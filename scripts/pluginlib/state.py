"""Transactional workflow state and resumable dispatch records."""

from __future__ import annotations

from collections.abc import Callable, Collection, Sequence
from contextlib import closing, contextmanager
from dataclasses import dataclass, replace
from hashlib import sha256
import json
import os
from pathlib import Path
import sqlite3
import time
from typing import Any, Iterator
from uuid import uuid4

from .workflows import Task, Workflow, WorkflowError, restore_workflow, task_input, validate_value


TERMINAL = {"completed", "failed", "cancelled"}


class StateError(ValueError):
    """An operation conflicts with the persisted workflow state."""


@dataclass(frozen=True, slots=True)
class Dispatch:
    """A claimed attempt. The key and original input survive a restart."""

    run_id: str
    task_id: str
    attempt: int
    task: Task
    input: dict
    idempotency_key: str
    deadline: float
    compensation: bool
    user_input: dict | None


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False)


def _attempt_key(run_id: str, task: Task, attempt: int, compensation: bool) -> str:
    # A declared key is stable across retries. Keys belong to a single run and
    # compensation cannot accidentally deduplicate against the original task.
    purpose = "compensation" if compensation else "task"
    token = task.idempotency_key or str(attempt)
    return sha256(_json([run_id, task.id, purpose, token]).encode("utf-8")).hexdigest()


def _new_attempt() -> dict:
    return {
        "status": "pending",
        "attempt": 0,
        "result": None,
        "artifacts": [],
        "error": None,
        "waiting_kind": None,
        "deadline": None,
        "idempotency_key": None,
        "input": None,
        "user_input": None,
        "approved": False,
    }


def _is_active(entry: dict) -> bool:
    return entry["status"] == "running" or (
        entry["status"] == "waiting_input" and entry["attempt"] > 0
    )


def _write_conflict(task: Task, running: Task) -> bool:
    if task.access != "write" or running.access != "write":
        return False
    return any(
        first == second or first.startswith(second + "/") or second.startswith(first + "/")
        for first in task.owned_paths
        for second in running.owned_paths
    )


class StateStore:
    """Store run definitions and attempts in SQLite to serialize concurrent claimers."""

    def __init__(self, database: Path, *, clock: Callable[[], float] = time.time):
        self.database = Path(database)
        self.clock = clock
        self.database.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        descriptor = os.open(self.database, os.O_RDWR | os.O_CREAT, 0o600)
        os.close(descriptor)
        with closing(self._connect()) as connection:
            connection.execute(
                "CREATE TABLE IF NOT EXISTS workflow_runs "
                "(id TEXT PRIMARY KEY, workflow TEXT NOT NULL, state TEXT NOT NULL)"
            )
            connection.commit()

    def _connect(self) -> sqlite3.Connection:
        return sqlite3.connect(self.database, timeout=30)

    @contextmanager
    def _edit(self, run_id: str) -> Iterator[tuple[Workflow, dict]]:
        with closing(self._connect()) as connection, connection:
            connection.execute("BEGIN IMMEDIATE")
            workflow, state = self._load(connection, run_id)
            yield workflow, state
            connection.execute(
                "UPDATE workflow_runs SET state = ? WHERE id = ?", (_json(state), run_id)
            )

    @staticmethod
    def _load(connection: sqlite3.Connection, run_id: str) -> tuple[Workflow, dict]:
        row = connection.execute(
            "SELECT workflow, state FROM workflow_runs WHERE id = ?", (run_id,)
        ).fetchone()
        if row is None:
            raise StateError(f"unknown workflow run {run_id!r}")
        return restore_workflow(row[0]), json.loads(row[1])

    def create_run(self, workflow: Workflow, inputs: dict, run_id: str | None = None) -> str:
        # Validate the pinned document too, avoiding discrepancies if a caller
        # mutated a nested dict on a workflow model after loading it.
        workflow = restore_workflow(workflow.document)
        if not isinstance(inputs, dict):
            raise StateError("workflow inputs must be an object")
        validate_value(workflow.input_schema, inputs, "workflow inputs")
        run_id = run_id or uuid4().hex
        state = {
            "run_id": run_id,
            "workflow_id": workflow.id,
            "status": "pending",
            "inputs": inputs,
            "tasks": {
                task.id: {**_new_attempt(), "provider": task.provider, "compensation": None}
                for task in workflow.tasks
            },
            "completion_order": [],
            "terminal_target": None,
        }
        with closing(self._connect()) as connection, connection:
            try:
                connection.execute(
                    "INSERT INTO workflow_runs(id, workflow, state) VALUES (?, ?, ?)",
                    (run_id, workflow.document, _json(state)),
                )
            except sqlite3.IntegrityError as error:
                raise StateError(f"workflow run {run_id!r} already exists") from error
        return run_id

    def snapshot(self, run_id: str) -> dict:
        with closing(self._connect()) as connection:
            return self._load(connection, run_id)[1]

    def _dispatch(self, state: dict, task: Task, entry: dict, compensation: bool = False) -> Dispatch:
        instructions = task.compensation if compensation else task.instructions
        return Dispatch(
            run_id=state["run_id"],
            task_id=task.id,
            attempt=entry["attempt"],
            task=replace(task, instructions=instructions) if compensation else task,
            input=json.loads(_json(entry["input"])),
            idempotency_key=entry["idempotency_key"],
            deadline=entry["deadline"],
            compensation=compensation,
            user_input=entry["user_input"],
        )

    def active(self, run_id: str) -> tuple[Dispatch, ...]:
        """Return running attempts, including dispatches pending provider acknowledgement."""
        with closing(self._connect()) as connection:
            workflow, state = self._load(connection, run_id)
            return tuple(
                self._dispatch(state, task, entry, compensating)
                for task in workflow.tasks
                for compensating, entry in self._entries(state, task)
                if entry["status"] == "running"
            )

    @staticmethod
    def _entries(state: dict, task: Task) -> Iterator[tuple[bool, dict]]:
        entry = state["tasks"][task.id]
        yield False, entry
        if entry["compensation"] is not None:
            yield True, entry["compensation"]

    def _claim(
        self, state: dict, task: Task, entry: dict, inputs: dict, *, compensation: bool = False
    ) -> Dispatch:
        entry["status"] = "running"
        entry["attempt"] += 1
        entry["deadline"] = self.clock() + task.timeout
        entry["idempotency_key"] = _attempt_key(
            state["run_id"], task, entry["attempt"], compensation
        )
        entry["input"] = inputs
        entry["error"] = None
        entry["waiting_kind"] = None
        return self._dispatch(state, task, entry, compensation)

    @staticmethod
    def _abort(state: dict, terminal: str) -> None:
        state["terminal_target"] = terminal
        for entry in state["tasks"].values():
            if entry["status"] == "pending" or (
                entry["status"] == "waiting_input" and entry["attempt"] == 0
            ):
                entry["status"] = "cancelled"
                entry["waiting_kind"] = None

    @staticmethod
    def _refresh(state: dict, workflow: Workflow) -> None:
        tasks = state["tasks"]
        if state["terminal_target"] is not None:
            unfinished = any(
                _is_active(tasks[task.id])
                or (
                    task.compensation is not None
                    and tasks[task.id]["status"] == "completed"
                    and (
                        tasks[task.id]["compensation"] is None
                        or tasks[task.id]["compensation"]["status"] not in TERMINAL
                    )
                )
                for task in workflow.tasks
            )
            state["status"] = "compensating" if unfinished else state["terminal_target"]
            return
        statuses = {entry["status"] for entry in tasks.values()}
        if statuses == {"completed"}:
            state["status"] = "completed"
        elif "running" in statuses:
            state["status"] = "running"
        elif "waiting_input" in statuses:
            state["status"] = "waiting_input"
        else:
            state["status"] = "pending"

    def _fail(
        self,
        state: dict,
        task: Task,
        entry: dict,
        message: str,
        retryable: bool,
        compensation: bool,
    ) -> None:
        retry = (
            retryable
            and not compensation
            and state["terminal_target"] is None
            and entry["attempt"] <= task.retries
        )
        entry.update(
            status="pending" if retry else "failed",
            error=message,
            deadline=None,
            waiting_kind=None,
        )
        if not retry and not compensation and state["terminal_target"] is None:
            self._abort(state, "failed")

    def _compensate(self, state: dict, workflow: Workflow) -> tuple[Dispatch, ...]:
        if any(_is_active(entry) for entry in state["tasks"].values()):
            return ()
        schedule = {task.id: task for task in workflow.tasks}
        for task_id in reversed(state["completion_order"]):
            task = schedule[task_id]
            if task.compensation is None:
                continue
            main = state["tasks"][task_id]
            entry = main["compensation"]
            if entry is None:
                entry = main["compensation"] = _new_attempt()
                inputs = {"input": main["input"], "result": main["result"], "artifacts": main["artifacts"]}
                return (self._claim(state, task, entry, inputs, compensation=True),)
            if entry["status"] not in TERMINAL:
                # Let the current compensation finish before walking farther back.
                return ()
        return ()

    def advance(self, run_id: str, capabilities: Collection[str]) -> tuple[Dispatch, ...]:
        """Apply timeouts and atomically claim up to one eligible DAG frontier."""
        with self._edit(run_id) as (workflow, state):
            if state["status"] in TERMINAL:
                return ()
            missing = workflow.capabilities - set(capabilities)
            if missing:
                raise StateError("missing required capabilities: " + ", ".join(sorted(missing)))
            now = self.clock()
            for task in workflow.tasks:
                for compensation, attempt in self._entries(state, task):
                    if attempt["status"] == "running" and attempt["deadline"] <= now:
                        self._fail(state, task, attempt, "deadline exceeded", True, compensation)
            if state["terminal_target"] is not None:
                dispatches = self._compensate(state, workflow)
                self._refresh(state, workflow)
                return dispatches
            entries = state["tasks"]
            running = [task for task in workflow.tasks if _is_active(entries[task.id])]
            dispatches = []
            for task in workflow.tasks:
                entry = entries[task.id]
                dependencies = {task_id: entries[task_id] for task_id in task.needs}
                if entry["status"] != "pending" or any(
                    parent["status"] != "completed" for parent in dependencies.values()
                ):
                    continue
                if task.approval and not entry["approved"]:
                    entry.update(status="waiting_input", waiting_kind="approval")
                    continue
                if any(_write_conflict(task, other) for other in running):
                    continue
                try:
                    inputs = task_input(
                        task, state["inputs"],
                        {task_id: parent["result"] for task_id, parent in dependencies.items()},
                    )
                except WorkflowError as error:
                    self._fail(state, task, entry, str(error), False, False)
                    break
                dispatches.append(self._claim(state, task, entry, inputs))
                running.append(task)
            self._refresh(state, workflow)
            return tuple(dispatches)

    @staticmethod
    def _find_attempt(
        state: dict, workflow: Workflow, task_id: str, attempt: int, compensation: bool
    ) -> tuple[Task, dict]:
        task = next((task for task in workflow.tasks if task.id == task_id), None)
        if task is None:
            raise StateError(f"unknown workflow task {task_id!r}")
        entry = state["tasks"][task_id]
        if compensation:
            entry = entry["compensation"]
        if entry is None or entry["attempt"] != attempt or not _is_active(entry):
            raise StateError(f"stale attempt {attempt} for task {task_id!r}")
        return task, entry

    def complete(
        self,
        run_id: str,
        task_id: str,
        attempt: int,
        result: Any,
        artifacts: Sequence[dict] = (),
        *,
        compensation: bool = False,
    ) -> None:
        """Record a result once and check the declared result/artifact contracts."""
        with self._edit(run_id) as (workflow, state):
            task, entry = self._find_attempt(state, workflow, task_id, attempt, compensation)
            if entry["status"] != "running":
                raise StateError(f"task {task_id!r} must receive operator input before completion")
            if not all(isinstance(item, dict) for item in artifacts):
                raise StateError("artifacts must be JSON objects")
            if not compensation:
                validate_value(task.output_schema, result, f"task {task_id} output")
                identifiers = {
                    value for item in artifacts for key in ("path", "id", "name")
                    if isinstance(value := item.get(key), str)
                }
                missing = set(task.artifacts) - identifiers
                if missing:
                    raise StateError("missing declared artifacts: " + ", ".join(sorted(missing)))
                state["completion_order"].append(task_id)
            entry.update(
                status="completed",
                result=result,
                artifacts=list(artifacts),
                error=None,
                deadline=None,
                waiting_kind=None,
            )
            self._refresh(state, workflow)

    def fail(
        self,
        run_id: str,
        task_id: str,
        attempt: int,
        message: str,
        retryable: bool = True,
        *,
        compensation: bool = False,
    ) -> None:
        with self._edit(run_id) as (workflow, state):
            task, entry = self._find_attempt(state, workflow, task_id, attempt, compensation)
            self._fail(state, task, entry, message, retryable, compensation)
            self._refresh(state, workflow)

    def wait_for_input(
        self,
        run_id: str,
        task_id: str,
        attempt: int,
        reason: str,
        kind: str = "input",
        *,
        compensation: bool = False,
    ) -> None:
        if kind not in {"input", "approval"}:
            raise StateError(f"unsupported waiting kind {kind!r}")
        with self._edit(run_id) as (workflow, state):
            _, entry = self._find_attempt(state, workflow, task_id, attempt, compensation)
            entry.update(status="waiting_input", error=reason, waiting_kind=kind, deadline=None)
            self._refresh(state, workflow)

    def provide_input(
        self,
        run_id: str,
        task_id: str,
        payload: dict,
        approved: bool = False,
        *,
        compensation: bool = False,
    ) -> None:
        if not isinstance(payload, dict):
            raise StateError("operator input must be an object")
        with self._edit(run_id) as (workflow, state):
            task = next((task for task in workflow.tasks if task.id == task_id), None)
            if task is None:
                raise StateError(f"unknown workflow task {task_id!r}")
            entry = state["tasks"][task.id]
            if compensation:
                entry = entry["compensation"]
            if entry is None or entry["status"] != "waiting_input":
                raise StateError(f"task {task_id!r} is not waiting for operator input")
            if entry["waiting_kind"] == "approval" and not approved:
                raise StateError(f"task {task_id!r} requires explicit approval")
            dispatched = entry["attempt"] > 0
            entry.update(
                status="running" if dispatched else "pending",
                approved=entry["approved"] or approved,
                user_input=payload,
                deadline=self.clock() + task.timeout if dispatched else None,
                error=None,
                waiting_kind=None,
            )
            self._refresh(state, workflow)

    def cancel(self, run_id: str) -> None:
        """Stop new work after the caller has cancelled outstanding provider handles."""
        with self._edit(run_id) as (workflow, state):
            if state["status"] in TERMINAL:
                return
            if state["terminal_target"] is None:
                self._abort(state, "cancelled")
            for entry in state["tasks"].values():
                if _is_active(entry):
                    entry.update(status="cancelled", waiting_kind=None, deadline=None)
            self._refresh(state, workflow)

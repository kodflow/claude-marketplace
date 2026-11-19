"""Connect durable workflow attempts to provider operations."""

from __future__ import annotations

from collections.abc import Iterator, Mapping
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, replace
import json
from typing import Any

from .journal import Journal, operation_key
from .ports import (
    ABANDONED_SUBMISSION, Event, Handle, Json, NoSendError, Provider, ProviderError, Request,
    SubmissionRejected, TERMINAL, uses_text_output,
)


@dataclass(frozen=True)
class Binding:
    provider: Provider
    route: str
    model: str = ""
    web_search: bool = False

    def capabilities(self) -> frozenset[str]:
        available = self.provider.capabilities()
        return available | ({"official-web", "web.official-docs"} if self.web_search else set())


class Supervisor:
    def __init__(
        self, state_store: Any, journal: Journal, providers: Mapping[str, Binding],
        *, default_provider: str, max_parallel: int = 4,
    ) -> None:
        if not 1 <= max_parallel <= 16:
            raise ValueError("max_parallel must be between 1 and 16")
        if state_store.database.resolve() != journal.database.resolve():
            raise ValueError("the workflow store and provider journal must share a database")
        self.store = state_store
        self.journal = journal
        self.providers = dict(providers)
        self.default_provider = default_provider
        self.max_parallel = max_parallel

    def _binding(self, name: str | None) -> Binding:
        key = name or self.default_provider
        if key not in self.providers:
            raise ProviderError(f"provider {key!r} is not configured")
        return self.providers[key]

    def _available(self) -> set[str]:
        return {"parallel-delegation", "structured-output", "human-approval"}.union(
            *(item.capabilities() for item in self.providers.values())
        )

    def preflight(self, workflow: Any) -> None:
        missing = workflow.capabilities - self._available()
        if missing:
            raise ProviderError("missing workflow capabilities: " + ", ".join(sorted(missing)))
        for task in workflow.tasks:
            if task.access != "read":
                raise ProviderError(f"task {task.id} requires repository.write, which this runtime does not provide")
            binding = self._binding(task.provider)
            missing = task.required_capabilities - self._available_for(binding)
            if missing:
                raise ProviderError(f"task {task.id} lacks provider capabilities: " + ", ".join(sorted(missing)))

    def execution_bindings(self, workflow: Any, *, live: bool) -> Json:
        """Capture provider settings for every task before any work can start."""
        task_routes = {}
        for task in workflow.tasks:
            provider = task.provider or self.default_provider
            binding = self._binding(provider)
            task_routes[task.id] = {
                "provider": provider, "route": binding.route,
                "model": binding.model, "web_search": binding.web_search,
            }
        return {"default_provider": self.default_provider, "task_routes": task_routes, "live": live}

    def _verify_run(self, run_id: str) -> None:
        definition = self.store.definition(run_id)
        execution = self.store.snapshot(run_id).get("execution")
        if execution is not None and self.execution_bindings(definition, live=execution["live"]) != execution:
            raise ProviderError("the run is pinned to a different provider route, model or configuration")

    @staticmethod
    def _available_for(binding: Binding) -> frozenset[str]:
        return binding.capabilities() | {"structured-output", "human-approval"}

    def _timeout(self, dispatch: Any) -> float:
        remaining = dispatch.deadline - self.store.clock()
        if remaining <= 0:
            raise ProviderError("provider dispatch deadline expired")
        return min(remaining, 120.0)

    @staticmethod
    def _check_handle(original: Event, update: Event) -> None:
        if update.handle.native_id != original.handle.native_id:
            raise ProviderError("provider returned a different native handle")

    def _poll(self, binding: Binding, key: str, event: Event, revision: int, *, timeout: float) -> tuple[Event, int]:
        try:
            update = binding.provider.resume(event.handle, timeout=timeout)
        except ProviderError:
            # A failed poll says nothing about the remote task or its original submission.
            raise ProviderError("provider poll failed; the existing handle can be resumed") from None
        self._check_handle(event, update)
        if not self.journal.save(key, binding.route, update, revision=revision):
            raise ProviderError("provider attempt changed during poll")
        return update, revision + 1

    def _provider_event(self, binding: Binding, dispatch: Any, key: str) -> tuple[Event, int]:
        event, action, revision = self.journal.read_revision(key, binding.route)
        if action:
            raise ProviderError("provider operation outcome is unknown; inspect or reconcile the attempt before retrying")
        if event is not None:
            if event.state in {"running", "waiting_auth"}:
                if event.poll_not_before is not None and event.poll_not_before > self.store.clock():
                    return event, revision
                return self._poll(binding, key, event, revision, timeout=self._timeout(dispatch))
            return event, revision

        request = Request(
            task_id=dispatch.idempotency_key,
            instructions=dispatch.task.instructions,
            inputs=dispatch.input,
            model=binding.model,
            timeout=self._timeout(dispatch),
            web_search=binding.web_search,
            output_schema=dispatch.task.output_schema,
        )
        if not self.journal.reserve(
            key, binding.route, guard=lambda db: self.store.authorize_submission(db, dispatch),
        ):
            raise ProviderError("another supervisor reserved this provider dispatch")
        try:
            event = binding.provider.submit(request)
        except (NoSendError, SubmissionRejected):
            self.journal.release_unprocessed(key, binding.route, "submit", revision=revision)
            raise
        except ProviderError as error:
            self.journal.mark_submit_unknown(key, binding.route, revision=revision)
            raise ProviderError(f"provider submission outcome is unknown: {error}") from None
        if not self.journal.save(key, binding.route, event, action="submit", revision=revision):
            raise ProviderError("provider dispatch reservation changed before persistence")
        return event, revision + 1

    @staticmethod
    def _output(event: Event, dispatch: Any) -> Any:
        schema = dispatch.task.output_schema
        if uses_text_output(schema):
            return {"text": event.text}
        try:
            return json.loads(event.text)
        except ValueError:
            raise ProviderError("provider output was not the required JSON value") from None

    def _process(self, dispatch: Any) -> None:
        args = (dispatch.run_id, dispatch.task_id, dispatch.attempt)
        flags = {"compensation": dispatch.compensation}
        binding = self._binding(dispatch.task.provider)
        key = operation_key(dispatch.idempotency_key, dispatch.attempt)
        event, revision = self._provider_event(binding, dispatch, key)
        if event.state in {"running", "waiting_auth"}:
            self.store.provider_status(
                *args, event.state, reason=event.reason, prompt_url=event.prompt_url, **flags,
            )
            return
        if event.state in {"waiting_input", "waiting_approval"}:
            kind = "approval" if event.state == "waiting_approval" else "input"
            self.store.wait_for_input(
                *args, event.reason or "provider is waiting for operator input", kind,
                checkpoint_revision=revision,
                checkpoint_guard=lambda db: self.journal.checkpoint_current(
                    db, key, binding.route, revision, event.state,
                ),
                **flags,
            )
        elif event.state == "completed":
            if not event.artifacts_collected:
                # Save the completed handle before fetching artifacts, so a transient
                # asset error can be retried without submitting the provider task again.
                artifacts = binding.provider.collect_artifacts(event, timeout=self._timeout(dispatch))
                event = replace(event, artifacts=artifacts, artifacts_collected=True)
                if not self.journal.save(key, binding.route, event, revision=revision):
                    raise ProviderError("provider attempt changed during artifact collection")
            self._complete(dispatch, event, binding)
        else:
            self.store.fail(*args, event.reason or f"provider task {event.state}", retryable=False, **flags)

    def _complete(self, dispatch: Any, event: Event, binding: Binding) -> None:
        args = (dispatch.run_id, dispatch.task_id, dispatch.attempt)
        flags = {"compensation": dispatch.compensation}
        try:
            result = self._output(event, dispatch)
        except ProviderError as error:
            self.store.fail(*args, str(error), retryable=False, **flags)
            return
        try:
            self.store.complete(
                *args, result, binding.provider.artifacts(event), retry_expired=False, **flags,
            )
        except ValueError as error:
            if not getattr(error, "transition_applied", False):
                self.store.fail(*args, "provider result did not satisfy the workflow contract", retryable=False, **flags)

    def step(self, run_id: str) -> Json:
        """Dispatch one runnable frontier and poll existing handles once."""
        self._verify_run(run_id)
        if self.store.snapshot(run_id).get("cancellation_requested"):
            self.cancel(run_id)
            return self.store.snapshot(run_id)
        self.preflight(self.store.definition(run_id))
        resolved = self._resolve_expired(run_id)
        self.store.advance(
            run_id, self._available(), resolved_expiry=resolved, expiry_guard=self._allows_expiry,
        )
        dispatches = [dispatch for dispatch in self.store.active(run_id) if dispatch.deadline > self.store.clock()]
        if dispatches:
            with ThreadPoolExecutor(max_workers=self.max_parallel) as pool:
                tuple(pool.map(self._process, dispatches))
        return self.store.snapshot(run_id)

    def _allows_expiry(self, connection: Any, dispatch: Any) -> bool:
        binding = self._binding(dispatch.task.provider)
        key = operation_key(dispatch.idempotency_key, dispatch.attempt)
        return self.journal.allows_expiry(connection, key, binding.route)

    def next_poll_delay(self, run_id: str) -> float | None:
        """Time until ready work or the earliest eligible poll, independent of other tasks."""
        state = self.store.snapshot(run_id)
        if state["status"] in TERMINAL:
            return None
        if state.get("cancellation_requested"):
            return 0
        tasks = state["tasks"]
        definition = self.store.definition(run_id)
        if any(
            tasks[task.id]["status"] == "pending"
            and all(tasks[dependency]["status"] == "completed" for dependency in task.needs)
            for task in definition.tasks
        ):
            return 0
        now = self.store.clock()
        delays = []
        for dispatch in self.store.active(run_id):
            binding = self._binding(dispatch.task.provider)
            key = operation_key(dispatch.idempotency_key, dispatch.attempt)
            event, action = self.journal.read(key, binding.route)
            if event is None or action or event.state not in {"running", "waiting_auth"}:
                return 0
            eligible = event.poll_not_before if event.poll_not_before is not None else now + 1
            delays.append(max(0, min(eligible, dispatch.deadline) - now))
        if delays:
            return min(delays)
        if state["status"] == "compensating" and not any(
            entry["status"] == "waiting_input" for entry, _ in self._attempts(state)
        ):
            return 0
        return None

    def _resolve_expired(self, run_id: str) -> set[tuple[str, int, bool]]:
        # A timeout only permits retry once the same attempt is resolved remotely.
        now = self.store.clock()
        resolved = set()
        for dispatch in self.store.active(run_id):
            if dispatch.deadline > now:
                continue
            binding = self._binding(dispatch.task.provider)
            key = operation_key(dispatch.idempotency_key, dispatch.attempt)
            event, action, revision = self.journal.read_revision(key, binding.route)
            if action:
                raise ProviderError("expired provider operation requires reconciliation before retry")
            if event is not None and event.state not in TERMINAL:
                if "cancel" in binding.capabilities():
                    event = self._cancel_one(binding, key, event, revision)
                else:
                    event, _ = self._poll(binding, key, event, revision, timeout=20)
                    if event.state not in TERMINAL:
                        raise ProviderError("expired provider attempt remains active and cannot be cancelled")
            if event is not None and event.state in {"completed", ABANDONED_SUBMISSION}:
                # A finished remote task and an operator-abandoned submission
                # must not be repeated when their local workflow deadline passes.
                message = event.reason if event.state == ABANDONED_SUBMISSION else "deadline exceeded"
                self.store.fail(
                    run_id, dispatch.task_id, dispatch.attempt, message,
                    retryable=False, compensation=dispatch.compensation,
                )
                continue
            resolved.add((dispatch.task_id, dispatch.attempt, dispatch.compensation))
        return resolved

    def _task_entry(self, run_id: str, task_id: str) -> Json:
        tasks = self.store.snapshot(run_id)["tasks"]
        if task_id not in tasks:
            raise ProviderError("unknown workflow task")
        return tasks[task_id]

    def _pending(self, run_id: str, task_id: str) -> tuple[Binding, Json]:
        entry = self._task_entry(run_id, task_id)
        return self._binding(entry["provider"]), entry

    def usage(self, run_id: str, task_id: str) -> dict[str, int]:
        entry = self._task_entry(run_id, task_id)
        if not entry["idempotency_key"]:
            raise ProviderError("task has no provider attempt")
        return self.journal.usage(operation_key(entry["idempotency_key"], entry["attempt"]))

    def provide_input(
        self, run_id: str, task_id: str, payload: Json, *, approved: bool | None = None,
        attempt: int | None = None, checkpoint: int | None = None,
    ) -> None:
        self._verify_run(run_id)
        binding, entry = self._pending(run_id, task_id)
        if entry["status"] != "waiting_input":
            raise ProviderError("workflow task is not waiting for operator input")
        attempt = entry["attempt"] if attempt is None else attempt
        checkpoint = entry.get("checkpoint_revision", 0) if checkpoint is None else checkpoint
        if attempt != entry["attempt"] or checkpoint != entry.get("checkpoint_revision", 0):
            raise ProviderError("operator checkpoint is no longer current")
        approval = entry["waiting_kind"] == "approval"
        if approval != (approved is not None):
            raise ProviderError("operator input does not match the waiting operation")
        if entry["attempt"] == 0:
            if not approved:
                self.cancel(run_id)
                return
            self.store.provide_input(run_id, task_id, attempt, payload, approved=True, checkpoint_revision=checkpoint)
            return

        key = operation_key(entry["idempotency_key"], attempt)
        event, action, revision = self.journal.read_revision(key, binding.route)
        if event is None or action:
            raise ProviderError("provider operation requires reconciliation")
        capability = "approval" if approval else "input"
        expected = "waiting_approval" if approval else "waiting_input"
        if revision != checkpoint:
            if not self.journal.confirmed(
                key, binding.route, capability, revision=checkpoint + 1, decision=approved,
            ):
                raise ProviderError("provider checkpoint changed or a different decision was already recorded")
            payload = {"reconciled": True}
        else:
            if event.state != expected or capability not in binding.capabilities():
                raise ProviderError(f"provider does not accept {capability} at this checkpoint")
            self.journal.begin_action(
                key, binding.route, capability, revision=checkpoint, decision=approved,
                guard=lambda db: self.store.authorize_interaction(db, run_id, task_id, attempt, checkpoint),
            )
            try:
                if approved is None:
                    update = binding.provider.provide_input(event.handle, payload, timeout=120)
                else:
                    update = binding.provider.approve(event.handle, approved, str(payload.get("reason", "")), timeout=120)
            except NoSendError:
                self.journal.release_unprocessed(key, binding.route, capability, revision=checkpoint)
                raise
            self._check_handle(event, update)
            if not self.journal.save(key, binding.route, update, action=capability, revision=checkpoint):
                raise ProviderError("provider operation changed during operator input")
        # A denial is a valid response to a provider approval checkpoint.
        self.store.provide_input(
            run_id, task_id, attempt, payload, approved=approval, checkpoint_revision=checkpoint,
        )

    def _recovery_entry(self, run_id: str, task_id: str) -> tuple[Binding, Json, bool]:
        binding, entry = self._pending(run_id, task_id)
        compensation = entry.get("compensation")
        if compensation and compensation["status"] in {"running", "waiting_input"}:
            return binding, compensation, True
        return binding, entry, False

    def abandon_submission(self, run_id: str, task_id: str) -> Event:
        """Close an unconfirmed submit locally without retrying or claiming remote cancellation."""
        self._verify_run(run_id)
        binding, entry, compensation = self._recovery_entry(run_id, task_id)
        logical_key = entry.get("idempotency_key")
        if not logical_key or entry["status"] != "running":
            raise ProviderError("task has no active submission to abandon")
        key = operation_key(logical_key, entry["attempt"])
        event, action, revision = self.journal.read_revision(key, binding.route)
        if event is None and action in {"submit", "submit_unknown"}:
            self._require_submit_not_in_flight(entry, action)
            event = Event(
                ABANDONED_SUBMISSION, Handle(""),
                reason="operator abandoned the submission; remote outcome remains unknown",
            )
            if not self.journal.save(key, binding.route, event, action=action, revision=revision):
                raise ProviderError("provider submission changed before it could be abandoned")
        elif event is None or event.state != ABANDONED_SUBMISSION:
            raise ProviderError("task has no uncertain submission to abandon")
        self.store.fail(
            run_id, task_id, entry["attempt"], event.reason, retryable=False, compensation=compensation,
        )
        return event

    def _require_submit_not_in_flight(self, entry: Json, action: str) -> None:
        deadline = entry.get("deadline")
        if action == "submit" and (deadline is None or deadline > self.store.clock()):
            raise ProviderError("provider submission might still be in flight; wait for its deadline")

    def reconcile(self, run_id: str, task_id: str, native_id: str | None = None) -> Event:
        """Recover an interrupted operation by polling its known native handle."""
        self._verify_run(run_id)
        binding, entry, compensation = self._recovery_entry(run_id, task_id)
        logical_key = entry.get("idempotency_key")
        if not logical_key:
            raise ProviderError("task has no provider attempt")
        key = operation_key(logical_key, entry["attempt"])
        event, action, revision = self.journal.read_revision(key, binding.route)
        if not action:
            raise ProviderError("task has no uncertain provider operation")
        self._require_submit_not_in_flight(entry, action)
        if event is None and not native_id:
            raise ProviderError("supply the native provider handle found out of band")
        if event is not None and native_id and event.handle.native_id != native_id:
            raise ProviderError("supplied native handle differs from the existing task")
        handle = event.handle if event is not None else binding.provider.recover_handle(native_id or "", timeout=120)
        update = binding.provider.resume(handle, timeout=120)
        if update.handle.native_id != handle.native_id:
            raise ProviderError("provider returned a different native handle")
        if action == "cancel" and update.state not in TERMINAL:
            raise ProviderError(
                "cancellation remains unconfirmed; resolve it with the provider and reconcile again",
            )
        interaction = action in {"input", "approval"}
        if interaction and event is not None and update.state == event.state and update.handle == handle:
            raise ProviderError("provider has not confirmed a change at the waiting checkpoint")
        if not self.journal.save(key, binding.route, update, action=action, revision=revision):
            raise ProviderError("provider attempt changed during reconciliation")
        if interaction and entry["status"] == "waiting_input":
            self.store.provide_input(
                run_id, task_id, entry["attempt"], {"reconciled": True},
                approved=entry["waiting_kind"] == "approval",
                checkpoint_revision=entry.get("checkpoint_revision", 0), compensation=compensation,
            )
        return update

    @staticmethod
    def _attempts(state: Json) -> Iterator[tuple[Json, str | None]]:
        for entry in state["tasks"].values():
            yield entry, entry["provider"]
            if entry["compensation"] is not None:
                yield entry["compensation"], entry["provider"]

    def cancel(self, run_id: str) -> None:
        self._verify_run(run_id)
        state = self.store.begin_cancel(run_id)
        if state["status"] in TERMINAL:
            return
        outstanding = []
        for entry, provider in self._attempts(state):
            logical_key = entry["idempotency_key"]
            if not logical_key or entry["status"] not in {"running", "waiting_input"}:
                continue
            binding = self._binding(provider)
            key = operation_key(logical_key, entry["attempt"])
            event, action, revision = self.journal.read_revision(key, binding.route)
            if action:
                raise ProviderError("cancellation pending: wait for or reconcile the in-flight provider operation")
            if event is not None and event.state not in TERMINAL:
                if "cancel" not in binding.capabilities():
                    raise ProviderError("an active provider does not support cancellation")
                outstanding.append((binding, key, event, revision))
        for binding, key, event, revision in outstanding:
            self._cancel_one(binding, key, event, revision)
        self.store.cancel(run_id)

    def _cancel_one(self, binding: Binding, key: str, event: Event, revision: int) -> Event:
        self.journal.begin_action(key, binding.route, "cancel", revision=revision)
        try:
            stopped = binding.provider.cancel(event.handle, timeout=20)
        except NoSendError:
            self.journal.release_unprocessed(key, binding.route, "cancel", revision=revision)
            raise
        self._check_handle(event, stopped)
        if not self.journal.save(key, binding.route, stopped, action="cancel", revision=revision):
            raise ProviderError("provider attempt changed during cancellation")
        if stopped.state not in TERMINAL:
            raise ProviderError("provider cancellation is not yet confirmed")
        return stopped

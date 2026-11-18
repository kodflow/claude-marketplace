"""Connect the workflow state port to provider operations without resubmission on restart."""

from __future__ import annotations

from collections.abc import Mapping
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
import json
from typing import Any

from .journal import Journal
from .ports import Event, Handle, Json, Provider, ProviderError, Request, TERMINAL


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
            binding = self._binding(task.provider)
            missing = task.required_capabilities - self._available_for(binding)
            if missing:
                raise ProviderError(f"task {task.id} lacks provider capabilities: " + ", ".join(sorted(missing)))

    @staticmethod
    def _available_for(binding: Binding) -> frozenset[str]:
        return binding.capabilities() | {"structured-output", "human-approval"}

    def _timeout(self, dispatch: Any) -> float:
        remaining = dispatch.deadline - self.store.clock()
        if remaining <= 0:
            raise ProviderError("provider dispatch deadline expired")
        return min(remaining, 120.0)

    def _provider_event(self, binding: Binding, dispatch: Any) -> Event:
        key = dispatch.idempotency_key
        event, action = self.journal.read(key, binding.route)
        if action:
            raise ProviderError("provider operation outcome is unknown; inspect or reconcile the attempt before retrying")
        if event is not None:
            if event.state == "running":
                try:
                    update = binding.provider.resume(event.handle, timeout=self._timeout(dispatch))
                except ProviderError:
                    # A failed poll says nothing about the remote task or its original submission.
                    raise ProviderError("provider poll failed; the existing handle can be resumed") from None
                if update.handle.native_id != event.handle.native_id:
                    raise ProviderError("provider changed the persisted task handle")
                if not self.journal.save(key, binding.route, update, previous=event):
                    raise ProviderError("provider attempt changed during poll")
                return update
            return event
        if not self.journal.reserve(key, binding.route):
            raise ProviderError("another supervisor reserved this provider dispatch")
        try:
            event = binding.provider.submit(Request(
                task_id=key,
                instructions=dispatch.task.instructions,
                inputs=dispatch.input,
                model=binding.model,
                timeout=self._timeout(dispatch),
                web_search=binding.web_search,
                output_schema=dispatch.task.output_schema,
            ))
        except ProviderError as error:
            raise ProviderError(f"provider submission outcome is unknown: {error}") from None
        if not self.journal.save(key, binding.route, event, action="submit"):
            raise ProviderError("provider dispatch reservation changed before persistence")
        return event

    @staticmethod
    def _output(event: Event, dispatch: Any) -> Any:
        schema = dispatch.task.output_schema
        properties = schema.get("properties", {})
        if not schema or properties.keys() == {"text"}:
            return {"text": event.text}
        try:
            return json.loads(event.text)
        except ValueError:
            raise ProviderError("provider output was not the required JSON value") from None

    def _process(self, dispatch: Any) -> None:
        args = (dispatch.run_id, dispatch.task_id, dispatch.attempt)
        flags = {"compensation": dispatch.compensation}
        binding = self._binding(dispatch.task.provider)
        if dispatch.task.access != "read":
            raise ProviderError(f"task {dispatch.task_id} requires repository.write, which this runtime does not provide")
        missing = dispatch.task.required_capabilities - self._available_for(binding)
        if missing:
            raise ProviderError(f"provider for {dispatch.task_id} lacks: " + ", ".join(sorted(missing)))
        event = self._provider_event(binding, dispatch)
        if event.state == "running":
            return
        if event.state.startswith("waiting_"):
            kind = "approval" if event.state == "waiting_approval" else "input"
            self.store.wait_for_input(*args, event.reason or "provider is waiting for operator input", kind, **flags)
        elif event.state == "completed":
            try:
                result = self._output(event, dispatch)
                self.store.complete(*args, result, binding.provider.artifacts(event), **flags)
            except ValueError:
                self.store.fail(*args, "provider result did not satisfy the workflow contract", retryable=False, **flags)
            except ProviderError as error:
                self.store.fail(*args, str(error), retryable=False, **flags)
        else:
            self.store.fail(*args, event.reason or f"provider task {event.state}", retryable=False, **flags)

    def step(self, run_id: str) -> Json:
        """Dispatch one runnable frontier and poll existing handles once."""
        self._resolve_expired(run_id)
        self.store.advance(run_id, self._available())
        dispatches = self.store.active(run_id)
        if dispatches:
            with ThreadPoolExecutor(max_workers=self.max_parallel) as pool:
                tuple(pool.map(self._process, dispatches))
        return self.store.snapshot(run_id)

    def _resolve_expired(self, run_id: str) -> None:
        # The DAG may retry a timed-out step. Resolve its existing provider
        # operation first so the retry cannot abandon work still running remotely.
        for dispatch in self.store.active(run_id):
            if dispatch.deadline > self.store.clock():
                continue
            binding = self._binding(dispatch.task.provider)
            key = dispatch.idempotency_key
            event, action = self.journal.read(key, binding.route)
            if action:
                raise ProviderError("expired provider operation requires reconciliation before retry")
            if event is None:
                continue
            if event.state == "running":
                self._cancel_one(binding, key, event)
            elif event.state.startswith("waiting_") or event.state == "completed":
                self._process(dispatch)

    def _pending(self, run_id: str, task_id: str) -> tuple[Binding, Json]:
        tasks = self.store.snapshot(run_id)["tasks"]
        if task_id not in tasks:
            raise ProviderError("unknown workflow task")
        entry = tasks[task_id]
        return self._binding(entry["provider"]), entry

    def provide_input(self, run_id: str, task_id: str, payload: Json, *, approved: bool | None = None) -> None:
        binding, entry = self._pending(run_id, task_id)
        if entry["status"] != "waiting_input":
            raise ProviderError("workflow task is not waiting for operator input")
        approval = entry["waiting_kind"] == "approval"
        if approval != (approved is not None):
            raise ProviderError("operator input does not match the waiting operation")
        if entry["attempt"] == 0:
            if not approved:
                self.cancel(run_id)
                return
            self.store.provide_input(run_id, task_id, payload, approved=True)
            return

        key = entry["idempotency_key"]
        event, action = self.journal.read(key, binding.route)
        if event is None or action:
            raise ProviderError("provider operation requires reconciliation")
        expected = "waiting_approval" if approval else "waiting_input"
        if event.state == expected:
            capability = "approval" if approval else "input"
            if capability not in binding.capabilities():
                raise ProviderError(f"provider does not support {capability}")
            self.journal.begin_action(key, binding.route, capability)
            if approved is None:
                update = binding.provider.provide_input(event.handle, payload, timeout=120)
            else:
                update = binding.provider.approve(event.handle, approved, str(payload.get("reason", "")), timeout=120)
            if update.handle.native_id != event.handle.native_id:
                raise ProviderError("provider returned a different native handle")
            if not self.journal.save(key, binding.route, update, action=capability):
                raise ProviderError("provider operation changed during operator input")
        # The explicit decision (including denial) was sent to the provider before advancing local state.
        # The workflow's approval flag releases the checkpoint, not the remote action itself.
        self.store.provide_input(run_id, task_id, payload, approved=approval)

    def reconcile(self, run_id: str, task_id: str, native_id: str | None = None) -> Event:
        """Recover an interrupted operation by polling its known native handle."""
        binding, entry = self._pending(run_id, task_id)
        key = entry.get("idempotency_key")
        if not key:
            raise ProviderError("task has no provider attempt")
        event, action = self.journal.read(key, binding.route)
        if not action:
            raise ProviderError("task has no uncertain provider operation")
        if event is None and not native_id:
            raise ProviderError("supply the native provider handle found out of band")
        if event is not None and native_id and event.handle.native_id != native_id:
            raise ProviderError("supplied native handle differs from the existing task")
        handle = event.handle if event is not None else Handle(native_id or "")
        update = binding.provider.resume(handle, timeout=120)
        if update.handle.native_id != handle.native_id:
            raise ProviderError("provider returned a different native handle")
        interaction = action in {"input", "approval"}
        if (
            interaction and event is not None and update.state == event.state
            and (not update.handle.context_id or update.handle.context_id == handle.context_id)
        ):
            raise ProviderError("provider has not confirmed a change at the waiting checkpoint")
        if not self.journal.save(key, binding.route, update, action=action):
            raise ProviderError("provider attempt changed during reconciliation")
        if interaction and entry["status"] == "waiting_input":
            self.store.provide_input(
                run_id, task_id, {"reconciled": True}, approved=entry["waiting_kind"] == "approval",
            )
        return update

    def cancel(self, run_id: str) -> None:
        state = self.store.snapshot(run_id)
        if state["status"] in TERMINAL:
            return
        outstanding = []
        for entry in state["tasks"].values():
            key = entry["idempotency_key"]
            if not key or entry["status"] not in {"running", "waiting_input"}:
                continue
            binding = self._binding(entry["provider"])
            event, action = self.journal.read(key, binding.route)
            if action or event is None:
                raise ProviderError("a provider operation requires reconciliation before cancellation")
            if event.state not in TERMINAL:
                if "cancel" not in binding.capabilities():
                    raise ProviderError("an active provider does not support cancellation")
                outstanding.append((binding, key, event))
        for binding, key, event in outstanding:
            self._cancel_one(binding, key, event)
        self.store.cancel(run_id)

    def _cancel_one(self, binding: Binding, key: str, event: Event) -> None:
        if "cancel" not in binding.capabilities():
            raise ProviderError("an active provider does not support cancellation")
        self.journal.begin_action(key, binding.route, "cancel")
        stopped = binding.provider.cancel(event.handle, timeout=20)
        if stopped.handle.native_id != event.handle.native_id:
            raise ProviderError("provider returned a different native handle")
        if not self.journal.save(key, binding.route, stopped, action="cancel"):
            raise ProviderError("provider attempt changed during cancellation")
        if stopped.state not in TERMINAL:
            raise ProviderError("provider cancellation is not yet confirmed")

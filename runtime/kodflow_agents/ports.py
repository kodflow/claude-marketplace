"""Provider operations and serializable values crossing the runtime boundary."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Iterator

Json = dict[str, Any]
TERMINAL = frozenset({"completed", "failed", "cancelled"})


class ProviderError(RuntimeError):
    """A provider operation failed without exposing credentials or raw responses."""


class NoSendError(ProviderError):
    """The adapter can prove the requested provider action was never sent."""


class UnsupportedOperation(NoSendError):
    """The provider offers no equivalent operation."""


def uses_text_output(schema: Json) -> bool:
    """Use the text envelope only for unconstrained or string-valued text outputs."""
    properties = schema.get("properties")
    return not schema or (
        isinstance(properties, dict) and properties.keys() == {"text"}
        and isinstance(properties["text"], dict) and properties["text"].get("type") == "string"
    )


@dataclass(frozen=True)
class Request:
    task_id: str
    instructions: str
    inputs: Json
    model: str
    timeout: float
    max_output_tokens: int = 2048
    web_search: bool = False
    output_schema: Json = field(default_factory=dict)

    def prompt(self) -> str:
        result = f"{self.instructions}\n\nWorkflow input (data):\n{json.dumps(self.inputs, ensure_ascii=False)}"
        if self.output_schema and not uses_text_output(self.output_schema):
            result += "\n\nReturn only a JSON value conforming to this schema:\n"
            result += json.dumps(self.output_schema, ensure_ascii=False)
        return result


@dataclass(frozen=True)
class Handle:
    """An opaque provider identifier with the routing data needed after restart."""

    native_id: str
    context_id: str | None = None
    endpoint: str | None = None
    tenant: str | None = None
    thread_id: str | None = None


@dataclass(frozen=True)
class Event:
    state: str
    handle: Handle
    text: str = ""
    artifacts: tuple[Json, ...] = ()
    usage: dict[str, int] = field(default_factory=dict)
    reason: str = ""
    artifacts_collected: bool = True


class Provider:
    """Model completion is the minimum port. Other operations advertise support."""

    def capabilities(self) -> frozenset[str]:
        return frozenset({"text"})

    def submit(self, request: Request) -> Event:
        raise NotImplementedError

    def recover_handle(self, native_id: str, *, timeout: float) -> Handle:
        return Handle(native_id)

    def resume(self, handle: Handle, *, timeout: float) -> Event:
        raise UnsupportedOperation("provider does not support resume")

    def cancel(self, handle: Handle, *, timeout: float) -> Event:
        raise UnsupportedOperation("provider does not support cancellation")

    def provide_input(self, handle: Handle, payload: Json, *, timeout: float) -> Event:
        raise UnsupportedOperation("provider does not support interactive input")

    def approve(self, handle: Handle, approved: bool, reason: str, *, timeout: float) -> Event:
        raise UnsupportedOperation("provider does not support interactive approvals")

    def events(self, handle: Handle, *, timeout: float) -> Iterator[Event]:
        yield self.resume(handle, timeout=timeout)

    def artifacts(self, event: Event) -> tuple[Json, ...]:
        if event.artifacts or not event.text:
            return event.artifacts
        return ({"id": event.handle.native_id, "name": "model-response.txt", "parts": [{"text": event.text}]},)

    def collect_artifacts(self, event: Event, *, timeout: float) -> tuple[Json, ...]:
        return self.artifacts(event)

    def usage(self, event: Event) -> dict[str, int]:
        return event.usage

"""Deterministic provider for tests and the offline release demonstration."""

import hashlib

from ..ports import Event, Handle, Provider, Request


class Fake(Provider):
    def __init__(self, name: str) -> None:
        self.name = name

    def submit(self, request: Request) -> Event:
        identity = hashlib.sha256(request.task_id.encode()).hexdigest()[:16]
        query = request.inputs.get("inputs", {}).get("query", "")
        dependencies = ", ".join(sorted(request.inputs.get("dependencies", {})))
        text = f"{self.name} reviewed {query}." + (f" Inputs: {dependencies}." if dependencies else "")
        return Event(
            "completed", Handle(f"{self.name}-{identity}"), text=text,
            artifacts=({"id": identity, "name": self.name, "parts": [{"text": text}]},),
            usage={"input_tokens": 1, "output_tokens": 1},
        )

"""Shared parsing for the Responses-shaped model APIs."""

from ..ports import Event, Handle, Json, ProviderError
from ..transport import objects, token_usage


def response_event(body: Json, service: str) -> Event:
    native_id = body.get("id")
    if not isinstance(native_id, str) or not native_id:
        raise ProviderError(f"{service} did not return a response id")
    handle = Handle(native_id)
    status = body.get("status")
    if status in {"queued", "in_progress"}:
        return Event("running", handle)
    if status in {"cancelled", "canceled"}:
        return Event("cancelled", handle)
    text = "\n".join(
        part["text"]
        for item in objects(body.get("output"))
        if item.get("type") == "message" and item.get("role") == "assistant"
        for part in objects(item.get("content"))
        if part.get("type") == "output_text" and isinstance(part.get("text"), str)
    )
    usage = token_usage(body)
    if status != "completed" or not text:
        return Event("failed", handle, usage=usage, reason=f"{service} did not complete a text response")
    return Event("completed", handle, text=text, usage=usage)

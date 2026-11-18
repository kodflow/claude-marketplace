"""Anthropic Messages API. Only text blocks are exported from a response."""

from ..ports import Event, Handle, Provider, ProviderError, Request
from ..transport import Transport, credential, objects, token_usage


class Anthropic(Provider):
    def __init__(self, transport: Transport) -> None:
        self.transport = transport

    def submit(self, request: Request) -> Event:
        body = {
            "model": request.model,
            "max_tokens": request.max_output_tokens,
            "messages": [{"role": "user", "content": request.prompt()}],
        }
        if request.web_search:
            body["tools"] = [{"type": "web_search_20250305", "name": "web_search", "max_uses": 3}]
        reply = self.transport.request(
            "POST", "https://api.anthropic.com/v1/messages", body,
            headers={"x-api-key": credential("ANTHROPIC_API_KEY"), "anthropic-version": "2023-06-01"},
            timeout=request.timeout,
        ).body
        identifier = reply.get("id")
        if not isinstance(identifier, str) or not identifier:
            raise ProviderError("Anthropic did not return a message id")
        text = "\n".join(
            block["text"] for block in objects(reply.get("content"))
            if block.get("type") == "text" and isinstance(block.get("text"), str)
        )
        if not text or reply.get("stop_reason") not in {"end_turn", "stop_sequence"}:
            return Event("failed", Handle(identifier), usage=token_usage(reply),
                         reason="Anthropic did not complete a text response")
        return Event("completed", Handle(identifier), text=text, usage=token_usage(reply))

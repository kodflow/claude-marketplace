"""Anthropic Messages API. Only text blocks are exported from a response."""

import time

from ..ports import Event, Handle, Provider, ProviderError, Request
from ..transport import Transport, credential, objects, token_usage

_MAX_CONTINUATIONS = 3


class Anthropic(Provider):
    def __init__(self, transport: Transport) -> None:
        self.transport = transport

    def submit(self, request: Request) -> Event:
        messages = [{"role": "user", "content": request.prompt()}]
        body = {
            "model": request.model,
            "max_tokens": request.max_output_tokens,
        }
        if request.web_search:
            body["tools"] = [{"type": "web_search_20250305", "name": "web_search", "max_uses": 3}]
        headers = {"x-api-key": credential("ANTHROPIC_API_KEY"), "anthropic-version": "2023-06-01"}
        deadline = time.monotonic() + request.timeout
        usage: dict[str, int] = {}
        text: list[str] = []
        handle = None
        for attempt in range(_MAX_CONTINUATIONS + 1):
            timeout = deadline - time.monotonic()
            if timeout <= 0:
                break
            reply = self.transport.request(
                "POST", "https://api.anthropic.com/v1/messages",
                {**body, "messages": list(messages)}, headers=headers, timeout=timeout,
            ).body
            identifier = reply.get("id")
            if not isinstance(identifier, str) or not identifier:
                raise ProviderError("Anthropic did not return a message id")
            handle = Handle(identifier)
            for name, count in token_usage(reply).items():
                usage[name] = usage.get(name, 0) + count
            content = reply.get("content")
            text.extend(
                block["text"] for block in objects(content)
                if block.get("type") == "text" and isinstance(block.get("text"), str)
            )
            reason = reply.get("stop_reason")
            if reason == "pause_turn":
                if attempt == _MAX_CONTINUATIONS or not isinstance(content, list) or not content:
                    break
                # Claude must receive every suspended assistant turn verbatim.
                messages.append({"role": "assistant", "content": content})
                continue
            if reason in {"end_turn", "stop_sequence"} and any(text):
                return Event("completed", handle, text="\n".join(text), usage=usage)
            return Event("failed", handle, usage=usage, reason="Anthropic did not complete a text response")
        if handle is None:
            raise ProviderError("Anthropic request deadline exhausted")
        return Event("failed", handle, usage=usage, reason="Anthropic continuation budget exhausted")

"""Perplexity Agent API. Computer threads use the separate MCP adapter."""

from ..ports import Event, Provider, Request
from ..transport import Transport, credential
from .responses import response_event


class Perplexity(Provider):
    def __init__(self, transport: Transport) -> None:
        self.transport = transport

    def submit(self, request: Request) -> Event:
        payload = {
            "model": request.model,
            "input": request.prompt(),
            "max_output_tokens": request.max_output_tokens,
        }
        if request.web_search:
            payload["tools"] = [{"type": "web_search"}]
            payload["max_steps"] = 3
        reply = self.transport.request(
            "POST", "https://api.perplexity.ai/v1/agent", payload,
            headers={"Authorization": f"Bearer {credential('PERPLEXITY_API_KEY')}"},
            timeout=request.timeout,
        ).body
        return response_event(reply, "Perplexity")

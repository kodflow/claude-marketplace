"""OpenAI Responses API, with explicit opt-in to stored background responses."""

from urllib.parse import quote

from ..ports import Event, Handle, Provider, Request
from ..transport import Transport, credential
from .responses import response_event

_ENDPOINT = "https://api.openai.com/v1/responses"


class OpenAI(Provider):
    def __init__(self, transport: Transport, *, background: bool = False) -> None:
        self.transport = transport
        self.background = background

    def capabilities(self) -> frozenset[str]:
        return frozenset({"text", "resume", "cancel"} if self.background else {"text"})

    @staticmethod
    def _headers() -> dict[str, str]:
        return {"Authorization": f"Bearer {credential('OPENAI_API_KEY')}"}

    def submit(self, request: Request) -> Event:
        payload = {
            "model": request.model,
            "input": request.prompt(),
            "store": self.background,
            "background": self.background,
            "max_output_tokens": request.max_output_tokens,
        }
        if request.web_search:
            payload["tools"] = [{"type": "web_search"}]
        reply = self.transport.request(
            "POST", _ENDPOINT, payload, headers=self._headers(), timeout=request.timeout,
        ).body
        return response_event(reply, "OpenAI")

    def resume(self, handle: Handle, *, timeout: float) -> Event:
        if not self.background:
            return super().resume(handle, timeout=timeout)
        path = quote(handle.native_id, safe="")
        reply = self.transport.request("GET", f"{_ENDPOINT}/{path}", headers=self._headers(), timeout=timeout).body
        return response_event(reply, "OpenAI")

    def cancel(self, handle: Handle, *, timeout: float) -> Event:
        if not self.background:
            return super().cancel(handle, timeout=timeout)
        path = quote(handle.native_id, safe="")
        reply = self.transport.request(
            "POST", f"{_ENDPOINT}/{path}/cancel", headers=self._headers(), timeout=timeout,
        ).body
        return response_event(reply, "OpenAI")

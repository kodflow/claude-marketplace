"""Anthropic Messages API. Only text blocks are exported from a response."""

import time

from ..ports import Event, Handle, NoSendError, Provider, ProviderError, Request, SubmissionRejected
from ..transport import ProviderHTTPError, Transport, credential, objects, token_usage

_MAX_CONTINUATIONS = 3
# Admission errors described by the Claude API contract. A bare HTTP status,
# timeout or server error cannot establish that inference never started.
_ADMISSION_ERRORS = {
    400: "invalid_request_error",
    401: "authentication_error",
    402: "billing_error",
    403: "permission_error",
    404: "not_found_error",
    413: "request_too_large",
    429: "rate_limit_error",
}


class Anthropic(Provider):
    def __init__(self, transport: Transport) -> None:
        self.transport = transport

    @staticmethod
    def _failed(handle: Handle, usage: dict[str, int], reason: str) -> Event:
        # A returned Messages handle proves that the workflow request started.
        return Event("failed", handle, usage=usage, reason=reason, retryable_on_expiry=False)

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
            try:
                reply = self.transport.request(
                    "POST", "https://api.anthropic.com/v1/messages",
                    {**body, "messages": list(messages)}, headers=headers, timeout=timeout,
                ).body
            except ProviderHTTPError as error:
                if not error.error_type or _ADMISSION_ERRORS.get(error.status) != error.error_type:
                    raise
                rejection = f"Anthropic rejected the request: {error}"
                if handle is None:
                    raise SubmissionRejected(rejection) from None
                return self._failed(handle, usage, rejection)
            except NoSendError:
                if handle is None:
                    raise
                return self._failed(handle, usage, "Anthropic continuation was not sent")
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
            return self._failed(handle, usage, "Anthropic did not complete a text response")
        if handle is None:
            raise NoSendError("Anthropic request deadline exhausted before sending")
        return self._failed(handle, usage, "Anthropic continuation budget exhausted")

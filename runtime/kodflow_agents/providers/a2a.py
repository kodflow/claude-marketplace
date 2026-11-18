"""A2A 1.0 JSON-RPC over HTTPS using an operator-configured Agent Card."""

from uuid import uuid4

from ..ports import Event, Handle, Json, Provider, ProviderError, Request, TERMINAL
from ..transport import Transport, credential, https_origin, objects

_VERSION = "1.0"
_STATES = {
    "TASK_STATE_SUBMITTED": "running",
    "TASK_STATE_WORKING": "running",
    "TASK_STATE_INPUT_REQUIRED": "waiting_input",
    "TASK_STATE_AUTH_REQUIRED": "waiting_input",
    "TASK_STATE_COMPLETED": "completed",
    "TASK_STATE_FAILED": "failed",
    "TASK_STATE_REJECTED": "failed",
    "TASK_STATE_CANCELED": "cancelled",
}


def _text(parts: object) -> str:
    return "\n".join(part["text"] for part in objects(parts) if isinstance(part.get("text"), str))


class A2A(Provider):
    def __init__(self, transport: Transport, card_url: str, *, credential_env: str | None = None) -> None:
        self.transport = transport
        self.card_url = card_url
        self.origin = https_origin(card_url)
        self.credential_env = credential_env
        self.endpoint = ""
        self.tenant = ""
        self.streaming = False

    def _discover(self, timeout: float) -> None:
        if self.endpoint:
            return
        card = self.transport.request("GET", self.card_url, timeout=timeout).body
        capability = card.get("capabilities")
        if not isinstance(capability, dict):
            raise ProviderError("A2A Agent Card has no capabilities")
        if any(extension.get("required") is True for extension in objects(capability.get("extensions"))):
            raise ProviderError("A2A Agent Card requires an unsupported extension")
        interface = next((
            item for item in objects(card.get("supportedInterfaces"))
            if item.get("protocolBinding") == "JSONRPC" and item.get("protocolVersion") == _VERSION
            and isinstance(item.get("url"), str) and https_origin(item["url"]) == self.origin
        ), None)
        if interface is None:
            raise ProviderError("A2A requires a same-origin JSON-RPC 1.0 interface")
        if interface.get("tenant") is not None and not isinstance(interface["tenant"], str):
            raise ProviderError("A2A Agent Card has an invalid tenant")
        self._check_auth(card)
        self.streaming = capability.get("streaming") is True
        self.tenant = interface.get("tenant") or ""
        self.endpoint = interface["url"]

    def _check_auth(self, card: Json) -> None:
        schemes = card.get("securitySchemes") or {}
        requirements = card.get("securityRequirements") or card.get("security") or []
        if not requirements:
            return
        if not isinstance(schemes, dict):
            raise ProviderError("A2A Agent Card has malformed authentication schemes")
        for requirement in objects(requirements):
            entries = requirement.get("schemes", requirement)
            if not entries:
                return
            if not self.credential_env or not isinstance(entries, dict) or len(entries) != 1:
                continue
            scheme = schemes.get(next(iter(entries)), {})
            if not isinstance(scheme, dict):
                continue
            http = scheme.get("httpAuthSecurityScheme", {})
            if "oauth2SecurityScheme" in scheme or (
                isinstance(http, dict) and str(http.get("scheme", "")).lower() == "bearer"
            ):
                return
        raise ProviderError("A2A Agent Card requires an unsupported authentication scheme")

    def capabilities(self) -> frozenset[str]:
        available = {"text", "resume", "cancel", "input", "artifacts"}
        if self.streaming:
            available.add("stream")
        return frozenset(available)

    def _headers(self) -> dict[str, str]:
        headers = {"A2A-Version": _VERSION}
        if self.credential_env:
            headers["Authorization"] = f"Bearer {credential(self.credential_env)}"
        return headers

    def _payload(self, method: str, params: Json) -> Json:
        if self.tenant:
            params = {**params, "tenant": self.tenant}
        return {"jsonrpc": "2.0", "id": uuid4().hex, "method": method, "params": params}

    @staticmethod
    def _result(body: Json, identifier: str) -> Json:
        if body.get("error") is not None:
            raise ProviderError("A2A returned a JSON-RPC error")
        if body.get("id") != identifier or not isinstance(body.get("result"), dict):
            raise ProviderError("A2A returned an invalid JSON-RPC response")
        return body["result"]

    def _rpc(self, method: str, params: Json, timeout: float) -> Json:
        self._discover(timeout)
        payload = self._payload(method, params)
        reply = self.transport.request(
            "POST", self.endpoint, payload, headers=self._headers(), timeout=timeout,
        ).body
        return self._result(reply, payload["id"])

    @staticmethod
    def _message(text: str) -> Json:
        return {"messageId": uuid4().hex, "role": "ROLE_USER", "parts": [{"text": text}]}

    @staticmethod
    def _task(body: Json) -> Event:
        identifier = body.get("id")
        status = body.get("status")
        if not isinstance(identifier, str) or not identifier or not isinstance(status, dict):
            raise ProviderError("A2A returned an invalid task")
        state = _STATES.get(str(status.get("state")))
        if state is None:
            raise ProviderError("A2A returned an unsupported task state")
        artifacts = tuple({
            "id": item["artifactId"],
            "name": item.get("name") or item["artifactId"],
            "parts": [
                {key: part[key] for key in ("text", "data", "raw", "url", "mediaType", "filename") if key in part}
                for part in objects(item.get("parts"))
            ],
        } for item in objects(body.get("artifacts")) if isinstance(item.get("artifactId"), str))
        message = status.get("message")
        text = _text(message.get("parts")) if isinstance(message, dict) else ""
        artifact_text = "\n".join(filter(None, (_text(item["parts"]) for item in artifacts)))
        return Event(state, Handle(identifier, body.get("contextId")), text=artifact_text or text,
                     artifacts=artifacts, reason=text if state == "waiting_input" else "")

    @classmethod
    def _send_result(cls, result: Json) -> Event:
        task, message = result.get("task"), result.get("message")
        if isinstance(task, dict) and message is None:
            return cls._task(task)
        if isinstance(message, dict) and task is None and isinstance(message.get("messageId"), str):
            return Event("completed", Handle(message["messageId"], message.get("contextId")),
                         text=_text(message.get("parts")))
        raise ProviderError("A2A returned neither a task nor a message")

    def submit(self, request: Request) -> Event:
        return self._send_result(self._rpc("SendMessage", {"message": self._message(request.prompt())}, request.timeout))

    def resume(self, handle: Handle, *, timeout: float) -> Event:
        return self._task(self._rpc("GetTask", {"id": handle.native_id}, timeout))

    def cancel(self, handle: Handle, *, timeout: float) -> Event:
        return self._task(self._rpc("CancelTask", {"id": handle.native_id}, timeout))

    def provide_input(self, handle: Handle, payload: Json, *, timeout: float) -> Event:
        text = payload.get("text")
        if not isinstance(text, str) or not text.strip():
            raise ProviderError("A2A interactive input requires nonempty text")
        message = {**self._message(text), "taskId": handle.native_id}
        if handle.context_id:
            message["contextId"] = handle.context_id
        return self._send_result(self._rpc("SendMessage", {"message": message}, timeout))

    def events(self, handle: Handle, *, timeout: float):
        self._discover(timeout)
        if not self.streaming:
            yield self.resume(handle, timeout=timeout)
            return
        payload = self._payload("SubscribeToTask", {"id": handle.native_id})
        for frame in self.transport.stream(self.endpoint, payload, headers=self._headers(), timeout=timeout):
            result = self._result(frame, payload["id"])
            task = result.get("task")
            if isinstance(task, dict):
                event = self._task(task)
                yield event
                if event.state in TERMINAL:
                    return
                continue
            update = result.get("statusUpdate")
            if isinstance(update, dict) and isinstance(update.get("status"), dict):
                state = update["status"].get("state")
                if state not in {"TASK_STATE_SUBMITTED", "TASK_STATE_WORKING"}:
                    break
                yield Event("running", handle)
        # GetTask has the authoritative artifacts after a stream disconnect or final delta.
        yield self.resume(handle, timeout=timeout)

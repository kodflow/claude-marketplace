"""Perplexity Computer MCP with operator-provided OAuth bearer authentication."""

from base64 import b64encode
from collections.abc import Callable
from dataclasses import replace
from threading import Lock
import time
from uuid import uuid4

from ..ports import Event, Handle, Json, NoSendError, Provider, ProviderError, Request
from ..transport import ProviderHTTPError, Transport, credential, https_origin, objects

_ENDPOINT = "https://www.perplexity.ai/rest/computer/mcp"
_TASKS_VERSION = "2026-07-28"
_LEGACY_VERSIONS = {"2025-03-26", "2025-06-18", "2025-11-25"}
_CLIENT_INFO = {"name": "kodflow-agents", "version": "0.1.0"}
_DEFAULT_POLL_MS = 5000
_THREAD_META = "ai.perplexity/threadId"


def _remaining(deadline: float) -> float:
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise NoSendError("Computer MCP deadline expired before sending the operation")
    return remaining


def _tool_content(result: Json) -> Json:
    content = result.get("structuredContent")
    if isinstance(content, dict):
        return content
    for item in objects(result.get("content")):
        if item.get("type") == "text" and isinstance(item.get("text"), str):
            try:
                return Transport._object(item["text"].encode())
            except ProviderError:
                continue
    raise ProviderError("Computer MCP did not return structured tool output")


def _no_thread_error(body: Json) -> str:
    if body.get("thread_id"):
        return ""
    interactive = body.get("interactive")
    for code in (
        body.get("event"), body.get("error_code"), interactive.get("type") if isinstance(interactive, dict) else None,
    ):
        if code in ("insufficient_credits", "access_denied"):
            return code
    return ""


def _tool_result(result: Json) -> Json:
    if result.get("isError") is True:
        try:
            error = _tool_content(result)
        except ProviderError:
            error = {}
        if code := _no_thread_error(error):
            raise NoSendError(f"Computer rejected the operation before starting a thread ({code})")
        raise ProviderError("Computer MCP tool reported an error")
    return _tool_content(result)


class ComputerMcp:
    """Streamable HTTP client with session rollover for Computer's tools and tasks."""

    def __init__(self, transport: Transport, *, protocol_version: str = _TASKS_VERSION) -> None:
        if protocol_version != _TASKS_VERSION and protocol_version not in _LEGACY_VERSIONS:
            raise NoSendError("unsupported Computer MCP protocol version")
        self.transport = transport
        self.protocol_version = protocol_version
        self.lock = Lock()
        self.session = ""
        self.version = ""
        self.generation = 0

    @staticmethod
    def _headers() -> dict[str, str]:
        return {
            "Authorization": f"Bearer {credential('PERPLEXITY_COMPUTER_OAUTH_TOKEN')}",
            "Accept": "application/json, text/event-stream",
        }

    def _session_headers(self) -> dict[str, str]:
        headers = {"MCP-Protocol-Version": self.version, **self._headers()}
        if self.session:
            headers["MCP-Session-Id"] = self.session
        return headers

    @staticmethod
    def _result(reply: Json, identifier: str) -> Json:
        if reply.get("id") != identifier or "error" in reply or not isinstance(reply.get("result"), dict):
            raise ProviderError("Computer MCP returned a JSON-RPC error or invalid response")
        return reply["result"]

    def _initialize(self, deadline: float) -> None:
        identifier = uuid4().hex
        reply = self.transport.request("POST", _ENDPOINT, {
            "jsonrpc": "2.0", "id": identifier, "method": "initialize",
            "params": {
                "protocolVersion": self.protocol_version, "capabilities": {},
                "clientInfo": _CLIENT_INFO,
            },
        }, headers=self._headers(), timeout=_remaining(deadline))
        version = self._result(reply.body, identifier).get("protocolVersion")
        if version not in _LEGACY_VERSIONS:
            raise ProviderError("Computer MCP negotiated an unsupported protocol version")
        self.version = version
        self.session = reply.headers.get("mcp-session-id", "")
        try:
            self.transport.request(
                "POST", _ENDPOINT, {"jsonrpc": "2.0", "method": "notifications/initialized"},
                headers=self._session_headers(), timeout=_remaining(deadline), allow_empty=True,
            )
        except ProviderError:
            self.session = self.version = ""
            raise
        self.generation += 1

    def _prepare(self, deadline: float) -> tuple[dict[str, str], int]:
        with self.lock:
            try:
                if not self.version:
                    self._initialize(deadline)
            except ProviderError as error:
                raise NoSendError(f"Computer MCP session could not be initialized: {error}") from None
            return self._session_headers(), self.generation

    @staticmethod
    def _name_header(name: str) -> str:
        visible_ascii = name == name.strip() and all(0x20 <= ord(char) <= 0x7E for char in name)
        ambiguous = name.startswith("=?base64?") and name.endswith("?=")
        if visible_ascii and not ambiguous:
            return name
        return f"=?base64?{b64encode(name.encode()).decode('ascii')}?="

    def _modern(self, method: str, params: Json, timeout: float, *, use_tasks: bool) -> Json:
        parameters = {
            **params,
            "_meta": {
                "io.modelcontextprotocol/protocolVersion": _TASKS_VERSION,
                "io.modelcontextprotocol/clientInfo": _CLIENT_INFO,
                "io.modelcontextprotocol/clientCapabilities": (
                    {"extensions": {"io.modelcontextprotocol/tasks": {}}} if use_tasks else {}
                ),
            },
        }
        headers = {**self._headers(), "MCP-Protocol-Version": _TASKS_VERSION, "Mcp-Method": method}
        if method == "tools/call":
            headers["Mcp-Name"] = self._name_header(params["name"])
        identifier = uuid4().hex
        response = self.transport.request(
            "POST", _ENDPOINT, {"jsonrpc": "2.0", "id": identifier, "method": method, "params": parameters},
            headers=headers, timeout=timeout,
        )
        return self._result(response.body, identifier)

    def _request(self, method: str, params: Json, timeout: float) -> Json:
        deadline = time.monotonic() + timeout
        identifier = uuid4().hex
        payload = {"jsonrpc": "2.0", "id": identifier, "method": method, "params": params}
        headers, generation = self._prepare(deadline)
        try:
            response = self.transport.request(
                "POST", _ENDPOINT, payload, headers=headers, timeout=_remaining(deadline),
            )
        except ProviderHTTPError as error:
            if error.status != 404 or "MCP-Session-Id" not in headers:
                raise
            # The server rejected this invalid session without routing the tool.
            # Retire only that generation so another request's fresh session remains usable.
            with self.lock:
                if self.generation == generation:
                    self.session = self.version = ""
            headers, _ = self._prepare(deadline)
            try:
                response = self.transport.request(
                    "POST", _ENDPOINT, payload, headers=headers, timeout=_remaining(deadline),
                )
            except ProviderHTTPError as retry_error:
                if retry_error.status == 404 and "MCP-Session-Id" in headers:
                    raise NoSendError("Computer MCP rejected the replacement session") from None
                raise
        return self._result(response.body, identifier)

    def call(self, name: str, arguments: Json, timeout: float) -> Json:
        params = {"name": name, "arguments": arguments}
        if self.protocol_version == _TASKS_VERSION:
            return _tool_result(self._modern("tools/call", params, timeout, use_tasks=False))
        return _tool_result(self._request("tools/call", params, timeout))

    def tasks(self, method: str, params: Json, timeout: float) -> Json:
        if self.protocol_version != _TASKS_VERSION:
            raise NoSendError("Computer Tasks require the stateless 2026-07-28 MCP version")
        return self._modern(method, params, timeout, use_tasks=True)


class Computer(Provider):
    def __init__(
        self, call_tool: Callable[[str, Json, float], Json],
        call_tasks: Callable[[str, Json, float], Json] | None = None,
    ) -> None:
        self.call_tool = call_tool
        self.call_tasks = call_tasks

    def capabilities(self) -> frozenset[str]:
        return frozenset({"text", "resume", "cancel", "input", "approval", "artifacts"})

    @staticmethod
    def _thread_event(body: Json, existing: Handle | None = None) -> Event:
        identifier = body.get("thread_id") or (existing.native_id if existing else None)
        if not isinstance(identifier, str) or not identifier:
            if code := _no_thread_error(body):
                raise NoSendError(f"Computer rejected the operation before starting a thread ({code})")
            raise ProviderError("Computer did not return a thread id")
        if existing and identifier != existing.native_id:
            raise ProviderError("Computer returned a different thread id")
        handle = Handle(identifier)
        event = body.get("event")
        web_state = body.get("web_state") if isinstance(body.get("web_state"), dict) else {}
        status = body.get("task_status") or web_state.get("task_status")
        if status == "input_required":
            interactive = body.get("interactive")
            if isinstance(interactive, dict):
                checkpoint = event
                followup = interactive.get("followup_uuid")
            else:
                checkpoint, followup = Computer._thread_checkpoint(web_state)
            kind = "waiting_approval" if checkpoint == "confirm_action" else "waiting_input"
            if checkpoint in {"auth_required", "interaction_required", "two_factor_required"}:
                kind = "waiting_auth"
            return Event(kind, replace(handle, context_id=followup if isinstance(followup, str) else None),
                         reason=f"Computer is waiting ({checkpoint})")
        if status == "cancelled":
            return Event("cancelled", handle)
        if status == "failed":
            return Event("failed", handle, reason="Computer reported a failed task")
        if status == "completed":
            # read_thread returns a combined transcript, not a task's result.
            # Older non-Tasks sessions can recover status but cannot supply task output.
            if event == "transcript":
                return Event("failed", handle, reason="Computer completed without a task-specific result")
            text = body.get("text") if isinstance(body.get("text"), str) else ""
            return Event("completed", handle, text=text, artifacts_collected=False)
        if status == "working" or event in {"timeout", "sleep", "waiting"}:
            return Event("running", handle)
        raise ProviderError("Computer did not report an authoritative task status")

    @staticmethod
    def _thread_checkpoint(web_state: Json) -> tuple[str, str | None]:
        for entry in reversed(objects(web_state.get("entries"))):
            for interaction in objects(entry.get("interactions")):
                request = interaction.get("request")
                kind = interaction.get("type")
                if kind in {"confirm_action", "CONFIRM_ACTION", "ask_user_question", "ASK_USER_QUESTION"}:
                    followup = request.get("answer_submission_uuid") if isinstance(request, dict) else None
                    return kind.lower(), followup if isinstance(followup, str) else None
        return "input_required", None

    @staticmethod
    def _task_event(body: Json, existing: Handle | None = None) -> Event:
        identifier = body.get("taskId")
        metadata = body.get("_meta")
        thread = metadata.get(_THREAD_META) if isinstance(metadata, dict) else None
        if existing:
            if identifier != existing.native_id or (thread is not None and thread != existing.thread_id):
                raise ProviderError("Computer returned a different task or thread id")
            thread = existing.thread_id
        if not isinstance(identifier, str) or not identifier or not isinstance(thread, str) or not thread:
            raise ProviderError("Computer MCP did not return the task and thread identifiers")
        interval = body.get("pollIntervalMs")
        if type(interval) is not int or not 0 < interval <= 2**53:
            interval = existing.poll_interval_ms if existing and existing.poll_interval_ms else _DEFAULT_POLL_MS
        handle = Handle(
            identifier, thread_id=thread, poll_interval_ms=interval,
            acknowledged_inputs=existing.acknowledged_inputs if existing else (),
        )
        next_poll = time.time() + interval / 1000
        status = body.get("status")
        if status == "working":
            return Event("running", handle, poll_not_before=next_poll)
        if status == "failed":
            return Event("failed", handle, reason="Computer reported a failed task")
        if status == "cancelled":
            return Event("cancelled", handle)
        if status == "input_required":
            requests = body.get("inputRequests")
            if not isinstance(requests, dict) or not requests:
                raise ProviderError("Computer did not return the waiting task's input requests")
            return Computer._task_input(requests, handle, next_poll)
        if status == "completed":
            result = body.get("result")
            if not isinstance(result, dict):
                raise ProviderError("Computer did not return the completed task result")
            if result.get("isError") is True:
                return Event("failed", handle, reason="Computer reported a failed task")
            outcome = Computer._thread_event(_tool_result(result), Handle(thread))
            if outcome.state != "completed":
                raise ProviderError("Computer returned an inconsistent completed task")
            return replace(outcome, handle=handle)
        raise ProviderError("Computer returned an unsupported task status")

    @staticmethod
    def _task_input(requests: Json, handle: Handle, next_poll: float) -> Event:
        remaining = {
            key: form for key, form in requests.items() if key not in handle.acknowledged_inputs
        }
        if not remaining:
            return Event("running", handle, poll_not_before=next_poll)

        pending_auth = None
        for key, form in sorted(remaining.items()):
            params = form.get("params") if isinstance(form, dict) else None
            if not isinstance(params, dict):
                continue
            mode = params.get("mode", "form")
            reason = params.get("message") if isinstance(params.get("message"), str) else ""
            if mode == "url" and pending_auth is None:
                url = params.get("url")
                if isinstance(url, str):
                    try:
                        https_origin(url)
                    except NoSendError:
                        url = None
                pending_auth = Event(
                    "waiting_auth", replace(handle, context_id=key),
                    reason=reason or "Computer is waiting for an action in the Perplexity UI",
                    poll_not_before=next_poll, prompt_url=url if isinstance(url, str) else None,
                )
            if mode != "form":
                continue
            schema = params.get("requestedSchema")
            if not isinstance(schema, dict) or not isinstance(schema.get("properties", {}), dict):
                raise ProviderError("Computer returned a malformed input form")
            state = "waiting_input" if schema.get("properties") else "waiting_approval"
            return Event(state, replace(handle, context_id=key), reason=reason)
        if pending_auth is not None:
            return pending_auth
        raise ProviderError("Computer returned an unsupported input request")

    def collect_artifacts(self, event: Event, *, timeout: float) -> tuple[Json, ...]:
        artifacts = self._assets(event.handle, timeout)
        return artifacts or self.artifacts(event)

    def _assets(self, handle: Handle, timeout: float) -> tuple[Json, ...]:
        assets = []
        cursor = None
        seen: set[str] = set()
        deadline = time.monotonic() + timeout
        while True:
            arguments = {"thread_id": handle.thread_id or handle.native_id}
            if cursor:
                arguments["cursor"] = cursor
            body = self.call_tool("list_thread_assets", arguments, _remaining(deadline))
            assets.extend({
                "id": asset["asset_id"],
                "name": asset.get("filename") or asset["asset_id"],
                "media_type": asset.get("mime_type"),
            } for asset in objects(body.get("assets")) if isinstance(asset.get("asset_id"), str))
            cursor = body.get("next_cursor")
            if not cursor:
                return tuple(assets)
            if not isinstance(cursor, str) or cursor in seen or len(seen) == 99:
                raise ProviderError("Computer returned invalid artifact pagination")
            seen.add(cursor)

    def submit(self, request: Request) -> Event:
        arguments = {"message": request.prompt()}
        if request.model:
            arguments["model"] = request.model
        if self.call_tasks is None:
            return self._thread_event(self.call_tool("call_perplexity_computer", arguments, request.timeout))
        body = self.call_tasks("tools/call", {"name": "call_perplexity_computer", "arguments": arguments}, request.timeout)
        if body.get("resultType") == "task":
            return self._task_event(body)
        return self._thread_event(_tool_result(body))

    def recover_handle(self, native_id: str, *, timeout: float) -> Handle:
        if self.call_tasks is None:
            return Handle(native_id)
        body = self.call_tasks("tasks/get", {"taskId": native_id}, timeout)
        event = self._task_event(body)
        if event.handle.native_id != native_id:
            raise ProviderError("Computer returned a different task id")
        return event.handle

    def resume(self, handle: Handle, *, timeout: float) -> Event:
        if handle.thread_id and self.call_tasks:
            return self._task_event(self.call_tasks("tasks/get", {"taskId": handle.native_id}, timeout), handle)
        result = self.call_tool("read_thread", {"thread_id": handle.native_id}, timeout)
        return self._thread_event(result, handle)

    def cancel(self, handle: Handle, *, timeout: float) -> Event:
        thread = handle.thread_id or handle.native_id
        result = self.call_tool("cancel_task", {"thread_id": thread}, timeout)
        event = self._thread_event(result, Handle(thread))
        return replace(event, handle=handle)

    def _answer_task(self, handle: Handle, response: Json, timeout: float) -> Event:
        if not self.call_tasks or not handle.context_id:
            raise NoSendError("Computer has no saved MCP task checkpoint")
        self.call_tasks("tasks/update", {
            "taskId": handle.native_id, "inputResponses": {handle.context_id: response},
        }, timeout)
        if handle.context_id not in handle.acknowledged_inputs:
            handle = replace(handle, acknowledged_inputs=(*handle.acknowledged_inputs, handle.context_id))
        interval = handle.poll_interval_ms or _DEFAULT_POLL_MS
        return Event("running", handle, poll_not_before=time.time() + interval / 1000)

    def provide_input(self, handle: Handle, payload: Json, *, timeout: float) -> Event:
        if handle.thread_id:
            answers = payload.get("answers")
            if not isinstance(answers, dict) or not answers:
                raise NoSendError("Computer task input requires an answers object")
            return self._answer_task(handle, {"action": "accept", "content": answers}, timeout)
        arguments: Json = {"thread_id": handle.native_id}
        if isinstance(payload.get("connector"), str):
            tool = "notify_connected"
            arguments.update({"connector": payload["connector"], "message": ""})
        elif isinstance(payload.get("answers"), dict) and payload["answers"]:
            tool = "answer_question"
            arguments["answers"] = payload["answers"]
            if handle.context_id:
                arguments["followup_uuid"] = handle.context_id
        else:
            raise NoSendError("Computer input requires answers or a connector name")
        return self._thread_event(self.call_tool(tool, arguments, timeout), handle)

    def approve(self, handle: Handle, approved: bool, reason: str, *, timeout: float) -> Event:
        if handle.thread_id:
            return self._answer_task(handle, {"action": "accept" if approved else "decline"}, timeout)
        tool = "confirm_action_approve" if approved else "confirm_action_deny"
        arguments = {"thread_id": handle.native_id, "result": reason}
        if handle.context_id:
            arguments["followup_uuid"] = handle.context_id
        return self._thread_event(self.call_tool(tool, arguments, timeout), handle)

    def artifact_download(self, handle: Handle, asset_id: str, *, timeout: float) -> Json:
        thread = handle.thread_id or handle.native_id
        return self.call_tool("create_asset_download", {"thread_id": thread, "asset_id": asset_id}, timeout)

"""Perplexity Computer MCP with operator-provided OAuth bearer authentication."""

from collections.abc import Callable
from threading import Lock
from uuid import uuid4

from ..ports import Event, Handle, Json, Provider, ProviderError, Request
from ..transport import Transport, credential, objects

_ENDPOINT = "https://www.perplexity.ai/rest/computer/mcp"
_VERSIONS = {"2025-03-26", "2025-06-18", "2025-11-25", "2026-07-28"}


class ComputerMcp:
    """Minimal Streamable HTTP client for the synchronous Computer tools."""

    def __init__(self, transport: Transport) -> None:
        self.transport = transport
        self.lock = Lock()
        self.session = ""
        self.version = ""

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

    def _initialize(self, timeout: float) -> None:
        with self.lock:
            if self.version:
                return
            identifier = uuid4().hex
            reply = self.transport.request("POST", _ENDPOINT, {
                "jsonrpc": "2.0", "id": identifier, "method": "initialize",
                "params": {
                    "protocolVersion": "2025-11-25", "capabilities": {},
                    "clientInfo": {"name": "kodflow-agents", "version": "0.1.0"},
                },
            }, headers=self._headers(), timeout=timeout)
            version = self._result(reply.body, identifier).get("protocolVersion")
            if version not in _VERSIONS:
                raise ProviderError("Computer MCP negotiated an unsupported protocol version")
            self.version = version
            self.session = reply.headers.get("mcp-session-id", "")
            try:
                self.transport.request(
                    "POST", _ENDPOINT, {"jsonrpc": "2.0", "method": "notifications/initialized"},
                    headers=self._session_headers(), timeout=timeout, allow_empty=True,
                )
            except ProviderError:
                self.session = self.version = ""
                raise

    def call(self, name: str, arguments: Json, timeout: float) -> Json:
        self._initialize(timeout)
        identifier = uuid4().hex
        response = self.transport.request("POST", _ENDPOINT, {
            "jsonrpc": "2.0", "id": identifier, "method": "tools/call",
            "params": {"name": name, "arguments": arguments},
        }, headers=self._session_headers(), timeout=timeout).body
        result = self._result(response, identifier)
        content = result.get("structuredContent")
        if not isinstance(content, dict):
            for item in objects(result.get("content")):
                if item.get("type") == "text" and isinstance(item.get("text"), str):
                    try:
                        content = Transport._object(item["text"].encode())
                    except ProviderError:
                        continue
                    break
        if not isinstance(content, dict):
            raise ProviderError("Computer MCP did not return structured tool output")
        return content


class Computer(Provider):
    def __init__(self, call_tool: Callable[[str, Json, float], Json]) -> None:
        self.call_tool = call_tool

    def capabilities(self) -> frozenset[str]:
        return frozenset({"text", "resume", "cancel", "input", "approval", "artifacts"})

    def _event(self, body: Json, timeout: float, existing: Handle | None = None) -> Event:
        identifier = body.get("thread_id") or (existing.native_id if existing else None)
        if not isinstance(identifier, str) or not identifier:
            raise ProviderError("Computer did not return a thread id")
        if existing and identifier != existing.native_id:
            raise ProviderError("Computer returned a different thread id")
        handle = Handle(identifier)
        event = body.get("event")
        web_state = body.get("web_state") or {}
        status = body.get("task_status") or web_state.get("task_status")
        text = body.get("text") if isinstance(body.get("text"), str) else ""
        if status == "input_required":
            interactive = body.get("interactive") or {}
            checkpoint = event if event != "transcript" else self._waiting_kind(web_state)
            kind = "waiting_approval" if checkpoint == "confirm_action" else "waiting_input"
            followup = interactive.get("followup_uuid")
            return Event(kind, Handle(identifier, followup if isinstance(followup, str) else None),
                         reason=f"Computer is waiting ({checkpoint})")
        if status == "cancelled":
            return Event("cancelled", handle)
        if status == "failed":
            return Event("failed", handle, reason="Computer reported a failed task")
        if status == "completed":
            return Event("completed", handle, text=text, artifacts=self._assets(handle, timeout))
        if status == "working" or event in {"timeout", "sleep", "waiting"}:
            return Event("running", handle)
        raise ProviderError("Computer did not report an authoritative task status")

    @staticmethod
    def _waiting_kind(web_state: Json) -> str:
        entries = objects(web_state.get("entries"))
        for entry in reversed(entries):
            for interaction in objects(entry.get("interactions")):
                if interaction.get("type") in {"confirm_action", "CONFIRM_ACTION"}:
                    return "confirm_action"
        return "input_required"

    def _assets(self, handle: Handle, timeout: float) -> tuple[Json, ...]:
        assets = []
        cursor = None
        seen: set[str] = set()
        while True:
            arguments = {"thread_id": handle.native_id}
            if cursor:
                arguments["cursor"] = cursor
            body = self.call_tool("list_thread_assets", arguments, timeout)
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
        return self._event(self.call_tool("call_perplexity_computer", arguments, request.timeout), request.timeout)

    def resume(self, handle: Handle, *, timeout: float) -> Event:
        result = self.call_tool("read_thread", {"thread_id": handle.native_id}, timeout)
        return self._event(result, timeout, handle)

    def cancel(self, handle: Handle, *, timeout: float) -> Event:
        result = self.call_tool("cancel_task", {"thread_id": handle.native_id}, timeout)
        return self._event(result, timeout, handle)

    def provide_input(self, handle: Handle, payload: Json, *, timeout: float) -> Event:
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
            raise ProviderError("Computer input requires answers or a connector name")
        return self._event(self.call_tool(tool, arguments, timeout), timeout, handle)

    def approve(self, handle: Handle, approved: bool, reason: str, *, timeout: float) -> Event:
        tool = "confirm_action_approve" if approved else "confirm_action_deny"
        arguments = {"thread_id": handle.native_id, "result": reason}
        if handle.context_id:
            arguments["followup_uuid"] = handle.context_id
        return self._event(self.call_tool(tool, arguments, timeout), timeout, handle)

    def artifact_download(self, handle: Handle, asset_id: str, *, timeout: float) -> Json:
        return self.call_tool("create_asset_download", {"thread_id": handle.native_id, "asset_id": asset_id}, timeout)

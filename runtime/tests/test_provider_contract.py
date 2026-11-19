"""Offline contracts for provider requests, state mapping and credential handling."""

from email.message import Message
import time
from types import SimpleNamespace

import pytest

from kodflow_agents.ports import Handle, NoSendError, ProviderError, Request, UnsupportedOperation
from kodflow_agents.providers.a2a import A2A
from kodflow_agents.providers.anthropic import Anthropic
from kodflow_agents.providers.computer import Computer, ComputerMcp
from kodflow_agents.providers.openai import OpenAI
from kodflow_agents.providers.perplexity import Perplexity
from kodflow_agents.transport import ProviderHTTPError, Reply, StreamInterrupted, Transport, https_origin

REQUEST = Request("task", "Research one question", {"topic": "storage"}, "test-model", timeout=20)


class RecordedTransport:
    def __init__(self, responses):
        self.calls = []
        self.responses = iter(responses)

    def request(self, method, url, payload=None, *, headers=None, timeout, **options):
        self.calls.append((method, url, payload, headers or {}, timeout, options))
        value = next(self.responses)
        if isinstance(value, Exception):
            raise value
        if callable(value):
            value = value(payload)
        return value if isinstance(value, Reply) else Reply(value, {})

    def stream(self, url, payload, *, headers, timeout):
        self.calls.append(("STREAM", url, payload, headers, timeout, {}))
        for item in next(self.responses):
            if isinstance(item, Exception):
                raise item
            key = "error" if "code" in item else "result"
            yield {"jsonrpc": "2.0", "id": payload["id"], key: item}


def rpc(result):
    return lambda payload: {"jsonrpc": "2.0", "id": payload["id"], "result": result}


def response(status="completed"):
    return {
        "id": "resp-id",
        "status": status,
        "output": [
            {"type": "reasoning", "summary": [{"text": "PRIVATE"}]},
            {"type": "message", "role": "assistant", "content": [
                {"type": "output_text", "text": "public answer"},
            ]},
        ],
        "usage": {"input_tokens": 3, "output_tokens": 2, "hidden_reasoning": 10},
    }


def test_anthropic_messages_excludes_thinking_and_rejects_unavailable_interaction(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "anthropic-fixture")
    transport = RecordedTransport([{
        "id": "msg-id", "stop_reason": "end_turn",
        "content": [{"type": "thinking", "thinking": "PRIVATE"}, {"type": "text", "text": "public answer"}],
        "usage": {"input_tokens": 3, "output_tokens": 2},
    }])
    provider = Anthropic(transport)
    event = provider.submit(REQUEST)
    method, url, body, headers, timeout, _ = transport.calls[0]
    assert (method, url) == ("POST", "https://api.anthropic.com/v1/messages")
    assert 0 < timeout <= 20
    assert body["messages"][0]["role"] == "user"
    assert headers["anthropic-version"] == "2023-06-01"
    assert event.text == "public answer"
    assert provider.usage(event) == {"input_tokens": 3, "output_tokens": 2}
    assert provider.artifacts(event)[0]["parts"] == [{"text": "public answer"}]
    with pytest.raises(UnsupportedOperation, match="resume"):
        provider.resume(event.handle, timeout=1)
    with pytest.raises(UnsupportedOperation, match="approvals"):
        provider.approve(event.handle, True, "test", timeout=1)
    with pytest.raises(UnsupportedOperation, match="interactive input"):
        provider.provide_input(event.handle, {}, timeout=1)


@pytest.mark.parametrize(("provider_type", "endpoint", "env"), [
    (OpenAI, "https://api.openai.com/v1/responses", "OPENAI_API_KEY"),
    (Perplexity, "https://api.perplexity.ai/v1/agent", "PERPLEXITY_API_KEY"),
])
def test_responses_providers_only_export_assistant_text(monkeypatch, provider_type, endpoint, env):
    monkeypatch.setenv(env, "bearer-fixture")
    transport = RecordedTransport([response()])
    provider = provider_type(transport)
    event = provider.submit(REQUEST)
    assert event.state == "completed"
    assert event.text == "public answer"
    assert event.usage == {"input_tokens": 3, "output_tokens": 2}
    assert transport.calls[0][:2] == ("POST", endpoint)
    assert transport.calls[0][3] == {"Authorization": "Bearer bearer-fixture"}
    with pytest.raises(UnsupportedOperation, match="cancellation"):
        provider.cancel(event.handle, timeout=1)


def test_openai_background_retrieves_existing_response_and_cancels(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "openai-fixture")
    transport = RecordedTransport([response("in_progress"), response("in_progress"), response("cancelled")])
    api = OpenAI(transport, background=True)
    first = api.submit(REQUEST)
    assert first.state == "running"
    assert transport.calls[0][2]["background"] and transport.calls[0][2]["store"]
    assert list(api.events(first.handle, timeout=3))[0].state == "running"
    assert api.cancel(first.handle, timeout=3).state == "cancelled"
    assert [call[:2] for call in transport.calls[1:]] == [
        ("GET", "https://api.openai.com/v1/responses/resp-id"),
        ("POST", "https://api.openai.com/v1/responses/resp-id/cancel"),
    ]


def test_missing_service_credentials_stop_before_transport(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    transport = RecordedTransport([])
    with pytest.raises(ProviderError, match="OPENAI_API_KEY"):
        OpenAI(transport).submit(REQUEST)
    assert not transport.calls


def card(url="https://agent.example/rpc"):
    return {
        "capabilities": {"streaming": True},
        "supportedInterfaces": [{"url": url, "protocolBinding": "JSONRPC", "protocolVersion": "1.0"}],
    }


def task(state, **kwargs):
    return {"id": "remote-task", "contextId": "context", "status": {"state": f"TASK_STATE_{state}"}, **kwargs}


def test_a2a_same_origin_agent_card_stream_artifact_and_cancel(monkeypatch):
    monkeypatch.setenv("KODFLOW_A2A_BEARER_TOKEN", "agent-fixture")
    completed = task("COMPLETED", artifacts=[
        {"artifactId": "brief", "name": "brief.txt", "parts": [{"text": "a reply"}]},
    ])
    transport = RecordedTransport([
        card(),
        rpc({"task": task("WORKING")}),
        [{"statusUpdate": {"status": {"state": "TASK_STATE_COMPLETED"}}}],
        rpc(completed),
        rpc(task("CANCELED")),
    ])
    provider = A2A(
        transport, "https://agent.example/.well-known/agent-card.json",
        credential_env="KODFLOW_A2A_BEARER_TOKEN",
    )
    event = provider.submit(REQUEST)
    assert event.state == "running"
    assert "Authorization" not in transport.calls[0][3]
    payload = transport.calls[1][2]
    assert payload["method"] == "SendMessage"
    assert payload["params"]["message"]["role"] == "ROLE_USER"
    assert payload["params"]["configuration"] == {"returnImmediately": True}
    assert event.handle.endpoint == "https://agent.example/rpc"
    assert transport.calls[1][3] == {"A2A-Version": "1.0", "Authorization": "Bearer agent-fixture"}
    events = list(provider.events(event.handle, timeout=20))
    assert [(item.state, item.text) for item in events] == [("completed", "a reply")]
    assert events[0].artifacts[0]["id"] == "brief"
    assert transport.calls[2][2]["method"] == "SubscribeToTask"
    assert transport.calls[3][2]["method"] == "GetTask"
    assert provider.cancel(event.handle, timeout=20).state == "cancelled"
    assert transport.calls[4][2]["method"] == "CancelTask"


def test_a2a_rejects_cross_origin_agent_card_before_sending_credentials():
    transport = RecordedTransport([card("https://another.example/rpc")])
    provider = A2A(transport, "https://agent.example/.well-known/agent-card.json", credential_env="AGENT_TOKEN")
    with pytest.raises(ProviderError, match="same-origin"):
        provider.submit(REQUEST)
    assert len(transport.calls) == 1


def test_a2a_continues_the_existing_task_and_context():
    transport = RecordedTransport([card(), rpc({"task": task("INPUT_REQUIRED")}), rpc({"task": task("WORKING")})])
    provider = A2A(transport, "https://agent.example/.well-known/agent-card.json")
    first = provider.submit(REQUEST)
    assert first.state == "waiting_input"
    assert provider.provide_input(first.handle, {"text": "Answer"}, timeout=2).state == "running"
    followup = transport.calls[-1][2]["params"]["message"]
    assert followup["taskId"] == "remote-task"
    assert followup["contextId"] == "context"


def test_computer_uses_explicit_input_approval_poll_and_assets():
    calls = []
    replies = iter((
        {"thread_id": "thread", "event": "confirm_action", "task_status": "input_required",
         "interactive": {"followup_uuid": "confirm-uuid"}},
        {"thread_id": "thread", "event": "ask_user_question", "task_status": "input_required"},
        {"thread_id": "thread", "event": "timeout", "task_status": "working"},
        {"thread_id": "thread", "event": "transcript", "web_state": {"task_status": "working"}},
        {"thread_id": "thread", "event": "cancelled", "task_status": "cancelled"},
    ))

    def tool(name, args, timeout):
        calls.append((name, args))
        return next(replies)

    provider = Computer(tool)
    first = provider.submit(REQUEST)
    assert first.state == "waiting_approval"
    second = provider.approve(first.handle, True, "operator decision", timeout=90)
    assert second.state == "waiting_input"
    third = provider.provide_input(second.handle, {"answers": {"format": "Markdown"}}, timeout=90)
    assert third.state == "running"
    fourth = provider.resume(third.handle, timeout=90)
    assert fourth.state == "running"
    assert provider.cancel(fourth.handle, timeout=90).state == "cancelled"
    assert [name for name, _ in calls] == [
        "call_perplexity_computer", "confirm_action_approve", "answer_question",
        "read_thread", "cancel_task",
    ]
    assert calls[1][1]["followup_uuid"] == "confirm-uuid"
    assert all(args["thread_id"] == "thread" for _, args in calls[1:])


def test_mcp_streamable_http_negotiation_and_session(monkeypatch):
    monkeypatch.setenv("PERPLEXITY_COMPUTER_OAUTH_TOKEN", "oauth-fixture")
    def initialize(payload):
        return Reply(rpc({"protocolVersion": "2025-11-25"})(payload), {"mcp-session-id": "mcp-session"})

    output = {"thread_id": "thread", "task_status": "working"}
    transport = RecordedTransport([initialize, {}, rpc({"structuredContent": output})])
    assert ComputerMcp(transport, protocol_version="2025-11-25").call("read_thread", {"thread_id": "thread"}, 20) == output
    assert [item[2]["method"] for item in transport.calls] == ["initialize", "notifications/initialized", "tools/call"]
    assert transport.calls[2][3]["MCP-Session-Id"] == "mcp-session"
    assert transport.calls[2][3]["MCP-Protocol-Version"] == "2025-11-25"
    assert transport.calls[0][3]["Authorization"] == "Bearer oauth-fixture"


@pytest.mark.parametrize("url", ["http://api.example/path", "https://user:pass@api.example", "https://api.example/#fragment"])
def test_unsafe_endpoints_rejected(url):
    with pytest.raises(ProviderError, match="HTTPS"):
        https_origin(url)



def test_sse_does_not_emit_comments_or_split_json():
    chunks = [b": heartbeat\n\ndata: {\"id\":", b"1,\ndata: \"result\":2}\r", b"\n\r\n"]
    assert list(Transport._sse(chunks)) == [{"id": 1, "result": 2}]


def test_anthropic_continues_paused_server_tools_with_same_context(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "anthropic-fixture")
    pause = [{"type": "server_tool_use", "id": "tool", "name": "web_search", "input": {"query": "q"}}]
    transport = RecordedTransport([
        {"id": "paused", "stop_reason": "pause_turn", "content": pause, "usage": {"output_tokens": 1}},
        {"id": "done", "stop_reason": "end_turn", "content": [{"type": "text", "text": "result"}],
         "usage": {"output_tokens": 4}},
    ])
    selected = Request("task", "Research", {}, "model", timeout=20, web_search=True)
    outcome = Anthropic(transport).submit(selected)
    assert outcome.text == "result"
    assert outcome.usage["output_tokens"] == 5
    first, second = transport.calls
    assert second[2]["messages"] == first[2]["messages"] + [{"role": "assistant", "content": pause}]
    assert second[2]["tools"] == first[2]["tools"]
    assert 0 < second[4] <= first[4] <= 20


def test_anthropic_exhausts_continuation_budget_and_rejects_nonterminal_output(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "anthropic-fixture")
    block = [{"type": "text", "text": "not a finished response"}]
    repeated = RecordedTransport([{"id": "paused", "stop_reason": "pause_turn", "content": block}] * 4)
    result = Anthropic(repeated).submit(REQUEST)
    assert result.state == "failed"
    assert "budget" in result.reason and not result.text
    assert len(repeated.calls) == 4
    for reason in ("max_tokens", "refusal"):
        result = Anthropic(RecordedTransport([{"id": "msg", "stop_reason": reason, "content": block}])).submit(REQUEST)
        assert result.state == "failed" and not result.text


def test_a2a_refreshes_out_of_band_auth_and_rejects_changed_endpoint():
    first_transport = RecordedTransport([
        card(), rpc({"task": task("AUTH_REQUIRED")}), rpc(task("WORKING")),
    ])
    provider = A2A(first_transport, "https://agent.example/.well-known/agent-card.json")
    provider.discover(timeout=1)
    assert "stream" in provider.capabilities()
    event = provider.submit(REQUEST)
    assert event.state == "waiting_auth"
    assert provider.resume(event.handle, timeout=1).state == "running"
    assert first_transport.calls[-1][2]["method"] == "GetTask"

    shifted = RecordedTransport([card("https://agent.example/different-rpc")])
    reloaded = A2A(shifted, "https://agent.example/.well-known/agent-card.json")
    with pytest.raises(NoSendError, match="differs"):
        reloaded.resume(event.handle, timeout=1)
    assert len(shifted.calls) == 1 and shifted.calls[0][0] == "GET"


def test_computer_mcp_reinitializes_only_on_session_specific_404(monkeypatch):
    monkeypatch.setenv("PERPLEXITY_COMPUTER_OAUTH_TOKEN", "oauth-fixture")

    def initialize(session):
        return lambda payload: Reply(rpc({"protocolVersion": "2025-11-25"})(payload), {"mcp-session-id": session})

    valid = rpc({"structuredContent": {"value": 1}})
    transport = RecordedTransport([initialize("old"), {}, ProviderHTTPError(404), initialize("new"), {}, valid])
    assert ComputerMcp(transport, protocol_version="2025-11-25").call("read_thread", {}, 20) == {"value": 1}
    assert [item[3]["MCP-Session-Id"] for item in transport.calls if item[2]["method"] == "tools/call"] == ["old", "new"]

    failed = RecordedTransport([initialize("old"), {}, ProviderHTTPError(500)])
    with pytest.raises(ProviderHTTPError, match="500"):
        ComputerMcp(failed, protocol_version="2025-11-25").call("read_thread", {}, 20)
    assert len(failed.calls) == 3


def test_computer_handles_only_confirmed_no_thread_errors_as_unsent(monkeypatch):
    monkeypatch.setenv("PERPLEXITY_COMPUTER_OAUTH_TOKEN", "oauth-fixture")
    initial = rpc({"protocolVersion": "2025-11-25"})
    declined = rpc({
        "isError": True, "structuredContent": {"event": "error", "interactive": {"type": "insufficient_credits"}},
    })
    with pytest.raises(NoSendError, match="before starting a thread"):
        ComputerMcp(RecordedTransport([initial, {}, declined]), protocol_version="2025-11-25").call("call_perplexity_computer", {}, 20)
    ambiguous = rpc({"isError": True, "structuredContent": {"event": "error", "text": "SECRET"}})
    with pytest.raises(ProviderError, match="tool reported an error") as caught:
        ComputerMcp(RecordedTransport([initial, {}, ambiguous]), protocol_version="2025-11-25").call("call_perplexity_computer", {}, 20)
    assert not isinstance(caught.value, NoSendError) and "SECRET" not in str(caught.value)


def test_computer_tasks_resume_authoritative_result_and_defer_assets():
    states = iter([
        {"resultType": "task", "taskId": "opaque-task", "status": "working", "_meta": {"ai.perplexity/threadId": "thread"}},
        {"resultType": "complete", "taskId": "opaque-task", "status": "input_required", "inputRequests": {
            "approval:form-key": {"params": {"mode": "form", "requestedSchema": {"properties": {}}}},
        }},
        {"resultType": "complete"},
        {"resultType": "complete", "taskId": "opaque-task", "status": "completed", "result": {
            "structuredContent": {"thread_id": "thread", "task_status": "completed", "event": "complete",
                                  "text": "task result only"},
        }},
    ])
    tasks = []
    calls = []

    def task_rpc(method, arguments, timeout):
        tasks.append((method, arguments))
        return next(states)

    def tool(name, arguments, timeout):
        calls.append((name, arguments))
        return {"assets": [{"asset_id": "asset", "filename": "brief.md"}]}

    provider = Computer(tool, task_rpc)
    first = provider.submit(REQUEST)
    assert first.handle.native_id == "opaque-task" and first.handle.thread_id == "thread"
    second = provider.resume(first.handle, timeout=5)
    assert second.state == "waiting_approval"
    assert second.handle.context_id == "approval:form-key"
    running = provider.approve(second.handle, True, "operator", timeout=5)
    outcome = provider.resume(running.handle, timeout=5)
    assert outcome.state == "completed" and not outcome.artifacts_collected and outcome.text == "task result only"
    assert not calls
    assert provider.collect_artifacts(outcome, timeout=5)[0]["name"] == "brief.md"
    assert calls == [("list_thread_assets", {"thread_id": "thread"})]
    assert tasks[2] == ("tasks/update", {
        "taskId": "opaque-task", "inputResponses": {"approval:form-key": {"action": "accept"}},
    })


def test_computer_read_thread_saves_form_uuid_without_using_transcript_as_answer():
    replies = iter([
        {"event": "transcript", "web_state": {"task_status": "input_required", "entries": [
            {"interactions": [{"type": "ask_user_question", "request": {"answer_submission_uuid": "precise-form"}}]},
        ]}},
        {"event": "transcript", "text": "unrelated user and assistant messages",
         "web_state": {"task_status": "completed"}},
    ])
    provider = Computer(lambda *args: next(replies))
    first = provider.resume(Handle("thread"), timeout=1)
    assert first.handle.context_id == "precise-form"
    outcome = provider.resume(first.handle, timeout=1)
    assert outcome.state == "failed" and not outcome.text


@pytest.mark.parametrize("content_type", ["application/json", "text/event-stream"])
def test_absolute_body_deadline_includes_open_time_and_closes_response(monkeypatch, content_type):
    class Response:
        closed = False

        def __init__(self):
            self.headers = Message()
            self.headers["Content-Type"] = content_type

        def __enter__(self):
            return self

        def __exit__(self, *_):
            self.closed = True

        def read1(self, size):
            time.sleep(0.004)
            return b" "

    response = Response()
    transport = Transport()
    deadline_start = []

    def opened(method, url, payload, headers, deadline):
        deadline_start.append(deadline.remaining())
        time.sleep(0.014)
        return response

    monkeypatch.setattr(transport, "_open", opened)
    with pytest.raises(ProviderError, match="deadline exceeded"):
        transport.request("GET", "https://service.example", timeout=0.025)
    assert response.closed and 0 < deadline_start[0] <= 0.025


def test_text_envelope_is_used_only_for_string_valued_outputs():
    for schema in ({"properties": {"text": {"type": "string"}}}, {}):
        assert "Return only a JSON value" not in Request("id", "prompt", {}, "model", 1, output_schema=schema).prompt()
    schema = {"properties": {"text": {"type": "integer"}}}
    assert "Return only a JSON value" in Request("id", "prompt", {}, "model", 1, output_schema=schema).prompt()


def test_cli_validates_pending_bindings_and_reuses_original_default(tmp_path, monkeypatch, capsys):
    from kodflow_agents import cli
    from kodflow_agents.providers.fake import Fake
    from kodflow_agents.supervisor import Binding

    workflow = tmp_path / "pinned.yaml"
    workflow.write_text("""apiVersion: io.github.kodflow/workflow/v1
id: pinned
description: Pending-route regression.
inputSchema: {type: object}
tasks:
  - id: first
    role: researcher
    instructions: First.
    inputSchema: {type: object}
    outputSchema: {type: object, properties: {text: {type: string}}}
  - id: later
    role: researcher
    instructions: Later.
    needs: [first]
    provider: openai
    inputSchema: {type: object}
    outputSchema: {type: object, properties: {text: {type: string}}}
""", encoding="utf-8")

    submissions = []
    route = {"openai": "original-openai", "anthropic": "original-anthropic"}

    class RecordingProvider(Fake):
        def submit(self, request):
            submissions.append(self.name)
            return super().submit(request)

    def providers(live, names):
        assert not live
        return {name: Binding(RecordingProvider(name), route[name]) for name in names}

    monkeypatch.setattr(cli, "_provider_bindings", providers)
    options = ["--database", str(tmp_path / "runs.sqlite")]
    assert cli.main(options + [
        "--default-provider", "anthropic", "run", str(workflow),
        "--input", "{}", "--run-id", "routing", "--once",
    ]) == 0
    assert submissions == ["anthropic"]
    capsys.readouterr()

    route["openai"] = "changed-openai"
    assert cli.main(options + ["resume", "routing", "--once"]) == 1
    assert "pinned run bindings" in capsys.readouterr().err
    assert submissions == ["anthropic"]

    route["openai"] = "original-openai"
    assert cli.main(options + ["--default-provider", "openai", "resume", "routing", "--once"]) == 1
    assert "default provider" in capsys.readouterr().err
    assert submissions == ["anthropic"]

    assert cli.main(options + ["resume", "routing", "--once"]) == 0
    assert submissions == ["anthropic", "openai"]


def test_cli_rejects_nonfinite_json_numbers_before_operator_action():
    from kodflow_agents.cli import _json_object

    for number in ("NaN", "Infinity", "-Infinity", "1e500", "-1e500"):
        with pytest.raises(ValueError, match="finite"):
            _json_object('{"answers": {"data": ' + number + "}}")
    assert _json_object('{"answers": {"data": 2.5e1}}') == {"answers": {"data": 25.0}}


@pytest.mark.parametrize("extension", [
    {"required": ["text", "language"]},
    {"additionalProperties": True},
    {"minProperties": 2},
    {"anyOf": [{"type": "null"}]},
    {"properties": {"text": {"type": "string"}, "language": {"type": "string"}}},
])
def test_text_envelope_preserves_structured_schema_constraints(extension):
    schema = {"type": "object", "properties": {"text": {"type": "string"}}, **extension}
    assert "Return only a JSON value" in Request("id", "prompt", {}, "model", 1, output_schema=schema).prompt()


def test_a2a_skips_invalid_agent_card_candidates_in_order():
    interface = lambda url: {"url": url, "protocolBinding": "JSONRPC", "protocolVersion": "1.0"}
    transport = RecordedTransport([
        {**card(), "supportedInterfaces": [
            interface("https://agent.example/rpc?token=invalid"),
            interface("https://other.example/rpc"),
            interface("bad-path"),
            interface("https://agent.example/first-valid"),
            interface("https://agent.example/second-valid"),
        ]},
        rpc({"task": task("WORKING")}),
    ])
    event = A2A(transport, "https://agent.example/.well-known/agent-card.json").submit(REQUEST)
    assert event.handle.endpoint == "https://agent.example/first-valid"


def test_a2a_recovers_interrupted_stream_but_propagates_rpc_error():
    transport = RecordedTransport([
        card(), rpc({"task": task("WORKING")}),
        [StreamInterrupted("read interrupted")],
        rpc(task("COMPLETED", artifacts=[{"artifactId": "answer", "parts": [{"text": "fixed"}]}])),
    ])
    agent = A2A(transport, "https://agent.example/.well-known/agent-card.json")
    first = agent.submit(REQUEST)
    assert [event.text for event in agent.events(first.handle, timeout=2)] == ["fixed"]
    assert [entry[2]["method"] for entry in transport.calls[-2:]] == ["SubscribeToTask", "GetTask"]

    errors = RecordedTransport([card(), rpc({"task": task("WORKING")}), [{"code": -32601}]])
    agent = A2A(errors, "https://agent.example/.well-known/agent-card.json")
    first = agent.submit(REQUEST)
    with pytest.raises(ProviderError, match="JSON-RPC error"):
        list(agent.events(first.handle, timeout=2))
    assert errors.calls[-1][2]["method"] == "SubscribeToTask"


def test_anthropic_exhaustion_before_first_send_is_not_an_uncertain_submission(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "anthropic-test")
    clock = iter([1.0, 30.0])
    monkeypatch.setattr("kodflow_agents.providers.anthropic.time", SimpleNamespace(monotonic=lambda: next(clock)))
    transport = RecordedTransport([])
    with pytest.raises(NoSendError, match="before sending"):
        Anthropic(transport).submit(REQUEST)
    assert not transport.calls


def test_computer_modern_tasks_and_tool_calls_are_stateless(monkeypatch):
    monkeypatch.setenv("PERPLEXITY_COMPUTER_OAUTH_TOKEN", "oauth-fixture")
    transport = RecordedTransport([
        rpc({"resultType": "task"}),
        rpc({"resultType": "complete"}),
        rpc({"structuredContent": {"assets": []}}),
    ])
    mcp = ComputerMcp(transport)
    assert mcp.tasks("tools/call", {"name": "call_perplexity_computer", "arguments": {}}, 1)["resultType"] == "task"
    assert mcp.tasks("tasks/get", {"taskId": "some-task"}, 1)["resultType"] == "complete"
    assert mcp.call("list_thread_assets", {"thread_id": "thread"}, 1) == {"assets": []}
    assert [entry[2]["method"] for entry in transport.calls] == ["tools/call", "tasks/get", "tools/call"]
    for _, _, payload, headers, _, _ in transport.calls:
        meta = payload["params"]["_meta"]
        assert meta["io.modelcontextprotocol/protocolVersion"] == headers["MCP-Protocol-Version"] == "2026-07-28"
        assert headers["Mcp-Method"] == payload["method"]
        assert headers.get("Mcp-Name") == payload["params"].get("name")
        assert "MCP-Session-Id" not in headers
    assert transport.calls[1][2]["params"]["_meta"]["io.modelcontextprotocol/clientCapabilities"] == {
        "extensions": {"io.modelcontextprotocol/tasks": {}},
    }


def test_computer_repolls_acknowledged_keys_and_exposes_new_operator_input(monkeypatch):
    monkeypatch.setattr("kodflow_agents.providers.computer.time", SimpleNamespace(time=lambda: 100))
    first = {"params": {"mode": "form", "requestedSchema": {"properties": {}}}}
    second = {"params": {"mode": "form", "requestedSchema": {"properties": {"text": {"type": "string"}}}}}
    route = {"taskId": "task", "_meta": {"ai.perplexity/threadId": "thread"}}
    replies = iter([
        {**route, "resultType": "task", "status": "working", "pollIntervalMs": 8000},
        {**route, "status": "input_required", "inputRequests": {"known": first}},
        {},
        {**route, "status": "input_required", "inputRequests": {"known": first}},
        {**route, "status": "input_required", "inputRequests": {"known": first, "new": second}},
    ])
    provider = Computer(lambda *_: None, lambda *_: next(replies))
    submitted = provider.submit(REQUEST)
    assert submitted.poll_not_before == 108
    waiting = provider.resume(submitted.handle, timeout=1)
    assert waiting.state == "waiting_approval"
    acknowledged = provider.approve(waiting.handle, True, "operator", timeout=1)
    assert acknowledged.handle.acknowledged_inputs == ("known",)
    assert acknowledged.poll_not_before == 108
    stale = provider.resume(acknowledged.handle, timeout=1)
    assert stale.state == "running" and stale.poll_not_before == 108
    outstanding = provider.resume(stale.handle, timeout=1)
    assert outstanding.state == "waiting_input" and outstanding.handle.context_id == "new"
    assert outstanding.handle.acknowledged_inputs == ("known",)


def test_computer_exposes_https_auth_prompt_and_reports_terminal_failure(monkeypatch):
    monkeypatch.setattr("kodflow_agents.providers.computer.time", SimpleNamespace(time=lambda: 100))
    handle = Handle("task", thread_id="thread")
    replies = iter([
        {"taskId": "task", "status": "input_required", "pollIntervalMs": 6000, "inputRequests": {
            "auth": {"params": {"mode": "url", "url": "https://account.example/login", "message": "Sign in to continue"}},
        }},
        {"taskId": "task", "status": "failed", "statusMessage": "provider secret"},
    ])
    provider = Computer(lambda *_: None, lambda *_: next(replies))
    pending = provider.resume(handle, timeout=1)
    assert pending.state == "waiting_auth" and pending.poll_not_before == 106
    assert pending.prompt_url == "https://account.example/login" and pending.reason == "Sign in to continue"
    failure = provider.resume(pending.handle, timeout=1)
    assert failure.state == "failed" and failure.reason == "Computer reported a failed task"


def test_anthropic_typed_rejection_preserves_distinction_from_no_send(monkeypatch):
    from kodflow_agents.ports import SubmissionRejected

    monkeypatch.setenv("ANTHROPIC_API_KEY", "anthropic-fixture")
    rejected = ProviderHTTPError(429, error_type="rate_limit_error", request_id="req_fixture")
    transport = RecordedTransport([rejected])
    with pytest.raises(SubmissionRejected, match="429.*req_fixture") as caught:
        Anthropic(transport).submit(REQUEST)
    assert not isinstance(caught.value, NoSendError)
    assert len(transport.calls) == 1

    ambiguous = (
        ProviderHTTPError(429),
        ProviderHTTPError(429, error_type="timeout_error"),
        ProviderHTTPError(504, error_type="timeout_error"),
        ProviderHTTPError(529, error_type="overloaded_error"),
    )
    for response_error in ambiguous:
        transport = RecordedTransport([response_error])
        with pytest.raises(ProviderHTTPError) as caught:
            Anthropic(transport).submit(REQUEST)
        assert caught.value is response_error
        assert len(transport.calls) == 1


@pytest.mark.parametrize("failure", [
    NoSendError("before sending the next request"), ProviderHTTPError(429, error_type="rate_limit_error"),
])
def test_anthropic_definite_continuation_failure_keeps_known_submission(monkeypatch, failure):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "anthropic-fixture")
    first = {
        "id": "paused", "stop_reason": "pause_turn", "content": [{"type": "server_tool_use"}],
        "usage": {"input_tokens": 6},
    }
    transport = RecordedTransport([first, failure])
    event = Anthropic(transport).submit(REQUEST)
    assert event.state == "failed" and event.handle.native_id == "paused"
    assert event.usage == {"input_tokens": 6} and len(transport.calls) == 2
    assert not event.retryable_on_expiry


def test_transport_classifies_connection_failure_only_before_wire_boundary_as_unsent(monkeypatch):
    from urllib.error import URLError
    from kodflow_agents.transport import ProviderConnectionError

    class SocketFixture:
        def settimeout(self, _):
            pass

    def opener_for(cross_wire):
        def opener(_redirection, handler):
            def open_request(*_, **__):
                if cross_wire:
                    handler.deadline.attach(SocketFixture())
                raise URLError("PRIVATE")

            return SimpleNamespace(open=open_request)

        return opener

    monkeypatch.setattr("kodflow_agents.transport.build_opener", opener_for(False))
    with pytest.raises(NoSendError, match="before sending") as rejected:
        Transport().request("POST", "https://service.example", {}, timeout=5)
    assert "PRIVATE" not in str(rejected.value)

    monkeypatch.setattr("kodflow_agents.transport.build_opener", opener_for(True))
    with pytest.raises(ProviderConnectionError, match="may have been sent"):
        Transport().request("POST", "https://service.example", {}, timeout=5)


@pytest.mark.parametrize("malformation", [None, "oversized", "too-deep"])
def test_transport_decodes_only_bounded_http_error_classification(monkeypatch, malformation):
    from io import BytesIO
    from urllib.error import HTTPError

    headers = Message()
    headers["Content-Type"] = "application/json"
    headers["request-id"] = "req_test"

    class FixedLengthBody(BytesIO):
        def __init__(self, raw):
            super().__init__(raw)
            self.length = len(raw)

        def read1(self, size):
            data = super().read1(size)
            self.length -= len(data)
            return data

        def isclosed(self):
            return not self.length

    if malformation == "oversized":
        detail = b'"' + (b"x" * 16384) + b'"'
    else:
        detail = b'"do not log PRIVATE"'
    body = FixedLengthBody(b'{"type":"error","error":{"type":"rate_limit_error","message":' + detail + b"}}")

    if malformation == "too-deep":
        from kodflow_agents import transport

        def decoder_recursion_limit(_):
            raise RecursionError("decoder depth exceeded")

        decoder = SimpleNamespace(loads=decoder_recursion_limit, dumps=transport.json.dumps)
        monkeypatch.setattr(transport, "json", decoder)

    class ResponseSocket:
        def settimeout(self, _):
            if body.isclosed():
                raise OSError("the fixed-length response already closed the socket")

    def opener(_, handler):
        def opening(*_, **__):
            handler.deadline.attach(ResponseSocket())
            raise HTTPError("https://service.example", 429, "Too Many Requests", headers, body)

        return SimpleNamespace(open=opening)

    monkeypatch.setattr("kodflow_agents.transport.build_opener", opener)
    with pytest.raises(ProviderHTTPError, match="429.*req_test") as failure:
        Transport().request("POST", "https://service.example", {}, timeout=5)
    assert failure.value.status == 429
    assert failure.value.request_id == "req_test"
    assert failure.value.error_type == (None if malformation else "rate_limit_error")
    assert body.closed
    assert "PRIVATE" not in str(failure.value)

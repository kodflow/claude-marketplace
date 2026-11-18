"""Offline contracts for provider requests, state mapping and credential handling."""

import io
import json

import pytest

from kodflow_agents.ports import Handle, ProviderError, Request, UnsupportedOperation
from kodflow_agents.providers.a2a import A2A
from kodflow_agents.providers.anthropic import Anthropic
from kodflow_agents.providers.computer import Computer, ComputerMcp
from kodflow_agents.providers.openai import OpenAI
from kodflow_agents.providers.perplexity import Perplexity
from kodflow_agents.transport import Reply, Transport, https_origin

REQUEST = Request("task", "Research one question", {"topic": "storage"}, "test-model", timeout=20)


class RecordedTransport:
    def __init__(self, responses):
        self.calls = []
        self.responses = iter(responses)

    def request(self, method, url, payload=None, *, headers=None, timeout, **options):
        self.calls.append((method, url, payload, headers or {}, timeout, options))
        value = next(self.responses)
        if callable(value):
            value = value(payload)
        return value if isinstance(value, Reply) else Reply(value, {})

    def stream(self, url, payload, *, headers, timeout):
        self.calls.append(("STREAM", url, payload, headers, timeout, {}))
        for item in next(self.responses):
            yield {"jsonrpc": "2.0", "id": payload["id"], "result": item}


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
    assert (method, url, timeout) == ("POST", "https://api.anthropic.com/v1/messages", 20)
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
        {"thread_id": "thread", "event": "transcript", "web_state": {"task_status": "completed"}, "text": "result"},
        {"assets": [{"asset_id": "asset", "filename": "summary.md"}], "next_cursor": None},
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
    assert fourth.state == "completed"
    assert fourth.artifacts[0]["name"] == "summary.md"
    assert provider.cancel(fourth.handle, timeout=90).state == "cancelled"
    assert [name for name, _ in calls] == [
        "call_perplexity_computer", "confirm_action_approve", "answer_question",
        "read_thread", "list_thread_assets", "cancel_task",
    ]
    assert calls[1][1]["followup_uuid"] == "confirm-uuid"
    assert all(args["thread_id"] == "thread" for _, args in calls[1:])


def test_mcp_streamable_http_negotiation_and_session(monkeypatch):
    monkeypatch.setenv("PERPLEXITY_COMPUTER_OAUTH_TOKEN", "oauth-fixture")
    def initialize(payload):
        return Reply(rpc({"protocolVersion": "2025-11-25"})(payload), {"mcp-session-id": "mcp-session"})

    output = {"thread_id": "thread", "task_status": "working"}
    transport = RecordedTransport([initialize, {}, rpc({"structuredContent": output})])
    assert ComputerMcp(transport).call("read_thread", {"thread_id": "thread"}, 20) == output
    assert [item[2]["method"] for item in transport.calls] == ["initialize", "notifications/initialized", "tools/call"]
    assert transport.calls[2][3]["MCP-Session-Id"] == "mcp-session"
    assert transport.calls[2][3]["MCP-Protocol-Version"] == "2025-11-25"
    assert transport.calls[0][3]["Authorization"] == "Bearer oauth-fixture"


@pytest.mark.parametrize("url", ["http://api.example/path", "https://user:pass@api.example", "https://api.example/#fragment"])
def test_unsafe_endpoints_rejected(url):
    with pytest.raises(ProviderError, match="HTTPS"):
        https_origin(url)


def test_sse_does_not_emit_comments_or_split_json():
    source = io.BytesIO(b": heartbeat\n\ndata: {\"id\":1,\ndata: \"result\":2}\r\n\r\n")
    assert list(Transport._sse(source, float("inf"))) == [{"id": 1, "result": 2}]

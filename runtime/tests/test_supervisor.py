"""Exercise real workflow persistence with deterministic provider ports."""

from pathlib import Path
import sys
import time

import pytest

from kodflow_agents.cli import main
from kodflow_agents.journal import Journal
from kodflow_agents.ports import Event, Handle, Provider, ProviderError
from kodflow_agents.providers.fake import Fake
from kodflow_agents.supervisor import Binding, Supervisor

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

from pluginlib.state import StateStore
from pluginlib.workflows import load_workflow


class SlowProvider(Provider):
    def __init__(self):
        self.submissions = 0
        self.resumes = 0
        self.cancellations = 0

    def capabilities(self):
        return super().capabilities() | {"resume", "cancel"}

    def submit(self, request):
        self.submissions += 1
        return Event("running", Handle("live-native-handle"))

    def resume(self, handle, *, timeout):
        self.resumes += 1
        return Event("completed", handle, text="result")

    def cancel(self, handle, *, timeout):
        self.cancellations += 1
        return Event("cancelled", handle)


class DroppedProvider(SlowProvider):
    def submit(self, request):
        self.submissions += 1
        raise ProviderError("connection closed after send")


def single_workflow(tmp_path):
    path = tmp_path / "single.yaml"
    path.write_text("""apiVersion: io.github.kodflow/workflow/v1
id: sample
description: Provider test.
inputSchema: {type: object}
tasks:
  - id: demo
    role: researcher
    instructions: Research.
    inputSchema: {type: object}
    outputSchema:
      type: object
      required: [text]
      properties: {text: {type: string}}
""", encoding="utf-8")
    return load_workflow(path)


def setup(tmp_path, provider, *, clock=time.time):
    workflow = single_workflow(tmp_path)
    database = tmp_path / "runs.sqlite"
    store = StateStore(database, clock=clock)
    journal = Journal(database)
    bindings = {"test": Binding(provider, "test-provider")}
    supervisor = Supervisor(store, journal, bindings, default_provider="test")
    supervisor.preflight(workflow)
    run_id = store.create_run(workflow, {})
    return run_id, store, journal, bindings, supervisor


def test_provider_handle_survives_process_and_store_restart(tmp_path):
    original = SlowProvider()
    run, local, journal, _, first = setup(tmp_path, original)
    assert first.step(run)["status"] == "running"
    second_provider = SlowProvider()
    second_store = StateStore(local.database)
    second = Supervisor(second_store, Journal(local.database), {
        "test": Binding(second_provider, "test-provider"),
    }, default_provider="test")
    state = second.step(run)
    assert state["status"] == "completed"
    assert state["tasks"]["demo"]["result"] == {"text": "result"}
    assert state["tasks"]["demo"]["artifacts"][0]["parts"] == [{"text": "result"}]
    assert original.submissions == 1 and second_provider.submissions == 0 and second_provider.resumes == 1


def test_ambiguous_submit_never_dispatches_twice_and_can_reconcile(tmp_path):
    remote = DroppedProvider()
    run, store, _, _, supervisor = setup(tmp_path, remote)
    with pytest.raises(ProviderError, match="submission outcome is unknown"):
        supervisor.step(run)
    with pytest.raises(ProviderError, match="inspect or reconcile"):
        supervisor.step(run)
    assert remote.submissions == 1
    with pytest.raises(ProviderError, match="native provider handle"):
        supervisor.reconcile(run, "demo")
    assert supervisor.reconcile(run, "demo", "live-native-handle").state == "completed"
    assert store.snapshot(run)["status"] == "running"
    assert supervisor.step(run)["status"] == "completed"
    assert remote.submissions == 1


def test_cancel_confirms_existing_remote_handle(tmp_path):
    run, store, _, _, supervisor = setup(tmp_path, SlowProvider())
    supervisor.step(run)
    supervisor.cancel(run)
    assert store.snapshot(run)["status"] == "cancelled"


def test_route_is_pinned_and_offline_reference_recovers_artifacts(tmp_path, capsys):
    run, store, journal, _, supervisor = setup(tmp_path, SlowProvider())
    supervisor.step(run)
    mismatched = Supervisor(store, journal, {"test": Binding(Fake("test"), "offline:test")}, default_provider="test")
    with pytest.raises(ProviderError, match="different provider route"):
        mismatched.step(run)
    assert main(["--repository", str(ROOT), "doctor", "--offline"]) == 0
    assert '"resumed": true' in capsys.readouterr().out


def test_timeout_cancels_remote_work_before_advancing_attempt(tmp_path):
    remote = SlowProvider()
    now = [10.0]
    run, _, _, _, supervisor = setup(tmp_path, remote, clock=lambda: now[0])
    assert supervisor.step(run)["status"] == "running"
    now[0] += 301
    assert supervisor.step(run)["status"] == "failed"
    assert remote.cancellations == 1 and remote.submissions == 1


def test_uncertain_submit_stays_visible_after_deadline(tmp_path):
    remote = DroppedProvider()
    now = [10.0]
    run, store, _, _, supervisor = setup(tmp_path, remote, clock=lambda: now[0])
    with pytest.raises(ProviderError, match="submission outcome is unknown"):
        supervisor.step(run)
    now[0] += 301
    with pytest.raises(ProviderError, match="requires reconciliation before retry"):
        supervisor.step(run)
    assert store.snapshot(run)["status"] == "running"
    assert remote.submissions == 1

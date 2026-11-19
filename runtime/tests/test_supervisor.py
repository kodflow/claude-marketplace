"""Exercise real workflow persistence with deterministic provider ports."""

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import sys
from threading import Event as Signal
import time

import pytest

from kodflow_agents.cli import main
from kodflow_agents.journal import Journal, operation_key
from kodflow_agents.ports import Event, Handle, NoSendError, Provider, ProviderError
from kodflow_agents.providers.fake import Fake
from kodflow_agents.supervisor import Binding, Supervisor

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

from pluginlib.state import StateError, StateStore
from pluginlib.workflows import load_workflow


class SlowProvider(Provider):
    def __init__(self):
        self.submissions = 0
        self.resumes = 0
        self.cancellations = 0
        self.cancelled_handles = []

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
        self.cancelled_handles.append(handle)
        return Event("cancelled", handle)


class DroppedProvider(SlowProvider):
    def submit(self, request):
        self.submissions += 1
        raise ProviderError("connection closed after send")


def single_workflow(tmp_path, *, retries=0, text_type="string"):
    path = tmp_path / "single.yaml"
    path.write_text(f"""apiVersion: io.github.kodflow/workflow/v1
id: sample
description: Provider test.
inputSchema: {{type: object}}
tasks:
  - id: demo
    role: researcher
    instructions: Research.
    inputSchema: {{type: object}}
    retries: {retries}
    idempotencyKey: stable
    outputSchema:
      type: object
      required: [text]
      properties: {{text: {{type: {text_type}}}}}
""", encoding="utf-8")
    return load_workflow(path)


def setup(tmp_path, provider, *, clock=time.time, retries=0, text_type="string", workflow=None):
    workflow = workflow or single_workflow(tmp_path, retries=retries, text_type=text_type)
    database = tmp_path / "runs.sqlite"
    store = StateStore(database, clock=clock)
    journal = Journal(database)
    bindings = {"test": Binding(provider, "test-provider")}
    supervisor = Supervisor(store, journal, bindings, default_provider="test")
    supervisor.preflight(workflow)
    run_id = store.create_run(workflow, {}, execution=supervisor.execution_bindings(workflow, live=False))
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
    remote = SlowProvider()
    run, store, _, _, supervisor = setup(tmp_path, remote)
    supervisor.step(run)
    supervisor.cancel(run)
    assert store.snapshot(run)["status"] == "cancelled"
    assert remote.cancelled_handles == [Handle("live-native-handle")]


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


def test_timeout_crossing_frontier_does_not_skip_remote_resolution(tmp_path, monkeypatch):
    class Tracked(SlowProvider):
        def __init__(self):
            super().__init__()
            self.request_keys = []

        def submit(self, request):
            self.request_keys.append(request.task_id)
            return super().submit(request)

    remote = Tracked()
    now = [10.0]
    run, store, journal, _, supervisor = setup(tmp_path, remote, clock=lambda: now[0], retries=1)
    first = supervisor.step(run)["tasks"]["demo"]
    advance = store.advance

    def tick_then_advance(*args, **kwargs):
        # Expire after the supervisor enumerated the remotely resolved attempts.
        now[0] = first["deadline"]
        return advance(*args, **kwargs)

    monkeypatch.setattr(store, "advance", tick_then_advance)
    assert supervisor.step(run)["tasks"]["demo"]["attempt"] == 1
    assert remote.cancellations == 0 and remote.submissions == 1
    second = supervisor.step(run)["tasks"]["demo"]
    assert second["attempt"] == 2 and second["status"] == "running"
    assert remote.cancellations == 1 and remote.submissions == 2
    assert remote.request_keys[0] == remote.request_keys[1]
    key = second["idempotency_key"]
    assert journal.read(operation_key(key, 1), "test-provider")[0].state == "cancelled"
    assert journal.read(operation_key(key, 2), "test-provider")[0].state == "running"


def test_cancel_intent_blocks_a_claim_that_has_not_submitted(tmp_path):
    remote = SlowProvider()
    run, store, _, _, supervisor = setup(tmp_path, remote)
    (dispatch,) = store.advance(run, store.definition(run).capabilities)
    store.begin_cancel(run)
    with pytest.raises(StateError, match="no longer has a live workflow attempt"):
        supervisor._process(dispatch)
    supervisor.cancel(run)
    assert remote.submissions == 0
    assert store.snapshot(run)["status"] == "cancelled"


def test_cancel_waits_for_provider_submitting_after_reservation(tmp_path):
    started = Signal()
    release = Signal()

    class ReservedProvider(SlowProvider):
        def submit(self, request):
            started.set()
            assert release.wait(timeout=5)
            return super().submit(request)

    remote = ReservedProvider()
    run, store, _, _, supervisor = setup(tmp_path, remote)
    with ThreadPoolExecutor(max_workers=1) as executor:
        inflight = executor.submit(supervisor.step, run)
        try:
            assert started.wait(timeout=5)
            with pytest.raises(ProviderError, match="cancellation pending"):
                supervisor.cancel(run)
            assert store.snapshot(run)["cancellation_requested"]
        finally:
            release.set()
        inflight.result(timeout=5)

    assert supervisor.step(run)["status"] == "cancelled"
    assert remote.submissions == 1
    assert remote.cancelled_handles == [Handle("live-native-handle")]


def test_no_send_clears_reservation_and_keeps_same_attempt(tmp_path):
    class NoSendProvider(SlowProvider):
        def submit(self, request):
            if self.submissions == 0:
                self.submissions += 1
                raise NoSendError("provider rejected request before sending")
            return super().submit(request)

    remote = NoSendProvider()
    run, store, journal, _, supervisor = setup(tmp_path, remote)
    with pytest.raises(NoSendError, match="before sending"):
        supervisor.step(run)
    entry = store.snapshot(run)["tasks"]["demo"]
    assert journal.read(entry["idempotency_key"], "test-provider") == (None, None)
    assert supervisor.step(run)["tasks"]["demo"]["attempt"] == entry["attempt"]
    assert remote.submissions == 2


def test_operator_action_requires_current_attempt_and_checkpoint(tmp_path):
    class Interactive(SlowProvider):
        def __init__(self):
            super().__init__()
            self.replies = 0

        def capabilities(self):
            return super().capabilities() | {"input"}

        def submit(self, request):
            return Event("waiting_input", Handle("interactive", "question-a"))

        def provide_input(self, handle, payload, *, timeout):
            self.replies += 1
            if self.replies == 1:
                raise NoSendError("invalid local payload")
            return Event("waiting_input", Handle("interactive", "question-b"))

    remote = Interactive()
    run, _, journal, _, supervisor = setup(tmp_path, remote)
    first = supervisor.step(run)["tasks"]["demo"]
    with pytest.raises(NoSendError, match="invalid local payload"):
        supervisor.provide_input(
            run, "demo", {}, attempt=first["attempt"], checkpoint=first["checkpoint_revision"],
        )
    assert journal.read(first["idempotency_key"], "test-provider")[1] is None
    supervisor.provide_input(
        run, "demo", {"text": "answer"}, attempt=first["attempt"], checkpoint=first["checkpoint_revision"],
    )
    second = supervisor.step(run)["tasks"]["demo"]
    assert second["attempt"] == first["attempt"]
    assert second["checkpoint_revision"] > first["checkpoint_revision"]
    with pytest.raises(ProviderError, match="checkpoint is no longer current"):
        supervisor.provide_input(
            run, "demo", {"text": "delayed answer"}, attempt=first["attempt"], checkpoint=first["checkpoint_revision"],
        )
    assert remote.replies == 2
    with pytest.raises(ProviderError, match="checkpoint changed"):
        journal.begin_action(
            first["idempotency_key"], "test-provider", "input", revision=first["checkpoint_revision"],
        )


def test_assets_can_be_retried_without_repeating_provider_work(tmp_path):
    class AssetProvider(SlowProvider):
        def __init__(self):
            super().__init__()
            self.collections = 0

        def submit(self, request):
            self.submissions += 1
            return Event("completed", Handle("with-asset"), text="report", artifacts_collected=False)

        def collect_artifacts(self, event, *, timeout):
            self.collections += 1
            if self.collections == 1:
                raise ProviderError("asset listing failed")
            return ({"id": "asset", "name": "report.md"},)

    remote = AssetProvider()
    run, store, journal, _, supervisor = setup(tmp_path, remote)
    with pytest.raises(ProviderError, match="asset listing failed"):
        supervisor.step(run)
    key = store.snapshot(run)["tasks"]["demo"]["idempotency_key"]
    saved, action = journal.read(key, "test-provider")
    assert saved.state == "completed" and not saved.artifacts_collected and action is None
    state = supervisor.step(run)
    assert state["status"] == "completed"
    assert state["tasks"]["demo"]["artifacts"] == [{"id": "asset", "name": "report.md"}]
    assert remote.submissions == 1 and remote.collections == 2


def test_non_string_text_field_uses_json_prompt_and_parser(tmp_path):
    class NumericText(Provider):
        def submit(self, request):
            assert "Return only a JSON value" in request.prompt()
            return Event("completed", Handle("integer"), text='{"text": 42}')

    run, _, _, _, supervisor = setup(tmp_path, NumericText(), text_type="integer")
    assert supervisor.step(run)["tasks"]["demo"]["result"] == {"text": 42}


def test_opposite_approval_does_not_resume_previous_decision(tmp_path):
    class Approval(Provider):
        def capabilities(self):
            return super().capabilities() | {"approval"}

        def submit(self, request):
            return Event("waiting_approval", Handle("approval", "form"))

        def approve(self, handle, approved, reason, *, timeout):
            raise AssertionError("a persisted approval must not be sent again")

    run, store, journal, _, supervisor = setup(tmp_path, Approval())
    waiting = supervisor.step(run)["tasks"]["demo"]
    key = waiting["idempotency_key"]
    revision = waiting["checkpoint_revision"]
    # The prior allow reached the provider, but the process stopped before
    # advancing local workflow state.
    journal.begin_action(key, "test-provider", "approval", revision=revision, decision=True)
    assert journal.save(
        key, "test-provider", Event("running", Handle("approval", "form")),
        revision=revision, action="approval",
    )
    with pytest.raises(ProviderError, match="different decision"):
        supervisor.provide_input(run, "demo", {}, approved=False, attempt=1, checkpoint=revision)
    assert store.snapshot(run)["tasks"]["demo"] == waiting
    supervisor.provide_input(run, "demo", {}, approved=True, attempt=1, checkpoint=revision)
    assert store.snapshot(run)["tasks"]["demo"]["status"] == "running"


def test_expiry_rechecks_provider_reservation_inside_transition(tmp_path, monkeypatch):
    now = [10.0]
    run, store, journal, _, supervisor = setup(tmp_path, SlowProvider(), clock=lambda: now[0], retries=1)
    (first,) = store.advance(run, store.definition(run).capabilities)
    now[0] = first.deadline
    advance = store.advance

    def reserve_then_advance(*args, **kwargs):
        assert journal.reserve(first.idempotency_key, "test-provider")
        return advance(*args, **kwargs)

    monkeypatch.setattr(store, "advance", reserve_then_advance)
    state = supervisor.step(run)
    assert state["tasks"]["demo"]["attempt"] == 1
    assert journal.read(first.idempotency_key, "test-provider")[1] == "submit"


def test_delayed_waiting_event_cannot_park_newer_running_task(tmp_path, monkeypatch):
    run, store, journal, _, supervisor = setup(tmp_path, SlowProvider())
    (dispatch,) = store.advance(run, store.definition(run).capabilities)
    key = dispatch.idempotency_key
    handle = Handle("delayed")
    stale = Event("waiting_input", handle)
    assert journal.reserve(key, "test-provider")
    assert journal.save(key, "test-provider", stale, action="submit", revision=0)
    assert journal.save(key, "test-provider", Event("running", handle), revision=1)
    monkeypatch.setattr(supervisor, "_provider_event", lambda *_: (stale, 1))
    supervisor._process(dispatch)
    assert store.snapshot(run)["tasks"]["demo"]["status"] == "running"


def test_nonterminal_reconciliation_preserves_cancel_reservation(tmp_path):
    class AmbiguousCancel(SlowProvider):
        resolved = False

        def cancel(self, handle, *, timeout):
            self.cancellations += 1
            raise ProviderError("cancel response was lost")

        def resume(self, handle, *, timeout):
            return Event("cancelled" if self.resolved else "running", handle)

    remote = AmbiguousCancel()
    run, store, journal, _, supervisor = setup(tmp_path, remote)
    key = supervisor.step(run)["tasks"]["demo"]["idempotency_key"]
    with pytest.raises(ProviderError, match="response was lost"):
        supervisor.cancel(run)
    with pytest.raises(ProviderError, match="cancellation remains unconfirmed"):
        supervisor.reconcile(run, "demo")
    assert journal.read(key, "test-provider")[1] == "cancel"
    remote.resolved = True
    assert supervisor.reconcile(run, "demo").state == "cancelled"
    supervisor.cancel(run)
    assert store.snapshot(run)["status"] == "cancelled"
    assert remote.cancellations == 1


def test_poll_eligibility_survives_restart_without_delaying_other_tasks(tmp_path):
    import yaml

    now = [10.0]

    class DelayedAuth(SlowProvider):
        def submit(self, request):
            if request.instructions == "Slow":
                return Event(
                    "waiting_auth", Handle("delayed"),
                    reason="Sign in to continue", prompt_url="https://example.org/sign-in",
                    poll_not_before=now[0] + 20,
                )
            return Event("completed", Handle("fast"), text="result")

    source = yaml.safe_load(single_workflow(tmp_path).document)
    task = source["tasks"][0]
    source["tasks"] = [
        {**task, "id": "slow", "instructions": "Slow"},
        {**task, "id": "fast"},
        {**task, "id": "follow-up", "needs": ["fast"]},
    ]
    path = tmp_path / "polling.yaml"
    path.write_text(yaml.safe_dump(source), encoding="utf-8")
    remote = DelayedAuth()
    run, store, _, bindings, supervisor = setup(
        tmp_path, remote, clock=lambda: now[0], workflow=load_workflow(path),
    )
    state = supervisor.step(run)
    assert state["tasks"]["slow"]["provider_status"] == "waiting_auth"
    assert state["tasks"]["slow"]["provider_prompt_url"] == "https://example.org/sign-in"
    assert state["tasks"]["slow"]["error"] == "Sign in to continue"
    assert supervisor.next_poll_delay(run) == 0
    assert supervisor.step(run)["tasks"]["follow-up"]["status"] == "completed"
    assert supervisor.next_poll_delay(run) == 20

    restored = Supervisor(StateStore(store.database, clock=lambda: now[0]), Journal(store.database), bindings, default_provider="test")
    restored.step(run)
    assert remote.resumes == 0
    now[0] += 20
    state = restored.step(run)
    assert state["status"] == "completed"
    assert state["tasks"]["slow"]["provider_prompt_url"] is None
    assert remote.resumes == 1


def test_documented_rejection_releases_reservation_without_automatic_resubmit(tmp_path):
    from kodflow_agents.ports import SubmissionRejected

    class LimitedProvider(SlowProvider):
        def submit(self, request):
            if self.submissions == 0:
                self.submissions += 1
                raise SubmissionRejected("Anthropic rejected the request: provider returned HTTP 429")
            return super().submit(request)

    remote = LimitedProvider()
    run, store, journal, _, supervisor = setup(tmp_path, remote)
    with pytest.raises(SubmissionRejected, match="429"):
        supervisor.step(run)
    assert remote.submissions == 1
    entry = store.snapshot(run)["tasks"]["demo"]
    assert journal.read(entry["idempotency_key"], "test-provider") == (None, None)
    assert supervisor.step(run)["tasks"]["demo"]["attempt"] == entry["attempt"] == 1
    assert remote.submissions == 2


def test_observed_ambiguous_attempt_can_be_abandoned_without_retry(tmp_path):
    from kodflow_agents.ports import ABANDONED_SUBMISSION

    remote = DroppedProvider()
    run, store, journal, _, supervisor = setup(tmp_path, remote, retries=2)
    with pytest.raises(ProviderError, match="submission outcome is unknown"):
        supervisor.step(run)
    key = store.snapshot(run)["tasks"]["demo"]["idempotency_key"]
    assert journal.read(key, "test-provider") == (None, "submit_unknown")
    abandoned = supervisor.abandon_submission(run, "demo")
    assert abandoned.state == ABANDONED_SUBMISSION
    assert abandoned.handle.native_id == ""
    entry = supervisor.step(run)["tasks"]["demo"]
    assert entry["status"] == "failed" and "remote outcome remains unknown" in entry["error"]
    assert remote.submissions == 1 and not remote.cancellations


def test_abandon_fences_crashed_submissions_after_deadline(tmp_path):
    from kodflow_agents.ports import ABANDONED_SUBMISSION

    now = [10.0]
    run, store, journal, _, supervisor = setup(tmp_path, SlowProvider(), clock=lambda: now[0])
    attempt = store.advance(run, set())[0]
    key = attempt.idempotency_key
    assert journal.reserve(key, "test-provider")
    with pytest.raises(ProviderError, match="might still be in flight"):
        supervisor.abandon_submission(run, "demo")
    with pytest.raises(ProviderError, match="might still be in flight"):
        supervisor.reconcile(run, "demo", "live-native-handle")
    assert journal.read(key, "test-provider") == (None, "submit")

    now[0] = attempt.deadline + 1
    assert supervisor.abandon_submission(run, "demo").state == ABANDONED_SUBMISSION
    assert not journal.save(key, "test-provider", Event("completed", Handle("late")), action="submit", revision=0)
    assert store.snapshot(run)["tasks"]["demo"]["status"] == "failed"


def test_abandoned_outcome_preserves_no_retry_if_local_transition_interrupted(tmp_path, monkeypatch):
    now = [10.0]
    remote = DroppedProvider()
    run, store, _, _, supervisor = setup(tmp_path, remote, clock=lambda: now[0], retries=2)
    with pytest.raises(ProviderError, match="submission outcome is unknown"):
        supervisor.step(run)
    with monkeypatch.context() as patch:
        def interrupted(*args, **kwargs):
            raise OSError("local transition interrupted")

        patch.setattr(store, "fail", interrupted)
        with pytest.raises(OSError, match="interrupted"):
            supervisor.abandon_submission(run, "demo")
    now[0] += 301
    assert supervisor.step(run)["status"] == "failed"
    assert remote.submissions == 1


def test_abandon_targets_active_compensation_and_preserves_original_result(tmp_path):
    from kodflow_agents.ports import ABANDONED_SUBMISSION

    path = tmp_path / "compensation.yaml"
    path.write_text("""apiVersion: io.github.kodflow/workflow/v1
id: recovery
description: Recover a provider submission during compensation.
inputSchema: {type: object}
tasks:
  - id: stage
    role: worker
    access: write
    ownedPaths: [approved.txt]
    compensation: Undo staged write.
    instructions: Stage the write.
    inputSchema: {type: object}
    outputSchema: {type: object}
  - id: verify
    role: reviewer
    needs: [stage]
    instructions: Verify.
    inputSchema: {type: object}
    outputSchema: {type: object}
""", encoding="utf-8")
    workflow = load_workflow(path)
    database = tmp_path / "runs.sqlite"
    store = StateStore(database)
    journal = Journal(database)
    supervisor = Supervisor(store, journal, {"test": Binding(SlowProvider(), "test-provider")}, default_provider="test")
    run = store.create_run(workflow, {})
    capabilities = {"repository.write"}
    assert store.advance(run, capabilities)[0].task_id == "stage"
    store.complete(run, "stage", 1, {"changed": True})
    assert store.advance(run, capabilities)[0].task_id == "verify"
    store.fail(run, "verify", 1, "verification failed", retryable=False)
    compensation = store.advance(run, capabilities)[0]
    assert compensation.compensation and compensation.task_id == "stage"
    assert journal.reserve(compensation.idempotency_key, "test-provider")
    journal.mark_submit_unknown(compensation.idempotency_key, "test-provider", revision=0)
    assert supervisor.abandon_submission(run, "stage").state == ABANDONED_SUBMISSION
    record = store.snapshot(run)["tasks"]["stage"]
    assert record["result"] == {"changed": True} and record["status"] == "completed"
    assert record["compensation"]["status"] == "failed"
    assert "remote outcome remains unknown" in record["compensation"]["error"]

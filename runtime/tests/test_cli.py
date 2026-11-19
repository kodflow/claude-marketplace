"""Operator-facing run loop behavior at persisted checkpoints."""

import json
from pathlib import Path

import pytest

from kodflow_agents import cli
from kodflow_agents.journal import Journal


def test_run_returns_checkpoint_when_no_work_can_poll(capsys):
    state = {"status": "compensating", "tasks": {"approval": {"status": "waiting_input"}}}

    class ParkedRun:
        stepped = False

        def step(self, run_id):
            assert not self.stepped
            self.stepped = True
            return state

        def next_poll_delay(self, run_id):
            return None

    assert cli._run(ParkedRun(), "checkpoint", once=False) == 0
    assert json.loads(capsys.readouterr().out) == state


def test_reconcile_abandon_and_native_retrieval_are_mutually_exclusive():
    parser = cli.parser()
    assert parser.parse_args(["reconcile", "run", "task", "--abandon"]).abandon
    with pytest.raises(SystemExit) as error:
        parser.parse_args(["reconcile", "run", "task", "--native-id", "remote", "--abandon"])
    assert error.value.code == 2


def test_abandon_pinned_live_attempt_without_provider_discovery(tmp_path, monkeypatch, capsys):
    repository = Path(__file__).resolve().parents[2]
    store_type, load = cli._bridge(repository)
    workflow = load(repository / "runtime/examples/research-council.yaml")
    database = tmp_path / "live.sqlite"
    store = store_type(database)
    journal = Journal(database)
    task = "anthropic-research"
    route = "live:anthropic"
    execution = {"default_provider": "openai", "live": True, "task_routes": {task: {"route": route}}}
    run_id = store.create_run(workflow, {"query": "Synthetic fixture"}, execution=execution)
    claims = store.advance(run_id, {"parallel-delegation", "structured-output", "official-web"})
    attempt = next(claim for claim in claims if claim.task_id == task)
    assert journal.reserve(attempt.idempotency_key, route)
    journal.mark_submit_unknown(attempt.idempotency_key, route, revision=0)

    def unexpected_discovery(*_):
        pytest.fail("local abandonment must not discover remote providers")

    monkeypatch.setattr(cli, "_provider_bindings", unexpected_discovery)
    assert cli.main(["--database", str(database), "reconcile", run_id, task, "--abandon"]) == 0
    assert json.loads(capsys.readouterr().out)["state"] == "abandoned_submission"
    assert store.snapshot(run_id)["tasks"][task]["status"] == "failed"

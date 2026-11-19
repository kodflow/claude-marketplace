"""Operator-facing run loop behavior at persisted checkpoints."""

import json

import pytest

from kodflow_agents import cli


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

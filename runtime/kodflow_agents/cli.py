"""Command-line bridge between the portable workflow model and provider runtime."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sqlite3
import sys
from tempfile import TemporaryDirectory
import time

from .journal import Journal
from .ports import Json, ProviderError, TERMINAL
from .providers.a2a import A2A
from .providers.anthropic import Anthropic
from .providers.computer import Computer, ComputerMcp
from .providers.fake import Fake
from .providers.openai import OpenAI
from .providers.perplexity import Perplexity
from .supervisor import Binding, Supervisor
from .transport import Transport, credential

_REAL_MODELS = {
    "anthropic": ("KODFLOW_ANTHROPIC_MODEL", "ANTHROPIC_API_KEY"),
    "openai": ("KODFLOW_OPENAI_MODEL", "OPENAI_API_KEY"),
    "perplexity": ("KODFLOW_PERPLEXITY_MODEL", "PERPLEXITY_API_KEY"),
}
_ALL = (*_REAL_MODELS, "computer", "a2a")


def _provider_bindings(live: bool, names: set[str]) -> dict[str, Binding]:
    if unknown := names - set(_ALL):
        raise ProviderError("unknown provider: " + ", ".join(sorted(unknown)))
    if not live:
        return {name: Binding(Fake(name), f"offline:{name}", web_search=True) for name in names}
    transport = Transport()
    constructors = {"anthropic": Anthropic, "openai": OpenAI, "perplexity": Perplexity}
    result = {}
    for name in sorted(names):
        if name in _REAL_MODELS:
            model_env, credential_env = _REAL_MODELS[name]
            model = os.environ.get(model_env, "").strip()
            if not model:
                raise ProviderError(f"{name} model is required in {model_env}")
            credential(credential_env)
            if name == "openai" and os.environ.get("KODFLOW_OPENAI_BACKGROUND") == "1":
                result[name] = Binding(OpenAI(transport, background=True), "live:openai-background", model, True)
            else:
                result[name] = Binding(constructors[name](transport), f"live:{name}", model, True)
        elif name == "computer":
            credential("PERPLEXITY_COMPUTER_OAUTH_TOKEN")
            result[name] = Binding(
                Computer(ComputerMcp(transport).call), "live:computer", os.environ.get("KODFLOW_COMPUTER_MODEL", ""),
            )
        else:
            card = os.environ.get("KODFLOW_A2A_CARD_URL", "")
            if not card:
                raise ProviderError("A2A requires KODFLOW_A2A_CARD_URL")
            token_ref = "KODFLOW_A2A_BEARER_TOKEN" if os.environ.get("KODFLOW_A2A_BEARER_TOKEN") else None
            result[name] = Binding(A2A(transport, card, credential_env=token_ref), f"live:a2a:{card}")
    return result


def _bridge(repository: Path):
    scripts = repository / "scripts"
    if not (scripts / "pluginlib" / "state.py").is_file():
        raise ProviderError("pass --repository pointing to a checkout containing the workflow engine")
    sys.path.insert(0, str(scripts))
    from pluginlib.state import StateStore
    from pluginlib.workflows import load_workflow

    return StateStore, load_workflow


def _print(value) -> None:
    print(json.dumps(value, ensure_ascii=False, allow_nan=False, indent=2, default=vars))


def _json_object(raw: str) -> Json:
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise ProviderError("workflow data must be a JSON object")
    return value


def _workflow_providers(workflow, default: str) -> set[str]:
    return {task.provider or default for task in workflow.tasks}


def _run(supervisor: Supervisor, run_id: str, *, once: bool) -> int:
    while True:
        state = supervisor.step(run_id)
        status = state["status"]
        if once or status in TERMINAL or status == "waiting_input":
            _print(state)
            return int(status == "failed")
        if status in {"running", "compensating"}:
            time.sleep(1)


def _doctor(repository: Path) -> int:
    store_type, load = _bridge(repository)
    path = repository / "runtime" / "examples" / "research-council.yaml"
    workflow = load(path)
    with TemporaryDirectory(prefix="kodflow-agents-doctor-") as temporary:
        database = Path(temporary) / "state.sqlite"
        providers = _provider_bindings(False, _workflow_providers(workflow, "openai"))
        store = store_type(database)
        supervisor = Supervisor(store, Journal(database), providers, default_provider="openai")
        supervisor.preflight(workflow)
        run_id = store.create_run(workflow, {"query": "Compare daylight and battery storage."})
        first = supervisor.step(run_id)
        if first["status"] in TERMINAL or first["tasks"]["verify"]["status"] != "pending":
            raise ProviderError("offline witness did not stop between workflow frontiers")
        resumed_store = store_type(database)
        resumed = Supervisor(resumed_store, Journal(database), providers, default_provider="openai").step(run_id)
        if resumed["status"] != "completed" or not resumed["tasks"]["verify"]["artifacts"]:
            raise ProviderError("offline witness failed to resume and recover artifacts")
    _print({"workflow": workflow.id, "providers": sorted(providers), "resumed": True, "artifacts": True})
    return 0


def parser() -> argparse.ArgumentParser:
    command = argparse.ArgumentParser(description=__doc__)
    command.add_argument("--repository", type=Path, default=Path(__file__).resolve().parents[2])
    command.add_argument("--database", type=Path, default=Path("dist/kodflow-agents/runs.sqlite"))
    command.add_argument("--default-provider", choices=_ALL, default="openai")
    command.add_argument("--live", action="store_true", help="permit credentialed, billable provider operations")
    subcommands = command.add_subparsers(dest="command", required=True)

    doctor = subcommands.add_parser("doctor")
    doctor.add_argument("--offline", action="store_true", required=True)
    run = subcommands.add_parser("run")
    run.add_argument("workflow", type=Path)
    run.add_argument("--input", required=True)
    run.add_argument("--run-id")
    run.add_argument("--once", action="store_true")

    for name in ("resume", "status", "cancel", "input", "approve", "reconcile", "artifacts", "usage"):
        action = subcommands.add_parser(name)
        action.add_argument("run_id")
        if name == "resume":
            action.add_argument("--once", action="store_true")
        if name in {"input", "approve", "reconcile", "artifacts", "usage"}:
            action.add_argument("task_id")
        if name == "input":
            action.add_argument("--value", required=True)
        if name == "approve":
            action.add_argument("decision", choices=("allow", "deny"))
            action.add_argument("--reason", required=True)
        if name == "reconcile":
            action.add_argument("--native-id")
    return command


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    try:
        repository = args.repository.resolve()
        if args.command == "doctor":
            if args.live:
                raise ProviderError("doctor --offline cannot use --live")
            return _doctor(repository)
        store_type, load = _bridge(repository)
        store = store_type(args.database)
        journal = Journal(args.database)
        if args.command == "run":
            workflow = load(args.workflow)
            providers = _provider_bindings(args.live, _workflow_providers(workflow, args.default_provider))
            supervisor = Supervisor(store, journal, providers, default_provider=args.default_provider)
            supervisor.preflight(workflow)
            run_id = store.create_run(workflow, _json_object(args.input), run_id=args.run_id)
            print(f"Run {run_id}", file=sys.stderr, flush=True)
            return _run(supervisor, run_id, once=args.once)
        state = store.snapshot(args.run_id)
        if args.command == "status":
            _print(state)
            return 0

        if args.command in {"artifacts", "usage"}:
            task = state["tasks"][args.task_id]
            key = task["idempotency_key"]
            if not key:
                raise ProviderError("task has no provider attempt")
            if args.command == "artifacts":
                _print(task["artifacts"])
            else:
                _print(journal.usage(key))
            return 0

        names = {task["provider"] or args.default_provider for task in state["tasks"].values()}
        providers = _provider_bindings(args.live, names)
        supervisor = Supervisor(store, journal, providers, default_provider=args.default_provider)
        if args.command == "resume":
            return _run(supervisor, args.run_id, once=args.once)
        if args.command == "input":
            supervisor.provide_input(args.run_id, args.task_id, _json_object(args.value))
        elif args.command == "approve":
            supervisor.provide_input(
                args.run_id, args.task_id, {"reason": args.reason}, approved=args.decision == "allow",
            )
        elif args.command == "cancel":
            supervisor.cancel(args.run_id)
        elif args.command == "reconcile":
            _print(supervisor.reconcile(args.run_id, args.task_id, args.native_id))
        return 0
    except (ProviderError, ValueError, KeyError, sqlite3.Error, OSError) as error:
        print(f"kodflow-agents: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

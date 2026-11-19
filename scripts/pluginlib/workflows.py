"""Validate workflow DAGs and render delegation plans for native hosts."""

from __future__ import annotations

from dataclasses import dataclass
from graphlib import CycleError, TopologicalSorter
import json
from pathlib import Path, PurePosixPath
import re
from typing import Any

import yaml
from yaml.constructor import ConstructorError

from .contract_schema import check_contract_schema, offline_validator


SCHEMAS = Path(__file__).resolve().parents[2] / "schemas"
WORKFLOW_SCHEMA = "kodflow-workflow-v1.schema.json"
IDENTIFIER = re.compile(r"[a-z][a-z0-9-]{0,63}")

HOSTS = {
    "claude": (
        "Claude Code",
        "Use Claude Teams when available. Otherwise delegate through named Claude Code subagents.",
        {"parallel-delegation", "structured-output", "local-verifier", "repository.read", "scratch.write", "web.official-docs"},
    ),
    "openai": (
        "Codex",
        "Use Codex collaboration to spawn named agents, wait for their results, then join the results.",
        {"parallel-delegation", "structured-output", "local-verifier", "repository.read", "scratch.write", "web.official-docs"},
    ),
    "perplexity": (
        "Perplexity",
        "Use Computer teammates where granted by the host. Verify that independent delegation and all requested resources are available.",
        {"parallel-delegation", "structured-output", "web.official-docs"},
    ),
}


class WorkflowError(ValueError):
    """Invalid workflow definition or unsupported execution plan."""


class _UniqueKeysLoader(yaml.SafeLoader):
    def construct_mapping(self, node: yaml.nodes.MappingNode, deep: bool = False) -> dict:
        result = {}
        for key_node, value_node in node.value:
            key = self.construct_object(key_node, deep=deep)
            if not isinstance(key, str) or key in result:
                raise ConstructorError(None, None, f"invalid or duplicate mapping key {key!r}", key_node.start_mark)
            result[key] = self.construct_object(value_node, deep=deep)
        return result


@dataclass(frozen=True, slots=True)
class Task:
    id: str
    role: str
    instructions: str
    input_schema: dict
    output_schema: dict
    needs: tuple[str, ...]
    access: str
    owned_paths: tuple[str, ...]
    timeout: int
    retries: int
    idempotency_key: str | None
    approval: bool
    artifacts: tuple[str, ...]
    compensation: str | None
    required_capabilities: frozenset[str]
    bindings: dict | None
    provider: str | None
    scratch_write: bool


@dataclass(frozen=True, slots=True)
class Workflow:
    id: str
    description: str
    tasks: tuple[Task, ...]
    input_schema: dict
    required_capabilities: frozenset[str]
    document: str

    @property
    def capabilities(self) -> frozenset[str]:
        """Include requirements implied by task access and retries."""
        required = self.required_capabilities.union(
            *(task.required_capabilities for task in self.tasks)
        )
        for task in self.tasks:
            if task.access == "write":
                required |= {"repository.write"}
                if task.retries:
                    required |= {"idempotent-write"}
            if task.approval:
                required |= {"human-approval"}
            if task.scratch_write:
                required |= {"scratch.write"}
        return required


def _check_schema(schema: dict, where: str) -> None:
    try:
        check_contract_schema(schema)
    except ValueError as error:
        raise WorkflowError(f"{where}: {error}") from error


def validate_value(schema: dict, value: Any, where: str) -> None:
    try:
        error = next(offline_validator(schema).iter_errors(value), None)
    except Exception as error:
        # A broken local $ref is a contract error, not a provider failure.
        raise WorkflowError(f"{where}: could not apply JSON Schema: {error}") from error
    if error is not None:
        path = "/".join(map(str, error.path))
        raise WorkflowError(f"{where}{'/' + path if path else ''}: {error.message}")


def _validate_paths(task: Task) -> None:
    for field, paths in (("ownedPaths", task.owned_paths), ("artifacts", task.artifacts)):
        for raw in paths:
            path = PurePosixPath(raw)
            if (
                raw == "."
                or path.is_absolute()
                or ".." in path.parts
                or any(character in raw for character in ("\\", ":", "\0"))
                or str(path) != raw
            ):
                raise WorkflowError(f"task {task.id}: invalid {field} path {raw!r}")

    if task.access == "read" and (task.owned_paths or task.compensation):
        raise WorkflowError(f"task {task.id}: read-only tasks cannot own paths or compensate writes")
    if task.access == "write":
        if not task.owned_paths:
            raise WorkflowError(f"task {task.id}: a write task requires owned paths")
        if task.retries and not task.idempotency_key:
            raise WorkflowError(f"task {task.id}: retrying a write requires idempotencyKey")


def _workflow(data: dict) -> Workflow:
    tasks = tuple(
        Task(
            id=node["id"],
            role=node["role"],
            instructions=node["instructions"],
            input_schema=node["inputSchema"],
            output_schema=node["outputSchema"],
            needs=tuple(node.get("needs", ())),
            access=node.get("access", "read"),
            owned_paths=tuple(node.get("ownedPaths", ())),
            timeout=node.get("timeout", 300),
            retries=node.get("retries", 0),
            idempotency_key=node.get("idempotencyKey"),
            approval=node.get("approval", False),
            artifacts=tuple(node.get("artifacts", ())),
            compensation=node.get("compensation"),
            required_capabilities=frozenset(node.get("requiredCapabilities", ())),
            bindings=node.get("with"),
            provider=node.get("provider"),
            scratch_write=node.get("scratchWrite", False),
        )
        for node in data["tasks"]
    )
    ids = {task.id for task in tasks}
    if len(ids) != len(tasks):
        raise WorkflowError("workflow has duplicate task IDs")
    identifiers = [data["id"], *ids, *(task.role for task in tasks)]
    identifiers.extend(task.provider for task in tasks if task.provider is not None)
    if any(IDENTIFIER.fullmatch(value) is None for value in identifiers):
        raise WorkflowError("workflow, task, role and provider IDs must use lowercase portable names")
    for task in tasks:
        unknown = set(task.needs) - ids
        if unknown:
            raise WorkflowError(f"task {task.id}: unknown dependencies {', '.join(sorted(unknown))}")
        _check_schema(task.input_schema, f"task {task.id} inputSchema")
        _check_schema(task.output_schema, f"task {task.id} outputSchema")
        _validate_paths(task)
    try:
        tuple(TopologicalSorter({task.id: task.needs for task in tasks}).static_order())
    except CycleError as error:
        raise WorkflowError(f"workflow dependencies form a cycle: {error.args[1]}") from error
    _check_schema(data["inputSchema"], "workflow inputSchema")

    return Workflow(
        id=data["id"],
        description=data["description"],
        tasks=tasks,
        input_schema=data["inputSchema"],
        required_capabilities=frozenset(data.get("requiredCapabilities", ())),
        document=json.dumps(data, ensure_ascii=False, sort_keys=True, allow_nan=False),
    )


def load_workflow(path: Path, schemas_root: Path | None = None) -> Workflow:
    """Read a UTF-8 workflow, then validate the schema and DAG."""
    schema_path = (schemas_root or SCHEMAS) / WORKFLOW_SCHEMA
    try:
        data = yaml.load(path.read_text(encoding="utf-8"), Loader=_UniqueKeysLoader)
        schema = json.loads(schema_path.read_text(encoding="utf-8"))
    except (OSError, ValueError, yaml.YAMLError) as error:
        raise WorkflowError(f"{path}: {error}") from error
    validate_value(schema, data, str(path))
    try:
        return _workflow(data)
    except (TypeError, ValueError) as error:
        raise WorkflowError(f"{path}: {error}") from error


def restore_workflow(document: str) -> Workflow:
    """Restore a document already validated when it was saved."""
    return _workflow(json.loads(document))


def _bind(binding: Any, context: dict) -> Any:
    if isinstance(binding, dict) and set(binding) == {"$from"}:
        pointer = binding["$from"]
        if not isinstance(pointer, str) or not pointer.startswith("/"):
            raise WorkflowError(f"invalid task input pointer: {pointer!r}")
        node: Any = context
        for token in pointer[1:].split("/"):
            key = token.replace("~1", "/").replace("~0", "~")
            try:
                if isinstance(node, list) and key.isascii() and key.isdecimal():
                    node = node[int(key)]
                elif isinstance(node, dict):
                    node = node[key]
                else:
                    raise KeyError(key)
            except (IndexError, KeyError) as error:
                raise WorkflowError(f"task input pointer does not resolve: {pointer}") from error
        return node
    if isinstance(binding, dict):
        return {name: _bind(value, context) for name, value in binding.items()}
    if isinstance(binding, list):
        return [_bind(value, context) for value in binding]
    return binding


def task_input(task: Task, inputs: dict, dependencies: dict) -> dict:
    context = {"inputs": inputs, "dependencies": dependencies}
    result = context if task.bindings is None else _bind(task.bindings, context)
    if not isinstance(result, dict):
        raise WorkflowError(f"task {task.id}: resolved inputs must be an object")
    validate_value(task.input_schema, result, f"task {task.id} inputs")
    return result


# Claude Code addresses a plugin agent by its namespaced name; a bare name only
# resolves when the agent is installed at user level, which a marketplace
# install is not.
CLAUDE_ROLE_NAMESPACE = "kodflow-specialists"


def _role_name(role: str, host: str) -> str:
    return f"{CLAUDE_ROLE_NAMESPACE}:{role}" if host == "claude" else role


def render_projection(workflow: Workflow, host: str) -> bytes:
    """Produce instructions that preserve task order and capability gating."""
    name, delegation, available = HOSTS[host]
    missing = workflow.capabilities - available
    requirements = ", ".join(sorted(workflow.capabilities)) or "none"
    lines = [
        f"# {workflow.id} on {name}",
        "",
        workflow.description,
        "",
        f"Required capabilities: {requirements}.",
        "",
    ]
    if missing:
        lines += [
            "This host projection cannot provide required capabilities: "
            + ", ".join(sorted(missing)) + ". Stop before starting any task.",
            "",
        ]
        return "\n".join(lines).encode("utf-8")
    lines += [
        delegation,
        "Confirm each required capability in the current session. If any is unavailable, stop before dispatch and report what is missing.",
        "Dispatch independent tasks together. Start a dependent task only after its prerequisites have completed and their outputs satisfy the declared contracts.",
        "Preserve the existing skill's evidence and report format. Keep repository files unchanged on read-only tasks.",
        "",
    ]
    for task in workflow.tasks:
        lines += [
            f"## {task.id}",
            "",
            f"Assign role `{_role_name(task.role, host)}` with `{task.access}` access. Prerequisites: "
            + (", ".join(task.needs) or "none") + ".",
            f"Timeout: {task.timeout} seconds. Retries: {task.retries}.",
            "",
            task.instructions.strip(),
            "",
            "Input JSON Schema:",
            "",
            "```json",
            json.dumps(task.input_schema, ensure_ascii=False, sort_keys=True, indent=2),
            "```",
            "",
        ]
        if task.bindings is None:
            lines += ["Use the default input envelope: `inputs` contains the run input and `dependencies` maps prerequisite task IDs to their outputs.", ""]
        else:
            lines += [
                "Resolve each `$from` in these bindings as a JSON Pointer against "
                "the default envelope (`/inputs` for run input and "
                "`/dependencies/<task>` for a prerequisite's output). Pass the resulting object as the task input.",
                "",
                "```json",
                json.dumps(task.bindings, ensure_ascii=False, sort_keys=True, indent=2),
                "```",
                "",
            ]
        lines += [
            "Output JSON Schema:",
            "",
            "```json",
            json.dumps(task.output_schema, ensure_ascii=False, sort_keys=True, indent=2),
            "```",
            "",
        ]
        if task.owned_paths:
            lines += ["Owned paths: " + ", ".join(task.owned_paths) + ".", ""]
        if task.scratch_write:
            lines += ["Allow writes only in the designated scratch directory. Keep the reviewed repository read-only.", ""]
        if task.approval:
            lines += ["Obtain operator approval before dispatching this task.", ""]
        if task.idempotency_key:
            lines += [f"Scope idempotency key `{task.idempotency_key}` to this run and task and reuse it on retries.", ""]
        if task.artifacts:
            lines += ["Artifacts: " + ", ".join(task.artifacts) + ".", ""]
        if task.compensation:
            lines += ["Compensation when an enclosing workflow fails:", "", task.compensation.strip(), ""]
    return "\n".join(lines).encode("utf-8")


def compile_projections(repo_root: Path) -> dict[Path, bytes]:
    """Build one deterministic delegation document per workflow and host."""
    result: dict[Path, bytes] = {}
    for path in sorted((repo_root / "plugins").glob("*/io.github.kodflow/workflows/*.yaml")):
        workflow = load_workflow(path, repo_root / "schemas")
        if workflow.id != path.stem:
            raise WorkflowError(f"{path}: workflow ID must match the filename")
        root = path.parents[2].relative_to(repo_root)
        for host in HOSTS:
            target = root / "io.github.kodflow" / "projections" / "workflows" / f"{workflow.id}-{host}.md"
            result[target] = render_projection(workflow, host)
    if not result:
        raise WorkflowError("no package workflow definitions found")
    return result

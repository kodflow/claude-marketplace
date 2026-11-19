"""Load portable roles and render their host-specific projections."""

from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path, PurePosixPath
import re

from jsonschema import Draft202012Validator, SchemaError
import yaml

from .codex_text import render_agent, role_agent_fields


ROLE_PATH = Path("io.github.kodflow/roles")
ROLE_SCHEMA = "kodflow-role-v1.schema.json"
ROLE_ID = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
SCHEMA_MAPS = ("$defs", "definitions", "properties", "patternProperties", "dependentSchemas", "dependencies")
SCHEMA_ARRAYS = ("allOf", "anyOf", "oneOf", "prefixItems")
SCHEMA_CHILDREN = (
    "additionalProperties", "contains", "contentSchema", "else", "if", "items", "not",
    "propertyNames", "then", "unevaluatedItems", "unevaluatedProperties",
)


@dataclass(frozen=True)
class Role:
    """One validated role with resolved instructions and local JSON contracts."""

    package: str
    id: str
    description: str
    instructions: str
    required: tuple[str, ...]
    optional: tuple[str, ...]
    model_class: str
    codex_effort: str | None
    input_schema: dict
    output_schema: dict
    side_effects: str
    claude: dict

    def render_claude(self) -> bytes:
        """Keep Claude's existing tool restrictions and agent settings."""
        metadata = {"name": self.id, "description": self.description, **self.claude}
        header = yaml.safe_dump(metadata, allow_unicode=True, sort_keys=False, width=88)
        return f"---\n{header}---\n{self.instructions}".encode("utf-8")

    def render_codex(self) -> bytes:
        """Render the standalone TOML format recognized by the Codex agent loader."""
        metadata = role_agent_fields({
            "id": self.id, "description": self.description,
            "modelClass": self.model_class,
            **({"codexEffort": self.codex_effort} if self.codex_effort else {}),
        })
        return render_agent(metadata, self.instructions, f"{self.id}.md").encode("utf-8")

    def render_perplexity(self) -> bytes:
        """Render an advisory skill and declare limitations that matter for this role."""
        header = yaml.safe_dump(
            {"name": self.id, "description": self.description},
            allow_unicode=True, sort_keys=False, width=88,
        )
        capabilities = ", ".join(self.required) or "none"
        body = (
            f"# {self.id}\n\n"
            "This skill provides role guidance. The host does not provide a separate "
            "sub-agent identity, sandbox, model, or tool restrictions for it. "
            "Apply the active session's permissions and policies.\n\n"
            f"Required capabilities for running the native role: {capabilities}.\n\n"
        )
        if self.package == "kodflow-gamedev":
            body += (
                "Use this role's description to route virtual animation work. The "
                "native role runs through the game's Claude workflow when the project "
                "has enabled it.\n"
            )
        elif self.side_effects == "none":
            body += (
                "Use the following instructions as read-only guidance over the "
                "materials supplied. This skill does not execute commands, launch "
                "agents, or write files.\n"
                f"{self.instructions}"
            )
        else:
            body += (
                "Use this skill to identify the appropriate specialist and draft a "
                "brief. Use the configured native agent for steps that need tool "
                "execution, file changes, or external actions.\n"
            )
        return f"---\n{header}---\n\n{body}".encode("utf-8")


def _inside(path: Path, root: Path) -> Path:
    """Resolve symlinks before accepting any path supplied by a role."""
    try:
        result = path.resolve(strict=True)
    except RuntimeError as error:
        raise ValueError(f"{path}: symlink resolution failed") from error
    if not result.is_relative_to(root):
        raise ValueError(f"{path} escapes {root}")
    return result


def _role_file(root: Path, value: str) -> Path:
    relative = PurePosixPath(value)
    if relative.is_absolute() or ".." in relative.parts or "\\" in value or not relative.parts:
        raise ValueError(f"invalid role file {value!r}")
    path = _inside(root / relative, root)
    if not path.is_file():
        raise ValueError(f"{path} is not a role file")
    return path


def _check_schema_refs(value: object) -> None:
    """Keep validation and task execution independent of remote schema retrieval."""
    if not isinstance(value, dict):
        return
    for name in ("$ref", "$dynamicRef"):
        if name in value:
            target = value[name]
            if not isinstance(target, str) or not target.startswith("#"):
                raise ValueError(f"role schema reference must stay in its document: {target!r}")
    # Traverse only subschema positions. The keys of a properties map and
    # arbitrary example or default data do not have schema semantics.
    for name in SCHEMA_MAPS:
        children = value.get(name)
        if isinstance(children, dict):
            for child in children.values():
                _check_schema_refs(child)
    for name in SCHEMA_ARRAYS:
        children = value.get(name)
        if isinstance(children, list):
            for child in children:
                _check_schema_refs(child)
    for name in SCHEMA_CHILDREN:
        _check_schema_refs(value.get(name))


def _contract(root: Path, value: str | dict, location: str) -> dict:
    if isinstance(value, str):
        path = _role_file(root, value)
        document = json.loads(path.read_text(encoding="utf-8"))
        location = str(path)
    else:
        document = value
    if not isinstance(document, dict):
        raise ValueError(f"{location} must contain a JSON Schema object")
    # PyYAML can represent recursive aliases. Python's JSON reader also accepts
    # non-finite numbers unless they are checked explicitly.
    try:
        if json.loads(json.dumps(document, allow_nan=False)) != document:
            raise ValueError("object keys must be strings")
    except (TypeError, ValueError) as error:
        raise ValueError(f"{location} must be JSON-compatible: {error}") from error
    try:
        Draft202012Validator.check_schema(document)
    except SchemaError as error:
        raise ValueError(f"{location}: {error.message}") from error
    _check_schema_refs(document)
    return document


def load_roles(package_root: Path, schemas: Path) -> list[Role]:
    """Read all role declarations in a package and check boundaries and contracts."""
    root = package_root.resolve(strict=True)
    roles_root = root / ROLE_PATH
    if not roles_root.exists() and not roles_root.is_symlink():
        return []
    roles_root = _inside(roles_root, root)
    validator = Draft202012Validator(json.loads((schemas / ROLE_SCHEMA).read_text(encoding="utf-8")))
    roles = []
    for source in sorted(roles_root.glob("*/role.yaml")):
        role_root = _inside(source.parent, roles_root)
        descriptor = _inside(source, role_root)
        try:
            data = yaml.safe_load(descriptor.read_text(encoding="utf-8"))
        except yaml.YAMLError as error:
            raise ValueError(f"{source}: invalid role YAML: {error}") from error
        error = next(validator.iter_errors(data), None)
        if error:
            raise ValueError(f"{source}: {error.message}")
        role_id = data["id"]
        if not ROLE_ID.fullmatch(role_id) or role_id != source.parent.name:
            raise ValueError(f"{source}: role id {role_id!r} must match its directory")
        required = tuple(data["capabilities"]["required"])
        optional = tuple(data["capabilities"]["optional"])
        if set(required) & set(optional):
            raise ValueError(f"{source}: a capability cannot be both required and optional")
        instructions = _role_file(role_root, data["instructions"]).read_text(encoding="utf-8")
        if not instructions.strip():
            raise ValueError(f"{source}: role instructions are empty")
        roles.append(Role(
            package=root.name, id=role_id, description=data["description"],
            instructions=instructions, required=required, optional=optional,
            model_class=data["modelClass"], codex_effort=data.get("codexEffort"),
            input_schema=_contract(role_root, data["inputSchema"], f"{source} inputSchema"),
            output_schema=_contract(role_root, data["outputSchema"], f"{source} outputSchema"),
            side_effects=data["sideEffects"], claude=data["claude"],
        ))
    return roles


def _repo_roles(repository: Path, schemas: Path) -> list[Role]:
    plugins_root = (repository / "plugins").resolve(strict=True)
    roles = [
        role for package in sorted(plugins_root.iterdir()) if package.is_dir()
        for role in load_roles(_inside(package, plugins_root), schemas)
    ]
    names = {role.id for role in roles}
    if len(names) != len(roles):
        raise ValueError("role ids must be unique across the catalog")
    return roles


def compile_roles(repository: Path, schemas: Path) -> dict[Path, bytes]:
    """Build tracked Claude and legacy Codex projections from portable sources."""
    outputs: dict[Path, bytes] = {}
    exclusion_file = repository / "scripts/install-exclude.txt"
    excluded = {
        line.split("#", 1)[0].strip()
        for line in exclusion_file.read_text(encoding="utf-8").splitlines()
    } if exclusion_file.is_file() else set()
    for role in _repo_roles(repository, schemas):
        outputs[Path("plugins") / role.package / "agents" / f"{role.id}.md"] = role.render_claude()
        if role.package not in excluded:
            outputs[Path("codex/agents") / f"{role.id}.toml"] = role.render_codex()
    return outputs


def build_role_artifacts(repository: Path, schemas: Path) -> dict[Path, bytes]:
    """Build host-scoped role artifacts, including Perplexity advisory skills."""
    outputs: dict[Path, bytes] = {}
    for role in _repo_roles(repository, schemas):
        outputs[Path("openai") / role.package / "agents" / f"{role.id}.toml"] = role.render_codex()
        outputs[Path("perplexity") / role.package / "skills" / role.id / "SKILL.md"] = role.render_perplexity()
    return outputs


def perplexity_role_skills(package_root: Path, schemas: Path) -> dict[str, bytes]:
    """Supply advisory skill members for a profile that explicitly supports them."""
    return {
        f"skills/{role.id}/SKILL.md": role.render_perplexity()
        for role in load_roles(package_root, schemas)
    }

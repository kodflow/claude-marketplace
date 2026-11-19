"""Codex-native plugin packages generated from the Claude packages.

`.agents/plugins/marketplace.json` points Codex at `codex/plugins/<name>/`, not
at `plugins/<name>/`: the Claude package's skills call their scripts through
`${CLAUDE_PLUGIN_ROOT}`, which Codex neither sets nor substitutes, and Codex
documents no variable of its own for a plugin's root.

Root resolution under Codex. `codex plugin add <name>@<marketplace>` copies the
package to `${CODEX_HOME:-$HOME/.codex}/plugins/cache/<marketplace>/<name>/<version>`
(measured with codex-cli 0.166: `installedPath` in `codex plugin add --json`),
where `<version>` is the `version` of the package's plugin.json. Every form of
`${CLAUDE_PLUGIN_ROOT}` is therefore rewritten to that expression, with the
marketplace name and the version known at build time. It stays a valid shell
expression, so a command copied from a skill runs as written; CODEX_HOME is
inherited by the commands Codex runs. Each projected SKILL.md also states the
rule, with the fallback Codex itself documents for skills (paths resolved
against the directory of the SKILL.md it opened): the plugin root is two
directories above it.

`${CLAUDE_SKILL_DIR}` becomes the same root followed by `skills/<skill>`.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path, PurePosixPath
import re

from .codex_text import neutralise, render_skill, split_frontmatter
from .model import Catalog, PluginPackage
from .sources import source_files, trust_executable_mode


CODEX_PACKAGES = PurePosixPath("codex/plugins")
# What a Codex package carries: its manifest, its skills (with the scripts in
# skills/_shared), the commands they call, and the workflow documents their
# SKILL.md links by relative path. Agents, hooks and the Claude manifest have
# no Codex meaning; custom agents ship separately in codex/agents.
INCLUDED = ("plugin.json", "README.md", "mcp.json", "assets", "bin", "skills", "io.github.kodflow/projections")
# Rewritten text: everything a skill reads or runs. plugin.json, bin and assets
# are copied byte for byte.
REWRITTEN = ("skills", "io.github.kodflow/projections")

_ROOT_FORMS = re.compile(
    r"\$\{CLAUDE_PLUGIN_ROOT:\+\$\{?CLAUDE_PLUGIN_ROOT\}?(?P<rest>[^}]*)\}"
    r"|\$\{CLAUDE_PLUGIN_ROOT(?:[-=?+]|:[-=?+])?[^}]*\}"
    r"|\$CLAUDE_PLUGIN_ROOT\b"
)
_SKILL_DIR_FORMS = re.compile(r"\$\{CLAUDE_SKILL_DIR(?:[-=?+]|:[-=?+])?[^}]*\}|\$CLAUDE_SKILL_DIR\b")


@dataclass(frozen=True)
class CodexFile:
    data: bytes
    executable: bool


def root_expression(marketplace: str, plugin: str, version: str) -> str:
    """The shell expression of the directory Codex installs a package into."""
    return f"${{CODEX_HOME:-$HOME/.codex}}/plugins/cache/{marketplace}/{plugin}/{version}"


def rewrite_roots(text: str, root: str, skill: str | None) -> str:
    """Replace every plugin-root and skill-dir form with Codex paths."""
    text = _ROOT_FORMS.sub(lambda match: root + (match["rest"] or ""), text)
    if skill is not None:
        text = _SKILL_DIR_FORMS.sub(lambda _: f"{root}/skills/{skill}", text)
    return text


def _note(root: str) -> str:
    return (
        "> Paths below are rooted at `" + root + "`, where Codex installs this plugin."
        " If that directory is missing, the plugin root is the directory two levels"
        " above this SKILL.md.\n\n"
    )


def _selected(relative: PurePosixPath, prefixes: tuple[str, ...]) -> bool:
    return any(relative == PurePosixPath(p) or PurePosixPath(p) in relative.parents for p in prefixes)


def render_package(root: Path, marketplace: str, package: PluginPackage) -> dict[PurePosixPath, CodexFile]:
    """Every file of one Codex package, keyed by its path in the repository."""
    scope = package.root.resolve().relative_to(root.resolve())
    trust = trust_executable_mode(root)
    expression = root_expression(marketplace, package.name, package.manifest["version"])
    destination = CODEX_PACKAGES / package.name
    files: dict[PurePosixPath, CodexFile] = {}
    for source in source_files(root, scope.as_posix()):
        relative = PurePosixPath(source.path.relative_to(scope).as_posix())
        if not _selected(relative, INCLUDED) or (root / source.path).is_symlink():
            continue
        data = source.content(root)
        executable = source.mode(root, trust) == "100755"
        if _selected(relative, REWRITTEN):
            try:
                text = data.decode("utf-8")
            except UnicodeDecodeError:
                text = None
            if text is not None:
                skill = relative.parts[1] if relative.parts[0] == "skills" and len(relative.parts) > 2 else None
                if skill is not None and len(relative.parts) == 3 and relative.name == "SKILL.md":
                    # Codex drops allowed-tools with the rest of the Claude
                    # frontmatter, so only the body needs its paths rewritten.
                    fm, body = split_frontmatter(text)
                    body = neutralise(rewrite_roots(body, expression, skill))
                    text = render_skill(fm, _note(expression) + body, skill)
                else:
                    text = neutralise(rewrite_roots(text, expression, skill))
                data = text.encode("utf-8")
        files[destination / relative] = CodexFile(data, executable)
    return files


def render_packages(root: Path, catalog: Catalog, packages: list[PluginPackage]) -> dict[PurePosixPath, CodexFile]:
    """All Codex packages of the plugins enabled for the OpenAI target."""
    files: dict[PurePosixPath, CodexFile] = {}
    for package in packages:
        if package.target("openai").get("enabled") is True:
            files.update(render_package(root, catalog.data["name"], package))
    return files

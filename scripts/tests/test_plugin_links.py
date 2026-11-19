"""Roles and relative links in the generated projections must resolve."""

from __future__ import annotations

from io import BytesIO
from pathlib import Path, PurePosixPath
import re
import unittest
from urllib.parse import unquote
from zipfile import BadZipFile, ZipFile

from pluginlib.release import render_profiles


ROOT = Path(__file__).resolve().parents[2]
LINK = re.compile(r"(?<!!)\[[^\]\n]*\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
FENCE = re.compile(r"^(```|~~~).*?^\1[ \t]*$", re.S | re.M)
INLINE_CODE = re.compile(r"`[^`\n]*`")
ROLE = re.compile(r"Assign role `([^`]+)`")
SKIP = ("http://", "https://", "mailto:", "#", "<")


def relative_targets(text: str) -> list[str]:
    """Return the relative file targets of Markdown links outside code."""
    text = INLINE_CODE.sub("", FENCE.sub("", text))
    targets = []
    for raw in LINK.findall(text):
        if raw.startswith(SKIP) or re.match(r"[a-z][a-z0-9+.-]*:", raw):
            continue
        target = unquote(raw.split("#", 1)[0].split("?", 1)[0])
        if target:
            targets.append(target)
    return targets


def dead_in_tree(base: Path, files: list[Path]) -> list[str]:
    dead = []
    for file in files:
        for target in relative_targets(file.read_text(encoding="utf-8", errors="replace")):
            resolved = (file.parent / target).resolve()
            if not resolved.exists():
                dead.append(f"{file.relative_to(base)} -> {target}")
    return dead


def archive_members(data: bytes, prefix: str = "") -> dict[str, bytes]:
    """Flatten a ZIP, descending into nested ZIPs, to {path: content}."""
    members = {}
    with ZipFile(BytesIO(data)) as archive:
        for name in archive.namelist():
            if name.endswith("/"):
                continue
            content = archive.read(name)
            if name.endswith(".zip"):
                try:
                    members.update(archive_members(content, f"{prefix}{name}!/"))
                    continue
                except BadZipFile:
                    pass
            members[f"{prefix}{name}"] = content
    return members


def dead_in_members(members: dict[str, bytes]) -> list[str]:
    dead = []
    for name, content in members.items():
        if not name.endswith(".md"):
            continue
        scope, _, inner = name.rpartition("!/")
        parent = PurePosixPath(inner).parent
        for target in relative_targets(content.decode("utf-8", errors="replace")):
            joined = PurePosixPath(parent, target)
            parts: list[str] = []
            for part in joined.parts:
                if part == "..":
                    if parts:
                        parts.pop()
                    else:
                        parts = ["<outside>"]
                        break
                elif part != ".":
                    parts.append(part)
            candidate = f"{scope}!/" if scope else ""
            candidate += "/".join(parts)
            if candidate not in members and not any(m.startswith(candidate + "/") for m in members):
                dead.append(f"{name} -> {target}")
    return dead


class RoleTests(unittest.TestCase):
    def test_claude_roles_name_a_packaged_specialist(self) -> None:
        agents = {p.stem for p in (ROOT / "plugins/kodflow-specialists/agents").glob("*.md")}
        files = sorted(ROOT.glob("plugins/*/io.github.kodflow/projections/workflows/*-claude.md"))
        self.assertTrue(files, "no Claude workflow projection found")
        for file in files:
            roles = ROLE.findall(file.read_text(encoding="utf-8"))
            self.assertTrue(roles, f"{file} assigns no role")
            for role in roles:
                namespace, _, name = role.partition(":")
                self.assertEqual("kodflow-specialists", namespace, f"{file}: {role}")
                self.assertIn(name, agents, f"{file}: {role} has no agent file")

    def test_other_hosts_keep_bare_role_names(self) -> None:
        for file in ROOT.glob("plugins/*/io.github.kodflow/projections/workflows/*-openai.md"):
            for role in ROLE.findall(file.read_text(encoding="utf-8")):
                self.assertNotIn(":", role, str(file))


class LinkTests(unittest.TestCase):
    maxDiff = None

    def test_no_dead_relative_link_in_plugins(self) -> None:
        files = sorted(p for p in ROOT.glob("plugins/**/*.md") if p.is_file())
        self.assertEqual([], dead_in_tree(ROOT, files))

    def test_no_dead_relative_link_in_codex_skills(self) -> None:
        files = sorted(p for p in ROOT.glob("codex/skills/**/*.md") if p.is_file())
        self.assertTrue(files)
        self.assertEqual([], dead_in_tree(ROOT, files))

    def test_no_dead_relative_link_in_built_archives(self) -> None:
        dead = []
        for profile, data in render_profiles(ROOT, "a" * 40).items():
            if profile.endswith(".zip"):
                dead += [f"{profile}!/{d}" for d in dead_in_members(archive_members(data))]
        self.assertEqual([], dead)

    def test_detector_sees_a_dead_link(self) -> None:
        members = {"p.zip!/skills/a/SKILL.md": b"[x](../../gone.md) [y](b.md) `[z](nope.md)`",
                   "p.zip!/skills/a/b.md": b""}
        self.assertEqual(["p.zip!/skills/a/SKILL.md -> ../../gone.md"], dead_in_members(members))


if __name__ == "__main__":
    unittest.main()

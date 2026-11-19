"""Every script path a skill hands to the model must exist once rendered.

The check runs outside any model: the plugin-root tokens are substituted the
way each host does it, then every path rooted at the package is resolved
against the package on disk.

- Claude substitutes the exact tokens `${CLAUDE_PLUGIN_ROOT}` and
  `${CLAUDE_SKILL_DIR}` in skill content; nothing else.
- Codex substitutes nothing: its packages (codex/plugins/<name>) carry the
  install directory as a shell expression (pluginlib/codex_package.py), which
  is replaced here by the package directory it is a copy of.
"""

from __future__ import annotations

from pathlib import Path, PurePosixPath
import json
import re
import unittest

from pluginlib.codex_package import CODEX_PACKAGES, render_packages, root_expression
from pluginlib.model import Catalog


ROOT = Path(__file__).resolve().parents[2]
PATH_TAIL = re.compile(r"(/[\w.+-]+(?:/[\w.+-]+)*/?)")
TOKEN = re.compile(r"\$\{?CLAUDE_(?:PLUGIN_ROOT|SKILL_DIR)\b")
BARE = re.compile(r"\bCLAUDE_(?:PLUGIN_ROOT|SKILL_DIR)\b")


def _documents(package_root: Path) -> list[Path]:
    skills = package_root / "skills"
    return sorted(path for path in skills.rglob("*") if path.is_file() and path.suffix == ".md") if skills.is_dir() else []


def _rooted_paths(text: str, root: str) -> list[str]:
    """Paths that follow `root` once the quotes around the root are dropped."""
    found = []
    for line in text.splitlines():
        line = line.replace('"', "")
        start = 0
        while (index := line.find(root, start)) >= 0:
            start = index + len(root)
            match = PATH_TAIL.match(line, start)
            if match:
                found.append(match[1].rstrip(".").rstrip("/") or "/")
    return found


def _missing(text: str, marker: str, package: Path) -> list[str]:
    return [path for path in _rooted_paths(text, marker) if not (package / path.lstrip("/")).exists()]


class ClaudeScriptPathTests(unittest.TestCase):
    def test_every_rooted_path_in_claude_skills_exists(self) -> None:
        catalog = Catalog.load(ROOT / "catalog/catalog.json")
        marker = "\0ROOT\0"
        checked, failures = 0, []
        for package in catalog.packages():
            if package.target("claude").get("enabled") is not True:
                continue
            for document in _documents(package.root):
                relative = document.relative_to(package.root)
                text = document.read_text(encoding="utf-8")
                if len(relative.parts) > 2:
                    text = text.replace("${CLAUDE_SKILL_DIR}", f"{marker}/skills/{relative.parts[1]}")
                text = text.replace("${CLAUDE_PLUGIN_ROOT}", marker)
                checked += len(_rooted_paths(text, marker))
                failures += [f"{package.name}/{relative}: {path}" for path in _missing(text, marker, package.root)]
        self.assertGreater(checked, 50, "too few rooted paths found: the extraction is broken")
        self.assertEqual([], failures)


class CodexPackageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.catalog = Catalog.load(ROOT / "catalog/catalog.json")
        cls.packages = [
            package for package in cls.catalog.packages() if package.target("openai").get("enabled") is True
        ]

    def test_tracked_codex_packages_match_the_renderer(self) -> None:
        expected = render_packages(ROOT, self.catalog, self.catalog.packages())
        on_disk = {
            PurePosixPath(path.relative_to(ROOT).as_posix())
            for path in (ROOT / CODEX_PACKAGES).rglob("*") if path.is_file()
        }
        self.assertEqual(set(expected), on_disk)
        for relative, rendered in expected.items():
            path = ROOT / relative
            self.assertEqual(rendered.data, path.read_bytes(), relative)
            self.assertEqual(rendered.executable, bool(path.stat().st_mode & 0o111), relative)

    def test_marketplace_installs_the_codex_packages(self) -> None:
        index = json.loads((ROOT / ".agents/plugins/marketplace.json").read_text(encoding="utf-8"))
        self.assertEqual(
            {package.name: f"./{CODEX_PACKAGES / package.name}" for package in self.packages},
            {entry["name"]: entry["source"]["path"] for entry in index["plugins"]},
        )

    def test_every_rooted_path_in_codex_packages_exists(self) -> None:
        checked, failures = 0, []
        for package in self.packages:
            directory = ROOT / CODEX_PACKAGES / package.name
            manifest = json.loads((directory / "plugin.json").read_text(encoding="utf-8"))
            # Codex installs into <marketplace>/<name>/<version of this manifest>.
            expression = root_expression(self.catalog.data["name"], package.name, manifest["version"])
            for document in sorted(directory.rglob("*")):
                if not document.is_file() or document.relative_to(directory).parts[0] not in {"skills", "io.github.kodflow"}:
                    continue
                try:
                    text = document.read_text(encoding="utf-8")
                except UnicodeDecodeError:
                    continue
                checked += len(_rooted_paths(text, expression))
                failures += [
                    f"{package.name}/{document.relative_to(directory)}: {path}"
                    for path in _missing(text, expression, directory)
                ]
        self.assertGreater(checked, 50, "too few rooted paths found: the rewrite or the extraction is broken")
        self.assertEqual([], failures)

    def test_no_claude_root_outside_comments(self) -> None:
        failures = []
        for path in sorted((ROOT / CODEX_PACKAGES).rglob("*")):
            if not path.is_file():
                continue
            try:
                lines = path.read_text(encoding="utf-8").splitlines()
            except UnicodeDecodeError:
                continue
            for number, line in enumerate(lines, 1):
                if TOKEN.search(line):
                    failures.append(f"{path.relative_to(ROOT)}:{number}: {line.strip()}")
                    continue
                for match in BARE.finditer(line):
                    if "#" not in line[:match.start()]:
                        failures.append(f"{path.relative_to(ROOT)}:{number}: {line.strip()}")
        self.assertEqual([], failures)

    def test_every_skill_states_its_root(self) -> None:
        for package in self.packages:
            directory = ROOT / CODEX_PACKAGES / package.name
            version = json.loads((directory / "plugin.json").read_text(encoding="utf-8"))["version"]
            expression = root_expression(self.catalog.data["name"], package.name, version)
            for entry in sorted(directory.glob("skills/*/SKILL.md")):
                self.assertIn(f"rooted at `{expression}`", entry.read_text(encoding="utf-8"), entry)


if __name__ == "__main__":
    unittest.main()

#!/usr/bin/env python3
"""The marketplace canary's golden: what a Claude user loads, at a reference
commit, against a candidate tree.

  canary_golden.py write <commit> <golden.json>
  canary_golden.py check <golden.json> <deviations.json> <tree>

For every plugin of the marketplace, its agents (agents/*.md) and skills
(skills/*/SKILL.md) by name, each with the sha256 of its parsed frontmatter
(canonical JSON, so a re-wrapped YAML line is no change) and of its body. The
exact-token rewrite of #168 (`${CLAUDE_PLUGIN_ROOT:-$HOME/.claude}` became
`${CLAUDE_PLUGIN_ROOT}`) is applied before hashing, on both sides.

check fails on a plugin, agent or skill of the golden missing from the tree,
and on any hash that differs unless deviations.json names it with a reason.
A deviation that no longer differs fails too: the list stays exact. Names the
tree adds are reported, not refused. The deviations exist only here, for the
canary; nothing else reads them.
"""

from __future__ import annotations

from hashlib import sha256
import json
from pathlib import Path
import subprocess
import sys

import yaml

TOKEN = ("${CLAUDE_PLUGIN_ROOT:-$HOME/.claude}", "${CLAUDE_PLUGIN_ROOT}")


def digest(text: str) -> dict[str, str]:
    text = text.replace(*TOKEN)
    front, body = {}, text
    if text.startswith("---\n"):
        end = text.find("\n---\n", 4)
        if end != -1:
            front = yaml.safe_load(text[4:end]) or {}
            body = text[end + 5:]
    canonical = json.dumps(front, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return {"frontmatter": sha256(canonical.encode()).hexdigest(), "body": sha256(body.encode()).hexdigest()}


def surface(files: dict[str, str], plugins: list[str]) -> dict:
    out = {}
    for plugin in plugins:
        prefix = f"plugins/{plugin}/"
        agents, skills = {}, {}
        for path, text in files.items():
            if not path.startswith(prefix):
                continue
            parts = path[len(prefix):].split("/")
            if len(parts) == 2 and parts[0] == "agents" and parts[1].endswith(".md"):
                agents[parts[1][:-3]] = digest(text)
            elif len(parts) == 3 and parts[0] == "skills" and parts[2] == "SKILL.md":
                skills[parts[1]] = digest(text)
        out[plugin] = {"agents": dict(sorted(agents.items())), "skills": dict(sorted(skills.items()))}
    return out


def plugin_names(marketplace: dict) -> list[str]:
    return sorted(p["name"] for p in marketplace["plugins"]
                  if isinstance(p["source"], str) or p["source"].get("source") == "git-subdir")


def write(commit: str, output: Path) -> int:
    root = Path(__file__).resolve().parents[2]
    sha = subprocess.check_output(["git", "-C", str(root), "rev-parse", f"{commit}^{{commit}}"], text=True).strip()
    listed = subprocess.check_output(["git", "-C", str(root), "ls-tree", "-r", "--name-only", sha, "plugins"],
                                     text=True).splitlines()

    def show(path: str) -> str:
        return subprocess.check_output(["git", "-C", str(root), "show", f"{sha}:{path}"], text=True)

    files = {path: show(path) for path in listed
             if path.endswith("/SKILL.md") or "/agents/" in path}
    plugins = plugin_names(json.loads(show(".claude-plugin/marketplace.json")))
    golden = {"commit": sha, "plugins": surface(files, plugins)}
    output.write_text(json.dumps(golden, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"golden of {sha}: {len(plugins)} plugins")
    return 0


def check(golden_path: Path, deviations_path: Path, tree: Path) -> int:
    golden = json.loads(golden_path.read_text(encoding="utf-8"))
    deviations = json.loads(deviations_path.read_text(encoding="utf-8"))
    if deviations.get("from") != golden["commit"]:
        print(f"::error::deviations.json is for {deviations.get('from')}, the golden for {golden['commit']}")
        return 1
    allowed = {(d["plugin"], d["kind"], d["name"], d["part"]) for d in deviations["deviations"]}
    files = {path.relative_to(tree).as_posix(): path.read_text(encoding="utf-8")
             for path in (tree / "plugins").rglob("*.md")}
    current = surface(files, sorted(golden["plugins"]))
    bad, seen, added = [], set(), []
    for plugin, kinds in golden["plugins"].items():
        if not (tree / "plugins" / plugin).is_dir():
            bad.append(f"plugin {plugin} is gone")
            continue
        for kind, entries in kinds.items():
            for name, parts in entries.items():
                now = current[plugin][kind].get(name)
                if now is None:
                    bad.append(f"{plugin} {kind[:-1]} {name} is gone")
                    continue
                for part, value in parts.items():
                    if now[part] == value:
                        continue
                    key = (plugin, kind, name, part)
                    if key in allowed:
                        seen.add(key)
                    else:
                        bad.append(f"{plugin} {kind[:-1]} {name}: {part} differs from {golden['commit'][:12]}")
            added += [f"{plugin} {kind[:-1]} {name}" for name in sorted(set(current[plugin][kind]) - set(entries))]
    bad += [f"deviation listed but absent: {' '.join(key)}" for key in sorted(allowed - seen)]
    for item in added:
        print(f"new since the golden: {item}")
    for item in bad:
        print(f"::error::canary golden: {item}")
    if not bad:
        print(f"canary golden: the tree loads what {golden['commit'][:12]} loaded, "
              f"{len(seen)} listed deviation(s) and nothing else")
    return 1 if bad else 0


def main() -> int:
    args = sys.argv[1:]
    if len(args) == 3 and args[0] == "write":
        return write(args[1], Path(args[2]))
    if len(args) == 4 and args[0] == "check":
        return check(Path(args[1]), Path(args[2]), Path(args[3]))
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())

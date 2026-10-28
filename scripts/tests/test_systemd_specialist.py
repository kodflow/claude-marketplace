#!/usr/bin/env python3
"""The systemd specialist keeps the evidence contract issue #106 gave it.

Its first version of the job went to a haiku/low router that judged directives
from WebFetch summaries, and disputed one that exists. The agent is only worth
routing to while its body holds the rules that prevent that: the raw-page curl
scope, the WebFetch rule, the version rule, the scratch-only writes and the
never-execute rule. Each is asserted in the agent and in its generated Codex
copy, since neutralise() rewrites the body on the way there. The routing split
itself is asserted too: systemd semantics on this agent, the host on the Linux
router, never the same keyword on both.
"""
import pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
AGENT = ROOT / "plugins/kodflow-specialists/agents/domain-specialist-systemd.md"
LINUX = ROOT / "plugins/kodflow-specialists/agents/devops-executor-linux.md"
TOML = ROOT / "codex/agents/domain-specialist-systemd.toml"
INDEX = ROOT / "plugins/kodflow-hooks/hooks/routing-index.tsv"
SYD = "kodflow-specialists:domain-specialist-systemd"
LNX = "kodflow-specialists:devops-executor-linux"
fails = 0


def check(name, ok, detail=""):
    global fails
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f" - {detail}"))
    fails += 0 if ok else 1


RULES = {
    "the freedesktop.org curl scope": "`Bash(curl -fsSL https://www.freedesktop.org/software/systemd/man/*)`",
    "the WebFetch-summary rule": "A WebFetch result is a summary, never proof that a directive exists or does not exist.",
    "the directives(7) locating rule": "systemd.directives.html",
    "the latest/pinned version rule": "not documented in systemd <version>",
    "the release recorded from the page header": "record the release its page header shows",
    "the scratch-only write rule": "Write only under the scratch directory the brief names",
    "the no-scratch rule": "When the brief names no scratch directory, write nothing to disk",
    "the never-execute rule": "never execute it, source it, or pipe it into a shell or an interpreter",
    "the Exec prefix table": "Special executable prefixes",
    "a checksum in consulted": "sha256",
}

fm, _, body = AGENT.read_text().partition("\n---\n")
check("model is opus", "\nmodel: opus\n" in fm + "\n")
check("effort is high", "\neffort: high\n" in fm + "\n")
tools = next((l for l in fm.splitlines() if l.startswith("tools:")), "")
check("no Edit or Write tool: downloads go through the curl scope", "Edit" not in tools and "Write" not in tools, tools)
for name, text in RULES.items():
    check(f"agent carries {name}", text in body)

# Every grep or sed form the checks prescribe must be one the Command scope
# grants, or an agent that keeps to its scope cannot run its own checks.
scope = body.split("## Command scope", 1)[-1].split("\n## ", 1)[0]
rest = body.replace(scope, "")
forms = sorted(set(re.findall(r"`((?:grep|sed)(?: -[A-Za-z]+)+)", rest)))
check("the checks prescribe grep and sed forms", len(forms) >= 3, forms)
for form in forms:
    check(f"the Command scope grants `{form}`", f"`{form}" in scope)

if TOML.is_file():
    gen = TOML.read_text()
    for name, text in RULES.items():
        check(f"codex copy carries {name}", text in gen)
else:
    check("codex copy exists", False, f"no {TOML.relative_to(ROOT)} - run scripts/build-codex.py")

check("the Linux router hands systemd semantics back", "`domain-specialist-systemd`" in LINUX.read_text())

rows = [l.split("\t") for l in INDEX.read_text().splitlines()[1:]]
owners = {}
for kw, _, agent in rows:
    owners.setdefault(kw, set()).add(agent)
for kw in ("systemd", "sd_notify", ".service", ".socket", ".timer"):
    check(f"{kw} routes to the systemd specialist alone", owners.get(kw) == {SYD}, owners.get(kw))
for kw in ("systemctl", "journald"):
    check(f"{kw} routes to the Linux router alone", owners.get(kw) == {LNX}, owners.get(kw))

sys.exit(1 if fails else 0)

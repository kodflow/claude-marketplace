#!/usr/bin/env python3
"""What this marketplace costs a session before it has done any work.

Five checks, none about correctness: an agent with no `model` pinned runs at
whatever the user set their session to — `xhigh` included — on every spawn; a
description is loaded into every session whether the skill is used or not; a
memory block copied out of the harness is paid for twice; a bare cross-plugin
reference silently resolves to a same-named user-local copy.

All findings are warnings. CI must not turn red the day this lands, or the
check becomes noise people route around. Opt in per check once the tree is
clean for it:

    python3 scripts/check-context-cost.py [root]
    COST_CHECKS_STRICT=model_effort,skill_size python3 scripts/check-context-cost.py .
    COST_CHECKS_STRICT=all python3 scripts/check-context-cost.py .
"""
import os, pathlib, re, sys

CHECKS = ("model_effort", "description_budget", "skill_size", "memory_block", "plugin_prefix")

DESCRIPTION_BUDGET = 350
SKILL_SIZE_BUDGET = 20_000

# The harness injects its own persistent-memory instructions into every
# session. A file that repeats them pays for the same paragraph twice, so the
# marker is the wording rather than an exact string — the harness rephrases it
# between versions and a literal would stop matching without anyone noticing.
MEMORY_BLOCK = re.compile(r"persistent,?\s+file-based memory|file-based memory (?:system|at)", re.I)

# path relative to the root -> "YYYY-MM-DD: why, and whether a reduction is planned".
# The date is the point: an exemption with no date is permanent wearing a
# temporary face. An entry that is stale — file gone, or already under budget —
# is itself a finding, so the list cannot outlive the reasons in it.
SKILL_SIZE_ALLOWLIST: dict[str, str] = {}

ALLOWLIST_REASON = re.compile(r"^\d{4}-\d{2}-\d{2}: \S")

FRONTMATTER = re.compile(r"\A---\n(.*?)\n---\n", re.DOTALL)
INLINE_CODE = re.compile(r"`([^`\n]+)`")
IDENT = re.compile(r"^/?([a-z0-9][a-z0-9-]*)$")
PREFIXED = re.compile(r"^/?([a-z0-9][a-z0-9-]*):([a-z0-9][a-z0-9-]*)$")


def frontmatter(text):
    m = FRONTMATTER.match(text)
    return m.group(1) if m else ""


def scalar(fm, key):
    """Read one top-level frontmatter scalar, wrapped lines included.

    Not YAML — this script stays dependency-free so it can run before anything
    is installed. It only has to be right about the wrapping: descriptions in
    this tree routinely continue on indented lines, and reading the first line
    alone measures a 90-character budget against a 900-character description.

    Returns None when the key is absent, which is a different fact from "".
    """
    out, collecting = None, False
    for line in fm.split("\n"):
        if collecting:
            if line[:1] in (" ", "\t"):
                out.append(line.strip())
                continue
            break
        if m := re.match(rf"^{re.escape(key)}:(.*)$", line):
            out, collecting = [m.group(1).strip()], True
    if out is None:
        return None
    value = " ".join(p for p in out if p).strip()
    if value[:1] in ("|", ">"):           # block scalar: the indicator is not content
        value = value[1:].lstrip("-+ ").strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
        value = value[1:-1]
    return value


def pinned(fm, key):
    return re.search(rf"^{re.escape(key)}:\s*\S", fm, re.M) is not None


def code_tokens(text):
    """Yield the backticked tokens that can be a skill or an agent reference.

    Backticks are this tree's convention for naming one, and scoping to them is
    what keeps `commit`, `update` and `fix` in prose out of the results. Two
    shapes inside them count: a span that is nothing but the name
    (`developer-specialist-go`) and a slash invocation (`/plan`, `/review --loop`).
    A name sitting among other words is a shell command — `git bisect` and
    `make lint` do not reference the `git` and `lint` skills, and counting them
    buried the thirty real findings under a hundred that were not.
    """
    for m in INLINE_CODE.finditer(text):
        span = m.group(1).strip()
        for t in re.finditer(r"\S+", span):
            token = t.group(0).strip(".,;:!?()[]{}\"'")
            if token.startswith("/") or token == span:
                yield token


def collect(root):
    """Inventory the catalogue: agent files, skill files, and name -> owning plugins."""
    agents, skills, owners = [], [], {}
    for plugin in sorted((root / "plugins").glob("*/")):
        pname = plugin.name
        for f in sorted(plugin.glob("agents/*.md")):
            agents.append((pname, f))
            owners.setdefault(f.stem, set()).add(pname)
        for f in sorted(plugin.glob("skills/*/SKILL.md")):
            skills.append((pname, f))
            owners.setdefault(f.parent.name, set()).add(pname)
    return agents, skills, owners


def check(root):
    """Return (findings, agent count, skill count). Pure: no printing, no exit."""
    root = pathlib.Path(root)
    found, agents, skills, owners = [], *collect(root)

    def add(name, path, msg):
        found.append((name, str(path.relative_to(root)), msg))

    for kind, files in (("agents", agents), ("skills", skills)):
        for _, f in files:
            text = f.read_text()
            fm = frontmatter(text)
            if kind == "agents" and not (pinned(fm, "model") and pinned(fm, "effort")):
                missing = [k for k in ("model", "effort") if not pinned(fm, k)]
                add("model_effort", f, f"no {' and no '.join(missing)} pinned — inherits the "
                                       f"session's setting, at the session's price, on every spawn")
            desc = scalar(fm, "description")
            if desc is None:
                add("description_budget", f, "no description: in the frontmatter")
            else:
                if len(desc) > DESCRIPTION_BUDGET:
                    add("description_budget", f,
                        f"description is {len(desc)} characters (budget {DESCRIPTION_BUDGET}), "
                        f"and every session loads it whether the skill runs or not")
                if "<example>" in desc:
                    add("description_budget", f, "description carries an <example> block")
            if MEMORY_BLOCK.search(text):
                add("memory_block", f, "repeats the harness's persistent-memory instructions, "
                                       "which the harness already injects")

    for _, f in skills:
        rel = str(f.relative_to(root))
        size = len(f.read_text())
        if size > SKILL_SIZE_BUDGET and rel not in SKILL_SIZE_ALLOWLIST:
            add("skill_size", f, f"{size} characters (budget {SKILL_SIZE_BUDGET})")

    for rel, reason in sorted(SKILL_SIZE_ALLOWLIST.items()):
        path = root / rel
        if not ALLOWLIST_REASON.match(reason):
            found.append(("skill_size", rel, "allowlisted without a 'YYYY-MM-DD: reason' entry"))
        elif not path.is_file():
            found.append(("skill_size", rel, "allowlisted but the file is gone"))
        elif len(path.read_text()) <= SKILL_SIZE_BUDGET:
            found.append(("skill_size", rel, "allowlisted but already under budget — drop the entry"))

    # A bare `debug` in a kodflow-workflow skill resolves to whatever `debug`
    # the user happens to have installed, which is how a session silently runs
    # someone else's skill. Only the owning plugin may write the name bare.
    for pname, f in skills:
        text, seen = f.read_text(), set()
        for token in code_tokens(text):
            if m := PREFIXED.match(token):
                prefix, name = m.groups()
                if name in owners and prefix not in owners[name] and token not in seen:
                    seen.add(token)
                    add("plugin_prefix", f, f"`{token}` names {name}, owned by "
                                            f"{'/'.join(sorted(owners[name]))}, not {prefix}")
                continue
            if not (m := IDENT.match(token)):
                continue
            name = m.group(1)
            if name not in owners or pname in owners[name] or token in seen:
                continue
            seen.add(token)
            owner = sorted(owners[name])[0]
            add("plugin_prefix", f, f"`{token}` is bare — {name} belongs to "
                                    f"{'/'.join(sorted(owners[name]))}, write `{owner}:{name}`")

    return found, len(agents), len(skills)


def main(root="."):
    strict = {c.strip() for c in os.environ.get("COST_CHECKS_STRICT", "").split(",") if c.strip()}
    if unknown := sorted(strict - set(CHECKS) - {"all"}):
        sys.exit(f"COST_CHECKS_STRICT: unknown check(s) {unknown}, known: {list(CHECKS)} or 'all'")
    hard = set(CHECKS) if "all" in strict else strict

    found, n_a, n_s = check(root)
    print(f"context cost: {n_a} agents · {n_s} skills checked")
    for name in CHECKS:
        hits = [(p, m) for c, p, m in found if c == name]
        if not hits:
            continue
        print(f"  [{'FAIL' if name in hard else 'warn'}] {name}: {len(hits)}")
        for p, m in hits:
            print(f"    {p}: {m}")
    if blocking := [c for c, _, _ in found if c in hard]:
        print(f"CONTEXT COST CHECKS FAILED ({len(blocking)} finding(s) in {sorted(hard)})")
        return 1
    print(f"{len(found)} warning(s)" if found else "no findings")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "."))

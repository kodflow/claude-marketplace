#!/usr/bin/env python3
"""Compile the allocation of model-policy.md section 2 into the tier table.

The hooks inject this table into the orchestrator (SessionStart) and into every
sub-agent that can delegate (SubagentStart), so that each dispatch names its
model and effort instead of inheriting them. It runs in bash 3.2, without
Python, so it reads a flat file rather than the Markdown: the Markdown stays the
one place a human edits, this script is the only writer, and CI checks that
they agree.

Two committed copies, on purpose:

    plugins/kodflow-hooks/hooks/tier-table.tsv                    read by the hooks
    plugins/kodflow-workflow/skills/_shared/tier-table.tsv        read by the skills

The double copy is a deliberate exception to the single-source rule: a plugin
cannot read another plugin's files, and the hooks must be able to compare their
copy with the one the skills ship. The _shared copy is mirrored into
kodflow-devops and kodflow-review by the existing _shared mechanism (CI runs
`diff -r` on it). The header line of both copies is the sha256 of the bytes of
the whole canonical model-policy.md, which is what the SessionStart skew check
compares.

File format: line 1 `# sha256 <hex>`; then the fixed preamble, every line
`# `-prefixed; then one row per line, tab-separated: kind, role, model, effort.
kind is role | exempt | fork | mode. A role row has a model in
{sonnet, opus, haiku} and an effort in {low, medium, high, xhigh, max}.
`-` means "no value claimed by the policy". It is allowed only in exempt, fork
and mode rows, and in the model cell of the Orchestrator role row (the main
session, not delegated: the hooks render it so). Every other cell is in the
closed vocabulary. A mode row exempts a permission mode from the tier (`plan`).

    python3 scripts/build-tier-table.py [root]           write both copies
    python3 scripts/build-tier-table.py --check [root]   exit 1 when stale

Exit 1 as well when the policy has no allocation table, a required role is
missing, or a cell is outside the closed vocabulary.
"""
import hashlib, pathlib, re, sys

SOURCE = "plugins/kodflow-workflow/skills/_shared/model-policy.md"
OUTPUTS = (
    "plugins/kodflow-hooks/hooks/tier-table.tsv",
    "plugins/kodflow-workflow/skills/_shared/tier-table.tsv",
)
MODELS = {"sonnet", "opus", "haiku"}
EFFORTS = {"low", "medium", "high", "xhigh", "max"}
# What section 2 must contain; a policy edit that drops one is a fault here,
# not a silent hole in what the hooks tell the model.
REQUIRED_ROLES = [
    "Orchestrator",
    "Code worker, well specified",
    "Code worker, defect in existing code",
    "Code worker, several modules, concurrency or a protocol",
    "Review / verify worker",
    "Correctness and security executors",
    "Autonomous run over 30 minutes",
    "Mechanical worker",
    "Bulk / triage worker",
]
REQUIRED_EXEMPT = ["claude-code-guide", "statusline-setup", "web-fetch"]
PREAMBLE = [
    "Model and effort of every delegation (Agent call or Workflow agent()).",
    "This table is the instruction that explicitly asks for an effort: pass on the call the model and the effort of the row that matches the role, unless the agent definition pins them.",
    "For agent() in a Workflow, this rule replaces the built-in guidance to omit model and effort.",
    "`-` means no value claimed by the policy; it appears only in exempt, fork and mode rows and in the model of the Orchestrator row.",
]


def cells(line):
    return [c.strip() for c in line.strip().strip("|").split("|")]


def clean(s):
    return re.sub(r"[`*]", "", s).strip()


def tables(section):
    """Yield each Markdown table of the section as a list of cell lists."""
    cur = []
    for line in section.splitlines() + [""]:
        if line.startswith("|"):
            c = cells(line)
            if set("".join(c)) <= set("-: "):
                continue
            cur.append(c)
        elif cur:
            yield cur
            cur = []


def section2(text):
    m = re.search(r"^## 2\..*$", text, re.M)
    if not m:
        raise ValueError("model-policy.md has no section 2")
    n = re.search(r"^## 3\.", text[m.end():], re.M)
    return text[m.end():m.end() + n.start()] if n else text[m.end():]


def build(root):
    root = pathlib.Path(root)
    src = root / SOURCE
    if not src.is_file():
        raise ValueError(f"{SOURCE} is missing")
    raw = src.read_bytes()
    sec = section2(raw.decode())
    faults, rows = [], []

    alloc = next((t for t in tables(sec) if t[0][:3] == ["Role", "Model", "Effort"]), None)
    if alloc is not None and len(alloc[0]) != 4:
        raise ValueError(f"allocation table has {len(alloc[0])} columns, expected 4 (Role, Model, Effort, Why)")
    if alloc is None:
        raise ValueError("section 2 has no Role | Model | Effort table")
    seen = set()
    for c in alloc[1:]:
        if len(c) != 4:
            faults.append(f"allocation row without four cells: {c}")
            continue
        role = re.sub(r"\s*\(.*$", "", clean(c[0])) if clean(c[0]).startswith("Orchestrator") else clean(c[0])
        model, effort = clean(c[1]).lower(), clean(c[2]).lower()
        seen.add(role)
        if role == "Orchestrator":
            if effort not in EFFORTS:
                faults.append(f"{role}: effort {effort!r} outside {sorted(EFFORTS)}")
            rows.append(("role", role, "-", effort))
            continue
        if model not in MODELS:
            faults.append(f"{role}: model {model!r} outside {sorted(MODELS)}")
        if effort not in EFFORTS:
            faults.append(f"{role}: effort {effort!r} outside {sorted(EFFORTS)}")
        rows.append(("role", role, model, effort))
    for r in REQUIRED_ROLES:
        if r not in seen:
            faults.append(f"role missing from section 2: {r}")

    exempt = next((t for t in tables(sec) if t[0][:2] == ["Agent", "Status"]), None)
    got = set()
    for c in (exempt or [[]])[1:]:
        name = clean(c[0])
        status = clean(c[1]).lower()
        model = next((m for m in ("haiku", "sonnet", "opus") if status.startswith(m)), "-")
        got.add(name)
        rows.append(("exempt", name, model, "-"))
    for n in REQUIRED_EXEMPT:
        if n not in got:
            faults.append(f"exemption missing from section 2: {n}")

    if re.search(r"^A \*\*fork\*\*", sec, re.M):
        rows.append(("fork", "fork", "-", "-"))
        rows.append(("mode", "plan", "-", "-"))
    else:
        faults.append("the fork paragraph is missing from section 2")

    for kind, role, model, effort in rows:
        for cell in (role, model, effort):
            if "\t" in cell or "\n" in cell or not cell:
                faults.append(f"{role}: empty cell or control character")
    if faults:
        raise ValueError("\n".join(faults))
    head = "# sha256 " + hashlib.sha256(raw).hexdigest()
    body = ["# " + p for p in PREAMBLE] + ["\t".join(r) for r in rows]
    return head + "\n" + "\n".join(body) + "\n"


def main(argv):
    check = "--check" in argv
    args = [a for a in argv if a != "--check"]
    root = pathlib.Path(args[0] if args else ".")
    try:
        want = build(root)
    except ValueError as e:
        print(f"tier table: {e}", file=sys.stderr)
        return 1
    stale = [o for o in OUTPUTS if not (root / o).is_file() or (root / o).read_text() != want]
    if check:
        if not stale:
            print("tier table up to date")
            return 0
        print(f"{', '.join(stale)} stale: run python3 scripts/build-tier-table.py", file=sys.stderr)
        return 1
    for o in OUTPUTS:
        (root / o).parent.mkdir(parents=True, exist_ok=True)
        (root / o).write_text(want)
    print(f"wrote {len(OUTPUTS)} copies ({want.count(chr(10)) - 1 - len(PREAMBLE)} rows)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

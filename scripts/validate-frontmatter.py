#!/usr/bin/env python3
"""Validate every skill and agent against the documented frontmatter schemas.

The two schemas are close enough to confuse and different enough to matter:
agents take `tools` and `disallowedTools`, skills take `allowed-tools` and
`disallowed-tools`. A key on the wrong side is accepted by the file and ignored
by the loader, so the file documents behaviour it does not have — which is the
failure this check exists to catch, and the reason it is not merely cosmetic.

It also holds the model policy's two mechanical rules: a `model` the loader
knows and an `effort` among the five levels, on agents and skills alike, and
no agent pinned to a gated model (_shared/gated-models.txt, model-policy.md
§6). The gated list is read from the canonical copy; without it nothing can
be judged, so its absence fails the run rather than passing everything.

And it holds one capability rule (#105): an agent whose `## Command scope`
grants a Go or Cargo test runner and sends that work to "the scratch
directory" must be able to write there. Without `Write` the reproduction it
promises cannot be created, and every behavioural claim it makes stays
unverified. The same holds for an agent with a `## Report file` section: it
is told to write its findings to a file, so it needs `Write` too. An absent
`tools` key inherits every tool; `disallowedTools` removes `Write` whatever
`tools` says.
"""
import pathlib, re, sys, yaml

AGENT_KEYS = {"name","description","tools","disallowedTools","model","permissionMode",
              "maxTurns","skills","mcpServers","hooks","memory","background","effort",
              "isolation","color","initialPrompt","experimental"}
SKILL_KEYS = {"name","description","when_to_use","argument-hint","arguments",
              "disable-model-invocation","user-invocable","allowed-tools",
              "disallowed-tools","model","effort","context","agent","background",
              "hooks","paths","shell","metadata","license","compatibility"}
MODELS = {"sonnet","opus","haiku","fable","inherit"}
EFFORTS = {"low","medium","high","xhigh","max"}
GATED = "plugins/kodflow-workflow/skills/_shared/gated-models.txt"

def gated_tokens(root):
    path = root / GATED
    if not path.is_file():
        return None
    tokens = ("".join(l.split("#", 1)[0].split()).lower() for l in path.read_text().splitlines())
    return [t for t in tokens if t]

def model_fault(rel, m):
    if m is not None and m not in MODELS and not str(m).startswith("claude-"):
        return f"{rel}: unknown model {m!r}"

def effort_fault(rel, e):
    if e is not None and str(e) not in EFFORTS:
        return f"{rel}: effort {e!r} is not one of {sorted(EFFORTS)}"

# Test-runner grants that, next to "scratch directory", promise a reproduction
# the agent must write before it can run: the broad `Bash(go:*)` and
# `Bash(cargo:*)`, and `go test` / `cargo test` with or without narrowing
# flags (`Bash(go test -race:*)`). Matched backticked.
SCRATCH_RUNNER = re.compile(r"`Bash\((?:go|cargo)(?::\*| test(?: [^`]*)?:\*)\)`")

def command_scope(body):
    """The `## Command scope` section, up to the next `## ` heading, or ''."""
    m = re.search(r"^## Command scope[ \t]*\n(.*?)(?=^## |\Z)", body, re.M | re.S)
    return m.group(1) if m else ""

def tool_tokens(v):
    """Exact tool names of a `tools`/`disallowedTools` value: a comma-separated
    string, or a YAML list (`disallowedTools: [Write]`), whose entries may
    themselves be comma-separated. A specifier is dropped: `Write(/repo/**)`
    names the Write tool, and in disallowedTools a specifier removes the whole
    tool."""
    if v is None:
        return set()
    items = v if isinstance(v, list) else [v]
    return {x.split("(", 1)[0].strip() for i in items for x in str(i).split(",") if x.strip()}

def write_fault(rel, fm, why):
    """The fault when `why` needs Write and the frontmatter does not give it."""
    if "Write" in tool_tokens(fm.get("disallowedTools")):
        return f"{rel}: {why} but disallowedTools removes Write"
    if "tools" in fm and "Write" not in tool_tokens(fm.get("tools")):
        return f"{rel}: {why} but tools lack Write"
    return None

def scratch_write_fault(rel, fm, body):
    scope = command_scope(body)
    runs = "scratch directory" in scope and SCRATCH_RUNNER.search(scope)
    if runs and (bad := write_fault(rel, fm, "Command scope runs tests under the scratch directory")):
        return bad
    # A `## Report file…` section tells the agent to write its findings to a
    # file the caller reads back; without Write the caller only ever finds
    # no file, which it must read as an incomplete pass.
    if re.search(r"^## Report file\b", body, re.M):
        return write_fault(rel, fm, "a Report file section asks for a report file")
    return None

def frontmatter(p):
    raw = p.read_text()
    if not raw.startswith("---\n"):
        return None, raw, "no frontmatter"
    end = raw.find("\n---\n", 4)
    if end == -1:
        return None, raw, "unterminated frontmatter"
    try:
        return yaml.safe_load(raw[4:end+1]) or {}, raw[end+5:], None
    except Exception as e:
        return None, raw, f"YAML error: {e}"

def main(root):
    root = pathlib.Path(root)
    faults, n_a, n_s = [], 0, 0
    gated = gated_tokens(root)
    if gated is None:
        faults.append(f"{GATED}: missing — the gated models cannot be checked")
        gated = []

    for f in sorted(root.rglob("agents/*.md")):
        fm, body, err = frontmatter(f)
        if err: faults.append(f"{f}: {err}"); continue
        n_a += 1
        rel = f.relative_to(root)
        if bad := sorted(set(fm) - AGENT_KEYS): faults.append(f"{rel}: invalid agent keys {bad}")
        if not fm.get("name"): faults.append(f"{rel}: missing name")
        elif not re.fullmatch(r"[a-z0-9-]+", str(fm["name"])): faults.append(f"{rel}: name must be lowercase-with-hyphens")
        if not fm.get("description"): faults.append(f"{rel}: missing description")
        if isinstance(fm.get("tools"), list): faults.append(f"{rel}: tools must be a comma-separated string")
        m = fm.get("model")
        if bad := model_fault(rel, m): faults.append(bad)
        if bad := effort_fault(rel, fm.get("effort")): faults.append(bad)
        if m is not None and any(t in str(m).lower() for t in gated):
            faults.append(f"{rel}: pins the gated model {m!r} — no agent may (model-policy.md §6)")
        if not isinstance(fm.get("tools"), list) and (bad := scratch_write_fault(rel, fm, body)):
            faults.append(bad)

    for f in sorted(root.rglob("skills/*/SKILL.md")):
        fm, body, err = frontmatter(f)
        if err: faults.append(f"{f}: {err}"); continue
        n_s += 1
        rel = f.relative_to(root)
        if bad := sorted(set(fm) - SKILL_KEYS): faults.append(f"{rel}: invalid skill keys {bad}")
        if bad := model_fault(rel, fm.get("model")): faults.append(bad)
        if bad := effort_fault(rel, fm.get("effort")): faults.append(bad)
        tot = len(" ".join(str(fm.get("description","")).split())) + \
              len(" ".join(str(fm.get("when_to_use","")).split()))
        if tot > 1536: faults.append(f"{rel}: description+when_to_use {tot} > 1536")
        if body.count("\n") > 500: faults.append(f"{rel}: {body.count(chr(10))} lines > 500 guidance")
        # every referenced module must exist beside it
        for m in re.finditer(r"`([A-Za-z0-9_.][A-Za-z0-9_./-]*\.md)`", body):
            ref = m.group(1)
            if ref.startswith(("/", "~")) or "NNNN" in ref or ref in ("CLAUDE.md","README.md","INDEX.md"):
                continue
            # A bare name is a sibling module; `../x/y.md` is a module in the
            # same plugin. Both must exist — a plugin is installed on its own,
            # so `../_shared/team-mode.md` pointing at another plugin is broken
            # for every consumer. Deeper project-relative paths (`docs/adr/…`)
            # are examples about the target project and are not checked.
            if "/" in ref and not ref.startswith("../"):
                continue
            if not (f.parent / ref).exists():
                faults.append(f"{rel}: module link `{ref}` does not resolve")

    print(f"{n_a} agents · {n_s} skills checked")
    if faults:
        print("FRONTMATTER VALIDATION FAILED")
        for x in faults: print("  " + x)
        return 1
    print("frontmatter valid")
    return 0

if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "."))

#!/usr/bin/env python3
"""Validate every skill and agent against the documented frontmatter schemas.

The two schemas are close enough to confuse and different enough to matter:
agents take `tools` and `disallowedTools`, skills take `allowed-tools` and
`disallowed-tools`. A key on the wrong side is accepted by the file and ignored
by the loader, so the file documents behaviour it does not have — which is the
failure this check exists to catch, and the reason it is not merely cosmetic.
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

    for f in sorted(root.rglob("agents/*.md")):
        fm, _, err = frontmatter(f)
        if err: faults.append(f"{f}: {err}"); continue
        n_a += 1
        rel = f.relative_to(root)
        if bad := sorted(set(fm) - AGENT_KEYS): faults.append(f"{rel}: invalid agent keys {bad}")
        if not fm.get("name"): faults.append(f"{rel}: missing name")
        elif not re.fullmatch(r"[a-z0-9-]+", str(fm["name"])): faults.append(f"{rel}: name must be lowercase-with-hyphens")
        if not fm.get("description"): faults.append(f"{rel}: missing description")
        if isinstance(fm.get("tools"), list): faults.append(f"{rel}: tools must be a comma-separated string")
        m = fm.get("model")
        if m is not None and m not in MODELS and not str(m).startswith("claude-"):
            faults.append(f"{rel}: unknown model {m!r}")

    for f in sorted(root.rglob("skills/*/SKILL.md")):
        fm, body, err = frontmatter(f)
        if err: faults.append(f"{f}: {err}"); continue
        n_s += 1
        rel = f.relative_to(root)
        if bad := sorted(set(fm) - SKILL_KEYS): faults.append(f"{rel}: invalid skill keys {bad}")
        tot = len(" ".join(str(fm.get("description","")).split())) + \
              len(" ".join(str(fm.get("when_to_use","")).split()))
        if tot > 1536: faults.append(f"{rel}: description+when_to_use {tot} > 1536")
        if body.count("\n") > 500: faults.append(f"{rel}: {body.count(chr(10))} lines > 500 guidance")
        # every referenced module must exist beside it
        for m in re.finditer(r"`([A-Za-z0-9_][A-Za-z0-9_./-]*\.md)`", body):
            ref = m.group(1)
            if ref.startswith(("/", "~")) or "NNNN" in ref or ref in ("CLAUDE.md","README.md","INDEX.md"):
                continue
            if not (f.parent / ref).exists() and "/" not in ref:
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

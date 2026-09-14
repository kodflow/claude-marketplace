#!/usr/bin/env bash
# Transpose the provider-neutral skills from ~/.claude/skills to ~/.codex/skills.
#
# The two formats are close: both are <name>/SKILL.md with YAML frontmatter and
# optional scripts/ references/ assets/. Codex's frontmatter is a SUBSET —
# name, description, metadata — so the Claude-only keys are folded or dropped
# rather than carried over, where they would be dead weight at best.
#
# Re-runnable. Prints what it changed. --check reports drift without writing.
set -uo pipefail

SRC="${HOME}/.claude/skills"
DST="${HOME}/.codex/skills"
CHECK=0
[ "${1:-}" = "--check" ] && CHECK=1

# Only skills with no Claude-specific binding. The rest stay Claude-side until
# their provider-specific parts are abstracted — porting them as-is would ship
# instructions naming tools Codex does not have.
# _shared carries the routing table and the model policy that the transposed
# skills reference by relative path. Omitting it left ../_shared/specialists.md
# dangling on the Codex side — the skill loaded and pointed at nothing.
SKILLS="_shared challenge project"

command -v python3 >/dev/null 2>&1 || { echo "python3 required" >&2; exit 2; }
[ -d "$SRC" ] || { echo "no source skills at $SRC" >&2; exit 2; }

python3 - "$SRC" "$DST" "$CHECK" "$SKILLS" <<'PY'
import pathlib, re, shutil, sys, yaml

src, dst, check, names = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]), sys.argv[3] == "1", sys.argv[4].split()
changed, skipped = [], []

# Claude tool and skill references that mean nothing on the Codex side.
NEUTRALISE = [
    (r"`Agent\(\*\)`|a subagent", "a subagent"),
    (r"`Skill\(skill=\"([a-z-]+)\"[^)]*\)`", r"the `/\1` skill"),
    (r"the library-documentation tool\s*then\s*the library-documentation tool",
     "the library-documentation tool available to you"),
    (r"`mcp__context7__[a-z_-]+`", "the library-documentation tool"),
    (r"`mcp__github__[a-z_*]+`", "the GitHub tool"),
    (r"`mcp__gitlab__[a-z_*]+`", "the GitLab tool"),
    (r"a multiple-choice question to the user", "a multiple-choice question to the user"),
    (r"~/\.claude/skills/", "~/.codex/skills/"),
]

for name in names:
    s = src / name
    d = dst / name
    if (s / "SKILL.md").exists():
        raw = (s / "SKILL.md").read_text()
        end = raw.find("\n---\n", 4)
        fm = yaml.safe_load(raw[4:end + 1]) or {}
        body = raw[end + 5:]
    else:
        fm, body = {}, ""   # a shared module directory: files only, no entrypoint

    # Codex frontmatter is name + description + metadata. when_to_use has no
    # equivalent field, so it is folded into the description rather than lost —
    # it is the half that drives invocation.
    desc = " ".join(str(fm.get("description", "")).split())
    wtu = " ".join(str(fm.get("when_to_use", "")).split())
    if wtu:
        # when_to_use already starts with "Use ..."; folding it behind another
        # "Use it when:" produced "Use it when: Use once a plan exists".
        wtu = re.sub(r"^Use\s+", "", wtu)
        desc = f"{desc} Use when {wtu}"
    out = {"name": fm.get("name", name), "description": desc}
    meta = dict(fm.get("metadata") or {})
    meta["short-description"] = desc.split(".")[0][:80]
    if fm.get("argument-hint"):
        meta["argument-hint"] = fm["argument-hint"]   # kept as data, not behaviour
    meta["transposed-from"] = f"~/.codex/skills/{name}"
    out["metadata"] = meta

    for pat, rep in NEUTRALISE:
        body = re.sub(pat, rep, body)
    body = re.sub(r"^\the arguments\s*$", "The user's arguments follow.", body, flags=re.M)
    # Inline mentions too — "If `the arguments` contains --help" is Claude syntax.
    body = body.replace("`the arguments`", "the arguments").replace("the arguments", "the arguments")

    new = "---\n" + yaml.safe_dump(out, sort_keys=False, allow_unicode=True, width=88).rstrip("\n") + "\n---\n" + body
    # A skill with no SKILL.md (the shared module directory) still has content
    # worth transposing, so the entrypoint is optional here.
    target = d / "SKILL.md"
    # No entrypoint in the source means there is nothing to compare, not a
    # difference — otherwise a shared module directory reports drift forever.
    entry_same = (not (s / "SKILL.md").exists()) or (target.exists() and target.read_text() == new)

    # Comparing only the entrypoint skipped every sibling module and script:
    # editing debate.md without touching SKILL.md synced nothing at all.
    siblings_same = True
    for extra in s.iterdir():
        if extra.name == "SKILL.md":
            continue
        tgt = d / extra.name
        if not tgt.exists():
            siblings_same = False; break
        if extra.is_file():
            want = extra.read_text()
            for pat, rep in NEUTRALISE:
                want = re.sub(pat, rep, want)
            if tgt.read_text() != want:
                siblings_same = False; break
        else:
            src_files = sorted(x.relative_to(extra) for x in extra.rglob("*") if x.is_file())
            dst_files = sorted(x.relative_to(tgt) for x in tgt.rglob("*") if x.is_file())
            if src_files != dst_files:
                siblings_same = False; break

    if entry_same and siblings_same:
        continue
    if check:
        changed.append(f"{name}: would update"); continue

    d.mkdir(parents=True, exist_ok=True)
    if (s / "SKILL.md").exists():
        target.write_text(new)
    for extra in s.iterdir():
        if extra.name == "SKILL.md":
            continue
        tgt = d / extra.name
        if extra.is_dir():
            shutil.rmtree(tgt, ignore_errors=True); shutil.copytree(extra, tgt)
        else:
            # sibling modules get the same neutralisation
            t = extra.read_text()
            for pat, rep in NEUTRALISE:
                t = re.sub(pat, rep, t)
            tgt.write_text(t)
    changed.append(f"{name}: synced")

for c in changed: print(f"  {c}")
for s_ in skipped: print(f"  SKIP {s_}")
print(f"\n{len(changed)} skill(s) {'would change' if check else 'synced'}, {len(skipped)} skipped")
PY

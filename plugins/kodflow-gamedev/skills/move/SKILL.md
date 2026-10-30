---
name: move
description: "Design one combat move with a sourced panel: anatomy, the six martial areas (the declared tradition governs, the others only remark), animation craft, rig, engines. Ends with a spec and measurable constraints under docs/anim/, verdict pending."
when_to_use: Use before animating or re-animating a combat move in a project that enables kodflow-gamedev, and again when the owner rejected a move and the spec must be redone.
argument-hint: '<move-slug> --tradition <europe|antiquity|south-asia|east-asia|southeast-asia|unarmed> --weapon <weapon|none> [--clip <name>] [--engine threejs|godot|both] [--references] "<what the owner wants>"'
model: inherit
effort: medium
allowed-tools:
- Agent
- Read
- Glob
- Grep
- Write(docs/anim/**)
- Edit(docs/anim/**)
- Write(docs/adr/feedback/**)
- AskUserQuestion
- Bash(python3 -I:*)
- Bash(git rev-parse:*)
- Bash(git -C:*)
- Bash(shasum:*)
- Bash(sha256sum:*)
- Bash(mkdir:*)
- Bash(mktemp:*)
- Bash(bash:*)
---

# /move — a combat move, designed by a sourced panel

$ARGUMENTS

The move is designed before it is animated. A panel of this plugin's agents
answers, each from sources it cites; the director keeps one technique whole
and turns the rest into constraints a checker measures. Nothing here touches
a clip. The run ends **pending verdict**: `/anim-review` measures the clip
and asks the owner.

## 0. Arguments

- `<move-slug>`: kebab-case (`run-guard`, `diagonal-cut`, `sword-grip`).
- `--tradition` and `--weapon` are required. Missing, ask with
  `AskUserQuestion` (one question, the six areas as options, the owner's
  game's usual one recommended). In a non-interactive run (`-p`), stop with
  the usage line instead of guessing.
- `--engine`: default from the project — `package.json` naming `three` →
  `threejs`; `project.godot` → `godot`; both → `both`.
- `--clip`: the clip(s) to measure on; default from
  `docs/anim/sampling.json` (`moves.<slug>.clips`), else the slug.
- `--references`: also brief `reference-specialist-imagery` (see `/reference`).
- The quoted text is the owner's request, passed verbatim to every member.

## 1. Preconditions

```bash
ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
P="${CLAUDE_PLUGIN_ROOT}"
SCRATCH=$(mktemp -d)          # or the session's scratchpad directory
python3 -I "$P/skills/_shared/scripts/feedback-rules.py" build --root "$ROOT"
```

- `build` regenerates `docs/adr/feedback/.RULES.md` once, before any agent
  starts, so their `RULES digest` is current. A named failure (unreadable
  ADR, dangling `supersedes`, cycle, fork) **stops the run**: show it; an
  agent briefed over a broken rule set would follow rules nobody can trace.
- `docs/anim/rig-map.json` must exist. Absent: copy
  `../_shared/rig-map.example.json` to it, tell the owner it is an example
  to map to their rig, and continue — every constraint naming a missing node
  will be reported unevaluated, which is the honest outcome.

## 2. The panel, in parallel

Brief every member in **one message** (parallel `Agent` calls), each with
`subagent_type: "kodflow-gamedev:<name>"` and the brief of
`../_shared/templates/brief.md` filled in. Roles:

| Member | Role |
|---|---|
| `anatomy-specialist-biomechanics` | `anatomy` |
| `martial-specialist-<declared area>` | `governing` |
| the five other `martial-specialist-*` | `consulted` |
| `animation-specialist-combat` | `craft` |
| `rig-specialist-ik` | `rig` (its `grip` block is mandatory for an armed move) |
| `engine-specialist-threejs` and/or `engine-specialist-godot` | `engine`, per `--engine` |
| `reference-specialist-imagery` | `imagery`, only with `--references` |

All six martial agents are briefed on every move (owner decision,
2026-10-30). The martial agents are `experimental`: their output is
evidence for the director, never adopted without its sources.

Record for each member: start and end time, and its status — `ok` (one
`panel-member/v1` JSON object returned), `partial` (the object says so),
`failed` (no parseable object), `timeout` (no answer). Save each answer
under the session's scratch directory as `<agent>.json`.

## 3. Check the sources

```bash
python3 -I "$P/skills/_shared/scripts/cache-source.py" --root "$ROOT" \
    --panel "$SCRATCH/<agent>.json" [--panel …] --json > "$SCRATCH/sources.json"
```

Each excerpt is looked for again on its page; found ones are cached as
`docs/anim/sources/<sha256>.md`. Keep `verified/total` for the run record.

## 4. The director

One `Agent` call, `subagent_type: "kodflow-gamedev:gamedev-animation-director"`,
with: the brief, every member's JSON (or its `failed`/`timeout` status), and
`sources.json`. It returns `director/v1`.

- `status: refused` → stop. Show its `reason` as is, and the members to
  re-run. Nothing is written but the run record.
- `status: ok` → step 5.

## 5. Write

- `docs/anim/<slug>.constraints.json` ← the director's `constraints`, as
  JSON, two-space indent. Then its hash:
  `shasum -a 256 docs/anim/<slug>.constraints.json`.
- `docs/anim/<slug>.md` ← `spec_markdown`, with the hash written into its
  header. The constraints file is never edited after this point: a change
  is a new `/move` run, which writes a new hash.
- `rig_map_gaps`: list them to the owner; the engine specialist's answer
  says where to add each landmark.

## 6. Record the run

Write the run as JSON to the scratch directory, then:

```bash
python3 -I "$P/skills/_shared/scripts/feedback-rules.py" record-run --root "$ROOT" --file "$SCRATCH/run.json"
```

`run.json`: `slug`, `tradition`, `weapon`, `agents` (name, role, status,
seconds, and the characters its `RULES digest` injected — measure them by
piping `{"agent_type":"kodflow-gamedev:<name>","cwd":"<root>"}` into
`$P/hooks/scripts/rules-digest.sh`, which is read-only), `sources`
(`verified`, `total`), `constraints_sha256`, `verdict: "pending"`.

## 7. Hand over

- Persist the trail: dispatch the subagent of `../_shared/trail.md`.
- Tell the owner, in a few lines: the governing technique (four name
  parts), each member's status, the constraints count by kind, what is
  `unverified`, and the next step: `/anim-review <slug>` once the clip is
  animated. End on **pending verdict**.

## Rules

- Never animate, never edit a clip, never confirm a threshold here.
- Never merge another culture's parameters into the governing technique.
- An agent that did not answer is reported, not replaced by your own
  knowledge.

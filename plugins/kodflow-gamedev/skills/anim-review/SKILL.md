---
name: anim-review
description: "Measure an animated combat move against its constraints and every owner rule, then ask the owner's verdict on the rendered clip and hand it to /anim-feedback. Samples three.js or Godot clips into pose tracks; reports evaluated/total, never a pass it could not measure."
when_to_use: Use once a move designed with /move has been animated or changed, before calling it done, and whenever the owner wants to judge a clip.
argument-hint: '<move-slug> [--clip <name>] [--track <pose.json>]… [--view 3d|iso|profile]'
model: inherit
effort: medium
allowed-tools:
- Read
- Glob
- Grep
- Agent
- Skill
- AskUserQuestion
- Write(docs/anim/**)
- Bash(python3 -I:*)
- Bash(node:*)
- Bash(godot:*)
- Bash(git rev-parse:*)
- Bash(git -C:*)
- Bash(mktemp:*)
- Bash(shasum:*)
- Bash(sha256sum:*)
---

# /anim-review — measure, then ask the owner

$ARGUMENTS

A clip is judged twice: by the checker, against the constraints the panel
wrote and the rules the owner confirmed, and by the owner, who watches it.
The checker never stands in for the owner; it tells them what it measured
and what it could not.

## 1. Preconditions

```bash
ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
P="${CLAUDE_PLUGIN_ROOT}"
SCRATCH=$(mktemp -d)          # new and empty, this run's only
python3 -I "$P/skills/_shared/scripts/feedback-rules.py" build --root "$ROOT"
```

- `build` first, as in `/move`: a named failure stops the review.
- `docs/anim/<slug>.constraints.json` must exist (`/move` writes it).
  Record its sha256 **before sampling**; the same file, unchanged, is what
  every track of this review is measured against. If it changes during the
  review, the review is void: start again.

## 2. Pose tracks

With `--track`, use the files given. Otherwise sample, per
`docs/anim/sampling.json` (`../_shared/templates/sampling.example.json`
shows the shape), every clip the move names:

- three.js, adapter or GLB:
  `node "$P/skills/_shared/scripts/sample-threejs.mjs" --adapter <adapter> --rig-map docs/anim/rig-map.json --clip <clip> --fps <fps> --out "$SCRATCH/<clip>.pose.json"`
  (`--glb <file>` instead of `--adapter`, run from the project, which
  provides `three`).
- Godot: `godot --headless --path "$ROOT" --script "$P/skills/_shared/scripts/sample-godot.gd" -- --scene <scene> --rig-map docs/anim/rig-map.json --clip <clip> --fps <fps> --out "$SCRATCH/<clip>.pose.json"`.

A sampler that fails is reported with its message; nothing is guessed in its
place. The adapter is the project's code: when it is missing, ask
`kodflow-gamedev:engine-specialist-threejs` (or `-godot`) for one and show it
to the owner — this skill does not write project code.

## 3. Measure

```bash
python3 -I "$P/skills/_shared/scripts/check-constraints.py" \
  --constraints "docs/anim/<slug>.constraints.json" --track "$SCRATCH/<clip>.pose.json" [--track …] \
  --view <view> --json > "$SCRATCH/report.json"
python3 -I "$P/skills/_shared/scripts/feedback-rules.py" export --root "$ROOT" --out "$SCRATCH/owner.constraints.json"
python3 -I "$P/skills/_shared/scripts/check-constraints.py" \
  --constraints "$SCRATCH/owner.constraints.json" --track … --status confirmed --allow-unevaluated --json > "$SCRATCH/owner-report.json"
```

- Every **confirmed** owner constraint is measured on these tracks, whether
  or not an agent's digest showed it (a constraint for another clip is
  reported unevaluated, which is why `--allow-unevaluated` is there).
- Report to the owner: `evaluated/total`, each failure with its value and
  threshold, each unevaluated constraint with its reason. A run with
  `evaluated < total` is not a pass, whatever else it says.

## 4. The owner's verdict

Render the clip with the project's `render` command when `sampling.json`
names one, and give the owner its path. Then one `AskUserQuestion`:

- **Good** — keep it as is.
- **Bad** — something reads wrong (ask what, in their words, as the
  free-text answer).
- **Good with a reservation** — keep it, and record what to watch.

No verdict without the owner: in a non-interactive run, stop after the
report, verdict `pending`.

## 5. Hand over

Invoke `kodflow-gamedev:anim-feedback` with the slug, the verdict, the
owner's words verbatim, the clip, `$SCRATCH/report.json` and the
constraints sha256. It writes the ADR, records the run and persists the
trail.

---
name: anim-feedback
description: "Record the owner's verdict on a combat animation, good or bad, as a feedback ADR in docs/adr/feedback/ that every later /move and agent reads first. Written once, never edited; a correction supersedes. Then persists the trail in one permanent PR."
when_to_use: Use when the owner judges an animation or a move spec — from /anim-review, or directly when they say what is right or wrong with a clip — so the judgement becomes a rule at once.
argument-hint: '<move-slug> --verdict good|bad [--clip <name>] [--supersedes <adr-file>] "<the owner words, verbatim>"'
model: inherit
effort: low
allowed-tools:
- Read
- Glob
- Grep
- Agent
- AskUserQuestion
- Write(docs/adr/feedback/**)
- Bash(python3 -I:*)
- Bash(git rev-parse:*)
- Bash(git -C:*)
- Bash(mktemp:*)
- Bash(shasum:*)
---

# /anim-feedback — the owner's verdict becomes a rule

$ARGUMENTS

Good feedback and bad feedback are both recorded: one says what to repeat,
the other what never to do again. The ADR is the owner's words first, and a
rule an agent can follow second.

## 1. The header

Build one `feedback-adr/v1` object (`../_shared/feedback-adr.schema.json`;
`../_shared/templates/adr-header.example.json` is a filled example):

- `verdict`: `good` or `bad`, as the owner said it.
- `rule`: one imperative sentence an agent can follow, derived from the
  owner's words — never stronger than they are. Show it to the owner with
  the words beside it when the session is interactive.
- `scope`: tags an agent filters on — `move:<slug>`, `weapon:<w>`,
  `tradition:<t>`, and `area:` tags: `anatomy`, `grip`, `locomotion`,
  `martial`, `technique`, `craft`, `timing`, `readability`, `rig`, `engine`,
  `imagery`, `licence`. A rule with no `area:` tag reaches every agent.
- `supersedes`: the ADR files this one replaces (`--supersedes`, or an
  active rule with the same scope that this verdict contradicts — ask the
  owner before superseding one they did not name).
- `reach: "project"`, unless the owner says it holds for any game: then
  `reach: "general"`.
- `subject`: `spec` (`docs/anim/<slug>.md`), `constraints_sha256` (from
  the report, or `null`), `clip`, `commit` (`git rev-parse HEAD`), `credits`
  (the agents whose recommendation the verdict judges, from the spec's
  panel table).
- `constraint`: when a measured constraint captures the complaint, its
  `kind`, `measured` value, `threshold` (the `test`), its full `definition`
  (a `move-constraints/v1` entry with its `clip`), and `status: proposed`.
  `confirmed` only when the owner confirms the threshold itself — a
  confirmed constraint is hard for every later review. Nothing measurable:
  `"unmeasured"` (an advisory rule).

## 2. Write it

```bash
ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
P="${CLAUDE_PLUGIN_ROOT}"
SCRATCH=$(mktemp -d)
# header.json and observed.txt (the owner's words, verbatim) written to $SCRATCH first
python3 -I "$P/skills/_shared/scripts/feedback-rules.py" new --root "$ROOT" \
  --slug <slug> --header "$SCRATCH/header.json" --observed "$SCRATCH/observed.txt"
```

`new` validates the header, creates
`docs/adr/feedback/<YYYYMMDD-HHMMSS>-<slug>-<4hex>.md` exclusively (never
overwrites), and rebuilds `docs/adr/feedback/.RULES.md`. A refusal names the fault; fix the
header, never the existing ADRs.

## 3. Record and persist

- Record the run with its verdict: `feedback-rules.py record-run` with
  `slug`, `agents` (from the review, or `[]`), `verdict`, the ADR file name.
- Persist the trail: dispatch the subagent of `../_shared/trail.md`.

## 4. What a verdict changes

- The next agent of this plugin starts with the rule in its digest.
- A `good` verdict with `reach: general` whose `credits` name a martial
  area is the evidence that area's agent needs to stop being
  `experimental`: tell the owner, who may open that change in the
  marketplace. This skill never edits the plugin.

---
name: flow
description: Draw the kodflow workflow as an ASCII diagram — the whole map, the nominal path
  through it, one skill in detail, the artifacts skills pass to each other, the hook lifecycle,
  or the specialist dispatch tree. Every node carries the command to type and the file it
  leaves behind, so the diagram doubles as the prompt for what to run next. Use when to see
  how the skills fit together — at the start of a session, when you know what you want but
  not which skill opens it, when handing the setup to someone else, or when a README needs
  the map. Also to check the diagram still matches the installed plugins.
metadata:
  short-description: 'Draw the kodflow workflow as an ASCII diagram — the whole map, the nominal
    path '
  generated-from: plugins/*/skills/flow
  argument-hint: '[<skill>] [--path|--artifacts|--hooks|--agents|--all] [--ascii] [--check]'
---

# /flow — The Workflow, Drawn

the arguments

## Overview

A reference view of the kodflow marketplace. The diagrams are **pre-rendered** in
`diagrams.md` and the per-skill cards in `reference.md`; this file only routes to
the one that was asked for. Print it verbatim — do not redraw it, do not
summarise it, do not add arrows that are not in the module.

**Principle**: the map is the menu. Every box names the command that opens it and
the artifact it writes, so reading the diagram answers "what do I type now?".

---

## Arguments

| Pattern | View | Module |
|---------|------|--------|
| (no args) | The whole map — lanes, skills, and the artifacts between them | `diagrams.md` § MAP |
| `--path` | The nominal path only: idea to merged, one line of boxes | `diagrams.md` § PATH |
| `--artifacts` | Who writes each file and who reads it back | `diagrams.md` § ARTIFACTS |
| `--hooks` | The hook lifecycle band: gate, block, transform, observe | `diagrams.md` § HOOKS |
| `--agents` | Orchestrator to executor to specialist dispatch tree | `diagrams.md` § AGENTS |
| `--all` | Every view above, in order | all of `diagrams.md` |
| `<skill>` | One skill in detail — inputs, outputs, what precedes and follows | `reference.md` |
| `--ascii` | Modifier: render 7-bit, 80 columns, for a README or a CI log | see Rendering |
| `--check` | Compare the diagram against the installed plugins, report drift | see --check |
| `--help` | This argument table |

`--ascii` combines with any view. `--check` runs alone.

---

## Rendering

Two renderings of the same content live side by side in `diagrams.md`.

| Mode | Block to print | When | Width |
|------|----------------|------|-------|
| **Unicode** (default) | the `### <VIEW> [unicode]` block | reading in the terminal | 88 cols |
| **7-bit** (`--ascii`) | the `### <VIEW> [7bit]` block | a README, a CI log, a commit body | 80 cols |

Each view is stored twice, once per mode. Pick the block whose heading matches
the mode; never translate one into the other by hand.

Rules that hold in both:

- Emit the block **exactly** as stored. Re-wrapping breaks the alignment, and a
  misaligned box tree is harder to read than no diagram.
- In `--ascii`, wrap the output in a fenced code block so Markdown preserves it.
- Never colourise. The diagram is copied more often than it is admired.
- Print nothing after the diagram except the legend lines for the mode you used.

---

## Routing

```yaml
route:
  1_parse:
    no_args:        "MAP"
    flag_path:      "PATH"
    flag_artifacts: "ARTIFACTS"
    flag_hooks:     "HOOKS"
    flag_agents:    "AGENTS"
    flag_all:       "every section, in module order"
    bare_word:      "treat as a skill name -> reference.md card"
    flag_check:     "drift check, see below"

  2_read:
    action: "Read ONLY the module the view needs"
    why:    "loading every diagram to print one wastes the context the caller still needs"

  3_emit:
    action:  "reproduce the stored block byte for byte"
    then:    "the legend, then stop"
    forbid:  "commentary, restatement, a summary of what the diagram shows"
```

### An unknown bare word

If `<skill>` is not a card in `reference.md`, do not guess and do not draw a box
for it. Run the inventory script, then:

- **present in the inventory, absent from `reference.md`** — say the skill is
  installed but not yet on the map, and name the file that needs the card.
- **absent from both** — list the nearest names from the inventory and stop.

---

## --check

The diagrams are laid out by hand, because a generated box tree is unreadable.
Hand-laid-out means they can fall behind the plugins. This is the other half of
that bargain.

```bash
bash "${CODEX_HOME:-$HOME/.codex}"/skills/flow/scripts/flow-inventory.sh --names-only
```

Compare that list against the skill names appearing in `reference.md`:

| Condition | Report |
|-----------|--------|
| Installed, not in `reference.md` | `+ <name>` — on disk, missing from the map |
| In `reference.md`, not installed | `- <name>` — on the map, not installed here |
| Sets match | `map matches the N installed skills` |

```text
═══════════════════════════════════════════════
  /flow --check
═══════════════════════════════════════════════

  Installed : N skills · M agents · K hook scripts
  On the map: N skills

  + <name>   installed, missing from reference.md
  - <name>   on the map, not installed here

  Verdict   : <in sync | drifted>

═══════════════════════════════════════════════
```

A drift report is the output. Do **not** edit `diagrams.md` or `reference.md` to
resolve it — say which file needs the entry and let the caller decide. A diagram
edited by the tool that reads it stops being a reviewed artifact.

---

## What a node carries

Every box in every view carries three things, and a card in `reference.md`
carries the same three expanded:

| Field | Meaning |
|-------|---------|
| **command** | exactly what to type, flags included |
| **writes** | the artifact it leaves behind, by path |
| **next** | what the artifact unblocks |

A box whose `writes` is blank performs an action without leaving a trail, and the
diagram marks it so — that is information, not an omission.

---

## Guardrails

| Action | Status |
|--------|--------|
| Draw an arrow that is not in `diagrams.md` | FORBIDDEN |
| Redraw, reflow or re-wrap a stored block | FORBIDDEN |
| Invent a skill, flag or artifact path | FORBIDDEN |
| Edit `diagrams.md` or `reference.md` from `--check` | FORBIDDEN |
| Read every module to answer one view | FORBIDDEN |
| Summarise the diagram in prose after printing it | FORBIDDEN |
| Report `in sync` without running the inventory script | FORBIDDEN |

The first and the last are the ones that matter. A workflow diagram is trusted on
sight; an arrow nobody checked is worse than a gap, and an `in sync` nobody
measured is worse than an unanswered question.

---
name: docs
description: Write the project documents that are missing — requirements, flows, data schema,
  implementation plan, threat model and the rest of the catalogue — from the repository, from
  your answers, or both. Every claim cites its file:line, the draft is shown before it is
  written, and a document that does not apply is ignored only on your word. Use when the documents
  panel shows missing documents, after /project adopts or creates a project, or before /plan
  on a project whose product, data or security has never been written down. Not for an ADR
  on a single decision, which is /kodflow-review:adr.
metadata:
  short-description: Write the project documents that are missing — requirements, flows, data
    schema,
  generated-from: plugins/*/skills/docs
  argument-hint: '[<id>[,<id>…]] [--mode ask|context|both] [--help]'
---

# /docs — the project's missing documents

the arguments

## Overview

A project carries up to fifteen documents (the catalogue below). kodflow-hooks
computes which exist and shows the missing ones in a panel; its « Créer »
button drafts `/kodflow-workflow:docs <id>,… --mode both` in the prompt. This
skill writes them.

**Principle**: a document says what is true of this project, and says how it
knows. Every statement is either read from the repository (cited
`fichier:ligne`), given by the user in this session, or marked as deduced or
uncertain. A plausible paragraph nobody can trace is worse than a gap: the next
`/plan` will trust it.

---

## Arguments

| Pattern | Action |
|---------|--------|
| *(none)* | every document whose state is `missing` |
| `<id>[,<id>…]` | those documents, in the order of § Order |
| `--mode both` | *(default)* the repository first, then questions on what is missing or doubtful |
| `--mode context` | the repository only; the draft is shown, nothing is asked but the go |
| `--mode ask` | questions only, the repository is not read for content |
| `--help` | this table, then stop |

An unknown id stops the run with the list of valid ids. A mode outside the
three stops it with the usage line.

---

## The catalogue

Copied from kodflow-hooks into `catalogue.json` (a plugin is installed alone).
`docs.sh` reads it; never retype it from here.

| id | Document | Default path |
|----|----------|--------------|
| `prd` | Exigences produit | `docs/product/requirements.md` |
| `trd` | Exigences techniques | `docs/tech/requirements.md` |
| `flow` | Parcours | `docs/product/flow.md` |
| `design` | Brief de design | `docs/design/brief.md` |
| `data` | Schéma de données | `docs/tech/data.md` |
| `impl` | Plan d'implémentation | `docs/plan/implementation.md` |
| adr | Décisions (ADR) | `docs/adr/` |
| `voice` | Ton et règles d'écriture | `docs/design/voice.md` |
| `glossary` | Glossaire | `docs/product/glossary.md` |
| `quality` | Qualité attendue | `docs/tech/quality.md` |
| `testing` | Stratégie de test | `docs/tech/testing.md` |
| `threat` | Modèle de menaces | `docs/security/threat-model.md` |
| `rgpd` | Registre RGPD | `docs/compliance/rgpd.md` |
| `ops` | PRA et runbooks | `docs/ops/` |
| `readme` | README et démarrage | `README.md` |

`docs/manifest.json` (git root, versioned) moves a document (`path`) or
ignores it (`ignored`, a reason). Absent manifest: every default, nothing
ignored.

---

## Phase 0 — State

```bash
bash "${CODEX_HOME:-$HOME/.codex}"/skills/docs/scripts/docs.sh state "${CLAUDE_SESSION_ID}"
```

kodflow-hooks' `docs.json` when it exists for this repository, otherwise the
same shape computed from the catalogue and the manifest: `docs[]` with `id`,
`name`, `path`, `state` (`ok` · `missing` · `ignored`), `reason`, `why`.

| Exit | Meaning | Do |
|------|---------|----|
| 3 | `jq` missing | say so, stop |
| 4 | not in a git work tree | say so and point at `/project`, stop |

Then resolve the targets:

- **No id**: every `missing`. None: print `Aucun document manquant.` with the
  ignored ones and their reason, stop.
- **An id that is `ok`**: ask (AskUserQuestion) *Compléter l'existant
  (recommandé)* · *Laisser tel quel*. Never rewrite a document wholesale.
- **An id that is `ignored`**: ask *Le garder ignoré (recommandé)* · *Le
  rédiger quand même*. Rédiger runs `docs.sh unignore <id>` first.

Read `CLAUDE.md` and the constraint ledger once: they hold decisions every
document must agree with.

---

## Order

Each document leans on the ones before it. Whatever the order typed, write in
this one:

`readme` → `glossary` → `prd` → `trd` → `data` → `flow` → `design` → `voice`
→ `quality` → `testing` → `threat` → `rgpd` → `ops` → adr → `impl`

`impl` comes last: its tasks are drawn from everything above. A document whose
inputs are missing and not targeted is written anyway, its gaps marked
`À confirmer` rather than invented.

---

## Phase 1 — Gather (`context`, `both`)

Skipped in `ask`. For each target, read what the repository already says. The
sources per type are in `templates.md`, under each template's **Sources**
line; in general:

| Kind | Where |
|------|-------|
| what the project is | `README*`, `CLAUDE.md` and its ledger, `docs/**`, ADRs |
| what it does | routes, handlers, CLI commands, templates, tests' names |
| what it stores | migrations, `*.sql`, models, schema files |
| what it runs on | manifests (`go.mod`, `package.json`…), Dockerfiles, IaC, CI |
| why it is so | `git log` (subjects and bodies), ADRs, issue links in commits |

`git ls-files` bounds the search: never read what git ignores. More than three
targets: one `Explore` agent per document in a single message, each told the
template's sections and to return facts with `fichier:ligne`, never prose.

Every fact carries one of three marks, kept in the draft:

| Mark | When |
|------|------|
| `[fichier:ligne]` | read in the repository, at that line |
| `(déduit)` | follows from several sources, none says it outright: name them |
| `(à confirmer)` | plausible, unsupported, or two sources disagree |

---

## Phase 2 — Ask (`ask`, `both`)

a multiple-choice question to the user, one to four questions per call, each with two to four
concrete options, the recommended one first and labelled `(recommandé)`. The
tool always offers a free answer: never write an open question when options
can be listed.

- `ask`: every section of the template becomes questions, grouped by section,
  four at a time. Options come from the template's typical answers and from
  what the conversation already said.
- `both`: only the `(à confirmer)` facts and the sections Phase 1 left empty.
  A section the repository answered is not asked again.
- `context`: no question but the go of Phase 4.

An answer turns `(à confirmer)` into `(confirmé le <date>)`; a section the
user declines to fill stays as an `À confirmer :` line in the document.

---

## Phase 3 — Should it exist?

Some documents have no subject in some projects: `design` for a CLI with no
interface, `rgpd` where no personal data is stored, `ops` for a library,
`data` with no storage. When Phase 1 shows it (cite what shows it), ask
before drafting:

*Ignorer : <raison en une ligne> (recommandé)* · *Le rédiger quand même* ·
*Plus tard*

Ignorer: `docs.sh ignore <id> "<raison>"`, nothing else is written. Plus
tard: skipped this run, state unchanged. Never ignore without that answer,
never propose it without evidence.

---

## Phase 4 — Draft, show, write

1. Fill the template of the document (`templates.md`), in the language of the
   project's existing documents (French when there are none). Sections the
   template marks *optional* are dropped when empty; mandatory ones stay,
   with an `À confirmer :` line when nothing fills them.
2. Show the draft in the conversation, marks included, then ask:
   *Écrire (recommandé)* · *Corriger d'abord* · *Ignorer ce document*.
   Corriger: take the corrections, show the changed sections, ask again.
3. Write it to the state's `path`. Inside a document, the marks become:
   `[fichier:ligne]` kept as a link in a closing **Sources** section, the
   `(déduit)` kept inline, `(à confirmer)` turned into `À confirmer :` lines
   at the end of their section.
4. Directories: adr writes `docs/adr/NNNN-<slug>.md` per decision found
   (suggest `/kodflow-review:adr` instead when kodflow-review is installed, one per
   decision); `ops` writes `docs/ops/README.md` (the index) and one runbook
   per procedure found.
5. A path outside the default (the user named another place): `docs.sh path
   <id> <path>` before writing.

`docs.sh init` first when the manifest is missing and the run will ignore or
move a document; a run that only writes at default paths leaves no manifest.

---

## Phase 5 — Verify and hand off

```bash
bash "${CODEX_HOME:-$HOME/.codex}"/skills/docs/scripts/docs.sh compute
```

Each written target must read `ok`, each ignored one `ignored`. Then print
one line per target: id, path, `écrit` · `ignoré (<raison>)` · `reporté`, the
count of `À confirmer` left.

**`impl` written**: propose turning its tasks into the epic's tasks:
*Créer les tâches dans l'épopée active (recommandé)* · *Dans une nouvelle
épopée* · *Non*. Créer: `task_list` for the active epic (or `task_epic` with
the plan's title), then one `task_create` per task in dependency order, each
`blocked_by` the ids already created for its `Dépend de`, subject at most 30
characters, the task's `Fait quand` in `description`. Never create them
without the answer.

Nothing is committed: the documents are left in the work tree for `/git`.

---

## Guardrails

| Action | Status |
|--------|--------|
| A statement with no source, no `(déduit)` and no `(à confirmer)` | FORBIDDEN |
| Writing a document before the user saw its draft | FORBIDDEN |
| Overwriting an existing document instead of completing it | FORBIDDEN |
| Ignoring a document without the user's answer | FORBIDDEN |
| An open question where options could be listed | FORBIDDEN |
| More than four questions in one a multiple-choice question to the user | FORBIDDEN |
| Editing `docs/manifest.json` by hand instead of `docs.sh` | FORBIDDEN |
| Reading files git ignores, or copying a secret into a document | FORBIDDEN |
| Creating tasks from `impl` without the user's answer | FORBIDDEN |
| Committing, pushing or opening a PR | FORBIDDEN |

---

## Related

- `templates.md` — one template per document, with its sources
- `../project/SKILL.md` — creates the manifest and proposes this skill
- `../plan/SKILL.md`, `../challenge/SKILL.md`, `../refine/SKILL.md` — read the
  documents present before proposing
- `/kodflow-review:adr` — one decision, one record

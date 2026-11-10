---
name: improve
description: Turn the feedback subagents leave on their own instructions into changes to this
  marketplace's agents, skills and hooks. Collects and dedupes it, judges each need against the
  current tree (already fixed, open, out of scope), shows a diff per file, asks, then opens one
  pull request it never merges.
when_to_use: Use when subagent feedback has piled up (the Stop hook proposes it, or after a long
  multi-agent session), or before reworking an agent or skill, to start from what its runs
  reported. Not for a project's own agents, nor for a defect in the hooks' code
  (`kodflow-workflow:fix`).
argument-hint: '[--session <id>] [--since <days>] [--agent <type>] [--target <prefix>] [--check]'
model: inherit
effort: medium
allowed-tools:
- Read(**/*)
- Glob(**/*)
- Grep(**/*)
- Write(**/*)
- Edit(**/*)
- Bash(*)
- AskUserQuestion
- mcp__github__*
- mcp__kodflow-hooks__*
---

# /improve — what the subagents said, turned into a reviewed change

$ARGUMENTS

Every subagent ends its answer with an `## Agent feedback` section: what in its
own instructions was wrong, missing or ambiguous. kodflow-hooks keeps it, one
line per report, in `<config>/kodflow/sessions/<session>/agent-feedback.jsonl`
(the hooks' README, « Agent feedback », says what each field holds and how it is
redacted). The Stop hook puts each new batch to the user once. This skill is the
deliberate pass over all of it: the needs that are still open in the current
marketplace become one pull request, the rest are recorded so they are not
asked about again.

Two things decide the run, and both outrank speed:

> **A need is judged against the tree as it is now, not as it was when the
> subagent ran.** Most feedback describes a version that has since moved; a
> change that re-adds what a later commit already says duplicates a rule.
>
> **Nothing of a session reaches the public repository.** The feedback quotes
> briefs, paths, repositories and hosts of private work. A pull request states
> each need in general terms, never in the subagent's words (below, « What
> never leaves the machine »).

---

## Arguments

| Pattern | Action |
|---------|--------|
| *(none)* | Every session, every entry not yet recorded in the ledger |
| `--session <id>` | One session only |
| `--since <days>` | Entries younger than this |
| `--agent <type>` | One agent type, exact (`kodflow-specialists:developer-specialist-go`) |
| `--target <prefix>` | Targets under a path (`plugins/kodflow-hooks/`) |
| `--check` | Phases 1 → 4 only: verdicts and diffs shown, nothing opened, nothing recorded |
| `--help` | Print this table and stop |

The script and the ledger:

```bash
COLLECT="${CLAUDE_PLUGIN_ROOT:-$HOME/.claude}/skills/improve/scripts/collect.py"
LEDGER="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/kodflow/improve/handled.tsv"
```

---

## Phase 1 — A checkout of the marketplace at its default branch

The verdicts need the current tree, never the installed plugin cache (it lags
behind) and never a stale local `main`.

1. If the current directory is a clone whose `origin` is
   `kodflow/claude-marketplace`, use it: `git fetch origin`, then read the
   default branch from `git symbolic-ref refs/remotes/origin/HEAD`.
2. Otherwise find a clone in the user's code home, where
   `kodflow-workflow:project` keeps checkouts; with none, `git clone` it into
   the scratch directory.
3. Create a worktree on a new branch cut from `origin/<default>` beside the
   clone, as the standing rules of the session say. Every read below is made
   in it; the clone's own checkout is never touched.

Call its path `TREE`. A run that opens nothing (`--check`, no open need, the
user declines) removes that worktree and its branch before it ends.

## Phase 2 — Collect and dedupe

```bash
python3 "$COLLECT" --tree "$TREE" --handled "$LEDGER" [--session …] [--since …] [--agent …] [--target …]
```

One JSON object per target: `kind` (`agent`, `skill`, `hook`, `plugin`,
`brief`, `external`), `target` (a path in the marketplace), `count`,
`sessions`, the agent types, models and efforts seen, and `needs`, each
distinct text once with its `key` and its `count`. Entries already in the
ledger are left out. How a target is attributed is in the script's header;
read it before contesting an attribution.

Exact duplicates are merged by the script. Near-duplicates — the same need in
other words, across agents of one family, or the same gap reported for every
routed agent — are merged here, by reading: one need, the sum of its counts,
every key it absorbed kept for the ledger. Then say the size of the run:
targets, distinct needs, entries. With more than about thirty needs, propose
`--target` or `--since` before going on.

## Phase 3 — One verdict per need

Read the target file in `TREE` (all of it: a need is often met two sections
away from where the subagent looked), and `git log --since=<first ts> --
<target>` for what changed since the reports. Each need gets exactly one
verdict:

| Verdict | When | Evidence to show |
|---------|------|------------------|
| **fixed** | The current tree already says it, or a commit since the first report closed it | `file:line` of the text that meets it, or the commit |
| **open** | The tree still lacks it, and the need would help any user of that file, on any project | the generic need (below) and the change proposed |
| **out of scope** | It is about one brief or one project (a private repository, host, ticket, path, or what only that caller got wrong); or `external`, whose owner changes it; or `brief` with no file to change; or it asks to relax a rule the marketplace holds on purpose | the reason in one line, naming the rule when there is one |

A need that contradicts a rule is out of scope even when several agents asked
for it: name the rule, and it becomes the user's question, not a change.

**Where the change goes.** Only at the file's canonical source, never in a
copy. `.github/workflows/ci.yml` names every file that is copied or generated
and the script that writes it — the `_shared` mirrors, the plan review mode
copies (`_shared/specialists.md`, « Plan review mode »), the routing index,
the tier table, `codex/` — read it rather than guessing. A rule that several
agents or skills need is written once in a shared file and pointed to, never
pasted into each: a duplicated rule drifts.

**Who writes it.** This skill writes in its own worktree. Anything it hands to
an agent follows `_shared/specialists.md`, « Who delivers a change », with the
model and effort of the tier table (`_shared/model-policy.md` section 2).

## Phase 4 — Show it, per file

For every file with at least one open need, in that order: the file, the
need(s) in general terms with `reported N times in M sessions`, and the
proposed change as a unified diff against `TREE`. Then one line per fixed need
(with its evidence) and a count of out-of-scope ones by reason, expandable on
request. Nothing is written to the tree yet.

With `--check`, stop here.

## Phase 5 — Ask

One `AskUserQuestion`, the recommended option first:

| Option | Effect |
|--------|--------|
| **Open one pull request with the N open changes (Recommended)** | Phase 6 with all of them; every verdict recorded |
| Choose per file | One question per file (open it / leave it open / out of scope), then Phase 6 with the kept ones |
| Record the verdicts, open nothing | The ledger only |

Leaving without an answer opens nothing and records nothing. A change the user
edits in their answer is shown again as a diff before it is written.

## Phase 6 — Deliver, never merge

In the worktree of Phase 1:

1. Apply the changes; run every generator whose output a touched file feeds
   (each named in `ci.yml`), the plugin version stamp included.
2. Run the `ci.yml` steps that the touched paths concern, and the privacy
   steps always (below). A red step is fixed before the commit, or the change
   that reddens it is dropped and the user told why.
3. One conventional commit per plugin touched (`feat(specialists): …`,
   `fix(hooks): …`), its body listing the needs in general terms; no AI
   attribution, no workflow path.
4. Push the branch, open one pull request against the default branch: one
   section per file — need, why it is general, the change — and the counts.
   Watch its checks to green; a red check is read and fixed on the branch.
5. Never merge it: the main thread and the user review it.

Then record every key the run judged, one verdict each:

```bash
python3 "$COLLECT" --handled "$LEDGER" --mark <key>=<fixed|open|out-of-scope|delivered|declined> [--mark …]
```

`delivered` for the needs in the pull request, `declined` for those the user
turned down; a need left `open` by choice is recorded `open` and comes back
only if it is reported again under another key.

## What never leaves the machine

The collector's output, and the JSONL files behind it, are local material.
Into the branch, the commit and the pull request go **none** of:

- a quote of the feedback, or a paraphrase close enough to identify the brief;
- a session id, agent id, timestamp of a run or count tied to one session;
- a path under a home directory, a hostname, an IP address, a private
  repository or organisation name, a ticket or PR number of another repository;
- a model or effort pinned to a named private project.

A need is written as what any user of the file would hit (« the agent's scope
omits read-only `git show`, which a review of a past revision needs »), and an
example in it uses `~/` and placeholder names. Before pushing, run
`scripts/sanitize.py` and the « No machine- or org-specific detail » step of
`ci.yml` on the worktree, and read the pull request body once more for names
from the sessions. When a need cannot be stated without private detail, it is
out of scope.

## Output

```text
/improve — <targets> targets · <needs> needs · <entries> entries
  open           <n>  in <files> files      → PR #<n> (checks <state>)
  fixed          <n>  (already in the tree)
  out of scope   <n>  (<n> project-specific · <n> external · <n> rule held)
  ledger         <path>  +<n> keys
```

## Guardrails

| Action | Status |
|--------|--------|
| Open, push or record before the user's answer | FORBIDDEN |
| Merge the pull request, or push to the default branch | FORBIDDEN |
| Quote a subagent's feedback, or any session detail, in the repository | FORBIDDEN |
| Edit a generated file or a mirror instead of its source | FORBIDDEN |
| Paste one rule into several agents instead of a shared file | FORBIDDEN |
| Judge against the installed cache or a stale local branch | FORBIDDEN |
| Change an `external` definition | FORBIDDEN |

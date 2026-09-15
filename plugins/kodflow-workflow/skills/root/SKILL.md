---
name: root
description: >-
  The main thread is root: it decides, briefs and dispatches; subagents do the
  work, including the one-line change. Defines the briefing contract that makes
  delegation worth its cost — objective, constraint ids, what root already read,
  and the return contract — plus the messaging discipline and the escape hatches
  from the hook that enforces it.
when_to_use: >-
  Use when the main thread is about to edit a file or run a mutating command, when
  a dispatch needs a brief worth its cost, and when the root gate has just denied a
  tool call and its reason needs unpacking.
argument-hint: --contract | --hatches | --measure
model: opus
allowed-tools:
- Read(**/*)
- Glob(**/*)
- Grep(**/*)
- Bash(git status:*)
- Bash(git log:*)
- Bash(git diff:*)
- Bash(jq:*)
- Agent(*)
- SendMessage
- AskUserQuestion
- Skill(*)
---

# /root — the orchestrator does not type

$ARGUMENTS

The agent that receives the user's message is **root**. Root reads, decides,
briefs and dispatches. It does not write files and it does not run mutating
commands — **not even for a task that would take one line**.

This is not a style preference. `kodflow-hooks` enforces it: a `PreToolUse`
payload carries `agent_id` only when the call comes from inside a subagent, so
the hook can tell root's own hand from a subagent's and refuse the first.

---

## Why root's own hand is the expensive one

Root's context is the one that has to last the whole session. Every file root
reads to make an edit, every test output it scrolls through, every failed
`old_string`, is spent from the budget that has to still be there when the user
asks the next question. A subagent's context is disposable — it is allocated,
filled with exactly one job, and thrown away. Moving the typing into a subagent
moves the token cost onto a budget nobody needs afterwards.

The second reason is that a one-line change is never reliably one line. It is
one line plus the read that confirmed it, plus the test run, plus the fix when
the test fails. "Simple" is a prediction, and root is the agent that can least
afford to be wrong about it.

---

## The briefing contract

**Delegation is only worth its cost if the brief is good.** A dispatch that says
"fix the bug in the parser" makes the subagent re-read everything root already
read, and the discipline loses money. Every dispatch carries four things:

### 1. The objective
What "done" looks like, stated so the subagent can tell whether it got there —
not the task title, the finished state.

### 2. The constraints that apply
The `C-NNN` ids from the project's `CLAUDE.md` constraint ledger that bear on
this change, quoted, not referenced. The subagent does not inherit root's
context, so a bare id is a lookup it has to pay for.

### 3. What root already knows
This is the part that pays for the discipline, and the part that gets skipped:

- exact paths, with line numbers — `plugins/kodflow-hooks/hooks/scripts/on-tool.sh:130`,
  not "the hook script"
- what root already read there, and what it concluded
- what was already decided, and what was rejected and why, so the subagent does
  not re-propose it
- the commands already run and their outcome, so they are not run twice

A brief that does not carry these is a brief that buys a rediscovery.

### 4. The return contract
- a **compact summary** to the main thread: what changed, what was verified,
  what was assumed, what is still open
- the **full output** — logs, diffs, transcripts, analyses — in a report file
  under the **session scratchpad**, never in the worktree, and the summary names
  its path
- no report file is written into the repository: a working tree polluted with
  agent output is the failure mode this rule exists to prevent

---

## Messaging discipline

- **Name every agent you spawn.** An unnamed agent cannot be addressed, so the
  only way to reach it again is to spawn another one.
- **Send follow-ups to a live agent; do not respawn.** A respawn throws away
  everything the first one learned — the files it read, the dead ends it
  already ruled out — and pays for all of it a second time. `SendMessage` to a
  running agent keeps its context intact.
- **Keep the user's message flowing to root.** The user talks to root; root
  talks to the agents. A subagent that needs a decision from the user asks root,
  and root asks the user. Nothing else is addressed to the person.
- **Never invent a pending agent's result.** A dispatch that has not reported is
  still running; say so rather than predicting what it will find.

---

## Escape hatches

A gate with no way out is a gate that gets ripped out. There are three, and they
are meant to be used:

| Hatch | Scope | How |
|-------|-------|-----|
| `ROOT_OK=1 <command>` | one Bash line | Prefix the line, exactly as `NO_RTK=` opts out of the rtk rewrite. The prefix stays on the line as an ordinary variable assignment. |
| `KODFLOW_ROOT=off` | the session | Set in the environment; the discipline stops applying. |
| plan mode | automatic | The gate never fires when `permission_mode` is `plan` — nothing mutates there. |

The gate also fails open on every anomaly — no `jq`, a malformed payload, a
field it cannot read. A broken guard must never stop someone from working.

---

## What the gate actually stops

Denied from the main thread: `Write`, `Edit`, `MultiEdit`, `NotebookEdit`, and
any `Bash` line that is not read-only.

A Bash line is read-only when **every** segment of it is — the line is split on
`;`, `&&`, `||`, `|` and `&`, and one mutating segment condemns the whole line.
The classification is an allow-list, because the inverse leaks on every command
it has not heard of yet: reading commands (`ls`, `cat`, `grep`, `find` without
`-delete`/`-exec`, `sed` without `-i`, `jq`, `awk`, …), read-only git
(`status`, `log`, `diff`, `show`, `rev-parse`, `ls-files`, bare `branch`/`remote`/`tag`,
`config --get`) and read-only forge calls (`gh`/`glab … view|list|checks`).

Any redirection — `>` or `>>` — or a `tee` makes the line mutating whatever else
is on it. The test runs over the whole line, quotes included: that only ever
makes it stricter, which is the safe direction.

---

## The counter-argument, and how it is settled

Another marketplace's implementation skill refuses to delegate implementation
outright, on the grounds that the repo context is already loaded in the main
thread and a coder agent spends most of its cost rediscovering it. That is a
real cost and the objection is honest.

The answer here is the briefing contract plus measurement: a brief that carries
the paths, the line numbers and the decisions is precisely the thing that stops
the rediscovery, and whether it does is a question of fact, not of taste. **The
overhead is to be measured, not assumed** — which is why every denial and every
dispatch is logged.

---

## Measuring it

Both events land in the session log that `kodflow-hooks` already writes, tagged
through the same sanitization policy as everything else — one log, one policy:

```bash
L=.claude/logs/$(git branch --show-current | tr / _)/session.jsonl
grep -c '"root_guard":"deny"'     "$L"   # times root was stopped
grep -c '"root_guard":"dispatch"' "$L"   # times root delegated
```

A session where denials far outnumber dispatches is a session where root kept
reaching for the keyboard. A session where dispatches carry thin briefs shows up
differently — in subagents that re-read what root had already read. Read both
before deciding the discipline earns its keep.

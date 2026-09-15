---
name: usage
description: What this machine's Claude Code sessions cost, priced from the transcripts they
  already wrote. Per ISO week, cost split into input, cache read, cache write and output; main
  thread versus subagents by agent type; models and effort observed; context-size bands;
  expired-cache re-primes; the priciest five-hour windows. Reads files, calls nothing.
when_to_use: Use when a week felt expensive and nobody can say why, before or after changing
  the default model or effort, to size what subagents actually cost, or to find the sessions
  that keep reloading an expired cache. Local workstation only — never in CI.
argument-hint: '[--since YYYY-MM-DD] [--until YYYY-MM-DD] [--project FRAGMENT] [--json]'
model: sonnet
allowed-tools:
- Bash(python3 "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude}"/skills/usage/scripts/usage_report.py:*)
- Read(**/*)
---

# /usage — what the sessions cost

$ARGUMENTS

Claude Code writes every response it receives to `~/.claude/projects`, token
counts included. This skill prices those counts and aggregates them. It is
arithmetic over local files: no API key, no request, no upload, no account
needed — and nothing it prints came from anywhere but this disk.

```bash
python3 "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude}"/skills/usage/scripts/usage_report.py --since 2026-09-01
```

Options: `--since YYYY-MM-DD`, `--until YYYY-MM-DD` (inclusive), `--project
FRAGMENT` (substring of the project directory name), `--json`, and `--projects
DIR` when the transcripts are not in the default place. `CLAUDE_CONFIG_DIR` is
honoured.

## Where its output may go

**Never run this in CI, and never paste its output anywhere public.**

The report names session ids and project directory names, and a project
directory name is the working directory with the slashes swapped — it carries
the client, the repository and the branch of everything worked on. That is the
point locally: it is what makes a spike attributable to an afternoon. It is
also why the output belongs in a terminal and not in a PR comment, an issue, a
Slack channel or a CI log.

In CI it is worse than indiscreet: a runner has no transcripts, so the run
proves nothing, and the one place it would find some is a workstation image
that should not be reading them.

Aggregates only. The script reads the usage counters and the timestamps; it
never reports what was in a message.

## What the numbers mean

**List price, not an invoice.** Every figure is what the observed tokens would
cost at the public per-token rates, so it is an order of magnitude and a
comparison between weeks, not a bill. A subscription, a discount, a partner
endpoint (Bedrock, Vertex) or a free tier all make the real number different.

**The four columns.** Cache read is usually the largest and should be: it is
the discount working. Cache *write* growing faster than cache read is the
signal to look at — something is invalidating the prefix.

**Model and effort drift.** Several `(model, effort)` pairs inside one week is
flagged. It is rarely deliberate: a model pinned in one skill, an effort raised
for one task and left there. It is also the single cheapest thing to fix.

**Re-primes.** A main-thread request that rewrites more than half its own
context after more than an hour of silence in the same session. That is a
session resumed once its cache had expired: the entire context is billed as a
write, at 1.25x or 2x input, to buy back what a read would have cost at 0.1x.
A handful per week is normal. A column of them means sessions are being left
open and returned to, and starting fresh would have been cheaper.

**Context bands.** Main-thread requests under 150k tokens, 150k–400k, and over
400k, with the cost each band carries. A small band carrying most of the cost
is the case for compacting earlier.

**Five-hour windows.** A fixed grid aligned to the epoch, not a window per
session, so that sessions running at the same time land in the same bucket —
which is what makes the parallel-session count mean anything. The ten most
expensive windows, with how many sessions were active in each.

## Reading it back to the user

Lead with the week total and the split. Name the one thing that would change
it — usually drift, re-primes, or a subagent type nobody expected to be
expensive — and say what it would save. Do not narrate every line; the table is
already on their screen.

If the report prints `UNKNOWN MODEL IDS`, say so first: those requests are
counted in tokens and priced at zero, so every total under it is an
understatement until that model gets a price row.

## Keeping the prices honest

The price table is at the top of `skills/usage/scripts/usage_report.py`, one row per model
id, each carrying the date it was verified. Prices move and models are
released; a row whose date is older than the model it prices is wrong. Re-check
it against the current published rates before trusting a total, and update the
date when you do.

## Tests

`tests/run-tests.sh` runs the assertions, on synthetic transcripts written into
a temporary directory. It never reads real sessions.

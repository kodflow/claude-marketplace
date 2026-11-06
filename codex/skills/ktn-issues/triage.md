# /ktn-issues — precedents and verdicts

The verdict decides everything downstream, and it is decided by history before
it is decided by argument. A report that matches an earlier lazy verdict is
lazy: the project already ruled on that shape, and reopening it one reporter at
a time is how a rule erodes.

---

## Phase 2 — Read the precedents

```bash
gh issue list -R <owner>/<repo> --state closed --label lazy --limit 1000 \
  --json number,title,body,stateReason,closedAt,url > "$STATE/lazy.json"
jq '[.[] | select(.stateReason == "NOT_PLANNED")]' "$STATE/lazy.json" > "$STATE/precedents.json"
```

For every precedent, fetch the **closing comment** (`gh issue view <N>
--comments`, the last comment by the maintainer before the close). That comment
is the precedent: the shape that was ruled on, the rewrite that satisfied the
rule, and why the exemption was refused. The title alone is not enough — two
reports with the same rule ID can be about different shapes.

Build `$STATE/precedents.tsv`: `number  rule  shape  rewrite`, one line each,
`shape` in a sentence ("value struct whose only method resets it in place").

Also note **open equivalents**: open issues against the same rule with the same
shape. They are judged together and get the same verdict; the earliest one
carries the reasoning, the others cite it.

A closed issue labelled `lazy` but closed as `completed` is not a precedent —
something was changed for it. Read it anyway: it may be a shape that was
narrowed, which tells you where the boundary now sits.

---

## Phase 3 — Classify, then judge

### Kind

| Kind | Examples | Path |
|------|----------|------|
| `rule` | false positive, wrong message, asks for an exemption, severity complaint | verdict below |
| `other` | crash, wrong output, feature, refactor, performance, docs, CI | straight to `fix.md`, after checking it still holds on the default branch |

An `other` issue whose reproduction no longer reproduces on the default branch
is `obsolete`: close it as completed citing the commit that fixed it (`git log
-S`, `git bisect` when needed). An unreproducible report is not obsolete — ask
for the reproduction in a comment and keep it open; record that in the ledger.

### Verdict for a `rule` issue

Work on a **reproduction**, not on the prose: reduce the report to the smallest
file that shows the finding, in `$STATE/scratch/<N>/`, and lint it.

1. **Precedent match.** Does the shape match a line of `precedents.tsv`? Then it
   is `lazy`, precedent cited, whatever the new report argues — unless it shows
   a difference that the precedent's reasoning does not cover. Name that
   difference in one sentence or apply the precedent.
2. **No precedent.** Ask the rule's question, from its documented intent (the
   README line, the rule's doc, its analyzer comment), not from the reporter's
   framing:
   - Is the flagged code actually worse than the code the rule asks for?
   - Does a rewrite exist that satisfies the rule, keeps the behaviour, and is
     at least as clear? **Lint that rewrite with all rules.** A rewrite that
     moves the finding to another rule is not a rewrite.
   - Is the rewrite impossible — a signature imposed by an interface the code
     does not own, a third-party or generated type, a language constraint?
3. Decide:

| Finding | Verdict |
|---------|---------|
| A rewrite exists, lints clean across all rules, and is no worse | `lazy` |
| The rule is already configurable to what the reporter wants (threshold, severity, phase) | `lazy` — the config is the answer |
| The flagged code is correct and every satisfying rewrite is worse | `legitimate` |
| The rewrite is impossible for a reason outside the code's control | `legitimate` |
| The finding is factually wrong (wrong line, wrong type, misread AST) | `legitimate` |
| The rule is right but the message misleads | `legitimate` — fix the message, not the verdict |

"The reporting project has many of these" is never an argument: a rule that
fires a lot on one codebase is doing its job until a single instance is shown to
be wrong.

### Challenge every lazy verdict

Before anything is closed, give each lazy verdict to an **independent** agent:
the issue text and your reproduction, not your reasoning. Its job is to overturn
the verdict — find the instance where the rewrite is worse, impossible, or still
flagged by another rule. A verdict it overturns becomes `legitimate`; one it
cannot overturn is closed, and the closing comment says it was challenged.

### Record

Each issue gets its ledger line updated: `kind`, `verdict`, `precedent` (issue
number or `-`), state `judged`, and a one-line `note` with the shape. Group open
equivalents in the note (`same shape as #N`).

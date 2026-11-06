# /ktn-issues — closing a lazy issue

A lazy closure is a code review of the reporting project, delivered on the
linter's tracker. It must leave the reporter with nothing to do but apply it:
the exact change, proof that it lints clean, and the reason the exemption they
asked for would cost everyone else real findings.

---

## Before closing

1. Write the rewrite in `$STATE/scratch/<N>/` next to the reproduction: the
   reporter's shape, changed the way the rule asks.
2. Lint it with the **whole** rule set — the project's normal run on that file
   (for ktn-linter `./builds/ktn-linter run <file>`), never a run restricted to
   the reported rule. Zero findings, or it is not the answer. A rewrite that
   trades the reported finding for another rule's is the most common wrong
   closure; it sends the reporter back with a new issue.
3. Write down one piece of **genuinely wrong code** that the requested exemption
   would also silence. If you cannot find one, the exemption may be safe — go
   back to `triage.md`, the verdict is in doubt.
4. The independent challenge (`triage.md`) could not overturn the verdict.

## The comment

```markdown
Closed as **lazy**: the rule is right and the reported code should change.
<Reproduced on <base sha>; challenged independently, the challenge could not overturn it.>
<Same shape as #<precedent>, closed lazy: <its one-line reasoning>.>   ← when a precedent applies

- **The change.** <the rewrite, as a short code block or diff, on the reporter's own shape>
- **Verified.** <file> linted with every rule at <sha>: 0 findings.
- **Why no exemption.** <the wrong code the exemption would also silence, and what the rule
  catches in it>
- <The configuration knob, when one already gives the reporter what they want.>
```

Keep it to what the reporter needs; no restatement of the issue.

## Closing

```bash
gh issue comment <N> -R <owner>/<repo> --body-file "$STATE/scratch/<N>/close.md"
gh issue edit    <N> -R <owner>/<repo> --add-label lazy
gh issue close   <N> -R <owner>/<repo> --reason "not planned"
```

The label and the `not planned` reason are both required: they are what makes
this closure a precedent the next run finds (`triage.md`, phase 2). Open
equivalents are closed the same way, each citing the first.

Ledger: state `closed-lazy`, `commit` = the comment URL.

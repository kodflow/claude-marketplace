# /ktn-issues — fixing a legitimate issue

Every legitimate `rule` issue and every `other` issue is fixed in this run — all
of them, without exception. A fix is three things in this order: a failing case
that pins the report, the narrowest change that makes it pass, and a control
that proves the change did not open a hole beside it.

---

## 1. Reduce

Shrink the report to the **most precise reproducible case**: the smallest code
that still shows the wrong finding, with every detail that does not matter
removed — and every detail that does kept. "A struct embedding an interface" is
not the case if the report only fails when the interface comes from another
package; the precise case is what tells you where the boundary of the fix goes.

Read the issue's **proposed fix**, but do not copy it. Reporters propose the fix
that silences their code, which is usually a whole category ("exempt every
`Register*` call"). Judge its width against the precise case: what else would it
exempt?

## 2. Red first

Write the case as a failing unit test or fixture **before** touching the
analyzer — for ktn-linter, the good-fixture case that must give zero findings,
or the bad-fixture case that must be flagged, in the rule's `testdata`, plus a
unit test when the logic is a helper. Run it and **see it red**; keep the red
output in `$STATE/scratch/<N>/red.txt`. A test that was never seen failing has
not been shown to test anything.

Follow the project's fixture rules (for ktn-linter: `bad.go` returns only its
rule's findings, `good.go` returns none, different function names in each, no
`_test.go` in `testdata`). Put the issue's case in a fixture **file of its own
named after the issue** where the layout allows it, rather than appending to a
shared fixture — see `commits.md` for why.

## 3. Fix the algorithm, for that case

Change the rule's logic so it accounts for the precise case: a structural
condition the case satisfies and genuinely wrong code does not. Never a name
list, never a path test, never a marker comment.

> **Narrow, never widen.** For every new condition, ask what *else* now passes.
> If the answer includes code the rule exists to catch, the condition is wrong.

## 4. Negative control, both directions

Every exemption gets a **bad control**: code just outside the new boundary,
genuinely wrong, that must still be flagged. Then check the pair both ways and
revert after each:

| Direction | Do | Must see |
|-----------|----|----------|
| Exemption disabled | turn the new condition off | the new **good** case goes red — the exemption is what makes it pass |
| Boundary widened | loosen the condition by one notch (drop one of its clauses) | the **bad** control drops — the control really sits on the boundary |

A control that stays flagged when the boundary is widened tests nothing: it sits
too far from the edge. Move it closer and check again. Record both runs in
`$STATE/scratch/<N>/controls.txt`.

## 5. Heavy issues, done properly

Some issues are not one condition. Recognise them and do the real work:

| The issue asks, or the fix reveals | Done properly means |
|-------------------------------------|---------------------|
| A function living in the wrong file | Move it to the file the project's convention assigns, renamed to the naming convention, callers updated, no shim left behind |
| A file grown past its purpose | Split it along the project's file-organisation rules, one responsibility per file, tests moved with their code |
| Two or more copies of the same logic | Deduplicate into one helper in the package the convention names; delete the copies, not just the callers |
| Slowness | A benchmark before and after, committed or quoted; a real algorithmic or allocation change, not a cache over the slow path |
| A wrong design under the bug | Fix the design; the narrow patch that works around it is the minimal patch this skill forbids |

The project's own linter applies to the change: run its self-lint on the
touched packages. A fix that adds findings is not finished.

## 6. Verify

- The issue's case: green. The bad control: still flagged. Both directions
  recorded.
- Fixture validation (for ktn-linter `make validate`) and the full test suite:
  green apart from the baseline-red list (`$STATE/baseline-red.txt`), by test
  name.
- The build, through the heavy-work wrapper.
- Docs touched by the change (rule count, README line, the package's
  `CLAUDE.md`) updated in the same commit.

Ledger: state `fixed`, `commit` = the sha.

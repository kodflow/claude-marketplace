# /ktn-issues — the review round

Agents fixing false positives widen exemptions. Not occasionally: on a measured
run, two independent reviews found 23 too-wide exemptions in 46 fixes. This
round is where that is caught, and it runs on the local batch branch, before the
first push.

Four passes, in order. Each finding becomes a `--fixup` of the commit it belongs
to (`commits.md`); after the last pass, autosquash and the per-commit build.

---

## 1. `/code-review` at max

The built-in correctness review, at the highest local level, over the batch
diff (`<base>...HEAD`). This skill asks for `max` explicitly; the level is not a
judgement call here.

## 2. `/review`

kodflow-review's evidence-bound review of the same diff, deterministic tiers
included (build, tests and the project's self-lint run for real). Every finding
cites `file:line` and a counterexample; treat its "Needs Verification" tier as
open until verified.

## 3. The exemption breaker

An **independent** agent — given the diff and the list of new or changed
exemptions, not your reasoning about them. For each exemption, its job is to
write code that is **genuinely wrong** by the rule's own intent and that now
passes because of the change. One brief per few exemptions, within the agent
cap; each writes in its own scratch subdirectory.

- Each success is a too-wide exemption: narrow the condition, add the breaker's
  code as a new bad control, check both control directions again (`fix.md` §4).
- Each failure is recorded with the attempts made, so the PR can say what was
  tried.

Expect successes. A breaker that finds nothing in a large batch either got a
small batch or did not try hard enough — read its attempts before trusting it.

## 4. Corpus diff

When the project runs its linter against a corpus of real code (named in its
`CLAUDE.md`), run it on the base and on the tip, through the heavy-work
wrapper, and compare **finding counts per rule**:

| Observation | Meaning | Do |
|-------------|---------|----|
| A rule loses about as many findings as its issues described | expected | nothing |
| A rule loses far more than its issues explain | an exemption is too wide | sample the lost findings (10, or all when fewer), classify each as false positive or real; any real one → narrow |
| A rule gains findings | a fix changed more than intended | sample and explain each kind |
| A rule not touched by the batch moves | a shared helper changed | find the helper, check every rule using it |

No corpus: say so in the PR, and give the breaker pass a larger budget instead.

---

## Closing the round

1. Every finding of passes 1–4 is fixed as a fixup or answered with evidence.
2. Trial autosquash, then the real one; `git rebase --exec` build on every
   commit; the full suite on the tip (`commits.md`).
3. Ledger: every fixed issue goes to `reviewed`.
4. Phase 8 of `SKILL.md`: push, PR, report.

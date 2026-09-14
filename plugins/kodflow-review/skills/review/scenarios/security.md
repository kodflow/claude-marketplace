<!-- scenario-contract v1
name: security
selects_when: --security flag, or a diff touching auth/crypto/secrets/network surface
lenses: [taint-source-to-sink, owasp-top-10, secrets, supply-chain, enforcement-completeness]
writes: .claude/plans/review-fixes-<timestamp>.md
engine: workflow
-->

# /review scenario — `security`

Deep security review. Selected by `--security` or when the diff touches an
auth / crypto / secrets / network surface.

## Lenses

| Lens | Focus |
|---|---|
| taint-source-to-sink | untrusted input → dangerous sink paths |
| owasp-top-10 | injection, broken auth, SSRF, etc. |
| secrets | hardcoded credentials / tokens / keys |
| supply-chain | dependency + build-step risk |
| enforcement-completeness | independent threat-model of every NEW security control (authenticity / freshness / input-robustness / fail-open-vs-closed), not verification of the diff's claims — see dimensions.md §Security (#397) |

Confirmed findings are written to a `review-fixes-<timestamp>` plan under
`.claude/plans/` for `/goal` execution. No disk writes outside that authorized dir.

# /review — Phases 3, 3.5, 3.7: deterministic scanning and blast radius

Everything mechanical, run for real with captured exit codes: linters, SAST,
SCA, secrets, IaC, build and tests, then the call graph and change-coupling that
bound the blast radius.

The tier table in the report is **generated from the captured output** of these
commands. Narrating a tier that was not executed is the exact failure the
external verifier exists to catch. `tool-absent` is a distinct result from `N/A`.

## Phase 3 — Deterministic Tiers (ENFORCED, table generated from captured output)

Each tool writes stdout+stderr to a temp `.out`; the final tier table is produced by
**parsing those files with jq/awk**, not by the model authoring numbers. Run only tools
matching languages/artifacts actually present in the diff.

```bash
DET=$(mktemp -d "${TMPDIR:-/tmp}/review-det.XXXXXX")
run() {                                   # run <tool> [args...]  (see review/deterministic.md for the canonical helper)
  local tool="$1"
  local label="$*"                          # FULL invocation -> go vet / go test / go build stay distinct rows
  local slug="${label//[^a-zA-Z0-9]/_}"     # unique per invocation -> .out files never collide
  if ! command -v "$tool" >/dev/null 2>&1; then
    printf '%s\tabsent\t\t0\n' "$label" >> "$DET/_table.tsv"; return 0
  fi
  local rc=0                                # `|| rc=$?` captures the real exit safely (no set -e abort, no $? clobber by wc)
  "$@" > "$DET/$slug.out" 2>&1 || rc=$?
  printf '%s\tran\t%s\t%s\n' "$label" "$rc" "$(wc -l <"$DET/$slug.out")" >> "$DET/_table.tsv"
}

# Idioms / static analysis (fire only on extensions present in diff)
run golangci-lint run ./...;  run go vet ./...;  run staticcheck ./...
run cargo clippy --all-targets -- -D warnings
run ruff check .;  run mypy .
run eslint .;  run tsc --noEmit
run clang-tidy <changed>;  run cppcheck --enable=all <changed>
run shellcheck <changed.sh>;  run actionlint;  run hadolint <Dockerfile>
run rubocop;  run phpstan analyse;  run detekt;  run swiftlint
# IaC
run checkov -d .;  run tflint;  run tfsec .;  run ansible-lint
run kube-linter lint .;  run kubeconform <manifests>;  run yamllint .
# Data / schema
run sqlfluff lint <changed.sql>;  run buf lint
# Security
run semgrep --config auto --error
run gitleaks detect --no-banner;  run trufflehog filesystem .;  run detect-secrets scan
# Supply chain (lockfiles always)
run osv-scanner -r .;  run trivy fs .;  run govulncheck ./...
# BUILD + EXISTING TESTS (catch breakage even with no CI)
run make test;  run go test ./...;  run cargo test;  run pytest -q
```

Then render the table programmatically:

```bash
awk -F'\t' '{printf "%-16s status=%s exit=%s findings=%s\n",$1,$2,$3,$4}' "$DET/_table.tsv"
```

```yaml
tier_status_model:                 # MUST appear in the report, generated from _table.tsv
  ran:    "tool executed; exit + finding count are REAL (parsed from .out)."
  absent: "tool not installed -> dimension marked 'unverified (tool absent)'. NOT a failure,
           NOT a pass. Surfaced LOUDLY. Does not by itself block convergence."
  na:     "tool not applicable to this diff's languages -> 'N/A (unsupported language)'."
  failed: "exit != 0 with findings -> findings ingested as FIRST-CLASS hard-blocking candidates."
  rules:
    - "Tool findings are deduped vs LLM findings; a tool-confirmed finding gets a confidence boost."
    - "CI / make test / make lint logs ingested as dual-validation hard blockers."
    - "A genuinely-applicable tool that is 'absent' lowers MAX achievable confidence for that
       dimension and is named in the report — but the run can still reach a valid (qualified) verdict."
```

External tiers (Qodo T2 — absent in default container, skip-with-note; CodeRabbit T3 —
requires `coderabbit auth login` first, probe `coderabbit auth status` before
`coderabbit review`): **read `tiers.md`**.

---

## Phase 3.5 — Call / Dependency Graph (bounded blast radius)

Diff-only review is the #1 source of missed bugs. For **every changed symbol** (function,
method, type, exported const, config key, CLI flag), enumerate callers/dependents across
the **whole repo**. AST-aware when available; otherwise git+rg. **Never use `sg`** —
`/usr/bin/sg` is `newgrp`, not ast-grep.

```bash
# Changed symbols: derive from git diff hunk headers (the @@ ... @@ context names the
# enclosing function for most languages) + added/removed signatures.
git diff "$BASE...$HEAD" -U0 | rg '^@@.*@@ (.+)$' -or '$1'

# Callers (prefer ast-grep IF installed; else ripgrep):
command -v ast-grep >/dev/null && ast-grep run -p 'DoThing($$$)' --lang go "$PROJECT_DIR"
rg -n --no-heading '\bDoThing\b' "$PROJECT_DIR"        # fallback / cross-lang
```

Caps (avoid context blowup): **max 40 changed symbols graphed**, **max 25 callers per
symbol** (record `+N more` as a count). For each: `{symbol, def_loc, callers:[file:line],
dependents:[...]}`. Verify the change does not break any caller's contract (arg
count/types, nullability, error semantics, ordering, side effects). A locally-correct
change that breaks a caller is **CRITICAL/HIGH** with the caller's `file:line` as evidence.

## Phase 3.7 — Change-Coupling (change-implies-change)

```bash
for f in $CHANGED_FILES; do
  git -C "$PROJECT_DIR" log --pretty=format: --name-only -- "$f" \
    | rg -v '^$' | sort | uniq -c | sort -rn | head
done
```

Flag the "absent change pattern": lib changed but its test / doc / migration / sibling
impl untouched -> probable missed edit (MEDIUM–HIGH, co-occurrence count as evidence).

---

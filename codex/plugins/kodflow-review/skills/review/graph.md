# Bounded Call-Graph / Blast-Radius + Change-Coupling (Phases 3.5 & 3.7)

> Read this module to execute **Phase 3.5 (Call/Dependency Graph)** and **Phase 3.7
> (Change-Coupling)** of `/review`. Diff-only review is the #1 source of missed bugs: a
> change that is locally correct can break a caller two files away, or silently skip the
> test/doc/migration that *always* moves with it. This module reaches what the diff
> *touches*, not just what it *shows* — under hard context caps so it never blows up.

---

## FOOTGUN — `sg` IS NOT ast-grep (read this first, every time)

```
/usr/bin/sg  ->  newgrp   (run-as-group; it will hang waiting on a group password / spawn a subshell)
```

`ast-grep`'s binary is invoked as **`ast-grep`** in this container, NEVER `sg`. The short
alias `sg` is a real, different system tool (`newgrp`). Calling `sg ...` here does not do an
AST search — at best it errors, at worst it opens an interactive subshell that stalls the
review. **Always type `ast-grep` in full. Never `sg`.** This is also a hard guardrail in
`SKILL.md`.

In THIS container `ast-grep` is **absent** -> the ripgrep fallback below is the live path.
The ast-grep path activates automatically only if a future image installs it.

---

## Phase 3.5 — Call / Dependency Graph (bounded blast radius)

### Inputs / preconditions

```yaml
inputs:
  PROJECT_DIR: "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"
  BASE: "diff.base from review-context.sh (merge-base sha)"
  HEAD: "diff.head sha"
  changed_files: "diff.files from review-context.sh, file_class from Phase 0.6"
scope: "code + config|iac (CLI flags, config keys count as symbols). generated|vendored|
        binary|lockfile|rename(pure) -> SKIP graphing (record blast_radius: 0, reason)."
```

> **WORKTREE mode — untracked files are IN SCOPE.** When `HEAD` is the `WORKTREE`
> sentinel (local `/review` on a dirty tree), `git diff BASE --` shows TRACKED changes
> only. A brand-new *uncommitted* file is invisible to that diff yet is part of the change
> under review. Enumerate it explicitly and treat it as a full added file:
> `git -C "$PROJECT_DIR" ls-files --others --exclude-standard` (untracked, non-ignored).
> Each such path MUST get a `manifest.files[]` entry (classified + graphed + macro/micro
> reviewed) exactly like a tracked add — otherwise it goes unreviewed while `uninspected`
> stays `[]`. The external verifier enforces this: in WORKTREE mode it re-enumerates the
> same `ls-files --others --exclude-standard` set and FAILS coverage for any untracked
> file missing from `manifest.files[]`. (`.gitignore`d files are out of scope by design.)

### Step 0 — Preflight: refs must be resolvable, else degrade to INCONCLUSIVE (C13)

`git diff "$BASE...$HEAD"` is only meaningful when **both refs resolve** and a **merge-base
exists**. A shallow clone (`checkout --depth=1`), a force-pushed/squashed base, or a
brand-new repo makes the range diff silently compare against an empty or garbage ref and
fabricate a blast radius. **Never run the diff with an empty/unresolvable ref** — detect
the condition first and degrade to a HONEST `INCONCLUSIVE` (Phase 8 hard-branches on it;
it must NEVER become APPROVE). Best-effort deepen once, then bail.

```bash
# Emit a structured INCONCLUSIVE signal. The STOP must run in the phase's own scope,
# NOT inside a helper — a `return` inside a `bail()` function would only return from
# that function and let the diff run anyway. So `inconclusive` only records; each call
# site stops with `{ ...; return 0 2>/dev/null || exit 0; }` (sourced => return,
# run directly => exit; never `die`).
inconclusive() {                            # inconclusive <reason>  (record only)
  printf '{"phase":"3.5","blast_radius_done":false,"verdict":"INCONCLUSIVE","reason":"%s"}\n' "$1" \
    > "$DET/graph_inconclusive.json"
  echo "[graph] INCONCLUSIVE — $1" >&2
}

# 1) Refs present? (Phase 0 assigns BASE/HEAD; empty => unresolved upstream.)
[ -n "${BASE:-}" ] && [ -n "${HEAD:-}" ] \
  || { inconclusive "BASE/HEAD unset (Phase 0 did not resolve refs)"; return 0 2>/dev/null || exit 0; }

# 2) Both refs exist as real commits? (force-push / squashed base / new repo => no.)
git -C "$PROJECT_DIR" rev-parse --verify --quiet "${BASE}^{commit}" >/dev/null \
  || { inconclusive "BASE '$BASE' unresolvable (force-push / squashed / unrelated)"; return 0 2>/dev/null || exit 0; }
git -C "$PROJECT_DIR" rev-parse --verify --quiet "${HEAD}^{commit}" >/dev/null \
  || { inconclusive "HEAD '$HEAD' unresolvable"; return 0 2>/dev/null || exit 0; }

# 3) Shallow clone => history truncated => merge-base/coupling unreliable. Deepen once
#    (bounded), then re-check; if still shallow, degrade rather than diff a partial tree.
if [ "$(git -C "$PROJECT_DIR" rev-parse --is-shallow-repository 2>/dev/null)" = "true" ]; then
  timeout 60 git -C "$PROJECT_DIR" fetch --deepen=200 --quiet 2>/dev/null || true
  if [ "$(git -C "$PROJECT_DIR" rev-parse --is-shallow-repository 2>/dev/null)" = "true" ]; then
    inconclusive "shallow clone — cannot resolve merge-base for blast-radius"
    return 0 2>/dev/null || exit 0
  fi
fi

# 4) A real merge-base must exist (the 3-dot range below depends on it).
git -C "$PROJECT_DIR" merge-base "$BASE" "$HEAD" >/dev/null 2>&1 \
  || { inconclusive "no merge-base between BASE and HEAD (unrelated histories)"; return 0 2>/dev/null || exit 0; }
```

Only once all four checks pass does the range diff in Step 1 run. The same guard protects
Phase 3.7 (change-coupling `git log`), which is equally meaningless on a truncated history.

### Step 1 — Extract the changed symbol set (must match the verifier's extraction)

The external verifier (`review-verify-manifest.sh`) recomputes this same set from git and
asserts `symbols_inspected ⊇ it`. Under-enumerate here and the run is INVALID. So extract a
**superset** from two sources and union them:

```bash
# (a) Enclosing-symbol names from -U0 hunk-header context (the text after the second @@).
#     Works for Go/C/C++/Java/Python/Rust/JS where the hunk header carries the def line.
git -C "$PROJECT_DIR" diff "$BASE...$HEAD" -U0 \
  | rg -o '^@@.*@@\s*(.+)$' -r '$1' \
  | rg -o '\b([A-Za-z_][A-Za-z0-9_]*)\s*\(' -r '$1' \
  | sort -u > "$DET/sym_hunkctx.txt"

# (b) Added/removed signatures + type/const/flag decls from the +/- lines themselves
#     (catches NEW defs, whose hunk header points at the file/prev symbol, not the new one).
#     NOTE: ripgrep honors only ONE --replace template per invocation (the last -r wins; it
#     CANNOT pair a distinct -r with each -e). So materialize the +/- lines once, then run
#     ONE rg pass per capture-shape (each with its own -r), and union the results.
git -C "$PROJECT_DIR" diff "$BASE...$HEAD" -U0 \
  | rg '^[+-]' | rg -v '^(\+\+\+|---)' > "$DET/_diff_pm.txt"
{
  # def names: keyword is non-capturing so the symbol is group 1
  rg -o -e '\b(?:func|def|fn|function|class|interface|type|struct|enum)\s+([A-Za-z_][A-Za-z0-9_]*)' \
        -r '$1' "$DET/_diff_pm.txt"
  # exported const/var/etc names
  rg -o -e '\b(?:const|let|var|public|private|static)\s+([A-Za-z_][A-Za-z0-9_]*)' \
        -r '$1' "$DET/_diff_pm.txt"
  # config keys / JSON / YAML — quoted AND bare keys. _diff_pm.txt lines keep their
  # leading +/- marker, so anchor on it (^[+-]) rather than ^\s* to capture forms like
  # `apiVersion:` or `foo = bar` without swallowing the diff sign into the symbol.
  rg -o -e '^[+-]\s*([A-Za-z0-9_.-]+)\s*[:=]' -r '$1' "$DET/_diff_pm.txt"
  rg -o -e '"([A-Za-z0-9_.-]+)"\s*[:=]'       -r '$1' "$DET/_diff_pm.txt"
  # CLI flags
  rg -o -e '(--[a-z][a-z0-9-]+)'         -r '$1' "$DET/_diff_pm.txt"
} 2>/dev/null | sort -u > "$DET/sym_decls.txt"   # any pass may match nothing (exit 1); harmless

sort -u "$DET/sym_hunkctx.txt" "$DET/sym_decls.txt" > "$DET/changed_symbols.txt"
```

```yaml
symbol_extraction:
  enum: [function, method, type/class, exported const/var, config key, CLI flag]
  note: |
    Over-extract on purpose. A spurious extra symbol costs one cheap rg sweep;
    a MISSING symbol fails the verifier (symbols_inspected must be a SUPERSET of
    the verifier's diff-derived set). When in doubt, include it.
  dedup: "lower-noise: drop language keywords, single-letter locals, and pure renames."
```

### Step 2 — Enumerate callers + dependents across the WHOLE repo

For **every** symbol in `changed_symbols.txt` (under the caps in Step 3), find its
definition and every reference. Prefer AST when present; otherwise ripgrep.

```bash
SYM="$1"   # one symbol from changed_symbols.txt
LANG="$2"  # go|rust|python|ts|tsx|js|c|cpp|java|...  (from the defining file's ext)

# --- Definition location -------------------------------------------------------
def_loc=$(rg -n --no-heading \
  -e "\b(func|def|fn|function|class|interface|type|struct|enum)\s+$SYM\b" \
  "$PROJECT_DIR" | head -1)

# --- Callers / dependents ------------------------------------------------------
if command -v ast-grep >/dev/null 2>&1; then
  # AST-aware: callers = call expressions; precise, no comment/string FPs.
  ast-grep run -p "$SYM(\$\$\$)" --lang "$LANG" "$PROJECT_DIR" --json=stream \
    | rg -o '"file":"[^"]+","range":\{"start":\{"line":[0-9]+' > "$DET/callers_$SYM.raw"
else
  # FALLBACK (live in this container): word-boundary grep, then split call vs ref.
  #   - call site (caller)  : symbol immediately followed by '('
  #   - non-call dependent  : import / type use / embed / subclass referencing symbol
  rg -n --no-heading -w "$SYM" "$PROJECT_DIR" \
     -g '!**/{vendor,node_modules,third_party,.venv,.git}/**' > "$DET/refs_$SYM.txt"
  rg -n '\b'"$SYM"'\s*\('      "$DET/refs_$SYM.txt" || true   # callers
  rg -nv '\b'"$SYM"'\s*\('     "$DET/refs_$SYM.txt" || true   # dependents (non-call refs)
fi
```

```yaml
fallback_caveats:                 # ripgrep is lexical, not semantic — state these honestly
  - "Same-name collisions across packages are NOT disambiguated -> mark such callers
     confidence:MEDIUM (Needs-Verification), never silently assert."
  - "Comments / strings / test fixtures can match -> exclude with -g globs; if unsure, demote."
  - "Method names shared by unrelated types over-count -> note in the record, do not drop."
  - "ast-grep path (when present) is exact and skips these caveats."
```

### Step 3 — HARD CAPS (bound the context; record what you truncate)

```yaml
graph_caps:                       # MUST mirror review.md budget.graph EXACTLY
  max_symbols: 40                 # graph at most 40 changed symbols
  max_callers_per_symbol: 25      # record at most 25 callers/dependents per symbol
  overflow: "record '+N more' as a COUNT (e.g. callers: [...25...], '+118 more')."
  symbol_overflow: ">40 changed symbols -> graph the 40 highest-risk first
                    (exported > public-API > hot-path/Phase-0.6 code > config keys),
                    list the remainder as 'symbols_ungraphed: [N]' in the manifest.
                    Truncation is RECORDED, never silent; it caps achievable confidence."
rationale: "+N more preserves the true blast-radius magnitude without echoing 100s of lines."
```

### Step 4 — Per-symbol record (binding schema)

Emit one record per graphed symbol; feeds `macro_per_file.blast_radius` (Phase 4) and the
coverage manifest (`blast_radius_done`).

```yaml
symbol_graph:
  - symbol: <pkg.Func | Class.method | config.key | --flag>
    def_loc: <file:line>                         # from Step 2; "unknown" allowed w/ reason
    change_kind: "signature | body | type | removed | added | renamed"
    callers:    [<file:line>, ...]               # call sites, <=25, then "+N more"
    dependents: [<file:line>, ...]               # non-call refs: imports, type uses,
                                                 #   interface impls, subclasses, embeds
    callers_truncated:    <N or 0>               # the '+N more' count
    dependents_truncated: <N or 0>
    contract_break: <see Step 5>                 # null when no break
```

### Step 5 — Contract-break check (the part that produces findings)

A change is locally correct yet repo-breaking when it alters the contract its callers
depend on. For **every signature/type/removed/renamed change**, diff the OLD vs NEW
declaration and check each caller against five contract axes:

```yaml
contract_axes:
  arg_count:      "param added/removed/reordered; new REQUIRED param without default."
  arg_types:      "param/return type narrowed or widened; nullability of a param changed."
  nullability:    "return may now be null/None/nil/Err where callers assume non-null;
                   or a param that was optional is now required."
  error_semantics:"function now returns/raises an error it didn't (or stops returning one);
                   error TYPE changed; panics/unwraps newly reachable from a caller."
  ordering:       "call-order / sequencing contract changed (init-before-use, must-close,
                   idempotency, returned-slice/iteration order callers rely on)."
  side_effects:   "new or removed mutation, I/O, lock acquisition, global-state write that
                   a caller's correctness depends on."

escalation:
  rule: |
    A locally-correct change that breaks ANY caller's contract is a real defect.
    For each broken caller emit a finding:
      severity: CRITICAL  # caller crashes / data-loss / breaks on a common path,
                          #   or breaks a PUBLIC/exported API or wire contract
                CRITICAL or HIGH otherwise (HIGH = breaks only under specific conditions)
      category: API/contract            # cross-tag per Severity model
      confidence: <decoupled>           # AST-confirmed call site -> high; rg-only -> demote
      evidence:
        broken_caller: <file:line>      # MANDATORY — the caller that now fails
        old_decl: <file:line of prior signature>
        new_decl: <file:line of new signature>
      counterexample: |                 # API/contract counterexample = the failing call site
        "<caller file:line> calls <sym>(<old args>); new sig requires <new args>
         -> compile error / runtime <NPE|wrong-arity|unhandled-err> at that line."
  decoupling: |
    Severity is set by IMPACT, never by confidence. If the fallback rg cannot PROVE the
    call binds to THIS symbol (name collision, dynamic dispatch), keep the severity and
    DEMOTE to 'Needs Verification' with the simulation trace — NEVER drop it. Any
    CRITICAL/HIGH that lands in Needs-Verification still gates the verdict (caps score <=3).
  not_a_break:
    - "All call sites updated in the SAME diff (verify each appears in changed_files)."
    - "A documented compat shim/overload preserves the old contract (cite its file:line)."
    - "Symbol is private/unexported AND every caller is inside the diff."
  exclusion_audit: "Marking a caller 'not broken' REQUIRES citing the updated call site or
                    shim line. An unjustified 'not broken' is itself a finding (anti-theater)."
```

---

## Phase 3.7 — Change-Coupling (change-implies-change)

Files that historically move together encode an implicit contract. When one moves without
its partner, that partner is a **probable missed edit** — the cheapest high-signal macro
check there is.

```bash
for f in $CHANGED_FILES; do
  echo "## coupled-with: $f"
  git -C "$PROJECT_DIR" log --pretty=format: --name-only -- "$f" \
    | rg -v '^$' \
    | rg -v "^$f\$" \
    | sort | uniq -c | sort -rn \
    | head -10                          # top co-changed files + their co-occurrence count
done > "$DET/coupling.txt"
```

### The "absent change pattern" (what to flag)

```yaml
absent_change_pattern:
  definition: "A file historically co-changes with a touched file (co-occurrence count
               high) but is NOT in this diff -> probable missed edit."
  high_signal_partners:               # the misses that matter most
    - "lib/impl changed  ->  its TEST file untouched           (probable missing test)"
    - "public behavior changed  ->  its DOC/README/CHANGELOG untouched   (doc drift)"
    - "schema/model changed  ->  no MIGRATION file added        (broken deploy)"
    - "one of a sibling pair changed  ->  the sibling impl untouched (e.g. *_linux.go w/o
       *_windows.go; encode without decode; client without server stub)."
  evidence_required: "the co-occurrence COUNT from git log (e.g. 'changed together 14/17
                      times') is the evidence — quantitative, not vibes."
  severity:
    HIGH:   "missing migration for a schema change; missing decode for a changed encode
             (correctness/deploy break)."
    MEDIUM: "missing test or doc update for a behavior change."
    confidence: "scales with co-occurrence ratio; low ratio (<50%) -> Needs Verification."
  false_positives:                    # demote, don't drop
    - "Partner already current (no behavior change needed) -> cite why; auditable exclusion."
    - "Historical coupling was incidental (e.g. a one-time mass rename) -> note + demote."
    - "Coupling below a min support (co-changed < 3 times total) -> ignore as noise."
```

```yaml
coupling_record:                      # feeds manifest.change_coupling_done
  - changed_file: <path>
    coupled_but_untouched:
      - partner: <path>
        cooccurrence: "<k>/<n> commits"
        kind: "test | doc | migration | sibling-impl | config"
        finding_id: <id or null>      # null = verified-current (with cited reason)
```

---

## Outputs (what this module hands back to the pipeline)

```yaml
emits:
  symbol_graph: [ ... ]               # Step 4 records -> macro_per_file.blast_radius
  contract_findings: [ ... ]          # Step 5 -> Phase 7 generate-then-filter (cat: API/contract)
  coupling_findings: [ ... ]          # Phase 3.7 -> Phase 7 (cat: Test/Docs/API/Migration)
  manifest_flags:
    blast_radius_done: true           # set ONLY after every in-scope symbol is graphed/capped
    change_coupling_done: true        # set ONLY after every changed file's coupling is mined
    symbols_inspected: [ "<sym@file:line>", ... ]   # MUST ⊇ verifier's diff-derived set
    symbols_ungraphed: <N>            # >40-cap overflow, recorded not hidden
```

The verifier (`review-verify-manifest.sh`) re-extracts changed symbols from git and FAILS
the run if `symbols_inspected` is not a superset. Keep Step-1 extraction a deliberate
superset so this never trips on a real, fully-inspected diff.

---

## Guardrails (quick reference)

| Action | Status |
|--------|--------|
| Use `sg` for AST search | FORBIDDEN — `/usr/bin/sg` is `newgrp`; type `ast-grep` in full |
| Graph > 40 symbols or > 25 callers without `+N more` / `ungraphed` count | FORBIDDEN (record truncation) |
| Drop a caller-breaking change for low (rg-only) confidence | FORBIDDEN (demote to gating Needs-Verification) |
| Emit a contract-break finding without the broken caller's `file:line` | FORBIDDEN (no evidence -> Judge rejects) |
| Mark a caller "not broken" without citing the updated call site / shim | FORBIDDEN (itself a finding) |
| Set `blast_radius_done`/`change_coupling_done` before the work ran | FORBIDDEN (verifier-checked) |
| Flag an absent-change without the git co-occurrence count | FORBIDDEN (count is the evidence) |
| Skip graphing because the diff "looks small" | FORBIDDEN (small diffs break callers too) |
| In WORKTREE mode, ignore untracked (uncommitted) non-ignored files | FORBIDDEN — enumerate `git ls-files --others --exclude-standard`; each needs a `manifest.files[]` entry or the verifier FAILS coverage |
| `git diff`/`git log` with an empty or unresolvable `BASE`/`HEAD` | FORBIDDEN — Step 0 preflight bails to INCONCLUSIVE first |
| Emit a blast radius from a shallow clone without deepening | FORBIDDEN — deepen once, else degrade to INCONCLUSIVE (C13) |
| `die`/non-zero abort on unresolvable refs | FORBIDDEN — degrade GRACEFULLY (`inconclusive` + scoped stop -> INCONCLUSIVE), never crash the review |

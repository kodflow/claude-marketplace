#!/usr/bin/env bash
# ============================================================================
# review-verify-manifest.sh - NON-LLM external verifier for /review (Phase 8)
# ----------------------------------------------------------------------------
# The keystone anti-theater gate. A model cannot APPROVE its own review: this
# script recomputes the coverage facts from git + the captured deterministic
# tier outputs, and INVALIDATES the run (nonzero exit) on any mismatch. The
# model defines neither the denominator of its coverage nor its own tier numbers.
#
# CONTRACT (from /review spec, Phase 8 + Anti-Theater Guardrails):
#   review-verify-manifest.sh --repo <dir> --base <sha> --head <sha> \
#                             --manifest <file.json> --det <det_dir>
#
# Tools used (only these are assumed present): git jq python3 sha256sum awk
# grep sed wc (coreutils). NO ast-grep, NO semgrep.
#
# CHECKS (each prints expected-vs-actual on mismatch):
#   1. diff-integrity   recompute diff_hash + hunks_total from the PINNED diff
#                       (C5: git -c core.autocrlf=false -c diff.renames=true
#                       -c diff.noprefix=false diff <range>); both MUST equal
#                       the manifest values.
#   2. coverage         a single python recomputation that enforces, PER FILE:
#                       - file-class (C2): re-derived from path/ext + git
#                         --numstat/--name-status; a manifest file_class that
#                         disagrees with the recomputed class FAILS. (config<->iac
#                         are interchangeable; .proto/.asn1/.asn => iac per C10.)
#                       - symbol-coverage (C1/C3): each code file's
#                         symbols_inspected MUST be a superset of THAT file's
#                         required symbols. Extraction strips comments, string
#                         literals and fenced ```code``` blocks, runs DEF_PATTERNS,
#                         and binds in-body edits to their ENCLOSING symbol
#                         (nearest preceding def / hunk-header context).
#                       - anti-paste (C1): reject any symbols_inspected token that
#                         contains a newline, exceeds 120 chars, looks like a diff
#                         ('@@'), or carries >12 identifiers (a pasted line/diff).
#                       - hunk-accounting (C4): each file's hunks MUST equal the
#                         git per-file @@ count AND sum(files[].hunks)==hunks_total.
#                       - untracked-coverage (WORKTREE only): a brand-new
#                         uncommitted file is invisible to 'git diff BASE --',
#                         so it would go unreviewed while uninspected stays [].
#                         When HEAD==WORKTREE every 'git ls-files --others
#                         --exclude-standard' path MUST appear in manifest.files[]
#                         or coverage FAILS.
#   3. tier-authenticity each manifest.tiers[] entry with status ran|failed MUST
#                       map to a real captured .out file in DET, and its recorded
#                       exit/findings MUST match what is parsed from that .out
#                       (cross-checked against DET/_table.tsv). Fabricated tier
#                       numbers FAIL.
#   4. pass-completeness no file with file_class in {code,config,iac} may have
#                       macro_pass=false, or a missing/false micro_pass.
#   5. doc-sync         (STRUCTURAL, exit 1 like 1-4) recompute, from the pinned
#                       diff's changed file paths, the set of TOUCHED directories +
#                       ALL ancestor directories up to the repo root; derive
#                       <dir>/CLAUDE.md for each ("CLAUDE.md" for the repo root) and
#                       require manifest.doc_sync.claude_md[] to list that path with
#                       status in {updated,created,current}. A required CLAUDE.md
#                       that is absent, or present with any other status, FAILS. This
#                       keeps every touched folder's CLAUDE.md iso with the change
#                       (/warmup:update semantics) for future review iterations.
#                       Scope is touched-folders+ancestors, NOT the whole repo.
#                       SCOPE NOTE: doc-sync is a CLAUDE.md-ONLY structural gate.
#                       manifest.doc_sync.docs[] (README/OpenAPI/changelog) is
#                       ADVISORY only and intentionally NOT gated here: unlike
#                       <dir>/CLAUDE.md (deterministically derivable from touched
#                       dirs), the set of human docs a given code change "should"
#                       update has no ground truth the verifier can recompute, so
#                       gating it would be unsound (false pass/FAIL). Human-doc
#                       staleness stays a reviewer-judgment dimension, not a
#                       mechanical gate.
#   6. approve-eligible manifest.uninspected MUST be [] AND manifest.canary_artifact
#                       MUST point at a REAL canary JSON artifact (C6) whose
#                       {seeded:true, detected:true}. The verifier READS the
#                       artifact (not a bare "passed" string). When only this
#                       check fails (structure 1-5 sound) the script prints a
#                       distinct 'NOT APPROVE-ELIGIBLE' note but STILL exits
#                       nonzero so the model cannot emit APPROVE.
#
# EXIT CODES:
#   0  VERIFIER: PASS  (all checks pass; run is valid AND approve-eligible)
#   1  VERIFIER: FAIL  (a structural check [1-5, incl. doc-sync] failed -> run is INVALID)
#   2  VERIFIER: FAIL (approve-eligibility) (structural checks sound but canary not
#                      detected or uninspected non-empty -> valid run, NOT
#                      approve-eligible)
#   3  usage / argument / environment error
#
# Final machine line is always one of:
#   VERIFIER: PASS
#   VERIFIER: FAIL (<check>)
# ============================================================================

set -euo pipefail

PROG="$(basename "$0")"

# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------
pass()  { printf '[PASS] %s\n' "$*"; }
fail()  { printf '[FAIL] %s\n' "$*"; }
info()  { printf '[ ..]  %s\n' "$*"; }
die()   { printf '%s: error: %s\n' "$PROG" "$*" >&2; exit 3; }

usage() {
  cat <<EOF
$PROG - non-LLM coverage-manifest verifier for /review (anti-theater gate)

USAGE:
  $PROG --repo <dir> --base <sha> --head <sha> --manifest <file.json> --det <det_dir>
  $PROG --repo <dir> --base <sha> --head <sha> --print-facts

ARGUMENTS:
  --repo <dir>          git repository the review ran against
  --base <sha>          base ref/sha of the reviewed range
  --head <sha>          head ref/sha of the reviewed range, OR the sentinel
                        WORKTREE to review the uncommitted working tree vs BASE
  --manifest <file>     coverage manifest JSON emitted by the review run
  --det <det_dir>       directory of captured deterministic tier .out files
                        (and the DET/_table.tsv produced by the tier runner)
  --print-facts         print canonical {diff_hash, hunks_total} as JSON and
                        exit 0 (manifest/det not required); the model copies
                        these verbatim instead of recomputing (avoids RTK drift)
  -h, --help            show this help and exit

EXIT: 0 PASS | 1 INVALID run | 2 not approve-eligible | 3 usage/env error
EOF
}

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
REPO="" BASE="" HEAD="" MANIFEST="" DET="" PRINT_FACTS=0

while [ $# -gt 0 ]; do
  case "$1" in
    --repo)        REPO="${2:-}";     shift 2 || die "--repo needs a value" ;;
    --base)        BASE="${2:-}";     shift 2 || die "--base needs a value" ;;
    --head)        HEAD="${2:-}";     shift 2 || die "--head needs a value" ;;
    --manifest)    MANIFEST="${2:-}"; shift 2 || die "--manifest needs a value" ;;
    --det)         DET="${2:-}";      shift 2 || die "--det needs a value" ;;
    # --print-facts: compute the canonical diff_hash + hunks_total from git and
    # print them as JSON, then exit. The model copies these into the manifest
    # INSTEAD of computing them itself — closing the RTK-rewrite divergence
    # (the model's `git diff` is rewritten by the RTK PreToolUse hook, this
    # script's internal `git diff` is not). Only --repo/--base/--head needed.
    --print-facts) PRINT_FACTS=1;     shift ;;
    -h|--help)     usage; exit 0 ;;
    *)             usage >&2; die "unknown argument: $1" ;;
  esac
done

[ -n "$REPO" ]     || { usage >&2; die "--repo is required"; }
[ -n "$BASE" ]     || { usage >&2; die "--base is required"; }
[ -n "$HEAD" ]     || { usage >&2; die "--head is required"; }
if [ "$PRINT_FACTS" -eq 0 ]; then
  [ -n "$MANIFEST" ] || { usage >&2; die "--manifest is required"; }
  [ -n "$DET" ]      || { usage >&2; die "--det is required"; }
fi

# ---------------------------------------------------------------------------
# Environment validation
# ---------------------------------------------------------------------------
for t in git jq python3 sha256sum awk grep sed wc; do
  command -v "$t" >/dev/null 2>&1 || die "required tool not found: $t"
done

[ -d "$REPO" ]      || die "repo dir does not exist: $REPO"
git -C "$REPO" rev-parse --git-dir >/dev/null 2>&1 || die "not a git repo: $REPO"
if [ "$PRINT_FACTS" -eq 0 ]; then
  [ -f "$MANIFEST" ]  || die "manifest file not found: $MANIFEST"
  jq -e . "$MANIFEST" >/dev/null 2>&1 || die "manifest is not valid JSON: $MANIFEST"
  [ -d "$DET" ]       || die "det dir does not exist: $DET"
fi

if ! git -C "$REPO" rev-parse --verify --quiet "${BASE}^{commit}" >/dev/null; then
  # C13: an unresolvable BASE (shallow clone / pruned ref) is an environment
  # condition, not a model fault. Exit 3 so the caller (review.md Phase 8, C8)
  # routes it to INCONCLUSIVE — never APPROVE, never a hard INVALID verdict.
  die "base ref not resolvable in repo (shallow clone?): $BASE"
fi
# HEAD may be the sentinel WORKTREE / WORKING-TREE — meaning "review the
# uncommitted working tree against BASE" (the common local `/review` on a dirty
# tree). In that mode there is no HEAD commit to resolve.
case "$HEAD" in
  WORKTREE|WORKING-TREE) HEAD_IS_WORKTREE=1 ;;
  *)
    HEAD_IS_WORKTREE=0
    if ! git -C "$REPO" rev-parse --verify --quiet "${HEAD}^{commit}" >/dev/null; then
      die "head ref not resolvable in repo: $HEAD"
    fi ;;
esac

# ---------------------------------------------------------------------------
# C5 - the ONE pinned diff command, used EVERYWHERE identically (diff_hash,
# hunk count, symbol/class/hunk recomputation, --print-facts). Pinned flags
# (no autocrlf rewrite, rename detection on, default a/ b/ prefixes) remove
# git-config / platform drift so the byte stream — and its sha256 — is stable.
# WORKTREE mode diffs BASE against the working tree (tracked changes only).
# Untracked, non-ignored files are INVISIBLE to this diff, so a brand-new
# uncommitted file would never enter `order` and could go unreviewed while
# coverage looks complete. Check 2 closes that blind spot by separately
# enumerating `git ls-files --others --exclude-standard` and requiring each
# such file to appear in manifest.files[] (see check_coverage).
# ---------------------------------------------------------------------------
pinned_diff() {
  # $@ = extra diff args (e.g. --numstat, --name-status); none = full patch.
  if [ "$HEAD_IS_WORKTREE" -eq 1 ]; then
    git -C "$REPO" -c core.autocrlf=false -c diff.renames=true -c diff.noprefix=false \
        diff "$@" "${BASE}" --
  else
    git -C "$REPO" -c core.autocrlf=false -c diff.renames=true -c diff.noprefix=false \
        diff "$@" "${BASE}...${HEAD}"
  fi
}

WORK="$(mktemp -d "${TMPDIR:-/tmp}/review-verify.XXXXXX")"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

DIFF_FILE="$WORK/diff.patch"
NUMSTAT_FILE="$WORK/numstat.tsv"
NAMESTATUS_FILE="$WORK/namestatus.tsv"
# UNTRACKED_FILE: WORKTREE-only list of untracked, non-ignored files (invisible
# to the diff). CLASS_TSV: per-path file_class RE-DERIVED by the coverage python,
# consumed by check_pass_completeness so check 4 never trusts the manifest's own
# file_class (anti-theater: a code file mislabeled docs/generated can't dodge the
# macro/micro gate).
UNTRACKED_FILE="$WORK/untracked.txt"
CLASS_TSV="$WORK/recomputed_class.tsv"
: > "$UNTRACKED_FILE"
: > "$CLASS_TSV"
pinned_diff               > "$DIFF_FILE"
pinned_diff --numstat     > "$NUMSTAT_FILE"
pinned_diff --name-status > "$NAMESTATUS_FILE"

# --print-facts: emit the authoritative diff_hash + hunks_total and exit 0.
# The model MUST copy these verbatim into the manifest rather than recompute
# them (its own `git diff` runs through the RTK rewrite and would diverge).
if [ "$PRINT_FACTS" -eq 1 ]; then
  pf_hash="$(sha256sum < "$DIFF_FILE" | awk '{print tolower($1)}')"
  pf_hunks="$(awk '/^@@/ {n++} END {print n+0}' "$DIFF_FILE")"
  jq -n --arg h "$pf_hash" --argjson n "$pf_hunks" --arg head "$HEAD" \
        '{diff_hash:$h, hunks_total:$n, head:$head}'
  exit 0
fi

# WORKTREE blind-spot: untracked, non-ignored files never enter `git diff BASE`,
# so they must be enumerated separately and fed through the SAME class+symbol
# coverage recomputation as diff-backed files (not just checked for manifest
# presence). See check_coverage's python untracked sub-check.
if [ "$HEAD_IS_WORKTREE" -eq 1 ]; then
  git -C "$REPO" ls-files --others --exclude-standard > "$UNTRACKED_FILE" 2>/dev/null \
    || : > "$UNTRACKED_FILE"
fi

printf '== review-verify-manifest ==\n'
printf 'repo=%s base=%s head=%s\n' "$REPO" "$BASE" "$HEAD"
printf 'manifest=%s det=%s\n\n' "$MANIFEST" "$DET"

# Accumulators. set -e safe: we never `exit` from a check, only flag.
STRUCT_FAILS=()           # names of failed structural checks (1-4)
ELIG_OK=1                 # 1 = approve-eligible, 0 = not
ELIG_REASON=""

# ===========================================================================
# CHECK 1 - diff-integrity (recompute diff_hash + hunks_total from pinned diff)
# ===========================================================================
check_diff_integrity() {
  local ok=1

  # --- diff_hash ---
  local actual_hash mani_hash
  actual_hash="$(sha256sum < "$DIFF_FILE" | awk '{print tolower($1)}')"
  mani_hash="$(jq -r '.diff_hash // ""' "$MANIFEST" \
    | awk '{ if (match($0,/[0-9a-fA-F]{64}/)) print tolower(substr($0,RSTART,64)) }')"

  if [ -z "$mani_hash" ]; then
    fail "diff-integrity: manifest.diff_hash missing or not a sha256"
    ok=0
  elif [ "$mani_hash" != "$actual_hash" ]; then
    fail "diff-integrity: diff_hash mismatch"
    printf '       expected (git): %s\n' "$actual_hash"
    printf '       actual (manifest): %s\n' "$mani_hash"
    ok=0
  else
    pass "diff-integrity: diff_hash matches ($actual_hash)"
  fi

  # --- hunks_total (count of hunk headers '^@@') ---
  local actual_hunks mani_hunks
  actual_hunks="$(awk '/^@@/ {n++} END {print n+0}' "$DIFF_FILE")"
  mani_hunks="$(jq -r 'if has("hunks_total") then (.hunks_total|tostring) else "" end' "$MANIFEST")"

  if [ -z "$mani_hunks" ] || [ "$mani_hunks" = "null" ]; then
    fail "diff-integrity: manifest.hunks_total missing"
    ok=0
  elif ! printf '%s' "$mani_hunks" | awk '/^[0-9]+$/{exit 0} {exit 1}'; then
    fail "diff-integrity: manifest.hunks_total is not an integer ($mani_hunks)"
    ok=0
  elif [ "$mani_hunks" != "$actual_hunks" ]; then
    fail "diff-integrity: hunks_total mismatch"
    printf '       expected (git): %s\n' "$actual_hunks"
    printf '       actual (manifest): %s\n' "$mani_hunks"
    ok=0
  else
    pass "diff-integrity: hunks_total matches ($actual_hunks)"
  fi

  [ "$ok" -eq 1 ] || STRUCT_FAILS+=("diff-integrity")
}

# ===========================================================================
# CHECK 2 - coverage (single python recomputation, PER FILE):
#   file-class (C2) + symbol-coverage (C1/C3) + anti-paste (C1) + hunks (C4)
#   + untracked-coverage (WORKTREE-only, bash) for files invisible to the diff.
# Language-agnostic, best-effort, tolerant. All set logic in python3.
# Python prints its own [PASS]/[FAIL] lines and a final machine line
#   __FAILS__ name1,name2,...
# listing the failed sub-checks (empty = all passed). It always exits 0 on a
# clean run; a nonzero/absent machine line is treated as an internal error.
# ===========================================================================
check_coverage() {
  local out="$WORK/cov.out" pyrc=0
  set +e
  python3 - "$DIFF_FILE" "$NUMSTAT_FILE" "$NAMESTATUS_FILE" "$MANIFEST" "$REPO" \
            "$UNTRACKED_FILE" "$CLASS_TSV" \
      > "$out" 2>&1 <<'PY'
import sys, json, re, os

diff_path, numstat_path, namestatus_path, manifest_path, repo = sys.argv[1:6]
untracked_path = sys.argv[6] if len(sys.argv) > 6 else ""
class_tsv_path = sys.argv[7] if len(sys.argv) > 7 else ""

# Multi-language keyword / primitive stoplist: NOT symbols, must never enter the
# REQUIRED set (else generic "name before (" or control-statement contexts would
# force false failures).
KEYWORDS = {
    "if","for","while","switch","return","else","elif","do","case","default",
    "func","def","function","fn","sub","class","struct","interface","trait",
    "enum","impl","type","typedef","namespace","module","package","protocol",
    "record","object","public","private","protected","static","final","async",
    "await","virtual","override","abstract","sealed","partial","readonly",
    "internal","friend","inline","extern","register","volatile","constexpr",
    "noexcept","template","typename","decltype","auto","using","import","from",
    "export","where","with","try","catch","except","finally","throw","throws",
    "raise","match","when","select","go","defer","chan","range","in","is","as",
    "and","or","not","lambda","pub","mut","ref","new","delete","goto","break",
    "continue","yield","assert","sizeof","typeof","operator","unsafe","extends",
    "implements","void","const","let","var","val","true","false","nil","null",
    "none","self","this","super","base","int","uint","float","double","char",
    "bool","byte","rune","short","long","signed","unsigned","string","str",
    "error","any","dynamic","print","println","echo",
}

DEF_PATTERNS = [
    r'\bfunc\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)',                          # Go
    r'\bdef\s+([A-Za-z_]\w*)',                                            # Python/Ruby
    r'\bfunction\s+\*?\s*([A-Za-z_]\w*)',                                 # JS/PHP
    r'\bfn\s+([A-Za-z_]\w*)',                                             # Rust
    r'\bsub\s+([A-Za-z_]\w*)',                                            # Perl
    r'\b(?:class|struct|interface|trait|impl|enum|type|namespace|'
    r'module|protocol|record|object)\s+([A-Za-z_]\w*)',                   # many
]
ident_re = re.compile(r'[A-Za-z_]\w*')

def strip_noise(text):
    """C3: strip block comments, string literals, and trailing line comments
    BEFORE applying DEF_PATTERNS so a `def foo` inside a string/comment never
    becomes a required symbol (and so docs/comment edits do not false-FAIL)."""
    text = re.sub(r'/\*.*?\*/', ' ', text)            # /* ... */ (single-line)
    text = re.sub(r'"(?:\\.|[^"\\])*"', ' ', text)    # "double" strings
    text = re.sub(r"'(?:\\.|[^'\\])*'", ' ', text)    # 'single' strings
    text = re.sub(r'`(?:\\.|[^`\\])*`', ' ', text)    # `backtick` strings
    for mark in ('//', '#'):                          # line comments
        i = text.find(mark)
        if i != -1:
            text = text[:i]
    return text

def names_from_text(text, signatures_only=False):
    text = strip_noise(text)
    found = set(); matched = False
    for p in DEF_PATTERNS:
        for m in re.finditer(p, text):
            found.add(m.group(1)); matched = True
    if signatures_only:
        if not matched:
            return set()
    elif not matched:
        # hunk-context fallback: identifier immediately before '(' — the
        # enclosing function git emits for C/C++/Java/C#/... section headers.
        m = re.search(r'([A-Za-z_]\w*)\s*\(', text)
        if m:
            found.add(m.group(1))
    return {n for n in found if len(n) > 1 and n.lower() not in KEYWORDS}

def norm(p):
    p = p.strip()
    if p.startswith('a/') or p.startswith('b/'):
        return p[2:]
    return p

# --- parse the pinned diff into per-file hunks ---
files = {}     # newpath(normalized) -> {'hunks':[{'ctx','lines'}], 'count'}
order = []
cur = None
def newfile(p):
    global cur
    if p not in files:
        files[p] = {'hunks': [], 'count': 0}
        order.append(p)
    cur = p
def rename_cur(np):
    global cur
    if cur is not None and np != cur:
        files[np] = files.pop(cur)
        order[order.index(cur)] = np
        cur = np

try:
    with open(diff_path, encoding="utf-8", errors="replace") as fh:
        for raw in fh:
            line = raw.rstrip('\n')
            if line.startswith('diff --git '):
                m = re.match(r'^diff --git (.+) (.+)$', line)
                if m:
                    a, b = norm(m.group(1)), norm(m.group(2))
                    newfile(b if b not in ('dev/null', '/dev/null') else a)
                else:
                    newfile(line)
            elif line.startswith('+++ '):
                p = line[4:].strip()
                if p not in ('/dev/null', 'dev/null'):
                    rename_cur(norm(p))
            elif line.startswith('@@'):
                if cur is None:
                    continue
                m = re.match(r'^@@[^@]*@@(.*)$', line)
                files[cur]['hunks'].append({'ctx': m.group(1) if m else '', 'lines': []})
                files[cur]['count'] += 1
            elif line.startswith('+') and not line.startswith('+++'):
                if cur and files[cur]['hunks']:
                    files[cur]['hunks'][-1]['lines'].append(('+', line[1:]))
            elif line.startswith('-') and not line.startswith('---'):
                if cur and files[cur]['hunks']:
                    files[cur]['hunks'][-1]['lines'].append(('-', line[1:]))
            elif line.startswith(' '):
                # context line — kept so an in-body edit can be bound to its
                # nearest preceding def even when that def line is unchanged.
                if cur and files[cur]['hunks']:
                    files[cur]['hunks'][-1]['lines'].append((' ', line[1:]))
            # '\ No newline at end of file' and headers are ignored.
except OSError as e:
    print("coverage: cannot read diff: %s" % e)
    print("__FAILS__ coverage-internal")
    sys.exit(0)

# --- numstat -> binary set (added '-' deleted '-') ---
def clean_numstat_path(p):
    if '=>' in p:
        p = re.sub(r'\{[^{}]*=> ?([^{}]*)\}', r'\1', p)
        if '=>' in p:
            p = p.split('=>')[-1].strip()
        p = p.replace('//', '/')
    return p.strip()

binary = set()
try:
    with open(numstat_path, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            parts = line.rstrip('\n').split('\t')
            if len(parts) >= 3 and parts[0] == '-' and parts[1] == '-':
                binary.add(norm(clean_numstat_path(parts[2])))
except OSError:
    pass

# --- name-status -> per-path (status-code, similarity) ---
status = {}
try:
    with open(namestatus_path, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            parts = line.rstrip('\n').split('\t')
            if not parts or not parts[0]:
                continue
            code = parts[0]
            if code[:1] in ('R', 'C') and len(parts) >= 3:
                sim = int(re.sub(r'\D', '', code) or '0')
                status[norm(parts[2])] = (code[:1], sim)
            elif len(parts) >= 2:
                status[norm(parts[1])] = (code[:1], 0)
except OSError:
    pass

LOCK = {'package-lock.json','yarn.lock','pnpm-lock.yaml','cargo.lock','go.sum',
        'poetry.lock','gemfile.lock','composer.lock'}

def generated_marker(path):
    fp = os.path.join(repo, path)
    try:
        with open(fp, encoding="utf-8", errors="replace") as f:
            head = "".join(f.readline() for _ in range(5)).lower()
    except OSError:
        return False
    return any(k in head for k in
               ('do not edit', 'autogenerated', '@generated', 'code generated by'))

def classify(path):
    blow = os.path.basename(path).lower()
    plow = path.lower()
    ext = blow.rsplit('.', 1)[-1] if '.' in blow else ''
    st = status.get(path)
    if path in binary:
        return 'binary'
    if st and st[0] == 'R' and st[1] == 100:
        return 'rename'
    if blow in LOCK:
        return 'lockfile'
    if re.search(r'(_generated\.|\.pb\.go$|\.pb\.|_pb2\.py$|\.gen\.)', plow) \
       or re.search(r'(^|/)openapi', plow) or generated_marker(path):
        return 'generated'
    if re.search(r'(^|/)(vendor|node_modules|third_party|\.venv|Pods|\.cargo)/', path):
        return 'vendored'
    # C10: .proto / .asn1 / .asn classified like iac so the wire-break
    # micro_per_hunk checklist (field renumber, required<->optional, ETSI/3GPP
    # X1/X2/X3) is reachable.
    if ext in ('tf', 'tfvars', 'hcl', 'proto', 'asn1', 'asn'):
        return 'iac'
    if blow == 'dockerfile' or blow.endswith('.dockerfile') or plow.endswith('/dockerfile'):
        return 'iac'
    if re.search(r'(^|/)(k8s|helm|charts|ansible)/', path) or '/.github/workflows/' in '/' + path:
        return 'iac'
    if ext in ('json','yaml','yml','toml','ini','env','properties','conf','cfg'):
        return 'config'
    if ext in ('md','rst','txt','adoc') or re.search(r'(^|/)docs/', path):
        return 'docs'
    return 'code'

def class_ok(recomputed, declared):
    if recomputed == declared:
        return True
    cfg = {'config', 'iac'}            # interchangeable (identical coverage tier)
    return recomputed in cfg and declared in cfg

# --- manifest ---
try:
    with open(manifest_path, encoding="utf-8", errors="replace") as fh:
        man = json.load(fh)
except (OSError, ValueError) as e:
    print("coverage: cannot read manifest: %s" % e)
    print("__FAILS__ coverage-internal")
    sys.exit(0)

mfiles = {}            # normpath -> set(tokens)
manifest_class = {}    # normpath -> declared class
manifest_hunks = {}    # normpath -> declared hunks
antipaste = []
for f in (man.get("files") or []):
    p = norm(str(f.get("path", "")))
    toks = set()
    for s in (f.get("symbols_inspected") or []):
        s = str(s)
        st_toks = ident_re.findall(s)
        if ('\n' in s) or (len(s) > 120) or ('@@' in s) or (len(st_toks) > 12):
            antipaste.append((p, s.replace('\n', '\\n')[:80]))
        toks.update(st_toks)
    mfiles[p] = toks
    manifest_class[p] = f.get("file_class")
    manifest_hunks[p] = f.get("hunks")

recomputed = {p: classify(p) for p in order}

# --- WORKTREE untracked files (invisible to the diff) -------------------------
# A brand-new uncommitted file never enters `order`, so without this it could
# fake-pass by being declared (e.g.) docs/generated with micro_pass "N/A" while
# its real source goes unreviewed. Feed each through the SAME recomputation:
#   * re-derive file_class from path/content (so a mislabel is caught here);
#   * for code files, require symbols_inspected to cover the file's top-level
#     defs (the whole new file is "changed", so every def is in scope).
untracked = []
if untracked_path and os.path.exists(untracked_path):
    try:
        with open(untracked_path, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                up = norm(line.strip())
                if up:
                    untracked.append(up)
    except OSError:
        pass

untracked_class = {up: classify(up) for up in untracked}
untracked_req = {}
for up in untracked:
    if untracked_class[up] != 'code':
        continue
    req = set()
    try:
        with open(os.path.join(repo, up), encoding="utf-8", errors="replace") as f:
            for raw in f:
                req |= names_from_text(raw, signatures_only=True)
    except OSError:
        pass
    untracked_req[up] = req

# Emit the RE-DERIVED class for every diff-backed AND untracked path so
# check_pass_completeness (check 4) gates on the recomputed class, never the
# manifest's self-declared file_class.
if class_tsv_path:
    try:
        with open(class_tsv_path, "w", encoding="utf-8") as cf:
            for p in order:
                cf.write("%s\t%s\n" % (p, recomputed[p]))
            for up in untracked:
                cf.write("%s\t%s\n" % (up, untracked_class[up]))
    except OSError:
        pass

# --- sub-check: file-class (C2) ---
class_fail = []
for p in order:
    dec = manifest_class.get(p)
    if dec is None:
        continue   # missing entry caught by hunk-accounting
    if not class_ok(recomputed[p], dec):
        class_fail.append((p, recomputed[p], dec))

# --- sub-check: symbol-coverage (C1/C3) — only code files ---
sym_fail = []
total_required = 0
for p in order:
    if recomputed[p] != 'code':
        continue
    req = set()
    in_fence = False
    for h in files[p]['hunks']:
        # The hunk-header context git emits is the section heading (usually the
        # enclosing decl) — seed it as the nearest preceding def.
        ctx_defs = names_from_text(h['ctx'], signatures_only=False)
        req |= ctx_defs
        last_def = next(iter(ctx_defs)) if ctx_defs else None
        for kind, raw in h['lines']:
            t = raw.strip()
            if t.startswith('```'):                # C3: skip fenced code blocks
                in_fence = not in_fence
                continue
            if in_fence or not t:
                continue
            d = names_from_text(raw, signatures_only=True)
            if d:
                # this line is itself a definition (added/removed/context)
                req |= d if kind in ('+', '-') else set()
                last_def = sorted(d)[0]
            elif kind in ('+', '-'):
                # in-body edit: bind it to the nearest preceding def (C3)
                if last_def is not None:
                    req.add(last_def)
    if not req:
        continue
    total_required += len(req)
    toks = mfiles.get(p)
    if toks is None:
        sym_fail.append((p, "NO MANIFEST ENTRY", sorted(req)[:20]))
        continue
    missing = sorted(n for n in req if n not in toks)
    if missing:
        sym_fail.append((p, "missing", missing[:20]))

# --- sub-check: hunk-accounting (C4) ---
hunk_fail = []
for p in order:
    if p not in manifest_hunks:
        hunk_fail.append((p, "not in manifest", files[p]['count'], None))
        continue
    mh = manifest_hunks[p]
    if mh != files[p]['count']:
        hunk_fail.append((p, "per-file count", files[p]['count'], mh))
htotal = man.get("hunks_total")
sum_manifest = sum(v for v in manifest_hunks.values() if isinstance(v, int))
sum_mismatch = isinstance(htotal, int) and sum_manifest != htotal

# --- sub-check: untracked-coverage (WORKTREE) — real class+symbol gate ---
untracked_fail = []
for up in untracked:
    toks = mfiles.get(up)
    if toks is None:
        untracked_fail.append((up, "absent from manifest.files[]", []))
        continue
    dec = manifest_class.get(up)
    if dec is not None and not class_ok(untracked_class[up], dec):
        untracked_fail.append(
            (up, "file-class recomputed=%s manifest=%s" % (untracked_class[up], dec), []))
    req = untracked_req.get(up, set())
    if req:
        missing = sorted(n for n in req if n not in toks)
        if missing:
            untracked_fail.append((up, "symbols missing", missing[:20]))

# --- report ---
fails = []

if class_fail:
    print("[FAIL] file-class: recomputed class disagrees with manifest:")
    for p, rc, dec in class_fail:
        print("        %s: recomputed=%s manifest=%s" % (p, rc, dec))
    fails.append("file-class")
else:
    print("[PASS] file-class: all declared file_class match the recomputed class")

if sym_fail:
    print("[FAIL] symbol-coverage: per-file under-enumeration of changed symbols:")
    for p, why, names in sym_fail:
        print("        %s (%s): %s" % (p, why, ", ".join(names)))
    fails.append("symbol-coverage")
else:
    print("[PASS] symbol-coverage: every code file's symbols_inspected covers its "
          "%d required symbol(s)" % total_required)

if antipaste:
    print("[FAIL] anti-paste: symbols_inspected holds diff-like / oversized token(s):")
    for p, s in antipaste[:20]:
        print("        %s: \"%s\"" % (p, s))
    fails.append("anti-paste")
else:
    print("[PASS] anti-paste: symbols_inspected tokens are clean (no diff paste)")

if hunk_fail or sum_mismatch:
    print("[FAIL] hunk-accounting: per-file hunks / sum disagree with git:")
    for p, why, actual, declared in hunk_fail:
        print("        %s (%s): git=%s manifest=%s" % (p, why, actual, declared))
    if sum_mismatch:
        print("        sum(files[].hunks)=%s != hunks_total=%s" % (sum_manifest, htotal))
    fails.append("hunk-accounting")
else:
    print("[PASS] hunk-accounting: per-file hunks match git and sum==hunks_total")

if untracked_fail:
    print("[FAIL] untracked-coverage: WORKTREE untracked file(s) under-covered "
          "(real class+symbol gate, not mere manifest presence):")
    for up, why, names in untracked_fail:
        print("        %s (%s): %s" % (up, why, ", ".join(names)))
    fails.append("untracked-coverage")
elif untracked:
    print("[PASS] untracked-coverage: all %d untracked WORKTREE file(s) pass "
          "class+symbol coverage" % len(untracked))

print("__FAILS__ " + ",".join(fails))
sys.exit(0)
PY
  pyrc=$?
  set -e

  # echo python's human-readable lines (everything but the machine line)
  grep -v '^__FAILS__ ' "$out" || true

  if ! grep -q '^__FAILS__ ' "$out"; then
    fail "coverage: internal verifier error (python rc=$pyrc, no result line)"
    STRUCT_FAILS+=("coverage-internal")
    return 0
  fi

  local fl
  fl="$(grep '^__FAILS__ ' "$out" | tail -1 | sed 's/^__FAILS__ //')"
  if [ -n "$fl" ]; then
    local oldifs="$IFS" name
    IFS=','
    for name in $fl; do
      [ -n "$name" ] && STRUCT_FAILS+=("$name")
    done
    IFS="$oldifs"
  fi
  # NOTE: WORKTREE untracked-file coverage is now enforced INSIDE the python
  # recomputation above (untracked-coverage sub-check): every untracked file is
  # run through the same file_class re-derivation AND symbol coverage gate as a
  # diff-backed file, not merely checked for manifest presence. The list comes
  # from $UNTRACKED_FILE (populated once, before the checks run).
}

# ===========================================================================
# CHECK 3 - tier-authenticity (.out exists; exit/findings match capture)
# Mirrors the tier runner: file = "${tool//[^a-zA-Z0-9]/_}.out",
# findings column = line count of that .out (wc -l). Both cross-checked
# against DET/_table.tsv (tool\tstatus\texit\tfindings).
# ===========================================================================
check_tier_authenticity() {
  local c3_fail=0 tiers
  tiers="$(jq -r '.tiers[]? | [(.tool//""),(.status//""),(.exit|tostring),(.findings|tostring)] | @tsv' "$MANIFEST")"

  if [ -z "$tiers" ]; then
    pass "tier-authenticity: no tiers declared (nothing to verify)"
    return 0
  fi

  local tool status exit_f findings_f
  while IFS=$'\t' read -r tool status exit_f findings_f; do
    [ -n "$tool" ] || continue
    case "$status" in
      absent|na|"" )  # no .out is expected for absent/na tiers
        info "tier-authenticity: $tool status=$status (no .out expected)"
        continue ;;
    esac

    # status implies a real run (ran|failed|...): the manifest MUST carry numeric
    # exit + findings. A null/absent/non-numeric value is a fabricated tier (the
    # .out file alone does NOT encode exit status), so it FAILS rather than being
    # silently skipped.
    if [ -z "$exit_f" ] || [ "$exit_f" = "null" ] || ! printf '%s' "$exit_f" | grep -Eq '^-?[0-9]+$'; then
      fail "tier-authenticity: $tool status=$status but exit is null/absent/non-numeric ($exit_f)"
      c3_fail=1
      continue
    fi
    if [ -z "$findings_f" ] || [ "$findings_f" = "null" ] || ! printf '%s' "$findings_f" | grep -Eq '^[0-9]+$'; then
      fail "tier-authenticity: $tool status=$status but findings is null/absent/non-numeric ($findings_f)"
      c3_fail=1
      continue
    fi

    # Resolve the captured .out file (sanitised whole string and first token)
    local san_full san_first first out cand
    san_full="${tool//[^a-zA-Z0-9]/_}"
    first="${tool%% *}"
    san_first="${first//[^a-zA-Z0-9]/_}"
    out=""
    for cand in "$DET/$san_full.out" "$DET/$san_first.out"; do
      if [ -f "$cand" ]; then out="$cand"; break; fi
    done

    if [ -z "$out" ]; then
      fail "tier-authenticity: $tool status=$status but no captured .out in DET"
      printf '       looked for: %s.out , %s.out\n' "$san_full" "$san_first"
      c3_fail=1
      continue
    fi

    # Recompute findings = line count of the .out (same as the runner's wc -l)
    local actual_lines
    actual_lines="$(wc -l < "$out")"; actual_lines="${actual_lines// /}"

    if [ "$findings_f" != "$actual_lines" ]; then
      fail "tier-authenticity: $tool findings mismatch"
      printf '       expected (%s line count): %s\n' "$(basename "$out")" "$actual_lines"
      printf '       actual (manifest): %s\n' "$findings_f"
      c3_fail=1
    fi

    # _table.tsv is the ONLY source of truth for exit codes (.out files do not
    # encode exit status), so it is MANDATORY for any run-implying tier: a
    # missing file or a missing row means the exit code cannot be validated ->
    # FAIL rather than pass with no evidence.
    if [ ! -f "$DET/_table.tsv" ]; then
      fail "tier-authenticity: $tool status=$status but DET/_table.tsv is missing (exit code unverifiable)"
      c3_fail=1
      continue
    fi
    local row tbl_exit tbl_find
    row="$(awk -F'\t' -v t="$tool" -v t2="$first" '$1==t || $1==t2 {print; exit}' "$DET/_table.tsv")"
    if [ -z "$row" ]; then
      fail "tier-authenticity: $tool status=$status but no matching row in DET/_table.tsv"
      printf '       looked for tool label: %s (or %s)\n' "$tool" "$first"
      c3_fail=1
      continue
    fi
    tbl_exit="$(printf '%s' "$row" | awk -F'\t' '{print $3}')"
    tbl_find="$(printf '%s' "$row" | awk -F'\t' '{print $4}')"
    if [ -z "$tbl_exit" ] || [ "$exit_f" != "$tbl_exit" ]; then
      fail "tier-authenticity: $tool exit mismatch"
      printf '       expected (_table.tsv): %s\n' "$tbl_exit"
      printf '       actual (manifest): %s\n' "$exit_f"
      c3_fail=1
    fi
    if [ -n "$tbl_find" ] && [ "$tbl_find" != "$actual_lines" ]; then
      fail "tier-authenticity: $tool captured table/.out inconsistent (tampering)"
      printf '       _table.tsv findings: %s , .out line count: %s\n' "$tbl_find" "$actual_lines"
      c3_fail=1
    fi

    [ "$c3_fail" -eq 1 ] || info "tier-authenticity: $tool ok (exit=$exit_f findings=$actual_lines)"
  done <<< "$tiers"

  if [ "$c3_fail" -eq 0 ]; then
    pass "tier-authenticity: all ran/failed tiers map to real captured output"
  else
    STRUCT_FAILS+=("tier-authenticity")
  fi
}

# ===========================================================================
# CHECK 4 - pass-completeness (code/config/iac need macro+micro)
# ===========================================================================
check_pass_completeness() {
  # The gate keys on the RE-DERIVED file_class (CLASS_TSV, written by
  # check_coverage's python) — NOT the manifest's self-declared file_class — so a
  # changed code/config/iac file cannot dodge the macro/micro gate by mislabeling
  # itself docs/generated. A code|config|iac file FAILS when macro_pass!=true, or
  # micro_pass is missing / false / null, or (code only) micro_pass is an
  # "N/A …"/"deferred …" string.
  local out="$WORK/passcomp.out" pyrc=0
  set +e
  python3 - "$MANIFEST" "$CLASS_TSV" > "$out" 2>&1 <<'PY'
import sys, json, re

manifest_path, class_tsv_path = sys.argv[1:3]

def norm(p):
    p = p.strip()
    if p.startswith('a/') or p.startswith('b/'):
        return p[2:]
    return p

# RE-DERIVED class map (path -> class) from the coverage recomputation.
recomputed = {}
try:
    with open(class_tsv_path, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            parts = line.rstrip('\n').split('\t')
            if len(parts) >= 2 and parts[0]:
                recomputed[parts[0]] = parts[1]
except OSError:
    pass

try:
    with open(manifest_path, encoding="utf-8", errors="replace") as fh:
        man = json.load(fh)
except (OSError, ValueError) as e:
    print("pass-completeness: cannot read manifest: %s" % e)
    print("__PASSCOMP_FAIL__ 1")
    sys.exit(0)

GATED = {"code", "config", "iac"}
NA_RE = re.compile(r'^(n/?a|deferred)')
offenders = []
for f in (man.get("files") or []):
    p = norm(str(f.get("path", "")))
    # Prefer the recomputed class; fall back to the declared one only when the
    # path was neither in the diff nor an untracked file (defensive — should be
    # rare). A genuine class disagreement is itself caught by check 2.
    cls = recomputed.get(p, f.get("file_class"))
    if cls not in GATED:
        continue
    macro = f.get("macro_pass")
    has_micro = "micro_pass" in f
    micro = f.get("micro_pass") if has_micro else None
    bad = False
    if macro is not True:
        bad = True
    # micro_pass must be present and a real outcome: missing, false, or JSON null
    # all FAIL (null was previously an unintended bypass).
    if (not has_micro) or (micro is False) or (micro is None):
        bad = True
    elif cls == "code" and isinstance(micro, str) and NA_RE.match(micro.strip().lower()):
        # only generated|vendored|binary|lockfile|rename|docs may use an N/A string
        bad = True
    if bad:
        offenders.append((p, cls, macro, micro if has_micro else "MISSING"))

if offenders:
    print("[FAIL] pass-completeness: code/config/iac file(s) with failed/missing passes "
          "(class re-derived from git/path, not the manifest):")
    for p, cls, macro, micro in offenders:
        print("        %s\tfile_class=%s\tmacro_pass=%s\tmicro_pass=%s"
              % (p, cls, macro, micro))
    print("__PASSCOMP_FAIL__ 1")
else:
    print("[PASS] pass-completeness: all code/config/iac files have macro+micro passes")
    print("__PASSCOMP_FAIL__ 0")
sys.exit(0)
PY
  pyrc=$?
  set -e

  grep -v '^__PASSCOMP_FAIL__ ' "$out" || true

  if ! grep -q '^__PASSCOMP_FAIL__ ' "$out"; then
    fail "pass-completeness: internal verifier error (python rc=$pyrc, no result line)"
    STRUCT_FAILS+=("pass-completeness-internal")
    return 0
  fi

  local fl
  fl="$(grep '^__PASSCOMP_FAIL__ ' "$out" | tail -1 | sed 's/^__PASSCOMP_FAIL__ //')"
  [ "$fl" = "0" ] || STRUCT_FAILS+=("pass-completeness")
}

# ===========================================================================
# CHECK 5 - doc-sync (STRUCTURAL; exit 1 on failure, same as checks 1-4)
#   Recompute, from the PINNED diff's changed file paths (name-status; BOTH the
#   destination AND the source path for renames/copies), the set of TOUCHED
#   directories + ALL ancestor dirs up to the repo root. For each derive
#   <dir>/CLAUDE.md (the repo root maps to the bare "CLAUDE.md"). Require
#   manifest.doc_sync.claude_md[] to carry that path with status in
#   {updated,created,current}. Missing/other-status -> FAIL.
#   Scope is touched-folders+ancestors only (NOT the whole repo). This keeps every
#   touched folder's CLAUDE.md iso with the change (/warmup:update semantics).
#   CLAUDE.md-ONLY: manifest.doc_sync.docs[] (human docs) is advisory, NOT gated
#   here — the required human-doc set is not deterministically derivable (see the
#   SCOPE NOTE in the top-of-file check-5 contract).
# Python prints its own [PASS]/[FAIL] lines and a final machine line:
#   __DOCSYNC_FAIL__ 0|1
# ===========================================================================
check_doc_sync() {
  local out="$WORK/docsync.out" pyrc=0
  set +e
  python3 - "$NAMESTATUS_FILE" "$MANIFEST" > "$out" 2>&1 <<'PY'
import sys, json, os

namestatus_path, manifest_path = sys.argv[1:3]

def norm(p):
    p = p.strip()
    if p.startswith('a/') or p.startswith('b/'):
        p = p[2:]
    while p.startswith('./'):
        p = p[2:]
    return p

# --- changed file paths from name-status (new path for renames/copies) ---
changed = []
try:
    with open(namestatus_path, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            parts = line.rstrip('\n').split('\t')
            if not parts or not parts[0]:
                continue
            code = parts[0]
            if code[:1] in ('R', 'C') and len(parts) >= 3:
                # Rename/copy: gate BOTH the destination AND the source folder.
                # Keeping only parts[2] would let a rename like old/foo -> new/foo
                # leave old/CLAUDE.md stale while the verifier still passes.
                changed.append(norm(parts[1]))
                changed.append(norm(parts[2]))
            elif len(parts) >= 2:
                changed.append(norm(parts[1]))
except OSError as e:
    print("doc-sync: cannot read name-status: %s" % e)
    print("__DOCSYNC_FAIL__ 1")
    sys.exit(0)

# --- required CLAUDE.md set: touched dir + all ancestors up to repo root ---
required = set()
for p in changed:
    d = os.path.dirname(p)
    while True:
        if d in ('', '.'):
            required.add("CLAUDE.md")          # repo root sentinel
            break
        required.add(d + "/CLAUDE.md")
        parent = os.path.dirname(d)
        if parent == d:
            required.add("CLAUDE.md")
            break
        d = parent

# An empty diff has no required CLAUDE.md -> trivially satisfied.
if not required:
    print("[PASS] doc-sync: no touched directories (empty diff) -> nothing to sync")
    print("__DOCSYNC_FAIL__ 0")
    sys.exit(0)

# --- manifest.doc_sync.claude_md[] -> {normpath: status} ---
try:
    with open(manifest_path, encoding="utf-8", errors="replace") as fh:
        man = json.load(fh)
except (OSError, ValueError) as e:
    print("doc-sync: cannot read manifest: %s" % e)
    print("__DOCSYNC_FAIL__ 1")
    sys.exit(0)

ds = man.get("doc_sync") or {}
have = {}
for e in (ds.get("claude_md") or []):
    if isinstance(e, dict):
        have[norm(str(e.get("path", "")))] = e.get("status")

OK = {"updated", "created", "current"}
missing, badstatus = [], []
for r in sorted(required):
    if r not in have:
        missing.append(r)
    elif have[r] not in OK:
        badstatus.append((r, have[r]))

fail = 0
if missing:
    print("[FAIL] doc-sync: required CLAUDE.md absent from doc_sync.claude_md[]:")
    for m in missing:
        print("        %s" % m)
    fail = 1
if badstatus:
    print("[FAIL] doc-sync: CLAUDE.md present but status not in {updated,created,current}:")
    for p, s in badstatus:
        print("        %s: status=%s" % (p, s))
    fail = 1
if fail == 0:
    print("[PASS] doc-sync: all %d required CLAUDE.md (touched dirs + ancestors) synced"
          % len(required))
print("__DOCSYNC_FAIL__ %d" % fail)
sys.exit(0)
PY
  pyrc=$?
  set -e

  # echo python's human-readable lines (everything but the machine line)
  grep -v '^__DOCSYNC_FAIL__ ' "$out" || true

  if ! grep -q '^__DOCSYNC_FAIL__ ' "$out"; then
    fail "doc-sync: internal verifier error (python rc=$pyrc, no result line)"
    STRUCT_FAILS+=("doc-sync-internal")
    return 0
  fi

  local fl
  fl="$(grep '^__DOCSYNC_FAIL__ ' "$out" | tail -1 | sed 's/^__DOCSYNC_FAIL__ //')"
  [ "$fl" = "0" ] || STRUCT_FAILS+=("doc-sync")
}

# ===========================================================================
# CHECK 6 - approve-eligibility (uninspected==[] AND real canary artifact, C6)
# Soft gate: does NOT mark the run INVALID, but DOES force nonzero exit so the
# model cannot APPROVE. The verifier READS the canary artifact and requires
# {seeded:true, detected:true} — not a bare "passed" string.
# ===========================================================================
check_approve_eligibility() {
  local uninspected_len art reasons=()
  uninspected_len="$(jq -r '(.uninspected // []) | length' "$MANIFEST")"
  art="$(jq -r '.canary_artifact // ""' "$MANIFEST")"

  if [ "$uninspected_len" != "0" ]; then
    reasons+=("uninspected is non-empty ($uninspected_len item(s))")
  fi

  if [ -z "$art" ] || [ "$art" = "null" ]; then
    reasons+=("manifest.canary_artifact missing (no real canary self-test)")
  else
    case "$art" in
      /*) : ;;                       # absolute
      *)  art="$REPO/$art" ;;        # resolve relative to repo
    esac
    if [ ! -f "$art" ]; then
      reasons+=("canary artifact not found: $art")
    elif ! jq -e . "$art" >/dev/null 2>&1; then
      reasons+=("canary artifact is not valid JSON: $art")
    else
      local seeded detected
      seeded="$(jq -r '.seeded // false' "$art")"
      detected="$(jq -r '.detected // false' "$art")"
      if [ "$seeded" != "true" ]; then
        reasons+=("canary not seeded (seeded != true)")
      fi
      if [ "$detected" != "true" ]; then
        reasons+=("canary defect NOT detected (detected != true) — engine mis-calibrated")
      fi
    fi
  fi

  if [ "${#reasons[@]}" -eq 0 ]; then
    pass "approve-eligibility: uninspected==[] and canary artifact detected==true"
  else
    ELIG_OK=0
    local r joined=""
    for r in "${reasons[@]}"; do joined+="${joined:+; }$r"; done
    ELIG_REASON="$joined"
    fail "approve-eligibility: NOT approve-eligible -> $joined"
  fi
}

# ---------------------------------------------------------------------------
# Run all checks (structural first, eligibility last)
# ---------------------------------------------------------------------------
check_diff_integrity
check_coverage
check_tier_authenticity
check_pass_completeness
check_doc_sync
check_approve_eligibility

# ---------------------------------------------------------------------------
# Verdict
# ---------------------------------------------------------------------------
printf '\n'
if [ "${#STRUCT_FAILS[@]}" -gt 0 ]; then
  printf 'INVALID RUN: structural check(s) failed: %s\n' "${STRUCT_FAILS[*]}"
  printf 'VERIFIER: FAIL (%s)\n' "${STRUCT_FAILS[0]}"
  exit 1
elif [ "$ELIG_OK" -eq 0 ]; then
  printf 'NOT APPROVE-ELIGIBLE: %s\n' "$ELIG_REASON"
  printf '  (run is structurally valid, but the model MUST NOT emit APPROVE — verdict INCONCLUSIVE)\n'
  printf 'VERIFIER: FAIL (approve-eligibility)\n'
  exit 2
else
  printf 'VERIFIER: PASS\n'
  exit 0
fi

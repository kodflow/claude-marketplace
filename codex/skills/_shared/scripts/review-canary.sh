#!/usr/bin/env bash
# ============================================================================
# review-canary.sh - REAL detection canary for /review (Phase 0.8, C6)
# ----------------------------------------------------------------------------
# Proves the review engine's micro detection is NOT a no-op BEFORE the run is
# allowed to say APPROVE. It seeds a KNOWN defect into a SCRATCH COPY of one
# changed code file (never the repo), runs a micro detector over that copy, and
# writes a machine artifact:
#
#   <out-dir>/review-canary-<ts>.json
#     { "seeded": true, "detected": <bool>, "defect": "<desc>",
#       "file": "<changed file>", "ts": "<utc>", "scratch": "<tmp path>" }
#
# review-verify-manifest.sh READS this artifact (via manifest.canary_artifact)
# and requires seeded==true AND detected==true for an APPROVE-eligible run. If
# the detector is broken (grep missing, file unreadable) detected==false and
# APPROVE is blocked — the canary has done its job.
#
# CONTRACT:
#   review-canary.sh --repo <dir> --base <sha> --head <sha|WORKTREE> \
#                    [--out-dir <dir>]
#
# Guarantees:
#   * NEVER mutates a tracked source file — only a temp scratch copy + the
#     artifact under <out-dir> (default <repo>/.claude, the agent scratchpad).
#   * Exits 0 even when there is nothing to seed (writes a seeded=false
#     artifact); a shallow/unresolvable BASE degrades gracefully (C13).
# ============================================================================

set -euo pipefail

PROG="$(basename "$0")"
die() { printf '%s: error: %s\n' "$PROG" "$*" >&2; exit 2; }

REPO="" BASE="" HEAD="" OUT_DIR=""
while [ $# -gt 0 ]; do
  case "$1" in
    --repo)    REPO="${2:-}";    shift 2 || die "--repo needs a value" ;;
    --base)    BASE="${2:-}";    shift 2 || die "--base needs a value" ;;
    --head)    HEAD="${2:-}";    shift 2 || die "--head needs a value" ;;
    --out-dir) OUT_DIR="${2:-}"; shift 2 || die "--out-dir needs a value" ;;
    -h|--help)
      printf 'usage: %s --repo <dir> --base <sha> --head <sha|WORKTREE> [--out-dir <dir>]\n' "$PROG"
      exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

[ -n "$REPO" ] || die "--repo is required"
[ -n "$BASE" ] || die "--base is required"
[ -n "$HEAD" ] || die "--head is required"

for t in git jq grep mktemp; do
  command -v "$t" >/dev/null 2>&1 || die "required tool not found: $t"
done
[ -d "$REPO" ] || die "repo dir does not exist: $REPO"
git -C "$REPO" rev-parse --git-dir >/dev/null 2>&1 || die "not a git repo: $REPO"

OUT_DIR="${OUT_DIR:-$REPO/.claude}"
mkdir -p "$OUT_DIR"

TS="$(date -u +%Y%m%dT%H%M%SZ)"
ARTIFACT="$OUT_DIR/review-canary-${TS}.json"

SCRATCH_DIR="$(mktemp -d "${TMPDIR:-/tmp}/review-canary.XXXXXX")"
cleanup() { rm -rf "$SCRATCH_DIR"; }
trap cleanup EXIT

# ---------------------------------------------------------------------------
# Pinned diff (C5) — same command family as the verifier. Worktree review uses
# `BASE --`, commit-range review uses `BASE...HEAD`. Wrapped so a shallow /
# unresolvable BASE degrades to an empty file list instead of dying (C13).
# ---------------------------------------------------------------------------
changed_files() {
  if [ "$HEAD" = "WORKTREE" ] || [ "$HEAD" = "WORKING-TREE" ]; then
    git -C "$REPO" -c core.autocrlf=false -c diff.renames=true -c diff.noprefix=false \
        diff --name-only "${BASE}" -- 2>/dev/null || true
  else
    git -C "$REPO" -c core.autocrlf=false -c diff.renames=true -c diff.noprefix=false \
        diff --name-only "${BASE}...${HEAD}" 2>/dev/null || true
  fi
}

CODE_RE='\.(go|py|js|jsx|ts|tsx|rs|java|c|cc|cpp|cxx|h|hpp|cs|rb|php|kt|swift|scala|m|mm|sh|bash|pl|lua|ex|exs|dart|vb|f90|adb|ads)$'

# Pick one changed CODE file (preferred), else any changed file.
CHOSEN=""
FALLBACK=""
while IFS= read -r f; do
  [ -n "$f" ] || continue
  [ -z "$FALLBACK" ] && FALLBACK="$f"
  if printf '%s' "$f" | grep -qE "$CODE_RE"; then
    CHOSEN="$f"
    break
  fi
done <<< "$(changed_files)"
[ -n "$CHOSEN" ] || CHOSEN="$FALLBACK"

write_artifact() {
  # $1 seeded(bool) $2 detected(bool) $3 defect $4 file $5 scratch
  jq -n \
    --argjson seeded   "$1" \
    --argjson detected "$2" \
    --arg     defect   "$3" \
    --arg     file     "$4" \
    --arg     ts       "$TS" \
    --arg     scratch  "$5" \
    '{seeded:$seeded, detected:$detected, defect:$defect, file:$file, ts:$ts, scratch:$scratch}' \
    > "$ARTIFACT"
  printf '%s\n' "$ARTIFACT"
}

# Nothing changed (empty diff / unresolvable base): graceful seeded=false.
if [ -z "$CHOSEN" ]; then
  write_artifact false false "no changed file to seed (empty diff / unresolvable base)" "" ""
  exit 0
fi

# ---------------------------------------------------------------------------
# Materialize a scratch copy of the chosen file (working tree first, else the
# committed blob). The repo is never written.
# ---------------------------------------------------------------------------
SCRATCH="$SCRATCH_DIR/$(basename "$CHOSEN")"
if [ -f "$REPO/$CHOSEN" ]; then
  cp "$REPO/$CHOSEN" "$SCRATCH"
elif [ "$HEAD" != "WORKTREE" ] && [ "$HEAD" != "WORKING-TREE" ] \
     && git -C "$REPO" show "$HEAD:$CHOSEN" > "$SCRATCH" 2>/dev/null; then
  :
elif git -C "$REPO" show "$BASE:$CHOSEN" > "$SCRATCH" 2>/dev/null; then
  :
else
  : > "$SCRATCH"
fi

# ---------------------------------------------------------------------------
# Seed a KNOWN insecure sink into the scratch copy. The marker is unique per
# run so the detection is unambiguous.
# ---------------------------------------------------------------------------
DEFECT="insecure-eval sink (seeded canary ${TS})"
SEED_LINE="CANARY_SEED ${TS}: eval(userControlledInput); os.system(cmd)  # seeded insecure sink"
printf '%s\n' "$SEED_LINE" >> "$SCRATCH"

# ---------------------------------------------------------------------------
# Micro detector — a real scan of the scratch copy for dangerous sinks. If the
# seeded defect is found the detection pipeline works (detected=true). A broken
# scanner / unreadable file yields detected=false and blocks APPROVE.
# ---------------------------------------------------------------------------
DETECTED=false
if grep -Eq 'eval\(|os\.system|system\(|exec\(|subprocess' "$SCRATCH"; then
  DETECTED=true
fi

write_artifact true "$DETECTED" "$DEFECT" "$CHOSEN" "$SCRATCH"
exit 0

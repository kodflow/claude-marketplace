#!/usr/bin/env bash
# Gate for the /goal directive that /challenge emits.
#
# The 4000-character ceiling is a hard tool limit, not a style preference: a
# longer directive is rejected by /goal outright, and a prompt that never reaches
# the goal state is worse than no prompt. Everything else checked here is what
# makes the directive executable rather than aspirational.
#
# Usage: validate-goal-prompt.sh <file>
# Exit:  0 valid · 1 invalid (reasons on stdout) · 2 usage
set -uo pipefail

[ $# -eq 1 ] || { echo "usage: $0 <file>" >&2; exit 2; }
F=$1
[ -r "$F" ] || { echo "unreadable: $F" >&2; exit 2; }

fail=0
say() { printf '  %s %s\n' "$1" "$2"; }
bad() { say "FAIL" "$1"; fail=1; }
ok()  { say "ok  " "$1"; }

# --- size ---------------------------------------------------------------------
# Characters, not bytes: the limit is on the prompt as /goal sees it, and an
# accented French directive has more bytes than characters.
CHARS=$(python3 -c 'import sys;print(len(open(sys.argv[1],encoding="utf-8").read()))' "$F")
BYTES=$(wc -c <"$F" | tr -d ' ')
if [ "$CHARS" -gt 4000 ]; then
  bad "length ${CHARS} chars > 4000 (over by $((CHARS-4000)))"
elif [ "$CHARS" -lt 400 ]; then
  bad "length ${CHARS} chars — too short to carry a plan; suspect a truncated write"
else
  ok "length ${CHARS} chars (${BYTES} bytes), within 4000"
fi

# --- required sections --------------------------------------------------------
for s in CONTEXT OBJECTIVE SCOPE TASKS CONSTRAINTS ACCEPTANCE VERIFY STOP; do
  grep -qE "^##[[:space:]]+${s}([[:space:]]|$)" "$F" && ok "section ${s}" || bad "missing section ${s}"
done

# --- the task list ------------------------------------------------------------
# The whole point of the exercise: a checkable list, so a half-finished run is
# visibly half-finished instead of being reported as done.
TASKS=$(grep -cE '^[[:space:]]*-[[:space:]]\[[ x]\][[:space:]]+\S' "$F")
if [ "$TASKS" -lt 2 ]; then
  bad "task list has ${TASKS} entries — need at least 2 '- [ ] ' items under TASKS"
else
  ok "task list: ${TASKS} checkbox items"
fi
if grep -qE '^[[:space:]]*-[[:space:]]\[x\]' "$F"; then
  bad "a task is pre-ticked — the directive must start with everything unchecked"
fi

# --- verifiers ----------------------------------------------------------------
# An acceptance criterion nobody can run is a wish. Each VERIFY line must carry
# something executable: a command in backticks, or an explicit file:line.
section() { awk -v s="$1" '$0 ~ "^##[[:space:]]+" s "([[:space:]]|$)" {f=1;next} /^##[[:space:]]/{f=0} f' "$F"; }
VERIFY_BLOCK=$(section VERIFY)
VCOUNT=$(printf '%s' "$VERIFY_BLOCK" | grep -cE '`[^`]+`|[A-Za-z0-9_./-]+:[0-9]+')
if [ "$VCOUNT" -lt 1 ]; then
  bad "VERIFY carries no runnable check (expected a \`command\` or file:line)"
else
  ok "VERIFY: ${VCOUNT} runnable check(s)"
fi

# --- vague verbs --------------------------------------------------------------
# These are how a directive reaches the goal state without anything being true.
VAGUE=$(grep -oiE '\b(améliorer|improve|optimi[sz]e|refactor|clean up|handle|support|make (it )?better|as needed|if necessary|etc\.)\b' "$F" | sort -u | tr '\n' ' ')
if [ -n "$VAGUE" ]; then
    ACC=$(section ACCEPTANCE)
  if printf '%s' "$ACC" | grep -qiE '\b(améliorer|improve|optimi[sz]e|refactor|clean up|handle|support)\b'; then
    bad "vague verb inside ACCEPTANCE: ${VAGUE}— acceptance must be binary"
  else
    say "note" "vague wording outside ACCEPTANCE (tolerated): ${VAGUE}"
  fi
fi

# --- model allocation ---------------------------------------------------------
# A directive that does not say who runs what runs everything on the
# orchestrator: a worker inherits the main-loop model unless told otherwise, so
# silence here is the expensive default, not a neutral one.
CONS=$(section CONSTRAINTS)
if printf '%s' "$CONS" | grep -qE '^[[:space:]]*Models:'; then
  if printf '%s' "$CONS" | grep -qE 'Models:.*<[A-Za-z_]'; then
    bad "CONSTRAINTS Models: line still carries a placeholder — resolve it with detect-models.sh"
  elif ! printf '%s' "$CONS" | grep -qiE 'never inherit'; then
    bad "CONSTRAINTS Models: line does not state that workers never inherit the orchestrator model"
  else
    ok "model allocation stated and resolved"
  fi
else
  bad "CONSTRAINTS carries no 'Models:' line — see _shared/model-policy.md"
fi

# --- unresolved placeholders --------------------------------------------------
PH=$(grep -oE '<[A-Za-z_ -]{3,}>|\bTBD\b|\bTODO\b|\bXXX\b|\bFIXME\b|\.\.\.' "$F" | sort -u | tr '\n' ' ')
[ -n "$PH" ] && bad "unresolved placeholder(s): ${PH}" || ok "no placeholders"

# --- STOP ---------------------------------------------------------------------
STOP_BLOCK=$(section STOP)
printf '%s' "$STOP_BLOCK" | grep -qE '\S' && ok "STOP is non-empty" \
  || bad "STOP is empty — the directive never says when it is finished"

echo
if [ "$fail" -eq 0 ]; then
  echo "VALID — ${CHARS}/4000 chars, ${TASKS} tasks, ${VCOUNT} verifiers"
  exit 0
fi
echo "INVALID — fix the FAIL lines above and re-validate. Do NOT hand this to /goal."
exit 1

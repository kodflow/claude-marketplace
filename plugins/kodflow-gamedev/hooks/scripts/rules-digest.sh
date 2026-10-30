#!/bin/bash
# rules-digest.sh — SubagentStart, for kodflow-gamedev's agents only (the
# matcher in hooks.json). It hands the agent the owner's feedback rules
# before it proposes anything, so a mistake the owner already named is not
# made twice.
#
# Read-only, always. /move and /anim-review regenerate
# docs/adr/feedback/.RULES.md (feedback-rules.py build) before they brief the
# panel; this hook only checks that file against the ADRs it was built from,
# by the same hash: sha256 of the lines "<sha256 of file>  <name>", names in
# byte order. Current → the rules of the agent's areas, hard first, cut at
# 2000 characters. Stale or absent → the raw list of ADRs, and the agent
# reads them itself. Ten agents starting at once read the same files and
# print the same lines.
#
# Always one of these first lines:
#   RULES digest: ok <sha>
#   RULES digest: truncated <n>/<total>, read <absolute path>
#   RULES digest unavailable: read docs/adr/feedback/ yourself
# Fails open: any surprise exits 0 with whatever was built so far.
#
# bash 3.2 (macOS /bin/bash): no associative arrays, no ${x,,}, no mapfile.
set +e
BUDGET=2000
START=$(date +%s)

INPUT=$(cat 2>/dev/null)
AGENT="" CWD=""
if command -v jq >/dev/null 2>&1; then
    AGENT=$(printf '%s' "$INPUT" | jq -r '.agent_type // ""' 2>/dev/null)
    CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // ""' 2>/dev/null)
else
    [[ $INPUT =~ \"agent_type\"[[:space:]]*:[[:space:]]*\"([^\"]*)\" ]] && AGENT=${BASH_REMATCH[1]}
    [[ $INPUT =~ \"cwd\"[[:space:]]*:[[:space:]]*\"([^\"]*)\" ]] && CWD=${BASH_REMATCH[1]}
fi
AGENT=${AGENT#kodflow-gamedev:}

# Characters, not bytes: a rule in French or with a technique's original
# script must not be cut mid-character. Any UTF-8 locale will do.
for loc in C.UTF-8 en_US.UTF-8 C.utf8 en_US.utf8; do
    if LC_ALL=$loc bash -c 'x="é"; [ ${#x} -eq 1 ]' 2>/dev/null; then export LC_ALL=$loc; break; fi
done

ROOT=${CLAUDE_PROJECT_DIR:-}
if [ -z "$ROOT" ] || [ ! -d "$ROOT" ]; then
    ROOT=$(GIT_OPTIONAL_LOCKS=0 git -C "${CWD:-$PWD}" rev-parse --show-toplevel 2>/dev/null)
fi
DIR=${ROOT:+$ROOT/docs/adr/feedback}

emit() {   # the context, as the JSON SubagentStart reads
    printf '%s' "$1" | awk 'BEGIN { ORS = ""; print "{\"hookSpecificOutput\":{\"hookEventName\":\"SubagentStart\",\"additionalContext\":\"" }
        { gsub(/\\/, "\\\\"); gsub(/"/, "\\\""); gsub(/\t/, "\\t"); gsub(/\r/, ""); if (NR > 1) print "\\n"; print }
        END { print "\"}}\n" }'
    exit 0
}

if [ -z "$DIR" ]; then
    emit "RULES digest unavailable: read docs/adr/feedback/ yourself
(no project root: neither CLAUDE_PROJECT_DIR nor a git work tree)"
fi

sha() { if command -v sha256sum >/dev/null 2>&1; then sha256sum | cut -d' ' -f1; else shasum -a 256 | cut -d' ' -f1; fi; }

# The ADRs, in byte order of their names, and the set's hash.
NAMES=""
if [ -d "$DIR" ]; then
    NAMES=$(for f in "$DIR"/[0-9]*.md; do
                n=${f##*/}
                [[ $n =~ ^[0-9]{8}-[0-9]{6}-[a-z0-9][a-z0-9-]*-[0-9a-f]{4}\.md$ ]] && [ -f "$f" ] && printf '%s\n' "$n"
            done | LC_ALL=C sort)
fi
TOTAL=0
LINES=""
while IFS= read -r n; do
    [ -n "$n" ] || continue
    TOTAL=$((TOTAL + 1))
    LINES="$LINES$(sha < "$DIR/$n")  $n
"
done <<EOF
$NAMES
EOF
WANT=$(printf '%s' "$LINES" | sha)

# ADRs the default branch will not have yet: untracked, or not in HEAD.
PENDING=0
if [ "$TOTAL" -gt 0 ] && [ $(( $(date +%s) - START )) -lt 3 ]; then
    TRACKED=$(GIT_OPTIONAL_LOCKS=0 git -C "$ROOT" ls-tree --name-only HEAD -- docs/adr/feedback/ 2>/dev/null)
    while IFS= read -r n; do
        [ -n "$n" ] || continue
        case "
$TRACKED
" in *"
docs/adr/feedback/$n
"*) ;; *) PENDING=$((PENDING + 1)) ;; esac
    done <<EOF
$NAMES
EOF
fi
NOTE=""
[ "$PENDING" -gt 0 ] && NOTE="
pending: $PENDING feedback ADR(s) not committed on this branch yet (the trail PR carries them)"

# The areas an agent reads. A rule with no area: tag concerns every agent.
case "$AGENT" in
    gamedev-animation-director|"") AREAS="*" ;;
    anatomy-specialist-*) AREAS="anatomy grip locomotion" ;;
    martial-specialist-*) AREAS="martial technique grip" ;;
    animation-specialist-*) AREAS="craft timing locomotion readability" ;;
    rig-specialist-*) AREAS="rig grip" ;;
    reference-specialist-*) AREAS="imagery licence" ;;
    engine-specialist-*) AREAS="engine rig" ;;
    *) AREAS="*" ;;
esac
wanted() {   # $1 a rule line of .RULES.md
    local tags=${1#*| scope=} t any=0
    [ "$AREAS" = "*" ] && return 0
    tags=${tags%% |*}
    for t in $(printf '%s' "$tags" | tr ',' ' '); do
        case "$t" in
            area:*)
                any=1
                case " $AREAS " in *" ${t#area:} "*) return 0 ;; esac ;;
        esac
    done
    [ "$any" = 0 ]
}

RULES=$DIR/.RULES.md
HAVE=""
[ -r "$RULES" ] && { IFS= read -r first < "$RULES"; [[ $first =~ sha256:([0-9a-f]{64}) ]] && HAVE=${BASH_REMATCH[1]}; }

if [ "$TOTAL" -eq 0 ]; then
    emit "RULES digest: ok $WANT
No owner feedback ADR yet in docs/adr/feedback/."
fi

if [ "$HAVE" != "$WANT" ]; then
    STATE=absent; [ -n "$HAVE" ] && STATE=stale
    out="RULES digest unavailable: read docs/adr/feedback/ yourself
.RULES.md is $STATE: read these $TOTAL ADR(s), newest first, before proposing anything:$NOTE"
    for n in $(printf '%s\n' "$NAMES" | LC_ALL=C sort -r); do
        line="
- docs/adr/feedback/$n"
        [ $(( ${#out} + ${#line} )) -le "$BUDGET" ] || break
        out=$out$line
    done
    emit "$out"
fi

# Current: the agent's rules, in the file's order (hard, proposed, advisory;
# newest first in each), whole lines only.
BODY="" KEPT=0 SEEN=0 CUT=0 SECTION=""
while IFS= read -r line; do
    case "$line" in
        "## "*) SECTION=$line; continue ;;
        "- (none)") continue ;;
        "- "*) ;;
        *) continue ;;
    esac
    wanted "$line" || continue
    SEEN=$((SEEN + 1))
    [ "$CUT" = 1 ] && continue
    add="$line"
    case "$BODY" in *"$SECTION"*) ;; *) add="$SECTION
$line" ;; esac
    if [ $(( ${#BODY} + ${#add} + 300 )) -gt "$BUDGET" ]; then CUT=1; continue; fi
    BODY="$BODY
$add"
    KEPT=$((KEPT + 1))
done < "$RULES"

if [ "$CUT" = 1 ]; then
    HEAD="RULES digest: truncated $KEPT/$SEEN, read $RULES"
else
    HEAD="RULES digest: ok $WANT"
fi
[ "$SEEN" -eq 0 ] && BODY="
No rule concerns this agent's areas ($AREAS)."
emit "$HEAD$NOTE$BODY"

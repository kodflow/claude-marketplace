#!/bin/bash
# on-session.sh — SessionStart, SessionEnd, PreCompact and ConfigChange.
#
# Sequence per event: GATE → BLOCK (none here: nothing at session level may
# stop the session) → TRANSFORM (context Claude reads) → OBSERVE (log).
# SessionEnd hooks share a 1.5 s budget that plugin timeouts cannot raise, so
# that branch does one append and leaves.
set +e

INPUT=$(cat 2>/dev/null); [ -n "$INPUT" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0
eval "$(printf '%s' "$INPUT" | jq -r '@sh "EV=\(.hook_event_name // "") SID=\(.session_id // "") CWD=\(.cwd // "") SCRATCH=\(.scratchpad_dir // "") SOURCE=\(.source // "") FILE=\(.file_path // "") MODEL=\(.model // "")"' 2>/dev/null)" || exit 0

SID=${SID//[^A-Za-z0-9_-]/}; SID=${SID:-default}
PROJECT_DIR=${CLAUDE_PROJECT_DIR:-${CWD:-$PWD}}
STATE=${SCRATCH:-${TMPDIR:-/tmp}/claude-hooks-$SID}
LIB=${BASH_SOURCE[0]%/*}/lib

_branch() {
    local g=$PROJECT_DIR/.git head
    if [ -f "$g" ]; then read -r head < "$g"; g=${head#gitdir: }; [[ $g = /* ]] || g=$PROJECT_DIR/$g; fi
    if [ -f "$g/HEAD" ]; then
        read -r head < "$g/HEAD"
        case "$head" in "ref: refs/heads/"*) BRANCH=${head#ref: refs/heads/} ;; *) BRANCH=detached ;; esac
    else
        BRANCH=$(git -C "$PROJECT_DIR" symbolic-ref --short HEAD 2>/dev/null) || BRANCH=detached
    fi
    BRANCH_SAFE=${BRANCH//\//_}; BRANCH_SAFE=${BRANCH_SAFE// /_}
}
_log() {
    _branch
    local dir=$PROJECT_DIR/.claude/logs/$BRANCH_SAFE
    (
        mkdir -p "$dir" 2>/dev/null || exit 0
        # mkdir is the lock: flock is absent on macOS.
        local n=0; until mkdir "$dir/.lock.d" 2>/dev/null; do n=$((n+1)); [ $n -ge 10 ] && break; sleep 0.05; done
        printf '%s' "$INPUT" | jq -c --arg b "$BRANCH" -f "$LIB/event.jq" >> "$dir/session.jsonl" 2>/dev/null
        [ $n -lt 10 ] && rmdir "$dir/.lock.d" 2>/dev/null
    ) >/dev/null 2>&1 </dev/null &
}
_context() { jq -n -c --arg c "$1" --arg e "$EV" '{hookSpecificOutput:{hookEventName:$e,additionalContext:$c}}' 2>/dev/null; }

_sha256() { { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1"; else shasum -a 256 "$1"; fi; } 2>/dev/null | cut -d' ' -f1; }

# $1 config dir → one warning line per guard script that differs from the
# fingerprint shipped with this copy, and one when this copy's fingerprints
# differ from the marketplace's (an update pending, or a modified install).
_fingerprints() {
    local hd=${BASH_SOURCE[0]%/*}/.. fp h p got pub
    fp=$hd/fingerprints.sha256
    if [ ! -f "$fp" ]; then
        printf '\n%s' "- hooks/fingerprints.sha256 is missing from the installed kodflow-hooks: the guards cannot be checked."
        return 0
    fi
    while read -r h p; do
        [ -n "$p" ] || continue
        got=$(_sha256 "$hd/$p")
        [ "$got" = "$h" ] || printf '\n%s' "- $p differs from its published fingerprint (expected ${h:0:12}, found ${got:-missing}): the installed guard was modified."
    done < "$fp"
    pub=$1/plugins/marketplaces/kodflow/plugins/kodflow-hooks/hooks/fingerprints.sha256
    [ -f "$pub" ] && ! cmp -s "$pub" "$fp" \
        && printf '\n%s' "- the installed kodflow-hooks guards differ from the marketplace copy: run claude plugin update kodflow-hooks@kodflow, or find out what changed."
    return 0
}

# $1 config dir, $2 roots (one per line), $3 enabled plugins (name@mkt per
# line) → every hooks.json declaring modules outside the kodflow marketplace.
_foreign_modules() {
    local cfg=$1 f r rel mkt plug
    {
        [ -d "$cfg/plugins/cache" ] && find "$cfg/plugins/cache" -maxdepth 6 -path '*/hooks/hooks.json' 2>/dev/null
        printf '%s\n' "$2" | while IFS= read -r r; do
            [ -n "$r" ] && [ -d "$r" ] && find "$r" -maxdepth 5 -name hooks.json 2>/dev/null
        done
    } | while IFS= read -r f; do
        case "$f" in "$cfg/plugins/cache/kodflow/"*) continue ;; esac
        case "$f" in "$cfg/plugins/cache/"*)
            rel=${f#"$cfg/plugins/cache/"}; mkt=${rel%%/*}; rel=${rel#*/}; plug=${rel%%/*}
            [ -n "$3" ] && ! printf '%s\n' "$3" | grep -qxF "$plug@$mkt" && continue ;;
        esac
        jq -e 'has("modules")' "$f" >/dev/null 2>&1 && printf '%s\n' "$f"
    done
}

case "$EV" in
SessionStart)
    ctx=""
    # A resumed, cleared or compacted session inherits a task list that no
    # longer says what is true: nothing is in progress at startup, whatever
    # the file claims. The list is shown and must be reconciled before any
    # other action — the triage gate of on-tool.sh holds acting tools until a
    # task tool is called. Only while the task tools answer (lib/beat.sh: the
    # mod beats in its own SessionStart hook, which runs this one inside it).
    sdir=${CLAUDE_CONFIG_DIR:-$HOME/.claude}/kodflow/sessions/$SID
    tasks_file=$sdir/tasks.json
    beat=2; . "$LIB/beat.sh" 2>/dev/null && { kf_beat "$sdir"; beat=$?; }
    if [ "$beat" = 0 ] && [ -s "$tasks_file" ]; then
        open=$(jq -r -L "$LIB" -f "$LIB/review.jq" "$tasks_file" 2>/dev/null)
        if [ -n "$open" ]; then
            : > "$sdir/triage-pending" 2>/dev/null
            ctx="## SESSION START — review the task list before anything else
These tasks were left open by earlier work. Nothing is in progress right now: an in_progress status is a leftover of the previous run. With the kodflow task tools, reconcile each one with reality first — completed if its work is done (check before deciding), deleted if it no longer applies, waiting if it is blocked on the user, in_progress only for the one you resume now (task_focus its epic). Then tell the user what you resumed and what you changed.
$open"
        fi
    fi
    if [ "$SOURCE" = compact ]; then
        # Compaction keeps the summary and drops the instructions. These are
        # the rules that were lost, in the order they are usually needed.
        ctx="${ctx:+$ctx

}"'## POST-COMPACTION — standing rules (kodflow-hooks)
1. MCP first: mcp__github__* / mcp__gitlab__* before gh or glab; mcp__context7__* for library docs.
2. No hook rewrites a Bash command. For compressed output prefix rtk yourself (rtk git status, rtk ls); never on a read whose bytes matter (cat, head, tail, sed, diff, patch, checksums).
3. Commits: conventional messages, no AI attribution, no .claude/ path in a message. Enforced by this plugin on PreToolUse and by the repo commit-msg hook.
4. Never commit on main/master — /git creates the branch and the PR. Never --no-verify, -n or core.hooksPath. A forced push (--force, -f, +refspec) is refused: use --force-with-lease. A subagent never merges and never pushes to the default branch.
5. Workflow: /project → /warmup → /search → /plan → /refine → /challenge → /goal. /feature and /fix open the tracker item and the branch; /review before merge.
6. Before finishing: update the CLAUDE.md of every directory this session changed — warmup --update convention, only what changed, at most 1000 lines. The Stop hook reminds you once per directory.
7. Recover state from .claude/plans/*.md (latest = current task), .claude/goals/*.md (directives), .claude/contexts/*.md (research).
8. Never delete anything under .claude/ or .devcontainer/ without explicit approval.
Context was compacted: verify the task state before continuing.'
    else
        # TRANSFORM: speak only when something is wrong. rtk present is the
        # normal case and needs no words.
        if ! command -v rtk >/dev/null 2>&1; then
            ctx="${ctx:+$ctx

}rtk is not on PATH: a Bash command prefixed with rtk will fail this session. Install it (https://github.com/rtk-ai/rtk) or run commands without the prefix."
        fi
    fi

    cfg=${CLAUDE_CONFIG_DIR:-$HOME/.claude}

    # The routing gate's index for this session (on-tool.sh, pre_agent): the
    # shipped one, filtered to the plugins installed here.
    if [ "${KODFLOW_ROUTE:-}" != off ] && . "$LIB/route.sh" 2>/dev/null; then
        kf_route_install "$cfg" "$sdir/routing-installed.tsv"
    fi

    # A session that starts on a gated model was not asked: --model, the
    # model of the settings or ANTHROPIC_MODEL chose it. Said once; the
    # payload carries no model in a headless run (tests/fixtures), so the
    # settings and the environment are read too, the most specific first.
    notice=""
    case "${KODFLOW_FABLE:-}" in allow|off) ;; *)
        smodel=$MODEL
        for f in "$PROJECT_DIR/.claude/settings.local.json" "$PROJECT_DIR/.claude/settings.json" "$cfg/settings.json"; do
            [ -n "$smodel" ] && break
            [ -f "$f" ] && smodel=$(jq -r '.model // empty | strings' "$f" 2>/dev/null)
        done
        smodel=${smodel:-${ANTHROPIC_MODEL:-}}
        if . "$LIB/agents.sh" 2>/dev/null && kf_is_gated "$smodel"; then
            notice="kodflow-hooks: this session starts on $smodel, a gated model (gated-models.txt), chosen at launch rather than agreed. Subagents that inherit it are asked for once; /model opus moves the session off it."
        fi ;;
    esac

    # OBSERVE: what can switch these guards off, or run code beside them. Not
    # blocked (the settings are the user's), said to the user and to Claude.
    warn=""
    for f in "$cfg/settings.json" "$cfg/settings.local.json" "$PROJECT_DIR/.claude/settings.json" "$PROJECT_DIR/.claude/settings.local.json"; do
        [ -f "$f" ] && jq -e '.disableAllHooks == true' "$f" >/dev/null 2>&1 \
            && warn="$warn"$'\n'"- disableAllHooks is true in $f: every hook, these guards included, is off."
    done
    [ -n "${CLAUDE_CODE_PLUGIN_DIRS:-}" ] \
        && warn="$warn"$'\n'"- CLAUDE_CODE_PLUGIN_DIRS is set ($CLAUDE_CODE_PLUGIN_DIRS): plugins load from outside any marketplace."
    # A hooks.json that declares modules runs TypeScript in the CLI itself.
    # Outside the kodflow marketplace it is reported: in an enabled plugin of
    # the cache, in a skills directory, or in a CLAUDE_CODE_PLUGIN_DIRS entry.
    enabled=$(jq -r '.enabledPlugins // {} | to_entries[] | select(.value == true) | .key' "$cfg/settings.json" "$PROJECT_DIR/.claude/settings.json" 2>/dev/null)
    roots="$cfg/skills"$'\n'"$PROJECT_DIR/.claude/skills"
    [ -n "${CLAUDE_CODE_PLUGIN_DIRS:-}" ] && roots="$roots"$'\n'"$(printf '%s' "$CLAUDE_CODE_PLUGIN_DIRS" | tr ':,' '\n\n')"
    mods=$(_foreign_modules "$cfg" "$roots" "$enabled")
    [ -n "$mods" ] && warn="$warn"$'\n'"- modules declared outside kodflow (TypeScript run by the CLI):"$'\n'"$(printf '%s\n' "$mods" | sed 's/^/  /')"

    # D8 · self-defence by fingerprint. Nothing is blocked; an edited guard
    # is said out loud. The reference is fingerprints.sha256, generated and
    # checked by CI (scripts/hooks-fingerprints.sh) and shipped with the
    # plugin; the marketplace clone holds the published one.
    warn="$warn$(_fingerprints "$cfg")"

    # One document per hook: every part above joins a single context.
    if [ -n "$warn" ] || [ -n "$notice" ]; then
        msg=""
        [ -n "$warn" ] && { ctx="${ctx:+$ctx

}## kodflow-hooks — guards at risk$warn"; msg="kodflow-hooks: guards at risk$warn"; }
        [ -n "$notice" ] && { ctx="${ctx:+$ctx

}$notice"; msg="${msg:+$msg
}$notice"; }
        jq -n -c --arg c "$ctx" --arg m "$msg" \
            '{systemMessage:$m, hookSpecificOutput:{hookEventName:"SessionStart",additionalContext:$c}}' 2>/dev/null
    elif [ -n "$ctx" ]; then
        _context "$ctx"
    fi
    _log ;;

SessionEnd)
    _branch
    local_log=$PROJECT_DIR/.claude/logs/$BRANCH_SAFE/session.jsonl
    total=0; [ -f "$local_log" ] && total=$(grep -c "\"session_id\":\"$SID\"" "$local_log" 2>/dev/null)
    INPUT=$(printf '%s' "$INPUT" | jq -c --argjson t "${total:-0}" '. + {total_events:$t}' 2>/dev/null)
    # Session state lives in the scratchpad when Claude Code provides one; the
    # /tmp fallback is ours to remove.
    [ -z "$SCRATCH" ] && rm -rf -- "${TMPDIR:-/tmp}/claude-hooks-$SID" 2>/dev/null
    _log; wait ;;

PreCompact)
    _log ;;

ConfigChange)
    # A settings change that enables bypassPermissions is worth a separate,
    # grep-able line. Not blocked: the user's own settings are theirs to set.
    if [ -n "$FILE" ] && [ -f "$FILE" ] && grep -q bypassPermissions "$FILE" 2>/dev/null; then
        _branch
        mkdir -p "$PROJECT_DIR/.claude/logs" 2>/dev/null && \
            jq -n -c --arg ts "$(date -u +%FT%TZ)" --arg s "$SOURCE" --arg f "$FILE" --arg sid "$SID" \
               '{timestamp:$ts,event:"PermissionEscalation",source:$s,file_path:$f,session_id:$sid}' \
               >> "$PROJECT_DIR/.claude/logs/security-events.jsonl" 2>/dev/null
    fi
    _log ;;
esac
exit 0

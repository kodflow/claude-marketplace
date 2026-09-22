#!/bin/bash
# on-tool.sh — the one hook behind PreToolUse, PostToolUse and PostToolUseFailure.
#
# Hooks registered on the same event run in parallel (hooks reference: "All
# matching hooks run in parallel"), so a chain of small scripts has no order —
# the guard may inspect a command the rewriter has already changed. One script
# per event is the only way to get a sequence, and the sequence is fixed:
#
#   1. GATE       the cheapest test that lets most calls leave at once
#   2. BLOCK      what must stop the call: exit 2 with the reason on stderr
#   3. TRANSFORM  rewrite the input, emitted as ONE JSON document
#   4. OBSERVE    logging and advice, off the critical path
#
# Every path that is not a deliberate block exits 0. A PreToolUse hook that
# fails by accident blocks every shell call of the session.
set +e

INPUT=$(cat 2>/dev/null); [ -n "$INPUT" ] || exit 0

# FAST PATH, no jq. The PreToolUse matcher is the catch-all so the triage gate
# sees every call, and one jq start costs ~30 ms on a slow CPU: the tools this
# script does not handle are decided with bash regexes alone. They leave at
# once unless the triage gate applies, in which case the full path below
# refuses them.
if [[ $INPUT =~ \"hook_event_name\":\ ?\"PreToolUse\" ]] && [[ $INPUT =~ \"tool_name\":\ ?\"([^\"]+)\" ]]; then
    case "${BASH_REMATCH[1]}" in
        Bash|Write|Edit|MultiEdit|NotebookEdit|TaskCreate|TodoWrite|mcp__*tasks__task_*) ;;
        Read|Glob|Grep|LS|ToolSearch|AskUserQuestion) exit 0 ;;
        *)
            [[ $INPUT =~ \"agent_id\":\ ?\"[^\"]+\" ]] && exit 0
            fp_dir=""; fp_sid=""
            [[ $INPUT =~ \"scratchpad_dir\":\ ?\"([^\"]*)\" ]] && fp_dir=${BASH_REMATCH[1]}
            [[ $INPUT =~ \"session_id\":\ ?\"([^\"]*)\" ]] && fp_sid=${BASH_REMATCH[1]//[^A-Za-z0-9_-]/}
            [ -f "${fp_dir:-${TMPDIR:-/tmp}/claude-hooks-${fp_sid:-default}}/triage-pending" ] || exit 0 ;;
    esac
fi

command -v jq >/dev/null 2>&1 || exit 0

# One jq call reads every field a branch below may need. @sh single-quotes
# each value, so a crafted path or command cannot escape into this shell.
eval "$(printf '%s' "$INPUT" | jq -r '@sh "EV=\(.hook_event_name // "") TOOL=\(.tool_name // "") SID=\(.session_id // "") CWD=\(.cwd // "") SCRATCH=\(.scratchpad_dir // "") CMD=\(.tool_input.command // "") FILE=\(.tool_input.file_path // "") ERR=\(.error // "") AID=\(.agent_id // "")"' 2>/dev/null)" || exit 0

SID=${SID//[^A-Za-z0-9_-]/}; SID=${SID:-default}
PROJECT_DIR=${CLAUDE_PROJECT_DIR:-${CWD:-$PWD}}
STATE=${SCRATCH:-${TMPDIR:-/tmp}/claude-hooks-$SID}   # session-scoped state; on-stop.sh reads it
LIB=${BASH_SOURCE[0]%/*}/lib

# Branch without forking: read .git/HEAD (following a worktree's gitdir file).
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

# OBSERVE. A detached subshell with no inherited pipes, so the hook's own exit
# is not held back by the write. lib/event.jq is the whole sanitization policy.
_log() {
    _branch
    local dir=$PROJECT_DIR/.claude/logs/$BRANCH_SAFE
    (
        mkdir -p "$dir" 2>/dev/null || exit 0
        exec 9>>"$dir/.lock"; flock -w 2 9 2>/dev/null
        printf '%s' "$INPUT" | jq -c --arg b "$BRANCH" -f "$LIB/event.jq" >> "$dir/session.jsonl" 2>/dev/null
    ) >/dev/null 2>&1 </dev/null &
}

_block() {   # $1 = title, rest = lines. Stderr on exit 2 is what Claude reads.
    printf '═══════════════════════════════════════════════\n  ❌ %s\n═══════════════════════════════════════════════\n' "$1" >&2
    shift; printf '  %s\n' "$@" >&2
    _log
    exit 2
}

# Split a command line on ; && || | & and newline. Text inside quotes is split
# too; that only ever makes the guards more conservative.
_split() {
    local s=$1 l
    s=${s//&&/$'\n'}; s=${s//||/$'\n'}; s=${s//;/$'\n'}; s=${s//|/$'\n'}; s=${s//&/$'\n'}
    SEGS=()
    while IFS= read -r l; do l=${l#"${l%%[![:space:]]*}"}; [ -n "$l" ] && SEGS+=("$l"); done <<<"$s"
}

# The executable name of a segment, past VAR=value prefixes and wrappers.
_seg_name() {
    local seg=$1 w next
    while :; do
        w=${seg%%[[:space:]]*}
        case "$w" in
            [A-Za-z_]*=*|env|command|builtin|nohup|time|exec|sudo|sg)
                next=${seg#*[[:space:]]}; [ "$next" = "$seg" ] && break
                seg=${next#"${next%%[![:space:]]*}"} ;;
            *) break ;;
        esac
    done
    w=${seg%%[[:space:]]*}; printf '%s' "${w##*/}"
}

# ============================================================================
# PreToolUse · Bash
# ============================================================================
pre_bash() {
    [ -n "$CMD" ] || exit 0
    local norm=$CMD
    case "$norm" in "rtk proxy "*) norm=${norm#rtk proxy } ;; "rtk "*) norm=${norm#rtk } ;; esac

    # --- GATE: which guarded git operations appear, anywhere on the line ---
    # Anchoring on `^git` let `cd x && git commit`, `env git push`, `git -C dir
    # commit` and `bash -c "git commit"` through untouched. The match runs on
    # the whole line: a wrapper, a separator, a quote or a path may precede it.
    local re rest OPS=""
    re="(^|[;&|(\"'\`/]|[[:space:]])(([A-Za-z_][A-Za-z_0-9]*=[^[:space:]]*|env|command|exec|sudo|nohup|time|xargs|eval)[[:space:]]+)*git([[:space:]]+(-C|-c)[[:space:]]+[^[:space:]]+|[[:space:]]+--[^[:space:]]+)*[[:space:]]+(commit|push|rebase|cherry-pick)([[:space:]]|$)"
    rest=$norm
    while [[ $rest =~ $re ]]; do
        OPS="$OPS ${BASH_REMATCH[6]}"
        rest=${rest#*"${BASH_REMATCH[0]}"}
    done
    _split "$norm"

    if [ -n "$OPS" ]; then
        # --- BLOCK 1: --no-verify, and -n on a commit segment ---------------
        # --no-verify skips the repo's own commit-msg hook, the second layer of
        # the attribution guard. `-n` is git commit's alias for it, also inside
        # a cluster (-anm). Quoted strings are removed first so a message that
        # says "-n" is not read as a flag. The -n test is per segment: sed -n
        # elsewhere on the line is not a commit flag.
        local seg flags
        flags=$(printf '%s' "$norm" | sed -E "s/\"[^\"]*\"//g; s/'[^']*'//g")
        [[ $flags =~ --no-verify ]] && _block "COMMAND BLOCKED — --no-verify is forbidden" \
            "Local git hooks are the second layer of the attribution and secret guards." \
            "If a hook is wrong, fix the hook; do not skip it."
        for seg in "${SEGS[@]}"; do
            [[ $seg =~ git([[:space:]]+(-C|-c)[[:space:]]+[^[:space:]]+|[[:space:]]+--[^[:space:]]+)*[[:space:]]+commit([[:space:]]|$) ]] || continue
            flags=$(printf '%s' "$seg" | sed -E "s/\"[^\"]*\"//g; s/'[^']*'//g")
            [[ $flags =~ (^|[[:space:]])-[a-zA-Z]*n[a-zA-Z]*([[:space:]]|$) ]] && _block \
                "COMMAND BLOCKED — -n (--no-verify) is forbidden on git commit" \
                "Local git hooks are the second layer of the attribution and secret guards."
        done

        # --- BLOCK 2: AI attribution and workflow leaks in the message -------
        # Scan the raw line rather than extract -m values: every -m, --message
        # and heredoc body is a substring of it. Augment with what lives
        # outside the line: -F file content, HEAD for --amend, recent commits
        # for rebase/cherry-pick. Tokens that exist on disk are dropped first so
        # a pathspec under .claude/ is not mistaken for a leaked reference.
        local hay tok farg
        case " $OPS " in *" commit "*|*" rebase "*|*" cherry-pick "*)
            hay=$CMD
            set -f; for tok in $CMD; do [ -e "$tok" ] && hay=${hay//"$tok"/}; done; set +f
            farg=""
            if   [[ $norm =~ -F[[:space:]]+\"([^\"]+)\" ]]; then farg=${BASH_REMATCH[1]}
            elif [[ $norm =~ -F[[:space:]]+\'([^\']+)\' ]]; then farg=${BASH_REMATCH[1]}
            elif [[ $norm =~ -F[[:space:]]+([^[:space:]]+) ]]; then farg=${BASH_REMATCH[1]}; fi
            [ -n "$farg" ] && [ "$farg" != "-" ] && [ -r "$farg" ] && hay="$hay"$'\n'"$(cat -- "$farg" 2>/dev/null)"
            [[ $norm =~ --amend ]] && [[ ! $norm =~ -m[[:space:]]|--message ]] && hay="$hay"$'\n'"$(git -C "$PROJECT_DIR" log -1 --pretty=%B 2>/dev/null)"
            case " $OPS " in *" rebase "*|*" cherry-pick "*) hay="$hay"$'\n'"$(git -C "$PROJECT_DIR" log -5 --pretty=%B 2>/dev/null)" ;; esac
            hay=$(printf '%s' "$hay" | tr '[:upper:]' '[:lower:]')
            local p
            for p in "co-authored-by:.*(claude|anthropic|openai|gpt|copilot|gemini|llm|ai)" \
                     "generated[[:space:]]+(by|with)[[:space:]]+(claude|ai|gpt|anthropic|copilot)" \
                     "ai[-.]assisted" "🤖" "claude[-[:space:]]code" \
                     "\\.claude/" "^[[:space:]]*plan:" "(see|ref|tracked-in)[[:space:]]+\\.claude" "\\bplan[[:space:]]+\\.claude"; do
                printf '%s' "$hay" | grep -qiE "$p" && _block "COMMIT BLOCKED — AI reference detected" \
                    "Forbidden pattern: $p" \
                    "Remove AI attribution (co-authored-by, generated by, 🤖) and workflow leaks (.claude/ paths, Plan: footers)." \
                    "The repo's commit-msg hook blocks the same thing on the git side."
            done ;;
        esac

        # --- BLOCK 3: secrets in the staged blobs (commit only) --------------
        # Reads the index, not the working tree. Hook and test sources are
        # skipped: they carry detection patterns that match themselves. The
        # alternation is assembled so this file does not itself read as a
        # credential to a line scanner.
        case " $OPS " in *" commit "*)
            local f content kw tok oth pat hits=""
            kw="pass""word|api[_-]?key|secret""_key"
            tok="gh""p_[a-zA-Z0-9]{36}|gh""o_[a-zA-Z0-9]{36}|github""_pat_[a-zA-Z0-9_]+"
            oth="aws[_-]?access[_-]?key|BEGIN RSA PRIV""ATE KEY|BEGIN OPENSSH PRIV""ATE KEY|sk""-[a-zA-Z0-9]{48}|AK""IA[0-9A-Z]{16}"
            pat="(${kw})"'\s*=\s*["\047][^"\047]+'"|${tok}|${oth}"
            while IFS= read -r -d '' f; do
                case "$f" in */hooks/scripts/*|*/.claude/scripts/*|*/.claude/agents/*|*/.githooks/*|*/tests/*|*/fixtures/*|*.bats|*.tpl) continue ;; esac
                content=$(git -C "$PROJECT_DIR" show ":$f" 2>/dev/null) || continue
                printf '%s' "$content" | grep -qI . || continue      # binary
                printf '%s' "$content" | grep -iEq "$pat" && hits="$hits"$'\n'"  - $f"
            done < <(git -C "$PROJECT_DIR" diff --cached --name-only -z 2>/dev/null)
            [ -n "$hits" ] && _block "COMMIT BLOCKED — secrets detected in staged files" "Remove them before committing:$hits" ;;
        esac
    fi

    # --- TRANSFORM 1: --force → --force-with-lease on a push -----------------
    # Token-wise: --force-if-includes is left alone. A forced push inside a
    # compound line is refused rather than rewritten: the rewrite is only
    # correct when the whole line is the push.
    local new=$CMD
    if [[ " $OPS " == *" push "* ]] && [[ $norm =~ (^|[[:space:]])(--force|-f)([[:space:]]|$) ]] && [[ $norm != *--force-with-lease* ]]; then
        [ ${#SEGS[@]} -gt 1 ] && _block "COMMAND BLOCKED — forced push inside a compound command" \
            "Run the push on its own line, as git push --force-with-lease."
        new=$(printf '%s' "$CMD" | sed -E 's/(^|[[:space:]])(--force|-f)([[:space:]]|$)/\1--force-with-lease\3/g')
    fi

    # --- TRANSFORM 2: rtk rewrite, unless a segment must stay byte-exact ------
    # rtk's read path strips comments, so a rewritten cat hands the agent a
    # file it cannot safely edit from. Any segment whose exact bytes matter
    # protects the whole line. NO_RTK= is the explicit opt-out.
    case "$new" in NO_RTK=*) ;; *)
        if command -v rtk >/dev/null 2>&1; then
            local protected=0 seg name
            for seg in "${SEGS[@]}"; do
                name=$(_seg_name "$seg")
                case "$name" in
                    cat|head|tail|sed|awk|diff|patch|sha256sum|sha1sum|md5sum|base64|xxd|od|strings|cmp) protected=1 ;;
                    find) case " $seg " in *" -not "*|*" -exec "*|*" -execdir "*|*" -o "*|*" -delete "*|*" -prune "*|*" -printf "*|*" -print0 "*) protected=1 ;; esac ;;
                esac
                [ $protected -eq 1 ] && break
            done
            if [ $protected -eq 0 ]; then
                local r; r=$(rtk rewrite "$new" 2>/dev/null) && [ -n "$r" ] && new=$r
            fi
        fi ;;
    esac

    # ONE document. updatedInput without permissionDecision: the rewritten
    # command goes through the normal permission flow. "allow" here would
    # auto-approve every command rtk knows how to rewrite — most of them.
    if [ "$new" != "$CMD" ]; then
        printf '%s' "$INPUT" | jq -c --arg cmd "$new" \
            '{hookSpecificOutput:{hookEventName:"PreToolUse",updatedInput:(.tool_input|.command=$cmd)}}' 2>/dev/null
    fi
    _log
    exit 0
}

# ============================================================================
# PreToolUse · task list (the plugin's tasks MCP, and the built-in tools)
# ============================================================================
# An MCP server cannot tell which session or which subagent is calling; this
# hook can. Both are written into the call, overriding whatever the model put
# there, so each agent owns its own list and the status line can show the
# main agent's alone.
pre_tasks() {
    jq -c '{hookSpecificOutput:{hookEventName:"PreToolUse",
            updatedInput:(.tool_input + {_session:(.session_id // "default"), _agent:(.agent_id // "main")})}}' \
        <<<"$INPUT" 2>/dev/null
    _log
    exit 0
}

# The built-in task tools draw their own panel in the chat, a second copy of
# the list the status line already shows. Send the model to the MCP instead.
pre_builtin_tasks() {
    _block "USE THE KODFLOW TASK TOOLS" \
        "$TOOL draws a second task list in the chat. Use the kodflow tasks MCP instead:" \
        "task_create (subject: 40 characters at most), task_update (id, status), task_list," \
        "task_epic / task_focus (one epic per subject). Statuses: pending, in_progress, waiting, completed, deleted."
}

# ============================================================================
# PreToolUse · Write / Edit / MultiEdit / NotebookEdit
# ============================================================================
pre_edit() {
    [ -n "$FILE" ] || exit 0

    # --- BLOCK: protected paths ----------------------------------------------
    # Globs, matched against the path's tail so `*.lock` means the basename and
    # `node_modules/` means a directory anywhere in the path. A project lists
    # its own in .claude/protected-paths, one glob per line.
    case "$FILE" in *.md|*/README*|*/CHANGELOG*|*/.claude/contexts/*|*/.claude/plans/*|*/.claude/goals/*) ;; *)
        local p pats=()
        if [ -f "$PROJECT_DIR/.claude/protected-paths" ]; then
            while IFS= read -r p; do [ -n "$p" ] && [ "${p:0:1}" != "#" ] && pats+=("$p"); done < "$PROJECT_DIR/.claude/protected-paths"
        else
            pats=('node_modules/' '.git/' 'vendor/' 'dist/' 'build/' '.env*' '*.lock' 'package-lock.json' 'yarn.lock' 'pnpm-lock.yaml' 'go.sum')
        fi
        for p in "${pats[@]}"; do
            case "$p" in
                */) p=${p%/}; if [[ $FILE == */$p/* ]]; then _block "EDIT BLOCKED — protected path" "$FILE matches $p/"; fi ;;
                *)  if [[ $FILE == */$p || $FILE == $p ]]; then _block "EDIT BLOCKED — protected path" "$FILE matches $p"; fi ;;
            esac
        done ;;
    esac

    # --- OBSERVE: project-linter pre-check, only when a server is listening --
    # A bash TCP probe costs nothing; curl to a closed port costs 12 ms per
    # edit. Structural/signature phases only — logic and style wait for Stop.
    case "$FILE" in *.md|*.json|*.yaml|*.yml|*.toml|/tmp/*|*/.claude/*) ;; *)
        local port=${KTN_LINTER_PORT:-7717} body resp
        if command -v curl >/dev/null 2>&1 && (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
            body=$(printf '%s' "$INPUT" | jq -c --arg p "${KTN_PRE_PHASES:-structural,signatures}" '. + {phases: ($p | split(","))}' 2>/dev/null)
            resp=$(curl -sf --max-time 4 -H 'Content-Type: application/json' -d "${body:-$INPUT}" "http://127.0.0.1:$port/hooks/pre-tool-use" 2>/dev/null)
            if [ -n "$resp" ] && printf '%s' "$resp" | jq -e '.hookSpecificOutput' >/dev/null 2>&1; then
                printf '%s' "$resp"; _log; exit 0
            fi
        fi ;;
    esac
    _log
    exit 0
}

# ============================================================================
# PostToolUse · Write / Edit / MultiEdit / NotebookEdit
# ============================================================================
post_edit() {
    [ -n "$FILE" ] && [ -f "$FILE" ] || { _log; exit 0; }
    case "$FILE" in *.md|*/.claude/*|"$HOME"/.claude/*) _log; exit 0 ;; esac
    local ctx=""

    # --- TRANSFORM: format, and say so when the bytes changed ----------------
    # A formatter that rewrites the file makes Claude's next old_string miss.
    # Telling it to re-read costs one line; a failed Edit costs a round trip.
    if [ -f "$LIB/format.sh" ]; then
        local before after
        # shellcheck source=lib/format.sh
        . "$LIB/format.sh"
        before=$(cksum < "$FILE" 2>/dev/null)
        hook_format "$FILE"
        after=$(cksum < "$FILE" 2>/dev/null)
        [ "$before" != "$after" ] && ctx="Reformatted by ${FMT_TOOL:-the project formatter}: $FILE changed on disk. Read it again before the next Edit."
    fi

    # --- OBSERVE: remember the edit for the Stop hook --------------------------
    # A plain append: the path is data, never part of a command.
    mkdir -p "$STATE" 2>/dev/null && printf '%s\n' "$FILE" >> "$STATE/edited" 2>/dev/null

    # --- OBSERVE: risky constructs, once per session each ------------------------
    # PostToolUse additionalContext is the channel Claude actually reads;
    # stderr on exit 0 never reaches it.
    local new entry pattern
    new=$(printf '%s' "$INPUT" | jq -r '.tool_input.content // .tool_input.new_string // ""' 2>/dev/null | head -c 200000)
    if [ -n "$new" ]; then
        for entry in \
            'eval(|code injection: eval() runs arbitrary strings — parse, do not evaluate' \
            'new Function|code injection: new Function() compiles strings' \
            'child_process.exec|command injection: exec() goes through a shell — use execFile with an argument array' \
            'dangerouslySetInnerHTML|XSS: raw HTML — sanitize (DOMPurify) or render text' \
            '.innerHTML =|XSS: innerHTML executes markup — use textContent' \
            'pickle.load|deserialization: pickle executes arbitrary code — use JSON' \
            'shell=True|command injection: shell=True — pass an argument list' \
            'os.system(|command injection: os.system — use subprocess with a list'; do
            pattern=${entry%%|*}
            [[ $new == *"$pattern"* ]] || continue
            grep -qxF -- "$pattern" "$STATE/warned" 2>/dev/null && continue
            printf '%s\n' "$pattern" >> "$STATE/warned" 2>/dev/null
            ctx="${ctx:+$ctx
}SECURITY: ${entry#*|} ('$pattern' in $FILE — shown once per session)"
        done
    fi

    [ -n "$ctx" ] && jq -n -c --arg c "$ctx" '{hookSpecificOutput:{hookEventName:"PostToolUse",additionalContext:$c}}' 2>/dev/null
    _log
    exit 0
}

# ============================================================================
# PostToolUseFailure · any tool
# ============================================================================
post_failure() {
    local advice=""
    case "$ERR" in
        *"command not found"*|*"not found"*)      advice="Command not found: check the spelling, install the tool, or use another approach." ;;
        *"ermission denied"*)                      advice="Permission denied: check ownership and mode before retrying." ;;
        *"No such file or directory"*)             advice="Path not found: verify it with Glob or ls before retrying." ;;
        *"AssertionError"*|*"FAILED"*)             advice="A test failed: read the assertion, fix the code, then re-run." ;;
        *"SyntaxError"*|*"syntax error"*)          advice="Syntax error: look for the unclosed bracket or bad indentation named in the message." ;;
        *"timeout"*|*"Timeout"*|*"ETIMEDOUT"*)     advice="Timed out: split the command, or run it in the background." ;;
        *"ENOENT"*|*"MODULE_NOT_FOUND"*)           advice="Module not found: check the manifest and run the install step." ;;
    esac
    [ -n "$advice" ] && jq -n -c --arg c "Tool '$TOOL' failed: ${ERR:0:200}. $advice" \
        '{hookSpecificOutput:{hookEventName:"PostToolUseFailure",additionalContext:$c}}' 2>/dev/null
    _log
    exit 0
}

# ============================================================================
# PreToolUse · triage gate
# ============================================================================
# The user wants every message filed in the task list BEFORE anything is done
# about it. on-user.sh raises triage-pending on each prompt; the first call to
# a task tool lowers it. Until then the main agent may only read and load
# tools — enough to understand the request, not to act on it. Subagents are
# not gated: they work for a task the main agent already filed.
if [ "$EV" = PreToolUse ] && [ -z "$AID" ] && [ -f "$STATE/triage-pending" ]; then
    case "$TOOL" in
        mcp__*tasks__task_*)
            rm -f -- "$STATE/triage-pending" 2>/dev/null ;;
        Read|Glob|Grep|LS|ToolSearch|AskUserQuestion)
            ;;
        *)
            _block "TRIAGE FIRST — file this message in the task list" \
                "Before acting, classify the user's message with the kodflow task tools:" \
                "new work for an open epic → task_create(epic=id) · new subject → task_epic(title), then task_create(epic=its id)" \
                "task_create always names its epic (epic=0 for none): there is no default." \
                "context on the task in progress → task_update it · rework of a completed task → task_create \"Rework #N: …\"" \
                "a question that needs no task → task_list (acknowledges the triage)." \
                "Reading (Read, Grep, Glob) and ToolSearch stay allowed meanwhile." ;;
    esac
fi

# Tools this script has nothing to do with leave at once, unlogged: the
# matcher is wide only so the triage gate above sees every call.
case "$EV/$TOOL" in
    PreToolUse/Bash|PreToolUse/Write|PreToolUse/Edit|PreToolUse/MultiEdit|PreToolUse/NotebookEdit|PreToolUse/TaskCreate|PreToolUse/TodoWrite|PreToolUse/mcp__*tasks__task_*) ;;
    PreToolUse/*) exit 0 ;;
esac

# ============================================================================
# dispatch
# ============================================================================
case "$EV/$TOOL" in
    PreToolUse/Bash)                                        pre_bash ;;
    PreToolUse/mcp__*tasks__task_create|PreToolUse/mcp__*tasks__task_update|PreToolUse/mcp__*tasks__task_list|PreToolUse/mcp__*tasks__task_epic|PreToolUse/mcp__*tasks__task_focus) pre_tasks ;;
    PreToolUse/TaskCreate|PreToolUse/TodoWrite)             pre_builtin_tasks ;;
    PreToolUse/Write|PreToolUse/Edit|PreToolUse/MultiEdit|PreToolUse/NotebookEdit)     pre_edit ;;
    PostToolUse/Write|PostToolUse/Edit|PostToolUse/MultiEdit|PostToolUse/NotebookEdit) post_edit ;;
    PostToolUseFailure/*)                                   post_failure ;;
    *)                                                      _log; exit 0 ;;
esac

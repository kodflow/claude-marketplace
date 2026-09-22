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

# REVIEWER GATE · forge MCP tools. Pure bash, so the fast path below can use
# it without jq. The main thread reads the forge, merges, and talks on the
# tracker and in reviews; it does not push content, branches or pull requests
# — that is a subagent's delivery. Allow-list: a tool nobody classified is
# refused, because a new write tool must not slip through by being new.
_forge_ok() {
    local t=$1
    case "$t" in
        mcp__github__*)
            t=${t#mcp__github__}
            case "$t" in
                get_*|list_*|search_*|*_read|merge_pull_request|issue_write|sub_issue_write|add_issue_comment|\
                pull_request_review_write|add_comment_to_pending_review|add_reply_to_pull_request_comment) return 0 ;;
            esac ;;
        mcp__gitlab__*)
            t=${t#mcp__gitlab__}
            case "$t" in
                get_*|list_*|search_*|verify_*|download_*|my_issues|mr_discussions|merge_merge_request|\
                approve_merge_request|unapprove_merge_request|create_issue|update_issue|create_issue_link|\
                create_note|create_issue_note|update_issue_note|create_merge_request_note|update_merge_request_note|\
                create_merge_request_thread|create_merge_request_discussion_note|update_merge_request_discussion_note|\
                resolve_merge_request_thread|*draft_note|bulk_publish_draft_notes) return 0 ;;
            esac ;;
        mcp__GitKraken__*)
            t=${t#mcp__GitKraken__}
            case "$t" in
                git_log_or_diff|git_blame|git_status|git_graph|git_fetch|gitkraken_workspace_list|gitlens_launchpad|\
                issues_get_detail|issues_assigned_to_me|pull_request_assigned_to_me|pull_request_get_detail|\
                pull_request_get_comments|repository_get_file_content) return 0 ;;
            esac ;;
        *) return 0 ;;
    esac
    return 1
}

# FAST PATH, no jq. The PreToolUse matcher is the catch-all so the triage gate
# sees every call, and one jq start costs ~30 ms on a slow CPU: the tools this
# script does not handle are decided with bash regexes alone. They leave at
# once unless the triage gate applies, in which case the full path below
# refuses them. A forge write from the main thread (reviewer gate, above) is
# the one other case that goes on to the full path.
if [[ $INPUT =~ \"hook_event_name\":\ ?\"PreToolUse\" ]] && [[ $INPUT =~ \"tool_name\":\ ?\"([^\"]+)\" ]]; then
    fp_tool=${BASH_REMATCH[1]}
    case "$fp_tool" in
        Bash|Write|Edit|MultiEdit|NotebookEdit|TaskCreate|TodoWrite|mcp__*tasks__task_*) ;;
        Read|Glob|Grep|LS|ToolSearch|AskUserQuestion) exit 0 ;;
        *)
            [[ $INPUT =~ \"agent_id\":\ ?\"[^\"]+\" ]] && exit 0
            fp_gate=0
            if [ "${KODFLOW_ROOT:-}" != off ] && ! [[ $INPUT =~ \"permission_mode\":\ ?\"plan\" ]] && ! _forge_ok "$fp_tool"; then
                fp_gate=1
            fi
            fp_dir=""; fp_sid=""
            [[ $INPUT =~ \"scratchpad_dir\":\ ?\"([^\"]*)\" ]] && fp_dir=${BASH_REMATCH[1]}
            [[ $INPUT =~ \"session_id\":\ ?\"([^\"]*)\" ]] && fp_sid=${BASH_REMATCH[1]//[^A-Za-z0-9_-]/}
            [ $fp_gate -eq 1 ] || [ -f "${fp_dir:-${TMPDIR:-/tmp}/claude-hooks-${fp_sid:-default}}/triage-pending" ] || exit 0 ;;
    esac
fi

command -v jq >/dev/null 2>&1 || exit 0

# One jq call reads every field a branch below may need. @sh single-quotes
# each value, so a crafted path or command cannot escape into this shell.
eval "$(printf '%s' "$INPUT" | jq -r '@sh "EV=\(.hook_event_name // "") TOOL=\(.tool_name // "") SID=\(.session_id // "") CWD=\(.cwd // "") SCRATCH=\(.scratchpad_dir // "") CMD=\(.tool_input.command // "") FILE=\(.tool_input.file_path // "") ERR=\(.error // "") AID=\(.agent_id // "") PMODE=\(.permission_mode // "") NB=\(.tool_input.notebook_path // "")"' 2>/dev/null)" || exit 0

SID=${SID//[^A-Za-z0-9_-]/}; SID=${SID:-default}
PROJECT_DIR=${CLAUDE_PROJECT_DIR:-${CWD:-$PWD}}
STATE=${SCRATCH:-${TMPDIR:-/tmp}/claude-hooks-$SID}   # session-scoped state; on-stop.sh reads it
LIB=${BASH_SOURCE[0]%/*}/lib

# REVIEWER GATE. A PreToolUse payload carries agent_id only when the call
# comes from inside a subagent; the main thread sends none (measured on 855
# real events: every PreToolUse carrying agent_id came from a subagent, no
# main-thread one did). That asymmetry is the whole mechanism. Plan mode
# mutates nothing, and KODFLOW_ROOT=off turns the gate off for the session.
ROOT_MAIN=0
[ "$EV" = PreToolUse ] && [ -z "$AID" ] && [ "$PMODE" != plan ] && [ "${KODFLOW_ROOT:-}" != off ] && ROOT_MAIN=1

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
        printf '%s' "$INPUT" | KODFLOW_ROOT_GUARD=${ROOT_GUARD:-} jq -c --arg b "$BRANCH" -f "$LIB/event.jq" >> "$dir/session.jsonl" 2>/dev/null
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
# Reviewer gate · the main thread triages, dispatches, reviews and merges
# ============================================================================
# The user's rule: the main thread produces nothing. It files messages,
# manages epics and tasks, dispatches, reviews, merges after the user's OK and
# informs; every epic is carried by a subagent in its own git worktree that
# delivers through a PR. The denial is the only channel back to the model, so
# it carries the briefing contract, not just the refusal. $1 = escape hatch.
_root_deny() {
    ROOT_GUARD=deny
    _block "BLOCKED — the main thread reviews, it does not produce" \
        "Main triages, manages epics and tasks, dispatches, reviews, merges after the user's OK, and informs." \
        "Code, repositories and installs go through a subagent in its own git worktree" \
        "(~/Documents/worktrees/<repo>-<epic-slug>) that delivers through a PR. Brief it with what you know:" \
        "  - the epic (task_focus it before dispatching, so the subagent is attributed to it) and its task ids" \
        "  - the objective, and the C-NNN constraints that apply to it" \
        "  - the exact paths and line numbers you read, and what is already decided" \
        "  - the return contract: PR number, what was verified versus assumed, a compact summary" \
        "An epic that already has a subagent: SendMessage it rather than starting another." \
        "Still yours: reading, read-only git/gh, tests and checks, gh pr merge, your memory and the Claude configuration." \
        "$@"
}

# A git segment that only reads (or fetches). The subcommand is found past
# `-C dir`, `-c k=v` and long globals, with the same shape the guard below uses.
_git_readonly() {
    local seg=$1 sub args
    [[ $seg =~ ^[^[:space:]]+([[:space:]]+(-C|-c)[[:space:]]+[^[:space:]]+|[[:space:]]+--[^[:space:]]+)*[[:space:]]+([a-z][a-z-]*)(.*)$ ]] || return 1
    sub=${BASH_REMATCH[3]}; args=${BASH_REMATCH[4]}
    case "$sub" in
        status|log|show|fetch|rev-parse|ls-files|ls-tree|ls-remote|describe|blame|shortlog|cat-file|for-each-ref|\
        whatchanged|grep|count-objects|version|merge-base|rev-list|name-rev|check-ignore|help) return 0 ;;
        diff) [[ $args =~ --output ]] && return 1; return 0 ;;
        reflog) [[ $args =~ (^|[[:space:]])(expire|delete)([[:space:]]|$) ]] && return 1; return 0 ;;
        # These list with no argument and mutate as soon as one appears: `git
        # branch` prints, `git branch x` creates. Only the listing forms pass.
        branch|tag)
            [[ $args =~ ^([[:space:]]+(-v|-vv|-a|-r|-l|--list|--all|--remotes|--show-current|--verbose|--merged|--no-merged|--contains|--sort=[^[:space:]]+|--format=[^[:space:]]+))*[[:space:]]*$ ]] ;;
        remote) [[ $args =~ ^[[:space:]]*(-v|--verbose|show([[:space:]].*)?|get-url([[:space:]].*)?)?[[:space:]]*$ ]] ;;
        worktree) [[ $args =~ ^[[:space:]]+list([[:space:]]|$) ]] ;;
        stash) [[ $args =~ ^[[:space:]]+(list|show)([[:space:]]|$) ]] ;;
        config) [[ $args =~ (^|[[:space:]])(--get|--get-all|--get-regexp|--list|-l)([[:space:]]|$) ]] ;;
        *) return 1 ;;
    esac
}

# gh / glab: the read verbs, `pr merge` / `mr merge` (the user merges through
# the main thread, after their OK), reviews, issues and comments (the same
# set the forge MCP tools leave to it), and `api` as a GET.
_forge_cli_ok() {
    local seg=$1 area verb
    [[ $seg =~ ^[^[:space:]]+([[:space:]]+(-R|--repo)[[:space:]]+[^[:space:]]+)*[[:space:]]+([a-z-]+)([[:space:]]+([a-z-]+))? ]] || return 1
    area=${BASH_REMATCH[3]}; verb=${BASH_REMATCH[5]}
    case "$area" in
        api)
            [[ $seg =~ (^|[[:space:]])(-f|-F|--field|--raw-field|--input)([[:space:]=]|$) ]] && return 1
            if [[ $seg =~ (^|[[:space:]])(-X|--method)[[:space:]=]*([A-Za-z]+) ]]; then
                [ "${BASH_REMATCH[3]^^}" = GET ] || return 1
            fi
            return 0 ;;
        search|status) return 0 ;;
    esac
    case "$area/$verb" in
        pr/view|pr/checks|pr/list|pr/diff|pr/status|pr/merge|run/view|run/list|run/watch|issue/view|issue/list|\
        issue/status|repo/view|release/view|release/list|workflow/view|workflow/list|auth/status|\
        pr/review|pr/comment|issue/create|issue/comment|issue/edit|\
        mr/view|mr/list|mr/diff|mr/merge|mr/approve|mr/note|issue/note|ci/view|ci/list|ci/status|ci/trace) return 0 ;;
    esac
    return 1
}

# make: only verification targets, and at least one of them. `make` alone
# runs the default target, usually a build.
_make_ok() {
    local tok skip=0 n=0
    set -f
    for tok in $1; do
        [ $skip -eq 1 ] && { skip=0; continue; }
        case "$tok" in
            make|*/make) ;;
            -C|-f|-j|-l|-o|-W) skip=1 ;;
            -*|*=*) ;;
            test|tests|lint|check|vet|typecheck|fmt-check|format-check|test[-_:]*|lint[-_:]*|check[-_:]*) n=$((n + 1)) ;;
            *) set +f; return 1 ;;
        esac
    done
    set +f
    [ $n -gt 0 ]
}

# The script a shell runs: `bash -n` parses only; otherwise the script must
# be a test suite (a tests/ directory, test_*.sh, *_test.sh, run-tests.sh).
_shell_ok() {
    local tok first=""
    set -f
    for tok in $1; do
        case "$tok" in bash|sh|zsh|*/bash|*/sh|*/zsh) continue ;; -n) set +f; return 0 ;; -*) continue ;; esac
        first=$tok; break
    done
    set +f
    case "$first" in */tests/*|tests/*|*/test/*|test/*|test_*.sh|*/test_*.sh|*_test.sh|run-tests.sh|*/run-tests.sh) return 0 ;; esac
    return 1
}

# One segment that only reads, or only verifies. The allow-list is the safe
# direction: a command nobody classified counts as producing.
_root_seg_ok() {
    local seg=$1 w name next
    # Shell keywords are transparent; wrappers are looked past.
    while :; do
        seg=${seg#"${seg%%[![:space:]]*}"}
        w=${seg%%[[:space:]]*}
        case "$w" in
            if|then|else|elif|do|while|until|'!'|'{'|time|env|command|builtin|nohup|exec|sudo|[A-Za-z_]*=*)
                [ "$w" = command ] && [[ $seg =~ ^command[[:space:]]+-[vV]([[:space:]]|$) ]] && return 0
                next=${seg#*[[:space:]]}; [ "$next" = "$seg" ] && break; seg=$next ;;
            timeout|xargs)
                # past the wrapper's own options and, for timeout, the duration
                next=${seg#*[[:space:]]}; [ "$next" = "$seg" ] && return 1; seg=$next
                while :; do
                    seg=${seg#"${seg%%[![:space:]]*}"}; w=${seg%%[[:space:]]*}
                    case "$w" in
                        -I|-n|-P|-L|-d|-E|-s|-k|--signal|--kill-after) seg=${seg#*[[:space:]]}; seg=${seg#"${seg%%[![:space:]]*}"}; seg=${seg#*[[:space:]]} ;;
                        -*) seg=${seg#*[[:space:]]} ;;
                        [0-9]*) seg=${seg#*[[:space:]]} ;;
                        *) break ;;
                    esac
                    [ -n "$seg" ] || return 1
                done ;;
            *) break ;;
        esac
    done
    w=${seg%%[[:space:]]*}; name=${w##*/}
    case "$name" in
        ""|fi|done|esac|'}'|for|cd|pushd|popd|export|true|false|:|test|'['|'[['|']]'|\
        echo|printf|pwd|ls|cat|head|tail|wc|stat|file|du|df|lsblk|free|which|type|basename|dirname|realpath|readlink|\
        grep|egrep|fgrep|rg|uniq|cut|tr|nl|column|comm|diff|cmp|jq|date|uname|hostname|id|whoami|uptime|ps|pgrep|\
        printenv|md5sum|sha1sum|sha256sum|sha512sum|cksum|base64|xxd|od|strings|man|sleep|shellcheck|pytest) return 0 ;;
        [A-Za-z_]*=*) return 0 ;;
        sort|tree) [[ $seg =~ (^|[[:space:]])(-o|--output)([[:space:]=]|$) ]] && return 1; return 0 ;;
        sed|awk|gawk|yq) [[ $seg =~ (^|[[:space:]])(-[a-zA-Z]*i[a-zA-Z]*|--in-place|--inplace)([[:space:]=]|$) ]] && return 1; return 0 ;;
        find) case " $seg " in *" -delete "*|*" -exec "*|*" -execdir "*|*" -ok "*|*" -okdir "*|*" -fprint"*|*" -fls "*) return 1 ;; esac; return 0 ;;
        git) _git_readonly "$seg" ;;
        gh|glab) _forge_cli_ok "$seg" ;;
        go) [[ $seg =~ ^[^[:space:]]+[[:space:]]+(test|vet|version|env|list|doc)([[:space:]]|$) ]] ;;
        cargo) [[ $seg =~ ^[^[:space:]]+[[:space:]]+(test|clippy|check|--version)([[:space:]]|$) ]] ;;
        npm) [[ $seg =~ ^[^[:space:]]+[[:space:]]+(test|ls|view|run[[:space:]]+(test|lint|check|typecheck)[^[:space:]]*)([[:space:]]|$) ]] ;;
        make) _make_ok "$seg" ;;
        python|python3)
            [[ $seg =~ ^[^[:space:]]+[[:space:]]+(-m[[:space:]]*(unittest|pytest)|--version|-V)([[:space:]]|$) ]] && return 0
            [[ $seg =~ ^[^[:space:]]+[[:space:]]+([^[:space:]-][^[:space:]]*) ]] || return 1
            case "${BASH_REMATCH[1]}" in */tests/*|tests/*|test_*.py|*/test_*.py) return 0 ;; esac
            return 1 ;;
        bash|sh|zsh) _shell_ok "$seg" ;;
        claude) [[ $seg =~ ^[^[:space:]]+[[:space:]]+(plugin|mcp|--version|-v)([[:space:]]|$) ]] ;;
        systemctl) [[ $seg =~ (^|[[:space:]])(status|is-active|is-enabled|is-failed|list-units|list-timers|show|cat)([[:space:]]|$) ]] ;;
        journalctl) [[ $seg =~ --(vacuum|rotate|flush) ]] && return 1; return 0 ;;
        docker) [[ $seg =~ ^[^[:space:]]+[[:space:]]+(ps|images|logs|inspect|version|info)([[:space:]]|$) ]] ;;
        *) return 1 ;;
    esac
}

# Quote-aware pass over a command line, in one awk: quoted text becomes Q so
# a `>` or `;` inside quotes is not read as shell syntax, and a command
# substitution inside double quotes — which runs — becomes a segment of its
# own that nothing classifies. Unbalanced quotes (a heredoc body, a typo) are
# unclassifiable, so they count as producing too.
_root_scan() {
    printf '%s' "$1" | awk 'BEGIN { RS = "\001" } {
        s = $0; n = length(s); st = 0; out = ""; sub_dq = 0
        for (i = 1; i <= n; i++) {
            c = substr(s, i, 1)
            if (st == 0) {
                if (c == "\\") { out = out c substr(s, i + 1, 1); i++; continue }
                if (c == "\047") { st = 1; out = out "Q"; continue }
                if (c == "\"") { st = 2; out = out "Q"; continue }
                out = out c
            } else if (st == 1) {
                if (c == "\047") st = 0
            } else {
                if (c == "\\") { i++; continue }
                if (c == "\"") { st = 0; continue }
                if (c == "`" || (c == "$" && substr(s, i + 1, 1) == "(")) sub_dq = 1
            }
        }
        printf "%s", out
        if (sub_dq) printf "\n__substitution__"
        if (st != 0) printf "\n__unbalanced__"
    }' 2>/dev/null
}

# GATE · a main-thread Bash line passes only when every segment reads or
# verifies. Any redirection other than to /dev/null or between descriptors
# makes the line producing, and one producing segment condemns the line.
_root_gate_bash() {
    [ "$ROOT_MAIN" = 1 ] || return 0
    # ROOT_OK=1 <cmd> is the per-line opt-out, spelled like NO_RTK=.
    [[ $CMD =~ ^([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*ROOT_OK=1([[:space:]]|$) ]] && return 0
    command -v awk >/dev/null 2>&1 || return 0
    local q seg
    q=$(_root_scan "$1")
    [ -n "$q" ] || return 0
    while [[ $q =~ ([0-9]*\>\&([0-9]+|-)|\&\>[[:space:]]*/dev/null|[0-9]*\>\>?[[:space:]]*/dev/null) ]]; do
        q=${q/"${BASH_REMATCH[0]}"/ }
    done
    [[ $q == *">"* ]] && _root_deny "Escape hatch: prefix the line with ROOT_OK=1, or set KODFLOW_ROOT=off for the session."
    while [[ $q =~ \$\{[A-Za-z_][A-Za-z0-9_]*\} ]]; do q=${q/"${BASH_REMATCH[0]}"/\$V}; done
    # Command and process substitutions, innermost first: the inner command
    # becomes a line of its own, the outer one keeps a placeholder word.
    local inner="" p nl=$'\n' re_sub='(\$\(|<\(|>\()([^()]*)\)' re_bt='`([^`]*)`'
    while [[ $q =~ $re_sub ]]; do inner+=$nl${BASH_REMATCH[2]}; q=${q/"${BASH_REMATCH[0]}"/V}; done
    while [[ $q =~ $re_bt ]]; do inner+=$nl${BASH_REMATCH[1]}; q=${q/"${BASH_REMATCH[0]}"/V}; done
    q+=$inner
    # What is left of ( ) and ` is a subshell or something unparsed: split there.
    for p in '(' ')' '`'; do q=${q//"$p"/$nl}; done
    _split "$q"
    for seg in "${SEGS[@]}"; do
        _root_seg_ok "$seg" || _root_deny "Escape hatch: prefix the line with ROOT_OK=1, or set KODFLOW_ROOT=off for the session." \
            "Refused segment: ${seg:0:120}"
    done
}

# GATE · a main-thread Write/Edit only on its own memory and the Claude
# configuration. A path with a .. component is never trusted.
_root_gate_edit() {
    [ "$ROOT_MAIN" = 1 ] || return 0
    local f=${FILE:-$NB} cfg=${CLAUDE_CONFIG_DIR:-$HOME/.claude}
    cfg=${cfg%/}
    case "$f" in
        */../*|*/..|*/./*) ;;
        "$cfg"/projects/*/memory/*|"$cfg"/settings.json|"$cfg"/settings.local.json|"$cfg"/CLAUDE.md|"$HOME"/CLAUDE.md) return 0 ;;
    esac
    _root_deny "Allowed here: $cfg/projects/*/memory/, $cfg/settings.json, settings.local.json, $cfg/CLAUDE.md, ~/CLAUDE.md." \
        "Escape hatch: KODFLOW_ROOT=off disables the gate for the session."
}

# ============================================================================
# PreToolUse · Bash
# ============================================================================
pre_bash() {
    [ -n "$CMD" ] || exit 0
    local norm=$CMD
    case "$norm" in "rtk proxy "*) norm=${norm#rtk proxy } ;; "rtk "*) norm=${norm#rtk } ;; esac
    _root_gate_bash "$norm"

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
    _root_gate_edit
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
    PreToolUse/mcp__github__*|PreToolUse/mcp__gitlab__*|PreToolUse/mcp__GitKraken__*)
        [ "$ROOT_MAIN" = 1 ] && ! _forge_ok "$TOOL" && _root_deny \
            "Forge tools left to the main thread: reads, merge, issues and comments, reviews." \
            "Escape hatch: KODFLOW_ROOT=off disables the gate for the session."
        exit 0 ;;
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
    # OBSERVE: the other half of the measurement — how often the main thread
    # delegated, counted against how often it was stopped.
    PostToolUse/Task|PostToolUse/Agent)                     ROOT_GUARD=dispatch; _log; exit 0 ;;
    *)                                                      _log; exit 0 ;;
esac

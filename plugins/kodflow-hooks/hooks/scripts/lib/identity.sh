# identity.sh — the identity a commit goes out with, held to its forge.
# shellcheck shell=bash
#
# A commit carries a name and an address to wherever its repository is
# pushed. The user's rules say which identity each forge gets, so that an
# address meant for one host never lands on another. The rules are the
# user's, outside any repository: this file ships the mechanism only.
#
#   ${CLAUDE_CONFIG_DIR:-~/.claude}/kodflow/commit-identity.conf
#   (KODFLOW_COMMIT_IDENTITY=<path> names another file, =off turns it off)
#
# One rule a line, the first that matches wins; `#` and blank lines skipped:
#
#   <host glob>  <path glob>  <name> <<email>>
#   github.com   *            Jane Doe <jane@users.noreply.example>
#   codeberg.org *            jdoe <>
#
# The host is matched without case, the path (owner/repo, no .git) as
# written; `*` crosses a `/`. `<>` is an empty address, which git accepts
# (`kodflow <>`, with or without user.useConfigOnly; tests/test_identity.sh).
# One line that does not read this way voids the whole file: the check is
# then off, and says so, rather than enforce half a policy.
#
# The repository's forge is the origin remote, as `git remote get-url` gives
# it (insteadOf applied). No origin, or a host no rule names: refused. The
# identity is the one git will write: `git var GIT_AUTHOR_IDENT` and
# GIT_COMMITTER_IDENT run in the commit's directory, with the -c options and
# the GIT_* / EMAIL / HOME variables the command line gives git, then
# --author, or the reused commit's author (--amend, -C, -c) unless
# --reset-author. Anything the reader cannot know for sure — a `$` in a
# value, git failing — leaves the commit alone: only a proven mismatch blocks.
#
#   . "$LIB/identity.sh"
#   kf_ident_rules FILE       → KF_IR_* arrays; rc 1 absent, 2 malformed (KF_IR_ERR)
#   kf_ident_url URL          → KF_IH host, KF_IP path; rc 1 when it names no host
#   kf_ident_match HOST PATH  → KF_IM the rule's index; rc 1 when none
#   kf_ident_check DIR        → rc 0 pass, 2 refuse (KF_ID_TITLE, KF_ID_MSG),
#                               3 no rules file, 4 rules file malformed
#     reads KF_ID_CFG (git's global options: -c x=y, --config-env=…),
#     KF_ID_ENV (`NAME=value` export, `-NAME` unset, `!` env -i),
#     KF_ID_AUTHOR, KF_ID_REUSE (a commit), KF_ID_AMEND, KF_ID_RESET, KF_ID_UNSURE.

KF_IR_HOST=(); KF_IR_PATH=(); KF_IR_NAME=(); KF_IR_EMAIL=(); KF_IR_ERR=""

kf_ident_file() {
    printf '%s' "${KODFLOW_COMMIT_IDENTITY:-${CLAUDE_CONFIG_DIR:-$HOME/.claude}/kodflow/commit-identity.conf}"
}

kf_ident_rules() {
    local f=$1 line n=0 hg pg rest re='^([^<>]*[^<>[:space:]])[[:space:]]*<([^<>[:space:]]*)>$'
    KF_IR_HOST=(); KF_IR_PATH=(); KF_IR_NAME=(); KF_IR_EMAIL=(); KF_IR_ERR=""
    [ -e "$f" ] || return 1
    [ -f "$f" ] && [ -r "$f" ] || { KF_IR_ERR="unreadable"; return 2; }
    while IFS= read -r line || [ -n "$line" ]; do
        n=$((n+1)); line=${line%$'\r'}
        line=${line#"${line%%[![:space:]]*}"}
        case "$line" in ''|'#'*) continue ;; esac
        read -r hg pg rest <<< "$line"
        if [ -z "$rest" ] || ! [[ $rest =~ $re ]]; then
            KF_IR_ERR="line $n"; KF_IR_HOST=(); return 2
        fi
        KF_IR_HOST+=("$hg"); KF_IR_PATH+=("$pg")
        KF_IR_NAME+=("${BASH_REMATCH[1]}"); KF_IR_EMAIL+=("${BASH_REMATCH[2]}")
    done < "$f"
    [ ${#KF_IR_HOST[@]} -gt 0 ] || { KF_IR_ERR="no rule"; return 2; }
    return 0
}

# https://u@h:443/o/r.git, ssh://u@h:22/o/r, git@h:o/r.git, codecommit::eu-west-1://r.
kf_ident_url() {
    local u=$1 r hp
    KF_IH=""; KF_IP=""
    case "$u" in
        codecommit::*://*) r=${u#codecommit::}; KF_IH=git-codecommit.${r%%://*}.amazonaws.com; KF_IP=${u#*://} ;;
        file://*) return 1 ;;
        *://*)
            r=${u#*://}; hp=${r%%/*}; KF_IP=${r#"$hp"}
            hp=${hp##*@}
            case "$hp" in \[*\]*) hp=${hp%%]*}]; ;; *) hp=${hp%%:*} ;; esac
            KF_IH=$hp ;;
        *:*)
            hp=${u%%:*}
            case "$hp" in */*|'') return 1 ;; esac   # ./a:b is a path, not scp
            KF_IH=${hp##*@}; KF_IP=${u#*:} ;;
        *) return 1 ;;
    esac
    KF_IH=$(printf '%s' "$KF_IH" | tr '[:upper:]' '[:lower:]')
    KF_IP=${KF_IP#/}; KF_IP=${KF_IP%/}; KF_IP=${KF_IP%.git}
    [ -n "$KF_IH" ]
}

# $1 a remote URL → the same without its userinfo (user:token@), for display:
# a refusal is read by the model and lands in the session log.
kf_ident_shown() {
    local u=$1 r hp
    case "$u" in
        *://*@*)
            r=${u#*://}; hp=${r%%/*}
            case "$hp" in *@*) u=${u%%://*}://${hp##*@}${r#"$hp"} ;; esac ;;
    esac
    printf '%s' "$u"
}

kf_ident_match() {
    local h=$1 p=$2 i=0 n=${#KF_IR_HOST[@]} hg
    KF_IM=""
    while [ $i -lt $n ]; do
        hg=$(printf '%s' "${KF_IR_HOST[i]}" | tr '[:upper:]' '[:lower:]')
        # shellcheck disable=SC2053  # the rule is a glob on purpose
        if [[ $h == $hg ]] && [[ $p == ${KF_IR_PATH[i]} ]]; then KF_IM=$i; return 0; fi
        i=$((i+1))
    done
    return 1
}

# git with the command line's environment: run in a subshell, never here.
_kf_ident_git() {
    (
        local op v
        for op in ${KF_ID_ENV[@]+"${KF_ID_ENV[@]}"}; do
            case "$op" in
                '!') while IFS= read -r v; do unset "$v"; done < <(compgen -e | grep -E '^(GIT_[A-Z_]+|EMAIL|HOME|XDG_CONFIG_HOME)$') ;;
                -*) unset "${op#-}" ;;
                *) export "${op?}" ;;
            esac
        done
        exec git "$@"
    ) 2>/dev/null
}

# "Name <email> 1700000000 +0200" → KF_N, KF_E
_kf_ident_split() {
    local s=$1
    case "$s" in *' <'*'>'*) ;; *) return 1 ;; esac
    KF_N=${s%% <*}; s=${s#*<}; KF_E=${s%>*}; KF_E=${KF_E%%>*}
}

kf_ident_check() {
    local dir=$1 file url shown ia ic an ae cn ce src="" en ee lea lee lec
    KF_ID_TITLE=""; KF_ID_MSG=()
    [ "${KODFLOW_COMMIT_IDENTITY:-}" = off ] && return 0
    file=$(kf_ident_file)
    kf_ident_rules "$file"
    case $? in 1) return 3 ;; 2) return 4 ;; esac
    [ "${KF_ID_UNSURE:-0}" = 1 ] && return 0
    command -v git >/dev/null 2>&1 || return 0
    _kf_ident_git -C "$dir" ${KF_ID_CFG[@]+"${KF_ID_CFG[@]}"} rev-parse --git-dir >/dev/null || return 0
    if ! url=$(_kf_ident_git -C "$dir" ${KF_ID_CFG[@]+"${KF_ID_CFG[@]}"} remote get-url origin) || [ -z "$url" ]; then
        KF_ID_TITLE="COMMIT BLOCKED — the repository has no origin remote"
        KF_ID_MSG=("The commit identity is chosen by the forge of origin; $dir has none." \
            "Add it first: git -C $dir remote add origin <url>, then commit.")
        return 2
    fi
    shown=$(kf_ident_shown "$url")
    if ! kf_ident_url "$url" || ! kf_ident_match "$KF_IH" "$KF_IP"; then
        KF_ID_TITLE="COMMIT BLOCKED — no identity rule for the host of origin (${KF_IH:-$shown})"
        KF_ID_MSG=("origin is $shown; no rule of $file names its host." \
            "Add a rule for it there (the user's file), or fix the remote. Unknown hosts are refused.")
        return 2
    fi
    en=${KF_IR_NAME[KF_IM]}; ee=${KF_IR_EMAIL[KF_IM]}
    ia=$(_kf_ident_git -C "$dir" ${KF_ID_CFG[@]+"${KF_ID_CFG[@]}"} var GIT_AUTHOR_IDENT) || ia=""
    ic=$(_kf_ident_git -C "$dir" ${KF_ID_CFG[@]+"${KF_ID_CFG[@]}"} var GIT_COMMITTER_IDENT) || ic=""
    _kf_ident_split "$ic" || return 0
    cn=$KF_N; ce=$KF_E
    if [ -n "${KF_ID_AUTHOR:-}" ]; then
        case "$KF_ID_AUTHOR" in
            *'<'*'>'*) ia=$KF_ID_AUTHOR ;;
            *) ia=$(_kf_ident_git -C "$dir" ${KF_ID_CFG[@]+"${KF_ID_CFG[@]}"} log --all -i -1 --author="$KF_ID_AUTHOR" --format='%an <%ae>') || ia="" ;;
        esac
        src="--author"
    elif [ "${KF_ID_RESET:-0}" != 1 ] && { [ -n "${KF_ID_REUSE:-}" ] || [ "${KF_ID_AMEND:-0}" = 1 ]; }; then
        ia=$(_kf_ident_git -C "$dir" ${KF_ID_CFG[@]+"${KF_ID_CFG[@]}"} log -1 --format='%an <%ae>' "${KF_ID_REUSE:-HEAD}" --) || ia=""
        src="the reused commit (--amend, -C, -c keep its author; --reset-author takes yours)"
    fi
    _kf_ident_split "$ia" || return 0
    an=$KF_N; ae=$KF_E
    lea=$(printf '%s' "$ae" | tr '[:upper:]' '[:lower:]'); lee=$(printf '%s' "$ee" | tr '[:upper:]' '[:lower:]')
    lec=$(printf '%s' "$ce" | tr '[:upper:]' '[:lower:]')
    [ "$an" = "$en" ] && [ "$lea" = "$lee" ] && [ "$cn" = "$en" ] && [ "$lec" = "$lee" ] && return 0
    KF_ID_TITLE="COMMIT BLOCKED — commit identity does not match ${KF_IH}"
    KF_ID_MSG=("origin: $shown (rule: ${KF_IR_HOST[KF_IM]} ${KF_IR_PATH[KF_IM]})" \
        "expected:  $en <$ee>" \
        "author:    $an <$ae>${src:+  (from $src)}" \
        "committer: $cn <$ce>" \
        "Set it in this repository (the hook never changes the configuration):" \
        "  git -C $dir config user.name \"$en\"" \
        "  git -C $dir config user.email \"$ee\"" \
        "and drop any --author, -c user.*, GIT_AUTHOR_* or GIT_COMMITTER_* on the line that sets another identity.")
    return 2
}

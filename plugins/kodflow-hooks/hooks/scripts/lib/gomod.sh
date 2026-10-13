# gomod.sh — which Go project a changed file belongs to, without a fork.
# shellcheck shell=bash
#
# A Go project is the go.mod nearest the file, never above the project root:
# making.codes has none at its root, only projects/making.codes/go.mod. The
# linter hooks (the :7717 probe, project-linter) run only for such a file.
# The same rule is written in hooks/mod/lint.ts (goModuleOf); both are held
# to tests/fixtures/gomod.json.
#
# Results come back in variables, not on stdout: a $( ) would fork per file.
#
#   . "$LIB/gomod.sh"
#   kf_gomod FILE ROOT        → KF_GOMOD = the module directory; rc 1 when none
#   kf_gomods ROOT <<< LIST   → KF_GOMODS = each module of the list, once,
#                               one per line in order; rc 1 when none

kf_gomod() {
    local f=$1 root=${2%/} d
    KF_GOMOD=""
    [ -n "$root" ] || root=/
    case "$f" in /*) ;; *) return 1 ;; esac
    if [ "$root" != / ]; then
        case "$f" in "$root"/*) ;; *) return 1 ;; esac
    fi
    d=${f%/*}; [ -n "$d" ] || d=/
    while :; do
        [ -f "${d%/}/go.mod" ] && { KF_GOMOD=$d; return 0; }
        { [ "$d" = "$root" ] || [ "$d" = / ]; } && return 1
        d=${d%/*}; [ -n "$d" ] || d=/
    done
}

kf_gomods() {
    local root=$1 f seen=$'\n'
    KF_GOMODS=""
    while IFS= read -r f; do
        [ -n "$f" ] || continue
        kf_gomod "$f" "$root" || continue
        case "$seen" in *$'\n'"$KF_GOMOD"$'\n'*) continue ;; esac
        seen="$seen$KF_GOMOD"$'\n'
        KF_GOMODS="$KF_GOMODS$KF_GOMOD"$'\n'
    done
    KF_GOMODS=${KF_GOMODS%$'\n'}
    [ -n "$KF_GOMODS" ]
}

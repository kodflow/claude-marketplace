# host.sh — what differs when a hook runs under Git for Windows (MSYS2).
# shellcheck shell=bash
#
# Sourced by every hook before its first jq call. Elsewhere (macOS, Linux,
# WSL) it defines kf_unixpath as a no-op and changes nothing else.
#
# Under Git Bash:
#   - a native jq.exe writes CRLF unless given --binary, which leaves a \r at
#     the end of the last variable each `eval "$(jq -r '@sh ...')"` sets, and
#     of every `jq -r` line read back. jq becomes `jq -b`.
#   - Claude Code hands every path in the Windows spelling (cwd C:\x\y,
#     tool_input.file_path, CLAUDE_PROJECT_DIR), and the hooks test absolute
#     paths with /* and walk them by /. kf_unixpath VAR... rewrites C:\x and
#     C:/x to /c/x, \\srv\share to //srv/share, in place; MSYS's own tools
#     read that form, and a relative path or a POSIX one is left as it is.

case "${OSTYPE:-}" in
    msys*|cygwin*)
        # No probe: a fork costs tens of milliseconds there, on every hook.
        # --binary is in every jq since 1.6 (2018).
        jq() { command jq -b "$@"; }
        kf_unixpath() {
            local _v _p _d _u
            for _v in "$@"; do
                _p=${!_v-}
                case "$_p" in
                    [A-Za-z]:[\\/]*)
                        _p=${_p//\\//}
                        # the drive in lower case, without a fork or bash 4
                        _d=${_p%%:*}
                        _u=ABCDEFGHIJKLMNOPQRSTUVWXYZ
                        _u=${_u%%"$_d"*}
                        [ ${#_u} -lt 26 ] && _d=abcdefghijklmnopqrstuvwxyz && _d=${_d:${#_u}:1}
                        _p=/$_d${_p#?:} ;;
                    '\\'*) _p=${_p//\\//} ;;
                    *) continue ;;
                esac
                printf -v "$_v" '%s' "$_p"
            done
        }
        kf_unixpath CLAUDE_PROJECT_DIR CLAUDE_CONFIG_DIR
        ;;
    *)
        kf_unixpath() { :; }
        ;;
esac

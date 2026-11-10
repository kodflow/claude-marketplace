# rules.sh — standing rules that more than one hook injects, written once.
# shellcheck shell=bash
#
# on-session.sh (every session start, and the post-compaction list) and
# on-agent.sh (SubagentStart) say the same forge rule; a copy in each drifted
# before. Each caller adds only what is its own: the subagent line about a
# missing MCP lives in on-agent.sh.
#
#   . "$LIB/rules.sh"
#   "Forge access: $KF_FORGE_RULE"   "$KF_CI_WATCH_RULE"

KF_FORGE_RULE='mcp__github__* / mcp__gitlab__* first (missing or answering 401: install or configure it first, or say what is missing); gh or glab only for what the MCP lacks; never Claude in Chrome on a forge (refused by default; KODFLOW_FORGE_BROWSER=ask asks the user per call, =off lifts the check).'

# Read by whoever waits on a CI run: the Bash tool stops a foreground command
# at 600 s, and macOS has no timeout(1).
KF_CI_WATCH_RULE='Watching CI: the forge MCP first; when it is missing or fails, gh run watch <id> --exit-status or gh pr checks <n> --watch --fail-fast, read-only, run in the background and followed with Monitor (no timeout(1) on macOS, the Bash tool stops a foreground command at 600 s); then read every check before calling the CI green.'

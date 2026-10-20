#!/usr/bin/env bash
# mod-lane.sh <plugin dir> — `claude plugin test` on a mod, behind a
# precondition that tells the engine's verdict from the mod's
# (kodflow/ktn-linter#788).
#
# `claude plugin test` exits 1 when hooks modules are turned off on the
# machine (a remote switch, disableAllHooks): that says nothing about the mod.
# So the engine is asked first about a probe mod that carries nothing but one
# passing test (scripts/mod-lane/probe). The probe failing with "turned off"
# ends the lane NEUTRAL: exit 0 and a ::warning:: annotation, never red. The
# probe failing any other way is red: the engine itself is broken, and a lane
# that swallows that teaches nothing. The probe passing hands the verdict to
# the mod's own suite, whatever it says.
#
# CLAUDE_BIN names the engine (default: claude on PATH). MOD_LANE_PRECONDITION
# set to "off" skips the probe: the tests use it to watch the lane go red on a
# turned-off engine without it.
#
# Writes "neutral", "pass" or "fail" on its last line, for a caller that keeps
# a record (the latest lane).
set -uo pipefail

plugin="${1:?usage: mod-lane.sh <plugin dir>}"
claude="${CLAUDE_BIN:-claude}"
probe="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/mod-lane/probe"
off_pattern='hooks modules are turned off'

if [ "${MOD_LANE_PRECONDITION:-on}" != off ]; then
  out="$("$claude" plugin test "$probe" 2>&1)"
  rc=$?
  if [ "$rc" -ne 0 ]; then
    printf '%s\n' "$out"
    if printf '%s' "$out" | grep -qi "$off_pattern"; then
      echo "::warning::hooks modules are turned off on this machine: the engine lane is neutral (no verdict on the mod); the node lane still ran"
      echo neutral
      exit 0
    fi
    echo "::error::the engine failed on the probe mod, which carries one passing test: the engine is broken, not the mod"
    echo fail
    exit "$rc"
  fi
fi

"$claude" plugin test "$plugin"
rc=$?
if [ "$rc" -eq 0 ]; then echo pass; else echo fail; fi
exit "$rc"

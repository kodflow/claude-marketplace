#!/usr/bin/env bash
# mod-latest-issue.sh <gap file> <engine version> — the latest lane's one
# rolling issue (kodflow/ktn-linter#788), deduplicated by its label.
#
# The gap file holds what scripts/mod-surface.py gap printed: one line per
# difference between the mod's committed surface and what the latest engine
# reads of it. Its signature is the sha256 of those lines, written into the
# issue's body. Then:
#   - a gap and no open issue under the label: one is opened;
#   - a gap and an open issue with the same signature: nothing is written —
#     two runs on the same gap leave one issue and no noise;
#   - a gap and an open issue with another signature: its body is replaced
#     and a comment names the version;
#   - no gap and an open issue: it is closed with the version that cleared it.
# Never more than one open issue under the label: the oldest is kept.
#
# GH_BIN names the gh binary (the tests hand it a fake); GH_REPO the
# repository when not run inside one.
set -euo pipefail

gap_file="${1:?usage: mod-latest-issue.sh <gap file> <engine version>}"
version="${2:?usage: mod-latest-issue.sh <gap file> <engine version>}"
gh="${GH_BIN:-gh}"
label="mod-latest"
title="kodflow-ktn: the latest Claude Code reads the mod differently"

signature=""
if [ -s "$gap_file" ]; then
  signature="$(sha256sum "$gap_file" | cut -d' ' -f1)"
fi

open="$("$gh" issue list --label "$label" --state open --json number --jq '.[].number' | sort -n | head -n 1)"

if [ -z "$signature" ]; then
  if [ -n "$open" ]; then
    "$gh" issue close "$open" --comment "No gap on Claude Code ${version}: the latest engine reads the mod as the pinned one does."
    echo "closed #$open"
  else
    echo "no gap, no issue"
  fi
  exit 0
fi

body_file="$(mktemp "${TMPDIR:-/tmp}/mod-latest-body.XXXXXX")"
trap 'rm -f "$body_file"' EXIT
{
  echo "The scheduled lane \`mod-latest\` ran kodflow-ktn against Claude Code **${version}** and read it differently from the pinned engine of \`ci.yml\`."
  echo
  echo "It compares only the set of events and \`\$\` calls the mod uses (\`plugins/kodflow-ktn/tests/fixtures/surface.json\`), the validator's findings and the engine suite's verdict:"
  echo
  echo '```'
  cat "$gap_file"
  echo '```'
  echo
  echo "Advisory: no pull request and no release waits on this lane. Bump \`CLAUDE_CODE_VERSION\` of the \`mod-ktn\` job once the mod is fixed for it."
  echo
  echo "<!-- mod-latest-signature: ${signature} -->"
} > "$body_file"

if [ -z "$open" ]; then
  "$gh" label create "$label" --description "kodflow-ktn read differently by the latest Claude Code" --color BFD4F2 --force >/dev/null
  "$gh" issue create --title "$title" --label "$label" --body-file "$body_file"
  echo "opened"
  exit 0
fi

current="$("$gh" issue view "$open" --json body --jq .body)"
if printf '%s' "$current" | grep -qF "mod-latest-signature: ${signature}"; then
  echo "same gap: #$open kept as it is"
  exit 0
fi
"$gh" issue edit "$open" --body-file "$body_file" >/dev/null
"$gh" issue comment "$open" --body "The gap changed on Claude Code ${version}: the description now holds it."
echo "updated #$open"

#!/usr/bin/env bash
# plugins-latest-issue.sh <gap file> <versions> — the plugins-latest lane's one
# rolling issue, deduplicated by its label (calqued on mod-latest-issue.sh).
#
# The gap file holds one line per difference the lane saw with the latest
# Claude Code and Codex: the smoke's verdict, the precedence probe's. Its
# signature is the sha256 of those lines, written into the issue's body. Then:
#   - a gap and no open issue under the label: one is opened;
#   - a gap and an open issue with the same signature: nothing is written;
#   - a gap and an open issue with another signature: its body is replaced
#     and a comment names the versions;
#   - no gap and an open issue: it is closed with the versions that cleared it.
# Never more than one open issue under the label: the oldest is kept.
#
# GH_BIN names the gh binary (the tests hand it a fake); GH_REPO the
# repository when not run inside one.
set -euo pipefail

gap_file="${1:?usage: plugins-latest-issue.sh <gap file> <versions>}"
versions="${2:?usage: plugins-latest-issue.sh <gap file> <versions>}"
gh="${GH_BIN:-gh}"
label="plugins-latest"
title="marketplace: the latest Claude Code or Codex installs the plugins differently"

signature=""
if [ -s "$gap_file" ]; then
  signature="$(sha256sum "$gap_file" | cut -d' ' -f1)"
fi

open="$("$gh" issue list --label "$label" --state open --json number --jq '.[].number' | sort -n | head -n 1)"

if [ -z "$signature" ]; then
  if [ -n "$open" ]; then
    "$gh" issue close "$open" --comment "No gap on ${versions}: the latest hosts install the marketplace as the pinned ones do."
    echo "closed #$open"
  else
    echo "no gap, no issue"
  fi
  exit 0
fi

body_file="$(mktemp "${TMPDIR:-/tmp}/plugins-latest-body.XXXXXX")"
trap 'rm -f "$body_file"' EXIT
{
  echo "The scheduled lane \`plugins-latest\` ran the plugin smoke (\`scripts/tests/smoke-plugins.sh\`) and the manifest precedence probe on **${versions}** and saw:"
  echo
  echo '```'
  cat "$gap_file"
  echo '```'
  echo
  echo "Advisory: no pull request and no release waits on this lane. Move the pins of \`.github/versions.env\` once the marketplace is fixed for these versions."
  echo
  echo "<!-- plugins-latest-signature: ${signature} -->"
} > "$body_file"

if [ -z "$open" ]; then
  "$gh" label create "$label" --description "the marketplace installed differently by the latest Claude Code or Codex" --color BFD4F2 --force >/dev/null
  "$gh" issue create --title "$title" --label "$label" --body-file "$body_file"
  echo "opened"
  exit 0
fi

current="$("$gh" issue view "$open" --json body --jq .body)"
if printf '%s' "$current" | grep -qF "plugins-latest-signature: ${signature}"; then
  echo "same gap: #$open kept as it is"
  exit 0
fi
"$gh" issue edit "$open" --body-file "$body_file" >/dev/null
"$gh" issue comment "$open" --body "The gap changed on ${versions}: the description now holds it."
echo "updated #$open"

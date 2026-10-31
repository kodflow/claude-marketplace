---
name: reference
description: "Find reference images for a combat move (treatise plates, museum objects, Commons photos) with their licence, and fetch the ones the owner keeps: committable ones into art/reference/ with a manifest, non-commercial ones only into an ignored study cache."
when_to_use: Use when a move needs visual references before it is designed or animated, or when /move was run with --references.
argument-hint: '<move-slug> [--tradition <area>] [--weapon <weapon>] ["<what to look for>"]'
model: inherit
effort: low
allowed-tools:
- Read
- Glob
- Grep
- Agent
- AskUserQuestion
- Bash(python3 -I:*)
- Bash(git rev-parse:*)
---

# /reference — images, with the right to use them

$ARGUMENTS

A reference that cannot be shipped can still be studied; it must never end
up in the game's repository by accident. Licences come from the source
itself, never from memory: `../_shared/licence-policy.md` is the policy and
its dated table of sources.

## 1. Candidates

One `Agent` call, `subagent_type: "kodflow-gamedev:reference-specialist-imagery"`,
with the brief of `../_shared/templates/brief.md` (role `imagery`) and what
to look for. It returns candidates: image URL, description page, licence as
the page states it, author, and why the image shows the move.

## 2. The owner keeps some

Show the candidates (title, licence, page); ask which to fetch. A candidate
under a non-commercial or unknown licence is offered as **study only**.

## 3. Fetch

```bash
ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
P="${CLAUDE_PLUGIN_ROOT}"
python3 -I "$P/skills/_shared/scripts/fetch-reference.py" --root "$ROOT" \
  --url <image url> --page <description page> --move <slug> \
  [--licence-id <id> --author "<author>"] [--private]
```

- Wikimedia Commons: licence and author are read from the API; a file
  missing either is refused.
- Any other host: `--licence-id` from the script's allow list, recorded
  `licence_verified: false` until a person confirms it on the page.
- A refusal is reported with its reason, never worked around.

Committable images land in `art/reference/<sha256>.<ext>` with
`art/reference/manifest.json` (sorted, no timestamp) and a `.gdignore`;
study copies in `.cache/anim-ref/`, which ignores itself. Tell the owner
which is which, and that `art/reference/` goes through their normal review.

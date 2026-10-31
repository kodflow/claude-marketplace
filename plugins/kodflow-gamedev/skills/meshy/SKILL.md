---
name: meshy
description: "Generate a character, weapon or prop with Meshy for the game: the asset agent writes the request, the owner approves the credits, meshy.py creates, polls and fetches the GLB with its licence, then the agent and the rig specialist judge it and prepare the retarget."
when_to_use: Use when the owner wants a 3D asset from Meshy (text, concept art or several views) in a project that enables kodflow-gamedev, or wants a Meshy result already fetched judged against the rig.
argument-hint: '<asset-slug> --kind <character|weapon|prop> [--from text|image|multi-image] [--image <path>]... [--plan <free|pro|premium|ultra|studio|enterprise>] [--judge <task-id>] "<what the owner wants>"'
model: inherit
effort: medium
allowed-tools:
- Agent
- Read
- Glob
- Grep
- Write(docs/anim/**)
- AskUserQuestion
- Bash(python3 -I:*)
- Bash(git rev-parse:*)
- Bash(mktemp:*)
---

# /meshy — a generated asset the game can use

$ARGUMENTS

Meshy spends the owner's credits and returns files that expire in three
days, under a licence that depends on the owner's plan. The asset agent
writes the request and judges the result; `meshy.py` is the only thing that
talks to the API; the main thread writes the files. The API facts are in
`../_shared/meshy-api.md`, the licence rule in `../_shared/licence-policy.md`
(section *Meshy outputs*): read them, do not restate them.

## 0. Arguments

- `<asset-slug>`: kebab-case (`hero-ronin`, `kopis-bronze`, `field-banner`).
- `--kind` is required; missing, ask with `AskUserQuestion` (character,
  weapon, prop). In a non-interactive run (`-p`), stop with the usage line.
- `--from`: `image` when `--image` is given once, `multi-image` when two to
  four times, else `text`.
- `--plan`: the owner's Meshy plan; else the project `CLAUDE.md` line that
  states it; else ask (`AskUserQuestion`, the six plans). Never guess it: it
  decides the licence, and `meshy.py` refuses an undetermined one.
- `--judge <task-id>`: skip to step 5 on a task already created and fetched.

## 1. Preconditions

```bash
ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
P="${CLAUDE_PLUGIN_ROOT}"
M="$P/skills/_shared/scripts/meshy.py"
python3 -I -c 'import os,sys; sys.exit(0 if os.environ.get("MESHY_API_KEY") else 1)' \
  && echo "key: set" || echo "key: missing"
```

The key is never printed, passed as an argument or written anywhere. Missing:
tell the owner to export `MESHY_API_KEY` in the shell that starts Claude Code,
and stop after the dry run of step 3.

## 2. The request

One `Agent` call, `subagent_type: "kodflow-gamedev:asset-specialist-meshy"`,
with the brief of `../_shared/templates/brief.md` (role `asset`, mode
`brief`), plus: the kind, the input and its image paths, the plan, the
project's art-direction files and triangle budget when the project has them,
and the owner's words verbatim. It returns `meshy_request` (endpoint,
params, the steps after it, the credits).

Write `meshy_request.params` as is to
`docs/anim/assets/<slug>.request.json`, and each step of `then` to
`docs/anim/assets/<slug>.<n>.<endpoint>.request.json`.

## 3. Dry run and the owner's go

```bash
python3 -I "$M" run --dry-run --endpoint <endpoint> --params "$ROOT/docs/anim/assets/<slug>.request.json" \
  --plan <plan> --asset <slug> --root "$ROOT"
```

Show the owner: the endpoint, the prompt, the parameters that matter
(model type, polycount, pose, PBR, formats), the credits of every step, and
the licence the dry run prints. Ask with `AskUserQuestion`: go, change the
request (back to step 2 with their words), or stop. **No go, no call**: in a
non-interactive run, stop here.

## 4. Create, wait, fetch

```bash
python3 -I "$M" create --endpoint <endpoint> --params <request file> --root "$ROOT"
python3 -I "$M" wait   --endpoint <endpoint> --task-id <id> --max-wait 540 --root "$ROOT"
python3 -I "$M" fetch  --endpoint <endpoint> --task-id <id> --plan <plan> --asset <slug> --root "$ROOT"
```

- `wait` exits 3 while the task runs: call it again with the same id, up to
  60 minutes from creation. Never `create` again for the same request; after
  a refused create, report the script's words.
- A step of `then` waits on the task before it: put that task id in its
  request file (`input_task_id`, `preview_task_id` or `rig_task_id`), then
  create, wait and fetch it the same way.
- `fetch` keeps the GLB by default (`--outputs` takes globs on output
  labels, such as `*glb*,texture_urls.*`). Files land in
  `art/meshy/<sha256>.<ext>` with `art/meshy/manifest.json`.

## 5. Judge

```bash
python3 -I "$M" inspect "$ROOT/art/meshy/<sha256>.glb"
```

In one message, in parallel:

- `asset-specialist-meshy`, mode `judge`, with each `inspect` report and
  manifest entry, the request, and the rig map path;
- for a weapon or a rigged character, `kodflow-gamedev:rig-specialist-ik`
  (role `rig`), with the `inspect` reports, the rig map, and for a
  character the question to settle: the retarget of the Meshy skeleton
  (joint names from `inspect`) to the project rig.

When the asset agent's `retarget.questions_for_rig` raises what the rig
specialist did not answer, send them to it once more. Write both answers
to `docs/anim/assets/<slug>.judgement.json` (`{"asset": …, "rig": …}`).

## 6. Hand over

Tell the owner: the verdict (`accept`, `repair` with the repair, `regenerate` with
the new request), the files and their licence from the manifest, the credits
consumed, and the attribution when the licence asks for one. Import into the
engines is the project's code: name the file and the settings the review
gave, change no scene. `art/meshy/` goes through the owner's normal review;
`docs/anim/assets/` goes to the trail PR (`../_shared/trail.md`).

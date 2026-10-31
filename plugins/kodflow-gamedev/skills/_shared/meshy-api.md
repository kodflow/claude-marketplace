# Meshy API — what the plugin relies on

The one text of the Meshy API facts that `/meshy`, `asset-specialist-meshy`
and `meshy.py` use. Read on **2026-10-31** from Meshy's own documentation;
each section names its page. Licences are not here: they are in
`licence-policy.md` (section *Meshy outputs*). A fact the documentation did
not state is listed under [Unverified](#unverified), never assumed.

| Source | Fetched | sha256 of the body read |
|--------|---------|-------------------------|
| https://docs.meshy.ai/llms.txt | 2026-10-31 | `f067a83dd633944752079a8484f4ef08d9676a615f3a7323f394c14516675b29` |
| https://docs.meshy.ai/llms-full.txt (every page, concatenated) | 2026-10-31 | `5a573583dcb9bbbc28e02e19bc00db235051d183740b0304b1f49d8fe47db00a` |
| https://docs.meshy.ai/openapi.yaml | 2026-10-31 | `693f63f545f7fece9dbd53c8afe6fc25f134544da73b6ebb52e257ddf08edc0b` |

Pages change: re-read the page before relying on a number here, and propose
the correction to this file when it moved.

## Authentication and transport

(docs.meshy.ai/api/authentication)

- Every request sends `Authorization: Bearer <key>`; keys look like
  `msy_…`. A missing or invalid key is `401`.
- HTTPS only. Redirects work for `GET` alone: always call `https://`.
- A key can carry a monthly credit limit and an IP allowlist. A leaked key
  is revoked, not hidden.
- The shared test-mode key was retired on 2026-09-16 (changelog): there is
  no free way to exercise the API. `meshy.py --dry-run` builds the request
  without sending it.
- Base URL: `https://api.meshy.ai/openapi/`.

## Endpoints

(the endpoint pages under docs.meshy.ai/api/)

| Name in `meshy.py` | Create | Get | Input |
|--------------------|--------|-----|-------|
| `text-to-3d` | `POST /openapi/v2/text-to-3d` | `GET /openapi/v2/text-to-3d/:id` | `mode: preview` + `prompt` (800 characters at most); then `mode: refine` + `preview_task_id` |
| `image-to-3d` | `POST /openapi/v1/image-to-3d` | `GET /openapi/v1/image-to-3d/:id` | `image_url`: public URL or `data:` URI, JPG/PNG/WebP, 20 MB at most |
| `multi-image-to-3d` | `POST /openapi/v1/multi-image-to-3d` | `GET …/:id` | `image_urls`: 1 to 4 views of one object, the first is the front |
| `remesh` | `POST /openapi/v1/remesh` | `GET …/:id` | `input_task_id` or `model_url` (GLB, glTF, OBJ, FBX, STL) |
| `retexture` | `POST /openapi/v1/retexture` | `GET …/:id` | `input_task_id` or `model_url`, and one of `text_style_prompt`, `image_style_url`, `multiview_image_urls` |
| `rigging` | `POST /openapi/v1/rigging` | `GET …/:id` | `input_task_id` or `model_url` (GLB only), `height_meters` (default 1.7) |
| `animations` | `POST /openapi/v1/animations` | `GET …/:id` | `rig_task_id` and exactly one of `action_id`, `action_ids` (1 to 10), `motion_task_id` |

Every `GET …/:id/stream` also serves the task as Server-Sent Events, and
`GET /openapi/v1/balance` returns the credits left (free of charge).

### Parameters that decide a game asset

- `model_type`: `standard` (high detail) or `smart-topology` (clean
  triangles at a face count you choose; `ai_model` `meshy-t2` 100–15,000
  faces, default 4,000, or `meshy-t2.5` 100–30,000, default 15,000).
  Smart Topology is triangle-only: `topology: quad` with it is `400`.
- `ai_model`: `latest` = `meshy-7.1` on Text, Image and Multi-Image to 3D;
  `meshy-6`, `meshy-6-lite`. Retexture's newest is `meshy-7` and it
  rejects `meshy-7.1`.
- `should_remesh` (default `false` except on `meshy-6-lite`), then
  `topology` (`triangle` or `quad`), `target_polycount` (remesh range 100 to
  300,000, default 30,000) or `decimation_mode` (1 ultra … 4 low, overrides
  the polycount).
- `pose_mode`: `a-pose`, `t-pose` or `""`. A character meant for rigging is
  generated in a set pose.
- `geometry_resolution`: `standard`, `2k`, `4k` (preview only, `meshy-7.1`,
  +5 credits).
- `enable_pbr` (metallic, roughness, normal maps; off by default),
  `texture_resolution` (`2k`, `4k`, `8k`), `remove_lighting` (default
  `true`), `texture_prompt` or `texture_image_url`.
- `target_formats`: `glb`, `obj`, `fbx`, `stl`, `usdz`, `3mf`; absent, every
  format but `3mf`. A format absent from `model_urls` was not generated.
- `auto_size` (AI estimate of real height) with `origin_at` `bottom`
  (default) or `center`.
- `moderation`: screens the prompt before creating the task.

### Rigging

(docs.meshy.ai/api/rigging)

- Works well only on textured, standard humanoid (bipedal) characters with a
  clear limb structure; not on untextured meshes or non-humanoid assets
  (a weapon or a prop is never rigged here).
- At most 380,000 triangles (a quad counts as 2); remesh first to 300,000 or
  less (150,000 with quads).
- `model_url`: the character's face must point toward **+Z**, the glTF
  forward; another axis makes pose estimation fail (`422`). No Draco above
  100 MB.
- Result: `rigged_character_glb_url`, `rigged_character_fbx_url`, and
  `basic_animations` (walking and running, with and without armature).

### Animation

(docs.meshy.ai/api/animation, docs.meshy.ai/api/animation-library)

- Preset actions by `action_id` from the library
  (`GET /openapi/v1/animations/library`); `action_ids` merges up to 10
  clips into one file, in the order given, each clip named after the
  library entry.
- `post_process.operation_type`: `change_fps` (`24`, `25`, `30`, `60`),
  `fbx2usdz`, `extract_armature`.
- Result: `animation_glb_url`, `animation_fbx_url`, and the processed files.

## Tasks

(docs.meshy.ai/api/task-lifecycle, docs.meshy.ai/llms.txt sections 2 to 4
and 11)

- A create returns `{"result": "<task id>"}`. Statuses: `PENDING`,
  `IN_PROGRESS`, then `SUCCEEDED`, `FAILED` or `CANCELED`; a task may step
  back from `IN_PROGRESS` to `PENDING` without failing.
- Poll the task's `GET`, waiting `Retry-After` seconds between polls (5
  when absent); `429` and `5xx` on a poll are not task failures.
- Wait at least **60 minutes** from `created_at` before giving up; a client
  timeout does not cancel the task. Keep the task id, never create it again.
- A create that timed out or returned `5xx` may still have created the
  task, and there is no idempotency key: list the newest tasks
  (`sort_by=-created_at`) before creating it again. A `4xx` created nothing.
- Credits are charged at creation; only `FAILED` refunds them. `DELETE`
  cancels a `PENDING` task only (`409` once `IN_PROGRESS`).
- Timestamps are Unix **milliseconds**. Each task reports
  `consumed_credits`.
- Typical times (meshy-7.1): preview 75 s, Image to 3D with 2K textures
  about 2 min.

## Credits per request

(docs.meshy.ai/api/pricing)

| Request | Credits |
|---------|---------|
| Text to 3D preview, `meshy-7.1` or `meshy-6` | 20 |
| Text to 3D preview, `meshy-6-lite`, `meshy-t2`, `meshy-t2.5` | 5 |
| Text to 3D refine (2K/4K textures) | 10 (15 at 8K) |
| Image or Multi-Image to 3D, `meshy-7.1`, mesh only / 2K-4K textures / 8K | 20 / 30 / 35 |
| Image to 3D, `meshy-t2` or `meshy-t2.5`, mesh only / 2K-4K / 8K | 5 / 15 / 20 |
| Ultra geometry (`geometry_resolution` `2k` or `4k`) | +5 |
| Retexture (2K/4K) | 10 (15 at 8K) |
| Remesh | 5 |
| Rigging | 5 |
| Animation | 3 per action |

## Limits and retention

(docs.meshy.ai/api/rate-limits, docs.meshy.ai/api/asset-retention,
docs.meshy.ai/api/errors)

- Requests per second: 20 on Pro, Premium, Ultra and Studio, 100 on
  Enterprise. Concurrent tasks: Pro 10, Premium 30, Ultra 100, Studio 60 (20
  on some older plans), Enterprise 100 by default. Every request counts,
  polls included; a team's keys share one budget. Over the limit: `429`; a
  concurrency `429` (`NoMorePendingTasks`) has no `Retry-After`.
- On the Free plan, most requests that create a task return `402`: the API
  is in practice a paid-plan service.
- Generated files are kept **3 days** (non-Enterprise), behind signed URLs
  that expire: download them, and keep the task id.

## Unverified

Looked for in the pages above on 2026-10-31 and not found:

- the bone names, hierarchy, rest pose and finger chains of the rigging
  skeleton: read them from the rigged GLB (`meshy.py inspect`), never from
  memory;
- the unit and the up axis of a generated GLB beyond what glTF 2.0 states
  (metres, +Y up, front +Z), and where the origin sits without `auto_size`;
- what the "machine-readable metadata, digital watermarks, or other
  identifiers" of the terms are in a GLB, and so which GLB field must
  survive an import (see `licence-policy.md`);
- whether the download host is always `assets.meshy.ai` (every example uses
  it; `meshy.py` requires https, not that host);
- an official Python client: none is used, the script speaks HTTP itself.

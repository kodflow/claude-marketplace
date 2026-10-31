# Licence policy — reference images, motion data and generated assets

As of **2026-10-30**, from the plugin's research of that date. Binding for the
`/reference` and `/meshy` skills, `fetch-reference.py`, `meshy.py` and every
agent that proposes an image, a dataset or a generated asset. A rule marked *tier 3* rests on snippets or secondary
reports, not on the source's own page: treat it as a hypothesis to confirm on
the object's own record. The project is assumed **commercial** unless its
`CLAUDE.md` says otherwise.

## What may be committed in a project

| Licence | Commit? | Condition |
|---------|---------|-----------|
| CC0, Public Domain Mark, public domain | yes | none; keep the manifest entry anyway |
| CC BY | yes | attribution (author, licence, source page) in the manifest and in the game's credits |
| CC BY-SA | with care | attribution, and share-alike may extend to a derivative image: commit as reference only, never ship it or a traced derivative inside the game without a decision recorded in an ADR |
| any NC (non-commercial) | **never** | cache only |
| any ND (no derivatives) | **never** | cache only |
| unknown, unclear, "probably free" | **never** | cache only |

Cache only means `.cache/anim-ref/` at the project root, gitignored, never
referenced by a committed file. `art/reference/` holds committed images and
carries a `.gdignore` so Godot does not import them.

## Per-source rules

| Source | Rule | Evidence |
|--------|------|----------|
| The Met | CC0 only for objects marked open access (`isPublicDomain: true` in the collection API record); more than 406,000 such images; never use the Met's name or logo | tier 1, metmuseum.org image-resources policy and github.com/metmuseum/openaccess |
| Cleveland Museum of Art | CC0 only when `share_license_status` is `CC0`; API without key | tier 1, openaccess-api.clevelandart.org |
| Smithsonian Open Access | CC0 (API key from api.data.gov) | **tier 3**, policy page not fetched (403): confirm on the object record |
| Art Institute of Chicago | CC0 per object | **tier 3**, not fetched: confirm per object |
| Rijksmuseum | CC0 or Public Domain Mark | **tier 3**, not fetched: confirm per object |
| Getty Open Content | CC0 | **tier 3**, not fetched: confirm per object |
| British Museum | commercial use under paid licence or forbidden | tier 3, snippets: not committable |
| Wallace Collection | idem | tier 3, snippets: not committable |
| Royal Armouries | idem; MS I.33 scans under a non-commercial licence (its transcription is public domain) | tier 3 snippets; I.33 tier 2 via Wiktenauer |
| Gallica (BnF) | idem | tier 3, snippets: not committable |
| BSB / MDZ | CC BY-NC-SA 4.0 or Public Domain Mark depending on the page read | unresolved conflict: check per object |
| Wiktenauer | CC BY-SA 4.0 by default; staff scans CC0; transcriptions and translations often CC BY-NC-SA | tier 2, License Templates category: read the template on each file page |
| Wikimedia Commons | licence per file, read from the API (below); personality rights may apply to identifiable people even under a free licence | tier 1, MediaWiki API docs; Commons reuse page |
| Europeana | at least 9.1 % of rights statements are inaccurate: never trust the aggregator, follow through to the providing institution's record | study cited by the research |
| AMASS (mocap) | non-commercial; forbids integration into a commercial product | tier 1, amass.is.tue.mpg.de/license.html |
| CMU mocap, 4TU FBX conversion | CC BY-NC 4.0 | tier 1-2 |
| CMU mocap, original database | inclusion in a product allowed; reselling the data forbidden | tier 1-2, mocap.cs.cmu.edu |
| Mixamo | royalty-free in commercial games; raw files may not be redistributed (never commit them in a public repo) | tier 2, Adobe FAQ snippet |
| Cascadeur | free plan is non-commercial | tier 2, plans page snippet |
| MediaPipe Pose Landmarker | code Apache-2.0; the model's licence was **not found**: do not ship output pipelines that embed the model until it is | tier 2 |
| Pexels, Unsplash | terms read only in snippets: not covered by this policy, treat as unknown | research open question |

## Wikimedia Commons, how to read a licence

- Query `https://commons.wikimedia.org/w/api.php?action=query&prop=imageinfo&iiprop=extmetadata|url&titles=File:<name>&format=json`.
- Use `extmetadata.LicenseShortName` (and `License`, `UsageTerms`) for the
  licence, `Artist` (HTML stripped) for the author, `AttributionRequired`,
  and `Restrictions` (personality rights and other non-copyright
  restrictions). Field names checked on a live response on 2026-10-30.
- Missing licence or missing author: reject.
- Rate limits: 10 requests per minute anonymous, 200 per minute with a
  User-Agent that follows the Wikimedia policy (tool name and contact), at
  most 3 concurrent requests. The plugin's scripts run sequentially with a
  compliant User-Agent.

## Manifest of a fetched image

`fetch-reference.py` names the file after the sha256 of its bytes and writes
one manifest entry per image (`manifest.json` beside the images), sorted by
file name and **without any timestamp**, so two fetches of the same set give
the same bytes:

| Field | Content |
|-------|---------|
| `file` | `<sha256>.<ext>`, the extension from the image's magic bytes |
| `sha256` | hex digest of the bytes |
| `url`, `final_url` | the URL asked for, and the URL after redirects (https at every hop) |
| `page` | the human-readable page of the object or file |
| `licence_id` | short id from the script's allow list (`CC0-1.0`, `PDM-1.0`, `PD`, `CC-BY-4.0`, `CC-BY-SA-4.0`, …), or the source's own wording when it is outside the list |
| `licence_verified` | `true` only when read from the source's own API in this fetch (Commons extmetadata); otherwise `false`, until a person confirms it on the page |
| `author` | as the source states it |
| `move` | the move the image was fetched for |
| `committable` | `false` for a study copy |

When the image was fetched is the commit's business, not the manifest's. An
image whose licence is not on the committable list goes to `.cache/anim-ref/`
(which ignores itself) with the same fields, never to `art/reference/`.

## Meshy outputs

Read on **2026-10-31** from Meshy's own pages: the Terms of Service
(https://www.meshy.ai/terms-of-use, "Last Updated: September 19, 2026",
sections 2.3, 2.4, 3.1 to 3.3; body sha256
`801c18a55054776b6945f2523af615c42440969e21589acb68de9fcda9f84a5a`) and the
web app's pricing page (https://docs.meshy.ai/en/webapp/pricing, section
*Licensing*, read through https://docs.meshy.ai/llms-full.txt). Tier 1 for
what they say; this table is not legal advice. Binding for `meshy.py`, which
writes the `licence_id` below from the plan the owner declares.

The licence of a Meshy model follows the **plan of the account when the task
was created**. The API does not return it: the owner states the plan
(`--plan`), and a model whose plan is not stated, or not one of the five
names below, is **never downloaded**.

| Plan at creation | `licence_id` | Who owns the model | Commit? | Condition |
|------------------|--------------|--------------------|---------|-----------|
| `free` | `CC-BY-4.0` | Meshy, licensed to you under CC BY 4.0 | yes | credit Meshy: the manifest's `attribution` and the game's credits ("3D model generated with Meshy, meshy.ai, CC BY 4.0") |
| `pro`, `premium`, `ultra`, `studio`, `enterprise` | `LicenseRef-Meshy-Paid` | you, "to the extent possible under applicable law" | yes | none from Meshy; keep the manifest entry |
| anything else, or not stated | — | unknown | **never** | not downloaded |

Excerpts relied on (Terms of Service, 3.2): "Customers using Meshy's Services
under the free plan, acknowledge and agree that Meshy owns all right, title,
and interest, including all intellectual property rights, in and to the
Customer Output and makes such rights available to free plan customers under
the Creative Commons Attribution 4.0 International License"; "such customers
on a paid Meshy plan own their Customer Output". Pricing page: "Free | CC BY
4.0 | Yes, with attribution | You own the output" and "Pro, Premium, Ultra,
Studio, and Enterprise | Private | Yes, full commercial use | You own the
output" (the page and the terms differ on who owns a free output: the terms,
which bind, say Meshy).

Rules that come with it:

- **Do not strip the AI marks.** Terms 2.4: "You agree not to remove, alter,
  disable, or otherwise tamper with such identifiers" (machine-readable
  metadata, digital watermarks). An import step or an optimiser that rewrites
  a GLB keeps its `asset` block and `extras` untouched. Which fields Meshy
  writes is *unverified* (`meshy-api.md`): until it is known, keep the
  downloaded GLB as the source of truth in the manifest, and treat any
  rewrite as a derivative that keeps every field it can.
- **Rigs and preset animations are Meshy's.** Terms 2.3 and 3.1: animations
  and character rigs Meshy makes available are *Service Assets*, licensed
  "solely to the extent incorporated into and necessary for Customer to use
  and otherwise exploit the Customer Output". A library clip on the Meshy
  character it was applied to ships with that character. Extracting the
  clip to drive **another** character, or the project's own rig, is not
  clearly covered: it needs an owner ADR before it is committed. Retargeting
  the Meshy **mesh** onto the project's rig is the Customer Output itself and
  is not affected.
- **Community page.** Terms 3.3: a model posted to the Meshy Community page
  is licensed to the public under CC0 1.0. Never post a project asset there
  without the owner's decision.
- **Downgrades.** Whether a model made on a paid plan keeps its terms after
  a downgrade is stated only in a help-centre article the research did not
  load (*unverified*): record the plan at creation, which is what the table
  keys on.
- **Inputs.** An `image_url` sent to Meshy is Customer Input: the owner must
  hold the rights to it (terms 2.2). A reference image from `/reference` is
  sent only when its manifest says `committable: true`.
- **Retention.** Files are deleted three days after generation (terms 2.5):
  download within that window or regenerate.

## When a rule here is wrong

Licences change. A source whose own page contradicts this table wins: record
the page, its date and the excerpt in the agent's `sources`, and propose the
correction to this file in the plugin's repository.

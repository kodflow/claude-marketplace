# Source map — where each area starts

The dated list of starting sources the kodflow-gamedev agents begin from.
It is built **only** from the plugin's research
(`.claude/contexts/gamedev-combat-animation.md` of the marketplace, generated
2026-10-30). Nothing here was added from memory: an area the research did not
cover has no entry, and its questions are listed under [Gaps](#gaps).

## How to use this map

- **A date is not a guarantee.** `Fetched` is the day the research read the
  page. Pages move, licences change, translations are revised: re-fetch an
  entry before citing it, and cite what you read in this run, not this map.
- **Status.**
  - `confirmed`: the research cross-checked the claim (several agents or a
    vote agreed).
  - `single-source`: one read, not cross-checked; or read only as a search
    snippet or an abstract, said in the caveat.
  - `not fetched`: the research names the source but could not load it (403),
    or knows it only through secondary citations; no URL is recorded unless
    the research gives one.
- **Tier** follows `panel-output.md`: 1 primary text, facsimile, museum,
  standards body or peer-reviewed paper; 2 scholarly edition, wiki of primary
  sources, a project's own repository; 3 secondary summary; 4 amateur. A tier
  written `1-2` is the research's own hesitation: treat it as 2 until you have
  read the page and can say what it is.
- **What it supports** is the claim the research read there, nothing more. A
  source listed for one claim does not vouch for another one.
- A source you read at work time that is not here goes back in your answer's
  `sources[]` with its URL, date, status and excerpt; the main thread caches
  it (`docs/anim/sources/`) and a later PR may add it to this map.

## Martial — Europe (HEMA)

| Entry | URL | Tier | Fetched | Status | What it supports | Caveats |
|-------|-----|------|---------|--------|------------------|---------|
| Wiktenauer, Zornhau | https://wiktenauer.com/wiki/Zornhau | 2 | 2026-10-30 | confirmed | Zornhau after Meyer (1570): from the right shoulder toward the opponent's left ear, on the diagonal lines; a master strike of Liechtenauer | translations often marked draft |
| Wiktenauer, Fiore dei Liberi (alternate order) | https://wiktenauer.com/wiki/Fiore_de%27i_Liberi/alternate_order | 2 | 2026-10-30 | confirmed | Fiore (c. 1400-1410): 12 longsword guards; Posta di Donna as an active guard for a fendente | postures to be read on the illustrations (Getty, Morgan, Pisani-Dossi), not on the text alone |
| Wiktenauer, MS I.33 | https://wiktenauer.com/wiki/I.33 | 2 | 2026-10-30 | confirmed | MS I.33 (c. 1300-1330), sword and buckler; transcription in the public domain | scans under a Royal Armouries **non-commercial** licence |
| Wiktenauer, Meyer | https://wiktenauer.com/ (exact page not recorded by the research) | 2 | 2026-10-30 | single-source | Meyer's treatise exists on Wiktenauer | page truncated by WebFetch at about 100k of 650k characters; the guards chapter was not reached |
| Longsword cut timing (amateur measurement) | https://science-and-fiction.org/swordfighting/cuts.html | 4 | 2026-10-30 | single-source | explosive longsword cut about 250-350 ms, angular speed about 1000-2000 deg/s | amateur, 100 fps camera: may inform a `proposed` soft threshold only |

## Martial — Greco-Roman antiquity

| Entry | URL | Tier | Fetched | Status | What it supports | Caveats |
|-------|-----|------|---------|--------|------------------|---------|
| The Met, Gladiators: types and training | https://www.metmuseum.org/en/essays/gladiators-types-and-training | 1 | 2026-10-30 | single-source | the gladiator types murmillo, thraex, retiarius, secutor, hoplomachus | an essay on types, not a technique source |

## Martial — South Asia

| Entry | URL | Tier | Fetched | Status | What it supports | Caveats |
|-------|-----|------|---------|--------|------------------|---------|
| Kerala Tourism, Kalaripayattu vadivu | https://www.keralatourism.org/kalaripayattu/meythozhil/vadivu | 1-2 | 2026-10-30 | single-source | animal vadivu: Gaja, Simha, Ashwa, Varaha, Sarpa, Kukkuta, Marjara or Mayura, Matsya | the eighth vadivu varies by lineage (see Conflicts); a state tourism site, not a lineage text |

## Martial — East Asia

| Entry | URL | Tier | Fetched | Status | What it supports | Caveats |
|-------|-----|------|---------|--------|------------------|---------|
| Wikipedia, Jixiao Xinshu | https://en.wikipedia.org/wiki/Jixiao_Xinshu | 3 | 2026-10-30 | single-source | Qi Jiguang, 1560-61; ch. 14 Quanjing Jieyao (about 40 postures), ch. 12 sabre and sword | tier 3: points to the primary text, is not one; chapter numbers depend on the edition |
| Online Books Page (route to HathiTrust scans of 1821 and 1922 editions) | https://onlinebooks.library.upenn.edu/ | 3 | 2026-10-30 | single-source | scans of the Jixiao Xinshu exist on HathiTrust | the research records only the site root, not the item page |

## Martial — Southeast Asia

| Entry | URL | Tier | Fetched | Status | What it supports | Caveats |
|-------|-----|------|---------|--------|------------------|---------|
| Republic Act 9850 (Philippines) | https://legacy.senate.gov.ph/republic_acts/ra%209850.pdf | 1 | 2026-10-30 | confirmed | Arnis is the national martial art and sport of the Philippines (2009) | a law, not a technique source |

## Martial — unarmed (cross-cultural)

No entry. The research found no primary source for boxing, UWW wrestling
rules, judo, Nordic, Persian or Ottoman wrestling. See [Gaps](#gaps).

## Anatomy and biomechanics

| Entry | URL | Tier | Fetched | Status | What it supports | Caveats |
|-------|-----|------|---------|--------|------------------|---------|
| CDC normal joint ROM study (Soucie 2011), site | https://archive.cdc.gov/www_cdc_gov/ncbddd/jointrom/index.html | 1 | 2026-10-30 | confirmed | 674 subjects aged 2-69; 11 motions on 5 joints | no wrist, spine, shoulder abduction or rotation, hip rotation |
| CDC joint ROM data (PDF) | https://stacks.cdc.gov/view/cdc/153156/cdc_153156_DS1.pdf | 1 | 2026-10-30 | confirmed | all ages, passive: shoulder flexion about 170; elbow flexion 148; pronation 80.2 ±6.85; supination 87.1 ±7.6; hip flexion 132, extension 18.5; knee flexion 140; dorsiflexion about 15; plantar flexion about 57 | ceilings, not combat ranges; CDC and AAOS/AMA differ by 5-12 deg |
| Ryu 1991, functional wrist ROM | https://pubmed.ncbi.nlm.nih.gov/1861019/ | 1 | 2026-10-30 | single-source | functional minimum (n=40): extension 60, flexion 54, ulnar deviation 40, radial 17; 70 % of tasks within about 40/40 and 40 combined radial plus ulnar | abstract only |
| Morrey 1981, functional forearm and elbow arc | none recorded (JBJS not open) | 3 | — | not fetched | 50 pronation / 50 supination; elbow 30-130 | known through secondary reports only |
| WikEM joint ROM table | https://wikem.org/wiki/Joint_ROM_(Table) | 3 | 2026-10-30 | single-source | shoulder abduction 180, internal/external rotation 90/90; hip abduction 40, rotation 40/50; cervical rotation 80, lateral flexion 45; thoracolumbar rotation 30 | secondary table |
| Putnam 1993 / Hirashima 2002, 2008, proximal-to-distal sequencing | none recorded | 3 | — | not fetched | proximal-to-distal sequencing is a well-supported heuristic, contested for arm internal rotation | secondary citations only: a `phase_offset` built on it is soft |

## Animation craft and motion metrics

| Entry | URL | Tier | Fetched | Status | What it supports | Caveats |
|-------|-----|------|---------|--------|------------------|---------|
| GDC 2014 Animation Bootcamp (Cartwright, Skullgirls) | https://www.gdcvault.com/play/1020971/ | 2 | 2026-10-30 | confirmed | strong key poses, anticipation and timing under a frame budget (6 frames for a punch) | only the public summary was read |
| Motion generation survey (foot skate, jerk) | https://arxiv.org/pdf/2507.05419 | 2 | 2026-10-30 | single-source | foot skate: a frame counts when the foot is under 5 cm from the ground and moves faster than 0.2 m/s horizontally (2-2.5 cm in some papers); jerk as peak, area, share of high-jerk frames | one paper |
| SmashWiki, Hitlag | https://www.ssbwiki.com/Hitlag | 3 | 2026-10-30 | single-source | hit-stop of 8-15 frames for a 15 % hit depending on the game | community wiki, per-game formulas |
| Longsword cut timing | see Europe | 4 | 2026-10-30 | single-source | — | — |

## Licensing — texts, images, motion data

| Entry | URL | Tier | Fetched | Status | What it supports | Caveats |
|-------|-----|------|---------|--------|------------------|---------|
| Wiktenauer licence templates | https://wiktenauer.com/wiki/Category:License_Templates | 2 | 2026-10-30 | single-source | CC BY-SA 4.0 by default; staff scans CC0; transcriptions and translations often CC BY-NC-SA | read the licence of each page and each file |
| AMASS licence | https://amass.is.tue.mpg.de/license.html | 1-2 | 2026-10-30 | confirmed | non-commercial; integration in a commercial product forbidden | — |
| CMU motion capture database | http://mocap.cs.cmu.edu | 1-2 | 2026-10-30 | confirmed | original CMU data: inclusion allowed, resale of the data forbidden; the 4TU CMU FBX conversion is CC BY-NC 4.0 | plain http as recorded; the FBX conversion is NC |
| The Met, image resources policy | https://www.metmuseum.org/en/policies/image-resources | 1 | 2026-10-30 | confirmed | Open Access: more than 406,000 CC0 images, only those marked OA; do not use the Met's name or logo | — |
| The Met Open Access data | https://github.com/metmuseum/openaccess | 1 | 2026-10-30 | confirmed | the OA flag per object | — |
| MediaWiki API: Imageinfo | https://www.mediawiki.org/wiki/API:Imageinfo | 1 | 2026-10-30 | confirmed | Commons licence per file, read with `prop=imageinfo&iiprop=extmetadata` | — |
| Wikimedia API rate limits | https://www.mediawiki.org/wiki/Wikimedia_APIs/Rate_limits | 1 | 2026-10-30 | confirmed | 10 requests/min anonymous, 200 with a compliant User-Agent; at most 3 concurrent | — |
| Commons, reusing content outside Wikimedia | https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia | not stated | 2026-10-30 | single-source | personality rights may apply even under a free licence | cited in the research's pitfalls only |
| Cleveland Museum of Art Open Access API | https://openaccess-api.clevelandart.org/ | 1 | 2026-10-30 | confirmed | CC0 when `share_license_status=CC0`; no API key | — |
| Smithsonian OA, Art Institute of Chicago, Rijksmuseum, Getty Open Content | none recorded | 3 | — | not fetched | reported CC0 (Smithsonian through an api.data.gov key; AIC per object; Rijksmuseum CC0 or PDM; Getty CC0) | official pages returned 403 |
| British Museum, Wallace Collection, Royal Armouries, Gallica | none recorded | 3 | — | single-source | commercial use under a paid licence, or forbidden | search snippets only |
| Europeana rights-statement accuracy study | https://kl.nl/publicaties/research-paper-the-accuracy-rights-statements-on-europeana-eu/ | not stated | 2026-10-30 | single-source | at least 9.1 % of Europeana rights statements inaccurate | verify each object's rights at the holding institution |
| Mixamo FAQ | https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html | 2 | 2026-10-30 | single-source | royalty-free in commercial games; redistribution of raw files forbidden | snippet only |
| Cascadeur plans | https://cascadeur.com/plans | 2 | 2026-10-30 | single-source | free plan is non-commercial | snippet only |
| MediaPipe Pose Landmarker | https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker | 2 | 2026-10-30 | confirmed (code) | 33 landmarks, 3D world coordinates in metres, video mode; code Apache-2.0 | the model's own licence was not found |
| BSB / MDZ digitised manuscripts | none recorded | — | — | not fetched | conflicting reports: CC BY-NC-SA 4.0 or Public Domain Mark | unresolved: check per object |

## Engines and tooling

| Entry | URL | Tier | Fetched | Status | What it supports | Caveats |
|-------|-----|------|---------|--------|------------------|---------|
| Coding-Solo/godot-mcp | https://github.com/Coding-Solo/godot-mcp | 2 | 2026-10-30 | confirmed | v0.1.1, 14 tools, no animation or skeleton tool | — |
| hi-godot/godot-ai, TOOLS.md | https://github.com/hi-godot/godot-ai/blob/main/docs/TOOLS.md | 2 | 2026-10-30 | confirmed | v4.3.1 (2026-10-24), MIT, Godot 4.7+, 46 tools; `animation_create`, `animation_manage`, `editor_screenshot`; no skeleton tool | — |
| godot-ai-animation-toolkit | https://github.com/michaltomczykowski/godot-ai-animation-toolkit | 2 | 2026-10-30 | single-source | v1.13.0 (2026-09-26), MIT, Godot 4.5-4.7: `animation_rig`, `animation_graph`, `animation_motion`, `animation_inspect` | young, 2 stars; retarget renames tracks only; Godot 4.7.2 compatibility unconfirmed |
| godot-mcp-pro | https://github.com/youichi-uda/godot-mcp-pro | 2 | 2026-10-30 | single-source | proprietary (15 USD); animation and AnimationTree tools including IK, captures | — |
| mcp-for-blender | https://github.com/ahujasid/mcp-for-blender | 2 | 2026-10-30 | confirmed | renamed from blender-mcp, MIT, 9 tools; pose, keyframe and glTF export only through `execute_blender_code` | — |
| blender-mcp on PyPI | https://pypi.org/pypi/blender-mcp/json | 2 | 2026-10-30 | confirmed | 2.0.0 is an alias of mcp-for-blender | — |
| Claude-Code-Game-Studios | https://github.com/Donchitos/Claude-Code-Game-Studios | 2 | 2026-10-30 | confirmed | v1.2.0 (2026-10-19), MIT, 49 agents, no animation or anatomy role | — |
| MADR | https://adr.github.io/madr/ | 1 | 2026-10-30 | confirmed | MADR 4.0.0 (2024-09-17): required sections and front matter | — |
| Claude Code skills | https://code.claude.com/docs/en/skills | 1 | 2026-10-30 | confirmed | SKILL.md under 500 lines; description plus when_to_use cut at 1,536 characters | — |
| Claude Code sub-agents | https://code.claude.com/docs/en/sub-agents | 1 | 2026-10-30 | confirmed | agents need `name` and `description`; `permissionMode`, `mcpServers`, `hooks` ignored for plugin agents | — |
| Claude Code plugins reference | https://code.claude.com/docs/en/plugins-reference | 1 | 2026-10-30 | confirmed | `.claude-plugin/plugin.json`, only `name` required; `claude plugin validate` decides | — |

## Conflicts recorded by the research

| Topic | One side | Other side | Held | Why |
|-------|----------|------------|------|-----|
| Shoulder flexion | CDC about 170 | AAOS about 180 | CDC as measured ceiling | primary data, published protocol |
| Hip flexion | CDC 132 | AAOS about 120 | CDC | same |
| Eighth Kalaripayattu vadivu | Marjara (cat) | Mayura (peacock) | both, marked as lineage variants | different lineages |
| BSB/MDZ licence | CC BY-NC-SA 4.0 | Public Domain Mark | unresolved: check per object | official pages not read |
| Pronation age 20-44 by sex | 82.0 / 76.9 | refuted 0-3 | rejected | verification vote |

## Gaps

These are the research's open questions. **No source is known for them.** An
agent that needs one must find and read a source at work time (tier 1 or 2
for a technique or a hard constraint), or put the claim under `unverified`.
Never fill a gap from memory and present it as sourced.

- **Europe.** Meyer's guards (chapter "Regarding the Stances or Guards",
  Garber translation) not retrieved; Talhoffer, Iberian destreza, messer and
  poleaxe not sourced. Measured kinematics of a cut (Kluwak et al. 2020,
  EUROCAST 2022): access and licence unknown.
- **Antiquity.** Hoplite (aspis, dory), palē and pygmachia not sourced; free
  texts of Polybius book 6 and Vegetius not located; licence of the Perseus
  texts unknown.
- **South Asia.** Gatka, otta, urumi, Mallakhamba not sourced; Dhanurveda
  (dating, which text); Hindu weapons (gada, chakra, astra) and temple
  iconography not sourced.
- **East Asia.** Koryu (names of cuts such as kesa-giri, Itto-ryu) and the
  Nihon Kobudo Kyokai not sourced; Wubei Zhi not sourced; names of jian and
  dao cuts not sourced. Korean sources (Muyedobotongji) not researched.
- **Southeast Asia.** FMA angles of attack and Muay Thai (Mae Mai, Look Mai):
  no primary source. Pencak silat, Krabi-krabong, Bokator and Vietnamese arts
  not researched.
- **Unarmed.** UWW rules, boxing, Nordic, Persian and Ottoman wrestling: no
  primary source. Judo and jujutsu not researched.
- **Anatomy.** Horizontal shoulder abduction; thoracic and lumbar rotation
  measured separately; centre-of-mass margins.
- **Licensing.** Licence of the MediaPipe Pose model; official terms of
  Mixamo, Pexels and Unsplash read only as snippets.
- **Engines.** Actual compatibility of godot-ai-animation-toolkit with
  Godot 4.7.2 (2 stars, no reports).

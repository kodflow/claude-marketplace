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

## Verified sources shipped with the plugin

Cached in the plugin's `sources/` directory beside this file, one file per page, named by the sha256 of the page body when it was checked: URL, check date, match status, the excerpts found, and the hash. A constraint that covers a reference defect may cite one of these hashes as its `source` (the coverage rule accepts them like a project's own `docs/anim/sources/`). They come from the first evaluation run, 2026-10-30, and keep only what is generic: treatises, papers, references, library documentation. Re-check a page before relying on a changed reading of it.

| Source | Tier | Checked | Match | sha256 | First excerpt |
|---|---|---|---|---|---|
| https://arxiv.org/html/2507.05419 | 2 | 2026-10-30 | normalised | `a5dbcfcbd7a82f6213b16067895d0959cfb915710f7ed7fcfe67e90b10280c15` | Foot Sliding Distance measures the average sliding of the foot joints when contact with th |
| https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=19181900&rettype=abstract&retmode=text | 1 | 2026-10-30 | normalised | `7239e2b0e95c6582711db4a48edbf0f06d52a82462bd2ce2f292dff8cdb3ead7` | the arms act as passive mass dampers which reduce torso and head rotation, and upper body  |
| https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=25031455&rettype=abstract&retmode=text | 1 | 2026-10-30 | normalised | `68b6f1a2ea3b02b4e18e7e8af440c8ba4db72d7bd5fefcecc3cbe9ee0f290a35` | We also found that when running without arm swing, subjects significantly increased the pe |
| https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=8505347&rettype=abstract&retmode=text | 1 | 2026-10-31 | normalised | `385cff656d4ade83aa614678d6c67d762f0bf5d9e20b22be8cc649c0345ad1f2` | The motions of segments participating in striking and throwing skills are generally sequen |
| https://nodejs.org/docs/latest-v26.x/api/module.html | 1 | 2026-10-30 | exact | `5f4608a1ea82d14cc519c7076052dfd87e242aec3f561b23e3a361b2a7f1039b` | module.registerHooks(options) |
| https://pubmed.ncbi.nlm.nih.gov/1861019/ | 1 | 2026-10-31 | exact | `fe233b957c191ae90a3e737838a444b0e7d8310d50388075db1a3f15858a3224` | This converts to 40 degrees each of wrist flexion and extension, and 40 degrees of combine |
| https://pubmed.ncbi.nlm.nih.gov/25031455/ | 1 | 2026-10-31 | exact | `0bda8ef4706f19e5a5fb5c124db244f4e6fceb329f3671ff46a60597e7b61dd5` | significantly increased the peak-to-peak amplitudes of both shoulder and pelvis rotation |
| https://raw.githubusercontent.com/mrdoob/three.js/r186/src/animation/AnimationMixer.js | 2 | 2026-10-31 | exact | `7b05af5507aa4edfe3d6b5debcda23c8f0d9b910928debff7fc50748954d533c` | Sets the global mixer to a specific time and updates the animation accordingly. |
| https://science-and-fiction.org/swordfighting/cuts.html | 4 | 2026-10-31 | exact | `7b71dda8ceb46bb5ade793ad9b5624c3075d3a58e55dee307ee1d3d5fdded76f` | Note that generally cuts are fast - with top angular velocities between 1000 and 2000 deg/ |
| https://wikem.org/wiki/Joint_ROM_(Table) | 3 | 2026-10-31 | normalised | `b0d2d31c1d771bb9fc06e41bac0f765f252e78a362bf92189454893fe6d8deba` | Lumbar-thoracic Spine Flexion 45-50 Hyperextension 25 Lateral Flexion 25 Rotation 30 |
| https://wiktenauer.com/wiki/I.33 | 2 | 2026-10-30 | exact | `fbc8f5b80c45c99a31a71c956ace99dffd93ebb871a763a3f08a559348fd3ae7` | have been conceptually restored by artist |
| https://wiktenauer.com/wiki/Liber_de_Arte_Dimicatoria | 2 | 2026-10-31 | exact | `02e0690564136e55fbdef8c3421f0a01cffb9361b006a80386154ce66fe6a9b5` | reach the bare hands of him who executes the abovementioned strikes |
| https://wiktenauer.com/wiki/Liber_de_Arte_Dimicatoria | 2 | 2026-10-31 | exact | `2d987abb24538786a4f9cf656cb36f6fd1ce1aac0f1a84fc4c1b0ad2e2e47da1` | all actions of the guards or the sword terminate, i.e. they end in it and not in the other |
| https://wiktenauer.com/wiki/Liber_de_Arte_Dimicatoria | 2 | 2026-10-31 | exact | `3add49b141e2064e95d6377df65eff8db22edcda32bf21215e7c9c40f2120197` | we speak of the second ward, which is given to the right shoulder |
| https://wiktenauer.com/wiki/Liber_de_Arte_Dimicatoria | 2 | 2026-10-31 | exact | `63da8c302ae1b9b9fb3c1adf95bab6d6e8f0bcd210c607278c07a25d517be57d` | to execute (not to receive) a blow |
| https://wiktenauer.com/wiki/Liber_de_Arte_Dimicatoria | 2 | 2026-10-31 | exact | `7140db80710a30f2d7b492df6255c96c9f4661cf8699cb18e9abf5a5cee9f94c` | Fencing is the ordering of various strikes |
| https://wiktenauer.com/wiki/Liber_de_Arte_Dimicatoria | 2 | 2026-10-31 | exact | `8ad2928e2978d8edfdc201232dcec8dbb2a2048893a11699e4b13c4d037cd160` | a strike from the one assuming the ward is always to be expected, which could divide sword |
| https://wiktenauer.com/wiki/Liber_de_Arte_Dimicatoria | 2 | 2026-10-31 | exact | `949f7dbaecdbeed774f65ebfae7a0abe9d4c6306db7899452374e7339472218f` | from the right side; thirdly, he can execute a blow from the left side |
| https://wiktenauer.com/wiki/Page:MS_I.33_01r.jpg | 2 | 2026-10-30 | exact | `961f77031d3f95688ec3d902de47def894ece3863b706b5473c27e44c79ee0f1` | Humero dextrali datur alter terna sinistro |
| https://wiktenauer.com/wiki/Page:MS_I.33_01v.jpg | 2 | 2026-10-31 | exact | `c50a8dcddafe23d4fd3d4b92569e63e476dabc07d8e8f21946b44b96dc281f8f` | omnes actus custodiarum siue gladij determinantur in ea |
| https://wiktenauer.com/wiki/Page:MS_I.33_02r.jpg | 2 | 2026-10-31 | exact | `2eeeecd1dce53d8d49e809dea85662f55edcd93191ffd3cfcb3adbd48caa1190` | manus regens scutum includitur in manu regente gladium |
| https://wiktenauer.com/wiki/Page:MS_I.33_09r.jpg | 2 | 2026-10-30 | exact | `a2ab430c612c290d38e57cf7b6bdadb405fe3f20a5cd82e17426f61255691655` | sed hic loquimur de secunda custodia que datur humero dextro |
| https://wiktenauer.com/wiki/Page:MS_I.33_09v.jpg | 2 | 2026-10-31 | exact | `41c603ab96634161357faa3d667cde64c3a0a9a01f7177ab47ecb24c6cd95600` | manus nudas ducentis plagas supradictas |
| https://wiktenauer.com/wiki/Page:MS_I.33_10r.jpg | 2 | 2026-10-30 | exact | `67c057cbe3757e0d38f4e155477ec8824a04fd06caaf91c07747cd6f6a4e887e` | Hvmero dextrali datur altera .i. custodia |
| https://wiktenauer.com/wiki/Page:MS_I.33_10v.jpg | 2 | 2026-10-30 | exact | `524c439b8fbee56f76967fd679a02ef53529ef6e236eb52ae76afdfb388a3cee` | contra primam custodiam videlicet sub brachio |
| https://wiktenauer.com/wiki/Page:MS_I.33_11r.jpg | 2 | 2026-10-31 | exact | `d16f05954cf3f288472816f68a028acedb4389dec16329b3231ac7f3e22f44c8` | sacerdos esset in actu ducendi plagam superiorem |
| https://wiktenauer.com/wiki/Page:MS_I.33_20r.jpg | 2 | 2026-10-31 | exact | `05f6c30307b57f75fee7d42b48975a7f250e6317ffe91033be804cd324c857f5` | vltima custodia que nuncupatur langort quam in hoc loco regit sacerdos |
| https://wiktenauer.com/wiki/Page:MS_I.33_20r.jpg | 2 | 2026-10-31 | exact | `0d72b977d621d154321f12967db0e6b7962ffb40cff09099e9b25cb87774146a` | HIc iterum ducitur vltima custodia que nuncupatur langort |

## Reference images shipped with the plugin

The plugin's `references/` directory beside this file: four folios of MS I.33 (fol. 1r, 9r, 10r, 20r) fetched from Wikimedia Commons by `fetch-reference.py` on 2026-10-31, licence read from the Commons API (public domain, author unknown), named by sha256, listed in its `manifest.json` with the Wiktenauer pages kept as links only. See the manifest's note on the Royal Armouries non-commercial statement.

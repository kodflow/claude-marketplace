# Panel output — what every kodflow-gamedev agent returns

The skills of this plugin (`/move`, `/anim-review`, `/reference`, `/meshy`)
brief one agent per role and merge what comes back. A subagent writes nothing in the
project: it returns one JSON object, and only the main thread writes, through
the plugin's scripts. This file is the contract of that object
(`panel-member/v1`). An agent receives this file's absolute path in its brief.

## The object

```json
{
  "schema": "panel-member/v1",
  "agent": "martial-specialist-europe",
  "role": "governing | consulted | anatomy | craft | rig | engine | imagery | asset | director",
  "status": "ok | partial",
  "summary": "<one line>",
  "rules_applied": ["<feedback ADR file name the answer follows>"],
  "techniques": [
    {
      "name": {
        "original": "Zornhau",
        "script": "Latn",
        "language": "Early New High German",
        "transliteration": "Zornhau",
        "translation": "wrath strike"
      },
      "tradition": "Kunst des Fechtens (Liechtenauer lineage)",
      "weapon": "longsword",
      "phases": [
        {"name": "preparation", "key_pose": "<joints and weapon, in words>", "timing": "<share of the move, or frames at the brief's fps>"}
      ],
      "source": {"url": "https://…", "tier": 2, "locator": "<chapter, folio, plate or section>", "fetched": "YYYY-MM-DD", "read": "full | partial | summary"}
    }
  ],
  "constraints": [ "<entries of move-constraints/v1, status proposed>" ],
  "remarks": [
    {"text": "<a remark compatible with the governing technique>",
     "source": {"url": "<optional: the page the remark rests on, also in sources>", "tier": 2, "locator": "…"},
     "alternative": {"name": {"original": "…", "transliteration": "…", "translation": "…"}, "source": {"url": "…", "tier": 1}}}
  ],
  "sources": [
    {"url": "https://…", "fetched": "YYYY-MM-DD", "http_status": 200,
     "excerpt": "<the exact sentence relied on, copied from the page>",
     "sha256": "<sha256 of the fetched body, or null when not computed>",
     "tier": 1, "read": "full | partial | summary"}
  ],
  "consulted": ["<every page and file actually read for this answer, the plugin's and the project's included>"],
  "unverified": ["<claim — what was tried and why it could not be confirmed>"],
  "agent_feedback": "<optional: what in the instructions was wrong or missing; omit when nothing>"
}
```

## Rules every agent holds

- **Names.** A technique, guard, stance, cut or weapon is named in its
  original language and script, with a transliteration (a recognised scheme:
  IAST for Sanskrit and Malayalam, Hepburn for Japanese, Hanyu Pinyin for
  Mandarin, the source's own spelling for historical European texts), an
  English translation, and a tier-1 or tier-2 source. A name that lacks any
  of the four goes under `unverified`, never under `techniques`. The
  source must give the original name; when it gives no translation, your
  own gloss fills `translation`, said so in `unverified`.
- **Tiers.** 1: primary text, facsimile, museum or standards body, peer
  reviewed paper. 2: an established scholarly edition or wiki of primary
  sources (Wiktenauer), a project's own repository or documentation. 3: a
  secondary summary (Wikipedia, WikEM). 4: amateur measurement or forum. Only
  tiers 1 and 2 support a technique or a hard constraint; tier 3 and 4 may
  inform a `proposed` threshold, said so in its `rationale`. A primary
  paper read through its abstract only keeps its tier, with
  `"read": "summary"`.
- **Excerpts.** `excerpt` is copied from the page, not paraphrased. The main
  thread re-fetches the URL and checks the excerpt (`cache-source.py`); an
  excerpt it cannot find is downgraded to `unverified`. A page read only as a
  summary, or truncated, says `"read": "summary"` or `"partial"`.
  `sources` holds only what a technique, a constraint or a remark rests on;
  a page read and not relied on goes in `consulted` only, and an answer
  with nothing to add has empty `sources`.
- **Figures.** A plate or a folio is viewed through WebFetch on the image
  URL (the tool keeps the file in its own results folder, which Read
  opens: a read, not a write of yours) or from the plugin's `references/`.
  A figure has no excerpt: cite it in `consulted` with its locator, and the
  text it illustrates in `sources`. Never copy an image anywhere; what an
  image may become is `licence-policy.md`'s call.
- **No invented source.** No URL, folio, plate or author that was not read in
  this run or listed in `source-map.md` with its date. A gap is reported as a
  gap.
- **Gaps outside your seat.** A rig-map gap you notice that none of your
  constraints needs (a missing prop, landmark or marker) goes under
  `unverified` as `rig map: <name> missing, needed for <what>`, never in
  `remarks`.
- **Phases.** A strike has a preparation, an execution and a recovery. A
  move that holds one pose through a loop (a run in guard, an idle, a
  carry) has one `hold` phase: its key pose is the ward or the carry, its
  timing the loop, and its constraints measure stability, not a strike.
  When the source's technique ends before the clip does (a held ward, then
  a return to guard), the phases stop where the source stops and the rest
  is craft, said so in `timing`.
- **Owner feedback first.** The `RULES digest` line injected at start names
  the owner's feedback rules (`docs/adr/feedback/.RULES.md` of the project).
  A hard rule outranks everything below it: owner ADR > anatomy > governing
  technique > animation craft. Cite the ADR files followed in `rules_applied`.
  The owner's request quoted in the brief says what the move must do; it
  is not a feedback ADR: it sets no severity, and a threshold it implies
  needs a source like any other.
  When the digest says `unavailable`, read `docs/adr/feedback/` yourself.
- **Governing on an area.** A brief that names only the area (`europe`)
  leaves the tradition to the governing agent: choose one treatise or
  lineage, name it in `techniques[].tradition`, and say in `summary` that
  it was your choice, for the director to confirm.
- **Constraints.** Every proposed constraint follows
  `move-constraints.schema.json`, carries `"status": "proposed"`, a
  `rationale` that names its source, and an `observable` per view. A
  threshold with no source is a guess: it may be proposed, as `soft`, with
  the word `guess` in its rationale. A threshold a definition fixes (a sign,
  or the bisector between two cases a source defines, such as 45 degrees
  between an edge-led and a point-led tip) is not a guess: say
  `definitional` in its rationale; it may be `hard` when the definition's
  source is tier 1 or 2. This rule outranks any example of an agent file.
- **Rig names.** Every bone, prop, landmark and marker a constraint names
  comes from the brief's rig map, markers from its `clips.<clip>.markers`.
  The names in an agent file's examples are placeholders: rename them,
  never copy them. A name the map lacks is a gap, reported as one.

## Shell within a Command scope

For every agent whose Command scope allows `curl` to stdout, these forms
are added to it, and nothing else:

- Pipe the body into `grep -n -F '<phrase>'` to find an excerpt in a long
  page, or into `shasum -a 256` for `sha256`: one pipe per fetch, fetch
  again for the other. `-w '\n%{http_code}\n'` prints `http_status`.
  Never `-o`, not even to `/dev/null`, and no file in `$TMPDIR`.
- Local files, JSON included, are read with Read (with `offset` and
  `limit` when large), Glob and Grep, never with `cat`, `sed`, `find`,
  `ls` or an interpreter.

## When consulted

For a martial agent in the `consulted` role, beside its own section:

- **Reads.** An answer with nothing to add needs this file and the area's
  entries of `source-map.md`; read `rom-table.json`,
  `move-constraints.schema.json`, `licence-policy.md` and the rig map when
  a remark or an alternative depends on them.
- **Technique still to be chosen.** The panel runs in parallel, so a
  consulted brief often names no governing technique yet. Return then only
  what holds for any technique of the declared tradition with the declared
  weapon, or nothing pertinent; the director checks each remark against
  the technique it adopts.
- **Alternatives.** An alternative keeps the declared weapon and the move:
  a counterpart that changes the weapon, or carries one culture's grip onto
  another culture's weapon, is not pertinent. When `source-map.md` lists no
  counterpart for the weapon, answer nothing pertinent without searching. A
  counterpart considered and set aside, or blocked by a known gap, goes
  under `unverified` with the reason, never in `remarks`.

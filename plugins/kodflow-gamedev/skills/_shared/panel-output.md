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
     "alternative": {"name": {"original": "…", "transliteration": "…", "translation": "…"}, "source": {"url": "…", "tier": 1}}}
  ],
  "sources": [
    {"url": "https://…", "fetched": "YYYY-MM-DD", "http_status": 200,
     "excerpt": "<the exact sentence relied on, copied from the page>",
     "sha256": "<sha256 of the fetched body, or null when not computed>",
     "tier": 1, "read": "full | partial | summary"}
  ],
  "consulted": ["<every source actually read for this answer>"],
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
  of the four goes under `unverified`, never under `techniques`.
- **Tiers.** 1: primary text, facsimile, museum or standards body, peer
  reviewed paper. 2: an established scholarly edition or wiki of primary
  sources (Wiktenauer), a project's own repository or documentation. 3: a
  secondary summary (Wikipedia, WikEM). 4: amateur measurement or forum. Only
  tiers 1 and 2 support a technique or a hard constraint; tier 3 and 4 may
  inform a `proposed` threshold, said so in its `rationale`.
- **Excerpts.** `excerpt` is copied from the page, not paraphrased. The main
  thread re-fetches the URL and checks the excerpt (`cache-source.py`); an
  excerpt it cannot find is downgraded to `unverified`. A page read only as a
  summary, or truncated, says `"read": "summary"` or `"partial"`.
- **No invented source.** No URL, folio, plate or author that was not read in
  this run or listed in `source-map.md` with its date. A gap is reported as a
  gap.
- **Owner feedback first.** The `RULES digest` line injected at start names
  the owner's feedback rules (`docs/adr/feedback/.RULES.md` of the project).
  A hard rule outranks everything below it: owner ADR > anatomy > governing
  technique > animation craft. Cite the ADR files followed in `rules_applied`.
  When the digest says `unavailable`, read `docs/adr/feedback/` yourself.
- **Constraints.** Every proposed constraint follows
  `move-constraints.schema.json`, carries `"status": "proposed"`, a
  `rationale` that names its source, and an `observable` per view. A
  threshold with no source is a guess: it may be proposed, as `soft`, with
  the word `guess` in its rationale.

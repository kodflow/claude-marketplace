# /search — Phase 10: writing findings back to the local base

The local base only stays useful if research flows back into it. Without this
phase every document drifts until `stale` becomes the normal state and the
local-first gate stops meaning anything — which is exactly what happened to this
base between March and September 2026.

Phase 10 runs after Phase 9 (the context file is already written) and is the
**only** phase permitted to modify `~/.claude/docs/`.

---

## When it runs

| Trigger | Scope |
|---------|-------|
| A `stale`/`expired` doc was consulted **and** the web confirmed or corrected it | that document |
| `/search --refresh <topic>` | every document matching `<topic>` |
| The research produced a genuinely new pattern with no existing document | a new document, only when the user asks for it |

It does **not** run when the query was INTERNAL, when no local document was
matched, or when every fetch failed. Nothing is stamped on the strength of a
search that did not actually verify anything.

---

## The three outcomes

### 1. Confirmed — restamp only

The web agrees with the document. Update the date, change nothing else:

```yaml
verified: 2026-09-08   # /search --refresh restamps this
```

Append a line to the document's `## Sources` section (create it if absent):

```markdown
- Confirmed 2026-09-08 against https://datatracker.ietf.org/doc/html/rfc9700 (tier 1)
```

### 2. Corrected — patch, then restamp

The web contradicts part of the document. Edit **only the contradicted part**,
in place, and record what changed:

```markdown
## Changelog

- **2026-09-08** — the implicit grant recommendation was removed; RFC 9700 §2.1.2
  now forbids it for public clients. Replaced with authorization code + PKCE.
  Source: https://datatracker.ietf.org/doc/html/rfc9700
```

Rules:

- Correct the claim, not the prose around it. A refresh is not a rewrite.
- The correcting source must be tier 1 or 2. A tier-3 corroboration is not
  enough to overwrite a validated document; record it as a conflict instead.
- Keep the old claim visible in the changelog. A reader who followed the old
  advice needs to know it moved, and why.
- Never delete a document. A pattern that fell out of favour gets a
  `> **Status:** superseded by <x> as of <date>` note under its title.

### 3. Contested — record, do not resolve

Sources disagree with each other, or a single tier-2 source contradicts the doc.
Do not restamp. Add:

```markdown
> **Contested (2026-09-08):** <maintainer docs> say X, <RFC> says Y.
> Not resolved — treat this section as unverified until it is.
```

An unresolved conflict left visible is worth more than a confident wrong answer.
`verified` stays at its old date so the index keeps flagging it.

---

## Procedure

1. **Diff intent.** List, per document, exactly which claims the web touched.
   A document nothing touched is not restamped — freshness is evidence of
   verification, not of having been opened.
2. **Show the user the diff** before writing, one line per change. Refreshing is
   a write to a shared knowledge base; it is not a silent side effect.
3. **Apply** with `Edit`, never `Write` — a whole-file rewrite loses the parts of
   the document nobody verified.
4. **Reindex:**

   ```bash
   python3 ~/.claude/docs/reindex.py
   ```

5. **Report** in the context file's *Local base* section: consulted, confirmed,
   corrected, contested — with the dates.

---

## `--refresh <topic>`

Batch mode, used to work down the stale list rather than reacting to one query.

```bash
jq -r '.documents[] | select(.status != "fresh") | [.status,.path,.verified] | @tsv' \
   ~/.claude/docs/INDEX.json
```

For each matching document: research its operational claims (libraries,
versions, defaults, advisories) against tier 1-2 sources, then apply outcome 1,
2 or 3 above.

**Batch limit: 10 documents per invocation.** Beyond that the verification
becomes shallow and the stamps stop meaning anything — which is the failure this
whole mechanism exists to prevent. Report what is left and let the user run it
again.

Order the queue by risk, not alphabetically: `security/` and `devops/` first
(180-day TTL, operational advice, real consequences), structural patterns last.

---

## Guardrails

| Action | Status |
|--------|--------|
| Restamp a document you did not re-verify | **FORBIDDEN** |
| Restamp on a tier-3 or tier-4 source alone | **FORBIDDEN** |
| Rewrite a document wholesale during a refresh | **FORBIDDEN** — patch the contradicted claim |
| Delete a document | **FORBIDDEN** — mark it superseded |
| Resolve a source conflict by picking the convenient side | **FORBIDDEN** — record it as contested |
| Write to `~/.claude/docs/` before Phase 9 finished | **FORBIDDEN** |
| Refresh more than 10 documents in one pass | **FORBIDDEN** |
| Skip the reindex after writing | **FORBIDDEN** — the index would lie |
| Restamp without showing the user what changed | **FORBIDDEN** |

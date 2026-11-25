# Normative work — read the standard, every time

One rule, shared by `/plan`, `/feature`, `/fix`, `/refine`, `/challenge`,
`/review`, `/debug`, `/hunt` and `/search`, and passed to every domain
specialist through its brief. When a skill reaches a step named below, it
applies this file; it never restates it.

A standard read from memory is how a review ships the requirement nobody coded:
the clause that ties a session mode to a static address, the case a hexadecimal
field must be written in, the answer owed to a malformed optional parameter.
None of these is found by reading the code and asking whether it looks right.
They are found by reading the clause and asking whether the code does it.

## 1. When it applies

The work touches a **normed domain** when any of these holds:

- a domain row of `specialists.md` matches the change or the plan (a protocol
  or standard family: mobile core, an IETF protocol, a W3C API, a security
  standard, a system semantics such as systemd);
- the project's constraint ledger (`CLAUDE.md`, `.claude/constraints.md`)
  declares a normative source (section 2);
- the code, the issue or the plan cites a standard: an RFC number, a
  specification number and release, a W3C recommendation, a named profile of a
  security standard.

Outside a normed domain this file does not apply, and no skill pretends it does.

## 2. The source, resolved and probed first

The **normative source** is where the text of the standard is read at a named
version. In this order:

1. what the project declares: a ledger entry such as
   `Normative sources: <MCP server or local cache path or URL>, versions in force: <spec> <version>`;
2. the standards body's own publication at that version (`rfc-editor.org`,
   `datatracker.ietf.org`, `w3.org`, the specification archive of the body
   that publishes it);
3. a local copy under `~/.claude/docs/`, subject to its `verified` date
   (`/search`).

**Probe before the first step**, not when the first clause is needed: one cheap
call that returns the text of one clause the work touches, at the version in
force. Record it as `source: <name> @ <version> — ok`, or the failure and its
exact message. A server listed as failed at session start, a call that errors,
an empty cache and a page that comes back without the clause text are all the
same thing: **the source is unavailable**.

## 3. An unavailable source blocks, it is never silent

When no source of section 2 gives the clause text at the version in force:

- **Stop and ask the user**, at once, with what lifts the block: the server to
  reconnect (`/mcp`) or reconfigure, the cache to fill, the version to
  confirm, or an alternative first-party source to accept. The recommended
  option is restoring the source.
- Until the user answers, every point that depends on a clause is **BLOCKED**,
  naming the clause it waits on. BLOCKED is a status of its own: never folded
  into "open", "needs verification" or "unverified", never resolved by
  default.
- **Forbidden without the clause text in hand:** leaving a point "open for lack
  of a spec", deciding it "as before" or "as the code already does", declaring
  it "free to the author", or approving the change it belongs to. A decision
  the user takes knowingly without the clause is recorded as theirs, with the
  clause it was taken without.

## 4. What every step produces — the conformance matrix

At each step named in section 6, the skill (or the specialist it briefs)
produces or updates one table, one row per requirement:

| Requirement | Source | In the code | Missing | Next version |
|---|---|---|---|---|
| the obligation, quoted (MUST / SHALL / conditional) | spec, version, clause | `file:line` that does it, or `absent` | what is not done, or `none` | what the next version changes in this clause, or `no change in <version checked>` |

The four questions every step answers: **what the standard imposes**, **what
the code already does**, **what is missing**, **what the next version
changes**. A row without a version and a clause is not a row. A `Next version`
cell is filled from the text of that version, or says which version was not
read and why.

The matrix lives where the skill already writes: the plan's context file, the
issue body, the goal contract's constraints, the review report.

## 5. Two directions, both required

- **Code → standard.** For each change, the clause that governs it, and
  whether the change follows it.
- **Standard → code.** For each clause the change touches, list every
  obligation it states, then look for the code that meets it. This is the
  direction that finds what nobody coded. Read the clause for at least:
  mandatory and conditional elements (an element required because of another
  setting); encodings and formats (length, range, case, byte order); the
  handling of a malformed, unknown or missing optional element (the response
  or cause it owes); defaults and timers; and what the clause says
  implementations MUST NOT do.

## 6. Where each skill applies it

| Skill | Step | Output |
|---|---|---|
| `/search` | a query on a standard | the clause text at its version, tier 1; an unreachable source is section 3, never a memory answer |
| `/plan` | before Phase 1 (probe), Phase 4 (consultation) | the matrix in `.claude/contexts/<slug>.md`; every `Missing` row in the plan or explicitly out of scope |
| `/feature`, `/fix` | before the specialist check (1.5) | the matrix in the issue body; for `/fix`, "is it a defect" answered by the clause |
| `/refine` | Phase 3 | each `Missing` row becomes an acceptance criterion or a stated non-goal; BLOCKED rows go in `# CONSTRAINTS` |
| `/challenge` | Phase 0, reference sources | the clause text in every brief; an objection on a normed topic cites the clause |
| `/review` | the conformance pass (`passes.md`, Phase 5.4) | both directions over the clauses the diff touches |
| `/debug` | Phase 1, expected behaviour | the expected behaviour stated from the clause, not from the old code |
| `/hunt` | Phase 0 preflight, matrix cells | a cell per obligation of the clauses in scope; an unavailable source refuses the hunt |

## 7. Briefing a domain specialist

An invoked agent does not read this folder, and its tools may not reach the
project's normative source (a project MCP server is not in a specialist's
tool list). So the caller resolves the source, and the brief carries:

- the clause text, pasted verbatim with spec, version and clause, for every
  clause the work touches (`specialists.md`, « Paste the material inline »);
- this block, verbatim:

```
Normative check. Answer from the clause text above, not from memory.
Return the conformance matrix: requirement (quoted), source (spec, version,
clause), in the code (file:line or absent), missing, next version.
Read each clause for obligations the code does not show (standard -> code),
not only for the code you were shown. A clause you need and do not have is
BLOCKED: name it and what would let you read it; never decide it by default.
```

A specialist answer that decides a normed point without a clause in
`consulted` is a memory claim (`specialists.md`, « What every specialist owes
back ») and the point stays BLOCKED.

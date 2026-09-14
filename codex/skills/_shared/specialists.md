# Specialist routing — who actually knows this technology

One table, shared by `/challenge`, `/feature` and `/fix`, so the three cannot
disagree about who reviews what. When an agent is added or removed, this file is
the only place to change.

## The table

Route on **evidence**. Evidence is a file that exists, a dependency that is
declared, a manifest present — **or, for work not yet built, a technology the
plan explicitly proposes adopting**, named with a version or a concrete API.

That second form matters more than it looks. `/challenge` and `/feature` run
*before* implementation, so requiring an existing artifact routes nothing at
exactly the moment a specialist is most useful: a plan whose first line is "add
a Postgres-backed session store" has no `.sql` file yet, and reviewing it
without the database specialist is how a schema decision ships unexamined.

What is still not evidence: the prose of a description with no technology named,
and a passing mention ("could use Redis later"). A proposal must name the thing
and commit to it.

```bash
ls ~/.codex/agents/*.md | xargs -n1 basename | sed 's/\.md$//'
```

| Evidence | Specialist |
|---|---|
| `.go`, `go.mod`, `go.work` | `developer-specialist-go` |
| `.rs`, `Cargo.toml` | `developer-specialist-rust` |
| `.py`, `pyproject.toml`, `requirements.txt` | `developer-specialist-python` |
| `.ts` `.js` `.mjs`, `package.json` | `developer-specialist-nodejs` |
| a `react` dependency, `.tsx` `.jsx` | `developer-specialist-react` |
| `.c` `.h` | `developer-specialist-c` |
| `.cc` `.cpp` `.hpp` `.cxx` | `developer-specialist-cpp` |
| `.zig`, `build.zig`, `build.zig.zon` | `developer-specialist-zig` |
| PostgreSQL specifically — `postgres`/`psql` present, a Postgres DSN, PG-dialect SQL | `data-specialist-postgres` |
| `Dockerfile`, `docker-compose.y*ml` | `devops-specialist-docker` |
| k8s manifests, `Chart.yaml`, Helm values | `devops-specialist-kubernetes` |
| `.tf`, `.hcl`, Terragrunt | `devops-specialist-infrastructure` |
| Vault, Consul, Nomad, Packer | `devops-specialist-hashicorp` |
| `.github/workflows/` | `tooling-specialist-github-actions` |
| `.sh`, a CI shell step, `Makefile` recipes | `developer-executor-shell` |
| auth, crypto, input handling, a trust boundary **in code** | `developer-executor-security` |
| secrets in config, image/dependency CVEs, compliance **in infrastructure** | `devops-specialist-security` |
| systemd units, packaging, host configuration | `devops-executor-linux` |

**Scope the evidence before matching.** Route on what the *change* touches, not
on what the repository contains: a one-file Go change in a repo that also holds
Terraform and Helm gets the Go specialist, not three. Repository-wide evidence
produces repository-wide fan-out, which costs real quota and buries the finding
that mattered.

Several rows can match on a genuinely cross-cutting change, and then **every
match is dispatched**, deduplicated by agent — one dispatch per specialist even
when three rows point at it. A change
touching Go, Kubernetes and a workflow file gets three specialists, not the one
that felt most relevant.

## Two rules that make it worth doing

**Dispatch every match.** Skipping a matched specialist because the set "feels
big enough" is how a change ships with the exact defect the installed specialist
would have named on sight. If the cost is the concern, that is an argument about
which specialists to install, not about which to consult.

**Report a match with no installed specialist.** Say the domain went unreviewed.
Silence reads as "reviewed and clean", which is the opposite of true.

## What every specialist owes back

Each specialist carries a standing instruction to verify before asserting: an
API's existence, a default, a limit, a deprecation, a version behaviour or a
security property is checked against documentation — `context7` first, then the
vendor's own docs and release notes, then `~/.claude/docs/` **respecting its
`verified` dates**, since a stale entry is a hypothesis rather than a source.

So the brief must ask for the evidence back:

```
Return `consulted`: the documentation you actually checked, per claim that
needed it. Return `unverified`: anything you could not confirm, with what you
tried. A claim about how this technology behaves, with an empty `consulted`
list, is a memory claim — mark it, do not present it as fact.
```

**A technology claim with an empty `consulted` list is not evidence.** Treat it
as unresolved rather than accepting it. This is the whole point of routing to a
specialist instead of reasoning about the technology yourself: not that it knows
more, but that it goes and checks.

## Briefing well

- **Paste the material inline** — the plan, the diff, the description. A
  specialist that has to go fetch what it is judging spends its turns fetching.
- **State the question.** "Is this correct in Go?" gets a survey; "does this
  plan's use of `errgroup` leak the goroutine when the parent context is already
  cancelled?" gets an answer.
- **Say what is already decided.** Pass the constraint ledger's MUST entries, so
  the specialist argues within them rather than against them.

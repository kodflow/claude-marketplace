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
ls ~/.claude/agents/*.md | xargs -n1 basename | sed 's/\.md$//'
```

| Evidence | Specialist | Keywords |
|---|---|---|
| `.go`, `go.mod`, `go.work` | `developer-specialist-go` | golang goroutine goroutines gofmt golangci-lint go.mod go.work .go |
| `.rs`, `Cargo.toml` | `developer-specialist-rust` | rust cargo clippy rustc tokio .rs |
| `.py`, `pyproject.toml`, `requirements.txt` | `developer-specialist-python` | python pytest mypy ruff pyproject asyncio django fastapi .py |
| `.ts` `.js` `.mjs`, `package.json` | `developer-specialist-nodejs` | node nodejs typescript javascript npm pnpm eslint tsconfig .ts .js .mjs .cjs |
| a `react` dependency, `.tsx` `.jsx` | `developer-specialist-react` | react jsx tsx nextjs .tsx .jsx |
| `.c` `.h` | `developer-specialist-c` | c99 c11 c23 valgrind clang-tidy .c .h |
| `.cc` `.cpp` `.hpp` `.cxx` | `developer-specialist-cpp` | c++ cpp cmake .cc .cpp .hpp .cxx |
| `.zig`, `build.zig`, `build.zig.zon` | `developer-specialist-zig` | zig build.zig .zig |
| PostgreSQL specifically — `postgres`/`psql` present, a Postgres DSN, PG-dialect SQL | `data-specialist-postgres` | postgres postgresql psql plpgsql pgbouncer |
| Valkey or a Redis-protocol store — `valkey.conf`, `sentinel.conf`, a Valkey/Redis client | `data-specialist-valkey` | valkey redis |
| `Dockerfile`, `docker-compose.y*ml` | `devops-specialist-docker` | docker dockerfile docker-compose podman |
| k8s manifests, `Chart.yaml`, Helm values | `devops-specialist-kubernetes` | kubernetes k8s k3s helm kubectl kustomize minikube argocd |
| `.tf`, `.hcl`, Terragrunt | `devops-specialist-infrastructure` | terraform opentofu terragrunt .tf .tfvars .hcl |
| Vault, Consul, Nomad, Packer | `devops-specialist-hashicorp` | vault consul nomad packer .nomad |
| `ansible.cfg`, playbooks, `roles/`, inventories | `tooling-specialist-ansible` | ansible playbook playbooks ansible-lint molecule |
| `.github/workflows/` | `tooling-specialist-github-actions` | github-actions actionlint |
| `.gitlab-ci.yml`, an included CI template | `tooling-specialist-gitlab-ci` | gitlab-ci gitlab-runner .gitlab-ci.yml |
| `.proto`, `buf.yaml`, a gRPC service | `developer-specialist-protobuf` | protobuf proto grpc buf.yaml .proto |
| 3GPP/ETSI mobile core — EPC or 5GC functions, Diameter, GTP, PFCP, NAS, LI handover | `domain-specialist-telecom` | 3gpp etsi diameter gtp gtpu pfcp amf smf upf udm nrf mme hss imsi supi |
| `.sh`, a CI shell step, `Makefile` recipes | `developer-executor-shell` | bash shellcheck .sh .bash |
| auth, crypto, input handling, a trust boundary **in code** | `developer-executor-security` | owasp taint injection xss csrf sqli |
| secrets in config, image/dependency CVEs, compliance **in infrastructure** | `devops-specialist-security` | cve trivy grype sbom |
| systemd units, packaging, host configuration | `devops-executor-linux` | systemd systemctl journald |
| reading a codebase to locate code, no change (built-in) | `Explore` | explore locate |

**Keywords** are what the routing gate of kodflow-hooks matches, on the
`description` of a main-thread Agent call alone: whole lower-case words of three
characters or more, and file extensions (a word ending in `.go` matches `.go`).
A call that leaves `subagent_type` out or names `general-purpose`, and whose
description carries a keyword of an installed agent, is refused with the
specialist to use. `[general-purpose-ok]` in its description or prompt is the
deliberate exception, and every skill that means a general-purpose dispatch
writes it. The keywords are compiled into `kodflow-hooks/hooks/routing-index.tsv`
by `scripts/build-routing-index.py`; CI fails when the two disagree.

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

## Plan review, one contract for every specialist

`/challenge` sends a plan, with nothing built yet, to a specialist whose own
definition is written for auditing an artifact and returns JSON or a Dockerfile
verdict. Left alone, each agent arbitrates between the two formats by itself.
The mode below removes the arbitration: one rule, one contract.

An invoked agent does not receive the files of this folder, so the section that
follows is **copied verbatim** into the body of every agent in the routing
table, and `scripts/tests/test_plan_review_mode.py` fails when a routed agent
lacks it or carries a different text. This file holds the canonical wording;
edit it here first, then in every agent. The caller's brief opens with the
literal marker `Plan review mode` and restates the six fields.

## Plan review mode

This mode is on when the brief starts with `Plan review mode`, asks for objections to a plan (nothing built yet), or asks for a read-only review of a plan or code in the caller's own format. One rule decides the format: the caller's format replaces this agent's output format, and no output-format section of this file overrides it. Outside this mode the output format of this file applies unchanged.

In this mode:

- Return objections only. Each objection carries six fields: `severity` (`blocking`, `material` or `minor`), `claim`, `evidence` (a `file:line`, or the plan line it contradicts), `remedy`, `consulted` (the sources actually checked for this claim, one entry per source: a documentation URL, a source file read at a named revision or version as `path@rev` such as `origin/main:path` or `$GOROOT/src/...@go1.x`, or a scratch measurement given as its command and result) and `unverified` (what could not be confirmed, with what was tried). If the brief names a different field list, use the brief's.
- A claim about how a technology behaves with an empty `consulted` is a memory claim: put it under `unverified`, never present it as fact.
- If the plan is sound from this agent's domain, say so and stop. An objection with no concrete failure behind it is noise.
- Stay read-only on the reviewed repository: no file edits, no change to its Git state, manifests or lockfiles, no formatter or fixer that rewrites files, no install or sync. A write is allowed only where this agent's Command scope permits it, and only under the scratch directory the brief names; when the brief names none, write nothing. Prefer a check or diff mode, and report a missing tool, or an execution, network access or write the host refuses, under `unverified`.

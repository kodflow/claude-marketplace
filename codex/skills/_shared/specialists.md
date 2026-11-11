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
| systemd semantics — unit-file directives and sections, `Exec*=` prefixes, `sd_notify`, readiness and watchdog, in a plan or code review | `domain-specialist-systemd` | systemd sd_notify .service .socket .timer |
| a Linux host — administration, packaging, host configuration, live service state | `devops-executor-linux` | systemctl journald |
| reading a codebase to locate code, no change (built-in) | `Explore` | explore locate |

**Keywords** are what the routing gate of kodflow-hooks matches, on the
`description` of a main-thread Agent call alone: whole lower-case words of three
characters or more, and file extensions (a word ending in `.go` matches `.go`).
A call that leaves `subagent_type` out or names `general-purpose`, and whose
description carries a keyword of an installed agent, is refused with the
specialist to use. `[general-purpose-ok]` in its description or prompt is the
deliberate exception, and every skill that means a general-purpose dispatch
writes it. The keywords are compiled into `kodflow-hooks/hooks/routing-index.tsv`
by `scripts/build-routing-index.py`; CI fails when the two disagree. The same
script writes, in a fourth column, whether each routed agent delivers a change
or reviews only ("Who delivers a change" below), and the refusal prints it.

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

## Who delivers a change

A task that writes — a commit, a push, a pull or merge request — goes to a
specialist only when that specialist can deliver: it has `Edit` and `Write`, or
a forge tool that opens a pull or merge request, **and** `Bash` with no
`## Command scope` or one that covers `git commit` and `git push` (a generic
`Bash(git:*)` does). Any other specialist reviews only: `general-purpose`
delivers, its brief carrying `[general-purpose-ok]`, and the specialist reviews
the result. `scripts/build-routing-index.py` computes this from each routed
agent's frontmatter and Command scope (`delivers` or `reviews`), so no list is
kept by hand.

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
- **Give literal paths.** A scratch directory or a file the specialist must
  read or write is named by its absolute path, never by a placeholder such as
  `<scratch>`: a placeholder sends the specialist looking for it.
  Create the scratch directory before dispatch: a reviewer whose scope has no
  `mkdir` cannot, and its measurements then go under `unverified`.
- **Name the commit identity when the brief asks for a commit.** A subagent
  told to commit is told the name and address the commit must carry — the rule
  the identity file gives for the repository's forge (the file
  `KODFLOW_COMMIT_IDENTITY` names, else
  `${CLAUDE_CONFIG_DIR:-~/.claude}/kodflow/commit-identity.conf`), set in the
  worktree's local git config — since the identity check of kodflow-hooks
  refuses any other. With `KODFLOW_COMMIT_IDENTITY=off`, or no file, the check
  is off and the brief names the identity the user asked for. A brief that does
  not ask for a commit says nothing about identity.
- **Give every fact and figure its command.** A count, a size, a line number
  or a "this file does X" carries the command that measured it and its
  result, or says "not verified": a reviewer handed a bare figure either
  trusts it or spends its turns reverse-engineering it.
- **Say which constraint wins.** Two requirements that can collide (the same
  layout and the same margin; keep a convention and replace a generator) are
  ranked in the brief, or the subagent picks one alone.
- **Number the follow-ups.** A second or third message on the same task is
  labelled v2, v3 and names the last report received from the subagent, so
  messages that crossed are recognised as such.
- **Ask for the property, not a frozen value.** "A digest that exists and
  carries Go 1.x" survives a moved tag; "digest sha256:…" does not.
- **Say what the subagent may run.** Name what it may execute beyond its
  definition (a container, a browser, a CI watch) and whether it has network
  access, so it measures instead of filing the claim under `unverified`.
  What it names runs only when it changes nothing: a brief that needs a
  commit, a push or a pull request goes to an agent that delivers (above).
  A probe that must queue behind a shared runner gets a budget (how long it
  may wait, or a fast path for a light probe): a specialist does not wait on
  work it did not start, it reports it pending.
- **Diagnose before prescribing.** Give the symptom and the evidence; a
  suspected cause or a fix named before the diagnosis gets the wrong cause
  fixed.
- **Local test dependencies.** When a test needs a package the machine may
  lack, say how to get it without installing anything:
  `uv run --no-project --with <package> python3 <test>`.
- **Example paths stay generic.** A path given as an example starts with `~/`,
  never with a real home directory.

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

This mode is on when the brief starts with `Plan review mode`, asks for objections to a plan (nothing built yet), or asks for a read-only review of a plan or code in the caller's own format. One rule decides the format: the caller's format replaces this agent's output format, and no output-format section of this file overrides it. Outside this mode the output format of this file applies unchanged. The validation checklist of this file (its linters, tests and formatters) applies to a code change; a review of a plan, prose or issue drafts runs the caller's checks only.

In this mode:

- Return objections only. Each objection carries six fields: `severity` (`blocking`, `material` or `minor`), `claim`, `evidence` (a `file:line`, or the plan line it contradicts), `remedy`, `consulted` (the sources actually checked for this claim, one entry per source: a documentation URL, a source file read at a named revision or version as `path@rev` such as `origin/main:path` or `$GOROOT/src/...@go1.x`, or a scratch measurement given as its command, the revision or archived tree it ran on, and its result) and `unverified` (what could not be confirmed, with what was tried). If the brief names a different field list, use the brief's.
- A claim about how a technology behaves with an empty `consulted` is a memory claim: put it under `unverified`, never present it as fact.
- A measurement made on data the plan's author produced (extracts such as `.npy` or `.npz` files, caches) is usable, but its `consulted` entry says "author-derived, raw source not re-read", and an `unverified` entry names the raw source whenever it could not be read.
- A GitHub source is read with the GitHub tool when the session has it, else with a read-only `gh` command (`gh issue view`, `gh release view`, a GET `gh api`, in scope in this mode as the inspection rule below says), else with WebFetch: a file on `https://raw.githubusercontent.com/<owner>/<repo>/<tag>/<path>`, cited as `<owner>/<repo>:<path>@<tag>`, an issue or a release on the public REST API (`https://api.github.com/repos/<owner>/<repo>/issues/<n>`, `.../releases/tags/<tag>`); when none of these answers, the exact lookup goes under `unverified` for the caller to run. Never through Claude in Chrome.
- A WebFetch result is a summary of the page, never its text: what it leaves out proves nothing, and what it says is a paraphrase. A documentation page that redirects, cannot be reached, or comes back truncated or as navigation without the claim is replaced by the first-party source read at the pinned version (its file on the project's repository at that tag, by the GitHub rule above), not cited from memory. A quote, or a claim that a page does not say something, rests on raw text (that source file, a context7 excerpt, or a raw fetch this file's Command scope allows); with only the summary, the claim goes under `unverified` as "WebFetch summary only".
- From round 2 on, the brief carries the previous version of the plan and the triage of the earlier objections: first say, objection by objection, whether each fix holds, in the verdict format the brief gives, then attack the new version. Never rebuild the earlier state from conversation history.
- If the plan is sound from this agent's domain, say so and stop. An objection with no concrete failure behind it is noise.
- The brief is read first: a rule of this file that says "before you read anything" means before the reviewed material. A report file the brief asks for by its path under the scratch directory is written in this mode too, by an agent that has `Write`, and the objections still go in the answer unless the brief says otherwise; with `Write` and no `Edit`, each update writes the whole file again and its status is its last `status:` line; with no `Write`, the answer carries everything and says the file was not written. A host rule that asks for a closing section (`## Agent feedback`) adds it after the caller's format, never inside it.
- What the brief says this agent may run, beyond its Command scope, runs when it changes nothing: a wrapper the brief names for every command (a memory-capped runner, a queue) around a command of the scope, a read-only `gh`, a container or a browser the brief provides. A command that would change the reviewed repository, its Git state or a forge (a commit, a push, a pull request) is never run on a brief's word: its claim goes under `unverified` with the exact command, for the caller or an agent that delivers. Never wait on work this agent did not start, nor poll it: a probe held behind another job (a lock, a queue, a CI run) goes under `unverified` as pending, with the command that would settle it, and the answer goes back.
- Stay read-only on the reviewed repository: no file edits, no change to its Git state, manifests or lockfiles, no formatter or fixer that rewrites files, no install or sync. A write is allowed only where this agent's Command scope permits it, and only under the scratch directory the brief names; when the brief names none, write nothing, unless a section of this file gives a fallback for that case. The tree archive below, and the one upstream file saved under the scratch directory, are the only files a shell command may create. Prefer a check or diff mode, and report a missing tool, or an execution, network access or write the host refuses, under `unverified`.
- In Plan review mode only, if this agent has Bash: the read-only inspection commands below are in scope in addition to this file's Command scope; nothing else is added but what the brief lets it run (above). A command in scope may still be refused by the host: report it under `unverified`. They are `git show`, `git log`, `git diff`, `git grep`, `git ls-tree`, `git cat-file` (each also as `git -C <repo> …` on a repository the brief names), `gh issue view`, `gh pr view`, `gh release view` and `gh api`, each under the rules that hold in every mode (below), and one tree archive: `git archive --format=tar -o <scratch>/tree.tar <rev> [-- <paths>]` then `python3 -m tarfile --filter data -e <scratch>/tree.tar <scratch>/tree` (Python 3.12 or later), `<scratch>` being the scratch directory the brief names; with none named, no archive. `git archive` runs every filter driver the tree's attributes assign, git-lfs included: list the drivers with `git config --name-only --get-regexp '^filter\.'` and pass, for each driver name N, `-c filter.N.smudge= -c filter.N.process= -c filter.N.required=false` before `archive`. This archive, and one upstream file read with `gh api --method GET` at a named tag and saved under `<scratch>` for line citations (cited `owner/repo:path@tag`), override any "never create a file through the shell" of this file, and what it yields is cited as "archived tree at <rev>, export-ignore and export-subst applied".

Holds in every mode, if this agent has Bash: git never gets `--output` (save the tree archive above), `--ext-diff`, `--textconv`, `--filters`, `-O`/`--open-files-in-pager`, `--remote` or `--exec`; a git command that prints a diff (`git diff`, `git log -p`, `git show <commit>`) runs as `git --no-pager <command> --no-ext-diff --no-textconv`, so no configured external diff, textconv driver or pager runs; gh never gets `--web`, and `gh api` runs with `--method GET` and no `-f`, `-F`, `--field`, `--raw-field` or `--input`.

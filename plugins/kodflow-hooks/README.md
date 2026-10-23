# kodflow-hooks

The lifecycle machinery the other kodflow plugins assume: a git and forge
guard that reads a Bash line as the shell would and never rewrites it, the
delegation gate (code in a git repository is produced by subagents), session context, a
formatter, a turn-end quality gate, one structured log, and the session task
list.

Two halves. The shell scripts (`hooks/scripts/`) hold every hard guard and run
on any Claude Code. The function hooks (`hooks/mod/`, a mod: TypeScript the
engine loads from `hooks/hooks.json` → `modules`) serve the task tools,
blank the attribution text, double the Bash
guards, compress Bash output and mask secrets in every tool's result; they
need **Claude Code 2.1.293 or later**.

## The mod and what is lost without it

`hooks/mod/register.ts` is wiring only, one `on(...)` per event; the logic
sits in pure modules beside it (`tasks.ts`, `store.ts`, `calls.ts`,
`paths.ts`, `lint.ts`, `shell.ts`, `patterns.ts`, `guards.ts`,
`filter.ts`, `veil.ts`, `pipeline.ts`, `fable.ts`, `cleanup.ts`, and for the three machine
guards `machine-guards.ts` over a port, with `modwall.ts`, `collision.ts`,
`zsh.ts`), which never touch `$`: the engine follows `$` and `on` only inside
register.ts.

| Event | What the mod does |
|-------|-------------------|
| `session.start` | registers `task_create`, `task_update`, `task_epic`, `task_focus`, `task_list`, `task_assign_human` (`isDeferred: false`), listed as `mcp__kodflow-hooks__task_*`, and the `/lint-setup` command |
| `classic.SessionStart` with `source: compact` | adds to the context the tasks still waiting on the user (`task_assign_human`), read fresh from `tasks.json`, so a summary cannot drop a pending "go" |
| `command.run` on `lint-setup` | checks ktn-linter for a Go module (below) |
| `classic.SessionStart`, `prompt.submit`, every `tool.call` | writes the beat, `<config>/kodflow/sessions/<session>/mod-beat` (time in seconds), before the shell hook of the same event runs, once the tools are registered |
| `tool.call` on a task tool | answers it (below); a refusal is `{ deny }` with the text the model reads, an internal failure a text error, never a crash |
| `tool.call` on Bash | one pipeline of ordered policies (`pipeline.ts`), below |
| every `tool.call`, after the tool ran | secrets masked in the result (`veil.ts`), below |
| `prompt.submit` | remembers when the user last pressed Enter (`origin.kind` `composer`, `notePrompt` of machine-guards.ts, read through `lastComposerAt()`): the collision and gated-model questions are put only to someone who typed in the last 10 minutes |
| `attribution.text` | `""` for `commit` and `pr`; `exemption` and `remedy` untouched |
| `plugin.register` | **modwall**: refuses every user-tier hooks module whose provenance is not `*@kodflow` (the list is in `modwall.ts`, nothing the model writes widens it); built-in and managed tiers are not judged. Each decision goes to `$.store` (`modwall`, last 100) and the debug log; a refusal is toasted once the session binds |
| `command.run` · `/kodflow-mods` | the modules judged at this load, and the refusals on record |
| `session.start` | **zsh-safe**: `ZDOTDIR` → `hooks/zsh`, the user's own in `KODFLOW_USER_ZDOTDIR` (`""` when unset); `hooks/zsh/.zshenv` gives ZDOTDIR back, sources the user's `.zshenv`, then `setopt nonomatch noequals`: `echo *.none` prints `*.none` instead of failing |
| `tool.call` on `Edit`, `Write`, `MultiEdit`, `NotebookEdit` | **collision-guard**: when another session of this machine, beating within 30 min, wrote the same file within 30 min (its `edits.tsv`), asks Continue / Move to a worktree (the model is told to call `EnterWorktree`) / Cancel, but only when the user typed a prompt at the terminal (`origin.kind` `composer`, noted by `prompt.submit`) in the last 10 minutes (the presence rule): otherwise it journals the collision to the debug log and lets the edit through, so a night run never waits on a question; once written, notes `<seconds>\t<path>` in `<config>/kodflow/sessions/<session>/edits.tsv` (no prompt, no content); `<config>/projects` is never checked |
| `session.end` | empties this session's `edits.tsv` |
| `agent.spawn` | **gated models**: passes or refuses a spawn on the model it would run on, never writes one (below) |
| `tool.call` on `Skill` | **gated models**: a skill whose frontmatter names one passes only with the session's grant, asked once like a spawn |
| `classic.PreModelSwitch` | a `/model` the user typed or picked grants the session a gated model; a switch from the SDK asks, and is refused with nobody at the prompt |
| `tool.call` on `Bash`, `Edit`, `Write`, `MultiEdit`, `NotebookEdit` from a subagent | **cleanup on close**: notes the absolute `.worktrees/<name>` roots its arguments name (`~` and `$HOME` expanded) under its id in `<config>/kodflow/sessions/<session>/worktrees.json`, once per path, without waiting |
| `tool.call` on `task_update` completing a main-agent task | **cleanup on close**: once the answer is settled, starts `hooks/scripts/cleanup.sh` on the worktrees of the task's worker, and when the completion closes the epic, of every worker of the epic and every subagent started on it; never awaited (below) |
| `prompt.submit` from the composer | writes `<config>/kodflow/sessions/<session>/composer-at` (seconds), the presence `on-stop.sh` reads before proposing agent feedback |

### The Bash pipeline

One `on("tool.call", { tool: "Bash" })`, its policies in a fixed order, each
with its own failure rule. No policy ever answers `allow`, and none answers
`{ result }` but the filter (and the veil, on every tool).

| # | Policy | What it does | A failure |
|---|--------|--------------|-----------|
| 1 | guards (`guards.ts`) | the shell's Bash guards doubled, refusal only: same reader (`shell.ts`, a port of on-tool.sh's), same order of blocks, same motifs; the bash-guard corpus is replayed against both. The staged-secret scan stays the shell's alone; the mcp.json refusal is doubled (the index read by name only), and the generic `tool.call` hook holds the forge tools to it | is logged, the call goes on |
| 2 | the call | the shell's `PreToolUse` runs beneath, as ever | — |
| 3 | output filter (`filter.ts`, L3) | a line that is exactly one `git status`, `git log`, `git diff`, `ls -l`, `find` or `grep -rn` gets its stdout shortened (hints, index lines, columns, repeated prefixes); never a read whose bytes count (`cat`, `head`, `tail`, `sed`, `diff`, `git show`, `git cat-file`, …), never a failed, interrupted, persisted, image, background or structured result, only when `stdout` is a string and the engine version is inside `FILTER_VERSIONS` (CI checks the pinned one is). Every other key of the result is kept | returns the result untouched |

Each decision and failure is one `ModPolicy` line in the session log.

A merge asks nothing and waits on no one: from the main thread it is
journaled (`root_guard: merge`), from a subagent it is refused. No command is
put to the user for being irreversible (`rm -rf` included); the guards above
still refuse what they refuse (a forced push, the delegation gate's writes).

### The secret veil

After every tool ran, never on its input: the value of a known credential
variable of the session (`SECRET_VARS`), a credential by its shape (provider
prefixes, `Bearer`, private key blocks, `user:password@`, `password=…`), and a
token of 20 characters or more, letters and digits mixed, above 4.3 bits per
character, unless it is a hash, a UUID, a path, an integrity digest or base64
of plain text. A masked value is gone, nothing keeps it. An errored result
with a secret is withheld with the masked text. Past 2 000 000 characters or
1.5 s, the result comes back as it was (fail open).

Every hook fails open. `KODFLOW_MOD=off` (environment or the `env` block of
the settings) makes the module pass-through: no tool, no beat, no marker.
A modwall judge that throws lets the module load; with no one to answer
(`-p`) or the dialog dismissed, collision-guard lets the edit through.

modwall judges only the modules that register after kodflow-hooks: one
loaded before it (load order is the engine's) is admitted by core alone, and
`/kodflow-mods` says so. This limit is accepted: closing it would take
kodflow-hooks into the managed `prepend` tier, which managed settings alone
can do, and they are not used. `on-session.sh` stays the net: it warns about
any plugin outside the kodflow marketplace that declares `modules`.

The shell reads the beat (`lib/beat.sh`): younger than 5 s, the task tools
answer; older, the mod was loaded and is gone; absent, it never loaded.

| Without the mod (Claude Code < 2.1.293, `KODFLOW_MOD=off`, a failed reload) | |
|---|---|
| task tools | absent: tasks are not tracked, the status line shows no epic |
| triage gate, triage directive, epic state in the prompt, session-start review | off: nothing could lift a gate the tools cannot answer |
| built-in `TaskCreate`/`TodoWrite` | allowed again: they are the only list left |
| attribution text | Claude Code's own (the shell guard still refuses AI attribution in a commit) |
| what the user is told | once per session that the task tools did not load (not with `KODFLOW_MOD=off`); after an unload, `/reload-plugins` |

| output filter, secret veil, doubled guards | absent |

Every hard guard (git, delegation, protected paths, secrets) is shell and
does not depend on the mod.

## One script per event

Hooks registered on the same event run **in parallel** — the Claude Code hooks
reference says so in one line, and it decides the design. A chain of small
scripts on `PreToolUse` has no order: the guard may inspect a command the
rewriter has already changed. The only way to get a sequence is to have one
script per event and put the sequence inside it.

Every script runs the same four stages, in this order, and leaves at the first
stage that has nothing more to do:

| Stage | Meaning | Exit |
|-------|---------|------|
| **1 · gate** | the cheapest test that lets most calls leave at once | `0` |
| **2 · block** | what must stop the call | `2`, reason on stderr |
| **3 · transform** | what Claude reads (context, the task identity of a `task_*` call), emitted as **one** JSON document; a Bash command is never rewritten | `0` |
| **4 · observe** | logging and advice, off the critical path | `0` |

Every path that is not a deliberate block exits `0`. A `PreToolUse` hook that
fails by accident blocks every shell call of the session.

## Events → scripts

| Event | Script | Gate | Block | Transform | Observe |
|-------|--------|------|-------|-----------|---------|
| `PreToolUse` · Bash | `on-tool.sh` | no `git`/`gh`/`glab`/`curl`/`wget`/`http` on the line once unquoted (and no `$'…'`) | read by the shell reader below: the main thread producing into a repository (delegation gate) · `--no-verify`, `-n` on a commit, `-c core.hooksPath` · AI attribution or workflow leak in a commit message, AI attribution in a PR/MR title or body · credential shapes in the staged blobs · a forced push (`--force`, `-f`, `+refspec`), with the command to run instead · from a subagent: any merge, any push to the default branch | none: the input is never rewritten | log; a main-thread merge is tagged `root_guard: merge` |
| `PreToolUse` · task tools | `on-tool.sh` | the mod's task tools never reach it (a call a function hook answers fires no `PreToolUse`); the old MCP names are logged and passed | built-in `TaskCreate`/`TodoWrite` while the mod beats: their chat panel duplicates the status line, the refusal points at the kodflow task tools | — | log |
| `PreToolUse` · Write/Edit | `on-tool.sh` | main thread writing inside a git work tree (memory and Claude configuration excepted) · no file path | the main thread producing into a repository (delegation gate) · protected path (defaults or `.claude/protected-paths`) | — | log (no linter call: ktn-linter reports through its own command hooks) |
| `PreToolUse` · forge MCP (`mcp__github__*`, `mcp__gitlab__*`, `mcp__GitKraken__*`) | `on-tool.sh` | no message, title, body, description, branch or merge field, and a subagent or a read/merge/review/issue tool (decided without jq) | a forge write from the main thread (files, branches, pull requests) · AI attribution or workflow leak in a commit field (`message`, `commit_message`, `commit_title`, `squash_commit_message`, `merge_commit_message`) · AI attribution in the title, body or description of a PR/MR tool · from a subagent: a merge (`merge_pull_request`, `merge_merge_request`, `merge_when_pipeline_succeeds`, `auto_merge`), a file write to `main`/`master` | — | log; a main-thread merge is tagged `root_guard: merge` |
| `PostToolUse` · Write/Edit | `on-tool.sh` | file absent; then markdown, `.claude/` | — | `docs.json` rebuilt after a write under `docs/` (markdown included), at most every 30 s otherwise · `document concerné` for each document the file concerns, once per session (below) · format (Makefile `fmt`/`format` first, then the formatter for the extension) and say so when the bytes changed · then, for a Go file (Write/Edit/MultiEdit), the ktn-linter findings of that file with the instruction to fix them now, unless ktn-linter's own PostToolUse hook is installed or `KODFLOW_LINT=off` (below) | edited-file tracker · risky construct warning once per session · log |
| `PreToolUse` · Agent/Task | `on-tool.sh` | gated-model fallback first, every caller, no jq; then the main thread only | a gated model when the mod does not beat · from the main thread, a `general-purpose` dispatch whose description names an installed specialist's technology (routing gate, below) · from the main thread, `isolation: "worktree"` on work in another repository (isolation gate, below) | — | log, `root_guard: route-deny`, `route-override`, `route-noindex`, `isolation-deny` or `isolation-override` |
| `PreToolUse` · Skill | `on-tool.sh` | the mod does not beat | a skill whose frontmatter names a gated model | — | — |
| `PostToolUse` · Task/Agent | `on-tool.sh` | — | — | — | `agent-models.tsv` (agent id, resolved model, per-call effort) · log tagged `root_guard: dispatch` |
| `PostToolUse` · SubagentHandback | `on-tool.sh` | — | — | — | the report's agent feedback, as at `SubagentStop` |
| `PostToolUse` · Read | `on-tool.sh` | — | — | `docs.json` at most every 30 s · `document concerné` for each document the file concerns, once per session | log |
| `PostToolUse` · Bash | `on-tool.sh` | — | — | `docs.json` at most every 30 s | log |
| `PostToolUse` · other | `on-tool.sh` | — | — | — | log |
| `PostToolUseFailure` | `on-tool.sh` | — | — | — | remediation hint · a failure carrying auto mode's refusal text goes to `blocks.jsonl` · log (error redacted) |
| `PermissionDenied` | `on-tool.sh` | — | — | — | auto mode's refusal in `blocks.jsonl` (kind `classifier`, the verdict, the rule that would allow the call) · log |
| `SessionStart` | `on-session.sh` | — | — | `docs.json` and the index of the project's documents (below) · `routing-installed.tsv` for the routing gate · a notice when the session starts on a gated model · the open tasks to reconcile, while the mod beats · post-compaction rules on `compact` · a warning when rtk is absent · a warning to the user (`systemMessage`) and to Claude when `disableAllHooks` is set, when `CLAUDE_CODE_PLUGIN_DIRS` is set, or when an enabled plugin, a skills directory or a plugin dir outside the kodflow marketplace declares `modules` · the same warning when an installed guard (`on-tool.sh`, `scripts/lib/agents.sh`, `scripts/lib/identity.sh`, `gated-models.txt`, `hooks/patterns/*.txt`) differs from `hooks/fingerprints.sha256`, when that file is missing, or when it differs from the marketplace clone's (D8: nothing is blocked; the file is generated by `scripts/hooks-fingerprints.sh` and checked by CI) | log |
| `SessionEnd` | `on-session.sh` | — | — | — | one log line with the session's event count (1.5 s budget) |
| `PreCompact` | `on-session.sh` | — | — | — | log |
| `ConfigChange` | `on-session.sh` | — | — | — | log · `bypassPermissions` flagged in `security-events.jsonl` |
| `UserPromptSubmit` | `on-user.sh` | — | — | branch, latest plan, latest goal · the cleanup notices (`cleanup-notices`, consumed) · while the mod beats: the main agent's epics (active one with its task in progress, other open ones with done/total) when `tasks.json` exists, and the triage directive with the epic mandatory on `task_create` · the delegation line (code in a repository: dispatch or message the epic's subagent) unless `KODFLOW_ROOT=off` · no triage directive on a turn the user did not type · a `systemMessage` when the mod is gone | raise the triage gate (mod beating) and reset the Stop loop counter, except on a turn the user did not type · log |
| `Notification` | `on-user.sh` | — | — | bell (`terminalSequence`) on idle, permission and elicitation prompts | log |
| `SubagentStart` | `on-agent.sh` | — | — | the standing rules, injected into the subagent (own worktree, deliver through a PR, and rule 6: end with `## Agent feedback`) | running-agents registry, with the main agent's active epic at start · log |
| `SubagentStop` | `on-agent.sh` | `stop_hook_active` | — | — | running-agents registry · its agent feedback in `agent-feedback.jsonl` · log |
| `TaskCreated` · `TaskCompleted` · `TeammateIdle` | `on-agent.sh` | — | — | — | log |
| `Stop` | `on-stop.sh` | `stop_hook_active` · 3 feedbacks without a new prompt | — | feedback in one document, one line per cause, each task named once, each cause said once per state (below, « The Stop feedback ») · the CLAUDE.md of each directory changed this session, once per directory · a triage cause left unsettled (`triage-pending`), not on a system turn · the subagents' new agent feedback, once, to a user present in the last 10 minutes, never for an agent with no definition file | bell · log |

## Main thread = reviewer, code is delegated

The user's rule: the main thread triages, manages epics and tasks,
dispatches, reviews, merges, and informs. Code
production in a git repository is delegated: every epic is carried by at
least one subagent working in its own git worktree
beside the repository (`<repo parent>/.worktrees/<repo>-<epic-slug>`; when
that parent is or sits under `~/Documents`, `~/Desktop` or `~/Downloads`, which
macOS TCC protects, `~/Projects/.worktrees/<repo>-<epic-slug>` instead) that
delivers through a PR. The main thread keeps every other permission —
it is also the workstation's sysadmin (sudo, apt, systemctl, nmcli, installs,
files outside repositories, configuration).

The gate is mechanical. A `PreToolUse` payload carries `agent_id` only when the
call comes from inside a subagent (measured on 855 real events: every one
carrying it came from a subagent, no main-thread one did), so a call without
it is the main thread's own hand. Subagents are never gated. The main thread
is refused exactly three things:

| Tool | Refused | Still allowed |
|------|---------|---------------|
| `Write`/`Edit`/`MultiEdit`/`NotebookEdit` | a file inside a git work tree: its directory and parents are walked up looking for `.git` (a directory, or a worktree's gitdir file), no exec, after the path is normalised lexically | everything outside a repository; `<config>/projects/*/memory/*`, `<config>/settings.json`, `settings.local.json`, `<config>/CLAUDE.md` and `~/CLAUDE.md` even inside one |
| `Bash` | `git commit`, `push`, `rebase`, `cherry-pick`, `merge`, `am`, `apply`, `revert`, `reset --hard`, `worktree add`; `gh pr create`, `glab mr create` — wherever the shell reader finds them (below) | everything else: no allow-list, no redirection rule, unknown commands pass; `gh pr merge` and `glab mr merge` pass the delegation gate, and the merge gate then asks for the mod's token (above) |
| forge MCP (`mcp__github__*`, `mcp__gitlab__*`, `mcp__GitKraken__*`) | file, branch, push and pull-request writes, and any tool not classified | reads, merges, reviews, comments, issues (decided in the jq-free fast path) |

## Commit identity

A commit carries a name and an address to wherever its repository is
pushed. Before every `git commit` the shell reader finds, `on-tool.sh`
(BLOCK 2b, `lib/identity.sh`) holds that identity to the one the user's
rules give the forge of `origin`, so an address meant for one host never
lands on another. The rules are the user's and stay out of this repository:
`${CLAUDE_CONFIG_DIR:-~/.claude}/kodflow/commit-identity.conf`
(`commit-identity.example.conf` beside this README shows the format with
example values).

- **The forge** is `origin` as `git remote get-url` gives it (insteadOf
  applied): https, `ssh://user@host:port/…`, `git@host:path`, CodeCommit
  with a key id and `codecommit::<region>://`. No `origin`, a local path,
  or a host no rule names: refused.
- **The identity** is the one git will write, author and committer, name and
  address: `git var GIT_AUTHOR_IDENT` and `GIT_COMMITTER_IDENT` run in the
  commit's directory (`-C`, `cd … &&`), with the line's `-c`,
  `--config-env`, `--git-dir`, and the `GIT_*`, `EMAIL`, `HOME` it sets
  (`X=v git`, `env [-i] [-u X] X=v git`, `export X=v; …`), so local, global
  and `includeIf` configuration all count; then `--author`, or the reused
  commit's author for `--amend`, `-C`, `-c` unless `--reset-author`. The
  address is compared without case, the name exactly.
- **An empty address** (`<>` in a rule) is what git writes for
  `user.email=""`, with or without `user.useConfigOnly`
  (`tests/test_identity.sh` asks git each run). A rule with an address
  refuses an empty one, and a rule without refuses any.
- **A refusal** (`[motif:commit-identity]`) names the rule, the expected
  identity, the author and committer found, and the two `git -C <dir> config`
  commands to run. The hook never changes a configuration.
- **Fail open**: no rules file, the check is off and says so once a session
  (`systemMessage`); a malformed or unreadable one voids the whole file the
  same way rather than enforce half a policy; git missing, not a repository,
  or a value the reader cannot know (a `$` or a backtick in it) leaves the
  commit alone. `KODFLOW_COMMIT_IDENTITY=off` turns it off.
- **Not covered**: a commit made by `merge`, `rebase`, `cherry-pick`,
  `revert`, `am` or `pull` (their committer), a commit through a forge MCP
  tool, `nohup env X=v git …` and other wrappers before `env`, a variable
  set without `export` and not exported already, and the gaps of the shell
  reader itself (an alias, `$c commit`). The mod does not double this
  check, like the staged-secret scan: it needs git.

## The shell reader

A regex over the raw line cannot tell `git "commit"`, `\git commit` or
`=git commit` from a commit, and it reads a heredoc that merely quotes a
commit as one. `on-tool.sh` does the shell's first pass instead: it cuts the
line into simple commands on `;` `&&` `||` `|` `&` and newlines, removes
quotes and backslashes, decodes `$'…'`, joins `\`+newline, sets heredoc and
here-string bodies aside as the command's stdin, walks past `VAR=value`,
reserved words and wrappers (`env`, `command`, `exec`, `sudo`, `doas`,
`nohup`, `nice`, `timeout`, `xargs`, `rtk`, `rtk proxy`…), and queues for
another pass every text the shell would itself run: `$( )`, backticks,
`<( )`, `bash -c`/`sh -c`/`zsh -c`, `eval`, `su -c`/`sg -c`, a heredoc or a
here-string fed to a shell, and `echo …`/`cat <<EOF` piped into one. A
heredoc fed to anything else is data: `cat > notes.md <<EOF` quoting a commit
and a `.claude/` path passes.

It never expands a variable or an alias. Those, and an interpreter other than
a shell (`python -c "os.system(…)"`), `find -exec` and a git alias defined on
the line, are the known gaps; each has a `known_gap` case in the corpus.

The attribution guard reads its rules from kodflow/post-commit, the gate
every repository runs on GitHub: `scripts/patterns.txt` and
`scripts/patterns-strict.txt`, vendored byte for byte in `hooks/patterns/`
at the commit `hooks/patterns/SOURCE` pins. An installed plugin reads that
copy and never the network. `on-tool.sh` (builtins only, once per call,
bash 3.2) and the mod (`patterns.ts`, translating each POSIX ERE to the same
line-by-line match) read the same files with the same format: one ERE a
line, `#` and blank lines skipped, `# @scope: <list>` for what follows.

A commit message meets every pattern, the strict file included (vendor
keywords such as `\bclaude\b`, `.claude/` paths). The keywords aim at a
mention of the assistant, not at a technical name: the word glued to an
alphanumeric by `-`, `_`, `.` or `/` (`super-claude`, `claude-code.d.ts`,
`CLAUDE.md`, `@anthropic-ai/sdk`) or inside backticks is set aside before
the keyword pass, which is the only pass that reads that text; attribution
trailers and `.claude/` leaks see the message as written. A pull or merge request
title or body meets the `commit,pr` scope only (AI trailers, AI noreply
addresses, "Generated with/by", the robot emoji, "AI-assisted"): a PR may
well be about the tooling, so naming Claude Code or a `.claude/` path, or a
`Plan:` line, passes there. Each hit carries a motif: `leak` for a
commit-only pattern naming a workflow artefact (a `.claude` path, the
`Plan:` footer), tried before the keywords, `attribution` for the rest. A
copy without both files, or with a scope it does not know, refuses every
commit message and PR text instead of reading it as clean.

Moving the pin is a reviewed change:

```bash
bash scripts/sync-post-commit-patterns.sh <40-hex commit of kodflow/post-commit>
bash scripts/tests/test_hooks.sh && bash plugins/kodflow-hooks/tests/run-tests.sh
```

The script copies both files at that commit, rewrites `SOURCE` and
regenerates `hooks/fingerprints.sha256` (the pattern files are guards too).
CI runs `--check`, which fetches the files at `SOURCE`'s commit and fails on
any difference with the copy.

Plugin machinery stays in marketplaces (L0.6). For every caller, Edit and
Write, and a shell redirection, are refused when they write a
`.claude-plugin/` or a `hooks/hooks.json` under a skills directory
(`~/.claude/skills/**`, `<config>/skills/**`, `**/.claude/skills/**`), and
`claude plugin install|i` or `claude plugin marketplace add` are refused
unless the plugin is `name@kodflow` or the marketplace is
`kodflow/claude-marketplace`. `cp`, `tee`, `sed -i` and `git clone` into a
skills directory are not read (known gaps).

No file named `mcp.json` or `.mcp.json` (any case, at any path) is ever
committed: such a file may carry tokens, and a GitHub token once lived in
clear in the user's global `mcp.json`. For every caller, subagents
included, the shell refuses `git add` or `git stage` naming one (`-f` or
not) or whose pathspecs would take one in (`.`, a directory, a glob, `-A`,
`--pathspec-from-file`, ignored files under `-f`: `git status` resolves
them), a `git commit` whose pathspecs name or take in one, a `git commit`
whose index adds or changes one (`git diff --cached --name-status`, the
read the secret scan already makes, in the repository the commit runs in,
`git -C` joined onto a preceding `cd`), and a `git commit -a` when a
tracked one is modified in the working tree. A file the same line creates
before adding it is not there yet when the hook runs (a `known_gap` row);
the commit that follows a separate add is refused. The forge write tools
are held to the same rule: a path that `push_files`,
`create_or_update_file`, a GitLab commit action or GitKraken's
`git_add`/`git_commit` names, and, for GitKraken naming no file, what the
repository would take in. Reading one on the forge passes. A deletion stays allowed, so a repository that
still tracks one can be cleaned: `git rm --cached <path>`, then commit, or
the forge's `delete_file`. Names that merely contain it (`mymcp.json`,
`mcp.json.tmpl`) pass. The mod doubles the refusal, refusal only and
failing open. A plugin that needs an MCP server declares it in the
`mcpServers` field of its `plugin.json`, never in a `.mcp.json`; no plugin
of this marketplace tracks one today.

Every refusal ends with a `[motif:<id>]` line (`root`, `no-verify`,
`attribution`, `leak`, `mcp-json`, `secrets`, `force`, `merge`,
`push-default`, `mod-write`, `plugin-source`): tests
compare it, never the wording. The corpus is
`tests/fixtures/bash-guard.jsonl`, one case per line (`cmd` or `tool` and
`input`, `rc`, `motif`, `agent`, `root`, `known_gap`), played by
`scripts/tests/test_hooks.sh` (`HOOK_SHELL=/bin/bash` plays it under macOS's
bash 3.2). Its attribution shapes are written with `\u` escapes so the file
does not carry them in clear.

The denial is short: it is code production in a repository, so dispatch the
epic's subagent (focus the epic first, so the subagent is attributed to it)
or `SendMessage` it if it is running; `ROOT_OK=1` for a genuine exception.

The Stop rule closes the other side: a main-agent task `in_progress` on an
epic with no running subagent attributed to it (`agents.json` `epic`, not
stopped, started less than 12 h ago) means the main thread is doing the
epic's work itself, or work that is no code in a repository; it is flagged
once per state (the `unattended` cause of « The Stop feedback ») — dispatch
a subagent for the epic, carry on when the work is not code in a
repository, or set the task back to `pending`/`waiting`. A task tied to a
subagent that stopped is the `stopped` cause instead, never both.

Ways out: `ROOT_OK=1` leading a Bash line, `KODFLOW_ROOT=off` in the
environment for the session (gate, Stop rule and prompt line all off), and
plan mode, where the gate never fires. Every anomaly — no jq, a malformed
payload, an empty command or path — fails open. Each denial is logged with
`root_guard: deny` and each dispatch with `root_guard: dispatch`:

```bash
L=.claude/logs/$(git branch --show-current | tr / _)/session.jsonl
grep -c '"root_guard":"deny"' "$L"; grep -c '"root_guard":"dispatch"' "$L"
```

`lib/format.sh` is the formatter table (sourced lazily, never registered) and
`lib/event.jq` is the one sanitization policy behind every log line.
`lib/epics.jq` is the hooks' read side of `tasks.json` (v1 or v2, malformed
read as empty), shared by `on-user.sh`, `on-agent.sh` and `on-stop.sh`.

## Dispatches: specialists, gated models, agent feedback

Three behaviours around every subagent dispatch, each with its own kill
switch. They are wired on the payloads the CLI actually sends, recorded once
with a throwaway recorder plugin (command hooks on every agent event, a mod on
`agent.spawn`, `classic.PreModelSwitch`, `prompt.submit` and `tool.call`) and
committed as `tests/fixtures/agent-hooks.jsonl`, `agent-spawn.jsonl` and
`agent-mod-events.jsonl` (CLI 2.1.300, headless, default and auto permission
modes, paths rewritten).

### The routing gate (`KODFLOW_ROUTE=off`)

A main-thread Agent call that leaves `subagent_type` out or names
`general-purpose`, and whose `description` names the technology of an
installed specialist, is refused with the `subagent_type` to use instead
(`[motif:route]`): `general-purpose` would run it without that agent's pinned
model, effort and checks. The match is on the description alone — whole
lower-case words of three letters or more, and file extensions at the end of
a word — against `<config>/kodflow/sessions/<session>/routing-installed.tsv`.
That file is `hooks/routing-index.tsv` filtered to the plugins
`installed_plugins.json` lists, written at `SessionStart` and rebuilt at the
first dispatch when it is missing or older than the shipped index; with no
index at all the call passes (`route-noindex`). `hooks/routing-index.tsv` is
generated from the Keywords column of `skills/_shared/specialists.md` by
`scripts/build-routing-index.py`, and CI fails when the two disagree.

`[general-purpose-ok]` in the description or the prompt is the deliberate
exception, written by every skill that means a general-purpose dispatch (the
`/challenge` lenses, `/debug`, `/search`, `/plan`'s explorers, `/refine`'s and
`route-agent.sh`'s fallback, `/review`, `/infra`, `/ktn`). **The model writes
that marker too: the gate steers, it does not enforce.** Subagents are not
gated.

### The isolation gate (`KODFLOW_ISOLATION=off`)

`isolation: "worktree"` is Claude Code's: it puts the subagent in a fresh
worktree of the session's repository (`<project>/.claude/worktrees/agent-…`)
and then refuses every shell command it cannot prove keeps git inside that
worktree (an interpreter fed a heredoc, a variable where a command or an
option stands, `screen`). That guard is in the CLI and no hook lifts it, so a
subagent sent that way to work in another repository fails on its first
non-trivial command. A main-thread Agent call with `isolation: "worktree"`
whose description or prompt names an absolute path (or `~/…`) inside a git
repository other than the session's is refused before it starts
(`[motif:isolation]`, `root_guard: isolation-deny`), naming that repository:
dispatched without isolation, the subagent makes its own worktree beside it
and delivers through a PR (start-up rule 5). Paths in the session's own
repository, worktrees of it included, and paths in no repository pass.
`[isolation-ok]` in the description or the prompt is the exception for a path
only quoted for reading (`isolation-override`). Subagents are not gated.

### Gated models (`KODFLOW_FABLE=allow|off`)

`hooks/gated-models.txt` (one token a line, a substring of the lower-cased
model id; CI holds it byte-identical to `skills/_shared/gated-models.txt`)
lists the models no dispatch reaches without the user's yes, once per
session — Fable today (model-policy §6).

- **The mod** judges every `agent.spawn` on the model it would run on: the
  call's `model`, else the definition's frontmatter (`plugin:name` in that
  plugin's installed copy, as `installed_plugins.json` names it; a bare name
  in the project, the user's agents, then any installed plugin; `inherit`
  meaning `parentModel`), else `CLAUDE_CODE_SUBAGENT_MODEL`, else
  `parentModel` — and `CLAUDE_CODE_SUBAGENT_MODEL` before all of them when
  `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` is set. One spawn is judged at a time,
  so parallel dispatches put one question. A built-in with no file
  (`Explore`, a workflow's agents) is judged on the last two. It passes or
  refuses, and never writes `model`. A gated one passes with the session's
  grant (`$.store` `fable:<session>`, never a file: whatever runs a tool could
  write one); else, to a user who typed in the last 10 minutes,
  `$.ui.ask` once, a yes granting the session; nobody there, a refusal with
  the reason (`[motif:fable]`). A throw refuses only when a raw input names a
  gated model; otherwise the spawn goes on, with a toast and a log line.
- **A `/model` the user types** (recorded: `source: command`), or picks, is
  the consent: `classic.PreModelSwitch` grants the session. From the SDK it
  asks like a spawn.
- **A skill** whose frontmatter names a gated model would switch the main
  conversation to it (no switch event was recorded for that): the mod judges
  the `Skill` call on its `SKILL.md` the same way (`tool.call`).
- **The shell**, while the mod does not beat, refuses any Agent call whose
  per-call `model` or definition frontmatter names a gated model, and any
  `Skill` whose frontmatter does, from every caller, without jq (bash
  regexes, a bounded awk read of the frontmatter, quote- and CRLF-safe). It
  trusts no grant: without the mod, only `KODFLOW_FABLE=allow` lets one through.
  With jq the fields are decoded from the JSON, whatever its layout; without
  jq they are read by regexes tolerant of any whitespace around the colon, so
  a value holding an escaped quote or a `\u` escape is read only up to it.
- `SessionStart` says once, to the user and to Claude, when the session itself
  starts on a gated model (the payload's `model`, absent in a headless run,
  else the settings', else `ANTHROPIC_MODEL`).

### Agent feedback (`KODFLOW_FEEDBACK=off`)

`SubagentStart` adds rule 6: end the answer with `## Agent feedback` (an
`agent_feedback` key in JSON) naming what in the agent's own instructions was
wrong, missing or ambiguous, or nothing. `SubagentStop` (`last_assistant_message`)
and `PostToolUse` `SubagentHandback` (`tool_input.message`, auto mode) both
carry the report; its feedback is kept once per agent and text as one line of
`<session>/agent-feedback.jsonl` (`lib/feedback.jq`): time, session, agent
type and id, model, effort, `source` and the feedback, redacted with the log's
rules, under 1 KB, written under `kf_lock`. The model is the one the parent's
`PostToolUse Agent` recorded for that agent id (`agent-models.tsv`, `source:
tool_result`), else the definition's frontmatter (`source: frontmatter`); the
effort is the payload's own, which is the subagent's effective level. At
`Stop`, a new set of entries is proposed once, to a user present in the last
10 minutes (`composer-at`): show the diff to each agent's definition, and ask
before opening any issue on kodflow/claude-marketplace. An entry whose agent
has no definition file (a built-in, an agent defined in the session) is kept
but never proposed: there is no definition to show a diff of.

### Holes — what was not observed, and is not claimed

| Case | What happens |
|------|--------------|
| A session launched on a gated model (`--model`, the settings' `model`, `ANTHROPIC_MODEL`) | no switch event: the `SessionStart` notice only. Its subagents that inherit it are asked by the mod; without the mod the shell cannot see the parent's model and lets them through |
| `inherit` under an unknown main model, in the shell fallback | passes: a `PreToolUse` payload carries no parent model |
| Automatic model switches made by the engine (fallback on overload or a limit) | not recorded; if they raise `PreModelSwitch` with `source: sdk` they ask or are refused like one |
| The model picker, and `set_model` from the SDK | not recorded (only `/model`, `source: command`); handled by the type's documented values |
| A fork (`subagent_type: fork`) | not recorded: the recorded build had no fork type. Judged on `parentModel`, which the types say a fork always inherits |
| The resume of an agent granted earlier | not recorded; judged as a spawn, so a resume in another session asks again |
| `turn.step` or another plugin rewriting a spawn's model after this mod | not judged; modwall refuses user-tier modules from outside kodflow, a managed one is not judged |
| A `Skill` called from inside a subagent | not recorded; judged as from the main thread |
| `[general-purpose-ok]` | written by the model as easily as by a skill: the routing gate steers |
| The isolation gate | reads paths written out in the prompt only: a repository named by a relative path, a variable or a remote URL is not seen; `[isolation-ok]` is written by the model as easily |
| The shell fallback without jq | a `model` or `skill` value written with an escaped quote or a `\u` escape is not decoded; with jq it is |
| A foreground subagent's model in its feedback | its `PostToolUse Agent` comes after its `SubagentStop` (recorded): the frontmatter's model is named instead |

## The task list (mod)

Six tools the mod registers and answers itself (`hooks/mod/tasks.ts`):
`task_create`, `task_update`, `task_epic`, `task_focus`, `task_list`,
`task_assign_human`, named
`mcp__kodflow-hooks__task_*`. They keep the session task list in
`<config>/kodflow/sessions/<session>/tasks.json`, `<config>` being
`CLAUDE_CONFIG_DIR` or `~/.claude` (always an absolute path). They replace the
built-in task tools, whose panel in the chat duplicates the status line. The
file format (version 2) is a contract shared with the status line, which draws
one pill per open epic of the main agent. They were an MCP server in Python
(`mcp/tasks.py`, gone): the port gives the same answers and leaves the same
files, proven by a corpus recorded from it (Tests, below).

- **One list per agent.** The mod reads the caller from the call itself
  (`agentId`, absent on the main loop, kept path-safe) and the session from
  `$.session.id()` on every call, so a `/clear` or a `/resume` lands in the
  right file. The status line and the Stop rules read the main agent's
  entries only.
- **Writes.** The file is read fresh on every call and replaced whole: a
  temporary file in the session directory, then `mv` (exit code checked), so
  a reader never sees half a list. Calls are queued one at a time inside the
  process (the main loop and every subagent share one copy of the mod), and a
  `mkdir` lock (`.lock.d`, the protocol of `lib/lock.sh`: stale after 10 s,
  broken by a rename, written through after 2 s) keeps two processes apart.
  `task_list` writes nothing. Timestamps are in seconds, lengths in code
  points. Each call is logged through `on-mod.sh` and `lib/event.jq`.
- **Tasks only the user can do.** `task_assign_human(subject, epic,
  description)` files a "go", a Touch ID, a gesture on a NAS as a task with
  `assignee: "human"` and the status `waiting`, in the epic it unblocks
  (required, never 0). Main agent only (a subagent says what it needs in its
  answer), at most 5 open. `task_update` closes it with `completed` once the
  user has answered, or `deleted`; it never goes `in_progress` or `pending`.
  `task_list` marks it "(assigned to the user)", the prompt's epic state lists
  the open ones ("waiting on the user: …"), and after a compaction the mod
  puts them back in the context. The field is optional: the status line,
  `lib/epics.jq` and the Stop rules read such a task as any `waiting` one.
  Nothing is submitted on the user's behalf (no `$.prompt.submit`).
- **Statuses:** `pending`, `in_progress`, `waiting` (blocked on the user: a
  decision, an approval, an answer), `completed`, `deleted`. The list must say
  what is true now; the Stop hook flags an active epic with tasks to do and
  none in progress or waiting, on every turn until it does.
- **Epics, several open at once.** An epic is one subject with its own tasks
  and its own pill. `task_epic(title)` opens one and makes it **active**; the
  others stay open. `task_focus(epic)` (id or exact title) switches the active
  epic back to an open one. `task_create` **requires** `epic`: the id of one
  of the caller's epics, or `0` for a task outside any epic. There is no
  default — a task that silently followed the active epic is how work got
  filed under the wrong subject — so a call without it is refused with the
  caller's open epics (the active one marked) and the syntax; an unknown id,
  or another agent's epic, is refused the same way. An epic is
  open while a task of it is not completed, or while it is active and still
  empty; completed epics cannot be focused, and `task_epic` with the title of
  an open epic focuses it instead of duplicating it. `task_list` shows the
  active epic's tasks, one `#id title done/total` line per other open epic,
  then the tasks with no epic. Each create, update and focus stamps the
  epic's `touched`, which orders the pills.
- **Triage.** One task per user message, a question included, closed as
  soon as it is answered or done. `UserPromptSubmit` injects the epic state
  and a directive to sort every message before acting, every `task_create`
  naming its epic: new work for an open epic (create it there, focus when
  starting), context on the task in progress (`task_update(id,
  description)`), a change to a completed task (`Rework #N: …` in its epic),
  a new subject (`task_epic`), or a question (`task_create(epic=0)`,
  completed once answered). At Stop, the main agent's pending tasks with no
  epic are said whatever epic is active (the `loose` cause).
- **One task in progress per worker.** The main agent may have one task
  `in_progress` plus one per subagent that is `running`, `waiting` or `idle`
  in `$.agent.list()` (`agents.json` when the list cannot be read); a
  subagent has one. `task_update` refuses an extra start, and the Stop hook flags more
  tasks in progress than workers, across every epic, once per state.
- **A task tied to its worker.** `task_update(status=in_progress,
  worker=<type, name or agent id>)` hands a task to a subagent as
  `$.agent.list()` names it (its id, its `SendMessage` name or its type). The
  start is refused if that subagent is stopped, unknown, or already holds
  another task in progress; otherwise it is accepted
  whatever the headcount, so tasks left `in_progress` by finished subagents
  no longer block a live one. `worker` and `worker_id` are stored on the task
  and dropped when it leaves `in_progress`; without `worker`, the headcount
  above applies as before. Every refusal lists the running subagents (type,
  id, for how long) and, for each task in progress, its worker and whether it
  runs, or "no worker linked", then says how to unblock (how long each has
  run comes from `agents.json`, when `on-agent.sh` recorded it). At Stop, a task
  whose worker has stopped is named once per set of such tasks; the
  headcount rule counts only untied tasks, against the main thread plus the
  running subagents that hold no tied task; and a task tied to a running
  subagent never trips the delegation rule.
- **Session start review.** On `startup`, `resume`, `clear` and `compact`,
  `SessionStart` lists the main agent's open tasks of every epic
  (`lib/review.jq`) and asks to reconcile them first — an `in_progress` left
  by the previous run is not work in progress — and raises the triage gate,
  so nothing is done before the list is true again. Only while the mod beats.
- **Turns the user did not type.** `UserPromptSubmit` also fires for a
  background task finishing and for a message relayed from another agent (a
  subagent's hand-back arrives inside that wrapper, never on its own). Their
  `prompt` starts with `<task-notification>` or `<agent-message …>`;
  `<teammate-message …>` and `[SYSTEM NOTIFICATION - NOT USER INPUT]` are
  matched too, as shapes seen reaching a session but not yet in a hook
  payload. Matched anchored, so quoting one is still a user message. Those
  raise no gate, get no triage directive and leave the Stop loop counter
  alone — a notification is not the user taking back control. The branch,
  plan, goal and epic state are still injected: a finishing task is exactly
  when where-things-stand is wanted. A `Stop hook feedback:` turn is *not*
  in that list: it quotes the user's own pending message, so it keeps the gate.
- **Triage gate.** `<config>/kodflow/sessions/<session>/triage-pending`
  holds one cause per line, raised while the mod beats: one `prompt <id>`
  line per user message (`on-user.sh`), so two messages sent before the
  first is filed need two gestures, and `resume` for a session start with
  open tasks (`on-session.sh`); an empty file is read as one message. The
  shell appends and the mod drops lines under the same lock
  (`.triage.lock.d`, `lib/lock.sh`), the mod replacing the file through a
  temporary file and `mv`. Until each cause is settled, `PreToolUse` refuses the main agent every tool but the task tools,
  Read, Glob, Grep, LS, ToolSearch and AskUserQuestion, and names the gesture
  of each cause left, with the number of messages still to file. Only the
  mod settles a cause, one line per call, on a main-agent task call that
  succeeded (`liftsTriage`, `settleCauses`, `calls.ts`): a `prompt` by `task_create`,
  `task_assign_human` or `task_update(id, description)`, `resume` by
  `task_update(id, status)`. `task_list`, `task_epic` and `task_focus` settle
  nothing; a refused call leaves the gate; a store that fails lifts it (fail
  open). A turn that ends with a cause left is reminded at Stop, not on a
  turn the user did not type (`turn-system` in the scratchpad). Subagents are
  not gated. A stale beat lifts the gate (nothing could lower it any more)
  and says `/reload-plugins`. The
  `PreToolUse` matcher is the catch-all for this; tools the script does not
  handle are decided without jq (~6 ms per call, measured, the delegation gate
  included).
- **The task tree.** `task_create` and `task_update` also take `parent`
  (the id of the task this one is a subtask of), `blocked_by` (the ids it
  waits on, a list; `"3, 4"` is read too) and `ref` (a short handle, `T0`,
  `C6`), stored on the task as `parent`, `blockedBy` and `ref` only once set.
  A parent exists in the caller's list, is in the same epic, and the tree
  stays three levels deep at most (task, subtask, sub-subtask), counting the
  subtasks of a task that moves; a task under itself or under one of its own
  subtasks, a blocker that does not exist, a task waiting on itself, and a
  wait that closes a cycle (`#1 waiting on #3 would be a cycle, #3 already
  waits on #1 (#3 → #2 → #1)`) are refused with the reason, and a refused
  call changes nothing. `parent=""`, `blocked_by=[]` and `ref=""` clear one.
  A deleted task's subtasks move up a level and the tasks waiting on it stop
  waiting. kodflow-hud draws the tree; nothing else reads these fields.
- **Limits:** task subjects 30 characters (the tree of kodflow-hud cuts the title at 18
  cells and shows it whole on the selected task's line; tasks.py allowed 40), refs 5, epic titles 20, refused beyond with the
  limit and where the detail goes (`description`). A subject written longer
  before the limit stays as written: it is never rewritten, the tree cuts it.
- **Format version.** The tree's fields keep the file at version 2: the
  status line (`internal/adapter/tasks/provider.go`) decodes named fields
  with `encoding/json`, which skips the others, and never reads `version`;
  `lib/epics.jq` picks the fields it uses. A version-2 file with the new
  fields reads as before in both, and a file without them is unchanged.
- **v1 files** (one epic per agent, a dict) are read as v2 and rewritten by
  the next change; the hooks read both shapes.
- **Running subagents** are recorded next to it, in `agents.json`, by the
  `SubagentStart`/`SubagentStop` hooks, each with the main agent's active epic
  at its start (`0` when none), so the status line counts it on that pill.
  Writes hold `lib/lock.sh`, a `mkdir` lock (`.agents.lock.d`): `flock(1)`
  does not exist on macOS, where the former `flock -w 2` serialised nothing
  and concurrent starts lost entries. A lock older than 10 s is broken by an
  atomic rename; one not obtained in 2 s is written through, never blocking.

`tests/run-tests.sh` runs the mod's node suite (when node can run TypeScript),
then `test_root_gate.sh`, `test_agents.sh` (routing gate, gated-model fallback,
agent feedback, on the recorded payloads), `test_lock.sh` and `test_cleanup.sh`.

### Cleanup on close (`KODFLOW_CLEANUP=off`)

A subagent works in its own worktree and branch; once its PR is merged, the
worktree, the local branch and the remote branch were removed by hand. The
mod does it when the main agent completes the task linked to that subagent
(`task_update` with `worker=`), or closes the epic it worked on.

- **Whose worktree.** Claude Code does not say where a subagent worked, and
  `agents.json` records no directory. The mod reads every writing call a
  subagent makes (Bash command, `file_path`) for absolute
  `<parent>/.worktrees/<name>` paths, the layout rule 5 of the subagent
  context and the delegation gate impose, and keeps them per agent id in
  `worktrees.json`. A path read by mistake is harmless: the checks below
  decide, not the attribution.
- **When.** In the mod, on the successful `task_update(status=completed)` of
  a main-agent task: the list before the update still holds the task's
  `worker_id`, which the update drops. A Stop hook would find the link gone.
  A worker cleaned after for a task is tied to that task's epic, so the
  epic's closing tries again what a first attempt left (a PR merged after the
  task was completed). The epic also brings the subagents `agents.json` saw
  start on it.
- **What must hold** (`hooks/scripts/cleanup.sh`), for each worktree: a
  linked worktree, never the repository's main one; its branch neither the
  default branch (`<remote>/HEAD`) nor `main` nor `master`; `git status
  --porcelain` empty; a PR for the branch `MERGED` whose `headRefOid` equals
  the branch's local head. A squash merge leaves no ancestry, so the heads are
  compared; a local commit past the merged head is unpublished work. Then
  `git worktree remove` (never `--force`, run from the main worktree),
  `git branch -D`, `git push <remote> --delete`.
- **Otherwise nothing is touched**, and one line names what is missing
  (uncommitted changes, PR open or absent, heads that differ, gh failing or
  silent, default branch, main worktree), once per worktree and motif: a
  refusal is not repeated, a new motif is said, and a removal is always said,
  even after an earlier refusal. The lines go to `cleanup-notices`;
  `on-user.sh` hands them to the model with the next prompt, whole lines up
  to 4000 bytes, and carries the others in `cleanup-notices.rest` for the
  prompt after, counted in a line of their own: none is lost or cut. A path that is no longer a
  worktree is skipped in silence.
- **Never in the way.** The script is started without being awaited, so the
  task call answers at once; `gh pr list` and the push are each bounded by
  `KODFLOW_CLEANUP_TIMEOUT` seconds (default 15), a timeout or a failure
  counting as "not known to be merged"; the whole run by 300 s. One run per
  session at a time (`lib/lock.sh`). Every failure is swallowed.

## The project's documents (`KODFLOW_DOCS=off`)

`hooks/docs-catalog.json` names fifteen documents (`id`, French `name`,
`default` path, `source` video or extra, `why`, `touches`): requirements,
flow, design brief, data, implementation plan, ADRs, voice, glossary,
quality, testing, threat model, GDPR register, operations, README. A project
moves one (`path`) or greys one (`ignored`, a reason, possibly empty) in
`docs/manifest.json` at its git root; no manifest means every default path,
nothing ignored; a manifest that does not parse reads as absent; unknown ids
are skipped. The hooks only read the manifest. A file is present when it
exists and is not empty; a path ending in `/` is a directory, present when a
non-empty `.md` lies anywhere below it.

- **`docs.json`**, at `<config>/kodflow/sessions/<session>/docs.json`
  beside `tasks.json` (`lib/docs.sh`, replaced whole by `mv`): version, git
  root, manifest, time, and per document its id, name, path, `state`
  (`ok`, `missing`, `ignored` with its `reason`), source and why. Written at
  SessionStart, after a Write or Edit under `docs/`, and at most every 30 s
  on the next Read, Write, Edit or Bash. Outside a git repository there is
  none (a stale one is removed at SessionStart). The HUD panel reads it.
- **SessionStart** adds an index to the context: one line per document
  (`- <id> <name>: <path>, <state>`), then the missing ids. Never a
  document's text, and nothing in the per-prompt directive of `on-user.sh`.
- **A file read or written** (PostToolUse Read, Write, Edit, MultiEdit)
  whose path, relative to its own git root (a subagent's worktree included),
  matches the `touches` of a document adds `document concerné : <name>
  (<path>)`, or `document concerné absent : …, /kodflow-workflow:docs <id>
  le crée` when it is missing; once per document, root and session
  (`docs-noted`); nothing for an ignored one, for `docs/`, `.md` files,
  `.git/` or `.claude/`. `touches` are bash patterns where `*` crosses `/`.

## The journal of refusals: `blocks.jsonl`

`<config>/kodflow/sessions/<session>/blocks.jsonl`, beside `tasks.json`
(`lib/blocks.sh`): one JSON line per stopped call, appended under a
`mkdir` lock, the last 500 kept. Fields: `ts`, `kind`, `tool`, `summary`,
`motif`, `agent` (the subagent's type, else its id, else `main`), `rule`,
`ref`; an empty one is left out. A `tool_use_id` is written once.

| kind | Written by | summary · motif · rule |
|------|------------|------------------------|
| `hook` | every refusal of `on-tool.sh` (`_block`, the gated-model fallback) and of the mod (Bash guards, mcp.json on a forge tool, gated models at a spawn, a Skill or a model switch), handed to `on-mod.sh` by `journal()` | the title · its `[motif:…]`, else the gate's name (`triage`, `delegation`, `builtin-tasks`, `protected-path`) · none |
| `classifier` | `PermissionDenied` (auto mode only), and a `PostToolUseFailure` whose error carries auto mode's refusal text | the verdict, brackets dropped, or the no-verdict text · none · `Bash(<command> <subcommand>:*)`, `Edit(//<abs path>)`, `Read(//<abs path>)`, `WebFetch(domain:<host>)`, else the tool name |
| `agent` | `on-stop.sh`, when a task `in_progress` is tied to a stopped worker (once per set) | `<worker> arrêté, tâche #<id> en cours (<subject>)` |
| `permission`, `ci` | nothing in this plugin: Claude Code fires no hook when the user denies a permission dialog (`PermissionDenied` is auto mode only, `PostToolUseFailure` does not fire on a denial), and CI is not a hook event. `kf_block` takes any kind for another writer | — |

Not journaled: the collision guard of the mod (`machine-guards.ts`, a write
another live session made) and the modwall refusals of a plugin module.

## What the log is

`.claude/logs/<branch>/session.jsonl`, one line per event, every script through
the same jq program. Tool inputs are allow-listed per tool — a `Read` keeps its
path, never its content; a `Bash` keeps 500 characters of command and 2000 of
output — and every string is clipped, then redacted (`token=`, `api_key=`,
`Bearer`, provider token prefixes). `/learn` reads it. It is gitignored.

## What was removed, and why

| Was | Now | Reason |
|-----|-----|--------|
| `permission-request.sh` auto-approving "safe" Bash prefixes | gone | a prefix match approved `git status; rm -rf ~`. Claude Code's own `permissions.allow` rules do this properly |
| `worktree-create.sh` / `worktree-remove.sh` | gone | a `WorktreeCreate` hook *replaces* Claude Code's worktree support, and the replacement deleted `index.lock` and ran `git fetch` on every creation. The native path handles `.worktreeinclude` and removes unchanged worktrees itself |
| worktree cleanup in `session-init.sh` | gone | it force-removed any worktree older than 24 h, including one with uncommitted work |
| `task-created.sh` contract registry | gone | it needed a capability file nothing writes and a primitives library the plugin never shipped, so it never ran. Team tasks are logged, not adjudicated |
| `feature-update.sh` | gone | `errexit` on a fail-open hook; its only output went to an async hook and arrived a turn late |
| `rtk` rewrite with `permissionDecision: allow` | rewrite only, then gone | `allow` skipped the permission prompt for every command rtk knows. The rewrite itself went next (D3): a hook that changes the input is a second author of every command. rtk is now a prefix the caller chooses |
| `--force` → `--force-with-lease` rewrite | refusal with the command to run | the rewrite was only correct when the whole line was the push; the refusal says what to run instead |
| stderr "warnings" on exit 0 | `additionalContext` | stderr on exit 0 goes to the debug log; Claude never saw them |
| `printf '\a'` | `terminalSequence` | hooks have no terminal; the bell never rang, and on `Stop` it corrupted the JSON that followed it |
| per-event jsonl files, `checkpoint.json`, compaction snapshots | one log | no reader for any of them; compaction recovery is Claude Code's job |
| `CLAUDE_ENV_FILE` caching of `GH_ORG`/`GH_REPO` | gone | no consumer |
| `common.sh`, hook profiles | gone | sourced by one script that used none of it; `HOOK_PROFILE` set nowhere |

## Measured

Wall time per hook invocation on the same machine, 20 runs, realistic payloads
(`scripts/tests/test_hooks.sh` has the harness):

| Event | 24 scripts | 5 scripts |
|-------|-----------:|----------:|
| PreToolUse · Bash `ls` | 145 ms | 44 ms |
| PreToolUse · Bash `git commit` | 176 ms | 85 ms |
| PreToolUse · Edit | 34 ms | 14 ms |
| PostToolUse · Edit | 103 ms | 37 ms |
| PostToolUse · Bash / Read | 77 ms | 14 ms |
| UserPromptSubmit | 26 ms | 20 ms |
| Stop | 43 ms | 16 ms |

The shell reader runs only when the unquoted line names a verb it knows; a
2.5 kB heredoc commit message costs about 100 ms under bash 5 and bash 3.2
alike. Global substitutions (`${x//…/}`) are quadratic in bash 3.2 and are
kept off long strings. Logging is a detached subshell and no longer on the
path; its lock is a `mkdir`, `flock` being absent on macOS.

## Project knobs

| File | Effect |
|------|--------|
| `.claude/protected-paths` | one glob per line; replaces the default list (`node_modules/`, `.git/`, `vendor/`, `dist/`, `build/`, `.env*`, `*.lock`, lockfiles, `go.sum`) |
| `ktn-linter` on PATH | after each Write, Edit or MultiEdit of a Go file, `ktn-linter run --json` on the file's package, from its module's directory (the `go.mod` nearest the file, never above the project root: `lib/gomod.sh`, `lint.ts`, one fixture file `tests/fixtures/gomod.json`), at most 10 s (`KF_LINT_TIMEOUT`); only that file's findings are kept and given to the model as `additionalContext`, with the instruction below. Silent when the file is clean, when the run fails, times out or exits 42 (a daemon serves the module through its own hooks), and when the same findings were already given for that file (line numbers left out of the comparison). When ktn-linter's own PostToolUse hook is installed (a `ktn-hook` command in `~/.claude/settings.json`, written by `ktn-linter hook install`, or in the project's `.claude/settings.json` or `settings.local.json`), it already lints each edit through the daemon: nothing is run here, the instruction is given once per session for the findings it reports. The instruction: fix each finding now, in this change; a fix that needs a heavy refactor is still a fix, not a false positive (do it, or say to the user that it is outside the task, never skip silently); only a finding certain to be a false positive gets a complete issue on kodflow/ktn-linter (rule ID, minimal reproduction, file:line, expected and actual, ktn-linter version), then the work goes on |
| `/lint-setup [path]` | checks, for the Go module of `path` (default the session root), the ktn-linter binary, its command hooks (`ktn-linter hook doctor --json`), the per-user daemon when `KTN_USER_DAEMON=1` (`ktn-linter daemon status`) and the module's `.ktn-linter.yaml`; proposes installing the latest release (ktn-linter and ktn-hook, checksum verified) into `~/.local/bin`, `ktn-linter hook install` and `ktn-linter daemon ensure`, each only after a yes in `$.ui.ask`; configuration problems are reported, never written |
| `ROOT_OK=1` prefix on a command | that line is exempt from the delegation gate |
| `KODFLOW_ROOT=off` | the delegation gate, its Stop rule and its prompt line are off for the session |
| `KODFLOW_MOD=off` | the mod hooks nothing: no task tools, no beat, attribution left to Claude Code |
| `KODFLOW_ROUTE=off` | the routing gate is off for the session |
| `KODFLOW_ISOLATION=off` | the isolation gate is off for the session |
| `KODFLOW_FABLE=allow` · `off` | gated models pass (`allow`, still logged) or the gate is not evaluated (`off`), in the mod and the shell alike |
| `KODFLOW_FEEDBACK=off` | no rule 6, nothing kept, nothing proposed |
| `KODFLOW_LINT=off` | no ktn-linter run after an edit and no instruction; ktn-linter's own hooks, when installed, are not affected. For every project: `"env": {"KODFLOW_LINT": "off"}` in `~/.claude/settings.json`. For one project: the same `env` block in that project's `.claude/settings.json` (applied once the workspace is trusted, and in `-p` runs; a hook inherits it) |
| `KODFLOW_STOP_TASKS=off` | no Stop line about the task list (`stopped`, `overcount`, `idle`, `loose`, `builtin`); the triage line and the delegation line (`unattended`, `KODFLOW_ROOT`) stay |
| `KODFLOW_LANG=en` · `fr` | the language of the texts, over Claude Code's `language` setting |
| `NO_COLOR` · `KODFLOW_COLOR=off` | the Stop feedback without colour |
| `KODFLOW_COMMIT_IDENTITY=<path>` · `off` | another commit-identity rules file, or the check off (default `${CLAUDE_CONFIG_DIR:-~/.claude}/kodflow/commit-identity.conf`, absent means off) |
| `KODFLOW_DOCS=off` | no `docs.json`, no index at SessionStart, no `document concerné` line; `blocks.jsonl` is not affected |
| `docs/manifest.json` | moves (`path`) or ignores (`ignored`) a document of the catalogue for this project |
| `KODFLOW_CLEANUP=off` | no worktree, branch or remote branch is removed on close, no notice; `KODFLOW_CLEANUP_TIMEOUT` (seconds, default 15) bounds each `gh` and push call |

## The Stop feedback

What `on-stop.sh` returns as `additionalContext` is shown on screen as
« Stop hook feedback » and read by Claude. It speaks only when the task list
says something false, one line per cause, each task named once (by the
first cause that claims it, in this order), and each cause once per state:
`stop-said` in the scratchpad keeps, per cause, the fingerprint of the
state last said; the same state is not said twice in a row, a changed one
is, and a cause that clears drops its record.

| Cause | Colour | When |
|-------|--------|------|
| `stopped` | red | `in_progress`, tied to a subagent that has stopped |
| `unattended` | orange | `in_progress`, tied to nobody, on an epic no running subagent covers (`KODFLOW_ROOT`) |
| `overcount` | orange | more untied tasks `in_progress` than workers |
| `idle` | orange | the active epic has work to do, nothing `in_progress` or `waiting` |
| `loose` | orange | requests with no epic left `pending` |
| `builtin` | orange | open tasks of Claude Code's own list (`TaskUpdate`) |
| triage, resume | orange | a message with no task, tasks left open at the session start |
| CLAUDE.md | orange | a changed directory whose CLAUDE.md was not updated |
| agent feedback | green | subagent feedback that waits on the user's decision |

A task `in_progress` on a running subagent and a `waiting` task are true
and never said. The reported case, three tasks on stopped subagents, was
three sections and nine lines; it is now one:

```
Tâches à remettre d'aplomb : #99 #100 #101 (sous-agent arrêté : terminer, remettre en pending ou waiting, ou relancer l'agent)
```

**Colour.** Claude Code 2.1.309 renders the ANSI colours of a Stop hook's
`additionalContext` and `systemMessage` (measured in a pty: the escape
reaches the screen as sent, `\e[31m` before the text). Only the label of
each line is coloured, so the model pays a few tokens on a turn the hook
speaks. Nothing the screen does not show is coloured: the
`UserPromptSubmit` context is not displayed, it stays plain.

**Language.** Every text of the shell scripts that the user or the model
reads at Stop and at each prompt lives in one table, `hooks/messages.json`
(`en` and `fr`), read by `lib/msg.sh`. The language is Claude Code's
`language` setting (free text, read from the user settings, then the
project's `settings.json` and `settings.local.json`, the last one that sets
it winning): French when it names French (`fr`, `french`, `Français`...),
English otherwise. The guards' refusals (`on-tool.sh` and their double in
the mod) and the task tools' answers are still in English.

## Tests

```
bash scripts/tests/test_hooks.sh
bash plugins/kodflow-hooks/tests/run-tests.sh   # mod (node) + delegation gate + test_agents.sh + test_cleanup.sh + test_identity.sh + test_docs.sh + test_blocks.sh
claude plugin validate --json plugins/kodflow-hooks
claude plugin test plugins/kodflow-hooks         # tests/mod/*.test.ts, in the engine
node plugins/kodflow-hooks/tests/mod/run-node.ts # corpora, real disk, several processes, invariants
```

The mod is held three ways. `tests/mod/conformance.corpus.ts` was recorded
from `mcp/tasks.py` before it was removed (38 scenarios, 184 calls: the 26
tests of its suite, the worker cases, the order of validation, code points,
`task_list` writing nothing, the agent id made path-safe, a worker judged by its id alone): each step keeps the
file before, the call, the answer and the file after, and the port must match
every one (`conformance.ts`, run by `claude plugin test` and by node). One
change since is deliberate, the 30-character subject: the corpus is replayed
amended for it (its long subjects shortened, its limits and refusal text
moved, every other byte as recorded), and `task_create` and `task_update`,
whose text changed, must still take every argument tasks.py gave them, as
it gave them. `tests/mod/tasks.test.ts` holds the tree: parent, depth,
cycles, blockers, refs, a deletion's links, the file left at version 2.
`tests/mod/register.test.ts` runs the wiring in the engine's own test kit,
with the host in memory: registration, the temporary file and `mv` under the
lock, refusals as `{ deny }`, the cap read from `$.agent.list()`, the beat
written before the call goes on, `KODFLOW_MOD=off`, the attribution text.
`run-node.ts` runs the store on a real disk, a stale lock, and six processes
writing one `tasks.json` at once (every task kept, ids unique); then the
bash-guard corpus against the mod's guards in a real repository (every Bash
row decided as on-tool.sh decides it, known gaps reported), and the module's
invariants read from its sources (never `allow`; `{ result }` built only by a
task tool, the filter and the veil; the secret variables read are
`SECRET_VARS`). `tests/mod/pipeline.test.ts` holds the pipeline's logic: the
order of the policies and a failure injected into each, the filter on its
corpus and on the "bytes" corpus (reads never touched), the veil and its false
positives (git hashes, base64 of text), and the shell reader's details.

A hundred and forty cases in a throwaway repository, plus the bash-guard
corpus (about two hundred lines, rc and motif compared): every block, the
input never rewritten, the tracker fed a file name that is also a shell command, the
redaction of every persisted string, the Stop reminder firing once, the task rules on the active epic only, the
lint of the file just edited (its findings only, the instruction, a set given
once, a clean run clearing it, silence on a failed run, nothing run beside
ktn-linter's own hook, `KODFLOW_LINT=off`), `KODFLOW_STOP_TASKS=off`, the
triage and epic state injected with each prompt, and every
script fed garbage or nothing and exiting 0.

`test_hooks.sh` runs with `KODFLOW_ROOT=off` so its main-thread payloads reach
the guard they test. The delegation gate has its own suite,
`tests/test_root_gate.sh` (run by `tests/run-tests.sh`): writes inside and
outside a work tree (worktree gitdir files, relative and `..` paths), memory
and configuration inside a repository, sysadmin commands allowed, every
producing git/forge op refused including wrapped forms, merges allowed and journaled, the
forge MCP tools, the escapes, the subagent never gated, the Stop rule with and
without a subagent on the epic, and the log tags.

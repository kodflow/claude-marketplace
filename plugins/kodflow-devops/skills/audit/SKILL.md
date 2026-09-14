---
name: audit
description: Health check for this Claude Code installation. Verifies that every skill, agent,
  hook, script and MCP server is present, well-formed and actually reachable — no skill pointing
  at a module that does not exist, no agent with invalid frontmatter, no hook naming a missing
  script, no dangling cross reference — and reports knowledge-base freshness. Scores seven
  dimensions and prints a dashboard with the specific files at fault.
when_to_use: Use after upgrading Claude Code, after editing settings/agents/skills, when a
  skill or hook misbehaves, or as a pre-flight check at the start of a session in a fresh
  environment.
argument-hint: '[--fix] [--dimension agents|skills|hooks|mcp|settings|security|knowledge]'
model: sonnet
allowed-tools:
- Read(**/*)
- Glob(**/*)
- Grep(**/*)
- Bash(ls:*)
- Bash(wc:*)
- Bash(jq:*)
- Bash(cat:*)
- Bash(find:*)
- Bash(grep:*)
- Bash(test:*)
- Bash(date:*)
- Bash(command:*)
- Bash(git:*)
- Bash(python3:*)
- Bash(bash:*)
- Edit(~/.claude/**)
---

# /audit — installation health

$ARGUMENTS

Checks the harness, not the project. Every check below is a **file that must
exist** or a **reference that must resolve** — never a subjective judgement, so
two runs on the same machine give the same score.

`--fix` repairs only the mechanically unambiguous faults (a missing directory, a
stale index, a non-executable hook). Everything else is reported, never guessed
at.

---

## Run every check, then print the dashboard

### 1. Agents — frontmatter validity and reachability

```bash
ls ~/.claude/agents/*.md | wc -l
```

Per file, verify:

- frontmatter parses as YAML and starts on line 1
- `name` and `description` are present; `name` is lowercase-with-hyphens and has no `:`
- `tools` is a comma-separated string, not a YAML list
- `model` ∈ {`sonnet`, `opus`, `haiku`, `fable`, `inherit`, a full `claude-*` id} or absent
- **no invalid key** — anything outside: `name description tools disallowedTools model
  permissionMode maxTurns skills mcpServers hooks memory background effort isolation
  color initialPrompt experimental`
- every `subagent_type` / agent name mentioned in the body resolves to an installed agent

Score: `100 − 10×(invalid frontmatter) − 15×(dangling agent reference)`.

`teamRole`, `teamSafe`, `context: fork` and `allowed-tools` are **not** agent
fields. Their presence is an invalid-key fault: they are silently ignored at
load time, so an agent carrying them is not doing what its file claims.

### 2. Skills — module links resolve

```bash
ls -d ~/.claude/skills/*/ | wc -l
find ~/.claude/skills -name SKILL.md | while read -r f; do
  printf '%s %s\n' "$(wc -l < "$f")" "$f"
done | sort -rn | head
```

Per skill, verify:

- `SKILL.md` exists and its frontmatter parses
- `description` + `when_to_use` ≤ 1536 characters combined
- `SKILL.md` ≤ 500 lines (over that, supporting files should carry the detail)
- **every backticked `*.md` reference resolves** to a file in the skill directory
- every `Skill(...)` invocation in a skill body names an installed skill
- `~/.claude/commands/` does not exist — commands are legacy; a name present in
  both places silently shadows the command

Score: `100 − 20×(broken module link) − 10×(oversized SKILL.md) − 15×(dangling skill reference)`.

A broken module link is the highest-value check here: the skill still loads and
still claims a phase map, but the phase content is missing, so it degrades into
improvisation without saying so.

### 3. Hooks and scripts

```bash
jq -r '.hooks | to_entries[] | .value[] | (.hooks//[])[] | .command' \
   ~/.claude/settings.json | tr '|' '\n' | awk '{print $1}' | sort -u |
while read -r s; do test -x "$s" || echo "MISSING/NOT-EXECUTABLE $s"; done
```

- every hook command resolves to an executable file
- `kodflow-hooks` is installed (`claude plugin list` names it) and its `hooks/scripts/on-*.sh` pass `bash -n`
- no `hooks` entry in `settings.json` still points at a `~/.claude/scripts/*.sh` the plugin replaced (`git-guard.sh`, `rtk-rewrite.sh`, `log.sh`, `session-init.sh`, …) — that is a duplicate hook running in parallel

Score: `100 − 25×(missing hook script) − 10×(syntax error)`.

### 4. MCP servers

```bash
jq -r '.mcpServers | to_entries[] | "\(.key)\t\(.value.command // .value.url)"' ~/.claude/mcp.json
```

- every `command` resolves on `PATH` or is an existing executable path
- servers listed in `disabledMcpjsonServers` are intentional, not accidental
- a configured-but-unreachable server is a fault: report the binary it wants and
  where the binary actually is, if it exists elsewhere

Score: `100 − 20×(unresolvable command)`.

### 5. Settings

- `settings.json` parses as JSON and matches its `$schema`
- no key with a `permissions` entry naming a tool that no longer exists
- `env` values are strings (a number or boolean here is silently dropped)
- backup files (`settings.json.bak*`) are noted, not deleted

Score: `100 − 30×(parse failure) − 5×(malformed env value)`.

### 6. Security

- the `kodflow-hooks` PreToolUse entry resolves to an executable `on-tool.sh` (the git guard lives there)
- no plaintext credential in a tracked file under `~/.claude/`
- **no git remote anywhere under the code home embeds a token** —
  `git remote -v` output matching `://[^/]*:[^/]*@` is a leaked credential:

  ```bash
  for r in <code-home>/*/; do
    git -C "$r" remote -v 2>/dev/null | grep -qE '://[^/@]+:[^/@]+@' &&
      echo "TOKEN IN REMOTE: $r"
  done
  ```

  Report the repository path only. **Never print the URL** — that would copy the
  credential into the transcript. The fix is to rotate the token and move to a
  credential helper; `--fix` must not attempt it.
- last 20 commits carry no AI attribution (`Co-Authored-By.*Claude`, `Generated by AI`)

Score: `100 − 40×(leaked credential) − 20×(missing git-guard) − 10×(AI attribution in a commit)`.

### 7. Knowledge base freshness

```bash
python3 ~/.claude/docs/reindex.py --check
jq -r '.by_status | to_entries[] | "\(.key)\t\(.value)"' ~/.claude/docs/INDEX.json
```

- `INDEX.json` exists and is newer than the newest **source** document
  (exclude `INDEX.md` and `README.md` — `reindex.py` writes `INDEX.md` last,
  so counting it always reports a false staleness)
- report `fresh` / `stale` / `expired` counts, and name the expired ones
- `expired` documents are the actionable finding — `/search --refresh <topic>`

Score: `100 − (stale% ÷ 2) − expired%`.

---

## Dashboard

```
═══════════════════════════════════════════════════════════════
  /audit — installation health                      2026-09-08
═══════════════════════════════════════════════════════════════

  Dimension        Score   Detail
  ─────────────────────────────────────────────────────────────
  Agents            100    28 agents, frontmatter valid, 0 dangling
  Skills             80    17 skills · 1 SKILL.md over 500 lines
  Hooks             100    21 events → 23 scripts, all executable
  MCP               100    6 servers, all commands resolvable
  Settings          100    parses, schema-clean
  Security           60    1 remote embeds a token
  Knowledge          89    152 docs · 130 fresh, 22 stale, 0 expired
  ─────────────────────────────────────────────────────────────
  OVERALL            91 / 100

  Act on
    1. [security]  <repo> remote embeds a token — rotate it, then
                   `git remote set-url origin <clean-url>` + credential helper
    2. [skills]    ktn/SKILL.md is 1009 lines — move detail to modules
    3. [knowledge] 22 stale docs (security/, devops/) — /search --refresh security

  --fix would repair: nothing here (all three need a decision)
═══════════════════════════════════════════════════════════════
```

Report the files at fault by path. A score with no path is not actionable, and
the whole point of this skill is that the next command is obvious.

---

## Guardrails

| Action | Status |
|--------|--------|
| Print a leaked credential, or any part of it | **FORBIDDEN** — report the path only |
| `--fix` a fault that needs a decision | **FORBIDDEN** — report it |
| Delete an agent, skill or setting | **FORBIDDEN** — audit reads; it does not prune |
| Score a dimension you did not actually check | **FORBIDDEN** — mark it `skipped` |
| Report a score without the failing paths | **FORBIDDEN** |
| Rotate or revoke a credential on the user's behalf | **FORBIDDEN** |

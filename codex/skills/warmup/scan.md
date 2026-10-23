# CLAUDE.md Hierarchy Scan

## Phase 1.0: Peek (Hierarchy Discovery)

One batch of independent calls, sent in a single message. Nothing here opens a
CLAUDE.md: the peek measures, it does not read.

```yaml
peek_workflow:
  1_discover:
    action: "Discover every instruction file, with its size, in ONE call"
    tool: Bash
    command: |
      git ls-files --cached --others --exclude-standard \
        '*CLAUDE.md' '*CLAUDE.local.md' '.claude/rules/*.md' '.claude/rules/**/*.md' \
        | while IFS= read -r f; do
            [ -f "$f" ] || continue
            printf '%s\t%s\t%s\t%s\t%s\n' \
              "$(wc -l < "$f" | tr -d ' ')" "$(wc -c < "$f" | tr -d ' ')" "$(wc -m < "$f" | tr -d ' ')" "$f"
          done
    note: |
      Prints <lines>\t<bytes>\t<chars>\t<path>. Three separate `wc` calls:
      on macOS `wc -lcm` does not print the byte count (-c and -m exclude each
      other). `[ -f "$f" ] || continue` skips an indexed file deleted on disk.
    fallback: "Glob '**/CLAUDE.md' outside a git work tree"
    output: [claude_files with lines, bytes and characters]

  2_build_tree:
    action: "Build the context tree by depth and mark what is already loaded"
    algorithm: |
      FOR each file:
        depth = path.count('/') - base.count('/')
        loaded = file is in the working directory or an ancestor of it
                 (CLAUDE.md, .claude/CLAUDE.md, CLAUDE.local.md),
                 or is imported by one of those (grep -n '^@\|[[:space:]]@[^[:space:]`]' on it),
                 or is a .claude/rules file without 'paths:' frontmatter
        on_demand = every other CLAUDE.md (subdirectories) and path-scoped rules
      Sort by ascending depth
    rule: |
      A loaded file is consumed from context in Phase 2. It is never passed to
      Read again in normal mode.

  3_detect_project:
    action: "Identify the project type in ONE call"
    command: |
      # CLAUDE_PLUGIN_ROOT is not set in the Bash tool and ~/.codex/skills/_shared
      # does not exist for a plugin install: start from the skill's base directory
      # (given when the skill loaded; the script is its sibling _shared/).
      D="<base directory of this skill>/../_shared/scripts"
      [ -f "$D/detect-project.sh" ] || D="${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/skills/_shared/scripts}"
      [ -f "$D/detect-project.sh" ] || D=$(dirname "$(find "$HOME/.claude/plugins" -path '*kodflow-workflow*/skills/_shared/scripts/detect-project.sh' 2>/dev/null | head -1)")
      [ -f "$D/detect-project.sh" ] && bash "$D/detect-project.sh"
      # the allowed-tools rule is Bash(bash *detect-project.sh): the literal tail matters
    returns: "languages, build_system.targets, test_frameworks, ci — JSON"
    fallback: |
      When no candidate path exists, the script is absent, jq is missing, or `languages` comes back empty
      (manifests below the root, as in a monorepo), Glob the manifests below,
      at most three levels deep, and read the table as the key.
    patterns:
      - "go.mod"           -> Go
      - "package.json"     -> Node.js / TypeScript
      - "Cargo.toml"       -> Rust
      - "pyproject.toml"   -> Python
      - "requirements.txt" -> Python (legacy)
      - "build.zig"        -> Zig
      - "CMakeLists.txt"   -> C / C++ (CMake)
      - "Makefile"         -> C / C++ / generic (check for CC/CXX)
      - "*.tf"             -> Terraform / OpenTofu
      - "Chart.yaml"       -> Helm
      - "docker-compose.y*ml" -> Docker Compose
      - ".github/workflows/" -> GitHub Actions
    on_no_match: |
      Report "unknown project type" and continue. Do NOT infer a stack from
      file extensions alone -- a repo of .sh and .md files is a scripts repo,
      not a mis-detected build.
    multi_language: |
      Several manifests may match; report every one. A repo with go.mod AND
      package.json is a Go service with a web front end, not an ambiguity.

  4_repo_shape:
    action: "Branch, dirt and size in ONE call"
    command: "git branch --show-current; git status --porcelain | wc -l; git ls-files | wc -l"
    output: [branch, dirty_count, tracked_files]
    use: "tracked_files decides inline vs Explore in Phase 3.0"

  5_locate_ledger:
    action: "Find the constraint ledger written by /project"
    check:
      - "CLAUDE.md            -> grep -n '^### C-[0-9]'"
      - ".claude/constraints.md"
    output: [ledger_path, active_constraint_count, superseded_count]
    absent: "Report 'no ledger' and suggest /project. Never synthesise one."
```

**Output Phase 1** (kept for the session, not printed on its own — it feeds
the briefing):

```
  Project : <root>        Type: <detected_type(s)>
  Branch  : <branch>      Dirty: <n>     Tracked files: <n>

  CLAUDE.md hierarchy (<n> files)
    depth 0 : /CLAUDE.md               871 l  56 KB  loaded     CRITICAL
    depth 1 : /src/CLAUDE.md           120 l   5 KB  on demand  IDEAL
    ...
  Rules     : <n> always loaded, <n> path-scoped
  Constraints: <n> active, <n> superseded  (<ledger_path> | none)
```

---

## Phase 1.2: Health (size and dated state)

Two cheap checks, both from data already measured or one `grep`. They never
edit anything: they feed the briefing's **Drift** section and point to
`--update`.

```yaml
health_checks:
  size:
    input: "lines, bytes and characters from Phase 1.0"
    rule: "Level = the line table (SKILL.md, Size thresholds), plus the character check below"
    report: |
      Every file at WARNING or above, with its level, and the launch cost of
      the loaded ones (bytes / 4 ≈ tokens). A file loaded on demand over
      40 000 characters (`wc -m`) is reported "truncated on a 200K window",
      over 150 000 "truncated everywhere" (FORBIDDEN). CRITICAL or FORBIDDEN →
      "split with /warmup --update" (update.md, Phase 3.5).

  dated_state:
    purpose: |
      Status prose ("as of 2026-10-07: deployed", "nothing converged yet")
      ages faster than rules, and a stale one is read as current.
    command: |
      # A status phrase and a date on the same line OR the next one (the date
      # often sits on the following line). A bare "rien" or "etat" is not a
      # status: "rien (n'est) deploye|converge|applique" and "etat au|:" are.
      for f in <each CLAUDE.md>; do
        awk -v F="$f" '
          { l[NR]=$0 }
          END { for (i=1;i<=NR;i++) {
                  w = l[i] (i<NR ? " " l[i+1] : "")
                  if (tolower(l[i]) ~ /(as of|status:|(état|etat) (au|du|:)|en service|en ligne|deployed|déployé|rien (n.est )?(déployé|deploye|converg|appliqué|applique)|pas (déployé|deploye)|wip)/ \
                      && w ~ /(20[0-9][0-9]-[01][0-9]-[0-3][0-9]|[0-3][0-9]\/[01][0-9]\/20[0-9][0-9])/)
                    printf "%s:%d:%s\n", F, i, substr(l[i],1,160) } }' "$f"
      done | head -50
    rule: |
      A match older than 30 days is a CANDIDATE, never a verdict: report the
      count, the oldest three by file:line, and let the user or --update
      decide. Never rewrite a status from warmup.
```

---

Phase 2.0 to 4.0 live in `read.md` — they run after the peek, not here.

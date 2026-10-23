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
        | xargs wc -lc 2>/dev/null
    fallback: "Glob '**/CLAUDE.md' outside a git work tree"
    output: [claude_files with lines and bytes]

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
    command: 'bash "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude}"/skills/_shared/scripts/detect-project.sh'
    returns: "languages, build_system.targets, test_frameworks, ci — JSON"
    fallback: |
      When the script is absent, jq is missing, or `languages` comes back empty
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
    depth 0 : /CLAUDE.md               871 l  56 KB  loaded     FORBIDDEN
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
    input: "lines and bytes from Phase 1.0"
    rule: "Level = worse of the line and byte levels (SKILL.md, Size thresholds)"
    report: |
      Every file at WARNING or above, with its level, and the launch cost of
      the loaded ones (bytes / 4 ≈ tokens). FORBIDDEN or CRITICAL →
      "split with /warmup --update" (update.md, Phase 3.5).

  dated_state:
    purpose: |
      Status prose ("as of 2026-10-07: deployed", "nothing converged yet")
      ages faster than rules, and a stale one is read as current.
    command: |
      grep -niE '(as of|status|state|état|etat|en service|deployed|déployé|not deployed|rien|pending|WIP)[^|]{0,80}(20[0-9]{2}-[01][0-9]-[0-3][0-9]|[0-3][0-9]/[01][0-9]/20[0-9]{2})' \
        <each CLAUDE.md> | head -50
    rule: |
      A match older than 30 days is a CANDIDATE, never a verdict: report the
      count, the oldest three by file:line, and let the user or --update
      decide. Never rewrite a status from warmup.
```

---

Phase 2.0 to 4.0 live in `read.md` — they run after the peek, not here.

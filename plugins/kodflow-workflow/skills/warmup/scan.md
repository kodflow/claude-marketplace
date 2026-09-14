# CLAUDE.md Hierarchy Scan

## Phase 1.0: Peek (Hierarchy Discovery)

```yaml
peek_workflow:
  1_discover:
    action: "Discover all CLAUDE.md files in the project"
    tool: Glob
    pattern: "**/CLAUDE.md"
    output: [claude_files]

  2_build_tree:
    action: "Build the context tree by depth"
    algorithm: |
      FOR each file:
        depth = path.count('/') - base.count('/')
      Sort by ascending depth
      depth 0: /CLAUDE.md (root)
      depth 1: /src/CLAUDE.md, /.devcontainer/CLAUDE.md
      depth 2+: subdirectories

  3_detect_project:
    action: "Identify the project type from its build manifest"
    tools: [Glob]
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

  4_locate_ledger:
    action: "Find the constraint ledger written by /project"
    check:
      - "CLAUDE.md            -> grep '^### C-[0-9]'"
      - ".claude/constraints.md"
    output: [ledger_path, active_constraint_count, superseded_count]
    absent: "Report 'no ledger' and suggest /project. Never synthesise one."
```

**Output Phase 1:**

```
═══════════════════════════════════════════════════════════════
  /warmup - Peek Analysis
═══════════════════════════════════════════════════════════════

  Project: /workspace
  Type   : <detected_type>

  CLAUDE.md Hierarchy (<n> files):
    depth 0 : /CLAUDE.md (project root)
    depth 1 : /.devcontainer/CLAUDE.md, /src/CLAUDE.md
    depth 2 : /.devcontainer/features/CLAUDE.md
    ...

  Constraints: <n> active, <n> superseded  (<ledger_path> | none)

  Strategy: Funnel (root → leaves, decreasing detail)

═══════════════════════════════════════════════════════════════
```

---


---

Phase 3.0 lives in `read.md` — it runs after the funnel read, not here.

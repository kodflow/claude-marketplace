# Update Mode (--update) for CLAUDE.md Refresh

Sizes are judged by the one table in `SKILL.md` (*Size thresholds*): the worse
of lines and bytes. Paths below are relative to the repository root
(`git rev-parse --show-toplevel`), never a hardcoded `/workspace`.

## Phase 1.0: Peek, then Full Code Scan

The Peek of `scan.md` Phase 1.0 opens `--update` too: hierarchy, sizes, load
state and project type, in one batch. `--update` needs it more than normal mode
does, because it judges and rewrites the files the Peek lists.

**Read from disk, never from context.** A CLAUDE.md that Claude Code loaded has
lost its block-level HTML comments before injection, and Read is the only view
that keeps them ("Block-level HTML comments ... are stripped before the content
is injected into Claude's context ... When you open a CLAUDE.md file directly
with the Read tool, comments remain visible", Claude Code memory docs,
<https://code.claude.com/docs/en/memory>). The `<!-- updated: ... -->`
timestamp is such a comment. Every CLAUDE.md that `--update` judges or
modifies is therefore `Read` from disk first (whole file under 150 lines,
otherwise by `offset`/`limit` around the sections touched), and the edit is
built from that read, never from the copy in context.

```yaml
scan_workflow:
  0_load_gitignore:
    action: "Load .gitignore patterns"
    command: "cat .gitignore 2>/dev/null"
    rule: "ALL patterns are STRICTLY respected"

  1_discover_code:
    action: "Scan all code files (respecting .gitignore)"
    tools: [Bash, Glob]
    command: |
      # Uses git ls-files to respect .gitignore
      git ls-files --cached --others --exclude-standard \
        '*.go' '*.ts' '*.py' '*.sh' '*.rs' '*.java' '*.hcl' '*.yml' '*.j2'
    patterns:
      - "src/**/*.go"
      - "src/**/*.ts"
      - "src/**/*.py"
      - "**/*.sh"
    exclude_source: ".gitignore (STRICT)"
    always_excluded:
      - ".git/"

  2_extract_metadata:
    action: "Extract metadata per directory — Grep and outlines, not whole-file reads"
    parallel_per_directory:
      - "Public functions/types"
      - "Patterns used"
      - "TODO/FIXME/HACK"
      - "Critical imports"
      - "Obsolete elements"

  3_check_claude_files:
    action: "Verify consistency with existing CLAUDE.md files"
    for_each: claude_files
    checks:
      - "Documented structure vs actual structure"
      - "Referenced files still exist"
      - "Documented conventions are followed"
      - "Obsolete information to remove"
```

---

## Phase 2.0: Creating Missing CLAUDE.md Files

**Default behavior of --update** (not a separate option).

```yaml
create_missing_workflow:
  trigger: "Always executed with --update"

  gitignore_respect:
    rule: "STRICT - All .gitignore patterns are honored"
    implementation: |
      # Read and parse .gitignore
      gitignore_patterns = parse_gitignore(".gitignore")

      # Use git ls-files to list only tracked files
      tracked_dirs = git ls-files --directory | get_unique_dirs()

      # OR use git check-ignore to validate
      for dir in candidate_dirs:
        if git check-ignore -q "$dir":
          skip(dir)  # Ignored by .gitignore

  scan_directories:
    action: "Find directories without CLAUDE.md that no ancestor covers (respecting .gitignore)"
    tool: Bash
    rule: |
      Coverage by the ancestor (the user's choice): a directory is COVERED when
      the nearest ancestor that has a CLAUDE.md names it. A directory is
      proposed for creation only when it is not covered AND holds more than 5
      code files (a role counts its tasks/, defaults/, handlers/, templates/,
      files/, vars/ and meta/) OR an entry point (main.<ext>, site.yml,
      playbook*.yml, *.nomad.hcl, tasks/main.yml). Otherwise it gets ONE line in
      the ancestor (Phase 3.7), never a file.
    command: |
      # Directories that hold code, have no CLAUDE.md, and are not covered by an ancestor.
      # Prints: <verdict>\t<direct code files>\t<dir>   (create | line-in-ancestor | covered)
      git ls-files --cached --others --exclude-standard \
        '*.go' '*.ts' '*.tsx' '*.js' '*.mjs' '*.py' '*.rs' '*.java' '*.sh' '*.html' '*.gohtml' '*.css' \
        '*.tf' '*.hcl' '*.yml' '*.yaml' '*.j2' '*.tpl' '*.sql' '*Dockerfile*' '*Makefile' \
        | grep -vE '(^|/)(testdata|vendor|node_modules|__pycache__|\.[^/]+)/' \
        | sed -e 's|/[^/]*$||' -e t -e 's|.*|.|' \
        | sed -E 's#/(tasks|defaults|handlers|templates|files|vars|meta)$##' | sort | uniq -c \
        | while read -r n dir; do
            [ -f "$dir/CLAUDE.md" ] && continue
            # nearest ancestor with a CLAUDE.md, and does it name this directory?
            anc=$dir; covered=0
            while [ "$anc" != "." ]; do
              anc=$(dirname "$anc")
              if [ -f "$anc/CLAUDE.md" ]; then
                grep -qF -- "$(basename "$dir")" "$anc/CLAUDE.md" && covered=1
                break
              fi
            done
            # entry point: main.*, site/playbook yml, *.nomad.hcl, a role's tasks/main.yml
            entry=0
            git ls-files --cached --others --exclude-standard -- "$dir" \
              | grep -E "^$dir/(main\.(go|py|rs|ts|js|mjs|java|sh)|site\.ya?ml|playbook[^/]*\.ya?ml|[^/]*\.nomad\.hcl|tasks/main\.ya?ml)$" -q && entry=1
            if [ "$covered" = 1 ]; then v=covered
            elif [ "$n" -gt 5 ] || [ "$entry" = 1 ]; then v=create
            else v=line-in-ancestor; fi
            printf '%s\t%s\t%s\n' "$v" "$n" "$dir"
          done
    output: |
      create | n | dir           propose a CLAUDE.md
      line-in-ancestor | n | dir  one line in the nearest ancestor (Phase 3.7)
      covered | n | dir           nothing to do
    measured: |
      making.codes (read-only run, 2026-10-23): the former command listed 162
      directories; this one proposes 15, adds 86 one-line pointers and finds 68
      already covered.

  create_template:
    format: |
      # <Directory Name>

      ## Purpose
      TODO: Describe the purpose of this directory.

      ## Structure
      ```text
      <auto-generated tree>
      ```

      ## Key Files
      | File | Description |
      |------|-------------|
      | <files> | TODO |

    max_lines: 30  # Minimal template, enriched later; never past 200 (SKILL.md)
```

**ABSOLUTE RULE: .gitignore is the source of truth for exclusions.**

| Exclusion source | Priority | Examples |
|------------------|----------|----------|
| `.gitignore` | **STRICT** | vendor/, node_modules/, *.log |
| Always excluded | Hardcoded in the command | .git/, testdata/, vendor/, node_modules/, __pycache__/, dot-directories |

---

## Phase 2.5: Drift Detection

A CLAUDE.md is judged stale from the history, not from its `<!-- updated: -->`
comment: that timestamp is inert (`skills/git/commit.md`, "No staleness
check"). The one command below lists each CLAUDE.md older than the last commit
of code in its directory, with the number of commits since and the code files
not yet tracked (a directory can drift before its first commit).

```bash
# CLAUDE.md older than the last code commit of its directory.
# Prints: <commits since>\t<untracked code files>\t<CLAUDE.md>
CODE=(':(exclude)*.md' ':(exclude)*/testdata/*' ':(exclude)*/vendor/*' ':(exclude)*/node_modules/*')
git ls-files --cached --others --exclude-standard '*CLAUDE.md' | grep -E '(^|/)CLAUDE.md$' \
  | while IFS= read -r f; do
      d=$(dirname "$f")
      doc=$(git log -1 --format=%ct -- "$f")
      [ -n "$doc" ] || doc=0                       # never committed: everything is newer
      code=$(git log -1 --format=%ct -- "$d" "${CODE[@]}")
      [ -n "$code" ] || continue
      [ "$code" -gt "$doc" ] || continue
      n=$(git rev-list --count --since="@$doc" HEAD -- "$d" "${CODE[@]}")
      u=$(git ls-files --others --exclude-standard -- "$d" | grep -vE '\.md$' | wc -l | tr -d ' ')
      printf '%s\t%s\t%s\n' "$n" "$u" "$f"
    done | sort -rn
```

Report `commits | untracked | file`, worst first. Drift is a candidate for
Phase 3.0, never a verdict: a refactor may leave a CLAUDE.md exactly right.

---

## Phase 3.0: Obsolescence Detection

```yaml
obsolete_detection:
  file_references:
    description: "Files mentioned in CLAUDE.md but deleted"
    action: |
      FOR each CLAUDE.md:
        extract referenced file paths
        verify each file exists
        mark as obsolete if not found

  structure_changes:
    description: "Directory structure changed"
    action: |
      FOR each CLAUDE.md with 'Structure' section:
        compare documented structure vs actual
        identify differences

  api_changes:
    description: "APIs/functions renamed or removed"
    action: |
      use Grep to search for references
      if 0 results → possibly obsolete

  deprecated_patterns:
    description: "Deprecated patterns still documented"
    action: |
      verify imports/usages in code
      compare with what is documented

  orphan:
    description: "A directory with a CLAUDE.md and no tracked file other than .md"
    command: |
      git ls-files --cached --others --exclude-standard '*CLAUDE.md' | grep -E '(^|/)CLAUDE.md$' \
        | while IFS= read -r f; do d=$(dirname "$f")
            [ -n "$(git ls-files --cached --others --exclude-standard -- "$d" | grep -v '\.md$' | head -1)" ] \
              || echo "$f"; done
    action: "Report the orphan with its last commit. Never delete: the user decides"

  renamed:
    description: "A directory renamed since its CLAUDE.md was last written"
    command: "git log -M --diff-filter=R --name-status --format= -- <dir> | head -20"
    action: |
      Propose `git mv <old>/CLAUDE.md <new>/CLAUDE.md` when the old path still
      holds one, and fix its path references. Never a deletion.

  dated_state:
    description: "Status prose older than 30 days (scan.md, Phase 1.2)"
    action: |
      FOR each candidate line:
        show it with its section heading
        propose ONE of: refresh the status (the user gives the new state),
        move the history to docs/ (a runbook, an ADR, a CHANGELOG) and leave
        a one-line pointer, or keep as is
    rule: "Never decide a status alone — a deployment state is a fact only the user or the system can confirm"
```

---

## Phase 3.5: Split the oversized CLAUDE.md files

**Trigger:** a CLAUDE.md at CRITICAL or FORBIDDEN (SKILL.md, *Size thresholds*).
The goal is a lower **launch** cost, so the moved text must stop loading at
launch (Claude Code memory docs: subdirectory CLAUDE.md and path-scoped rules
load on demand; `@imports` load with their parent and save nothing).

```yaml
split_workflow:
  1_outline:
    action: "grep -n '^#{1,3} ' <file> — sections with their line spans and bytes"

  2_classify_each_section:
    always_needed: "rules for every task (guardrails, workflow, commit rules) → stays"
    one_subtree:   "concerns one directory → that directory's CLAUDE.md (on demand)"
    file_types:    "concerns a file pattern → .claude/rules/<topic>.md with paths: (on demand)"
    history_state: "dated status, decision logs, runbook steps → docs/ (ADR, runbook), one-line pointer left"
    reference:     "long tables, inventories → a doc the section links to, read when needed"

  3_propose:
    action: "Show the plan: section → destination, bytes moved, launch cost before/after"
    dry_run: "--dry-run prints the plan and stops"
    tool: AskUserQuestion
    options:
      - "Apply the whole split (Recommended)"
      - "Apply section by section"
      - "Skip the split"

  4_apply:
    rules:
      - "MOVE, never delete: every moved section leaves a one-line pointer"
      - "Keep the project's language and wording; no rewrite while moving"
      - "A moved ledger goes to .claude/constraints.md (SKILL.md, Phase 1.5)"
      - "Re-measure: the source file must land at ACCEPTABLE or better"
```

---

## Phase 3.7: Parent and Child Coherence

Run after Phase 3.5, deepest CLAUDE.md first, up to the root. Claude Code
loads a subdirectory's file on demand while every ancestor is already in
context (memory docs), so the two must not say the same thing twice or
contradict each other ("if two instructions contradict each other, Claude may
pick one arbitrarily").

```yaml
parent_child:
  order: "deepest first, then each parent in turn"
  rules:
    pointer: "The nearest ancestor names each child in ONE line: `<dir>/CLAUDE.md: <purpose>`"
    repetition: "A rule a child repeats from an ancestor is replaced by a pointer to that ancestor"
    contradiction: "Reported to the user with both file:line; never resolved alone"
    created_child: "A CLAUDE.md created in Phase 2.0 adds its line to the nearest ancestor in the same change"
    line_in_ancestor: "A `line-in-ancestor` directory of Phase 2.0 gets its one line here, no file"
  tool: "Read (disk, see Phase 1.0) then Edit; proposed through the Phase 5.0 diff"
```

---

## Phase 4.0: Generating Updates

```yaml
update_generation:
  for_each: directory_with_claude_md

  format: |
    # <Directory Name>

    ## Purpose
    <Short description of the directory's role>

    ## Structure
    ```text
    <current tree>
    ```

    ## Key Files
    | File | Description |
    |------|-------------|
    | <file> | <description> |

    ## Conventions
    - <convention 1>
    - <convention 2>

    ## Attention Points
    - <attention point detected in code>

  constraints:
    target_lines: 200  # a generated or rewritten file (Claude Code docs)
    subdirectory_limit: "over 40 000 characters (wc -m), a subdirectory CLAUDE.md is cut: Claude keeps only its start (memory docs, 200K context window; 150 000 on the 1M window of later models)"
    ceiling: "the SKILL.md size table — CRITICAL means condense or split (Phase 3.5)"
    no_implementation_details: true
    no_obsolete_info: true
    maintain_existing_structure: true
```

---

## Phase 5.0: Applying Changes

```yaml
apply_workflow:
  dry_run:
    condition: "--dry-run flag present"
    action: "Display differences without modifying"

  interactive:
    condition: "No --dry-run flag"
    for_each_file:
      action: "Display diff and ask for confirmation"
      tool: AskUserQuestion
      options:
        - "Apply this change"
        - "Skip this file"
        - "Edit manually"
        - "Apply all remaining"

    on_apply:
      action: "Write the updated file"
      tool: Edit or Write
      backup: true

  timestamp_injection:
    action: "Add/update ISO timestamp on first line"
    algorithm: |
      FOR each updated CLAUDE.md:
        timestamp = "<!-- updated: " + now().toISO8601() + "Z -->"
        IF first_line matches '<!-- updated: .* -->':
          replace first_line with timestamp
        ELSE:
          insert timestamp as first line
    format: "<!-- updated: YYYY-MM-DDTHH:MM:SSZ -->"
    purpose: |
      A note for human maintainers. It is inert: nothing compares it to
      anything, and Claude Code strips it from context. Drift is read from
      git (Phase 2.5).

  validation:
    post_apply:
      - "Measure lines, bytes and characters (wc -lcm) against the SKILL.md size table"
      - "Flag FORBIDDEN files (must split, Phase 3.5)"
      - "Verify no obsolete references"
      - "Verify structure section matches reality"
      - "Verify timestamp injected in first line"
```

---

## Phase 7.0: Learn (Extract Conventions)

**Extract non-obvious conventions from code into CLAUDE.md files.**

```yaml
learn_workflow:
  trigger: "Always executed with --update (after all other phases)"
  purpose: "Auto-discover implicit patterns and inject into CLAUDE.md hierarchy"

  1_analyze_patterns:
    action: "Scan codebase for implicit conventions not yet documented"
    tools: [Grep, Glob]
    targets:
      - "Naming conventions (files, functions, variables)"
      - "Error handling patterns (try/catch, Result, early return)"
      - "Import ordering conventions"
      - "File organization patterns (co-location, barrel exports)"
      - "Hidden dependencies (env vars, config files)"
      - "Configuration patterns (defaults, overrides)"

  2_compare_with_documented:
    action: "Read existing CLAUDE.md files and filter already-documented patterns"
    rule: "Only keep patterns with 3+ occurrences AND not already in CLAUDE.md"
    tools: [Read, Grep]  # Read from disk each CLAUDE.md that will be edited (Phase 1.0): the context copy has no HTML comments

  3_scope_learnings:
    rules:
      project_wide: "root CLAUDE.md (cross-cutting concerns)"
      package_scope: "package/CLAUDE.md (package-specific conventions)"
      feature_scope: "feature/CLAUDE.md (feature-specific patterns)"
    principle: "Place learning at the narrowest applicable scope"

  4_inject_learnings:
    action: "Append learnings to appropriate CLAUDE.md under '## Learned Conventions' section"
    constraints:
      - "Max 5 learnings per CLAUDE.md per update"
      - "Each learning = 1-2 lines max"
      - "Respect the SKILL.md size table: a file at WARNING or above gets no injection"
      - "If threshold exceeded → skip injection, warn user"
    format: "- **{pattern_name}**: {description} ({n} occurrences)"
```

---

**Final Output (--update Mode):**

```
═══════════════════════════════════════════════════════════════
  /warmup --update - Documentation Updated
═══════════════════════════════════════════════════════════════

  Files analyzed: <n> source files, <n> CLAUDE.md

  Changes applied:
    OK /src/CLAUDE.md - Updated structure
    OK /src/handlers/CLAUDE.md - Removed obsolete refs
    -- /tests/CLAUDE.md - Skipped (user choice)
    OK /CLAUDE.md - Split: 56 KB → 22 KB at launch (3 sections moved)

  Learned conventions:
    OK <n> patterns discovered, <n> injected

  Validation:
    OK Size thresholds: 0 FORBIDDEN, 0 CRITICAL, 0 WARNING
    OK Structure sections match reality
    OK No broken file references

═══════════════════════════════════════════════════════════════
```

# Update Mode (--update) for CLAUDE.md Refresh

Sizes are judged by the one table in `SKILL.md` (*Size thresholds*): lines,
plus the character check for what loads on demand. Paths below are relative to the repository root
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
      the nearest ancestor that has a CLAUDE.md names it BY ITS PATH relative to
      that ancestor, as a whole word (`roles/vault`, not the substring `vault`
      of `lab-vault-from-zero.sh`, nor `ci` of `ci-1`). A directory that is not
      covered is proposed for creation when it holds more than 5 code files (a
      role counts its tasks/, defaults/, handlers/, templates/, files/, vars/
      and meta/), OR an entry point (main.<ext>, site.yml, playbook*.yml,
      *.nomad.hcl, tasks/main.yml) AND at least 3 code files. An entry point
      with 1 or 2 files is `create(small)`: listed, never proposed by default.
      Everything else gets ONE line in the ancestor (Phase 3.7), never a file.
      Directories without code (only .html, .css, .gohtml, .tpl: static assets,
      templates) are not counted at all; their code parent covers them.
      Hubs: when at least 3 sibling directories would be created and their
      parent has no CLAUDE.md, the parent is listed as `hub`: propose the
      parent first, then its children one line each, instead of N files.
      Siblings that would only get a line are grouped in one row
      (`line-in-ancestor(group)`): one line for the group, not one per folder.
    command: |
      # Prints: <verdict>\t<direct code files>\t<dir>
      git ls-files --cached --others --exclude-standard \
        '*.go' '*.ts' '*.tsx' '*.js' '*.mjs' '*.py' '*.rs' '*.java' '*.sh' \
        '*.tf' '*.hcl' '*.yml' '*.yaml' '*.j2' '*.sql' '*Dockerfile*' '*Makefile' \
        | grep -vE '(^|/)(testdata|vendor|node_modules|__pycache__|\.[^/]+)/' \
        | sed -e 's|/[^/]*$||' -e t -e 's|.*|.|' \
        | sed -E 's#/(tasks|defaults|handlers|templates|files|vars|meta)$##' | sort | uniq -c \
        | while read -r n dir; do
            [ -f "$dir/CLAUDE.md" ] && continue
            anc=$dir; covered=0
            while [ "$anc" != "." ]; do
              anc=$(dirname "$anc")
              if [ -f "$anc/CLAUDE.md" ]; then
                rel=${dir#"$anc"/}; [ "$anc" = "." ] && rel=$dir
                esc=$(printf '%s' "$rel" | sed 's/[][\.*^$/]/\\&/g')
                grep -qE -- "(^|[^A-Za-z0-9_./-])$esc(/|[^A-Za-z0-9_./-]|\$)" "$anc/CLAUDE.md" && covered=1
                break
              fi
            done
            entry=0
            git ls-files --cached --others --exclude-standard -- "$dir" \
              | grep -qE "^$dir/(main\.(go|py|rs|ts|js|mjs|java|sh)|site\.ya?ml|playbook[^/]*\.ya?ml|[^/]*\.nomad\.hcl|tasks/main\.ya?ml)$" && entry=1
            if [ "$covered" = 1 ]; then v=covered
            elif [ "$n" -gt 5 ]; then v=create
            elif [ "$entry" = 1 ] && [ "$n" -ge 3 ]; then v=create
            elif [ "$entry" = 1 ]; then v='create(small)'
            else v=line-in-ancestor; fi
            printf '%s\t%s\t%s\n' "$v" "$n" "$dir"
          done \
        | awk -F'\t' '
            { v[NR]=$1; n[NR]=$2; d[NR]=$3; p=$3; if (!sub(/\/[^\/]*$/,"",p)) p="."
              par[NR]=p
              if ($1 ~ /^create/) cc[p]++
              if ($1 == "line-in-ancestor") lc[p]++ }
            END {
              for (i=1;i<=NR;i++) {
                if (v[i]=="line-in-ancestor" && lc[par[i]]>=3) {
                  if (!(par[i] in done)) { done[par[i]]=1
                    printf "line-in-ancestor(group)\t%d\t%s/{%d dirs}\n", lc[par[i]], par[i], lc[par[i]] }
                  continue }
                print v[i] "\t" n[i] "\t" d[i]
              }
              for (p in cc) if (cc[p]>=3 && p!="." && system("[ -f \"" p "/CLAUDE.md\" ]")!=0)
                printf "hub\t%d\t%s\n", cc[p], p
            }'
    output: |
      create | n | dir                    propose a CLAUDE.md
      create(small) | n | dir             entry point, under 3 files: only on request
      hub | k | parent                    parent of k directories to create: propose it first
      line-in-ancestor | n | dir          one line in the nearest ancestor (Phase 3.7)
      line-in-ancestor(group) | k | dir/  one line for k sibling folders
      covered | n | dir                   nothing to do
    measured: |
      making.codes (read-only run, 2026-10-23, working tree with other
      branches' edits): 26 covered, 19 create, 1 create(small), 3 hub, 15
      line-in-ancestor and 3 groups of siblings, in 2.5 s. The previous form
      matched the basename as a substring and proposed a file for every
      directory holding a lone main.go.

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

    max_lines: 30  # Minimal template, enriched later; a created file starts short
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
of code in its directory, with the number of commits since, the tracked files
modified but not yet committed (`git diff --name-only HEAD`) and the code files
not yet tracked (a directory can drift before its first commit). Code owned by
a deeper CLAUDE.md is excluded, so the root is not charged for the whole
repository.

```bash
# CLAUDE.md older than the code it covers, or with code changed since.
# Prints: <commits since>\t<modified, uncommitted>\t<untracked code files>\t<CLAUDE.md>
CODE=(':(exclude)*.md' ':(exclude)*/testdata/*' ':(exclude)*/vendor/*' ':(exclude)*/node_modules/*')
ALL=$(git ls-files --cached --others --exclude-standard '*CLAUDE.md' | grep -E '(^|/)CLAUDE.md$')
printf '%s\n' "$ALL" | while IFS= read -r f; do
  d=$(dirname "$f")
  # code owned by a deeper CLAUDE.md does not count against this one
  EXCL=()
  while IFS= read -r g; do
    gd=$(dirname "$g")
    [ "$gd" != "$d" ] || continue
    case "$d" in .) EXCL+=(":(exclude)$gd") ;; *) case "$gd" in "$d"/*) EXCL+=(":(exclude)$gd") ;; esac ;; esac
  done <<< "$ALL"
  doc=$(git log -1 --format=%ct -- "$f"); [ -n "$doc" ] || doc=0   # never committed: everything is newer
  code=$(git log -1 --format=%ct -- "$d" "${CODE[@]}" "${EXCL[@]}")
  n=0; [ -n "$code" ] && [ "$code" -gt "$doc" ] && n=$(git rev-list --count --since="@$doc" HEAD -- "$d" "${CODE[@]}" "${EXCL[@]}")
  m=$(git diff --name-only HEAD -- "$d" "${CODE[@]}" "${EXCL[@]}" | wc -l | tr -d ' ')
  u=$(git ls-files --others --exclude-standard -- "$d" "${CODE[@]}" "${EXCL[@]}" | wc -l | tr -d ' ')
  [ "$n" -gt 0 ] || [ "$m" -gt 0 ] || [ "$u" -gt 0 ] || continue
  printf '%s\t%s\t%s\t%s\n' "$n" "$m" "$u" "$f"
done | sort -rn
```

Report `commits | modified | untracked | file`, worst first. Drift is a candidate for
Phase 3.0, never a verdict: a refactor may leave a CLAUDE.md exactly right.

---

## Phase 3.0: Obsolescence Detection

```yaml
obsolete_detection:
  file_references:
    description: "Files mentioned in CLAUDE.md but deleted"
    command: |
      # Broken file references of one CLAUDE.md, by suffix match on the tracked files.
      # Usage: refs.sh <path/to/CLAUDE.md>   Prints the references that match no file.
      f=$1; d=$(dirname "$f")
      LIST=$(mktemp); git ls-files --cached --others --exclude-standard > "$LIST"
      grep -oE '`[A-Za-z0-9_./-]+(\.(sh|md|go|ts|tsx|js|mjs|py|rs|tf|hcl|yml|yaml|j2|json|toml|sql|html|css|env|txt|conf|cfg|service|timer|mod|sum)|/)`' "$f" \
        | tr -d '`' | sort -u | while IFS= read -r t; do
            case "$t" in /*|~*|*://*) continue ;; esac
            p=${t%/}
            [ -e "$d/$p" ] || [ -e "$p" ] && continue
            esc=$(printf '%s' "$p" | sed 's/[][\.*^$/]/\\&/g')
            grep -qE "(^|/)$esc(/|\$)" "$LIST" || echo "$t"
          done
      rm -f "$LIST"
    action: |
      FOR each CLAUDE.md, run the command above. A reference resolves when it
      exists from the CLAUDE.md's directory, from the root, or as a path SUFFIX
      of a tracked or untracked file (docs often write `x.sh` for `scripts/x.sh`).
      What remains is a CANDIDATE, never a verdict: runtime files (STATUS.txt),
      ignored local files (terraform.tfvars) and paths cited as removed show up.
    measured: "making.codes root CLAUDE.md at HEAD: 65 'broken' with plain existence, 15 with suffix resolution"

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
    command: |
      # Renames since this CLAUDE.md was last written, whose old name it still cites.
      f=<dir>/CLAUDE.md; d=$(dirname "$f"); [ "$d" = . ] && pre="" || pre="$d/"
      base=$(git log -1 --format=%H -- "$f")
      [ -n "$base" ] && git diff -M --name-status --diff-filter=R "$base" HEAD \
        | awk -F'\t' -v p="$pre" 'index($2,p)==1 || index($3,p)==1 {print $2 "\t" $3}' \
        | while IFS=$'\t' read -r old new; do
            rel=${old#"$pre"}
            grep -qF -- "$rel" "$f" && printf '%s -> %s\n' "$old" "$new"
          done | head -20
    note: |
      Bounded to `<commit of the CLAUDE.md>..HEAD`, filtered on the directory,
      then only the old names the file still cites: the unbounded
      `git log -M --diff-filter=R` listed the whole history.
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
    action: |
      Sections with their start line and bytes, ignoring `#` lines inside fenced
      code blocks (a shell comment is not a heading):
        awk '/^[ \t]*(```|~~~)/ { fence = !fence }
             !fence && /^#(#?#?) / { if (h) printf "%d\t%d\t%s\n", start, bytes, h
                                     h = $0; start = NR; bytes = 0 }
             { bytes += length($0) + 1 }
             END { if (h) printf "%d\t%d\t%s\n", start, bytes, h }' <file>

  2_classify_each_section:
    always_needed: "rules for every task (guardrails, workflow, commit rules) → stays"
    one_subtree:   "concerns one directory → that directory's CLAUDE.md (on demand)"
    file_types:    "concerns a file pattern → .claude/rules/<topic>.md with paths: (on demand); run `git check-ignore -q .claude/rules/<topic>.md` first: when the path is gitignored the rule would never be committed, so propose docs/ or a subdirectory CLAUDE.md instead"
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
      - "Re-measure: the source file must land at ACCEPTABLE or better (500 lines is the target, not a rewrite budget: moving never shortens text)"
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
    repetition: |
      A rule a child repeats from an ancestor in IDENTICAL or WEAKER words is
      replaced by a pointer to that ancestor. A child that is MORE detailed than
      its parent keeps its text (the detail is why the child exists); the
      parent is then the one to point down, or to be left alone.
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
    new_file: "a created file starts from the short template (Phase 2.0), no line target"
    advice: "the docs advise under 200 lines for adherence; quote it, do not enforce it. A file warmup moves or keeps is bounded by the SKILL.md table only"
    subdirectory_limit: "over 40 000 characters (wc -m), a subdirectory CLAUDE.md is cut on a 200K window; over 150 000 everywhere (memory docs)"
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
      backup: |
        Before the first write to a file, copy it:
          mkdir -p "$SCRATCH/warmup-backup" && cp -p "$f" "$SCRATCH/warmup-backup/$(printf '%s' "$f" | tr / _).bak"
        $SCRATCH is the session scratchpad directory (else ${TMPDIR:-/tmp}).
        Print the backup directory in the final output. Nothing is written
        into the repository, and the backup is never committed.

  timestamp_injection:
    action: "Add/update the timestamp on first line, in the file's own format"
    algorithm: |
      FOR each updated CLAUDE.md:
        IF first_line matches '<!-- updated: YYYY-MM-DD -->' (date only):
          replace it with today's date, same shape
        ELSE IF first_line matches '<!-- updated: .* -->' (with time):
          replace it with the ISO 8601 UTC time
        ELSE:
          insert the ISO 8601 UTC time as first line
    format: "<!-- updated: YYYY-MM-DD --> or <!-- updated: YYYY-MM-DDTHH:MM:SSZ -->, whichever the file already uses"
    purpose: |
      A note for human maintainers. It is inert: nothing compares it to
      anything, and Claude Code strips it from context. Drift is read from
      git (Phase 2.5).

  validation:
    post_apply:
      - "Measure lines (wc -l), bytes (wc -c) and characters (wc -m) separately (macOS wc cannot combine -c and -m) against the SKILL.md size table"
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

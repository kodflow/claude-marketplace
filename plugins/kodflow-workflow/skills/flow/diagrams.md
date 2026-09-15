# Diagrams

Pre-rendered views. Print the block for the requested view **verbatim** — every
arrow here was checked against the skill that claims it, and redrawing loses that.

Each section exists twice: `[unicode]` for the terminal, `[7bit]` for a README,
a CI log or a commit body. `--ascii` selects the second.

Legend. Print the matching two lines under any view:

```text
  unicode   ▼ ──▶ hands over    ◆ a gate that can refuse    ( a loop back
            ◀── who calls it    — reads only, writes nothing

  7bit      v --> hands over    <> a gate that can refuse   ( a loop back
            <-- who calls it    -- reads only, writes nothing
```

---

## MAP

The whole thing. Default view.

### MAP [unicode]

```text
╔════════════════════════════════════════════════════════════════════════════════╗
║  kodflow — the work loop        20 skills · 4 plugins · 29 agents · 5 hooks     ║
╚════════════════════════════════════════════════════════════════════════════════╝

  THE SPINE                         LEAVES BEHIND                    THEN TYPE
  ────────────────────────────────  ───────────────────────────────  ─────────────

  /project [name]                   CLAUDE.md → ## Constraints       (auto) /warmup
  │ adopt · clone · create · STOP    C-NNN: a rule and its verifier
  │ the conversation becomes         .claude/{contexts,plans,goals}/
  │ numbered, checkable rules
  ▼
  /warmup [--update]                — reads only —                   /search
  │ the CLAUDE.md funnel, root       --update rewrites every
  │ to leaf, plus the ledger         CLAUDE.md it touched
  ▼
  /search <topic>                   .claude/contexts/<slug>.md       /plan
  │ the local base first; the web    ~/.claude/docs/ + INDEX.json
  │ for anything a version moved     restamped, so it stops rotting
  ▼
  /plan <what> [--goal]             .claude/plans/<slug>.md          /challenge
  │ explore → decompose → design                                     or /refine
  ◆ ends at ExitPlanMode. You approve. Nothing is built yet.
  │
  ├──────────────────────────┬─────────────────────────────────────────────────────
  ▼                          ▼
  /challenge [slug]          /refine [slug]
  │ three contradictory      │ plan + context → a contract
  │ lenses, plus every       │ whose criteria are binary and
  │ specialist the plan      │ paired 1:1 with a verifier
  │ actually touches         │
  │ ≤ 3 rounds               │  both write:  .claude/goals/<slug>.md
  ( rewrites the plan        │               ≤ 4000 chars · gitignored
  ( between rounds ─▶ /plan  │
  └────────────┬─────────────┘
               ▼
       ╭────────────────────────────────────────────────────╮
       │  /goal    not a skill — the executor.              │
       │           4000 characters, a hard runtime ceiling. │
       ╰────────────────────────────────────────────────────╯
               │
               ▼
  /review [PR | MR | --local]       .claude/plans/review-fixes-<ts>.md
  │ macro on every file, micro      .claude/review-manifest-<ts>.json
  │ on every changed hunk           ──▶ /refine ──▶ /goal   (the cycle)
  ◆ an external, non-LLM verifier recomputes the manifest from git
  ◆ and VOIDS the whole run on a mismatch. That is the anti-fake-pass.
  ▼
  /git --commit ─▶ --watch ─▶ --merge      a commit · a PR/MR · a merge
  ◆ --watch never merges on its own.
  ( --merge ─▶ --watch is the only automatic edge, and it points backwards.
  └──▶ /warmup --update · /review · /adr


  OPENING WORK — either of these starts the trail and cuts the branch
  ──────────────────────────────────────────────────────────────────────────────
  /feature <what>    .claude/issues/<slug>.md · an issue · a branch
                     ──▶ /search  /challenge  /goal  /git
  /fix <defect>      the same ledger, kind: fix
                     ──▶ /debug  /challenge  /git
  ◆ /fix refuses a defect with no reproduction: observed, expected, and the steps.
  ◆ a specialist verdict of "documented behaviour" ends the run and sends you
    to /feature having created nothing.
  ( re-run either on the same subject and it appends a comment. The first
  ( understanding is never rewritten — that is what makes the trail worth keeping.


  WHEN SOMETHING IS WRONG
  ──────────────────────────────────────────────────────────────────────────────
  /debug <symptom>   ◀── /fix        ──▶ /plan  /adr
  ◆ no fix is permitted until cause → mechanism → symptom is cited at file:line
  ( the proof gate returns the run to isolation rather than waving it through
  /review --loop     converges on correctness, not on tone
  /lint              `make lint` if the Makefile has it, else the toolchain, to zero
  /comment [path]    one worker per file, in parallel — WHY, never WHAT


  WHAT OUTLIVES THE SESSION
  ──────────────────────────────────────────────────────────────────────────────
  /adr <decision>    docs/adr/NNNN-*.md   ◀── /plan  /git  /debug
                     a leaf: three arrows in, none out
  /learn             ~/.claude/docs/learned/
  ◆ nothing is written without your yes


  THE MACHINE ITSELF
  ──────────────────────────────────────────────────────────────────────────────
  /audit    seven dimensions scored, every file at fault named  ──▶ /search --refresh
  /update   re-sync the devcontainer from the upstream template
  /ktn      five agents in ONE wave, heal the project-linter stack
  /infra    --plan ──tfplan──▶ --apply
  ◆ --apply refuses to run without the tfplan that --plan wrote
```

### MAP [7bit]

```text
+==============================================================================+
|  kodflow -- the work loop   20 skills . 4 plugins . 29 agents . 5 hooks     |
+==============================================================================+

  THE SPINE                        LEAVES BEHIND                   THEN TYPE
  -------------------------------  ------------------------------  ------------

  /project [name]                  CLAUDE.md -> ## Constraints     (auto)
  | adopt . clone . create . STOP   C-NNN: a rule and its verifier  /warmup
  | the conversation becomes        .claude/{contexts,plans,goals}/
  | numbered, checkable rules
  v
  /warmup [--update]               -- reads only --                /search
  | the CLAUDE.md funnel, root      --update rewrites every
  | to leaf, plus the ledger        CLAUDE.md it touched
  v
  /search <topic>                  .claude/contexts/<slug>.md      /plan
  | the local base first; the web   ~/.claude/docs/ + INDEX.json
  | for anything a version moved    restamped, so it stops rotting
  v
  /plan <what> [--goal]            .claude/plans/<slug>.md         /challenge
  | explore -> decompose -> design                                  or /refine
  <> ends at ExitPlanMode. You approve. Nothing is built yet.
  |
  +-------------------------+---------------------------------------------------
  v                         v
  /challenge [slug]         /refine [slug]
  | three contradictory     | plan + context -> a contract
  | lenses, plus every      | whose criteria are binary and
  | specialist the plan     | paired 1:1 with a verifier
  | actually touches        |
  | <= 3 rounds             |  both write: .claude/goals/<slug>.md
  ( rewrites the plan       |              <= 4000 chars . gitignored
  ( between rounds -> /plan |
  +-----------+-------------+
              v
      +--------------------------------------------------+
      |  /goal   not a skill -- the executor.            |
      |          4000 characters, a hard runtime ceiling.|
      +--------------------------------------------------+
              |
              v
  /review [PR | MR | --local]      .claude/plans/review-fixes-<ts>.md
  | macro on every file, micro     .claude/review-manifest-<ts>.json
  | on every changed hunk          --> /refine --> /goal   (the cycle)
  <> an external, non-LLM verifier recomputes the manifest from git
  <> and VOIDS the whole run on a mismatch. That is the anti-fake-pass.
  v
  /git --commit -> --watch -> --merge     a commit . a PR/MR . a merge
  <> --watch never merges on its own.
  ( --merge -> --watch is the only automatic edge, and it points backwards.
  +--> /warmup --update . /review . /adr


  OPENING WORK -- either of these starts the trail and cuts the branch
  ------------------------------------------------------------------------------
  /feature <what>   .claude/issues/<slug>.md . an issue . a branch
                    --> /search  /challenge  /goal  /git
  /fix <defect>     the same ledger, kind: fix
                    --> /debug  /challenge  /git
  <> /fix refuses a defect with no reproduction: observed, expected, the steps.
  <> a specialist verdict of "documented behaviour" ends the run and sends you
     to /feature having created nothing.
  ( re-run either on the same subject and it appends a comment. The first
  ( understanding is never rewritten -- that is what makes the trail worth it.


  WHEN SOMETHING IS WRONG
  ------------------------------------------------------------------------------
  /debug <symptom>  <-- /fix        --> /plan  /adr
  <> no fix is permitted until cause -> mechanism -> symptom is cited file:line
  ( the proof gate returns the run to isolation rather than waving it through
  /review --loop    converges on correctness, not on tone
  /lint             `make lint` if the Makefile has it, else the toolchain
  /comment [path]   one worker per file, in parallel -- WHY, never WHAT


  WHAT OUTLIVES THE SESSION
  ------------------------------------------------------------------------------
  /adr <decision>   docs/adr/NNNN-*.md   <-- /plan  /git  /debug
                    a leaf: three arrows in, none out
  /learn            ~/.claude/docs/learned/
  <> nothing is written without your yes


  THE MACHINE ITSELF
  ------------------------------------------------------------------------------
  /audit   seven dimensions scored, every file at fault named
           --> /search --refresh
  /update  re-sync the devcontainer from the upstream template
  /ktn     five agents in ONE wave, heal the project-linter stack
  /infra   --plan --tfplan--> --apply
  <> --apply refuses to run without the tfplan that --plan wrote
```

---

## PATH

The nominal route, nothing else. For someone who wants the order and no detail.

### PATH [unicode]

```text
  an idea
     │
     ▼
  /project ─▶ /warmup ─▶ /search ─▶ /plan ─▶ /refine ─▶ /goal ─▶ /review ─▶ /git
                                                                             │
                                                                             ▼
                                                                          merged

  what each one leaves behind
  ─────────────────────────────────────────────────────────────────────────────
     /project    CLAUDE.md, and the C-NNN ledger inside it
     /warmup     nothing — it reads
     /search     .claude/contexts/<slug>.md
     /plan       .claude/plans/<slug>.md
     /refine     .claude/goals/<slug>.md
     /goal       the work itself
     /review     .claude/plans/review-fixes-<ts>.md  ──▶ back to /refine
     /git        a commit, a PR or MR, a merge

  open the work first when it is a real change
  ─────────────────────────────────────────────────────────────────────────────
     /feature <what>   or   /fix <defect>
        ──▶ an issue, a ledger entry under .claude/issues/, and a branch

  shorter routes that are still the workflow
  ─────────────────────────────────────────────────────────────────────────────
     /plan --goal          plan ──▶ /review gate ──▶ /refine ──▶ suggests /goal
     /plan --goal --fast   plan ──▶ /refine     (skips the gate; trivial plans)
     /refine "<blurb>"     no plan at all — BARE mode structures the sentence
     /challenge <slug>     argue the plan first, then straight to /goal
```

### PATH [7bit]

```text
  an idea
     |
     v
  /project -> /warmup -> /search -> /plan -> /refine -> /goal -> /review -> /git
                                                                             |
                                                                             v
                                                                          merged

  what each one leaves behind
  -----------------------------------------------------------------------------
     /project   CLAUDE.md, and the C-NNN ledger inside it
     /warmup    nothing -- it reads
     /search    .claude/contexts/<slug>.md
     /plan      .claude/plans/<slug>.md
     /refine    .claude/goals/<slug>.md
     /goal      the work itself
     /review    .claude/plans/review-fixes-<ts>.md  --> back to /refine
     /git       a commit, a PR or MR, a merge

  open the work first when it is a real change
  -----------------------------------------------------------------------------
     /feature <what>   or   /fix <defect>
        --> an issue, a ledger entry under .claude/issues/, and a branch

  shorter routes that are still the workflow
  -----------------------------------------------------------------------------
     /plan --goal         plan -> /review gate -> /refine -> suggests /goal
     /plan --goal --fast  plan -> /refine     (skips the gate; trivial plans)
     /refine "<blurb>"    no plan at all -- BARE mode structures the sentence
     /challenge <slug>    argue the plan first, then straight to /goal
```

---

## ARTIFACTS

Who writes each file and who reads it back. This is the real coupling: the
skills barely call each other, they hand each other files.

### ARTIFACTS [unicode]

```text
  WRITER           FILE                                  READ BACK BY
  ──────────────── ───────────────────────────────────── ────────────────────────────

  /project         CLAUDE.md  ## Constraints             /warmup  /plan  /refine
  /warmup --update   C-NNN — a rule + its verifier       /challenge  /review
                     append-only: a changed rule         — a finding cites the ID
                     gets a new ID, the old one
                     is marked superseded

  /search          .claude/contexts/<slug>.md            /plan
                     ~/.claude/docs/ + INDEX.json        /refine  (FULL mode)
                     verified: date + category TTL       every specialist
                     fresh:   citable
                     stale:   confirm first
                     expired: not evidence

  /plan            .claude/plans/<slug>.md               /challenge  /refine
                     .claude/contexts/<slug>.md            /review  /goal

  /review          .claude/plans/review-fixes-<ts>.md    /refine ──▶ /goal
                     .claude/review-manifest-<ts>.json   an external non-LLM
                     edits the plan in place, keeping    verifier — it can VOID it
                     a backup under .history/

  /refine          .claude/goals/<slug>.md               /goal
  /challenge         <= 4000 chars, gitignored
                     frontmatter joins the slug,
                     the plan and the context

  /feature         .claude/issues/<slug>.md              a re-run of /feature or /fix
  /fix               committed, append-only
                     the join between a branch, an
                     issue, and the conversation

  /adr             docs/adr/NNNN-kebab-title.md          /git — before a PR whose
                     docs/adr/README.md (the index)      diff changes architecture
                                                         /plan — suggests one

  the hooks        .claude/logs/<branch>/                /learn
                        session.jsonl                    you
                     one sanitized line per event
                     .claude/logs/
                        security-events.jsonl

  ──────────────────────────────────────────────────────────────────────────────
  ! one contradiction, as shipped: /search calls itself the sole writer of
    .claude/contexts/, and /plan Phase 5.0 writes there too.
```

### ARTIFACTS [7bit]

```text
  WRITER           FILE                                 READ BACK BY
  ---------------- ------------------------------------ ------------------------

  /project         CLAUDE.md  ## Constraints            /warmup  /plan  /refine
  /warmup --update   C-NNN - a rule + its verifier      /challenge  /review
                     append-only: a changed rule        - a finding cites the ID
                     gets a new ID, the old one
                     is marked superseded

  /search          .claude/contexts/<slug>.md           /plan
                     ~/.claude/docs/ + INDEX.json       /refine  (FULL mode)
                     verified: date + category TTL      every specialist
                     fresh:   citable
                     stale:   confirm first
                     expired: not evidence

  /plan            .claude/plans/<slug>.md              /challenge  /refine
                     .claude/contexts/<slug>.md           /review  /goal

  /review          .claude/plans/review-fixes-<ts>.md   /refine -> /goal
                     .claude/review-manifest-<ts>.json  an external non-LLM
                     edits the plan in place, keeping   verifier can VOID it
                     a backup under .history/

  /refine          .claude/goals/<slug>.md              /goal
  /challenge         <= 4000 chars, gitignored
                     frontmatter joins the slug,
                     the plan and the context

  /feature         .claude/issues/<slug>.md             a re-run of either
  /fix               committed, append-only
                     the join between a branch, an
                     issue, and the conversation

  /adr             docs/adr/NNNN-kebab-title.md         /git - before a PR whose
                     docs/adr/README.md (the index)     diff changes the design
                                                        /plan - suggests one

  the hooks        .claude/logs/<branch>/               /learn
                        session.jsonl                   you
                     one sanitized line per event
                     .claude/logs/
                        security-events.jsonl

  --------------------------------------------------------------------------
  (!) one contradiction, as shipped: /search calls itself the sole writer
      of .claude/contexts/, and /plan Phase 5.0 writes there too.
```

---

## HOOKS

Five scripts on fifteen events. They run whether or not a skill is running, and
they are the only part of the system that can say no to you.

### HOOKS [unicode]

```text
  your turn ──────────────────────────────────────────────────────────────────
                                                                       script
  UserPromptSubmit ─▶ injects the branch, the newest plan, the         on-user
                      newest goal, and resets the Stop counter

  SessionStart ─────▶ after a compaction, re-injects the standing      on-session
                      rules; warns when rtk is missing or too old

   ┌─ every Bash · Write · Edit · MultiEdit · NotebookEdit ──────────────────┐
   │                                                                        │
   │  PreToolUse    gate ──▶ BLOCK ──▶ transform ──▶ observe      on-tool    │
   │                          ▲            │                                │
   │                          │            └─ a forced push becomes         │
   │                          │               a lease-checked one           │
   │                  ┌───────┴────────────────────────────────┐            │
   │                  │  the six refusals, all in on-tool.sh:  │            │
   │                  │  1  skipping the local git hooks       │            │
   │                  │  2  a silenced commit flag cluster     │            │
   │                  │  3  AI attribution in a commit message │            │
   │                  │  4  a credential shape in a staged blob│            │
   │                  │  5  a forced push inside a compound    │            │
   │                  │  6  a write to a protected path        │            │
   │                  └────────────────────────────────────────┘            │
   │                                                                        │
   │  PostToolUse   formats the file, then tells the session to             │
   │                read it again before the next edit                      │
   │  PostToolUseFailure  seven remediation hints keyed off the error       │
   └────────────────────────────────────────────────────────────────────────┘

  SubagentStart ────▶ every subagent inherits the four standing rules  on-agent

  Stop ─────────────▶ the turn-end quality gate:                       on-stop
                      · relays the project-linter verdict verbatim
                      · lints this session's packages
                      · nudges the CLAUDE.md of each changed directory,
                        once per directory per session
                      ◆ a deny comes from the linter daemon on :7717,
                        never from the hook's own judgement

  SessionEnd · PreCompact · ConfigChange · Notification · TaskCreated
  TaskCompleted · TeammateIdle · SubagentStop ──▶ observe only

  ◆ Nothing at session level may stop the session. Even a permissions change
    is written to .claude/logs/security-events.jsonl rather than refused.
  ◆ Every non-blocking path exits 0, and a missing jq or empty input fails
    OPEN — an accidental failure must not block every shell call of a session.
  ◆ These guards are why this very diagram had to be written to a file rather
    than typed on a shell line: naming refusal 1 beside the word commit is
    itself a guarded line.
```

### HOOKS [7bit]

```text
  your turn ------------------------------------------------------------------
                                                                      script
  UserPromptSubmit -> injects the branch, the newest plan, the        on-user
                      newest goal, and resets the Stop counter

  SessionStart -----> after a compaction, re-injects the standing     on-session
                      rules; warns when rtk is missing or too old

   +- every Bash . Write . Edit . MultiEdit . NotebookEdit -----------------+
   |                                                                       |
   |  PreToolUse    gate --> BLOCK --> transform --> observe     on-tool    |
   |                          ^            |                               |
   |                          |            +- a forced push becomes        |
   |                          |               a lease-checked one          |
   |                  +-------+--------------------------------+           |
   |                  |  the six refusals, all in on-tool.sh:  |           |
   |                  |  1  skipping the local git hooks       |           |
   |                  |  2  a silenced commit flag cluster     |           |
   |                  |  3  AI attribution in a commit message |           |
   |                  |  4  a credential shape in a staged blob|           |
   |                  |  5  a forced push inside a compound    |           |
   |                  |  6  a write to a protected path        |           |
   |                  +----------------------------------------+           |
   |                                                                       |
   |  PostToolUse   formats the file, then tells the session to            |
   |                read it again before the next edit                     |
   |  PostToolUseFailure  seven remediation hints keyed off the error      |
   +-----------------------------------------------------------------------+

  SubagentStart ----> every subagent inherits the four standing rules on-agent

  Stop -------------> the turn-end quality gate:                      on-stop
                      . relays the project-linter verdict verbatim
                      . lints this session's packages
                      . nudges the CLAUDE.md of each changed directory,
                        once per directory per session
                      <> a deny comes from the linter daemon on :7717,
                         never from the hook's own judgement

  SessionEnd . PreCompact . ConfigChange . Notification . TaskCreated
  TaskCompleted . TeammateIdle . SubagentStop --> observe only

  <> Nothing at session level may stop the session. Even a permissions change
     is written to .claude/logs/security-events.jsonl rather than refused.
  <> Every non-blocking path exits 0, and a missing jq or empty input fails
     OPEN -- an accidental failure must not block every shell call.
  <> These guards are why this very diagram had to be written to a file
     rather than typed on a shell line: naming refusal 1 beside the word
     commit is itself a guarded line.
```

---

## AGENTS

Twenty-nine specialists, three levels deep at most. A skill never picks a leaf
itself: it routes on evidence through the shared table, and every match is
dispatched in one message.

### AGENTS [unicode]

```text
  WHICH SKILL SENDS WORK DOWN HERE
  ─────────────────────────────────────────────────────────────────────────────
  /review      the five executors, always · a language specialist per extension
  /refine      ten lenses, mapped onto executors and orchestrators
  /challenge   three fixed lenses + every specialist the plan's evidence matches
  /feature  /fix   every specialist the technology matches — mandatory
  /plan        developer-orchestrator as lead, four explorers
  /comment     developer-commentator ──▶ one worker per file, in parallel
  /infra       devops-orchestrator ──▶ infrastructure + security, always
  /ktn         devops-executor-linux ×5, in ONE wave

  DEVELOPER
  ─────────────────────────────────────────────────────────────────────────────
  developer-orchestrator (opus)
      ├─▶ developer-specialist-review ── the real fan-out hub
      │       ├─▶ executor-correctness   invariants, races, off-by-one
      │       ├─▶ executor-security      taint source ─▶ sink, OWASP, secrets
      │       ├─▶ executor-quality       complexity, smells, maintainability
      │       ├─▶ executor-design        antipatterns, DDD, SOLID   (if arch)
      │       ├─▶ executor-shell         shell, Dockerfile, CI      (if shell)
      │       └─▶ by extension:  .go→go   .py→python   .ts/.js→nodejs
      │                          React→react   .rs→rust   .c→c   .zig→zig
      │                          .sql→data-specialist-postgres
      │                          .github/*.yml→tooling-specialist-github-actions
      ├─▶ developer-executor-security
      └─▶ developer-executor-quality
  ◆ never dispatch to an agent that is not in that table.

  developer-commentator (opus) ──▶ developer-commentator-worker ×N, background

  DEVOPS
  ─────────────────────────────────────────────────────────────────────────────
  devops-orchestrator (opus)
      ├─▶ devops-specialist-{infrastructure · security · docker
      │                      kubernetes · hashicorp}
      ├─▶ devops-executor-linux ──▶ reads /etc/os-release ──▶
      │       os-specialist-{debian · ubuntu · alpine}, else handles it itself
      └─▶ tooling-specialist-github-actions

  ◆ Every specialist verifies an API, a default, a limit or a deprecation
    against documentation before asserting it, and returns what it consulted.
    An empty consulted list marks the claim as recall, not as evidence.
```

### AGENTS [7bit]

```text
  WHICH SKILL SENDS WORK DOWN HERE
  ------------------------------------------------------------------------------
  /review     the five executors, always . a language specialist per extension
  /refine     ten lenses, mapped onto executors and orchestrators
  /challenge  three fixed lenses + every specialist the plan's evidence matches
  /feature /fix   every specialist the technology matches -- mandatory
  /plan       developer-orchestrator as lead, four explorers
  /comment    developer-commentator --> one worker per file, in parallel
  /infra      devops-orchestrator --> infrastructure + security, always
  /ktn        devops-executor-linux x5, in ONE wave

  DEVELOPER
  ------------------------------------------------------------------------------
  developer-orchestrator (opus)
      +-> developer-specialist-review -- the real fan-out hub
      |       +-> executor-correctness  invariants, races, off-by-one
      |       +-> executor-security     taint source -> sink, OWASP, secrets
      |       +-> executor-quality      complexity, smells, maintainability
      |       +-> executor-design       antipatterns, DDD, SOLID   (if arch)
      |       +-> executor-shell        shell, Dockerfile, CI      (if shell)
      |       +-> by extension: .go->go  .py->python  .ts/.js->nodejs
      |                         React->react  .rs->rust  .c->c  .zig->zig
      |                         .sql->data-specialist-postgres
      |                         .github/*.yml->tooling-specialist-github-actions
      +-> developer-executor-security
      +-> developer-executor-quality
  <> never dispatch to an agent that is not in that table.

  developer-commentator (opus) --> developer-commentator-worker xN, background

  DEVOPS
  ------------------------------------------------------------------------------
  devops-orchestrator (opus)
      +-> devops-specialist-{infrastructure . security . docker
      |                      kubernetes . hashicorp}
      +-> devops-executor-linux --> reads /etc/os-release -->
      |       os-specialist-{debian . ubuntu . alpine}, else handles it itself
      +-> tooling-specialist-github-actions

  <> Every specialist verifies an API, a default, a limit or a deprecation
     against documentation before asserting it, and returns what it consulted.
     An empty consulted list marks the claim as recall, not as evidence.
```

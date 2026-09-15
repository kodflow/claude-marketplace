# kodflow Claude marketplace

An opinionated agent configuration for **Claude Code** and **Codex**, installed
from one place instead of copied by hand.

```bash
git clone https://github.com/kodflow/claude-marketplace
cd claude-marketplace && ./scripts/install.sh
```

`--check` reports what it would do and writes nothing. Re-running is safe.

## What is in it

| Plugin | Skills |
|--------|--------|
| `kodflow-workflow` | `/project` `/warmup` `/search` `/plan` `/challenge` `/refine` `/git` `/feature` `/fix` `/flow` |
| `kodflow-review` | `/review` `/debug` `/adr` `/learn` `/lint` |
| `kodflow-devops` | `/infra` `/audit` `/update` `/ktn` |
| `kodflow-shell` | `/shell` — and `super-claude` on your PATH |
| `kodflow-specialists` | 29 language, platform and concern agents |

## The three ideas worth the install

**Work leaves a trail.** `/feature` and `/fix` record what you are doing where
the project already tracks work — a note store when the session has one, a
GitLab or GitHub issue otherwise — and cut a branch named after it. Running
either again on the same subject appends a comment and **never rewrites the
original**: the record of the first understanding is what makes the trail worth
keeping.

**Claims are checked, not recalled.** Every specialist verifies an API, a
default, a limit or a deprecation against documentation before asserting it, and
returns what it consulted and what it could not confirm. A claim with an empty
`consulted` list is marked as recall, not accepted as evidence. The local
pattern library carries a `verified` date and a category TTL, so a stale entry
is a hypothesis rather than a source.

**Plans are argued before they are built.** `/challenge` puts a plan through
contradictory lenses plus every specialist whose technology it touches, asks you
the moment it hits something it cannot settle, and emits a directive that a
script validates — length, an unticked task list, a runnable check per
acceptance criterion, no vague verbs, no placeholders. A directive that would
let a run report success at 60% does not ship.

## Pinning a version for a project or a team

`install.sh` follows the tip of `main`, which is right on your own machine and
wrong for a team: a plugin update lands the moment someone opens the project,
possibly mid-sprint. A repository can register the marketplace at a fixed git
ref in its own `.claude/settings.json` — a tag, a branch or a commit sha —
so everyone working on it runs the same revision until that file changes:

```json
{
  "extraKnownMarketplaces": {
    "kodflow": {
      "source": {
        "source": "git",
        "url": "https://github.com/kodflow/claude-marketplace.git",
        "ref": "4eeb32f3b9cacea4696faf549fb4a80b6760eedd"
      }
    }
  },
  "enabledPlugins": {
    "kodflow-workflow@kodflow": true,
    "kodflow-review@kodflow": true
  }
}
```

Pin when a change to the skills would be a change to the work — a release
branch, a shared CI image, an audit whose findings have to be reproducible —
and leave it unpinned everywhere else, where getting the fix the day it lands
is the reason to install from a marketplace at all.

## Both CLIs, one source

`codex/` is **generated** from `plugins/` by `scripts/build-codex.py`, not
maintained in parallel. The skill container is close on both CLIs; the agent
format is not — Codex custom agents are TOML with `developer_instructions`. Tool
names that exist on one side only are rewritten rather than dropped, because an
agent told to use a tool that is not there simply fails.

Re-run the generator after changing anything under `plugins/`; CI checks the
result parses and that no private detail survived.

## The repository is public, and CI enforces it

`scripts/sanitize.py` fails the build on a credential shape — tokens, keys,
credentials in a URL — while distinguishing a real one from a placeholder or a
detection pattern, so a security skill can ship the regexes it needs. CI also
refuses machine paths and internal hostnames, validates every skill and agent
against the documented frontmatter schema, checks that module links resolve, and
parses every shell script.

`mcp/mcp.example.json` references credentials as `${VAR}` and contains none. The
installer seeds it **only when no config exists** — it never overwrites a file
holding a working token.

## Licence

MIT.

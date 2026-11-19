# Install and roll back Kodflow

`scripts/install.sh` detects the marketplace commands on the installed Codex
CLI. On supported clients it registers the checkout, installs the enabled
user-scoped packages, and copies the generated custom roles into
`${CODEX_HOME:-$HOME/.codex}/agents`. Older clients use the flat skills and
agents shipped in `codex/`. Pass `--legacy` to choose that path explicitly,
`--check` to print actions, or `--codex` / `--claude` to select one client.

Claude uses the upstream Git marketplace by default. Pass `--checkout` to
register the current checkout for Claude too. Existing Claude MCP
configuration is preserved. GameDev remains a project-scoped choice.

## Canary at a specific commit

Use a fresh Claude configuration directory and a fresh Codex home so the
result can be attributed to one exact commit.

```sh
git clone https://github.com/kodflow/claude-marketplace.git kodflow-canary
cd kodflow-canary
git checkout --detach "$KODFLOW_CANARY_SHA"
bash scripts/tests/smoke-plugins.sh
bash scripts/tests/smoke-hosts.sh --require-both
canary_home=$(mktemp -d)
(
  export HOME="$canary_home"
  export CLAUDE_CONFIG_DIR="$canary_home/claude" CODEX_HOME="$canary_home/codex"
  ./scripts/install.sh --checkout --check
  ./scripts/install.sh --checkout
)
```

Keep the checkout at the selected commit while using its local marketplace.
Both smoke tests create and dispose of their own empty profiles.
`smoke-plugins.sh` serves the checkout's HEAD as the Git marketplace a user
adds (`url.insteadOf` in the throwaway HOME points the published URL at a bare
copy, so nothing is fetched), runs `install.sh`, and compares every installed
plugin with the tree byte for byte. `--migrate-from <sha>` installs at an older
commit first and checks that `marketplace update` then `plugin update` land
on HEAD. The `Marketplace canary` workflow runs all of this on a commit's
release artifact before it reaches main.

Codex accepts repeat registration from the same checkout. To use a different
checkout with an existing Codex profile, inspect the current source with
`codex plugin marketplace list`. Once you have verified the previous checkout
is available for rollback, run `codex plugin marketplace remove kodflow` in
that profile and rerun the installer from the new checkout. An isolated
canary profile does not require removing any existing registration.

## Rollback

### Claude Code

Pin the marketplace to the previous commit, then update each plugin. Never run
`claude plugin marketplace remove kodflow`: it uninstalls every kodflow plugin
with it. The first step depends on whether `~/.claude/settings.json` already
declares `extraKnownMarketplaces.kodflow` (it does once `install.sh` or a
`marketplace add` has run):

```sh
prev=<full sha of the previous good commit>
# 1. Entry declared in settings.json: first set "ref": "<prev>" in
#    extraKnownMarketplaces.kodflow.source by hand (url and "source" unchanged).
#    No entry declared: skip this step.
claude plugin marketplace add "https://github.com/kodflow/claude-marketplace.git#$prev"
claude plugin list                       # the installed kodflow plugins and their scope
claude plugin update --scope user kodflow-hooks@kodflow   # once per plugin and scope
```

With a declared entry, `marketplace add "<url>#<sha>"` on its own fails ("its
source doesn't match its extraKnownMarketplaces entry"): the `ref` written
first makes both sources identical, and the `add` then moves the marketplace
clone to that commit. The argument of `add` takes the exact form of the
declared source:

| Declared `extraKnownMarketplaces.kodflow.source` | `add` argument |
|---|---|
| `{"source": "git", "url": "https://github.com/kodflow/claude-marketplace.git"}` | `"https://github.com/kodflow/claude-marketplace.git#$prev"` |
| `{"source": "github", "repo": "kodflow/claude-marketplace"}` | `"kodflow/claude-marketplace#$prev"` |

The same holds going forward: `add` with the declared form, without `#`. Without a declared entry, the `add` writes the `ref`
into `extraKnownMarketplaces.kodflow.source` itself. Either way,
`plugin update` then reinstalls each plugin as it was at that commit. A
plugin installed at project or local scope is updated with that `--scope`.
Restart open sessions to apply it.

To move forward again, delete the `"ref"` key from
`extraKnownMarketplaces.kodflow.source`, run
`claude plugin marketplace add https://github.com/kodflow/claude-marketplace.git`,
(or `kodflow/claude-marketplace` for a `github` source), then the same
`plugin update` commands. Both steps are needed: a hand edit of
`settings.json` alone is not picked up by `claude plugin marketplace update`
(the CLI reports the marketplace as not found until the next `add`).

Checked with Claude Code 2.1.328, in a throwaway profile and on copies of real
profiles declaring a `git` and a `github` entry. The rollback only works between commits
whose `marketplace.json` uses relative sources (`./plugins/...`, #168 and
later): before, each plugin pointed at the repository's default branch, which
a marketplace `ref` does not move.

#### Duplicate installs at project scope in the home directory

A plugin installed at `project` scope while the project directory is `$HOME`
shares its settings file with the user scope: `~/.claude/settings.json` is
both. Removing that duplicate with
`claude plugin uninstall --scope project <plugin>@kodflow` therefore also
disables the user-scope install (`enabledPlugins` set to false). Enable it
again afterwards:

```sh
claude plugin uninstall --scope project kodflow-hooks@kodflow
claude plugin enable --scope user kodflow-hooks@kodflow
claude plugin list        # the plugin is listed once, user scope, enabled
```

### Codex

Before a native install, keep the flat installation it may retire:

```sh
tar -C "${CODEX_HOME:-$HOME/.codex}" -czf ~/.cache/kodflow-codex-$(date +%Y%m%d).tgz skills agents
```

To roll back, remove the native plugins, then restore that archive:

```sh
for p in $(codex plugin list --json | jq -r '.installed[] | select(.marketplaceName == "kodflow") | .pluginId'); do
  codex plugin remove "$p"
done
tar -C "${CODEX_HOME:-$HOME/.codex}" -xzf ~/.cache/kodflow-codex-<date>.tgz
```

Or run `scripts/install.sh --codex --legacy` from the previous good checkout,
which removes the native plugins and installs its flat skills and agents.
Verify the restored skills and agents before removing anything else.

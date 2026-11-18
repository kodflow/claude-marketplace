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
bash scripts/tests/smoke-hosts.sh --require-both
./scripts/install.sh --checkout --check
```

Keep the checkout at the selected commit while using its local marketplace.
The smoke test creates and disposes of its own empty profiles.

## Rollback

Use the previous validated checkout with `--checkout`, or use that checkout's
`--legacy` path for Codex. Verify the restored skills and agents before
removing the canary marketplace from the client. Existing flat files stay in
place throughout the canary period, so do the first native install in an
isolated profile to avoid duplicate skill names.

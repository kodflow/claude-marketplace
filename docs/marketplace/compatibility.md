# Universal marketplace compatibility

`scripts/pluginctl.py` derives every result from the root `plugin.json` files.
The JSON reports emitted by `compat --write` describe the package
projections. The installer and release profiles also carry host companions.

| Capability | Claude | OpenAI Codex | Perplexity |
|---|---|---|---|
| Skills | native | native plugin load | native ZIP import |
| Agents | Generated native Markdown agents | Generated TOMLs staged into the user agent directory | Separate advisory role-skill ZIPs |
| Workflow delegation | Claude Teams and subagent instructions | Codex collaboration instructions | Advisory Computer instructions with capability preflight |
| Hooks | native | absent | absent |
| Mods / HUD | native | absent | absent |
| Shell integration | native hook | portable guidance only | absent |

The statuses are not scores:

- `equivalent` means a named automated verifier proves the projection.
- `advisory-loss` means the usable portable part remains but host integration
  is lost.
- `absent` means no adapter exists.

Optional loss is reported but does not block a build. Required loss blocks an
enabled projection. Hook/mod-only packages use the Claude profile. Codex
discovers custom roles through its own agent directory, which the native
installer stages separately. GameDev activation remains project-scoped.
The Perplexity role skills provide guidance without subagent identity or sandbox
guarantees. Generated workflow instructions do not establish native dispatch
equivalence on their own. The runtime uses a separate provider contract.

The ZIP verifier checks package shape and limits. Perplexity import acceptance
also requires checking the expected skills and connectors in Computer. See
[Prepare a marketplace canary](publish.md).

## Commands

```sh
uv sync --project scripts --frozen
uv run --project scripts python scripts/pluginctl.py validate --all --mode publisher-strict
uv run --project scripts python scripts/pluginctl.py build --targets all --check
uv run --project scripts python scripts/pluginctl.py compat --targets all --fail-required-loss
python3 scripts/stamp-versions.py --check
```

Run `build` without `--check` to refresh committed host marketplaces and write
Perplexity archives under ignored `dist/perplexity/`.

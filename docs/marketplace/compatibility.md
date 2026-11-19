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

- `equivalent` means the named automated check passed on the package being
  reported. Native checks cover the configured files. The Perplexity check
  validates the archive and its required skill content.
- `advisory-loss` means the usable portable part remains but host integration
  is lost.
- `absent` means the target does not provide the capability, or its verifier
  did not pass.

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

Each package's root `plugin.json` is its only hand-edited manifest. `build`
generates `.claude-plugin/plugin.json` from it, adding the Claude-only fields of
`extensions."io.github.kodflow".targets.claude.manifest` (such as `types` and
`userConfig`) and `engines.claude-code` when `targets.claude.minimumVersion` is
2.1.323 or later. The overlay cannot set `name`, `version`, `description` or
`engines`. `stamp-versions.py` writes only the root manifest, so run it first,
then `build`.

`catalog/catalog.json` lists third-party plugins under `externals[]`, each pinned
to an HTTPS URL and a 40-character commit. Only the Claude marketplace lists
them, with `installByDefault: false`; they are never packaged, stamped,
inventoried or released. `pluginctl.py bump-external <name> [--sha X]` moves a
pin, refuses an upstream version that goes down (exit 4) and exits 3 when the
upstream content changed under an unchanged version.

Run `roles` and `workflows` to refresh their generated files and ownership
inventories under `catalog/`. Their `--check` mode reports drift and obsolete
owned files. Write mode can retire previously generated files using the
inventory, while hand-maintained files outside it remain available.

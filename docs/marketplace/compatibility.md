# Universal marketplace compatibility

`scripts/pluginctl.py` derives every result from the root `plugin.json` files.
The table below summarizes phase 3; the JSON reports emitted by `compat
--write` are the machine-readable form.

| Capability | Claude | OpenAI Codex | Perplexity |
|---|---|---|---|
| Skills | native | native plugin load | native ZIP import |
| Agents | native Markdown agents | legacy flat TOML export; not yet packaged | absent |
| Multi-agent dispatch | native | native | absent |
| Hooks | native | absent | absent |
| Mods / HUD | native | absent | absent |
| Shell integration | native hook | portable guidance only | absent |

The statuses are not scores:

- `equivalent` means a named automated verifier proves the projection.
- `advisory-loss` means the usable portable part remains but host integration
  is lost.
- `absent` means no adapter exists.

Optional loss is reported but does not block a build. Required loss blocks an
enabled projection. Consequently hook/mod-only packages are Claude-only in
phase 3, while skill packages can be imported by all three hosts and the
specialist agents are Claude-only through the new marketplace in phase 3. The
existing flat Codex export remains supported during the canary, but is not
misrepresented as a package-level equivalent; portable roles arrive in phase
4.

Perplexity's real import UI remains an explicit release gate because it cannot
be exercised headlessly. Phase 3 proves the documented ZIP shape and limits.

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

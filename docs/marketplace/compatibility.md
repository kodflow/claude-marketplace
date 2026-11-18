# Universal marketplace compatibility

`scripts/pluginctl.py` derives every result from the root `plugin.json` files.
The table below summarizes phase 3; the JSON reports emitted by `compat
--write` are the machine-readable form.

| Capability | Claude | OpenAI Codex | Perplexity |
|---|---|---|---|
| Skills | native | native plugin load | native ZIP import |
| Agents | native Markdown agents | legacy flat TOML export; not yet packaged | absent |
| Multi-agent dispatch | host-supported, package behavior is unverified | host-supported, package behavior is unverified | absent |
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
enabled projection. Consequently hook/mod-only packages are Claude-only in
phase 3, while compatible skill-only packages can be imported by all three
hosts. Specialist and GameDev agents are Claude-only through the new marketplace in
phase 3. Shell is also withheld from the new Codex marketplace until its
package can be staged without Claude's SessionStart hook. The existing flat
Codex exports remain supported during the canary, but are not misrepresented
as package-level equivalents; portable roles arrive in phase 4.

The ZIP verifier checks the documented package shape and limits. To pass the
Perplexity release gate, import the archive in Computer, open the installed
plugin, and check that all expected skills and connectors appear and can be
used. Upload success alone does not show that every connector was loaded.
See the [manual import procedure](https://www.perplexity.ai/help-center/en/articles/2026100802-create-or-upload-a-custom-plugin).

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

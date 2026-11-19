# Prepare a marketplace canary

Use Python 3.11.4 or newer. Build from the full SHA of a committed, tested
tree. The command exports that commit through Git, runs its validators and scanner, and creates
`dist/releases/<sha>/`. It also accepts an explicit `--output` parent.

```sh
uv sync --project scripts --locked
uv run --project scripts python scripts/plugin-release.py --ref "$(git rev-parse HEAD)"
```

| Profile | Contents |
|---|---|
| `portable.zip` | Portable packages whose required capabilities survive the projection |
| `claude-full.zip` | Claude marketplace, packages, native agents, hooks and mods |
| `openai-local.zip` | Codex marketplace and packages, plus the versioned custom agent directory |
| `openai-public.zip` | Portable Codex packages without local hooks or staged agent files |
| `perplexity.zip` | Individual import ZIPs, including separate advisory role-skill batches |

`release-lock.json` identifies the immutable source commit and records the
SHA-256 and size of each archive. Each archive contains its provenance,
compatibility reports and omitted capabilities. GitHub Actions can prepare
these artifacts manually for a full SHA. Attach the files to a prerelease
whose Git ref points to that same commit.

## Canary acceptance

1. Install the pinned checkout in clean Claude and Codex homes. Use the
   portable search skill in both. Exercise a native Claude delegation and
   three distinct Codex roles.
2. Unpack the Perplexity profile. Upload the individual workflow ZIP in
   Perplexity Computer and verify the installed skill and expected connectors.
   Import acceptance requires the skill and every expected connector to be
   listed and usable. Upload success alone can hide skipped connectors.
3. Run the runtime's opt-in provider test with operator credentials, interrupt
   the research council run, resume it and retrieve its artifacts.
4. Record the SHA, artifact digests, host versions and evidence for each host.
   Deprecate the flat Codex path only after two successful SHA-pinned canaries.

Use the previous SHA to roll back, as described in [Install and roll back](install.md).
Perplexity publication uses the [manual import procedure](https://www.perplexity.ai/help-center/en/articles/2026100802-create-or-upload-a-custom-plugin).

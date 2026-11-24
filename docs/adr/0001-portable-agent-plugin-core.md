# ADR 0001: Portable Agent Plugins core with generated host projections

- Status: accepted
- Date: 2026-11-18
- Issue: [#166](https://github.com/kodflow/claude-marketplace/issues/166)
- Area: catalog, runtime, codex, schemas
- Need: decision

## Context

The repository historically used Claude Code manifests and a separate flat
Codex export. That made each host a potential source of truth and could hide
capability loss during a port. Perplexity imports Agent Plugin ZIP files, while
Claude and Codex can load local marketplaces but expose different host-only
features.

## Decision

Each package now has an Agent Plugins 1.0 `plugin.json` at its root. A logical
catalog in `catalog/catalog.json` lists packages without embedding release
commits or digests. Deterministic adapters generate the Claude and Codex
marketplaces and Perplexity ZIP files.

Host-specific behavior remains beside the portable core during the canary:
legacy `.claude-plugin` manifests and the flat `codex/` export continue to
work. Compatibility reports use three semantic states: `equivalent`,
`advisory-loss`, and `absent`. An equivalent capability must name a verifier;
an enabled target fails its build if a required capability is not equivalent.

The publisher validator rejects unknown root fields. A separate loader mode
models the Agent Plugins rule that unknown root fields and non-object
`extensions` are warnings that loaders may ignore.

## Consequences

- Package identity and portable skills have one canonical contract.
- Claude-only hooks and mods remain explicit instead of being presented as
  portable.
- OpenAI agent TOML remains generated from Claude agent sources for now.
- Perplexity receives only packages whose required capabilities survive its
  import model.
- Release locking and provider-neutral roles/workflows remain later phases.

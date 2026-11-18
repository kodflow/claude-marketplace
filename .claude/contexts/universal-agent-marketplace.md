---
topic: Universal multi-agent marketplace for Kodflow
slug: universal-agent-marketplace
generated: 2026-11-18T14:00:06Z
query: "Migrate the Kodflow Claude marketplace so it works with Claude, OpenAI/Codex, Perplexity, and future agent hosts"
class: VERSIONED
gate: LOCAL_PARTIAL
engine: degraded:agents
---

# Context: Universal multi-agent marketplace for Kodflow

## Answer

Use Agent Plugins 1.0 as the portable package core for `plugin.json`, `skills/`,
and `mcp.json`. Keep agents, hooks, permissions, UI, and orchestration in
namespaced Kodflow extensions and compile them into Claude, OpenAI/Codex, and
Perplexity projections. Use MCP for tools and connectors, host-native delegation
for local teams, and A2A only where independent remote agents must collaborate.

## Facts

| # | Claim | Source | Tier | Confidence |
|---|-------|--------|------|------------|
| 1 | Agent Plugins 1.0.0 standardizes a root `plugin.json`, `skills/`, and `mcp.json`, with reverse-domain extension namespaces for client-specific data. | [Agent Plugins specification](https://agent-plugins.org/specification) | 1 | confirmed (Agent Plugins + OpenAI) |
| 2 | Agent Plugins v1 deliberately excludes portable agents, commands, hooks, rules, and LSP servers because those formats have not converged. | [Agent Plugins design decision](https://agent-plugins.org/specification#why-only-agent-skills-and-mcp-in-v1) | 1 | confirmed (specification + host docs) |
| 3 | OpenAI recommends Agent Plugins packages for new plugins and supports legacy Claude and Codex compatibility manifests. | [OpenAI plugin packaging](https://developers.openai.com/plugins/build/plugins) | 2 | confirmed (OpenAI + Agent Plugins) |
| 4 | Claude Code plugins can additionally ship subagents, hooks, workflows, LSP servers, output styles, and mods; those surfaces have Claude-specific lifecycle and enforcement semantics. | [Claude plugin reference](https://code.claude.com/docs/en/plugins-reference) | 2 | confirmed (Claude plugin + hooks docs) |
| 5 | Codex named subagents use `.codex/agents/*.toml`; they inherit the parent provider, MCP servers, permissions, and service tier, and cannot independently override every security boundary. | [Codex subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents) | 2 | confirmed (Codex config + migration docs) |
| 6 | Perplexity Computer imports root Agent Plugins manifests as well as Claude and Codex compatibility manifests, but documents portable import for skills and remote MCP connectors rather than foreign hook or subagent definitions. | [Perplexity custom plugin import](https://www.perplexity.ai/help-center/en/articles/2026100802-create-or-upload-a-custom-plugin) | 2 | confirmed (Perplexity import + changelog) |
| 7 | Perplexity plugin imports are bounded to 32 skills, 1,000 files, 20 MB uncompressed, and 15 MCP servers; an import may succeed while unsupported MCP entries are skipped. | [Perplexity custom plugin import](https://www.perplexity.ai/help-center/en/articles/2026100802-create-or-upload-a-custom-plugin) | 2 | single-source |
| 8 | MCP is the shared tool and connector boundary. A2A provides agent discovery, tasks, artifacts, streaming, and remote delegation between independent agents. | [MCP architecture](https://modelcontextprotocol.io/specification/2026-07-28/architecture) · [A2A specification](https://a2a-protocol.org/latest/specification/) | 1 | confirmed (two standards) |
| 9 | The repository already keeps Claude plugin content as the source and generates Codex skills and agents, but the generator is a text rewrite with a fixed vendor model map. | `README.md:89` · `scripts/build-codex.py:18` · `scripts/build-codex.py:37` | local | confirmed (repository) |
| 10 | The current repository contains 9 plugins, 30 source skills, 49 source agents, 5 hook bundles, 26 generated Codex skills, and 35 generated Codex agents. | repository inventory on 2026-11-18 | local | confirmed (repository) |

## Versions

| Thing | Value | As of | Source |
|-------|-------|-------|--------|
| Agent Plugins specification | 1.0.0 | 2026-11-18 | [Specification](https://agent-plugins.org/specification) |
| Agent Plugins manifest schema | `https://agent-plugins.org/schemas/1.0.0/plugin.schema.json` | 2026-11-18 | [Build guide](https://agent-plugins.org/plugin-authors/build-an-agent-plugin) |
| MCP specification consulted | 2026-07-28 | 2026-11-18 | [MCP specification](https://modelcontextprotocol.io/specification/2026-07-28) |
| Claude marketplace Git `ref` pin | Claude Code 2.1.324+ | 2026-11-18 | [Claude marketplace pinning](https://code.claude.com/docs/en/plugins/marketplace-reference#pin-a-marketplace-to-a-commit) |
| Local Codex CLI inspected | 0.170.0 | 2026-11-18 | local `codex --version` and `codex plugin --help` |
| Perplexity import limits | 32 skills / 1,000 files / 20 MB / 15 MCP servers | 2026-11-18 | [Perplexity import](https://www.perplexity.ai/help-center/en/articles/2026100802-create-or-upload-a-custom-plugin) |

## Decisions open

| Decision | Options | Trade-off | Depends on |
|----------|---------|-----------|------------|
| Canonical package format | Keep Claude as source / Agent Plugins core plus overlays / proprietary universal schema | Keeping Claude is fastest but preserves translation debt. Agent Plugins reuses an adopted standard. A proprietary core offers control but duplicates the standard. | Willingness to migrate manifests in place |
| Portable agent roles | Keep Claude Markdown canonical / define `io.github.kodflow` role IR / convert every agent into a skill | A role IR preserves real multi-agent semantics but remains a Kodflow extension until standards converge. | Required parity for 49 existing agents |
| Distribution | Git catalogs only / public vendor directories / hosted Kodflow registry | Git is reproducible and cheap. Public directories add reach and review constraints. A hosted registry adds operations and trust responsibilities. | Target audience and governance |
| Orchestration | Host-native only / Kodflow process manager / A2A gateway | Native delegation is simplest. A durable process manager enables retries and mixed providers. A2A is useful only for remote autonomous agents. | Need for cross-provider workflows in the first release |
| Hook policy | Required capability / optional degradation / split public and private packages | Public portability conflicts with lifecycle enforcement. Separate profiles preserve both reach and enforcement. | Which workflows are unsafe without hooks |

## Pitfalls

- **Treating Agent Plugins as a complete multi-agent standard** — v1 standardizes skills and MCP, while agents and hooks remain client extensions. ([Agent Plugins specification](https://agent-plugins.org/specification#why-only-agent-skills-and-mcp-in-v1))
- **Publishing hook-dependent behavior as portable** — OpenAI allows hooks for manually installed desktop plugins but excludes them from the public directory. ([OpenAI plugin packaging](https://developers.openai.com/plugins/build/plugins#bundled-mcp-servers-and-lifecycle-hooks))
- **Silent Perplexity degradation** — import can succeed after skipping unsupported MCP definitions, so compatibility must be checked before packaging. ([Perplexity import](https://www.perplexity.ai/help-center/en/articles/2026100802-create-or-upload-a-custom-plugin))
- **Assuming role-level isolation in Codex** — Codex subagents inherit parent provider, MCP, permissions, and service tier. ([Codex subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents))
- **Confusing package version with content integrity in Claude** — plugin `version` drives cache identity; source SHA or archive digest must be pinned separately. ([Claude loading and updates](https://code.claude.com/docs/en/plugins/loading#versions-and-updates))
- **Using MCP as the workflow supervisor** — MCP exposes capabilities, while task recovery, idempotency, approvals, and compensation remain orchestration responsibilities even where optional MCP Tasks exist. ([MCP architecture](https://modelcontextprotocol.io/specification/2026-07-28/architecture))
- **Claiming Perplexity A2A support** — no official Perplexity A2A endpoint or Agent Card was found; any bridge would be maintained by Kodflow. ([Perplexity Computer MCP](https://docs.perplexity.ai/docs/getting-started/integrations/computer-mcp-server))

## Conflicts

| Topic | Source A says | Source B says | Believed | Why |
|-------|---------------|---------------|----------|-----|
| Codex distribution | The repository README describes `codex/` as a generated flat installation. | Current OpenAI docs provide native Agent Plugins and local marketplaces. | Both, by version | The current path remains a compatibility fallback; the migration should make native plugins primary after a tested transition. |
| Perplexity as a target | Earlier product positioning treated Perplexity mainly as a search/model provider. | Current official docs expose Computer, skills/plugins, teammates, MCP, and Agent API. | Current official docs | Product capabilities changed; Perplexity needs both a host adapter and provider adapter. |

## Open questions

- Which minimum Claude Code, Codex, and Perplexity client/account tiers should be supported in release one?
- Should the first release target Git/team distribution only, or prepare public OpenAI and Perplexity submissions immediately?
- Does the hosted OpenAI Agents API accept portable-only Agent Plugins in the required deployment path, or must the Codex compatibility projection remain mandatory?
- Which Kodflow hooks are correctness or security requirements, and which can degrade to advisory behavior on hosts without equivalent events?
- Perplexity documents import and upload, but a stable automated publication API for its public marketplace was not confirmed.

## Local base

| Doc | Verified | Status | Role | Action |
|-----|----------|--------|------|--------|
| `cloud/scheduler-agent-supervisor.md` | 2026-03-11 | fresh | durable scheduler, worker registry, recovery | consulted; no change |
| `messaging/process-manager.md` | 2026-03-11 | fresh | workflow state, retry, compensation | consulted; no change |
| `devops/mcp-optimization.md` | 2026-03-11 | stale | lazy capability discovery | consulted structurally; operational claims not restamped |

## Sources

| # | Title | URL | Tier | Fetched |
|---|-------|-----|------|---------|
| 1 | Agent Plugins Specification | https://agent-plugins.org/specification | 1 | 2026-11-18 |
| 2 | OpenAI: Package your plugin | https://developers.openai.com/plugins/build/plugins | 2 | 2026-11-18 |
| 3 | OpenAI: Submit a Claude plugin | https://developers.openai.com/plugins/guides/submit-claude-plugin | 2 | 2026-11-18 |
| 4 | Claude Code plugins reference | https://code.claude.com/docs/en/plugins-reference | 2 | 2026-11-18 |
| 5 | Claude Code hooks | https://code.claude.com/docs/en/hooks | 2 | 2026-11-18 |
| 6 | Codex subagents | https://learn.chatgpt.com/docs/agent-configuration/subagents | 2 | 2026-11-18 |
| 7 | Perplexity custom plugin import | https://www.perplexity.ai/help-center/en/articles/2026100802-create-or-upload-a-custom-plugin | 2 | 2026-11-18 |
| 8 | Perplexity Agent API | https://docs.perplexity.ai/docs/agent-api/quickstart | 2 | 2026-11-18 |
| 9 | MCP specification | https://modelcontextprotocol.io/specification/2026-07-28 | 1 | 2026-11-18 |
| 10 | A2A specification | https://a2a-protocol.org/latest/specification/ | 1 | 2026-11-18 |

---
_Written by /search. Commit this file with the project so the research remains reproducible._

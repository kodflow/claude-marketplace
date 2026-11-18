---
slug: universal-agent-plugins-marketplace
kind: feature
title: "Universal Agent Plugins marketplace phases 0-3"
destination: github
issue_iid: 166
issue_url: https://github.com/kodflow/claude-marketplace/issues/166
branch: feature/166-universal-agent-plugins-marketplace
opened: 2026-11-18
---

## Exchange log

### 2026-11-18 — opened

Migrate the nine Kodflow plugins to an Agent Plugins 1.0 portable core and
generate verified Claude, OpenAI/Codex, and Perplexity projections. Preserve the
legacy Claude and flat Codex paths during the canary period. Phases 4–7 (neutral
roles, durable workflows, provider runtimes, A2A, and final installer cutover)
remain out of scope.

Pre-implementation specialist review added five requirements: a locked Python
tool environment, cycle-free version derivation, distinct publisher and loader
validation modes, verifier-backed compatibility states, and real loader smoke
tests for available hosts.

### 2026-11-18 — CodeRabbit review

The first PR review tightened failure boundaries and removed two false
compatibility claims. GameDev now requires its agents and remains Claude-only;
Shell is withheld from the new Codex marketplace until a hook-free package can
be staged. Validator fixtures now cover invalid MCP envelopes and sibling
servers, HTTPS/loopback URL rules, PLUGIN_DATA escapes, command forms, symlink
loops, Agent Skills names, UTF-8 metadata, invalid catalog manifests, and the
semantic verifier-ID contract. The official vendored schemas remain unchanged;
the Python-specific final-newline check is an additional semantic validation.

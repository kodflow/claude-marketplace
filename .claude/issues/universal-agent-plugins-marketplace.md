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

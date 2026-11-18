# Kodflow agent runtime

The runtime executes provider-backed workflow DAGs from a checkout containing
the workflow engine and schemas. SQLite stores the pinned workflow, attempts,
dependencies, user approvals, results and provider handles. The runtime needs no
hosting service.

Run the offline release witness with deterministic provider adapters:

```sh
uv run --frozen --project runtime pytest runtime/tests
uv run --frozen --project runtime kodflow-agents doctor --offline
```

Exercise the same three-worker research council across separate CLI processes:

```sh
uv run --frozen --project runtime kodflow-agents run runtime/examples/research-council.yaml \
  --run-id council-demo --input '{"query":"Compare methods for storing daylight-generated energy."}' --once
uv run --frozen --project runtime kodflow-agents resume council-demo --once
uv run --frozen --project runtime kodflow-agents artifacts council-demo verify
uv run --frozen --project runtime kodflow-agents usage council-demo verify
```

Pick a fresh run ID on subsequent executions. Default state lives under ignored
`dist/kodflow-agents/`. Use `--database` to select another SQLite path,
and `--repository` when running from a standalone wheel. Restrict access to the
database because workflow inputs and finished artifacts can contain private data.

## Credentialed release verification

Set the following environment variables through the operator's secret manager.
Model names are account-specific, so the runtime requires an explicit value for
each selected model service.

| Route ID | Configuration | Native operations |
|---|---|---|
| `anthropic` | `ANTHROPIC_API_KEY`, `KODFLOW_ANTHROPIC_MODEL` | Claude Messages text and token usage |
| `openai` | `OPENAI_API_KEY`, `KODFLOW_OPENAI_MODEL` | Responses text and usage. Set `KODFLOW_OPENAI_BACKGROUND=1` to enable stored backgrounds, polling and cancellation |
| `perplexity` | `PERPLEXITY_API_KEY`, `KODFLOW_PERPLEXITY_MODEL` | Perplexity Agent API text and usage |
| `computer` | `PERPLEXITY_COMPUTER_OAUTH_TOKEN`, optional `KODFLOW_COMPUTER_MODEL` | Computer threads, polling, cancellation, interactive answers or confirmations, and assets |
| `a2a` | `KODFLOW_A2A_CARD_URL`, optional `KODFLOW_A2A_BEARER_TOKEN` | A2A 1.0 JSON-RPC messages, status, input, cancellation, artifacts and streaming when advertised |

The Perplexity Computer token is an existing OAuth bearer token. The operator
completes the account authorization separately. A2A uses an operator-trusted
HTTPS Agent Card and follows only its same-origin JSON-RPC 1.0 interface.
Neither adapter forwards credentials across redirects.

Use `--live` before the subcommand to opt in to genuine, billable requests:

```sh
uv run --frozen --project runtime kodflow-agents --live run runtime/examples/research-council.yaml \
  --run-id council-live --input '{"query":"Compare methods for storing daylight-generated energy."}' --once
uv run --frozen --project runtime kodflow-agents --live resume council-live
uv run --frozen --project runtime kodflow-agents artifacts council-live verify
```

Inspect the four completed results and the verification artifact. The first
frontier runs three provider requests in parallel. The verifier consumes those
results only after the first frontier is complete. Provider tools enabled for
model APIs are limited to their web search integrations. The runtime exposes
no repository-write capability.

## Recovering or controlling a run

- Use `status RUN` to inspect the local state, and `resume RUN` to continue
  durable progress. Native handles are persisted before workflow task results.
- If a submission dropped its connection before the native handle was saved,
  use `reconcile RUN TASK --native-id ID` when the provider supports retrieving
  that handle. A worker with a synchronous-only API might require operator
  investigation instead. The runtime keeps an uncertain attempt visible.
- For a task waiting for input, use `input RUN TASK --value JSON_OBJECT`. A2A
  accepts a `text` field. Computer accepts an `answers` object or an explicitly
  completed connector name in `connector`.
- Use `approve RUN TASK allow|deny --reason MESSAGE` only after reviewing the
  pending decision. Provider requests remain paused until that decision.
- Use `cancel RUN` to cancel all known active remote handles before changing the
  local run state. Providers that cannot confirm cancellation leave their
  attempts visible for reconciliation.
- `artifacts RUN TASK` prints persisted artifacts. Computer asset metadata
  contains durable IDs. The Python `Computer.artifact_download` operation
  requests a fresh URL for a chosen asset.

API contracts checked for this runtime. [Anthropic Messages](https://platform.claude.com/docs/en/api/messages/create) · [OpenAI Responses](https://developers.openai.com/api/reference/resources/responses/methods/create) · [Perplexity Agent API](https://docs.perplexity.ai/docs/agent-api/quickstart) · [Perplexity Computer MCP](https://docs.perplexity.ai/docs/getting-started/integrations/computer-mcp-server) · [A2A protocol](https://a2a-protocol.org/latest/specification/)

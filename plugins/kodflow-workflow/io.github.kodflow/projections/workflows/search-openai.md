# search on Codex

Research a topic using three independent read-only investigations, verified sources, and a single context report.

Required capabilities: parallel-delegation, structured-output, web.official-docs.

Use Codex collaboration to spawn named agents, wait for their results, then join the results.
Confirm each required capability in the current session. If any is unavailable, stop before dispatch and report what is missing.
Dispatch independent tasks together. Start a dependent task only after its prerequisites have completed and their outputs satisfy the declared contracts.
Preserve the existing skill's evidence and report format. Do not run write actions on read-only tasks.

## local-evidence

Assign role `developer-executor-design` with `read` access. Prerequisites: none.
Timeout: 180 seconds. Retries: 1.

Check project context and documentation available to this session. Record factual claims, source paths, dates and gaps. Treat unverified or stale sources as leads. Do not edit the knowledge base or repository.

Input JSON Schema:

```json
{
  "required": [
    "inputs",
    "dependencies"
  ],
  "type": "object"
}
```

Output JSON Schema:

```json
{
  "properties": {
    "claims": {
      "items": {
        "properties": {
          "checked": {
            "type": "boolean"
          },
          "claim": {
            "minLength": 1,
            "type": "string"
          },
          "source": {
            "minLength": 1,
            "type": "string"
          }
        },
        "required": [
          "claim",
          "source",
          "checked"
        ],
        "type": "object"
      },
      "type": "array"
    }
  },
  "required": [
    "claims"
  ],
  "type": "object"
}
```

## primary-sources

Assign role `developer-executor-design` with `read` access. Prerequisites: none.
Timeout: 240 seconds. Retries: 1.

Investigate the query using authoritative primary sources. Record source URLs, release or protocol versions and checked facts. Preserve source provenance and keep unsupported interpretations separate from verified claims.

Input JSON Schema:

```json
{
  "required": [
    "inputs",
    "dependencies"
  ],
  "type": "object"
}
```

Output JSON Schema:

```json
{
  "properties": {
    "claims": {
      "items": {
        "properties": {
          "checked": {
            "type": "boolean"
          },
          "claim": {
            "minLength": 1,
            "type": "string"
          },
          "source": {
            "minLength": 1,
            "type": "string"
          }
        },
        "required": [
          "claim",
          "source",
          "checked"
        ],
        "type": "object"
      },
      "type": "array"
    }
  },
  "required": [
    "claims"
  ],
  "type": "object"
}
```

## corroboration

Assign role `developer-executor-correctness` with `read` access. Prerequisites: none.
Timeout: 240 seconds. Retries: 1.

Independently verify the query's likely assumptions against primary sources. Focus on boundary conditions, disagreements, and platform or version drift. Return each claim with its evidence and whether the source was checked.

Input JSON Schema:

```json
{
  "required": [
    "inputs",
    "dependencies"
  ],
  "type": "object"
}
```

Output JSON Schema:

```json
{
  "properties": {
    "claims": {
      "items": {
        "properties": {
          "checked": {
            "type": "boolean"
          },
          "claim": {
            "minLength": 1,
            "type": "string"
          },
          "source": {
            "minLength": 1,
            "type": "string"
          }
        },
        "required": [
          "claim",
          "source",
          "checked"
        ],
        "type": "object"
      },
      "type": "array"
    }
  },
  "required": [
    "claims"
  ],
  "type": "object"
}
```

## validate-sources

Assign role `developer-executor-correctness` with `read` access. Prerequisites: local-evidence, primary-sources, corroboration.
Timeout: 180 seconds. Retries: 0.

Cross-check the three results. Deduplicate by claim and source, reject unsupported evidence, resolve conflicting versions or mark the conflict explicitly, and retain only verified claims. Report unresolved gaps.

Input JSON Schema:

```json
{
  "required": [
    "inputs",
    "dependencies"
  ],
  "type": "object"
}
```

Output JSON Schema:

```json
{
  "properties": {
    "claims": {
      "items": {
        "properties": {
          "checked": {
            "const": true
          },
          "claim": {
            "minLength": 1,
            "type": "string"
          },
          "source": {
            "minLength": 1,
            "type": "string"
          }
        },
        "required": [
          "claim",
          "source",
          "checked"
        ],
        "type": "object"
      },
      "type": "array"
    },
    "gaps": {
      "items": {
        "type": "string"
      },
      "type": "array"
    }
  },
  "required": [
    "claims",
    "gaps"
  ],
  "type": "object"
}
```

## synthesize

Assign role `developer-orchestrator` with `read` access. Prerequisites: validate-sources.
Timeout: 180 seconds. Retries: 0.

Produce the existing /search Markdown context from verified claims. Separate assumptions and unresolved gaps, keep version and source attribution, and return the report to the operator for placement. Do not write local files.

Input JSON Schema:

```json
{
  "required": [
    "inputs",
    "dependencies"
  ],
  "type": "object"
}
```

Output JSON Schema:

```json
{
  "properties": {
    "report": {
      "minLength": 1,
      "type": "string"
    }
  },
  "required": [
    "report"
  ],
  "type": "object"
}
```

# review on Claude Code

Coordinate specialist review of a local code change and preserve the existing evidence-bound review report.

Required capabilities: local-verifier, parallel-delegation, repository.read, structured-output.

Use Claude Teams when available. Otherwise delegate through named Claude Code subagents.
Confirm each required capability in the current session. If any is unavailable, stop before dispatch and report what is missing.
Dispatch independent tasks together. Start a dependent task only after its prerequisites have completed and their outputs satisfy the declared contracts.
Preserve the existing skill's evidence and report format. Do not run write actions on read-only tasks.

## correctness

Assign role `developer-executor-correctness` with `read` access. Prerequisites: none.
Timeout: 300 seconds. Retries: 1.

Review the selected diff for correctness and regression risk. Cite source locations and concrete failure conditions using the existing /review evidence rules. Do not modify code or publish comments.

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
    "findings": {
      "items": {
        "properties": {
          "confidence": {
            "minLength": 1,
            "type": "string"
          },
          "evidence": {
            "minLength": 1,
            "type": "string"
          },
          "line": {
            "minimum": 1,
            "type": "integer"
          },
          "path": {
            "minLength": 1,
            "type": "string"
          },
          "severity": {
            "minLength": 1,
            "type": "string"
          },
          "summary": {
            "minLength": 1,
            "type": "string"
          }
        },
        "required": [
          "path",
          "line",
          "summary",
          "evidence",
          "severity",
          "confidence"
        ],
        "type": "object"
      },
      "type": "array"
    }
  },
  "required": [
    "findings"
  ],
  "type": "object"
}
```

## defensive-security

Assign role `developer-executor-security` with `read` access. Prerequisites: none.
Timeout: 300 seconds. Retries: 1.

Perform a defensive source review of the diff for broken trust boundaries, unsafe defaults, secret exposure and permission regressions. Return source locations, impact, and remediation. Do not attempt exploitation or reproduction of a vulnerability. Do not change files or publish comments.

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
    "findings": {
      "items": {
        "properties": {
          "confidence": {
            "minLength": 1,
            "type": "string"
          },
          "evidence": {
            "minLength": 1,
            "type": "string"
          },
          "line": {
            "minimum": 1,
            "type": "integer"
          },
          "path": {
            "minLength": 1,
            "type": "string"
          },
          "severity": {
            "minLength": 1,
            "type": "string"
          },
          "summary": {
            "minLength": 1,
            "type": "string"
          }
        },
        "required": [
          "path",
          "line",
          "summary",
          "evidence",
          "severity",
          "confidence"
        ],
        "type": "object"
      },
      "type": "array"
    }
  },
  "required": [
    "findings"
  ],
  "type": "object"
}
```

## quality

Assign role `developer-executor-quality` with `read` access. Prerequisites: none.
Timeout: 240 seconds. Retries: 1.

Review maintainability, API consistency, and missing tests on the selected diff. Return concrete findings with source locations and evidence. Do not modify the repository or publish comments.

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
    "findings": {
      "items": {
        "properties": {
          "confidence": {
            "minLength": 1,
            "type": "string"
          },
          "evidence": {
            "minLength": 1,
            "type": "string"
          },
          "line": {
            "minimum": 1,
            "type": "integer"
          },
          "path": {
            "minLength": 1,
            "type": "string"
          },
          "severity": {
            "minLength": 1,
            "type": "string"
          },
          "summary": {
            "minLength": 1,
            "type": "string"
          }
        },
        "required": [
          "path",
          "line",
          "summary",
          "evidence",
          "severity",
          "confidence"
        ],
        "type": "object"
      },
      "type": "array"
    }
  },
  "required": [
    "findings"
  ],
  "type": "object"
}
```

## consolidate

Assign role `developer-orchestrator` with `read` access. Prerequisites: correctness, defensive-security, quality.
Timeout: 180 seconds. Retries: 0.

Merge duplicate findings that identify the same cause and source location. Preserve the strongest evidence, severity and confidence and keep unverified findings in the existing Needs Verification tier. Preserve the existing coverage manifest and deterministic tier inputs to /review.

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
    "coverageManifest": {
      "type": "object"
    },
    "findings": {
      "items": {
        "type": "object"
      },
      "type": "array"
    }
  },
  "required": [
    "findings",
    "coverageManifest"
  ],
  "type": "object"
}
```

## verify-and-report

Assign role `developer-executor-correctness` with `read` access. Prerequisites: consolidate.
Timeout: 180 seconds. Retries: 0.

Run the repository's review-verify-manifest.sh against the requested diff and coverage manifest. Treat a missing verifier, failed verification, or incomplete coverage as inconclusive. Render the existing /review report using skills/review/output.md and synthesis.md: walkthrough, verdict, findings by severity and confidence, Needs Verification, deterministic tier table from captured output, and verifier result. Return the report locally without posting any message.

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
  "if": {
    "properties": {
      "verified": {
        "const": false
      }
    }
  },
  "properties": {
    "report": {
      "minLength": 1,
      "type": "string"
    },
    "verdict": {
      "enum": [
        0,
        1,
        2,
        3,
        4,
        5,
        "INCONCLUSIVE"
      ]
    },
    "verified": {
      "type": "boolean"
    }
  },
  "required": [
    "report",
    "verdict",
    "verified"
  ],
  "then": {
    "properties": {
      "verdict": {
        "const": "INCONCLUSIVE"
      }
    }
  },
  "type": "object"
}
```

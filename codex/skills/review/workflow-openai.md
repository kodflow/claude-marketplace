# review on Codex

Coordinate specialist review of a local code change and preserve the existing evidence-bound review report.

Required capabilities: local-verifier, parallel-delegation, repository.read, structured-output.

Use Codex collaboration to spawn named agents, wait for their results, then join the results.
Confirm each required capability in the current session. If any is unavailable, stop before dispatch and report what is missing.
Dispatch independent tasks together. Start a dependent task only after its prerequisites have completed and their outputs satisfy the declared contracts.
Preserve the existing skill's evidence and report format. Do not run write actions on read-only tasks.

## capture-tiers

Assign role `developer-executor-quality` with `read` access. Prerequisites: none.
Timeout: 300 seconds. Retries: 0.

Run the existing /review Phase 3 tool invocations from deterministic.md. Use its scratch directory, capture each applicable invocation's .out file and _table.tsv, and return paths to those captured files. Do not synthesize captures or change repository files.

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

Use the default input envelope: `inputs` contains the run input and `dependencies` maps prerequisite task IDs to their outputs.

Output JSON Schema:

```json
{
  "properties": {
    "captures": {
      "additionalProperties": {
        "minLength": 1,
        "type": "string"
      },
      "type": "object"
    },
    "directory": {
      "minLength": 1,
      "type": "string"
    },
    "table": {
      "minLength": 1,
      "type": "string"
    }
  },
  "required": [
    "directory",
    "table",
    "captures"
  ],
  "type": "object"
}
```

## correctness

Assign role `developer-executor-correctness` with `read` access. Prerequisites: none.
Timeout: 300 seconds. Retries: 1.

Review the selected diff for correctness and regression risk. Cite source locations and concrete failure conditions using the existing /review evidence rules. Return your coverage records from passes.md. Do not modify code or publish comments.

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

Use the default input envelope: `inputs` contains the run input and `dependencies` maps prerequisite task IDs to their outputs.

Output JSON Schema:

```json
{
  "properties": {
    "coverage": {
      "description": "Actual macro file and micro function or hunk inspection records from passes.md.",
      "type": "object"
    },
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
    "findings",
    "coverage"
  ],
  "type": "object"
}
```

## defensive-security

Assign role `developer-executor-security` with `read` access. Prerequisites: none.
Timeout: 300 seconds. Retries: 1.

Perform a defensive source review of the diff for broken trust boundaries, unsafe defaults, secret exposure and permission regressions. Return source locations, impact, and remediation. Do not attempt exploitation or reproduction of a vulnerability. Return your inspection coverage records. Do not change files or publish comments.

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

Use the default input envelope: `inputs` contains the run input and `dependencies` maps prerequisite task IDs to their outputs.

Output JSON Schema:

```json
{
  "properties": {
    "coverage": {
      "description": "Actual macro file and micro function or hunk inspection records from passes.md.",
      "type": "object"
    },
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
    "findings",
    "coverage"
  ],
  "type": "object"
}
```

## quality

Assign role `developer-executor-quality` with `read` access. Prerequisites: none.
Timeout: 240 seconds. Retries: 1.

Review maintainability, API consistency, and missing tests on the selected diff. Return concrete findings with source locations, evidence, and your inspection coverage records. Do not modify the repository or publish comments.

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

Use the default input envelope: `inputs` contains the run input and `dependencies` maps prerequisite task IDs to their outputs.

Output JSON Schema:

```json
{
  "properties": {
    "coverage": {
      "description": "Actual macro file and micro function or hunk inspection records from passes.md.",
      "type": "object"
    },
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
    "findings",
    "coverage"
  ],
  "type": "object"
}
```

## assemble-evidence

Assign role `developer-orchestrator` with `read` access. Prerequisites: capture-tiers, correctness, defensive-security, quality.
Timeout: 180 seconds. Retries: 0.

Assemble the existing /review Phase 8 coverage manifest from the actual specialist inspection records, the deterministic outputs captured by capture-tiers, and canonical facts from review-verify-manifest.sh --print-facts. Follow manifest.md and leave missing evidence unverified. Return the manifest and the same capture references for verification.

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

Use the default input envelope: `inputs` contains the run input and `dependencies` maps prerequisite task IDs to their outputs.

Output JSON Schema:

```json
{
  "properties": {
    "coverageManifest": {
      "type": "object"
    },
    "deterministicTierOutput": {
      "properties": {
        "captures": {
          "additionalProperties": {
            "minLength": 1,
            "type": "string"
          },
          "type": "object"
        },
        "directory": {
          "minLength": 1,
          "type": "string"
        },
        "table": {
          "minLength": 1,
          "type": "string"
        }
      },
      "required": [
        "directory",
        "table",
        "captures"
      ],
      "type": "object"
    }
  },
  "required": [
    "coverageManifest",
    "deterministicTierOutput"
  ],
  "type": "object"
}
```

## consolidate

Assign role `developer-orchestrator` with `read` access. Prerequisites: correctness, defensive-security, quality, assemble-evidence.
Timeout: 180 seconds. Retries: 0.

Merge duplicate findings that identify the same cause and source location. Preserve the strongest evidence, severity and confidence and keep unverified findings in the existing Needs Verification tier. Preserve the supplied coverage manifest and deterministic tier capture references without changing their evidence.

Input JSON Schema:

```json
{
  "properties": {
    "coverageManifest": {
      "type": "object"
    },
    "deterministicTierOutput": {
      "properties": {
        "captures": {
          "additionalProperties": {
            "minLength": 1,
            "type": "string"
          },
          "type": "object"
        },
        "directory": {
          "minLength": 1,
          "type": "string"
        },
        "table": {
          "minLength": 1,
          "type": "string"
        }
      },
      "required": [
        "directory",
        "table",
        "captures"
      ],
      "type": "object"
    },
    "findings": {
      "type": "object"
    }
  },
  "required": [
    "findings",
    "coverageManifest",
    "deterministicTierOutput"
  ],
  "type": "object"
}
```

Resolve each `$from` in these bindings as a JSON Pointer against the default envelope (`/inputs` for run input and `/dependencies/<task>` for a prerequisite's output). Pass the resulting object as the task input.

```json
{
  "coverageManifest": {
    "$from": "/dependencies/assemble-evidence/coverageManifest"
  },
  "deterministicTierOutput": {
    "$from": "/dependencies/assemble-evidence/deterministicTierOutput"
  },
  "findings": {
    "correctness": {
      "$from": "/dependencies/correctness/findings"
    },
    "quality": {
      "$from": "/dependencies/quality/findings"
    },
    "security": {
      "$from": "/dependencies/defensive-security/findings"
    }
  }
}
```

Output JSON Schema:

```json
{
  "properties": {
    "coverageManifest": {
      "type": "object"
    },
    "deterministicTierOutput": {
      "properties": {
        "captures": {
          "additionalProperties": {
            "minLength": 1,
            "type": "string"
          },
          "type": "object"
        },
        "directory": {
          "minLength": 1,
          "type": "string"
        },
        "table": {
          "minLength": 1,
          "type": "string"
        }
      },
      "required": [
        "directory",
        "table",
        "captures"
      ],
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
    "coverageManifest",
    "deterministicTierOutput"
  ],
  "type": "object"
}
```

## verify-and-report

Assign role `developer-executor-correctness` with `read` access. Prerequisites: consolidate.
Timeout: 180 seconds. Retries: 0.

Run the repository's review-verify-manifest.sh against the requested diff and supplied coverage manifest. Pass the captured evidence directory as --det, and check the supplied table and .out file references. Treat a missing verifier, missing captures, failed verification, or incomplete coverage as inconclusive. Render the existing /review report using skills/review/output.md and synthesis.md: walkthrough, verdict, findings by severity and confidence, Needs Verification, deterministic tier table from captured output, and verifier result. Return the report locally without posting any message.

Input JSON Schema:

```json
{
  "properties": {
    "coverageManifest": {
      "type": "object"
    },
    "deterministicTierOutput": {
      "properties": {
        "captures": {
          "additionalProperties": {
            "minLength": 1,
            "type": "string"
          },
          "type": "object"
        },
        "directory": {
          "minLength": 1,
          "type": "string"
        },
        "table": {
          "minLength": 1,
          "type": "string"
        }
      },
      "required": [
        "directory",
        "table",
        "captures"
      ],
      "type": "object"
    },
    "findings": {
      "items": {
        "type": "object"
      },
      "type": "array"
    },
    "inputs": {
      "type": "object"
    }
  },
  "required": [
    "inputs",
    "findings",
    "coverageManifest",
    "deterministicTierOutput"
  ],
  "type": "object"
}
```

Resolve each `$from` in these bindings as a JSON Pointer against the default envelope (`/inputs` for run input and `/dependencies/<task>` for a prerequisite's output). Pass the resulting object as the task input.

```json
{
  "coverageManifest": {
    "$from": "/dependencies/consolidate/coverageManifest"
  },
  "deterministicTierOutput": {
    "$from": "/dependencies/consolidate/deterministicTierOutput"
  },
  "findings": {
    "$from": "/dependencies/consolidate/findings"
  },
  "inputs": {
    "$from": "/inputs"
  }
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

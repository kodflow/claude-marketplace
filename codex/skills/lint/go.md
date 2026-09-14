# Go Linting Gateway

> Invoked from lint.md when Go is detected with project-linter available.

## Prerequisites

1. Verify `go.mod` exists in project root
2. Check for project-linter binary:

```bash
# Check binary
ls ./builds/project-linter 2>/dev/null

# If missing, build it
if [ -d ./cmd/project-linter ]; then
    go build -o ./builds/project-linter ./cmd/project-linter
fi
```

3. If project-linter not available (no binary, no source): fall back to `generic.md` with `golangci-lint`

## Execution

Once project-linter is confirmed available, execute the full 8-phase workflow:

1. **Run project-linter**: Refer to `execution.md` Step 1
2. **Parse & classify**: Refer to `rules.md` for phase mapping
3. **DTO detection**: Refer to `dto.md` when KTN-STRUCT-ONEFILE or KTN-STRUCT-CTOR
4. **Execute fixes**: Refer to `execution.md` for Agent Teams or sequential mode
5. **Re-run until convergence**: Refer to `execution.md` final verification

## Quick Reference

| Phase | Category | Rules | Mode |
|-------|----------|-------|------|
| 1 | STRUCTURAL | 7 | Lead (sequential) |
| 2 | SIGNATURES | 7 | Lead (sequential) |
| 3 | LOGIC | 17 | Lead (sequential) |
| 4 | PERFORMANCE | 11 | Teammate "perf" |
| 5 | MODERN | 20 | Teammate "modern" |
| 6 | STYLE | 13 | Teammate "polish" |
| 7 | DOCS | 8 | Teammate "polish" |
| 8 | TESTS | 8 | Teammate "tester" |

## Module Reference

| Action | Module |
|--------|--------|
| All 148 rules by phase | Read `rules.md` |
| Execution workflow & agent teams | Read `execution.md` |
| DTO convention & detection | Read `dto.md` |

# /hunt adapter — Go

How a Go repository of the scope builds, runs and counts a witness, finds the
packages a fix can break, and works across several modules. The core of the
skill knows none of this; it asks the adapter.

Every command below runs through `hunt-queue` and carries the scope's `env`
for the repository — `GOTOOLCHAIN=local` always, plus `GOEXPERIMENT`,
`GOPRIVATE`/`GONOSUMDB` when the scope sets them — **for every `go` invocation,
including `vet`, `list` and `test -c`**, not only for the test run. `-mod=mod`
is never used.

---

## 1. A witness is a compiled test binary

```bash
# build once per (package, tag set, -race)
hunt-queue --label "build <pkg>" -- \
  env GOTOOLCHAIN=local <scope env> \
  go test -c -o "$GOTMPDIR/w.test" [-race] [-tags '<tags>'] ./<pkg>

# run N times, each in its own process, in the package directory
cd <worktree>/<pkg-dir>
for i in $(seq 1 "$N"); do
  timeout "<per-run timeout>" "$GOTMPDIR/w.test" -test.run '^<TestName>$' \
    -test.count=1 -test.v=test2json [-test.timeout <t>] 2>&1 \
  | go tool test2json -p <import path> -t
done
```

- **Run in the package directory** — tests read `testdata/` relative to it.
- **Separate processes**: one run per process, so a leaked goroutine or a
  global left dirty by run *i* cannot mask or cause run *i+1*'s result.
- The per-run timeout is the scope's witness timeout; the queue timeout covers
  N × the measured duration.

### Counting

Read the `test2json` stream event by event:

| Event | Counts as |
|-------|-----------|
| `{"Action":"fail","Test":"<TestName>"}` | a failure — **k** is the number of these only |
| `{"Action":"pass","Test":"<TestName>"}` | a pass |
| a `fail` of another test, or a package-level `fail` without a test | not counted for this witness |
| the process killed (signal, `timeout` exit 124/137), a `panic: test timed out` | **no-verdict** |
| compilation failed | **no-verdict** for every run |
| queue exit 75 | **no-verdict** |

`p̂ = k / N` over the runs that produced a verdict. A witness with fewer
verdict-bearing runs than N is reported with its real denominator.

### `-race`

Allowed per witness. The scope may list packages or tests where `-race` is
banned (`go.race_denylist` — too slow, or a known false positive in a
dependency); the flag is part of the witness record, so a verifier replays
exactly what the hunter ran.

## 2. Witnesses waiting for a decision: `huntopen`

A witness whose issue is `hunt:needs-decision` must not turn the hunt's final
pass red, and must not be deleted either — the decision may bring it back. When
such a witness is on `hunt/<slug>` (typically: the fix was integrated, but the
defect is too rare to verify within the budget), its file carries a
**negative** build constraint:

```go
//go:build !huntopen
```

Every run the hunt itself makes — final pass, integration witnesses, reverse
dependencies — adds `huntopen` to its tag set, so those witnesses drop out of
the hunt's verdicts. A build without the tag (a developer, the CI) still
compiles and runs them. A `needs-decision` witness that is still red with no fix
stays on its `hunt-w/<slug>/<N>` branch, linked from the issue, and is not
integrated.

Static checks run **with and without** `huntopen`, so a witness file that only
compiles under one of the two is caught.

## 3. Static checks per tag set

```bash
for tags in "<each witness tag set of the scope>"; do
  go vet -tags "$tags" ./...
  go vet -tags "$tags,huntopen" ./...
done
```

One `vet` per tag set: a file behind a build tag is invisible to a vet run
without that tag.

## 4. Reverse dependencies of a fix

The integrator re-runs, at a reduced N, the witnesses of every package a fix
can break:

```bash
# for each witness package W of the scope:
go list -deps -test -f '{{.ImportPath}}' ./<W>
```

A witness package is affected when its `-deps -test` closure intersects the
packages the fix touched. A change to `go.mod` or `go.sum` affects **all**
witness packages.

## 5. Several repositories: one go.work per worktree

When the scope has several `owned` Go modules that depend on each other:

- each worktree gets its own `go.work`, with **absolute** paths to the sibling
  worktrees of the same hunt, stored **outside the tree** (in the state
  directory) and selected with `GOWORK=<absolute path>` — never committed,
  never at the repository root;
- `go get` and the pre-push verification run with `GOWORK=off`, so the module
  graph that gets pushed is the one in `go.mod`, not the workspace's;
- at convergence the dependency is pushed first, then the consumer is re-pinned
  with `GOWORK=off go get <dep module>@<pushed sha>` in a dedicated commit;
- after every later push of the dependency, and after its merge, the consumer
  is re-pinned again (on the merge SHA in the end — `hunt-push <slug> --repin`).

## 6. Scope fields this adapter reads

| Field | Use |
|-------|-----|
| `repos[].lang` = `"go"` | selects this adapter |
| `repos[].env` | applied to every `go` command |
| `repos[].witness_tags` | the tag sets: one build and one vet per set |
| `repos[].exclusive` | packages / tag sets whose witnesses start containers |
| `repos[].go.race_denylist` | packages or tests never run with `-race` |
| `repos[].go.module` | module path, for the re-pin |
| `matrix[].witness` | package, test name, tags, `-race`, N |
| `thresholds.witness_timeout_s` | per-run timeout |

# kodflow-ktn

ktn-linter, seen from inside Claude Code: a mod (function hooks) that tells
whether the session is in a Go project and, from there, shows what the
ktn-linter daemon knows about it.

It **completes** ktn-linter's hooks and replaces none. The command hooks that
`ktn-linter` installs keep delivering the findings to the model through the
daemon's socket, everywhere — Kepler, `claude -p` and the Agent SDK included.
This mod registers no tool hook: it can neither block nor rewrite a call, and
if it does not load, nothing the model receives changes.

It needs **Claude Code 2.1.299 or later** (the oldest version measured by the
spike of [kodflow/ktn-linter#774](https://github.com/kodflow/ktn-linter/issues/774);
CI pins 2.1.301). Below that it shows one status line and does nothing else.

## Install

```
/plugin install kodflow-ktn@kodflow
```

`claude plugin disable kodflow-ktn@kodflow` turns it off without touching the
rest; the hooks go on as before.

## Where it is active

Only where something draws — the terminal. In a `-p` run, under the Agent SDK
and in Kepler's launch mode `$.session.surfaces()` is empty: the mod is inert
there, with no probe and no daemon call.

Only in a Go project, decided by the **same predicate as ktn-linter's own
resolver** (`daemonaddr.ResolveProject`): walking up from the session's root
to the nearest `.git` (a folder, or a file in a linked worktree), a regular
`go.mod` or `go.work` on the way makes it Go; crossing a `vendor/` folder
discards what was found below it; a `go.mod` above the repository does not
count. A repository whose modules all sit in subfolders is not Go from its
root — open the session in the module, or set `activation: always`.

The probe is bounded by what the spike measured: at most **three listings and
250 ms**, upward only (nothing below the root is read, so no link is ever
followed). A walk cut short says *undetermined*, which is drawn as inactive,
never guessed.

| `activation` | Effect |
|---|---|
| `auto` (default) | active in a Go project only |
| `always` | active everywhere — the net for an undetermined probe |
| `off` | never active |

The verdict is reconciled at one point only: the end of each main-loop turn,
and the `SessionStart` hook after a `/clear`, `/resume` or fork. That catches
a `/cd`, a worktree switch, a `go mod init`, and a `$.state` that came back
empty.

## Command

`/ktn-view` — `/ktn` belongs to `kodflow-devops`. It answers from what the
mod already holds and never waits on the daemon (a command that waits holds
the prompt for up to 30 s).

## One predicate, one table

`tests/fixtures/resolve-project.json` is ktn-linter's golden table for the
resolver (`pkg/daemonaddr/project_roots_external_test.go`), transcribed row
for row at the commit its `provenance.sha` names, and checked against the Go
resolver at that commit before it was committed. The pure tests replay every
row; changing an expected value fails them, as it fails the Go test. To move
the pin: copy the table again from the new commit, re-run the Go resolver on
each tree, then update `KTN_LINTER_SHA` in `hooks/mod/contract.ts`.

## Tests

```
node --test plugins/kodflow-ktn/tests/pure/*.spec.ts   # pure modules, no engine
claude plugin test plugins/kodflow-ktn                 # the hooks, in the engine
```

Node 22.18 or later runs the TypeScript as it is. No npm dependency.

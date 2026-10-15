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
the prompt for up to 30 s); it sends a refresh in the background.

## The daemon

The mod reads the per-user daemon of ktn-linter (`KTN_USER_DAEMON=1`, kodflow/ktn-linter#757)
and nothing else. It finds it through **`endpoint.json` alone**, the pointer
ktn-linter writes under HOME (`~/.local/state/ktn-linter/`, macOS
`~/Library/Application Support/ktn-linter/`): the socket path is never
computed on this side, and `state.json` is not a source (a clean stop removes
it, which is exactly when the launch button is needed). It then asks `GET
/status` once per pointer (the protocol it speaks, the workspaces waiting for
approval) and `GET /api/view` for the workspace, over the socket.

Every known failure ends in a drawn state, never in silence:

| State | When | Offered |
|---|---|---|
| out of a Go project | the probe said so | nothing at all |
| loading | no answer yet | — |
| unreachable | no `endpoint.json`, nothing on the socket, a daemon silent past the request's wait + 5 s, an answer too big or unreadable | the **launch button**, or the command to run |
| incompatible | another protocol than `v1` | nothing: no further call until `endpoint.json` changes |
| pending approval | the daemon waits for the person | the daemon's exact `ktn-linter admin workspace approve …` |
| refused / not served | the daemon's reason | — |
| clean / findings | served | the counts on the status line |

A request refused before it left (an organization's web-fetch policy, a hook)
is a state of its own, never "unreachable", and offers no launch.

One request at a time, tied to the underlying fetch: `$.http.fetch` has a
fixed 30 s deadline and no signal, so the mod races its own (the request's
wait + 5 s), draws "unreachable" when it fires, sends nothing more until the
first request has settled, and drops its late answer. Five failures in a row
hold the turn's refresh back (3 s doubling to 60 s); the person's own act — the
command, a press — passes it. No timer exists while no pane is placed: the
status line is refreshed at the end of each turn, with `wait=0`.

**The launch button** is a convenience, not the guarantee — the hooks and the
MCP shim start the daemon. It runs `<exe> daemon ensure` with the absolute
binary `endpoint.json` names (never a name looked up in PATH), from `/`, with
`KTN_USER_DAEMON=1`, then watches the socket every 500 ms for 10 s: a zero exit
proves a request, not a daemon. Two presses run one command. On failure it
shows the exit code and the first 300 characters of stderr. Where the session
has no host commands, the command is shown to copy instead.

Every string from the daemon is cleaned of control characters before it is
drawn, by a plain loop: no regular expression runs on external data.

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

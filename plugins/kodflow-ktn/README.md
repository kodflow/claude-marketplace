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

## The pane

`/ktn-view` opens it in a Go project (`/ktn-view off` closes it); out of one
the command answers and opens nothing. At the top, the synthesis: the state,
the workspace, the totals by severity and by phase, how long since the last
answer, the launch button when the daemon is down. Below, the findings as a
**collapsible tree**, the way the daemon serves it: directories folded with
their counts, only the children of the ones opened. A press on a directory or
a file opens or folds it (the key of each row is the model's stable
`dir:` / `file:` id, never a line or a counter); the opened ids live in
`$.state` and come back after a hot reload. The pane does not window the
tree: the engine scrolls it natively, the daemon bounds it, and a window
that stops short says "… N de plus, voir l'UI web". The drawing stops its
rows below the engine's 100 000 characters.

While the pane is placed, and only then, one timer exists: a chain of
one-shot timers, 3 s apart, each long-polling the daemon (`wait=20`, raced
at 25 s). Closed, nothing is left armed. A press may send one request beside
a long-poll that waits on a daemon that answers; the long-poll's answer,
about a tree nobody looks at any more, is dropped.

**Ouvrir l'UI web** mints a bootstrap link over the socket (`POST /ui/boot`,
same uid) on the press, never before. The daemon grants only read-only
`view` sessions. The token is held in a module variable and drawn in the
pane's `Link` alone: never in `$.state`, which every plugin can read, never
in the command's text, which the model reads. The link's label is the URL
without its fragment.

`autoOpen` is **off** by default, as kodflow/ktn-linter#774 recommended: the engine seats a pane
nobody asked for only from 144 columns, and once you have opened it with
`/ktn-view` it seats it again from 110, in every later session.

| `autoOpen` | Effect |
|---|---|
| `false` (default) | the pane opens on `/ktn-view` |
| `true` | the pane opens when a Go session starts |

## What it looks like

`tmux capture-pane` of a terminal at 144 columns, fullscreen layout, against a
test daemon (`KTN_USER_DAEMON=1`, private `HOME` and `XDG_*`), the pane opened
by `/ktn-view` and three folders opened from the keyboard (the scratch path
shortened, three of the six findings shown):

```
│ktn · 6 constats · 0 E · 2 W · 4 I
│…/scratchpad/kws
│phases 2:1 5:1 6:2 7:2
│actualisé il y a 0 s · moteur init
│http://127.0.0.1:8080/
│▾ .  6 · 2W 4I
│  ▾ pkg/  6 · 2W 4I
│    ▾ api/  6 · 2W 4I
│      ▾ handler.go  6 · 2W 4I
│        L1 KTN-SC-ST1000 at least one file in a package should…
│        L5 KTN-FUNC-MAXPARAM function 'Serve' has 7 parameters…
│        L6 KTN-VAR-USEANY prefer any to interface{}
```

Under the prompt: `⚠ kodflow-ktn: 6 constats · 0 E · 2 W · 4 I`. The
daemon stopped, the band above the prompt shows the button:

```
ktn · daemon injoignable — aucun daemon sur le socket
[ Lancer le daemon ]
```

A workspace waiting for approval, at 110 columns:

```
ktn · en attente d'approbation — repository not approved                  [-]
à lancer dans votre propre terminal :
ktn-linter admin workspace approve "/…/scratchpad/kws2"
```

## One predicate, one table — and the view model

`tests/fixtures/resolve-project.json` is ktn-linter's golden table for the
resolver (`pkg/daemonaddr/project_roots_external_test.go`), transcribed row
for row at the commit its `provenance.sha` names, and checked against the Go
resolver at that commit before it was committed. The pure tests replay every
row; changing an expected value fails them, as it fails the Go test. To move
the pin: copy the table again from the new commit, re-run the Go resolver on
each tree, then update `KTN_LINTER_SHA` in `hooks/mod/contract.ts`.

`tests/fixtures/view/` holds ktn-linter's golden view models
(`pkg/view/testdata/golden`), byte for byte at the commit `SOURCE` names. The
pure tests read every one back whole, check that the expansions the mod sends
are the golden queries' own, and draw them under the 100 000-character
limit. ktn-linter is private, so a public CI cannot read the pinned commit:
CI holds only the pin (`SOURCE`'s sha is `KTN_LINTER_SHA`), and
`scripts/sync-ktn-fixtures.sh --check` is the maintainer's byte-for-byte check
through `gh` (without an argument it rewrites the copies from the pin).

## Tests and CI

```
make mod-check        # all of it, as CI runs it (from the repository root)
make mod-pure         # pure modules under node --test, no engine
make mod-engine       # claude plugin test, behind its precondition
```

Node 22.18 or later runs the TypeScript as it is. No npm dependency.

The lanes (kodflow/ktn-linter#788), none of which can redden ktn-linter's
release — the plugin is published here, by commit or by its own
`kodflow-ktn/v*` tags (`kodflow-ktn-release.yml`, gated on `make mod-check`):

- **`mod-ktn` in `ci.yml`, blocking.** The pure modules first, before the
  engine is installed, so their verdict stands whatever happens to it; then
  `make mod-check` on Claude Code pinned by `CLAUDE_CODE_VERSION`, bumped by
  hand: the validator (one `session.start`, no tool hook, and the surface —
  the events hooked and the `$` calls made — equal to
  `tests/fixtures/surface.json`), then `claude plugin test`.
- **The precondition.** `claude plugin test` exits 1 when hooks modules are
  turned off on the machine (a remote switch, `disableAllHooks`). The engine
  is first asked about a probe mod with one passing test
  (`scripts/mod-lane/probe`): "turned off" there ends the lane neutral with a
  `::warning::`, never red; any other failure of the probe stays red.
- **`mod-latest.yml`, advisory.** Daily and on demand, never on a push or a
  pull request, in no `needs`: the latest Claude Code against the committed
  surface, the validator's findings and the engine suite's verdict, kept in
  one rolling issue labelled `mod-latest` (two runs on the same gap write
  nothing; a run with no gap closes it).
- **`make ci-gates-check`** reads the workflows as YAML: `mod-check` is run by
  a blocking job of `ci.yml`, every `make` target a workflow runs exists, the
  advisory workflow stays off push and pull requests and out of every `needs`,
  `actions/setup-node` is pinned by a 40-character sha.
  `make mod-lane-check` tests all of the above against a fake engine and a
  fake `gh`.

A change to the surface (a new event, a new `$` call) rewrites
`tests/fixtures/surface.json` in the same change:
`python3 scripts/mod-surface.py surface <claude plugin validate --json report>`.

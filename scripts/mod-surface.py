#!/usr/bin/env python3
"""What a mod uses of the engine, read from `claude plugin validate --json`.

kodflow/ktn-linter#788. The mod's SURFACE is the set of events it hooks and
the set of `$` calls it makes, as the validator reads them from the source.
That set is committed (tests/fixtures/surface.json of the plugin): the pinned
lane holds the source to it, and the latest lane compares the engine's
reading of it — and nothing else — with what the pinned engine read.

  mod-surface.py validate <plugin> [--baseline FILE] [--report FILE]
      run the validator (CLAUDE_BIN, default claude), fail on any error or
      warning but the "version" one, on a module that was not read, on a
      second session.start, on any tool hook, and — with --baseline — on a
      surface that differs from the committed one. --report keeps the JSON.

  mod-surface.py surface <report.json>
      print the surface the report reads, as the baseline is written.

  mod-surface.py gap <report.json> <baseline> <lane verdict>
      the latest lane's comparison: one line per difference (an error or a
      warning of the validator, an event or a call of the baseline the engine
      no longer reads, an event or a call it now reads that the baseline does
      not hold, a failed engine suite). Nothing printed: no gap.
"""
import json
import os
import re
import subprocess
import sys

TOOL_EVENTS = {"tool.call", "tool.check", "classic.PreToolUse", "classic.PostToolUse", "classic.PostToolUseFailure"}
HOOKS_NOTE = re.compile(r"^(\./\S+) hooks: (.*)$")
CALLS_NOTE = re.compile(r"^\./\S+ calls: (.*)$")


def run_validate(plugin):
    claude = os.environ.get("CLAUDE_BIN", "claude")
    r = subprocess.run([claude, "plugin", "validate", "--strict", "--json", plugin], capture_output=True, text=True)
    try:
        return json.loads(r.stdout)
    except json.JSONDecodeError:
        sys.stderr.write(r.stdout + r.stderr)
        print("::error::the validator wrote no JSON report")
        sys.exit(1)


def parts(report):
    return [report.get("manifest", {})] + list(report.get("contents", []))


def problems(report):
    out = []
    for p in parts(report):
        out += ["error: %s" % e.get("message", e) if isinstance(e, dict) else "error: %s" % e for e in p.get("errors", [])]
        out += ["warning: %s" % w.get("message", w) for w in p.get("warnings", []) if not (isinstance(w, dict) and w.get("path") == "version")]
    return out


def split_events(text):
    # "a, b{component=Pane, requestId=x}, c": a matcher holds commas of its own
    return re.findall(r"([\w.]+)(?:\{[^}]*\})?(?:, |$)", text.strip())


def surface(report):
    hooked, events, calls = [], [], set()
    for p in parts(report):
        for note in p.get("notes", []):
            m = HOOKS_NOTE.match(note)
            if m:
                hooked.append(m.group(1))
                events += split_events(m.group(2))
            m = CALLS_NOTE.match(note)
            if m:
                calls.update(re.findall(r"\$\.[\w.]+", m.group(1)))
    return hooked, events, sorted(calls)


def surface_value(report):
    _, events, calls = surface(report)
    return {"events": sorted(set(events)), "calls": calls}


def cmd_validate(args):
    plugin = args[0]
    baseline = args[args.index("--baseline") + 1] if "--baseline" in args else None
    report_path = args[args.index("--report") + 1] if "--report" in args else None
    report = run_validate(plugin)
    if report_path:
        with open(report_path, "w") as f:
            json.dump(report, f, indent=1)
    bad = problems(report)
    for item in bad:
        print("::error::%s" % item)
    hooked, events, _ = surface(report)
    if len(hooked) != 1:
        print("::error::%d hooks modules read, exactly one expected" % len(hooked))
        bad.append("modules")
    if events.count("session.start") != 1:
        print("::error::%d session.start hooks, exactly one expected" % events.count("session.start"))
        bad.append("start")
    tools = [e for e in events if e in TOOL_EVENTS]
    if tools:
        print("::error::tool hooks registered: %s" % tools)
        bad.append("tools")
    if baseline:
        want = json.load(open(baseline))
        got = surface_value(report)
        if got != want:
            print("::error::the mod's surface moved: rewrite %s (scripts/mod-surface.py surface)" % baseline)
            print("  committed: %s" % json.dumps(want, sort_keys=True))
            print("  read:      %s" % json.dumps(got, sort_keys=True))
            bad.append("surface")
    print("hooks:", events)
    return 1 if bad else 0


def cmd_surface(args):
    print(json.dumps(surface_value(json.load(open(args[0]))), indent=2))
    return 0


def cmd_gap(args):
    baseline, verdict = json.load(open(args[1])), args[2]
    lines = []
    try:
        report = json.load(open(args[0]))
    except (OSError, json.JSONDecodeError):
        report = {}
        lines.append("validator wrote no JSON report")
    got = surface_value(report)
    lines += ["validator %s" % p for p in problems(report)]
    for key, label in (("events", "event"), ("calls", "call")):
        lines += ["%s no longer read: %s" % (label, x) for x in baseline[key] if x not in got[key]]
        lines += ["%s read but not committed: %s" % (label, x) for x in got[key] if x not in baseline[key]]
    if verdict == "fail":
        lines.append("claude plugin test failed")
    for line in sorted(set(lines)):
        print(line)
    return 0


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    cmd, args = sys.argv[1], sys.argv[2:]
    return {"validate": cmd_validate, "surface": cmd_surface, "gap": cmd_gap}[cmd](args)


if __name__ == "__main__":
    sys.exit(main())

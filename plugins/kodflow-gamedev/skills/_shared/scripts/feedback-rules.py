#!/usr/bin/env python3
"""The owner's feedback ADRs, and the rules they add up to.

    python3 -I feedback-rules.py build  [--root DIR]   write docs/adr/feedback/.RULES.md
    python3 -I feedback-rules.py check  [--root DIR]   exit 0 when .RULES.md is current
    python3 -I feedback-rules.py hash   [--root DIR]   print the hash of the ADR set
    python3 -I feedback-rules.py new    [--root DIR] --slug S --header H.json --observed O.txt [--context C.md]
    python3 -I feedback-rules.py export [--root DIR] --out F.json   confirmed constraints, move-constraints/v1
    python3 -I feedback-rules.py record-run [--root DIR] --file RUN.json   docs/anim/runs/<id>.json

An ADR is docs/adr/feedback/<YYYYMMDD-HHMMSS>-<slug>-<4hex>.md, opened by a
```json block (feedback-adr/v1) and followed by the owner's words verbatim.
It is created once, exclusively, and never edited: a correction is a new ADR
whose `supersedes` names the old one. .RULES.md is derived, never committed
(the project ignores it), so two branches never conflict over it.

The ADR set's hash is the sha256 of the lines `<sha256 of file>  <name>`,
names in byte order, one per ADR. rules-digest.sh computes the same with
shasum, which is how a hook that must not write tells a stale .RULES.md.

Every failure is named: an unreadable ADR, an unknown schema, a dangling
`supersedes`, a cycle, a fork (two ADRs superseding the same one). A rules
file built over any of them would state rules nobody can trace.

Standard library only, Python 3.9 or later.
"""
import argparse
import datetime
import hashlib
import json
import os
import pathlib
import re
import secrets
import sys
import tempfile

ADR_DIR = pathlib.Path("docs/adr/feedback")
RUNS_DIR = pathlib.Path("docs/anim/runs")
RULES = ".RULES.md"
NAME = re.compile(r"^[0-9]{8}-[0-9]{6}-[a-z0-9][a-z0-9-]*-[0-9a-f]{4}\.md$")
SLUG = re.compile(r"^[a-z0-9][a-z0-9-]{0,47}$")
KNOWN_SCHEMAS = ("feedback-adr/v1",)
HEADER = re.compile(r"```json[ \t]*\n(.*?)\n```", re.S)
REQUIRED = ("schema", "verdict", "rule", "scope", "supersedes", "reach", "subject", "constraint")


class Fault(Exception):
    pass


def adr_files(root):
    d = root / ADR_DIR
    if not d.is_dir():
        return []
    return sorted((p for p in d.iterdir() if p.is_file() and NAME.match(p.name)),
                  key=lambda p: p.name.encode())


def set_hash(files):
    lines = "".join(f"{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.name}\n" for p in files)
    return hashlib.sha256(lines.encode()).hexdigest()


def validate_header(h, where):
    if not isinstance(h, dict):
        raise Fault(f"{where}: the header is not a JSON object")
    missing = [k for k in REQUIRED if k not in h]
    if missing:
        raise Fault(f"{where}: header lacks {', '.join(missing)}")
    if h["schema"] not in KNOWN_SCHEMAS:
        raise Fault(f"{where}: unknown schema {h['schema']!r} (known: {', '.join(KNOWN_SCHEMAS)})")
    if h["verdict"] not in ("good", "bad"):
        raise Fault(f"{where}: verdict must be good or bad")
    if h["reach"] not in ("project", "general"):
        raise Fault(f"{where}: reach must be project or general")
    if not isinstance(h["rule"], str) or not h["rule"].strip():
        raise Fault(f"{where}: empty rule")
    if not isinstance(h["scope"], list) or not all(isinstance(s, str) for s in h["scope"]):
        raise Fault(f"{where}: scope must be a list of tags")
    if not isinstance(h["supersedes"], list) or not all(isinstance(s, str) and NAME.match(s) for s in h["supersedes"]):
        raise Fault(f"{where}: supersedes must list ADR file names")
    sub = h["subject"]
    if not isinstance(sub, dict) or any(k not in sub for k in ("spec", "constraints_sha256", "clip", "commit", "credits")):
        raise Fault(f"{where}: subject needs spec, constraints_sha256, clip, commit, credits")
    c = h["constraint"]
    if c != "unmeasured":
        if not isinstance(c, dict) or any(k not in c for k in ("kind", "measured", "threshold", "status")):
            raise Fault(f"{where}: constraint must be \"unmeasured\" or carry kind, measured, threshold, status")
        if c["status"] not in ("proposed", "confirmed"):
            raise Fault(f"{where}: constraint status must be proposed or confirmed")


def read_adr(p):
    try:
        text = p.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as e:
        raise Fault(f"{p.name}: unreadable ({e})")
    m = HEADER.search(text)
    if not m:
        raise Fault(f"{p.name}: no ```json header block")
    try:
        h = json.loads(m.group(1))
    except ValueError as e:
        raise Fault(f"{p.name}: header is not JSON ({e})")
    validate_header(h, p.name)
    return h


def load(root):
    files = adr_files(root)
    adrs = {p.name: read_adr(p) for p in files}
    superseded_by = {}
    for name, h in adrs.items():
        for old in h["supersedes"]:
            if old not in adrs:
                raise Fault(f"{name}: supersedes {old}, which does not exist")
            if old == name:
                raise Fault(f"{name}: supersedes itself")
            if old in superseded_by:
                raise Fault(f"fork: {old} is superseded by both {superseded_by[old]} and {name}")
            superseded_by[old] = name
    for start in adrs:
        seen, cur = set(), start
        while cur in superseded_by:
            if cur in seen:
                raise Fault(f"cycle in supersedes through {cur}")
            seen.add(cur)
            cur = superseded_by[cur]
    active = {n: h for n, h in adrs.items() if n not in superseded_by}
    return files, adrs, active


def section_of(h):
    c = h["constraint"]
    if c == "unmeasured":
        return "advisory"
    return "hard" if c["status"] == "confirmed" else "proposed"


def rule_line(name, h):
    c = h["constraint"]
    measure = ""
    if c != "unmeasured":
        measure = f" | {c['kind']} {json.dumps(c['threshold'], sort_keys=True, separators=(',', ':'))}"
    tags = ",".join(h["scope"])
    return f"- {h['verdict']} | {h['rule'].strip()} | scope={tags}{measure} | {name}"


def render(files, active):
    digest = set_hash(files)
    out = [f"<!-- feedback-rules v1 sha256:{digest} adrs:{len(files)} active:{len(active)} -->",
           "# Owner feedback rules (generated by feedback-rules.py — do not edit, do not commit)", ""]
    titles = {"hard": "## Hard (constraint confirmed by the owner)",
              "proposed": "## Proposed (measured, threshold not confirmed yet)",
              "advisory": "## Advisory (not measurable)"}
    for sec in ("hard", "proposed", "advisory"):
        names = sorted((n for n, h in active.items() if section_of(h) == sec), key=lambda n: n.encode(), reverse=True)
        out.append(titles[sec])
        out.extend(rule_line(n, active[n]) for n in names)
        if not names:
            out.append("- (none)")
        out.append("")
    return digest, "\n".join(out)


def atomic_write(path, text, exclusive=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    if exclusive:
        fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
        return
    fd, tmp = tempfile.mkstemp(prefix=".tmp-", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
        os.chmod(tmp, 0o644)
        os.replace(tmp, str(path))
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def current_hash(rules_path):
    try:
        first = rules_path.read_text(encoding="utf-8").split("\n", 1)[0]
    except OSError:
        return None
    m = re.search(r"sha256:([0-9a-f]{64})", first)
    return m.group(1) if m else None


IGNORE = ".RULES.md\n.tmp-*\n"


def cmd_build(root, _a):
    files, _adrs, active = load(root)
    digest, text = render(files, active)
    ign = root / ADR_DIR / ".gitignore"
    if not ign.exists():
        atomic_write(ign, IGNORE)
    atomic_write(root / ADR_DIR / RULES, text + "\n")
    print(f"RULES {digest} ({len(active)} active of {len(files)})")
    return 0


def cmd_check(root, _a):
    files = adr_files(root)
    want = set_hash(files)
    have = current_hash(root / ADR_DIR / RULES)
    if have == want:
        print(f"RULES current {want}")
        return 0
    print(f"RULES stale: have {have or 'none'}, want {want}", file=sys.stderr)
    return 1


def cmd_hash(root, _a):
    print(set_hash(adr_files(root)))
    return 0


def cmd_new(root, a):
    if not SLUG.match(a.slug):
        raise Fault(f"slug {a.slug!r} must match {SLUG.pattern}")
    try:
        header = json.loads(pathlib.Path(a.header).read_text(encoding="utf-8"))
        observed = pathlib.Path(a.observed).read_text(encoding="utf-8").strip()
        context = pathlib.Path(a.context).read_text(encoding="utf-8").strip() if a.context else ""
    except (OSError, ValueError) as e:
        raise Fault(f"cannot read the new ADR's inputs: {e}")
    if not observed:
        raise Fault("the owner's words (--observed) are empty: an ADR without them records nothing")
    validate_header(header, "new ADR")
    _files, adrs, _active = load(root)
    for old in header["supersedes"]:
        if old not in adrs:
            raise Fault(f"new ADR supersedes {old}, which does not exist")
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d-%H%M%S")
    quoted = "\n".join("> " + line if line else ">" for line in observed.splitlines())
    body = (f"# Feedback ({header['verdict']}): {header['rule'].strip()}\n\n"
            f"```json\n{json.dumps(header, indent=2, ensure_ascii=False)}\n```\n\n"
            f"## Observed\n\n{quoted}\n")
    if context:
        body += f"\n## Context\n\n{context}\n"
    for _ in range(8):
        path = root / ADR_DIR / f"{stamp}-{a.slug}-{secrets.token_hex(2)}.md"
        try:
            atomic_write(path, body, exclusive=True)
            break
        except FileExistsError:
            continue
    else:
        raise Fault("could not find a free ADR name after 8 tries")
    print(path.relative_to(root))
    return cmd_build(root, a)


def cmd_export(root, a):
    _files, _adrs, active = load(root)
    constraints, skipped = [], []
    for name in sorted(active, key=lambda n: n.encode()):
        c = active[name]["constraint"]
        if c == "unmeasured" or c["status"] != "confirmed":
            continue
        d = c.get("definition")
        if not isinstance(d, dict) or "clip" not in d:
            skipped.append(name)
            continue
        d = dict(d, status="confirmed", severity="hard", source=name)
        constraints.append(d)
    doc = {"schema_version": "move-constraints/v1", "move": "owner-feedback", "fps": 30,
           "rig_map": "docs/anim/rig-map.json", "clip": "", "constraints": constraints}
    atomic_write(pathlib.Path(a.out), json.dumps(doc, indent=2, ensure_ascii=False) + "\n")
    print(f"exported {len(constraints)} confirmed constraint(s)" +
          (f"; {len(skipped)} without a definition with a clip: {', '.join(skipped)}" if skipped else ""))
    return 0


def cmd_record_run(root, a):
    try:
        run = json.loads(pathlib.Path(a.file).read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        raise Fault(f"cannot read the run: {e}")
    for k in ("slug", "agents", "verdict"):
        if k not in run:
            raise Fault(f"run lacks {k}")
    if not SLUG.match(str(run["slug"])):
        raise Fault(f"run slug {run['slug']!r} is not a slug")
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d-%H%M%S")
    path = root / RUNS_DIR / f"{stamp}-{run['slug']}-{secrets.token_hex(2)}.json"
    atomic_write(path, json.dumps(run, indent=2, ensure_ascii=False, sort_keys=True) + "\n", exclusive=True)
    print(path.relative_to(root))
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("command", choices=("build", "check", "hash", "new", "export", "record-run"))
    ap.add_argument("--root", default=".")
    ap.add_argument("--slug")
    ap.add_argument("--header")
    ap.add_argument("--observed")
    ap.add_argument("--context")
    ap.add_argument("--out")
    ap.add_argument("--file")
    a = ap.parse_args(argv)
    root = pathlib.Path(a.root).resolve()
    need = {"new": ("slug", "header", "observed"), "export": ("out",), "record-run": ("file",)}
    for k in need.get(a.command, ()):
        if getattr(a, k) is None:
            ap.error(f"{a.command} needs --{k}")
    fn = {"build": cmd_build, "check": cmd_check, "hash": cmd_hash, "new": cmd_new,
          "export": cmd_export, "record-run": cmd_record_run}[a.command]
    try:
        return fn(root, a)
    except Fault as e:
        print(f"feedback-rules: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())

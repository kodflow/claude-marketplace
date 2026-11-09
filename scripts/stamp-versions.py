#!/usr/bin/env python3
"""Stamp every plugin with a version derived from its own content.

Why a version at all: `claude plugin validate --strict` fails on "No version
specified", and a plain strict run is the bar. Why not a hand-bumped one:
`claude plugin update` detects an update by comparing the computed version, and
a `version` in plugin.json wins over the commit SHA
(https://code.claude.com/docs/en/plugins/loading.md#versions-and-updates), so a
version nobody remembers to bump would freeze every user on their cached copy.

The version is therefore a pure function of what the plugin ships: it changes
exactly when a file under the plugin changes, and not otherwise. It is
`0.0.0-r<12 hex>` over the git index entries of the plugin directory (mode,
blob id, path), with plugin.json taken as canonical JSON minus its own
`version` key, so stamping the version does not change the version.

    scripts/stamp-versions.py            rewrite plugin.json where stale
    scripts/stamp-versions.py --check    exit 1 and list stale plugins
"""
import hashlib, json, pathlib, re, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
MANIFEST = ".claude-plugin/plugin.json"


def git(*args, raw=False):
    out = subprocess.run(["git", "-C", str(ROOT), *args], check=True,
                         capture_output=True).stdout
    return out if raw else out.decode()


def compute(plugin):
    h = hashlib.sha256()
    prefix = f"plugins/{plugin}/"
    entries = git("ls-files", "-s", "-z", "--", prefix).split("\0")
    for entry in sorted(e for e in entries if e):
        meta, path = entry.split("\t", 1)
        mode, blob, _stage = meta.split()
        if path == prefix + MANIFEST:
            doc = json.loads(git("cat-file", "blob", blob, raw=True))
            doc.pop("version", None)
            blob = hashlib.sha256(
                json.dumps(doc, sort_keys=True, ensure_ascii=False).encode()
            ).hexdigest()
        h.update(f"{mode} {blob} {path}\n".encode())
    return "0.0.0-r" + h.hexdigest()[:12]


def stamp(text, version):
    line = f'"version": "{version}"'
    if re.search(r'^\s*"version"\s*:', text, re.M):
        return re.sub(r'("version"\s*:\s*)"[^"]*"', rf'\g<1>"{version}"', text, count=1)
    return re.sub(r'(^\s*"name"\s*:\s*"[^"]*",?)(\n)',
                  lambda m: m.group(1).rstrip(",") + ",\n  " + line + ("," if m.group(1).endswith(",") else "") + m.group(2),
                  text, count=1, flags=re.M)


def main():
    check = "--check" in sys.argv
    stale = []
    for d in sorted((ROOT / "plugins").iterdir()):
        mf = d / MANIFEST
        if not mf.is_file():
            continue
        want = compute(d.name)
        text = mf.read_text()
        have = json.loads(text).get("version")
        if have == want:
            continue
        stale.append(f"{d.name}: {have} -> {want}")
        if not check:
            mf.write_text(stamp(text, want))
            assert json.loads(mf.read_text())["version"] == want
    for s in stale:
        print(("stale " if check else "stamped ") + s)
    if check and stale:
        print("run scripts/stamp-versions.py and commit the result", file=sys.stderr)
        sys.exit(1)


main()

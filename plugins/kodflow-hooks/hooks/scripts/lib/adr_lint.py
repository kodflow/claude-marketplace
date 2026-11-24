#!/usr/bin/env python3
"""adr_lint.py - the ADR header contract, stdlib only.

An ADR is docs/adr/NNNN-slug.md whose header (the bullets before the first
"## " heading, or a MADR front matter) carries:

  Status  first word in proposed|accepted|rejected|deprecated|superseded|amended
          ("superseded by NNNN" must name an existing ADR)
  Date    YYYY-MM-DD
  Area    one or more comma-separated tags; each must be listed in
          docs/adr/areas.txt when that file exists, free otherwise
  Need    decision|constraint|incident|convention|record

Both "- Status: x" and "- **Status**: x" are read.

  adr_lint.py --check PATH [--strict]     PATH is a directory or one file;
                                          one line per defect, exit 0 unless
                                          --strict and a defect exists
  adr_lint.py --hook FILE [--strict]      the hook's view: the tool input
                                          (JSON on stdin) applied to FILE;
                                          prints "BLOCK <line>" for a defect
                                          the Area/Need rule refuses, then
                                          "WARN <line>" for the others
"""
import json
import os
import re
import sys

STATUSES = ("proposed", "accepted", "rejected", "deprecated", "superseded", "amended")
NEEDS = ("decision", "constraint", "incident", "convention", "record")
NAME_RE = re.compile(r"^(\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$")
BULLET_RE = re.compile(r"^\s*[-*]\s+(?:\*\*)?([A-Za-z][A-Za-z ]*?)(?:\*\*)?\s*:\s*(?:\*\*)?\s*(.*?)\s*$")
FM_RE = re.compile(r"^([A-Za-z][A-Za-z_-]*)\s*:\s*(.*?)\s*$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def parse_header(text):
    """Return {lowercase key: value} from the bullets or front matter."""
    lines = text.splitlines()
    out = {}
    i = 0
    if lines and lines[0].strip() == "---":
        for i in range(1, len(lines)):
            if lines[i].strip() == "---":
                i += 1
                break
            m = FM_RE.match(lines[i])
            if m:
                out.setdefault(m.group(1).lower(), m.group(2).strip("\"' "))
    for ln in lines[i:]:
        if ln.startswith("## "):
            break
        m = BULLET_RE.match(ln)
        if m:
            out.setdefault(m.group(1).strip().lower(), m.group(2).strip("* "))
    return out


def vocabulary(adir):
    path = os.path.join(adir, "areas.txt")
    if not os.path.isfile(path):
        return None
    with open(path, encoding="utf-8") as fh:
        return {w.strip().lower() for w in fh if w.strip() and not w.lstrip().startswith("#")}


def numbers(adir):
    nums = {}
    try:
        names = sorted(os.listdir(adir))
    except OSError:
        return nums
    for n in names:
        m = NAME_RE.match(n)
        if m:
            nums.setdefault(m.group(1), []).append(n)
    return nums


def lint_text(name, text, adir, nums=None, vocab=None):
    """Return [(kind, message)]; kind is 'shape' or 'header' (Area/Need rule)."""
    defects = []
    m = NAME_RE.match(name)
    if not m:
        defects.append(("shape", "file name is not NNNN-slug.md"))
    else:
        nums = numbers(adir) if nums is None else nums
        if len(nums.get(m.group(1), [])) > 1:
            defects.append(("shape", "number %s is used by %s" % (m.group(1), ", ".join(nums[m.group(1)]))))
    h = parse_header(text)
    st = h.get("status", "")
    word = re.sub(r"[^a-z]", "", st.split()[0].lower()) if st.split() else ""
    if not st:
        defects.append(("shape", "missing Status"))
    elif word not in STATUSES:
        defects.append(("shape", "Status '%s' does not start with one of %s" % (st, "|".join(STATUSES))))
    sb = re.search(r"superseded\s+by\s+[\[(]*(?:ADR[- ]?)?0*(\d+)", st, re.I)
    if word == "superseded" and not sb:
        defects.append(("shape", "superseded without 'superseded by NNNN'"))
    if sb:
        target = "%04d" % int(sb.group(1))
        if target not in (numbers(adir) if nums is None else nums):
            defects.append(("shape", "superseded by %s: no such ADR" % target))
    d = h.get("date", "")
    if not DATE_RE.match(d):
        defects.append(("shape", "missing or non-ISO Date" if not d else "Date '%s' is not YYYY-MM-DD" % d))
    area = h.get("area", "")
    if not area:
        defects.append(("header", "missing Area"))
    else:
        vocab = vocabulary(adir) if vocab is None else vocab
        if vocab is not None:
            bad = [t for t in re.split(r"[,\s]+", area.lower()) if t and t not in vocab]
            if bad:
                defects.append(("header", "Area '%s' not in areas.txt" % ", ".join(bad)))
    need = h.get("need", "")
    if not need:
        defects.append(("header", "missing Need"))
    elif need.lower() not in NEEDS:
        defects.append(("header", "Need '%s' is not one of %s" % (need, "|".join(NEEDS))))
    return defects


def check(path):
    files = []
    if os.path.isdir(path):
        adir = path
        files = [os.path.join(path, n) for n in sorted(os.listdir(path))
                 if n.endswith(".md") and n[:1].isdigit()]
    else:
        adir = os.path.dirname(os.path.abspath(path))
        files = [path]
    nums, vocab = numbers(adir), vocabulary(adir)
    lines = []
    for f in files:
        try:
            with open(f, encoding="utf-8", errors="replace") as fh:
                text = fh.read()
        except OSError as e:
            lines.append("%s: unreadable (%s)" % (f, e))
            continue
        for _, msg in lint_text(os.path.basename(f), text, adir, nums, vocab):
            lines.append("%s: %s" % (f, msg))
    return lines


def hook(path, ti):
    """The file as the tool would leave it: Write content, or Edit applied."""
    text = None
    if isinstance(ti.get("content"), str):
        text = ti["content"]
    else:
        try:
            with open(path, encoding="utf-8") as fh:
                text = fh.read()
        except OSError:
            return []
        edits = ti.get("edits") if isinstance(ti.get("edits"), list) else [ti]
        for e in edits:
            old, new = e.get("old_string"), e.get("new_string")
            if isinstance(old, str) and isinstance(new, str) and old:
                text = text.replace(old, new) if e.get("replace_all") else text.replace(old, new, 1)
    adir = os.path.dirname(os.path.abspath(path))
    return lint_text(os.path.basename(path), text, adir)


def main(argv):
    strict = "--strict" in argv
    args = [a for a in argv if a != "--strict"]
    if len(args) == 2 and args[0] == "--check":
        lines = check(args[1])
        for ln in lines:
            print(ln)
        return 1 if (strict and lines) else 0
    if len(args) == 2 and args[0] == "--hook":
        try:
            ti = json.load(sys.stdin)
        except ValueError:
            return 0
        for kind, msg in hook(args[1], ti if isinstance(ti, dict) else {}):
            print("%s %s: %s" % ("BLOCK" if kind == "header" else "WARN", args[1], msg))
        return 0
    sys.stderr.write(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

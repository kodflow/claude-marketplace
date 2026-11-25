#!/usr/bin/env python3
"""kf_docs.py - full-text index of a repository's documents, stdlib only.

SQLite FTS5 with BM25 ranking, no network, no third-party import.

  kf_docs.py index [--root DIR] [--global] [--quiet]
  kf_docs.py search QUERY [--root DIR] [--area A] [--need N] [--status S]
                          [--all] [--no-global] [--limit 8]
                          [--format text|json|md] [--no-refresh]
  kf_docs.py map [--root DIR] [--max-lines 60] [--max-bytes 3600]
  kf_docs.py budget [--root DIR]
  kf_docs.py export --obsidian DIR [--root DIR]

Indexed per repository (~/.cache/kodflow/docs-index/<sha1(git root)>.db):
docs/adr/*.md split by "## " section, docs/**/*.md, every CLAUDE.md and NOTES.md (the overflow
sibling of a CLAUDE.md). A global
index (global.db) holds ~/.claude/docs and ~/.claude/projects/*/memory.
Incremental: a file is read again only when its mtime or size changed.

The tokenizer is unicode61 with tokenchars '.-_/', so 0.2.57, ADR-0152 and
net/http1 stay one token; `num` is an exact column (an ADR's NNNN). A search
returns at most --limit hits (default 8), each a line plus a snippet of at
most 200 characters: never a whole document. Superseded ADRs are left out
unless --all. KODFLOW_DOCS_CACHE overrides the cache directory.

`map` prints the decision map SessionStart injects: accepted ADRs grouped by
Area ("-" when absent), a short title and the amends / supersedes edges, at
most --max-lines lines and --max-bytes bytes (ADRs with edges first, then the
newest; the rest is counted, not listed). It reads the ADR headers only: no
index, no cache. `budget` prints one line when a CLAUDE.md exceeds
KODFLOW_CLAUDE_MD_LINES lines (200, the official "target under 200 lines",
https://code.claude.com/docs/en/memory); a subdirectory one over
KODFLOW_CLAUDE_MD_TRUNC_CHARS characters (40000) is flagged first as
truncated on a 200K window. Nothing otherwise. `export --obsidian` writes one generated note a decision
with [[ADR-NNNN]] links; the notes are an output, never a source.
"""
import argparse
import hashlib
import json
import os
import re
import sqlite3
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from adr_lint import parse_header  # noqa: E402

SNIPPET = 200
BODY_CAP = 40000
SKIP_DIRS = {".git", "node_modules", "vendor", ".worktrees", ".venv", "dist", "build", "third_party"}
ADR_RE = re.compile(r"(?:^|/)docs/adr/(\d{4})-[^/]+\.md$")
COLS = ("path", "num", "title", "status", "area", "need", "date", "section",
        "line", "body", "supersedes", "superseded_by")
SCHEMA = """
CREATE TABLE IF NOT EXISTS files(path TEXT PRIMARY KEY, mtime INTEGER, size INTEGER);
CREATE VIRTUAL TABLE IF NOT EXISTS docs USING fts5(
  path, num, title, status, area, need, date, section,
  line UNINDEXED, body, supersedes, superseded_by,
  tokenize = "unicode61 tokenchars '.-_/'"
);
"""


def cache_dir():
    d = os.environ.get("KODFLOW_DOCS_CACHE")
    return d or os.path.join(os.path.expanduser("~"), ".cache", "kodflow", "docs-index")


def git_root(start):
    try:
        out = subprocess.run(["git", "-C", start, "rev-parse", "--show-toplevel"],
                             capture_output=True, text=True, timeout=5)
        if out.returncode == 0 and out.stdout.strip():
            return os.path.realpath(out.stdout.strip())
    except (OSError, subprocess.SubprocessError):
        pass
    return os.path.realpath(start)


def db_path(root):
    if root is None:
        name = "global"
    else:
        name = hashlib.sha1(root.encode()).hexdigest()
    return os.path.join(cache_dir(), name + ".db")


VERSION = 3  # bump when what a row holds changes: the index is rebuilt


def connect(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    con = sqlite3.connect(path, timeout=5)
    if con.execute("PRAGMA user_version").fetchone()[0] != VERSION:
        con.executescript("DROP TABLE IF EXISTS docs; DROP TABLE IF EXISTS files;")
        con.execute("PRAGMA user_version = %d" % VERSION)
    con.executescript(SCHEMA)
    return con


def repo_files(root):
    """Markdown files worth indexing: docs/**/*.md, every CLAUDE.md and NOTES.md."""
    names = []
    try:
        out = subprocess.run(
            ["git", "-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
            capture_output=True, timeout=20)
        if out.returncode == 0:
            names = [n for n in out.stdout.decode("utf-8", "replace").split("\0") if n]
    except (OSError, subprocess.SubprocessError):
        names = []
    if not names:
        for d, dirs, files in os.walk(root):
            dirs[:] = [x for x in dirs if x not in SKIP_DIRS]
            for f in files:
                names.append(os.path.relpath(os.path.join(d, f), root))
    keep = []
    for n in names:
        if not n.endswith(".md"):
            continue
        parts = n.split("/")
        if any(p in SKIP_DIRS for p in parts[:-1]):
            continue
        if parts[-1] in ("CLAUDE.md", "NOTES.md") or parts[0] == "docs":
            keep.append(os.path.join(root, n))
    return keep


def global_files():
    home = os.path.expanduser("~")
    out = []
    for base in (os.path.join(home, ".claude", "docs"),):
        for d, dirs, files in os.walk(base):
            dirs[:] = [x for x in dirs if x not in SKIP_DIRS]
            out += [os.path.join(d, f) for f in files if f.endswith(".md")]
    proj = os.path.join(home, ".claude", "projects")
    try:
        for p in os.listdir(proj):
            m = os.path.join(proj, p, "memory")
            if os.path.isdir(m):
                out += [os.path.join(m, f) for f in os.listdir(m) if f.endswith(".md")]
    except OSError:
        pass
    return out


def status_word(raw):
    m = re.match(r"[A-Za-z]+", raw or "")
    return m.group(0).lower() if m else ""


def superseded_by(raw):
    m = re.search(r"superseded\s+by\s+(?:ADR[- ]?)?(\d{1,4})", raw or "", re.I)
    return m.group(1).zfill(4) if m else ""


TRAIL_RE = re.compile(r"(?<=\w)[.\-_/]+(?=\s|$|[)\]}\"',;:!?])")


def sections(text):
    """[(heading, first line, body)]: the preamble, then one per '## '."""
    out, name, start, buf = [], "", 1, []
    for i, ln in enumerate(text.splitlines(), 1):
        if ln.startswith("## "):
            out.append((name, start, "\n".join(buf)))
            name, start, buf = ln[3:].strip(), i, []
        else:
            buf.append(ln)
    out.append((name, start, "\n".join(buf)))
    return [s for s in out if s[2].strip() or s[0]]


def rows_for(path, rel):
    with open(path, encoding="utf-8", errors="replace") as fh:
        text = fh.read()
    m = ADR_RE.search(rel)
    num = m.group(1) if m else ""
    head = parse_header(text) if m else {}
    t = re.search(r"^#\s+(.+?)\s*$", text, re.M)
    title = t.group(1) if t else os.path.basename(path)
    if num:
        title = re.sub(r"^(?:ADR[- ]?)?0*%s[.:\s\u2014\u2013-]+" % int(num), "", title, flags=re.I) or title
        title = title.lstrip("\u2014\u2013- ") or title
    raw = head.get("status", "")
    status = status_word(raw)
    sup_by = superseded_by(raw)
    if sup_by and status != "superseded":
        sup_by = ""
    sup = re.findall(r"\d{4}", head.get("supersedes", ""))
    rows = []
    for name, line, body in sections(text):
        rows.append((rel, num, title, status, head.get("area", ""), head.get("need", "").lower(),
                     head.get("date", ""), name or "header", line, TRAIL_RE.sub("", body[:BODY_CAP]),
                     " ".join(sup), sup_by))
    return rows


def index_files(con, files, label):
    """Bring the index in line with `files` (absolute paths -> stored key)."""
    known = {r[0]: (r[1], r[2]) for r in con.execute("SELECT path, mtime, size FROM files")}
    seen, changed = set(), 0
    for key, path in files:
        try:
            st = os.stat(path)
        except OSError:
            continue
        seen.add(key)
        sig = (int(st.st_mtime_ns), st.st_size)
        if known.get(key) == sig:
            continue
        con.execute("DELETE FROM docs WHERE path = ?", (key,))
        try:
            rows = rows_for(path, key)
        except OSError:
            continue
        con.executemany("INSERT INTO docs(%s) VALUES (%s)" % (",".join(COLS), ",".join("?" * len(COLS))), rows)
        con.execute("INSERT OR REPLACE INTO files VALUES (?,?,?)", (key, sig[0], sig[1]))
        changed += 1
    for gone in set(known) - seen:
        con.execute("DELETE FROM docs WHERE path = ?", (gone,))
        con.execute("DELETE FROM files WHERE path = ?", (gone,))
        changed += 1
    con.commit()
    return changed


def build(root):
    """Index `root` (a git root), or the global set when root is None."""
    con = connect(db_path(root))
    if root is None:
        files = [(p, p) for p in global_files()]
    else:
        files = [(os.path.relpath(p, root), p) for p in repo_files(root)]
    n = index_files(con, files, root)
    con.close()
    return n


def fts_query(q, mode):
    terms = [t.strip(".-_/") or t for t in re.findall(r"[^\s\"']+", q)]
    if not terms:
        return ""
    return (" OR " if mode == "or" else " ").join('"%s"' % t.replace('"', "") for t in terms)


def search_db(path, q, flt, limit):
    if not os.path.exists(path):
        return []
    con = sqlite3.connect(path, timeout=5)
    where, args = "", []
    if not flt["all"]:
        where += " AND docs.status != 'superseded' AND docs.superseded_by = ''"
    for col in ("area", "need", "status"):
        if flt.get(col):
            where += " AND lower(docs.%s) LIKE ?" % col
            args.append("%" + flt[col].lower() + "%")
    sql = ("SELECT path, num, title, status, area, need, date, section, line, "
           "snippet(docs, 9, '', '', '...', 32), bm25(docs, 0, 30, 8, 0, 4, 2, 0, 3, 0, 1, 0, 0) AS r "
           "FROM docs WHERE docs MATCH ?" + where + " ORDER BY r LIMIT ?")
    out = []
    try:
        for mode in ("and", "or"):
            match = fts_query(q, mode)
            if not match:
                return []
            cur = con.execute(sql, [match] + args + [limit])
            out = cur.fetchall()
            if out or len(re.findall(r"\S+", q)) < 2:
                break
    except sqlite3.OperationalError:
        out = []
    finally:
        con.close()
    return out


def hit(row):
    path, num, title, status, area, need, date, section, line, snip, rank = row
    snip = " ".join(snip.split())
    if len(snip) > SNIPPET:
        snip = snip[:SNIPPET - 3].rstrip() + "..."
    return {"num": num, "title": title, "status": status, "area": area, "need": need,
            "date": date, "section": section, "path": path, "line": int(line),
            "snippet": snip, "rank": rank}


def render(hits, fmt):
    if fmt == "json":
        return json.dumps(hits, ensure_ascii=False, indent=1)
    out = []
    for h in hits:
        head = " · ".join(x for x in (h["num"], h["title"], h["status"], h["area"],
                                      "%s:%d" % (h["path"], h["line"])) if x)
        if fmt == "md":
            out.append("- **%s**\n  %s" % (head, h["snippet"]))
        else:
            out.append("%s\n    %s" % (head, h["snippet"]))
    return "\n".join(out)


EDGE_NUM = re.compile(r"(?:ADR[ -]?|docs/adr/)?(\d{4})(?!\d)")


def adr_records(root):
    """Every ADR of root/docs/adr as a dict, from its header only."""
    adir = os.path.join(root, "docs", "adr")
    try:
        names = sorted(os.listdir(adir))
    except OSError:
        return []
    recs = []
    for n in names:
        m = ADR_RE.search("docs/adr/" + n)
        if not m:
            continue
        try:
            with open(os.path.join(adir, n), encoding="utf-8", errors="replace") as fh:
                text = fh.read(12000)
        except OSError:
            continue
        h = parse_header(text)
        title = ""
        t = re.search(r"^#\s+(.+)$", text, re.M)
        if t:
            title = re.sub(r"^ADR[ -]?\d+\s*[-\u2014:.]*\s*", "", t.group(1)).strip()
        short = re.split(r"\s+\(`|:\s|\s\u2014\s", title)[0].replace("`", "").strip("*_ ") or title
        if len(short) > 44:
            short = short[:43].rstrip() + "\u2026"
        st = h.get("status", "")
        edges = {}
        for key in ("amends", "supersedes"):
            nums = [x for x in EDGE_NUM.findall(h.get(key, "")) if x != m.group(1)]
            edges[key] = sorted(set(nums))
        area = (h.get("area", "").split(",")[0].strip().lower()) or "-"
        recs.append({"num": m.group(1), "file": n, "title": title, "short": short,
                     "status": status_word(st), "area": area,
                     "by": superseded_by(st), "edges": edges})
    return recs


def decision_map(recs, max_lines=60, max_bytes=3600):
    live = [r for r in recs if r["status"] in ("accepted", "amended")]
    if not live:
        return ""
    gone = {r["num"] for r in recs if r["status"] == "superseded" or r["by"]}
    live = [r for r in live if r["num"] not in gone]
    hubs = {}
    for r in live:
        for k in ("amends", "supersedes"):
            for n in r["edges"][k]:
                hubs[n] = hubs.get(n, 0) + 1
    for r in live:
        r["deg"] = len(r["edges"]["amends"]) + len(r["edges"]["supersedes"]) + hubs.get(r["num"], 0)
    head = "## Decision map (kodflow-hooks): %d accepted ADRs; kf_docs.py search QUERY or docs_search for the rest" % len(live)
    used, size, areas, picked = 1 + 1, len(head) + 120, set(), []
    for r in sorted(live, key=lambda r: (-r["deg"], -int(r["num"]))):
        r["line"] = "- %s %s%s" % (r["num"], r["short"], edge_text(r, hubs, gone))
        cost = 1 + (0 if r["area"] in areas else 1)
        add = len(r["line"]) + 1 + (0 if r["area"] in areas else len(r["area"]) + 8)
        if used + cost > max_lines or size + add > max_bytes:
            continue
        areas.add(r["area"])
        picked.append(r)
        used, size = used + cost, size + add
    out = [head]
    for area in sorted(areas, key=lambda x: (x == "-", x)):
        grp = sorted((r for r in picked if r["area"] == area), key=lambda r: r["num"])
        total = sum(1 for r in live if r["area"] == area)
        out.append("### %s (%d)" % (area, total))
        out += [r["line"] for r in grp]
    if len(picked) < len(live):
        out.append("%d more accepted ADRs not listed." % (len(live) - len(picked)))
    return "\n".join(out)


def edge_text(r, hubs, gone):
    bits = []
    if r["edges"]["amends"]:
        bits.append("amends " + ",".join(r["edges"]["amends"][:3]))
    if r["edges"]["supersedes"]:
        bits.append("supersedes " + ",".join(r["edges"]["supersedes"][:3]))
    return " [%s]" % "; ".join(bits) if bits else ""


def cmd_map(a):
    out = decision_map(adr_records(git_root(a.root)), a.max_lines, a.max_bytes)
    if out:
        print(out)
    return 0


def cmd_budget(a):
    root = git_root(a.root)
    try:
        lim = int(os.environ.get("KODFLOW_CLAUDE_MD_LINES", "200"))
        trunc = int(os.environ.get("KODFLOW_CLAUDE_MD_TRUNC_CHARS", "40000"))
    except ValueError:
        return 0
    cut, over = [], []
    for f in repo_files(root):
        if os.path.basename(f) != "CLAUDE.md":
            continue
        try:
            with open(f, encoding="utf-8", errors="replace") as fh:
                text = fh.read()
        except OSError:
            continue
        rel = os.path.relpath(f, root)
        n = text.count("\n") + (1 if text and not text.endswith("\n") else 0)
        if rel not in ("CLAUDE.md", ".claude/CLAUDE.md") and len(text) > trunc:
            cut.append((-len(text), rel, n))
        elif n > lim:
            over.append((-n, rel))
    cut.sort()
    over.sort()
    if not cut and not over:
        return 0
    bits = ["%s %d chars: truncated on a 200K window" % (r, -c) for c, r, _ in cut[:3]]
    bits += ["%s %d lines > %d" % (r, -n, lim) for n, r in over[: max(0, 3 - len(bits))]]
    total = len(cut) + len(over)
    more = " (+%d more)" % (total - len(bits)) if total > len(bits) else ""
    print("CLAUDE.md budget: %s%s. Trim or split (/warmup --update); official target: under %d lines per file." % ("; ".join(bits), more, lim))
    return 0


def cmd_export(a):
    recs = adr_records(git_root(a.root))
    os.makedirs(a.obsidian, exist_ok=True)
    for r in recs:
        links = []
        for k in ("amends", "supersedes"):
            links += ["%s: [[ADR-%s]]" % (k.capitalize(), n) for n in r["edges"][k]]
        if r["by"]:
            links.append("Superseded by: [[ADR-%s]]" % r["by"])
        body = "---\nstatus: %s\narea: %s\ngenerated: true\n---\n# ADR-%s %s\n\n%s\n" % (
            r["status"], r["area"], r["num"], r["short"], "\n".join("- " + x for x in links))
        with open(os.path.join(a.obsidian, "ADR-%s.md" % r["num"]), "w", encoding="utf-8") as fh:
            fh.write(body)
    print("exported %d note(s)" % len(recs))
    return 0


def cmd_index(a):
    if a.glob:
        n = build(None)
    else:
        n = build(git_root(a.root))
    if not a.quiet:
        print("indexed %d changed file(s)" % n)
    return 0


def cmd_search(a):
    root = git_root(a.root)
    flt = {"all": a.all, "area": a.area, "need": a.need, "status": a.status}
    if not a.no_refresh:
        try:
            build(root)
            if not a.no_global:
                build(None)
        except (sqlite3.Error, OSError) as e:
            print("kf_docs: refresh failed (%s), searching the index as it is" % e, file=sys.stderr)
    wide = a.limit * 4  # the ADR preference below needs more than the cut
    rows = search_db(db_path(root), a.query, flt, wide)
    if not a.no_global:
        rows += search_db(db_path(None), a.query, flt, wide)
    # bm25 is negative, lower is better: a decision record outranks a prose
    # mention of the same words
    rows.sort(key=lambda r: r[-1] * (1.6 if r[1] else 1.0))
    best, seen = [], set()  # one hit a file: its best section
    for r in rows:
        if r[0] not in seen:
            seen.add(r[0])
            best.append(r)
    hits = [hit(r) for r in best[:a.limit]]
    if hits:
        print(render(hits, a.format))
    elif a.format == "json":
        print("[]")
    return 0


def main(argv):
    p = argparse.ArgumentParser(prog="kf_docs.py")
    sub = p.add_subparsers(dest="cmd", required=True)
    i = sub.add_parser("index")
    i.add_argument("--root", default=".")
    i.add_argument("--global", dest="glob", action="store_true")
    i.add_argument("--quiet", action="store_true")
    s = sub.add_parser("search")
    s.add_argument("query")
    s.add_argument("--root", default=".")
    s.add_argument("--area")
    s.add_argument("--need")
    s.add_argument("--status")
    s.add_argument("--all", action="store_true", help="include superseded ADRs")
    s.add_argument("--no-global", action="store_true")
    s.add_argument("--no-refresh", action="store_true")
    s.add_argument("--limit", type=int, default=8)
    s.add_argument("--format", choices=("text", "json", "md"), default="text")
    m = sub.add_parser("map")
    m.add_argument("--root", default=".")
    m.add_argument("--max-lines", type=int, default=60)
    m.add_argument("--max-bytes", type=int, default=3600)
    b = sub.add_parser("budget")
    b.add_argument("--root", default=".")
    x = sub.add_parser("export")
    x.add_argument("--root", default=".")
    x.add_argument("--obsidian", required=True)
    a = p.parse_args(argv)
    try:
        cmds = {"index": cmd_index, "search": cmd_search, "map": cmd_map,
                "budget": cmd_budget, "export": cmd_export}
        return cmds[a.cmd](a)
    except sqlite3.Error as e:
        print("kf_docs: %s" % e, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

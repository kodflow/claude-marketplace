#!/usr/bin/env python3
"""Check the excerpts the panel quoted, and cache what was checked.

    python3 -I cache-source.py --root DIR --panel member.json [--panel …] [--json]
    python3 -I cache-source.py --root DIR --panel member.json --offline BODIES.json

A panel member (panel-member/v1) returns its sources as {url, excerpt, …}.
The main thread runs this: each URL is fetched again (https only, 5 MB at
most, 20 s), and the excerpt is looked for in the body, first as it is, then
after normalisation — tags dropped, entities decoded, quotes and dashes
folded, whitespace collapsed, case folded. The verdict per source is
`match_mode`: exact, normalised, not_found, or fetch_failed:<status>. Only
exact and normalised count as verified; everything else is `unverified`.

What is cached is the evidence, not the page: docs/anim/sources/<sha256 of
the body>.md holds the URL, the final URL, the status, the body's hash, the
excerpt and the match mode. A third party's page is not copied into a
project; its hash is what lets a later run tell whether it changed.

--offline maps URLs to local files holding their bodies (tests, or bodies the
caller already fetched); no network is used then.

Standard library only, Python 3.9 or later.
"""
import argparse
import datetime
import hashlib
import html
import json
import os
import pathlib
import re
import sys
import tempfile
import urllib.error
import urllib.request

LIMIT = 5 * 1024 * 1024
TIMEOUT = 20
UA = "kodflow-gamedev-cache-source/1 (https://github.com/kodflow/claude-marketplace)"
SRC_DIR = pathlib.Path("docs/anim/sources")
FOLD = {"‘": "'", "’": "'", "‚": "'", "‛": "'", "′": "'",
        "“": '"', "”": '"', "„": '"', "‟": '"', "″": '"',
        "«": '"', "»": '"', "–": "-", "—": "-", "−": "-", " ": " "}


class HttpsOnly(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not newurl.lower().startswith("https://"):
            raise urllib.error.HTTPError(newurl, code, "redirect leaves https", headers, fp)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def fetch(url):
    """(status, final url, body bytes or None)."""
    if not url.lower().startswith("https://"):
        return "not_https", url, None
    opener = urllib.request.build_opener(HttpsOnly())
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with opener.open(req, timeout=TIMEOUT) as r:
            body = r.read(LIMIT + 1)
            if len(body) > LIMIT:
                return "too_large", r.geturl(), None
            return r.status, r.geturl(), body
    except urllib.error.HTTPError as e:
        return e.code, url, None
    except (urllib.error.URLError, OSError, ValueError) as e:
        return type(e).__name__, url, None


def normalise(text):
    text = re.sub(r"(?is)<(script|style)\b.*?</\1>", " ", text)
    text = re.sub(r"(?s)<[^>]+>", " ", text)
    text = html.unescape(text)
    text = "".join(FOLD.get(ch, ch) for ch in text)
    return re.sub(r"\s+", " ", text).strip().casefold()


def decode(body):
    for enc in ("utf-8", "latin-1"):
        try:
            return body.decode(enc)
        except UnicodeDecodeError:
            continue
    return body.decode("utf-8", "replace")


def match(excerpt, body):
    if not excerpt or not excerpt.strip():
        return "no_excerpt"
    text = decode(body)
    if excerpt in text:
        return "exact"
    if normalise(excerpt) in normalise(text):
        return "normalised"
    return "not_found"


def atomic_write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
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


def entry(src, agent, getter, root, today):
    url = str(src.get("url", ""))
    excerpt = src.get("excerpt") or ""
    status, final, body = getter(url)
    out = {"url": url, "agent": agent, "excerpt": excerpt, "http_status": status, "final_url": final}
    if body is None or status != 200:
        out.update(match_mode=f"fetch_failed:{status}", verified=False)
        return out
    digest = hashlib.sha256(body).hexdigest()
    mode = match(excerpt, body)
    out.update(sha256=digest, match_mode=mode, verified=mode in ("exact", "normalised"))
    claimed = src.get("sha256")
    if claimed and claimed != digest:
        out["sha256_claimed"] = claimed
    if out["verified"]:
        rec = {"url": url, "final_url": final, "http_status": status, "sha256": digest,
               "checked": today, "match_mode": mode, "agent": agent, "tier": src.get("tier"),
               "read": src.get("read")}
        path = root / SRC_DIR / f"{digest}.md"
        text = ("```json\n" + json.dumps(rec, indent=2, ensure_ascii=False, sort_keys=True) + "\n```\n\n"
                "## Excerpt\n\n" + "\n".join("> " + l if l else ">" for l in excerpt.strip().splitlines()) + "\n")
        if path.exists():
            prior = path.read_text(encoding="utf-8")
            if excerpt.strip() and excerpt.strip().splitlines()[0] not in prior:
                text = prior.rstrip("\n") + "\n\n## Excerpt\n\n" + \
                    "\n".join("> " + l if l else ">" for l in excerpt.strip().splitlines()) + "\n"
                atomic_write(path, text)
        else:
            atomic_write(path, text)
        out["cached"] = str(path.relative_to(root))
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--root", default=".")
    ap.add_argument("--panel", action="append", required=True, help="a panel-member/v1 JSON file")
    ap.add_argument("--offline", help="JSON map url -> local file holding the body")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    root = pathlib.Path(a.root).resolve()
    today = datetime.date.today().isoformat()

    if a.offline:
        bodies = json.loads(pathlib.Path(a.offline).read_text(encoding="utf-8"))

        def getter(url):
            p = bodies.get(url)
            if p is None:
                return "offline_missing", url, None
            return 200, url, pathlib.Path(p).read_bytes()
    else:
        getter = fetch

    results = []
    for p in a.panel:
        try:
            m = json.loads(pathlib.Path(p).read_text(encoding="utf-8"))
        except (OSError, ValueError) as e:
            print(f"cache-source: {p}: unreadable ({e})", file=sys.stderr)
            return 2
        for s in m.get("sources") or []:
            results.append(entry(s, m.get("agent", "?"), getter, root, today))
    verified = sum(1 for r in results if r["verified"])
    report = {"schema": "source-check/v1", "verified": verified, "total": len(results), "sources": results}
    if a.json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
    else:
        print(f"sources verified {verified}/{len(results)}")
        for r in results:
            print(f"  {'ok  ' if r['verified'] else 'UNV '} {r['match_mode']:<22} {r['agent']}: {r['url']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

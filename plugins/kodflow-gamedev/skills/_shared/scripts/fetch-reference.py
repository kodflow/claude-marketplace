#!/usr/bin/env python3
"""Download one reference image with its licence, or refuse it.

    python3 -I fetch-reference.py --root DIR --url https://upload.wikimedia.org/…/File.jpg \
        --page https://commons.wikimedia.org/wiki/File:… --move diagonal-cut
    python3 -I fetch-reference.py --root DIR --url https://… --page https://… \
        --licence-id CC0-1.0 --author "…" --move diagonal-cut
    python3 -I fetch-reference.py --root DIR --url … --private …   (study copy, never committed)

https only, after every redirect; the body is cut at 5 MB; status 200; the
first bytes must be an image's (PNG, JPEG, GIF, WebP). The file is named by
its sha256. On Wikimedia Commons the licence and the author are read from the
API (imageinfo, extmetadata) and a file missing either is refused. On any
other host the caller states a licence id from the allow list below, and the
manifest records licence_verified: false — a person must confirm it.

Committable images go to art/reference/ (with a .gdignore, so Godot does not
import them) and art/reference/manifest.json, sorted, with no timestamp so
two fetches of the same set give the same bytes. --private, or a licence
outside the allow list, goes to .cache/anim-ref/ instead, which the project
ignores: a non-commercial image may be studied, never shipped.

Standard library only, Python 3.9 or later.
"""
import argparse
import hashlib
import json
import os
import pathlib
import re
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request

LIMIT = 5 * 1024 * 1024
TIMEOUT = 20
UA = "kodflow-gamedev-fetch-reference/1 (https://github.com/kodflow/claude-marketplace)"
COMMIT_DIR = pathlib.Path("art/reference")
PRIVATE_DIR = pathlib.Path(".cache/anim-ref")
COMMONS_API = "https://commons.wikimedia.org/w/api.php"
# Licences a commercial game may ship with attribution or without. NC and ND
# are absent on purpose; "unknown" is absent on purpose.
ALLOWED = {
    "CC0-1.0": "CC0 1.0", "PDM-1.0": "Public Domain Mark 1.0", "PD": "public domain",
    "CC-BY-4.0": "CC BY 4.0", "CC-BY-3.0": "CC BY 3.0", "CC-BY-2.0": "CC BY 2.0",
    "CC-BY-SA-4.0": "CC BY-SA 4.0", "CC-BY-SA-3.0": "CC BY-SA 3.0", "CC-BY-SA-2.0": "CC BY-SA 2.0",
}
COMMONS_SHORT = {
    "cc0": "CC0-1.0", "public domain": "PD", "pdm": "PDM-1.0",
    "cc by 4.0": "CC-BY-4.0", "cc by 3.0": "CC-BY-3.0", "cc by 2.0": "CC-BY-2.0",
    "cc by-sa 4.0": "CC-BY-SA-4.0", "cc by-sa 3.0": "CC-BY-SA-3.0", "cc by-sa 2.0": "CC-BY-SA-2.0",
}
MAGIC = ((b"\x89PNG\r\n\x1a\n", "png"), (b"\xff\xd8\xff", "jpg"), (b"GIF87a", "gif"), (b"GIF89a", "gif"))


class Refused(Exception):
    pass


class HttpsOnly(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not newurl.lower().startswith("https://"):
            raise Refused(f"redirect to a non-https URL: {newurl}")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def kind_of(head):
    for sig, ext in MAGIC:
        if head.startswith(sig):
            return ext
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "webp"
    return None


def get(url, limit=LIMIT):
    if not url.lower().startswith("https://"):
        raise Refused(f"not https: {url}")
    opener = urllib.request.build_opener(HttpsOnly())
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with opener.open(req, timeout=TIMEOUT) as r:
            if r.status != 200:
                raise Refused(f"status {r.status}")
            body = r.read(limit + 1)
            final = r.geturl()
    except urllib.error.HTTPError as e:
        raise Refused(f"status {e.code}")
    except (urllib.error.URLError, OSError) as e:
        raise Refused(f"fetch failed: {e}")
    if len(body) > limit:
        raise Refused(f"larger than {limit} bytes")
    if not final.lower().startswith("https://"):
        raise Refused(f"final URL is not https: {final}")
    return body, final


def file_title(u):
    """The Commons file a URL names — a file page, Special:FilePath, an upload or a
    thumbnail URL — as "File:<name>" with spaces for underscores, or None."""
    p = urllib.parse.urlparse(u or "")
    if p.netloc == "commons.wikimedia.org" and "/wiki/" in p.path:
        t = urllib.parse.unquote(p.path.split("/wiki/", 1)[1])
        if t.startswith("Special:FilePath/"):
            t = "File:" + t[len("Special:FilePath/"):]
        return t.replace("_", " ") if t.startswith("File:") else None
    if p.netloc == "upload.wikimedia.org":
        parts = p.path.rstrip("/").split("/")
        name = parts[-2] if "/thumb/" in p.path else parts[-1]
        return "File:" + urllib.parse.unquote(name).replace("_", " ")
    return None


def commons_title(url, page):
    """The Commons file whose licence applies, or None when neither URL is Commons'."""
    return file_title(page) or file_title(url)


def same_file(title, url, final):
    """Commons metadata vouches only for the bytes of that very file: the URL asked
    for and the URL the bytes came from must both name it."""
    return file_title(url) == title and file_title(final) == title


def strip_tags(s):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s or "")).strip()


def commons_licence(meta):
    """(licence_id, author) from an extmetadata dict, or Refused."""
    short = strip_tags((meta.get("LicenseShortName") or {}).get("value", ""))
    author = strip_tags((meta.get("Artist") or {}).get("value", ""))
    if not short:
        raise Refused("Commons gives no licence for this file")
    if not author:
        raise Refused("Commons gives no author for this file")
    lid = COMMONS_SHORT.get(short.casefold())
    if lid is None and short.casefold().startswith("public domain"):
        lid = "PD"
    return lid or short, author


def commons_meta(title):
    q = urllib.parse.urlencode({"action": "query", "titles": title, "prop": "imageinfo",
                                "iiprop": "extmetadata|url", "format": "json", "formatversion": "2"})
    body, _ = get(f"{COMMONS_API}?{q}", limit=1024 * 1024)
    pages = (json.loads(body.decode("utf-8")).get("query") or {}).get("pages") or []
    if not pages or not pages[0].get("imageinfo"):
        raise Refused(f"Commons knows no file {title}")
    return pages[0]["imageinfo"][0].get("extmetadata") or {}


def atomic_write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".tmp-", dir=str(path.parent))
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        os.chmod(tmp, 0o644)
        os.replace(tmp, str(path))
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def add_to_manifest(path, rec):
    try:
        items = json.loads(path.read_text(encoding="utf-8")).get("images", [])
    except (OSError, ValueError):
        items = []
    items = [i for i in items if i.get("file") != rec["file"]] + [rec]
    items.sort(key=lambda i: i["file"])
    doc = {"schema": "reference-manifest/v1", "images": items}
    atomic_write(path, (json.dumps(doc, indent=2, ensure_ascii=False, sort_keys=True) + "\n").encode())


def run(a, getter=get, meta_getter=commons_meta):
    root = pathlib.Path(a.root).resolve()
    title = commons_title(a.url, a.page)
    if title:
        lid, author = commons_licence(meta_getter(title))
        verified = True
    else:
        if not a.licence_id:
            raise Refused("not a Commons file: --licence-id is required, and a person must confirm it")
        lid, author, verified = a.licence_id, a.author or "", False
    private = a.private or lid not in ALLOWED
    body, final = getter(a.url)
    if title and not same_file(title.replace("_", " "), a.url, final):
        raise Refused(f"the licence read for {title} does not cover the bytes of {final}")
    ext = kind_of(body[:16])
    if not ext:
        raise Refused("the body is not a PNG, JPEG, GIF or WebP image")
    digest = hashlib.sha256(body).hexdigest()
    name = f"{digest}.{ext}"
    dest = root / (PRIVATE_DIR if private else COMMIT_DIR)
    atomic_write(dest / name, body)
    rec = {"file": name, "sha256": digest, "url": a.url, "final_url": final, "page": a.page or "",
           "licence_id": lid, "licence_verified": verified, "author": author, "move": a.move or "",
           "committable": not private}
    if private:
        ign = dest / ".gitignore"
        if not ign.exists():
            atomic_write(ign, b"*\n")
        add_to_manifest(dest / "manifest.json", rec)
    else:
        gd = dest / ".gdignore"
        if not gd.exists():
            atomic_write(gd, b"")
        add_to_manifest(dest / "manifest.json", rec)
    return rec


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--root", default=".")
    ap.add_argument("--url", required=True)
    ap.add_argument("--page", help="the page that describes the image (Commons file page, museum record)")
    ap.add_argument("--licence-id", help=f"one of {', '.join(sorted(ALLOWED))}, for a non-Commons host")
    ap.add_argument("--author")
    ap.add_argument("--move")
    ap.add_argument("--private", action="store_true", help="study copy under .cache/anim-ref/, never committed")
    a = ap.parse_args(argv)
    try:
        rec = run(a)
    except Refused as e:
        print(f"fetch-reference: refused: {e}", file=sys.stderr)
        return 1
    print(json.dumps(rec, indent=2, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Create a Meshy task, wait for it, fetch its files with their licence, or inspect a GLB.

    python3 -I meshy.py create --endpoint text-to-3d --params req.json [--dry-run]
    python3 -I meshy.py wait   --endpoint text-to-3d --task-id ID [--max-wait 3600]
    python3 -I meshy.py fetch  --endpoint text-to-3d --task-id ID --plan pro --asset hero
    python3 -I meshy.py run    --endpoint text-to-3d --params req.json --plan pro --asset hero
    python3 -I meshy.py inspect art/meshy/<sha256>.glb

The API facts this script follows are in ../meshy-api.md; the licence rule in
../licence-policy.md (section "Meshy outputs").

The key is read from MESHY_API_KEY only: there is no option for it, it is sent
to https://api.meshy.ai only (never to a download host), and it is masked in
every line this script prints. --dry-run builds the request and prints it
without a key and without a network call.

A create is sent once: after a timeout or a 5xx the task may exist anyway, so
the script stops and says so instead of creating a second, charged task.
Polling waits Retry-After between polls (5 s when absent), retries 429, 5xx
and network errors, and stops at --max-wait with the task id to come back to
(exit 3); FAILED and CANCELED exit 1.

fetch refuses to download anything unless --plan names a plan whose licence
the policy states. Files are named by the sha256 of their bytes and listed in
<out>/manifest.json, sorted, with the task's own creation date and no fetch
time, so fetching the same task twice gives the same bytes. The request
record (endpoint, parameters, prompt, never the key) is kept in
.cache/meshy/tasks/<task id>.json, which ignores itself.

A parameter value "@path" is a local image (relative to --root), sent as a
data: URI and recorded by its sha256.

Standard library only, Python 3.9 or later.
"""
import argparse
import base64
import fnmatch
import hashlib
import json
import math
import os
import pathlib
import socket
import struct
import sys
import tempfile
import time
import urllib.error
import urllib.request

API = "https://api.meshy.ai"
TIMEOUT = 60
DOWNLOAD_LIMIT = 400 * 1024 * 1024
IMAGE_LIMIT = 20 * 1024 * 1024
DEFAULT_WAIT = 3600          # meshy-api.md: wait at least 60 minutes before giving up
DEFAULT_POLL = 5
MAX_POLL = 60
UA = "kodflow-gamedev-meshy/1 (https://github.com/kodflow/claude-marketplace)"
OUT_DIR = pathlib.Path("art/meshy")
RECORD_DIR = pathlib.Path(".cache/meshy/tasks")
POLICY = "skills/_shared/licence-policy.md#meshy-outputs (read 2026-10-31)"

# name -> (create path, get path prefix); meshy-api.md, "Endpoints".
ENDPOINTS = {
    "text-to-3d": ("/openapi/v2/text-to-3d", "/openapi/v2/text-to-3d/"),
    "image-to-3d": ("/openapi/v1/image-to-3d", "/openapi/v1/image-to-3d/"),
    "multi-image-to-3d": ("/openapi/v1/multi-image-to-3d", "/openapi/v1/multi-image-to-3d/"),
    "remesh": ("/openapi/v1/remesh", "/openapi/v1/remesh/"),
    "retexture": ("/openapi/v1/retexture", "/openapi/v1/retexture/"),
    "rigging": ("/openapi/v1/rigging", "/openapi/v1/rigging/"),
    "animations": ("/openapi/v1/animations", "/openapi/v1/animations/"),
}
# licence-policy.md, "Meshy outputs": the plan at creation decides the licence.
# A plan absent from this table has no licence the policy states: refused.
PAID = ("LicenseRef-Meshy-Paid", "")
PLANS = {
    "free": ("CC-BY-4.0", "3D model generated with Meshy (meshy.ai), CC BY 4.0"),
    "pro": PAID, "premium": PAID, "ultra": PAID, "studio": PAID, "enterprise": PAID,
}
TERMINAL_BAD = ("FAILED", "CANCELED")
IMAGE_MAGIC = ((b"\x89PNG\r\n\x1a\n", "image/png"), (b"\xff\xd8\xff", "image/jpeg"))
TEXT_FORMATS = ("obj", "mtl", "stl", "usdz", "3mf")


class Refused(Exception):
    pass


class StillRunning(Exception):
    pass


# --- the key, and what may be printed --------------------------------------

def api_key():
    k = os.environ.get("MESHY_API_KEY", "").strip()
    if not k:
        raise Refused("MESHY_API_KEY is not set (the key is read from the environment only)")
    return k


def mask(text):
    """Every printed line goes through here: the key never leaves the process."""
    k = os.environ.get("MESHY_API_KEY", "").strip()
    text = str(text)
    return text.replace(k, "***") if k else text


def say(msg):
    print(mask(f"meshy: {msg}"), file=sys.stderr)


# --- HTTP ---------------------------------------------------------------------

class HttpsOnly(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not newurl.lower().startswith("https://"):
            raise Refused(f"redirect to a non-https URL: {newurl}")
        new = super().redirect_request(req, fp, code, msg, headers, newurl)
        if new is not None and not newurl.startswith(API + "/"):
            new.remove_header("Authorization")     # the key stays with api.meshy.ai
        return new


def urlopen(req, timeout):
    """The default transport: a response, also for an HTTP error status."""
    try:
        return urllib.request.build_opener(HttpsOnly()).open(req, timeout=timeout)
    except urllib.error.HTTPError as e:
        return e


def status_of(r):
    return getattr(r, "status", None) or getattr(r, "code", None)


class Client:
    def __init__(self, key, opener=urlopen, base=API):
        self.key, self.opener, self.base = key, opener, base

    def call(self, method, path, body=None):
        """(status, headers, parsed JSON or None). Raises OSError on a network failure."""
        url = self.base + path
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(url, data=data, method=method, headers={
            "Authorization": f"Bearer {self.key}", "User-Agent": UA,
            "Content-Type": "application/json", "Accept": "application/json"})
        r = self.opener(req, TIMEOUT)
        try:
            raw = r.read(4 * 1024 * 1024)
            st, hd = status_of(r), r.headers
        finally:
            close = getattr(r, "close", None)
            if close:
                close()
        try:
            doc = json.loads(raw.decode("utf-8")) if raw else None
        except ValueError:
            doc = None
        return st, hd, doc


def message_of(doc):
    if isinstance(doc, dict):
        return str(doc.get("message") or doc.get("error") or "")[:300]
    return ""


# --- parameters ---------------------------------------------------------------

def data_uri(path):
    p = pathlib.Path(path)
    body = p.read_bytes()
    if len(body) > IMAGE_LIMIT:
        raise Refused(f"{p}: larger than 20 MB, which Meshy refuses")
    mime = next((m for sig, m in IMAGE_MAGIC if body.startswith(sig)), None)
    if mime is None and body[:4] == b"RIFF" and body[8:12] == b"WEBP":
        mime = "image/webp"
    if mime is None:
        raise Refused(f"{p}: not a PNG, JPEG or WebP image")
    return f"data:{mime};base64,{base64.b64encode(body).decode()}", hashlib.sha256(body).hexdigest()


def resolve(value, base):
    """(value sent, value recorded): "@path" becomes a data: URI sent, and its sha256 recorded."""
    if isinstance(value, str) and value.startswith("@"):
        p = pathlib.Path(value[1:])
        sent, digest = data_uri(p if p.is_absolute() else base / p)
        return sent, f"@{value[1:]} (sha256 {digest})"
    if isinstance(value, str) and value.startswith("data:"):
        return value, f"data: URI (sha256 {hashlib.sha256(value.encode()).hexdigest()})"
    if isinstance(value, list):
        pairs = [resolve(v, base) for v in value]
        return [s for s, _ in pairs], [r for _, r in pairs]
    if isinstance(value, dict):
        pairs = {k: resolve(v, base) for k, v in value.items()}
        return {k: s for k, (s, _) in pairs.items()}, {k: r for k, (_, r) in pairs.items()}
    return value, value


def load_params(a):
    base = pathlib.Path(a.root).resolve()       # "@path" is relative to the project root
    raw = sys.stdin.read() if a.params == "-" else pathlib.Path(a.params).read_text(encoding="utf-8")
    try:
        params = json.loads(raw)
    except ValueError as e:
        raise Refused(f"--params is not JSON: {e}")
    if not isinstance(params, dict) or not params:
        raise Refused("--params must be a non-empty JSON object")
    if any(k.lower() in ("api_key", "authorization", "key") for k in params):
        raise Refused("the key is never a parameter: it is read from MESHY_API_KEY")
    return resolve(params, base)


def prompt_of(params):
    for k in ("prompt", "texture_prompt", "text_style_prompt"):
        if isinstance(params.get(k), str) and params[k]:
            return params[k]
    return ""


def endpoint(name):
    if name not in ENDPOINTS:
        raise Refused(f"unknown endpoint {name}: one of {', '.join(sorted(ENDPOINTS))}")
    return ENDPOINTS[name]


def licence_for(plan):
    """(licence_id, attribution) for the plan at creation, or Refused: undetermined is never downloaded."""
    key = (plan or "").strip().lower()
    if key not in PLANS:
        raise Refused(f"licence undetermined: plan {plan!r} is not one of {', '.join(PLANS)}; "
                      "nothing is downloaded (licence-policy.md, Meshy outputs)")
    return PLANS[key]


# --- files ---------------------------------------------------------------------

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


def dump(doc):
    return (json.dumps(doc, indent=2, ensure_ascii=False, sort_keys=True) + "\n").encode()


def write_record(root, rec):
    d = root / RECORD_DIR
    if not (root / ".cache/meshy/.gitignore").exists():
        atomic_write(root / ".cache/meshy/.gitignore", b"*\n")
    atomic_write(d / f"{rec['task_id']}.json", dump(rec))


def read_record(root, task_id):
    try:
        return json.loads((root / RECORD_DIR / f"{task_id}.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


# --- create, wait, fetch ------------------------------------------------------------

def create(client, name, sent):
    path, _ = endpoint(name)
    try:
        st, _, doc = client.call("POST", path, sent)
    except (OSError, socket.timeout) as e:
        raise Refused(f"create sent, no answer ({e}): the task may exist. List the newest "
                      f"{name} tasks (sort_by=-created_at) before creating it again")
    if st is not None and 200 <= st < 300 and isinstance(doc, dict) and isinstance(doc.get("result"), str):
        return doc["result"]
    if st is not None and 400 <= st < 500:
        raise Refused(f"create refused, status {st}: {message_of(doc)} (no task was created)")
    raise Refused(f"create answered status {st}: the task may exist. List the newest {name} "
                  "tasks (sort_by=-created_at) before creating it again")


def retry_after(headers):
    try:
        v = int((headers or {}).get("Retry-After") or DEFAULT_POLL)
    except (TypeError, ValueError):
        v = DEFAULT_POLL
    return max(1, min(MAX_POLL, v))


def wait(client, name, task_id, max_wait=DEFAULT_WAIT, clock=time.monotonic, sleep=time.sleep):
    """The task once SUCCEEDED; Refused on FAILED or CANCELED; StillRunning past max_wait."""
    _, prefix = endpoint(name)
    deadline = clock() + max_wait
    status = "unknown"
    while True:
        try:
            st, hd, doc = client.call("GET", prefix + task_id)
        except (OSError, socket.timeout):
            st, hd, doc = None, {}, None              # a network error leaves the task running
        if st == 200 and isinstance(doc, dict):
            status = doc.get("status", "unknown")
            if status == "SUCCEEDED":
                return doc
            if status in TERMINAL_BAD:
                raise Refused(f"task {task_id} {status}: {message_of(doc.get('task_error'))}")
        elif st in (401, 403, 404):
            raise Refused(f"task {task_id}: status {st} {message_of(doc)}")
        left = deadline - clock()
        if left <= 0:
            raise StillRunning(f"task {task_id} is still {status} after {max_wait} s: keep the id "
                               f"and run `wait` again; do not create it again")
        sleep(min(retry_after(hd), left))


def outputs(task):
    """(label, url) pairs of every downloadable file of a task, labels stable across runs."""
    found = []
    for fmt, url in sorted((task.get("model_urls") or {}).items()):
        found.append((f"model_urls.{fmt}", url))
    for i, maps in enumerate(task.get("texture_urls") or []):
        for kind, url in sorted((maps or {}).items()):
            found.append((f"texture_urls.{i}.{kind}", url))
    result = task.get("result")
    if isinstance(result, dict):
        for k, v in sorted(result.items()):
            if isinstance(v, dict):
                found += [(f"result.{k}.{k2}", u) for k2, u in sorted(v.items())]
            else:
                found.append((f"result.{k}", v))
    return [(lab, u) for lab, u in found if isinstance(u, str) and u]


def kind_of(head, label):
    if head.startswith(b"glTF"):
        return "glb"
    if head.startswith(b"Kaydara FBX Binary"):
        return "fbx"
    for sig, mime in IMAGE_MAGIC:
        if head.startswith(sig):
            return mime.split("/")[1].replace("jpeg", "jpg")
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "webp"
    for fmt in TEXT_FORMATS:
        if fmt in label.lower():
            return fmt
    return None


def download(url, label, dest, opener=urlopen, limit=DOWNLOAD_LIMIT):
    """(file name, sha256, bytes) of a file stored as <sha256>.<ext> in dest. Never sends the key."""
    if not url.lower().startswith("https://"):
        raise Refused(f"{label}: not https: {url.split('?')[0]}")
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        r = opener(req, TIMEOUT)
    except (OSError, socket.timeout) as e:
        raise Refused(f"{label}: download failed: {e}")
    dest.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".tmp-", dir=str(dest))
    h, size, head = hashlib.sha256(), 0, b""
    try:
        if status_of(r) != 200:
            raise Refused(f"{label}: download status {status_of(r)} (signed URLs expire; files live 3 days)")
        final = r.geturl() if hasattr(r, "geturl") else url
        if not str(final).lower().startswith("https://"):
            raise Refused(f"{label}: final URL is not https")
        with os.fdopen(fd, "wb") as f:
            while True:
                chunk = r.read(1 << 20)
                if not chunk:
                    break
                size += len(chunk)
                if size > limit:
                    raise Refused(f"{label}: larger than {limit} bytes")
                if len(head) < 32:
                    head += chunk[:32 - len(head)]
                h.update(chunk)
                f.write(chunk)
        ext = kind_of(head, label)
        if not ext:
            raise Refused(f"{label}: unknown file type")
        name = f"{h.hexdigest()}.{ext}"
        os.chmod(tmp, 0o644)
        os.replace(tmp, str(dest / name))
        return name, h.hexdigest(), size
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
    finally:
        close = getattr(r, "close", None)
        if close:
            close()


def day_of(ms):
    if not isinstance(ms, (int, float)):
        return ""
    return time.strftime("%Y-%m-%d", time.gmtime(ms / 1000.0))


def add_to_manifest(path, recs):
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        doc = {}
    names = {r["file"] for r in recs}
    items = [i for i in doc.get("assets", []) if i.get("file") not in names] + recs
    items.sort(key=lambda i: (i["file"], i.get("output", "")))
    doc = dict(doc, schema="meshy-manifest/v1", assets=items)
    atomic_write(path, dump(doc))


def fetch(client, root, name, task_id, plan, asset, patterns=("*glb*",), out=OUT_DIR,
          task=None, opener=urlopen):
    licence_id, attribution = licence_for(plan)          # before any byte is downloaded
    if task is None:
        _, prefix = endpoint(name)
        st, _, task = client.call("GET", prefix + task_id)
        if st != 200 or not isinstance(task, dict):
            raise Refused(f"task {task_id}: status {st}")
    if task.get("status") != "SUCCEEDED":
        raise Refused(f"task {task_id} is {task.get('status')}, not SUCCEEDED: nothing to fetch")
    chosen = [(lab, u) for lab, u in outputs(task) if any(fnmatch.fnmatch(lab, p) for p in patterns)]
    if not chosen:
        raise Refused(f"task {task_id}: no output matches {', '.join(patterns)} "
                      f"(it has {', '.join(l for l, _ in outputs(task)) or 'none'})")
    rec = read_record(root, task_id)
    params = rec["params"] if rec else {}
    dest = root / out
    entries = []
    for label, url in chosen:
        fname, digest, size = download(url, label, dest, opener=opener)
        entries.append({
            "file": fname, "sha256": digest, "bytes": size, "output": label, "asset": asset,
            "task_id": task_id, "endpoint": name, "params": params,
            "params_source": "meshy.py create" if rec else "unknown: task not created by meshy.py",
            "prompt": prompt_of(params) or task.get("prompt") or "",
            "plan": plan.strip().lower(), "licence_id": licence_id, "attribution": attribution,
            "licence_policy": POLICY, "created": day_of(task.get("created_at")),
            "consumed_credits": task.get("consumed_credits"),
        })
    if not (dest / ".gitattributes").exists():
        atomic_write(dest / ".gitattributes", b"*.glb binary\n*.fbx binary\n*.usdz binary\n")
    add_to_manifest(dest / "manifest.json", entries)
    return entries


# --- inspect -----------------------------------------------------------------------------

def mat_mul(a, b):
    return [sum(a[k * 4 + r] * b[c * 4 + k] for k in range(4)) for c in range(4) for r in range(4)]


def node_matrix(n):
    if "matrix" in n:
        return [float(x) for x in n["matrix"]]
    x, y, z, w = n.get("rotation", [0, 0, 0, 1])
    sx, sy, sz = n.get("scale", [1, 1, 1])
    tx, ty, tz = n.get("translation", [0, 0, 0])
    r = [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w),
         2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w),
         2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)]
    return [r[0] * sx, r[1] * sx, r[2] * sx, 0, r[3] * sy, r[4] * sy, r[5] * sy, 0,
            r[6] * sz, r[7] * sz, r[8] * sz, 0, tx, ty, tz, 1]


def apply(m, p):
    return [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
            m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
            m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]]


def read_glb_json(path):
    with open(path, "rb") as f:
        head = f.read(20)
        if len(head) < 20 or head[:4] != b"glTF":
            raise Refused(f"{path}: not a GLB (no glTF magic)")
        version, _length, clen, ctype = struct.unpack("<III4s", head[4:])
        if version != 2 or ctype != b"JSON":
            raise Refused(f"{path}: GLB version {version} or first chunk {ctype!r} unsupported")
        return json.loads(f.read(clen).decode("utf-8"))


def inspect(path):
    """What a reviewer needs to judge a GLB, from its JSON chunk alone: triangles,
    world bounds at rest, origin, skins and joint names, materials, clips, and the
    asset block (where an AI mark would live)."""
    g = read_glb_json(path)
    nodes, meshes, acc = g.get("nodes", []), g.get("meshes", []), g.get("accessors", [])
    scene = g.get("scenes", [{}])[g.get("scene", 0)] if g.get("scenes") else {"nodes": list(range(len(nodes)))}
    lo, hi = [math.inf] * 3, [-math.inf] * 3
    tris, per_mesh, seen = 0, [], set()

    def walk(i, parent):
        nonlocal tris
        if i in seen:
            return
        seen.add(i)
        n = nodes[i]
        world = mat_mul(parent, node_matrix(n))
        if "mesh" in n:
            m = meshes[n["mesh"]]
            t = 0
            for prim in m.get("primitives", []):
                pos = acc[prim["attributes"]["POSITION"]]
                count = acc[prim["indices"]]["count"] if "indices" in prim else pos["count"]
                t += count // 3 if prim.get("mode", 4) == 4 else 0
                # A skinned mesh ignores its node's transform (glTF 2.0, skins): bounds in mesh space.
                xf = node_matrix({}) if "skin" in n else world
                mn, mx = pos.get("min"), pos.get("max")
                if mn and mx:
                    for c in range(8):
                        p = apply(xf, [mx[k] if c >> k & 1 else mn[k] for k in range(3)])
                        for k in range(3):
                            lo[k], hi[k] = min(lo[k], p[k]), max(hi[k], p[k])
            tris += t
            per_mesh.append({"node": n.get("name", f"#{i}"), "mesh": m.get("name", f"#{n['mesh']}"),
                             "triangles": t, "skinned": "skin" in n})
        for c in n.get("children", []):
            walk(c, world)

    ident = node_matrix({})
    for r in scene.get("nodes", []):
        walk(r, ident)
    bounds = None
    if lo[0] != math.inf:
        r6 = lambda v: [round(x, 6) for x in v]
        size = [hi[k] - lo[k] for k in range(3)]
        bounds = {"min": r6(lo), "max": r6(hi), "size": r6(size),
                  "height_axis": "xyz"[size.index(max(size))],
                  "origin_offset": r6([(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2])}
    skins = [{"name": s.get("name", f"#{i}"), "joints": len(s.get("joints", [])),
              "root": nodes[s["skeleton"]].get("name") if "skeleton" in s else None,
              "joint_names": [nodes[j].get("name", f"#{j}") for j in s.get("joints", [])]}
             for i, s in enumerate(g.get("skins", []))]
    clips = []
    for a in g.get("animations", []):
        ends = [acc[s["input"]].get("max", [0])[0] for s in a.get("samplers", []) if "input" in s]
        clips.append({"name": a.get("name", ""), "duration": round(max(ends), 4) if ends else 0,
                      "channels": len(a.get("channels", []))})
    mats = []
    for m in g.get("materials", []):
        pbr = m.get("pbrMetallicRoughness", {})
        mats.append({"name": m.get("name", ""),
                     "maps": sorted(k for k in ("baseColorTexture", "metallicRoughnessTexture") if k in pbr)
                     + sorted(k for k in ("normalTexture", "occlusionTexture", "emissiveTexture") if k in m)})
    return {"schema": "meshy-inspect/v1", "file": pathlib.Path(path).name,
            "asset": g.get("asset", {}), "extensions_used": sorted(g.get("extensionsUsed", [])),
            "triangles": tris, "meshes": per_mesh, "bounds": bounds, "skins": skins,
            "animations": clips, "materials": mats,
            "node_names": [n.get("name", f"#{i}") for i, n in enumerate(nodes)],
            "notes": ["glTF 2.0: metres, +Y up, front of the asset on +Z",
                      "bounds are the rest pose; a skinned mesh is measured in mesh space"]}


# --- command line --------------------------------------------------------------------------

def dry_run(name, sent, recorded):
    path, _ = endpoint(name)
    return {"dry_run": True, "method": "POST", "url": API + path,
            "headers": {"Authorization": "Bearer ***", "Content-Type": "application/json"},
            "body": recorded, "body_bytes": len(json.dumps(sent).encode()),
            "note": "nothing was sent; credits are charged at creation (meshy-api.md, Credits per request)"}


def out(doc):
    print(mask(json.dumps(doc, indent=2, ensure_ascii=False, sort_keys=True)))


def main(argv=None, opener=urlopen, clock=time.monotonic, sleep=time.sleep):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    for cmd in ("create", "wait", "fetch", "run"):
        s = sub.add_parser(cmd)
        s.add_argument("--endpoint", required=True, choices=sorted(ENDPOINTS))
        s.add_argument("--root", default=".")
        if cmd in ("create", "run"):
            s.add_argument("--params", required=True, help="JSON object file, or - for stdin")
            s.add_argument("--dry-run", action="store_true", help="print the request, send nothing")
        if cmd in ("wait", "fetch"):
            s.add_argument("--task-id", required=True)
        if cmd in ("wait", "run"):
            s.add_argument("--max-wait", type=int, default=DEFAULT_WAIT, help="seconds (default 3600)")
        if cmd in ("fetch", "run"):
            s.add_argument("--plan", help=f"Meshy plan at creation: {', '.join(PLANS)}")
            s.add_argument("--asset", required=True, help="the asset's slug")
            s.add_argument("--outputs", default="*glb*", help="comma-separated globs on output labels")
            s.add_argument("--out", default=str(OUT_DIR))
    s = sub.add_parser("inspect")
    s.add_argument("glb")
    a = ap.parse_args(argv)
    try:
        if a.cmd == "inspect":
            out(inspect(a.glb))
            return 0
        root = pathlib.Path(a.root).resolve()
        if a.cmd in ("create", "run"):
            sent, recorded = load_params(a)
            if a.cmd == "run" and not a.dry_run:
                licence_for(a.plan)        # no credit spent on a model that could not be downloaded
            if a.dry_run:
                doc = dry_run(a.endpoint, sent, recorded)
                if a.cmd == "run":
                    doc["then"] = ["wait", "fetch"]
                    doc["licence"] = list(licence_for(a.plan)) if (a.plan or "").lower() in PLANS else "undetermined: fetch would refuse"
                out(doc)
                return 0
            client = Client(api_key(), opener)
            task_id = create(client, a.endpoint, sent)
            write_record(root, {"task_id": task_id, "endpoint": a.endpoint, "params": recorded,
                                "prompt": prompt_of(recorded)})
            say(f"created {a.endpoint} task {task_id}")
            if a.cmd == "create":
                out({"task_id": task_id, "endpoint": a.endpoint})
                return 0
        else:
            client = Client(api_key(), opener)
            task_id = a.task_id
        task = None
        if a.cmd in ("wait", "run"):
            task = wait(client, a.endpoint, task_id, a.max_wait, clock=clock, sleep=sleep)
            if a.cmd == "wait":
                out({"task_id": task_id, "status": task.get("status"),
                     "consumed_credits": task.get("consumed_credits"),
                     "outputs": [lab for lab, _ in outputs(task)]})
                return 0
        pats = tuple(p.strip() for p in a.outputs.split(",") if p.strip())
        entries = fetch(client, root, a.endpoint, task_id, a.plan, a.asset, pats, pathlib.Path(a.out),
                        task=task, opener=opener)
        out({"task_id": task_id, "files": [e["file"] for e in entries],
             "manifest": str(pathlib.Path(a.out) / "manifest.json"), "licence_id": entries[0]["licence_id"]})
        return 0
    except StillRunning as e:
        say(str(e))
        return 3
    except Refused as e:
        say(f"refused: {e}")
        return 1
    except (OSError, ValueError) as e:
        say(f"error: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())

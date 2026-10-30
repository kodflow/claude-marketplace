#!/usr/bin/env python3
"""Judge a move's constraints against sampled pose tracks.

    python3 -I check-constraints.py --constraints <move>.constraints.json \
        --track run.pose.json [--track …] [--view 3d|iso|profile] \
        [--all-hard] [--status confirmed] [--allow-unevaluated] [--json]

Inputs are move-constraints/v1 (what the panel wrote) and pose-track/v1 (what
a sampler measured: world transforms of bones and props, world points of
landmarks, per frame). Nothing here knows an engine: the samplers have
already mapped the engine's names to the rig map's logical names.

A constraint the tracks cannot measure (a clip not sampled, a name missing, an
empty window) is unevaluated, never passed. The run fails when a hard
constraint fails, when nothing applies (total 0), or when fewer were evaluated
than apply, unless --allow-unevaluated: a checker that passes what it could
not read is the failure this exists to prevent.

Standard library only, Python 3.9 or later. Coordinates are right-handed,
+Y up; angles are degrees, lengths metres, time seconds.
"""
import argparse
import hashlib
import json
import math
import sys

EXIT_OK, EXIT_FAIL, EXIT_USAGE = 0, 1, 2
KINDS = ("joint_angle", "frame_pose", "vector_angle", "velocity", "trajectory",
         "phase_offset", "reach_ratio", "grip", "handedness")


class Unmeasurable(Exception):
    """The tracks do not hold what the constraint needs."""


# ---------------------------------------------------------------- vectors

def sub(a, b):
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]


def add(a, b):
    return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]


def scale(a, k):
    return [a[0] * k, a[1] * k, a[2] * k]


def dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def cross(a, b):
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]


def norm(a):
    return math.sqrt(dot(a, a))


def unit(a):
    n = norm(a)
    if n < 1e-12:
        raise Unmeasurable("zero-length vector")
    return scale(a, 1.0 / n)


def angle(a, b):
    c = dot(unit(a), unit(b))
    return math.degrees(math.acos(max(-1.0, min(1.0, c))))


# ------------------------------------------------------------ quaternions
# [x, y, z, w], as three.js and Godot store them.

def qnorm(q):
    n = math.sqrt(sum(c * c for c in q))
    if n < 1e-12:
        raise Unmeasurable("zero quaternion")
    return [c / n for c in q]


def qconj(q):
    return [-q[0], -q[1], -q[2], q[3]]


def qmul(a, b):
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return [aw * bx + ax * bw + ay * bz - az * by,
            aw * by - ax * bz + ay * bw + az * bx,
            aw * bz + ax * by - ay * bx + az * bw,
            aw * bw - ax * bx - ay * by - az * bz]


def qrot(q, v):
    p = qmul(qmul(q, [v[0], v[1], v[2], 0.0]), qconj(q))
    return p[:3]


def qangle(q):
    q = qnorm(q)
    return math.degrees(2.0 * math.acos(min(1.0, abs(q[3]))))


def swing_twist(q, axis):
    """Split q into swing·twist around the unit axis; return (swing°, signed twist°)."""
    q = qnorm(q)
    a = unit(axis)
    p = dot(q[:3], a)
    tw = [a[0] * p, a[1] * p, a[2] * p, q[3]]
    if norm(tw[:3]) < 1e-12 and abs(tw[3]) < 1e-12:
        twist = 180.0
        tw = [a[0], a[1], a[2], 0.0]
    else:
        tw = qnorm(tw)
        twist = math.degrees(2.0 * math.atan2(dot(tw[:3], a), tw[3]))
    twist = (twist + 180.0) % 360.0 - 180.0
    swing = qmul(q, qconj(tw))
    return qangle(swing), twist


def qmat(q):
    x, y, z, w = qnorm(q)
    return [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]]


def euler(q, order):
    """Intrinsic Euler angles in degrees, three.js's convention (Euler.setFromRotationMatrix)."""
    m = qmat(q)
    m11, m12, m13 = m[0]
    m21, m22, m23 = m[1]
    m31, m32, m33 = m[2]
    c = lambda v: max(-1.0, min(1.0, v))
    if order == "XYZ":
        y = math.asin(c(m13))
        x, z = (math.atan2(-m23, m33), math.atan2(-m12, m11)) if abs(m13) < 0.9999999 else (math.atan2(m32, m22), 0.0)
    elif order == "YXZ":
        x = math.asin(-c(m23))
        y, z = (math.atan2(m13, m33), math.atan2(m21, m22)) if abs(m23) < 0.9999999 else (math.atan2(-m31, m11), 0.0)
    elif order == "ZXY":
        x = math.asin(c(m32))
        y, z = (math.atan2(-m31, m33), math.atan2(-m12, m22)) if abs(m32) < 0.9999999 else (0.0, math.atan2(m21, m11))
    elif order == "ZYX":
        y = math.asin(-c(m31))
        x, z = (math.atan2(m32, m33), math.atan2(m21, m11)) if abs(m31) < 0.9999999 else (0.0, math.atan2(-m12, m22))
    elif order == "YZX":
        z = math.asin(c(m21))
        x, y = (math.atan2(-m23, m22), math.atan2(-m31, m11)) if abs(m21) < 0.9999999 else (0.0, math.atan2(m13, m33))
    elif order == "XZY":
        z = math.asin(-c(m12))
        x, y = (math.atan2(m32, m22), math.atan2(m13, m11)) if abs(m12) < 0.9999999 else (math.atan2(-m23, m33), 0.0)
    else:
        raise Unmeasurable(f"unknown Euler order {order!r}")
    return {"x": math.degrees(x), "y": math.degrees(y), "z": math.degrees(z)}


# ------------------------------------------------------------------ track

class Track:
    """One pose-track/v1 clip."""

    def __init__(self, doc, path):
        if doc.get("schema_version") != "pose-track/v1":
            raise ValueError(f"{path}: schema_version is not pose-track/v1")
        self.path = path
        self.clip = doc["clip"]
        self.fps = float(doc["fps"])
        self.frames = doc["frames"]
        if not self.frames:
            raise ValueError(f"{path}: no frames")
        self.duration = float(doc.get("duration") or (self.frames[-1]["t"] - self.frames[0]["t"]) or 1.0)
        self.markers = doc.get("markers") or {}
        self.rest = doc.get("rest") or {}
        self.t0 = float(self.frames[0]["t"])

    def share(self, f):
        return (float(f["t"]) - self.t0) / self.duration if self.duration else 0.0

    def resolve(self, w):
        if isinstance(w, str):
            if w not in self.markers:
                raise Unmeasurable(f"marker {w!r} not in clip {self.clip}")
            return float(self.markers[w])
        return float(w)

    def window(self, c):
        w = c.get("window") or {}
        lo = self.resolve(w.get("from", 0.0))
        hi = self.resolve(w.get("to", 1.0))
        eps = 0.5 / (self.fps * self.duration) if self.duration else 1e-9
        idx = [i for i, f in enumerate(self.frames) if lo - eps <= self.share(f) <= hi + eps]
        if not idx:
            raise Unmeasurable(f"empty window {lo:.3f}–{hi:.3f} in clip {self.clip}")
        return idx

    def frame_at(self, share):
        best = min(range(len(self.frames)), key=lambda i: abs(self.share(self.frames[i]) - share))
        return best

    @staticmethod
    def _node(f, name):
        for key in ("bones", "props"):
            n = (f.get(key) or {}).get(name)
            if n is not None:
                return n
        return None

    def point(self, i, name):
        f = self.frames[i]
        p = (f.get("landmarks") or {}).get(name)
        if p is not None:
            return [float(v) for v in p]
        n = self._node(f, name)
        if n is None:
            raise Unmeasurable(f"{name!r} absent from clip {self.clip}")
        return [float(v) for v in n["p"]]

    def quat(self, i, name):
        n = self._node(self.frames[i], name)
        if n is None or "q" not in n:
            raise Unmeasurable(f"no orientation for {name!r} in clip {self.clip}")
        return qnorm([float(v) for v in n["q"]])

    def rest_quat(self, name):
        n = (self.rest.get("bones") or {}).get(name) or (self.rest.get("props") or {}).get(name)
        return qnorm([float(v) for v in n["q"]]) if n and "q" in n else None

    def rest_point(self, name):
        n = (self.rest.get("bones") or {}).get(name) or (self.rest.get("props") or {}).get(name)
        if n and "p" in n:
            return [float(v) for v in n["p"]]
        lm = (self.rest.get("landmarks") or {}).get(name)
        return [float(v) for v in lm] if lm else None

    def vector(self, i, spec):
        if "world" in spec:
            return [float(v) for v in spec["world"]]
        if "from" in spec:
            return sub(self.point(i, spec["to"]), self.point(i, spec["from"]))
        if "axis" in spec:
            return qrot(self.quat(i, spec["of"]), [float(v) for v in spec["axis"]])
        raise Unmeasurable(f"vector spec {spec!r} names no direction")

    def local(self, i, name, ref):
        """name's point in ref's frame."""
        return qrot(qconj(self.quat(i, ref)), sub(self.point(i, name), self.point(i, ref)))


# --------------------------------------------------------------- measures
# Each returns a list of (frame index, value); a few return one value at
# index -1 (a statistic of the whole window).

def m_joint_angle(tr, c, idx):
    bone, parent = c["bone"], c["parent"]
    rest_rel = None
    rb, rp = tr.rest_quat(bone), tr.rest_quat(parent)
    if rb is not None and rp is not None:
        rest_rel = qmul(qconj(rp), rb)
    out = []
    for i in idx:
        rel = qmul(qconj(tr.quat(i, parent)), tr.quat(i, bone))
        if rest_rel is not None:
            rel = qmul(qconj(rest_rel), rel)
        comp = c["component"]
        if comp == "total":
            v = qangle(rel)
        elif comp in ("swing", "twist"):
            if "axis" not in c:
                raise Unmeasurable("swing/twist needs a local axis")
            s, t = swing_twist(rel, c["axis"])
            v = s if comp == "swing" else t
        else:
            v = euler(rel, c.get("order", "XYZ"))[c.get("euler_axis", "x")]
        out.append((i, v))
    return out


def m_frame_pose(tr, c, idx):
    out = []
    for i in idx:
        if "orientation" in c:
            o = c["orientation"]
            a = qrot(tr.quat(i, c["target"]), o["axis"])
            b = qrot(tr.quat(i, c["ref"]), o["ref_axis"])
            out.append((i, angle(a, b)))
            continue
        p = tr.local(i, c["target"], c["ref"])
        comp = c.get("component", "distance")
        out.append((i, norm(p) if comp == "distance" else p["xyz".index(comp)]))
    return out


def m_vector_angle(tr, c, idx):
    return [(i, angle(tr.vector(i, c["a"]), tr.vector(i, c["b"]))) for i in idx]


def _positions(tr, name, ref, idx):
    return [tr.local(i, name, ref) if ref else tr.point(i, name) for i in idx]


def m_velocity(tr, c, idx):
    if len(idx) < 2:
        raise Unmeasurable("velocity needs two frames")
    out = []
    ref = c.get("relative_to")
    if c.get("mode", "linear") == "angular":
        bone = c.get("bone") or c.get("point")
        for a, b in zip(idx, idx[1:]):
            dt = float(tr.frames[b]["t"]) - float(tr.frames[a]["t"])
            qa, qb = tr.quat(a, bone), tr.quat(b, bone)
            if ref:
                qa, qb = qmul(qconj(tr.quat(a, ref)), qa), qmul(qconj(tr.quat(b, ref)), qb)
            out.append((b, qangle(qmul(qb, qconj(qa))) / dt if dt > 0 else 0.0))
        return out
    pts = _positions(tr, c["point"], ref, idx)
    for k in range(1, len(idx)):
        dt = float(tr.frames[idx[k]]["t"]) - float(tr.frames[idx[k - 1]]["t"])
        out.append((idx[k], norm(sub(pts[k], pts[k - 1])) / dt if dt > 0 else 0.0))
    return out


def m_trajectory(tr, c, idx):
    if len(idx) < 3:
        raise Unmeasurable("a trajectory needs three frames")
    ref = c.get("relative_to")
    pts = _positions(tr, c["point"], ref, idx)
    metric = c["metric"]
    if metric == "velocity_axis_angle":
        if "blade_axis" not in c:
            raise Unmeasurable("velocity_axis_angle needs blade_axis")
        out = []
        for k in range(1, len(idx)):
            v = sub(pts[k], pts[k - 1])
            if norm(v) < 1e-9:
                continue
            ax = tr.vector(idx[k], c["blade_axis"])
            if ref:
                ax = qrot(qconj(tr.quat(idx[k], ref)), ax)
            a = angle(v, ax)
            out.append((idx[k], min(a, 180.0 - a)))
        if not out:
            raise Unmeasurable("the point does not move in the window")
        return out
    path = sum(norm(sub(pts[k], pts[k - 1])) for k in range(1, len(pts)))
    if metric == "path_length":
        return [(-1, path)]
    if path < 1e-9:
        raise Unmeasurable("the point does not move in the window")
    chord = sub(pts[-1], pts[0])
    if metric == "chord_arc_ratio":
        return [(-1, norm(chord) / path)]
    if metric == "displacement_angle":
        if "against" not in c:
            raise Unmeasurable("displacement_angle needs against")
        ag = tr.vector(idx[0], c["against"])
        if ref:
            ag = qrot(qconj(tr.quat(idx[0], ref)), ag)
        return [(-1, angle(chord, ag))]
    raise Unmeasurable(f"unknown trajectory metric {metric!r}")


def _series(tr, s, idx):
    comp = "xyz".index(s["component"])
    return [(tr.local(i, s["point"], s["ref"]) if s.get("ref") else tr.point(i, s["point"]))[comp] for i in idx]


def m_phase_offset(tr, c, idx):
    """Cyclic lag of b behind a, as a share of the window, by cross-correlation."""
    a, b = _series(tr, c["a"], idx), _series(tr, c["b"], idx)
    n = len(a)
    if n < 4:
        raise Unmeasurable("phase needs four frames")
    ma, mb = sum(a) / n, sum(b) / n
    a = [x - ma for x in a]
    b = [x - mb for x in b]
    if max(map(abs, a)) < 1e-9 or max(map(abs, b)) < 1e-9:
        raise Unmeasurable("a series does not move: no phase")
    best, lag = None, 0
    for k in range(n):
        r = sum(a[j] * b[(j + k) % n] for j in range(n))
        if best is None or r > best:
            best, lag = r, k
    return [(-1, lag / n)]


def m_reach_ratio(tr, c, idx):
    chain = c["chain"]
    rest = [tr.rest_point(n) for n in chain]
    if all(p is not None for p in rest):
        full = sum(norm(sub(rest[k], rest[k - 1])) for k in range(1, len(rest)))
    else:
        i0 = idx[0]
        full = sum(norm(sub(tr.point(i0, chain[k]), tr.point(i0, chain[k - 1]))) for k in range(1, len(chain)))
    if full < 1e-9:
        raise Unmeasurable("the chain has no length")
    return [(i, norm(sub(tr.point(i, c["to"]), tr.point(i, c["from"]))) / full) for i in idx]


def _closest_on_line(p, a, d):
    d = unit(d)
    return add(a, scale(d, dot(sub(p, a), d)))


def m_grip(tr, c, idx):
    out = []
    for i in idx:
        palm = tr.point(i, c["palm"])
        g = c["grip_axis"]
        if "from" not in g:
            raise Unmeasurable("grip_axis must run from a point to a point (pommel side to blade side)")
        a = tr.point(i, g["from"])
        d = sub(tr.point(i, g["to"]), a)
        on = _closest_on_line(palm, a, d)
        check = c["check"]
        if check == "palm_distance":
            out.append((i, norm(sub(palm, on))))
        elif check == "fingers_wrap":
            fingers = c.get("fingers") or []
            if not fingers:
                raise Unmeasurable("fingers_wrap needs finger landmarks")
            to_palm = sub(palm, on)
            if norm(to_palm) < 1e-6:
                raise Unmeasurable("the palm sits on the grip axis: no side to compare")
            far = 0
            for fn in fingers:
                fp = tr.point(i, fn)
                if dot(sub(fp, _closest_on_line(fp, a, d)), to_palm) < 0:
                    far += 1
            out.append((i, far / len(fingers)))
        elif check == "index_toward_blade":
            v = sub(tr.point(i, c["index"]), tr.point(i, c["pinky"]))
            out.append((i, 1.0 if dot(v, d) > 0 else -1.0))
        else:
            raise Unmeasurable(f"unknown grip check {check!r}")
    return out


def m_handedness(tr, c, idx):
    """sign det[(index−pinky), (middle−wrist), (palm−center)]: +1 right hand, −1 left."""
    out = []
    for i in idx:
        u = sub(tr.point(i, c["index"]), tr.point(i, c["pinky"]))
        v = sub(tr.point(i, c["middle"]), tr.point(i, c["wrist"]))
        n = sub(tr.point(i, c["palm"]), tr.point(i, c["center"]))
        d = dot(u, cross(v, n))
        out.append((i, 1.0 if d > 0 else -1.0))
    return out


MEASURES = {"joint_angle": m_joint_angle, "frame_pose": m_frame_pose, "vector_angle": m_vector_angle,
            "velocity": m_velocity, "trajectory": m_trajectory, "phase_offset": m_phase_offset,
            "reach_ratio": m_reach_ratio, "grip": m_grip, "handedness": m_handedness}


# ------------------------------------------------------------------ tests

def inside(v, t):
    return ("min" not in t or v >= t["min"]) and ("max" not in t or v <= t["max"])


def judge(tr, series, t):
    """(value reported, passed) for a series under the constraint's test."""
    stat = t["stat"]
    vals = [v for _, v in series]
    if not vals:
        raise Unmeasurable("nothing measured")
    if len(series) == 1 and series[0][0] == -1:
        return vals[0], inside(vals[0], t)
    if stat == "all":
        worst = [v for v in vals if not inside(v, t)]
        return (worst[0] if worst else (min(vals) if "min" in t else max(vals))), not worst
    if stat == "any":
        good = [v for v in vals if inside(v, t)]
        return (good[0] if good else vals[0]), bool(good)
    if stat == "mean":
        v = sum(vals) / len(vals)
    elif stat == "max":
        v = max(vals)
    elif stat == "min":
        v = min(vals)
    elif stat == "peak_to_peak":
        v = max(vals) - min(vals)
    elif stat == "at":
        want = tr.frame_at(tr.resolve(t["at"]))
        hit = [v for i, v in series if i == want]
        if not hit:
            raise Unmeasurable(f"frame at {t['at']} is outside the window")
        v = hit[0]
    else:
        raise Unmeasurable(f"unknown stat {stat!r}")
    return v, inside(v, t)


# ------------------------------------------------------------------- main

def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def structural(doc):
    """Faults of a constraints document that make it unreadable as a whole."""
    bad = []
    if doc.get("schema_version") != "move-constraints/v1":
        bad.append("schema_version is not move-constraints/v1")
    for k in ("move", "fps", "rig_map", "clip", "constraints"):
        if k not in doc:
            bad.append(f"missing {k}")
    ids = set()
    for c in doc.get("constraints") or []:
        cid = c.get("id", "?")
        if cid in ids:
            bad.append(f"duplicate constraint id {cid}")
        ids.add(cid)
        for k in ("id", "kind", "severity", "status", "observable", "rationale", "test"):
            if k not in c:
                bad.append(f"{cid}: missing {k}")
        if c.get("kind") not in KINDS:
            bad.append(f"{cid}: unknown kind {c.get('kind')!r}")
        if c.get("severity") not in ("hard", "soft"):
            bad.append(f"{cid}: severity must be hard or soft")
        if c.get("status") not in ("proposed", "confirmed"):
            bad.append(f"{cid}: status must be proposed or confirmed")
        t = c.get("test") or {}
        if "min" not in t and "max" not in t:
            bad.append(f"{cid}: test has neither min nor max")
    return bad


def evaluate(doc, tracks, view="3d", all_hard=False, status=None):
    results = []
    default_clip = doc["clip"]
    for c in doc["constraints"]:
        if status and c.get("status") != status:
            continue
        if not (c.get("observable") or {}).get(view, view == "3d"):
            continue
        sev = "hard" if all_hard else c["severity"]
        r = {"id": c["id"], "kind": c["kind"], "severity": sev, "status": c["status"],
             "clip": c.get("clip", default_clip), "test": c["test"], "unit": c.get("unit")}
        tr = tracks.get(r["clip"])
        try:
            if tr is None:
                raise Unmeasurable(f"no track for clip {r['clip']!r}")
            series = MEASURES[c["kind"]](tr, c, tr.window(c))
            value, ok = judge(tr, series, c["test"])
            r.update(evaluated=True, value=round(value, 4), passed=ok)
        except Unmeasurable as e:
            r.update(evaluated=False, passed=None, reason=str(e))
        except (KeyError, TypeError, ValueError, IndexError) as e:
            r.update(evaluated=False, passed=None, reason=f"{type(e).__name__}: {e}")
        results.append(r)
    return results


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--constraints", required=True)
    ap.add_argument("--track", action="append", default=[], required=True)
    ap.add_argument("--view", default="3d", choices=("3d", "iso", "profile"))
    ap.add_argument("--all-hard", action="store_true", help="treat every constraint as hard (evaluation runs)")
    ap.add_argument("--status", choices=("proposed", "confirmed"), help="only constraints with this status")
    ap.add_argument("--allow-unevaluated", action="store_true")
    ap.add_argument("--json", action="store_true", help="print the report as JSON")
    a = ap.parse_args(argv)

    try:
        doc = load_json(a.constraints)
        tracks = {}
        for p in a.track:
            t = Track(load_json(p), p)
            tracks[t.clip] = t
    except (OSError, ValueError, KeyError) as e:
        print(f"check-constraints: cannot read input: {e}", file=sys.stderr)
        return EXIT_USAGE
    bad = structural(doc)
    if bad:
        for b in bad:
            print(f"check-constraints: {a.constraints}: {b}", file=sys.stderr)
        return EXIT_USAGE

    results = evaluate(doc, tracks, a.view, a.all_hard, a.status)
    total = len(results)
    evaluated = sum(1 for r in results if r["evaluated"])
    hard_failed = [r["id"] for r in results if r["evaluated"] and not r["passed"] and r["severity"] == "hard"]
    soft_failed = [r["id"] for r in results if r["evaluated"] and not r["passed"] and r["severity"] == "soft"]
    report = {
        "schema": "constraint-report/v1",
        "move": doc["move"],
        "constraints_sha256": sha256_file(a.constraints),
        "tracks": {t.clip: sha256_file(t.path) for t in tracks.values()},
        "view": a.view, "all_hard": a.all_hard,
        "evaluated": evaluated, "total": total,
        "hard_failed": hard_failed, "soft_failed": soft_failed,
        "results": results,
    }
    reasons = []
    if hard_failed:
        reasons.append(f"{len(hard_failed)} hard constraint(s) failed")
    if total == 0:
        reasons.append("no constraint applies (total 0)")
    if evaluated < total and not a.allow_unevaluated:
        reasons.append(f"only {evaluated}/{total} evaluated")
    report["verdict"] = "fail" if reasons else "pass"
    report["why"] = reasons

    if a.json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
    else:
        print(f"{doc['move']}: {report['verdict']} — evaluated {evaluated}/{total}, "
              f"constraints sha256 {report['constraints_sha256'][:12]}")
        for r in results:
            mark = "skip" if not r["evaluated"] else ("ok  " if r["passed"] else "FAIL")
            detail = r.get("reason") if not r["evaluated"] else f"value {r['value']} {r.get('unit') or ''}".rstrip()
            print(f"  {mark} {r['severity']:4} {r['id']} ({r['kind']}, {r['clip']}): {detail}")
        for w in reasons:
            print(f"  -> {w}")
    return EXIT_FAIL if reasons else EXIT_OK


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""The plugin's Python scripts, against synthetic inputs only. Standard library, Python 3.9+.

    python3 -I test_scripts.py

check-constraints.py: the math of every kind on hand-built tracks, and the
exit codes (hard failure, total 0, unevaluated, malformed input).
feedback-rules.py: the hash rules-digest.sh recomputes, the section order,
and each named failure (unreadable, unknown schema, dangling, cycle, fork);
an ADR is created exclusively and never overwritten.
cache-source.py: exact, normalised, not found and fetch failures, offline.
fetch-reference.py: magic bytes, Commons licence refusals, placement of
committable and study copies, a manifest with no timestamp.
"""
import contextlib
import importlib.util
import io
import json
import math
import pathlib
import shutil
import subprocess
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True     # the scripts are imported from the plugin: leave no __pycache__ there
HERE = pathlib.Path(__file__).resolve().parent
SCRIPTS = HERE.parent / "skills" / "_shared" / "scripts"


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), SCRIPTS / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


cc = load("check-constraints")
fr = load("feedback-rules")
cs = load("cache-source")
fx = load("fetch-reference")


def qaxis(axis, deg):
    a = math.radians(deg) / 2
    n = math.sqrt(sum(x * x for x in axis))
    return [axis[0] / n * math.sin(a), axis[1] / n * math.sin(a), axis[2] / n * math.sin(a), math.cos(a)]


def mktrack(frames, clip="c", fps=10, **kw):
    doc = {"schema_version": "pose-track/v1", "clip": clip, "fps": fps,
           "frames": [dict(f, t=i / fps) for i, f in enumerate(frames)]}
    doc.update(kw)
    return cc.Track(doc, "mem")


def C(kind, test, **kw):
    d = {"id": "x", "kind": kind, "severity": "hard", "status": "proposed",
         "observable": {"3d": True}, "rationale": "test", "test": test}
    d.update(kw)
    return d


def run_cli(mod, argv):
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        rc = mod.main(argv)
    return rc, out.getvalue(), err.getvalue()


class Measures(unittest.TestCase):
    def series(self, c, tr):
        return cc.MEASURES[c["kind"]](tr, c, tr.window(c))

    def test_swing_twist(self):
        s, t = cc.swing_twist(qaxis([0, 1, 0], 70), [0, 1, 0])
        self.assertAlmostEqual(s, 0, 4)
        self.assertAlmostEqual(t, 70, 4)
        s, t = cc.swing_twist(qaxis([1, 0, 0], 40), [0, 1, 0])
        self.assertAlmostEqual(s, 40, 4)
        self.assertAlmostEqual(t, 0, 4)

    def test_joint_angle_relative_to_parent_and_rest(self):
        par = qaxis([0, 0, 1], 30)
        bone = cc.qmul(par, qaxis([0, 1, 0], -50))      # 50° of twist under the parent
        f = {"bones": {"p": {"p": [0, 0, 0], "q": par}, "b": {"p": [0, 1, 0], "q": bone}}}
        tr = mktrack([f, f])
        c = C("joint_angle", {"stat": "all", "min": -55, "max": -45}, bone="b", parent="p", component="twist", axis=[0, 1, 0])
        self.assertAlmostEqual(self.series(c, tr)[0][1], -50, 3)
        rest = {"bones": {"p": {"p": [0, 0, 0], "q": [0, 0, 0, 1]}, "b": {"p": [0, 1, 0], "q": qaxis([0, 1, 0], -20)}}}
        tr = mktrack([f, f], rest=rest)
        self.assertAlmostEqual(self.series(c, tr)[0][1], -30, 3)
        e = C("joint_angle", {"stat": "all", "max": 0}, bone="b", parent="p", component="euler", order="XYZ", euler_axis="y")
        self.assertAlmostEqual(self.series(e, mktrack([f, f]))[0][1], -50, 3)

    def test_frame_pose_and_vector_angle(self):
        f = {"bones": {"chest": {"p": [0, 1, 0], "q": qaxis([0, 1, 0], 90)}, "h": {"p": [1, 1, 0], "q": [0, 0, 0, 1]}}}
        tr = mktrack([f, f])
        c = C("frame_pose", {"stat": "all", "min": 0.99, "max": 1.01}, target="h", ref="chest", component="z")
        self.assertAlmostEqual(self.series(c, tr)[0][1], 1.0, 5)   # +X world is +Z in a frame yawed +90°
        o = C("frame_pose", {"stat": "all", "max": 1}, target="h", ref="chest", orientation={"axis": [1, 0, 0], "ref_axis": [1, 0, 0]})
        self.assertAlmostEqual(self.series(o, tr)[0][1], 90, 4)
        v = C("vector_angle", {"stat": "all", "max": 1}, a={"from": "chest", "to": "h"}, b={"world": [0, 1, 0]})
        self.assertAlmostEqual(self.series(v, tr)[0][1], 90, 4)
        ax = C("vector_angle", {"stat": "all", "max": 1}, a={"axis": [0, 0, 1], "of": "chest"}, b={"world": [1, 0, 0]})
        self.assertAlmostEqual(self.series(ax, tr)[0][1], 0, 4)

    def test_velocity(self):
        fr_ = [{"bones": {"r": {"p": [0, 0, 0], "q": qaxis([0, 1, 0], 9 * i)}},
                "landmarks": {"tip": [0.1 * i, 0, 0]}} for i in range(5)]
        tr = mktrack(fr_, fps=10)
        lin = C("velocity", {"stat": "max", "max": 2}, point="tip")
        self.assertTrue(all(abs(v - 1.0) < 1e-6 for _, v in self.series(lin, tr)))
        rel = C("velocity", {"stat": "max", "max": 2}, point="tip", relative_to="r")
        self.assertTrue(all(v > 0.99 for _, v in self.series(rel, tr)))
        ang = C("velocity", {"stat": "max", "max": 100}, bone="r", mode="angular")
        self.assertTrue(all(abs(v - 90) < 1e-3 for _, v in self.series(ang, tr)))

    def test_trajectory_cut_versus_thrust(self):
        arc = [{"landmarks": {"b": [0, 0, 0], "tip": [math.cos(a), math.sin(a), 0]}}
               for a in [math.radians(10 * i) for i in range(10)]]
        line = [{"landmarks": {"b": [0.1 * i, 0, 0], "tip": [0.1 * i + 1, 0, 0]}} for i in range(10)]
        cut = C("trajectory", {"stat": "mean", "min": 60}, point="tip", metric="velocity_axis_angle", blade_axis={"from": "b", "to": "tip"})
        self.assertGreater(cc.judge(None, self.series(cut, mktrack(arc)), cut["test"])[0], 80)
        self.assertLess(cc.judge(None, self.series(cut, mktrack(line)), cut["test"])[0], 1)
        ratio = C("trajectory", {"stat": "max", "max": 0.97}, point="tip", metric="chord_arc_ratio")
        self.assertAlmostEqual(self.series(ratio, mktrack(line))[0][1], 1.0, 6)
        disp = C("trajectory", {"stat": "max", "max": 10}, point="tip", metric="displacement_angle", against={"world": [1, 0, 0]})
        self.assertAlmostEqual(self.series(disp, mktrack(line))[0][1], 0, 4)

    def test_phase_offset(self):
        n = 20
        f = [{"landmarks": {"a": [0, math.sin(2 * math.pi * i / n), 0], "b": [0, -math.sin(2 * math.pi * i / n), 0]}} for i in range(n)]
        c = C("phase_offset", {"stat": "all", "min": 0.45, "max": 0.55}, a={"point": "a", "component": "y"}, b={"point": "b", "component": "y"})
        self.assertAlmostEqual(self.series(c, mktrack(f))[0][1], 0.5, 6)

    def test_handedness_sign(self):
        right = {"landmarks": {"i": [0, 0.04, 0], "p": [0, -0.04, 0], "m": [0, 0, -0.1], "w": [0, 0, 0.05],
                               "palm": [-0.02, 0, 0], "c": [0, 0, 0]}}
        left = json.loads(json.dumps(right))
        for k in left["landmarks"]:
            left["landmarks"][k][0] *= -1        # a mirror image
        c = C("handedness", {"stat": "all", "min": 0}, index="i", pinky="p", middle="m", wrist="w", palm="palm", center="c")
        self.assertEqual(self.series(c, mktrack([right]))[0][1], 1.0)
        self.assertEqual(self.series(c, mktrack([left]))[0][1], -1.0)

    def test_window_and_markers(self):
        f = [{"bones": {"x": {"p": [i, 0, 0], "q": [0, 0, 0, 1]}}} for i in range(11)]
        tr = mktrack(f, markers={"impact": 0.5})
        c = C("frame_pose", {"stat": "at", "at": "impact", "min": 0}, target="x", ref="x", window={"from": 0.4, "to": "impact"})
        self.assertEqual([i for i, _ in self.series(c, tr)], [4, 5])
        with self.assertRaises(cc.Unmeasurable):
            mktrack(f).window(C("frame_pose", {"stat": "all", "min": 0}, target="x", ref="x", window={"from": "nope"}))


class Exits(unittest.TestCase):
    def setUp(self):
        self.d = pathlib.Path(tempfile.mkdtemp())

    def tearDown(self):
        shutil.rmtree(self.d)

    def write(self, name, doc):
        p = self.d / name
        p.write_text(json.dumps(doc))
        return str(p)

    def base(self, constraints):
        return {"schema_version": "move-constraints/v1", "move": "m", "fps": 10, "rig_map": "r", "clip": "c",
                "constraints": constraints}

    def track(self):
        return self.write("t.json", {"schema_version": "pose-track/v1", "clip": "c", "fps": 10,
                                     "frames": [{"t": i / 10, "bones": {"a": {"p": [i, 0, 0], "q": [0, 0, 0, 1]}}} for i in range(4)]})

    def test_total_zero_fails(self):
        rc, out, _ = run_cli(cc, ["--constraints", self.write("c.json", self.base([])), "--track", self.track()])
        self.assertEqual(rc, 1)
        self.assertIn("total 0", out)

    def test_unevaluated_fails_unless_allowed(self):
        c = C("frame_pose", {"stat": "all", "max": 10}, target="missing", ref="a")
        p = self.write("c.json", self.base([c]))
        rc, out, _ = run_cli(cc, ["--constraints", p, "--track", self.track()])
        self.assertEqual(rc, 1)
        self.assertIn("0/1 evaluated", out)
        rc, _, _ = run_cli(cc, ["--constraints", p, "--track", self.track(), "--allow-unevaluated"])
        self.assertEqual(rc, 0)

    def test_soft_failure_passes_all_hard_fails(self):
        c = C("frame_pose", {"stat": "all", "max": 0.5}, target="a", ref="a", component="distance")
        c["target"] = "a"
        c2 = dict(C("trajectory", {"stat": "max", "max": 0.1}, point="a", metric="path_length"), id="y", severity="soft")
        p = self.write("c.json", self.base([c, c2]))
        rc, out, _ = run_cli(cc, ["--constraints", p, "--track", self.track(), "--json"])
        self.assertEqual(rc, 0, out)
        rc, out, _ = run_cli(cc, ["--constraints", p, "--track", self.track(), "--all-hard", "--json"])
        self.assertEqual(rc, 1)
        self.assertEqual(json.loads(out)["hard_failed"], ["y"])

    def test_malformed_is_a_usage_error(self):
        bad = self.base([{"id": "x", "kind": "telepathy"}])
        rc, _, err = run_cli(cc, ["--constraints", self.write("c.json", bad), "--track", self.track()])
        self.assertEqual(rc, 2)
        self.assertIn("unknown kind", err)
        rc, _, _ = run_cli(cc, ["--constraints", self.write("c.json", self.base([])), "--track", self.write("t.json", {"x": 1})])
        self.assertEqual(rc, 2)

    def test_view_filter_and_status(self):
        c = dict(C("frame_pose", {"stat": "all", "max": 1}, target="a", ref="a"), observable={"3d": True, "iso": False})
        c2 = dict(c, id="y", status="confirmed", observable={"3d": True, "iso": True})
        p = self.write("c.json", self.base([c, c2]))
        rc, out, _ = run_cli(cc, ["--constraints", p, "--track", self.track(), "--view", "iso", "--json"])
        self.assertEqual(json.loads(out)["total"], 1)
        rc, out, _ = run_cli(cc, ["--constraints", p, "--track", self.track(), "--status", "confirmed", "--json"])
        self.assertEqual([r["id"] for r in json.loads(out)["results"]], ["y"])


def header(**kw):
    h = {"schema": "feedback-adr/v1", "verdict": "bad", "rule": "Keep the hand steady.", "scope": ["move:run", "area:locomotion"],
         "supersedes": [], "reach": "project",
         "subject": {"spec": "docs/anim/run.md", "constraints_sha256": None, "clip": "run", "commit": "abc", "credits": []},
         "constraint": "unmeasured"}
    h.update(kw)
    return h


def adr_text(h):
    return f"# x\n\n```json\n{json.dumps(h)}\n```\n\n## Observed\n\n> words\n"


class Rules(unittest.TestCase):
    def setUp(self):
        self.root = pathlib.Path(tempfile.mkdtemp())
        self.dir = self.root / "docs/adr/feedback"
        self.dir.mkdir(parents=True)

    def tearDown(self):
        shutil.rmtree(self.root)

    def adr(self, name, h):
        (self.dir / name).write_text(adr_text(h))

    def cli(self, *argv):
        return run_cli(fr, list(argv) + ["--root", str(self.root)])

    def test_build_sections_hash_and_check(self):
        self.adr("20261030-100000-a-0001.md", header())
        meas = {"kind": "frame_pose", "measured": 0.3, "threshold": {"stat": "peak_to_peak", "max": 0.08}, "status": "confirmed"}
        self.adr("20261030-110000-b-0002.md", header(constraint=meas, verdict="good", rule="Hard one."))
        self.adr("20261030-120000-c-0003.md", header(constraint=dict(meas, status="proposed"), rule="Proposed one."))
        (self.dir / "README.md").write_text("not an ADR")
        rc, out, _ = self.cli("build")
        self.assertEqual(rc, 0)
        text = (self.dir / ".RULES.md").read_text()
        self.assertLess(text.index("## Hard"), text.index("## Proposed"))
        self.assertLess(text.index("## Proposed"), text.index("## Advisory"))
        self.assertIn("Hard one.", text.split("## Proposed")[0])
        self.assertIn(".RULES.md", (self.dir / ".gitignore").read_text())
        lines = "".join(f"{__import__('hashlib').sha256((self.dir / n).read_bytes()).hexdigest()}  {n}\n"
                        for n in sorted(p.name for p in self.dir.glob("2026*.md")))
        self.assertIn(__import__("hashlib").sha256(lines.encode()).hexdigest(), text.split("\n")[0])
        self.assertEqual(self.cli("check")[0], 0)
        self.adr("20261030-130000-d-0004.md", header())
        self.assertEqual(self.cli("check")[0], 1)

    def test_named_failures(self):
        cases = {
            "dangling": header(supersedes=["20200101-000000-gone-ffff.md"]),
            "schema": header(schema="feedback-adr/v9"),
            "verdict": header(verdict="meh"),
        }
        for what, h in cases.items():
            for p in self.dir.glob("*.md"):
                p.unlink()
            self.adr("20261030-100000-a-0001.md", h)
            rc, _, err = self.cli("build")
            self.assertEqual(rc, 1, what)
            self.assertIn("20261030-100000-a-0001.md", err, what)
        for p in self.dir.glob("*.md"):
            p.unlink()
        (self.dir / "20261030-100000-a-0001.md").write_bytes(b"\xff\xfe no header")
        rc, _, err = self.cli("build")
        self.assertEqual(rc, 1)
        self.assertIn("unreadable", err)

    def test_cycle_and_fork(self):
        a, b, c = "20261030-100000-a-0001.md", "20261030-110000-b-0002.md", "20261030-120000-c-0003.md"
        self.adr(a, header(supersedes=[b]))
        self.adr(b, header(supersedes=[a]))
        rc, _, err = self.cli("build")
        self.assertEqual(rc, 1)
        self.assertIn("cycle", err)
        self.adr(a, header())
        self.adr(b, header(supersedes=[a]))
        self.adr(c, header(supersedes=[a]))
        rc, _, err = self.cli("build")
        self.assertEqual(rc, 1)
        self.assertIn("fork", err)

    def test_supersede_drops_the_old_rule(self):
        a, b = "20261030-100000-a-0001.md", "20261030-110000-b-0002.md"
        self.adr(a, header(rule="Old rule."))
        self.adr(b, header(rule="New rule.", supersedes=[a]))
        self.cli("build")
        text = (self.dir / ".RULES.md").read_text()
        self.assertIn("New rule.", text)
        self.assertNotIn("Old rule.", text)

    def test_new_is_exclusive_and_export(self):
        tmp = pathlib.Path(tempfile.mkdtemp())
        meas = {"kind": "frame_pose", "measured": 0.3, "threshold": {"stat": "peak_to_peak", "max": 0.08},
                "status": "confirmed", "definition": {"id": "fb", "kind": "frame_pose", "clip": "run", "target": "h", "ref": "c",
                                                      "observable": {"3d": True}, "rationale": "owner", "test": {"stat": "peak_to_peak", "max": 0.08},
                                                      "severity": "soft", "status": "proposed"}}
        (tmp / "h.json").write_text(json.dumps(header(constraint=meas)))
        (tmp / "o.txt").write_text("le poing bat pendant la course\n")
        names = set()
        for _ in range(3):
            rc, out, err = self.cli("new", "--slug", "run", "--header", str(tmp / "h.json"), "--observed", str(tmp / "o.txt"))
            self.assertEqual(rc, 0, err)
            names.add(out.split("\n")[0])
        self.assertEqual(len(names), 3)
        one = (self.root / sorted(names)[0]).read_text()
        self.assertIn("> le poing bat pendant la course", one)
        (tmp / "empty.txt").write_text("  \n")
        self.assertEqual(self.cli("new", "--slug", "run", "--header", str(tmp / "h.json"), "--observed", str(tmp / "empty.txt"))[0], 1)
        rc, _, _ = self.cli("export", "--out", str(tmp / "x.json"))
        doc = json.loads((tmp / "x.json").read_text())
        self.assertEqual(len(doc["constraints"]), 3)
        self.assertTrue(all(c["severity"] == "hard" and c["status"] == "confirmed" for c in doc["constraints"]))
        self.assertEqual(len({c["id"] for c in doc["constraints"]}), 3)
        self.assertEqual(cc.structural(doc), [])
        (tmp / "run.json").write_text(json.dumps({"slug": "run", "agents": [], "verdict": "pending"}))
        rc, out, _ = self.cli("record-run", "--file", str(tmp / "run.json"))
        self.assertEqual(rc, 0)
        self.assertTrue(out.startswith("docs/anim/runs/"))
        shutil.rmtree(tmp)

    def test_exclusive_create_never_overwrites(self):
        p = self.dir / "20261030-100000-a-0001.md"
        p.write_text("first")
        with self.assertRaises(FileExistsError):
            fr.atomic_write(p, "second", exclusive=True)
        self.assertEqual(p.read_text(), "first")


class Sources(unittest.TestCase):
    def test_match_modes(self):
        body = '<p>Der <b>Zornhau</b> &amp; “die Lange” schlägt</p>'.encode()
        self.assertEqual(cs.match("Zornhau</b> &amp;", body), "exact")
        self.assertEqual(cs.match('zornhau & "die lange"', body), "normalised")
        self.assertEqual(cs.match("Krumphau", body), "not_found")
        self.assertEqual(cs.match("", body), "no_excerpt")

    def test_offline_run_caches_only_verified(self):
        root = pathlib.Path(tempfile.mkdtemp())
        (root / "body.html").write_text("<html>The quick <i>brown</i> fox</html>")
        bodies = {"https://ex.example/a": str(root / "body.html")}
        (root / "bodies.json").write_text(json.dumps(bodies))
        panel = {"schema": "panel-member/v1", "agent": "x", "sources": [
            {"url": "https://ex.example/a", "excerpt": "quick brown fox"},
            {"url": "https://ex.example/a", "excerpt": "lazy dog"},
            {"url": "https://ex.example/missing", "excerpt": "x"}]}
        (root / "p.json").write_text(json.dumps(panel))
        rc, out, _ = run_cli(cs, ["--root", str(root), "--panel", str(root / "p.json"), "--offline", str(root / "bodies.json"), "--json"])
        rep = json.loads(out)
        self.assertEqual([s["match_mode"] for s in rep["sources"]], ["normalised", "not_found", "fetch_failed:offline_missing"])
        self.assertEqual(rep["verified"], 1)
        self.assertEqual(len(list((root / "docs/anim/sources").glob("*.md"))), 1)
        shutil.rmtree(root)

    def test_http_is_refused(self):
        self.assertEqual(cs.fetch("http://example.com/")[0], "not_https")


class References(unittest.TestCase):
    PNG = b"\x89PNG\r\n\x1a\n" + b"\0" * 32

    def args(self, root, **kw):
        a = {"root": str(root), "url": "https://upload.wikimedia.org/wikipedia/commons/a/ab/Plate.png",
             "page": None, "licence_id": None, "author": None, "move": "cut", "private": False}
        a.update(kw)
        return type("A", (), a)

    def test_magic(self):
        self.assertEqual(fx.kind_of(self.PNG[:16]), "png")
        self.assertEqual(fx.kind_of(b"\xff\xd8\xff\xe0" + b"\0" * 12), "jpg")
        self.assertEqual(fx.kind_of(b"RIFF\0\0\0\0WEBPVP8 "), "webp")
        self.assertIsNone(fx.kind_of(b"<html><body>"))

    def test_commons(self):
        self.assertEqual(fx.commons_title("https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/X_y.jpg/320px-X_y.jpg", None), "File:X y.jpg")
        self.assertEqual(fx.commons_title("https://x.example/i.png", "https://commons.wikimedia.org/wiki/File:Z.png"), "File:Z.png")
        self.assertEqual(fx.file_title("https://commons.wikimedia.org/wiki/Special:FilePath/A_b.png"), "File:A b.png")
        with self.assertRaises(fx.Refused):
            fx.commons_licence({"Artist": {"value": "A"}})
        with self.assertRaises(fx.Refused):
            fx.commons_licence({"LicenseShortName": {"value": "CC BY-SA 4.0"}})
        self.assertEqual(fx.commons_licence({"LicenseShortName": {"value": "CC BY-SA 4.0"}, "Artist": {"value": "<a>Me</a>"}}), ("CC-BY-SA-4.0", "Me"))
        hidden = 'Unknown author<span style="display: none;">Unknown author</span>'
        self.assertEqual(fx.commons_licence({"LicenseShortName": {"value": "Public domain"}, "Artist": {"value": hidden}}), ("PD", "Unknown author"))

    def test_placement(self):
        root = pathlib.Path(tempfile.mkdtemp())
        get = lambda url: (self.PNG, url)
        meta = lambda title: {"LicenseShortName": {"value": "CC0"}, "Artist": {"value": "Anon"}}
        rec = fx.run(self.args(root), getter=get, meta_getter=meta)
        self.assertTrue(rec["committable"] and rec["licence_verified"])
        self.assertTrue((root / "art/reference" / rec["file"]).is_file())
        self.assertTrue((root / "art/reference/.gdignore").is_file())
        nc = lambda title: {"LicenseShortName": {"value": "CC BY-NC-SA 4.0"}, "Artist": {"value": "Anon"}}
        rec2 = fx.run(self.args(root), getter=get, meta_getter=nc)
        self.assertFalse(rec2["committable"])
        self.assertEqual((root / ".cache/anim-ref/.gitignore").read_text(), "*\n")
        with self.assertRaises(fx.Refused):
            fx.run(self.args(root, url="https://museum.example/i.png"), getter=get, meta_getter=meta)
        with self.assertRaises(fx.Refused):   # a Commons page cannot license another host's bytes
            fx.run(self.args(root, url="https://museum.example/i.png", page="https://commons.wikimedia.org/wiki/File:Plate.png"),
                   getter=get, meta_getter=meta)
        with self.assertRaises(fx.Refused):   # nor another Commons file's
            fx.run(self.args(root, page="https://commons.wikimedia.org/wiki/File:Other.png"), getter=get, meta_getter=meta)
        rec3 = fx.run(self.args(root, url="https://museum.example/i.png", licence_id="CC0-1.0", author="M"), getter=get, meta_getter=meta)
        self.assertFalse(rec3["licence_verified"])
        man = (root / "art/reference/manifest.json").read_text()
        self.assertNotRegex(man, r"20[0-9]{2}-[0-9]{2}-[0-9]{2}")
        with self.assertRaises(fx.Refused):
            fx.run(self.args(root), getter=lambda u: (b"<html>", u), meta_getter=meta)
        with self.assertRaises(fx.Refused):
            fx.get("http://example.com/x.png")
        shutil.rmtree(root)


class Coverage(unittest.TestCase):
    """The coverage rule: reference-defects.json, held by check-constraints.py --coverage only."""

    def setUp(self):
        self.root = pathlib.Path(tempfile.mkdtemp())
        self.src = self.root / "docs/anim/sources"
        self.src.mkdir(parents=True)
        self.good = "a" * 64
        self.bad = "b" * 64
        for sha, mode in ((self.good, "exact"), (self.bad, "not_found")):
            (self.src / f"{sha}.md").write_text(f"```json\n{json.dumps({'sha256': sha, 'match_mode': mode})}\n```\n")
        self.dirs = [str(self.src)]

    def tearDown(self):
        shutil.rmtree(self.root)

    def doc(self, cov, weapon="sword", sev="hard", src=None):
        c = C("frame_pose", {"stat": "all", "max": 1}, target="a", ref="a", severity=sev, source=src or self.good)
        return {"schema_version": "move-constraints/v1", "move": "m", "fps": 30, "rig_map": "r", "clip": "c",
                "weapon": weapon, "constraints": [c], "coverage": cov}

    def full(self):
        return {"locomotion-carry": {"constraints": ["x"]}, "cut-reads-as-thrust": {"not_applicable": "no cut in this move"},
                "hand-reads-as-other-hand": {"constraints": ["x"]}}

    def test_passes_when_every_defect_is_covered_or_excused(self):
        self.assertEqual(cc.coverage(self.doc(self.full()), self.dirs), [])

    def test_refusals(self):
        cov = self.full()
        self.assertTrue(cc.coverage(self.doc(cov, sev="soft"), self.dirs))                      # soft never covers
        self.assertTrue(cc.coverage(self.doc(cov, src=self.bad), self.dirs))                    # unverified source
        self.assertTrue(cc.coverage(self.doc(cov, src="see I.33"), self.dirs))                  # no sha256
        miss = dict(cov); del miss["locomotion-carry"]
        self.assertTrue(cc.coverage(self.doc(miss), self.dirs))                                  # a defect left out
        armed = dict(cov, **{"hand-reads-as-other-hand": {"not_applicable": "no hand"}})
        self.assertTrue(any("armed" in f for f in cc.coverage(self.doc(armed), self.dirs)))     # required when armed
        self.assertEqual(cc.coverage(self.doc(armed, weapon="none"), self.dirs), [])            # but not unarmed
        ghost = dict(cov, **{"locomotion-carry": {"constraints": ["nope"]}})
        self.assertTrue(cc.coverage(self.doc(ghost), self.dirs))                                 # unknown id
        doc = self.doc(cov); del doc["coverage"]
        self.assertTrue(cc.coverage(doc, self.dirs))                                             # no map at all

    def test_cli_coverage_only(self):
        p = self.root / "c.json"
        p.write_text(json.dumps(self.doc(self.full())))
        rc, out, _ = run_cli(cc, ["--constraints", str(p), "--coverage", "--root", str(self.root)])
        self.assertEqual(rc, 0, out)
        p.write_text(json.dumps(self.doc(self.full(), sev="soft")))
        rc, out, _ = run_cli(cc, ["--constraints", str(p), "--coverage", "--root", str(self.root)])
        self.assertEqual(rc, 1)
        self.assertIn("soft", out)


if __name__ == "__main__":
    unittest.main(verbosity=1)

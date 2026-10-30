#!/usr/bin/env python3
"""Synthetic pose tracks: one sound set, and the three reference defects in numbers.

    python3 -I gen_tracks.py <out dir>

Nothing here comes from a game: a stick figure, placed by formulas, enough to
give every constraint kind something to measure. The three defects are the
ones that motivated the plugin, reduced to what a checker sees:

  run_flail    the sword hand and the blade beat against the chest while running
  cut_stab     a "diagonal cut" whose tip travels along the blade, arm bent:
               it reads as a dagger stab
  grip_mirror  a right hand whose landmarks are mirrored (it reads as a left
               hand) and whose fingers close on the palm side of the grip

run-tests.sh regenerates them and compares with the committed files, so the
fixtures cannot drift from the formulas that explain them.
"""
import json
import math
import pathlib
import sys

FPS = 30


def r(v):
    return [round(x, 6) for x in v]


def yaw_q(a):
    return [0.0, math.sin(a / 2), 0.0, math.cos(a / 2)]


def ident():
    return [0.0, 0.0, 0.0, 1.0]


def frames(duration):
    n = int(round(duration * FPS)) + 1
    return [i / FPS for i in range(n)]


def body(t, speed=0.0, bob=0.0):
    """Root, hips, chest and shoulder of a figure walking along +Z."""
    z = speed * t
    y = 1.0 + bob * math.sin(2 * math.pi * 2 * t)
    return {
        "root": {"p": r([0, 0, z]), "q": ident()},
        "hips": {"p": r([0, y, z]), "q": ident()},
        "chest": {"p": r([0, y + 0.35, z]), "q": ident()},
        "shoulder.R": {"p": r([0.2, y + 0.45, z]), "q": ident()},
    }


def track(clip, duration, make, markers=None, rest=None):
    out = {"schema_version": "pose-track/v1", "clip": clip, "fps": FPS, "duration": duration,
           "source": {"engine": "synthetic", "adapter": "gen_tracks.py"}, "markers": markers or {},
           "frames": []}
    if rest:
        out["rest"] = rest
    for t in frames(duration):
        f = make(t)
        f["t"] = round(t, 6)
        out["frames"].append(f)
    return out


# ------------------------------------------------------------------ run

def run(flail):
    def make(t):
        b = body(t, speed=3.0, bob=0.03)
        c = b["chest"]["p"]
        beat = 0.15 * math.sin(2 * math.pi * 2 * t) if flail else 0.005 * math.sin(2 * math.pi * 2 * t)
        hand = [c[0] + 0.25, c[1] - 0.15 + beat, c[2] + 0.30 + beat * 0.5]
        tip = [hand[0], hand[1] + 0.9 + beat * 2, hand[2] + 0.25 + beat * 2]
        base = [hand[0], hand[1] + 0.1, hand[2] + 0.03]
        b["hand.R"] = {"p": r(hand), "q": ident()}
        return {"bones": b, "props": {"blade": {"p": r(hand), "q": ident()}},
                "landmarks": {"blade.tip": r(tip), "blade.base": r(base)}}
    return track("run", 1.0, make)


# ------------------------------------------------------------------ cut

def cut(stab):
    """0.6 s; strike from 0.2 to 0.8 of the clip, impact at 0.6."""
    shoulder = [0.2, 1.45, 0.0]
    upper, fore = 0.30, 0.28

    def make(t):
        b = body(t)
        s = min(1.0, max(0.0, (t / 0.6 - 0.2) / 0.6))
        if stab:
            # elbow stays bent, the hand pushes forward and down along the blade
            hand = [0.25, 1.30 - 0.10 * s, 0.25 + 0.12 * s]
            elbow = [0.30, 1.20, 0.10]
            d = [0.0, -0.25, 1.0]
            n = math.sqrt(sum(x * x for x in d))
            d = [x / n for x in d]
            base = [hand[k] + 0.1 * d[k] for k in range(3)]
            tip = [hand[k] + 0.95 * d[k] for k in range(3)]
        else:
            # the arm extends and sweeps from the right shoulder down to the left hip,
            # the blade radial to the sweep: the edge leads
            a = math.radians(-40 + 120 * s)           # angle in the frontal-diagonal plane
            reach = upper + fore
            ext = 0.75 + 0.24 * s                      # extends towards contact
            u = [-math.sin(a) * 0.7071, math.cos(a), 0.55]
            n = math.sqrt(sum(x * x for x in u))
            u = [x / n for x in u]
            hand = [shoulder[k] + u[k] * reach * ext for k in range(3)]
            elbow = [shoulder[k] + u[k] * upper * ext + (0.03 if k == 1 else 0.0) for k in range(3)]
            base = [hand[k] + 0.1 * u[k] for k in range(3)]
            tip = [hand[k] + 0.95 * u[k] for k in range(3)]
        b["shoulder.R"] = {"p": r(shoulder), "q": ident()}
        b["elbow.R"] = {"p": r(elbow), "q": ident()}
        b["hand.R"] = {"p": r(hand), "q": ident()}
        return {"bones": b, "props": {"blade": {"p": r(hand), "q": ident()}},
                "landmarks": {"blade.tip": r(tip), "blade.base": r(base)}}

    rest = {"bones": {"shoulder.R": {"p": r(shoulder), "q": ident()},
                      "elbow.R": {"p": r([shoulder[0] + upper, shoulder[1], 0]), "q": ident()},
                      "hand.R": {"p": r([shoulder[0] + upper + fore, shoulder[1], 0]), "q": ident()}}}
    return track("attack_cut", 0.6, make, markers={"impact": 0.6, "strike_start": 0.2, "strike_end": 0.8}, rest=rest)


# ----------------------------------------------------------------- grip

def grip(mirror):
    """A still right hand round a vertical grip at x = 0.3, z = 0.3, palm facing -X."""
    ax = [0.30, 1.10, 0.30]

    def make(t):
        b = body(t)
        sx = -1.0 if mirror else 1.0      # mirror the hand's layout across its own plane
        palm = [ax[0] + 0.03, ax[1], ax[2]]
        center = [ax[0] + 0.05, ax[1], ax[2]]
        # right hand, palm towards -X (onto the grip), fingers forward along -Z,
        # thumb and index up (+Y, towards the blade): det[(i-p),(m-w),(palm-center)] > 0
        index_b = [ax[0] + 0.05, ax[1] + 0.035 * sx, ax[2] - 0.04]
        pinky_b = [ax[0] + 0.05, ax[1] - 0.035 * sx, ax[2] - 0.04]
        middle_b = [ax[0] + 0.05, ax[1] + 0.012 * sx, ax[2] - 0.045]
        wrist = [ax[0] + 0.06, ax[1], ax[2] + 0.05]
        far = -1.0 if mirror else 1.0      # the middle phalanges wrap to the far side (x < axis)
        mids = {f"{n}.mid.R": r([ax[0] - 0.025 * far, ax[1] + dy, ax[2] - 0.02])
                for n, dy in (("index", 0.03), ("middle", 0.01), ("ring", -0.01), ("pinky", -0.03))}
        b["hand.R"] = {"p": r(center), "q": ident()}
        lm = {"palm.R": r(palm), "hand.center.R": r(center), "wrist.R": r(wrist),
              "index.base.R": r(index_b), "pinky.base.R": r(pinky_b), "middle.base.R": r(middle_b),
              "grip.pommel": r([ax[0], ax[1] - 0.15, ax[2]]), "grip.guard": r([ax[0], ax[1] + 0.10, ax[2]])}
        lm.update(mids)
        return {"bones": b, "props": {"blade": {"p": r(ax), "q": ident()}}, "landmarks": lm}
    return track("grip_hold", 0.2, make)


SETS = {
    "run_ok": lambda: run(False), "run_flail": lambda: run(True),
    "cut_ok": lambda: cut(False), "cut_stab": lambda: cut(True),
    "grip_ok": lambda: grip(False), "grip_mirror": lambda: grip(True),
}


def main(out):
    out = pathlib.Path(out)
    out.mkdir(parents=True, exist_ok=True)
    for name, make in SETS.items():
        (out / f"{name}.pose.json").write_text(json.dumps(make(), indent=1, sort_keys=True) + "\n")
    print(f"wrote {len(SETS)} tracks to {out}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else pathlib.Path(__file__).parent)

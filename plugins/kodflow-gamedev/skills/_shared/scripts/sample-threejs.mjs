#!/usr/bin/env node
// sample-threejs.mjs — sample a three.js project's clips into pose-track/v1.
//
//   node sample-threejs.mjs --adapter <project>/anim-adapter.mjs \
//        --rig-map docs/anim/rig-map.json --clip <name> [--fps 60] --out <file>
//   node sample-threejs.mjs --adapter … --rig-map … --list
//   node sample-threejs.mjs --glb <file.glb> --rig-map … --clip <name> --out <file>
//
// Two sources, one output. An ADAPTER is project code (never part of this
// plugin) that exports:
//
//   clips()                 → ["run", "attack_cut", …]
//   meta(clip)  (optional)  → { duration, markers: { impact: 0.42 } }
//   rest()      (optional)  → the bind or neutral pose, same shape as below
//   sampleWorld(clip, t)    → { nodes:  { <engine name>: { p:[x,y,z], q:[x,y,z,w] } },
//                               points: { <engine name>: [x,y,z] } }   (points optional)
//
// sampleWorld is called with t in seconds, by frame index — never by wall
// clock — so two runs give the same bytes. A GLB with baked clips is the other
// source: it needs `three` installed in the project, resolved from the current
// directory, and samples with AnimationMixer.setTime.
//
// The rig map turns engine names into the logical names constraints use:
// bones and props map a logical name to a node; a landmark is a node plus a
// local offset ({node, offset}) or an adapter point ({point}). A name the map
// declares and the source does not give is left out of the frame, and the
// checker reports every constraint that needed it as unevaluated.
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { resolve, dirname, basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

function args(argv) {
  const a = { fps: 60 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--list") a.list = true;
    else if (k.startsWith("--")) a[k.slice(2)] = argv[++i];
  }
  a.fps = Number(a.fps);
  return a;
}

function die(msg) {
  process.stderr.write(`sample-threejs: ${msg}\n`);
  process.exit(2);
}

// q * v * q⁻¹ for a unit quaternion [x, y, z, w]
function rotate(q, v) {
  const [x, y, z, w] = q;
  const [vx, vy, vz] = v;
  const ix = w * vx + y * vz - z * vy;
  const iy = w * vy + z * vx - x * vz;
  const iz = w * vz + x * vy - y * vx;
  const iw = -x * vx - y * vy - z * vz;
  return [
    ix * w + iw * -x + iy * -z - iz * -y,
    iy * w + iw * -y + iz * -x - ix * -z,
    iz * w + iw * -z + ix * -y - iy * -x,
  ];
}

const r6 = (n) => Math.round(n * 1e6) / 1e6;
const vec = (a) => a.map((n) => r6(Number(n)));

export function mapPose(raw, rig) {
  const nodes = raw.nodes || {};
  const points = raw.points || {};
  const out = { bones: {}, props: {}, landmarks: {} };
  for (const kind of ["bones", "props"]) {
    for (const [logical, engine] of Object.entries(rig[kind] || {})) {
      const n = nodes[engine];
      if (n) out[kind][logical] = { p: vec(n.p), q: vec(n.q) };
    }
  }
  for (const [logical, spec] of Object.entries(rig.landmarks || {})) {
    if (spec.point !== undefined) {
      if (points[spec.point]) out.landmarks[logical] = vec(points[spec.point]);
      continue;
    }
    const n = nodes[spec.node];
    if (!n) continue;
    const off = rotate(n.q, spec.offset || [0, 0, 0]);
    out.landmarks[logical] = vec([
      n.p[0] + off[0],
      n.p[1] + off[1],
      n.p[2] + off[2],
    ]);
  }
  return out;
}

async function fromAdapter(path) {
  const mod = await import(pathToFileURL(resolve(path)).href);
  for (const f of ["clips", "sampleWorld"]) {
    if (typeof mod[f] !== "function") die(`${path} does not export ${f}()`);
  }
  return {
    clips: async () => await mod.clips(),
    meta: async (c) =>
      typeof mod.meta === "function" ? await mod.meta(c) : {},
    rest: async () =>
      typeof mod.rest === "function" ? await mod.rest() : null,
    sample: async (c, t) => await mod.sampleWorld(c, t),
    origin: { engine: "three.js", adapter: basename(path) },
  };
}

async function fromGlb(path) {
  const require = createRequire(join(process.cwd(), "noop.js"));
  let THREE, GLTFLoader;
  try {
    THREE = await import(pathToFileURL(require.resolve("three")).href);
    ({ GLTFLoader } = await import(
      pathToFileURL(require.resolve("three/examples/jsm/loaders/GLTFLoader.js"))
        .href
    ));
  } catch {
    die(
      "--glb needs `three` installed in the project (run from its directory)",
    );
  }
  const buf = readFileSync(path);
  const gltf = await new Promise((ok, ko) =>
    new GLTFLoader().parse(
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
      "",
      ok,
      ko,
    ),
  );
  const scene = gltf.scene;
  const mixer = new THREE.AnimationMixer(scene);
  const byName = Object.fromEntries(gltf.animations.map((a) => [a.name, a]));
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const grab = () => {
    scene.updateMatrixWorld(true);
    const nodes = {};
    scene.traverse((o) => {
      if (!o.name) return;
      o.getWorldPosition(p);
      o.getWorldQuaternion(q);
      nodes[o.name] = { p: [p.x, p.y, p.z], q: [q.x, q.y, q.z, q.w] };
    });
    return { nodes };
  };
  const rest = grab();
  let action = null;
  return {
    clips: async () => Object.keys(byName),
    meta: async (c) => ({ duration: byName[c]?.duration }),
    rest: async () => rest,
    sample: async (c, t) => {
      if (!byName[c]) die(`no clip ${c} in ${path}`);
      if (!action || action.getClip() !== byName[c]) {
        mixer.stopAllAction();
        action = mixer.clipAction(byName[c]);
        action.play();
      }
      mixer.setTime(t);
      return grab();
    },
    origin: { engine: "three.js", adapter: `glb:${basename(path)}` },
  };
}

async function main() {
  const a = args(process.argv.slice(2));
  if (!a.adapter && !a.glb) die("--adapter or --glb is required");
  const src = a.adapter ? await fromAdapter(a.adapter) : await fromGlb(a.glb);
  if (a.list) {
    process.stdout.write((await src.clips()).join("\n") + "\n");
    return;
  }
  if (!a["rig-map"] || !a.clip || !a.out)
    die("--rig-map, --clip and --out are required");
  if (!(a.fps > 0)) die("--fps must be positive");
  const rig = JSON.parse(readFileSync(a["rig-map"], "utf8"));
  const clips = await src.clips();
  if (!clips.includes(a.clip))
    die(`no clip ${a.clip}; have: ${clips.join(", ")}`);
  const meta = (await src.meta(a.clip)) || {};
  const duration = Number(meta.duration);
  if (!(duration > 0))
    die(`clip ${a.clip} has no positive duration (meta(clip).duration)`);
  const n = Math.max(2, Math.round(duration * a.fps) + 1);
  const frames = [];
  for (let i = 0; i < n; i++) {
    const t = Math.min(duration, i / a.fps);
    frames.push({ t: r6(t), ...mapPose(await src.sample(a.clip, t), rig) });
  }
  const restRaw = await src.rest();
  const doc = {
    schema_version: "pose-track/v1",
    clip: a.clip,
    fps: a.fps,
    duration: r6(duration),
    source: { ...src.origin, revision: a.revision || "" },
    markers: meta.markers || {},
    ...(restRaw ? { rest: mapPose(restRaw, rig) } : {}),
    frames,
  };
  const tmp = join(
    dirname(resolve(a.out)),
    `.tmp-${process.pid}-${basename(a.out)}`,
  );
  writeFileSync(tmp, JSON.stringify(doc) + "\n");
  renameSync(tmp, a.out);
  process.stdout.write(`${a.clip}: ${frames.length} frames → ${a.out}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((e) => die(e?.stack || String(e)));
}

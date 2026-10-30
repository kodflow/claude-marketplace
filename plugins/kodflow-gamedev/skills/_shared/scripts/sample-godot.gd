# sample-godot.gd — sample a Godot 4 scene's clips into pose-track/v1.
#
#   godot --headless --path <project> --script <this file> -- \
#       --scene res://characters/fighter.tscn --rig-map docs/anim/rig-map.json \
#       --clip attack_cut [--fps 60] [--player AnimationPlayer] [--skeleton Skeleton3D] \
#       --out /tmp/attack_cut.pose.json
#
# The scene holds a Skeleton3D and an AnimationPlayer (an imported GLB with
# baked clips is the usual case). Each frame is reached with seek(t, true) by
# frame index, never by the wall clock, so two runs give the same bytes. World
# transforms are skeleton.global_transform * get_bone_global_pose(i) for a
# bone, global_transform for any other node (a prop under a BoneAttachment3D,
# a Marker3D used as a landmark).
#
# The rig map names logical bones and props after engine names: a bone of the
# Skeleton3D first, else a node path under the scene root. A landmark is a
# node or bone plus a local offset ({node, offset}). Names the scene lacks
# are left out; the checker then reports what needed them as unevaluated.
#
# Godot is right-handed, +Y up, like the pose-track format; quaternions are
# written [x, y, z, w]. Some APIs here (seek's update argument, Basis
# get_rotation_quaternion) should be confirmed against the docs of the
# project's Godot version before the first run.
extends SceneTree

var _args := {}


func _parse_args() -> void:
	var a := OS.get_cmdline_user_args()
	var i := 0
	while i < a.size():
		var k: String = a[i]
		if k.begins_with("--") and i + 1 < a.size():
			_args[k.substr(2)] = a[i + 1]
			i += 2
		else:
			i += 1


func _fail(msg: String) -> void:
	printerr("sample-godot: " + msg)
	quit(2)


func _find(root: Node, cls: String, wanted: String) -> Node:
	if wanted != "":
		return root.get_node_or_null(wanted)
	var stack: Array[Node] = [root]
	while not stack.is_empty():
		var n: Node = stack.pop_back()
		if n.is_class(cls):
			return n
		for c in n.get_children():
			stack.append(c)
	return null


func _r6(x: float) -> float:
	return round(x * 1e6) / 1e6


func _vec(v: Vector3) -> Array:
	return [_r6(v.x), _r6(v.y), _r6(v.z)]


func _quat(b: Basis) -> Array:
	var q := b.get_rotation_quaternion()
	return [_r6(q.x), _r6(q.y), _r6(q.z), _r6(q.w)]


func _world(root: Node, skel: Skeleton3D, engine_name: String):
	var bi := skel.find_bone(engine_name) if skel != null else -1
	if bi >= 0:
		return skel.global_transform * skel.get_bone_global_pose(bi)
	var n := root.get_node_or_null(NodePath(engine_name))
	if n == null:
		n = root.find_child(engine_name, true, false)
	if n is Node3D:
		return (n as Node3D).global_transform
	return null


func _pose(root: Node, skel: Skeleton3D, rig: Dictionary) -> Dictionary:
	var out := {"bones": {}, "props": {}, "landmarks": {}}
	for kind in ["bones", "props"]:
		var m: Dictionary = rig.get(kind, {})
		for logical in m.keys():
			var t = _world(root, skel, str(m[logical]))
			if t != null:
				out[kind][logical] = {"p": _vec(t.origin), "q": _quat(t.basis)}
	var lm: Dictionary = rig.get("landmarks", {})
	for logical in lm.keys():
		var spec: Dictionary = lm[logical]
		if not spec.has("node"):
			continue
		var t = _world(root, skel, str(spec["node"]))
		if t == null:
			continue
		var o: Array = spec.get("offset", [0, 0, 0])
		out["landmarks"][logical] = _vec(t * Vector3(o[0], o[1], o[2]))
	return out


func _initialize() -> void:
	_parse_args()
	for k in ["scene", "rig-map", "clip", "out"]:
		if not _args.has(k):
			_fail("--%s is required" % k)
			return
	var fps := float(_args.get("fps", "60"))
	var rig = JSON.parse_string(FileAccess.get_file_as_string(_args["rig-map"]))
	if typeof(rig) != TYPE_DICTIONARY:
		_fail("cannot read the rig map " + _args["rig-map"])
		return
	var packed := load(_args["scene"]) as PackedScene
	if packed == null:
		_fail("cannot load " + _args["scene"])
		return
	var root := packed.instantiate()
	get_root().add_child(root)
	var skel := _find(root, "Skeleton3D", _args.get("skeleton", "")) as Skeleton3D
	var player := _find(root, "AnimationPlayer", _args.get("player", "")) as AnimationPlayer
	if player == null:
		_fail("no AnimationPlayer in the scene")
		return
	var clip: String = _args["clip"]
	if not player.has_animation(clip):
		_fail("no clip %s; have: %s" % [clip, ", ".join(player.get_animation_list())])
		return
	var rest := _pose(root, skel, rig)
	var duration := player.get_animation(clip).length
	player.play(clip)
	var frames := []
	var n := maxi(2, int(round(duration * fps)) + 1)
	for i in n:
		var t := minf(duration, i / fps)
		player.seek(t, true)
		var f := _pose(root, skel, rig)
		f["t"] = _r6(t)
		frames.append(f)
	var doc := {
		"schema_version": "pose-track/v1",
		"clip": clip,
		"fps": fps,
		"duration": _r6(duration),
		"source": {"engine": "godot " + Engine.get_version_info().get("string", ""), "adapter": _args["scene"]},
		"markers": {},
		"rest": rest,
		"frames": frames,
	}
	var tmp: String = _args["out"] + ".tmp"
	var fa := FileAccess.open(tmp, FileAccess.WRITE)
	if fa == null:
		_fail("cannot write " + tmp)
		return
	fa.store_string(JSON.stringify(doc) + "\n")
	fa.close()
	DirAccess.rename_absolute(tmp, _args["out"])
	print("%s: %d frames -> %s" % [clip, frames.size(), _args["out"]])
	quit(0)

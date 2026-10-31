# Project boundary — what an agent of this plugin may read

The one text of this rule; the agents that read code point here.

Read only the repository of the calling project (the project root the brief
names) and the plugin root. Never read another repository, a sibling
checkout, another revision of the project, an evaluation fixture or a
session transcript, even when one is reachable on disk, by Read, Glob,
Grep or a shell command.

Why: a constraint calibrated on code the brief did not give you measures
that code, not the move. The first evaluation of this plugin was voided
for exactly that: thresholds copied from the corrected revision passed it.

When the project lacks what you need — a node name, a landmark, a clip —
say so under `unverified` (or `rig_map_gaps`) instead of finding it
elsewhere.

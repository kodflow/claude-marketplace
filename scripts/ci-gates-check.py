#!/usr/bin/env python3
"""The mod lanes' wiring, read from the workflows as YAML (kodflow/ktn-linter#788).

  ci-gates-check.py [--root DIR] --gates "a b" --advisory "x.yml y.yml"

Fails when:
  - a gate (GATES of the Makefile) is not run as `make <gate>` by a job of
    ci.yml — a gate nothing runs gates nothing;
  - a workflow runs `make <target>` and the Makefile has no such target;
  - an advisory workflow (ADVISORY) runs on a push or a pull request, or one
    of its jobs is named in any other workflow's `needs`: an advisory lane
    reddens nothing a person waits on;
  - an `actions/setup-node` step is not pinned by a 40-character commit sha.
"""
import pathlib
import re
import sys

import yaml

SHA = re.compile(r"^[0-9a-f]{40}$")
# Flags of make that take the next word as their value
VALUED = {"-C", "-f", "-I", "-o", "-W", "--directory", "--file", "--makefile", "--include-dir", "--old-file", "--what-if"}


def goals(text):
    """Every goal of every `make` command in a run script: its flags, their
    values and VAR=value assignments skipped, up to the command's end."""
    out = []
    for line in text.splitlines():
        words = re.split(r"\s+", re.sub(r"[;&|()]", " ; ", line).strip())
        i = 0
        while i < len(words):
            if words[i] != "make":
                i += 1
                continue
            i += 1
            while i < len(words) and words[i] != ";":
                w = words[i]
                if w in VALUED:
                    i += 2
                    continue
                if not w.startswith("-") and "=" not in w and re.fullmatch(r"[A-Za-z0-9_.-]+", w):
                    out.append(w)
                i += 1
    return out


def arg(name, default=""):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


def triggers(doc):
    # PyYAML reads the bare key `on` as True
    on = doc.get("on", doc.get(True, {}))
    if isinstance(on, str):
        return {on}
    if isinstance(on, list):
        return set(on)
    return set((on or {}).keys())


def runs(job, blocking=False):
    for step in job.get("steps", []) or []:
        if blocking and isinstance(step, dict) and step.get("continue-on-error"):
            continue
        if isinstance(step, dict) and isinstance(step.get("run"), str):
            yield step["run"]


def uses(job):
    for step in job.get("steps", []) or []:
        if isinstance(step, dict) and isinstance(step.get("uses"), str):
            yield step["uses"]


def make_targets(makefile):
    text = makefile.read_text() if makefile.exists() else ""
    return set(re.findall(r"^([A-Za-z0-9_.-]+):", text, re.M))


def main():
    root = pathlib.Path(arg("--root", "."))
    gates = arg("--gates").split()
    advisory = set(arg("--advisory").split())
    targets = make_targets(root / "Makefile")
    flows = {p.name: yaml.safe_load(p.read_text()) or {} for p in sorted((root / ".github/workflows").glob("*.yml"))}
    bad = []

    ci_made = set()
    for job in (flows.get("ci.yml", {}).get("jobs") or {}).values():
        if job.get("continue-on-error"):
            continue
        for text in runs(job, blocking=True):
            ci_made.update(goals(text))
    for gate in gates:
        if gate not in targets:
            bad.append("gate %s is no target of the Makefile" % gate)
        if gate not in ci_made:
            bad.append("gate %s is not run as `make %s` by a blocking job of ci.yml" % (gate, gate))

    for name, doc in flows.items():
        for job_name, job in (doc.get("jobs") or {}).items():
            for text in runs(job):
                for goal in goals(text):
                    if goal not in targets:
                        bad.append("%s/%s runs `make %s`, which the Makefile does not declare" % (name, job_name, goal))
            for ref in uses(job):
                action, _, version = ref.partition("@")
                if action == "actions/setup-node" and not SHA.match(version):
                    bad.append("%s/%s uses actions/setup-node@%s: pin it by a 40-character sha" % (name, job_name, version))

    for name in sorted(advisory):
        doc = flows.get(name)
        if doc is None:
            bad.append("advisory workflow %s does not exist" % name)
            continue
        loud = triggers(doc) & {"push", "pull_request", "pull_request_target", "merge_group"}
        if loud:
            bad.append("advisory workflow %s runs on %s" % (name, ", ".join(sorted(loud))))
        jobs = set((doc.get("jobs") or {}).keys())
        for other, odoc in flows.items():
            if other == name:
                continue
            for job_name, job in (odoc.get("jobs") or {}).items():
                needs = job.get("needs") or []
                needs = [needs] if isinstance(needs, str) else needs
                hit = jobs & set(needs)
                if hit:
                    bad.append("%s/%s needs %s of the advisory %s" % (other, job_name, ", ".join(sorted(hit)), name))

    for item in bad:
        print("::error::%s" % item)
    if not bad:
        print("ci gates: %d gate(s) run by ci.yml, %d advisory workflow(s) out of every needs" % (len(gates), len(advisory)))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())

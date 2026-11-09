#!/usr/bin/env python3
"""usage_report.py prices the 5.5 rows exactly and counts dispatches honestly.

A synthetic projects tree stands in for ~/.claude/projects: one main thread, a
handful of subagent transcripts with their `.meta.json`, and a workflow run.
Every dollar figure below is worked out by hand from the published rates, so a
wrong price row, a wrong tier boundary or a double-counted message fails here
and not in a week of real spending.
"""
import json, pathlib, subprocess, sys, tempfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
REPORT = ROOT / "plugins/kodflow-devops/skills/usage/scripts/usage_report.py"
fails = 0


def check(name, ok, detail=""):
    global fails
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f" — {detail}"))
    fails += 0 if ok else 1


def near(a, b):
    return abs(a - b) < 2e-6


def record(msg_id, ts, model=None, usage=None, effort=None, tools=()):
    content = [{"type": "tool_use", "id": t[0], "name": "Agent", "input": t[1]} for t in tools]
    message = {"id": msg_id, "content": content}
    if model:
        message["model"] = model
    if usage is not None:
        message["usage"] = usage
    rec = {"type": "assistant", "timestamp": ts, "message": message}
    if effort:
        rec["effort"] = effort
    return rec


def usage(inp=0, cr=0, w5=0, w1=0, out=0):
    return {"input_tokens": inp, "cache_read_input_tokens": cr, "output_tokens": out,
            "cache_creation_input_tokens": w5 + w1,
            "cache_creation": {"ephemeral_5m_input_tokens": w5, "ephemeral_1h_input_tokens": w1}}


def write(path, records):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(r) + "\n" for r in records))


def meta(path, **fields):
    path.with_suffix(".meta.json").write_text(json.dumps(fields))


M = 1_000_000
tmp = pathlib.Path(tempfile.mkdtemp())
sess = tmp / "proj" / "s1"
sub = sess / "subagents"
T = "2026-11-03T10:{:02d}:00Z"

# One transcript per priced row, each under its own agent type.
rows = {
    "p-opus": ("claude-opus-5-5", usage(M, M, M, M, M)),
    "p-sonnet": ("claude-sonnet-5-5", usage(M, M, M, M, M)),
    "p-haiku-100000": ("claude-haiku-5-5", usage(25_000, 25_000, 25_000, 25_000, 100_000)),
    "p-haiku-100001": ("claude-haiku-5-5", usage(25_001, 25_000, 25_000, 25_000, 100_000)),
    "p-dated": ("claude-haiku-5-5-20260101", usage(25_000, 25_000, 25_000, 25_000, 100_000)),
    "p-1m": ("claude-opus-5-5[1m]", usage(M, 0, 0, 0, 0)),
}
for n, (name, (model, use)) in enumerate(rows.items()):
    f = sub / f"agent-{name}.jsonl"
    write(f, [record(f"m-{name}", T.format(n), model, use, effort="high")])
    meta(f, agentType=name, description=f"priced {name}")
# The same message appended twice is billed once.
dup = sub / "agent-p-dup.jsonl"
write(dup, [record("m-dup", T.format(20), "claude-sonnet-5-5", usage(M), "low")] * 2)
meta(dup, agentType="p-dup")

# Main thread: Agent calls, one repeated id, one fork.
main = tmp / "proj" / "s1.jsonl"
write(main, [
    record("mm-1", T.format(30), "claude-sonnet-5-5", usage(1000), tools=[
        ("tu-a", {"subagent_type": "Plan", "model": "opus", "effort": "high"}),
        ("tu-b", {"subagent_type": "Explore", "model": "haiku"}),
        ("tu-c", {"subagent_type": "general-purpose"}),
        ("tu-f", {"subagent_type": "fork"}),
    ]),
    record("mm-2", T.format(31), "claude-sonnet-5-5", usage(1000), tools=[
        ("tu-a", {"subagent_type": "Plan", "model": "opus", "effort": "high"}),
    ]),
])
b = sub / "agent-disp-b.jsonl"
write(b, [record("m-disp-b", T.format(32), "claude-haiku-5-5", usage(10), "medium")])
meta(b, agentType="Explore", toolUseId="tu-b", effort="medium")

# A 3-wide parallel group (overlapping) and one sequential repeat.
for i in range(3):
    f = sub / f"agent-par{i}.jsonl"
    write(f, [record(f"par{i}a", T.format(40 + i), "claude-sonnet-5-5", usage(10), "low"),
              record(f"par{i}b", T.format(50 + i), "claude-sonnet-5-5", usage(10), "low")])
    meta(f, agentType="par-type", description="same prompt")
for i, (a, z) in enumerate([(0, 5), (30, 35)]):
    f = sub / f"agent-seq{i}.jsonl"
    write(f, [record(f"seq{i}a", f"2026-11-03T11:{a:02d}:00Z", "claude-sonnet-5-5", usage(10), "low"),
              record(f"seq{i}b", f"2026-11-03T11:{z:02d}:00Z", "claude-sonnet-5-5", usage(10), "low")])
    meta(f, agentType="seq-type", description="again")
f = sub / "agent-seq-other.jsonl"
write(f, [record("seqo", "2026-11-03T11:50:00Z", "claude-sonnet-5-5", usage(10), "low")])
meta(f, agentType="seq-type", description="a different one")

# A workflow run with a named agentType, and one detected by its meta alone.
wf = sub / "workflows" / "wf_abc"
for name, agent, phase, model in (("w1", "kodflow-specialists:developer-specialist-go", "Build", "claude-sonnet-5-5"),
                                  ("w2", "workflow-subagent", "Review", "claude-opus-5-5")):
    f = wf / f"agent-{name}.jsonl"
    write(f, [record(f"m-{name}", T.format(45), model, usage(M), "max")])
    meta(f, agentType=agent, workflowPhase=phase, description=f"wf {name}")
lone = sub / "agent-lone.jsonl"
write(lone, [record("m-lone", T.format(46), "claude-sonnet-5-5", usage(M), "max")])
meta(lone, agentType="workflow-subagent", workflowPhase="Solo")

r = subprocess.run([sys.executable, str(REPORT), "--projects", str(tmp), "--json"],
                   capture_output=True, text=True)
check("the report runs", r.returncode == 0, r.stderr.strip())
out = json.loads(r.stdout)
week = out["weeks"]["2026-W45"]
by_agent = {(x["agent"], x["model"], x["effort"]): x for x in week["by_agent_model"]}


def cost(agent, model):
    return by_agent[(agent, model, "high")]["cost"]["total"]


check("Opus 5.5 row: 4 + 0.20 + 5 + 8 + 20", near(cost("p-opus", "claude-opus-5-5"), 37.2))
check("Sonnet 5.5 row: 2 + 0.10 + 2.50 + 4 + 10", near(cost("p-sonnet", "claude-sonnet-5-5"), 18.6))
check("Haiku at exactly 100 000 prompt tokens stays on the base row",
      near(cost("p-haiku-100000", "claude-haiku-5-5"), 0.060875), str(cost("p-haiku-100000", "claude-haiku-5-5")))
check("Haiku at 100 001 prompt tokens takes the whole request at the long rate",
      near(cost("p-haiku-100001", "claude-haiku-5-5"), 0.3043755))
check("a dated snapshot id prices as its base model",
      near(cost("p-dated", "claude-haiku-5-5"), 0.060875))
check("a [1m] suffix prices as its base model (Opus 5.5 input 4)",
      near(cost("p-1m", "claude-opus-5-5"), 4.0))
check("no 5.5 id falls into unknown_models", out["unknown_models"] == {}, str(out["unknown_models"]))
dup = by_agent[("p-dup", "claude-sonnet-5-5", "low")]
check("a message id appended twice is billed once", dup["requests"] == 1 and near(dup["cost"]["total"], 2.0))
check("the duplicate is counted in stats", out["stats"]["duplicates"] >= 1)

sp = {(x["model"], x["effort"]): x for x in week["subagent_pairs"]}
check("subagent_pairs holds subagent events only (no main-thread sonnet/n-a pair)",
      ("claude-sonnet-5-5", "n/a") not in sp and ("claude-opus-5-5", "high") in sp)

d = out["dispatches"]
check("Agent tool_use ids are deduplicated; forks are apart", d["total"] == 3 and d["forks"] == 1, str(d))
w = d["by_week"]["2026-W45"]
check("model: 2 by call, 0 by definition, 1 unresolved", w["model"] == {"call": 2, "definition": 0, "unresolved": 1}, str(w))
check("effort: 1 by call, 1 by definition (meta), 1 unresolved", w["effort"] == {"call": 1, "definition": 1, "unresolved": 1}, str(w))

rep = out["sequential_repeat_candidates"]
check("a 3-wide parallel group is not a repetition; one sequential repeat is",
      rep["candidates"] == 1 and rep["by_agent"] == {"seq-type": 1}, str(rep))

runs = {x["run_id"]: x for x in out["workflows"]}
check("workflow run id comes from the path", "wf_abc" in runs, str(list(runs)))
run = runs["wf_abc"]
check("a named agentType inside a workflow still belongs to its run", run["agents"] == 2)
check("run cost sums its agents (2.00 sonnet + 4.00 opus)", near(run["cost"]["total"], 6.0), str(run["cost"]))
check("(model, effort) mix is split by phase",
      {p: [(m["model"], m["effort"]) for m in mix] for p, mix in run["phases"].items()}
      == {"Build": [("claude-sonnet-5-5", "max")], "Review": [("claude-opus-5-5", "max")]})
check("a workflowPhase without a path segment is still a workflow run", "(no run id)" in runs)

text = subprocess.run([sys.executable, str(REPORT), "--projects", str(tmp)], capture_output=True, text=True)
check("the text report runs", text.returncode == 0 and "dispatches" in text.stdout, text.stderr.strip())
check("no description or prompt text is printed",
      "same prompt" not in text.stdout and "priced p-opus" not in text.stdout)

print("FAILED" if fails else "all ok")
sys.exit(1 if fails else 0)

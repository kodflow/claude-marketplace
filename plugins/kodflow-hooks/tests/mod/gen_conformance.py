#!/usr/bin/env python3
"""Record the conformance corpus of the task tools from mcp/tasks.py.

Every scenario below is one of the tests of test_tasks_mcp.py (plus the
cases the port must hold: validation order, code points, task_list writing
nothing, safe() on the agent id), replayed through tasks.py's own call_tool
with the clock frozen. For each call the corpus keeps the state before, the
call, the answer (text, error or not) and the state after. The TypeScript
port replays the same calls on the same states and must give the same
answers and leave the same files: tests/mod/conformance.ts.

Run from anywhere: python3 gen_conformance.py > conformance.corpus.ts
"""

import importlib.util
import json
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SERVER = os.path.join(HERE, "..", "..", "mcp", "tasks.py")
T0 = 1791900000


class Clock:
    now = T0

    def time(self):
        return self.now


def load():
    spec = importlib.util.spec_from_file_location("tasks", SERVER)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    mod.time = Clock()
    return mod


# --- scenarios ------------------------------------------------------------
# A step is one of:
#   ("call", tool, args)                main agent, session s1
#   ("call", tool, args, agent)         another agent
#   ("call", tool, args, agent, sess)   another session
#   ("file", text)                      tasks.json of s1 replaced by text
#   ("edit", fn)                        tasks.json of s1 replaced by fn(data)
#   ("agents", {id: (type, alive, age)})  the subagents (agents.json)
# The clock moves one second after every call.

def c(tool, agent="main", session="s1", **args):
    return ("call", tool, args, agent, session)


def touched_one(data):
    data["epics"][0]["touched"] = 1
    return data


SCENARIOS = {
    "lifecycle": [
        c("task_create", subject="Add the gauge", epic=0, description="d"),
        c("task_create", subject="Ship it", epic=0),
        c("task_update", id="1", status="in_progress"),
        c("task_update", id="#2", status="deleted"),
        c("task_create", subject="Next", epic=0),
    ],
    "waiting_status": [
        c("task_create", subject="Await the go", epic=0),
        c("task_update", id="1", status="waiting"),
    ],
    "epics_v2_lifecycle": [
        c("task_create", subject="Loose work", epic=0),
        c("task_epic", title="SDK rewrite"),
        c("task_create", subject="Freeze golden renders", epic=1),
        c("task_list"),
    ],
    "several_open_epics_and_focus": [
        c("task_epic", title="SDK status-line"),
        c("task_create", subject="Port the renderer", epic=1),
        c("task_epic", title="api-gateway"),
        c("task_create", subject="Fix the daemon", epic=2),
        c("task_update", id="2", status="completed"),
        c("task_create", subject="Ship", epic=2),
        c("task_list"),
        c("task_focus", epic="#1"),
        c("task_focus", epic="api-gateway"),
        c("task_create", subject="Next", epic=2),
    ],
    "focus_refuses_unknown_and_closed": [
        c("task_epic", title="Done soon"),
        c("task_create", subject="Only task", epic=1),
        c("task_update", id="1", status="completed"),
        c("task_epic", title="Other"),
        c("task_focus", epic="1"),
        c("task_focus", epic="nope"),
        c("task_focus", epic="2", agent="a1"),
        c("task_focus"),
        c("task_focus", epic=0),
    ],
    "create_in_explicit_epic": [
        c("task_epic", title="First"),
        c("task_epic", title="Second"),
        c("task_create", subject="Belongs to first", epic=1),
        c("task_create", subject="Lost", epic=9),
        c("task_create", subject="x", epic=1, agent="a1"),
    ],
    "rework_of_completed_task_reopens_its_epic": [
        c("task_epic", title="Shipped"),
        c("task_create", subject="Build it", epic=1),
        c("task_update", id="1", status="completed"),
        c("task_epic", title="Next thing"),
        c("task_create", subject="Rework #1: tweak", epic=1),
        c("task_list"),
    ],
    "epic_title_cap": [
        c("task_epic", title="x" * 21),
        c("task_epic", title="x" * 20),
        c("task_epic", title="   "),
    ],
    "same_title_focuses_the_open_epic": [
        c("task_epic", title="Alpha"),
        c("task_create", subject="Work", epic=1),
        c("task_epic", title="Beta"),
        c("task_epic", title="Alpha"),
        c("task_update", id="1", status="completed"),
        c("task_epic", title="Beta"),
        c("task_epic", title="Alpha"),
    ],
    "v1_file_is_migrated": [
        ("file", json.dumps({
            "version": 1, "next_id": 3, "next_epic": 2,
            "epics": {"main": {"id": 1, "title": "Old subject"}, "a1": {"id": 5, "title": "Sub"}},
            "tasks": [{"id": "1", "agent": "main", "subject": "Before epics", "status": "pending"},
                      {"id": "2", "agent": "main", "epic": 1, "subject": "In epic", "status": "pending"}]})),
        c("task_list"),
        c("task_create", subject="After", epic=1),
    ],
    "touched_follows_activity": [
        c("task_epic", title="A"),
        c("task_create", subject="Work", epic=1),
        ("edit", touched_one),
        c("task_update", id="1", status="in_progress"),
        ("edit", touched_one),
        c("task_create", subject="More", epic=1),
    ],
    "malformed_file_is_recovered": [
        ("file", '{"epics": 3, "active": [], "tasks": "x"'),
        c("task_create", subject="Fresh", epic=0),
    ],
    "foreign_shapes_are_normalised": [
        ("file", json.dumps({"next_id": "7", "next_epic": 1,
                             "epics": [{"id": 4, "agent": "main", "title": "Kept", "touched": 3},
                                       {"id": "x", "title": "Dropped"}, "junk"],
                             "active": {"main": 4},
                             "tasks": [{"id": 12, "subject": "Numeric id", "epic": "4"},
                                       {"subject": "No id"}, 7,
                                       {"id": "3", "agent": "a1", "status": "waiting", "epic": 4}]})),
        c("task_list"),
        c("task_list", agent="a1"),
        c("task_create", subject="Fresh", epic=4),
    ],
    "epics_are_per_agent": [
        c("task_epic", title="Main subject"),
        c("task_create", subject="Sub work", epic=1, agent="a1"),
        c("task_create", subject="Sub work", epic=0, agent="a1"),
    ],
    "one_task_in_progress_per_worker": [
        c("task_create", subject="First", epic=0),
        c("task_create", subject="Second", epic=0),
        c("task_create", subject="Third", epic=0),
        c("task_update", id="1", status="in_progress"),
        c("task_update", id="2", status="in_progress"),
        ("agents", {"a0": ("Explore", True, 0)}),
        c("task_update", id="2", status="in_progress"),
        c("task_update", id="3", status="in_progress"),
        c("task_update", id="1", status="in_progress"),
    ],
    "a_subagent_has_one_task_in_progress": [
        ("agents", {"a0": ("Explore", True, 0), "a1": ("Explore", True, 0), "a2": ("Explore", True, 0)}),
        c("task_create", subject="Sub one", epic=0, agent="a1"),
        c("task_create", subject="Sub two", epic=0, agent="a1"),
        c("task_update", id="1", status="in_progress", agent="a1"),
        c("task_update", id="2", status="in_progress", agent="a1"),
    ],
    "worker_running_takes_the_task": [
        ("agents", {"r1": ("review-pr3", False, 600), "r2": ("forgejo-cluster", False, 600),
                    "c2": ("sdk-consensus2", True, 600)}),
        c("task_create", subject="Review PR 3", epic=0),
        c("task_create", subject="Forgejo cluster", epic=0),
        c("task_create", subject="Consensus", epic=0),
        c("task_update", id="1", status="in_progress"),
        c("task_update", id="2", status="in_progress"),
        c("task_update", id="3", status="in_progress"),
        c("task_update", id="3", status="in_progress", worker="sdk-consensus2"),
    ],
    "worker_by_agent_id": [
        ("agents", {"c2": ("sdk-consensus2", True, 600)}),
        c("task_create", subject="Consensus", epic=0),
        c("task_update", id="1", status="in_progress", worker="c2"),
    ],
    "worker_stopped_or_unknown_is_refused": [
        ("agents", {"r1": ("review-pr3", False, 600), "c2": ("sdk-consensus2", True, 600)}),
        c("task_create", subject="Review", epic=0),
        c("task_update", id="1", status="in_progress", worker="review-pr3"),
        c("task_update", id="1", status="in_progress", worker="ghost"),
    ],
    "worker_already_busy_is_refused": [
        ("agents", {"c2": ("sdk-consensus2", True, 600)}),
        c("task_create", subject="First", epic=0),
        c("task_create", subject="Second", epic=0),
        c("task_update", id="1", status="in_progress", worker="sdk-consensus2"),
        c("task_update", id="2", status="in_progress", worker="c2"),
        c("task_update", id="1", status="in_progress", worker="sdk-consensus2"),
    ],
    "refusal_lists_workers_and_holders": [
        ("agents", {"r1": ("review-pr3", False, 600), "c2": ("sdk-consensus2", True, 4000)}),
        c("task_create", subject="Mine", epic=0),
        c("task_create", subject="Delegated", epic=0),
        c("task_create", subject="Third", epic=0),
        c("task_update", id="1", status="in_progress"),
        c("task_update", id="2", status="in_progress"),
        c("task_update", id="3", status="in_progress"),
    ],
    "worker_link_is_dropped_when_leaving_in_progress": [
        ("agents", {"c2": ("sdk-consensus2", True, 600)}),
        c("task_create", subject="Work", epic=0),
        c("task_update", id="1", status="in_progress", worker="sdk-consensus2"),
        c("task_update", id="1", status="waiting"),
        c("task_update", id="1", status="in_progress", worker="sdk-consensus2"),
        c("task_update", id="1", status="completed", worker="sdk-consensus2"),
    ],
    "stopped_holder_is_reported": [
        ("agents", {"c2": ("sdk-consensus2", True, 600), "c3": ("other", True, 60)}),
        c("task_create", subject="Held", epic=0),
        c("task_create", subject="Next", epic=0),
        c("task_create", subject="Third", epic=0),
        c("task_update", id="1", status="in_progress", worker="c2"),
        ("agents", {"c2": ("sdk-consensus2", False, 600), "c3": ("other", True, 60)}),
        c("task_update", id="2", status="in_progress"),
        c("task_update", id="3", status="in_progress"),
    ],
    "a_stopped_worker_is_judged_by_its_id": [
        ("agents", {"c2": ("sdk-consensus2", True, 600)}),
        c("task_create", subject="Held", epic=0),
        c("task_create", subject="Other", epic=0),
        c("task_update", id="1", status="in_progress", worker="sdk-consensus2"),
        ("agents", {"c2": ("sdk-consensus2", False, 600), "c9": ("sdk-consensus2", True, 30)}),
        c("task_update", id="2", status="in_progress"),
        c("task_update", id="2", status="in_progress", worker="nobody"),
        c("task_update", id="2", status="in_progress", worker="sdk-consensus2"),
    ],
    "long_subject_is_refused": [
        c("task_create", subject="x" * 41, epic=0),
        c("task_create", subject="x" * 40, epic=0),
        c("task_update", id="1", subject="y" * 41),
        c("task_update", id="1", subject="  trimmed  "),
    ],
    "lengths_are_code_points": [
        c("task_create", subject="\U0001F600" * 40, epic=0),
        c("task_create", subject="\U0001F600" * 41, epic=0),
        c("task_epic", title="été \U0001F4E6" + "x" * 15),
        c("task_epic", title="é" * 11),
    ],
    "agents_keep_separate_lists": [
        c("task_create", subject="Main work", epic=0),
        c("task_create", subject="Sub work", epic=0, agent="a8b9904c"),
        c("task_list", agent="a8b9904c"),
        c("task_update", id="1", status="completed", agent="a8b9904c"),
    ],
    "agent_id_is_made_path_safe": [
        c("task_create", subject="Odd agent", epic=0, agent="a/b c.d"),
        c("task_list", agent="a-b-c-d"),
        c("task_create", subject="Long agent", epic=0, agent="z" * 200),
    ],
    "bad_status_and_unknown_task": [
        c("task_update", id="9", status="done"),
        c("task_update", id="9", status="completed"),
    ],
    "a_missing_id_names_the_field": [
        c("task_create", subject="Ship it", epic=0),
        c("task_update", status="completed", task_id="1"),
        c("task_update", status="completed", id=""),
        c("task_update", status="completed", id="#"),
        c("task_update", status="completed"),
        c("task_update", status="completed", id=0),
        c("task_update", status="completed", id=1),
    ],
    "validation_order": [
        c("task_create", subject="x" * 41),
        c("task_create", epic=0),
        c("task_update", status="bogus", subject="x" * 41),
        c("task_update", id="1", status="bogus", subject="x" * 41),
        c("task_update", id="1", subject="x" * 41),
        c("task_update", id="1", status="completed"),
        c("task_epic"),
        c("task_epic", title=""),
    ],
    "task_list_writes_nothing": [
        c("task_list"),
        c("task_list", agent="a1"),
    ],
    "sessions_are_isolated": [
        c("task_create", subject="In one", epic=0),
        c("task_create", subject="In two", epic=0, session="s2"),
        c("task_list", session="s2"),
    ],
    "epic_is_required": [
        c("task_epic", title="Alpha"),
        c("task_create", subject="Alpha work", epic=1),
        c("task_epic", title="Beta"),
        c("task_create", subject="Where does it go"),
        c("task_create", subject="Blank epic", epic=""),
        c("task_create", subject="Blank epic", epic=None),
    ],
    "epic_zero_is_no_epic": [
        c("task_epic", title="Alpha"),
        c("task_create", subject="Loose", epic=0),
        c("task_create", subject="Loose too", epic="0"),
    ],
    "unknown_epic_is_refused": [
        c("task_epic", title="Alpha"),
        c("task_create", subject="Lost", epic=9),
        c("task_create", subject="Lost", epic="#9"),
        c("task_create", subject="Lost", epic="nope"),
        c("task_create", subject="Lost", epic=-1),
        c("task_create", subject="Found", epic="#1"),
        c("task_create", subject="Found too", epic=" ##1 "),
    ],
    "subagent_uses_its_own_epics": [
        c("task_epic", title="Main epic"),
        c("task_epic", title="Sub epic", agent="a1"),
        c("task_create", subject="Sub task", agent="a1"),
        c("task_create", subject="Sub task", epic=2, agent="a1"),
        c("task_create", subject="Steal", epic=1, agent="a1"),
        c("task_create", subject="Steal", epic=2),
    ],
    "list_shapes": [
        c("task_list"),
        c("task_create", subject="Loose", epic=0),
        c("task_list"),
        c("task_epic", title="Empty"),
        c("task_list"),
        c("task_epic", title="Second"),
        c("task_create", subject="A", epic=2),
        c("task_update", id="2", status="completed"),
        c("task_list"),
    ],
}


def run():
    tasks = load()
    tmp = tempfile.mkdtemp()
    os.environ["CLAUDE_CONFIG_DIR"] = tmp
    out = []
    for name, steps in SCENARIOS.items():
        Clock.now = T0
        root = os.path.join(tmp, name)
        os.environ["CLAUDE_CONFIG_DIR"] = root

        def path(session):
            return os.path.join(root, "kodflow", "sessions", session, "tasks.json")

        def read(session):
            try:
                with open(path(session), encoding="utf-8") as fh:
                    return fh.read()
            except OSError:
                return None

        def state(session):
            text = read(session)
            return None if text is None else json.loads(text)

        agents = {}
        recorded = []
        for step in steps:
            kind = step[0]
            if kind in ("file", "edit"):
                text = step[1] if kind == "file" else json.dumps(step[1](state("s1")))
                os.makedirs(os.path.dirname(path("s1")), exist_ok=True)
                with open(path("s1"), "w", encoding="utf-8") as fh:
                    fh.write(text)
                recorded.append({"file": text})
                continue
            if kind == "agents":
                roster = {k: {"type": t, "started": Clock.now - age, "stopped": None if up else Clock.now}
                          for k, (t, up, age) in step[1].items()}
                d = os.path.join(root, "kodflow", "sessions", "s1")
                os.makedirs(d, exist_ok=True)
                with open(os.path.join(d, "agents.json"), "w", encoding="utf-8") as fh:
                    json.dump({"agents": roster}, fh)
                agents = [{"id": k, "type": t, "alive": up, "started": Clock.now - age}
                          for k, (t, up, age) in step[1].items()]
                recorded.append({"agents": agents})
                continue
            _, tool, args, agent, session = step
            sent = dict(args, _session=session, _agent=agent)
            before = read(session)
            reply = tasks.call_tool({"name": tool, "arguments": sent})
            recorded.append({
                "now": Clock.now, "session": session, "agent": agent, "tool": tool, "args": args,
                "before": before,
                "error": bool(reply.get("isError")),
                "text": reply["content"][0]["text"],
                "after": state(session),
            })
            Clock.now += 1
        out.append({"name": name, "steps": recorded})
    tools = [{"name": t["name"], "description": t["description"],
              "inputSchema": dict(t["inputSchema"], properties={k: v for k, v in t["inputSchema"]["properties"].items()
                                                                if k not in tasks.HIDDEN})}
             for t in tasks.TOOLS]
    return out, tools


def main():
    corpus, tools = run()
    sys.stdout.write(
        "// Recorded from mcp/tasks.py by gen_conformance.py: do not edit by hand.\n"
        "// Each step: the call, the state of tasks.json before, the answer, the state after.\n"
        "// The TypeScript port is held to it by conformance.ts.\n"
        "export const T0 = %d;\n"
        "export const TOOLS = %s;\n"
        "export const CORPUS = %s;\n" % (T0, json.dumps(tools, ensure_ascii=False, indent=1),
                                          json.dumps(corpus, ensure_ascii=False, indent=1)))


if __name__ == "__main__":
    main()

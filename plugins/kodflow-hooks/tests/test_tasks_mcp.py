"""Behavioural tests for mcp/tasks.py, driven over stdio like Claude Code does."""

import json
import os
import subprocess
import sys
import tempfile
import unittest

SERVER = os.path.join(os.path.dirname(__file__), "..", "mcp", "tasks.py")


class Session:
    """One server process fed newline-delimited JSON-RPC."""

    def __init__(self, config):
        env = dict(os.environ, CLAUDE_CONFIG_DIR=config)
        self.proc = subprocess.Popen([sys.executable, SERVER], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                     text=True, env=env)
        self.next = 0

    def request(self, method, params=None):
        self.next += 1
        self.proc.stdin.write(json.dumps({"jsonrpc": "2.0", "id": self.next, "method": method, "params": params or {}}) + "\n")
        self.proc.stdin.flush()
        return json.loads(self.proc.stdout.readline())

    def notify(self, method):
        self.proc.stdin.write(json.dumps({"jsonrpc": "2.0", "method": method}) + "\n")
        self.proc.stdin.flush()

    def call(self, name, **args):
        return self.request("tools/call", {"name": name, "arguments": args})["result"]

    def close(self):
        self.proc.stdin.close()
        self.proc.wait(timeout=5)
        self.proc.stdout.close()


class TasksServer(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.s = Session(self.tmp.name)

    def tearDown(self):
        self.s.close()
        self.tmp.cleanup()

    def state(self, session="s1"):
        with open(os.path.join(self.tmp.name, "kodflow", "sessions", session, "tasks.json"), encoding="utf-8") as fh:
            return json.load(fh)

    def test_handshake_and_tools(self):
        init = self.s.request("initialize", {"protocolVersion": "2025-06-18"})["result"]
        self.assertEqual(init["protocolVersion"], "2025-06-18")
        self.assertIn("tools", init["capabilities"])
        self.s.notify("notifications/initialized")
        names = [t["name"] for t in self.s.request("tools/list")["result"]["tools"]]
        self.assertEqual(names, ["task_create", "task_update", "task_epic", "task_focus", "task_list"])
        self.assertIn("error", self.s.request("nope"))

    def test_lifecycle(self):
        out = self.s.call("task_create", subject="Add the gauge", description="d", _session="s1", _agent="main")
        self.assertEqual(out["content"][0]["text"], "Task #1 created: Add the gauge")
        self.s.call("task_create", subject="Ship it", _session="s1")
        self.s.call("task_update", id="1", status="in_progress", _session="s1")
        tasks = self.state()["tasks"]
        self.assertEqual([(t["id"], t["status"], t["agent"]) for t in tasks],
                         [("1", "in_progress", "main"), ("2", "pending", "main")])
        self.s.call("task_update", id="#2", status="deleted", _session="s1")
        self.assertEqual([t["id"] for t in self.state()["tasks"]], ["1"])
        self.s.call("task_create", subject="Next", _session="s1")
        self.assertEqual(self.state()["tasks"][-1]["id"], "3", "ids are never reused")

    def test_waiting_status(self):
        self.s.call("task_create", subject="Await the go", _session="s1")
        out = self.s.call("task_update", id="1", status="waiting", _session="s1")
        self.assertFalse(out.get("isError"), out)
        self.assertEqual(self.state()["tasks"][0]["status"], "waiting")

    def text(self, out):
        return out["content"][0]["text"]

    def epic(self, eid, session="s1"):
        return next(e for e in self.state(session)["epics"] if e["id"] == eid)

    def test_epics_v2_lifecycle(self):
        self.s.call("task_create", subject="Loose work", _session="s1")
        started = self.s.call("task_epic", title="SDK rewrite", _session="s1")
        self.assertFalse(started.get("isError"), "an open task no longer blocks a new epic")
        self.s.call("task_create", subject="Freeze golden renders", _session="s1")
        data = self.state()
        self.assertEqual(data["version"], 2)
        self.assertEqual(data["active"], {"main": 1})
        self.assertEqual(data["next_epic"], 2)
        epic = data["epics"][0]
        self.assertEqual((epic["id"], epic["agent"], epic["title"]), (1, "main", "SDK rewrite"))
        self.assertLessEqual(epic["created"], epic["touched"])
        self.assertEqual([t["epic"] for t in data["tasks"]], [0, 1])
        listed = self.text(self.s.call("task_list", _session="s1"))
        self.assertTrue(listed.startswith("Epic #1: SDK rewrite (active, 0/1)"), listed)
        self.assertIn("Freeze golden renders", listed)
        self.assertIn("Tasks with no epic:", listed)
        self.assertIn("Loose work", listed, "epic-0 tasks are listed after the epics")

    def test_several_open_epics_and_focus(self):
        self.s.call("task_epic", title="SDK status-line", _session="s1")
        self.s.call("task_create", subject="Port the renderer", _session="s1")
        self.s.call("task_epic", title="api-gateway", _session="s1")
        self.s.call("task_create", subject="Fix the daemon", _session="s1")
        self.s.call("task_update", id="2", status="completed", _session="s1")
        self.s.call("task_create", subject="Ship", _session="s1")
        data = self.state()
        self.assertEqual(data["active"]["main"], 2)
        self.assertEqual([t["epic"] for t in data["tasks"]], [1, 2, 2])
        listed = self.text(self.s.call("task_list", _session="s1"))
        self.assertIn("Epic #2: api-gateway (active, 1/2)", listed)
        self.assertIn("Other open epics:\n#1 SDK status-line 0/1", listed)
        self.assertNotIn("Port the renderer", listed, "another epic is summarised, not detailed")
        out = self.s.call("task_focus", epic="#1", _session="s1")
        self.assertFalse(out.get("isError"), out)
        self.assertEqual(self.state()["active"]["main"], 1)
        out = self.s.call("task_focus", epic="api-gateway", _session="s1")
        self.assertFalse(out.get("isError"), out)
        self.assertEqual(self.state()["active"]["main"], 2)
        self.s.call("task_create", subject="Next", _session="s1")
        self.assertEqual(self.state()["tasks"][-1]["epic"], 2, "new tasks follow the focus")

    def test_focus_refuses_unknown_and_closed(self):
        self.s.call("task_epic", title="Done soon", _session="s1")
        self.s.call("task_create", subject="Only task", _session="s1")
        self.s.call("task_update", id="1", status="completed", _session="s1")
        self.s.call("task_epic", title="Other", _session="s1")
        closed = self.s.call("task_focus", epic="1", _session="s1")
        self.assertTrue(closed.get("isError"))
        self.assertIn("epic 1 is completed", self.text(closed))
        self.assertIn("open epics: #2 Other", self.text(closed))
        unknown = self.s.call("task_focus", epic="nope", _session="s1")
        self.assertTrue(unknown.get("isError"))
        self.assertIn("no open epic nope", self.text(unknown))
        self.assertTrue(self.s.call("task_focus", epic="2", _session="s1", _agent="a1").get("isError"),
                        "an epic of another agent cannot be focused")

    def test_create_in_explicit_epic(self):
        self.s.call("task_epic", title="First", _session="s1")
        self.s.call("task_epic", title="Second", _session="s1")
        out = self.s.call("task_create", subject="Belongs to first", epic=1, _session="s1")
        self.assertFalse(out.get("isError"), out)
        self.assertIn("not the active one", self.text(out))
        self.assertEqual(self.state()["tasks"][0]["epic"], 1)
        self.assertEqual(self.state()["active"]["main"], 2, "an explicit epic does not steal the focus")
        bad = self.s.call("task_create", subject="Lost", epic=9, _session="s1")
        self.assertTrue(bad.get("isError"))
        self.assertIn("open epics:", self.text(bad))
        self.assertTrue(self.s.call("task_create", subject="x", epic=1, _session="s1", _agent="a1").get("isError"),
                        "another agent's epic is refused")

    def test_rework_of_completed_task_reopens_its_epic(self):
        self.s.call("task_epic", title="Shipped", _session="s1")
        self.s.call("task_create", subject="Build it", _session="s1")
        self.s.call("task_update", id="1", status="completed", _session="s1")
        self.s.call("task_epic", title="Next thing", _session="s1")
        self.s.call("task_create", subject="Rework #1: tweak", epic=1, _session="s1")
        listed = self.text(self.s.call("task_list", _session="s1"))
        self.assertIn("#1 Shipped 1/2", listed)

    def test_epic_title_cap(self):
        out = self.s.call("task_epic", title="x" * 21, _session="s1")
        self.assertTrue(out.get("isError"))
        self.assertIn("21 characters, the limit is 20", self.text(out))
        self.assertFalse(self.s.call("task_epic", title="x" * 20, _session="s1").get("isError"))

    def test_same_title_focuses_the_open_epic(self):
        self.s.call("task_epic", title="Alpha", _session="s1")
        self.s.call("task_create", subject="Work", _session="s1")
        self.s.call("task_epic", title="Beta", _session="s1")
        out = self.s.call("task_epic", title="Alpha", _session="s1")
        self.assertIn("already open", self.text(out))
        data = self.state()
        self.assertEqual(len(data["epics"]), 2, "no duplicate epic")
        self.assertEqual(data["active"]["main"], 1)
        # A closed epic with the same title is not reused: Beta (empty, no
        # longer active) and Alpha (all done) both get a fresh id
        self.s.call("task_update", id="1", status="completed", _session="s1")
        self.s.call("task_epic", title="Beta", _session="s1")
        self.s.call("task_epic", title="Alpha", _session="s1")
        self.assertEqual(self.state()["active"]["main"], 4)

    def test_v1_file_is_migrated(self):
        d = os.path.join(self.tmp.name, "kodflow", "sessions", "s1")
        os.makedirs(d)
        with open(os.path.join(d, "tasks.json"), "w", encoding="utf-8") as fh:
            json.dump({"version": 1, "next_id": 3, "next_epic": 2,
                       "epics": {"main": {"id": 1, "title": "Old subject"}, "a1": {"id": 5, "title": "Sub"}},
                       "tasks": [{"id": "1", "agent": "main", "subject": "Before epics", "status": "pending"},
                                 {"id": "2", "agent": "main", "epic": 1, "subject": "In epic", "status": "pending"}]}, fh)
        listed = self.text(self.s.call("task_list", _session="s1"))
        self.assertIn("Epic #1: Old subject (active, 0/1)", listed)
        self.s.call("task_create", subject="After", _session="s1")
        data = self.state()
        self.assertEqual(data["version"], 2)
        self.assertEqual(data["active"], {"main": 1, "a1": 5})
        self.assertEqual(data["next_epic"], 6, "next_epic is past every migrated id")
        self.assertEqual(sorted((e["id"], e["agent"], e["title"]) for e in data["epics"]),
                         [(1, "main", "Old subject"), (5, "a1", "Sub")])
        self.assertTrue(all("created" in e and "touched" in e for e in data["epics"]))
        self.assertEqual([(t["id"], t["epic"]) for t in data["tasks"]], [("1", 0), ("2", 1), ("3", 1)])

    def test_touched_follows_activity(self):
        self.s.call("task_epic", title="A", _session="s1")
        self.s.call("task_create", subject="Work", _session="s1")
        path = os.path.join(self.tmp.name, "kodflow", "sessions", "s1", "tasks.json")
        data = self.state()
        data["epics"][0]["touched"] = 1
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(data, fh)
        self.s.call("task_update", id="1", status="in_progress", _session="s1")
        self.assertGreater(self.epic(1)["touched"], 1, "task_update touches the task's epic")
        data = self.state()
        data["epics"][0]["touched"] = 1
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(data, fh)
        self.s.call("task_create", subject="More", _session="s1")
        self.assertGreater(self.epic(1)["touched"], 1, "task_create touches the epic")

    def test_malformed_file_is_recovered(self):
        d = os.path.join(self.tmp.name, "kodflow", "sessions", "s1")
        os.makedirs(d)
        with open(os.path.join(d, "tasks.json"), "w", encoding="utf-8") as fh:
            fh.write('{"epics": 3, "active": [], "tasks": "x"')
        out = self.s.call("task_create", subject="Fresh", _session="s1")
        self.assertFalse(out.get("isError"), out)
        self.assertEqual(self.state()["tasks"][0]["subject"], "Fresh")

    def test_epics_are_per_agent(self):
        self.s.call("task_epic", title="Main subject", _session="s1", _agent="main")
        self.s.call("task_create", subject="Sub work", _session="s1", _agent="a1")
        self.assertEqual(self.state()["tasks"][0]["epic"], 0, "a subagent keeps its own epic")

    def agents(self, session, running):
        d = os.path.join(self.tmp.name, "kodflow", "sessions", session)
        os.makedirs(d, exist_ok=True)
        now = int(__import__("time").time())
        with open(os.path.join(d, "agents.json"), "w", encoding="utf-8") as fh:
            json.dump({"agents": {"a%d" % i: {"type": "Explore", "started": now, "stopped": None}
                                  for i in range(running)}}, fh)

    def test_one_task_in_progress_per_worker(self):
        for subject in ("First", "Second", "Third"):
            self.s.call("task_create", subject=subject, _session="s1")
        self.assertFalse(self.s.call("task_update", id="1", status="in_progress", _session="s1").get("isError"))
        refused = self.s.call("task_update", id="2", status="in_progress", _session="s1")
        self.assertTrue(refused.get("isError"), "a lone main agent has one worker")
        self.assertIn("#1 First", refused["content"][0]["text"])
        self.agents("s1", 1)
        self.assertFalse(self.s.call("task_update", id="2", status="in_progress", _session="s1").get("isError"),
                         "a running subagent adds one worker")
        self.assertTrue(self.s.call("task_update", id="3", status="in_progress", _session="s1").get("isError"))
        self.assertFalse(self.s.call("task_update", id="1", status="in_progress", _session="s1").get("isError"),
                         "re-asserting a task already in progress is not a new start")

    def test_a_subagent_has_one_task_in_progress(self):
        self.agents("s1", 3)
        for subject in ("Sub one", "Sub two"):
            self.s.call("task_create", subject=subject, _session="s1", _agent="a1")
        self.s.call("task_update", id="1", status="in_progress", _session="s1", _agent="a1")
        self.assertTrue(self.s.call("task_update", id="2", status="in_progress", _session="s1", _agent="a1").get("isError"))

    def test_long_subject_is_refused(self):
        out = self.s.call("task_create", subject="x" * 41, _session="s1")
        self.assertTrue(out.get("isError"))
        self.assertIn("41 characters", out["content"][0]["text"])

    def test_agents_keep_separate_lists(self):
        self.s.call("task_create", subject="Main work", _session="s1", _agent="main")
        self.s.call("task_create", subject="Sub work", _session="s1", _agent="a8b9904c")
        listed = self.s.call("task_list", _session="s1", _agent="a8b9904c")["content"][0]["text"]
        self.assertIn("Sub work", listed)
        self.assertNotIn("Main work", listed)
        refused = self.s.call("task_update", id="1", status="completed", _session="s1", _agent="a8b9904c")
        self.assertTrue(refused.get("isError"), "a subagent cannot close the main agent's task")

    def test_bad_status_and_unknown_task(self):
        self.assertTrue(self.s.call("task_update", id="9", status="done", _session="s1").get("isError"))
        self.assertTrue(self.s.call("task_update", id="9", status="completed", _session="s1").get("isError"))

    def test_sessions_are_isolated(self):
        self.s.call("task_create", subject="In one", _session="s1")
        self.s.call("task_create", subject="In two", _session="s2")
        self.assertEqual(self.state("s1")["tasks"][0]["subject"], "In one")
        self.assertEqual(self.state("s2")["tasks"][0]["subject"], "In two")


if __name__ == "__main__":
    unittest.main()

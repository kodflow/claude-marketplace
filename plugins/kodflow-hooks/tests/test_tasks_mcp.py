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
        self.assertEqual(names, ["task_create", "task_update", "task_list"])
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

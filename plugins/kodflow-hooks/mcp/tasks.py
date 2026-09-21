#!/usr/bin/env python3
"""tasks.py — MCP server holding the session task list, one list per agent.

Why not the built-in task tools: they render their own panel in the chat,
which duplicates the status line. This server keeps the list in a plain JSON
file the status line and the Stop hook read directly, and nothing is drawn in
the conversation.

State: <config>/kodflow/sessions/<session>/tasks.json, <config> being
CLAUDE_CONFIG_DIR or ~/.claude. The PreToolUse hook (on-tool.sh) adds
`_session` and `_agent` to every call: an MCP server cannot tell which session
or which subagent is calling, a hook can. Without the hook the session is
found through the parent Claude Code process and the agent is "main".

Standard library only, stdio JSON-RPC 2.0, one message per line.
"""

import json
import os
import sys
import tempfile
import time

PROTOCOL = "2025-06-18"
MAX_SUBJECT = 40
STATUSES = ("pending", "in_progress", "completed", "deleted")
MAIN = "main"

try:  # POSIX advisory locking; Windows runs unlocked, one writer per session
    import fcntl
except ImportError:  # pragma: no cover
    fcntl = None


def config_dir():
    """Return the Claude configuration directory."""
    return os.environ.get("CLAUDE_CONFIG_DIR") or os.path.join(os.path.expanduser("~"), ".claude")


def safe(value):
    """Keep an identifier usable as a single path component."""
    return "".join(c if c.isalnum() or c in "-_" else "-" for c in str(value))[:128] or "default"


def parent_session():
    """Find the session id of the Claude Code process that started this server."""
    path = os.path.join(config_dir(), "sessions", "%d.json" % os.getppid())
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh).get("sessionId") or ""
    except (OSError, ValueError):
        return ""


class Store:
    """The task file of one session, read and rewritten under a lock."""

    def __init__(self, session):
        self.dir = os.path.join(config_dir(), "kodflow", "sessions", safe(session))
        self.path = os.path.join(self.dir, "tasks.json")

    def _load(self):
        try:
            with open(self.path, encoding="utf-8") as fh:
                data = json.load(fh)
        except (OSError, ValueError):
            data = {}
        data.setdefault("version", 1)
        data.setdefault("next_id", 1)
        data.setdefault("tasks", [])
        return data

    def _save(self, data):
        # Write through a temporary file: a reader never sees half a list
        fd, tmp = tempfile.mkstemp(dir=self.dir, prefix=".tasks.")
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=1)
        os.replace(tmp, self.path)

    def mutate(self, change):
        """Apply change(data) under the session lock and persist the result."""
        os.makedirs(self.dir, exist_ok=True)
        with open(os.path.join(self.dir, ".lock"), "a", encoding="utf-8") as lock:
            if fcntl:
                fcntl.flock(lock, fcntl.LOCK_EX)
            data = self._load()
            result = change(data)
            self._save(data)
            return result

    def read(self):
        return self._load()


def check_subject(subject):
    subject = (subject or "").strip()
    if not subject:
        raise ValueError("subject is required")
    if len(subject) > MAX_SUBJECT:
        raise ValueError(
            "subject is %d characters, the limit is %d: it is shown in full on the status line. "
            "Shorten it to an imperative title and move the detail to description." % (len(subject), MAX_SUBJECT))
    return subject


def task_create(store, agent, args):
    subject = check_subject(args.get("subject"))

    def change(data):
        task = {
            "id": str(data["next_id"]), "agent": agent, "subject": subject,
            "description": args.get("description") or "", "status": "pending",
            "created": int(time.time()), "updated": int(time.time()),
        }
        data["next_id"] += 1
        data["tasks"].append(task)
        return task

    task = store.mutate(change)
    return "Task #%s created: %s" % (task["id"], task["subject"])


def task_update(store, agent, args):
    task_id = str(args.get("id") or "").strip().lstrip("#")
    status = args.get("status")
    subject = args.get("subject")
    if status is not None and status not in STATUSES:
        raise ValueError("status must be one of %s" % ", ".join(STATUSES))
    if subject is not None:
        subject = check_subject(subject)

    def change(data):
        for idx, task in enumerate(data["tasks"]):
            if task["id"] == task_id and task.get("agent", MAIN) == agent:
                if status == "deleted":
                    del data["tasks"][idx]
                    return "Task #%s deleted" % task_id
                if status:
                    task["status"] = status
                if subject:
                    task["subject"] = subject
                if args.get("description") is not None:
                    task["description"] = args["description"]
                task["updated"] = int(time.time())
                return "Task #%s updated: %s (%s)" % (task_id, task["subject"], task["status"])
        raise ValueError("no task #%s in this agent's list" % task_id)

    return store.mutate(change)


def task_list(store, agent, _args):
    tasks = [t for t in store.read()["tasks"] if t.get("agent", MAIN) == agent]
    if not tasks:
        return "No tasks."
    return "\n".join("#%s [%s] %s" % (t["id"], t["status"], t["subject"]) for t in tasks)


HIDDEN = {
    "_session": {"type": "string", "description": "Filled in automatically. Leave unset."},
    "_agent": {"type": "string", "description": "Filled in automatically. Leave unset."},
}

TOOLS = [
    {
        "name": "task_create",
        "description": (
            "Add a task to your task list, shown live on the user's status line. Use it for work with three "
            "or more distinct steps, or when the user lists several things to do; skip it for a single trivial "
            "change. subject: at most 40 characters, imperative, no final punctuation (\"Add the effort gauge\"); "
            "put the detail in description. New tasks start pending."),
        "inputSchema": {"type": "object", "properties": dict({
            "subject": {"type": "string", "maxLength": MAX_SUBJECT, "description": "Short imperative title, 40 characters at most."},
            "description": {"type": "string", "description": "What needs to be done."},
        }, **HIDDEN), "required": ["subject"]},
    },
    {
        "name": "task_update",
        "description": (
            "Update one of your tasks. Set in_progress before starting it, completed as soon as its work is "
            "done and verified, deleted when it no longer applies. Never leave a finished task open: the status "
            "line shows the list until every task is settled."),
        "inputSchema": {"type": "object", "properties": dict({
            "id": {"type": "string", "description": "Task id, as returned by task_create."},
            "status": {"type": "string", "enum": list(STATUSES)},
            "subject": {"type": "string", "maxLength": MAX_SUBJECT},
            "description": {"type": "string"},
        }, **HIDDEN), "required": ["id"]},
    },
    {
        "name": "task_list",
        "description": "List your tasks with their ids and statuses.",
        "inputSchema": {"type": "object", "properties": dict(HIDDEN)},
    },
]

HANDLERS = {"task_create": task_create, "task_update": task_update, "task_list": task_list}


def call_tool(params):
    name = params.get("name")
    args = params.get("arguments") or {}
    handler = HANDLERS.get(name)
    if handler is None:
        return {"content": [{"type": "text", "text": "unknown tool %s" % name}], "isError": True}
    session = args.get("_session") or parent_session() or "default"
    agent = safe(args.get("_agent") or MAIN)
    try:
        text = handler(Store(session), agent, args)
        return {"content": [{"type": "text", "text": text}]}
    except (ValueError, OSError) as err:
        return {"content": [{"type": "text", "text": str(err)}], "isError": True}


def handle(msg):
    method = msg.get("method")
    if method == "initialize":
        requested = (msg.get("params") or {}).get("protocolVersion") or PROTOCOL
        return {"protocolVersion": requested, "capabilities": {"tools": {}},
                "serverInfo": {"name": "kodflow-tasks", "version": "1.0.0"}}
    if method == "tools/list":
        return {"tools": TOOLS}
    if method == "tools/call":
        return call_tool(msg.get("params") or {})
    if method == "ping":
        return {}
    raise LookupError(method)


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except ValueError:
            continue
        if "id" not in msg:  # notification: nothing to answer
            continue
        try:
            reply = {"jsonrpc": "2.0", "id": msg["id"], "result": handle(msg)}
        except LookupError as err:
            reply = {"jsonrpc": "2.0", "id": msg["id"], "error": {"code": -32601, "message": "method not found: %s" % err}}
        sys.stdout.write(json.dumps(reply, ensure_ascii=False) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""tasks.py — MCP server holding the session task list, one list per agent.

Tasks are grouped in epics, one per subject. An agent can have several epics
open at once; one of them is active (the one being worked on). Every task
names its epic when it is created — there is no default. The file format
(version 2) is a contract shared with the status line, which draws one pill
per open epic of the main agent.

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
MAX_TITLE = 20
STATUSES = ("pending", "in_progress", "waiting", "completed", "deleted")
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
        return upgrade(data if isinstance(data, dict) else {})

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


def upgrade(data):
    """Bring a tasks.json of any earlier shape to version 2, in memory.

    v1 kept one epic per agent, {"<agent>": {"id", "title"}}; v2 keeps a list
    of epics, several open at once, and the agent's active one in `active`.
    The file is rewritten in v2 by the next mutation.
    """
    now = int(time.time())
    epics = data.get("epics")
    active = data.get("active") if isinstance(data.get("active"), dict) else {}
    if isinstance(epics, dict):
        converted = []
        for agent, epic in epics.items():
            if isinstance(epic, dict) and isinstance(epic.get("id"), int):
                converted.append({"id": epic["id"], "agent": agent, "title": str(epic.get("title") or ""),
                                  "created": now, "touched": now})
                active[agent] = epic["id"]
        epics = converted
    if not isinstance(epics, list):
        epics = []
    epics = [e for e in epics if isinstance(e, dict) and isinstance(e.get("id"), int)]
    tasks = data.get("tasks") if isinstance(data.get("tasks"), list) else []
    tasks = [t for t in tasks if isinstance(t, dict) and "id" in t]
    for task in tasks:
        task["id"] = str(task["id"])
        task.setdefault("agent", MAIN)
        task.setdefault("status", "pending")
        task.setdefault("subject", "")
        if not isinstance(task.get("epic"), int):
            task["epic"] = 0
    highest = max([e["id"] for e in epics] or [0])
    data.update({
        "version": 2,
        "next_id": data.get("next_id") if isinstance(data.get("next_id"), int) else 1,
        "next_epic": max(data.get("next_epic") if isinstance(data.get("next_epic"), int) else 1, highest + 1),
        "epics": epics, "active": active, "tasks": tasks,
    })
    return data


def check_text(value, what, limit, hint):
    value = (value or "").strip()
    if not value:
        raise ValueError("%s is required" % what)
    if len(value) > limit:
        raise ValueError("%s is %d characters, the limit is %d: %s" % (what, len(value), limit, hint))
    return value


def check_subject(subject):
    return check_text(subject, "subject", MAX_SUBJECT,
                      "it is shown in full on the status line. Shorten it to an imperative title "
                      "and move the detail to description.")


def check_title(title):
    return check_text(title, "title", MAX_TITLE,
                      "it is the label of a pill on the status line. Use a short noun phrase "
                      "(\"SDK status-line\", \"api-gateway\").")


def agent_epics(data, agent):
    return [e for e in data["epics"] if e.get("agent", MAIN) == agent]


def find_epic(data, agent, epic_id):
    for epic in agent_epics(data, agent):
        if epic["id"] == epic_id:
            return epic
    return None


def active_epic(data, agent):
    """Return the id of the agent's active epic, 0 when it has none."""
    epic_id = data["active"].get(agent, 0)
    return epic_id if find_epic(data, agent, epic_id) else 0


def tasks_of(data, agent, epic_id):
    return [t for t in data["tasks"] if t.get("agent", MAIN) == agent and t.get("epic", 0) == epic_id]


def progress(data, agent, epic_id):
    tasks = tasks_of(data, agent, epic_id)
    return sum(t["status"] == "completed" for t in tasks), len(tasks)


def is_open(data, agent, epic):
    """Open: a task not completed, or the active epic with no task yet."""
    done, total = progress(data, agent, epic["id"])
    return done < total or (total == 0 and active_epic(data, agent) == epic["id"])


def open_epics(data, agent):
    """The agent's open epics, most recently touched first."""
    epics = [e for e in agent_epics(data, agent) if is_open(data, agent, e)]
    return sorted(epics, key=lambda e: e.get("touched", 0), reverse=True)


def touch(data, agent, epic_id):
    epic = find_epic(data, agent, epic_id)
    if epic:
        epic["touched"] = int(time.time())


def parse_epic_id(value):
    text = str(value).strip().lstrip("#")
    return int(text) if text.isdigit() else None


def describe_open(data, agent):
    epics = open_epics(data, agent)
    if not epics:
        return "no epic is open"
    active = active_epic(data, agent)
    return "open epics: " + ", ".join("#%d %s%s" % (e["id"], e["title"], " (active)" if e["id"] == active else "")
                                      for e in epics)


EPIC_SYNTAX = ("task_create(subject, epic=<id>) files the task in one of your epics; epic=0 files it outside "
               "any epic; task_epic(title) opens a new epic first.")


def task_create(store, agent, args):
    subject = check_subject(args.get("subject"))
    wanted = args.get("epic")

    def change(data):
        # No default epic: a task that silently lands in whatever epic happens
        # to be active is how work gets filed under the wrong subject. The
        # caller names the epic every time, 0 included.
        if wanted is None or str(wanted).strip() == "":
            raise ValueError("epic is required: name the epic this task belongs to; %s. %s"
                             % (describe_open(data, agent), EPIC_SYNTAX))
        epic_id = parse_epic_id(wanted)
        if epic_id is None or (epic_id != 0 and not find_epic(data, agent, epic_id)):
            raise ValueError("no epic %s for this agent; %s. %s" % (wanted, describe_open(data, agent), EPIC_SYNTAX))
        now = int(time.time())
        task = {
            "id": str(data["next_id"]), "agent": agent, "epic": epic_id, "subject": subject,
            "description": args.get("description") or "", "status": "pending",
            "created": now, "updated": now,
        }
        data["next_id"] += 1
        data["tasks"].append(task)
        touch(data, agent, epic_id)
        note = ""
        if epic_id and epic_id != active_epic(data, agent):
            note = " (epic #%d is not the active one: task_focus it when you start working on it)" % epic_id
        elif epic_id:
            note = " in epic #%d %s" % (epic_id, find_epic(data, agent, epic_id)["title"])
        return "Task #%s created: %s%s" % (task["id"], subject, note)

    return store.mutate(change)


STALE_AGENT = 12 * 3600  # a subagent with no stop for this long was lost with its session


def running_subagents(store):
    """Count the subagents of the session still running (agents.json, hooks)."""
    try:
        with open(os.path.join(store.dir, "agents.json"), encoding="utf-8") as fh:
            agents = json.load(fh).get("agents") or {}
    except (OSError, ValueError, AttributeError):
        return 0
    cutoff = time.time() - STALE_AGENT
    return sum(1 for a in agents.values()
               if isinstance(a, dict) and a.get("stopped") is None and (a.get("started") or 0) >= cutoff)


def in_progress_cap(store, agent):
    """How many tasks an agent may have in progress: one per worker.

    A subagent is one worker. The main agent is one worker plus every
    subagent it has running: a task handed to a subagent is in progress
    while that subagent works, and only then.
    """
    return 1 + running_subagents(store) if agent == MAIN else 1


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
                touch(data, agent, task.get("epic", 0))
                if status == "deleted":
                    del data["tasks"][idx]
                    return "Task #%s deleted" % task_id
                # One task in progress per worker: an amber cell on the status
                # line must mean someone is on it right now
                if status == "in_progress" and task.get("status") != "in_progress":
                    busy = [t for t in data["tasks"] if t.get("agent", MAIN) == agent
                            and t.get("status") == "in_progress" and t["id"] != task_id]
                    cap = in_progress_cap(store, agent)
                    if len(busy) >= cap:
                        workers = "you" if cap == 1 else "you and %d running subagent(s)" % (cap - 1)
                        raise ValueError(
                            "cannot start #%s: %d task(s) already in progress (%s) for %d worker(s), %s. "
                            "One task per worker: complete it, or set the one nobody is on to pending or "
                            "waiting; to run this one in parallel, start a subagent for it first, then mark "
                            "it in_progress." % (task_id, len(busy), ", ".join("#%s %s" % (t["id"], t["subject"])
                                                                              for t in busy), cap, workers))
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
    data = store.read()
    active = active_epic(data, agent)
    lines = []

    def rows(tasks):
        lines.extend("#%s [%s] %s" % (t["id"], t["status"], t["subject"]) for t in tasks)

    if active:
        epic = find_epic(data, agent, active)
        done, total = progress(data, agent, active)
        lines.append("Epic #%d: %s (active, %d/%d)" % (active, epic["title"], done, total))
        if total:
            rows(tasks_of(data, agent, active))
        else:
            lines.append("No tasks yet.")
    others = [e for e in open_epics(data, agent) if e["id"] != active]
    if others:
        lines.append("Other open epics:")
        for epic in others:
            lines.append("#%d %s %d/%d" % ((epic["id"], epic["title"]) + progress(data, agent, epic["id"])))
    loose = tasks_of(data, agent, 0)
    if loose:
        lines.append("Tasks with no epic:" if active else "No active epic. Tasks with no epic:")
        rows(loose)
    return "\n".join(lines) or "No tasks and no epic."


def task_epic(store, agent, args):
    title = check_title(args.get("title"))

    def change(data):
        now = int(time.time())
        for epic in open_epics(data, agent):
            if epic["title"] == title:
                data["active"][agent] = epic["id"]
                epic["touched"] = now
                done, total = progress(data, agent, epic["id"])
                return ("Epic #%d %s is already open (%d/%d): focused it instead of opening a duplicate."
                        % (epic["id"], title, done, total))
        epic = {"id": data["next_epic"], "agent": agent, "title": title, "created": now, "touched": now}
        data["next_epic"] += 1
        data["epics"].append(epic)
        data["active"][agent] = epic["id"]
        others = [e for e in open_epics(data, agent) if e["id"] != epic["id"]]
        tail = (" Still open: " + ", ".join("#%d %s" % (e["id"], e["title"]) for e in others) + ".") if others else ""
        return ("Epic #%d %s opened and active: file its tasks with task_create(epic=%d).%s"
                % (epic["id"], title, epic["id"], tail))

    return store.mutate(change)


def task_focus(store, agent, args):
    wanted = str(args.get("epic") or "").strip()
    if not wanted:
        raise ValueError("epic is required: an epic id or its exact title")

    def change(data):
        epics = open_epics(data, agent)
        epic_id = parse_epic_id(wanted)
        match = [e for e in epics if e["id"] == epic_id] or [e for e in epics if e["title"] == wanted]
        if not match:
            closed = epic_id is not None and find_epic(data, agent, epic_id)
            why = "epic %s is completed" % wanted if closed else "no open epic %s" % wanted
            raise ValueError("%s; %s. Open a new one with task_epic." % (why, describe_open(data, agent)))
        epic = match[0]
        data["active"][agent] = epic["id"]
        epic["touched"] = int(time.time())
        done, total = progress(data, agent, epic["id"])
        return ("Epic #%d %s is now active (%d/%d): file its tasks with task_create(epic=%d)."
                % (epic["id"], epic["title"], done, total, epic["id"]))

    return store.mutate(change)


HIDDEN = {
    "_session": {"type": "string", "description": "Filled in automatically. Leave unset."},
    "_agent": {"type": "string", "description": "Filled in automatically. Leave unset."},
}

WORKFLOW = (
    " Work is grouped in epics, one per subject; several can be open at once, one is active (the one being "
    "worked on) and every task names its epic explicitly. The user's status line shows every open epic live, so the list must say what is true at every "
    "moment: in_progress while you work on a task, waiting while it is blocked on the user, completed as soon "
    "as it is done and verified.")

TOOLS = [
    {
        "name": "task_create",
        "description": (
            "Add a task. Use tasks for work with three or more distinct steps, or when the user lists several "
            "things to do; skip them for a single trivial change. epic is REQUIRED, there is no default: the id "
            "of the epic the task belongs to (task_list, or the Epics line given with each prompt, lists them), "
            "or 0 for a task outside any epic; open a new subject with task_epic first. task_focus the epic when "
            "you start its work. A change to an already completed task is a new task \"Rework #N: ...\" in that "
            "task's epic. subject: at most 40 characters, "
            "imperative, no final punctuation (\"Add the effort gauge\"); detail goes in description. New tasks "
            "start pending." + WORKFLOW),
        "inputSchema": {"type": "object", "properties": dict({
            "subject": {"type": "string", "maxLength": MAX_SUBJECT, "description": "Short imperative title, 40 characters at most."},
            "description": {"type": "string", "description": "What needs to be done."},
            "epic": {"type": "integer", "minimum": 0,
                     "description": "Required. Id of one of your epics, or 0 for no epic. No default."},
        }, **HIDDEN), "required": ["subject", "epic"]},
    },
    {
        "name": "task_update",
        "description": (
            "Update one of your tasks: set in_progress before starting it, completed as soon as its work is done "
            "and verified, waiting when it is blocked on the user (a decision, an approval, an answer), deleted "
            "when it no longer applies. Never end a turn with tasks left to do but none in_progress or waiting: "
            "either one is under way, or they wait on the user and say so. One task in_progress per worker: you "
            "may have one, plus one per running subagent (each subagent works on exactly one task); switching "
            "to another task means setting the current one back to pending first, and a task handed to a "
            "subagent goes in_progress once that subagent has started. Extra in_progress calls are refused."),
        "inputSchema": {"type": "object", "properties": dict({
            "id": {"type": "string", "description": "Task id, as returned by task_create."},
            "status": {"type": "string", "enum": list(STATUSES)},
            "subject": {"type": "string", "maxLength": MAX_SUBJECT},
            "description": {"type": "string"},
        }, **HIDDEN), "required": ["id"]},
    },
    {
        "name": "task_epic",
        "description": (
            "Open a new epic and make it active: a separate subject with its own task list and its own pill on "
            "the user's status line. Use it when the user brings a new subject, rather than appending its tasks "
            "to an unrelated epic; other open epics stay open. If an open epic already has this exact title it "
            "is focused instead. title: at most 20 characters, a short noun phrase (\"SDK status-line\")."
            + WORKFLOW),
        "inputSchema": {"type": "object", "properties": dict({
            "title": {"type": "string", "maxLength": MAX_TITLE, "description": "Subject of the epic, 20 characters at most."},
        }, **HIDDEN), "required": ["title"]},
    },
    {
        "name": "task_focus",
        "description": (
            "Make an open epic the active one, by id or exact title, when the work turns back to it: the status "
            "line expands it. Completed epics cannot be focused; open a new one "
            "with task_epic." + WORKFLOW),
        "inputSchema": {"type": "object", "properties": dict({
            "epic": {"type": "string", "description": "Epic id (\"3\" or \"#3\") or its exact title."},
        }, **HIDDEN), "required": ["epic"]},
    },
    {
        "name": "task_list",
        "description": ("List the active epic's tasks with ids and statuses, one line per other open epic "
                        "(id, title, done/total), and tasks with no epic."),
        "inputSchema": {"type": "object", "properties": dict(HIDDEN)},
    },
]

HANDLERS = {"task_create": task_create, "task_update": task_update, "task_list": task_list,
            "task_epic": task_epic, "task_focus": task_focus}


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
                "serverInfo": {"name": "kodflow-tasks", "version": "2.0.0"}}
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

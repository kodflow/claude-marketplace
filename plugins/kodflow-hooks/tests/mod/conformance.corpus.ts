// Recorded from mcp/tasks.py by gen_conformance.py: do not edit by hand. Both were
// removed once the port matched; the commit that added this file holds them.
// Each step: the call, the state of tasks.json before, the answer, the state after.
// The TypeScript port is held to it by conformance.ts.
export const T0 = 1791900000;
export const TOOLS = [
 {
  "name": "task_create",
  "description": "Add a task. Every message of the user gets one, a question included: file it before acting, and set it completed as soon as it is answered or done. epic is REQUIRED, there is no default: the id of the epic the task belongs to (task_list, or the Epics line given with each prompt, lists them), or 0 for a task outside any epic; open a new subject with task_epic first. task_focus the epic when you start its work. A change to an already completed task is a new task \"Rework #N: ...\" in that task's epic. subject: at most 40 characters, imperative, no final punctuation (\"Add the effort gauge\"); detail goes in description. New tasks start pending. Work is grouped in epics, one per subject; several can be open at once, one is active (the one being worked on) and every task names its epic explicitly. The user's status line shows every open epic live, so the list must say what is true at every moment: in_progress while you work on a task, waiting while it is blocked on the user, completed as soon as it is done and verified.",
  "inputSchema": {
   "type": "object",
   "properties": {
    "subject": {
     "type": "string",
     "maxLength": 40,
     "description": "Short imperative title, 40 characters at most."
    },
    "description": {
     "type": "string",
     "description": "What needs to be done."
    },
    "epic": {
     "type": "integer",
     "minimum": 0,
     "description": "Required. Id of one of your epics, or 0 for no epic. No default."
    }
   },
   "required": [
    "subject",
    "epic"
   ]
  }
 },
 {
  "name": "task_update",
  "description": "Update one of your tasks: set in_progress before starting it, completed as soon as its work is done and verified, waiting when it is blocked on the user (a decision, an approval, an answer), deleted when it no longer applies. Never end a turn with tasks left to do but none in_progress or waiting: either one is under way, or they wait on the user and say so. One task in_progress per worker: you may have one, plus one per running subagent (each subagent works on exactly one task); switching to another task means setting the current one back to pending first, and a task handed to a subagent goes in_progress once that subagent has started, with worker=<its type or id> so the task is tied to it. With worker, the start is refused if that subagent is stopped or already holds another task; without it, a start beyond the worker count is refused. The link is dropped when the task leaves in_progress. A refusal lists the running subagents and who holds each task in progress.",
  "inputSchema": {
   "type": "object",
   "properties": {
    "id": {
     "type": "string",
     "description": "Task id, as returned by task_create."
    },
    "status": {
     "type": "string",
     "enum": [
      "pending",
      "in_progress",
      "waiting",
      "completed",
      "deleted"
     ]
    },
    "subject": {
     "type": "string",
     "maxLength": 40
    },
    "description": {
     "type": "string"
    },
    "worker": {
     "type": "string",
     "description": "With status=in_progress: the running subagent that takes the task, by type (its name) or agent id. Optional."
    }
   },
   "required": [
    "id"
   ]
  }
 },
 {
  "name": "task_epic",
  "description": "Open a new epic and make it active: a separate subject with its own task list and its own pill on the user's status line. Use it when the user brings a new subject, rather than appending its tasks to an unrelated epic; other open epics stay open. If an open epic already has this exact title it is focused instead. title: at most 20 characters, a short noun phrase (\"SDK status-line\"). Work is grouped in epics, one per subject; several can be open at once, one is active (the one being worked on) and every task names its epic explicitly. The user's status line shows every open epic live, so the list must say what is true at every moment: in_progress while you work on a task, waiting while it is blocked on the user, completed as soon as it is done and verified.",
  "inputSchema": {
   "type": "object",
   "properties": {
    "title": {
     "type": "string",
     "maxLength": 20,
     "description": "Subject of the epic, 20 characters at most."
    }
   },
   "required": [
    "title"
   ]
  }
 },
 {
  "name": "task_focus",
  "description": "Make an open epic the active one, by id or exact title, when the work turns back to it: the status line expands it. Completed epics cannot be focused; open a new one with task_epic. Work is grouped in epics, one per subject; several can be open at once, one is active (the one being worked on) and every task names its epic explicitly. The user's status line shows every open epic live, so the list must say what is true at every moment: in_progress while you work on a task, waiting while it is blocked on the user, completed as soon as it is done and verified.",
  "inputSchema": {
   "type": "object",
   "properties": {
    "epic": {
     "type": "string",
     "description": "Epic id (\"3\" or \"#3\") or its exact title."
    }
   },
   "required": [
    "epic"
   ]
  }
 },
 {
  "name": "task_list",
  "description": "List the active epic's tasks with ids and statuses, one line per other open epic (id, title, done/total), and tasks with no epic.",
  "inputSchema": {
   "type": "object",
   "properties": {}
  }
 }
];
export const CORPUS = [
 {
  "name": "lifecycle",
  "steps": [
   {
    "now": 1791900000,
    "session": "s1",
    "agent": "main",
    "tool": "task_create",
    "args": {
     "subject": "Add the gauge",
     "epic": 0,
     "description": "d"
    },
    "before": null,
    "error": false,
    "text": "Task #1 created: Add the gauge",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "Add the gauge",
       "description": "d",
       "status": "pending",
       "created": 1791900000,
       "updated": 1791900000
      }
     ]
    }
   },
   {
    "now": 1791900001,
    "session": "s1",
    "agent": "main",
    "tool": "task_create",
    "args": {
     "subject": "Ship it",
     "epic": 0
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 1,\n \"epics\": [],\n \"active\": {},\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Add the gauge\",\n   \"description\": \"d\",\n   \"status\": \"pending\",\n   \"created\": 1791900000,\n   \"updated\": 1791900000\n  }\n ]\n}",
    "error": false,
    "text": "Task #2 created: Ship it",
    "after": {
     "version": 2,
     "next_id": 3,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "Add the gauge",
       "description": "d",
       "status": "pending",
       "created": 1791900000,
       "updated": 1791900000
      },
      {
       "id": "2",
       "agent": "main",
       "epic": 0,
       "subject": "Ship it",
       "description": "",
       "status": "pending",
       "created": 1791900001,
       "updated": 1791900001
      }
     ]
    }
   },
   {
    "now": 1791900002,
    "session": "s1",
    "agent": "main",
    "tool": "task_update",
    "args": {
     "id": "1",
     "status": "in_progress"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 3,\n \"next_epic\": 1,\n \"epics\": [],\n \"active\": {},\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Add the gauge\",\n   \"description\": \"d\",\n   \"status\": \"pending\",\n   \"created\": 1791900000,\n   \"updated\": 1791900000\n  },\n  {\n   \"id\": \"2\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Ship it\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900001,\n   \"updated\": 1791900001\n  }\n ]\n}",
    "error": false,
    "text": "Task #1 updated: Add the gauge (in_progress)",
    "after": {
     "version": 2,
     "next_id": 3,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "Add the gauge",
       "description": "d",
       "status": "in_progress",
       "created": 1791900000,
       "updated": 1791900002
      },
      {
       "id": "2",
       "agent": "main",
       "epic": 0,
       "subject": "Ship it",
       "description": "",
       "status": "pending",
       "created": 1791900001,
       "updated": 1791900001
      }
     ]
    }
   },
   {
    "now": 1791900003,
    "session": "s1",
    "agent": "main",
    "tool": "task_update",
    "args": {
     "id": "#2",
     "status": "deleted"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 3,\n \"next_epic\": 1,\n \"epics\": [],\n \"active\": {},\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Add the gauge\",\n   \"description\": \"d\",\n   \"status\": \"in_progress\",\n   \"created\": 1791900000,\n   \"updated\": 1791900002\n  },\n  {\n   \"id\": \"2\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Ship it\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900001,\n   \"updated\": 1791900001\n  }\n ]\n}",
    "error": false,
    "text": "Task #2 deleted",
    "after": {
     "version": 2,
     "next_id": 3,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "Add the gauge",
       "description": "d",
       "status": "in_progress",
       "created": 1791900000,
       "updated": 1791900002
      }
     ]
    }
   },
   {
    "now": 1791900004,
    "session": "s1",
    "agent": "main",
    "tool": "task_create",
    "args": {
     "subject": "Next",
     "epic": 0
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 3,\n \"next_epic\": 1,\n \"epics\": [],\n \"active\": {},\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Add the gauge\",\n   \"description\": \"d\",\n   \"status\": \"in_progress\",\n   \"created\": 1791900000,\n   \"updated\": 1791900002\n  }\n ]\n}",
    "error": false,
    "text": "Task #3 created: Next",
    "after": {
     "version": 2,
     "next_id": 4,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "Add the gauge",
       "description": "d",
       "status": "in_progress",
       "created": 1791900000,
       "updated": 1791900002
      },
      {
       "id": "3",
       "agent": "main",
       "epic": 0,
       "subject": "Next",
       "description": "",
       "status": "pending",
       "created": 1791900004,
       "updated": 1791900004
      }
     ]
    }
   }
  ]
 },
 {
  "name": "waiting_status",
  "steps": [
   {
    "now": 1791900000,
    "session": "s1",
    "agent": "main",
    "tool": "task_create",
    "args": {
     "subject": "Await the go",
     "epic": 0
    },
    "before": null,
    "error": false,
    "text": "Task #1 created: Await the go",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "Await the go",
       "description": "",
       "status": "pending",
       "created": 1791900000,
       "updated": 1791900000
      }
     ]
    }
   },
   {
    "now": 1791900001,
    "session": "s1",
    "agent": "main",
    "tool": "task_update",
    "args": {
     "id": "1",
     "status": "waiting"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 1,\n \"epics\": [],\n \"active\": {},\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Await the go\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900000,\n   \"updated\": 1791900000\n  }\n ]\n}",
    "error": false,
    "text": "Task #1 updated: Await the go (waiting)",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "Await the go",
       "description": "",
       "status": "waiting",
       "created": 1791900000,
       "updated": 1791900001
      }
     ]
    }
   }
  ]
 },
 {
  "name": "epics_v2_lifecycle",
  "steps": [
   {
    "now": 1791900000,
    "session": "s1",
    "agent": "main",
    "tool": "task_create",
    "args": {
     "subject": "Loose work",
     "epic": 0
    },
    "before": null,
    "error": false,
    "text": "Task #1 created: Loose work",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "Loose work",
       "description": "",
       "status": "pending",
       "created": 1791900000,
       "updated": 1791900000
      }
     ]
    }
   },
   {
    "now": 1791900001,
    "session": "s1",
    "agent": "main",
    "tool": "task_epic",
    "args": {
     "title": "SDK rewrite"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 1,\n \"epics\": [],\n \"active\": {},\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Loose work\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900000,\n   \"updated\": 1791900000\n  }\n ]\n}",
    "error": false,
    "text": "Epic #1 SDK rewrite opened and active: file its tasks with task_create(epic=1).",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "SDK rewrite",
       "created": 1791900001,
       "touched": 1791900001
      }
     ],
     "active": {
      "main": 1
     },
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "Loose work",
       "description": "",
       "status": "pending",
       "created": 1791900000,
       "updated": 1791900000
      }
     ]
    }
   },
   {
    "now": 1791900002,
    "session": "s1",
    "agent": "main",
    "tool": "task_create",
    "args": {
     "subject": "Freeze golden renders",
     "epic": 1
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 2,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"SDK rewrite\",\n   \"created\": 1791900001,\n   \"touched\": 1791900001\n  }\n ],\n \"active\": {\n  \"main\": 1\n },\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Loose work\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900000,\n   \"updated\": 1791900000\n  }\n ]\n}",
    "error": false,
    "text": "Task #2 created: Freeze golden renders in epic #1 SDK rewrite",
    "after": {
     "version": 2,
     "next_id": 3,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "SDK rewrite",
       "created": 1791900001,
       "touched": 1791900002
      }
     ],
     "active": {
      "main": 1
     },
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "Loose work",
       "description": "",
       "status": "pending",
       "created": 1791900000,
       "updated": 1791900000
      },
      {
       "id": "2",
       "agent": "main",
       "epic": 1,
       "subject": "Freeze golden renders",
       "description": "",
       "status": "pending",
       "created": 1791900002,
       "updated": 1791900002
      }
     ]
    }
   },
   {
    "now": 1791900003,
    "session": "s1",
    "agent": "main",
    "tool": "task_list",
    "args": {},
    "before": "{\n \"version\": 2,\n \"next_id\": 3,\n \"next_epic\": 2,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"SDK rewrite\",\n   \"created\": 1791900001,\n   \"touched\": 1791900002\n  }\n ],\n \"active\": {\n  \"main\": 1\n },\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Loose work\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900000,\n   \"updated\": 1791900000\n  },\n  {\n   \"id\": \"2\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Freeze golden renders\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900002,\n   \"updated\": 1791900002\n  }\n ]\n}",
    "error": false,
    "text": "Epic #1: SDK rewrite (active, 0/1)\n#2 [pending] Freeze golden renders\nTasks with no epic:\n#1 [pending] Loose work",
    "after": {
     "version": 2,
     "next_id": 3,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "SDK rewrite",
       "created": 1791900001,
       "touched": 1791900002
      }
     ],
     "active": {
      "main": 1
     },
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "Loose work",
       "description": "",
       "status": "pending",
       "created": 1791900000,
       "updated": 1791900000
      },
      {
       "id": "2",
       "agent": "main",
       "epic": 1,
       "subject": "Freeze golden renders",
       "description": "",
       "status": "pending",
       "created": 1791900002,
       "updated": 1791900002
      }
     ]
    }
   }
  ]
 },
 {
  "name": "several_open_epics_and_focus",
  "steps": [
   {
    "now": 1791900000,
    "session": "s1",
    "agent": "main",
    "tool": "task_epic",
    "args": {
     "title": "SDK status-line"
    },
    "before": null,
    "error": false,
    "text": "Epic #1 SDK status-line opened and active: file its tasks with task_create(epic=1).",
    "after": {
     "version": 2,
     "next_id": 1,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "SDK status-line",
       "created": 1791900000,
       "touched": 1791900000
      }
     ],
     "active": {
      "main": 1
     },
     "tasks": []
    }
   },
   {
    "now": 1791900001,
    "session": "s1",
    "agent": "main",
    "tool": "task_create",
    "args": {
     "subject": "Port the renderer",
     "epic": 1
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 1,\n \"next_epic\": 2,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"SDK status-line\",\n   \"created\": 1791900000,\n   \"touched\": 1791900000\n  }\n ],\n \"active\": {\n  \"main\": 1\n },\n \"tasks\": []\n}",
    "error": false,
    "text": "Task #1 created: Port the renderer in epic #1 SDK status-line",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "SDK status-line",
       "created": 1791900000,
       "touched": 1791900001
      }
     ],
     "active": {
      "main": 1
     },
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 1,
       "subject": "Port the renderer",
       "description": "",
       "status": "pending",
       "created": 1791900001,
       "updated": 1791900001
      }
     ]
    }
   },
   {
    "now": 1791900002,
    "session": "s1",
    "agent": "main",
    "tool": "task_epic",
    "args": {
     "title": "api-gateway"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 2,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"SDK status-line\",\n   \"created\": 1791900000,\n   \"touched\": 1791900001\n  }\n ],\n \"active\": {\n  \"main\": 1\n },\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Port the renderer\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900001,\n   \"updated\": 1791900001\n  }\n ]\n}",
    "error": false,
    "text": "Epic #2 api-gateway opened and active: file its tasks with task_create(epic=2). Still open: #1 SDK status-line.",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 3,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "SDK status-line",
       "created": 1791900000,
       "touched": 1791900001
      },
      {
       "id": 2,
       "agent": "main",
       "title": "api-gateway",
       "created": 1791900002,
       "touched": 1791900002
      }
     ],
     "active": {
      "main": 2
     },
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 1,
       "subject": "Port the renderer",
       "description": "",
       "status": "pending",
       "created": 1791900001,
       "updated": 1791900001
      }
     ]
    }
   },
   {
    "now": 1791900003,
    "session": "s1",
    "agent": "main",
    "tool": "task_create",
    "args": {
     "subject": "Fix the daemon",
     "epic": 2
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 3,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"SDK status-line\",\n   \"created\": 1791900000,\n   \"touched\": 1791900001\n  },\n  {\n   \"id\": 2,\n   \"agent\": \"main\",\n   \"title\": \"api-gateway\",\n   \"created\": 1791900002,\n   \"touched\": 1791900002\n  }\n ],\n \"active\": {\n  \"main\": 2\n },\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Port the renderer\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900001,\n   \"updated\": 1791900001\n  }\n ]\n}",
    "error": false,
    "text": "Task #2 created: Fix the daemon in epic #2 api-gateway",
    "after": {
     "version": 2,
     "next_id": 3,
     "next_epic": 3,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "SDK status-line",
       "created": 1791900000,
       "touched": 1791900001
      },
      {
       "id": 2,
       "agent": "main",
       "title": "api-gateway",
       "created": 1791900002,
       "touched": 1791900003
      }
     ],
     "active": {
      "main": 2
     },
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 1,
       "subject": "Port the renderer",
       "description": "",
       "status": "pending",
       "created": 1791900001,
       "updated": 1791900001
      },
      {
       "id": "2",
       "agent": "main",
       "epic": 2,
       "subject": "Fix the daemon",
       "description": "",
       "status": "pending",
       "created": 1791900003,
       "updated": 1791900003
      }
     ]
    }
   },
   {
    "now": 1791900004,
    "session": "s1",
    "agent": "main",
    "tool": "task_update",
    "args": {
     "id": "2",
     "status": "completed"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 3,\n \"next_epic\": 3,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"SDK status-line\",\n   \"created\": 1791900000,\n   \"touched\": 1791900001\n  },\n  {\n   \"id\": 2,\n   \"agent\": \"main\",\n   \"title\": \"api-gateway\",\n   \"created\": 1791900002,\n   \"touched\": 1791900003\n  }\n ],\n \"active\": {\n  \"main\": 2\n },\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Port the renderer\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900001,\n   \"updated\": 1791900001\n  },\n  {\n   \"id\": \"2\",\n   \"agent\": \"main\",\n   \"epic\": 2,\n   \"subject\": \"Fix the daemon\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900003,\n   \"updated\": 1791900003\n  }\n ]\n}",
    "error": false,
    "text": "Task #2 updated: Fix the daemon (completed)",
    "after": {
     "version": 2,
     "next_id": 3,
     "next_epic": 3,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "SDK status-line",
       "created": 1791900000,
       "touched": 1791900001
      },
      {
       "id": 2,
       "agent": "main",
       "title": "api-gateway",
       "created": 1791900002,
       "touched": 1791900004
      }
     ],
     "active": {
      "main": 2
     },
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 1,
       "subject": "Port the renderer",
       "description": "",
       "status": "pending",
       "created": 1791900001,
       "updated": 1791900001
      },
      {
       "id": "2",
       "agent": "main",
       "epic": 2,
       "subject": "Fix the daemon",
       "description": "",
       "status": "completed",
       "created": 1791900003,
       "updated": 1791900004
      }
     ]
    }
   },
   {
    "now": 1791900005,
    "session": "s1",
    "agent": "main",
    "tool": "task_create",
    "args": {
     "subject": "Ship",
     "epic": 2
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 3,\n \"next_epic\": 3,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"SDK status-line\",\n   \"created\": 1791900000,\n   \"touched\": 1791900001\n  },\n  {\n   \"id\": 2,\n   \"agent\": \"main\",\n   \"title\": \"api-gateway\",\n   \"created\": 1791900002,\n   \"touched\": 1791900004\n  }\n ],\n \"active\": {\n  \"main\": 2\n },\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Port the renderer\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900001,\n   \"updated\": 1791900001\n  },\n  {\n   \"id\": \"2\",\n   \"agent\": \"main\",\n   \"epic\": 2,\n   \"subject\": \"Fix the daemon\",\n   \"description\": \"\",\n   \"status\": \"completed\",\n   \"created\": 1791900003,\n   \"updated\": 1791900004\n  }\n ]\n}",
    "error": false,
    "text": "Task #3 created: Ship in epic #2 api-gateway",
    "after": {
     "version": 2,
     "next_id": 4,
     "next_epic": 3,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "SDK status-line",
       "created": 1791900000,
       "touched": 1791900001
      },
      {
       "id": 2,
       "agent": "main",
       "title": "api-gateway",
       "created": 1791900002,
       "touched": 1791900005
      }
     ],
     "active": {
      "main": 2
     },
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 1,
       "subject": "Port the renderer",
       "description": "",
       "status": "pending",
       "created": 1791900001,
       "updated": 1791900001
      },
      {
       "id": "2",
       "agent": "main",
       "epic": 2,
       "subject": "Fix the daemon",
       "description": "",
       "status": "completed",
       "created": 1791900003,
       "updated": 1791900004
      },
      {
       "id": "3",
       "agent": "main",
       "epic": 2,
       "subject": "Ship",
       "description": "",
       "status": "pending",
       "created": 1791900005,
       "updated": 1791900005
      }
     ]
    }
   },
   {
    "now": 1791900006,
    "session": "s1",
    "agent": "main",
    "tool": "task_list",
    "args": {},
    "before": "{\n \"version\": 2,\n \"next_id\": 4,\n \"next_epic\": 3,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"SDK status-line\",\n   \"created\": 1791900000,\n   \"touched\": 1791900001\n  },\n  {\n   \"id\": 2,\n   \"agent\": \"main\",\n   \"title\": \"api-gateway\",\n   \"created\": 1791900002,\n   \"touched\": 1791900005\n  }\n ],\n \"active\": {\n  \"main\": 2\n },\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Port the renderer\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900001,\n   \"updated\": 1791900001\n  },\n  {\n   \"id\": \"2\",\n   \"agent\": \"main\",\n   \"epic\": 2,\n   \"subject\": \"Fix the daemon\",\n   \"description\": \"\",\n   \"status\": \"completed\",\n   \"created\": 1791900003,\n   \"updated\": 1791900004\n  },\n  {\n   \"id\": \"3\",\n   \"agent\": \"main\",\n   \"epic\": 2,\n   \"subject\": \"Ship\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900005,\n   \"updated\": 1791900005\n  }\n ]\n}",
    "error": false,
    "text": "Epic #2: api-gateway (active, 1/2)\n#2 [completed] Fix the daemon\n#3 [pending] Ship\nOther open epics:\n#1 SDK status-line 0/1",
    "after": {
     "version": 2,
     "next_id": 4,
     "next_epic": 3,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "SDK status-line",
       "created": 1791900000,
       "touched": 1791900001
      },
      {
       "id": 2,
       "agent": "main",
       "title": "api-gateway",
       "created": 1791900002,
       "touched": 1791900005
      }
     ],
     "active": {
      "main": 2
     },
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 1,
       "subject": "Port the renderer",
       "description": "",
       "status": "pending",
       "created": 1791900001,
       "updated": 1791900001
      },
      {
       "id": "2",
       "agent": "main",
       "epic": 2,
       "subject": "Fix the daemon",
       "description": "",
       "status": "completed",
       "created": 1791900003,
       "updated": 1791900004
      },
      {
       "id": "3",
       "agent": "main",
       "epic": 2,
       "subject": "Ship",
       "description": "",
       "status": "pending",
       "created": 1791900005,
       "updated": 1791900005
      }
     ]
    }
   },
   {
    "now": 1791900007,
    "session": "s1",
    "agent": "main",
    "tool": "task_focus",
    "args": {
     "epic": "#1"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 4,\n \"next_epic\": 3,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"SDK status-line\",\n   \"created\": 1791900000,\n   \"touched\": 1791900001\n  },\n  {\n   \"id\": 2,\n   \"agent\": \"main\",\n   \"title\": \"api-gateway\",\n   \"created\": 1791900002,\n   \"touched\": 1791900005\n  }\n ],\n \"active\": {\n  \"main\": 2\n },\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Port the renderer\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900001,\n   \"updated\": 1791900001\n  },\n  {\n   \"id\": \"2\",\n   \"agent\": \"main\",\n   \"epic\": 2,\n   \"subject\": \"Fix the daemon\",\n   \"description\": \"\",\n   \"status\": \"completed\",\n   \"created\": 1791900003,\n   \"updated\": 1791900004\n  },\n  {\n   \"id\": \"3\",\n   \"agent\": \"main\",\n   \"epic\": 2,\n   \"subject\": \"Ship\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900005,\n   \"updated\": 1791900005\n  }\n ]\n}",
    "error": false,
    "text": "Epic #1 SDK status-line is now active (0/1): file its tasks with task_create(epic=1).",
    "after": {
     "version": 2,
     "next_id": 4,
     "next_epic": 3,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "SDK status-line",
       "created": 1791900000,
       "touched": 1791900007
      },
      {
       "id": 2,
       "agent": "main",
       "title": "api-gateway",
       "created": 1791900002,
       "touched": 1791900005
      }
     ],
     "active": {
      "main": 1
     },
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 1,
       "subject": "Port the renderer",
       "description": "",
       "status": "pending",
       "created": 1791900001,
       "updated": 1791900001
      },
      {
       "id": "2",
       "agent": "main",
       "epic": 2,
       "subject": "Fix the daemon",
       "description": "",
       "status": "completed",
       "created": 1791900003,
       "updated": 1791900004
      },
      {
       "id": "3",
       "agent": "main",
       "epic": 2,
       "subject": "Ship",
       "description": "",
       "status": "pending",
       "created": 1791900005,
       "updated": 1791900005
      }
     ]
    }
   },
   {
    "now": 1791900008,
    "session": "s1",
    "agent": "main",
    "tool": "task_focus",
    "args": {
     "epic": "api-gateway"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 4,\n \"next_epic\": 3,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"SDK status-line\",\n   \"created\": 1791900000,\n   \"touched\": 1791900007\n  },\n  {\n   \"id\": 2,\n   \"agent\": \"main\",\n   \"title\": \"api-gateway\",\n   \"created\": 1791900002,\n   \"touched\": 1791900005\n  }\n ],\n \"active\": {\n  \"main\": 1\n },\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Port the renderer\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900001,\n   \"updated\": 1791900001\n  },\n  {\n   \"id\": \"2\",\n   \"agent\": \"main\",\n   \"epic\": 2,\n   \"subject\": \"Fix the daemon\",\n   \"description\": \"\",\n   \"status\": \"completed\",\n   \"created\": 1791900003,\n   \"updated\": 1791900004\n  },\n  {\n   \"id\": \"3\",\n   \"agent\": \"main\",\n   \"epic\": 2,\n   \"subject\": \"Ship\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900005,\n   \"updated\": 1791900005\n  }\n ]\n}",
    "error": false,
    "text": "Epic #2 api-gateway is now active (1/2): file its tasks with task_create(epic=2).",
    "after": {
     "version": 2,
     "next_id": 4,
     "next_epic": 3,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "SDK status-line",
       "created": 1791900000,
       "touched": 1791900007
      },
      {
       "id": 2,
       "agent": "main",
       "title": "api-gateway",
       "created": 1791900002,
       "touched": 1791900008
      }
     ],
     "active": {
      "main": 2
     },
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 1,
       "subject": "Port the renderer",
       "description": "",
       "status": "pending",
       "created": 1791900001,
       "updated": 1791900001
      },
      {
       "id": "2",
       "agent": "main",
       "epic": 2,
       "subject": "Fix the daemon",
       "description": "",
       "status": "completed",
       "created": 1791900003,
       "updated": 1791900004
      },
      {
       "id": "3",
       "agent": "main",
       "epic": 2,
       "subject": "Ship",
       "description": "",
       "status": "pending",
       "created": 1791900005,
       "updated": 1791900005
      }
     ]
    }
   },
   {
    "now": 1791900009,
    "session": "s1",
    "agent": "main",
    "tool": "task_create",
    "args": {
     "subject": "Next",
     "epic": 2
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 4,\n \"next_epic\": 3,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"SDK status-line\",\n   \"created\": 1791900000,\n   \"touched\": 1791900007\n  },\n  {\n   \"id\": 2,\n   \"agent\": \"main\",\n   \"title\": \"api-gateway\",\n   \"created\": 1791900002,\n   \"touched\": 1791900008\n  }\n ],\n \"active\": {\n  \"main\": 2\n },\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Port the renderer\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900001,\n   \"updated\": 1791900001\n  },\n  {\n   \"id\": \"2\",\n   \"agent\": \"main\",\n   \"epic\": 2,\n   \"subject\": \"Fix the daemon\",\n   \"description\": \"\",\n   \"status\": \"completed\",\n   \"created\": 1791900003,\n   \"updated\": 1791900004\n  },\n  {\n   \"id\": \"3\",\n   \"agent\": \"main\",\n   \"epic\": 2,\n   \"subject\": \"Ship\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900005,\n   \"updated\": 1791900005\n  }\n ]\n}",
    "error": false,
    "text": "Task #4 created: Next in epic #2 api-gateway",
    "after": {
     "version": 2,
     "next_id": 5,
     "next_epic": 3,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "SDK status-line",
       "created": 1791900000,
       "touched": 1791900007
      },
      {
       "id": 2,
       "agent": "main",
       "title": "api-gateway",
       "created": 1791900002,
       "touched": 1791900009
      }
     ],
     "active": {
      "main": 2
     },
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 1,
       "subject": "Port the renderer",
       "description": "",
       "status": "pending",
       "created": 1791900001,
       "updated": 1791900001
      },
      {
       "id": "2",
       "agent": "main",
       "epic": 2,
       "subject": "Fix the daemon",
       "description": "",
       "status": "completed",
       "created": 1791900003,
       "updated": 1791900004
      },
      {
       "id": "3",
       "agent": "main",
       "epic": 2,
       "subject": "Ship",
       "description": "",
       "status": "pending",
       "created": 1791900005,
       "updated": 1791900005
      },
      {
       "id": "4",
       "agent": "main",
       "epic": 2,
       "subject": "Next",
       "description": "",
       "status": "pending",
       "created": 1791900009,
       "updated": 1791900009
      }
     ]
    }
   }
  ]
 },
 {
  "name": "focus_refuses_unknown_and_closed",
  "steps": [
   {
    "now": 1791900000,
    "session": "s1",
    "agent": "main",
    "tool": "task_epic",
    "args": {
     "title": "Done soon"
    },
    "before": null,
    "error": false,
    "text": "Epic #1 Done soon opened and active: file its tasks with task_create(epic=1).",
    "after": {
     "version": 2,
     "next_id": 1,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Done soon",
       "created": 1791900000,
       "touched": 1791900000
      }
     ],
     "active": {
      "main": 1
     },
     "tasks": []
    }
   },
   {
    "now": 1791900001,
    "session": "s1",
    "agent": "main",
    "tool": "task_create",
    "args": {
     "subject": "Only task",
     "epic": 1
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 1,\n \"next_epic\": 2,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"Done soon\",\n   \"created\": 1791900000,\n   \"touched\": 1791900000\n  }\n ],\n \"active\": {\n  \"main\": 1\n },\n \"tasks\": []\n}",
    "error": false,
    "text": "Task #1 created: Only task in epic #1 Done soon",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Done soon",
       "created": 1791900000,
       "touched": 1791900001
      }
     ],
     "active": {
      "main": 1
     },
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 1,
       "subject": "Only task",
       "description": "",
       "status": "pending",
       "created": 1791900001,
       "updated": 1791900001
      }
     ]
    }
   },
   {
    "now": 1791900002,
    "session": "s1",
    "agent": "main",
    "tool": "task_update",
    "args": {
     "id": "1",
     "status": "completed"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 2,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"Done soon\",\n   \"created\": 1791900000,\n   \"touched\": 1791900001\n  }\n ],\n \"active\": {\n  \"main\": 1\n },\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Only task\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900001,\n   \"updated\": 1791900001\n  }\n ]\n}",
    "error": false,
    "text": "Task #1 updated: Only task (completed)",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Done soon",
       "created": 1791900000,
       "touched": 1791900002
      }
     ],
     "active": {
      "main": 1
     },
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 1,
       "subject": "Only task",
       "description": "",
       "status": "completed",
       "created": 1791900001,
       "updated": 1791900002
      }
     ]
    }
   },
   {
    "now": 1791900003,
    "session": "s1",
    "agent": "main",
    "tool": "task_epic",
    "args": {
     "title": "Other"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 2,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"Done soon\",\n   \"created\": 1791900000,\n   \"touched\": 1791900002\n  }\n ],\n \"active\": {\n  \"main\": 1\n },\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Only task\",\n   \"description\": \"\",\n   \"status\": \"completed\",\n   \"created\": 1791900001,\n   \"updated\": 1791900002\n  }\n ]\n}",
    "error": false,
    "text": "Epic #2 Other opened and active: file its tasks with task_create(epic=2).",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 3,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Done soon",
       "created": 1791900000,
       "touched": 1791900002
      },
      {
       "id": 2,
       "agent": "main",
       "title": "Other",
       "created": 1791900003,
       "touched": 1791900003
      }
     ],
     "active": {
      "main": 2
     },
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 1,
       "subject": "Only task",
       "description": "",
       "status": "completed",
       "created": 1791900001,
       "updated": 1791900002
      }
     ]
    }
   },
   {
    "now": 1791900004,
    "session": "s1",
    "agent": "main",
    "tool": "task_focus",
    "args": {
     "epic": "1"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 3,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"Done soon\",\n   \"created\": 1791900000,\n   \"touched\": 1791900002\n  },\n  {\n   \"id\": 2,\n   \"agent\": \"main\",\n   \"title\": \"Other\",\n   \"created\": 1791900003,\n   \"touched\": 1791900003\n  }\n ],\n \"active\": {\n  \"main\": 2\n },\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Only task\",\n   \"description\": \"\",\n   \"status\": \"completed\",\n   \"created\": 1791900001,\n   \"updated\": 1791900002\n  }\n ]\n}",
    "error": true,
    "text": "epic 1 is completed; open epics: #2 Other (active). Open a new one with task_epic.",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 3,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Done soon",
       "created": 1791900000,
       "touched": 1791900002
      },
      {
       "id": 2,
       "agent": "main",
       "title": "Other",
       "created": 1791900003,
       "touched": 1791900003
      }
     ],
     "active": {
      "main": 2
     },
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 1,
       "subject": "Only task",
       "description": "",
       "status": "completed",
       "created": 1791900001,
       "updated": 1791900002
      }
     ]
    }
   },
   {
    "now": 1791900005,
    "session": "s1",
    "agent": "main",
    "tool": "task_focus",
    "args": {
     "epic": "nope"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 3,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"Done soon\",\n   \"created\": 1791900000,\n   \"touched\": 1791900002\n  },\n  {\n   \"id\": 2,\n   \"agent\": \"main\",\n   \"title\": \"Other\",\n   \"created\": 1791900003,\n   \"touched\": 1791900003\n  }\n ],\n \"active\": {\n  \"main\": 2\n },\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Only task\",\n   \"description\": \"\",\n   \"status\": \"completed\",\n   \"created\": 1791900001,\n   \"updated\": 1791900002\n  }\n ]\n}",
    "error": true,
    "text": "no open epic nope; open epics: #2 Other (active). Open a new one with task_epic.",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 3,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Done soon",
       "created": 1791900000,
       "touched": 1791900002
      },
      {
       "id": 2,
       "agent": "main",
       "title": "Other",
       "created": 1791900003,
       "touched": 1791900003
      }
     ],
     "active": {
      "main": 2
     },
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 1,
       "subject": "Only task",
       "description": "",
       "status": "completed",
       "created": 1791900001,
       "updated": 1791900002
      }
     ]
    }
   },
   {
    "now": 1791900006,
    "session": "s1",
    "agent": "a1",
    "tool": "task_focus",
    "args": {
     "epic": "2"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 3,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"Done soon\",\n   \"created\": 1791900000,\n   \"touched\": 1791900002\n  },\n  {\n   \"id\": 2,\n   \"agent\": \"main\",\n   \"title\": \"Other\",\n   \"created\": 1791900003,\n   \"touched\": 1791900003\n  }\n ],\n \"active\": {\n  \"main\": 2\n },\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Only task\",\n   \"description\": \"\",\n   \"status\": \"completed\",\n   \"created\": 1791900001,\n   \"updated\": 1791900002\n  }\n ]\n}",
    "error": true,
    "text": "no open epic 2; no epic is open. Open a new one with task_epic.",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 3,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Done soon",
       "created": 1791900000,
       "touched": 1791900002
      },
      {
       "id": 2,
       "agent": "main",
       "title": "Other",
       "created": 1791900003,
       "touched": 1791900003
      }
     ],
     "active": {
      "main": 2
     },
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 1,
       "subject": "Only task",
       "description": "",
       "status": "completed",
       "created": 1791900001,
       "updated": 1791900002
      }
     ]
    }
   },
   {
    "now": 1791900007,
    "session": "s1",
    "agent": "main",
    "tool": "task_focus",
    "args": {},
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 3,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"Done soon\",\n   \"created\": 1791900000,\n   \"touched\": 1791900002\n  },\n  {\n   \"id\": 2,\n   \"agent\": \"main\",\n   \"title\": \"Other\",\n   \"created\": 1791900003,\n   \"touched\": 1791900003\n  }\n ],\n \"active\": {\n  \"main\": 2\n },\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Only task\",\n   \"description\": \"\",\n   \"status\": \"completed\",\n   \"created\": 1791900001,\n   \"updated\": 1791900002\n  }\n ]\n}",
    "error": true,
    "text": "epic is required: an epic id or its exact title",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 3,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Done soon",
       "created": 1791900000,
       "touched": 1791900002
      },
      {
       "id": 2,
       "agent": "main",
       "title": "Other",
       "created": 1791900003,
       "touched": 1791900003
      }
     ],
     "active": {
      "main": 2
     },
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 1,
       "subject": "Only task",
       "description": "",
       "status": "completed",
       "created": 1791900001,
       "updated": 1791900002
      }
     ]
    }
   },
   {
    "now": 1791900008,
    "session": "s1",
    "agent": "main",
    "tool": "task_focus",
    "args": {
     "epic": 0
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 3,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"Done soon\",\n   \"created\": 1791900000,\n   \"touched\": 1791900002\n  },\n  {\n   \"id\": 2,\n   \"agent\": \"main\",\n   \"title\": \"Other\",\n   \"created\": 1791900003,\n   \"touched\": 1791900003\n  }\n ],\n \"active\": {\n  \"main\": 2\n },\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Only task\",\n   \"description\": \"\",\n   \"status\": \"completed\",\n   \"created\": 1791900001,\n   \"updated\": 1791900002\n  }\n ]\n}",
    "error": true,
    "text": "epic is required: an epic id or its exact title",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 3,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Done soon",
       "created": 1791900000,
       "touched": 1791900002
      },
      {
       "id": 2,
       "agent": "main",
       "title": "Other",
       "created": 1791900003,
       "touched": 1791900003
      }
     ],
     "active": {
      "main": 2
     },
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 1,
       "subject": "Only task",
       "description": "",
       "status": "completed",
       "created": 1791900001,
       "updated": 1791900002
      }
     ]
    }
   }
  ]
 },
 {
  "name": "create_in_explicit_epic",
  "steps": [
   {
    "now": 1791900000,
    "session": "s1",
    "agent": "main",
    "tool": "task_epic",
    "args": {
     "title": "First"
    },
    "before": null,
    "error": false,
    "text": "Epic #1 First opened and active: file its tasks with task_create(epic=1).",
    "after": {
     "version": 2,
     "next_id": 1,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "First",
       "created": 1791900000,
       "touched": 1791900000
      }
     ],
     "active": {
      "main": 1
     },
     "tasks": []
    }
   },
   {
    "now": 1791900001,
    "session": "s1",
    "agent": "main",
    "tool": "task_epic",
    "args": {
     "title": "Second"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 1,\n \"next_epic\": 2,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"First\",\n   \"created\": 1791900000,\n   \"touched\": 1791900000\n  }\n ],\n \"active\": {\n  \"main\": 1\n },\n \"tasks\": []\n}",
    "error": false,
    "text": "Epic #2 Second opened and active: file its tasks with task_create(epic=2).",
    "after": {
     "version": 2,
     "next_id": 1,
     "next_epic": 3,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "First",
       "created": 1791900000,
       "touched": 1791900000
      },
      {
       "id": 2,
       "agent": "main",
       "title": "Second",
       "created": 1791900001,
       "touched": 1791900001
      }
     ],
     "active": {
      "main": 2
     },
     "tasks": []
    }
   },
   {
    "now": 1791900002,
    "session": "s1",
    "agent": "main",
    "tool": "task_create",
    "args": {
     "subject": "Belongs to first",
     "epic": 1
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 1,\n \"next_epic\": 3,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"First\",\n   \"created\": 1791900000,\n   \"touched\": 1791900000\n  },\n  {\n   \"id\": 2,\n   \"agent\": \"main\",\n   \"title\": \"Second\",\n   \"created\": 1791900001,\n   \"touched\": 1791900001\n  }\n ],\n \"active\": {\n  \"main\": 2\n },\n \"tasks\": []\n}",
    "error": false,
    "text": "Task #1 created: Belongs to first (epic #1 is not the active one: task_focus it when you start working on it)",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 3,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "First",
       "created": 1791900000,
       "touched": 1791900002
      },
      {
       "id": 2,
       "agent": "main",
       "title": "Second",
       "created": 1791900001,
       "touched": 1791900001
      }
     ],
     "active": {
      "main": 2
     },
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 1,
       "subject": "Belongs to first",
       "description": "",
       "status": "pending",
       "created": 1791900002,
       "updated": 1791900002
      }
     ]
    }
   },
   {
    "now": 1791900003,
    "session": "s1",
    "agent": "main",
    "tool": "task_create",
    "args": {
     "subject": "Lost",
     "epic": 9
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 3,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"First\",\n   \"created\": 1791900000,\n   \"touched\": 1791900002\n  },\n  {\n   \"id\": 2,\n   \"agent\": \"main\",\n   \"title\": \"Second\",\n   \"created\": 1791900001,\n   \"touched\": 1791900001\n  }\n ],\n \"active\": {\n  \"main\": 2\n },\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Belongs to first\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900002,\n   \"updated\": 1791900002\n  }\n ]\n}",
    "error": true,
    "text": "no epic 9 for this agent; open epics: #1 First, #2 Second (active). task_create(subject, epic=<id>) files the task in one of your epics; epic=0 files it outside any epic; task_epic(title) opens a new epic first.",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 3,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "First",
       "created": 1791900000,
       "touched": 1791900002
      },
      {
       "id": 2,
       "agent": "main",
       "title": "Second",
       "created": 1791900001,
       "touched": 1791900001
      }
     ],
     "active": {
      "main": 2
     },
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 1,
       "subject": "Belongs to first",
       "description": "",
       "status": "pending",
       "created": 1791900002,
       "updated": 1791900002
      }
     ]
    }
   },
   {
    "now": 1791900004,
    "session": "s1",
    "agent": "a1",
    "tool": "task_create",
    "args": {
     "subject": "x",
     "epic": 1
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 3,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"First\",\n   \"created\": 1791900000,\n   \"touched\": 1791900002\n  },\n  {\n   \"id\": 2,\n   \"agent\": \"main\",\n   \"title\": \"Second\",\n   \"created\": 1791900001,\n   \"touched\": 1791900001\n  }\n ],\n \"active\": {\n  \"main\": 2\n },\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Belongs to first\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900002,\n   \"updated\": 1791900002\n  }\n ]\n}",
    "error": true,
    "text": "no epic 1 for this agent; no epic is open. task_create(subject, epic=<id>) files the task in one of your epics; epic=0 files it outside any epic; task_epic(title) opens a new epic first.",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 3,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "First",
       "created": 1791900000,
       "touched": 1791900002
      },
      {
       "id": 2,
       "agent": "main",
       "title": "Second",
       "created": 1791900001,
       "touched": 1791900001
      }
     ],
     "active": {
      "main": 2
     },
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 1,
       "subject": "Belongs to first",
       "description": "",
       "status": "pending",
       "created": 1791900002,
       "updated": 1791900002
      }
     ]
    }
   }
  ]
 },
 {
  "name": "rework_of_completed_task_reopens_its_epic",
  "steps": [
   {
    "now": 1791900000,
    "session": "s1",
    "agent": "main",
    "tool": "task_epic",
    "args": {
     "title": "Shipped"
    },
    "before": null,
    "error": false,
    "text": "Epic #1 Shipped opened and active: file its tasks with task_create(epic=1).",
    "after": {
     "version": 2,
     "next_id": 1,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Shipped",
       "created": 1791900000,
       "touched": 1791900000
      }
     ],
     "active": {
      "main": 1
     },
     "tasks": []
    }
   },
   {
    "now": 1791900001,
    "session": "s1",
    "agent": "main",
    "tool": "task_create",
    "args": {
     "subject": "Build it",
     "epic": 1
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 1,\n \"next_epic\": 2,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"Shipped\",\n   \"created\": 1791900000,\n   \"touched\": 1791900000\n  }\n ],\n \"active\": {\n  \"main\": 1\n },\n \"tasks\": []\n}",
    "error": false,
    "text": "Task #1 created: Build it in epic #1 Shipped",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Shipped",
       "created": 1791900000,
       "touched": 1791900001
      }
     ],
     "active": {
      "main": 1
     },
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 1,
       "subject": "Build it",
       "description": "",
       "status": "pending",
       "created": 1791900001,
       "updated": 1791900001
      }
     ]
    }
   },
   {
    "now": 1791900002,
    "session": "s1",
    "agent": "main",
    "tool": "task_update",
    "args": {
     "id": "1",
     "status": "completed"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 2,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"Shipped\",\n   \"created\": 1791900000,\n   \"touched\": 1791900001\n  }\n ],\n \"active\": {\n  \"main\": 1\n },\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Build it\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900001,\n   \"updated\": 1791900001\n  }\n ]\n}",
    "error": false,
    "text": "Task #1 updated: Build it (completed)",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Shipped",
       "created": 1791900000,
       "touched": 1791900002
      }
     ],
     "active": {
      "main": 1
     },
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 1,
       "subject": "Build it",
       "description": "",
       "status": "completed",
       "created": 1791900001,
       "updated": 1791900002
      }
     ]
    }
   },
   {
    "now": 1791900003,
    "session": "s1",
    "agent": "main",
    "tool": "task_epic",
    "args": {
     "title": "Next thing"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 2,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"Shipped\",\n   \"created\": 1791900000,\n   \"touched\": 1791900002\n  }\n ],\n \"active\": {\n  \"main\": 1\n },\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Build it\",\n   \"description\": \"\",\n   \"status\": \"completed\",\n   \"created\": 1791900001,\n   \"updated\": 1791900002\n  }\n ]\n}",
    "error": false,
    "text": "Epic #2 Next thing opened and active: file its tasks with task_create(epic=2).",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 3,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Shipped",
       "created": 1791900000,
       "touched": 1791900002
      },
      {
       "id": 2,
       "agent": "main",
       "title": "Next thing",
       "created": 1791900003,
       "touched": 1791900003
      }
     ],
     "active": {
      "main": 2
     },
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 1,
       "subject": "Build it",
       "description": "",
       "status": "completed",
       "created": 1791900001,
       "updated": 1791900002
      }
     ]
    }
   },
   {
    "now": 1791900004,
    "session": "s1",
    "agent": "main",
    "tool": "task_create",
    "args": {
     "subject": "Rework #1: tweak",
     "epic": 1
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 3,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"Shipped\",\n   \"created\": 1791900000,\n   \"touched\": 1791900002\n  },\n  {\n   \"id\": 2,\n   \"agent\": \"main\",\n   \"title\": \"Next thing\",\n   \"created\": 1791900003,\n   \"touched\": 1791900003\n  }\n ],\n \"active\": {\n  \"main\": 2\n },\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Build it\",\n   \"description\": \"\",\n   \"status\": \"completed\",\n   \"created\": 1791900001,\n   \"updated\": 1791900002\n  }\n ]\n}",
    "error": false,
    "text": "Task #2 created: Rework #1: tweak (epic #1 is not the active one: task_focus it when you start working on it)",
    "after": {
     "version": 2,
     "next_id": 3,
     "next_epic": 3,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Shipped",
       "created": 1791900000,
       "touched": 1791900004
      },
      {
       "id": 2,
       "agent": "main",
       "title": "Next thing",
       "created": 1791900003,
       "touched": 1791900003
      }
     ],
     "active": {
      "main": 2
     },
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 1,
       "subject": "Build it",
       "description": "",
       "status": "completed",
       "created": 1791900001,
       "updated": 1791900002
      },
      {
       "id": "2",
       "agent": "main",
       "epic": 1,
       "subject": "Rework #1: tweak",
       "description": "",
       "status": "pending",
       "created": 1791900004,
       "updated": 1791900004
      }
     ]
    }
   },
   {
    "now": 1791900005,
    "session": "s1",
    "agent": "main",
    "tool": "task_list",
    "args": {},
    "before": "{\n \"version\": 2,\n \"next_id\": 3,\n \"next_epic\": 3,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"Shipped\",\n   \"created\": 1791900000,\n   \"touched\": 1791900004\n  },\n  {\n   \"id\": 2,\n   \"agent\": \"main\",\n   \"title\": \"Next thing\",\n   \"created\": 1791900003,\n   \"touched\": 1791900003\n  }\n ],\n \"active\": {\n  \"main\": 2\n },\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Build it\",\n   \"description\": \"\",\n   \"status\": \"completed\",\n   \"created\": 1791900001,\n   \"updated\": 1791900002\n  },\n  {\n   \"id\": \"2\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Rework #1: tweak\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900004,\n   \"updated\": 1791900004\n  }\n ]\n}",
    "error": false,
    "text": "Epic #2: Next thing (active, 0/0)\nNo tasks yet.\nOther open epics:\n#1 Shipped 1/2",
    "after": {
     "version": 2,
     "next_id": 3,
     "next_epic": 3,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Shipped",
       "created": 1791900000,
       "touched": 1791900004
      },
      {
       "id": 2,
       "agent": "main",
       "title": "Next thing",
       "created": 1791900003,
       "touched": 1791900003
      }
     ],
     "active": {
      "main": 2
     },
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 1,
       "subject": "Build it",
       "description": "",
       "status": "completed",
       "created": 1791900001,
       "updated": 1791900002
      },
      {
       "id": "2",
       "agent": "main",
       "epic": 1,
       "subject": "Rework #1: tweak",
       "description": "",
       "status": "pending",
       "created": 1791900004,
       "updated": 1791900004
      }
     ]
    }
   }
  ]
 },
 {
  "name": "epic_title_cap",
  "steps": [
   {
    "now": 1791900000,
    "session": "s1",
    "agent": "main",
    "tool": "task_epic",
    "args": {
     "title": "xxxxxxxxxxxxxxxxxxxxx"
    },
    "before": null,
    "error": true,
    "text": "title is 21 characters, the limit is 20: it is the label of a pill on the status line. Use a short noun phrase (\"SDK status-line\", \"api-gateway\").",
    "after": null
   },
   {
    "now": 1791900001,
    "session": "s1",
    "agent": "main",
    "tool": "task_epic",
    "args": {
     "title": "xxxxxxxxxxxxxxxxxxxx"
    },
    "before": null,
    "error": false,
    "text": "Epic #1 xxxxxxxxxxxxxxxxxxxx opened and active: file its tasks with task_create(epic=1).",
    "after": {
     "version": 2,
     "next_id": 1,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "xxxxxxxxxxxxxxxxxxxx",
       "created": 1791900001,
       "touched": 1791900001
      }
     ],
     "active": {
      "main": 1
     },
     "tasks": []
    }
   },
   {
    "now": 1791900002,
    "session": "s1",
    "agent": "main",
    "tool": "task_epic",
    "args": {
     "title": "   "
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 1,\n \"next_epic\": 2,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"xxxxxxxxxxxxxxxxxxxx\",\n   \"created\": 1791900001,\n   \"touched\": 1791900001\n  }\n ],\n \"active\": {\n  \"main\": 1\n },\n \"tasks\": []\n}",
    "error": true,
    "text": "title is required",
    "after": {
     "version": 2,
     "next_id": 1,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "xxxxxxxxxxxxxxxxxxxx",
       "created": 1791900001,
       "touched": 1791900001
      }
     ],
     "active": {
      "main": 1
     },
     "tasks": []
    }
   }
  ]
 },
 {
  "name": "same_title_focuses_the_open_epic",
  "steps": [
   {
    "now": 1791900000,
    "session": "s1",
    "agent": "main",
    "tool": "task_epic",
    "args": {
     "title": "Alpha"
    },
    "before": null,
    "error": false,
    "text": "Epic #1 Alpha opened and active: file its tasks with task_create(epic=1).",
    "after": {
     "version": 2,
     "next_id": 1,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Alpha",
       "created": 1791900000,
       "touched": 1791900000
      }
     ],
     "active": {
      "main": 1
     },
     "tasks": []
    }
   },
   {
    "now": 1791900001,
    "session": "s1",
    "agent": "main",
    "tool": "task_create",
    "args": {
     "subject": "Work",
     "epic": 1
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 1,\n \"next_epic\": 2,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"Alpha\",\n   \"created\": 1791900000,\n   \"touched\": 1791900000\n  }\n ],\n \"active\": {\n  \"main\": 1\n },\n \"tasks\": []\n}",
    "error": false,
    "text": "Task #1 created: Work in epic #1 Alpha",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Alpha",
       "created": 1791900000,
       "touched": 1791900001
      }
     ],
     "active": {
      "main": 1
     },
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 1,
       "subject": "Work",
       "description": "",
       "status": "pending",
       "created": 1791900001,
       "updated": 1791900001
      }
     ]
    }
   },
   {
    "now": 1791900002,
    "session": "s1",
    "agent": "main",
    "tool": "task_epic",
    "args": {
     "title": "Beta"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 2,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"Alpha\",\n   \"created\": 1791900000,\n   \"touched\": 1791900001\n  }\n ],\n \"active\": {\n  \"main\": 1\n },\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Work\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900001,\n   \"updated\": 1791900001\n  }\n ]\n}",
    "error": false,
    "text": "Epic #2 Beta opened and active: file its tasks with task_create(epic=2). Still open: #1 Alpha.",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 3,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Alpha",
       "created": 1791900000,
       "touched": 1791900001
      },
      {
       "id": 2,
       "agent": "main",
       "title": "Beta",
       "created": 1791900002,
       "touched": 1791900002
      }
     ],
     "active": {
      "main": 2
     },
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 1,
       "subject": "Work",
       "description": "",
       "status": "pending",
       "created": 1791900001,
       "updated": 1791900001
      }
     ]
    }
   },
   {
    "now": 1791900003,
    "session": "s1",
    "agent": "main",
    "tool": "task_epic",
    "args": {
     "title": "Alpha"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 3,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"Alpha\",\n   \"created\": 1791900000,\n   \"touched\": 1791900001\n  },\n  {\n   \"id\": 2,\n   \"agent\": \"main\",\n   \"title\": \"Beta\",\n   \"created\": 1791900002,\n   \"touched\": 1791900002\n  }\n ],\n \"active\": {\n  \"main\": 2\n },\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Work\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900001,\n   \"updated\": 1791900001\n  }\n ]\n}",
    "error": false,
    "text": "Epic #1 Alpha is already open (0/1): focused it instead of opening a duplicate.",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 3,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Alpha",
       "created": 1791900000,
       "touched": 1791900003
      },
      {
       "id": 2,
       "agent": "main",
       "title": "Beta",
       "created": 1791900002,
       "touched": 1791900002
      }
     ],
     "active": {
      "main": 1
     },
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 1,
       "subject": "Work",
       "description": "",
       "status": "pending",
       "created": 1791900001,
       "updated": 1791900001
      }
     ]
    }
   },
   {
    "now": 1791900004,
    "session": "s1",
    "agent": "main",
    "tool": "task_update",
    "args": {
     "id": "1",
     "status": "completed"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 3,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"Alpha\",\n   \"created\": 1791900000,\n   \"touched\": 1791900003\n  },\n  {\n   \"id\": 2,\n   \"agent\": \"main\",\n   \"title\": \"Beta\",\n   \"created\": 1791900002,\n   \"touched\": 1791900002\n  }\n ],\n \"active\": {\n  \"main\": 1\n },\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Work\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900001,\n   \"updated\": 1791900001\n  }\n ]\n}",
    "error": false,
    "text": "Task #1 updated: Work (completed)",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 3,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Alpha",
       "created": 1791900000,
       "touched": 1791900004
      },
      {
       "id": 2,
       "agent": "main",
       "title": "Beta",
       "created": 1791900002,
       "touched": 1791900002
      }
     ],
     "active": {
      "main": 1
     },
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 1,
       "subject": "Work",
       "description": "",
       "status": "completed",
       "created": 1791900001,
       "updated": 1791900004
      }
     ]
    }
   },
   {
    "now": 1791900005,
    "session": "s1",
    "agent": "main",
    "tool": "task_epic",
    "args": {
     "title": "Beta"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 3,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"Alpha\",\n   \"created\": 1791900000,\n   \"touched\": 1791900004\n  },\n  {\n   \"id\": 2,\n   \"agent\": \"main\",\n   \"title\": \"Beta\",\n   \"created\": 1791900002,\n   \"touched\": 1791900002\n  }\n ],\n \"active\": {\n  \"main\": 1\n },\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Work\",\n   \"description\": \"\",\n   \"status\": \"completed\",\n   \"created\": 1791900001,\n   \"updated\": 1791900004\n  }\n ]\n}",
    "error": false,
    "text": "Epic #3 Beta opened and active: file its tasks with task_create(epic=3).",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 4,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Alpha",
       "created": 1791900000,
       "touched": 1791900004
      },
      {
       "id": 2,
       "agent": "main",
       "title": "Beta",
       "created": 1791900002,
       "touched": 1791900002
      },
      {
       "id": 3,
       "agent": "main",
       "title": "Beta",
       "created": 1791900005,
       "touched": 1791900005
      }
     ],
     "active": {
      "main": 3
     },
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 1,
       "subject": "Work",
       "description": "",
       "status": "completed",
       "created": 1791900001,
       "updated": 1791900004
      }
     ]
    }
   },
   {
    "now": 1791900006,
    "session": "s1",
    "agent": "main",
    "tool": "task_epic",
    "args": {
     "title": "Alpha"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 4,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"Alpha\",\n   \"created\": 1791900000,\n   \"touched\": 1791900004\n  },\n  {\n   \"id\": 2,\n   \"agent\": \"main\",\n   \"title\": \"Beta\",\n   \"created\": 1791900002,\n   \"touched\": 1791900002\n  },\n  {\n   \"id\": 3,\n   \"agent\": \"main\",\n   \"title\": \"Beta\",\n   \"created\": 1791900005,\n   \"touched\": 1791900005\n  }\n ],\n \"active\": {\n  \"main\": 3\n },\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Work\",\n   \"description\": \"\",\n   \"status\": \"completed\",\n   \"created\": 1791900001,\n   \"updated\": 1791900004\n  }\n ]\n}",
    "error": false,
    "text": "Epic #4 Alpha opened and active: file its tasks with task_create(epic=4).",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 5,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Alpha",
       "created": 1791900000,
       "touched": 1791900004
      },
      {
       "id": 2,
       "agent": "main",
       "title": "Beta",
       "created": 1791900002,
       "touched": 1791900002
      },
      {
       "id": 3,
       "agent": "main",
       "title": "Beta",
       "created": 1791900005,
       "touched": 1791900005
      },
      {
       "id": 4,
       "agent": "main",
       "title": "Alpha",
       "created": 1791900006,
       "touched": 1791900006
      }
     ],
     "active": {
      "main": 4
     },
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 1,
       "subject": "Work",
       "description": "",
       "status": "completed",
       "created": 1791900001,
       "updated": 1791900004
      }
     ]
    }
   }
  ]
 },
 {
  "name": "v1_file_is_migrated",
  "steps": [
   {
    "file": "{\"version\": 1, \"next_id\": 3, \"next_epic\": 2, \"epics\": {\"main\": {\"id\": 1, \"title\": \"Old subject\"}, \"a1\": {\"id\": 5, \"title\": \"Sub\"}}, \"tasks\": [{\"id\": \"1\", \"agent\": \"main\", \"subject\": \"Before epics\", \"status\": \"pending\"}, {\"id\": \"2\", \"agent\": \"main\", \"epic\": 1, \"subject\": \"In epic\", \"status\": \"pending\"}]}"
   },
   {
    "now": 1791900000,
    "session": "s1",
    "agent": "main",
    "tool": "task_list",
    "args": {},
    "before": "{\"version\": 1, \"next_id\": 3, \"next_epic\": 2, \"epics\": {\"main\": {\"id\": 1, \"title\": \"Old subject\"}, \"a1\": {\"id\": 5, \"title\": \"Sub\"}}, \"tasks\": [{\"id\": \"1\", \"agent\": \"main\", \"subject\": \"Before epics\", \"status\": \"pending\"}, {\"id\": \"2\", \"agent\": \"main\", \"epic\": 1, \"subject\": \"In epic\", \"status\": \"pending\"}]}",
    "error": false,
    "text": "Epic #1: Old subject (active, 0/1)\n#2 [pending] In epic\nTasks with no epic:\n#1 [pending] Before epics",
    "after": {
     "version": 1,
     "next_id": 3,
     "next_epic": 2,
     "epics": {
      "main": {
       "id": 1,
       "title": "Old subject"
      },
      "a1": {
       "id": 5,
       "title": "Sub"
      }
     },
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "subject": "Before epics",
       "status": "pending"
      },
      {
       "id": "2",
       "agent": "main",
       "epic": 1,
       "subject": "In epic",
       "status": "pending"
      }
     ]
    }
   },
   {
    "now": 1791900001,
    "session": "s1",
    "agent": "main",
    "tool": "task_create",
    "args": {
     "subject": "After",
     "epic": 1
    },
    "before": "{\"version\": 1, \"next_id\": 3, \"next_epic\": 2, \"epics\": {\"main\": {\"id\": 1, \"title\": \"Old subject\"}, \"a1\": {\"id\": 5, \"title\": \"Sub\"}}, \"tasks\": [{\"id\": \"1\", \"agent\": \"main\", \"subject\": \"Before epics\", \"status\": \"pending\"}, {\"id\": \"2\", \"agent\": \"main\", \"epic\": 1, \"subject\": \"In epic\", \"status\": \"pending\"}]}",
    "error": false,
    "text": "Task #3 created: After in epic #1 Old subject",
    "after": {
     "version": 2,
     "next_id": 4,
     "next_epic": 6,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Old subject",
       "created": 1791900001,
       "touched": 1791900001
      },
      {
       "id": 5,
       "agent": "a1",
       "title": "Sub",
       "created": 1791900001,
       "touched": 1791900001
      }
     ],
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "subject": "Before epics",
       "status": "pending",
       "epic": 0
      },
      {
       "id": "2",
       "agent": "main",
       "epic": 1,
       "subject": "In epic",
       "status": "pending"
      },
      {
       "id": "3",
       "agent": "main",
       "epic": 1,
       "subject": "After",
       "description": "",
       "status": "pending",
       "created": 1791900001,
       "updated": 1791900001
      }
     ],
     "active": {
      "main": 1,
      "a1": 5
     }
    }
   }
  ]
 },
 {
  "name": "touched_follows_activity",
  "steps": [
   {
    "now": 1791900000,
    "session": "s1",
    "agent": "main",
    "tool": "task_epic",
    "args": {
     "title": "A"
    },
    "before": null,
    "error": false,
    "text": "Epic #1 A opened and active: file its tasks with task_create(epic=1).",
    "after": {
     "version": 2,
     "next_id": 1,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "A",
       "created": 1791900000,
       "touched": 1791900000
      }
     ],
     "active": {
      "main": 1
     },
     "tasks": []
    }
   },
   {
    "now": 1791900001,
    "session": "s1",
    "agent": "main",
    "tool": "task_create",
    "args": {
     "subject": "Work",
     "epic": 1
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 1,\n \"next_epic\": 2,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"A\",\n   \"created\": 1791900000,\n   \"touched\": 1791900000\n  }\n ],\n \"active\": {\n  \"main\": 1\n },\n \"tasks\": []\n}",
    "error": false,
    "text": "Task #1 created: Work in epic #1 A",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "A",
       "created": 1791900000,
       "touched": 1791900001
      }
     ],
     "active": {
      "main": 1
     },
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 1,
       "subject": "Work",
       "description": "",
       "status": "pending",
       "created": 1791900001,
       "updated": 1791900001
      }
     ]
    }
   },
   {
    "file": "{\"version\": 2, \"next_id\": 2, \"next_epic\": 2, \"epics\": [{\"id\": 1, \"agent\": \"main\", \"title\": \"A\", \"created\": 1791900000, \"touched\": 1}], \"active\": {\"main\": 1}, \"tasks\": [{\"id\": \"1\", \"agent\": \"main\", \"epic\": 1, \"subject\": \"Work\", \"description\": \"\", \"status\": \"pending\", \"created\": 1791900001, \"updated\": 1791900001}]}"
   },
   {
    "now": 1791900002,
    "session": "s1",
    "agent": "main",
    "tool": "task_update",
    "args": {
     "id": "1",
     "status": "in_progress"
    },
    "before": "{\"version\": 2, \"next_id\": 2, \"next_epic\": 2, \"epics\": [{\"id\": 1, \"agent\": \"main\", \"title\": \"A\", \"created\": 1791900000, \"touched\": 1}], \"active\": {\"main\": 1}, \"tasks\": [{\"id\": \"1\", \"agent\": \"main\", \"epic\": 1, \"subject\": \"Work\", \"description\": \"\", \"status\": \"pending\", \"created\": 1791900001, \"updated\": 1791900001}]}",
    "error": false,
    "text": "Task #1 updated: Work (in_progress)",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "A",
       "created": 1791900000,
       "touched": 1791900002
      }
     ],
     "active": {
      "main": 1
     },
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 1,
       "subject": "Work",
       "description": "",
       "status": "in_progress",
       "created": 1791900001,
       "updated": 1791900002
      }
     ]
    }
   },
   {
    "file": "{\"version\": 2, \"next_id\": 2, \"next_epic\": 2, \"epics\": [{\"id\": 1, \"agent\": \"main\", \"title\": \"A\", \"created\": 1791900000, \"touched\": 1}], \"active\": {\"main\": 1}, \"tasks\": [{\"id\": \"1\", \"agent\": \"main\", \"epic\": 1, \"subject\": \"Work\", \"description\": \"\", \"status\": \"in_progress\", \"created\": 1791900001, \"updated\": 1791900002}]}"
   },
   {
    "now": 1791900003,
    "session": "s1",
    "agent": "main",
    "tool": "task_create",
    "args": {
     "subject": "More",
     "epic": 1
    },
    "before": "{\"version\": 2, \"next_id\": 2, \"next_epic\": 2, \"epics\": [{\"id\": 1, \"agent\": \"main\", \"title\": \"A\", \"created\": 1791900000, \"touched\": 1}], \"active\": {\"main\": 1}, \"tasks\": [{\"id\": \"1\", \"agent\": \"main\", \"epic\": 1, \"subject\": \"Work\", \"description\": \"\", \"status\": \"in_progress\", \"created\": 1791900001, \"updated\": 1791900002}]}",
    "error": false,
    "text": "Task #2 created: More in epic #1 A",
    "after": {
     "version": 2,
     "next_id": 3,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "A",
       "created": 1791900000,
       "touched": 1791900003
      }
     ],
     "active": {
      "main": 1
     },
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 1,
       "subject": "Work",
       "description": "",
       "status": "in_progress",
       "created": 1791900001,
       "updated": 1791900002
      },
      {
       "id": "2",
       "agent": "main",
       "epic": 1,
       "subject": "More",
       "description": "",
       "status": "pending",
       "created": 1791900003,
       "updated": 1791900003
      }
     ]
    }
   }
  ]
 },
 {
  "name": "malformed_file_is_recovered",
  "steps": [
   {
    "file": "{\"epics\": 3, \"active\": [], \"tasks\": \"x\""
   },
   {
    "now": 1791900000,
    "session": "s1",
    "agent": "main",
    "tool": "task_create",
    "args": {
     "subject": "Fresh",
     "epic": 0
    },
    "before": "{\"epics\": 3, \"active\": [], \"tasks\": \"x\"",
    "error": false,
    "text": "Task #1 created: Fresh",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "Fresh",
       "description": "",
       "status": "pending",
       "created": 1791900000,
       "updated": 1791900000
      }
     ]
    }
   }
  ]
 },
 {
  "name": "foreign_shapes_are_normalised",
  "steps": [
   {
    "file": "{\"next_id\": \"7\", \"next_epic\": 1, \"epics\": [{\"id\": 4, \"agent\": \"main\", \"title\": \"Kept\", \"touched\": 3}, {\"id\": \"x\", \"title\": \"Dropped\"}, \"junk\"], \"active\": {\"main\": 4}, \"tasks\": [{\"id\": 12, \"subject\": \"Numeric id\", \"epic\": \"4\"}, {\"subject\": \"No id\"}, 7, {\"id\": \"3\", \"agent\": \"a1\", \"status\": \"waiting\", \"epic\": 4}]}"
   },
   {
    "now": 1791900000,
    "session": "s1",
    "agent": "main",
    "tool": "task_list",
    "args": {},
    "before": "{\"next_id\": \"7\", \"next_epic\": 1, \"epics\": [{\"id\": 4, \"agent\": \"main\", \"title\": \"Kept\", \"touched\": 3}, {\"id\": \"x\", \"title\": \"Dropped\"}, \"junk\"], \"active\": {\"main\": 4}, \"tasks\": [{\"id\": 12, \"subject\": \"Numeric id\", \"epic\": \"4\"}, {\"subject\": \"No id\"}, 7, {\"id\": \"3\", \"agent\": \"a1\", \"status\": \"waiting\", \"epic\": 4}]}",
    "error": false,
    "text": "Epic #4: Kept (active, 0/0)\nNo tasks yet.\nTasks with no epic:\n#12 [pending] Numeric id",
    "after": {
     "next_id": "7",
     "next_epic": 1,
     "epics": [
      {
       "id": 4,
       "agent": "main",
       "title": "Kept",
       "touched": 3
      },
      {
       "id": "x",
       "title": "Dropped"
      },
      "junk"
     ],
     "active": {
      "main": 4
     },
     "tasks": [
      {
       "id": 12,
       "subject": "Numeric id",
       "epic": "4"
      },
      {
       "subject": "No id"
      },
      7,
      {
       "id": "3",
       "agent": "a1",
       "status": "waiting",
       "epic": 4
      }
     ]
    }
   },
   {
    "now": 1791900001,
    "session": "s1",
    "agent": "a1",
    "tool": "task_list",
    "args": {},
    "before": "{\"next_id\": \"7\", \"next_epic\": 1, \"epics\": [{\"id\": 4, \"agent\": \"main\", \"title\": \"Kept\", \"touched\": 3}, {\"id\": \"x\", \"title\": \"Dropped\"}, \"junk\"], \"active\": {\"main\": 4}, \"tasks\": [{\"id\": 12, \"subject\": \"Numeric id\", \"epic\": \"4\"}, {\"subject\": \"No id\"}, 7, {\"id\": \"3\", \"agent\": \"a1\", \"status\": \"waiting\", \"epic\": 4}]}",
    "error": false,
    "text": "No tasks and no epic.",
    "after": {
     "next_id": "7",
     "next_epic": 1,
     "epics": [
      {
       "id": 4,
       "agent": "main",
       "title": "Kept",
       "touched": 3
      },
      {
       "id": "x",
       "title": "Dropped"
      },
      "junk"
     ],
     "active": {
      "main": 4
     },
     "tasks": [
      {
       "id": 12,
       "subject": "Numeric id",
       "epic": "4"
      },
      {
       "subject": "No id"
      },
      7,
      {
       "id": "3",
       "agent": "a1",
       "status": "waiting",
       "epic": 4
      }
     ]
    }
   },
   {
    "now": 1791900002,
    "session": "s1",
    "agent": "main",
    "tool": "task_create",
    "args": {
     "subject": "Fresh",
     "epic": 4
    },
    "before": "{\"next_id\": \"7\", \"next_epic\": 1, \"epics\": [{\"id\": 4, \"agent\": \"main\", \"title\": \"Kept\", \"touched\": 3}, {\"id\": \"x\", \"title\": \"Dropped\"}, \"junk\"], \"active\": {\"main\": 4}, \"tasks\": [{\"id\": 12, \"subject\": \"Numeric id\", \"epic\": \"4\"}, {\"subject\": \"No id\"}, 7, {\"id\": \"3\", \"agent\": \"a1\", \"status\": \"waiting\", \"epic\": 4}]}",
    "error": false,
    "text": "Task #1 created: Fresh in epic #4 Kept",
    "after": {
     "next_id": 2,
     "next_epic": 5,
     "epics": [
      {
       "id": 4,
       "agent": "main",
       "title": "Kept",
       "touched": 1791900002
      }
     ],
     "active": {
      "main": 4
     },
     "tasks": [
      {
       "id": "12",
       "subject": "Numeric id",
       "epic": 0,
       "agent": "main",
       "status": "pending"
      },
      {
       "id": "3",
       "agent": "a1",
       "status": "waiting",
       "epic": 4,
       "subject": ""
      },
      {
       "id": "1",
       "agent": "main",
       "epic": 4,
       "subject": "Fresh",
       "description": "",
       "status": "pending",
       "created": 1791900002,
       "updated": 1791900002
      }
     ],
     "version": 2
    }
   }
  ]
 },
 {
  "name": "epics_are_per_agent",
  "steps": [
   {
    "now": 1791900000,
    "session": "s1",
    "agent": "main",
    "tool": "task_epic",
    "args": {
     "title": "Main subject"
    },
    "before": null,
    "error": false,
    "text": "Epic #1 Main subject opened and active: file its tasks with task_create(epic=1).",
    "after": {
     "version": 2,
     "next_id": 1,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Main subject",
       "created": 1791900000,
       "touched": 1791900000
      }
     ],
     "active": {
      "main": 1
     },
     "tasks": []
    }
   },
   {
    "now": 1791900001,
    "session": "s1",
    "agent": "a1",
    "tool": "task_create",
    "args": {
     "subject": "Sub work",
     "epic": 1
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 1,\n \"next_epic\": 2,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"Main subject\",\n   \"created\": 1791900000,\n   \"touched\": 1791900000\n  }\n ],\n \"active\": {\n  \"main\": 1\n },\n \"tasks\": []\n}",
    "error": true,
    "text": "no epic 1 for this agent; no epic is open. task_create(subject, epic=<id>) files the task in one of your epics; epic=0 files it outside any epic; task_epic(title) opens a new epic first.",
    "after": {
     "version": 2,
     "next_id": 1,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Main subject",
       "created": 1791900000,
       "touched": 1791900000
      }
     ],
     "active": {
      "main": 1
     },
     "tasks": []
    }
   },
   {
    "now": 1791900002,
    "session": "s1",
    "agent": "a1",
    "tool": "task_create",
    "args": {
     "subject": "Sub work",
     "epic": 0
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 1,\n \"next_epic\": 2,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"Main subject\",\n   \"created\": 1791900000,\n   \"touched\": 1791900000\n  }\n ],\n \"active\": {\n  \"main\": 1\n },\n \"tasks\": []\n}",
    "error": false,
    "text": "Task #1 created: Sub work",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Main subject",
       "created": 1791900000,
       "touched": 1791900000
      }
     ],
     "active": {
      "main": 1
     },
     "tasks": [
      {
       "id": "1",
       "agent": "a1",
       "epic": 0,
       "subject": "Sub work",
       "description": "",
       "status": "pending",
       "created": 1791900002,
       "updated": 1791900002
      }
     ]
    }
   }
  ]
 },
 {
  "name": "one_task_in_progress_per_worker",
  "steps": [
   {
    "now": 1791900000,
    "session": "s1",
    "agent": "main",
    "tool": "task_create",
    "args": {
     "subject": "First",
     "epic": 0
    },
    "before": null,
    "error": false,
    "text": "Task #1 created: First",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "First",
       "description": "",
       "status": "pending",
       "created": 1791900000,
       "updated": 1791900000
      }
     ]
    }
   },
   {
    "now": 1791900001,
    "session": "s1",
    "agent": "main",
    "tool": "task_create",
    "args": {
     "subject": "Second",
     "epic": 0
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 1,\n \"epics\": [],\n \"active\": {},\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"First\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900000,\n   \"updated\": 1791900000\n  }\n ]\n}",
    "error": false,
    "text": "Task #2 created: Second",
    "after": {
     "version": 2,
     "next_id": 3,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "First",
       "description": "",
       "status": "pending",
       "created": 1791900000,
       "updated": 1791900000
      },
      {
       "id": "2",
       "agent": "main",
       "epic": 0,
       "subject": "Second",
       "description": "",
       "status": "pending",
       "created": 1791900001,
       "updated": 1791900001
      }
     ]
    }
   },
   {
    "now": 1791900002,
    "session": "s1",
    "agent": "main",
    "tool": "task_create",
    "args": {
     "subject": "Third",
     "epic": 0
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 3,\n \"next_epic\": 1,\n \"epics\": [],\n \"active\": {},\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"First\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900000,\n   \"updated\": 1791900000\n  },\n  {\n   \"id\": \"2\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Second\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900001,\n   \"updated\": 1791900001\n  }\n ]\n}",
    "error": false,
    "text": "Task #3 created: Third",
    "after": {
     "version": 2,
     "next_id": 4,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "First",
       "description": "",
       "status": "pending",
       "created": 1791900000,
       "updated": 1791900000
      },
      {
       "id": "2",
       "agent": "main",
       "epic": 0,
       "subject": "Second",
       "description": "",
       "status": "pending",
       "created": 1791900001,
       "updated": 1791900001
      },
      {
       "id": "3",
       "agent": "main",
       "epic": 0,
       "subject": "Third",
       "description": "",
       "status": "pending",
       "created": 1791900002,
       "updated": 1791900002
      }
     ]
    }
   },
   {
    "now": 1791900003,
    "session": "s1",
    "agent": "main",
    "tool": "task_update",
    "args": {
     "id": "1",
     "status": "in_progress"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 4,\n \"next_epic\": 1,\n \"epics\": [],\n \"active\": {},\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"First\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900000,\n   \"updated\": 1791900000\n  },\n  {\n   \"id\": \"2\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Second\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900001,\n   \"updated\": 1791900001\n  },\n  {\n   \"id\": \"3\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Third\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900002,\n   \"updated\": 1791900002\n  }\n ]\n}",
    "error": false,
    "text": "Task #1 updated: First (in_progress)",
    "after": {
     "version": 2,
     "next_id": 4,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "First",
       "description": "",
       "status": "in_progress",
       "created": 1791900000,
       "updated": 1791900003
      },
      {
       "id": "2",
       "agent": "main",
       "epic": 0,
       "subject": "Second",
       "description": "",
       "status": "pending",
       "created": 1791900001,
       "updated": 1791900001
      },
      {
       "id": "3",
       "agent": "main",
       "epic": 0,
       "subject": "Third",
       "description": "",
       "status": "pending",
       "created": 1791900002,
       "updated": 1791900002
      }
     ]
    }
   },
   {
    "now": 1791900004,
    "session": "s1",
    "agent": "main",
    "tool": "task_update",
    "args": {
     "id": "2",
     "status": "in_progress"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 4,\n \"next_epic\": 1,\n \"epics\": [],\n \"active\": {},\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"First\",\n   \"description\": \"\",\n   \"status\": \"in_progress\",\n   \"created\": 1791900000,\n   \"updated\": 1791900003\n  },\n  {\n   \"id\": \"2\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Second\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900001,\n   \"updated\": 1791900001\n  },\n  {\n   \"id\": \"3\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Third\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900002,\n   \"updated\": 1791900002\n  }\n ]\n}",
    "error": true,
    "text": "cannot start #2: 1 task(s) already in progress (#1 First) for 1 worker(s), you.\nRunning subagents: none\n#1 First: no worker linked\nOne task per worker: complete a task nobody is on, or set it to pending or waiting; to hand this one to a running subagent, pass worker=<its type or id> with status=in_progress (refused if that subagent is stopped or already holds a task).",
    "after": {
     "version": 2,
     "next_id": 4,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "First",
       "description": "",
       "status": "in_progress",
       "created": 1791900000,
       "updated": 1791900003
      },
      {
       "id": "2",
       "agent": "main",
       "epic": 0,
       "subject": "Second",
       "description": "",
       "status": "pending",
       "created": 1791900001,
       "updated": 1791900001
      },
      {
       "id": "3",
       "agent": "main",
       "epic": 0,
       "subject": "Third",
       "description": "",
       "status": "pending",
       "created": 1791900002,
       "updated": 1791900002
      }
     ]
    }
   },
   {
    "agents": [
     {
      "id": "a0",
      "type": "Explore",
      "alive": true,
      "started": 1791900005
     }
    ]
   },
   {
    "now": 1791900005,
    "session": "s1",
    "agent": "main",
    "tool": "task_update",
    "args": {
     "id": "2",
     "status": "in_progress"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 4,\n \"next_epic\": 1,\n \"epics\": [],\n \"active\": {},\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"First\",\n   \"description\": \"\",\n   \"status\": \"in_progress\",\n   \"created\": 1791900000,\n   \"updated\": 1791900003\n  },\n  {\n   \"id\": \"2\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Second\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900001,\n   \"updated\": 1791900001\n  },\n  {\n   \"id\": \"3\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Third\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900002,\n   \"updated\": 1791900002\n  }\n ]\n}",
    "error": false,
    "text": "Task #2 updated: Second (in_progress)",
    "after": {
     "version": 2,
     "next_id": 4,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "First",
       "description": "",
       "status": "in_progress",
       "created": 1791900000,
       "updated": 1791900003
      },
      {
       "id": "2",
       "agent": "main",
       "epic": 0,
       "subject": "Second",
       "description": "",
       "status": "in_progress",
       "created": 1791900001,
       "updated": 1791900005
      },
      {
       "id": "3",
       "agent": "main",
       "epic": 0,
       "subject": "Third",
       "description": "",
       "status": "pending",
       "created": 1791900002,
       "updated": 1791900002
      }
     ]
    }
   },
   {
    "now": 1791900006,
    "session": "s1",
    "agent": "main",
    "tool": "task_update",
    "args": {
     "id": "3",
     "status": "in_progress"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 4,\n \"next_epic\": 1,\n \"epics\": [],\n \"active\": {},\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"First\",\n   \"description\": \"\",\n   \"status\": \"in_progress\",\n   \"created\": 1791900000,\n   \"updated\": 1791900003\n  },\n  {\n   \"id\": \"2\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Second\",\n   \"description\": \"\",\n   \"status\": \"in_progress\",\n   \"created\": 1791900001,\n   \"updated\": 1791900005\n  },\n  {\n   \"id\": \"3\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Third\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900002,\n   \"updated\": 1791900002\n  }\n ]\n}",
    "error": true,
    "text": "cannot start #3: 2 task(s) already in progress (#1 First, #2 Second) for 2 worker(s), you and 1 running subagent(s).\nRunning subagents: Explore (id a0, for 0 min)\n#1 First: no worker linked\n#2 Second: no worker linked\nOne task per worker: complete a task nobody is on, or set it to pending or waiting; to hand this one to a running subagent, pass worker=<its type or id> with status=in_progress (refused if that subagent is stopped or already holds a task).",
    "after": {
     "version": 2,
     "next_id": 4,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "First",
       "description": "",
       "status": "in_progress",
       "created": 1791900000,
       "updated": 1791900003
      },
      {
       "id": "2",
       "agent": "main",
       "epic": 0,
       "subject": "Second",
       "description": "",
       "status": "in_progress",
       "created": 1791900001,
       "updated": 1791900005
      },
      {
       "id": "3",
       "agent": "main",
       "epic": 0,
       "subject": "Third",
       "description": "",
       "status": "pending",
       "created": 1791900002,
       "updated": 1791900002
      }
     ]
    }
   },
   {
    "now": 1791900007,
    "session": "s1",
    "agent": "main",
    "tool": "task_update",
    "args": {
     "id": "1",
     "status": "in_progress"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 4,\n \"next_epic\": 1,\n \"epics\": [],\n \"active\": {},\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"First\",\n   \"description\": \"\",\n   \"status\": \"in_progress\",\n   \"created\": 1791900000,\n   \"updated\": 1791900003\n  },\n  {\n   \"id\": \"2\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Second\",\n   \"description\": \"\",\n   \"status\": \"in_progress\",\n   \"created\": 1791900001,\n   \"updated\": 1791900005\n  },\n  {\n   \"id\": \"3\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Third\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900002,\n   \"updated\": 1791900002\n  }\n ]\n}",
    "error": false,
    "text": "Task #1 updated: First (in_progress)",
    "after": {
     "version": 2,
     "next_id": 4,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "First",
       "description": "",
       "status": "in_progress",
       "created": 1791900000,
       "updated": 1791900007
      },
      {
       "id": "2",
       "agent": "main",
       "epic": 0,
       "subject": "Second",
       "description": "",
       "status": "in_progress",
       "created": 1791900001,
       "updated": 1791900005
      },
      {
       "id": "3",
       "agent": "main",
       "epic": 0,
       "subject": "Third",
       "description": "",
       "status": "pending",
       "created": 1791900002,
       "updated": 1791900002
      }
     ]
    }
   }
  ]
 },
 {
  "name": "a_subagent_has_one_task_in_progress",
  "steps": [
   {
    "agents": [
     {
      "id": "a0",
      "type": "Explore",
      "alive": true,
      "started": 1791900000
     },
     {
      "id": "a1",
      "type": "Explore",
      "alive": true,
      "started": 1791900000
     },
     {
      "id": "a2",
      "type": "Explore",
      "alive": true,
      "started": 1791900000
     }
    ]
   },
   {
    "now": 1791900000,
    "session": "s1",
    "agent": "a1",
    "tool": "task_create",
    "args": {
     "subject": "Sub one",
     "epic": 0
    },
    "before": null,
    "error": false,
    "text": "Task #1 created: Sub one",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "a1",
       "epic": 0,
       "subject": "Sub one",
       "description": "",
       "status": "pending",
       "created": 1791900000,
       "updated": 1791900000
      }
     ]
    }
   },
   {
    "now": 1791900001,
    "session": "s1",
    "agent": "a1",
    "tool": "task_create",
    "args": {
     "subject": "Sub two",
     "epic": 0
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 1,\n \"epics\": [],\n \"active\": {},\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"a1\",\n   \"epic\": 0,\n   \"subject\": \"Sub one\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900000,\n   \"updated\": 1791900000\n  }\n ]\n}",
    "error": false,
    "text": "Task #2 created: Sub two",
    "after": {
     "version": 2,
     "next_id": 3,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "a1",
       "epic": 0,
       "subject": "Sub one",
       "description": "",
       "status": "pending",
       "created": 1791900000,
       "updated": 1791900000
      },
      {
       "id": "2",
       "agent": "a1",
       "epic": 0,
       "subject": "Sub two",
       "description": "",
       "status": "pending",
       "created": 1791900001,
       "updated": 1791900001
      }
     ]
    }
   },
   {
    "now": 1791900002,
    "session": "s1",
    "agent": "a1",
    "tool": "task_update",
    "args": {
     "id": "1",
     "status": "in_progress"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 3,\n \"next_epic\": 1,\n \"epics\": [],\n \"active\": {},\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"a1\",\n   \"epic\": 0,\n   \"subject\": \"Sub one\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900000,\n   \"updated\": 1791900000\n  },\n  {\n   \"id\": \"2\",\n   \"agent\": \"a1\",\n   \"epic\": 0,\n   \"subject\": \"Sub two\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900001,\n   \"updated\": 1791900001\n  }\n ]\n}",
    "error": false,
    "text": "Task #1 updated: Sub one (in_progress)",
    "after": {
     "version": 2,
     "next_id": 3,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "a1",
       "epic": 0,
       "subject": "Sub one",
       "description": "",
       "status": "in_progress",
       "created": 1791900000,
       "updated": 1791900002
      },
      {
       "id": "2",
       "agent": "a1",
       "epic": 0,
       "subject": "Sub two",
       "description": "",
       "status": "pending",
       "created": 1791900001,
       "updated": 1791900001
      }
     ]
    }
   },
   {
    "now": 1791900003,
    "session": "s1",
    "agent": "a1",
    "tool": "task_update",
    "args": {
     "id": "2",
     "status": "in_progress"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 3,\n \"next_epic\": 1,\n \"epics\": [],\n \"active\": {},\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"a1\",\n   \"epic\": 0,\n   \"subject\": \"Sub one\",\n   \"description\": \"\",\n   \"status\": \"in_progress\",\n   \"created\": 1791900000,\n   \"updated\": 1791900002\n  },\n  {\n   \"id\": \"2\",\n   \"agent\": \"a1\",\n   \"epic\": 0,\n   \"subject\": \"Sub two\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900001,\n   \"updated\": 1791900001\n  }\n ]\n}",
    "error": true,
    "text": "cannot start #2: 1 task(s) already in progress (#1 Sub one) for 1 worker(s), you.\nRunning subagents: Explore (id a0, for 0 min), Explore (id a1, for 0 min), Explore (id a2, for 0 min)\n#1 Sub one: no worker linked\nOne task per worker: complete a task nobody is on, or set it to pending or waiting; to hand this one to a running subagent, pass worker=<its type or id> with status=in_progress (refused if that subagent is stopped or already holds a task).",
    "after": {
     "version": 2,
     "next_id": 3,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "a1",
       "epic": 0,
       "subject": "Sub one",
       "description": "",
       "status": "in_progress",
       "created": 1791900000,
       "updated": 1791900002
      },
      {
       "id": "2",
       "agent": "a1",
       "epic": 0,
       "subject": "Sub two",
       "description": "",
       "status": "pending",
       "created": 1791900001,
       "updated": 1791900001
      }
     ]
    }
   }
  ]
 },
 {
  "name": "worker_running_takes_the_task",
  "steps": [
   {
    "agents": [
     {
      "id": "r1",
      "type": "review-pr3",
      "alive": false,
      "started": 1791899400
     },
     {
      "id": "r2",
      "type": "forgejo-cluster",
      "alive": false,
      "started": 1791899400
     },
     {
      "id": "c2",
      "type": "sdk-consensus2",
      "alive": true,
      "started": 1791899400
     }
    ]
   },
   {
    "now": 1791900000,
    "session": "s1",
    "agent": "main",
    "tool": "task_create",
    "args": {
     "subject": "Review PR 3",
     "epic": 0
    },
    "before": null,
    "error": false,
    "text": "Task #1 created: Review PR 3",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "Review PR 3",
       "description": "",
       "status": "pending",
       "created": 1791900000,
       "updated": 1791900000
      }
     ]
    }
   },
   {
    "now": 1791900001,
    "session": "s1",
    "agent": "main",
    "tool": "task_create",
    "args": {
     "subject": "Forgejo cluster",
     "epic": 0
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 1,\n \"epics\": [],\n \"active\": {},\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Review PR 3\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900000,\n   \"updated\": 1791900000\n  }\n ]\n}",
    "error": false,
    "text": "Task #2 created: Forgejo cluster",
    "after": {
     "version": 2,
     "next_id": 3,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "Review PR 3",
       "description": "",
       "status": "pending",
       "created": 1791900000,
       "updated": 1791900000
      },
      {
       "id": "2",
       "agent": "main",
       "epic": 0,
       "subject": "Forgejo cluster",
       "description": "",
       "status": "pending",
       "created": 1791900001,
       "updated": 1791900001
      }
     ]
    }
   },
   {
    "now": 1791900002,
    "session": "s1",
    "agent": "main",
    "tool": "task_create",
    "args": {
     "subject": "Consensus",
     "epic": 0
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 3,\n \"next_epic\": 1,\n \"epics\": [],\n \"active\": {},\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Review PR 3\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900000,\n   \"updated\": 1791900000\n  },\n  {\n   \"id\": \"2\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Forgejo cluster\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900001,\n   \"updated\": 1791900001\n  }\n ]\n}",
    "error": false,
    "text": "Task #3 created: Consensus",
    "after": {
     "version": 2,
     "next_id": 4,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "Review PR 3",
       "description": "",
       "status": "pending",
       "created": 1791900000,
       "updated": 1791900000
      },
      {
       "id": "2",
       "agent": "main",
       "epic": 0,
       "subject": "Forgejo cluster",
       "description": "",
       "status": "pending",
       "created": 1791900001,
       "updated": 1791900001
      },
      {
       "id": "3",
       "agent": "main",
       "epic": 0,
       "subject": "Consensus",
       "description": "",
       "status": "pending",
       "created": 1791900002,
       "updated": 1791900002
      }
     ]
    }
   },
   {
    "now": 1791900003,
    "session": "s1",
    "agent": "main",
    "tool": "task_update",
    "args": {
     "id": "1",
     "status": "in_progress"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 4,\n \"next_epic\": 1,\n \"epics\": [],\n \"active\": {},\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Review PR 3\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900000,\n   \"updated\": 1791900000\n  },\n  {\n   \"id\": \"2\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Forgejo cluster\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900001,\n   \"updated\": 1791900001\n  },\n  {\n   \"id\": \"3\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Consensus\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900002,\n   \"updated\": 1791900002\n  }\n ]\n}",
    "error": false,
    "text": "Task #1 updated: Review PR 3 (in_progress)",
    "after": {
     "version": 2,
     "next_id": 4,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "Review PR 3",
       "description": "",
       "status": "in_progress",
       "created": 1791900000,
       "updated": 1791900003
      },
      {
       "id": "2",
       "agent": "main",
       "epic": 0,
       "subject": "Forgejo cluster",
       "description": "",
       "status": "pending",
       "created": 1791900001,
       "updated": 1791900001
      },
      {
       "id": "3",
       "agent": "main",
       "epic": 0,
       "subject": "Consensus",
       "description": "",
       "status": "pending",
       "created": 1791900002,
       "updated": 1791900002
      }
     ]
    }
   },
   {
    "now": 1791900004,
    "session": "s1",
    "agent": "main",
    "tool": "task_update",
    "args": {
     "id": "2",
     "status": "in_progress"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 4,\n \"next_epic\": 1,\n \"epics\": [],\n \"active\": {},\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Review PR 3\",\n   \"description\": \"\",\n   \"status\": \"in_progress\",\n   \"created\": 1791900000,\n   \"updated\": 1791900003\n  },\n  {\n   \"id\": \"2\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Forgejo cluster\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900001,\n   \"updated\": 1791900001\n  },\n  {\n   \"id\": \"3\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Consensus\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900002,\n   \"updated\": 1791900002\n  }\n ]\n}",
    "error": false,
    "text": "Task #2 updated: Forgejo cluster (in_progress)",
    "after": {
     "version": 2,
     "next_id": 4,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "Review PR 3",
       "description": "",
       "status": "in_progress",
       "created": 1791900000,
       "updated": 1791900003
      },
      {
       "id": "2",
       "agent": "main",
       "epic": 0,
       "subject": "Forgejo cluster",
       "description": "",
       "status": "in_progress",
       "created": 1791900001,
       "updated": 1791900004
      },
      {
       "id": "3",
       "agent": "main",
       "epic": 0,
       "subject": "Consensus",
       "description": "",
       "status": "pending",
       "created": 1791900002,
       "updated": 1791900002
      }
     ]
    }
   },
   {
    "now": 1791900005,
    "session": "s1",
    "agent": "main",
    "tool": "task_update",
    "args": {
     "id": "3",
     "status": "in_progress"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 4,\n \"next_epic\": 1,\n \"epics\": [],\n \"active\": {},\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Review PR 3\",\n   \"description\": \"\",\n   \"status\": \"in_progress\",\n   \"created\": 1791900000,\n   \"updated\": 1791900003\n  },\n  {\n   \"id\": \"2\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Forgejo cluster\",\n   \"description\": \"\",\n   \"status\": \"in_progress\",\n   \"created\": 1791900001,\n   \"updated\": 1791900004\n  },\n  {\n   \"id\": \"3\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Consensus\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900002,\n   \"updated\": 1791900002\n  }\n ]\n}",
    "error": true,
    "text": "cannot start #3: 2 task(s) already in progress (#1 Review PR 3, #2 Forgejo cluster) for 2 worker(s), you and 1 running subagent(s).\nRunning subagents: sdk-consensus2 (id c2, for 10 min)\n#1 Review PR 3: no worker linked\n#2 Forgejo cluster: no worker linked\nOne task per worker: complete a task nobody is on, or set it to pending or waiting; to hand this one to a running subagent, pass worker=<its type or id> with status=in_progress (refused if that subagent is stopped or already holds a task).",
    "after": {
     "version": 2,
     "next_id": 4,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "Review PR 3",
       "description": "",
       "status": "in_progress",
       "created": 1791900000,
       "updated": 1791900003
      },
      {
       "id": "2",
       "agent": "main",
       "epic": 0,
       "subject": "Forgejo cluster",
       "description": "",
       "status": "in_progress",
       "created": 1791900001,
       "updated": 1791900004
      },
      {
       "id": "3",
       "agent": "main",
       "epic": 0,
       "subject": "Consensus",
       "description": "",
       "status": "pending",
       "created": 1791900002,
       "updated": 1791900002
      }
     ]
    }
   },
   {
    "now": 1791900006,
    "session": "s1",
    "agent": "main",
    "tool": "task_update",
    "args": {
     "id": "3",
     "status": "in_progress",
     "worker": "sdk-consensus2"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 4,\n \"next_epic\": 1,\n \"epics\": [],\n \"active\": {},\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Review PR 3\",\n   \"description\": \"\",\n   \"status\": \"in_progress\",\n   \"created\": 1791900000,\n   \"updated\": 1791900003\n  },\n  {\n   \"id\": \"2\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Forgejo cluster\",\n   \"description\": \"\",\n   \"status\": \"in_progress\",\n   \"created\": 1791900001,\n   \"updated\": 1791900004\n  },\n  {\n   \"id\": \"3\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Consensus\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900002,\n   \"updated\": 1791900002\n  }\n ]\n}",
    "error": false,
    "text": "Task #3 updated: Consensus (in_progress on worker sdk-consensus2)",
    "after": {
     "version": 2,
     "next_id": 4,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "Review PR 3",
       "description": "",
       "status": "in_progress",
       "created": 1791900000,
       "updated": 1791900003
      },
      {
       "id": "2",
       "agent": "main",
       "epic": 0,
       "subject": "Forgejo cluster",
       "description": "",
       "status": "in_progress",
       "created": 1791900001,
       "updated": 1791900004
      },
      {
       "id": "3",
       "agent": "main",
       "epic": 0,
       "subject": "Consensus",
       "description": "",
       "status": "in_progress",
       "created": 1791900002,
       "updated": 1791900006,
       "worker_id": "c2",
       "worker": "sdk-consensus2"
      }
     ]
    }
   }
  ]
 },
 {
  "name": "worker_by_agent_id",
  "steps": [
   {
    "agents": [
     {
      "id": "c2",
      "type": "sdk-consensus2",
      "alive": true,
      "started": 1791899400
     }
    ]
   },
   {
    "now": 1791900000,
    "session": "s1",
    "agent": "main",
    "tool": "task_create",
    "args": {
     "subject": "Consensus",
     "epic": 0
    },
    "before": null,
    "error": false,
    "text": "Task #1 created: Consensus",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "Consensus",
       "description": "",
       "status": "pending",
       "created": 1791900000,
       "updated": 1791900000
      }
     ]
    }
   },
   {
    "now": 1791900001,
    "session": "s1",
    "agent": "main",
    "tool": "task_update",
    "args": {
     "id": "1",
     "status": "in_progress",
     "worker": "c2"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 1,\n \"epics\": [],\n \"active\": {},\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Consensus\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900000,\n   \"updated\": 1791900000\n  }\n ]\n}",
    "error": false,
    "text": "Task #1 updated: Consensus (in_progress on worker c2)",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "Consensus",
       "description": "",
       "status": "in_progress",
       "created": 1791900000,
       "updated": 1791900001,
       "worker_id": "c2",
       "worker": "c2"
      }
     ]
    }
   }
  ]
 },
 {
  "name": "worker_stopped_or_unknown_is_refused",
  "steps": [
   {
    "agents": [
     {
      "id": "r1",
      "type": "review-pr3",
      "alive": false,
      "started": 1791899400
     },
     {
      "id": "c2",
      "type": "sdk-consensus2",
      "alive": true,
      "started": 1791899400
     }
    ]
   },
   {
    "now": 1791900000,
    "session": "s1",
    "agent": "main",
    "tool": "task_create",
    "args": {
     "subject": "Review",
     "epic": 0
    },
    "before": null,
    "error": false,
    "text": "Task #1 created: Review",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "Review",
       "description": "",
       "status": "pending",
       "created": 1791900000,
       "updated": 1791900000
      }
     ]
    }
   },
   {
    "now": 1791900001,
    "session": "s1",
    "agent": "main",
    "tool": "task_update",
    "args": {
     "id": "1",
     "status": "in_progress",
     "worker": "review-pr3"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 1,\n \"epics\": [],\n \"active\": {},\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Review\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900000,\n   \"updated\": 1791900000\n  }\n ]\n}",
    "error": true,
    "text": "cannot start #1 on worker review-pr3: it is stopped.\nRunning subagents: sdk-consensus2 (id c2, for 10 min)\nName a running subagent (its type or id, listed above) with worker=, or start one for this task first; a task nobody runs stays pending.",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "Review",
       "description": "",
       "status": "pending",
       "created": 1791900000,
       "updated": 1791900000
      }
     ]
    }
   },
   {
    "now": 1791900002,
    "session": "s1",
    "agent": "main",
    "tool": "task_update",
    "args": {
     "id": "1",
     "status": "in_progress",
     "worker": "ghost"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 1,\n \"epics\": [],\n \"active\": {},\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Review\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900000,\n   \"updated\": 1791900000\n  }\n ]\n}",
    "error": true,
    "text": "cannot start #1 on worker ghost: it is not a subagent of this session.\nRunning subagents: sdk-consensus2 (id c2, for 10 min)\nName a running subagent (its type or id, listed above) with worker=, or start one for this task first; a task nobody runs stays pending.",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "Review",
       "description": "",
       "status": "pending",
       "created": 1791900000,
       "updated": 1791900000
      }
     ]
    }
   }
  ]
 },
 {
  "name": "worker_already_busy_is_refused",
  "steps": [
   {
    "agents": [
     {
      "id": "c2",
      "type": "sdk-consensus2",
      "alive": true,
      "started": 1791899400
     }
    ]
   },
   {
    "now": 1791900000,
    "session": "s1",
    "agent": "main",
    "tool": "task_create",
    "args": {
     "subject": "First",
     "epic": 0
    },
    "before": null,
    "error": false,
    "text": "Task #1 created: First",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "First",
       "description": "",
       "status": "pending",
       "created": 1791900000,
       "updated": 1791900000
      }
     ]
    }
   },
   {
    "now": 1791900001,
    "session": "s1",
    "agent": "main",
    "tool": "task_create",
    "args": {
     "subject": "Second",
     "epic": 0
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 1,\n \"epics\": [],\n \"active\": {},\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"First\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900000,\n   \"updated\": 1791900000\n  }\n ]\n}",
    "error": false,
    "text": "Task #2 created: Second",
    "after": {
     "version": 2,
     "next_id": 3,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "First",
       "description": "",
       "status": "pending",
       "created": 1791900000,
       "updated": 1791900000
      },
      {
       "id": "2",
       "agent": "main",
       "epic": 0,
       "subject": "Second",
       "description": "",
       "status": "pending",
       "created": 1791900001,
       "updated": 1791900001
      }
     ]
    }
   },
   {
    "now": 1791900002,
    "session": "s1",
    "agent": "main",
    "tool": "task_update",
    "args": {
     "id": "1",
     "status": "in_progress",
     "worker": "sdk-consensus2"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 3,\n \"next_epic\": 1,\n \"epics\": [],\n \"active\": {},\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"First\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900000,\n   \"updated\": 1791900000\n  },\n  {\n   \"id\": \"2\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Second\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900001,\n   \"updated\": 1791900001\n  }\n ]\n}",
    "error": false,
    "text": "Task #1 updated: First (in_progress on worker sdk-consensus2)",
    "after": {
     "version": 2,
     "next_id": 3,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "First",
       "description": "",
       "status": "in_progress",
       "created": 1791900000,
       "updated": 1791900002,
       "worker_id": "c2",
       "worker": "sdk-consensus2"
      },
      {
       "id": "2",
       "agent": "main",
       "epic": 0,
       "subject": "Second",
       "description": "",
       "status": "pending",
       "created": 1791900001,
       "updated": 1791900001
      }
     ]
    }
   },
   {
    "now": 1791900003,
    "session": "s1",
    "agent": "main",
    "tool": "task_update",
    "args": {
     "id": "2",
     "status": "in_progress",
     "worker": "c2"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 3,\n \"next_epic\": 1,\n \"epics\": [],\n \"active\": {},\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"First\",\n   \"description\": \"\",\n   \"status\": \"in_progress\",\n   \"created\": 1791900000,\n   \"updated\": 1791900002,\n   \"worker_id\": \"c2\",\n   \"worker\": \"sdk-consensus2\"\n  },\n  {\n   \"id\": \"2\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Second\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900001,\n   \"updated\": 1791900001\n  }\n ]\n}",
    "error": true,
    "text": "cannot start #2 on worker c2: it already holds #1 First. One task per worker: set #1 to completed, pending or waiting first, or hand this one to another subagent.\nRunning subagents: sdk-consensus2 (id c2, for 10 min)\n#1 First: worker sdk-consensus2 (running)",
    "after": {
     "version": 2,
     "next_id": 3,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "First",
       "description": "",
       "status": "in_progress",
       "created": 1791900000,
       "updated": 1791900002,
       "worker_id": "c2",
       "worker": "sdk-consensus2"
      },
      {
       "id": "2",
       "agent": "main",
       "epic": 0,
       "subject": "Second",
       "description": "",
       "status": "pending",
       "created": 1791900001,
       "updated": 1791900001
      }
     ]
    }
   },
   {
    "now": 1791900004,
    "session": "s1",
    "agent": "main",
    "tool": "task_update",
    "args": {
     "id": "1",
     "status": "in_progress",
     "worker": "sdk-consensus2"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 3,\n \"next_epic\": 1,\n \"epics\": [],\n \"active\": {},\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"First\",\n   \"description\": \"\",\n   \"status\": \"in_progress\",\n   \"created\": 1791900000,\n   \"updated\": 1791900002,\n   \"worker_id\": \"c2\",\n   \"worker\": \"sdk-consensus2\"\n  },\n  {\n   \"id\": \"2\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Second\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900001,\n   \"updated\": 1791900001\n  }\n ]\n}",
    "error": false,
    "text": "Task #1 updated: First (in_progress on worker sdk-consensus2)",
    "after": {
     "version": 2,
     "next_id": 3,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "First",
       "description": "",
       "status": "in_progress",
       "created": 1791900000,
       "updated": 1791900004,
       "worker_id": "c2",
       "worker": "sdk-consensus2"
      },
      {
       "id": "2",
       "agent": "main",
       "epic": 0,
       "subject": "Second",
       "description": "",
       "status": "pending",
       "created": 1791900001,
       "updated": 1791900001
      }
     ]
    }
   }
  ]
 },
 {
  "name": "refusal_lists_workers_and_holders",
  "steps": [
   {
    "agents": [
     {
      "id": "r1",
      "type": "review-pr3",
      "alive": false,
      "started": 1791899400
     },
     {
      "id": "c2",
      "type": "sdk-consensus2",
      "alive": true,
      "started": 1791896000
     }
    ]
   },
   {
    "now": 1791900000,
    "session": "s1",
    "agent": "main",
    "tool": "task_create",
    "args": {
     "subject": "Mine",
     "epic": 0
    },
    "before": null,
    "error": false,
    "text": "Task #1 created: Mine",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "Mine",
       "description": "",
       "status": "pending",
       "created": 1791900000,
       "updated": 1791900000
      }
     ]
    }
   },
   {
    "now": 1791900001,
    "session": "s1",
    "agent": "main",
    "tool": "task_create",
    "args": {
     "subject": "Delegated",
     "epic": 0
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 1,\n \"epics\": [],\n \"active\": {},\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Mine\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900000,\n   \"updated\": 1791900000\n  }\n ]\n}",
    "error": false,
    "text": "Task #2 created: Delegated",
    "after": {
     "version": 2,
     "next_id": 3,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "Mine",
       "description": "",
       "status": "pending",
       "created": 1791900000,
       "updated": 1791900000
      },
      {
       "id": "2",
       "agent": "main",
       "epic": 0,
       "subject": "Delegated",
       "description": "",
       "status": "pending",
       "created": 1791900001,
       "updated": 1791900001
      }
     ]
    }
   },
   {
    "now": 1791900002,
    "session": "s1",
    "agent": "main",
    "tool": "task_create",
    "args": {
     "subject": "Third",
     "epic": 0
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 3,\n \"next_epic\": 1,\n \"epics\": [],\n \"active\": {},\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Mine\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900000,\n   \"updated\": 1791900000\n  },\n  {\n   \"id\": \"2\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Delegated\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900001,\n   \"updated\": 1791900001\n  }\n ]\n}",
    "error": false,
    "text": "Task #3 created: Third",
    "after": {
     "version": 2,
     "next_id": 4,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "Mine",
       "description": "",
       "status": "pending",
       "created": 1791900000,
       "updated": 1791900000
      },
      {
       "id": "2",
       "agent": "main",
       "epic": 0,
       "subject": "Delegated",
       "description": "",
       "status": "pending",
       "created": 1791900001,
       "updated": 1791900001
      },
      {
       "id": "3",
       "agent": "main",
       "epic": 0,
       "subject": "Third",
       "description": "",
       "status": "pending",
       "created": 1791900002,
       "updated": 1791900002
      }
     ]
    }
   },
   {
    "now": 1791900003,
    "session": "s1",
    "agent": "main",
    "tool": "task_update",
    "args": {
     "id": "1",
     "status": "in_progress"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 4,\n \"next_epic\": 1,\n \"epics\": [],\n \"active\": {},\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Mine\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900000,\n   \"updated\": 1791900000\n  },\n  {\n   \"id\": \"2\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Delegated\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900001,\n   \"updated\": 1791900001\n  },\n  {\n   \"id\": \"3\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Third\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900002,\n   \"updated\": 1791900002\n  }\n ]\n}",
    "error": false,
    "text": "Task #1 updated: Mine (in_progress)",
    "after": {
     "version": 2,
     "next_id": 4,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "Mine",
       "description": "",
       "status": "in_progress",
       "created": 1791900000,
       "updated": 1791900003
      },
      {
       "id": "2",
       "agent": "main",
       "epic": 0,
       "subject": "Delegated",
       "description": "",
       "status": "pending",
       "created": 1791900001,
       "updated": 1791900001
      },
      {
       "id": "3",
       "agent": "main",
       "epic": 0,
       "subject": "Third",
       "description": "",
       "status": "pending",
       "created": 1791900002,
       "updated": 1791900002
      }
     ]
    }
   },
   {
    "now": 1791900004,
    "session": "s1",
    "agent": "main",
    "tool": "task_update",
    "args": {
     "id": "2",
     "status": "in_progress"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 4,\n \"next_epic\": 1,\n \"epics\": [],\n \"active\": {},\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Mine\",\n   \"description\": \"\",\n   \"status\": \"in_progress\",\n   \"created\": 1791900000,\n   \"updated\": 1791900003\n  },\n  {\n   \"id\": \"2\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Delegated\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900001,\n   \"updated\": 1791900001\n  },\n  {\n   \"id\": \"3\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Third\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900002,\n   \"updated\": 1791900002\n  }\n ]\n}",
    "error": false,
    "text": "Task #2 updated: Delegated (in_progress)",
    "after": {
     "version": 2,
     "next_id": 4,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "Mine",
       "description": "",
       "status": "in_progress",
       "created": 1791900000,
       "updated": 1791900003
      },
      {
       "id": "2",
       "agent": "main",
       "epic": 0,
       "subject": "Delegated",
       "description": "",
       "status": "in_progress",
       "created": 1791900001,
       "updated": 1791900004
      },
      {
       "id": "3",
       "agent": "main",
       "epic": 0,
       "subject": "Third",
       "description": "",
       "status": "pending",
       "created": 1791900002,
       "updated": 1791900002
      }
     ]
    }
   },
   {
    "now": 1791900005,
    "session": "s1",
    "agent": "main",
    "tool": "task_update",
    "args": {
     "id": "3",
     "status": "in_progress"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 4,\n \"next_epic\": 1,\n \"epics\": [],\n \"active\": {},\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Mine\",\n   \"description\": \"\",\n   \"status\": \"in_progress\",\n   \"created\": 1791900000,\n   \"updated\": 1791900003\n  },\n  {\n   \"id\": \"2\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Delegated\",\n   \"description\": \"\",\n   \"status\": \"in_progress\",\n   \"created\": 1791900001,\n   \"updated\": 1791900004\n  },\n  {\n   \"id\": \"3\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Third\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900002,\n   \"updated\": 1791900002\n  }\n ]\n}",
    "error": true,
    "text": "cannot start #3: 2 task(s) already in progress (#1 Mine, #2 Delegated) for 2 worker(s), you and 1 running subagent(s).\nRunning subagents: sdk-consensus2 (id c2, for 1h06)\n#1 Mine: no worker linked\n#2 Delegated: no worker linked\nOne task per worker: complete a task nobody is on, or set it to pending or waiting; to hand this one to a running subagent, pass worker=<its type or id> with status=in_progress (refused if that subagent is stopped or already holds a task).",
    "after": {
     "version": 2,
     "next_id": 4,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "Mine",
       "description": "",
       "status": "in_progress",
       "created": 1791900000,
       "updated": 1791900003
      },
      {
       "id": "2",
       "agent": "main",
       "epic": 0,
       "subject": "Delegated",
       "description": "",
       "status": "in_progress",
       "created": 1791900001,
       "updated": 1791900004
      },
      {
       "id": "3",
       "agent": "main",
       "epic": 0,
       "subject": "Third",
       "description": "",
       "status": "pending",
       "created": 1791900002,
       "updated": 1791900002
      }
     ]
    }
   }
  ]
 },
 {
  "name": "worker_link_is_dropped_when_leaving_in_progress",
  "steps": [
   {
    "agents": [
     {
      "id": "c2",
      "type": "sdk-consensus2",
      "alive": true,
      "started": 1791899400
     }
    ]
   },
   {
    "now": 1791900000,
    "session": "s1",
    "agent": "main",
    "tool": "task_create",
    "args": {
     "subject": "Work",
     "epic": 0
    },
    "before": null,
    "error": false,
    "text": "Task #1 created: Work",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "Work",
       "description": "",
       "status": "pending",
       "created": 1791900000,
       "updated": 1791900000
      }
     ]
    }
   },
   {
    "now": 1791900001,
    "session": "s1",
    "agent": "main",
    "tool": "task_update",
    "args": {
     "id": "1",
     "status": "in_progress",
     "worker": "sdk-consensus2"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 1,\n \"epics\": [],\n \"active\": {},\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Work\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900000,\n   \"updated\": 1791900000\n  }\n ]\n}",
    "error": false,
    "text": "Task #1 updated: Work (in_progress on worker sdk-consensus2)",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "Work",
       "description": "",
       "status": "in_progress",
       "created": 1791900000,
       "updated": 1791900001,
       "worker_id": "c2",
       "worker": "sdk-consensus2"
      }
     ]
    }
   },
   {
    "now": 1791900002,
    "session": "s1",
    "agent": "main",
    "tool": "task_update",
    "args": {
     "id": "1",
     "status": "waiting"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 1,\n \"epics\": [],\n \"active\": {},\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Work\",\n   \"description\": \"\",\n   \"status\": \"in_progress\",\n   \"created\": 1791900000,\n   \"updated\": 1791900001,\n   \"worker_id\": \"c2\",\n   \"worker\": \"sdk-consensus2\"\n  }\n ]\n}",
    "error": false,
    "text": "Task #1 updated: Work (waiting)",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "Work",
       "description": "",
       "status": "waiting",
       "created": 1791900000,
       "updated": 1791900002
      }
     ]
    }
   },
   {
    "now": 1791900003,
    "session": "s1",
    "agent": "main",
    "tool": "task_update",
    "args": {
     "id": "1",
     "status": "in_progress",
     "worker": "sdk-consensus2"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 1,\n \"epics\": [],\n \"active\": {},\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Work\",\n   \"description\": \"\",\n   \"status\": \"waiting\",\n   \"created\": 1791900000,\n   \"updated\": 1791900002\n  }\n ]\n}",
    "error": false,
    "text": "Task #1 updated: Work (in_progress on worker sdk-consensus2)",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "Work",
       "description": "",
       "status": "in_progress",
       "created": 1791900000,
       "updated": 1791900003,
       "worker_id": "c2",
       "worker": "sdk-consensus2"
      }
     ]
    }
   },
   {
    "now": 1791900004,
    "session": "s1",
    "agent": "main",
    "tool": "task_update",
    "args": {
     "id": "1",
     "status": "completed",
     "worker": "sdk-consensus2"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 1,\n \"epics\": [],\n \"active\": {},\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Work\",\n   \"description\": \"\",\n   \"status\": \"in_progress\",\n   \"created\": 1791900000,\n   \"updated\": 1791900003,\n   \"worker_id\": \"c2\",\n   \"worker\": \"sdk-consensus2\"\n  }\n ]\n}",
    "error": false,
    "text": "Task #1 updated: Work (completed)",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "Work",
       "description": "",
       "status": "completed",
       "created": 1791900000,
       "updated": 1791900004
      }
     ]
    }
   }
  ]
 },
 {
  "name": "stopped_holder_is_reported",
  "steps": [
   {
    "agents": [
     {
      "id": "c2",
      "type": "sdk-consensus2",
      "alive": true,
      "started": 1791899400
     },
     {
      "id": "c3",
      "type": "other",
      "alive": true,
      "started": 1791899940
     }
    ]
   },
   {
    "now": 1791900000,
    "session": "s1",
    "agent": "main",
    "tool": "task_create",
    "args": {
     "subject": "Held",
     "epic": 0
    },
    "before": null,
    "error": false,
    "text": "Task #1 created: Held",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "Held",
       "description": "",
       "status": "pending",
       "created": 1791900000,
       "updated": 1791900000
      }
     ]
    }
   },
   {
    "now": 1791900001,
    "session": "s1",
    "agent": "main",
    "tool": "task_create",
    "args": {
     "subject": "Next",
     "epic": 0
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 1,\n \"epics\": [],\n \"active\": {},\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Held\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900000,\n   \"updated\": 1791900000\n  }\n ]\n}",
    "error": false,
    "text": "Task #2 created: Next",
    "after": {
     "version": 2,
     "next_id": 3,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "Held",
       "description": "",
       "status": "pending",
       "created": 1791900000,
       "updated": 1791900000
      },
      {
       "id": "2",
       "agent": "main",
       "epic": 0,
       "subject": "Next",
       "description": "",
       "status": "pending",
       "created": 1791900001,
       "updated": 1791900001
      }
     ]
    }
   },
   {
    "now": 1791900002,
    "session": "s1",
    "agent": "main",
    "tool": "task_create",
    "args": {
     "subject": "Third",
     "epic": 0
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 3,\n \"next_epic\": 1,\n \"epics\": [],\n \"active\": {},\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Held\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900000,\n   \"updated\": 1791900000\n  },\n  {\n   \"id\": \"2\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Next\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900001,\n   \"updated\": 1791900001\n  }\n ]\n}",
    "error": false,
    "text": "Task #3 created: Third",
    "after": {
     "version": 2,
     "next_id": 4,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "Held",
       "description": "",
       "status": "pending",
       "created": 1791900000,
       "updated": 1791900000
      },
      {
       "id": "2",
       "agent": "main",
       "epic": 0,
       "subject": "Next",
       "description": "",
       "status": "pending",
       "created": 1791900001,
       "updated": 1791900001
      },
      {
       "id": "3",
       "agent": "main",
       "epic": 0,
       "subject": "Third",
       "description": "",
       "status": "pending",
       "created": 1791900002,
       "updated": 1791900002
      }
     ]
    }
   },
   {
    "now": 1791900003,
    "session": "s1",
    "agent": "main",
    "tool": "task_update",
    "args": {
     "id": "1",
     "status": "in_progress",
     "worker": "c2"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 4,\n \"next_epic\": 1,\n \"epics\": [],\n \"active\": {},\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Held\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900000,\n   \"updated\": 1791900000\n  },\n  {\n   \"id\": \"2\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Next\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900001,\n   \"updated\": 1791900001\n  },\n  {\n   \"id\": \"3\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Third\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900002,\n   \"updated\": 1791900002\n  }\n ]\n}",
    "error": false,
    "text": "Task #1 updated: Held (in_progress on worker c2)",
    "after": {
     "version": 2,
     "next_id": 4,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "Held",
       "description": "",
       "status": "in_progress",
       "created": 1791900000,
       "updated": 1791900003,
       "worker_id": "c2",
       "worker": "c2"
      },
      {
       "id": "2",
       "agent": "main",
       "epic": 0,
       "subject": "Next",
       "description": "",
       "status": "pending",
       "created": 1791900001,
       "updated": 1791900001
      },
      {
       "id": "3",
       "agent": "main",
       "epic": 0,
       "subject": "Third",
       "description": "",
       "status": "pending",
       "created": 1791900002,
       "updated": 1791900002
      }
     ]
    }
   },
   {
    "agents": [
     {
      "id": "c2",
      "type": "sdk-consensus2",
      "alive": false,
      "started": 1791899404
     },
     {
      "id": "c3",
      "type": "other",
      "alive": true,
      "started": 1791899944
     }
    ]
   },
   {
    "now": 1791900004,
    "session": "s1",
    "agent": "main",
    "tool": "task_update",
    "args": {
     "id": "2",
     "status": "in_progress"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 4,\n \"next_epic\": 1,\n \"epics\": [],\n \"active\": {},\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Held\",\n   \"description\": \"\",\n   \"status\": \"in_progress\",\n   \"created\": 1791900000,\n   \"updated\": 1791900003,\n   \"worker_id\": \"c2\",\n   \"worker\": \"c2\"\n  },\n  {\n   \"id\": \"2\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Next\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900001,\n   \"updated\": 1791900001\n  },\n  {\n   \"id\": \"3\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Third\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900002,\n   \"updated\": 1791900002\n  }\n ]\n}",
    "error": false,
    "text": "Task #2 updated: Next (in_progress)",
    "after": {
     "version": 2,
     "next_id": 4,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "Held",
       "description": "",
       "status": "in_progress",
       "created": 1791900000,
       "updated": 1791900003,
       "worker_id": "c2",
       "worker": "c2"
      },
      {
       "id": "2",
       "agent": "main",
       "epic": 0,
       "subject": "Next",
       "description": "",
       "status": "in_progress",
       "created": 1791900001,
       "updated": 1791900004
      },
      {
       "id": "3",
       "agent": "main",
       "epic": 0,
       "subject": "Third",
       "description": "",
       "status": "pending",
       "created": 1791900002,
       "updated": 1791900002
      }
     ]
    }
   },
   {
    "now": 1791900005,
    "session": "s1",
    "agent": "main",
    "tool": "task_update",
    "args": {
     "id": "3",
     "status": "in_progress"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 4,\n \"next_epic\": 1,\n \"epics\": [],\n \"active\": {},\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Held\",\n   \"description\": \"\",\n   \"status\": \"in_progress\",\n   \"created\": 1791900000,\n   \"updated\": 1791900003,\n   \"worker_id\": \"c2\",\n   \"worker\": \"c2\"\n  },\n  {\n   \"id\": \"2\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Next\",\n   \"description\": \"\",\n   \"status\": \"in_progress\",\n   \"created\": 1791900001,\n   \"updated\": 1791900004\n  },\n  {\n   \"id\": \"3\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Third\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900002,\n   \"updated\": 1791900002\n  }\n ]\n}",
    "error": true,
    "text": "cannot start #3: 2 task(s) already in progress (#1 Held, #2 Next) for 2 worker(s), you and 1 running subagent(s).\nRunning subagents: other (id c3, for 1 min)\n#1 Held: worker c2 (STOPPED)\n#2 Next: no worker linked\nOne task per worker: complete a task nobody is on, or set it to pending or waiting; to hand this one to a running subagent, pass worker=<its type or id> with status=in_progress (refused if that subagent is stopped or already holds a task).",
    "after": {
     "version": 2,
     "next_id": 4,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "Held",
       "description": "",
       "status": "in_progress",
       "created": 1791900000,
       "updated": 1791900003,
       "worker_id": "c2",
       "worker": "c2"
      },
      {
       "id": "2",
       "agent": "main",
       "epic": 0,
       "subject": "Next",
       "description": "",
       "status": "in_progress",
       "created": 1791900001,
       "updated": 1791900004
      },
      {
       "id": "3",
       "agent": "main",
       "epic": 0,
       "subject": "Third",
       "description": "",
       "status": "pending",
       "created": 1791900002,
       "updated": 1791900002
      }
     ]
    }
   }
  ]
 },
 {
  "name": "a_stopped_worker_is_judged_by_its_id",
  "steps": [
   {
    "agents": [
     {
      "id": "c2",
      "type": "sdk-consensus2",
      "alive": true,
      "started": 1791899400
     }
    ]
   },
   {
    "now": 1791900000,
    "session": "s1",
    "agent": "main",
    "tool": "task_create",
    "args": {
     "subject": "Held",
     "epic": 0
    },
    "before": null,
    "error": false,
    "text": "Task #1 created: Held",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "Held",
       "description": "",
       "status": "pending",
       "created": 1791900000,
       "updated": 1791900000
      }
     ]
    }
   },
   {
    "now": 1791900001,
    "session": "s1",
    "agent": "main",
    "tool": "task_create",
    "args": {
     "subject": "Other",
     "epic": 0
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 1,\n \"epics\": [],\n \"active\": {},\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Held\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900000,\n   \"updated\": 1791900000\n  }\n ]\n}",
    "error": false,
    "text": "Task #2 created: Other",
    "after": {
     "version": 2,
     "next_id": 3,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "Held",
       "description": "",
       "status": "pending",
       "created": 1791900000,
       "updated": 1791900000
      },
      {
       "id": "2",
       "agent": "main",
       "epic": 0,
       "subject": "Other",
       "description": "",
       "status": "pending",
       "created": 1791900001,
       "updated": 1791900001
      }
     ]
    }
   },
   {
    "now": 1791900002,
    "session": "s1",
    "agent": "main",
    "tool": "task_update",
    "args": {
     "id": "1",
     "status": "in_progress",
     "worker": "sdk-consensus2"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 3,\n \"next_epic\": 1,\n \"epics\": [],\n \"active\": {},\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Held\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900000,\n   \"updated\": 1791900000\n  },\n  {\n   \"id\": \"2\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Other\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900001,\n   \"updated\": 1791900001\n  }\n ]\n}",
    "error": false,
    "text": "Task #1 updated: Held (in_progress on worker sdk-consensus2)",
    "after": {
     "version": 2,
     "next_id": 3,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "Held",
       "description": "",
       "status": "in_progress",
       "created": 1791900000,
       "updated": 1791900002,
       "worker_id": "c2",
       "worker": "sdk-consensus2"
      },
      {
       "id": "2",
       "agent": "main",
       "epic": 0,
       "subject": "Other",
       "description": "",
       "status": "pending",
       "created": 1791900001,
       "updated": 1791900001
      }
     ]
    }
   },
   {
    "agents": [
     {
      "id": "c2",
      "type": "sdk-consensus2",
      "alive": false,
      "started": 1791899403
     },
     {
      "id": "c9",
      "type": "sdk-consensus2",
      "alive": true,
      "started": 1791899973
     }
    ]
   },
   {
    "now": 1791900003,
    "session": "s1",
    "agent": "main",
    "tool": "task_update",
    "args": {
     "id": "2",
     "status": "in_progress"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 3,\n \"next_epic\": 1,\n \"epics\": [],\n \"active\": {},\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Held\",\n   \"description\": \"\",\n   \"status\": \"in_progress\",\n   \"created\": 1791900000,\n   \"updated\": 1791900002,\n   \"worker_id\": \"c2\",\n   \"worker\": \"sdk-consensus2\"\n  },\n  {\n   \"id\": \"2\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Other\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900001,\n   \"updated\": 1791900001\n  }\n ]\n}",
    "error": false,
    "text": "Task #2 updated: Other (in_progress)",
    "after": {
     "version": 2,
     "next_id": 3,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "Held",
       "description": "",
       "status": "in_progress",
       "created": 1791900000,
       "updated": 1791900002,
       "worker_id": "c2",
       "worker": "sdk-consensus2"
      },
      {
       "id": "2",
       "agent": "main",
       "epic": 0,
       "subject": "Other",
       "description": "",
       "status": "in_progress",
       "created": 1791900001,
       "updated": 1791900003
      }
     ]
    }
   },
   {
    "now": 1791900004,
    "session": "s1",
    "agent": "main",
    "tool": "task_update",
    "args": {
     "id": "2",
     "status": "in_progress",
     "worker": "nobody"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 3,\n \"next_epic\": 1,\n \"epics\": [],\n \"active\": {},\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Held\",\n   \"description\": \"\",\n   \"status\": \"in_progress\",\n   \"created\": 1791900000,\n   \"updated\": 1791900002,\n   \"worker_id\": \"c2\",\n   \"worker\": \"sdk-consensus2\"\n  },\n  {\n   \"id\": \"2\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Other\",\n   \"description\": \"\",\n   \"status\": \"in_progress\",\n   \"created\": 1791900001,\n   \"updated\": 1791900003\n  }\n ]\n}",
    "error": true,
    "text": "cannot start #2 on worker nobody: it is not a subagent of this session.\nRunning subagents: sdk-consensus2 (id c9, for 0 min)\n#1 Held: worker sdk-consensus2 (STOPPED)\n#2 Other: no worker linked\nName a running subagent (its type or id, listed above) with worker=, or start one for this task first; a task nobody runs stays pending.",
    "after": {
     "version": 2,
     "next_id": 3,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "Held",
       "description": "",
       "status": "in_progress",
       "created": 1791900000,
       "updated": 1791900002,
       "worker_id": "c2",
       "worker": "sdk-consensus2"
      },
      {
       "id": "2",
       "agent": "main",
       "epic": 0,
       "subject": "Other",
       "description": "",
       "status": "in_progress",
       "created": 1791900001,
       "updated": 1791900003
      }
     ]
    }
   },
   {
    "now": 1791900005,
    "session": "s1",
    "agent": "main",
    "tool": "task_update",
    "args": {
     "id": "2",
     "status": "in_progress",
     "worker": "sdk-consensus2"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 3,\n \"next_epic\": 1,\n \"epics\": [],\n \"active\": {},\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Held\",\n   \"description\": \"\",\n   \"status\": \"in_progress\",\n   \"created\": 1791900000,\n   \"updated\": 1791900002,\n   \"worker_id\": \"c2\",\n   \"worker\": \"sdk-consensus2\"\n  },\n  {\n   \"id\": \"2\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Other\",\n   \"description\": \"\",\n   \"status\": \"in_progress\",\n   \"created\": 1791900001,\n   \"updated\": 1791900003\n  }\n ]\n}",
    "error": false,
    "text": "Task #2 updated: Other (in_progress on worker sdk-consensus2)",
    "after": {
     "version": 2,
     "next_id": 3,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "Held",
       "description": "",
       "status": "in_progress",
       "created": 1791900000,
       "updated": 1791900002,
       "worker_id": "c2",
       "worker": "sdk-consensus2"
      },
      {
       "id": "2",
       "agent": "main",
       "epic": 0,
       "subject": "Other",
       "description": "",
       "status": "in_progress",
       "created": 1791900001,
       "updated": 1791900005,
       "worker_id": "c9",
       "worker": "sdk-consensus2"
      }
     ]
    }
   }
  ]
 },
 {
  "name": "long_subject_is_refused",
  "steps": [
   {
    "now": 1791900000,
    "session": "s1",
    "agent": "main",
    "tool": "task_create",
    "args": {
     "subject": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
     "epic": 0
    },
    "before": null,
    "error": true,
    "text": "subject is 41 characters, the limit is 40: it is shown in full on the status line. Shorten it to an imperative title and move the detail to description.",
    "after": null
   },
   {
    "now": 1791900001,
    "session": "s1",
    "agent": "main",
    "tool": "task_create",
    "args": {
     "subject": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
     "epic": 0
    },
    "before": null,
    "error": false,
    "text": "Task #1 created: xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
       "description": "",
       "status": "pending",
       "created": 1791900001,
       "updated": 1791900001
      }
     ]
    }
   },
   {
    "now": 1791900002,
    "session": "s1",
    "agent": "main",
    "tool": "task_update",
    "args": {
     "id": "1",
     "subject": "yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 1,\n \"epics\": [],\n \"active\": {},\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900001,\n   \"updated\": 1791900001\n  }\n ]\n}",
    "error": true,
    "text": "subject is 41 characters, the limit is 40: it is shown in full on the status line. Shorten it to an imperative title and move the detail to description.",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
       "description": "",
       "status": "pending",
       "created": 1791900001,
       "updated": 1791900001
      }
     ]
    }
   },
   {
    "now": 1791900003,
    "session": "s1",
    "agent": "main",
    "tool": "task_update",
    "args": {
     "id": "1",
     "subject": "  trimmed  "
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 1,\n \"epics\": [],\n \"active\": {},\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900001,\n   \"updated\": 1791900001\n  }\n ]\n}",
    "error": false,
    "text": "Task #1 updated: trimmed (pending)",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "trimmed",
       "description": "",
       "status": "pending",
       "created": 1791900001,
       "updated": 1791900003
      }
     ]
    }
   }
  ]
 },
 {
  "name": "lengths_are_code_points",
  "steps": [
   {
    "now": 1791900000,
    "session": "s1",
    "agent": "main",
    "tool": "task_create",
    "args": {
     "subject": "😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀",
     "epic": 0
    },
    "before": null,
    "error": false,
    "text": "Task #1 created: 😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀",
       "description": "",
       "status": "pending",
       "created": 1791900000,
       "updated": 1791900000
      }
     ]
    }
   },
   {
    "now": 1791900001,
    "session": "s1",
    "agent": "main",
    "tool": "task_create",
    "args": {
     "subject": "😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀",
     "epic": 0
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 1,\n \"epics\": [],\n \"active\": {},\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900000,\n   \"updated\": 1791900000\n  }\n ]\n}",
    "error": true,
    "text": "subject is 41 characters, the limit is 40: it is shown in full on the status line. Shorten it to an imperative title and move the detail to description.",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀",
       "description": "",
       "status": "pending",
       "created": 1791900000,
       "updated": 1791900000
      }
     ]
    }
   },
   {
    "now": 1791900002,
    "session": "s1",
    "agent": "main",
    "tool": "task_epic",
    "args": {
     "title": "été 📦xxxxxxxxxxxxxxx"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 1,\n \"epics\": [],\n \"active\": {},\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900000,\n   \"updated\": 1791900000\n  }\n ]\n}",
    "error": false,
    "text": "Epic #1 été 📦xxxxxxxxxxxxxxx opened and active: file its tasks with task_create(epic=1).",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "été 📦xxxxxxxxxxxxxxx",
       "created": 1791900002,
       "touched": 1791900002
      }
     ],
     "active": {
      "main": 1
     },
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀",
       "description": "",
       "status": "pending",
       "created": 1791900000,
       "updated": 1791900000
      }
     ]
    }
   },
   {
    "now": 1791900003,
    "session": "s1",
    "agent": "main",
    "tool": "task_epic",
    "args": {
     "title": "ééééééééééé"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 2,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"été 📦xxxxxxxxxxxxxxx\",\n   \"created\": 1791900002,\n   \"touched\": 1791900002\n  }\n ],\n \"active\": {\n  \"main\": 1\n },\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900000,\n   \"updated\": 1791900000\n  }\n ]\n}",
    "error": true,
    "text": "title is 22 characters, the limit is 20: it is the label of a pill on the status line. Use a short noun phrase (\"SDK status-line\", \"api-gateway\").",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "été 📦xxxxxxxxxxxxxxx",
       "created": 1791900002,
       "touched": 1791900002
      }
     ],
     "active": {
      "main": 1
     },
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀",
       "description": "",
       "status": "pending",
       "created": 1791900000,
       "updated": 1791900000
      }
     ]
    }
   }
  ]
 },
 {
  "name": "agents_keep_separate_lists",
  "steps": [
   {
    "now": 1791900000,
    "session": "s1",
    "agent": "main",
    "tool": "task_create",
    "args": {
     "subject": "Main work",
     "epic": 0
    },
    "before": null,
    "error": false,
    "text": "Task #1 created: Main work",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "Main work",
       "description": "",
       "status": "pending",
       "created": 1791900000,
       "updated": 1791900000
      }
     ]
    }
   },
   {
    "now": 1791900001,
    "session": "s1",
    "agent": "a8b9904c",
    "tool": "task_create",
    "args": {
     "subject": "Sub work",
     "epic": 0
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 1,\n \"epics\": [],\n \"active\": {},\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Main work\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900000,\n   \"updated\": 1791900000\n  }\n ]\n}",
    "error": false,
    "text": "Task #2 created: Sub work",
    "after": {
     "version": 2,
     "next_id": 3,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "Main work",
       "description": "",
       "status": "pending",
       "created": 1791900000,
       "updated": 1791900000
      },
      {
       "id": "2",
       "agent": "a8b9904c",
       "epic": 0,
       "subject": "Sub work",
       "description": "",
       "status": "pending",
       "created": 1791900001,
       "updated": 1791900001
      }
     ]
    }
   },
   {
    "now": 1791900002,
    "session": "s1",
    "agent": "a8b9904c",
    "tool": "task_list",
    "args": {},
    "before": "{\n \"version\": 2,\n \"next_id\": 3,\n \"next_epic\": 1,\n \"epics\": [],\n \"active\": {},\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Main work\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900000,\n   \"updated\": 1791900000\n  },\n  {\n   \"id\": \"2\",\n   \"agent\": \"a8b9904c\",\n   \"epic\": 0,\n   \"subject\": \"Sub work\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900001,\n   \"updated\": 1791900001\n  }\n ]\n}",
    "error": false,
    "text": "No active epic. Tasks with no epic:\n#2 [pending] Sub work",
    "after": {
     "version": 2,
     "next_id": 3,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "Main work",
       "description": "",
       "status": "pending",
       "created": 1791900000,
       "updated": 1791900000
      },
      {
       "id": "2",
       "agent": "a8b9904c",
       "epic": 0,
       "subject": "Sub work",
       "description": "",
       "status": "pending",
       "created": 1791900001,
       "updated": 1791900001
      }
     ]
    }
   },
   {
    "now": 1791900003,
    "session": "s1",
    "agent": "a8b9904c",
    "tool": "task_update",
    "args": {
     "id": "1",
     "status": "completed"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 3,\n \"next_epic\": 1,\n \"epics\": [],\n \"active\": {},\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Main work\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900000,\n   \"updated\": 1791900000\n  },\n  {\n   \"id\": \"2\",\n   \"agent\": \"a8b9904c\",\n   \"epic\": 0,\n   \"subject\": \"Sub work\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900001,\n   \"updated\": 1791900001\n  }\n ]\n}",
    "error": true,
    "text": "no task #1 in this agent's list",
    "after": {
     "version": 2,
     "next_id": 3,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "Main work",
       "description": "",
       "status": "pending",
       "created": 1791900000,
       "updated": 1791900000
      },
      {
       "id": "2",
       "agent": "a8b9904c",
       "epic": 0,
       "subject": "Sub work",
       "description": "",
       "status": "pending",
       "created": 1791900001,
       "updated": 1791900001
      }
     ]
    }
   }
  ]
 },
 {
  "name": "agent_id_is_made_path_safe",
  "steps": [
   {
    "now": 1791900000,
    "session": "s1",
    "agent": "a/b c.d",
    "tool": "task_create",
    "args": {
     "subject": "Odd agent",
     "epic": 0
    },
    "before": null,
    "error": false,
    "text": "Task #1 created: Odd agent",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "a-b-c-d",
       "epic": 0,
       "subject": "Odd agent",
       "description": "",
       "status": "pending",
       "created": 1791900000,
       "updated": 1791900000
      }
     ]
    }
   },
   {
    "now": 1791900001,
    "session": "s1",
    "agent": "a-b-c-d",
    "tool": "task_list",
    "args": {},
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 1,\n \"epics\": [],\n \"active\": {},\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"a-b-c-d\",\n   \"epic\": 0,\n   \"subject\": \"Odd agent\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900000,\n   \"updated\": 1791900000\n  }\n ]\n}",
    "error": false,
    "text": "No active epic. Tasks with no epic:\n#1 [pending] Odd agent",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "a-b-c-d",
       "epic": 0,
       "subject": "Odd agent",
       "description": "",
       "status": "pending",
       "created": 1791900000,
       "updated": 1791900000
      }
     ]
    }
   },
   {
    "now": 1791900002,
    "session": "s1",
    "agent": "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz",
    "tool": "task_create",
    "args": {
     "subject": "Long agent",
     "epic": 0
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 1,\n \"epics\": [],\n \"active\": {},\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"a-b-c-d\",\n   \"epic\": 0,\n   \"subject\": \"Odd agent\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900000,\n   \"updated\": 1791900000\n  }\n ]\n}",
    "error": false,
    "text": "Task #2 created: Long agent",
    "after": {
     "version": 2,
     "next_id": 3,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "a-b-c-d",
       "epic": 0,
       "subject": "Odd agent",
       "description": "",
       "status": "pending",
       "created": 1791900000,
       "updated": 1791900000
      },
      {
       "id": "2",
       "agent": "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz",
       "epic": 0,
       "subject": "Long agent",
       "description": "",
       "status": "pending",
       "created": 1791900002,
       "updated": 1791900002
      }
     ]
    }
   }
  ]
 },
 {
  "name": "bad_status_and_unknown_task",
  "steps": [
   {
    "now": 1791900000,
    "session": "s1",
    "agent": "main",
    "tool": "task_update",
    "args": {
     "id": "9",
     "status": "done"
    },
    "before": null,
    "error": true,
    "text": "status must be one of pending, in_progress, waiting, completed, deleted",
    "after": null
   },
   {
    "now": 1791900001,
    "session": "s1",
    "agent": "main",
    "tool": "task_update",
    "args": {
     "id": "9",
     "status": "completed"
    },
    "before": null,
    "error": true,
    "text": "no task #9 in this agent's list",
    "after": null
   }
  ]
 },
 {
  "name": "a_missing_id_names_the_field",
  "steps": [
   {
    "now": 1791900000,
    "session": "s1",
    "agent": "main",
    "tool": "task_create",
    "args": {
     "subject": "Ship it",
     "epic": 0
    },
    "before": null,
    "error": false,
    "text": "Task #1 created: Ship it",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "Ship it",
       "description": "",
       "status": "pending",
       "created": 1791900000,
       "updated": 1791900000
      }
     ]
    }
   },
   {
    "now": 1791900001,
    "session": "s1",
    "agent": "main",
    "tool": "task_update",
    "args": {
     "status": "completed",
     "task_id": "1"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 1,\n \"epics\": [],\n \"active\": {},\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Ship it\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900000,\n   \"updated\": 1791900000\n  }\n ]\n}",
    "error": true,
    "text": "task_update needs the task id: id=\"36\"",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "Ship it",
       "description": "",
       "status": "pending",
       "created": 1791900000,
       "updated": 1791900000
      }
     ]
    }
   },
   {
    "now": 1791900002,
    "session": "s1",
    "agent": "main",
    "tool": "task_update",
    "args": {
     "status": "completed",
     "id": ""
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 1,\n \"epics\": [],\n \"active\": {},\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Ship it\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900000,\n   \"updated\": 1791900000\n  }\n ]\n}",
    "error": true,
    "text": "task_update needs the task id: id=\"36\"",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "Ship it",
       "description": "",
       "status": "pending",
       "created": 1791900000,
       "updated": 1791900000
      }
     ]
    }
   },
   {
    "now": 1791900003,
    "session": "s1",
    "agent": "main",
    "tool": "task_update",
    "args": {
     "status": "completed",
     "id": "#"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 1,\n \"epics\": [],\n \"active\": {},\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Ship it\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900000,\n   \"updated\": 1791900000\n  }\n ]\n}",
    "error": true,
    "text": "task_update needs the task id: id=\"36\"",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "Ship it",
       "description": "",
       "status": "pending",
       "created": 1791900000,
       "updated": 1791900000
      }
     ]
    }
   },
   {
    "now": 1791900004,
    "session": "s1",
    "agent": "main",
    "tool": "task_update",
    "args": {
     "status": "completed"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 1,\n \"epics\": [],\n \"active\": {},\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Ship it\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900000,\n   \"updated\": 1791900000\n  }\n ]\n}",
    "error": true,
    "text": "task_update needs the task id: id=\"36\"",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "Ship it",
       "description": "",
       "status": "pending",
       "created": 1791900000,
       "updated": 1791900000
      }
     ]
    }
   },
   {
    "now": 1791900005,
    "session": "s1",
    "agent": "main",
    "tool": "task_update",
    "args": {
     "status": "completed",
     "id": 0
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 1,\n \"epics\": [],\n \"active\": {},\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Ship it\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900000,\n   \"updated\": 1791900000\n  }\n ]\n}",
    "error": true,
    "text": "task_update needs the task id: id=\"36\"",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "Ship it",
       "description": "",
       "status": "pending",
       "created": 1791900000,
       "updated": 1791900000
      }
     ]
    }
   },
   {
    "now": 1791900006,
    "session": "s1",
    "agent": "main",
    "tool": "task_update",
    "args": {
     "status": "completed",
     "id": 1
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 1,\n \"epics\": [],\n \"active\": {},\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Ship it\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900000,\n   \"updated\": 1791900000\n  }\n ]\n}",
    "error": false,
    "text": "Task #1 updated: Ship it (completed)",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "Ship it",
       "description": "",
       "status": "completed",
       "created": 1791900000,
       "updated": 1791900006
      }
     ]
    }
   }
  ]
 },
 {
  "name": "validation_order",
  "steps": [
   {
    "now": 1791900000,
    "session": "s1",
    "agent": "main",
    "tool": "task_create",
    "args": {
     "subject": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
    },
    "before": null,
    "error": true,
    "text": "subject is 41 characters, the limit is 40: it is shown in full on the status line. Shorten it to an imperative title and move the detail to description.",
    "after": null
   },
   {
    "now": 1791900001,
    "session": "s1",
    "agent": "main",
    "tool": "task_create",
    "args": {
     "epic": 0
    },
    "before": null,
    "error": true,
    "text": "subject is required",
    "after": null
   },
   {
    "now": 1791900002,
    "session": "s1",
    "agent": "main",
    "tool": "task_update",
    "args": {
     "status": "bogus",
     "subject": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
    },
    "before": null,
    "error": true,
    "text": "task_update needs the task id: id=\"36\"",
    "after": null
   },
   {
    "now": 1791900003,
    "session": "s1",
    "agent": "main",
    "tool": "task_update",
    "args": {
     "id": "1",
     "status": "bogus",
     "subject": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
    },
    "before": null,
    "error": true,
    "text": "status must be one of pending, in_progress, waiting, completed, deleted",
    "after": null
   },
   {
    "now": 1791900004,
    "session": "s1",
    "agent": "main",
    "tool": "task_update",
    "args": {
     "id": "1",
     "subject": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
    },
    "before": null,
    "error": true,
    "text": "subject is 41 characters, the limit is 40: it is shown in full on the status line. Shorten it to an imperative title and move the detail to description.",
    "after": null
   },
   {
    "now": 1791900005,
    "session": "s1",
    "agent": "main",
    "tool": "task_update",
    "args": {
     "id": "1",
     "status": "completed"
    },
    "before": null,
    "error": true,
    "text": "no task #1 in this agent's list",
    "after": null
   },
   {
    "now": 1791900006,
    "session": "s1",
    "agent": "main",
    "tool": "task_epic",
    "args": {},
    "before": null,
    "error": true,
    "text": "title is required",
    "after": null
   },
   {
    "now": 1791900007,
    "session": "s1",
    "agent": "main",
    "tool": "task_epic",
    "args": {
     "title": ""
    },
    "before": null,
    "error": true,
    "text": "title is required",
    "after": null
   }
  ]
 },
 {
  "name": "task_list_writes_nothing",
  "steps": [
   {
    "now": 1791900000,
    "session": "s1",
    "agent": "main",
    "tool": "task_list",
    "args": {},
    "before": null,
    "error": false,
    "text": "No tasks and no epic.",
    "after": null
   },
   {
    "now": 1791900001,
    "session": "s1",
    "agent": "a1",
    "tool": "task_list",
    "args": {},
    "before": null,
    "error": false,
    "text": "No tasks and no epic.",
    "after": null
   }
  ]
 },
 {
  "name": "sessions_are_isolated",
  "steps": [
   {
    "now": 1791900000,
    "session": "s1",
    "agent": "main",
    "tool": "task_create",
    "args": {
     "subject": "In one",
     "epic": 0
    },
    "before": null,
    "error": false,
    "text": "Task #1 created: In one",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "In one",
       "description": "",
       "status": "pending",
       "created": 1791900000,
       "updated": 1791900000
      }
     ]
    }
   },
   {
    "now": 1791900001,
    "session": "s2",
    "agent": "main",
    "tool": "task_create",
    "args": {
     "subject": "In two",
     "epic": 0
    },
    "before": null,
    "error": false,
    "text": "Task #1 created: In two",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "In two",
       "description": "",
       "status": "pending",
       "created": 1791900001,
       "updated": 1791900001
      }
     ]
    }
   },
   {
    "now": 1791900002,
    "session": "s2",
    "agent": "main",
    "tool": "task_list",
    "args": {},
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 1,\n \"epics\": [],\n \"active\": {},\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"In two\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900001,\n   \"updated\": 1791900001\n  }\n ]\n}",
    "error": false,
    "text": "No active epic. Tasks with no epic:\n#1 [pending] In two",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "In two",
       "description": "",
       "status": "pending",
       "created": 1791900001,
       "updated": 1791900001
      }
     ]
    }
   }
  ]
 },
 {
  "name": "epic_is_required",
  "steps": [
   {
    "now": 1791900000,
    "session": "s1",
    "agent": "main",
    "tool": "task_epic",
    "args": {
     "title": "Alpha"
    },
    "before": null,
    "error": false,
    "text": "Epic #1 Alpha opened and active: file its tasks with task_create(epic=1).",
    "after": {
     "version": 2,
     "next_id": 1,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Alpha",
       "created": 1791900000,
       "touched": 1791900000
      }
     ],
     "active": {
      "main": 1
     },
     "tasks": []
    }
   },
   {
    "now": 1791900001,
    "session": "s1",
    "agent": "main",
    "tool": "task_create",
    "args": {
     "subject": "Alpha work",
     "epic": 1
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 1,\n \"next_epic\": 2,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"Alpha\",\n   \"created\": 1791900000,\n   \"touched\": 1791900000\n  }\n ],\n \"active\": {\n  \"main\": 1\n },\n \"tasks\": []\n}",
    "error": false,
    "text": "Task #1 created: Alpha work in epic #1 Alpha",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Alpha",
       "created": 1791900000,
       "touched": 1791900001
      }
     ],
     "active": {
      "main": 1
     },
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 1,
       "subject": "Alpha work",
       "description": "",
       "status": "pending",
       "created": 1791900001,
       "updated": 1791900001
      }
     ]
    }
   },
   {
    "now": 1791900002,
    "session": "s1",
    "agent": "main",
    "tool": "task_epic",
    "args": {
     "title": "Beta"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 2,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"Alpha\",\n   \"created\": 1791900000,\n   \"touched\": 1791900001\n  }\n ],\n \"active\": {\n  \"main\": 1\n },\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Alpha work\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900001,\n   \"updated\": 1791900001\n  }\n ]\n}",
    "error": false,
    "text": "Epic #2 Beta opened and active: file its tasks with task_create(epic=2). Still open: #1 Alpha.",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 3,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Alpha",
       "created": 1791900000,
       "touched": 1791900001
      },
      {
       "id": 2,
       "agent": "main",
       "title": "Beta",
       "created": 1791900002,
       "touched": 1791900002
      }
     ],
     "active": {
      "main": 2
     },
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 1,
       "subject": "Alpha work",
       "description": "",
       "status": "pending",
       "created": 1791900001,
       "updated": 1791900001
      }
     ]
    }
   },
   {
    "now": 1791900003,
    "session": "s1",
    "agent": "main",
    "tool": "task_create",
    "args": {
     "subject": "Where does it go"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 3,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"Alpha\",\n   \"created\": 1791900000,\n   \"touched\": 1791900001\n  },\n  {\n   \"id\": 2,\n   \"agent\": \"main\",\n   \"title\": \"Beta\",\n   \"created\": 1791900002,\n   \"touched\": 1791900002\n  }\n ],\n \"active\": {\n  \"main\": 2\n },\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Alpha work\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900001,\n   \"updated\": 1791900001\n  }\n ]\n}",
    "error": true,
    "text": "epic is required: name the epic this task belongs to; open epics: #2 Beta (active), #1 Alpha. task_create(subject, epic=<id>) files the task in one of your epics; epic=0 files it outside any epic; task_epic(title) opens a new epic first.",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 3,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Alpha",
       "created": 1791900000,
       "touched": 1791900001
      },
      {
       "id": 2,
       "agent": "main",
       "title": "Beta",
       "created": 1791900002,
       "touched": 1791900002
      }
     ],
     "active": {
      "main": 2
     },
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 1,
       "subject": "Alpha work",
       "description": "",
       "status": "pending",
       "created": 1791900001,
       "updated": 1791900001
      }
     ]
    }
   },
   {
    "now": 1791900004,
    "session": "s1",
    "agent": "main",
    "tool": "task_create",
    "args": {
     "subject": "Blank epic",
     "epic": ""
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 3,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"Alpha\",\n   \"created\": 1791900000,\n   \"touched\": 1791900001\n  },\n  {\n   \"id\": 2,\n   \"agent\": \"main\",\n   \"title\": \"Beta\",\n   \"created\": 1791900002,\n   \"touched\": 1791900002\n  }\n ],\n \"active\": {\n  \"main\": 2\n },\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Alpha work\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900001,\n   \"updated\": 1791900001\n  }\n ]\n}",
    "error": true,
    "text": "epic is required: name the epic this task belongs to; open epics: #2 Beta (active), #1 Alpha. task_create(subject, epic=<id>) files the task in one of your epics; epic=0 files it outside any epic; task_epic(title) opens a new epic first.",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 3,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Alpha",
       "created": 1791900000,
       "touched": 1791900001
      },
      {
       "id": 2,
       "agent": "main",
       "title": "Beta",
       "created": 1791900002,
       "touched": 1791900002
      }
     ],
     "active": {
      "main": 2
     },
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 1,
       "subject": "Alpha work",
       "description": "",
       "status": "pending",
       "created": 1791900001,
       "updated": 1791900001
      }
     ]
    }
   },
   {
    "now": 1791900005,
    "session": "s1",
    "agent": "main",
    "tool": "task_create",
    "args": {
     "subject": "Blank epic",
     "epic": null
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 3,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"Alpha\",\n   \"created\": 1791900000,\n   \"touched\": 1791900001\n  },\n  {\n   \"id\": 2,\n   \"agent\": \"main\",\n   \"title\": \"Beta\",\n   \"created\": 1791900002,\n   \"touched\": 1791900002\n  }\n ],\n \"active\": {\n  \"main\": 2\n },\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Alpha work\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900001,\n   \"updated\": 1791900001\n  }\n ]\n}",
    "error": true,
    "text": "epic is required: name the epic this task belongs to; open epics: #2 Beta (active), #1 Alpha. task_create(subject, epic=<id>) files the task in one of your epics; epic=0 files it outside any epic; task_epic(title) opens a new epic first.",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 3,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Alpha",
       "created": 1791900000,
       "touched": 1791900001
      },
      {
       "id": 2,
       "agent": "main",
       "title": "Beta",
       "created": 1791900002,
       "touched": 1791900002
      }
     ],
     "active": {
      "main": 2
     },
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 1,
       "subject": "Alpha work",
       "description": "",
       "status": "pending",
       "created": 1791900001,
       "updated": 1791900001
      }
     ]
    }
   }
  ]
 },
 {
  "name": "epic_zero_is_no_epic",
  "steps": [
   {
    "now": 1791900000,
    "session": "s1",
    "agent": "main",
    "tool": "task_epic",
    "args": {
     "title": "Alpha"
    },
    "before": null,
    "error": false,
    "text": "Epic #1 Alpha opened and active: file its tasks with task_create(epic=1).",
    "after": {
     "version": 2,
     "next_id": 1,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Alpha",
       "created": 1791900000,
       "touched": 1791900000
      }
     ],
     "active": {
      "main": 1
     },
     "tasks": []
    }
   },
   {
    "now": 1791900001,
    "session": "s1",
    "agent": "main",
    "tool": "task_create",
    "args": {
     "subject": "Loose",
     "epic": 0
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 1,\n \"next_epic\": 2,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"Alpha\",\n   \"created\": 1791900000,\n   \"touched\": 1791900000\n  }\n ],\n \"active\": {\n  \"main\": 1\n },\n \"tasks\": []\n}",
    "error": false,
    "text": "Task #1 created: Loose",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Alpha",
       "created": 1791900000,
       "touched": 1791900000
      }
     ],
     "active": {
      "main": 1
     },
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "Loose",
       "description": "",
       "status": "pending",
       "created": 1791900001,
       "updated": 1791900001
      }
     ]
    }
   },
   {
    "now": 1791900002,
    "session": "s1",
    "agent": "main",
    "tool": "task_create",
    "args": {
     "subject": "Loose too",
     "epic": "0"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 2,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"Alpha\",\n   \"created\": 1791900000,\n   \"touched\": 1791900000\n  }\n ],\n \"active\": {\n  \"main\": 1\n },\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Loose\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900001,\n   \"updated\": 1791900001\n  }\n ]\n}",
    "error": false,
    "text": "Task #2 created: Loose too",
    "after": {
     "version": 2,
     "next_id": 3,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Alpha",
       "created": 1791900000,
       "touched": 1791900000
      }
     ],
     "active": {
      "main": 1
     },
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "Loose",
       "description": "",
       "status": "pending",
       "created": 1791900001,
       "updated": 1791900001
      },
      {
       "id": "2",
       "agent": "main",
       "epic": 0,
       "subject": "Loose too",
       "description": "",
       "status": "pending",
       "created": 1791900002,
       "updated": 1791900002
      }
     ]
    }
   }
  ]
 },
 {
  "name": "unknown_epic_is_refused",
  "steps": [
   {
    "now": 1791900000,
    "session": "s1",
    "agent": "main",
    "tool": "task_epic",
    "args": {
     "title": "Alpha"
    },
    "before": null,
    "error": false,
    "text": "Epic #1 Alpha opened and active: file its tasks with task_create(epic=1).",
    "after": {
     "version": 2,
     "next_id": 1,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Alpha",
       "created": 1791900000,
       "touched": 1791900000
      }
     ],
     "active": {
      "main": 1
     },
     "tasks": []
    }
   },
   {
    "now": 1791900001,
    "session": "s1",
    "agent": "main",
    "tool": "task_create",
    "args": {
     "subject": "Lost",
     "epic": 9
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 1,\n \"next_epic\": 2,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"Alpha\",\n   \"created\": 1791900000,\n   \"touched\": 1791900000\n  }\n ],\n \"active\": {\n  \"main\": 1\n },\n \"tasks\": []\n}",
    "error": true,
    "text": "no epic 9 for this agent; open epics: #1 Alpha (active). task_create(subject, epic=<id>) files the task in one of your epics; epic=0 files it outside any epic; task_epic(title) opens a new epic first.",
    "after": {
     "version": 2,
     "next_id": 1,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Alpha",
       "created": 1791900000,
       "touched": 1791900000
      }
     ],
     "active": {
      "main": 1
     },
     "tasks": []
    }
   },
   {
    "now": 1791900002,
    "session": "s1",
    "agent": "main",
    "tool": "task_create",
    "args": {
     "subject": "Lost",
     "epic": "#9"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 1,\n \"next_epic\": 2,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"Alpha\",\n   \"created\": 1791900000,\n   \"touched\": 1791900000\n  }\n ],\n \"active\": {\n  \"main\": 1\n },\n \"tasks\": []\n}",
    "error": true,
    "text": "no epic #9 for this agent; open epics: #1 Alpha (active). task_create(subject, epic=<id>) files the task in one of your epics; epic=0 files it outside any epic; task_epic(title) opens a new epic first.",
    "after": {
     "version": 2,
     "next_id": 1,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Alpha",
       "created": 1791900000,
       "touched": 1791900000
      }
     ],
     "active": {
      "main": 1
     },
     "tasks": []
    }
   },
   {
    "now": 1791900003,
    "session": "s1",
    "agent": "main",
    "tool": "task_create",
    "args": {
     "subject": "Lost",
     "epic": "nope"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 1,\n \"next_epic\": 2,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"Alpha\",\n   \"created\": 1791900000,\n   \"touched\": 1791900000\n  }\n ],\n \"active\": {\n  \"main\": 1\n },\n \"tasks\": []\n}",
    "error": true,
    "text": "no epic nope for this agent; open epics: #1 Alpha (active). task_create(subject, epic=<id>) files the task in one of your epics; epic=0 files it outside any epic; task_epic(title) opens a new epic first.",
    "after": {
     "version": 2,
     "next_id": 1,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Alpha",
       "created": 1791900000,
       "touched": 1791900000
      }
     ],
     "active": {
      "main": 1
     },
     "tasks": []
    }
   },
   {
    "now": 1791900004,
    "session": "s1",
    "agent": "main",
    "tool": "task_create",
    "args": {
     "subject": "Lost",
     "epic": -1
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 1,\n \"next_epic\": 2,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"Alpha\",\n   \"created\": 1791900000,\n   \"touched\": 1791900000\n  }\n ],\n \"active\": {\n  \"main\": 1\n },\n \"tasks\": []\n}",
    "error": true,
    "text": "no epic -1 for this agent; open epics: #1 Alpha (active). task_create(subject, epic=<id>) files the task in one of your epics; epic=0 files it outside any epic; task_epic(title) opens a new epic first.",
    "after": {
     "version": 2,
     "next_id": 1,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Alpha",
       "created": 1791900000,
       "touched": 1791900000
      }
     ],
     "active": {
      "main": 1
     },
     "tasks": []
    }
   },
   {
    "now": 1791900005,
    "session": "s1",
    "agent": "main",
    "tool": "task_create",
    "args": {
     "subject": "Found",
     "epic": "#1"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 1,\n \"next_epic\": 2,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"Alpha\",\n   \"created\": 1791900000,\n   \"touched\": 1791900000\n  }\n ],\n \"active\": {\n  \"main\": 1\n },\n \"tasks\": []\n}",
    "error": false,
    "text": "Task #1 created: Found in epic #1 Alpha",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Alpha",
       "created": 1791900000,
       "touched": 1791900005
      }
     ],
     "active": {
      "main": 1
     },
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 1,
       "subject": "Found",
       "description": "",
       "status": "pending",
       "created": 1791900005,
       "updated": 1791900005
      }
     ]
    }
   },
   {
    "now": 1791900006,
    "session": "s1",
    "agent": "main",
    "tool": "task_create",
    "args": {
     "subject": "Found too",
     "epic": " ##1 "
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 2,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"Alpha\",\n   \"created\": 1791900000,\n   \"touched\": 1791900005\n  }\n ],\n \"active\": {\n  \"main\": 1\n },\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Found\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900005,\n   \"updated\": 1791900005\n  }\n ]\n}",
    "error": false,
    "text": "Task #2 created: Found too in epic #1 Alpha",
    "after": {
     "version": 2,
     "next_id": 3,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Alpha",
       "created": 1791900000,
       "touched": 1791900006
      }
     ],
     "active": {
      "main": 1
     },
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 1,
       "subject": "Found",
       "description": "",
       "status": "pending",
       "created": 1791900005,
       "updated": 1791900005
      },
      {
       "id": "2",
       "agent": "main",
       "epic": 1,
       "subject": "Found too",
       "description": "",
       "status": "pending",
       "created": 1791900006,
       "updated": 1791900006
      }
     ]
    }
   }
  ]
 },
 {
  "name": "subagent_uses_its_own_epics",
  "steps": [
   {
    "now": 1791900000,
    "session": "s1",
    "agent": "main",
    "tool": "task_epic",
    "args": {
     "title": "Main epic"
    },
    "before": null,
    "error": false,
    "text": "Epic #1 Main epic opened and active: file its tasks with task_create(epic=1).",
    "after": {
     "version": 2,
     "next_id": 1,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Main epic",
       "created": 1791900000,
       "touched": 1791900000
      }
     ],
     "active": {
      "main": 1
     },
     "tasks": []
    }
   },
   {
    "now": 1791900001,
    "session": "s1",
    "agent": "a1",
    "tool": "task_epic",
    "args": {
     "title": "Sub epic"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 1,\n \"next_epic\": 2,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"Main epic\",\n   \"created\": 1791900000,\n   \"touched\": 1791900000\n  }\n ],\n \"active\": {\n  \"main\": 1\n },\n \"tasks\": []\n}",
    "error": false,
    "text": "Epic #2 Sub epic opened and active: file its tasks with task_create(epic=2).",
    "after": {
     "version": 2,
     "next_id": 1,
     "next_epic": 3,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Main epic",
       "created": 1791900000,
       "touched": 1791900000
      },
      {
       "id": 2,
       "agent": "a1",
       "title": "Sub epic",
       "created": 1791900001,
       "touched": 1791900001
      }
     ],
     "active": {
      "main": 1,
      "a1": 2
     },
     "tasks": []
    }
   },
   {
    "now": 1791900002,
    "session": "s1",
    "agent": "a1",
    "tool": "task_create",
    "args": {
     "subject": "Sub task"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 1,\n \"next_epic\": 3,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"Main epic\",\n   \"created\": 1791900000,\n   \"touched\": 1791900000\n  },\n  {\n   \"id\": 2,\n   \"agent\": \"a1\",\n   \"title\": \"Sub epic\",\n   \"created\": 1791900001,\n   \"touched\": 1791900001\n  }\n ],\n \"active\": {\n  \"main\": 1,\n  \"a1\": 2\n },\n \"tasks\": []\n}",
    "error": true,
    "text": "epic is required: name the epic this task belongs to; open epics: #2 Sub epic (active). task_create(subject, epic=<id>) files the task in one of your epics; epic=0 files it outside any epic; task_epic(title) opens a new epic first.",
    "after": {
     "version": 2,
     "next_id": 1,
     "next_epic": 3,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Main epic",
       "created": 1791900000,
       "touched": 1791900000
      },
      {
       "id": 2,
       "agent": "a1",
       "title": "Sub epic",
       "created": 1791900001,
       "touched": 1791900001
      }
     ],
     "active": {
      "main": 1,
      "a1": 2
     },
     "tasks": []
    }
   },
   {
    "now": 1791900003,
    "session": "s1",
    "agent": "a1",
    "tool": "task_create",
    "args": {
     "subject": "Sub task",
     "epic": 2
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 1,\n \"next_epic\": 3,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"Main epic\",\n   \"created\": 1791900000,\n   \"touched\": 1791900000\n  },\n  {\n   \"id\": 2,\n   \"agent\": \"a1\",\n   \"title\": \"Sub epic\",\n   \"created\": 1791900001,\n   \"touched\": 1791900001\n  }\n ],\n \"active\": {\n  \"main\": 1,\n  \"a1\": 2\n },\n \"tasks\": []\n}",
    "error": false,
    "text": "Task #1 created: Sub task in epic #2 Sub epic",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 3,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Main epic",
       "created": 1791900000,
       "touched": 1791900000
      },
      {
       "id": 2,
       "agent": "a1",
       "title": "Sub epic",
       "created": 1791900001,
       "touched": 1791900003
      }
     ],
     "active": {
      "main": 1,
      "a1": 2
     },
     "tasks": [
      {
       "id": "1",
       "agent": "a1",
       "epic": 2,
       "subject": "Sub task",
       "description": "",
       "status": "pending",
       "created": 1791900003,
       "updated": 1791900003
      }
     ]
    }
   },
   {
    "now": 1791900004,
    "session": "s1",
    "agent": "a1",
    "tool": "task_create",
    "args": {
     "subject": "Steal",
     "epic": 1
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 3,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"Main epic\",\n   \"created\": 1791900000,\n   \"touched\": 1791900000\n  },\n  {\n   \"id\": 2,\n   \"agent\": \"a1\",\n   \"title\": \"Sub epic\",\n   \"created\": 1791900001,\n   \"touched\": 1791900003\n  }\n ],\n \"active\": {\n  \"main\": 1,\n  \"a1\": 2\n },\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"a1\",\n   \"epic\": 2,\n   \"subject\": \"Sub task\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900003,\n   \"updated\": 1791900003\n  }\n ]\n}",
    "error": true,
    "text": "no epic 1 for this agent; open epics: #2 Sub epic (active). task_create(subject, epic=<id>) files the task in one of your epics; epic=0 files it outside any epic; task_epic(title) opens a new epic first.",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 3,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Main epic",
       "created": 1791900000,
       "touched": 1791900000
      },
      {
       "id": 2,
       "agent": "a1",
       "title": "Sub epic",
       "created": 1791900001,
       "touched": 1791900003
      }
     ],
     "active": {
      "main": 1,
      "a1": 2
     },
     "tasks": [
      {
       "id": "1",
       "agent": "a1",
       "epic": 2,
       "subject": "Sub task",
       "description": "",
       "status": "pending",
       "created": 1791900003,
       "updated": 1791900003
      }
     ]
    }
   },
   {
    "now": 1791900005,
    "session": "s1",
    "agent": "main",
    "tool": "task_create",
    "args": {
     "subject": "Steal",
     "epic": 2
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 3,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"Main epic\",\n   \"created\": 1791900000,\n   \"touched\": 1791900000\n  },\n  {\n   \"id\": 2,\n   \"agent\": \"a1\",\n   \"title\": \"Sub epic\",\n   \"created\": 1791900001,\n   \"touched\": 1791900003\n  }\n ],\n \"active\": {\n  \"main\": 1,\n  \"a1\": 2\n },\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"a1\",\n   \"epic\": 2,\n   \"subject\": \"Sub task\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900003,\n   \"updated\": 1791900003\n  }\n ]\n}",
    "error": true,
    "text": "no epic 2 for this agent; open epics: #1 Main epic (active). task_create(subject, epic=<id>) files the task in one of your epics; epic=0 files it outside any epic; task_epic(title) opens a new epic first.",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 3,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Main epic",
       "created": 1791900000,
       "touched": 1791900000
      },
      {
       "id": 2,
       "agent": "a1",
       "title": "Sub epic",
       "created": 1791900001,
       "touched": 1791900003
      }
     ],
     "active": {
      "main": 1,
      "a1": 2
     },
     "tasks": [
      {
       "id": "1",
       "agent": "a1",
       "epic": 2,
       "subject": "Sub task",
       "description": "",
       "status": "pending",
       "created": 1791900003,
       "updated": 1791900003
      }
     ]
    }
   }
  ]
 },
 {
  "name": "list_shapes",
  "steps": [
   {
    "now": 1791900000,
    "session": "s1",
    "agent": "main",
    "tool": "task_list",
    "args": {},
    "before": null,
    "error": false,
    "text": "No tasks and no epic.",
    "after": null
   },
   {
    "now": 1791900001,
    "session": "s1",
    "agent": "main",
    "tool": "task_create",
    "args": {
     "subject": "Loose",
     "epic": 0
    },
    "before": null,
    "error": false,
    "text": "Task #1 created: Loose",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "Loose",
       "description": "",
       "status": "pending",
       "created": 1791900001,
       "updated": 1791900001
      }
     ]
    }
   },
   {
    "now": 1791900002,
    "session": "s1",
    "agent": "main",
    "tool": "task_list",
    "args": {},
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 1,\n \"epics\": [],\n \"active\": {},\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Loose\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900001,\n   \"updated\": 1791900001\n  }\n ]\n}",
    "error": false,
    "text": "No active epic. Tasks with no epic:\n#1 [pending] Loose",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 1,
     "epics": [],
     "active": {},
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "Loose",
       "description": "",
       "status": "pending",
       "created": 1791900001,
       "updated": 1791900001
      }
     ]
    }
   },
   {
    "now": 1791900003,
    "session": "s1",
    "agent": "main",
    "tool": "task_epic",
    "args": {
     "title": "Empty"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 1,\n \"epics\": [],\n \"active\": {},\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Loose\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900001,\n   \"updated\": 1791900001\n  }\n ]\n}",
    "error": false,
    "text": "Epic #1 Empty opened and active: file its tasks with task_create(epic=1).",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Empty",
       "created": 1791900003,
       "touched": 1791900003
      }
     ],
     "active": {
      "main": 1
     },
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "Loose",
       "description": "",
       "status": "pending",
       "created": 1791900001,
       "updated": 1791900001
      }
     ]
    }
   },
   {
    "now": 1791900004,
    "session": "s1",
    "agent": "main",
    "tool": "task_list",
    "args": {},
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 2,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"Empty\",\n   \"created\": 1791900003,\n   \"touched\": 1791900003\n  }\n ],\n \"active\": {\n  \"main\": 1\n },\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Loose\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900001,\n   \"updated\": 1791900001\n  }\n ]\n}",
    "error": false,
    "text": "Epic #1: Empty (active, 0/0)\nNo tasks yet.\nTasks with no epic:\n#1 [pending] Loose",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Empty",
       "created": 1791900003,
       "touched": 1791900003
      }
     ],
     "active": {
      "main": 1
     },
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "Loose",
       "description": "",
       "status": "pending",
       "created": 1791900001,
       "updated": 1791900001
      }
     ]
    }
   },
   {
    "now": 1791900005,
    "session": "s1",
    "agent": "main",
    "tool": "task_epic",
    "args": {
     "title": "Second"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 2,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"Empty\",\n   \"created\": 1791900003,\n   \"touched\": 1791900003\n  }\n ],\n \"active\": {\n  \"main\": 1\n },\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Loose\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900001,\n   \"updated\": 1791900001\n  }\n ]\n}",
    "error": false,
    "text": "Epic #2 Second opened and active: file its tasks with task_create(epic=2).",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 3,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Empty",
       "created": 1791900003,
       "touched": 1791900003
      },
      {
       "id": 2,
       "agent": "main",
       "title": "Second",
       "created": 1791900005,
       "touched": 1791900005
      }
     ],
     "active": {
      "main": 2
     },
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "Loose",
       "description": "",
       "status": "pending",
       "created": 1791900001,
       "updated": 1791900001
      }
     ]
    }
   },
   {
    "now": 1791900006,
    "session": "s1",
    "agent": "main",
    "tool": "task_create",
    "args": {
     "subject": "A",
     "epic": 2
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 3,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"Empty\",\n   \"created\": 1791900003,\n   \"touched\": 1791900003\n  },\n  {\n   \"id\": 2,\n   \"agent\": \"main\",\n   \"title\": \"Second\",\n   \"created\": 1791900005,\n   \"touched\": 1791900005\n  }\n ],\n \"active\": {\n  \"main\": 2\n },\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Loose\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900001,\n   \"updated\": 1791900001\n  }\n ]\n}",
    "error": false,
    "text": "Task #2 created: A in epic #2 Second",
    "after": {
     "version": 2,
     "next_id": 3,
     "next_epic": 3,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Empty",
       "created": 1791900003,
       "touched": 1791900003
      },
      {
       "id": 2,
       "agent": "main",
       "title": "Second",
       "created": 1791900005,
       "touched": 1791900006
      }
     ],
     "active": {
      "main": 2
     },
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "Loose",
       "description": "",
       "status": "pending",
       "created": 1791900001,
       "updated": 1791900001
      },
      {
       "id": "2",
       "agent": "main",
       "epic": 2,
       "subject": "A",
       "description": "",
       "status": "pending",
       "created": 1791900006,
       "updated": 1791900006
      }
     ]
    }
   },
   {
    "now": 1791900007,
    "session": "s1",
    "agent": "main",
    "tool": "task_update",
    "args": {
     "id": "2",
     "status": "completed"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 3,\n \"next_epic\": 3,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"Empty\",\n   \"created\": 1791900003,\n   \"touched\": 1791900003\n  },\n  {\n   \"id\": 2,\n   \"agent\": \"main\",\n   \"title\": \"Second\",\n   \"created\": 1791900005,\n   \"touched\": 1791900006\n  }\n ],\n \"active\": {\n  \"main\": 2\n },\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Loose\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900001,\n   \"updated\": 1791900001\n  },\n  {\n   \"id\": \"2\",\n   \"agent\": \"main\",\n   \"epic\": 2,\n   \"subject\": \"A\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900006,\n   \"updated\": 1791900006\n  }\n ]\n}",
    "error": false,
    "text": "Task #2 updated: A (completed)",
    "after": {
     "version": 2,
     "next_id": 3,
     "next_epic": 3,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Empty",
       "created": 1791900003,
       "touched": 1791900003
      },
      {
       "id": 2,
       "agent": "main",
       "title": "Second",
       "created": 1791900005,
       "touched": 1791900007
      }
     ],
     "active": {
      "main": 2
     },
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "Loose",
       "description": "",
       "status": "pending",
       "created": 1791900001,
       "updated": 1791900001
      },
      {
       "id": "2",
       "agent": "main",
       "epic": 2,
       "subject": "A",
       "description": "",
       "status": "completed",
       "created": 1791900006,
       "updated": 1791900007
      }
     ]
    }
   },
   {
    "now": 1791900008,
    "session": "s1",
    "agent": "main",
    "tool": "task_list",
    "args": {},
    "before": "{\n \"version\": 2,\n \"next_id\": 3,\n \"next_epic\": 3,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"Empty\",\n   \"created\": 1791900003,\n   \"touched\": 1791900003\n  },\n  {\n   \"id\": 2,\n   \"agent\": \"main\",\n   \"title\": \"Second\",\n   \"created\": 1791900005,\n   \"touched\": 1791900007\n  }\n ],\n \"active\": {\n  \"main\": 2\n },\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 0,\n   \"subject\": \"Loose\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791900001,\n   \"updated\": 1791900001\n  },\n  {\n   \"id\": \"2\",\n   \"agent\": \"main\",\n   \"epic\": 2,\n   \"subject\": \"A\",\n   \"description\": \"\",\n   \"status\": \"completed\",\n   \"created\": 1791900006,\n   \"updated\": 1791900007\n  }\n ]\n}",
    "error": false,
    "text": "Epic #2: Second (active, 1/1)\n#2 [completed] A\nTasks with no epic:\n#1 [pending] Loose",
    "after": {
     "version": 2,
     "next_id": 3,
     "next_epic": 3,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Empty",
       "created": 1791900003,
       "touched": 1791900003
      },
      {
       "id": 2,
       "agent": "main",
       "title": "Second",
       "created": 1791900005,
       "touched": 1791900007
      }
     ],
     "active": {
      "main": 2
     },
     "tasks": [
      {
       "id": "1",
       "agent": "main",
       "epic": 0,
       "subject": "Loose",
       "description": "",
       "status": "pending",
       "created": 1791900001,
       "updated": 1791900001
      },
      {
       "id": "2",
       "agent": "main",
       "epic": 2,
       "subject": "A",
       "description": "",
       "status": "completed",
       "created": 1791900006,
       "updated": 1791900007
      }
     ]
    }
   }
  ]
 }
];

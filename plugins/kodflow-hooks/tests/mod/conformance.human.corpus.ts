// The user's tasks (task_assign_human), added after the port: written from
// scenarios, each answer read and checked by hand before it was kept.
// Same shape as conformance.corpus.ts, replayed by conformance.ts.
export const HUMAN_CORPUS = [
 {
  "name": "human: assign, list, close",
  "steps": [
   {
    "now": 1791950000,
    "session": "s1",
    "agent": "main",
    "tool": "task_epic",
    "args": {
     "title": "NAS reboot"
    },
    "before": null,
    "error": false,
    "text": "Epic #1 NAS reboot opened and active: file its tasks with task_create(epic=1).",
    "after": {
     "version": 2,
     "next_id": 1,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "NAS reboot",
       "created": 1791950000,
       "touched": 1791950000
      }
     ],
     "active": {
      "main": 1
     },
     "tasks": []
    }
   },
   {
    "now": 1791950001,
    "session": "s1",
    "agent": "main",
    "tool": "task_assign_human",
    "args": {
     "subject": "Give the go for the reboot",
     "epic": 1,
     "description": "Reply go once the backup is checked."
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 1,\n \"next_epic\": 2,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"NAS reboot\",\n   \"created\": 1791950000,\n   \"touched\": 1791950000\n  }\n ],\n \"active\": {\n  \"main\": 1\n },\n \"tasks\": []\n}",
    "error": false,
    "text": "Task #1 assigned to the user, waiting: Give the go for the reboot in epic #1 NAS reboot. Ask them for it in your reply; once they have answered, task_update(id=\"1\", status=\"completed\").",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "NAS reboot",
       "created": 1791950000,
       "touched": 1791950001
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
       "subject": "Give the go for the reboot",
       "description": "Reply go once the backup is checked.",
       "status": "waiting",
       "assignee": "human",
       "created": 1791950001,
       "updated": 1791950001
      }
     ]
    }
   },
   {
    "now": 1791950002,
    "session": "s1",
    "agent": "main",
    "tool": "task_list",
    "args": {},
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 2,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"NAS reboot\",\n   \"created\": 1791950000,\n   \"touched\": 1791950001\n  }\n ],\n \"active\": {\n  \"main\": 1\n },\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Give the go for the reboot\",\n   \"description\": \"Reply go once the backup is checked.\",\n   \"status\": \"waiting\",\n   \"assignee\": \"human\",\n   \"created\": 1791950001,\n   \"updated\": 1791950001\n  }\n ]\n}",
    "error": false,
    "text": "Epic #1: NAS reboot (active, 0/1)\n#1 [waiting] Give the go for the reboot (assigned to the user)",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "NAS reboot",
       "created": 1791950000,
       "touched": 1791950001
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
       "subject": "Give the go for the reboot",
       "description": "Reply go once the backup is checked.",
       "status": "waiting",
       "assignee": "human",
       "created": 1791950001,
       "updated": 1791950001
      }
     ]
    }
   },
   {
    "now": 1791950003,
    "session": "s1",
    "agent": "main",
    "tool": "task_update",
    "args": {
     "id": "1",
     "status": "in_progress"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 2,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"NAS reboot\",\n   \"created\": 1791950000,\n   \"touched\": 1791950001\n  }\n ],\n \"active\": {\n  \"main\": 1\n },\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Give the go for the reboot\",\n   \"description\": \"Reply go once the backup is checked.\",\n   \"status\": \"waiting\",\n   \"assignee\": \"human\",\n   \"created\": 1791950001,\n   \"updated\": 1791950001\n  }\n ]\n}",
    "error": true,
    "text": "#1 is assigned to the user: it stays waiting until they answer, then completed (or deleted when it no longer applies).",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "NAS reboot",
       "created": 1791950000,
       "touched": 1791950001
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
       "subject": "Give the go for the reboot",
       "description": "Reply go once the backup is checked.",
       "status": "waiting",
       "assignee": "human",
       "created": 1791950001,
       "updated": 1791950001
      }
     ]
    }
   },
   {
    "now": 1791950004,
    "session": "s1",
    "agent": "main",
    "tool": "task_update",
    "args": {
     "id": "1",
     "status": "pending"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 2,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"NAS reboot\",\n   \"created\": 1791950000,\n   \"touched\": 1791950001\n  }\n ],\n \"active\": {\n  \"main\": 1\n },\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Give the go for the reboot\",\n   \"description\": \"Reply go once the backup is checked.\",\n   \"status\": \"waiting\",\n   \"assignee\": \"human\",\n   \"created\": 1791950001,\n   \"updated\": 1791950001\n  }\n ]\n}",
    "error": true,
    "text": "#1 is assigned to the user: it stays waiting until they answer, then completed (or deleted when it no longer applies).",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "NAS reboot",
       "created": 1791950000,
       "touched": 1791950001
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
       "subject": "Give the go for the reboot",
       "description": "Reply go once the backup is checked.",
       "status": "waiting",
       "assignee": "human",
       "created": 1791950001,
       "updated": 1791950001
      }
     ]
    }
   },
   {
    "now": 1791950005,
    "session": "s1",
    "agent": "main",
    "tool": "task_update",
    "args": {
     "id": "1",
     "status": "in_progress",
     "worker": "x"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 2,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"NAS reboot\",\n   \"created\": 1791950000,\n   \"touched\": 1791950001\n  }\n ],\n \"active\": {\n  \"main\": 1\n },\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Give the go for the reboot\",\n   \"description\": \"Reply go once the backup is checked.\",\n   \"status\": \"waiting\",\n   \"assignee\": \"human\",\n   \"created\": 1791950001,\n   \"updated\": 1791950001\n  }\n ]\n}",
    "error": true,
    "text": "#1 is assigned to the user: it stays waiting until they answer, then completed (or deleted when it no longer applies).",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "NAS reboot",
       "created": 1791950000,
       "touched": 1791950001
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
       "subject": "Give the go for the reboot",
       "description": "Reply go once the backup is checked.",
       "status": "waiting",
       "assignee": "human",
       "created": 1791950001,
       "updated": 1791950001
      }
     ]
    }
   },
   {
    "now": 1791950006,
    "session": "s1",
    "agent": "main",
    "tool": "task_update",
    "args": {
     "id": "1",
     "status": "waiting",
     "description": "Reply go."
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 2,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"NAS reboot\",\n   \"created\": 1791950000,\n   \"touched\": 1791950001\n  }\n ],\n \"active\": {\n  \"main\": 1\n },\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Give the go for the reboot\",\n   \"description\": \"Reply go once the backup is checked.\",\n   \"status\": \"waiting\",\n   \"assignee\": \"human\",\n   \"created\": 1791950001,\n   \"updated\": 1791950001\n  }\n ]\n}",
    "error": false,
    "text": "Task #1 updated: Give the go for the reboot (waiting)",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "NAS reboot",
       "created": 1791950000,
       "touched": 1791950006
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
       "subject": "Give the go for the reboot",
       "description": "Reply go.",
       "status": "waiting",
       "assignee": "human",
       "created": 1791950001,
       "updated": 1791950006
      }
     ]
    }
   },
   {
    "now": 1791950007,
    "session": "s1",
    "agent": "main",
    "tool": "task_update",
    "args": {
     "id": "1",
     "status": "completed"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 2,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"NAS reboot\",\n   \"created\": 1791950000,\n   \"touched\": 1791950006\n  }\n ],\n \"active\": {\n  \"main\": 1\n },\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Give the go for the reboot\",\n   \"description\": \"Reply go.\",\n   \"status\": \"waiting\",\n   \"assignee\": \"human\",\n   \"created\": 1791950001,\n   \"updated\": 1791950006\n  }\n ]\n}",
    "error": false,
    "text": "Task #1 updated: Give the go for the reboot (completed)",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "NAS reboot",
       "created": 1791950000,
       "touched": 1791950007
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
       "subject": "Give the go for the reboot",
       "description": "Reply go.",
       "status": "completed",
       "assignee": "human",
       "created": 1791950001,
       "updated": 1791950007
      }
     ]
    }
   },
   {
    "now": 1791950008,
    "session": "s1",
    "agent": "main",
    "tool": "task_list",
    "args": {},
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 2,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"NAS reboot\",\n   \"created\": 1791950000,\n   \"touched\": 1791950007\n  }\n ],\n \"active\": {\n  \"main\": 1\n },\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Give the go for the reboot\",\n   \"description\": \"Reply go.\",\n   \"status\": \"completed\",\n   \"assignee\": \"human\",\n   \"created\": 1791950001,\n   \"updated\": 1791950007\n  }\n ]\n}",
    "error": false,
    "text": "Epic #1: NAS reboot (active, 1/1)\n#1 [completed] Give the go for the reboot (assigned to the user)",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "NAS reboot",
       "created": 1791950000,
       "touched": 1791950007
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
       "subject": "Give the go for the reboot",
       "description": "Reply go.",
       "status": "completed",
       "assignee": "human",
       "created": 1791950001,
       "updated": 1791950007
      }
     ]
    }
   }
  ]
 },
 {
  "name": "human: refusals",
  "steps": [
   {
    "now": 1791950000,
    "session": "s1",
    "agent": "main",
    "tool": "task_epic",
    "args": {
     "title": "Vault"
    },
    "before": null,
    "error": false,
    "text": "Epic #1 Vault opened and active: file its tasks with task_create(epic=1).",
    "after": {
     "version": 2,
     "next_id": 1,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Vault",
       "created": 1791950000,
       "touched": 1791950000
      }
     ],
     "active": {
      "main": 1
     },
     "tasks": []
    }
   },
   {
    "now": 1791950001,
    "session": "s1",
    "agent": "agent-1",
    "tool": "task_assign_human",
    "args": {
     "subject": "Touch ID",
     "epic": 1
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 1,\n \"next_epic\": 2,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"Vault\",\n   \"created\": 1791950000,\n   \"touched\": 1791950000\n  }\n ],\n \"active\": {\n  \"main\": 1\n },\n \"tasks\": []\n}",
    "error": true,
    "text": "task_assign_human is the main agent's: say in your answer what you need from the user, and the main agent assigns it.",
    "after": {
     "version": 2,
     "next_id": 1,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Vault",
       "created": 1791950000,
       "touched": 1791950000
      }
     ],
     "active": {
      "main": 1
     },
     "tasks": []
    }
   },
   {
    "now": 1791950002,
    "session": "s1",
    "agent": "main",
    "tool": "task_assign_human",
    "args": {
     "subject": "",
     "epic": 1
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 1,\n \"next_epic\": 2,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"Vault\",\n   \"created\": 1791950000,\n   \"touched\": 1791950000\n  }\n ],\n \"active\": {\n  \"main\": 1\n },\n \"tasks\": []\n}",
    "error": true,
    "text": "subject is required",
    "after": {
     "version": 2,
     "next_id": 1,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Vault",
       "created": 1791950000,
       "touched": 1791950000
      }
     ],
     "active": {
      "main": 1
     },
     "tasks": []
    }
   },
   {
    "now": 1791950003,
    "session": "s1",
    "agent": "main",
    "tool": "task_assign_human",
    "args": {
     "subject": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
     "epic": 1
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 1,\n \"next_epic\": 2,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"Vault\",\n   \"created\": 1791950000,\n   \"touched\": 1791950000\n  }\n ],\n \"active\": {\n  \"main\": 1\n },\n \"tasks\": []\n}",
    "error": true,
    "text": "subject is 41 characters, the limit is 40: it is shown in full on the status line. Shorten it to an imperative title and move the detail to description.",
    "after": {
     "version": 2,
     "next_id": 1,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Vault",
       "created": 1791950000,
       "touched": 1791950000
      }
     ],
     "active": {
      "main": 1
     },
     "tasks": []
    }
   },
   {
    "now": 1791950004,
    "session": "s1",
    "agent": "main",
    "tool": "task_assign_human",
    "args": {
     "subject": "Touch ID for op"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 1,\n \"next_epic\": 2,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"Vault\",\n   \"created\": 1791950000,\n   \"touched\": 1791950000\n  }\n ],\n \"active\": {\n  \"main\": 1\n },\n \"tasks\": []\n}",
    "error": true,
    "text": "epic is required: a task for the user belongs to the epic it unblocks; open epics: #1 Vault (active). task_epic(title) opens one first.",
    "after": {
     "version": 2,
     "next_id": 1,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Vault",
       "created": 1791950000,
       "touched": 1791950000
      }
     ],
     "active": {
      "main": 1
     },
     "tasks": []
    }
   },
   {
    "now": 1791950005,
    "session": "s1",
    "agent": "main",
    "tool": "task_assign_human",
    "args": {
     "subject": "Touch ID for op",
     "epic": 0
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 1,\n \"next_epic\": 2,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"Vault\",\n   \"created\": 1791950000,\n   \"touched\": 1791950000\n  }\n ],\n \"active\": {\n  \"main\": 1\n },\n \"tasks\": []\n}",
    "error": true,
    "text": "epic is required: a task for the user belongs to the epic it unblocks; open epics: #1 Vault (active). task_epic(title) opens one first.",
    "after": {
     "version": 2,
     "next_id": 1,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Vault",
       "created": 1791950000,
       "touched": 1791950000
      }
     ],
     "active": {
      "main": 1
     },
     "tasks": []
    }
   },
   {
    "now": 1791950006,
    "session": "s1",
    "agent": "main",
    "tool": "task_assign_human",
    "args": {
     "subject": "Touch ID for op",
     "epic": 9
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 1,\n \"next_epic\": 2,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"Vault\",\n   \"created\": 1791950000,\n   \"touched\": 1791950000\n  }\n ],\n \"active\": {\n  \"main\": 1\n },\n \"tasks\": []\n}",
    "error": true,
    "text": "epic is required: a task for the user belongs to the epic it unblocks; open epics: #1 Vault (active). task_epic(title) opens one first.",
    "after": {
     "version": 2,
     "next_id": 1,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Vault",
       "created": 1791950000,
       "touched": 1791950000
      }
     ],
     "active": {
      "main": 1
     },
     "tasks": []
    }
   },
   {
    "now": 1791950007,
    "session": "s1",
    "agent": "main",
    "tool": "task_assign_human",
    "args": {
     "subject": "Touch ID for op",
     "epic": "#1"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 1,\n \"next_epic\": 2,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"Vault\",\n   \"created\": 1791950000,\n   \"touched\": 1791950000\n  }\n ],\n \"active\": {\n  \"main\": 1\n },\n \"tasks\": []\n}",
    "error": false,
    "text": "Task #1 assigned to the user, waiting: Touch ID for op in epic #1 Vault. Ask them for it in your reply; once they have answered, task_update(id=\"1\", status=\"completed\").",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Vault",
       "created": 1791950000,
       "touched": 1791950007
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
       "subject": "Touch ID for op",
       "description": "",
       "status": "waiting",
       "assignee": "human",
       "created": 1791950007,
       "updated": 1791950007
      }
     ]
    }
   }
  ]
 },
 {
  "name": "human: five open at most",
  "steps": [
   {
    "now": 1791950000,
    "session": "s1",
    "agent": "main",
    "tool": "task_epic",
    "args": {
     "title": "Seed"
    },
    "before": null,
    "error": false,
    "text": "Epic #1 Seed opened and active: file its tasks with task_create(epic=1).",
    "after": {
     "version": 2,
     "next_id": 1,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Seed",
       "created": 1791950000,
       "touched": 1791950000
      }
     ],
     "active": {
      "main": 1
     },
     "tasks": []
    }
   },
   {
    "now": 1791950001,
    "session": "s1",
    "agent": "main",
    "tool": "task_assign_human",
    "args": {
     "subject": "Go 1",
     "epic": 1
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 1,\n \"next_epic\": 2,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"Seed\",\n   \"created\": 1791950000,\n   \"touched\": 1791950000\n  }\n ],\n \"active\": {\n  \"main\": 1\n },\n \"tasks\": []\n}",
    "error": false,
    "text": "Task #1 assigned to the user, waiting: Go 1 in epic #1 Seed. Ask them for it in your reply; once they have answered, task_update(id=\"1\", status=\"completed\").",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Seed",
       "created": 1791950000,
       "touched": 1791950001
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
       "subject": "Go 1",
       "description": "",
       "status": "waiting",
       "assignee": "human",
       "created": 1791950001,
       "updated": 1791950001
      }
     ]
    }
   },
   {
    "now": 1791950002,
    "session": "s1",
    "agent": "main",
    "tool": "task_assign_human",
    "args": {
     "subject": "Go 2",
     "epic": 1
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 2,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"Seed\",\n   \"created\": 1791950000,\n   \"touched\": 1791950001\n  }\n ],\n \"active\": {\n  \"main\": 1\n },\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Go 1\",\n   \"description\": \"\",\n   \"status\": \"waiting\",\n   \"assignee\": \"human\",\n   \"created\": 1791950001,\n   \"updated\": 1791950001\n  }\n ]\n}",
    "error": false,
    "text": "Task #2 assigned to the user, waiting: Go 2 in epic #1 Seed. Ask them for it in your reply; once they have answered, task_update(id=\"2\", status=\"completed\").",
    "after": {
     "version": 2,
     "next_id": 3,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Seed",
       "created": 1791950000,
       "touched": 1791950002
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
       "subject": "Go 1",
       "description": "",
       "status": "waiting",
       "assignee": "human",
       "created": 1791950001,
       "updated": 1791950001
      },
      {
       "id": "2",
       "agent": "main",
       "epic": 1,
       "subject": "Go 2",
       "description": "",
       "status": "waiting",
       "assignee": "human",
       "created": 1791950002,
       "updated": 1791950002
      }
     ]
    }
   },
   {
    "now": 1791950003,
    "session": "s1",
    "agent": "main",
    "tool": "task_assign_human",
    "args": {
     "subject": "Go 3",
     "epic": 1
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 3,\n \"next_epic\": 2,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"Seed\",\n   \"created\": 1791950000,\n   \"touched\": 1791950002\n  }\n ],\n \"active\": {\n  \"main\": 1\n },\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Go 1\",\n   \"description\": \"\",\n   \"status\": \"waiting\",\n   \"assignee\": \"human\",\n   \"created\": 1791950001,\n   \"updated\": 1791950001\n  },\n  {\n   \"id\": \"2\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Go 2\",\n   \"description\": \"\",\n   \"status\": \"waiting\",\n   \"assignee\": \"human\",\n   \"created\": 1791950002,\n   \"updated\": 1791950002\n  }\n ]\n}",
    "error": false,
    "text": "Task #3 assigned to the user, waiting: Go 3 in epic #1 Seed. Ask them for it in your reply; once they have answered, task_update(id=\"3\", status=\"completed\").",
    "after": {
     "version": 2,
     "next_id": 4,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Seed",
       "created": 1791950000,
       "touched": 1791950003
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
       "subject": "Go 1",
       "description": "",
       "status": "waiting",
       "assignee": "human",
       "created": 1791950001,
       "updated": 1791950001
      },
      {
       "id": "2",
       "agent": "main",
       "epic": 1,
       "subject": "Go 2",
       "description": "",
       "status": "waiting",
       "assignee": "human",
       "created": 1791950002,
       "updated": 1791950002
      },
      {
       "id": "3",
       "agent": "main",
       "epic": 1,
       "subject": "Go 3",
       "description": "",
       "status": "waiting",
       "assignee": "human",
       "created": 1791950003,
       "updated": 1791950003
      }
     ]
    }
   },
   {
    "now": 1791950004,
    "session": "s1",
    "agent": "main",
    "tool": "task_assign_human",
    "args": {
     "subject": "Go 4",
     "epic": 1
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 4,\n \"next_epic\": 2,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"Seed\",\n   \"created\": 1791950000,\n   \"touched\": 1791950003\n  }\n ],\n \"active\": {\n  \"main\": 1\n },\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Go 1\",\n   \"description\": \"\",\n   \"status\": \"waiting\",\n   \"assignee\": \"human\",\n   \"created\": 1791950001,\n   \"updated\": 1791950001\n  },\n  {\n   \"id\": \"2\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Go 2\",\n   \"description\": \"\",\n   \"status\": \"waiting\",\n   \"assignee\": \"human\",\n   \"created\": 1791950002,\n   \"updated\": 1791950002\n  },\n  {\n   \"id\": \"3\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Go 3\",\n   \"description\": \"\",\n   \"status\": \"waiting\",\n   \"assignee\": \"human\",\n   \"created\": 1791950003,\n   \"updated\": 1791950003\n  }\n ]\n}",
    "error": false,
    "text": "Task #4 assigned to the user, waiting: Go 4 in epic #1 Seed. Ask them for it in your reply; once they have answered, task_update(id=\"4\", status=\"completed\").",
    "after": {
     "version": 2,
     "next_id": 5,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Seed",
       "created": 1791950000,
       "touched": 1791950004
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
       "subject": "Go 1",
       "description": "",
       "status": "waiting",
       "assignee": "human",
       "created": 1791950001,
       "updated": 1791950001
      },
      {
       "id": "2",
       "agent": "main",
       "epic": 1,
       "subject": "Go 2",
       "description": "",
       "status": "waiting",
       "assignee": "human",
       "created": 1791950002,
       "updated": 1791950002
      },
      {
       "id": "3",
       "agent": "main",
       "epic": 1,
       "subject": "Go 3",
       "description": "",
       "status": "waiting",
       "assignee": "human",
       "created": 1791950003,
       "updated": 1791950003
      },
      {
       "id": "4",
       "agent": "main",
       "epic": 1,
       "subject": "Go 4",
       "description": "",
       "status": "waiting",
       "assignee": "human",
       "created": 1791950004,
       "updated": 1791950004
      }
     ]
    }
   },
   {
    "now": 1791950005,
    "session": "s1",
    "agent": "main",
    "tool": "task_assign_human",
    "args": {
     "subject": "Go 5",
     "epic": 1
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 5,\n \"next_epic\": 2,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"Seed\",\n   \"created\": 1791950000,\n   \"touched\": 1791950004\n  }\n ],\n \"active\": {\n  \"main\": 1\n },\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Go 1\",\n   \"description\": \"\",\n   \"status\": \"waiting\",\n   \"assignee\": \"human\",\n   \"created\": 1791950001,\n   \"updated\": 1791950001\n  },\n  {\n   \"id\": \"2\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Go 2\",\n   \"description\": \"\",\n   \"status\": \"waiting\",\n   \"assignee\": \"human\",\n   \"created\": 1791950002,\n   \"updated\": 1791950002\n  },\n  {\n   \"id\": \"3\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Go 3\",\n   \"description\": \"\",\n   \"status\": \"waiting\",\n   \"assignee\": \"human\",\n   \"created\": 1791950003,\n   \"updated\": 1791950003\n  },\n  {\n   \"id\": \"4\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Go 4\",\n   \"description\": \"\",\n   \"status\": \"waiting\",\n   \"assignee\": \"human\",\n   \"created\": 1791950004,\n   \"updated\": 1791950004\n  }\n ]\n}",
    "error": false,
    "text": "Task #5 assigned to the user, waiting: Go 5 in epic #1 Seed. Ask them for it in your reply; once they have answered, task_update(id=\"5\", status=\"completed\").",
    "after": {
     "version": 2,
     "next_id": 6,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Seed",
       "created": 1791950000,
       "touched": 1791950005
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
       "subject": "Go 1",
       "description": "",
       "status": "waiting",
       "assignee": "human",
       "created": 1791950001,
       "updated": 1791950001
      },
      {
       "id": "2",
       "agent": "main",
       "epic": 1,
       "subject": "Go 2",
       "description": "",
       "status": "waiting",
       "assignee": "human",
       "created": 1791950002,
       "updated": 1791950002
      },
      {
       "id": "3",
       "agent": "main",
       "epic": 1,
       "subject": "Go 3",
       "description": "",
       "status": "waiting",
       "assignee": "human",
       "created": 1791950003,
       "updated": 1791950003
      },
      {
       "id": "4",
       "agent": "main",
       "epic": 1,
       "subject": "Go 4",
       "description": "",
       "status": "waiting",
       "assignee": "human",
       "created": 1791950004,
       "updated": 1791950004
      },
      {
       "id": "5",
       "agent": "main",
       "epic": 1,
       "subject": "Go 5",
       "description": "",
       "status": "waiting",
       "assignee": "human",
       "created": 1791950005,
       "updated": 1791950005
      }
     ]
    }
   },
   {
    "now": 1791950006,
    "session": "s1",
    "agent": "main",
    "tool": "task_assign_human",
    "args": {
     "subject": "Go 6",
     "epic": 1
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 6,\n \"next_epic\": 2,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"Seed\",\n   \"created\": 1791950000,\n   \"touched\": 1791950005\n  }\n ],\n \"active\": {\n  \"main\": 1\n },\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Go 1\",\n   \"description\": \"\",\n   \"status\": \"waiting\",\n   \"assignee\": \"human\",\n   \"created\": 1791950001,\n   \"updated\": 1791950001\n  },\n  {\n   \"id\": \"2\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Go 2\",\n   \"description\": \"\",\n   \"status\": \"waiting\",\n   \"assignee\": \"human\",\n   \"created\": 1791950002,\n   \"updated\": 1791950002\n  },\n  {\n   \"id\": \"3\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Go 3\",\n   \"description\": \"\",\n   \"status\": \"waiting\",\n   \"assignee\": \"human\",\n   \"created\": 1791950003,\n   \"updated\": 1791950003\n  },\n  {\n   \"id\": \"4\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Go 4\",\n   \"description\": \"\",\n   \"status\": \"waiting\",\n   \"assignee\": \"human\",\n   \"created\": 1791950004,\n   \"updated\": 1791950004\n  },\n  {\n   \"id\": \"5\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Go 5\",\n   \"description\": \"\",\n   \"status\": \"waiting\",\n   \"assignee\": \"human\",\n   \"created\": 1791950005,\n   \"updated\": 1791950005\n  }\n ]\n}",
    "error": true,
    "text": "the user already has 5 tasks waiting (#1 Go 1, #2 Go 2, #3 Go 3, #4 Go 4, #5 Go 5), the limit is 5: close the ones they answered with task_update(status=completed), or delete the ones that no longer apply, first.",
    "after": {
     "version": 2,
     "next_id": 6,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Seed",
       "created": 1791950000,
       "touched": 1791950005
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
       "subject": "Go 1",
       "description": "",
       "status": "waiting",
       "assignee": "human",
       "created": 1791950001,
       "updated": 1791950001
      },
      {
       "id": "2",
       "agent": "main",
       "epic": 1,
       "subject": "Go 2",
       "description": "",
       "status": "waiting",
       "assignee": "human",
       "created": 1791950002,
       "updated": 1791950002
      },
      {
       "id": "3",
       "agent": "main",
       "epic": 1,
       "subject": "Go 3",
       "description": "",
       "status": "waiting",
       "assignee": "human",
       "created": 1791950003,
       "updated": 1791950003
      },
      {
       "id": "4",
       "agent": "main",
       "epic": 1,
       "subject": "Go 4",
       "description": "",
       "status": "waiting",
       "assignee": "human",
       "created": 1791950004,
       "updated": 1791950004
      },
      {
       "id": "5",
       "agent": "main",
       "epic": 1,
       "subject": "Go 5",
       "description": "",
       "status": "waiting",
       "assignee": "human",
       "created": 1791950005,
       "updated": 1791950005
      }
     ]
    }
   },
   {
    "now": 1791950007,
    "session": "s1",
    "agent": "main",
    "tool": "task_update",
    "args": {
     "id": "2",
     "status": "completed"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 6,\n \"next_epic\": 2,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"Seed\",\n   \"created\": 1791950000,\n   \"touched\": 1791950005\n  }\n ],\n \"active\": {\n  \"main\": 1\n },\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Go 1\",\n   \"description\": \"\",\n   \"status\": \"waiting\",\n   \"assignee\": \"human\",\n   \"created\": 1791950001,\n   \"updated\": 1791950001\n  },\n  {\n   \"id\": \"2\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Go 2\",\n   \"description\": \"\",\n   \"status\": \"waiting\",\n   \"assignee\": \"human\",\n   \"created\": 1791950002,\n   \"updated\": 1791950002\n  },\n  {\n   \"id\": \"3\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Go 3\",\n   \"description\": \"\",\n   \"status\": \"waiting\",\n   \"assignee\": \"human\",\n   \"created\": 1791950003,\n   \"updated\": 1791950003\n  },\n  {\n   \"id\": \"4\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Go 4\",\n   \"description\": \"\",\n   \"status\": \"waiting\",\n   \"assignee\": \"human\",\n   \"created\": 1791950004,\n   \"updated\": 1791950004\n  },\n  {\n   \"id\": \"5\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Go 5\",\n   \"description\": \"\",\n   \"status\": \"waiting\",\n   \"assignee\": \"human\",\n   \"created\": 1791950005,\n   \"updated\": 1791950005\n  }\n ]\n}",
    "error": false,
    "text": "Task #2 updated: Go 2 (completed)",
    "after": {
     "version": 2,
     "next_id": 6,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Seed",
       "created": 1791950000,
       "touched": 1791950007
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
       "subject": "Go 1",
       "description": "",
       "status": "waiting",
       "assignee": "human",
       "created": 1791950001,
       "updated": 1791950001
      },
      {
       "id": "2",
       "agent": "main",
       "epic": 1,
       "subject": "Go 2",
       "description": "",
       "status": "completed",
       "assignee": "human",
       "created": 1791950002,
       "updated": 1791950007
      },
      {
       "id": "3",
       "agent": "main",
       "epic": 1,
       "subject": "Go 3",
       "description": "",
       "status": "waiting",
       "assignee": "human",
       "created": 1791950003,
       "updated": 1791950003
      },
      {
       "id": "4",
       "agent": "main",
       "epic": 1,
       "subject": "Go 4",
       "description": "",
       "status": "waiting",
       "assignee": "human",
       "created": 1791950004,
       "updated": 1791950004
      },
      {
       "id": "5",
       "agent": "main",
       "epic": 1,
       "subject": "Go 5",
       "description": "",
       "status": "waiting",
       "assignee": "human",
       "created": 1791950005,
       "updated": 1791950005
      }
     ]
    }
   },
   {
    "now": 1791950008,
    "session": "s1",
    "agent": "main",
    "tool": "task_assign_human",
    "args": {
     "subject": "Go 6",
     "epic": 1
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 6,\n \"next_epic\": 2,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"Seed\",\n   \"created\": 1791950000,\n   \"touched\": 1791950007\n  }\n ],\n \"active\": {\n  \"main\": 1\n },\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Go 1\",\n   \"description\": \"\",\n   \"status\": \"waiting\",\n   \"assignee\": \"human\",\n   \"created\": 1791950001,\n   \"updated\": 1791950001\n  },\n  {\n   \"id\": \"2\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Go 2\",\n   \"description\": \"\",\n   \"status\": \"completed\",\n   \"assignee\": \"human\",\n   \"created\": 1791950002,\n   \"updated\": 1791950007\n  },\n  {\n   \"id\": \"3\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Go 3\",\n   \"description\": \"\",\n   \"status\": \"waiting\",\n   \"assignee\": \"human\",\n   \"created\": 1791950003,\n   \"updated\": 1791950003\n  },\n  {\n   \"id\": \"4\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Go 4\",\n   \"description\": \"\",\n   \"status\": \"waiting\",\n   \"assignee\": \"human\",\n   \"created\": 1791950004,\n   \"updated\": 1791950004\n  },\n  {\n   \"id\": \"5\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Go 5\",\n   \"description\": \"\",\n   \"status\": \"waiting\",\n   \"assignee\": \"human\",\n   \"created\": 1791950005,\n   \"updated\": 1791950005\n  }\n ]\n}",
    "error": false,
    "text": "Task #6 assigned to the user, waiting: Go 6 in epic #1 Seed. Ask them for it in your reply; once they have answered, task_update(id=\"6\", status=\"completed\").",
    "after": {
     "version": 2,
     "next_id": 7,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Seed",
       "created": 1791950000,
       "touched": 1791950008
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
       "subject": "Go 1",
       "description": "",
       "status": "waiting",
       "assignee": "human",
       "created": 1791950001,
       "updated": 1791950001
      },
      {
       "id": "2",
       "agent": "main",
       "epic": 1,
       "subject": "Go 2",
       "description": "",
       "status": "completed",
       "assignee": "human",
       "created": 1791950002,
       "updated": 1791950007
      },
      {
       "id": "3",
       "agent": "main",
       "epic": 1,
       "subject": "Go 3",
       "description": "",
       "status": "waiting",
       "assignee": "human",
       "created": 1791950003,
       "updated": 1791950003
      },
      {
       "id": "4",
       "agent": "main",
       "epic": 1,
       "subject": "Go 4",
       "description": "",
       "status": "waiting",
       "assignee": "human",
       "created": 1791950004,
       "updated": 1791950004
      },
      {
       "id": "5",
       "agent": "main",
       "epic": 1,
       "subject": "Go 5",
       "description": "",
       "status": "waiting",
       "assignee": "human",
       "created": 1791950005,
       "updated": 1791950005
      },
      {
       "id": "6",
       "agent": "main",
       "epic": 1,
       "subject": "Go 6",
       "description": "",
       "status": "waiting",
       "assignee": "human",
       "created": 1791950008,
       "updated": 1791950008
      }
     ]
    }
   },
   {
    "now": 1791950009,
    "session": "s1",
    "agent": "main",
    "tool": "task_update",
    "args": {
     "id": "3",
     "status": "deleted"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 7,\n \"next_epic\": 2,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"Seed\",\n   \"created\": 1791950000,\n   \"touched\": 1791950008\n  }\n ],\n \"active\": {\n  \"main\": 1\n },\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Go 1\",\n   \"description\": \"\",\n   \"status\": \"waiting\",\n   \"assignee\": \"human\",\n   \"created\": 1791950001,\n   \"updated\": 1791950001\n  },\n  {\n   \"id\": \"2\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Go 2\",\n   \"description\": \"\",\n   \"status\": \"completed\",\n   \"assignee\": \"human\",\n   \"created\": 1791950002,\n   \"updated\": 1791950007\n  },\n  {\n   \"id\": \"3\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Go 3\",\n   \"description\": \"\",\n   \"status\": \"waiting\",\n   \"assignee\": \"human\",\n   \"created\": 1791950003,\n   \"updated\": 1791950003\n  },\n  {\n   \"id\": \"4\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Go 4\",\n   \"description\": \"\",\n   \"status\": \"waiting\",\n   \"assignee\": \"human\",\n   \"created\": 1791950004,\n   \"updated\": 1791950004\n  },\n  {\n   \"id\": \"5\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Go 5\",\n   \"description\": \"\",\n   \"status\": \"waiting\",\n   \"assignee\": \"human\",\n   \"created\": 1791950005,\n   \"updated\": 1791950005\n  },\n  {\n   \"id\": \"6\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Go 6\",\n   \"description\": \"\",\n   \"status\": \"waiting\",\n   \"assignee\": \"human\",\n   \"created\": 1791950008,\n   \"updated\": 1791950008\n  }\n ]\n}",
    "error": false,
    "text": "Task #3 deleted",
    "after": {
     "version": 2,
     "next_id": 7,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Seed",
       "created": 1791950000,
       "touched": 1791950009
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
       "subject": "Go 1",
       "description": "",
       "status": "waiting",
       "assignee": "human",
       "created": 1791950001,
       "updated": 1791950001
      },
      {
       "id": "2",
       "agent": "main",
       "epic": 1,
       "subject": "Go 2",
       "description": "",
       "status": "completed",
       "assignee": "human",
       "created": 1791950002,
       "updated": 1791950007
      },
      {
       "id": "4",
       "agent": "main",
       "epic": 1,
       "subject": "Go 4",
       "description": "",
       "status": "waiting",
       "assignee": "human",
       "created": 1791950004,
       "updated": 1791950004
      },
      {
       "id": "5",
       "agent": "main",
       "epic": 1,
       "subject": "Go 5",
       "description": "",
       "status": "waiting",
       "assignee": "human",
       "created": 1791950005,
       "updated": 1791950005
      },
      {
       "id": "6",
       "agent": "main",
       "epic": 1,
       "subject": "Go 6",
       "description": "",
       "status": "waiting",
       "assignee": "human",
       "created": 1791950008,
       "updated": 1791950008
      }
     ]
    }
   },
   {
    "now": 1791950010,
    "session": "s1",
    "agent": "main",
    "tool": "task_assign_human",
    "args": {
     "subject": "Go 7",
     "epic": 1
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 7,\n \"next_epic\": 2,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"Seed\",\n   \"created\": 1791950000,\n   \"touched\": 1791950009\n  }\n ],\n \"active\": {\n  \"main\": 1\n },\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Go 1\",\n   \"description\": \"\",\n   \"status\": \"waiting\",\n   \"assignee\": \"human\",\n   \"created\": 1791950001,\n   \"updated\": 1791950001\n  },\n  {\n   \"id\": \"2\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Go 2\",\n   \"description\": \"\",\n   \"status\": \"completed\",\n   \"assignee\": \"human\",\n   \"created\": 1791950002,\n   \"updated\": 1791950007\n  },\n  {\n   \"id\": \"4\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Go 4\",\n   \"description\": \"\",\n   \"status\": \"waiting\",\n   \"assignee\": \"human\",\n   \"created\": 1791950004,\n   \"updated\": 1791950004\n  },\n  {\n   \"id\": \"5\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Go 5\",\n   \"description\": \"\",\n   \"status\": \"waiting\",\n   \"assignee\": \"human\",\n   \"created\": 1791950005,\n   \"updated\": 1791950005\n  },\n  {\n   \"id\": \"6\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Go 6\",\n   \"description\": \"\",\n   \"status\": \"waiting\",\n   \"assignee\": \"human\",\n   \"created\": 1791950008,\n   \"updated\": 1791950008\n  }\n ]\n}",
    "error": false,
    "text": "Task #7 assigned to the user, waiting: Go 7 in epic #1 Seed. Ask them for it in your reply; once they have answered, task_update(id=\"7\", status=\"completed\").",
    "after": {
     "version": 2,
     "next_id": 8,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Seed",
       "created": 1791950000,
       "touched": 1791950010
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
       "subject": "Go 1",
       "description": "",
       "status": "waiting",
       "assignee": "human",
       "created": 1791950001,
       "updated": 1791950001
      },
      {
       "id": "2",
       "agent": "main",
       "epic": 1,
       "subject": "Go 2",
       "description": "",
       "status": "completed",
       "assignee": "human",
       "created": 1791950002,
       "updated": 1791950007
      },
      {
       "id": "4",
       "agent": "main",
       "epic": 1,
       "subject": "Go 4",
       "description": "",
       "status": "waiting",
       "assignee": "human",
       "created": 1791950004,
       "updated": 1791950004
      },
      {
       "id": "5",
       "agent": "main",
       "epic": 1,
       "subject": "Go 5",
       "description": "",
       "status": "waiting",
       "assignee": "human",
       "created": 1791950005,
       "updated": 1791950005
      },
      {
       "id": "6",
       "agent": "main",
       "epic": 1,
       "subject": "Go 6",
       "description": "",
       "status": "waiting",
       "assignee": "human",
       "created": 1791950008,
       "updated": 1791950008
      },
      {
       "id": "7",
       "agent": "main",
       "epic": 1,
       "subject": "Go 7",
       "description": "",
       "status": "waiting",
       "assignee": "human",
       "created": 1791950010,
       "updated": 1791950010
      }
     ]
    }
   },
   {
    "now": 1791950011,
    "session": "s1",
    "agent": "main",
    "tool": "task_assign_human",
    "args": {
     "subject": "Go 8",
     "epic": 1
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 8,\n \"next_epic\": 2,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"Seed\",\n   \"created\": 1791950000,\n   \"touched\": 1791950010\n  }\n ],\n \"active\": {\n  \"main\": 1\n },\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Go 1\",\n   \"description\": \"\",\n   \"status\": \"waiting\",\n   \"assignee\": \"human\",\n   \"created\": 1791950001,\n   \"updated\": 1791950001\n  },\n  {\n   \"id\": \"2\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Go 2\",\n   \"description\": \"\",\n   \"status\": \"completed\",\n   \"assignee\": \"human\",\n   \"created\": 1791950002,\n   \"updated\": 1791950007\n  },\n  {\n   \"id\": \"4\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Go 4\",\n   \"description\": \"\",\n   \"status\": \"waiting\",\n   \"assignee\": \"human\",\n   \"created\": 1791950004,\n   \"updated\": 1791950004\n  },\n  {\n   \"id\": \"5\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Go 5\",\n   \"description\": \"\",\n   \"status\": \"waiting\",\n   \"assignee\": \"human\",\n   \"created\": 1791950005,\n   \"updated\": 1791950005\n  },\n  {\n   \"id\": \"6\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Go 6\",\n   \"description\": \"\",\n   \"status\": \"waiting\",\n   \"assignee\": \"human\",\n   \"created\": 1791950008,\n   \"updated\": 1791950008\n  },\n  {\n   \"id\": \"7\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Go 7\",\n   \"description\": \"\",\n   \"status\": \"waiting\",\n   \"assignee\": \"human\",\n   \"created\": 1791950010,\n   \"updated\": 1791950010\n  }\n ]\n}",
    "error": true,
    "text": "the user already has 5 tasks waiting (#1 Go 1, #4 Go 4, #5 Go 5, #6 Go 6, #7 Go 7), the limit is 5: close the ones they answered with task_update(status=completed), or delete the ones that no longer apply, first.",
    "after": {
     "version": 2,
     "next_id": 8,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Seed",
       "created": 1791950000,
       "touched": 1791950010
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
       "subject": "Go 1",
       "description": "",
       "status": "waiting",
       "assignee": "human",
       "created": 1791950001,
       "updated": 1791950001
      },
      {
       "id": "2",
       "agent": "main",
       "epic": 1,
       "subject": "Go 2",
       "description": "",
       "status": "completed",
       "assignee": "human",
       "created": 1791950002,
       "updated": 1791950007
      },
      {
       "id": "4",
       "agent": "main",
       "epic": 1,
       "subject": "Go 4",
       "description": "",
       "status": "waiting",
       "assignee": "human",
       "created": 1791950004,
       "updated": 1791950004
      },
      {
       "id": "5",
       "agent": "main",
       "epic": 1,
       "subject": "Go 5",
       "description": "",
       "status": "waiting",
       "assignee": "human",
       "created": 1791950005,
       "updated": 1791950005
      },
      {
       "id": "6",
       "agent": "main",
       "epic": 1,
       "subject": "Go 6",
       "description": "",
       "status": "waiting",
       "assignee": "human",
       "created": 1791950008,
       "updated": 1791950008
      },
      {
       "id": "7",
       "agent": "main",
       "epic": 1,
       "subject": "Go 7",
       "description": "",
       "status": "waiting",
       "assignee": "human",
       "created": 1791950010,
       "updated": 1791950010
      }
     ]
    }
   }
  ]
 },
 {
  "name": "human: waiting on the user takes no worker",
  "steps": [
   {
    "now": 1791950000,
    "session": "s1",
    "agent": "main",
    "tool": "task_epic",
    "args": {
     "title": "Deploy"
    },
    "before": null,
    "error": false,
    "text": "Epic #1 Deploy opened and active: file its tasks with task_create(epic=1).",
    "after": {
     "version": 2,
     "next_id": 1,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Deploy",
       "created": 1791950000,
       "touched": 1791950000
      }
     ],
     "active": {
      "main": 1
     },
     "tasks": []
    }
   },
   {
    "now": 1791950001,
    "session": "s1",
    "agent": "main",
    "tool": "task_assign_human",
    "args": {
     "subject": "Approve the deploy",
     "epic": 1
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 1,\n \"next_epic\": 2,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"Deploy\",\n   \"created\": 1791950000,\n   \"touched\": 1791950000\n  }\n ],\n \"active\": {\n  \"main\": 1\n },\n \"tasks\": []\n}",
    "error": false,
    "text": "Task #1 assigned to the user, waiting: Approve the deploy in epic #1 Deploy. Ask them for it in your reply; once they have answered, task_update(id=\"1\", status=\"completed\").",
    "after": {
     "version": 2,
     "next_id": 2,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Deploy",
       "created": 1791950000,
       "touched": 1791950001
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
       "subject": "Approve the deploy",
       "description": "",
       "status": "waiting",
       "assignee": "human",
       "created": 1791950001,
       "updated": 1791950001
      }
     ]
    }
   },
   {
    "now": 1791950002,
    "session": "s1",
    "agent": "main",
    "tool": "task_create",
    "args": {
     "subject": "Write the runbook",
     "epic": 1
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 2,\n \"next_epic\": 2,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"Deploy\",\n   \"created\": 1791950000,\n   \"touched\": 1791950001\n  }\n ],\n \"active\": {\n  \"main\": 1\n },\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Approve the deploy\",\n   \"description\": \"\",\n   \"status\": \"waiting\",\n   \"assignee\": \"human\",\n   \"created\": 1791950001,\n   \"updated\": 1791950001\n  }\n ]\n}",
    "error": false,
    "text": "Task #2 created: Write the runbook in epic #1 Deploy",
    "after": {
     "version": 2,
     "next_id": 3,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Deploy",
       "created": 1791950000,
       "touched": 1791950002
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
       "subject": "Approve the deploy",
       "description": "",
       "status": "waiting",
       "assignee": "human",
       "created": 1791950001,
       "updated": 1791950001
      },
      {
       "id": "2",
       "agent": "main",
       "epic": 1,
       "subject": "Write the runbook",
       "description": "",
       "status": "pending",
       "created": 1791950002,
       "updated": 1791950002
      }
     ]
    }
   },
   {
    "now": 1791950003,
    "session": "s1",
    "agent": "main",
    "tool": "task_update",
    "args": {
     "id": "2",
     "status": "in_progress"
    },
    "before": "{\n \"version\": 2,\n \"next_id\": 3,\n \"next_epic\": 2,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"Deploy\",\n   \"created\": 1791950000,\n   \"touched\": 1791950002\n  }\n ],\n \"active\": {\n  \"main\": 1\n },\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Approve the deploy\",\n   \"description\": \"\",\n   \"status\": \"waiting\",\n   \"assignee\": \"human\",\n   \"created\": 1791950001,\n   \"updated\": 1791950001\n  },\n  {\n   \"id\": \"2\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Write the runbook\",\n   \"description\": \"\",\n   \"status\": \"pending\",\n   \"created\": 1791950002,\n   \"updated\": 1791950002\n  }\n ]\n}",
    "error": false,
    "text": "Task #2 updated: Write the runbook (in_progress)",
    "after": {
     "version": 2,
     "next_id": 3,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Deploy",
       "created": 1791950000,
       "touched": 1791950003
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
       "subject": "Approve the deploy",
       "description": "",
       "status": "waiting",
       "assignee": "human",
       "created": 1791950001,
       "updated": 1791950001
      },
      {
       "id": "2",
       "agent": "main",
       "epic": 1,
       "subject": "Write the runbook",
       "description": "",
       "status": "in_progress",
       "created": 1791950002,
       "updated": 1791950003
      }
     ]
    }
   },
   {
    "now": 1791950004,
    "session": "s1",
    "agent": "main",
    "tool": "task_list",
    "args": {},
    "before": "{\n \"version\": 2,\n \"next_id\": 3,\n \"next_epic\": 2,\n \"epics\": [\n  {\n   \"id\": 1,\n   \"agent\": \"main\",\n   \"title\": \"Deploy\",\n   \"created\": 1791950000,\n   \"touched\": 1791950003\n  }\n ],\n \"active\": {\n  \"main\": 1\n },\n \"tasks\": [\n  {\n   \"id\": \"1\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Approve the deploy\",\n   \"description\": \"\",\n   \"status\": \"waiting\",\n   \"assignee\": \"human\",\n   \"created\": 1791950001,\n   \"updated\": 1791950001\n  },\n  {\n   \"id\": \"2\",\n   \"agent\": \"main\",\n   \"epic\": 1,\n   \"subject\": \"Write the runbook\",\n   \"description\": \"\",\n   \"status\": \"in_progress\",\n   \"created\": 1791950002,\n   \"updated\": 1791950003\n  }\n ]\n}",
    "error": false,
    "text": "Epic #1: Deploy (active, 0/2)\n#1 [waiting] Approve the deploy (assigned to the user)\n#2 [in_progress] Write the runbook",
    "after": {
     "version": 2,
     "next_id": 3,
     "next_epic": 2,
     "epics": [
      {
       "id": 1,
       "agent": "main",
       "title": "Deploy",
       "created": 1791950000,
       "touched": 1791950003
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
       "subject": "Approve the deploy",
       "description": "",
       "status": "waiting",
       "assignee": "human",
       "created": 1791950001,
       "updated": 1791950001
      },
      {
       "id": "2",
       "agent": "main",
       "epic": 1,
       "subject": "Write the runbook",
       "description": "",
       "status": "in_progress",
       "created": 1791950002,
       "updated": 1791950003
      }
     ]
    }
   }
  ]
 }
];

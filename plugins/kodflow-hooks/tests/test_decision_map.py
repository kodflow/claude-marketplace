"""kf_docs map, budget and export: bounds, exclusions, edges, thresholds."""
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "..", "hooks", "scripts", "lib", "kf_docs.py")
SESSION = os.path.join(HERE, "..", "hooks", "scripts", "on-session.sh")


def adr(n, title, status="Accepted", extra=""):
    return "# ADR %04d - %s\n\n- Status: %s\n- Date: 2026-11-01\n%s\n## Decision\nx\n" % (n, title, status, extra)


class DecisionMap(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.repo = os.path.join(self.tmp, "repo")
        os.makedirs(os.path.join(self.repo, "docs", "adr"))
        subprocess.run(["git", "init", "-q", self.repo], check=True)
        self.env = dict(os.environ, KODFLOW_DOCS_CACHE=os.path.join(self.tmp, "c"), HOME=self.tmp)

    def put(self, rel, text):
        with open(os.path.join(self.repo, rel), "w") as fh:
            fh.write(text)

    def cli(self, *args, env=None):
        r = subprocess.run([sys.executable, "-I", SCRIPT, *args, "--root", self.repo],
                           capture_output=True, text=True, env=env or self.env)
        self.assertEqual(r.returncode, 0, r.stderr)
        return r.stdout

    def test_map_groups_edges_and_drops_superseded(self):
        self.put("docs/adr/0001-a.md", adr(1, "old drain", "Superseded by 0002", "- Area: net\n"))
        self.put("docs/adr/0002-b.md", adr(2, "new drain: why", "Accepted", "- Area: net\n- Supersedes: 0001\n"))
        self.put("docs/adr/0003-c.md", adr(3, "a limit", "Accepted", "- **Amends**: ADR 0002 and `docs/adr/0001-a.md`\n"))
        self.put("docs/adr/0004-d.md", adr(4, "not yet", "Proposed", "- Area: net\n"))
        out = self.cli("map")
        self.assertIn("### net (1)", out)
        self.assertIn("### - (1)", out)
        self.assertIn("- 0002 new drain [supersedes 0001]", out)
        self.assertIn("- 0003 a limit [amends 0001,0002]", out)
        self.assertNotIn("0001 old drain", out)
        self.assertNotIn("0004", out)

    def test_map_is_bounded(self):
        for i in range(1, 201):
            self.put("docs/adr/%04d-x.md" % i, adr(i, "decision number %d about things" % i, "Accepted",
                                                    "- Area: a%d\n" % (i % 30)))
        out = self.cli("map")
        self.assertLessEqual(len(out.splitlines()), 60)
        self.assertLessEqual(len(out.encode()), 3600)
        self.assertIn("more accepted ADRs not listed", out)

    def test_map_empty_without_adrs(self):
        self.assertEqual(self.cli("map"), "")

    def test_budget_thresholds_and_env(self):
        self.put("CLAUDE.md", "x\n" * 201)
        os.makedirs(os.path.join(self.repo, "sub"))
        os.makedirs(os.path.join(self.repo, "big"))
        self.put("sub/CLAUDE.md", "y\n" * 150)
        self.put("big/CLAUDE.md", "z" * 41000)
        out = self.cli("budget")
        self.assertEqual(len(out.splitlines()), 1)
        self.assertIn("CLAUDE.md 201 lines > 200", out)
        self.assertNotIn("sub/CLAUDE.md", out)
        self.assertIn("big/CLAUDE.md 41000 chars: truncated on a 200K window", out)
        self.assertLess(out.index("big/CLAUDE.md"), out.index("CLAUDE.md 201"))
        os.makedirs(os.path.join(self.repo, ".claude"))
        self.put(".claude/CLAUDE.md", "w" * 41000)
        self.assertNotIn(".claude/CLAUDE.md", self.cli("budget"))
        env = dict(self.env, KODFLOW_CLAUDE_MD_LINES="300", KODFLOW_CLAUDE_MD_TRUNC_CHARS="50000")
        self.assertEqual(self.cli("budget", env=env), "")

    def test_notes_md_is_indexed_like_claude_md(self):
        sys.path.insert(0, os.path.dirname(SCRIPT))
        import kf_docs
        self.put("NOTES.md", "root notes\n")
        os.makedirs(os.path.join(self.repo, "a", "b"))
        self.put("a/b/NOTES.md", "deep notes\n")
        self.put("a/b/other.md", "not indexed\n")
        got = sorted(os.path.relpath(f, self.repo) for f in kf_docs.repo_files(self.repo))
        self.assertIn("NOTES.md", got)
        self.assertIn("a/b/NOTES.md", got)
        self.assertNotIn("a/b/other.md", got)

    def test_export_obsidian_links(self):
        self.put("docs/adr/0002-b.md", adr(2, "new", "Accepted", "- Supersedes: 0001\n"))
        dest = os.path.join(self.tmp, "vault")
        self.cli("export", "--obsidian", dest)
        with open(os.path.join(dest, "ADR-0002.md")) as fh:
            self.assertIn("Supersedes: [[ADR-0001]]", fh.read())

    def test_session_start_carries_map_and_budget(self):
        self.put("docs/adr/0002-b.md", adr(2, "new drain", "Accepted", "- Area: net\n"))
        self.put("CLAUDE.md", "x\n" * 250)
        sp = os.path.join(self.tmp, "sp")
        os.makedirs(sp)
        env = dict(self.env, CLAUDE_PROJECT_DIR=self.repo, CLAUDE_CONFIG_DIR=os.path.join(self.tmp, ".claude"),
                   KODFLOW_ROOT="off")
        ev = '{"session_id":"s1","cwd":"%s","scratchpad_dir":"%s","hook_event_name":"SessionStart","source":"startup"}' % (self.repo, sp)
        r = subprocess.run(["bash", SESSION], input=ev, capture_output=True, text=True, env=env)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("Decision map", r.stdout)
        self.assertIn("0002 new drain", r.stdout)
        self.assertIn("CLAUDE.md budget: CLAUDE.md 250 lines > 200", r.stdout)
        r = subprocess.run(["bash", SESSION], input=ev, capture_output=True, text=True,
                           env=dict(env, KODFLOW_DOCS_INDEX="off", KODFLOW_CLAUDE_MD_BUDGET="off"))
        self.assertNotIn("Decision map", r.stdout)
        self.assertNotIn("budget", r.stdout)


if __name__ == "__main__":
    unittest.main()

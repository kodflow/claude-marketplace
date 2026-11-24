"""kf_docs: the tokenizer, the filters and the bounds, on fixture ADRs."""
import ast
import json
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "..", "hooks", "scripts", "lib", "kf_docs.py")

ADRS = {
    "0152-consensus.md": ("# ADR 0152 - consensus domain\n\n- Status: Accepted\n- Date: 2026-11-01\n"
                          "- Area: consensus\n- Need: decision\n\n## Decision\n"
                          "Codes keep their serials in the 0.2.57 range. See net/http1 and ADR-0152.\n"),
    "0153-old.md": ("# ADR 0153 - old drain\n\n- Status: Superseded by 0154\n- Date: 2026-10-01\n"
                    "- Area: net\n- Need: decision\n\n## Decision\nThe drain closes at once.\n"),
    "0154-new.md": ("# ADR 0154 - new drain\n\n- Status: Accepted\n- Date: 2026-11-02\n"
                    "- Area: net\n- Need: constraint\n- Supersedes: 0153\n\n## Decision\n"
                    "The drain stops routing first. " + "word " * 200 + "\n"),
}


class KfDocs(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        cls.repo = os.path.join(cls.tmp, "repo")
        os.makedirs(os.path.join(cls.repo, "docs", "adr"))
        for n, t in ADRS.items():
            with open(os.path.join(cls.repo, "docs", "adr", n), "w") as fh:
                fh.write(t)
        with open(os.path.join(cls.repo, "CLAUDE.md"), "w") as fh:
            fh.write("# repo\n\n## Notes\nplain note about nothing\n")
        cls.env = dict(os.environ, KODFLOW_DOCS_CACHE=os.path.join(cls.tmp, "cache"),
                       HOME=os.path.join(cls.tmp, "home"))
        os.makedirs(cls.env["HOME"])

    def run_cli(self, *args):
        r = subprocess.run([sys.executable, "-I", SCRIPT, *args, "--root", self.repo],
                           capture_output=True, text=True, env=self.env)
        self.assertEqual(r.returncode, 0, r.stderr)
        return r.stdout

    def search(self, q, *a):
        return json.loads(self.run_cli("search", q, "--no-global", "--format", "json", *a))

    def test_version_and_adr_tokens_survive(self):
        for q in ("0.2.57", "ADR-0152", "net/http1"):
            hits = self.search(q)
            self.assertTrue(hits and hits[0]["num"] == "0152", (q, hits))

    def test_exact_num(self):
        self.assertEqual(self.search("0152")[0]["num"], "0152")

    def test_superseded_excluded_by_default(self):
        nums = [h["num"] for h in self.search("drain")]
        self.assertEqual(nums, ["0154"])
        nums = sorted(h["num"] for h in self.search("drain", "--all"))
        self.assertEqual(nums, ["0153", "0154"])

    def test_filters(self):
        self.assertEqual([h["num"] for h in self.search("drain", "--need", "constraint")], ["0154"])
        self.assertEqual(self.search("drain", "--area", "consensus"), [])

    def test_snippet_and_limit_bounded(self):
        hits = self.search("drain", "--all", "--limit", "1")
        self.assertEqual(len(hits), 1)
        for h in self.search("word"):
            self.assertLessEqual(len(h["snippet"]), 200)

    def test_text_hit_line(self):
        out = self.run_cli("search", "0.2.57", "--no-global")
        self.assertIn("0152 · consensus domain · accepted · consensus · docs/adr/0152-consensus.md:", out)

    def test_incremental_picks_up_an_edit(self):
        p = os.path.join(self.repo, "docs", "adr", "0152-consensus.md")
        self.run_cli("index", "--quiet")
        os.utime(p, (1, 1))
        with open(p, "a") as fh:
            fh.write("\nzebrafinch appears later.\n")
        self.assertEqual(self.search("zebrafinch")[0]["num"], "0152")

    def test_stdlib_only(self):
        with open(SCRIPT) as fh:
            tree = ast.parse(fh.read())
        mods = set()
        for n in ast.walk(tree):
            if isinstance(n, ast.Import):
                mods |= {a.name.split(".")[0] for a in n.names}
            elif isinstance(n, ast.ImportFrom):
                mods.add(n.module.split(".")[0])
        std = set(sys.stdlib_module_names) | {"adr_lint"}
        self.assertEqual(mods - std, set())


if __name__ == "__main__":
    unittest.main()

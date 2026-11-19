from __future__ import annotations

from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
import runpy
from tempfile import TemporaryDirectory
import unittest
from zipfile import ZipFile

from pluginlib.release import PROFILES, render_profiles


ROOT = Path(__file__).resolve().parents[2]
SHA = "a" * 40


class ReleaseProfileTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.profiles = render_profiles(ROOT, SHA)

    def test_reproducible_profiles_and_lock(self) -> None:
        self.assertEqual(self.profiles, render_profiles(ROOT, SHA))
        lock = json.loads(self.profiles["release-lock.json"])
        self.assertEqual(SHA, lock["sourceCommit"])
        self.assertEqual({f"{name}.zip" for name in PROFILES},
                         {item["file"] for item in lock["artifacts"]})
        for item in lock["artifacts"]:
            data = self.profiles[item["file"]]
            self.assertEqual(item["sha256"], sha256(data).hexdigest())
            self.assertEqual(item["bytes"], len(data))
            with ZipFile(BytesIO(data)) as archive:
                proof = json.loads(archive.read("provenance.json"))
                self.assertEqual(SHA, proof["sourceCommit"])
                self.assertEqual(item["file"], proof["profile"] + ".zip")
                self.assertIn("compatibility.json", archive.namelist())

    def test_host_specific_files_live_only_in_matching_profiles(self) -> None:
        with ZipFile(BytesIO(self.profiles["portable.zip"])) as portable:
            self.assertIn("plugins/kodflow-workflow/plugin.json", portable.namelist())
            self.assertNotIn("plugins/kodflow-hooks/plugin.json", portable.namelist())
        with ZipFile(BytesIO(self.profiles["claude-full.zip"])) as claude:
            self.assertIn("plugins/kodflow-hooks/.claude-plugin/plugin.json", claude.namelist())
        with ZipFile(BytesIO(self.profiles["openai-local.zip"])) as local:
            self.assertIn("codex/agents/developer-executor-correctness.toml", local.namelist())
            for name in ("hunt-forge", "hunt-ledger"):
                entry = local.getinfo("codex/plugins/kodflow-workflow/bin/" + name)
                self.assertTrue((entry.external_attr >> 16) & 0o111)
        with ZipFile(BytesIO(self.profiles["openai-public.zip"])) as public:
            self.assertTrue(all("/hooks/" not in name for name in public.namelist()))
            self.assertTrue(all(not name.startswith("codex/agents/") for name in public.namelist()))
        with ZipFile(BytesIO(self.profiles["perplexity.zip"])) as perplexity:
            self.assertIn("kodflow-workflow.zip", perplexity.namelist())
            self.assertIn("kodflow-specialists-role-skills-1.zip", perplexity.namelist())
            with ZipFile(BytesIO(perplexity.read("kodflow-workflow.zip"))) as package:
                self.assertIn("skills/search/workflow-perplexity.md", package.namelist())

    def test_snapshot_uses_its_own_renderer(self) -> None:
        render = runpy.run_path(str(ROOT / "scripts/plugin-release.py"))["_render_snapshot"]
        with TemporaryDirectory() as temporary:
            directory = Path(temporary)
            snapshot = directory / "snapshot"
            module = snapshot / "scripts/pluginlib"
            module.mkdir(parents=True)
            (module / "__init__.py").touch()
            (module / "release.py").write_text(
                "def render_profiles(root, commit):\n"
                "    return {'snapshot.txt': (root.name + ':' + commit).encode()}\n",
                encoding="utf-8",
            )
            staged = directory / "artifacts"
            render(snapshot, SHA, staged)
            self.assertEqual(f"snapshot:{SHA}", (staged / "snapshot.txt").read_text())

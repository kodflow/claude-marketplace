#!/usr/bin/env python3
"""Prove the role migration's contracts and generated host parity."""

from hashlib import sha256
import json
from pathlib import Path
import shutil
import sys
from tempfile import TemporaryDirectory
import tomllib
import unittest

from jsonschema import Draft202012Validator
import yaml


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

from pluginlib.roles import build_role_artifacts, compile_roles, load_roles, perplexity_role_skills


SCHEMAS = ROOT / "schemas"
SPECIALISTS = ROOT / "plugins/kodflow-specialists"
PILOT = "developer-executor-correctness"


def digest(data: bytes) -> str:
    return sha256(data).hexdigest()


class RoleCompilerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tracked = compile_roles(ROOT, SCHEMAS)

    def test_every_migrated_role_preserves_legacy_metadata_and_instructions(self):
        golden_path = ROOT / "scripts/tests/fixtures/roles/legacy-projections.json"
        batches = json.loads(golden_path.read_text(encoding="utf-8"))
        self.assertEqual([len(batch) for batch in batches.values()], [3, 9, 15, 8, 14])
        verified = set()
        for batch in batches.values():
            for name, expectations in batch.items():
                with self.subTest(role=name):
                    relative = Path(name)
                    data = self.tracked[relative]
                    _, header, body = data.decode("utf-8").split("---\n", 2)
                    metadata = yaml.safe_load(header)
                    canonical = json.dumps(metadata, ensure_ascii=False, sort_keys=True)
                    self.assertEqual(digest(canonical.encode("utf-8")), expectations["metadataSha256"])
                    self.assertEqual(digest(body.encode("utf-8")), expectations["instructionsSha256"])
                    verified.add(relative)
                    if "codexSha256" in expectations:
                        relative = Path("codex/agents") / f"{relative.stem}.toml"
                        self.assertEqual(digest(self.tracked[relative]), expectations["codexSha256"])
                        verified.add(relative)
        self.assertEqual(verified, set(self.tracked))
        self.assertEqual(sum(path.suffix == ".toml" for path in verified), 35)

    def test_tracked_projections_match_compiler(self):
        for relative, content in self.tracked.items():
            with self.subTest(path=relative):
                self.assertEqual((ROOT / relative).read_bytes(), content)

    def test_host_companions_preserve_custom_agents_and_explain_advisory_skills(self):
        artifacts = build_role_artifacts(ROOT, SCHEMAS)
        self.assertEqual(sum(path.suffix == ".toml" for path in artifacts), 49)
        self.assertEqual(sum(path.name == "SKILL.md" for path in artifacts), 49)
        role_dir = Path("openai/kodflow-specialists/agents")
        role_ids = {
            tomllib.loads(artifacts[role_dir / f"developer-executor-{suffix}.toml"].decode("utf-8"))["name"]
            for suffix in ("correctness", "security", "quality")
        }
        self.assertEqual(role_ids, {
            "developer-executor-correctness", "developer-executor-security",
            "developer-executor-quality",
        })
        skills = perplexity_role_skills(SPECIALISTS, SCHEMAS)
        self.assertEqual(len(skills), 35)
        skill_bytes = skills[f"skills/{PILOT}/SKILL.md"]
        self.assertIn(b"does not provide a separate sub-agent identity, sandbox", skill_bytes)
        self.assertIn(b"as read-only guidance", skill_bytes)
        game_role = artifacts[
            Path("perplexity/kodflow-gamedev/skills/martial-specialist-europe/SKILL.md")
        ]
        self.assertIn(b"route virtual animation work", game_role)
        self.assertNotIn(b"## When governing", game_role)

    def test_role_contracts_and_model_class(self):
        role = next(role for role in load_roles(SPECIALISTS, SCHEMAS) if role.id == PILOT)
        self.assertEqual(role.model_class, "verify")
        self.assertEqual(role.side_effects, "none")
        self.assertIn("repository.read", role.required)
        Draft202012Validator(role.input_schema).validate({"repository": ".", "change": "local"})
        output = Draft202012Validator(role.output_schema)
        output.validate({"agent": "correctness-checker", "issues": [], "commendations": [], "metrics": {}})
        self.assertFalse(output.is_valid({"agent": "correctness-checker", "issues": "bad"}))

    def test_reject_role_paths_outside_source_and_remote_schema_references(self):
        with TemporaryDirectory() as temp:
            outside = Path(temp) / "foreign.md"
            outside.write_text("foreign data", encoding="utf-8")
            package = Path(temp) / "example"
            role = package / "io.github.kodflow/roles" / PILOT
            shutil.copytree(SPECIALISTS / "io.github.kodflow/roles" / PILOT, role)
            instructions = role / "instructions.md"
            instructions.unlink()
            instructions.symlink_to(outside)
            with self.assertRaisesRegex(ValueError, "escapes"):
                load_roles(package, SCHEMAS)
            instructions.unlink()
            instructions.write_text("# Role\n", encoding="utf-8")
            descriptor = role / "role.yaml"
            data = yaml.safe_load(descriptor.read_text(encoding="utf-8"))
            data["outputSchema"] = {"$dynamicRef": "https://example.invalid/external.json"}
            descriptor.write_text(yaml.safe_dump(data), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "stay in its document"):
                load_roles(package, SCHEMAS)
            data["outputSchema"] = "./output.schema.json"
            descriptor.write_text(yaml.safe_dump(data), encoding="utf-8")
            (role / "output.schema.json").write_text(
                '{"$ref": "https://example.invalid/external.json"}', encoding="utf-8",
            )
            with self.assertRaisesRegex(ValueError, "stay in its document"):
                load_roles(package, SCHEMAS)

    def test_inline_and_referenced_role_contracts_are_equivalent(self):
        with TemporaryDirectory() as temp:
            package = Path(temp) / "example"
            role = package / "io.github.kodflow/roles" / PILOT
            shutil.copytree(SPECIALISTS / "io.github.kodflow/roles" / PILOT, role)
            (inline,) = load_roles(package, SCHEMAS)
            descriptor = role / "role.yaml"
            data = yaml.safe_load(descriptor.read_text(encoding="utf-8"))
            for field, file in (("inputSchema", "input.schema.json"), ("outputSchema", "output.schema.json")):
                (role / file).write_text(json.dumps(data[field]), encoding="utf-8")
                data[field] = f"./{file}"
            descriptor.write_text(yaml.safe_dump(data), encoding="utf-8")
            self.assertEqual([inline], load_roles(package, SCHEMAS))

    def test_refuse_role_directory_mismatch_and_conflicting_capabilities(self):
        with TemporaryDirectory() as temp:
            package = Path(temp) / "example"
            role = package / "io.github.kodflow/roles" / "bad-id"
            shutil.copytree(SPECIALISTS / "io.github.kodflow/roles" / PILOT, role)
            with self.assertRaisesRegex(ValueError, "must match"):
                load_roles(package, SCHEMAS)
            destination = role.with_name(PILOT)
            role.rename(destination)
            path = destination / "role.yaml"
            data = yaml.safe_load(path.read_text(encoding="utf-8"))
            data["capabilities"]["optional"].append("repository.read")
            path.write_text(yaml.safe_dump(data), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "both required and optional"):
                load_roles(package, SCHEMAS)


if __name__ == "__main__":
    unittest.main()

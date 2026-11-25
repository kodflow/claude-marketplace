#!/usr/bin/env python3
"""Prove the role migration's contracts and generated host parity."""

from hashlib import sha256
import json
from pathlib import Path
import shutil
import subprocess
import sys
from tempfile import TemporaryDirectory
import tomllib
import unittest

from jsonschema import Draft202012Validator
import yaml


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

from pluginlib.roles import build_role_artifacts, compile_roles, load_roles, perplexity_role_skills
from pluginlib.codex_text import render_agent
from pluginlib.workflows import load_workflow
from sync_plan_review_mode import section, with_section


SCHEMAS = ROOT / "schemas"
SPECIALISTS = ROOT / "plugins/kodflow-specialists"
PILOT = "developer-executor-correctness"
# CodeRabbit #168 identified these intentional changes to the migrated body.
# Their historical hashes remain in the migration fixture.
REVIEWED_INSTRUCTIONS = {
    "asset-specialist-meshy", "martial-specialist-unarmed", "rig-specialist-ik",
    "developer-commentator-worker", "developer-executor-correctness", "developer-executor-shell",
    "developer-specialist-cpp", "developer-specialist-nodejs", "developer-specialist-react",
    "developer-specialist-zig", "devops-executor-linux", "devops-specialist-docker",
    "devops-specialist-infrastructure", "devops-specialist-security", "os-specialist-debian",
    "domain-specialist-systemd", "domain-specialist-telecom",
}


def digest(data: bytes) -> str:
    return sha256(data).hexdigest()


# Plan review mode is one shared section, synced into every role from
# _shared/specialists.md (scripts/sync_plan_review_mode.py), so it evolves
# with that file. The migration baseline pins the rest of each body: the
# section is put back to its text at migration time before hashing.
PLAN_REVIEW_BASELINE = (
    ROOT / "scripts/tests/fixtures/roles/plan-review-mode-baseline.md"
).read_text(encoding="utf-8").rstrip("\n")


def at_baseline(body: str) -> str:
    return with_section(body, PLAN_REVIEW_BASELINE) if section(body) is not None else body


class RoleCompilerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tracked = compile_roles(ROOT, SCHEMAS)
        cls.roles = [
            role
            for package in (ROOT / "plugins").iterdir()
            if package.is_dir()
            for role in load_roles(package, SCHEMAS)
        ]

    def test_historical_roles_preserve_legacy_metadata_and_unedited_instructions(self):
        golden_path = ROOT / "scripts/tests/fixtures/roles/legacy-projections.json"
        batches = json.loads(golden_path.read_text(encoding="utf-8"))
        self.assertEqual([len(batch) for batch in batches.values()], [3, 9, 15, 8, 14])
        historical_roles = set()
        original_codex_count = 0
        for batch in batches.values():
            for name, expectations in batch.items():
                with self.subTest(role=name):
                    relative = Path(name)
                    data = self.tracked[relative]
                    _, header, body = data.decode("utf-8").split("---\n", 2)
                    metadata = yaml.safe_load(header)
                    canonical = json.dumps(metadata, ensure_ascii=False, sort_keys=True)
                    self.assertEqual(digest(canonical.encode("utf-8")), expectations["metadataSha256"])
                    baseline_body = at_baseline(body)
                    if relative.stem not in REVIEWED_INSTRUCTIONS:
                        self.assertEqual(digest(baseline_body.encode("utf-8")), expectations["instructionsSha256"])
                    historical_roles.add(relative.stem)
                    if "codexSha256" in expectations:
                        original_codex_count += 1
                        if relative.stem not in REVIEWED_INSTRUCTIONS:
                            rendered = render_agent(metadata, baseline_body, relative.name)
                            self.assertEqual(digest(rendered.encode("utf-8")), expectations["codexSha256"])
        self.assertEqual(len(historical_roles), 49)
        self.assertEqual(original_codex_count, 35)
        self.assertTrue(REVIEWED_INSTRUCTIONS <= historical_roles)

    def test_tracked_projections_match_compiler(self):
        excluded = {
            line.split("#", 1)[0].strip()
            for line in (ROOT / "scripts/install-exclude.txt").read_text(encoding="utf-8").splitlines()
        }
        expected = {Path(f"plugins/{role.package}/agents/{role.id}.md") for role in self.roles}
        expected |= {Path(f"codex/agents/{role.id}.toml") for role in self.roles if role.package not in excluded}
        self.assertEqual(expected, set(self.tracked))
        for relative, content in self.tracked.items():
            with self.subTest(path=relative):
                self.assertEqual((ROOT / relative).read_bytes(), content)

    def test_host_companions_preserve_custom_agents_and_explain_advisory_skills(self):
        artifacts = build_role_artifacts(ROOT, SCHEMAS)
        expected = {Path(f"openai/{role.package}/agents/{role.id}.toml") for role in self.roles}
        expected |= {Path(f"perplexity/{role.package}/skills/{role.id}/SKILL.md") for role in self.roles}
        self.assertEqual(expected, set(artifacts))
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
        self.assertEqual(
            {f"skills/{role.id}/SKILL.md" for role in self.roles if role.package == SPECIALISTS.name},
            set(skills),
        )
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
        self.assertTrue(output.is_valid("No findings. Full report in the requested file."))
        self.assertFalse(output.is_valid(""))

    def test_correctness_role_accepts_the_search_task_contracts(self):
        role = next(role for role in self.roles if role.id == PILOT)
        output = Draft202012Validator(role.output_schema)
        workflow = load_workflow(ROOT / "plugins/kodflow-workflow/io.github.kodflow/workflows/search.yaml", SCHEMAS)
        tasks = {task.id: task for task in workflow.tasks}
        verified = {"claim": "Reference reviewed", "source": "docs/example.md", "checked": True}
        corroboration = {"claims": [verified]}
        validated = {"claims": [verified], "gaps": ["Missing older reference"]}
        for task, result in (("corroboration", corroboration), ("validate-sources", validated)):
            with self.subTest(task=task):
                output.validate(result)
                Draft202012Validator(tasks[task].output_schema).validate(result)
        self.assertFalse(Draft202012Validator(tasks["validate-sources"].output_schema).is_valid(corroboration))
        self.assertFalse(output.is_valid({"claims": [{"claim": "Evidence missing"}]}))

    def test_plan_review_schemas_accept_objections_without_relaxing_normal_results(self):
        objection = {
            "severity": "material", "claim": "Missing domain fixture", "evidence": "plan.md:12",
            "remedy": "Add coverage", "consulted": [], "unverified": [],
        }
        roles = {role.id: role for role in self.roles}
        for name in ("developer-executor-security", "martial-specialist-unarmed"):
            with self.subTest(role=name):
                output = Draft202012Validator(roles[name].output_schema)
                self.assertTrue(output.is_valid([objection]))
                self.assertTrue(output.is_valid([]))
                self.assertFalse(output.is_valid([{"claim": "Missing fields"}]))
                self.assertFalse(output.is_valid({}))
        self.assertTrue(Draft202012Validator(roles["developer-executor-security"].output_schema).is_valid("Report written"))
        unarmed = Draft202012Validator(roles["martial-specialist-unarmed"].output_schema)
        self.assertTrue(unarmed.is_valid({
            "schema": "panel-member/v1", "agent": "martial-specialist-unarmed",
            "role": "consulted", "status": "ok", "summary": "Rig timing checked.",
        }))

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

    def test_role_checks_schema_referenced_under_an_annotation(self):
        with TemporaryDirectory() as temp:
            package = Path(temp) / "example"
            role = package / "io.github.kodflow/roles" / PILOT
            shutil.copytree(SPECIALISTS / "io.github.kodflow/roles" / PILOT, role)
            descriptor = role / "role.yaml"
            data = yaml.safe_load(descriptor.read_text(encoding="utf-8"))
            data["outputSchema"] = {"$ref": "#/default", "default": {"$ref": "#/$defs/missing"}}
            descriptor.write_text(yaml.safe_dump(data), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "unresolved local JSON Schema reference"):
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

    def test_schema_refs_are_checked_only_in_subschemas(self):
        with TemporaryDirectory() as temp:
            package = Path(temp) / "example"
            role = package / "io.github.kodflow/roles" / PILOT
            shutil.copytree(SPECIALISTS / "io.github.kodflow/roles" / PILOT, role)
            descriptor = role / "role.yaml"
            data = yaml.safe_load(descriptor.read_text(encoding="utf-8"))
            data["outputSchema"] = {
                "type": "object",
                "properties": {"$ref": {"type": "string"}, "$dynamicRef": {"type": "string"}},
                "default": {"$ref": "https://example.invalid/document.json"},
            }
            descriptor.write_text(yaml.safe_dump(data), encoding="utf-8")
            (compiled,) = load_roles(package, SCHEMAS)
            self.assertEqual(data["outputSchema"], compiled.output_schema)
            data["outputSchema"]["properties"]["$ref"]["$ref"] = "https://example.invalid/schema.json"
            descriptor.write_text(yaml.safe_dump(data), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "stay in its document"):
                load_roles(package, SCHEMAS)

    def test_file_contracts_reject_non_finite_numbers(self):
        with TemporaryDirectory() as temp:
            package = Path(temp) / "example"
            role = package / "io.github.kodflow/roles" / PILOT
            shutil.copytree(SPECIALISTS / "io.github.kodflow/roles" / PILOT, role)
            descriptor = role / "role.yaml"
            data = yaml.safe_load(descriptor.read_text(encoding="utf-8"))
            data["outputSchema"] = "./output.schema.json"
            descriptor.write_text(yaml.safe_dump(data), encoding="utf-8")
            (role / "output.schema.json").write_text('{"default": NaN}', encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "must be JSON-compatible"):
                load_roles(package, SCHEMAS)

    def test_codex_toml_preserves_control_characters_and_markdown(self):
        original = 'text\\t\nwith\tquotes """ and controls\f\r\x00\x1f\x7f here'
        document = render_agent({"name": "demo"}, original, "demo.md")
        self.assertEqual(original + "\n", tomllib.loads(document)["developer_instructions"])

    def test_flat_generator_loads_portable_roles_and_stages_workflows(self):
        with TemporaryDirectory() as temp:
            root = Path(temp)
            package = root / "plugins/example"
            role = package / "io.github.kodflow/roles" / PILOT
            shutil.copytree(SPECIALISTS / "io.github.kodflow/roles" / PILOT, role)
            entry = package / "skills/review/SKILL.md"
            entry.parent.mkdir(parents=True)
            entry.write_text(
                "---\nname: review\ndescription: Review a local change\n---\n\n"
                "[Workflow](../../io.github.kodflow/projections/workflows/review-openai.md)\n",
                encoding="utf-8",
            )
            projection = package / "io.github.kodflow/projections/workflows/review-openai.md"
            projection.parent.mkdir(parents=True)
            projection.write_text("# Review workflow\n", encoding="utf-8")
            generator = [sys.executable, str(ROOT / "scripts/build-codex.py"), str(root)]
            subprocess.run(generator, capture_output=True, check=True)
            agent = root / "codex/agents" / f"{PILOT}.toml"
            (expected,) = load_roles(package, SCHEMAS)
            self.assertEqual(expected.render_codex(), agent.read_bytes())
            skill = root / "codex/skills/review"
            self.assertIn("[Workflow](workflow-openai.md)", (skill / "SKILL.md").read_text(encoding="utf-8"))
            self.assertEqual(projection.read_bytes(), (skill / "workflow-openai.md").read_bytes())

            descriptor = role / "role.yaml"
            declaration = yaml.safe_load(descriptor.read_text(encoding="utf-8"))
            declaration["modelClass"] = "unknown"
            descriptor.write_text(yaml.safe_dump(declaration), encoding="utf-8")
            rejected = subprocess.run(generator, capture_output=True, text=True)
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn("'unknown' is not one of", rejected.stderr)

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

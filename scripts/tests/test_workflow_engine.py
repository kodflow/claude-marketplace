"""Workflow compiler and durable scheduler tests using a local fake clock."""

from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from dataclasses import replace
from pathlib import Path
import sys
import tempfile
from threading import Barrier
import unittest

import yaml


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

from pluginlib.state import CompletionRejected, StateError, StateStore
from pluginlib.workflows import (
    HOSTS,
    WorkflowError,
    compile_projections,
    load_workflow,
    render_projection,
    validate_value,
)


TRANSACTION = Path(__file__).parent / "fixtures" / "workflows" / "transaction.yaml"
SEARCH = ROOT / "plugins/kodflow-workflow/io.github.kodflow/workflows/search.yaml"
REVIEW = ROOT / "plugins/kodflow-review/io.github.kodflow/workflows/review.yaml"
CAPS = {"repository.write", "idempotent-write", "human-approval"}


class WorkflowCompilerTest(unittest.TestCase):
    def test_native_instructions_and_unsupported_review_are_deterministic(self):
        outputs = compile_projections(ROOT)
        self.assertEqual(len(outputs), 6)
        for output, content in outputs.items():
            self.assertEqual((ROOT / output).read_bytes(), content)
        search = load_workflow(SEARCH)
        review = load_workflow(REVIEW)
        for host in HOSTS:
            self.assertIn(b"Confirm each required capability", render_projection(search, host))
        self.assertIn(b"review-verify-manifest.sh", render_projection(review, "claude"))
        native = render_projection(review, "openai")
        self.assertIn(b"Timeout: 9600 seconds", native)
        self.assertIn(b"writes only in the designated scratch directory", native)
        self.assertIn(b"developer-executor-quality` with `read` access", native)
        blocked = render_projection(review, "perplexity")
        self.assertIn(b"Stop before starting any task", blocked)
        self.assertNotIn(b"## defensive-security", blocked)

    def test_projection_renders_task_bindings_and_default_envelope(self):
        workflow = load_workflow(SEARCH)
        first = workflow.tasks[0]
        original = render_projection(workflow, "claude")
        binding = {"limit": 17, "query": {"$from": "/inputs/query"}}
        edited = replace(workflow, tasks=(replace(first, bindings=binding), *workflow.tasks[1:]))
        projected = render_projection(edited, "claude")
        self.assertNotEqual(projected, original)
        self.assertIn(b'"limit": 17', projected)
        self.assertIn(b'/inputs/query', projected)
        self.assertIn(b'Use the default input envelope', original)

    def test_schema_and_graph_validation_reject_unsafe_definitions(self):
        source = yaml.safe_load(TRANSACTION.read_text(encoding="utf-8"))
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "workflow.yaml"
            for updates, expected in [
                ({"needs": ["missing"]}, "unknown dependencies"),
                ({"needs": ["check"]}, "form a cycle"),
                ({"ownedPaths": ["../outside"]}, "invalid ownedPaths"),
                ({"idempotencyKey": ""}, "idempotencyKey"),
                ({"inputSchema": {"$ref": "https://example.invalid/schema"}}, "external JSON Schema"),
                ({"inputSchema": {"properties": {"foo": {"$ref": "https://example.invalid/schema"}}}}, "external JSON Schema"),
                ({"inputSchema": {"type": "bogus"}}, "inputSchema"),
            ]:
                with self.subTest(updates=updates):
                    data = {
                        **source,
                        "tasks": [{**source["tasks"][0], **updates}, *source["tasks"][1:]],
                    }
                    path.write_text(yaml.safe_dump(data), encoding="utf-8")
                    with self.assertRaisesRegex(WorkflowError, expected):
                        load_workflow(path)
            del source["tasks"][0]["idempotencyKey"]
            path.write_text(yaml.safe_dump(source), encoding="utf-8")
            with self.assertRaisesRegex(WorkflowError, "retrying a write requires"):
                load_workflow(path)
            path.write_text("id: first\nid: second\n", encoding="utf-8")
            with self.assertRaisesRegex(WorkflowError, "duplicate mapping key"):
                load_workflow(path)

    def test_reference_keys_in_literal_schema_data_are_preserved(self):
        source = yaml.safe_load(TRANSACTION.read_text(encoding="utf-8"))
        schema = source["tasks"][0]["inputSchema"]
        literal = {"$ref": "https://example.invalid/literal"}
        schema.update(default=literal, examples=[literal], enum=[literal])
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "workflow.yaml"
            path.write_text(yaml.safe_dump(source), encoding="utf-8")
            self.assertEqual(load_workflow(path).tasks[0].input_schema["default"], literal)

    def test_fragment_targets_under_annotations_are_checked_without_looping(self):
        source = yaml.safe_load(TRANSACTION.read_text(encoding="utf-8"))
        source["tasks"][0]["inputSchema"] = {
            "$ref": "#/default",
            "default": {"type": "object", "properties": {"next": {"$ref": "#"}}},
        }
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "workflow.yaml"
            path.write_text(yaml.safe_dump(source), encoding="utf-8")
            schema = load_workflow(path).tasks[0].input_schema
            validate_value(schema, {"next": {"next": {}}}, "local recursive instance")

            source["tasks"][0]["inputSchema"]["default"]["properties"]["next"]["$ref"] = "#/$defs/missing"
            path.write_text(yaml.safe_dump(source), encoding="utf-8")
            with self.assertRaisesRegex(WorkflowError, "unresolved local JSON Schema reference"):
                load_workflow(path)

    def test_value_validation_rejects_unregistered_resources(self):
        with self.assertRaisesRegex(WorkflowError, "could not apply JSON Schema"):
            validate_value({"$ref": "urn:kodflow:test:unregistered"}, {}, "local registry")


class WorkflowStateTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.database = Path(tmp.name) / "workflow.sqlite"
        self.now = 100.0
        self.store = self.open_store()

    def open_store(self):
        return StateStore(self.database, clock=lambda: self.now)

    def test_parallel_search_and_pinned_restart(self):
        workflow = load_workflow(SEARCH)
        run = self.store.create_run(workflow, {"query": "install portability"})
        with self.assertRaisesRegex(StateError, "missing required capabilities"):
            self.store.advance(run, {"structured-output"})
        self.assertEqual(self.store.snapshot(run)["status"], "pending")
        frontier = self.store.advance(run, workflow.capabilities)
        self.assertEqual(
            [task.task_id for task in frontier],
            ["local-evidence", "primary-sources", "corroboration"],
        )
        store = self.open_store()
        self.assertEqual(store.active(run), frontier)
        self.assertEqual(store.advance(run, workflow.capabilities), ())
        with self.assertRaisesRegex(WorkflowError, "claims"):
            store.complete(run, "local-evidence", 1, {})
        for task in frontier:
            store.complete(run, task.task_id, task.attempt, {"claims": []})
        (validate,) = store.advance(run, workflow.capabilities)
        self.assertEqual(validate.task_id, "validate-sources")
        self.assertEqual(set(validate.input["dependencies"]), {task.task_id for task in frontier})
        store.complete(run, validate.task_id, validate.attempt, {"claims": [], "gaps": []})
        (synthesize,) = store.advance(run, workflow.capabilities)
        store.complete(run, synthesize.task_id, synthesize.attempt, {"report": "# Context"})
        self.assertEqual(store.snapshot(run)["status"], "completed")
        with self.assertRaisesRegex(StateError, "stale attempt"):
            store.complete(run, synthesize.task_id, synthesize.attempt, {"report": "# Duplicate"})

    def test_two_workers_cannot_claim_the_same_tasks(self):
        workflow = load_workflow(SEARCH)
        run = self.store.create_run(workflow, {"query": "concurrency"})
        barrier = Barrier(2)

        def claim():
            store = self.open_store()
            barrier.wait(timeout=10)
            return store.advance(run, workflow.capabilities)

        with ThreadPoolExecutor(max_workers=2) as workers:
            attempts = list(workers.map(lambda _: claim(), range(2)))
        self.assertEqual(sorted(map(len, attempts)), [0, 3])

    def test_approval_timeout_idempotency_artifacts_and_reverse_compensation(self):
        run = self.store.create_run(load_workflow(TRANSACTION), {"key": "example"})
        (second,) = self.store.advance(run, CAPS)
        self.assertEqual(second.task_id, "second-write")
        self.assertEqual(self.store.snapshot(run)["tasks"]["first-write"]["waiting_kind"], "approval")
        with self.assertRaisesRegex(StateError, "explicit approval"):
            self.store.provide_input(run, "first-write", 0, {})
        self.store.provide_input(run, "first-write", 0, {"signoff": "operator"}, approved=True)
        self.assertEqual(self.store.advance(run, CAPS), ())
        self.store.complete(run, second.task_id, second.attempt, {})
        (first,) = self.store.advance(run, CAPS)
        self.assertEqual(first.user_input, {"signoff": "operator"})
        self.now += 6
        store = self.open_store()
        (retry,) = store.advance(run, CAPS)
        self.assertEqual(retry.attempt, 2)
        self.assertEqual(retry.idempotency_key, first.idempotency_key)
        with self.assertRaisesRegex(StateError, "stale attempt"):
            store.complete(run, first.task_id, first.attempt, {"marker": 0})
        store.complete(run, retry.task_id, retry.attempt, {"marker": 10}, [{"path": "out/first"}])
        (check,) = store.advance(run, CAPS)
        self.assertEqual(check.input, {"prior": 10, "input": "example"})
        store.fail(run, check.task_id, check.attempt, "verification failed")
        self.assertEqual(store.snapshot(run)["status"], "compensating")
        (undo_first,) = store.advance(run, CAPS)
        self.assertEqual(undo_first.task_id, first.task_id)
        self.assertTrue(undo_first.compensation)
        self.assertNotEqual(undo_first.idempotency_key, retry.idempotency_key)
        self.assertEqual(undo_first.task.instructions, "Undo the first test write.")
        self.assertEqual(undo_first.input["result"], {"marker": 10})
        self.assertEqual(store.advance(run, CAPS), ())
        store.complete(run, undo_first.task_id, undo_first.attempt, {}, compensation=True)
        (undo_second,) = store.advance(run, CAPS)
        self.assertEqual(undo_second.task_id, second.task_id)
        store.complete(run, undo_second.task_id, undo_second.attempt, {}, compensation=True)
        self.assertEqual(store.snapshot(run)["status"], "failed")

    def test_operator_input_resumes_same_attempt_and_cancel_stops_claims(self):
        workflow = load_workflow(SEARCH)
        run = self.store.create_run(workflow, {"query": "confirmation"})
        first = self.store.advance(run, workflow.capabilities)[0]
        self.store.wait_for_input(run, first.task_id, first.attempt, "Need more context")
        store = self.open_store()
        self.assertNotIn(first.task_id, {task.task_id for task in store.active(run)})
        with self.assertRaisesRegex(StateError, "must receive operator input"):
            store.complete(run, first.task_id, first.attempt, {"claims": []})
        store.provide_input(run, first.task_id, first.attempt, {"context": "docs"})
        resumed = next(task for task in store.active(run) if task.task_id == first.task_id)
        self.assertEqual(resumed.attempt, first.attempt)
        self.assertEqual(resumed.input, first.input)
        self.assertEqual(resumed.idempotency_key, first.idempotency_key)
        self.assertEqual(resumed.user_input, {"context": "docs"})
        store.cancel(run)
        self.assertEqual(store.snapshot(run)["status"], "cancelled")
        self.assertEqual(store.active(run), ())
        self.assertEqual(store.advance(run, workflow.capabilities), ())

    def test_invalid_frontier_inputs_prevent_earlier_write_claim(self):
        transaction = yaml.safe_load(TRANSACTION.read_text(encoding="utf-8"))
        first, second = transaction["tasks"][:2]
        first["approval"] = False
        second["with"] = {"required": {"$from": "/inputs/missing"}}
        path = self.database.with_suffix(".yaml")
        transaction["tasks"] = [first, second]
        path.write_text(yaml.safe_dump(transaction), encoding="utf-8")
        run = self.store.create_run(load_workflow(path), {})
        self.assertEqual(self.store.advance(run, CAPS), ())
        snapshot = self.store.snapshot(run)
        self.assertEqual(snapshot["status"], "failed")
        self.assertEqual(snapshot["tasks"]["first-write"]["attempt"], 0)
        self.assertEqual(self.store.active(run), ())

    def test_failure_fences_already_claimed_unsubmitted_main_tasks(self):
        import sqlite3

        workflow = load_workflow(SEARCH)
        run = self.store.create_run(workflow, {"query": "failure fence"})
        first, second, _ = self.store.advance(run, workflow.capabilities)
        self.store.fail(run, first.task_id, first.attempt, "blocked", retryable=False)
        with closing(sqlite3.connect(self.database)) as conn:
            with self.assertRaisesRegex(StateError, "no longer has a live workflow attempt"):
                self.store.authorize_submission(conn, second)

    def test_deadline_is_checked_in_completion_transaction(self):
        workflow = load_workflow(SEARCH)
        run = self.store.create_run(workflow, {"query": "read deadline"})
        first = self.store.advance(run, workflow.capabilities)[0]
        self.now = first.deadline
        with self.assertRaisesRegex(CompletionRejected, "deadline exceeded"):
            self.store.complete(run, first.task_id, first.attempt, {"claims": []})
        self.assertEqual(self.store.snapshot(run)["tasks"][first.task_id]["status"], "pending")
        (second,) = self.store.advance(run, workflow.capabilities)
        self.store.complete(run, second.task_id, second.attempt, {"claims": []})
        self.assertEqual(self.store.snapshot(run)["tasks"][second.task_id]["status"], "completed")

    def test_rejected_write_is_compensated_after_missing_artifact(self):
        run = self.store.create_run(load_workflow(TRANSACTION), {"key": "misreported write"})
        (second,) = self.store.advance(run, CAPS)
        self.store.provide_input(run, "first-write", 0, {}, approved=True)
        self.store.complete(run, second.task_id, second.attempt, {})
        (first,) = self.store.advance(run, CAPS)
        with self.assertRaisesRegex(CompletionRejected, "missing declared artifacts"):
            self.store.complete(run, first.task_id, first.attempt, {"marker": "applied"})
        entry = self.store.snapshot(run)["tasks"][first.task_id]
        self.assertEqual(entry["status"], "failed")
        self.assertTrue(entry["effect_applied"])
        (undo,) = self.store.advance(run, CAPS)
        self.assertTrue(undo.compensation)
        self.assertEqual(undo.task_id, first.task_id)
        self.assertEqual(undo.input["result"], {"marker": "applied"})
        self.store.wait_for_input(run, undo.task_id, undo.attempt, "operator note", compensation=True)
        self.store.cancel(run)
        entry = self.store.snapshot(run)["tasks"][first.task_id]
        self.assertEqual(entry["compensation"]["status"], "cancelled")
        (remaining,) = self.store.advance(run, CAPS)
        self.assertEqual(remaining.task_id, second.task_id)

    def test_stale_operator_attempt_cannot_satisfy_new_checkpoint(self):
        workflow = load_workflow(SEARCH)
        run = self.store.create_run(workflow, {"query": "checkpoint"})
        first = self.store.advance(run, workflow.capabilities)[0]
        self.store.wait_for_input(run, first.task_id, first.attempt, "First checkpoint")
        self.store.fail(run, first.task_id, first.attempt, "retry")
        (second,) = self.store.advance(run, workflow.capabilities)
        self.store.wait_for_input(run, second.task_id, second.attempt, "Second checkpoint")
        waiting = self.store.snapshot(run)
        with self.assertRaisesRegex(StateError, "not waiting at this operator checkpoint"):
            self.store.provide_input(run, first.task_id, first.attempt, {"stale": True})
        self.assertEqual(self.store.snapshot(run), waiting)

    def test_review_carries_real_capture_references_to_verifier(self):
        workflow = load_workflow(REVIEW)
        inputs = {"repository": "/repo", "base": "abc", "head": "def"}
        run = self.store.create_run(workflow, inputs)
        frontier = self.store.advance(run, workflow.capabilities)
        self.assertEqual({item.task_id for item in frontier}, {
            "capture-tiers", "correctness", "defensive-security", "quality",
        })
        captured = {"directory": "/scratch/det", "table": "/scratch/det/_table.tsv", "captures": {
            "lint": "/scratch/det/lint.out",
        }}
        for item in frontier:
            output = captured if item.task_id == "capture-tiers" else {"findings": [], "coverage": {"files": []}}
            self.store.complete(run, item.task_id, item.attempt, output)
        (assemble,) = self.store.advance(run, workflow.capabilities)
        self.assertEqual(assemble.input["dependencies"]["capture-tiers"], captured)
        evidence = {"coverageManifest": {"diff_hash": "abc"}, "deterministicTierOutput": captured}
        self.store.complete(run, assemble.task_id, assemble.attempt, evidence)
        (consolidate,) = self.store.advance(run, workflow.capabilities)
        self.assertEqual(consolidate.input["coverageManifest"], evidence["coverageManifest"])
        self.assertEqual(consolidate.input["deterministicTierOutput"], captured)
        self.store.complete(run, consolidate.task_id, consolidate.attempt, {**evidence, "findings": []})
        (verify,) = self.store.advance(run, workflow.capabilities)
        self.assertEqual(verify.input, {"inputs": inputs, "findings": [], **evidence})

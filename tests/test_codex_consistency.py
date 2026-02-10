from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

from team_orchestrator.codex_consistency import (
    CodexConsistencyError,
    CodexConsistencyReviewClient,
    apply_consistency_patch,
    build_consistency_review_request,
    load_change_source,
    validate_consistency_review_response,
)


class CodexConsistencyReviewClientTests(unittest.TestCase):
    def _write_change(
        self,
        root: Path,
        *,
        change_id: str,
        proposal_md: str = "# proposal",
        tasks_md: str = "## tasks\n- [ ] 1.1 sample",
        design_md: str | None = None,
        specs: dict[str, str] | None = None,
    ) -> Path:
        change_dir = root / "openspec" / "changes" / change_id
        change_dir.mkdir(parents=True, exist_ok=True)
        (change_dir / "proposal.md").write_text(proposal_md, encoding="utf-8")
        (change_dir / "tasks.md").write_text(tasks_md, encoding="utf-8")
        if design_md is not None:
            (change_dir / "design.md").write_text(design_md, encoding="utf-8")
        for relative_path, content in (specs or {}).items():
            spec_path = change_dir / relative_path
            spec_path.parent.mkdir(parents=True, exist_ok=True)
            spec_path.write_text(content, encoding="utf-8")
        return change_dir

    def test_load_change_source_reads_required_and_optional_documents(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._write_change(
                root,
                change_id="add-consistency",
                proposal_md="# proposal body",
                tasks_md="## tasks body",
                design_md="## design body",
                specs={
                    "specs/runtime/spec.md": "runtime spec",
                    "specs/adapter/spec.md": "adapter spec",
                },
            )

            source = load_change_source(change_id="add-consistency", openspec_root=root / "openspec")
            payload = source.to_payload()

            self.assertEqual(payload["proposal.md"], "# proposal body")
            self.assertEqual(payload["tasks.md"], "## tasks body")
            self.assertEqual(payload["design.md"], "## design body")
            self.assertEqual(payload["specs/runtime/spec.md"], "runtime spec")
            self.assertEqual(payload["specs/adapter/spec.md"], "adapter spec")

    def test_load_change_source_fails_when_required_file_missing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            change_dir = root / "openspec" / "changes" / "add-consistency"
            change_dir.mkdir(parents=True, exist_ok=True)
            (change_dir / "proposal.md").write_text("# proposal", encoding="utf-8")
            with self.assertRaisesRegex(CodexConsistencyError, r"tasks\.md"):
                load_change_source(change_id="add-consistency", openspec_root=root / "openspec")

    def test_build_consistency_review_request_embeds_source_and_compiled_payload(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._write_change(
                root,
                change_id="add-consistency",
                proposal_md="# proposal",
                tasks_md="## tasks",
            )
            compiled_payload = {
                "teammates": ["teammate-a"],
                "tasks": [{"id": "1.1", "title": "sample", "target_paths": ["*"]}],
            }
            request = build_consistency_review_request(
                change_id="add-consistency",
                compiled_task_config=compiled_payload,
                openspec_root=root / "openspec",
            )
            payload = request.to_payload()

            self.assertEqual(payload["change_id"], "add-consistency")
            self.assertIn("proposal.md", payload["source"])
            self.assertIn("tasks.md", payload["source"])
            self.assertEqual(payload["compiled_task_config"]["tasks"][0]["id"], "1.1")

    def test_review_client_executes_command_with_json_payload(self) -> None:
        request_payload = {
            "teammates": ["teammate-a"],
            "tasks": [{"id": "1.1", "title": "sample", "target_paths": ["*"]}],
        }
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._write_change(root, change_id="add-consistency")
            request = build_consistency_review_request(
                change_id="add-consistency",
                compiled_task_config=request_payload,
                openspec_root=root / "openspec",
            )
            client = CodexConsistencyReviewClient(
                command=[
                    sys.executable,
                    "-c",
                    (
                        "import json,sys;"
                        "payload=json.load(sys.stdin);"
                        "print(json.dumps({"
                        "'is_consistent': True,"
                        "'change_id': payload.get('change_id'),"
                        "'has_tasks_md': 'tasks.md' in payload.get('source', {})"
                        "}))"
                    ),
                ]
            )
            response = client.review(request)
            self.assertTrue(response["is_consistent"])
            self.assertEqual(response["change_id"], "add-consistency")
            self.assertTrue(response["has_tasks_md"])

    def test_review_client_fails_on_non_zero_exit(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._write_change(root, change_id="add-consistency")
            request = build_consistency_review_request(
                change_id="add-consistency",
                compiled_task_config={"teammates": ["teammate-a"], "tasks": []},
                openspec_root=root / "openspec",
            )
            client = CodexConsistencyReviewClient(
                command=[sys.executable, "-c", "import sys;sys.stderr.write('boom');sys.exit(3)"]
            )
            with self.assertRaisesRegex(CodexConsistencyError, r"boom"):
                client.review(request)

    def test_review_client_fails_on_invalid_json_output(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._write_change(root, change_id="add-consistency")
            request = build_consistency_review_request(
                change_id="add-consistency",
                compiled_task_config={"teammates": ["teammate-a"], "tasks": []},
                openspec_root=root / "openspec",
            )
            client = CodexConsistencyReviewClient(command=[sys.executable, "-c", "print('not-json')"])
            with self.assertRaisesRegex(CodexConsistencyError, r"valid JSON object"):
                client.review(request)


class CodexConsistencyPatchTests(unittest.TestCase):
    def test_validate_consistency_response_accepts_inconsistent_with_patch(self) -> None:
        response = validate_consistency_review_response(
            {
                "is_consistent": False,
                "issues": [{"code": "missing-task"}],
                "patch": {
                    "tasks_update": {
                        "1.1": {
                            "title": "updated title",
                            "target_paths": ["src/a.ts"],
                        }
                    }
                },
            }
        )
        self.assertFalse(response["is_consistent"])
        self.assertIsInstance(response["patch"], dict)
        self.assertIn("tasks_update", response["patch"])

    def test_validate_consistency_response_rejects_unknown_patch_key(self) -> None:
        with self.assertRaisesRegex(CodexConsistencyError, r"unknown key"):
            validate_consistency_review_response(
                {
                    "is_consistent": False,
                    "issues": [],
                    "patch": {"unknown": True},
                }
            )

    def test_validate_consistency_response_requires_patch_when_inconsistent(self) -> None:
        with self.assertRaisesRegex(CodexConsistencyError, r"patch is required"):
            validate_consistency_review_response(
                {
                    "is_consistent": False,
                    "issues": [],
                }
            )

    def test_apply_consistency_patch_updates_tasks_and_teammates(self) -> None:
        compiled = {
            "teammates": ["teammate-a"],
            "tasks": [
                {
                    "id": "1.1",
                    "title": "old",
                    "description": "",
                    "target_paths": ["src/a.ts"],
                    "depends_on": [],
                    "requires_plan": False,
                }
            ],
        }
        patched = apply_consistency_patch(
            compiled,
            {
                "teammates": ["teammate-b", "teammate-c"],
                "tasks_update": {
                    "1.1": {
                        "title": "new",
                        "depends_on": "none",
                        "requires_plan": True,
                    }
                },
            },
        )
        self.assertEqual(patched["teammates"], ["teammate-b", "teammate-c"])
        self.assertEqual(patched["tasks"][0]["title"], "new")
        self.assertEqual(patched["tasks"][0]["depends_on"], [])
        self.assertTrue(patched["tasks"][0]["requires_plan"])

    def test_apply_consistency_patch_appends_task(self) -> None:
        compiled = {
            "teammates": ["teammate-a"],
            "tasks": [
                {
                    "id": "1.1",
                    "title": "base",
                    "description": "",
                    "target_paths": ["src/a.ts"],
                    "depends_on": [],
                    "requires_plan": False,
                }
            ],
        }
        patched = apply_consistency_patch(
            compiled,
            {
                "tasks_append": [
                    {
                        "id": "1.2",
                        "title": "follow-up",
                        "description": "desc",
                        "target_paths": ["src/b.ts"],
                        "depends_on": ["1.1"],
                        "requires_plan": True,
                    }
                ]
            },
        )
        self.assertEqual(len(patched["tasks"]), 2)
        self.assertEqual(patched["tasks"][1]["id"], "1.2")
        self.assertEqual(patched["tasks"][1]["depends_on"], ["1.1"])
        self.assertTrue(patched["tasks"][1]["requires_plan"])

    def test_apply_consistency_patch_rejects_unknown_task_update_target(self) -> None:
        with self.assertRaisesRegex(CodexConsistencyError, r"unknown task id"):
            apply_consistency_patch(
                {"teammates": ["teammate-a"], "tasks": [{"id": "1.1", "title": "x", "target_paths": ["*"]}]},
                {"tasks_update": {"9.9": {"title": "missing"}}},
            )

    def test_apply_consistency_patch_rejects_duplicate_appended_task_id(self) -> None:
        with self.assertRaisesRegex(CodexConsistencyError, r"duplicate task id"):
            apply_consistency_patch(
                {"teammates": ["teammate-a"], "tasks": [{"id": "1.1", "title": "x", "target_paths": ["*"]}]},
                {
                    "tasks_append": [
                        {
                            "id": "1.1",
                            "title": "dupe",
                            "target_paths": ["src/new.ts"],
                        }
                    ]
                },
            )


if __name__ == "__main__":
    unittest.main()

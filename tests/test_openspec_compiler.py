from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from team_orchestrator.cli import main
from team_orchestrator.codex_consistency import CodexConsistencyError
from team_orchestrator.openspec_compiler import (
    OpenSpecCompileError,
    _parse_tasks_markdown,
    compile_change_to_config,
)
from team_orchestrator.openspec_template import get_openspec_tasks_template


class OpenSpecCompilerTests(unittest.TestCase):
    def _write_change(self, root: Path, change_id: str, tasks_md: str, *, proposal_md: str | None = None) -> None:
        change_dir = root / "openspec" / "changes" / change_id
        change_dir.mkdir(parents=True, exist_ok=True)
        if proposal_md is not None:
            (change_dir / "proposal.md").write_text(proposal_md, encoding="utf-8")
        (change_dir / "tasks.md").write_text(tasks_md, encoding="utf-8")

    def _write_tasks_markdown(self, root: Path, tasks_md: str) -> Path:
        tasks_path = root / "tasks.md"
        tasks_path.write_text(tasks_md, encoding="utf-8")
        return tasks_path

    def test_compile_tasks_markdown_success(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._write_change(
                root,
                "add-sample",
                "\n".join(
                    [
                        "## 1. 実装タスク",
                        "- [ ] T-001 仕様を定義する（`requires_plan=true`）",
                        "  - 依存: なし",
                        "  - 対象: src/specs/contract.ts",
                        "  - フェーズ担当: implement=implementer",
                        "  - 成果物: 仕様を整理する",
                        "- [ ] T-002 実装する",
                        "  - 依存: T-001",
                        "  - 対象: src/runtime/orchestrator.ts, src/runtime/store.ts",
                        "  - フェーズ担当: implement=implementer",
                        "## 2. 検証項目",
                        "- [x] `python -m unittest discover -s tests -v` が通る",
                        "- [ ] `python -m team_orchestrator.cli run --openspec-change add-sample` で実行開始できる",
                    ]
                ),
            )
            compiled = compile_change_to_config(
                change_id="add-sample",
                openspec_root=root / "openspec",
                overrides_root=root / "task_configs" / "overrides",
            )
            self.assertEqual(compiled["teammates"], ["teammate-a", "teammate-b"])
            self.assertEqual(len(compiled["tasks"]), 2)
            first = compiled["tasks"][0]
            second = compiled["tasks"][1]
            self.assertEqual(first["id"], "T-001")
            self.assertTrue(first["requires_plan"])
            self.assertEqual(first["depends_on"], [])
            self.assertEqual(first["target_paths"], ["src/specs/contract.ts"])
            self.assertEqual(second["depends_on"], ["T-001"])
            self.assertEqual(
                second["target_paths"],
                ["src/runtime/orchestrator.ts", "src/runtime/store.ts"],
            )
            verification_items = compiled["meta"]["verification_items"]
            self.assertEqual(len(verification_items), 2)
            self.assertEqual(verification_items[0]["checked"], True)
            self.assertIn("python -m unittest discover -s tests -v", verification_items[0]["text"])
            self.assertEqual(verification_items[1]["checked"], False)
            self.assertIn("run --openspec-change add-sample", verification_items[1]["text"])

    def test_compile_extracts_verification_items_from_english_heading(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._write_change(
                root,
                "add-english-checks",
                "\n".join(
                    [
                        "## 1. Implementation",
                        "- [ ] 1.1 Define compiler structure",
                        "  - Depends on: none",
                        "  - Target paths: team_orchestrator/openspec_compiler.py",
                        "  - phase assignments: implement=implementer",
                        "  - Deliverable: baseline structure",
                        "- [ ] 1.2 Add dependency parsing",
                        "  - Depends on: 1.1",
                        "  - Target paths: team_orchestrator/openspec_compiler.py",
                        "  - phase assignments: implement=implementer",
                        "## 2. Verification Checklist",
                        "- [x] unit tests pass",
                        "- [ ] smoke run passes",
                    ]
                ),
            )
            compiled = compile_change_to_config(
                change_id="add-english-checks",
                openspec_root=root / "openspec",
                overrides_root=root / "task_configs" / "overrides",
            )
            tasks_by_id = {task["id"]: task for task in compiled["tasks"]}
            self.assertIn("1.1", tasks_by_id)
            self.assertIn("1.2", tasks_by_id)
            self.assertEqual(tasks_by_id["1.2"]["depends_on"], ["1.1"])
            verification_items = compiled["meta"]["verification_items"]
            self.assertEqual(len(verification_items), 2)
            self.assertEqual(verification_items[0]["checked"], True)
            self.assertEqual(verification_items[0]["text"], "unit tests pass")
            self.assertEqual(verification_items[1]["checked"], False)
            self.assertEqual(verification_items[1]["text"], "smoke run passes")

    def test_parse_tasks_markdown_accepts_ja_template_output(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            tasks_path = self._write_tasks_markdown(root, get_openspec_tasks_template("ja"))
            parsed_tasks, verification_items, persona_directives = _parse_tasks_markdown(tasks_path)
            self.assertEqual([task["id"] for task in parsed_tasks], ["1.1", "1.2"])
            self.assertEqual(len(verification_items), 2)
            self.assertIn("persona_defaults", persona_directives)
            self.assertEqual(
                persona_directives["persona_defaults"]["phase_order"],
                ["implement", "review", "spec_check", "test"],
            )

    def test_parse_tasks_markdown_accepts_en_template_output(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            tasks_path = self._write_tasks_markdown(root, get_openspec_tasks_template("en"))
            parsed_tasks, verification_items, persona_directives = _parse_tasks_markdown(tasks_path)
            self.assertEqual([task["id"] for task in parsed_tasks], ["1.1", "1.2"])
            self.assertEqual(len(verification_items), 2)
            self.assertIn("persona_defaults", persona_directives)
            self.assertEqual(
                persona_directives["persona_defaults"]["phase_order"],
                ["implement", "review", "spec_check", "test"],
            )

    def test_compile_fills_default_target_paths_when_missing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._write_change(
                root,
                "add-missing-paths",
                "\n".join(
                    [
                        "## 1. 実装タスク",
                        "- [ ] T-001 仕様を定義する",
                        "  - 依存: なし",
                        "  - フェーズ担当: implement=implementer",
                    ]
                ),
            )
            compiled = compile_change_to_config(
                change_id="add-missing-paths",
                openspec_root=root / "openspec",
                overrides_root=root / "task_configs" / "overrides",
            )
            self.assertEqual(compiled["tasks"][0]["target_paths"], ["*"])
            self.assertEqual(compiled["meta"]["auto_target_path_tasks"], ["T-001"])

    def test_compile_fails_on_dependency_cycle(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._write_change(
                root,
                "add-cycle",
                "\n".join(
                    [
                        "## 1. 実装タスク",
                        "- [ ] T-001 A",
                        "  - 依存: T-002",
                        "  - 対象: src/a.ts",
                        "  - フェーズ担当: implement=implementer",
                        "- [ ] T-002 B",
                        "  - 依存: T-001",
                        "  - 対象: src/b.ts",
                        "  - フェーズ担当: implement=implementer",
                    ]
                ),
            )
            with self.assertRaises(OpenSpecCompileError):
                compile_change_to_config(
                    change_id="add-cycle",
                    openspec_root=root / "openspec",
                    overrides_root=root / "task_configs" / "overrides",
                )

    def test_compile_applies_override_yaml(self) -> None:
        try:
            import yaml  # type: ignore
        except Exception:
            self.skipTest("PyYAML is not installed")

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._write_change(
                root,
                "add-override",
                "\n".join(
                    [
                        "## 1. 実装タスク",
                        "- [ ] T-001 A",
                        "  - 依存: なし",
                        "  - 対象: src/a.ts",
                        "  - フェーズ担当: implement=implementer",
                        "- [ ] T-002 B",
                        "  - 依存: T-001",
                        "  - 対象: src/b.ts",
                        "  - フェーズ担当: implement=implementer",
                    ]
                ),
            )
            override_dir = root / "task_configs" / "overrides"
            override_dir.mkdir(parents=True, exist_ok=True)
            override_path = override_dir / "add-override.yaml"
            override_payload = {
                "teammates": ["tm-a", "tm-b"],
                "requires_plan": {"T-002": True},
                "tasks": {
                    "T-002": {
                        "target_paths": ["src/b-override.ts"],
                    }
                },
            }
            override_path.write_text(yaml.safe_dump(override_payload), encoding="utf-8")

            compiled = compile_change_to_config(
                change_id="add-override",
                openspec_root=root / "openspec",
                overrides_root=override_dir,
            )
            self.assertEqual(compiled["teammates"], ["tm-a", "tm-b"])
            task_by_id = {task["id"]: task for task in compiled["tasks"]}
            self.assertTrue(task_by_id["T-002"]["requires_plan"])
            self.assertEqual(task_by_id["T-002"]["target_paths"], ["src/b-override.ts"])

    def test_cli_rejects_config_and_openspec_change_together(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            config_path = root / "config.json"
            config_path.write_text(
                '{"teammates":["tm-1"],"tasks":[{"id":"T-1","title":"x","target_paths":["src/x.ts"]}]}',
                encoding="utf-8",
            )
            with self.assertRaises(ValueError):
                main(
                    [
                        "run",
                        "--config",
                        str(config_path),
                        "--openspec-change",
                        "add-anything",
                    ]
                )

    def test_compile_cli_applies_consistency_patch_before_output(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._write_change(
                root,
                "add-consistency",
                "\n".join(
                    [
                        "## 1. 実装タスク",
                        "- [ ] 1.1 仕様を更新する",
                        "  - 依存: なし",
                        "  - 対象: src/spec.md",
                        "  - フェーズ担当: implement=implementer",
                        "- [ ] 1.2 実装を更新する",
                        "  - 依存: 1.1",
                        "  - 対象: src/runtime.py",
                        "  - フェーズ担当: implement=implementer",
                    ]
                ),
                proposal_md="# proposal",
            )
            output_path = root / "task_configs" / "compiled.json"
            with mock.patch(
                "team_orchestrator.cli.CodexConsistencyReviewClient.review",
                return_value={
                    "is_consistent": False,
                    "issues": [{"code": "missing-review-task"}],
                    "patch": {
                        "tasks_update": {
                            "1.2": {
                                "title": "実装を更新する（補正済み）",
                            }
                        }
                    },
                },
            ) as mocked_review:
                result = main(
                    [
                        "compile-openspec",
                        "--change-id",
                        "add-consistency",
                        "--openspec-root",
                        str(root / "openspec"),
                        "--overrides-root",
                        str(root / "task_configs" / "overrides"),
                        "--output",
                        str(output_path),
                        "--codex-consistency-command",
                        "echo ok",
                    ]
                )
            self.assertEqual(result, 0)
            self.assertEqual(mocked_review.call_count, 1)
            payload = json.loads(output_path.read_text(encoding="utf-8"))
            self.assertEqual([task["id"] for task in payload["tasks"]], ["1.1", "1.2"])
            self.assertEqual(payload["tasks"][1]["title"], "実装を更新する（補正済み）")
            self.assertEqual(
                payload["meta"]["codex_consistency"],
                {
                    "checked": True,
                    "consistent_before_patch": False,
                    "patched": True,
                    "issues_count": 1,
                },
            )

    def test_compile_cli_fails_when_patched_payload_breaks_validation(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._write_change(
                root,
                "add-consistency-invalid",
                "\n".join(
                    [
                        "## 1. 実装タスク",
                        "- [ ] 1.1 仕様を更新する",
                        "  - 依存: なし",
                        "  - 対象: src/spec.md",
                        "  - フェーズ担当: implement=implementer",
                        "- [ ] 1.2 実装を更新する",
                        "  - 依存: 1.1",
                        "  - 対象: src/runtime.py",
                        "  - フェーズ担当: implement=implementer",
                    ]
                ),
                proposal_md="# proposal",
            )
            with mock.patch(
                "team_orchestrator.cli.CodexConsistencyReviewClient.review",
                return_value={
                    "is_consistent": False,
                    "issues": [{"code": "bad-dependency"}],
                    "patch": {
                        "tasks_update": {
                            "1.2": {
                                "depends_on": ["1.3"],
                            }
                        }
                    },
                },
            ):
                with self.assertRaisesRegex(OpenSpecCompileError, r"unknown dependency '1.3' in task 1.2"):
                    main(
                        [
                            "compile-openspec",
                            "--change-id",
                            "add-consistency-invalid",
                            "--openspec-root",
                            str(root / "openspec"),
                            "--overrides-root",
                            str(root / "task_configs" / "overrides"),
                            "--task-config-root",
                            str(root / "task_configs"),
                            "--codex-consistency-command",
                            "echo ok",
                        ]
                    )

    def test_compile_cli_fails_on_invalid_consistency_patch(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._write_change(
                root,
                "add-consistency-invalid-patch",
                "\n".join(
                    [
                        "## 1. 実装タスク",
                        "- [ ] 1.1 仕様を更新する",
                        "  - 依存: なし",
                        "  - 対象: src/spec.md",
                        "  - フェーズ担当: implement=implementer",
                    ]
                ),
                proposal_md="# proposal",
            )
            with mock.patch(
                "team_orchestrator.cli.CodexConsistencyReviewClient.review",
                return_value={
                    "is_consistent": False,
                    "issues": [{"code": "invalid-patch"}],
                    "patch": {"unknown": True},
                },
            ):
                with self.assertRaisesRegex(OpenSpecCompileError, r"patch has unknown key\(s\): unknown"):
                    main(
                        [
                            "compile-openspec",
                            "--change-id",
                            "add-consistency-invalid-patch",
                            "--openspec-root",
                            str(root / "openspec"),
                            "--overrides-root",
                            str(root / "task_configs" / "overrides"),
                            "--task-config-root",
                            str(root / "task_configs"),
                            "--codex-consistency-command",
                            "echo ok",
                        ]
                    )

    def test_compile_cli_fails_when_consistency_command_fails(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._write_change(
                root,
                "add-consistency-command-failure",
                "\n".join(
                    [
                        "## 1. 実装タスク",
                        "- [ ] 1.1 仕様を更新する",
                        "  - 依存: なし",
                        "  - 対象: src/spec.md",
                        "  - フェーズ担当: implement=implementer",
                    ]
                ),
                proposal_md="# proposal",
            )
            with mock.patch(
                "team_orchestrator.cli.CodexConsistencyReviewClient.review",
                side_effect=CodexConsistencyError("codex consistency command failed (3): boom"),
            ):
                with self.assertRaisesRegex(OpenSpecCompileError, r"codex consistency command failed \(3\): boom"):
                    main(
                        [
                            "compile-openspec",
                            "--change-id",
                            "add-consistency-command-failure",
                            "--openspec-root",
                            str(root / "openspec"),
                            "--overrides-root",
                            str(root / "task_configs" / "overrides"),
                            "--task-config-root",
                            str(root / "task_configs"),
                            "--codex-consistency-command",
                            "echo ok",
                        ]
                    )

    def test_compile_cli_fails_when_consistency_command_missing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._write_change(
                root,
                "add-consistency-command-missing",
                "\n".join(
                    [
                        "## 1. 実装タスク",
                        "- [ ] 1.1 仕様を更新する",
                        "  - 依存: なし",
                        "  - 対象: src/spec.md",
                        "  - フェーズ担当: implement=implementer",
                    ]
                ),
                proposal_md="# proposal",
            )
            with mock.patch.dict(os.environ, {}, clear=False):
                os.environ.pop("CODEX_CONSISTENCY_COMMAND", None)
                with self.assertRaisesRegex(
                    OpenSpecCompileError,
                    r"codex consistency command is not configured",
                ):
                    main(
                        [
                            "compile-openspec",
                            "--change-id",
                            "add-consistency-command-missing",
                            "--openspec-root",
                            str(root / "openspec"),
                            "--overrides-root",
                            str(root / "task_configs" / "overrides"),
                            "--task-config-root",
                            str(root / "task_configs"),
                        ]
                    )

    def test_compile_cli_skip_codex_consistency_skips_review_step(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._write_change(
                root,
                "add-skip-consistency",
                "\n".join(
                    [
                        "## 1. 実装タスク",
                        "- [ ] 1.1 仕様を更新する",
                        "  - 依存: なし",
                        "  - 対象: src/spec.md",
                        "  - フェーズ担当: implement=implementer",
                    ]
                ),
                proposal_md="# proposal",
            )
            output_path = root / "task_configs" / "compiled.json"
            with mock.patch("team_orchestrator.cli.CodexConsistencyReviewClient.review") as mocked_review:
                result = main(
                    [
                        "compile-openspec",
                        "--change-id",
                        "add-skip-consistency",
                        "--openspec-root",
                        str(root / "openspec"),
                        "--overrides-root",
                        str(root / "task_configs" / "overrides"),
                        "--output",
                        str(output_path),
                        "--skip-codex-consistency",
                    ]
                )
            self.assertEqual(result, 0)
            self.assertEqual(mocked_review.call_count, 0)
            payload = json.loads(output_path.read_text(encoding="utf-8"))
            self.assertEqual([task["id"] for task in payload["tasks"]], ["1.1"])
            self.assertEqual(
                payload["meta"]["codex_consistency"],
                {
                    "checked": False,
                    "consistent_before_patch": True,
                    "patched": False,
                    "issues_count": 0,
                },
            )

    def test_compile_cli_consistency_command_executes_without_mock(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._write_change(
                root,
                "add-consistency-non-mock",
                "\n".join(
                    [
                        "## 1. 実装タスク",
                        "- [ ] 1.1 仕様を更新する",
                        "  - 依存: なし",
                        "  - 対象: src/spec.md",
                        "  - フェーズ担当: implement=implementer",
                    ]
                ),
                proposal_md="# proposal",
            )
            checker_script = root / "consistency_checker.py"
            checker_script.write_text(
                "\n".join(
                    [
                        "import json",
                        "import sys",
                        "payload = json.load(sys.stdin)",
                        "if not isinstance(payload, dict) or 'compiled_task_config' not in payload:",
                        "    raise SystemExit(3)",
                        "print(json.dumps({'is_consistent': True, 'issues': []}))",
                    ]
                ),
                encoding="utf-8",
            )
            output_path = root / "task_configs" / "compiled.json"
            result = main(
                [
                    "compile-openspec",
                    "--change-id",
                    "add-consistency-non-mock",
                    "--openspec-root",
                    str(root / "openspec"),
                    "--overrides-root",
                    str(root / "task_configs" / "overrides"),
                    "--output",
                    str(output_path),
                    "--codex-consistency-command",
                    f"{sys.executable} {checker_script}",
                ]
            )
            self.assertEqual(result, 0)
            payload = json.loads(output_path.read_text(encoding="utf-8"))
            self.assertEqual(
                payload["meta"]["codex_consistency"],
                {
                    "checked": True,
                    "consistent_before_patch": True,
                    "patched": False,
                    "issues_count": 0,
                },
            )

    def test_compile_cli_codex_consistency_command_uses_cli_override(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._write_change(
                root,
                "add-cli-consistency-command",
                "\n".join(
                    [
                        "## 1. 実装タスク",
                        "- [ ] 1.1 仕様を更新する",
                        "  - 依存: なし",
                        "  - 対象: src/spec.md",
                        "  - フェーズ担当: implement=implementer",
                    ]
                ),
                proposal_md="# proposal",
            )
            output_path = root / "task_configs" / "compiled.json"
            mocked_client = mock.Mock()
            mocked_client.review.return_value = {"is_consistent": True, "issues": []}
            with mock.patch.dict(os.environ, {"CODEX_CONSISTENCY_COMMAND": "echo env-command"}, clear=False):
                with mock.patch(
                    "team_orchestrator.cli.CodexConsistencyReviewClient",
                    return_value=mocked_client,
                ) as mocked_client_class:
                    result = main(
                        [
                            "compile-openspec",
                            "--change-id",
                            "add-cli-consistency-command",
                            "--openspec-root",
                            str(root / "openspec"),
                            "--overrides-root",
                            str(root / "task_configs" / "overrides"),
                            "--output",
                            str(output_path),
                            "--codex-consistency-command",
                            "echo cli-command",
                        ]
                    )
            self.assertEqual(result, 0)
            self.assertEqual(mocked_client_class.call_count, 1)
            self.assertEqual(mocked_client_class.call_args.kwargs["command"], ["echo", "cli-command"])
            self.assertEqual(mocked_client.review.call_count, 1)
            payload = json.loads(output_path.read_text(encoding="utf-8"))
            self.assertEqual(
                payload["meta"]["codex_consistency"],
                {
                    "checked": True,
                    "consistent_before_patch": True,
                    "patched": False,
                    "issues_count": 0,
                },
            )

    def test_compile_outputs_persona_policy_and_defaults(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            persona_defaults = {
                "phase_order": ["implement", "review"],
                "phase_policies": {
                    "implement": {
                        "active_personas": ["implementer"],
                        "executor_personas": ["implementer"],
                        "state_transition_personas": ["implementer"],
                    },
                    "review": {
                        "active_personas": ["code-reviewer"],
                        "executor_personas": ["code-reviewer"],
                        "state_transition_personas": ["code-reviewer"],
                    },
                },
            }
            task_policy = {
                "phase_overrides": {
                    "review": {
                        "active_personas": ["code-reviewer", "spec-checker"],
                        "executor_personas": ["code-reviewer"],
                        "state_transition_personas": ["code-reviewer"],
                    }
                }
            }
            self._write_change(
                root,
                "add-persona-directives",
                "\n".join(
                    [
                        "## 0. Persona Defaults",
                        f"- persona_defaults: {json.dumps(persona_defaults, ensure_ascii=False)}",
                        "- disable_personas: spec-checker",
                        "## 1. 実装タスク",
                        "- [ ] 1.1 実装する",
                        "  - 依存: なし",
                        "  - 対象: src/a.ts",
                        f"  - persona_policy: {json.dumps(task_policy, ensure_ascii=False)}",
                        "- [ ] 1.2 レビューする",
                        "  - 依存: 1.1",
                        "  - 対象: src/b.ts",
                        "  - フェーズ担当: implement=implementer; review=code-reviewer",
                        "  - disable_personas: test-owner",
                    ]
                ),
            )
            compiled = compile_change_to_config(
                change_id="add-persona-directives",
                openspec_root=root / "openspec",
                overrides_root=root / "task_configs" / "overrides",
            )
            self.assertIn("persona_defaults", compiled)
            self.assertEqual(compiled["persona_defaults"]["phase_order"], ["implement", "review"])
            by_id = {task["id"]: task for task in compiled["tasks"]}
            self.assertIn("persona_policy", by_id["1.1"])
            self.assertIn("persona_policy", by_id["1.2"])
            policy_11 = by_id["1.1"]["persona_policy"]
            self.assertEqual(policy_11["disable_personas"], ["spec-checker"])
            self.assertIn("review", policy_11["phase_overrides"])
            self.assertEqual(policy_11["phase_order"], ["review"])
            policy_12 = by_id["1.2"]["persona_policy"]
            self.assertEqual(policy_12["disable_personas"], ["test-owner", "spec-checker"])
            self.assertIn("implement", policy_12["phase_overrides"])
            self.assertIn("review", policy_12["phase_overrides"])
            self.assertEqual(policy_12["phase_order"], ["implement", "review"])
            resolution = compiled["meta"]["persona_resolution"]
            self.assertEqual(resolution["global_disable_personas"], ["spec-checker"])
            self.assertEqual(resolution["tasks_with_persona_policy"], ["1.1", "1.2"])

    def test_compile_keeps_task_phase_order_when_explicitly_specified(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._write_change(
                root,
                "add-task-phase-order",
                "\n".join(
                    [
                        "## 0. Persona Defaults",
                        '- persona_defaults: {"phase_order": ["implement", "review", "spec_check", "test"]}',
                        "## 1. 実装タスク",
                        "- [ ] 1.1 実装する",
                        "  - 依存: なし",
                        "  - 対象: src/a.ts",
                        "  - persona_policy: {\"phase_order\": [\"implement\"], \"phase_overrides\": {\"implement\": {\"executor_personas\": [\"implementer\"], \"active_personas\": [\"implementer\"], \"state_transition_personas\": [\"implementer\"]}}}",
                    ]
                ),
            )
            compiled = compile_change_to_config(
                change_id="add-task-phase-order",
                openspec_root=root / "openspec",
                overrides_root=root / "task_configs" / "overrides",
            )
            by_id = {task["id"]: task for task in compiled["tasks"]}
            policy_11 = by_id["1.1"]["persona_policy"]
            self.assertEqual(policy_11["phase_order"], ["implement"])
            self.assertIn("implement", policy_11["phase_overrides"])

    def test_compile_fails_on_unknown_persona_in_persona_policy(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._write_change(
                root,
                "add-unknown-persona",
                "\n".join(
                    [
                        "## 1. 実装タスク",
                        "- [ ] 1.1 実装する",
                        "  - 依存: なし",
                        "  - 対象: src/a.ts",
                        '  - persona_policy: {"disable_personas": ["missing-persona"]}',
                    ]
                ),
            )
            with self.assertRaisesRegex(OpenSpecCompileError, r"missing-persona"):
                compile_change_to_config(
                    change_id="add-unknown-persona",
                    openspec_root=root / "openspec",
                    overrides_root=root / "task_configs" / "overrides",
                )

    def test_compile_fails_on_unknown_phase_in_task_persona_policy(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._write_change(
                root,
                "add-unknown-phase",
                "\n".join(
                    [
                        "## 0. Persona Defaults",
                        '- persona_defaults: {"phase_order": ["implement"]}',
                        "## 1. 実装タスク",
                        "- [ ] 1.1 実装する",
                        "  - 依存: なし",
                        "  - 対象: src/a.ts",
                        "  - フェーズ担当: review=code-reviewer",
                    ]
                ),
            )
            with self.assertRaisesRegex(
                OpenSpecCompileError,
                r"unknown persona phase\(s\) in task 1\.1 phase_order: review",
            ):
                compile_change_to_config(
                    change_id="add-unknown-phase",
                    openspec_root=root / "openspec",
                    overrides_root=root / "task_configs" / "overrides",
                )

    def test_compile_fails_on_empty_phase_assignments(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._write_change(
                root,
                "add-empty-phase-assignments",
                "\n".join(
                    [
                        "## 1. 実装タスク",
                        "- [ ] 1.1 実装する",
                        "  - 依存: なし",
                        "  - 対象: src/a.ts",
                        "  - フェーズ担当: ",
                    ]
                ),
            )
            with self.assertRaisesRegex(OpenSpecCompileError, r"phase assignments must not be empty"):
                compile_change_to_config(
                    change_id="add-empty-phase-assignments",
                    openspec_root=root / "openspec",
                    overrides_root=root / "task_configs" / "overrides",
                )

    def test_compile_fails_when_task_lacks_phase_assignments(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._write_change(
                root,
                "add-missing-phase-assignments",
                "\n".join(
                    [
                        "## 1. 実装タスク",
                        "- [ ] 1.1 実装する",
                        "  - 依存: なし",
                        "  - 対象: src/a.ts",
                        "  - フェーズ担当: implement=implementer",
                        "- [ ] 1.2 レビューする",
                        "  - 依存: 1.1",
                        "  - 対象: src/b.ts",
                    ]
                ),
            )
            with self.assertRaisesRegex(
                OpenSpecCompileError,
                r"task 1\.2 must define phase assignments via persona_policy\.phase_overrides",
            ):
                compile_change_to_config(
                    change_id="add-missing-phase-assignments",
                    openspec_root=root / "openspec",
                    overrides_root=root / "task_configs" / "overrides",
                )


if __name__ == "__main__":
    unittest.main()

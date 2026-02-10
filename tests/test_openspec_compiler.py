from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from team_orchestrator.cli import main
from team_orchestrator.openspec_compiler import OpenSpecCompileError, compile_change_to_config


class OpenSpecCompilerTests(unittest.TestCase):
    def _write_change(self, root: Path, change_id: str, tasks_md: str) -> None:
        change_dir = root / "openspec" / "changes" / change_id
        change_dir.mkdir(parents=True, exist_ok=True)
        (change_dir / "tasks.md").write_text(tasks_md, encoding="utf-8")

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
                        "  - 成果物: 仕様を整理する",
                        "- [ ] T-002 実装する",
                        "  - 依存: T-001",
                        "  - 対象: src/runtime/orchestrator.ts, src/runtime/store.ts",
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
                        "  - Deliverable: baseline structure",
                        "- [ ] 1.2 Add dependency parsing",
                        "  - Depends on: 1.1",
                        "  - Target paths: team_orchestrator/openspec_compiler.py",
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
                        "- [ ] T-002 B",
                        "  - 依存: T-001",
                        "  - 対象: src/b.ts",
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
                        "- [ ] T-002 B",
                        "  - 依存: T-001",
                        "  - 対象: src/b.ts",
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
            policy_12 = by_id["1.2"]["persona_policy"]
            self.assertEqual(policy_12["disable_personas"], ["test-owner", "spec-checker"])
            self.assertIn("implement", policy_12["phase_overrides"])
            self.assertIn("review", policy_12["phase_overrides"])
            resolution = compiled["meta"]["persona_resolution"]
            self.assertEqual(resolution["global_disable_personas"], ["spec-checker"])
            self.assertEqual(resolution["tasks_with_persona_policy"], ["1.1", "1.2"])

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
            with self.assertRaisesRegex(OpenSpecCompileError, r"unknown persona phase\(s\) in task 1.1: review"):
                compile_change_to_config(
                    change_id="add-unknown-phase",
                    openspec_root=root / "openspec",
                    overrides_root=root / "task_configs" / "overrides",
                )


if __name__ == "__main__":
    unittest.main()

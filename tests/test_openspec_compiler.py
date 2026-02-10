from __future__ import annotations

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


if __name__ == "__main__":
    unittest.main()

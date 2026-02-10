from __future__ import annotations

import io
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

from team_orchestrator.cli import main
from team_orchestrator.openspec_compiler import compile_change_to_config
from team_orchestrator.openspec_template import get_openspec_tasks_template


class OpenSpecTemplateTests(unittest.TestCase):
    def _compile_template(self, lang: str) -> dict:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            change_id = f"add-template-{lang}"
            change_dir = root / "openspec" / "changes" / change_id
            change_dir.mkdir(parents=True, exist_ok=True)
            (change_dir / "tasks.md").write_text(get_openspec_tasks_template(lang), encoding="utf-8")
            return compile_change_to_config(
                change_id=change_id,
                openspec_root=root / "openspec",
                overrides_root=root / "task_configs" / "overrides",
            )

    def test_ja_template_contains_required_fixed_lines(self) -> None:
        template = get_openspec_tasks_template("ja")
        self.assertIn("persona_defaults.phase_order", template)
        self.assertIn("persona_defaults", template)
        self.assertIn("フェーズ担当", template)
        self.assertIn("テンプレート利用ルール", template)
        self.assertIn("固定行は削除しない", template)
        self.assertIn("## 1. 実装タスク", template)
        self.assertIn("## 2. 検証項目", template)

    def test_en_template_contains_required_fixed_lines(self) -> None:
        template = get_openspec_tasks_template("en")
        self.assertIn("persona_defaults.phase_order", template)
        self.assertIn("persona_defaults", template)
        self.assertIn("phase assignments", template)
        self.assertIn("Template Usage Rules", template)
        self.assertIn("execution.enabled: true", template)
        self.assertIn("## 1. Implementation", template)
        self.assertIn("## 2. Verification Checklist", template)

    def test_ja_template_is_compile_compatible(self) -> None:
        compiled = self._compile_template("ja")
        self.assertEqual([task["id"] for task in compiled["tasks"]], ["1.1", "1.2"])
        self.assertIn("persona_defaults", compiled)
        self.assertEqual(compiled["persona_defaults"]["phase_order"], ["implement", "review", "spec_check", "test"])

    def test_en_template_is_compile_compatible(self) -> None:
        compiled = self._compile_template("en")
        self.assertEqual([task["id"] for task in compiled["tasks"]], ["1.1", "1.2"])
        self.assertIn("persona_defaults", compiled)
        self.assertEqual(compiled["persona_defaults"]["phase_order"], ["implement", "review", "spec_check", "test"])

    def test_cli_print_openspec_template_ja(self) -> None:
        stdout = io.StringIO()
        with redirect_stdout(stdout):
            exit_code = main(["print-openspec-template", "--lang", "ja"])
        self.assertEqual(exit_code, 0)
        self.assertEqual(stdout.getvalue(), get_openspec_tasks_template("ja"))

    def test_cli_print_openspec_template_en(self) -> None:
        stdout = io.StringIO()
        with redirect_stdout(stdout):
            exit_code = main(["print-openspec-template", "--lang", "en"])
        self.assertEqual(exit_code, 0)
        self.assertEqual(stdout.getvalue(), get_openspec_tasks_template("en"))

    def test_cli_print_openspec_template_rejects_unsupported_lang(self) -> None:
        stderr = io.StringIO()
        with redirect_stderr(stderr):
            with self.assertRaises(SystemExit) as context:
                main(["print-openspec-template", "--lang", "fr"])
        self.assertNotEqual(context.exception.code, 0)
        message = stderr.getvalue()
        self.assertIn("invalid choice", message)
        self.assertIn("'fr'", message)
        self.assertIn("ja", message)
        self.assertIn("en", message)


if __name__ == "__main__":
    unittest.main()

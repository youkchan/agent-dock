from __future__ import annotations

import argparse
import unittest

from team_orchestrator.adapter import TemplateTeammateAdapter
from team_orchestrator.cli import _build_teammate_adapter, _load_tasks_payload
from team_orchestrator.codex_adapter import SubprocessCodexAdapter
from team_orchestrator.persona_catalog import load_personas_from_payload


class CliAdapterSelectionTests(unittest.TestCase):
    def test_build_template_adapter(self) -> None:
        args = argparse.Namespace(
            teammate_adapter="template",
            teammate_command="",
            plan_command="",
            execute_command="",
            command_timeout=120,
        )
        adapter = _build_teammate_adapter(args)
        self.assertIsInstance(adapter, TemplateTeammateAdapter)

    def test_build_subprocess_adapter_from_shared_command(self) -> None:
        args = argparse.Namespace(
            teammate_adapter="subprocess",
            teammate_command="echo codex",
            plan_command="",
            execute_command="",
            command_timeout=45,
        )
        adapter = _build_teammate_adapter(args)
        self.assertIsInstance(adapter, SubprocessCodexAdapter)
        self.assertEqual(adapter.plan_command, ["echo", "codex"])
        self.assertEqual(adapter.execute_command, ["echo", "codex"])
        self.assertEqual(adapter.timeout_seconds, 45)

    def test_build_subprocess_adapter_requires_commands(self) -> None:
        args = argparse.Namespace(
            teammate_adapter="subprocess",
            teammate_command="",
            plan_command="",
            execute_command="",
            command_timeout=120,
        )
        with self.assertRaises(ValueError):
            _build_teammate_adapter(args)


class CliPersonaCatalogTests(unittest.TestCase):
    def _base_payload(self) -> dict:
        return {
            "teammates": ["teammate-a"],
            "tasks": [
                {
                    "id": "T-001",
                    "title": "sample",
                    "target_paths": ["*"],
                }
            ],
        }

    def test_default_personas_are_loaded_when_not_specified(self) -> None:
        payload = self._base_payload()
        personas = load_personas_from_payload(payload, source_label="inline")
        self.assertEqual(
            [persona.id for persona in personas],
            ["implementer", "code-reviewer", "spec-checker", "test-owner"],
        )
        self.assertTrue(all(persona.enabled for persona in personas))

    def test_project_persona_same_id_fully_overrides_default(self) -> None:
        payload = self._base_payload()
        payload["personas"] = [
            {
                "id": "implementer",
                "role": "custom",
                "focus": "project-specific implementation checks",
                "can_block": True,
                "enabled": False,
            }
        ]

        personas = load_personas_from_payload(payload, source_label="inline")
        by_id = {persona.id: persona for persona in personas}

        self.assertEqual(by_id["implementer"].role, "custom")
        self.assertEqual(by_id["implementer"].focus, "project-specific implementation checks")
        self.assertTrue(by_id["implementer"].can_block)
        self.assertFalse(by_id["implementer"].enabled)

    def test_project_persona_new_id_is_added(self) -> None:
        payload = self._base_payload()
        payload["personas"] = [
            {
                "id": "security-checker",
                "role": "custom",
                "focus": "security checks",
                "can_block": False,
                "enabled": True,
            }
        ]

        personas = load_personas_from_payload(payload, source_label="inline")
        self.assertEqual(
            [persona.id for persona in personas],
            ["implementer", "code-reviewer", "spec-checker", "test-owner", "security-checker"],
        )

    def test_invalid_persona_unknown_key_fails_on_load(self) -> None:
        payload = self._base_payload()
        payload["personas"] = [
            {
                "id": "custom-a",
                "role": "custom",
                "focus": "custom checks",
                "can_block": False,
                "enabled": True,
                "unexpected": "value",
            }
        ]
        with self.assertRaisesRegex(ValueError, r"unknown keys: unexpected"):
            _load_tasks_payload(payload, source_label="inline")

    def test_invalid_persona_missing_required_key_fails_on_load(self) -> None:
        payload = self._base_payload()
        payload["personas"] = [
            {
                "id": "custom-a",
                "role": "custom",
                "focus": "custom checks",
                "enabled": True,
            }
        ]
        with self.assertRaisesRegex(ValueError, r"missing required keys: can_block"):
            _load_tasks_payload(payload, source_label="inline")

    def test_invalid_persona_type_fails_on_load(self) -> None:
        payload = self._base_payload()
        payload["personas"] = [
            {
                "id": "custom-a",
                "role": "custom",
                "focus": "custom checks",
                "can_block": "false",
                "enabled": True,
            }
        ]
        with self.assertRaisesRegex(ValueError, r"can_block must be bool"):
            _load_tasks_payload(payload, source_label="inline")

    def test_duplicate_persona_id_fails_on_load(self) -> None:
        payload = self._base_payload()
        payload["personas"] = [
            {
                "id": "custom-a",
                "role": "custom",
                "focus": "first",
                "can_block": False,
                "enabled": True,
            },
            {
                "id": "custom-a",
                "role": "custom",
                "focus": "second",
                "can_block": False,
                "enabled": True,
            },
        ]
        with self.assertRaisesRegex(ValueError, r"duplicate persona id\(s\): custom-a"):
            _load_tasks_payload(payload, source_label="inline")


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import argparse
import tempfile
import unittest
from pathlib import Path

from team_orchestrator.adapter import TemplateTeammateAdapter
from team_orchestrator.cli import (
    _bootstrap_run_state,
    _build_run_parser,
    _build_teammate_adapter,
    _load_tasks_payload,
    _resolve_run_mode,
    _should_bootstrap_run_state,
)
from team_orchestrator.codex_adapter import SubprocessCodexAdapter
from team_orchestrator.models import Task
from team_orchestrator.persona_catalog import load_personas_from_payload
from team_orchestrator.state_store import StateStore


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

    def test_load_tasks_payload_returns_none_personas_when_not_specified(self) -> None:
        payload = self._base_payload()
        _, teammates, personas, _ = _load_tasks_payload(payload, source_label="inline")
        self.assertEqual(teammates, ["teammate-a"])
        self.assertIsNone(personas)

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

    def test_persona_execution_config_is_loaded(self) -> None:
        payload = self._base_payload()
        payload["personas"] = [
            {
                "id": "implementer",
                "role": "implementer",
                "focus": "implementation",
                "can_block": False,
                "enabled": True,
                "execution": {
                    "enabled": True,
                    "command_ref": "default",
                    "sandbox": "workspace-write",
                    "timeout_sec": 600,
                },
            }
        ]

        _, _, personas, _ = _load_tasks_payload(payload, source_label="inline")
        self.assertIsNotNone(personas)
        if personas is None:
            self.fail("personas should be set")
        implementer = next(persona for persona in personas if persona.id == "implementer")
        self.assertIsNotNone(implementer.execution)
        if implementer.execution is None:
            self.fail("execution config should be set")
        self.assertTrue(implementer.execution.enabled)
        self.assertEqual(implementer.execution.command_ref, "default")
        self.assertEqual(implementer.execution.sandbox, "workspace-write")
        self.assertEqual(implementer.execution.timeout_sec, 600)

    def test_persona_execution_config_unknown_key_fails_on_load(self) -> None:
        payload = self._base_payload()
        payload["personas"] = [
            {
                "id": "implementer",
                "role": "implementer",
                "focus": "implementation",
                "can_block": False,
                "enabled": True,
                "execution": {
                    "enabled": True,
                    "command_ref": "default",
                    "sandbox": "workspace-write",
                    "timeout_sec": 600,
                    "unexpected": "value",
                },
            }
        ]

        with self.assertRaisesRegex(ValueError, r"execution has unknown keys: unexpected"):
            _load_tasks_payload(payload, source_label="inline")

    def test_persona_execution_config_invalid_timeout_fails_on_load(self) -> None:
        payload = self._base_payload()
        payload["personas"] = [
            {
                "id": "implementer",
                "role": "implementer",
                "focus": "implementation",
                "can_block": False,
                "enabled": True,
                "execution": {
                    "enabled": True,
                    "command_ref": "default",
                    "sandbox": "workspace-write",
                    "timeout_sec": "600",
                },
            }
        ]

        with self.assertRaisesRegex(ValueError, r"execution.timeout_sec must be a positive integer"):
            _load_tasks_payload(payload, source_label="inline")

    def test_persona_defaults_and_task_persona_policy_are_accepted(self) -> None:
        payload = self._base_payload()
        payload["persona_defaults"] = {
            "phase_order": ["implement", "review"],
            "phase_policies": {
                "implement": {
                    "active_personas": ["implementer"],
                    "executor_personas": ["implementer"],
                    "state_transition_personas": ["implementer"],
                },
                "review": {
                    "active_personas": ["code-reviewer", "spec-checker"],
                    "executor_personas": ["code-reviewer"],
                    "state_transition_personas": ["code-reviewer"],
                },
            },
        }
        payload["tasks"][0]["persona_policy"] = {
            "disable_personas": ["spec-checker"],
            "phase_overrides": {
                "review": {
                    "active_personas": ["code-reviewer"],
                    "executor_personas": ["code-reviewer"],
                    "state_transition_personas": ["code-reviewer"],
                }
            },
        }

        tasks, _, _, persona_defaults = _load_tasks_payload(payload, source_label="inline")
        self.assertIsNotNone(tasks[0].persona_policy)
        if tasks[0].persona_policy is None:
            self.fail("persona_policy should be set")
        self.assertEqual(tasks[0].persona_policy["disable_personas"], ["spec-checker"])
        self.assertIn("review", tasks[0].persona_policy["phase_overrides"])
        self.assertIsNotNone(persona_defaults)
        if persona_defaults is None:
            self.fail("persona_defaults should be set")
        self.assertEqual(persona_defaults["phase_order"], ["implement", "review"])

    def test_persona_defaults_unknown_persona_fails_on_load(self) -> None:
        payload = self._base_payload()
        payload["persona_defaults"] = {
            "phase_order": ["implement"],
            "phase_policies": {
                "implement": {
                    "active_personas": ["missing-persona"],
                }
            },
        }

        with self.assertRaisesRegex(ValueError, r"references unknown persona: missing-persona"):
            _load_tasks_payload(payload, source_label="inline")

    def test_task_persona_policy_unknown_persona_fails_on_load(self) -> None:
        payload = self._base_payload()
        payload["tasks"][0]["persona_policy"] = {
            "disable_personas": ["missing-persona"],
        }

        with self.assertRaisesRegex(ValueError, r"references unknown persona: missing-persona"):
            _load_tasks_payload(payload, source_label="inline")


class CliRunModeTests(unittest.TestCase):
    def _task(self, task_id: str, status: str = "pending") -> Task:
        return Task(id=task_id, title=f"title-{task_id}", status=status, target_paths=[f"src/{task_id}.py"])

    def test_run_parser_resume_default_false(self) -> None:
        parser = _build_run_parser()
        args = parser.parse_args([])
        self.assertFalse(args.resume)

    def test_run_parser_resume_true_when_passed(self) -> None:
        parser = _build_run_parser()
        args = parser.parse_args(["--resume"])
        self.assertTrue(args.resume)

    def test_run_parser_resume_requeue_in_progress_default_true(self) -> None:
        parser = _build_run_parser()
        args = parser.parse_args([])
        self.assertTrue(args.resume_requeue_in_progress)

    def test_run_parser_resume_requeue_in_progress_can_be_disabled(self) -> None:
        parser = _build_run_parser()
        args = parser.parse_args(["--no-resume-requeue-in-progress"])
        self.assertFalse(args.resume_requeue_in_progress)

    def test_bootstrap_run_state_resets_on_new_run(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = StateStore(Path(tmp) / "state")
            store.bootstrap_tasks([self._task("A", status="completed")], replace=True)

            _bootstrap_run_state(store=store, tasks=[self._task("B")], resume=False)

            tasks = store.list_tasks()
            self.assertEqual([task.id for task in tasks], ["B"])
            self.assertEqual(tasks[0].status, "pending")

    def test_bootstrap_run_state_keeps_existing_on_resume(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = StateStore(Path(tmp) / "state")
            store.bootstrap_tasks([self._task("A", status="completed")], replace=True)

            _bootstrap_run_state(store=store, tasks=[self._task("A", status="pending")], resume=True)

            tasks = store.list_tasks()
            self.assertEqual([task.id for task in tasks], ["A"])
            self.assertEqual(tasks[0].status, "completed")

    def test_bootstrap_run_state_keeps_existing_progress_log_on_resume(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = StateStore(Path(tmp) / "state")
            store.bootstrap_tasks(
                [
                    Task(
                        id="A",
                        title="title-A",
                        status="blocked",
                        target_paths=["src/A.py"],
                        progress_log=[
                            {"timestamp": 1.23, "source": "stdout", "text": "existing-log"},
                        ],
                    )
                ],
                replace=True,
            )

            _bootstrap_run_state(
                store=store,
                tasks=[Task(id="A", title="title-A", target_paths=["src/A.py"])],
                resume=True,
            )

            task = store.get_task("A")
            self.assertIsNotNone(task)
            if task is None:
                self.fail("task should exist")
            self.assertEqual(task.status, "blocked")
            self.assertEqual(len(task.progress_log), 1)
            self.assertEqual(task.progress_log[0]["text"], "existing-log")

    def test_bootstrap_run_state_new_run_reinitializes_existing_tasks(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = StateStore(Path(tmp) / "state")
            store.bootstrap_tasks(
                [
                    Task(id="A", title="title-A", status="completed", target_paths=["src/A.py"]),
                    Task(
                        id="B",
                        title="title-B",
                        status="blocked",
                        target_paths=["src/B.py"],
                        progress_log=[
                            {"timestamp": 1.0, "source": "stdout", "text": "halfway"},
                        ],
                    ),
                ],
                replace=True,
            )

            _bootstrap_run_state(
                store=store,
                tasks=[Task(id="C", title="title-C", target_paths=["src/C.py"])],
                resume=False,
            )

            tasks = store.list_tasks()
            self.assertEqual([task.id for task in tasks], ["C"])
            self.assertEqual(tasks[0].status, "pending")
            self.assertEqual(tasks[0].progress_log, [])

    def test_bootstrap_run_state_resume_preserves_existing_statuses(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = StateStore(Path(tmp) / "state")
            store.bootstrap_tasks(
                [
                    Task(id="A", title="title-A", status="completed", target_paths=["src/A.py"]),
                    Task(id="B", title="title-B", status="blocked", target_paths=["src/B.py"]),
                ],
                replace=True,
            )

            _bootstrap_run_state(
                store=store,
                tasks=[
                    Task(id="A", title="title-A", status="pending", target_paths=["src/A.py"]),
                    Task(id="B", title="title-B", status="pending", target_paths=["src/B.py"]),
                ],
                resume=True,
            )

            by_id = {task.id: task for task in store.list_tasks()}
            self.assertEqual(by_id["A"].status, "completed")
            self.assertEqual(by_id["B"].status, "blocked")

    def test_bootstrap_run_state_resume_mismatch_error_includes_detail(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = StateStore(Path(tmp) / "state")
            store.bootstrap_tasks(
                [Task(id="A", title="title-A", target_paths=["src/A.py"])],
                replace=True,
            )

            with self.assertRaisesRegex(ValueError, r"resume task_config mismatch: .*A:target_paths"):
                _bootstrap_run_state(
                    store=store,
                    tasks=[Task(id="A", title="title-A", target_paths=["src/other.py"])],
                    resume=True,
                )

    def test_bootstrap_run_state_resume_preserves_intermediate_progress_logs(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = StateStore(Path(tmp) / "state")
            store.bootstrap_tasks(
                [
                    Task(
                        id="A",
                        title="title-A",
                        status="in_progress",
                        target_paths=["src/A.py"],
                        progress_log=[
                            {"timestamp": 1.1, "source": "stdout", "text": "step-1"},
                            {"timestamp": 1.2, "source": "stderr", "text": "step-2"},
                        ],
                    )
                ],
                replace=True,
            )

            _bootstrap_run_state(
                store=store,
                tasks=[Task(id="A", title="title-A", status="pending", target_paths=["src/A.py"])],
                resume=True,
            )

            task = store.get_task("A")
            self.assertIsNotNone(task)
            if task is None:
                self.fail("task should exist")
            self.assertEqual(task.status, "in_progress")
            self.assertEqual([entry["text"] for entry in task.progress_log], ["step-1", "step-2"])

    def test_bootstrap_run_state_resume_fails_on_task_id_mismatch(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = StateStore(Path(tmp) / "state")
            store.bootstrap_tasks([self._task("A", status="completed")], replace=True)

            with self.assertRaisesRegex(ValueError, r"task_ids"):
                _bootstrap_run_state(store=store, tasks=[self._task("B")], resume=True)

    def test_bootstrap_run_state_resume_fails_on_requires_plan_mismatch(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = StateStore(Path(tmp) / "state")
            store.bootstrap_tasks(
                [Task(id="A", title="title-A", requires_plan=True, target_paths=["src/A.py"])],
                replace=True,
            )

            with self.assertRaisesRegex(ValueError, r"A:requires_plan"):
                _bootstrap_run_state(
                    store=store,
                    tasks=[Task(id="A", title="title-A", requires_plan=False, target_paths=["src/A.py"])],
                    resume=True,
                )

    def test_bootstrap_run_state_resume_fails_on_depends_on_mismatch(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = StateStore(Path(tmp) / "state")
            store.bootstrap_tasks(
                [Task(id="A", title="title-A", depends_on=["B"], target_paths=["src/A.py"])],
                replace=True,
            )

            with self.assertRaisesRegex(ValueError, r"A:depends_on"):
                _bootstrap_run_state(
                    store=store,
                    tasks=[Task(id="A", title="title-A", depends_on=["C"], target_paths=["src/A.py"])],
                    resume=True,
                )

    def test_bootstrap_run_state_resume_fails_on_target_paths_mismatch(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = StateStore(Path(tmp) / "state")
            store.bootstrap_tasks(
                [Task(id="A", title="title-A", target_paths=["src/A.py"])],
                replace=True,
            )

            with self.assertRaisesRegex(ValueError, r"A:target_paths"):
                _bootstrap_run_state(
                    store=store,
                    tasks=[Task(id="A", title="title-A", target_paths=["src/other.py"])],
                    resume=True,
                )

    def test_bootstrap_run_state_resume_accepts_different_dependency_order(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = StateStore(Path(tmp) / "state")
            store.bootstrap_tasks(
                [
                    Task(
                        id="A",
                        title="title-A",
                        depends_on=["B", "C"],
                        target_paths=["src/z.py", "src/a.py"],
                        status="completed",
                    )
                ],
                replace=True,
            )

            _bootstrap_run_state(
                store=store,
                tasks=[
                    Task(
                        id="A",
                        title="title-A",
                        depends_on=["C", "B"],
                        target_paths=["src/a.py", "src/z.py"],
                    )
                ],
                resume=True,
            )

            tasks = store.list_tasks()
            self.assertEqual(tasks[0].status, "completed")

    def test_bootstrap_run_state_bootstraps_when_resume_and_empty(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = StateStore(Path(tmp) / "state")

            _bootstrap_run_state(store=store, tasks=[self._task("A")], resume=True)

            tasks = store.list_tasks()
            self.assertEqual([task.id for task in tasks], ["A"])

    def test_should_bootstrap_on_new_run(self) -> None:
        self.assertTrue(
            _should_bootstrap_run_state(
                resume=False,
                has_existing_state=True,
                has_tasks_in_state=True,
            )
        )

    def test_should_bootstrap_when_resume_but_no_existing_state(self) -> None:
        self.assertTrue(
            _should_bootstrap_run_state(
                resume=True,
                has_existing_state=False,
                has_tasks_in_state=False,
            )
        )

    def test_should_bootstrap_when_resume_and_existing_state_is_empty(self) -> None:
        self.assertTrue(
            _should_bootstrap_run_state(
                resume=True,
                has_existing_state=True,
                has_tasks_in_state=False,
            )
        )

    def test_should_not_bootstrap_when_resume_with_existing_tasks(self) -> None:
        self.assertFalse(
            _should_bootstrap_run_state(
                resume=True,
                has_existing_state=True,
                has_tasks_in_state=True,
            )
        )

    def test_resolve_run_mode_new_when_resume_not_requested(self) -> None:
        self.assertEqual(
            _resolve_run_mode(
                resume=False,
                has_existing_state=True,
                has_tasks_in_state=True,
            ),
            "new-run",
        )

    def test_resolve_run_mode_new_when_resume_requested_without_existing_tasks(self) -> None:
        self.assertEqual(
            _resolve_run_mode(
                resume=True,
                has_existing_state=True,
                has_tasks_in_state=False,
            ),
            "new-run",
        )

    def test_resolve_run_mode_resume_when_resume_requested_with_existing_tasks(self) -> None:
        self.assertEqual(
            _resolve_run_mode(
                resume=True,
                has_existing_state=True,
                has_tasks_in_state=True,
            ),
            "resume-run",
        )


if __name__ == "__main__":
    unittest.main()

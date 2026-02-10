from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from team_orchestrator.adapter import TemplateTeammateAdapter
from team_orchestrator.models import Task
from team_orchestrator.orchestrator import AgentTeamsLikeOrchestrator, OrchestratorConfig
from team_orchestrator.persona_catalog import PersonaDefinition, PersonaExecutionConfig
from team_orchestrator.persona_pipeline import PersonaComment
from team_orchestrator.provider import MockOrchestratorProvider, build_provider_from_env
from team_orchestrator.state_store import StateStore


class OrchestratorTests(unittest.TestCase):
    def test_run_completes_with_plan_approval(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = StateStore(Path(tmp) / "state")
            store.bootstrap_tasks(
                [
                    Task(id="T1", title="task1", requires_plan=True, target_paths=["src/a.ts"]),
                    Task(id="T2", title="task2", depends_on=["T1"], requires_plan=False, target_paths=["src/b.ts"]),
                ]
            )
            orchestrator = AgentTeamsLikeOrchestrator(
                store=store,
                adapter=TemplateTeammateAdapter(),
                provider=MockOrchestratorProvider(),
                config=OrchestratorConfig(
                    teammate_ids=["tm-1"],
                    max_rounds=50,
                    max_idle_rounds=10,
                    max_idle_seconds=60,
                ),
            )
            result = orchestrator.run()
            self.assertEqual(result["stop_reason"], "all_tasks_completed")
            self.assertEqual(result["summary"]["completed"], 2)
            self.assertGreaterEqual(result["provider_calls"], 1)

    def test_run_stops_on_idle_round_limit(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = StateStore(Path(tmp) / "state")
            store.bootstrap_tasks(
                [
                    Task(id="T1", title="blocked", depends_on=["UNKNOWN"], target_paths=["src/a.ts"]),
                ]
            )
            orchestrator = AgentTeamsLikeOrchestrator(
                store=store,
                adapter=TemplateTeammateAdapter(),
                provider=MockOrchestratorProvider(),
                config=OrchestratorConfig(
                    teammate_ids=["tm-1"],
                    max_rounds=30,
                    max_idle_rounds=3,
                    max_idle_seconds=60,
                    no_progress_event_interval=10,
                ),
            )
            result = orchestrator.run()
            self.assertEqual(result["stop_reason"], "idle_rounds_limit")
            self.assertEqual(result["summary"]["pending"], 1)
            self.assertEqual(result["provider_calls"], 1)

    def test_human_approval_mode_stops_before_provider_call(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = StateStore(Path(tmp) / "state")
            store.bootstrap_tasks(
                [
                    Task(id="T1", title="task1", requires_plan=True, target_paths=["src/a.ts"]),
                ]
            )
            orchestrator = AgentTeamsLikeOrchestrator(
                store=store,
                adapter=TemplateTeammateAdapter(),
                provider=MockOrchestratorProvider(),
                config=OrchestratorConfig(
                    teammate_ids=["tm-1"],
                    max_rounds=10,
                    human_approval=True,
                ),
            )
            result = orchestrator.run()
            self.assertEqual(result["stop_reason"], "human_approval_required")
            self.assertEqual(result["provider_calls"], 0)

    def test_execution_progress_logs_are_appended_and_preserved(self) -> None:
        class StreamingAdapter:
            def build_plan(self, teammate_id, task):
                del teammate_id
                del task
                return "plan"

            def execute_task(self, teammate_id, task, progress_callback=None):
                del teammate_id
                del task
                if progress_callback is not None:
                    progress_callback("stdout", "step-1")
                    progress_callback("stderr", "step-2")
                return "done"

        with tempfile.TemporaryDirectory() as tmp:
            store = StateStore(Path(tmp) / "state")
            store.bootstrap_tasks(
                [
                    Task(
                        id="T1",
                        title="task1",
                        target_paths=["src/a.ts"],
                        progress_log=[
                            {
                                "timestamp": 1.0,
                                "source": "stdout",
                                "text": "previous-step",
                            }
                        ],
                    ),
                ]
            )
            orchestrator = AgentTeamsLikeOrchestrator(
                store=store,
                adapter=StreamingAdapter(),
                provider=MockOrchestratorProvider(),
                config=OrchestratorConfig(
                    teammate_ids=["tm-1"],
                    max_rounds=5,
                    max_idle_rounds=5,
                    max_idle_seconds=60,
                ),
            )
            result = orchestrator.run()
            self.assertEqual(result["stop_reason"], "all_tasks_completed")
            task = store.get_task("T1")
            self.assertIsNotNone(task)
            if task is None:
                self.fail("task should exist")
            logged_texts = [entry["text"] for entry in task.progress_log]
            self.assertIn("previous-step", logged_texts)
            self.assertIn("step-1", logged_texts)
            self.assertIn("step-2", logged_texts)
            self.assertTrue(any(entry["source"] == "system" for entry in task.progress_log))

    def test_execution_adapter_receives_latest_progress_log_snapshot(self) -> None:
        class SnapshotAdapter:
            def __init__(self) -> None:
                self.seen_progress_texts: list[str] = []

            def build_plan(self, teammate_id, task):
                del teammate_id
                del task
                return "plan"

            def execute_task(self, teammate_id, task, progress_callback=None):
                del teammate_id
                del progress_callback
                self.seen_progress_texts = [
                    str(entry.get("text", ""))
                    for entry in task.progress_log
                    if isinstance(entry, dict)
                ]
                return "done"

        adapter = SnapshotAdapter()
        with tempfile.TemporaryDirectory() as tmp:
            store = StateStore(Path(tmp) / "state")
            store.bootstrap_tasks(
                [
                    Task(
                        id="T1",
                        title="task1",
                        target_paths=["src/a.ts"],
                        progress_log=[
                            {
                                "timestamp": 1.0,
                                "source": "stdout",
                                "text": "existing-log",
                            }
                        ],
                    ),
                ]
            )
            orchestrator = AgentTeamsLikeOrchestrator(
                store=store,
                adapter=adapter,
                provider=MockOrchestratorProvider(),
                config=OrchestratorConfig(
                    teammate_ids=["tm-1"],
                    max_rounds=5,
                    max_idle_rounds=5,
                    max_idle_seconds=60,
                ),
            )
            result = orchestrator.run()
            self.assertEqual(result["stop_reason"], "all_tasks_completed")
            self.assertIn("existing-log", adapter.seen_progress_texts)
            self.assertTrue(
                any(text.startswith("execution started teammate=") for text in adapter.seen_progress_texts)
            )

    def test_persona_execution_subject_claims_owner_with_persona_id(self) -> None:
        class RecordingAdapter:
            def __init__(self) -> None:
                self.seen_execution_ids: list[str] = []

            def build_plan(self, teammate_id, task):
                del teammate_id
                del task
                return "plan"

            def execute_task(self, teammate_id, task, progress_callback=None):
                del task
                del progress_callback
                self.seen_execution_ids.append(teammate_id)
                return "done"

        adapter = RecordingAdapter()
        with tempfile.TemporaryDirectory() as tmp:
            store = StateStore(Path(tmp) / "state")
            store.bootstrap_tasks([Task(id="T1", title="task1", target_paths=["src/a.ts"])])
            orchestrator = AgentTeamsLikeOrchestrator(
                store=store,
                adapter=adapter,
                provider=MockOrchestratorProvider(),
                config=OrchestratorConfig(
                    teammate_ids=["tm-1"],
                    max_rounds=5,
                    max_idle_rounds=5,
                    max_idle_seconds=60,
                    personas=[
                        PersonaDefinition(
                            id="impl-persona",
                            role="custom",
                            focus="execute",
                            can_block=False,
                            enabled=True,
                            execution=PersonaExecutionConfig(
                                enabled=True,
                                command_ref="default",
                                sandbox="workspace-write",
                                timeout_sec=900,
                            ),
                        ),
                    ],
                ),
            )
            result = orchestrator.run()
            self.assertEqual(result["stop_reason"], "all_tasks_completed")
            self.assertEqual(adapter.seen_execution_ids, ["impl-persona"])
            task = store.get_task("T1")
            self.assertIsNotNone(task)
            if task is None:
                self.fail("task should exist")
            self.assertEqual(task.owner, "impl-persona")
            self.assertTrue(
                any(
                    str(entry.get("text", "")).startswith("execution started persona=impl-persona")
                    for entry in task.progress_log
                )
            )

    def test_teammate_execution_is_used_when_no_persona_executor_enabled(self) -> None:
        class RecordingAdapter:
            def __init__(self) -> None:
                self.seen_execution_ids: list[str] = []

            def build_plan(self, teammate_id, task):
                del teammate_id
                del task
                return "plan"

            def execute_task(self, teammate_id, task, progress_callback=None):
                del task
                del progress_callback
                self.seen_execution_ids.append(teammate_id)
                return "done"

        adapter = RecordingAdapter()
        with tempfile.TemporaryDirectory() as tmp:
            store = StateStore(Path(tmp) / "state")
            store.bootstrap_tasks([Task(id="T1", title="task1", target_paths=["src/a.ts"])])
            orchestrator = AgentTeamsLikeOrchestrator(
                store=store,
                adapter=adapter,
                provider=MockOrchestratorProvider(),
                config=OrchestratorConfig(
                    teammate_ids=["tm-1"],
                    max_rounds=5,
                    max_idle_rounds=5,
                    max_idle_seconds=60,
                    personas=[
                        PersonaDefinition(
                            id="impl-persona",
                            role="custom",
                            focus="execute",
                            can_block=False,
                            enabled=True,
                            execution=PersonaExecutionConfig(
                                enabled=False,
                                command_ref="default",
                                sandbox="workspace-write",
                                timeout_sec=900,
                            ),
                        ),
                    ],
                ),
            )
            result = orchestrator.run()
            self.assertEqual(result["stop_reason"], "all_tasks_completed")
            self.assertEqual(adapter.seen_execution_ids, ["tm-1"])

    def test_teammate_execution_is_used_when_personas_not_configured(self) -> None:
        class RecordingAdapter:
            def __init__(self) -> None:
                self.seen_execution_ids: list[str] = []

            def build_plan(self, teammate_id, task):
                del teammate_id
                del task
                return "plan"

            def execute_task(self, teammate_id, task, progress_callback=None):
                del task
                del progress_callback
                self.seen_execution_ids.append(teammate_id)
                return "done"

        adapter = RecordingAdapter()
        with tempfile.TemporaryDirectory() as tmp:
            store = StateStore(Path(tmp) / "state")
            store.bootstrap_tasks([Task(id="T1", title="task1", target_paths=["src/a.ts"])])
            orchestrator = AgentTeamsLikeOrchestrator(
                store=store,
                adapter=adapter,
                provider=MockOrchestratorProvider(),
                config=OrchestratorConfig(
                    teammate_ids=["tm-1"],
                    max_rounds=5,
                    max_idle_rounds=5,
                    max_idle_seconds=60,
                ),
            )
            self.assertEqual(orchestrator.execution_subject_mode, "teammate")
            result = orchestrator.run()
            self.assertEqual(result["stop_reason"], "all_tasks_completed")
            self.assertEqual(adapter.seen_execution_ids, ["tm-1"])

    def test_orchestrator_rejects_configuration_without_execution_subjects(self) -> None:
        class NoFallbackTeammateConfig(OrchestratorConfig):
            def resolved_teammates(self) -> list[str]:
                return []

        with tempfile.TemporaryDirectory() as tmp:
            store = StateStore(Path(tmp) / "state")
            store.bootstrap_tasks([Task(id="T1", title="task1", target_paths=["src/a.ts"])])
            with self.assertRaisesRegex(ValueError, r"at least one execution subject is required"):
                AgentTeamsLikeOrchestrator(
                    store=store,
                    adapter=TemplateTeammateAdapter(),
                    provider=MockOrchestratorProvider(),
                    config=NoFallbackTeammateConfig(
                        teammate_ids=[],
                        personas=[
                            PersonaDefinition(
                                id="impl-persona",
                                role="custom",
                                focus="execute",
                                can_block=False,
                                enabled=True,
                                execution=PersonaExecutionConfig(
                                    enabled=False,
                                    command_ref="default",
                                    sandbox="workspace-write",
                                    timeout_sec=900,
                                ),
                            ),
                        ],
                    ),
                )

    def test_phase_order_handoff_switches_execution_persona(self) -> None:
        class RecordingAdapter:
            def __init__(self) -> None:
                self.seen_execution_ids: list[str] = []

            def build_plan(self, teammate_id, task):
                del teammate_id
                del task
                return "plan"

            def execute_task(self, teammate_id, task, progress_callback=None):
                del task
                del progress_callback
                self.seen_execution_ids.append(teammate_id)
                return f"done:{teammate_id}"

        adapter = RecordingAdapter()
        with tempfile.TemporaryDirectory() as tmp:
            store = StateStore(Path(tmp) / "state")
            store.bootstrap_tasks([Task(id="T1", title="task1", target_paths=["src/a.ts"])])
            orchestrator = AgentTeamsLikeOrchestrator(
                store=store,
                adapter=adapter,
                provider=MockOrchestratorProvider(),
                config=OrchestratorConfig(
                    teammate_ids=["tm-1"],
                    max_rounds=5,
                    max_idle_rounds=5,
                    max_idle_seconds=60,
                    personas=[
                        PersonaDefinition(
                            id="implementer",
                            role="custom",
                            focus="implement",
                            can_block=False,
                            enabled=True,
                            execution=PersonaExecutionConfig(
                                enabled=True,
                                command_ref="default",
                                sandbox="workspace-write",
                                timeout_sec=900,
                            ),
                        ),
                        PersonaDefinition(
                            id="reviewer",
                            role="custom",
                            focus="review",
                            can_block=False,
                            enabled=True,
                            execution=PersonaExecutionConfig(
                                enabled=True,
                                command_ref="default",
                                sandbox="workspace-write",
                                timeout_sec=900,
                            ),
                        ),
                    ],
                    persona_defaults={
                        "phase_order": ["implement", "review"],
                        "phase_policies": {
                            "implement": {"executor_personas": ["implementer"]},
                            "review": {"executor_personas": ["reviewer"]},
                        },
                    },
                ),
            )
            result = orchestrator.run()
            self.assertEqual(result["stop_reason"], "all_tasks_completed")
            self.assertEqual(adapter.seen_execution_ids, ["implementer", "reviewer"])
            task = store.get_task("T1")
            self.assertIsNotNone(task)
            if task is None:
                self.fail("task should exist")
            self.assertEqual(task.status, "completed")
            self.assertEqual(task.current_phase_index, 1)
            self.assertTrue(any("phase handoff to review" in str(entry.get("text", "")) for entry in task.progress_log))

    def test_critical_without_state_transition_permission_does_not_change_status(self) -> None:
        class KickoffCriticalPipeline:
            def evaluate_events(self, events):
                for event in events:
                    if event.get("type") == "Kickoff":
                        return [
                            PersonaComment(
                                persona_id="spec-checker",
                                severity="critical",
                                task_id="T1",
                                event_type="Kickoff",
                                detail="critical but no permission",
                            )
                        ]
                return []

        class SilentProvider:
            provider_name = "silent-provider"

            def run(self, snapshot_json):
                del snapshot_json
                return {
                    "decisions": [],
                    "task_updates": [],
                    "messages": [],
                    "stop": {"should_stop": False, "reason_short": ""},
                    "meta": {
                        "provider": "silent-provider",
                        "model": "mock",
                        "token_budget": {"input": 4000, "output": 800},
                        "elapsed_ms": 1,
                    },
                }

        with tempfile.TemporaryDirectory() as tmp:
            store = StateStore(Path(tmp) / "state")
            store.bootstrap_tasks(
                [
                    Task(id="T1", title="task1", depends_on=["UNKNOWN"], target_paths=["src/a.ts"]),
                ]
            )
            orchestrator = AgentTeamsLikeOrchestrator(
                store=store,
                adapter=TemplateTeammateAdapter(),
                provider=SilentProvider(),
                config=OrchestratorConfig(
                    max_rounds=1,
                    max_idle_rounds=5,
                    max_idle_seconds=60,
                    personas=[
                        PersonaDefinition(
                            id="spec-checker",
                            role="custom",
                            focus="spec checks",
                            can_block=False,
                            enabled=True,
                            execution=PersonaExecutionConfig(
                                enabled=True,
                                command_ref="default",
                                sandbox="workspace-write",
                                timeout_sec=900,
                            ),
                        ),
                    ],
                    persona_defaults={
                        "phase_order": ["review"],
                        "phase_policies": {
                            "review": {
                                "active_personas": ["spec-checker"],
                                "executor_personas": ["spec-checker"],
                                "state_transition_personas": [],
                            }
                        },
                    },
                    auto_approve_fallback=False,
                ),
                persona_pipeline=KickoffCriticalPipeline(),
            )
            result = orchestrator.run()
            self.assertEqual(result["stop_reason"], "max_rounds")
            task = store.get_task("T1")
            self.assertIsNotNone(task)
            if task is None:
                self.fail("task should exist")
            self.assertEqual(task.status, "pending")

    def test_blocker_requires_state_transition_permission_even_with_can_block(self) -> None:
        class KickoffBlockerPipeline:
            def evaluate_events(self, events):
                for event in events:
                    if event.get("type") == "Kickoff":
                        return [
                            PersonaComment(
                                persona_id="custom-blocker",
                                severity="blocker",
                                task_id="T1",
                                event_type="Kickoff",
                                detail="block requested",
                            )
                        ]
                return []

        class SilentProvider:
            provider_name = "silent-provider"

            def run(self, snapshot_json):
                del snapshot_json
                return {
                    "decisions": [],
                    "task_updates": [],
                    "messages": [],
                    "stop": {"should_stop": False, "reason_short": ""},
                    "meta": {
                        "provider": "silent-provider",
                        "model": "mock",
                        "token_budget": {"input": 4000, "output": 800},
                        "elapsed_ms": 1,
                    },
                }

        with tempfile.TemporaryDirectory() as tmp:
            store = StateStore(Path(tmp) / "state")
            store.bootstrap_tasks(
                [
                    Task(id="T1", title="task1", depends_on=["UNKNOWN"], target_paths=["src/a.ts"]),
                ]
            )
            orchestrator = AgentTeamsLikeOrchestrator(
                store=store,
                adapter=TemplateTeammateAdapter(),
                provider=SilentProvider(),
                config=OrchestratorConfig(
                    max_rounds=1,
                    max_idle_rounds=5,
                    max_idle_seconds=60,
                    personas=[
                        PersonaDefinition(
                            id="custom-blocker",
                            role="custom",
                            focus="blocking checks",
                            can_block=True,
                            enabled=True,
                            execution=PersonaExecutionConfig(
                                enabled=True,
                                command_ref="default",
                                sandbox="workspace-write",
                                timeout_sec=900,
                            ),
                        ),
                    ],
                    persona_defaults={
                        "phase_order": ["review"],
                        "phase_policies": {
                            "review": {
                                "active_personas": ["custom-blocker"],
                                "executor_personas": ["custom-blocker"],
                                "state_transition_personas": [],
                            }
                        },
                    },
                    auto_approve_fallback=False,
                ),
                persona_pipeline=KickoffBlockerPipeline(),
            )
            result = orchestrator.run()
            self.assertEqual(result["stop_reason"], "max_rounds")
            self.assertFalse(result["persona_metrics"]["persona_blocker_triggered"])
            task = store.get_task("T1")
            self.assertIsNotNone(task)
            if task is None:
                self.fail("task should exist")
            self.assertEqual(task.status, "pending")

    def test_disable_personas_applies_to_execution_and_comment_evaluation(self) -> None:
        class RecordingAdapter:
            def __init__(self) -> None:
                self.seen_execution_ids: list[str] = []

            def build_plan(self, teammate_id, task):
                del teammate_id
                del task
                return "plan"

            def execute_task(self, teammate_id, task, progress_callback=None):
                del task
                del progress_callback
                self.seen_execution_ids.append(teammate_id)
                raise RuntimeError("execution failed for test")

        class SnapshotCaptureProvider:
            provider_name = "snapshot-capture-provider"

            def __init__(self) -> None:
                self.snapshots: list[dict] = []

            def run(self, snapshot_json):
                self.snapshots.append(snapshot_json)
                return {
                    "decisions": [],
                    "task_updates": [],
                    "messages": [],
                    "stop": {"should_stop": False, "reason_short": ""},
                    "meta": {
                        "provider": "snapshot-capture-provider",
                        "model": "mock",
                        "token_budget": {"input": 4000, "output": 800},
                        "elapsed_ms": 1,
                    },
                }

        adapter = RecordingAdapter()
        provider = SnapshotCaptureProvider()
        with tempfile.TemporaryDirectory() as tmp:
            store = StateStore(Path(tmp) / "state")
            store.bootstrap_tasks(
                [
                    Task(
                        id="T1",
                        title="task1",
                        target_paths=["src/a.ts"],
                        persona_policy={"disable_personas": ["implementer"]},
                    ),
                ]
            )
            orchestrator = AgentTeamsLikeOrchestrator(
                store=store,
                adapter=adapter,
                provider=provider,
                config=OrchestratorConfig(
                    max_rounds=1,
                    max_idle_rounds=5,
                    max_idle_seconds=60,
                    auto_approve_fallback=False,
                    personas=[
                        PersonaDefinition(
                            id="implementer",
                            role="custom",
                            focus="implementation",
                            can_block=False,
                            enabled=True,
                            execution=PersonaExecutionConfig(
                                enabled=True,
                                command_ref="default",
                                sandbox="workspace-write",
                                timeout_sec=900,
                            ),
                        ),
                        PersonaDefinition(
                            id="reviewer",
                            role="custom",
                            focus="review",
                            can_block=False,
                            enabled=True,
                            execution=PersonaExecutionConfig(
                                enabled=True,
                                command_ref="default",
                                sandbox="workspace-write",
                                timeout_sec=900,
                            ),
                        ),
                    ],
                ),
            )
            result = orchestrator.run()
            self.assertEqual(result["stop_reason"], "max_rounds")
            self.assertEqual(adapter.seen_execution_ids, ["reviewer"])
            self.assertGreaterEqual(len(provider.snapshots), 1)
            first_snapshot = provider.snapshots[0]
            blocked_comments = [
                comment
                for comment in first_snapshot.get("persona_comments", [])
                if comment.get("event_type") == "Blocked" and comment.get("task_id") == "T1"
            ]
            self.assertTrue(blocked_comments)
            persona_ids = {comment.get("persona_id") for comment in blocked_comments}
            self.assertEqual(persona_ids, {"reviewer"})

    def test_same_phase_allows_multiple_active_persona_comments(self) -> None:
        class FailingAdapter:
            def build_plan(self, teammate_id, task):
                del teammate_id
                del task
                return "plan"

            def execute_task(self, teammate_id, task, progress_callback=None):
                del teammate_id
                del task
                del progress_callback
                raise RuntimeError("execution failed for test")

        class SnapshotCaptureProvider:
            provider_name = "snapshot-capture-provider"

            def __init__(self) -> None:
                self.snapshots: list[dict] = []

            def run(self, snapshot_json):
                self.snapshots.append(snapshot_json)
                return {
                    "decisions": [],
                    "task_updates": [],
                    "messages": [],
                    "stop": {"should_stop": False, "reason_short": ""},
                    "meta": {
                        "provider": "snapshot-capture-provider",
                        "model": "mock",
                        "token_budget": {"input": 4000, "output": 800},
                        "elapsed_ms": 1,
                    },
                }

        provider = SnapshotCaptureProvider()
        with tempfile.TemporaryDirectory() as tmp:
            store = StateStore(Path(tmp) / "state")
            store.bootstrap_tasks(
                [
                    Task(id="T1", title="task1", target_paths=["src/a.ts"]),
                ]
            )
            orchestrator = AgentTeamsLikeOrchestrator(
                store=store,
                adapter=FailingAdapter(),
                provider=provider,
                config=OrchestratorConfig(
                    max_rounds=1,
                    max_idle_rounds=5,
                    max_idle_seconds=60,
                    auto_approve_fallback=False,
                    personas=[
                        PersonaDefinition(
                            id="reviewer",
                            role="custom",
                            focus="review",
                            can_block=False,
                            enabled=True,
                            execution=PersonaExecutionConfig(
                                enabled=True,
                                command_ref="default",
                                sandbox="workspace-write",
                                timeout_sec=900,
                            ),
                        ),
                        PersonaDefinition(
                            id="spec-checker",
                            role="custom",
                            focus="spec checks",
                            can_block=False,
                            enabled=True,
                            execution=PersonaExecutionConfig(
                                enabled=True,
                                command_ref="default",
                                sandbox="workspace-write",
                                timeout_sec=900,
                            ),
                        ),
                    ],
                    persona_defaults={
                        "phase_order": ["review"],
                        "phase_policies": {
                            "review": {
                                "active_personas": ["reviewer", "spec-checker"],
                                "executor_personas": ["reviewer"],
                                "state_transition_personas": ["reviewer"],
                            }
                        },
                    },
                ),
            )
            result = orchestrator.run()
            self.assertEqual(result["stop_reason"], "max_rounds")
            self.assertEqual(len(provider.snapshots), 1)
            comments = provider.snapshots[0].get("persona_comments", [])
            blocked_comments = [
                comment
                for comment in comments
                if comment.get("event_type") == "Blocked" and comment.get("task_id") == "T1"
            ]
            self.assertEqual(len(blocked_comments), 2)
            self.assertEqual(
                {comment.get("persona_id") for comment in blocked_comments},
                {"reviewer", "spec-checker"},
            )

    def test_persona_blocker_stops_immediately(self) -> None:
        class KickoffBlockerPipeline:
            def evaluate_events(self, events):
                for event in events:
                    if event.get("type") == "Kickoff":
                        return [
                            PersonaComment(
                                persona_id="custom-blocker",
                                severity="blocker",
                                task_id="T1",
                                event_type="Kickoff",
                                detail="stop now",
                            )
                        ]
                return []

        with tempfile.TemporaryDirectory() as tmp:
            store = StateStore(Path(tmp) / "state")
            store.bootstrap_tasks(
                [
                    Task(id="T1", title="task1", depends_on=["UNKNOWN"], target_paths=["src/a.ts"]),
                ]
            )
            orchestrator = AgentTeamsLikeOrchestrator(
                store=store,
                adapter=TemplateTeammateAdapter(),
                provider=MockOrchestratorProvider(),
                config=OrchestratorConfig(
                    teammate_ids=["tm-1"],
                    max_rounds=5,
                    max_idle_rounds=5,
                    max_idle_seconds=60,
                    personas=[
                        PersonaDefinition(
                            id="custom-blocker",
                            role="custom",
                            focus="blocking checks",
                            can_block=True,
                            enabled=True,
                        )
                    ],
                ),
                persona_pipeline=KickoffBlockerPipeline(),
            )
            result = orchestrator.run()
            self.assertEqual(result["stop_reason"], "persona_blocker:custom-blocker")
            self.assertEqual(result["provider_calls"], 0)
            task = store.get_task("T1")
            self.assertIsNotNone(task)
            self.assertEqual(task.status, "pending")

    def test_persona_critical_transitions_task_to_needs_approval(self) -> None:
        class KickoffCriticalPipeline:
            def evaluate_events(self, events):
                for event in events:
                    if event.get("type") == "Kickoff":
                        return [
                            PersonaComment(
                                persona_id="reviewer-x",
                                severity="critical",
                                task_id="T1",
                                event_type="Kickoff",
                                detail="needs approval",
                            )
                        ]
                return []

        class SilentProvider:
            provider_name = "silent-provider"

            def run(self, snapshot_json):
                del snapshot_json
                return {
                    "decisions": [],
                    "task_updates": [],
                    "messages": [],
                    "stop": {"should_stop": False, "reason_short": ""},
                    "meta": {
                        "provider": "silent-provider",
                        "model": "mock",
                        "token_budget": {"input": 4000, "output": 800},
                        "elapsed_ms": 1,
                    },
                }

        with tempfile.TemporaryDirectory() as tmp:
            store = StateStore(Path(tmp) / "state")
            store.bootstrap_tasks(
                [
                    Task(id="T1", title="task1", depends_on=["UNKNOWN"], target_paths=["src/a.ts"]),
                ]
            )
            orchestrator = AgentTeamsLikeOrchestrator(
                store=store,
                adapter=TemplateTeammateAdapter(),
                provider=SilentProvider(),
                config=OrchestratorConfig(
                    teammate_ids=["tm-1"],
                    max_rounds=1,
                    max_idle_rounds=5,
                    max_idle_seconds=60,
                    auto_approve_fallback=False,
                    personas=[
                        PersonaDefinition(
                            id="reviewer-x",
                            role="custom",
                            focus="quality checks",
                            can_block=False,
                            enabled=True,
                        )
                    ],
                ),
                persona_pipeline=KickoffCriticalPipeline(),
            )
            result = orchestrator.run()
            self.assertEqual(result["stop_reason"], "max_rounds")
            task = store.get_task("T1")
            self.assertIsNotNone(task)
            self.assertEqual(task.status, "needs_approval")

    def test_persona_critical_can_be_released_by_auto_approve_fallback(self) -> None:
        class KickoffCriticalPipeline:
            def evaluate_events(self, events):
                for event in events:
                    if event.get("type") == "Kickoff":
                        return [
                            PersonaComment(
                                persona_id="reviewer-x",
                                severity="critical",
                                task_id="T1",
                                event_type="Kickoff",
                                detail="needs approval",
                            )
                        ]
                return []

        class SilentProvider:
            provider_name = "silent-provider"

            def run(self, snapshot_json):
                del snapshot_json
                return {
                    "decisions": [],
                    "task_updates": [],
                    "messages": [],
                    "stop": {"should_stop": False, "reason_short": ""},
                    "meta": {
                        "provider": "silent-provider",
                        "model": "mock",
                        "token_budget": {"input": 4000, "output": 800},
                        "elapsed_ms": 1,
                    },
                }

        with tempfile.TemporaryDirectory() as tmp:
            store = StateStore(Path(tmp) / "state")
            store.bootstrap_tasks(
                [
                    Task(id="T1", title="task1", depends_on=["UNKNOWN"], target_paths=["src/a.ts"]),
                ]
            )
            orchestrator = AgentTeamsLikeOrchestrator(
                store=store,
                adapter=TemplateTeammateAdapter(),
                provider=SilentProvider(),
                config=OrchestratorConfig(
                    teammate_ids=["tm-1"],
                    max_rounds=2,
                    max_idle_rounds=10,
                    max_idle_seconds=60,
                    auto_approve_fallback=True,
                    personas=[
                        PersonaDefinition(
                            id="reviewer-x",
                            role="custom",
                            focus="quality checks",
                            can_block=False,
                            enabled=True,
                        )
                    ],
                ),
                persona_pipeline=KickoffCriticalPipeline(),
            )
            result = orchestrator.run()
            self.assertEqual(result["stop_reason"], "max_rounds")
            task = store.get_task("T1")
            self.assertIsNotNone(task)
            self.assertEqual(task.status, "pending")
            self.assertEqual(result["summary"]["needs_approval"], 0)

    def test_persona_warn_is_rechecked_in_next_round(self) -> None:
        class KickoffWarnPipeline:
            def evaluate_events(self, events):
                for event in events:
                    if event.get("type") == "Kickoff":
                        return [
                            PersonaComment(
                                persona_id="reviewer-x",
                                severity="warn",
                                task_id="T1",
                                event_type="Kickoff",
                                detail="recheck later",
                            )
                        ]
                return []

        class RecordingProvider:
            provider_name = "recording-provider"

            def __init__(self) -> None:
                self.snapshots = []

            def run(self, snapshot_json):
                self.snapshots.append(snapshot_json)
                return {
                    "decisions": [],
                    "task_updates": [],
                    "messages": [],
                    "stop": {"should_stop": False, "reason_short": ""},
                    "meta": {
                        "provider": "recording-provider",
                        "model": "mock",
                        "token_budget": {"input": 4000, "output": 800},
                        "elapsed_ms": 1,
                    },
                }

        provider = RecordingProvider()
        with tempfile.TemporaryDirectory() as tmp:
            store = StateStore(Path(tmp) / "state")
            store.bootstrap_tasks(
                [
                    Task(id="T1", title="task1", depends_on=["UNKNOWN"], target_paths=["src/a.ts"]),
                ]
            )
            orchestrator = AgentTeamsLikeOrchestrator(
                store=store,
                adapter=TemplateTeammateAdapter(),
                provider=provider,
                config=OrchestratorConfig(
                    teammate_ids=["tm-1"],
                    max_rounds=2,
                    max_idle_rounds=10,
                    max_idle_seconds=60,
                    no_progress_event_interval=10,
                    personas=[
                        PersonaDefinition(
                            id="reviewer-x",
                            role="custom",
                            focus="quality checks",
                            can_block=False,
                            enabled=True,
                        )
                    ],
                ),
                persona_pipeline=KickoffWarnPipeline(),
            )
            orchestrator.run()
            self.assertGreaterEqual(len(provider.snapshots), 2)
            event_types = [event["type"] for event in provider.snapshots[1]["events"]]
            self.assertIn("WarnRecheck", event_types)

    def test_persona_comment_limit_default_two(self) -> None:
        class SnapshotCaptureProvider:
            provider_name = "snapshot-capture-provider"

            def __init__(self) -> None:
                self.snapshots: list[dict] = []

            def run(self, snapshot_json):
                self.snapshots.append(snapshot_json)
                return {
                    "decisions": [],
                    "task_updates": [],
                    "messages": [],
                    "stop": {"should_stop": False, "reason_short": ""},
                    "meta": {
                        "provider": "snapshot-capture-provider",
                        "model": "mock",
                        "token_budget": {"input": 4000, "output": 800},
                        "elapsed_ms": 1,
                    },
                }

        with tempfile.TemporaryDirectory() as tmp:
            store = StateStore(Path(tmp) / "state")
            store.bootstrap_tasks(
                [
                    Task(id="T1", title="blocked", depends_on=["UNKNOWN"], target_paths=["src/a.ts"]),
                ]
            )
            provider = SnapshotCaptureProvider()
            orchestrator = AgentTeamsLikeOrchestrator(
                store=store,
                adapter=TemplateTeammateAdapter(),
                provider=provider,
                config=OrchestratorConfig(
                    teammate_ids=["tm-1"],
                    max_rounds=1,
                    max_idle_rounds=3,
                    max_idle_seconds=60,
                    auto_approve_fallback=False,
                ),
            )
            result = orchestrator.run()
            self.assertEqual(result["stop_reason"], "max_rounds")
            self.assertEqual(len(provider.snapshots), 1)
            comments = provider.snapshots[0].get("persona_comments", [])
            kickoff_comments = [comment for comment in comments if comment.get("event_type") == "Kickoff"]
            self.assertEqual(len(kickoff_comments), 2)

    def test_persona_comment_limit_uses_deterministic_order(self) -> None:
        class SnapshotCaptureProvider:
            provider_name = "snapshot-capture-provider"

            def __init__(self) -> None:
                self.snapshots: list[dict] = []

            def run(self, snapshot_json):
                self.snapshots.append(snapshot_json)
                return {
                    "decisions": [],
                    "task_updates": [],
                    "messages": [],
                    "stop": {"should_stop": False, "reason_short": ""},
                    "meta": {
                        "provider": "snapshot-capture-provider",
                        "model": "mock",
                        "token_budget": {"input": 4000, "output": 800},
                        "elapsed_ms": 1,
                    },
                }

        with tempfile.TemporaryDirectory() as tmp:
            store = StateStore(Path(tmp) / "state")
            store.bootstrap_tasks(
                [
                    Task(id="T1", title="blocked", depends_on=["UNKNOWN"], target_paths=["src/a.ts"]),
                ]
            )
            provider = SnapshotCaptureProvider()
            orchestrator = AgentTeamsLikeOrchestrator(
                store=store,
                adapter=TemplateTeammateAdapter(),
                provider=provider,
                config=OrchestratorConfig(
                    teammate_ids=["tm-1"],
                    max_rounds=1,
                    max_idle_rounds=3,
                    max_idle_seconds=60,
                    auto_approve_fallback=False,
                    personas=[
                        PersonaDefinition(
                            id="zeta",
                            role="custom",
                            focus="late",
                            can_block=False,
                            enabled=True,
                        ),
                        PersonaDefinition(
                            id="alpha",
                            role="custom",
                            focus="first",
                            can_block=False,
                            enabled=True,
                        ),
                        PersonaDefinition(
                            id="beta",
                            role="custom",
                            focus="second",
                            can_block=False,
                            enabled=True,
                        ),
                    ],
                ),
            )
            result = orchestrator.run()
            self.assertEqual(result["stop_reason"], "max_rounds")
            self.assertEqual(len(provider.snapshots), 1)
            comments = provider.snapshots[0].get("persona_comments", [])
            kickoff_comments = [comment for comment in comments if comment.get("event_type") == "Kickoff"]
            self.assertEqual(len(kickoff_comments), 2)
            self.assertEqual([comment.get("persona_id") for comment in kickoff_comments], ["alpha", "beta"])

    def test_persona_blocker_without_permission_is_downgraded_to_critical(self) -> None:
        class KickoffBlockerPipeline:
            def evaluate_events(self, events):
                for event in events:
                    if event.get("type") == "Kickoff":
                        return [
                            PersonaComment(
                                persona_id="reviewer-x",
                                severity="blocker",
                                task_id="T1",
                                event_type="Kickoff",
                                detail="block request",
                            )
                        ]
                return []

        class SilentProvider:
            provider_name = "silent-provider"

            def run(self, snapshot_json):
                del snapshot_json
                return {
                    "decisions": [],
                    "task_updates": [],
                    "messages": [],
                    "stop": {"should_stop": False, "reason_short": ""},
                    "meta": {
                        "provider": "silent-provider",
                        "model": "mock",
                        "token_budget": {"input": 4000, "output": 800},
                        "elapsed_ms": 1,
                    },
                }

        with tempfile.TemporaryDirectory() as tmp:
            store = StateStore(Path(tmp) / "state")
            store.bootstrap_tasks(
                [
                    Task(id="T1", title="blocked", depends_on=["UNKNOWN"], target_paths=["src/a.ts"]),
                ]
            )
            orchestrator = AgentTeamsLikeOrchestrator(
                store=store,
                adapter=TemplateTeammateAdapter(),
                provider=SilentProvider(),
                config=OrchestratorConfig(
                    teammate_ids=["tm-1"],
                    max_rounds=1,
                    max_idle_rounds=3,
                    max_idle_seconds=60,
                    auto_approve_fallback=False,
                    personas=[
                        PersonaDefinition(
                            id="reviewer-x",
                            role="custom",
                            focus="quality checks",
                            can_block=False,
                            enabled=True,
                        )
                    ],
                ),
                persona_pipeline=KickoffBlockerPipeline(),
            )
            result = orchestrator.run()
            self.assertEqual(result["stop_reason"], "max_rounds")
            self.assertFalse(result["persona_metrics"]["persona_blocker_triggered"])
            task = store.get_task("T1")
            self.assertIsNotNone(task)
            self.assertEqual(task.status, "needs_approval")

    def test_persona_metrics_are_reported_in_result(self) -> None:
        class KickoffWarnPipeline:
            def evaluate_events(self, events):
                for event in events:
                    if event.get("type") == "Kickoff":
                        return [
                            PersonaComment(
                                persona_id="reviewer-x",
                                severity="warn",
                                task_id="T1",
                                event_type="Kickoff",
                                detail="recheck later",
                            )
                        ]
                return []

        class SilentProvider:
            provider_name = "silent-provider"

            def run(self, snapshot_json):
                del snapshot_json
                return {
                    "decisions": [],
                    "task_updates": [],
                    "messages": [],
                    "stop": {"should_stop": False, "reason_short": ""},
                    "meta": {
                        "provider": "silent-provider",
                        "model": "mock",
                        "token_budget": {"input": 4000, "output": 800},
                        "elapsed_ms": 1,
                    },
                }

        with tempfile.TemporaryDirectory() as tmp:
            store = StateStore(Path(tmp) / "state")
            store.bootstrap_tasks(
                [
                    Task(id="T1", title="blocked", depends_on=["UNKNOWN"], target_paths=["src/a.ts"]),
                ]
            )
            orchestrator = AgentTeamsLikeOrchestrator(
                store=store,
                adapter=TemplateTeammateAdapter(),
                provider=SilentProvider(),
                config=OrchestratorConfig(
                    teammate_ids=["tm-1"],
                    max_rounds=1,
                    max_idle_rounds=3,
                    max_idle_seconds=60,
                    personas=[
                        PersonaDefinition(
                            id="reviewer-x",
                            role="custom",
                            focus="quality checks",
                            can_block=False,
                            enabled=True,
                        )
                    ],
                ),
                persona_pipeline=KickoffWarnPipeline(),
            )
            result = orchestrator.run()
            metrics = result.get("persona_metrics", {})
            self.assertEqual(metrics.get("severity_counts", {}).get("warn"), 1)
            self.assertEqual(metrics.get("warn_recheck_queue_remaining"), 1)
            self.assertFalse(metrics.get("persona_blocker_triggered"))

    def test_provider_factory_mock(self) -> None:
        with tempfile.TemporaryDirectory() as _:
            import os

            original = os.environ.get("ORCHESTRATOR_PROVIDER")
            try:
                os.environ["ORCHESTRATOR_PROVIDER"] = "mock"
                provider = build_provider_from_env()
                self.assertEqual(provider.provider_name, "mock")
            finally:
                if original is None:
                    os.environ.pop("ORCHESTRATOR_PROVIDER", None)
                else:
                    os.environ["ORCHESTRATOR_PROVIDER"] = original

    def test_invalid_provider_task_update_is_skipped(self) -> None:
        class InvalidUpdateProvider:
            provider_name = "invalid-update-provider"

            def run(self, snapshot_json):
                tasks = snapshot_json.get("tasks", [])
                if len(tasks) >= 2:
                    target_task_id = tasks[1]["id"]
                else:
                    target_task_id = tasks[0]["id"]
                return {
                    "decisions": [],
                    "task_updates": [
                        {
                            "task_id": target_task_id,
                            "new_status": "pending",
                            "owner": None,
                            "plan_action": "approve",
                            "feedback": "invalid for this task state",
                        }
                    ],
                    "messages": [],
                    "stop": {"should_stop": False, "reason_short": ""},
                    "meta": {
                        "provider": "invalid-update-provider",
                        "model": "mock",
                        "token_budget": {"input": 4000, "output": 800},
                        "elapsed_ms": 1,
                    },
                }

        with tempfile.TemporaryDirectory() as tmp:
            store = StateStore(Path(tmp) / "state")
            store.bootstrap_tasks(
                [
                    Task(id="T1", title="task1", requires_plan=True, target_paths=["src/a.ts"]),
                    Task(id="T2", title="task2", depends_on=["T1"], requires_plan=False, target_paths=["src/b.ts"]),
                ]
            )
            orchestrator = AgentTeamsLikeOrchestrator(
                store=store,
                adapter=TemplateTeammateAdapter(),
                provider=InvalidUpdateProvider(),
                config=OrchestratorConfig(
                    teammate_ids=["tm-1"],
                    max_rounds=10,
                    max_idle_rounds=3,
                    max_idle_seconds=60,
                    no_progress_event_interval=1,
                    auto_approve_fallback=False,
                ),
            )
            result = orchestrator.run()
            self.assertEqual(result["stop_reason"], "idle_rounds_limit")
            self.assertEqual(result["summary"]["needs_approval"], 1)
            self.assertEqual(result["summary"]["completed"], 0)
            self.assertGreaterEqual(result["provider_calls"], 1)

    def test_execution_status_update_from_provider_is_ignored(self) -> None:
        class MixedProvider:
            provider_name = "mixed-provider"

            def run(self, snapshot_json):
                updates = []
                for task in snapshot_json.get("tasks", []):
                    if task["status"] == "needs_approval" and task["plan_status"] == "submitted":
                        updates.append(
                            {
                                "task_id": task["id"],
                                "new_status": "pending",
                                "owner": None,
                                "plan_action": "approve",
                                "feedback": "approved",
                            }
                        )
                    elif task["status"] == "pending" and task["id"] == "T2":
                        updates.append(
                            {
                                "task_id": task["id"],
                                "new_status": "in_progress",
                                "owner": "tm-1",
                                "plan_action": None,
                                "feedback": "",
                            }
                        )
                return {
                    "decisions": [],
                    "task_updates": updates,
                    "messages": [],
                    "stop": {"should_stop": False, "reason_short": ""},
                    "meta": {
                        "provider": "mixed-provider",
                        "model": "mock",
                        "token_budget": {"input": 4000, "output": 800},
                        "elapsed_ms": 1,
                    },
                }

        with tempfile.TemporaryDirectory() as tmp:
            store = StateStore(Path(tmp) / "state")
            store.bootstrap_tasks(
                [
                    Task(id="T1", title="task1", requires_plan=True, target_paths=["src/a.ts"]),
                    Task(id="T2", title="task2", depends_on=["T1"], requires_plan=False, target_paths=["src/b.ts"]),
                ]
            )
            orchestrator = AgentTeamsLikeOrchestrator(
                store=store,
                adapter=TemplateTeammateAdapter(),
                provider=MixedProvider(),
                config=OrchestratorConfig(
                    teammate_ids=["tm-1"],
                    max_rounds=30,
                    max_idle_rounds=10,
                    max_idle_seconds=60,
                ),
            )
            result = orchestrator.run()
            self.assertEqual(result["stop_reason"], "all_tasks_completed")
            self.assertEqual(result["summary"]["completed"], 2)

    def test_blocked_update_from_provider_is_ignored_if_not_already_blocked(self) -> None:
        class BlockSetterProvider:
            provider_name = "block-setter-provider"

            def run(self, snapshot_json):
                updates = []
                for task in snapshot_json.get("tasks", []):
                    if task["id"] == "T1" and task["status"] == "needs_approval":
                        updates.append(
                            {
                                "task_id": "T1",
                                "new_status": "pending",
                                "owner": None,
                                "plan_action": "approve",
                                "feedback": "approved",
                            }
                        )
                    if task["id"] == "T2" and task["status"] == "pending":
                        updates.append(
                            {
                                "task_id": "T2",
                                "new_status": "blocked",
                                "owner": None,
                                "plan_action": None,
                                "feedback": "",
                            }
                        )
                return {
                    "decisions": [],
                    "task_updates": updates,
                    "messages": [],
                    "stop": {"should_stop": False, "reason_short": ""},
                    "meta": {
                        "provider": "block-setter-provider",
                        "model": "mock",
                        "token_budget": {"input": 4000, "output": 800},
                        "elapsed_ms": 1,
                    },
                }

        with tempfile.TemporaryDirectory() as tmp:
            store = StateStore(Path(tmp) / "state")
            store.bootstrap_tasks(
                [
                    Task(id="T1", title="task1", requires_plan=True, target_paths=["src/a.ts"]),
                    Task(id="T2", title="task2", depends_on=["T1"], requires_plan=False, target_paths=["src/b.ts"]),
                ]
            )
            orchestrator = AgentTeamsLikeOrchestrator(
                store=store,
                adapter=TemplateTeammateAdapter(),
                provider=BlockSetterProvider(),
                config=OrchestratorConfig(
                    teammate_ids=["tm-1"],
                    max_rounds=30,
                    max_idle_rounds=10,
                    max_idle_seconds=60,
                ),
            )
            result = orchestrator.run()
            self.assertEqual(result["stop_reason"], "all_tasks_completed")
            self.assertEqual(result["summary"]["completed"], 2)

    def test_auto_approve_fallback_unblocks_plan(self) -> None:
        class SilentProvider:
            provider_name = "silent-provider"

            def run(self, snapshot_json):
                del snapshot_json
                return {
                    "decisions": [],
                    "task_updates": [],
                    "messages": [],
                    "stop": {"should_stop": False, "reason_short": ""},
                    "meta": {
                        "provider": "silent-provider",
                        "model": "mock",
                        "token_budget": {"input": 4000, "output": 800},
                        "elapsed_ms": 1,
                    },
                }

        with tempfile.TemporaryDirectory() as tmp:
            store = StateStore(Path(tmp) / "state")
            store.bootstrap_tasks(
                [
                    Task(id="T1", title="task1", requires_plan=True, target_paths=["src/a.ts"]),
                    Task(id="T2", title="task2", depends_on=["T1"], requires_plan=False, target_paths=["src/b.ts"]),
                ]
            )
            orchestrator = AgentTeamsLikeOrchestrator(
                store=store,
                adapter=TemplateTeammateAdapter(),
                provider=SilentProvider(),
                config=OrchestratorConfig(
                    teammate_ids=["tm-1"],
                    max_rounds=30,
                    max_idle_rounds=10,
                    max_idle_seconds=60,
                    auto_approve_fallback=True,
                ),
            )
            result = orchestrator.run()
            self.assertEqual(result["stop_reason"], "all_tasks_completed")
            self.assertEqual(result["summary"]["completed"], 2)

    def test_persona_comments_are_attached_to_provider_snapshot(self) -> None:
        class SnapshotCaptureProvider:
            provider_name = "snapshot-capture-provider"

            def __init__(self) -> None:
                self.snapshots: list[dict] = []

            def run(self, snapshot_json):
                self.snapshots.append(snapshot_json)
                return {
                    "decisions": [],
                    "task_updates": [],
                    "messages": [],
                    "stop": {"should_stop": False, "reason_short": ""},
                    "meta": {
                        "provider": "snapshot-capture-provider",
                        "model": "mock",
                        "token_budget": {"input": 4000, "output": 800},
                        "elapsed_ms": 1,
                    },
                }

        with tempfile.TemporaryDirectory() as tmp:
            store = StateStore(Path(tmp) / "state")
            store.bootstrap_tasks(
                [
                    Task(id="T1", title="task1", requires_plan=True, target_paths=["src/a.ts"]),
                ]
            )
            provider = SnapshotCaptureProvider()
            orchestrator = AgentTeamsLikeOrchestrator(
                store=store,
                adapter=TemplateTeammateAdapter(),
                provider=provider,
                config=OrchestratorConfig(
                    teammate_ids=["tm-1"],
                    max_rounds=1,
                    max_idle_rounds=3,
                    max_idle_seconds=60,
                    auto_approve_fallback=False,
                ),
            )
            result = orchestrator.run()
            self.assertEqual(result["stop_reason"], "max_rounds")
            self.assertEqual(len(provider.snapshots), 1)
            first_snapshot = provider.snapshots[0]
            comments = first_snapshot.get("persona_comments", [])
            self.assertGreaterEqual(len(comments), 1)
            self.assertTrue(
                any(comment.get("event_type") == "NeedsApproval" and comment.get("task_id") == "T1" for comment in comments)
            )
            self.assertEqual(set(first_snapshot.keys()).intersection({"personas", "persona_comments"}), {"personas", "persona_comments"})

    def test_persona_pipeline_skips_disabled_personas(self) -> None:
        class SnapshotCaptureProvider:
            provider_name = "snapshot-capture-provider"

            def __init__(self) -> None:
                self.snapshots: list[dict] = []

            def run(self, snapshot_json):
                self.snapshots.append(snapshot_json)
                return {
                    "decisions": [],
                    "task_updates": [],
                    "messages": [],
                    "stop": {"should_stop": False, "reason_short": ""},
                    "meta": {
                        "provider": "snapshot-capture-provider",
                        "model": "mock",
                        "token_budget": {"input": 4000, "output": 800},
                        "elapsed_ms": 1,
                    },
                }

        with tempfile.TemporaryDirectory() as tmp:
            store = StateStore(Path(tmp) / "state")
            store.bootstrap_tasks(
                [
                    Task(id="T1", title="task1", requires_plan=True, target_paths=["src/a.ts"]),
                ]
            )
            provider = SnapshotCaptureProvider()
            orchestrator = AgentTeamsLikeOrchestrator(
                store=store,
                adapter=TemplateTeammateAdapter(),
                provider=provider,
                config=OrchestratorConfig(
                    teammate_ids=["tm-1"],
                    max_rounds=1,
                    max_idle_rounds=3,
                    max_idle_seconds=60,
                    auto_approve_fallback=False,
                    personas=[
                        PersonaDefinition(
                            id="enabled-checker",
                            role="custom",
                            focus="enabled focus",
                            can_block=False,
                            enabled=True,
                        ),
                        PersonaDefinition(
                            id="disabled-checker",
                            role="custom",
                            focus="disabled focus",
                            can_block=False,
                            enabled=False,
                        ),
                    ],
                ),
            )
            result = orchestrator.run()
            self.assertEqual(result["stop_reason"], "max_rounds")
            first_snapshot = provider.snapshots[0]
            comments = first_snapshot.get("persona_comments", [])
            persona_ids = {comment.get("persona_id") for comment in comments}
            self.assertIn("enabled-checker", persona_ids)
            self.assertNotIn("disabled-checker", persona_ids)


if __name__ == "__main__":
    unittest.main()

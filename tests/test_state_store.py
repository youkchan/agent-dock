from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from team_orchestrator.models import Task
from team_orchestrator.state_store import StateStore


class StateStoreTests(unittest.TestCase):
    def test_dependency_and_plan_gate(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = StateStore(Path(tmp))
            store.bootstrap_tasks(
                [
                    Task(id="A", title="plan first", requires_plan=True, target_paths=["src/a.ts"]),
                    Task(id="B", title="depends", depends_on=["A"], target_paths=["src/b.ts"]),
                ]
            )

            planning = store.claim_plan_task("tm-1")
            self.assertIsNotNone(planning)
            self.assertEqual(planning.id, "A")

            submitted = store.submit_plan("A", "tm-1", "plan text")
            self.assertEqual(submitted.status, "needs_approval")
            self.assertEqual(submitted.plan_status, "submitted")
            approved = store.review_plan("A", "lead", action="approve", feedback="ok")
            self.assertEqual(approved.plan_status, "approved")
            self.assertEqual(approved.status, "pending")

            first_exec = store.claim_execution_task("tm-1")
            self.assertIsNotNone(first_exec)
            self.assertEqual(first_exec.id, "A")
            store.complete_task("A", "tm-1", "done")

            second_exec = store.claim_execution_task("tm-2")
            self.assertIsNotNone(second_exec)
            self.assertEqual(second_exec.id, "B")

    def test_mailbox_sequence(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = StateStore(Path(tmp))
            store.send_message("lead", "tm-1", "hello", task_id="A")
            store.send_message("lead", "tm-1", "world", task_id="B")
            inbox = store.get_inbox("tm-1")
            self.assertEqual(len(inbox), 2)
            self.assertLess(inbox[0].seq, inbox[1].seq)

    def test_revision_flow(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = StateStore(Path(tmp))
            store.bootstrap_tasks(
                [
                    Task(id="A", title="plan first", requires_plan=True, target_paths=["src/a.ts"]),
                ]
            )
            planning = store.claim_plan_task("tm-1")
            self.assertIsNotNone(planning)
            store.submit_plan("A", "tm-1", "v1 plan")
            revised = store.review_plan("A", "lead", action="revise", feedback="needs smaller scope")
            self.assertEqual(revised.plan_status, "revision_requested")
            self.assertEqual(revised.status, "pending")
            self.assertIsNone(revised.planner)

    def test_collision_is_detected(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = StateStore(Path(tmp))
            store.bootstrap_tasks(
                [
                    Task(id="A", title="task A", target_paths=["src/shared.ts"]),
                    Task(id="B", title="task B", target_paths=["src/shared.ts"]),
                ]
            )
            first = store.claim_execution_task("tm-1")
            self.assertIsNotNone(first)
            self.assertEqual(first.id, "A")
            second = store.claim_execution_task("tm-2")
            self.assertIsNone(second)
            collisions = store.detect_collisions()
            self.assertEqual(len(collisions), 1)
            self.assertEqual(collisions[0]["waiting_task_id"], "B")
            self.assertEqual(collisions[0]["running_task_id"], "A")

    def test_review_plan_clears_owner(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = StateStore(Path(tmp))
            store.bootstrap_tasks(
                [
                    Task(id="A", title="plan task", requires_plan=True, target_paths=["src/a.ts"]),
                ]
            )
            planning = store.claim_plan_task("tm-1")
            self.assertIsNotNone(planning)
            submitted = store.submit_plan("A", "tm-1", "plan")
            # emulate provider-side accidental owner contamination
            updated = store.apply_task_update(
                task_id="A",
                new_status="needs_approval",
                owner="tm-2",
                plan_action=None,
                feedback="",
            )
            self.assertEqual(updated.owner, "tm-2")
            approved = store.review_plan("A", "lead", action="approve", feedback="ok")
            self.assertEqual(approved.status, "pending")
            self.assertEqual(approved.plan_status, "approved")
            self.assertIsNone(approved.owner)
            executable = store.claim_execution_task("tm-1")
            self.assertIsNotNone(executable)
            self.assertEqual(executable.id, "A")

    def test_task_progress_log_append_and_rotation(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = StateStore(Path(tmp))
            store.bootstrap_tasks([Task(id="A", title="task A", target_paths=["src/a.ts"])], replace=True)

            store.append_task_progress_log("A", "stdout", "line-1", max_entries=3)
            store.append_task_progress_log("A", "stdout", "line-2", max_entries=3)
            store.append_task_progress_log("A", "stderr", "line-3", max_entries=3)
            store.append_task_progress_log("A", "stdout", "line-4", max_entries=3)

            task = store.get_task("A")
            if task is None:
                self.fail("task should exist")
            self.assertEqual(len(task.progress_log), 3)
            self.assertEqual([entry["text"] for entry in task.progress_log], ["line-2", "line-3", "line-4"])
            self.assertEqual(task.progress_log[-1]["source"], "stdout")
            self.assertIn("timestamp", task.progress_log[-1])

    def test_requeue_in_progress_tasks(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = StateStore(Path(tmp))
            store.bootstrap_tasks(
                [
                    Task(id="A", title="task A", status="in_progress", owner="tm-1", target_paths=["src/a.ts"]),
                    Task(id="B", title="task B", status="pending", target_paths=["src/b.ts"]),
                ],
                replace=True,
            )

            recovered = store.requeue_in_progress_tasks()
            self.assertEqual([task.id for task in recovered], ["A"])
            task_a = store.get_task("A")
            if task_a is None:
                self.fail("task A should exist")
            self.assertEqual(task_a.status, "pending")
            self.assertIsNone(task_a.owner)
            self.assertTrue(task_a.progress_log)
            self.assertIn("resume recovery", task_a.progress_log[-1]["text"])


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import json
import os
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from time import time
from typing import Literal

import fcntl

from .models import Task

PlanAction = Literal["approve", "reject", "revise"]


@dataclass
class MailMessage:
    seq: int
    sender: str
    receiver: str
    content: str
    task_id: str | None
    created_at: float


class StateStore:
    def __init__(self, state_dir: Path | str) -> None:
        self.state_dir = Path(state_dir)
        self.state_dir.mkdir(parents=True, exist_ok=True)
        self.state_file = self.state_dir / "state.json"
        self.lock_file = self.state_dir / "state.lock"
        self._initialize_state_if_missing()

    def _initialize_state_if_missing(self) -> None:
        if self.state_file.exists():
            return
        payload = {
            "version": 2,
            "tasks": {},
            "messages": [],
            "meta": {
                "sequence": 0,
                "progress_counter": 0,
                "last_progress_at": time(),
            },
        }
        self._atomic_write(payload)

    @contextmanager
    def _locked_state(self):
        self.lock_file.touch(exist_ok=True)
        with self.lock_file.open("r+") as lock_handle:
            fcntl.flock(lock_handle.fileno(), fcntl.LOCK_EX)
            state = self._read_state()
            yield state
            self._atomic_write(state)
            fcntl.flock(lock_handle.fileno(), fcntl.LOCK_UN)

    def _read_state(self) -> dict:
        with self.state_file.open("r", encoding="utf-8") as handle:
            return json.load(handle)

    def _atomic_write(self, state: dict) -> None:
        temp_path = self.state_file.with_suffix(".tmp")
        with temp_path.open("w", encoding="utf-8") as handle:
            json.dump(state, handle, ensure_ascii=True, indent=2, sort_keys=True)
        os.replace(temp_path, self.state_file)

    @staticmethod
    def _touch_progress(state: dict) -> None:
        state["meta"]["progress_counter"] += 1
        state["meta"]["last_progress_at"] = time()

    @staticmethod
    def _are_dependencies_completed(task: Task, tasks: dict[str, dict]) -> bool:
        for dependency_id in task.depends_on:
            dependency = tasks.get(dependency_id)
            if not dependency:
                return False
            if dependency.get("status") != "completed":
                return False
        return True

    @staticmethod
    def _has_target_collision(task: Task, tasks: dict[str, dict]) -> bool:
        if not task.target_paths:
            return False
        task_targets = set(task.target_paths)
        for other_raw in tasks.values():
            other = Task.from_dict(other_raw)
            if other.id == task.id:
                continue
            if other.status != "in_progress":
                continue
            if not other.target_paths:
                continue
            if task_targets.intersection(other.target_paths):
                return True
        return False

    @staticmethod
    def _is_execution_ready(task: Task, tasks: dict[str, dict]) -> bool:
        if task.status != "pending":
            return False
        if task.owner is not None:
            return False
        if not StateStore._are_dependencies_completed(task, tasks):
            return False
        if task.requires_plan and task.plan_status != "approved":
            return False
        return True

    def bootstrap_tasks(self, tasks: list[Task], replace: bool = True) -> None:
        with self._locked_state() as state:
            if replace:
                state["tasks"] = {}
            for task in tasks:
                state["tasks"][task.id] = task.to_dict()
            self._touch_progress(state)

    def add_task(self, task: Task) -> None:
        with self._locked_state() as state:
            state["tasks"][task.id] = task.to_dict()
            self._touch_progress(state)

    def get_task(self, task_id: str) -> Task | None:
        state = self._read_state()
        raw_task = state["tasks"].get(task_id)
        if not raw_task:
            return None
        return Task.from_dict(raw_task)

    def list_tasks(self) -> list[Task]:
        state = self._read_state()
        tasks = [Task.from_dict(raw) for raw in state["tasks"].values()]
        tasks.sort(key=lambda item: item.id)
        return tasks

    def list_recent_messages(self, limit: int = 30) -> list[MailMessage]:
        state = self._read_state()
        messages = [MailMessage(**raw) for raw in state["messages"]]
        if limit <= 0:
            return []
        return messages[-limit:]

    def claim_plan_task(self, teammate_id: str) -> Task | None:
        with self._locked_state() as state:
            tasks: dict[str, dict] = state["tasks"]
            for task_id in sorted(tasks.keys()):
                candidate = Task.from_dict(tasks[task_id])
                if candidate.status != "pending":
                    continue
                if not candidate.requires_plan:
                    continue
                if candidate.plan_status not in ("pending", "rejected", "revision_requested"):
                    continue
                if candidate.planner is not None:
                    continue
                if not self._are_dependencies_completed(candidate, tasks):
                    continue
                candidate.planner = teammate_id
                candidate.plan_status = "drafting"
                candidate.updated_at = time()
                tasks[candidate.id] = candidate.to_dict()
                self._touch_progress(state)
                return candidate
        return None

    def submit_plan(self, task_id: str, teammate_id: str, plan_text: str) -> Task:
        with self._locked_state() as state:
            raw = state["tasks"].get(task_id)
            if not raw:
                raise KeyError(f"task not found: {task_id}")
            task = Task.from_dict(raw)
            if task.planner != teammate_id:
                raise ValueError("planner mismatch")
            if task.plan_status != "drafting":
                raise ValueError("plan is not drafting")
            task.plan_text = plan_text
            task.status = "needs_approval"
            task.plan_status = "submitted"
            task.updated_at = time()
            state["tasks"][task_id] = task.to_dict()
            self._touch_progress(state)
            return task

    def list_submitted_plans(self) -> list[Task]:
        submitted: list[Task] = []
        for task in self.list_tasks():
            if task.requires_plan and task.status == "needs_approval" and task.plan_status == "submitted":
                submitted.append(task)
        return submitted

    def has_pending_approvals(self) -> bool:
        return len(self.list_submitted_plans()) > 0

    def review_plan(
        self,
        task_id: str,
        lead_id: str,
        action: PlanAction,
        feedback: str = "",
    ) -> Task:
        del lead_id
        if action not in ("approve", "reject", "revise"):
            raise ValueError(f"unknown action: {action}")
        with self._locked_state() as state:
            raw = state["tasks"].get(task_id)
            if not raw:
                raise KeyError(f"task not found: {task_id}")
            task = Task.from_dict(raw)
            if task.status != "needs_approval" or task.plan_status != "submitted":
                raise ValueError("task is not waiting approval")
            task.plan_feedback = feedback
            task.updated_at = time()
            task.status = "pending"
            task.owner = None
            if action == "approve":
                task.plan_status = "approved"
            elif action == "reject":
                task.plan_status = "rejected"
                task.planner = None
            else:
                task.plan_status = "revision_requested"
                task.planner = None
            state["tasks"][task.id] = task.to_dict()
            self._touch_progress(state)
            return task

    def claim_execution_task(self, teammate_id: str) -> Task | None:
        with self._locked_state() as state:
            tasks: dict[str, dict] = state["tasks"]
            for task_id in sorted(tasks.keys()):
                candidate = Task.from_dict(tasks[task_id])
                if not self._is_execution_ready(candidate, tasks):
                    continue
                if self._has_target_collision(candidate, tasks):
                    continue
                candidate.owner = teammate_id
                candidate.status = "in_progress"
                candidate.block_reason = None
                candidate.updated_at = time()
                tasks[candidate.id] = candidate.to_dict()
                self._touch_progress(state)
                return candidate
        return None

    def detect_collisions(self) -> list[dict[str, str]]:
        state = self._read_state()
        tasks_raw: dict[str, dict] = state["tasks"]
        active = [Task.from_dict(raw) for raw in tasks_raw.values() if raw.get("status") == "in_progress"]
        collisions: list[dict[str, str]] = []
        for raw in tasks_raw.values():
            pending_task = Task.from_dict(raw)
            if not self._is_execution_ready(pending_task, tasks_raw):
                continue
            if not pending_task.target_paths:
                continue
            pending_targets = set(pending_task.target_paths)
            for running_task in active:
                if not running_task.target_paths:
                    continue
                if pending_targets.intersection(running_task.target_paths):
                    collisions.append(
                        {
                            "waiting_task_id": pending_task.id,
                            "running_task_id": running_task.id,
                        }
                    )
        return collisions

    def mark_task_blocked(self, task_id: str, teammate_id: str, reason: str) -> Task:
        with self._locked_state() as state:
            raw = state["tasks"].get(task_id)
            if not raw:
                raise KeyError(f"task not found: {task_id}")
            task = Task.from_dict(raw)
            if task.owner != teammate_id:
                raise ValueError("owner mismatch")
            if task.status != "in_progress":
                raise ValueError("task not in progress")
            task.status = "blocked"
            task.block_reason = reason
            task.updated_at = time()
            state["tasks"][task_id] = task.to_dict()
            self._touch_progress(state)
            return task

    def complete_task(self, task_id: str, teammate_id: str, result_summary: str) -> Task:
        with self._locked_state() as state:
            raw = state["tasks"].get(task_id)
            if not raw:
                raise KeyError(f"task not found: {task_id}")
            task = Task.from_dict(raw)
            if task.owner != teammate_id:
                raise ValueError("owner mismatch")
            if task.status != "in_progress":
                raise ValueError("task not in progress")
            task.status = "completed"
            task.result_summary = result_summary
            task.block_reason = None
            now = time()
            task.updated_at = now
            task.completed_at = now
            state["tasks"][task_id] = task.to_dict()
            self._touch_progress(state)
            return task

    def apply_task_update(
        self,
        task_id: str,
        new_status: str,
        owner: str | None = None,
        plan_action: PlanAction | None = None,
        feedback: str = "",
    ) -> Task:
        if plan_action is not None:
            return self.review_plan(
                task_id=task_id,
                lead_id="lead",
                action=plan_action,
                feedback=feedback,
            )
        with self._locked_state() as state:
            raw = state["tasks"].get(task_id)
            if not raw:
                raise KeyError(f"task not found: {task_id}")
            task = Task.from_dict(raw)
            if new_status not in ("pending", "in_progress", "blocked", "needs_approval", "completed"):
                raise ValueError(f"invalid status: {new_status}")
            task.status = new_status  # type: ignore[assignment]
            if owner is not None:
                task.owner = owner
            if new_status == "pending":
                task.block_reason = None
                task.owner = None
            if new_status == "completed":
                task.completed_at = time()
            task.updated_at = time()
            state["tasks"][task.id] = task.to_dict()
            self._touch_progress(state)
            return task

    def send_message(
        self,
        sender: str,
        receiver: str,
        content: str,
        task_id: str | None = None,
    ) -> MailMessage:
        with self._locked_state() as state:
            state["meta"]["sequence"] += 1
            message = {
                "seq": state["meta"]["sequence"],
                "sender": sender,
                "receiver": receiver,
                "content": content,
                "task_id": task_id,
                "created_at": time(),
            }
            state["messages"].append(message)
            self._touch_progress(state)
            return MailMessage(**message)

    def get_inbox(self, receiver: str, after_seq: int = 0) -> list[MailMessage]:
        state = self._read_state()
        inbox: list[MailMessage] = []
        for raw in state["messages"]:
            if raw["receiver"] != receiver:
                continue
            if raw["seq"] <= after_seq:
                continue
            inbox.append(MailMessage(**raw))
        inbox.sort(key=lambda item: item.seq)
        return inbox

    def progress_marker(self) -> tuple[int, float]:
        state = self._read_state()
        return state["meta"]["progress_counter"], state["meta"]["last_progress_at"]

    def status_summary(self) -> dict[str, int]:
        summary = {
            "pending": 0,
            "in_progress": 0,
            "blocked": 0,
            "needs_approval": 0,
            "completed": 0,
        }
        for task in self.list_tasks():
            summary[task.status] += 1
        return summary

    def all_tasks_completed(self) -> bool:
        tasks = self.list_tasks()
        if not tasks:
            return False
        return all(task.status == "completed" for task in tasks)

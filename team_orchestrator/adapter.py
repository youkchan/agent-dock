from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from .models import Task


class TeammateAdapter(Protocol):
    def build_plan(self, teammate_id: str, task: Task) -> str:
        ...

    def execute_task(self, teammate_id: str, task: Task) -> str:
        ...


@dataclass
class TemplateTeammateAdapter:
    plan_template: str = (
        "1) Clarify acceptance criteria\n"
        "2) Edit owned files only\n"
        "3) Run local checks and report"
    )
    result_template: str = "Implemented task {task_id} on {paths}"

    def build_plan(self, teammate_id: str, task: Task) -> str:
        paths = ", ".join(task.target_paths) if task.target_paths else "(no paths)"
        return (
            f"teammate={teammate_id}\n"
            f"task={task.id}\n"
            f"target_paths={paths}\n"
            f"{self.plan_template}"
        )

    def execute_task(self, teammate_id: str, task: Task) -> str:
        del teammate_id
        paths = ", ".join(task.target_paths) if task.target_paths else "(no paths)"
        return self.result_template.format(task_id=task.id, paths=paths)


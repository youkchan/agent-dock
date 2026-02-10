from __future__ import annotations

from dataclasses import dataclass, field
from time import time
from typing import Any, Literal

TaskStatus = Literal["pending", "in_progress", "blocked", "needs_approval", "completed"]
TaskPlanStatus = Literal[
    "not_required",
    "pending",
    "drafting",
    "submitted",
    "approved",
    "rejected",
    "revision_requested",
]


@dataclass
class Task:
    id: str
    title: str
    description: str = ""
    target_paths: list[str] = field(default_factory=list)
    depends_on: list[str] = field(default_factory=list)
    owner: str | None = None
    planner: str | None = None
    status: TaskStatus = "pending"
    requires_plan: bool = False
    plan_status: TaskPlanStatus | None = None
    plan_text: str | None = None
    plan_feedback: str | None = None
    result_summary: str | None = None
    block_reason: str | None = None
    created_at: float = field(default_factory=time)
    updated_at: float = field(default_factory=time)
    completed_at: float | None = None

    def __post_init__(self) -> None:
        if self.plan_status is None:
            self.plan_status = "pending" if self.requires_plan else "not_required"

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "description": self.description,
            "target_paths": self.target_paths,
            "depends_on": self.depends_on,
            "owner": self.owner,
            "planner": self.planner,
            "status": self.status,
            "requires_plan": self.requires_plan,
            "plan_status": self.plan_status,
            "plan_text": self.plan_text,
            "plan_feedback": self.plan_feedback,
            "result_summary": self.result_summary,
            "block_reason": self.block_reason,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "completed_at": self.completed_at,
        }

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "Task":
        return cls(
            id=raw["id"],
            title=raw["title"],
            description=raw.get("description", ""),
            target_paths=list(raw.get("target_paths", [])),
            depends_on=list(raw.get("depends_on", [])),
            owner=raw.get("owner"),
            planner=raw.get("planner"),
            status=raw.get("status", "pending"),
            requires_plan=raw.get("requires_plan", False),
            plan_status=raw.get("plan_status"),
            plan_text=raw.get("plan_text"),
            plan_feedback=raw.get("plan_feedback"),
            result_summary=raw.get("result_summary"),
            block_reason=raw.get("block_reason"),
            created_at=raw.get("created_at", time()),
            updated_at=raw.get("updated_at", time()),
            completed_at=raw.get("completed_at"),
        )

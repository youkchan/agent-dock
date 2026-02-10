from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

from .persona_catalog import PersonaDefinition

PersonaSeverity = Literal["info", "warn", "critical", "blocker"]

_SEVERITY_BY_EVENT: dict[str, PersonaSeverity] = {
    "Kickoff": "info",
    "TaskCompleted": "info",
    "NeedsApproval": "warn",
    "NoProgress": "warn",
    "Collision": "warn",
    "Blocked": "critical",
}

_SEVERITY_PRIORITY: dict[PersonaSeverity, int] = {
    "blocker": 0,
    "critical": 1,
    "warn": 2,
    "info": 3,
}


@dataclass(frozen=True)
class PersonaComment:
    persona_id: str
    severity: PersonaSeverity
    task_id: str | None
    event_type: str
    detail: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "persona_id": self.persona_id,
            "severity": self.severity,
            "task_id": self.task_id,
            "event_type": self.event_type,
            "detail": self.detail,
        }


class PersonaEvaluationPipeline:
    def __init__(self, personas: list[PersonaDefinition], max_comments_per_event: int = 2) -> None:
        self.personas = list(personas)
        self.max_comments_per_event = max(1, int(max_comments_per_event))

    def evaluate_events(
        self,
        events: list[dict[str, str]],
        active_persona_ids: set[str] | None = None,
    ) -> list[PersonaComment]:
        comments: list[PersonaComment] = []
        enabled_personas = [
            persona
            for persona in self.personas
            if persona.enabled and (active_persona_ids is None or persona.id in active_persona_ids)
        ]
        for event in events:
            event_type = str(event.get("type", "")).strip()
            if not event_type:
                continue
            severity = _SEVERITY_BY_EVENT.get(event_type)
            if severity is None:
                continue
            event_candidates: list[PersonaComment] = []
            for persona in enabled_personas:
                comment = self._build_comment(
                    persona=persona,
                    event=event,
                    event_type=event_type,
                    severity=severity,
                )
                event_candidates.append(comment)
            event_candidates.sort(
                key=lambda item: (_SEVERITY_PRIORITY[item.severity], item.persona_id, item.task_id or "")
            )
            comments.extend(event_candidates[: self.max_comments_per_event])
        return comments

    @staticmethod
    def _build_comment(
        persona: PersonaDefinition,
        event: dict[str, str],
        event_type: str,
        severity: PersonaSeverity,
    ) -> PersonaComment:
        task_id = event.get("task_id")
        detail = event.get("detail", "").strip()
        message = f"{persona.id} observed {event_type}"
        if task_id:
            message = f"{message} task={task_id}"
        if detail:
            message = f"{message} detail={detail}"
        return PersonaComment(
            persona_id=persona.id,
            severity=severity,
            task_id=task_id,
            event_type=event_type,
            detail=message[:200],
        )

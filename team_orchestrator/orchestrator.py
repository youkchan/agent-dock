from __future__ import annotations

import os
from dataclasses import dataclass
from time import sleep, time
from typing import Any, Callable

from .adapter import TeammateAdapter
from .persona_catalog import PersonaDefinition, default_personas
from .persona_pipeline import PersonaEvaluationPipeline
from .provider import OrchestratorProvider, build_provider_from_env, validate_decision_json
from .state_store import StateStore


@dataclass
class OrchestratorConfig:
    lead_id: str = "lead"
    teammate_ids: list[str] | None = None
    personas: list[PersonaDefinition] | None = None
    max_rounds: int = 200
    max_idle_rounds: int = 20
    max_idle_seconds: int = 120
    no_progress_event_interval: int = 3
    tick_seconds: float = 0.0
    human_approval: bool | None = None
    auto_approve_fallback: bool | None = None

    def resolved_teammates(self) -> list[str]:
        return self.teammate_ids or ["teammate-1", "teammate-2"]

    def resolved_human_approval(self) -> bool:
        if self.human_approval is not None:
            return self.human_approval
        return os.getenv("HUMAN_APPROVAL", "0").strip() == "1"

    def resolved_auto_approve_fallback(self) -> bool:
        if self.auto_approve_fallback is not None:
            return self.auto_approve_fallback
        return os.getenv("ORCHESTRATOR_AUTO_APPROVE_FALLBACK", "1").strip() == "1"


class AgentTeamsLikeOrchestrator:
    def __init__(
        self,
        store: StateStore,
        adapter: TeammateAdapter,
        provider: OrchestratorProvider | None = None,
        config: OrchestratorConfig | None = None,
        persona_pipeline: PersonaEvaluationPipeline | None = None,
        event_logger: Callable[[str], None] | None = None,
    ) -> None:
        self.store = store
        self.adapter = adapter
        self.provider = provider or build_provider_from_env()
        self.config = config or OrchestratorConfig()
        self.personas = list(self.config.personas) if self.config.personas is not None else default_personas()
        self.persona_by_id = {persona.id: persona for persona in self.personas}
        self.persona_pipeline = persona_pipeline or PersonaEvaluationPipeline(personas=self.personas)
        self.event_logger = event_logger or (lambda _: None)
        self.provider_calls = 0
        self.decision_history: list[dict[str, Any]] = []
        self.persona_comment_history: list[dict[str, Any]] = []
        self.persona_severity_counts: dict[str, int] = {
            "info": 0,
            "warn": 0,
            "critical": 0,
            "blocker": 0,
        }
        self.persona_blocker_triggered = False
        self.collision_cache: set[tuple[str, str]] = set()

    def _log(self, message: str) -> None:
        self.event_logger(f"{time():.3f} {message}")

    @staticmethod
    def _short(text: str, max_chars: int = 180) -> str:
        return text if len(text) <= max_chars else text[: max_chars - 3] + "..."

    def _make_event(
        self,
        event_type: str,
        task_id: str | None = None,
        teammate: str | None = None,
        detail: str = "",
    ) -> dict[str, str]:
        payload = {"type": event_type, "detail": self._short(detail, 200)}
        if task_id:
            payload["task_id"] = task_id
        if teammate:
            payload["teammate"] = teammate
        return payload

    def _evaluate_persona_comments(
        self,
        round_index: int,
        events: list[dict[str, str]],
    ) -> list[dict[str, Any]]:
        comments = self.persona_pipeline.evaluate_events(events)
        serialized = [comment.to_dict() for comment in comments]
        if not serialized:
            return serialized
        for comment in serialized:
            comment["round"] = round_index
            severity = str(comment.get("severity", "")).strip()
            if severity in self.persona_severity_counts:
                self.persona_severity_counts[severity] += 1
            self.persona_comment_history.append(dict(comment))
            self._log(
                f"[persona:{comment['persona_id']}] severity={comment['severity']} "
                f"event={comment['event_type']} task={comment.get('task_id') or '-'} "
                f"detail={self._short(str(comment['detail']), 120)}"
            )
        return serialized

    def _apply_persona_actions(
        self,
        comments: list[dict[str, Any]],
    ) -> tuple[str | None, list[dict[str, str]]]:
        next_round_events: list[dict[str, str]] = []
        escalated_tasks: set[str] = set()

        for comment in comments:
            persona_id = str(comment.get("persona_id", "")).strip()
            severity = str(comment.get("severity", "")).strip()
            task_id_raw = comment.get("task_id")
            task_id = task_id_raw if isinstance(task_id_raw, str) and task_id_raw else None
            if severity not in ("info", "warn", "critical", "blocker"):
                self._log(f"[persona] ignored severity={severity} persona={persona_id or 'unknown'}")
                continue

            if severity == "warn":
                next_round_events.append(
                    self._make_event(
                        event_type="WarnRecheck",
                        task_id=task_id,
                        detail=f"persona={persona_id} from={comment.get('event_type', 'unknown')}",
                    )
                )
                continue

            if severity == "critical":
                if not task_id:
                    self._log(
                        f"[persona] skip critical persona={persona_id or 'unknown'} reason=missing_task_id"
                    )
                    continue
                if task_id in escalated_tasks:
                    continue
                current = self.store.get_task(task_id)
                if current is None:
                    self._log(
                        f"[persona] skip critical persona={persona_id or 'unknown'} "
                        f"task={task_id} reason=task_not_found"
                    )
                    continue
                if current.status != "needs_approval":
                    updated = self.store.apply_task_update(task_id=task_id, new_status="needs_approval")
                    self._log(
                        f"[persona] escalated task={updated.id} status={updated.status} "
                        f"by={persona_id or 'unknown'}"
                    )
                escalated_tasks.add(task_id)
                continue

            if severity == "blocker":
                persona = self.persona_by_id.get(persona_id)
                if not persona or not persona.can_block:
                    if task_id:
                        current = self.store.get_task(task_id)
                        if current is not None and current.status != "needs_approval":
                            updated = self.store.apply_task_update(task_id=task_id, new_status="needs_approval")
                            self._log(
                                f"[persona] downgraded blocker to critical task={updated.id} "
                                f"by={persona_id or 'unknown'}"
                            )
                    continue
                stop_reason = f"persona_blocker:{persona_id}"
                self.persona_blocker_triggered = True
                self._log(f"[persona] blocker stop triggered by={persona_id}")
                return stop_reason, next_round_events

        return None, next_round_events

    def _build_snapshot(
        self,
        events: list[dict[str, str]],
        persona_comments: list[dict[str, Any]],
        round_index: int,
        idle_rounds: int,
    ) -> dict[str, Any]:
        tasks = []
        for task in self.store.list_tasks():
            tasks.append(
                {
                    "id": task.id,
                    "title": task.title,
                    "status": task.status,
                    "owner": task.owner,
                    "planner": task.planner,
                    "depends_on": task.depends_on,
                    "target_paths": task.target_paths,
                    "requires_plan": task.requires_plan,
                    "plan_status": task.plan_status,
                    "plan_excerpt": self._short(task.plan_text or "", 240),
                    "block_reason": self._short(task.block_reason or "", 180),
                }
            )
        messages = []
        for message in self.store.list_recent_messages(limit=20):
            messages.append(
                {
                    "seq": message.seq,
                    "sender": message.sender,
                    "receiver": message.receiver,
                    "task_id": message.task_id,
                    "content_short": self._short(message.content, 120),
                }
            )
        return {
            "lead_id": self.config.lead_id,
            "teammates": self.config.resolved_teammates(),
            "personas": [persona.to_dict() for persona in self.personas],
            "round_index": round_index,
            "idle_rounds": idle_rounds,
            "status_summary": self.store.status_summary(),
            "events": events,
            "persona_comments": persona_comments,
            "tasks": tasks,
            "recent_messages": messages,
            "last_decisions": self.decision_history[-5:],
        }

    def _invoke_provider(
        self,
        events: list[dict[str, str]],
        persona_comments: list[dict[str, Any]],
        round_index: int,
        idle_rounds: int,
    ) -> dict[str, Any]:
        snapshot = self._build_snapshot(
            events=events,
            persona_comments=persona_comments,
            round_index=round_index,
            idle_rounds=idle_rounds,
        )
        self.provider_calls += 1
        decision = self.provider.run(snapshot)
        validated = validate_decision_json(decision)
        self.decision_history.append(
            {
                "round": round_index,
                "events": [event["type"] for event in events],
                "updates": len(validated["task_updates"]),
                "messages": len(validated["messages"]),
                "stop": validated["stop"]["should_stop"],
            }
        )
        return validated

    def _apply_decision(self, decision: dict[str, Any]) -> dict[str, int]:
        applied_updates = 0
        applied_plan_actions = 0
        for update in decision["task_updates"]:
            task_id = update["task_id"]
            current = self.store.get_task(task_id)
            if current is None:
                self._log(f"[lead] skip update task={task_id} reason=task_not_found")
                continue
            new_status = update["new_status"]
            if new_status in ("in_progress", "completed"):
                self._log(
                    f"[lead] skip update task={task_id} reason=execution_state_managed_by_teammates "
                    f"requested={new_status}"
                )
                continue
            if new_status == "blocked" and current.status != "blocked":
                self._log(
                    f"[lead] skip update task={task_id} reason=blocked_transition_not_allowed "
                    f"current_status={current.status}"
                )
                continue
            plan_action = update.get("plan_action")
            if plan_action is not None and not (
                current.status == "needs_approval" and current.plan_status == "submitted"
            ):
                self._log(
                    f"[lead] skip update task={task_id} reason=plan_action_not_applicable "
                    f"status={current.status} plan_status={current.plan_status}"
                )
                continue
            try:
                updated_task = self.store.apply_task_update(
                    task_id=task_id,
                    new_status=new_status,
                    owner=update.get("owner"),
                    plan_action=plan_action,
                    feedback=update.get("feedback", ""),
                )
            except Exception as error:
                self._log(f"[lead] skip update task={task_id} reason={self._short(str(error), 180)}")
                continue
            applied_updates += 1
            if plan_action is not None:
                applied_plan_actions += 1
            self._log(
                f"[lead] update task={updated_task.id} status={updated_task.status} "
                f"plan_status={updated_task.plan_status}"
            )
        for message in decision["messages"]:
            self.store.send_message(
                sender=self.config.lead_id,
                receiver=message["to"],
                content=message["text_short"],
            )
            self._log(f"[lead] msg to={message['to']} text={message['text_short']}")
        return {
            "applied_updates": applied_updates,
            "applied_plan_actions": applied_plan_actions,
        }

    def _teammate_process_plan(self, teammate_id: str) -> tuple[bool, list[dict[str, str]]]:
        task = self.store.claim_plan_task(teammate_id=teammate_id)
        if not task:
            return False, []
        plan_text = self.adapter.build_plan(teammate_id=teammate_id, task=task)
        self.store.submit_plan(task_id=task.id, teammate_id=teammate_id, plan_text=plan_text)
        self.store.send_message(
            sender=teammate_id,
            receiver=self.config.lead_id,
            content=f"plan submitted task={task.id}",
            task_id=task.id,
        )
        self._log(f"[{teammate_id}] plan submitted task={task.id}")
        return True, [
            self._make_event(
                event_type="NeedsApproval",
                teammate=teammate_id,
                task_id=task.id,
                detail="plan submitted",
            )
        ]

    def _teammate_process_execution(self, teammate_id: str) -> tuple[bool, list[dict[str, str]]]:
        task = self.store.claim_execution_task(teammate_id=teammate_id)
        if not task:
            return False, []
        try:
            result = self.adapter.execute_task(teammate_id=teammate_id, task=task)
        except Exception as error:
            blocked = self.store.mark_task_blocked(
                task_id=task.id,
                teammate_id=teammate_id,
                reason=self._short(str(error), 180),
            )
            self.store.send_message(
                sender=teammate_id,
                receiver=self.config.lead_id,
                content=f"task blocked task={blocked.id} reason={blocked.block_reason}",
                task_id=blocked.id,
            )
            self._log(f"[{teammate_id}] blocked task={blocked.id} reason={blocked.block_reason}")
            return True, [
                self._make_event(
                    event_type="Blocked",
                    teammate=teammate_id,
                    task_id=blocked.id,
                    detail=blocked.block_reason or "blocked",
                )
            ]
        completed = self.store.complete_task(task_id=task.id, teammate_id=teammate_id, result_summary=result)
        self.store.send_message(
            sender=teammate_id,
            receiver=self.config.lead_id,
            content=f"task completed task={completed.id}",
            task_id=completed.id,
        )
        self._log(f"[{teammate_id}] completed task={completed.id}")
        return True, [
            self._make_event(
                event_type="TaskCompleted",
                teammate=teammate_id,
                task_id=completed.id,
                detail=self._short(result, 160),
            )
        ]

    def _collect_collision_events(self) -> list[dict[str, str]]:
        events: list[dict[str, str]] = []
        collisions = self.store.detect_collisions()
        current_keys: set[tuple[str, str]] = set()
        for item in collisions:
            key = (item["waiting_task_id"], item["running_task_id"])
            current_keys.add(key)
            if key in self.collision_cache:
                continue
            events.append(
                self._make_event(
                    event_type="Collision",
                    task_id=item["waiting_task_id"],
                    detail=f"waiting={item['waiting_task_id']} running={item['running_task_id']}",
                )
            )
        self.collision_cache = current_keys
        return events

    def run(self) -> dict[str, object]:
        start_at = time()
        idle_rounds = 0
        stop_reason = "max_rounds"
        teammates = self.config.resolved_teammates()
        human_approval = self.config.resolved_human_approval()
        auto_approve_fallback = self.config.resolved_auto_approve_fallback()
        if not teammates:
            raise ValueError("at least one teammate is required")

        pending_events: list[dict[str, str]] = [self._make_event("Kickoff", detail="start")]

        for round_index in range(1, self.config.max_rounds + 1):
            marker_before = self.store.progress_marker()
            round_events = pending_events
            pending_events = []
            progress_from_teammates = False

            for teammate_id in teammates:
                changed, events = self._teammate_process_plan(teammate_id=teammate_id)
                if changed:
                    progress_from_teammates = True
                    round_events.extend(events)
                    continue
                changed, events = self._teammate_process_execution(teammate_id=teammate_id)
                if changed:
                    progress_from_teammates = True
                    round_events.extend(events)

            round_events.extend(self._collect_collision_events())

            if self.store.all_tasks_completed():
                stop_reason = "all_tasks_completed"
                break

            marker_after = self.store.progress_marker()
            progressed = progress_from_teammates or (marker_after[0] > marker_before[0])
            if progressed:
                idle_rounds = 0
            else:
                idle_rounds += 1
                interval = max(1, self.config.no_progress_event_interval)
                if idle_rounds % interval == 0:
                    round_events.append(
                        self._make_event(
                            event_type="NoProgress",
                            detail=f"idle_rounds={idle_rounds}",
                        )
                    )

            if human_approval and self.store.has_pending_approvals():
                stop_reason = "human_approval_required"
                self._log("[lead] waiting for human approval")
                break

            if round_events:
                persona_comments = self._evaluate_persona_comments(round_index=round_index, events=round_events)
                persona_stop_reason, recheck_events = self._apply_persona_actions(comments=persona_comments)
                if recheck_events:
                    pending_events.extend(recheck_events)
                if persona_stop_reason:
                    stop_reason = persona_stop_reason
                    break
                try:
                    decision = self._invoke_provider(
                        events=round_events,
                        persona_comments=persona_comments,
                        round_index=round_index,
                        idle_rounds=idle_rounds,
                    )
                    apply_result = self._apply_decision(decision)
                    if (
                        auto_approve_fallback
                        and apply_result["applied_plan_actions"] == 0
                        and self.store.has_pending_approvals()
                    ):
                        submitted = self.store.list_submitted_plans()
                        if submitted:
                            fallback_task = submitted[0]
                            updated = self.store.review_plan(
                                task_id=fallback_task.id,
                                lead_id=self.config.lead_id,
                                action="approve",
                                feedback="fallback auto-approval",
                            )
                            receiver = updated.planner or "unknown"
                            self.store.send_message(
                                sender=self.config.lead_id,
                                receiver=receiver,
                                content=f"plan approved by fallback for {updated.id}",
                                task_id=updated.id,
                            )
                            self._log(
                                f"[lead] fallback approved task={updated.id} "
                                f"status={updated.status} plan_status={updated.plan_status}"
                            )
                except Exception as error:
                    stop_reason = "provider_error"
                    self._log(f"[lead] provider error: {self._short(str(error), 220)}")
                    break
                if decision["stop"]["should_stop"]:
                    detail = decision["stop"]["reason_short"] or "provider requested stop"
                    stop_reason = f"provider_stop:{detail}"
                    self._log(f"[lead] provider stop reason={detail}")
                    break

            if self.store.all_tasks_completed():
                stop_reason = "all_tasks_completed"
                break

            elapsed_idle_seconds = int(time() - self.store.progress_marker()[1])
            if idle_rounds >= self.config.max_idle_rounds:
                stop_reason = "idle_rounds_limit"
                break
            if elapsed_idle_seconds >= self.config.max_idle_seconds:
                stop_reason = "idle_seconds_limit"
                break

            if self.config.tick_seconds > 0:
                sleep(self.config.tick_seconds)

            self._log(
                f"[orchestrator] round={round_index} "
                f"idle_rounds={idle_rounds} summary={self.store.status_summary()} "
                f"provider_calls={self.provider_calls}"
            )

        return {
            "stop_reason": stop_reason,
            "elapsed_seconds": round(time() - start_at, 3),
            "summary": self.store.status_summary(),
            "tasks_total": len(self.store.list_tasks()),
            "provider_calls": self.provider_calls,
            "provider": getattr(self.provider, "provider_name", "unknown"),
            "human_approval": human_approval,
            "persona_metrics": {
                "severity_counts": dict(self.persona_severity_counts),
                "persona_blocker_triggered": self.persona_blocker_triggered,
                "warn_recheck_queue_remaining": sum(
                    1 for event in pending_events if event.get("type") == "WarnRecheck"
                ),
            },
        }

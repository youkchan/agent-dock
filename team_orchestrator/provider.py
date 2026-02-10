from __future__ import annotations

import json
import os
from dataclasses import dataclass
from time import time
from typing import Any, Protocol

try:
    from openai import OpenAI
except Exception:  # pragma: no cover
    OpenAI = None  # type: ignore[assignment]

MAX_INPUT_TOKEN_HARD_CAP = 16000
MAX_OUTPUT_TOKEN_HARD_CAP = 2000
DEFAULT_INPUT_TOKEN_BUDGET = 4000
DEFAULT_OUTPUT_TOKEN_BUDGET = 800
DEFAULT_OPENAI_MODEL = "gpt-5-mini"
DECISION_JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["decisions", "task_updates", "messages", "stop", "meta"],
    "properties": {
        "decisions": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["type", "task_id", "teammate", "reason_short"],
                "properties": {
                    "type": {"type": "string"},
                    "task_id": {"type": ["string", "null"]},
                    "teammate": {"type": ["string", "null"]},
                    "reason_short": {"type": "string"},
                },
            },
        },
        "task_updates": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["task_id", "new_status", "owner", "plan_action", "feedback"],
                "properties": {
                    "task_id": {"type": "string"},
                    "new_status": {
                        "type": "string",
                        "enum": ["pending", "in_progress", "blocked", "needs_approval", "completed"],
                    },
                    "owner": {"type": ["string", "null"]},
                    "plan_action": {"type": ["string", "null"], "enum": ["approve", "reject", "revise", None]},
                    "feedback": {"type": "string"},
                },
            },
        },
        "messages": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["to", "text_short"],
                "properties": {
                    "to": {"type": "string"},
                    "text_short": {"type": "string"},
                },
            },
        },
        "stop": {
            "type": "object",
            "additionalProperties": False,
            "required": ["should_stop", "reason_short"],
            "properties": {
                "should_stop": {"type": "boolean"},
                "reason_short": {"type": "string"},
            },
        },
        "meta": {
            "type": "object",
            "additionalProperties": False,
            "required": ["provider", "model", "token_budget", "elapsed_ms"],
            "properties": {
                "provider": {"type": "string"},
                "model": {"type": "string"},
                "token_budget": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["input", "output"],
                    "properties": {
                        "input": {"type": "integer"},
                        "output": {"type": "integer"},
                    },
                },
                "elapsed_ms": {"type": "integer"},
            },
        },
    },
}


class DecisionValidationError(ValueError):
    pass


class OrchestratorProvider(Protocol):
    provider_name: str

    def run(self, snapshot_json: dict[str, Any]) -> dict[str, Any]:
        ...


def _safe_int_env(name: str, default: int, hard_cap: int) -> int:
    raw = os.getenv(name, "")
    try:
        parsed = int(raw) if raw else default
    except ValueError:
        parsed = default
    parsed = max(1, parsed)
    return min(parsed, hard_cap)


def _default_decision(provider: str, model: str, input_budget: int, output_budget: int) -> dict[str, Any]:
    return {
        "decisions": [],
        "task_updates": [],
        "messages": [],
        "stop": {"should_stop": False, "reason_short": ""},
        "meta": {
            "provider": provider,
            "model": model,
            "token_budget": {"input": input_budget, "output": output_budget},
            "elapsed_ms": 0,
        },
    }


def validate_decision_json(payload: dict[str, Any]) -> dict[str, Any]:
    required_keys = {"decisions", "task_updates", "messages", "stop", "meta"}
    missing = required_keys.difference(payload.keys())
    if missing:
        raise DecisionValidationError(f"missing keys: {sorted(missing)}")

    decisions = payload["decisions"]
    task_updates = payload["task_updates"]
    messages = payload["messages"]
    stop = payload["stop"]
    meta = payload["meta"]
    if not isinstance(decisions, list):
        raise DecisionValidationError("decisions must be a list")
    if not isinstance(task_updates, list):
        raise DecisionValidationError("task_updates must be a list")
    if not isinstance(messages, list):
        raise DecisionValidationError("messages must be a list")
    if not isinstance(stop, dict) or "should_stop" not in stop:
        raise DecisionValidationError("stop.should_stop is required")
    if not isinstance(meta, dict):
        raise DecisionValidationError("meta must be an object")

    normalized_updates: list[dict[str, Any]] = []
    for update in task_updates:
        if not isinstance(update, dict):
            raise DecisionValidationError("task_updates[] must be objects")
        task_id = update.get("task_id")
        new_status = update.get("new_status")
        if not isinstance(task_id, str) or not task_id:
            raise DecisionValidationError("task_updates[].task_id is required")
        if not isinstance(new_status, str):
            raise DecisionValidationError("task_updates[].new_status is required")
        if new_status not in ("pending", "in_progress", "blocked", "needs_approval", "completed"):
            raise DecisionValidationError(f"invalid new_status: {new_status}")
        plan_action = update.get("plan_action")
        if plan_action is not None and plan_action not in ("approve", "reject", "revise"):
            raise DecisionValidationError(f"invalid plan_action: {plan_action}")
        normalized_updates.append(
            {
                "task_id": task_id,
                "new_status": new_status,
                "owner": update.get("owner"),
                "plan_action": plan_action,
                "feedback": str(update.get("feedback", ""))[:200],
            }
        )

    normalized_messages: list[dict[str, str]] = []
    for message in messages:
        if not isinstance(message, dict):
            raise DecisionValidationError("messages[] must be objects")
        receiver = message.get("to")
        text = message.get("text_short")
        if not isinstance(receiver, str) or not receiver:
            raise DecisionValidationError("messages[].to is required")
        if not isinstance(text, str) or not text:
            raise DecisionValidationError("messages[].text_short is required")
        normalized_messages.append({"to": receiver, "text_short": text[:300]})

    normalized_stop = {
        "should_stop": bool(stop.get("should_stop", False)),
        "reason_short": str(stop.get("reason_short", ""))[:200],
    }
    normalized_decisions: list[dict[str, Any]] = []
    for decision in decisions:
        if not isinstance(decision, dict):
            raise DecisionValidationError("decisions[] must be objects")
        normalized_decisions.append(
            {
                "type": str(decision.get("type", ""))[:80],
                "task_id": decision.get("task_id"),
                "teammate": decision.get("teammate"),
                "reason_short": str(decision.get("reason_short", ""))[:200],
            }
        )

    normalized_meta = {
        "provider": str(meta.get("provider", "unknown"))[:40],
        "model": str(meta.get("model", "unknown"))[:80],
        "token_budget": {
            "input": int(meta.get("token_budget", {}).get("input", DEFAULT_INPUT_TOKEN_BUDGET)),
            "output": int(meta.get("token_budget", {}).get("output", DEFAULT_OUTPUT_TOKEN_BUDGET)),
        },
        "elapsed_ms": int(meta.get("elapsed_ms", 0)),
    }
    return {
        "decisions": normalized_decisions,
        "task_updates": normalized_updates,
        "messages": normalized_messages,
        "stop": normalized_stop,
        "meta": normalized_meta,
    }


@dataclass
class MockOrchestratorProvider:
    provider_name: str = "mock"
    model: str = "mock-v1"
    input_token_budget: int = DEFAULT_INPUT_TOKEN_BUDGET
    output_token_budget: int = DEFAULT_OUTPUT_TOKEN_BUDGET

    def run(self, snapshot_json: dict[str, Any]) -> dict[str, Any]:
        started = time()
        result = _default_decision(
            provider=self.provider_name,
            model=self.model,
            input_budget=self.input_token_budget,
            output_budget=self.output_token_budget,
        )
        tasks = snapshot_json.get("tasks", [])
        for task in tasks:
            if task.get("status") == "needs_approval" and task.get("plan_status") == "submitted":
                task_id = task.get("id")
                if not task_id:
                    continue
                result["decisions"].append(
                    {"type": "approve_plan", "task_id": task_id, "reason_short": "auto approved"}
                )
                result["task_updates"].append(
                    {
                        "task_id": task_id,
                        "new_status": "pending",
                        "plan_action": "approve",
                        "feedback": "approved by mock provider",
                    }
                )
                planner = task.get("planner")
                if isinstance(planner, str) and planner:
                    result["messages"].append(
                        {
                            "to": planner,
                            "text_short": f"Plan approved for {task_id}",
                        }
                    )
        result["meta"]["elapsed_ms"] = int((time() - started) * 1000)
        return validate_decision_json(result)


@dataclass
class OpenAIOrchestratorProvider:
    provider_name: str = "openai"
    model: str = DEFAULT_OPENAI_MODEL
    input_token_budget: int = DEFAULT_INPUT_TOKEN_BUDGET
    output_token_budget: int = DEFAULT_OUTPUT_TOKEN_BUDGET
    system_prompt: str = (
        "You are a thin orchestrator lead. Return strict JSON only. "
        "No markdown. No prose. Keep reason_short concise. "
        "Decisions should be routing/state updates only."
    )
    api_key: str | None = None

    def __post_init__(self) -> None:
        if OpenAI is None:  # pragma: no cover
            raise RuntimeError("openai package is required for OpenAIOrchestratorProvider")
        resolved_key = self.api_key or os.getenv("OPENAI_API_KEY")
        if not resolved_key:
            raise RuntimeError("OPENAI_API_KEY is required for OpenAIOrchestratorProvider")
        self.client = OpenAI(api_key=resolved_key)

    def _compress_snapshot(self, snapshot_json: dict[str, Any]) -> str:
        compact = json.dumps(snapshot_json, ensure_ascii=True, separators=(",", ":"))
        max_chars = max(1000, self.input_token_budget * 4)
        if len(compact) <= max_chars:
            return compact
        wrapped = {
            "truncated": True,
            "snapshot_prefix": compact[: max_chars - 80],
        }
        return json.dumps(wrapped, ensure_ascii=True, separators=(",", ":"))

    @staticmethod
    def _strip_markdown_fence(text: str) -> str:
        stripped = text.strip()
        if stripped.startswith("```") and stripped.endswith("```"):
            lines = stripped.splitlines()
            if len(lines) >= 3:
                return "\n".join(lines[1:-1]).strip()
        return stripped

    @staticmethod
    def _response_diagnostic(response: Any) -> str:
        model_dump = getattr(response, "model_dump", None)
        if not callable(model_dump):
            return "no_diagnostic"
        payload = model_dump()
        if not isinstance(payload, dict):
            return "no_diagnostic"
        status = payload.get("status")
        incomplete = payload.get("incomplete_details")
        output = payload.get("output")
        output_len = len(output) if isinstance(output, list) else 0
        return (
            f"status={status} incomplete_details={incomplete} "
            f"output_items={output_len}"
        )

    @staticmethod
    def _extract_text_from_response(response: Any) -> str:
        parsed_obj = getattr(response, "output_parsed", None)
        if parsed_obj is not None:
            if isinstance(parsed_obj, (dict, list)):
                return json.dumps(parsed_obj, ensure_ascii=True)
            model_dump = getattr(parsed_obj, "model_dump", None)
            if callable(model_dump):
                dumped = model_dump()
                if isinstance(dumped, (dict, list)):
                    return json.dumps(dumped, ensure_ascii=True)

        direct = getattr(response, "output_text", None)
        if isinstance(direct, str) and direct.strip():
            return direct.strip()

        def as_dict(obj: Any) -> dict[str, Any] | None:
            if isinstance(obj, dict):
                return obj
            model_dump = getattr(obj, "model_dump", None)
            if callable(model_dump):
                dumped = model_dump()
                if isinstance(dumped, dict):
                    return dumped
            to_dict = getattr(obj, "to_dict", None)
            if callable(to_dict):
                dumped = to_dict()
                if isinstance(dumped, dict):
                    return dumped
            return None

        def read_text(part: Any) -> str:
            if isinstance(part, str):
                return part
            if isinstance(part, dict):
                raw_text = part.get("text")
                if isinstance(raw_text, str):
                    return raw_text
                if isinstance(raw_text, dict):
                    value = raw_text.get("value")
                    if isinstance(value, str):
                        return value
                output_text = part.get("output_text")
                if isinstance(output_text, str):
                    return output_text
                return ""
            raw_text = getattr(part, "text", None)
            if isinstance(raw_text, str):
                return raw_text
            if raw_text is not None:
                text_dict = as_dict(raw_text)
                if text_dict and isinstance(text_dict.get("value"), str):
                    return text_dict["value"]
            output_text = getattr(part, "output_text", None)
            if isinstance(output_text, str):
                return output_text
            part_dict = as_dict(part)
            if part_dict:
                return read_text(part_dict)
            return ""

        response_dict = as_dict(response)
        if not response_dict:
            return ""
        output = response_dict.get("output")
        if not isinstance(output, list):
            return ""
        chunks: list[str] = []
        for item in output:
            item_dict = as_dict(item)
            if not item_dict:
                continue
            item_type = item_dict.get("type")
            if item_type and item_type != "message":
                continue
            content = item_dict.get("content")
            if not isinstance(content, list):
                continue
            for part in content:
                part_dict = as_dict(part)
                if part_dict:
                    part_type = part_dict.get("type")
                    if part_type and part_type not in ("output_text", "text"):
                        continue
                text = read_text(part).strip()
                if text:
                    chunks.append(text)
        return "\n".join(chunks).strip()

    @staticmethod
    def _parse_json_output(output_text: str, response: Any) -> dict[str, Any]:
        try:
            return json.loads(output_text)
        except json.JSONDecodeError:
            first = output_text.find("{")
            last = output_text.rfind("}")
            if first != -1 and last != -1 and last > first:
                candidate = output_text[first : last + 1]
                try:
                    return json.loads(candidate)
                except json.JSONDecodeError:
                    pass
            diagnostic = OpenAIOrchestratorProvider._response_diagnostic(response)
            preview = output_text[:300].replace("\n", "\\n")
            raise DecisionValidationError(
                f"openai provider returned invalid json ({diagnostic}) preview={preview}"
            )

    def run(self, snapshot_json: dict[str, Any]) -> dict[str, Any]:
        started = time()
        compact_snapshot = self._compress_snapshot(snapshot_json)
        reasoning_effort = os.getenv("ORCHESTRATOR_REASONING_EFFORT", "minimal").strip() or "minimal"
        request_common = {
            "model": self.model,
            "instructions": self.system_prompt,
            "input": (
                "Return decision_json only. Follow the required keys exactly. "
                "Do not add explanations.\n"
                f"Snapshot:\n{compact_snapshot}"
            ),
            "max_output_tokens": self.output_token_budget,
            "reasoning": {"effort": reasoning_effort},
        }
        try:
            response = self.client.responses.create(
                **request_common,
                text={
                    "format": {
                        "type": "json_schema",
                        "name": "decision_json",
                        "strict": True,
                        "schema": DECISION_JSON_SCHEMA,
                    }
                },
            )
        except Exception:
            response = self.client.responses.create(
                **request_common,
                text={"format": {"type": "json_object"}},
            )
        output_text = self._strip_markdown_fence(self._extract_text_from_response(response))
        if not output_text:
            diagnostic = self._response_diagnostic(response)
            raise DecisionValidationError(f"openai provider returned empty output ({diagnostic})")
        parsed = self._parse_json_output(output_text, response)
        validated = validate_decision_json(parsed)
        validated["meta"]["provider"] = self.provider_name
        validated["meta"]["model"] = self.model
        validated["meta"]["token_budget"] = {
            "input": self.input_token_budget,
            "output": self.output_token_budget,
        }
        validated["meta"]["elapsed_ms"] = int((time() - started) * 1000)
        return validated


def build_provider_from_env() -> OrchestratorProvider:
    provider_name = os.getenv("ORCHESTRATOR_PROVIDER", "mock").strip().lower()
    input_budget = _safe_int_env(
        "ORCHESTRATOR_INPUT_TOKENS",
        DEFAULT_INPUT_TOKEN_BUDGET,
        MAX_INPUT_TOKEN_HARD_CAP,
    )
    output_budget = _safe_int_env(
        "ORCHESTRATOR_OUTPUT_TOKENS",
        DEFAULT_OUTPUT_TOKEN_BUDGET,
        MAX_OUTPUT_TOKEN_HARD_CAP,
    )
    if provider_name == "mock":
        return MockOrchestratorProvider(
            input_token_budget=input_budget,
            output_token_budget=output_budget,
        )
    if provider_name == "openai":
        model = os.getenv("ORCHESTRATOR_OPENAI_MODEL", DEFAULT_OPENAI_MODEL).strip() or DEFAULT_OPENAI_MODEL
        return OpenAIOrchestratorProvider(
            model=model,
            input_token_budget=input_budget,
            output_token_budget=output_budget,
        )
    if provider_name in ("claude", "gemini"):
        raise RuntimeError(
            f"{provider_name} provider is not implemented yet; use ORCHESTRATOR_PROVIDER=mock|openai"
        )
    raise RuntimeError(f"unknown orchestrator provider: {provider_name}")

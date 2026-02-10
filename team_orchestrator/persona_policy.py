from __future__ import annotations

from typing import Any

_PHASE_POLICY_KEYS = {
    "active_personas",
    "executor_personas",
    "state_transition_personas",
}
_PERSONA_DEFAULTS_KEYS = {
    "phase_order",
    "phase_policies",
}
_TASK_PERSONA_POLICY_KEYS = {
    "disable_personas",
    "phase_order",
    "phase_overrides",
}


def normalize_persona_defaults(
    raw: Any,
    *,
    source_label: str,
    known_persona_ids: set[str],
) -> dict[str, Any] | None:
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise ValueError(f"persona_defaults must be an object ({source_label})")

    unknown_keys = sorted(set(raw.keys()) - _PERSONA_DEFAULTS_KEYS)
    if unknown_keys:
        formatted = ", ".join(unknown_keys)
        raise ValueError(f"persona_defaults has unknown keys: {formatted} ({source_label})")

    normalized: dict[str, Any] = {}
    if "phase_order" in raw:
        normalized["phase_order"] = _normalize_phase_order(
            raw["phase_order"],
            field_name="persona_defaults.phase_order",
            source_label=source_label,
        )
    if "phase_policies" in raw:
        normalized["phase_policies"] = _normalize_phase_policy_map(
            raw["phase_policies"],
            field_name="persona_defaults.phase_policies",
            source_label=source_label,
            known_persona_ids=known_persona_ids,
        )
    return normalized


def normalize_task_persona_policy(
    raw: Any,
    *,
    source_label: str,
    task_id: str,
    known_persona_ids: set[str],
) -> dict[str, Any] | None:
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise ValueError(f"task {task_id} persona_policy must be an object ({source_label})")

    unknown_keys = sorted(set(raw.keys()) - _TASK_PERSONA_POLICY_KEYS)
    if unknown_keys:
        formatted = ", ".join(unknown_keys)
        raise ValueError(f"task {task_id} persona_policy has unknown keys: {formatted} ({source_label})")

    normalized: dict[str, Any] = {}
    if "disable_personas" in raw:
        normalized["disable_personas"] = _normalize_persona_id_list(
            raw["disable_personas"],
            field_name=f"task {task_id} persona_policy.disable_personas",
            source_label=source_label,
            known_persona_ids=known_persona_ids,
        )
    if "phase_order" in raw:
        normalized["phase_order"] = _normalize_phase_order(
            raw["phase_order"],
            field_name=f"task {task_id} persona_policy.phase_order",
            source_label=source_label,
        )
    if "phase_overrides" in raw:
        normalized["phase_overrides"] = _normalize_phase_policy_map(
            raw["phase_overrides"],
            field_name=f"task {task_id} persona_policy.phase_overrides",
            source_label=source_label,
            known_persona_ids=known_persona_ids,
        )
    return normalized


def _normalize_phase_order(raw: Any, *, field_name: str, source_label: str) -> list[str]:
    if not isinstance(raw, list):
        raise ValueError(f"{field_name} must be a list ({source_label})")

    seen: set[str] = set()
    normalized: list[str] = []
    for index, item in enumerate(raw):
        if not isinstance(item, str) or not item.strip():
            raise ValueError(f"{field_name}[{index}] must be a non-empty string ({source_label})")
        phase = item.strip()
        if phase in seen:
            continue
        seen.add(phase)
        normalized.append(phase)
    return normalized


def _normalize_phase_policy_map(
    raw: Any,
    *,
    field_name: str,
    source_label: str,
    known_persona_ids: set[str],
) -> dict[str, dict[str, list[str]]]:
    if not isinstance(raw, dict):
        raise ValueError(f"{field_name} must be an object ({source_label})")

    normalized: dict[str, dict[str, list[str]]] = {}
    for phase_raw, policy_raw in raw.items():
        phase = str(phase_raw).strip()
        if not phase:
            raise ValueError(f"{field_name} contains an empty phase key ({source_label})")
        normalized[phase] = _normalize_phase_policy(
            policy_raw,
            field_name=f"{field_name}.{phase}",
            source_label=source_label,
            known_persona_ids=known_persona_ids,
        )
    return normalized


def _normalize_phase_policy(
    raw: Any,
    *,
    field_name: str,
    source_label: str,
    known_persona_ids: set[str],
) -> dict[str, list[str]]:
    if not isinstance(raw, dict):
        raise ValueError(f"{field_name} must be an object ({source_label})")

    unknown_keys = sorted(set(raw.keys()) - _PHASE_POLICY_KEYS)
    if unknown_keys:
        formatted = ", ".join(unknown_keys)
        raise ValueError(f"{field_name} has unknown keys: {formatted} ({source_label})")

    normalized: dict[str, list[str]] = {}
    for key in sorted(_PHASE_POLICY_KEYS):
        if key not in raw:
            continue
        normalized[key] = _normalize_persona_id_list(
            raw[key],
            field_name=f"{field_name}.{key}",
            source_label=source_label,
            known_persona_ids=known_persona_ids,
        )
    return normalized


def _normalize_persona_id_list(
    raw: Any,
    *,
    field_name: str,
    source_label: str,
    known_persona_ids: set[str],
) -> list[str]:
    if not isinstance(raw, list):
        raise ValueError(f"{field_name} must be a list ({source_label})")

    seen: set[str] = set()
    normalized: list[str] = []
    for index, item in enumerate(raw):
        if not isinstance(item, str) or not item.strip():
            raise ValueError(f"{field_name}[{index}] must be a non-empty string ({source_label})")
        persona_id = item.strip()
        if persona_id not in known_persona_ids:
            raise ValueError(f"{field_name}[{index}] references unknown persona: {persona_id} ({source_label})")
        if persona_id in seen:
            continue
        seen.add(persona_id)
        normalized.append(persona_id)
    return normalized

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal, cast

PersonaRole = Literal["implementer", "reviewer", "spec_guard", "test_guard", "custom"]

_REQUIRED_KEYS = ("id", "role", "focus", "can_block", "enabled")
_OPTIONAL_KEYS = ("execution",)
_ALLOWED_KEYS = set(_REQUIRED_KEYS + _OPTIONAL_KEYS)
_ALLOWED_ROLES = {"implementer", "reviewer", "spec_guard", "test_guard", "custom"}
_ALLOWED_EXECUTION_KEYS = {"enabled", "command_ref", "sandbox", "timeout_sec"}


@dataclass(frozen=True)
class PersonaExecutionConfig:
    enabled: bool = False
    command_ref: str = "default"
    sandbox: str = "workspace-write"
    timeout_sec: int = 900

    def to_dict(self) -> dict[str, Any]:
        return {
            "enabled": self.enabled,
            "command_ref": self.command_ref,
            "sandbox": self.sandbox,
            "timeout_sec": self.timeout_sec,
        }


@dataclass(frozen=True)
class PersonaDefinition:
    id: str
    role: PersonaRole
    focus: str
    can_block: bool = False
    enabled: bool = True
    execution: PersonaExecutionConfig | None = None

    def to_dict(self) -> dict[str, Any]:
        payload = {
            "id": self.id,
            "role": self.role,
            "focus": self.focus,
            "can_block": self.can_block,
            "enabled": self.enabled,
        }
        if self.execution is not None:
            payload["execution"] = self.execution.to_dict()
        return payload


_DEFAULT_PERSONAS: tuple[PersonaDefinition, ...] = (
    PersonaDefinition(
        id="implementer",
        role="implementer",
        focus="実装の前進と、依存・影響範囲の整合性を確認する",
        can_block=False,
        enabled=True,
    ),
    PersonaDefinition(
        id="code-reviewer",
        role="reviewer",
        focus="品質、保守性、回帰リスクを重視して差分を確認する",
        can_block=False,
        enabled=True,
    ),
    PersonaDefinition(
        id="spec-checker",
        role="spec_guard",
        focus="仕様逸脱や要件の取りこぼしがないかを確認する",
        can_block=False,
        enabled=True,
    ),
    PersonaDefinition(
        id="test-owner",
        role="test_guard",
        focus="必要な検証が揃っているか、再現性があるかを確認する",
        can_block=False,
        enabled=True,
    ),
)


def default_personas() -> list[PersonaDefinition]:
    return list(_DEFAULT_PERSONAS)


def load_personas(raw: Any, source_label: str) -> list[PersonaDefinition]:
    if raw is None:
        return default_personas()
    project_personas = _parse_persona_list(raw=raw, source_label=source_label)
    return _merge_personas(defaults=default_personas(), project=project_personas)


def _parse_persona_list(raw: Any, source_label: str) -> list[PersonaDefinition]:
    if not isinstance(raw, list):
        raise ValueError(f"personas must be a list ({source_label})")

    personas: list[PersonaDefinition] = []
    seen_ids: set[str] = set()
    duplicate_ids: set[str] = set()

    for index, item in enumerate(raw):
        persona = _parse_persona(item, index=index, source_label=source_label)
        if persona.id in seen_ids:
            duplicate_ids.add(persona.id)
        seen_ids.add(persona.id)
        personas.append(persona)

    if duplicate_ids:
        ids = ", ".join(sorted(duplicate_ids))
        raise ValueError(f"duplicate persona id(s): {ids} ({source_label})")
    return personas


def _merge_personas(
    defaults: list[PersonaDefinition],
    project: list[PersonaDefinition],
) -> list[PersonaDefinition]:
    merged = list(defaults)
    index_by_id = {persona.id: index for index, persona in enumerate(merged)}
    for persona in project:
        existing_index = index_by_id.get(persona.id)
        if existing_index is None:
            index_by_id[persona.id] = len(merged)
            merged.append(persona)
            continue
        merged[existing_index] = persona
    return merged


def load_personas_from_payload(raw: dict[str, Any], source_label: str) -> list[PersonaDefinition]:
    return load_personas(raw.get("personas"), source_label=source_label)


def _parse_persona(raw: Any, index: int, source_label: str) -> PersonaDefinition:
    if not isinstance(raw, dict):
        raise ValueError(f"personas[{index}] must be an object ({source_label})")

    unknown_keys = sorted(set(raw.keys()) - _ALLOWED_KEYS)
    if unknown_keys:
        formatted = ", ".join(unknown_keys)
        raise ValueError(f"personas[{index}] has unknown keys: {formatted} ({source_label})")

    missing = [key for key in _REQUIRED_KEYS if key not in raw]
    if missing:
        formatted = ", ".join(missing)
        raise ValueError(f"personas[{index}] missing required keys: {formatted} ({source_label})")

    persona_id = raw["id"]
    role = raw["role"]
    focus = raw["focus"]
    can_block = raw["can_block"]
    enabled = raw["enabled"]
    execution = _parse_execution(
        raw.get("execution"),
        index=index,
        source_label=source_label,
    )

    if not isinstance(persona_id, str) or not persona_id.strip():
        raise ValueError(f"personas[{index}].id must be a non-empty string ({source_label})")
    persona_id = persona_id.strip()

    if not isinstance(role, str) or role not in _ALLOWED_ROLES:
        allowed = ", ".join(sorted(_ALLOWED_ROLES))
        raise ValueError(f"personas[{index}].role must be one of: {allowed} ({source_label})")

    if not isinstance(focus, str) or not focus.strip():
        raise ValueError(f"personas[{index}].focus must be a non-empty string ({source_label})")
    focus = focus.strip()

    if not isinstance(can_block, bool):
        raise ValueError(f"personas[{index}].can_block must be bool ({source_label})")

    if not isinstance(enabled, bool):
        raise ValueError(f"personas[{index}].enabled must be bool ({source_label})")

    return PersonaDefinition(
        id=persona_id,
        role=cast(PersonaRole, role),
        focus=focus,
        can_block=can_block,
        enabled=enabled,
        execution=execution,
    )


def _parse_execution(raw: Any, index: int, source_label: str) -> PersonaExecutionConfig | None:
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise ValueError(f"personas[{index}].execution must be an object ({source_label})")

    unknown_keys = sorted(set(raw.keys()) - _ALLOWED_EXECUTION_KEYS)
    if unknown_keys:
        formatted = ", ".join(unknown_keys)
        raise ValueError(f"personas[{index}].execution has unknown keys: {formatted} ({source_label})")

    required = ("enabled", "command_ref", "sandbox", "timeout_sec")
    missing = [key for key in required if key not in raw]
    if missing:
        formatted = ", ".join(missing)
        raise ValueError(f"personas[{index}].execution missing required keys: {formatted} ({source_label})")

    enabled = raw["enabled"]
    command_ref = raw["command_ref"]
    sandbox = raw["sandbox"]
    timeout_sec = raw["timeout_sec"]

    if not isinstance(enabled, bool):
        raise ValueError(f"personas[{index}].execution.enabled must be bool ({source_label})")
    if not isinstance(command_ref, str) or not command_ref.strip():
        raise ValueError(f"personas[{index}].execution.command_ref must be a non-empty string ({source_label})")
    if not isinstance(sandbox, str) or not sandbox.strip():
        raise ValueError(f"personas[{index}].execution.sandbox must be a non-empty string ({source_label})")
    if not isinstance(timeout_sec, int) or timeout_sec <= 0:
        raise ValueError(f"personas[{index}].execution.timeout_sec must be a positive integer ({source_label})")

    return PersonaExecutionConfig(
        enabled=enabled,
        command_ref=command_ref.strip(),
        sandbox=sandbox.strip(),
        timeout_sec=timeout_sec,
    )

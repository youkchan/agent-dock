from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal, cast

import yaml

PersonaRole = Literal["implementer", "reviewer", "spec_guard", "test_guard", "custom"]

_REQUIRED_KEYS = ("id", "role", "focus", "can_block", "enabled")
_OPTIONAL_KEYS = ("execution",)
_ALLOWED_KEYS = set(_REQUIRED_KEYS + _OPTIONAL_KEYS)
_ALLOWED_ROLES = {"implementer", "reviewer", "spec_guard", "test_guard", "custom"}
_ALLOWED_EXECUTION_KEYS = {"enabled", "command_ref", "sandbox", "timeout_sec"}
_MISSING = object()
_DEFAULT_PERSONA_IDS: tuple[str, ...] = (
    "implementer",
    "code-reviewer",
    "spec-checker",
    "test-owner",
)
_DEFAULT_PERSONA_ID_SET = set(_DEFAULT_PERSONA_IDS)
_DEFAULT_PERSONAS_DIR = Path(__file__).resolve().parent / "personas" / "default"


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

def default_personas() -> list[PersonaDefinition]:
    return list(_load_default_personas())


@lru_cache(maxsize=1)
def _load_default_personas() -> tuple[PersonaDefinition, ...]:
    if not _DEFAULT_PERSONAS_DIR.is_dir():
        raise ValueError(f"default persona directory not found: {_DEFAULT_PERSONAS_DIR}")

    persona_files = {path.stem: path for path in _DEFAULT_PERSONAS_DIR.glob("*.yaml")}
    missing_files = [persona_id for persona_id in _DEFAULT_PERSONA_IDS if persona_id not in persona_files]
    if missing_files:
        formatted = ", ".join(missing_files)
        raise ValueError(f"missing default persona file(s): {formatted} ({_DEFAULT_PERSONAS_DIR})")

    ordered_paths = [persona_files[persona_id] for persona_id in _DEFAULT_PERSONA_IDS]
    for extra_id in sorted(set(persona_files) - _DEFAULT_PERSONA_ID_SET):
        ordered_paths.append(persona_files[extra_id])

    personas: list[PersonaDefinition] = []
    seen_ids: set[str] = set()
    duplicate_ids: set[str] = set()
    for path in ordered_paths:
        raw = _read_default_persona_yaml(path)
        persona = _parse_persona(raw, index=0, source_label=f"default persona file: {path.name}")
        if persona.id in seen_ids:
            duplicate_ids.add(persona.id)
        seen_ids.add(persona.id)
        personas.append(persona)

    if duplicate_ids:
        ids = ", ".join(sorted(duplicate_ids))
        raise ValueError(f"duplicate persona id(s): {ids} (default persona files)")
    return tuple(personas)


def _read_default_persona_yaml(path: Path) -> Any:
    try:
        content = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise ValueError(f"failed to read default persona file: {path}") from exc

    try:
        return yaml.safe_load(content)
    except yaml.YAMLError as exc:
        raise ValueError(f"invalid YAML in default persona file: {path}") from exc


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
    # Keep backward-compatible behavior:
    # - same id: full replacement
    # - new id: append in project declaration order
    project_by_id = {persona.id: persona for persona in project}
    default_ids = {persona.id for persona in defaults}
    merged = [project_by_id.get(persona.id, persona) for persona in defaults]
    merged.extend(persona for persona in project if persona.id not in default_ids)
    return merged


def load_personas_from_payload(raw: dict[str, Any], source_label: str) -> list[PersonaDefinition]:
    if not isinstance(raw, dict):
        raise ValueError(f"payload must be an object ({source_label})")
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
    execution = _parse_execution(raw.get("execution", _MISSING), index=index, source_label=source_label)

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
    if raw is _MISSING or raw is None:
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
    if not isinstance(timeout_sec, int) or isinstance(timeout_sec, bool) or timeout_sec <= 0:
        raise ValueError(f"personas[{index}].execution.timeout_sec must be a positive integer ({source_label})")

    return PersonaExecutionConfig(
        enabled=enabled,
        command_ref=command_ref.strip(),
        sandbox=sandbox.strip(),
        timeout_sec=timeout_sec,
    )

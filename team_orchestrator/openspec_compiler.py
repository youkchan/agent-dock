from __future__ import annotations

import copy
import json
import re
from pathlib import Path
from typing import Any

from .persona_catalog import load_personas_from_payload
from .persona_policy import normalize_persona_defaults, normalize_task_persona_policy


class OpenSpecCompileError(ValueError):
    pass


TASK_ID_PATTERN = re.compile(r"(?:T-[A-Za-z0-9_-]+|TASK-[A-Za-z0-9_-]+|\d+(?:\.\d+)*)", re.IGNORECASE)
TASK_ID_FULL_PATTERN = re.compile(r"^(?:T-[A-Za-z0-9_-]+|TASK-[A-Za-z0-9_-]+|\d+(?:\.\d+)*)$", re.IGNORECASE)
TASK_HEADER_PATTERN = re.compile(r"^\s*-\s*\[[ xX]\]\s*(.+?)\s*$")
CHECK_ITEM_PATTERN = re.compile(r"^\s*-\s*\[([ xX])\]\s*(.+?)\s*$")
DEPENDENCY_PATTERN = re.compile(r"^\s*-\s*(?:依存|depends?\s*on|depends_on)\s*:\s*(.+?)\s*$", re.IGNORECASE)
TARGET_PATHS_PATTERN = re.compile(r"^\s*-\s*(?:対象|target[_\s-]*paths?)\s*:\s*(.+?)\s*$", re.IGNORECASE)
DESCRIPTION_PATTERN = re.compile(
    r"^\s*-\s*(?:成果物|説明|description|deliverable|outcome)\s*:\s*(.+?)\s*$",
    re.IGNORECASE,
)
PERSONA_DEFAULTS_PATTERN = re.compile(
    r"^\s*-\s*(?:persona[_\s-]*defaults?|ペルソナ(?:既定|デフォルト))\s*:\s*(.+?)\s*$",
    re.IGNORECASE,
)
PERSONAS_PATTERN = re.compile(r"^\s*-\s*(?:personas|ペルソナ(?:定義)?)\s*:\s*(.+?)\s*$", re.IGNORECASE)
DISABLE_PERSONAS_PATTERN = re.compile(
    r"^\s*-\s*(?:disable[_\s-]*personas?|利用禁止(?:ペルソナ)?|disable)\s*:\s*(.+?)\s*$",
    re.IGNORECASE,
)
TASK_PERSONA_POLICY_PATTERN = re.compile(
    r"^\s*-\s*(?:persona[_\s-]*policy|ペルソナ方針)\s*:\s*(.+?)\s*$",
    re.IGNORECASE,
)
PHASE_OVERRIDES_PATTERN = re.compile(
    r"^\s*-\s*(?:phase[_\s-]*overrides?|フェーズ上書き)\s*:\s*(.+?)\s*$",
    re.IGNORECASE,
)
PHASE_ASSIGNMENTS_PATTERN = re.compile(
    r"^\s*-\s*(?:phase[_\s-]*(?:assignments?|owners?|executors?)|フェーズ(?:担当|実行))\s*:\s*(.+?)\s*$",
    re.IGNORECASE,
)
REQUIRES_PLAN_PATTERN = re.compile(r"requires_plan\s*=\s*(true|false)", re.IGNORECASE)
REQUIRES_PLAN_TITLE_SUFFIX_PATTERN = re.compile(
    r"\s*[（(][^）)]*requires_plan\s*=\s*(?:true|false)[^）)]*[）)]\s*$",
    re.IGNORECASE,
)

ALLOWED_OVERRIDE_TOP_LEVEL_KEYS = {"teammates", "tasks", "requires_plan", "depends_on"}
ALLOWED_TASK_OVERRIDE_KEYS = {"title", "description", "target_paths", "depends_on", "requires_plan"}
DEFAULT_PERSONA_PHASE_ORDER = ("implement", "review", "spec_check", "test")


def default_compiled_output_path(change_id: str, task_config_root: Path | str = Path("task_configs")) -> Path:
    return Path(task_config_root) / f"{change_id}.json"


def write_compiled_config(config_payload: dict[str, Any], output_path: Path | str) -> Path:
    target = Path(output_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("w", encoding="utf-8") as handle:
        json.dump(config_payload, handle, ensure_ascii=False, indent=2, sort_keys=True)
    return target


def compile_change_to_config(
    change_id: str,
    *,
    openspec_root: Path | str = Path("openspec"),
    overrides_root: Path | str = Path("task_configs/overrides"),
    teammates: list[str] | None = None,
) -> dict[str, Any]:
    openspec_path = Path(openspec_root)
    change_dir = openspec_path / "changes" / change_id
    if not change_dir.exists() or not change_dir.is_dir():
        raise OpenSpecCompileError(f"change not found: {change_dir}")
    tasks_path = change_dir / "tasks.md"
    if not tasks_path.exists():
        raise OpenSpecCompileError(f"tasks.md not found: {tasks_path}")

    tasks, verification_items, persona_directives = _parse_tasks_markdown(tasks_path)
    payload: dict[str, Any] = {
        "teammates": teammates if teammates else ["teammate-a", "teammate-b"],
        "tasks": tasks,
        "meta": {
            "source_change_id": change_id,
            "verification_items": verification_items,
        },
    }
    _apply_persona_directives(payload, persona_directives)
    payload = _apply_overrides(payload, Path(overrides_root) / f"{change_id}.yaml")
    return validate_compiled_config(payload, change_id=change_id)


def validate_compiled_config(payload: dict[str, Any], *, change_id: str) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise OpenSpecCompileError("compiled payload must be an object")
    normalized_payload = copy.deepcopy(payload)
    _validate_compiled_payload(normalized_payload, change_id=change_id)
    _validate_persona_payload(normalized_payload, change_id=change_id)
    normalized_payload["tasks"] = sorted(normalized_payload["tasks"], key=lambda item: item["id"])
    return normalized_payload


def _parse_tasks_markdown(
    tasks_path: Path,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    lines = tasks_path.read_text(encoding="utf-8").splitlines()
    parsed_tasks: list[dict[str, Any]] = []
    verification_items: list[dict[str, Any]] = []
    persona_defaults: dict[str, Any] | None = None
    personas: list[dict[str, Any]] | None = None
    global_disable_personas: list[str] = []
    current_task: dict[str, Any] | None = None
    current_description_parts: list[str] = []
    known_ids: set[str] = set()
    current_section = ""
    auto_id_counter = 1

    def finalize_current() -> None:
        nonlocal current_task
        if current_task is None:
            return
        description = "\n".join(current_description_parts).strip()
        current_task["description"] = description
        parsed_tasks.append(current_task)
        current_task = None

    for line_no, line in enumerate(lines, start=1):
        heading_match = re.match(r"^\s*##+\s+(.+?)\s*$", line)
        if heading_match:
            finalize_current()
            current_description_parts = []
            current_section = heading_match.group(1).strip()
            continue

        if _is_verification_section(current_section):
            check_match = CHECK_ITEM_PATTERN.match(line)
            if check_match:
                verification_items.append(
                    {
                        "text": check_match.group(2).strip(),
                        "checked": check_match.group(1).strip().lower() == "x",
                        "line": line_no,
                    }
                )
                continue

        header_match = TASK_HEADER_PATTERN.match(line)
        if header_match:
            finalize_current()
            task_id, title_raw = _extract_task_id_and_title(
                header_match.group(1),
                auto_id_counter=auto_id_counter,
            )
            auto_id_counter += 1
            if task_id in known_ids:
                raise OpenSpecCompileError(f"duplicate task id {task_id} at {tasks_path}:{line_no}")
            known_ids.add(task_id)
            requires_plan = _extract_requires_plan(title_raw)
            title = REQUIRES_PLAN_TITLE_SUFFIX_PATTERN.sub("", title_raw).strip() or title_raw
            current_task = {
                "id": task_id,
                "title": title,
                "description": "",
                "target_paths": [],
                "depends_on": [],
                "requires_plan": requires_plan,
            }
            current_description_parts = []
            continue

        if current_task is None:
            persona_defaults_match = PERSONA_DEFAULTS_PATTERN.match(line)
            if persona_defaults_match:
                parsed_defaults = _parse_inline_json(
                    persona_defaults_match.group(1),
                    expected_type=dict,
                    label="persona_defaults",
                    tasks_path=tasks_path,
                    line_no=line_no,
                )
                persona_defaults = _merge_dict_values(persona_defaults, parsed_defaults)
                continue

            personas_match = PERSONAS_PATTERN.match(line)
            if personas_match:
                parsed_personas = _parse_inline_json(
                    personas_match.group(1),
                    expected_type=list,
                    label="personas",
                    tasks_path=tasks_path,
                    line_no=line_no,
                )
                normalized_personas = [item for item in parsed_personas if isinstance(item, dict)]
                if len(normalized_personas) != len(parsed_personas):
                    raise OpenSpecCompileError(f"personas must be an array of objects at {tasks_path}:{line_no}")
                personas = normalized_personas
                continue

            global_disable_match = DISABLE_PERSONAS_PATTERN.match(line)
            if global_disable_match:
                global_disable_personas = _merge_unique(
                    global_disable_personas,
                    _parse_persona_id_list(global_disable_match.group(1)),
                )
                continue

            global_phase_assignments_match = PHASE_ASSIGNMENTS_PATTERN.match(line)
            if global_phase_assignments_match:
                assignments = _parse_phase_assignments(
                    global_phase_assignments_match.group(1),
                    tasks_path=tasks_path,
                    line_no=line_no,
                )
                if persona_defaults is None:
                    persona_defaults = {}
                phase_policies = persona_defaults.setdefault("phase_policies", {})
                if not isinstance(phase_policies, dict):
                    raise OpenSpecCompileError(f"persona_defaults.phase_policies must be object at {tasks_path}:{line_no}")
                phase_policies = _merge_dict_values(phase_policies, assignments)
                persona_defaults["phase_policies"] = phase_policies
                phase_order = persona_defaults.setdefault("phase_order", [])
                if not isinstance(phase_order, list):
                    raise OpenSpecCompileError(f"persona_defaults.phase_order must be list at {tasks_path}:{line_no}")
                for phase in assignments.keys():
                    if phase not in phase_order:
                        phase_order.append(phase)
                continue

            continue

        persona_policy_match = TASK_PERSONA_POLICY_PATTERN.match(line)
        if persona_policy_match:
            parsed_policy = _parse_inline_json(
                persona_policy_match.group(1),
                expected_type=dict,
                label="persona_policy",
                tasks_path=tasks_path,
                line_no=line_no,
            )
            existing_policy = current_task.get("persona_policy") if isinstance(current_task.get("persona_policy"), dict) else None
            current_task["persona_policy"] = _merge_persona_policy(existing_policy, parsed_policy)
            continue

        task_phase_overrides_match = PHASE_OVERRIDES_PATTERN.match(line)
        if task_phase_overrides_match:
            parsed_phase_overrides = _parse_inline_json(
                task_phase_overrides_match.group(1),
                expected_type=dict,
                label="phase_overrides",
                tasks_path=tasks_path,
                line_no=line_no,
            )
            existing_policy = current_task.get("persona_policy") if isinstance(current_task.get("persona_policy"), dict) else None
            current_task["persona_policy"] = _merge_persona_policy(
                existing_policy,
                {"phase_overrides": parsed_phase_overrides},
            )
            continue

        task_disable_match = DISABLE_PERSONAS_PATTERN.match(line)
        if task_disable_match:
            parsed_disable_personas = _parse_persona_id_list(task_disable_match.group(1))
            existing_policy = current_task.get("persona_policy") if isinstance(current_task.get("persona_policy"), dict) else None
            current_task["persona_policy"] = _merge_persona_policy(
                existing_policy,
                {"disable_personas": parsed_disable_personas},
            )
            continue

        task_phase_assignments_match = PHASE_ASSIGNMENTS_PATTERN.match(line)
        if task_phase_assignments_match:
            assignments = _parse_phase_assignments(
                task_phase_assignments_match.group(1),
                tasks_path=tasks_path,
                line_no=line_no,
            )
            existing_policy = current_task.get("persona_policy") if isinstance(current_task.get("persona_policy"), dict) else None
            current_task["persona_policy"] = _merge_persona_policy(
                existing_policy,
                {"phase_overrides": assignments},
            )
            continue

        dep_match = DEPENDENCY_PATTERN.match(line)
        if dep_match:
            current_task["depends_on"] = _parse_dependency_value(dep_match.group(1), tasks_path, line_no)
            continue

        target_match = TARGET_PATHS_PATTERN.match(line)
        if target_match:
            current_task["target_paths"] = _parse_path_value(target_match.group(1))
            continue

        desc_match = DESCRIPTION_PATTERN.match(line)
        if desc_match:
            current_description_parts.append(desc_match.group(1).strip())
            continue

    finalize_current()
    if not parsed_tasks:
        raise OpenSpecCompileError(f"no tasks found in {tasks_path}")
    persona_directives: dict[str, Any] = {}
    if personas is not None:
        persona_directives["personas"] = personas
    if persona_defaults is not None:
        persona_directives["persona_defaults"] = persona_defaults
    if global_disable_personas:
        persona_directives["global_disable_personas"] = global_disable_personas
    return parsed_tasks, verification_items, persona_directives


def _is_verification_section(section_title: str) -> bool:
    normalized = re.sub(r"\s+", " ", section_title.strip()).lower()
    patterns = (
        r"検証項目",
        r"verification",
        r"validation",
        r"checklist",
        r"checks?",
        r"testing",
        r"\bqa\b",
    )
    return any(re.search(pattern, normalized) for pattern in patterns)


def _extract_requires_plan(text: str) -> bool:
    match = REQUIRES_PLAN_PATTERN.search(text)
    if not match:
        return False
    return match.group(1).lower() == "true"


def _extract_task_id_and_title(raw_header: str, auto_id_counter: int) -> tuple[str, str]:
    stripped = raw_header.strip()
    matched = re.match(
        r"^(?P<task_id>(?:T-[A-Za-z0-9_-]+|TASK-[A-Za-z0-9_-]+|\d+(?:\.\d+)*))\s+(?P<title>.+)$",
        stripped,
        flags=re.IGNORECASE,
    )
    if matched:
        return matched.group("task_id").strip(), matched.group("title").strip()
    return f"AUTO-{auto_id_counter:03d}", stripped


def _parse_dependency_value(raw: str, tasks_path: Path, line_no: int) -> list[str]:
    cleaned = raw.strip()
    if cleaned in {"なし", "none", "None", "-"}:
        return []
    dependencies = TASK_ID_PATTERN.findall(cleaned)
    if dependencies:
        return dependencies
    raise OpenSpecCompileError(
        f"dependency parse failed at {tasks_path}:{line_no}. "
        f"use task ids like T-001/TASK-1/1.1 or 'none'."
    )


def _parse_path_value(raw: str) -> list[str]:
    value = raw.strip()
    if not value:
        return []
    if value in {"なし", "none", "None", "-"}:
        return []

    backticked = re.findall(r"`([^`]+)`", value)
    if backticked:
        return [item.strip() for item in backticked if item.strip()]

    if value.startswith("[") and value.endswith("]"):
        inner = value[1:-1].strip()
        if not inner:
            return []
        parts = [part.strip().strip("\"'") for part in inner.split(",")]
        return [part for part in parts if part]

    if "," in value or "、" in value:
        parts = re.split(r"[、,]", value)
        cleaned_parts = [part.strip().strip("\"'") for part in parts]
        return [part for part in cleaned_parts if part]

    return [value.strip().strip("\"'")]


def _parse_inline_json(
    raw: str,
    *,
    expected_type: type,
    label: str,
    tasks_path: Path,
    line_no: int,
) -> Any:
    value = raw.strip()
    if value.startswith("`") and value.endswith("`") and len(value) >= 2:
        value = value[1:-1].strip()
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError as error:
        raise OpenSpecCompileError(f"{label} must be JSON at {tasks_path}:{line_no}") from error
    if not isinstance(parsed, expected_type):
        expected_label = "object" if expected_type is dict else "array" if expected_type is list else expected_type.__name__
        raise OpenSpecCompileError(f"{label} must be JSON {expected_label} at {tasks_path}:{line_no}")
    return parsed


def _parse_persona_id_list(raw: str) -> list[str]:
    candidates = _parse_path_value(raw)
    normalized: list[str] = []
    seen: set[str] = set()
    for item in candidates:
        parts = [part.strip() for part in re.split(r"[/]", item) if part.strip()]
        if not parts:
            parts = [item.strip()]
        for part in parts:
            if not part or part in seen:
                continue
            seen.add(part)
            normalized.append(part)
    return normalized


def _merge_unique(existing: list[str], incoming: list[str]) -> list[str]:
    merged: list[str] = []
    seen: set[str] = set()
    for item in existing + incoming:
        value = str(item).strip()
        if not value or value in seen:
            continue
        seen.add(value)
        merged.append(value)
    return merged


def _parse_phase_assignments(raw: str, *, tasks_path: Path, line_no: int) -> dict[str, dict[str, list[str]]]:
    parsed: dict[str, dict[str, list[str]]] = {}
    chunks = [chunk.strip() for chunk in re.split(r"[;|]", raw) if chunk.strip()]
    if not chunks:
        raise OpenSpecCompileError(f"phase assignments must not be empty at {tasks_path}:{line_no}")
    for chunk in chunks:
        matched = re.match(r"^(?P<phase>[^=:]+)\s*(?:=|:)\s*(?P<personas>.+)$", chunk)
        if not matched:
            raise OpenSpecCompileError(f"invalid phase assignment '{chunk}' at {tasks_path}:{line_no}")
        phase = _normalize_phase_id(matched.group("phase"))
        persona_ids = _parse_persona_id_list(matched.group("personas"))
        if not persona_ids:
            raise OpenSpecCompileError(f"phase assignment has no personas for phase '{phase}' at {tasks_path}:{line_no}")
        parsed[phase] = {
            "active_personas": persona_ids,
            "executor_personas": persona_ids,
            "state_transition_personas": persona_ids,
        }
    return parsed


def _merge_persona_policy(existing: dict[str, Any] | None, incoming: dict[str, Any]) -> dict[str, Any]:
    merged = copy.deepcopy(existing) if isinstance(existing, dict) else {}
    for key, value in incoming.items():
        if key == "disable_personas":
            if isinstance(value, list):
                incoming_values = _merge_unique([], [str(item).strip() for item in value if str(item).strip()])
            else:
                incoming_values = _parse_persona_id_list(str(value))
            existing_values = merged.get("disable_personas")
            merged["disable_personas"] = _merge_unique(
                existing_values if isinstance(existing_values, list) else [],
                incoming_values,
            )
            continue
        if key == "phase_overrides":
            incoming_overrides = value if isinstance(value, dict) else {}
            existing_overrides = merged.get("phase_overrides")
            normalized_existing = existing_overrides if isinstance(existing_overrides, dict) else {}
            merged["phase_overrides"] = _merge_dict_values(normalized_existing, incoming_overrides)
            continue
        merged[key] = copy.deepcopy(value)
    return merged


def _merge_dict_values(existing: dict[str, Any] | None, incoming: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(existing, dict):
        return copy.deepcopy(incoming) if isinstance(incoming, dict) else {}
    if not isinstance(incoming, dict):
        return copy.deepcopy(existing)

    merged = copy.deepcopy(existing)
    for key, value in incoming.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _merge_dict_values(merged.get(key), value)
            continue
        if isinstance(value, list) and isinstance(merged.get(key), list):
            merged[key] = _merge_unique([str(item) for item in merged.get(key, [])], [str(item) for item in value])
            continue
        merged[key] = copy.deepcopy(value)
    return merged


def _normalize_phase_id(raw: str) -> str:
    base = re.sub(r"[\s\-]+", "_", str(raw).strip().lower())
    aliases = {
        "speccheck": "spec_check",
        "spec_checker": "spec_check",
        "spec_review": "spec_check",
    }
    return aliases.get(base, base)


def _apply_persona_directives(payload: dict[str, Any], persona_directives: dict[str, Any]) -> None:
    if not persona_directives:
        return
    if "personas" in persona_directives:
        payload["personas"] = copy.deepcopy(persona_directives["personas"])
    if "persona_defaults" in persona_directives:
        payload["persona_defaults"] = copy.deepcopy(persona_directives["persona_defaults"])

    global_disable = persona_directives.get("global_disable_personas", [])
    global_disable_list = [str(item).strip() for item in global_disable if str(item).strip()]
    if global_disable_list:
        for task in payload.get("tasks", []):
            if not isinstance(task, dict):
                continue
            existing_policy = task.get("persona_policy") if isinstance(task.get("persona_policy"), dict) else None
            task["persona_policy"] = _merge_persona_policy(
                existing_policy,
                {"disable_personas": global_disable_list},
            )

    task_policy_ids = sorted(
        [
            str(task.get("id")).strip()
            for task in payload.get("tasks", [])
            if isinstance(task, dict) and isinstance(task.get("persona_policy"), dict)
        ]
    )
    meta = payload.setdefault("meta", {})
    if isinstance(meta, dict):
        meta["persona_resolution"] = {
            "global_disable_personas": sorted(global_disable_list),
            "tasks_with_persona_policy": [task_id for task_id in task_policy_ids if task_id],
        }


def _apply_overrides(base_payload: dict[str, Any], override_path: Path) -> dict[str, Any]:
    if not override_path.exists():
        return base_payload
    override_data = _load_override_yaml(override_path)
    unknown_top_level = set(override_data.keys()).difference(ALLOWED_OVERRIDE_TOP_LEVEL_KEYS)
    if unknown_top_level:
        unknown_sorted = ", ".join(sorted(unknown_top_level))
        raise OpenSpecCompileError(f"unknown override keys: {unknown_sorted}")

    merged = copy.deepcopy(base_payload)
    tasks_by_id = {task["id"]: task for task in merged["tasks"]}

    if "teammates" in override_data:
        teammates = override_data["teammates"]
        if not isinstance(teammates, list) or not teammates:
            raise OpenSpecCompileError("override teammates must be a non-empty list")
        merged["teammates"] = [str(item).strip() for item in teammates if str(item).strip()]
        if not merged["teammates"]:
            raise OpenSpecCompileError("override teammates must contain at least one non-empty id")

    if "requires_plan" in override_data:
        requires_map = override_data["requires_plan"]
        if not isinstance(requires_map, dict):
            raise OpenSpecCompileError("override requires_plan must be an object")
        for task_id, flag in requires_map.items():
            task = _resolve_task_for_override(tasks_by_id, str(task_id))
            if not isinstance(flag, bool):
                raise OpenSpecCompileError(f"requires_plan override must be bool: {task_id}")
            task["requires_plan"] = flag

    if "depends_on" in override_data:
        depends_map = override_data["depends_on"]
        if not isinstance(depends_map, dict):
            raise OpenSpecCompileError("override depends_on must be an object")
        for task_id, deps in depends_map.items():
            task = _resolve_task_for_override(tasks_by_id, str(task_id))
            task["depends_on"] = _normalize_depends_override(task_id=str(task_id), value=deps)

    if "tasks" in override_data:
        task_overrides = override_data["tasks"]
        if not isinstance(task_overrides, dict):
            raise OpenSpecCompileError("override tasks must be an object")
        for task_id, override_item in task_overrides.items():
            task = _resolve_task_for_override(tasks_by_id, str(task_id))
            if not isinstance(override_item, dict):
                raise OpenSpecCompileError(f"task override must be object: {task_id}")
            unknown_task_keys = set(override_item.keys()).difference(ALLOWED_TASK_OVERRIDE_KEYS)
            if unknown_task_keys:
                unknown_sorted = ", ".join(sorted(unknown_task_keys))
                raise OpenSpecCompileError(f"unknown task override keys for {task_id}: {unknown_sorted}")
            if "title" in override_item:
                title = str(override_item["title"]).strip()
                if not title:
                    raise OpenSpecCompileError(f"title override must be non-empty: {task_id}")
                task["title"] = title
            if "description" in override_item:
                task["description"] = str(override_item["description"])
            if "target_paths" in override_item:
                target_paths = override_item["target_paths"]
                if not isinstance(target_paths, list):
                    raise OpenSpecCompileError(f"target_paths override must be list: {task_id}")
                task["target_paths"] = [str(item).strip() for item in target_paths if str(item).strip()]
            if "depends_on" in override_item:
                task["depends_on"] = _normalize_depends_override(
                    task_id=str(task_id),
                    value=override_item["depends_on"],
                )
            if "requires_plan" in override_item:
                value = override_item["requires_plan"]
                if not isinstance(value, bool):
                    raise OpenSpecCompileError(f"requires_plan override must be bool: {task_id}")
                task["requires_plan"] = value

    return merged


def _load_override_yaml(path: Path) -> dict[str, Any]:
    try:
        import yaml  # type: ignore
    except Exception as error:
        raise OpenSpecCompileError(
            f"override yaml requires PyYAML (pip install pyyaml). file={path}"
        ) from error
    with path.open("r", encoding="utf-8") as handle:
        loaded = yaml.safe_load(handle)
    if loaded is None:
        return {}
    if not isinstance(loaded, dict):
        raise OpenSpecCompileError(f"override root must be object: {path}")
    return loaded


def _resolve_task_for_override(tasks_by_id: dict[str, dict[str, Any]], task_id: str) -> dict[str, Any]:
    task = tasks_by_id.get(task_id)
    if not task:
        raise OpenSpecCompileError(f"override references unknown task id: {task_id}")
    return task


def _normalize_depends_override(task_id: str, value: Any) -> list[str]:
    if isinstance(value, str):
        if value.strip() in {"", "-", "なし", "none", "None"}:
            return []
        dependencies = TASK_ID_PATTERN.findall(value)
        if not dependencies:
            raise OpenSpecCompileError(f"depends_on override must include task ids: {task_id}")
        return dependencies
    if isinstance(value, list):
        normalized = [str(item).strip() for item in value if str(item).strip()]
        for dep in normalized:
            if not TASK_ID_FULL_PATTERN.fullmatch(dep):
                raise OpenSpecCompileError(f"depends_on override contains invalid id '{dep}' for {task_id}")
        return normalized
    raise OpenSpecCompileError(f"depends_on override must be list or string: {task_id}")


def _validate_compiled_payload(payload: dict[str, Any], *, change_id: str) -> None:
    teammates = payload.get("teammates")
    if not isinstance(teammates, list) or not teammates:
        raise OpenSpecCompileError("compiled teammates must be a non-empty list")
    normalized_teammates = [str(item).strip() for item in teammates if str(item).strip()]
    if not normalized_teammates:
        raise OpenSpecCompileError("compiled teammates must contain non-empty values")
    payload["teammates"] = normalized_teammates

    tasks = payload.get("tasks")
    if not isinstance(tasks, list) or not tasks:
        raise OpenSpecCompileError("compiled tasks must be a non-empty list")

    task_ids: set[str] = set()
    auto_target_path_tasks: list[str] = []
    dependency_graph: dict[str, list[str]] = {}

    for task in tasks:
        if not isinstance(task, dict):
            raise OpenSpecCompileError("each compiled task must be an object")
        task_id = str(task.get("id", "")).strip()
        if not task_id:
            raise OpenSpecCompileError("task id is required")
        if task_id in task_ids:
            raise OpenSpecCompileError(f"duplicate task id in compiled config: {task_id}")
        task_ids.add(task_id)

        title = str(task.get("title", "")).strip()
        if not title:
            raise OpenSpecCompileError(f"task title is required: {task_id}")
        task["title"] = title
        task["description"] = str(task.get("description", "")).strip()

        target_paths = task.get("target_paths")
        if not isinstance(target_paths, list):
            raise OpenSpecCompileError(f"target_paths must be list: {task_id}")
        normalized_paths = [str(item).strip() for item in target_paths if str(item).strip()]
        if not normalized_paths:
            # Keep compiler runnable without overrides by falling back to a conservative
            # wildcard target so unrelated tasks do not silently bypass collision control.
            normalized_paths = ["*"]
            auto_target_path_tasks.append(task_id)
        task["target_paths"] = normalized_paths

        depends_on = task.get("depends_on", [])
        if not isinstance(depends_on, list):
            raise OpenSpecCompileError(f"depends_on must be list: {task_id}")
        normalized_deps = [str(item).strip() for item in depends_on if str(item).strip()]
        task["depends_on"] = normalized_deps
        dependency_graph[task_id] = normalized_deps

        requires_plan = task.get("requires_plan", False)
        if not isinstance(requires_plan, bool):
            raise OpenSpecCompileError(f"requires_plan must be bool: {task_id}")
        task["requires_plan"] = requires_plan

    missing_dependencies: list[str] = []
    for task_id, dependencies in dependency_graph.items():
        for dep in dependencies:
            if dep not in task_ids:
                missing_dependencies.append(f"unknown dependency '{dep}' in task {task_id} for change {change_id}")
    if missing_dependencies:
        raise OpenSpecCompileError("; ".join(missing_dependencies))

    meta = payload.setdefault("meta", {})
    if isinstance(meta, dict):
        meta["auto_target_path_tasks"] = sorted(auto_target_path_tasks)

    _validate_no_dependency_cycle(dependency_graph)


def _validate_persona_payload(payload: dict[str, Any], *, change_id: str) -> None:
    _canonicalize_phase_fields(payload)
    source_label = f"openspec:{change_id}"
    try:
        personas = load_personas_from_payload(payload, source_label=source_label)
        known_persona_ids = {persona.id for persona in personas}
        validation_errors: list[str] = []
        if "persona_defaults" in payload:
            try:
                payload["persona_defaults"] = normalize_persona_defaults(
                    payload.get("persona_defaults"),
                    source_label=source_label,
                    known_persona_ids=known_persona_ids,
                )
            except ValueError as error:
                validation_errors.append(str(error))

        known_phases = set(DEFAULT_PERSONA_PHASE_ORDER)
        persona_defaults = payload.get("persona_defaults")
        if isinstance(persona_defaults, dict):
            phase_order = persona_defaults.get("phase_order")
            if isinstance(phase_order, list) and phase_order:
                known_phases = set(phase_order)
            phase_policies = persona_defaults.get("phase_policies")
            if isinstance(phase_policies, dict):
                unknown_phases = sorted(set(phase_policies.keys()) - known_phases)
                if unknown_phases:
                    formatted = ", ".join(unknown_phases)
                    validation_errors.append(f"unknown persona phase(s) in persona_defaults: {formatted}")

        for task in payload.get("tasks", []):
            if not isinstance(task, dict):
                continue
            task_id = str(task.get("id", "")).strip() or "<unknown>"
            raw_policy = task.get("persona_policy")
            try:
                normalized_policy = normalize_task_persona_policy(
                    raw_policy,
                    source_label=source_label,
                    task_id=task_id,
                    known_persona_ids=known_persona_ids,
                )
            except ValueError as error:
                validation_errors.append(f"task {task_id}: {error}")
                continue

            task_has_error = False
            if isinstance(normalized_policy, dict):
                phase_order = normalized_policy.get("phase_order")
                if isinstance(phase_order, list):
                    unknown_phases = sorted(set(phase_order) - known_phases)
                    if unknown_phases:
                        formatted = ", ".join(unknown_phases)
                        validation_errors.append(
                            f"unknown persona phase(s) in task {task_id} phase_order: {formatted}"
                        )
                        task_has_error = True
                phase_overrides = normalized_policy.get("phase_overrides")
                if isinstance(phase_overrides, dict):
                    unknown_phases = sorted(set(phase_overrides.keys()) - known_phases)
                    if unknown_phases:
                        formatted = ", ".join(unknown_phases)
                        validation_errors.append(f"unknown persona phase(s) in task {task_id}: {formatted}")
                        task_has_error = True
                if not isinstance(phase_overrides, dict) or not phase_overrides:
                    validation_errors.append(
                        f"task {task_id} must define phase assignments via persona_policy.phase_overrides"
                    )
                    task_has_error = True
            else:
                validation_errors.append(
                    f"task {task_id} must define phase assignments via persona_policy.phase_overrides"
                )
                task_has_error = True

            if task_has_error:
                continue
            if normalized_policy is None:
                task.pop("persona_policy", None)
            else:
                task["persona_policy"] = normalized_policy
        if "personas" in payload:
            payload["personas"] = [persona.to_dict() for persona in personas]
        if validation_errors:
            raise OpenSpecCompileError("; ".join(validation_errors))
    except OpenSpecCompileError:
        raise
    except ValueError as error:
        raise OpenSpecCompileError(str(error)) from error


def _canonicalize_phase_fields(payload: dict[str, Any]) -> None:
    default_phase_order: list[str] = []
    persona_defaults = payload.get("persona_defaults")
    if isinstance(persona_defaults, dict):
        phase_order = persona_defaults.get("phase_order")
        if isinstance(phase_order, list):
            normalized_order: list[str] = []
            seen: set[str] = set()
            for item in phase_order:
                phase = _normalize_phase_id(str(item))
                if not phase or phase in seen:
                    continue
                seen.add(phase)
                normalized_order.append(phase)
            persona_defaults["phase_order"] = normalized_order
            default_phase_order = list(normalized_order)
        phase_policies = persona_defaults.get("phase_policies")
        if isinstance(phase_policies, dict):
            normalized_policies: dict[str, Any] = {}
            for phase_raw, phase_policy in phase_policies.items():
                normalized_phase = _normalize_phase_id(str(phase_raw))
                normalized_policies[normalized_phase] = phase_policy
            persona_defaults["phase_policies"] = normalized_policies

    for task in payload.get("tasks", []):
        if not isinstance(task, dict):
            continue
        policy = task.get("persona_policy")
        if not isinstance(policy, dict):
            continue
        task_phase_order = policy.get("phase_order")
        normalized_task_phase_order: list[str] = []
        if isinstance(task_phase_order, list):
            seen_task_phases: set[str] = set()
            for item in task_phase_order:
                phase = _normalize_phase_id(str(item))
                if not phase or phase in seen_task_phases:
                    continue
                seen_task_phases.add(phase)
                normalized_task_phase_order.append(phase)
            policy["phase_order"] = normalized_task_phase_order
        phase_overrides = policy.get("phase_overrides")
        if isinstance(phase_overrides, dict):
            normalized_overrides: dict[str, Any] = {}
            for phase_raw, phase_policy in phase_overrides.items():
                normalized_phase = _normalize_phase_id(str(phase_raw))
                normalized_overrides[normalized_phase] = phase_policy
            policy["phase_overrides"] = normalized_overrides
            if not normalized_task_phase_order:
                task_override_phases = list(normalized_overrides.keys())
                if default_phase_order:
                    ordered = [phase for phase in default_phase_order if phase in normalized_overrides]
                    ordered.extend([phase for phase in task_override_phases if phase not in ordered])
                    policy["phase_order"] = ordered
                else:
                    policy["phase_order"] = task_override_phases


def _validate_no_dependency_cycle(graph: dict[str, list[str]]) -> None:
    visiting: set[str] = set()
    visited: set[str] = set()
    stack: list[str] = []

    def dfs(node: str) -> None:
        if node in visited:
            return
        if node in visiting:
            cycle_start = stack.index(node) if node in stack else 0
            cycle = stack[cycle_start:] + [node]
            raise OpenSpecCompileError(f"dependency cycle detected: {' -> '.join(cycle)}")
        visiting.add(node)
        stack.append(node)
        for dep in graph.get(node, []):
            dfs(dep)
        stack.pop()
        visiting.remove(node)
        visited.add(node)

    for task_id in sorted(graph.keys()):
        dfs(task_id)

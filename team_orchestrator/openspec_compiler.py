from __future__ import annotations

import copy
import json
import re
from pathlib import Path
from typing import Any


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
REQUIRES_PLAN_PATTERN = re.compile(r"requires_plan\s*=\s*(true|false)", re.IGNORECASE)
REQUIRES_PLAN_TITLE_SUFFIX_PATTERN = re.compile(
    r"\s*[（(][^）)]*requires_plan\s*=\s*(?:true|false)[^）)]*[）)]\s*$",
    re.IGNORECASE,
)

ALLOWED_OVERRIDE_TOP_LEVEL_KEYS = {"teammates", "tasks", "requires_plan", "depends_on"}
ALLOWED_TASK_OVERRIDE_KEYS = {"title", "description", "target_paths", "depends_on", "requires_plan"}


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

    tasks, verification_items = _parse_tasks_markdown(tasks_path)
    payload: dict[str, Any] = {
        "teammates": teammates if teammates else ["teammate-a", "teammate-b"],
        "tasks": tasks,
        "meta": {
            "source_change_id": change_id,
            "verification_items": verification_items,
        },
    }
    payload = _apply_overrides(payload, Path(overrides_root) / f"{change_id}.yaml")
    _validate_compiled_payload(payload, change_id=change_id)
    payload["tasks"] = sorted(payload["tasks"], key=lambda item: item["id"])
    return payload


def _parse_tasks_markdown(tasks_path: Path) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    lines = tasks_path.read_text(encoding="utf-8").splitlines()
    parsed_tasks: list[dict[str, Any]] = []
    verification_items: list[dict[str, Any]] = []
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
    return parsed_tasks, verification_items


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

    for task_id, dependencies in dependency_graph.items():
        for dep in dependencies:
            if dep not in task_ids:
                raise OpenSpecCompileError(f"unknown dependency '{dep}' in task {task_id} for change {change_id}")

    meta = payload.setdefault("meta", {})
    if isinstance(meta, dict):
        meta["auto_target_path_tasks"] = sorted(auto_target_path_tasks)

    _validate_no_dependency_cycle(dependency_graph)


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

from __future__ import annotations

import copy
import json
import os
import re
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


class CodexConsistencyError(RuntimeError):
    pass


ALLOWED_CONSISTENCY_RESULT_KEYS = frozenset({"is_consistent", "issues", "patch"})
ALLOWED_PATCH_KEYS = frozenset({"tasks_append", "tasks_update", "teammates"})
ALLOWED_TASK_UPDATE_KEYS = frozenset({"title", "description", "target_paths", "depends_on", "requires_plan"})
ALLOWED_TASK_APPEND_KEYS = frozenset({"id", "title", "description", "target_paths", "depends_on", "requires_plan"})
TASK_ID_PATTERN = re.compile(r"(?:T-[A-Za-z0-9_-]+|TASK-[A-Za-z0-9_-]+|\d+(?:\.\d+)*)", re.IGNORECASE)
TASK_ID_FULL_PATTERN = re.compile(r"^(?:T-[A-Za-z0-9_-]+|TASK-[A-Za-z0-9_-]+|\d+(?:\.\d+)*)$", re.IGNORECASE)


@dataclass(frozen=True)
class OpenSpecChangeSource:
    proposal_md: str
    tasks_md: str
    design_md: str | None
    specs: dict[str, str]

    def to_payload(self) -> dict[str, str]:
        payload = {
            "proposal.md": self.proposal_md,
            "tasks.md": self.tasks_md,
        }
        if self.design_md is not None:
            payload["design.md"] = self.design_md
        for path, content in sorted(self.specs.items()):
            payload[path] = content
        return payload


@dataclass(frozen=True)
class CodexConsistencyReviewRequest:
    change_id: str
    source: OpenSpecChangeSource
    compiled_task_config: dict[str, Any]

    def to_payload(self) -> dict[str, Any]:
        return {
            "change_id": self.change_id,
            "source": self.source.to_payload(),
            "compiled_task_config": copy.deepcopy(self.compiled_task_config),
        }


@dataclass
class CodexConsistencyReviewClient:
    command: list[str]
    timeout_seconds: int = 120
    extra_env: dict[str, str] = field(default_factory=dict)

    def review(self, request: CodexConsistencyReviewRequest) -> dict[str, Any]:
        if not self.command:
            raise CodexConsistencyError("codex consistency command is empty")
        payload = request.to_payload()
        try:
            completed = subprocess.run(
                self.command,
                input=json.dumps(payload, ensure_ascii=True),
                capture_output=True,
                text=True,
                timeout=self.timeout_seconds,
                env={**os.environ, **self.extra_env},
                check=False,
            )
        except subprocess.TimeoutExpired as error:
            raise CodexConsistencyError(
                f"codex consistency command timed out ({self.timeout_seconds}s): {' '.join(self.command)}"
            ) from error
        except OSError as error:
            raise CodexConsistencyError(
                f"failed to start codex consistency command: {' '.join(self.command)}"
            ) from error

        stdout = (completed.stdout or "").strip()
        stderr = (completed.stderr or "").strip()
        if completed.returncode != 0:
            detail = stderr or "no stderr"
            raise CodexConsistencyError(
                f"codex consistency command failed ({completed.returncode}): {detail}"
            )
        if not stdout:
            raise CodexConsistencyError("codex consistency command returned empty output")
        try:
            parsed = json.loads(stdout)
        except json.JSONDecodeError as error:
            raise CodexConsistencyError("codex consistency command output must be valid JSON object") from error
        if not isinstance(parsed, dict):
            raise CodexConsistencyError("codex consistency command output must be JSON object")
        return parsed


def validate_consistency_review_response(payload: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise CodexConsistencyError("codex consistency response must be JSON object")
    unknown_top_level = set(payload.keys()).difference(ALLOWED_CONSISTENCY_RESULT_KEYS)
    if unknown_top_level:
        unknown = ", ".join(sorted(unknown_top_level))
        raise CodexConsistencyError(f"codex consistency response has unknown key(s): {unknown}")

    if "is_consistent" not in payload:
        raise CodexConsistencyError("codex consistency response must include is_consistent")
    is_consistent = payload["is_consistent"]
    if not isinstance(is_consistent, bool):
        raise CodexConsistencyError("codex consistency response is_consistent must be bool")

    if "issues" not in payload:
        raise CodexConsistencyError("codex consistency response must include issues")
    issues = payload["issues"]
    if not isinstance(issues, list):
        raise CodexConsistencyError("codex consistency response issues must be list")

    patch_raw = payload.get("patch")
    if patch_raw is None:
        if not is_consistent:
            raise CodexConsistencyError("codex consistency response patch is required when is_consistent=false")
        normalized_patch: dict[str, Any] | None = None
    else:
        normalized_patch = _normalize_patch(patch_raw)
        if not is_consistent and not normalized_patch:
            raise CodexConsistencyError("codex consistency response patch must not be empty when is_consistent=false")

    return {
        "is_consistent": is_consistent,
        "issues": copy.deepcopy(issues),
        "patch": normalized_patch,
    }


def apply_consistency_patch(compiled_task_config: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(compiled_task_config, dict):
        raise CodexConsistencyError("compiled_task_config must be object")
    normalized_patch = _normalize_patch(patch)
    if not normalized_patch:
        return copy.deepcopy(compiled_task_config)

    merged = copy.deepcopy(compiled_task_config)
    tasks = merged.get("tasks")
    if not isinstance(tasks, list):
        raise CodexConsistencyError("compiled_task_config.tasks must be list")

    tasks_by_id: dict[str, dict[str, Any]] = {}
    for index, task in enumerate(tasks):
        if not isinstance(task, dict):
            raise CodexConsistencyError(f"compiled_task_config.tasks[{index}] must be object")
        task_id = str(task.get("id", "")).strip()
        if not task_id:
            raise CodexConsistencyError(f"compiled_task_config.tasks[{index}].id is required")
        if task_id in tasks_by_id:
            raise CodexConsistencyError(f"compiled_task_config has duplicate task id: {task_id}")
        tasks_by_id[task_id] = task

    if "teammates" in normalized_patch:
        merged["teammates"] = list(normalized_patch["teammates"])

    for task_id, updates in normalized_patch.get("tasks_update", {}).items():
        task = tasks_by_id.get(task_id)
        if task is None:
            raise CodexConsistencyError(f"tasks_update references unknown task id: {task_id}")
        for field, value in updates.items():
            task[field] = value

    for new_task in normalized_patch.get("tasks_append", []):
        task_id = new_task["id"]
        if task_id in tasks_by_id:
            raise CodexConsistencyError(f"tasks_append has duplicate task id: {task_id}")
        appended = copy.deepcopy(new_task)
        tasks.append(appended)
        tasks_by_id[task_id] = appended

    return merged


def _normalize_patch(patch: Any) -> dict[str, Any]:
    if not isinstance(patch, dict):
        raise CodexConsistencyError("codex consistency response patch must be object")
    unknown_patch_keys = set(patch.keys()).difference(ALLOWED_PATCH_KEYS)
    if unknown_patch_keys:
        unknown = ", ".join(sorted(unknown_patch_keys))
        raise CodexConsistencyError(f"codex consistency patch has unknown key(s): {unknown}")

    normalized: dict[str, Any] = {}
    if "teammates" in patch:
        normalized["teammates"] = _normalize_teammates(patch["teammates"], label="patch.teammates")
    if "tasks_update" in patch:
        normalized["tasks_update"] = _normalize_tasks_update(patch["tasks_update"])
    if "tasks_append" in patch:
        normalized["tasks_append"] = _normalize_tasks_append(patch["tasks_append"])
    return normalized


def _normalize_teammates(raw_value: Any, *, label: str) -> list[str]:
    if not isinstance(raw_value, list):
        raise CodexConsistencyError(f"{label} must be list")
    normalized = [str(item).strip() for item in raw_value if str(item).strip()]
    if not normalized:
        raise CodexConsistencyError(f"{label} must contain at least one non-empty id")
    return normalized


def _normalize_tasks_update(raw_value: Any) -> dict[str, dict[str, Any]]:
    if not isinstance(raw_value, dict):
        raise CodexConsistencyError("patch.tasks_update must be object")
    normalized: dict[str, dict[str, Any]] = {}
    for task_id_raw, update_raw in raw_value.items():
        task_id = str(task_id_raw).strip()
        if not task_id:
            raise CodexConsistencyError("patch.tasks_update key must be non-empty task id")
        if not isinstance(update_raw, dict):
            raise CodexConsistencyError(f"patch.tasks_update.{task_id} must be object")
        unknown = set(update_raw.keys()).difference(ALLOWED_TASK_UPDATE_KEYS)
        if unknown:
            unknown_fields = ", ".join(sorted(unknown))
            raise CodexConsistencyError(f"patch.tasks_update.{task_id} has unknown field(s): {unknown_fields}")
        if not update_raw:
            raise CodexConsistencyError(f"patch.tasks_update.{task_id} must include at least one field")
        normalized[task_id] = _normalize_task_fields(
            fields=update_raw,
            allow_id=False,
            context=f"patch.tasks_update.{task_id}",
        )
    return normalized


def _normalize_tasks_append(raw_value: Any) -> list[dict[str, Any]]:
    if not isinstance(raw_value, list):
        raise CodexConsistencyError("patch.tasks_append must be list")
    normalized: list[dict[str, Any]] = []
    seen_task_ids: set[str] = set()
    for index, task_raw in enumerate(raw_value):
        context = f"patch.tasks_append[{index}]"
        if not isinstance(task_raw, dict):
            raise CodexConsistencyError(f"{context} must be object")
        unknown = set(task_raw.keys()).difference(ALLOWED_TASK_APPEND_KEYS)
        if unknown:
            unknown_fields = ", ".join(sorted(unknown))
            raise CodexConsistencyError(f"{context} has unknown field(s): {unknown_fields}")
        task_id = str(task_raw.get("id", "")).strip()
        if not task_id:
            raise CodexConsistencyError(f"{context}.id is required")
        if task_id in seen_task_ids:
            raise CodexConsistencyError(f"patch.tasks_append contains duplicate task id: {task_id}")
        if "title" not in task_raw:
            raise CodexConsistencyError(f"{context}.title is required")
        if "target_paths" not in task_raw:
            raise CodexConsistencyError(f"{context}.target_paths is required")
        normalized_task = _normalize_task_fields(
            fields=task_raw,
            allow_id=True,
            context=context,
        )
        normalized.append(normalized_task)
        seen_task_ids.add(task_id)
    return normalized


def _normalize_task_fields(
    *,
    fields: dict[str, Any],
    allow_id: bool,
    context: str,
) -> dict[str, Any]:
    normalized: dict[str, Any] = {}
    if allow_id:
        task_id = str(fields.get("id", "")).strip()
        if not task_id:
            raise CodexConsistencyError(f"{context}.id is required")
        normalized["id"] = task_id

    if "title" in fields:
        title = str(fields["title"]).strip()
        if not title:
            raise CodexConsistencyError(f"{context}.title must be non-empty")
        normalized["title"] = title
    elif allow_id:
        raise CodexConsistencyError(f"{context}.title is required")

    if "description" in fields:
        normalized["description"] = str(fields["description"])
    elif allow_id:
        normalized["description"] = ""

    if "target_paths" in fields:
        target_paths = fields["target_paths"]
        if not isinstance(target_paths, list):
            raise CodexConsistencyError(f"{context}.target_paths must be list")
        normalized["target_paths"] = [str(item).strip() for item in target_paths if str(item).strip()]
    elif allow_id:
        raise CodexConsistencyError(f"{context}.target_paths is required")

    if "depends_on" in fields:
        normalized["depends_on"] = _normalize_depends_on(fields["depends_on"], context=context)
    elif allow_id:
        normalized["depends_on"] = []

    if "requires_plan" in fields:
        requires_plan = fields["requires_plan"]
        if not isinstance(requires_plan, bool):
            raise CodexConsistencyError(f"{context}.requires_plan must be bool")
        normalized["requires_plan"] = requires_plan
    elif allow_id:
        normalized["requires_plan"] = False

    return normalized


def _normalize_depends_on(raw_value: Any, *, context: str) -> list[str]:
    if isinstance(raw_value, str):
        cleaned = raw_value.strip()
        if cleaned in {"", "-", "なし", "none", "None"}:
            return []
        dependencies = TASK_ID_PATTERN.findall(cleaned)
        if not dependencies:
            raise CodexConsistencyError(f"{context}.depends_on must include task ids")
        return dependencies
    if isinstance(raw_value, list):
        normalized = [str(item).strip() for item in raw_value if str(item).strip()]
        for dep in normalized:
            if not TASK_ID_FULL_PATTERN.fullmatch(dep):
                raise CodexConsistencyError(f"{context}.depends_on has invalid task id: {dep}")
        return normalized
    raise CodexConsistencyError(f"{context}.depends_on must be list or string")


def build_consistency_review_request(
    *,
    change_id: str,
    compiled_task_config: dict[str, Any],
    openspec_root: Path | str = Path("openspec"),
) -> CodexConsistencyReviewRequest:
    source = load_change_source(change_id=change_id, openspec_root=openspec_root)
    return CodexConsistencyReviewRequest(
        change_id=change_id,
        source=source,
        compiled_task_config=copy.deepcopy(compiled_task_config),
    )


def load_change_source(*, change_id: str, openspec_root: Path | str = Path("openspec")) -> OpenSpecChangeSource:
    change_dir = Path(openspec_root) / "changes" / change_id
    if not change_dir.exists() or not change_dir.is_dir():
        raise CodexConsistencyError(f"OpenSpec change not found: {change_dir}")

    proposal_path = change_dir / "proposal.md"
    tasks_path = change_dir / "tasks.md"
    if not proposal_path.exists():
        raise CodexConsistencyError(f"required file not found: {proposal_path}")
    if not tasks_path.exists():
        raise CodexConsistencyError(f"required file not found: {tasks_path}")

    design_path = change_dir / "design.md"
    specs_dir = change_dir / "specs"
    specs: dict[str, str] = {}
    if specs_dir.exists() and specs_dir.is_dir():
        for spec_path in sorted(specs_dir.rglob("spec.md")):
            relative = spec_path.relative_to(change_dir).as_posix()
            specs[relative] = spec_path.read_text(encoding="utf-8")

    return OpenSpecChangeSource(
        proposal_md=proposal_path.read_text(encoding="utf-8"),
        tasks_md=tasks_path.read_text(encoding="utf-8"),
        design_md=design_path.read_text(encoding="utf-8") if design_path.exists() else None,
        specs=specs,
    )

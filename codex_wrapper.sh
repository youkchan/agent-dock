#!/usr/bin/env bash
set -euo pipefail

if ! command -v codex >/dev/null 2>&1; then
  echo "codex command not found" >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 command not found" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_PROJECT_DIR="${TARGET_PROJECT_DIR:-$SCRIPT_DIR}"
CODEX_BIN="${CODEX_BIN:-codex}"
CODEX_MODEL="${CODEX_MODEL:-}"
CODEX_REASONING_EFFORT="${CODEX_REASONING_EFFORT:-}"
CODEX_PROFILE="${CODEX_PROFILE:-}"
CODEX_SANDBOX="${CODEX_SANDBOX:-workspace-write}"
CODEX_FULL_AUTO="${CODEX_FULL_AUTO:-0}"
CODEX_SKIP_GIT_REPO_CHECK="${CODEX_SKIP_GIT_REPO_CHECK:-1}"
CODEX_STREAM_LOGS="${CODEX_STREAM_LOGS:-1}"
CODEX_STREAM_VIEW="${CODEX_STREAM_VIEW:-all}"
CODEX_DENY_DOTENV="${CODEX_DENY_DOTENV:-1}"
CODEX_WRAPPER_LANG="${CODEX_WRAPPER_LANG:-en_US.UTF-8}"
CODEX_RUST_BACKTRACE="${CODEX_RUST_BACKTRACE:-0}"

PAYLOAD="$(cat)"
if [[ -z "${PAYLOAD// }" ]]; then
  echo "empty stdin payload" >&2
  exit 2
fi

PROMPT="$(
  PAYLOAD="$PAYLOAD" CODEX_DENY_DOTENV="$CODEX_DENY_DOTENV" python3 - <<'PY'
import json
import os
import re
import sys

try:
    payload = json.loads(os.environ["PAYLOAD"])
except Exception as error:
    print(f"invalid input payload: {error}", file=sys.stderr)
    sys.exit(2)

def _contains_dotenv_reference(raw: str) -> bool:
    text = raw.lower().strip()
    if ".env" not in text:
        return False
    tokens = re.split(r"[,\s]+", text)
    for token_raw in tokens:
        token = token_raw.strip("'\"()[]{}")
        if not token:
            continue
        if token.startswith(".env"):
            return True
        if "/.env" in token or "\\.env" in token:
            return True
    return False

def _collect_dotenv_hits(name: str, value) -> list[str]:
    hits: list[str] = []
    if isinstance(value, list):
        for item in value:
            text = str(item)
            if _contains_dotenv_reference(text):
                hits.append(f"{name}:{text}")
        return hits
    text = str(value)
    if _contains_dotenv_reference(text):
        hits.append(f"{name}:{text}")
    return hits

def _safe_int_env(name: str, default: int, minimum: int, maximum: int) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    if value < minimum:
        return minimum
    if value > maximum:
        return maximum
    return value

def _sanitize_prompt_text(raw: str) -> str:
    # Keep prompt deterministic and avoid control-character leakage from logs.
    text = raw.replace("\r", " ").replace("\n", " ").strip()
    cleaned: list[str] = []
    for ch in text:
        code = ord(ch)
        if ch == "\t" or code >= 0x20:
            cleaned.append(ch)
    normalized = "".join(cleaned)
    return re.sub(r"\s+", " ", normalized).strip()

mode = payload.get("mode")
teammate_id = str(payload.get("teammate_id") or "teammate")
task = payload.get("task") or {}

task_id = str(task.get("id") or "")
title = str(task.get("title") or "")
description = str(task.get("description") or "")
target_paths = task.get("target_paths") or []
depends_on = task.get("depends_on") or []
requires_plan = bool(task.get("requires_plan"))
progress_log = task.get("progress_log") or []

deny_dotenv = os.getenv("CODEX_DENY_DOTENV", "1").strip() != "0"
if deny_dotenv:
    violations: list[str] = []
    violations.extend(_collect_dotenv_hits("title", title))
    violations.extend(_collect_dotenv_hits("description", description))
    violations.extend(_collect_dotenv_hits("target_paths", target_paths))
    violations.extend(_collect_dotenv_hits("depends_on", depends_on))
    if violations:
        preview = ", ".join(violations[:5])
        print(
            "deny rule violation: .env/.env.* references are forbidden in task payload "
            f"(task_id={task_id or 'unknown'}; {preview})",
            file=sys.stderr,
        )
        sys.exit(3)

if isinstance(target_paths, list):
    target_paths_str = ", ".join(str(item) for item in target_paths) if target_paths else "(none)"
else:
    target_paths_str = str(target_paths)

if isinstance(depends_on, list):
    depends_on_str = ", ".join(str(item) for item in depends_on) if depends_on else "(none)"
else:
    depends_on_str = str(depends_on)

progress_log_count = 0
progress_log_recent = "(none)"
if isinstance(progress_log, list):
    progress_log_count = len(progress_log)
    max_recent_lines = _safe_int_env(
        "CODEX_PROGRESS_RECENT_LINES",
        default=8,
        minimum=1,
        maximum=20,
    )
    max_recent_text_chars = _safe_int_env(
        "CODEX_PROGRESS_RECENT_TEXT_CHARS",
        default=220,
        minimum=80,
        maximum=1200,
    )
    max_recent_total_chars = _safe_int_env(
        "CODEX_PROGRESS_RECENT_TOTAL_CHARS",
        default=2000,
        minimum=400,
        maximum=12000,
    )
    recent_lines: list[str] = []
    for entry in progress_log[-max_recent_lines:]:
        if not isinstance(entry, dict):
            continue
        text = _sanitize_prompt_text(str(entry.get("text") or ""))
        if not text:
            continue
        if len(text) > max_recent_text_chars:
            text = text[: max_recent_text_chars - 3] + "..."
        source = str(entry.get("source") or "unknown").strip() or "unknown"
        timestamp = entry.get("timestamp")
        if isinstance(timestamp, (int, float)):
            stamp = f"{timestamp:.3f}"
        else:
            stamp = "-"
        recent_lines.append(f"- [{stamp}] {source}: {text}")
    if recent_lines:
        joined = "\n".join(recent_lines)
        if len(joined) > max_recent_total_chars:
            joined = joined[: max_recent_total_chars - 3] + "..."
        progress_log_recent = joined

if mode == "plan":
    prompt = f"""You are implementation teammate {teammate_id}.
Create only the execution plan for this task.

task_id: {task_id}
title: {title}
description: {description}
target_paths: {target_paths_str}
depends_on: {depends_on_str}
requires_plan: {requires_plan}

Constraints:
- Do not propose edits outside target_paths
- Do not read/reference/edit .env or .env.*
- Keep steps short and concrete
- Include local verification commands at the end

Output format:
1) Acceptance criteria
2) Implementation steps
3) Files to edit
4) Local checks
Keep total output within 12 lines."""
    print(prompt)
    sys.exit(0)

if mode == "execute":
    prompt = f"""You are implementation teammate {teammate_id}.
Execute the task below.

task_id: {task_id}
title: {title}
description: {description}
target_paths: {target_paths_str}
depends_on: {depends_on_str}
requires_plan: {requires_plan}
existing_progress_log_count: {progress_log_count}
existing_progress_log_recent:
{progress_log_recent}

Constraints:
- Do not edit outside target_paths
- Do not read/reference/edit .env or .env.*
- Run required local checks
- If failed, provide a short root cause

Final output must be exactly these 4 lines:
RESULT: completed|blocked
SUMMARY: <=100 chars
CHANGED_FILES: comma-separated
CHECKS: executed check commands"""
    max_prompt_chars = _safe_int_env(
        "CODEX_PROMPT_MAX_CHARS",
        default=16000,
        minimum=2000,
        maximum=120000,
    )
    if len(prompt) > max_prompt_chars:
        prompt = prompt[: max_prompt_chars - 60] + "\n\n[truncated by codex_wrapper]"
    print(prompt)
    sys.exit(0)

print(f"unknown mode: {mode}", file=sys.stderr)
sys.exit(2)
PY
)"

TMP_OUTPUT="$(mktemp)"
TMP_DOTENV_SNAPSHOT="$(mktemp)"
TMP_STREAM_LOG="$(mktemp)"
TMP_PROMPT_FILE="$(mktemp)"
TMP_PROMPT_LOG="${CODEX_PROMPT_LOG_PATH:-/tmp/codex_wrapper_last_prompt.txt}"
trap 'rm -f "$TMP_OUTPUT" "$TMP_DOTENV_SNAPSHOT" "$TMP_STREAM_LOG" "$TMP_PROMPT_FILE"' EXIT

snapshot_dotenv_files() {
  TARGET_PROJECT_DIR="$TARGET_PROJECT_DIR" SNAPSHOT_PATH="$TMP_DOTENV_SNAPSHOT" python3 - <<'PY'
import hashlib
import json
import os
from pathlib import Path

root = Path(os.environ["TARGET_PROJECT_DIR"]).resolve()
snapshot_path = Path(os.environ["SNAPSHOT_PATH"])
payload: dict[str, str] = {}

for candidate in root.rglob(".env*"):
    if not candidate.is_file():
        continue
    relative = candidate.relative_to(root).as_posix()
    digest = hashlib.sha256(candidate.read_bytes()).hexdigest()
    payload[relative] = digest

snapshot_path.write_text(json.dumps(payload, ensure_ascii=True, sort_keys=True), encoding="utf-8")
PY
}

verify_dotenv_files_unchanged() {
  TARGET_PROJECT_DIR="$TARGET_PROJECT_DIR" SNAPSHOT_PATH="$TMP_DOTENV_SNAPSHOT" python3 - <<'PY'
import hashlib
import json
import os
import sys
from pathlib import Path

root = Path(os.environ["TARGET_PROJECT_DIR"]).resolve()
snapshot_path = Path(os.environ["SNAPSHOT_PATH"])
before_raw = snapshot_path.read_text(encoding="utf-8").strip()
before = json.loads(before_raw) if before_raw else {}
after: dict[str, str] = {}

for candidate in root.rglob(".env*"):
    if not candidate.is_file():
        continue
    relative = candidate.relative_to(root).as_posix()
    digest = hashlib.sha256(candidate.read_bytes()).hexdigest()
    after[relative] = digest

if before != after:
    before_keys = set(before.keys())
    after_keys = set(after.keys())
    added = sorted(after_keys.difference(before_keys))
    removed = sorted(before_keys.difference(after_keys))
    changed = sorted(path for path in before_keys.intersection(after_keys) if before[path] != after[path])
    details: list[str] = []
    if added:
        details.append("added=" + ",".join(added))
    if removed:
        details.append("removed=" + ",".join(removed))
    if changed:
        details.append("changed=" + ",".join(changed))
    suffix = (" (" + "; ".join(details) + ")") if details else ""
    print("deny rule violation: .env/.env.* files were modified by codex" + suffix, file=sys.stderr)
    sys.exit(4)
PY
}

CMD=(
  env
  "LANG=$CODEX_WRAPPER_LANG"
  "LC_ALL=$CODEX_WRAPPER_LANG"
  "RUST_BACKTRACE=$CODEX_RUST_BACKTRACE"
  "$CODEX_BIN" exec
  -C "$TARGET_PROJECT_DIR"
  --output-last-message "$TMP_OUTPUT"
)

if [[ "$CODEX_SKIP_GIT_REPO_CHECK" == "1" ]]; then
  CMD+=(--skip-git-repo-check)
fi

if [[ -n "$CODEX_MODEL" ]]; then
  CMD+=(-m "$CODEX_MODEL")
fi

if [[ -n "$CODEX_REASONING_EFFORT" ]]; then
  CMD+=(-c "model_reasoning_effort=\"$CODEX_REASONING_EFFORT\"")
fi

if [[ -n "$CODEX_PROFILE" ]]; then
  CMD+=(-p "$CODEX_PROFILE")
fi

if [[ "$CODEX_FULL_AUTO" == "1" ]]; then
  CMD+=(--full-auto)
else
  CMD+=(-s "$CODEX_SANDBOX")
fi

CMD+=("-")

if [[ "${CODEX_WRAPPER_DEBUG:-0}" == "1" ]]; then
  printf '%s' "$PROMPT" > "$TMP_PROMPT_LOG" || true
  echo "[codex_wrapper] prompt_chars=${#PROMPT} prompt_log=$TMP_PROMPT_LOG" >&2
  echo "[codex_wrapper] prompt_stdin=$TMP_PROMPT_FILE" >&2
  printf '[codex_wrapper] cmd=' >&2
  printf '%q ' "${CMD[@]}" >&2
  printf '\n' >&2
fi

printf '%s' "$PROMPT" > "$TMP_PROMPT_FILE"

if [[ "$CODEX_DENY_DOTENV" != "0" ]]; then
  snapshot_dotenv_files
fi

stream_assistant_view() {
  local include_user="${1:-1}"
  CODEX_STREAM_INCLUDE_USER="$include_user" python3 - <<'PY'
import os
import re
import sys

ansi_re = re.compile(r"\x1B\[[0-9;]*[A-Za-z]")
include_user = os.getenv("CODEX_STREAM_INCLUDE_USER", "1").strip() == "1"
mode = "default"
in_diff = False

for raw in sys.stdin:
    line = raw.rstrip("\n")
    plain = ansi_re.sub("", line).replace("\r", "")
    stripped = plain.strip()
    lowered = stripped.lower()

    if lowered == "thinking":
        mode = "thinking"
        in_diff = False
        print(line)
        continue
    if lowered == "codex":
        mode = "codex"
        in_diff = False
        print(line)
        continue
    if lowered == "user":
        mode = "user"
        in_diff = False
        if include_user:
            print(line)
        continue
    if lowered.startswith("exec"):
        mode = "exec"
        in_diff = False
        continue

    if mode == "exec":
        continue
    if mode not in ("user", "thinking", "codex"):
        continue
    if mode == "user" and not include_user:
        continue

    if lowered.startswith("pyenv: "):
        continue
    if lowered.startswith("mcp startup:"):
        continue
    if lowered.startswith("tokens used"):
        continue
    if lowered.startswith("file update"):
        in_diff = True
        continue
    if lowered.startswith("apply_patch("):
        in_diff = True
        continue
    if lowered.startswith("success. updated the following files:"):
        in_diff = True
        continue

    if in_diff:
        if stripped == "":
            in_diff = False
            continue
        if (
            lowered.startswith("diff --git")
            or lowered.startswith("index ")
            or lowered.startswith("--- ")
            or lowered.startswith("+++ ")
            or lowered.startswith("@@ ")
        ):
            continue
        if stripped.startswith("+") or stripped.startswith("-"):
            continue
        if stripped.startswith("M ") or stripped.startswith("A ") or stripped.startswith("D "):
            continue
        if stripped.startswith("Chunk ID:") or lowered.startswith("wall time:"):
            continue
        if lowered.startswith("process exited with code"):
            continue
        if lowered.startswith("output:"):
            continue
        if lowered.startswith("diff --"):
            continue
        in_diff = False

    if lowered.startswith("/bin/"):
        continue
    if "succeeded in " in lowered and "/bin/" in lowered:
        continue

    print(line)
PY
}

run_codex_command() {
  "${CMD[@]}" < "$TMP_PROMPT_FILE"
}

extract_result_block() {
  STREAM_PATH="$TMP_STREAM_LOG" OUTPUT_PATH="$TMP_OUTPUT" python3 - <<'PY'
import os
import re
import sys
from pathlib import Path

stream_path = Path(os.environ["STREAM_PATH"])
output_path = Path(os.environ["OUTPUT_PATH"])
if not stream_path.exists():
    sys.exit(1)
raw = stream_path.read_text(encoding="utf-8", errors="ignore")
lines = [line.strip() for line in raw.splitlines() if line.strip()]

patterns = {
    "RESULT": re.compile(r"^RESULT:\s*(.+)$"),
    "SUMMARY": re.compile(r"^SUMMARY:\s*(.+)$"),
    "CHANGED_FILES": re.compile(r"^CHANGED_FILES:\s*(.+)$"),
    "CHECKS": re.compile(r"^CHECKS:\s*(.+)$"),
}
found: dict[str, str] = {}
for line in reversed(lines):
    for key, pattern in patterns.items():
        if key in found:
            continue
        match = pattern.match(line)
        if match:
            found[key] = match.group(1).strip()

if len(found) == 4:
    output = "\n".join(
        [
            f"RESULT: {found['RESULT']}",
            f"SUMMARY: {found['SUMMARY']}",
            f"CHANGED_FILES: {found['CHANGED_FILES']}",
            f"CHECKS: {found['CHECKS']}",
        ]
    )
    output_path.write_text(output, encoding="utf-8")
    sys.exit(0)

sys.exit(2)
PY
}

codex_exit_code=0
set +e
if [[ "$CODEX_STREAM_LOGS" == "1" ]]; then
  if [[ "$CODEX_STREAM_VIEW" == "assistant" ]]; then
    run_codex_command 2>&1 | tee "$TMP_STREAM_LOG" | stream_assistant_view 1 1>&2
    codex_exit_code=${PIPESTATUS[0]}
  elif [[ "$CODEX_STREAM_VIEW" == "thinking" ]]; then
    run_codex_command 2>&1 | tee "$TMP_STREAM_LOG" | stream_assistant_view 0 1>&2
    codex_exit_code=${PIPESTATUS[0]}
  else
    run_codex_command 2>&1 | tee "$TMP_STREAM_LOG" 1>&2
    codex_exit_code=${PIPESTATUS[0]}
  fi
else
  run_codex_command >"$TMP_STREAM_LOG" 2>&1
  codex_exit_code=$?
fi
set -e

if [[ $codex_exit_code -ne 0 ]]; then
  ERROR_LOG_PATH="${CODEX_ERROR_LOG_PATH:-/tmp/codex_wrapper_last_error.log}"
  if [[ -s "$TMP_STREAM_LOG" ]]; then
    cp "$TMP_STREAM_LOG" "$ERROR_LOG_PATH" 2>/dev/null || true
    echo "codex command failed (exit=$codex_exit_code)" >&2
    echo "codex stderr/stdout tail (full: $ERROR_LOG_PATH):" >&2
    tail -n 80 "$TMP_STREAM_LOG" >&2 || true
  fi
  if [[ -s "$TMP_STREAM_LOG" ]]; then
    preview="$(tail -n 60 "$TMP_STREAM_LOG" | tr '\n' ' ' | sed -E 's/[[:space:]]+/ /g' | cut -c 1-1200)"
    echo "codex command failed (exit=$codex_exit_code): $preview" >&2
  elif [[ -s "$TMP_OUTPUT" ]]; then
    preview="$(head -c 400 "$TMP_OUTPUT" | tr '\n' ' ')"
    echo "codex command failed (exit=$codex_exit_code): $preview" >&2
  else
    echo "codex command failed (exit=$codex_exit_code)" >&2
  fi
  exit $codex_exit_code
fi

if [[ ! -s "$TMP_OUTPUT" ]]; then
  extract_result_block || true
fi

if [[ ! -s "$TMP_OUTPUT" ]]; then
  echo "codex returned empty output" >&2
  if [[ -s "$TMP_STREAM_LOG" ]]; then
    echo "last stream lines:" >&2
    tail -n 40 "$TMP_STREAM_LOG" >&2 || true
  fi
  exit 3
fi

if [[ "$CODEX_DENY_DOTENV" != "0" ]]; then
  verify_dotenv_files_unchanged
fi

cat "$TMP_OUTPUT"

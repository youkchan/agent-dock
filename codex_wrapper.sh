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

mode = payload.get("mode")
teammate_id = str(payload.get("teammate_id") or "teammate")
task = payload.get("task") or {}

task_id = str(task.get("id") or "")
title = str(task.get("title") or "")
description = str(task.get("description") or "")
target_paths = task.get("target_paths") or []
depends_on = task.get("depends_on") or []
requires_plan = bool(task.get("requires_plan"))

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

if mode == "plan":
    prompt = f"""あなたは実装担当の {teammate_id} です。
次のタスクに対する実行計画だけを作ってください。

task_id: {task_id}
title: {title}
description: {description}
target_paths: {target_paths_str}
depends_on: {depends_on_str}
requires_plan: {requires_plan}

制約:
- target_paths 以外の編集提案はしない
- .env / .env.* は読まない・参照しない・編集しない
- 手順は短く具体的にする
- 最後にローカル確認手順を必ず含める

出力形式:
1) 受け入れ条件
2) 実装ステップ
3) 編集対象ファイル
4) ローカル確認
各項目を短く、合計 12 行以内で返してください。"""
    print(prompt)
    sys.exit(0)

if mode == "execute":
    prompt = f"""あなたは実装担当の {teammate_id} です。
次のタスクを実行してください。

task_id: {task_id}
title: {title}
description: {description}
target_paths: {target_paths_str}
depends_on: {depends_on_str}
requires_plan: {requires_plan}

制約:
- target_paths 以外は編集しない
- .env / .env.* は読まない・参照しない・編集しない
- 必要なローカル確認を実行する
- 失敗時は原因を短く書く

最終出力は次の 4 行のみ:
RESULT: completed|blocked
SUMMARY: 100文字以内
CHANGED_FILES: カンマ区切り
CHECKS: 実行した確認コマンド"""
    print(prompt)
    sys.exit(0)

print(f"unknown mode: {mode}", file=sys.stderr)
sys.exit(2)
PY
)"

TMP_OUTPUT="$(mktemp)"
TMP_DOTENV_SNAPSHOT="$(mktemp)"
trap 'rm -f "$TMP_OUTPUT" "$TMP_DOTENV_SNAPSHOT"' EXIT

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

CMD+=("$PROMPT")

if [[ "$CODEX_DENY_DOTENV" != "0" ]]; then
  snapshot_dotenv_files
fi

stream_assistant_view() {
  awk '
    BEGIN { mode = "default" }
    {
      line = $0
      plain = $0
      gsub(/\r/, "", plain)
      gsub(/\x1B\[[0-9;]*[A-Za-z]/, "", plain)

      if (plain ~ /^thinking[[:space:]]*$/) { mode = "thinking"; print line; next }
      if (plain ~ /^codex[[:space:]]*$/) { mode = "codex"; print line; next }
      if (plain ~ /^user[[:space:]]*$/) { mode = "user"; print line; next }
      if (plain ~ /^exec([[:space:]]|$)/) { mode = "exec"; next }

      if (mode == "exec") { next }
      if (mode == "default" || mode == "user" || mode == "thinking" || mode == "codex") {
        print line
        next
      }
    }
  '
}

if [[ "$CODEX_STREAM_LOGS" == "1" ]]; then
  if [[ "$CODEX_STREAM_VIEW" == "assistant" ]]; then
    "${CMD[@]}" 2>&1 | stream_assistant_view 1>&2
  else
    "${CMD[@]}" 1>&2
  fi
else
  "${CMD[@]}" >/dev/null
fi

if [[ ! -s "$TMP_OUTPUT" ]]; then
  echo "codex returned empty output" >&2
  exit 3
fi

if [[ "$CODEX_DENY_DOTENV" != "0" ]]; then
  verify_dotenv_files_unchanged
fi

cat "$TMP_OUTPUT"

#!/usr/bin/env bash
set -euo pipefail

if ! command -v codex >/dev/null 2>&1; then
  echo "codex command not found" >&2
  exit 1
fi

if ! command -v deno >/dev/null 2>&1; then
  echo "deno command not found" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_PROJECT_DIR="${TARGET_PROJECT_DIR:-$SCRIPT_DIR}"
WRAPPER_HELPER_SCRIPT="${WRAPPER_HELPER_SCRIPT:-$SCRIPT_DIR/src/infrastructure/wrapper/helper.ts}"
CODEX_BIN="${CODEX_BIN:-codex}"
CODEX_MODEL="${CODEX_MODEL:-}"
CODEX_REASONING_EFFORT="${CODEX_REASONING_EFFORT:-}"
CODEX_PROFILE="${CODEX_PROFILE:-}"
CODEX_SANDBOX="${CODEX_SANDBOX:-workspace-write}"
CODEX_FULL_AUTO="${CODEX_FULL_AUTO:-0}"
CODEX_SKIP_GIT_REPO_CHECK="${CODEX_SKIP_GIT_REPO_CHECK:-1}"
CODEX_STREAM_LOGS="${CODEX_STREAM_LOGS:-1}"
CODEX_STREAM_VIEW="${CODEX_STREAM_VIEW:-all}"
CODEX_STREAM_EXEC_KEEP_LINES="${CODEX_STREAM_EXEC_KEEP_LINES:-3}"
CODEX_DENY_DOTENV="${CODEX_DENY_DOTENV:-1}"
CODEX_WRAPPER_LANG="${CODEX_WRAPPER_LANG:-en_US.UTF-8}"
CODEX_RUST_BACKTRACE="${CODEX_RUST_BACKTRACE:-0}"

if [[ ! -f "$WRAPPER_HELPER_SCRIPT" ]]; then
  echo "wrapper helper not found: $WRAPPER_HELPER_SCRIPT" >&2
  exit 1
fi

WRAPPER_HELPER_CMD=(
  deno run
  --no-prompt
  --allow-read
  --allow-write
  --allow-env
  "$WRAPPER_HELPER_SCRIPT"
)

run_wrapper_helper() {
  "${WRAPPER_HELPER_CMD[@]}" "$@"
}

PAYLOAD="$(cat)"
if [[ -z "${PAYLOAD// }" ]]; then
  echo "empty stdin payload" >&2
  exit 2
fi

PROMPT="$(PAYLOAD="$PAYLOAD" CODEX_DENY_DOTENV="$CODEX_DENY_DOTENV" run_wrapper_helper build-prompt)"

TMP_OUTPUT="$(mktemp)"
TMP_DOTENV_SNAPSHOT="$(mktemp)"
TMP_STREAM_LOG="$(mktemp)"
TMP_PROMPT_FILE="$(mktemp)"
TMP_PROMPT_LOG="${CODEX_PROMPT_LOG_PATH:-/tmp/codex_wrapper_last_prompt.txt}"
trap 'rm -f "$TMP_OUTPUT" "$TMP_DOTENV_SNAPSHOT" "$TMP_STREAM_LOG" "$TMP_PROMPT_FILE"' EXIT

snapshot_dotenv_files() {
  TARGET_PROJECT_DIR="$TARGET_PROJECT_DIR" SNAPSHOT_PATH="$TMP_DOTENV_SNAPSHOT" run_wrapper_helper snapshot-dotenv
}

verify_dotenv_files_unchanged() {
  TARGET_PROJECT_DIR="$TARGET_PROJECT_DIR" SNAPSHOT_PATH="$TMP_DOTENV_SNAPSHOT" run_wrapper_helper verify-dotenv
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
  awk -v include_user="$include_user" '
function trim(s) {
  sub(/^[[:space:]]+/, "", s)
  sub(/[[:space:]]+$/, "", s)
  return s
}
BEGIN {
  mode = "default"
}
{
  line = $0
  plain = line
  gsub(/\033\[[0-9;]*[A-Za-z]/, "", plain)
  gsub(/\r/, "", plain)
  lowered = tolower(trim(plain))

  if (lowered == "thinking") {
    mode = "thinking"
    print line
    fflush()
    next
  }
  if (lowered == "codex") {
    mode = "codex"
    print line
    fflush()
    next
  }
  if (lowered == "user") {
    mode = "user"
    if (include_user == "1") {
      print line
      fflush()
    }
    next
  }
  if (index(lowered, "exec") == 1) {
    mode = "exec"
    next
  }

  if (mode == "exec") {
    next
  }
  if (mode == "user" && include_user != "1") {
    next
  }

  print line
  fflush()
}'
}

stream_all_compact_view() {
  local exec_keep_lines="${1:-3}"
  awk -v exec_keep_lines="$exec_keep_lines" '
function trim(s) {
  sub(/^[[:space:]]+/, "", s)
  sub(/[[:space:]]+$/, "", s)
  return s
}
function emit_line(raw_line) {
  print raw_line
  fflush()
}
function flush_exec_omitted() {
  if (mode == "exec" && exec_omitted_lines > 0) {
    print "[all_compact] exec output omitted lines=" exec_omitted_lines
    fflush()
  }
  exec_kept_lines = 0
  exec_omitted_lines = 0
}
BEGIN {
  mode = "default"
  in_codex_diff = 0
  codex_diff_lines = 0
  exec_kept_lines = 0
  exec_omitted_lines = 0
}
{
  line = $0
  plain = line
  gsub(/\033\[[0-9;]*[A-Za-z]/, "", plain)
  gsub(/\r/, "", plain)
  lowered = tolower(trim(plain))

  if (lowered == "thinking") {
    flush_exec_omitted()
    if (in_codex_diff) {
      print "[all_compact] codex diff omitted lines=" codex_diff_lines
      fflush()
      in_codex_diff = 0
      codex_diff_lines = 0
    }
    mode = "thinking"
    print line
    fflush()
    next
  }
  if (lowered == "codex") {
    flush_exec_omitted()
    if (in_codex_diff) {
      print "[all_compact] codex diff omitted lines=" codex_diff_lines
      fflush()
      in_codex_diff = 0
      codex_diff_lines = 0
    }
    mode = "codex"
    print line
    fflush()
    next
  }
  if (lowered == "user") {
    flush_exec_omitted()
    if (in_codex_diff) {
      print "[all_compact] codex diff omitted lines=" codex_diff_lines
      fflush()
      in_codex_diff = 0
      codex_diff_lines = 0
    }
    mode = "user"
    print line
    fflush()
    next
  }
  if (index(lowered, "exec") == 1) {
    flush_exec_omitted()
    if (in_codex_diff) {
      print "[all_compact] codex diff omitted lines=" codex_diff_lines
      fflush()
      in_codex_diff = 0
      codex_diff_lines = 0
    }
    mode = "exec"
    print line
    fflush()
    next
  }

  if (mode == "exec") {
    if (exec_kept_lines < exec_keep_lines) {
      emit_line(line)
      exec_kept_lines++
    } else {
      exec_omitted_lines++
    }
    next
  }

  if (mode == "codex") {
    if (!in_codex_diff && (index(lowered, "file update:") == 1 || index(lowered, "diff --git ") == 1)) {
      in_codex_diff = 1
      codex_diff_lines = 1
      next
    }
    if (in_codex_diff) {
      if (lowered == "tokens used" || index(lowered, "result:") == 1 || index(lowered, "summary:") == 1 || index(lowered, "changed_files:") == 1 || index(lowered, "checks:") == 1) {
        print "[all_compact] codex diff omitted lines=" codex_diff_lines
        fflush()
        in_codex_diff = 0
        codex_diff_lines = 0
      } else {
        codex_diff_lines++
        next
      }
    }
  }

  emit_line(line)
}
END {
  flush_exec_omitted()
  if (in_codex_diff) {
    print "[all_compact] codex diff omitted lines=" codex_diff_lines
    fflush()
  }
}'
}

run_codex_command() {
  "${CMD[@]}" < "$TMP_PROMPT_FILE"
}

run_codex_with_filtered_view() {
  local include_user="${1:-1}"
  : > "$TMP_STREAM_LOG"

  tail -n +1 -f "$TMP_STREAM_LOG" | stream_assistant_view "$include_user" 1>&2 &
  local viewer_pid=$!

  run_codex_command 2>&1 | tee -a "$TMP_STREAM_LOG" >/dev/null
  RUN_CODEX_EXIT_CODE=${PIPESTATUS[0]}

  kill "$viewer_pid" 2>/dev/null || true
  wait "$viewer_pid" 2>/dev/null || true
}

extract_result_block() {
  RESULT_PHASE="${RESULT_PHASE:-}" STREAM_PATH="$TMP_STREAM_LOG" OUTPUT_PATH="$TMP_OUTPUT" run_wrapper_helper extract-result
}

codex_exit_code=0
RUN_CODEX_EXIT_CODE=0
set +e
if [[ "$CODEX_STREAM_LOGS" == "1" ]]; then
  if [[ "$CODEX_STREAM_VIEW" == "assistant" ]]; then
    run_codex_with_filtered_view 1
    codex_exit_code=$RUN_CODEX_EXIT_CODE
  elif [[ "$CODEX_STREAM_VIEW" == "thinking" ]]; then
    run_codex_with_filtered_view 0
    codex_exit_code=$RUN_CODEX_EXIT_CODE
  elif [[ "$CODEX_STREAM_VIEW" == "all_compact" ]]; then
    run_codex_command 2>&1 | tee "$TMP_STREAM_LOG" | stream_all_compact_view "$CODEX_STREAM_EXEC_KEEP_LINES" 1>&2
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

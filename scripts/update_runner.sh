#!/usr/bin/env bash
# codex_agent/scripts/update_runner.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RUNNER_DIR="${RUNNER_DIR:-$PROJECT_ROOT/../agent_dock}"
RUNNER_VERSION="${RUNNER_VERSION:-0.0.0-dev}"
RUNNER_BUILD_SCRIPT="${RUNNER_BUILD_SCRIPT:-scripts/build_npm.ts}"

if [[ ! -d "$RUNNER_DIR" ]]; then
  echo "runner directory not found: $RUNNER_DIR" >&2
  exit 1
fi

if [[ ! -f "$RUNNER_DIR/$RUNNER_BUILD_SCRIPT" ]]; then
  echo "build script not found: $RUNNER_DIR/$RUNNER_BUILD_SCRIPT" >&2
  echo "runner update now uses build flow from task 2.9 (scripts/build_npm.ts)." >&2
  exit 1
fi

if ! command -v deno >/dev/null 2>&1; then
  echo "deno is required but not found in PATH." >&2
  exit 1
fi

(
  cd "$RUNNER_DIR"
  deno run -A "$RUNNER_BUILD_SCRIPT" "$RUNNER_VERSION"
)

if [[ ! -d "$RUNNER_DIR/npm" ]]; then
  echo "build completed, but npm artifacts are missing: $RUNNER_DIR/npm" >&2
  exit 1
fi

if [[ ! -x "$PROJECT_ROOT/node_modules/.bin/agent-dock" ]]; then
  cat <<EOF
build completed: $RUNNER_DIR/npm
one-time npm link setup is still required:
  cd "$RUNNER_DIR/npm" && npm link
  cd "$PROJECT_ROOT" && npm link "$RUNNER_DIR/npm"
EOF
  exit 0
fi

echo "build completed: $RUNNER_DIR/npm"
echo "verify: $PROJECT_ROOT/node_modules/.bin/agent-dock --help"

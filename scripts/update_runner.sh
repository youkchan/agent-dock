# codex_agent/scripts/update_runner.sh
set -euo pipefail

RUNNER_DIR="${RUNNER_DIR:-../agent_dock}"

# runner 側で wheel を作る
cd "$RUNNER_DIR"
source .venv/bin/activate
rm -rf dist build *.egg-info
python -m build

WHEEL="$(ls -1 dist/*.whl | tail -n 1)"

# 編集側 venv に再インストール
cd - >/dev/null
source .venv/bin/activate
python -m pip install --force-reinstall "$RUNNER_DIR/$WHEEL"

echo "installed: $WHEEL"


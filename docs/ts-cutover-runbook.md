# TypeScript runner 切替ランブック

## 目的
TypeScript 実装の更新を fail-closed で段階適用し、回帰時に直前安定版へ即時ロールバックできる状態を維持する。

## 適用範囲
- 実行コマンド: `./node_modules/.bin/agent-dock run`
- 対象変更: `add-typescript-runtime-rewrite-plan`

## 0. 実行前チェック

```bash
set -euo pipefail
command -v deno >/dev/null
command -v jq >/dev/null
test -x ./node_modules/.bin/agent-dock
```

## 0.5 runner 更新（build 主体）

```bash
set -euo pipefail
./scripts/update_runner.sh
./node_modules/.bin/agent-dock --help >/dev/null
```

## 1. 切替開始ゲート
次のコマンドがすべて成功した場合のみ切替フェーズへ進む。

```bash
set -euo pipefail
deno task check
deno task test
deno test src/cli/main_test.ts src/infrastructure/state/store_test.ts src/infrastructure/openspec/compiler_test.ts --allow-read --allow-write --allow-run --allow-env
```

## 2. runner 切替順序

### Phase 0: Baseline 固定
同一入力で比較するため、まず現行 stable 版の結果を保存する。

```bash
set -euo pipefail
export CUTOVER_CONFIG="examples/sample_tasks.json"
export CUTOVER_ROOT="/tmp/codex_agent_cutover"
rm -rf "$CUTOVER_ROOT"
mkdir -p "$CUTOVER_ROOT"

./node_modules/.bin/agent-dock run \
  --config "$CUTOVER_CONFIG" \
  --state-dir "$CUTOVER_ROOT/baseline" \
  --teammate-adapter template \
  --provider mock \
  --max-rounds 30 | tee "$CUTOVER_ROOT/baseline.log"

tail -n 1 "$CUTOVER_ROOT/baseline.log" \
  | jq -S '{stop_reason,summary,tasks_total,provider_calls,provider,human_approval,persona_metrics}' \
  > "$CUTOVER_ROOT/baseline.result.json"
```

### Phase 1: Canary 切替
低リスク config で stable 版と candidate 版を 3 回比較する。

```bash
set -euo pipefail
export CUTOVER_CONFIG="examples/sample_tasks.json"
export CUTOVER_ROOT="/tmp/codex_agent_cutover"
mkdir -p "$CUTOVER_ROOT"

for i in 1 2 3; do
  ./node_modules/.bin/agent-dock run \
    --config "$CUTOVER_CONFIG" \
    --state-dir "$CUTOVER_ROOT/stable-canary-$i" \
    --teammate-adapter template \
    --provider mock \
    --max-rounds 30 | tee "$CUTOVER_ROOT/stable-canary-$i.log"

  ./node_modules/.bin/agent-dock run \
    --config "$CUTOVER_CONFIG" \
    --state-dir "$CUTOVER_ROOT/candidate-canary-$i" \
    --teammate-adapter template \
    --provider mock \
    --max-rounds 30 | tee "$CUTOVER_ROOT/candidate-canary-$i.log"

tail -n 1 "$CUTOVER_ROOT/stable-canary-$i.log" \
    | jq -S '{stop_reason,summary,tasks_total,provider_calls,provider,human_approval,persona_metrics}' \
    > "$CUTOVER_ROOT/stable-canary-$i.result.json"

  tail -n 1 "$CUTOVER_ROOT/candidate-canary-$i.log" \
    | jq -S '{stop_reason,summary,tasks_total,provider_calls,provider,human_approval,persona_metrics}' \
    > "$CUTOVER_ROOT/candidate-canary-$i.result.json"

  diff -u "$CUTOVER_ROOT/stable-canary-$i.result.json" "$CUTOVER_ROOT/candidate-canary-$i.result.json"
done
```

### Phase 2: 範囲拡大
対象 config を増やし、各 config で 3 run 一致を確認する。実行形式は Phase 1 と同じ。

### Phase 3: Primary 切替
運用ジョブの実行コマンドを candidate 版へ切替する。

```bash
./node_modules/.bin/agent-dock run --config <task_config> --state-dir <state_dir>
```

## 3. fallback 条件
以下のいずれかを検出した時点で candidate 実行を停止し、4 章を実施する。

1. 1 章のゲートで 1 つでも失敗。
2. `run` 必須開始ログ（`[run] run_mode=...`, `[run] progress_log_ref=...`）が欠落。
3. 最終 JSON の互換契約フィールドに baseline との差分。
4. candidate 版の非ゼロ終了、または異常 `stop_reason`。

## 4. ロールバック手順

```bash
set -euo pipefail
export CUTOVER_CONFIG="examples/sample_tasks.json"
export CUTOVER_ROOT="/tmp/codex_agent_cutover"
mkdir -p "$CUTOVER_ROOT"

# 1) candidate 実行を停止
# 2) stable 実行コマンドに差し戻し
./node_modules/.bin/agent-dock run \
  --config "$CUTOVER_CONFIG" \
  --state-dir "$CUTOVER_ROOT/rollback-smoke" \
  --teammate-adapter template \
  --provider mock \
  --max-rounds 30 | tee "$CUTOVER_ROOT/rollback-smoke.log"

# 3) smoke run の正常終了確認
tail -n 1 "$CUTOVER_ROOT/rollback-smoke.log" | jq -e '.stop_reason == "all_tasks_completed"' >/dev/null
```

## 5. 切替完了判定
次をすべて満たす場合のみ切替完了と判定する。

1. 1 章の切替開始ゲートを継続して満たす。
2. Phase 1/2/3 で fallback 条件が 0 件。
3. 主系で連続 5 run 成功。

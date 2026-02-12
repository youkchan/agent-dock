# TypeScript runner 切替ランブック

## 目的
TypeScript 実装への切替を fail-closed で段階実施し、回帰時に即時で Python runner へ戻せる状態を維持する。

## 適用範囲
- Python 参照実装: `python -m team_orchestrator.cli run`
- TypeScript 実装: `./node_modules/.bin/agent-dock run`
- 対象変更: `add-typescript-runtime-rewrite-plan`

## 0. 実行前チェック
切替判定を実行する端末で、次を先に確認する。

```bash
set -euo pipefail
command -v python >/dev/null
command -v jq >/dev/null
test -x ./node_modules/.bin/agent-dock
```

## 0.5 runner 更新（build 主体）
runner 側の変更反映は再 install ではなく、`scripts/build_npm.ts` の再生成で行う。

```bash
set -euo pipefail
./scripts/update_runner.sh
./node_modules/.bin/agent-dock --help >/dev/null
```

初回のみ `npm link` が必要な場合は、`./scripts/update_runner.sh` の出力に従ってリンクを作成する。

## 1. 切替開始ゲート（この結果だけで切替可否を判定）
次の 3 コマンドがすべて成功した場合のみ、TS 切替フェーズへ進む。

```bash
set -euo pipefail
python -m unittest tests.parity.test_parity -v
python -m unittest tests.test_cli tests.test_state_store tests.test_openspec_compiler -v
python -m unittest discover -s tests -v
```

判定ルール:
1. いずれか 1 コマンドでも失敗した場合は切替禁止（Python runner 維持）。
2. `docs/ts-parity-gate.md` の Gate-A/B/C はこの実行結果で `PASS` とみなす。

## 2. runner 切替順序

### Phase 0: Baseline 固定（Python）
同一入力で比較するため、まず Python 基準値を保存する。

```bash
set -euo pipefail
export CUTOVER_CONFIG="examples/sample_tasks.json"
export CUTOVER_ROOT="/tmp/codex_agent_cutover"
rm -rf "$CUTOVER_ROOT"
mkdir -p "$CUTOVER_ROOT"

python -m team_orchestrator.cli run \
  --config "$CUTOVER_CONFIG" \
  --state-dir "$CUTOVER_ROOT/py-baseline" \
  --teammate-adapter template \
  --provider mock \
  --max-rounds 30 | tee "$CUTOVER_ROOT/py-baseline.log"

tail -n 1 "$CUTOVER_ROOT/py-baseline.log" \
  | jq -S '{stop_reason,summary,tasks_total,provider_calls,provider,human_approval,persona_metrics}' \
  > "$CUTOVER_ROOT/py-baseline.result.json"
```

### Phase 1: Canary 切替（TS を限定適用）
1 件の低リスク config で、Python と TS を同条件で 3 回比較する。

```bash
set -euo pipefail
export CUTOVER_CONFIG="examples/sample_tasks.json"
export CUTOVER_ROOT="/tmp/codex_agent_cutover"
mkdir -p "$CUTOVER_ROOT"

for i in 1 2 3; do
  python -m team_orchestrator.cli run \
    --config "$CUTOVER_CONFIG" \
    --state-dir "$CUTOVER_ROOT/py-canary-$i" \
    --teammate-adapter template \
    --provider mock \
    --max-rounds 30 | tee "$CUTOVER_ROOT/py-canary-$i.log"

  ./node_modules/.bin/agent-dock run \
    --config "$CUTOVER_CONFIG" \
    --state-dir "$CUTOVER_ROOT/ts-canary-$i" \
    --teammate-adapter template \
    --provider mock \
    --max-rounds 30 | tee "$CUTOVER_ROOT/ts-canary-$i.log"

  tail -n 1 "$CUTOVER_ROOT/py-canary-$i.log" \
    | jq -S '{stop_reason,summary,tasks_total,provider_calls,provider,human_approval,persona_metrics}' \
    > "$CUTOVER_ROOT/py-canary-$i.result.json"

  tail -n 1 "$CUTOVER_ROOT/ts-canary-$i.log" \
    | jq -S '{stop_reason,summary,tasks_total,provider_calls,provider,human_approval,persona_metrics}' \
    > "$CUTOVER_ROOT/ts-canary-$i.result.json"

  diff -u "$CUTOVER_ROOT/py-canary-$i.result.json" "$CUTOVER_ROOT/ts-canary-$i.result.json"
done
```

判定ルール:
1. 3 回連続で `diff` 差分が 0 件なら Phase 2 へ進む。
2. 1 回でも失敗した場合は即時ロールバック（本書 4 章）。

### Phase 2: 範囲拡大（TS 対象を増やす）
対象 config を増やし、各 config で 3 run の一致を確認する。  
実行形式は Phase 1 と同じで、`CUTOVER_CONFIG` を対象ごとに差し替える。

### Phase 3: Primary 切替（TS を主系化）
運用ジョブの実行コマンドを次へ切替する。

```bash
./node_modules/.bin/agent-dock run --config <task_config> --state-dir <state_dir>
```

Python runner は待機系として残し、同一入力で即時再実行できる状態を維持する。

## 3. fallback 条件（ロールバック判定）
以下のいずれかを検出した時点で TS 実行を停止し、4 章を実施する。

1. 1 章の切替開始ゲートで 1 つでも失敗。
2. `run` 必須開始ログ（`[run] run_mode=...`, `[run] progress_log_ref=...`）が欠落。
3. `tail -n 1 ... | jq ...` で抽出した互換契約フィールドに Python 基準との差分。
4. `tests.parity.test_parity` 失敗（state/compile/CLI 契約違反を含む）。
5. TS runner の非ゼロ終了、または `stop_reason` が異常終了系。
6. TS 結果の `summary.blocked` または `summary.needs_approval` が Python 基準より増加。

## 4. ロールバック手順（TS -> Python）
```bash
set -euo pipefail
export CUTOVER_CONFIG="examples/sample_tasks.json"
export CUTOVER_ROOT="/tmp/codex_agent_cutover"
mkdir -p "$CUTOVER_ROOT"

# 1) TS 実行を停止（運用ジョブのコマンドを差し戻す）
# 2) Python runner に戻す
python -m team_orchestrator.cli run \
  --config "$CUTOVER_CONFIG" \
  --state-dir "$CUTOVER_ROOT/rollback-smoke" \
  --teammate-adapter template \
  --provider mock \
  --max-rounds 30 | tee "$CUTOVER_ROOT/rollback-smoke.log"

# 3) smoke run の正常終了確認
tail -n 1 "$CUTOVER_ROOT/rollback-smoke.log" | jq -e '.stop_reason == "all_tasks_completed"' >/dev/null
```

4. 差分原因を記録し、1 章のゲート再合格まで TS 再切替を禁止する。

## 5. 切替完了判定
次をすべて満たす場合のみ「TS 切替完了」と判定する。

1. 1 章の切替開始ゲートを継続して満たす。
2. Phase 1/2/3 で fallback 条件が 0 件。
3. TS 主系で連続 5 run 成功。
4. 4 章のロールバック手順を即時実行できる（Python 待機系が有効）。

1 つでも未達の場合は移行完了扱いにしない（fail-closed）。

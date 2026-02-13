# TypeScript parity gate 定義

## 目的
TypeScript 実装の出力を golden fixture と比較し、仕様互換を機械的に判定する。

## 1. Golden Fixture 比較対象

### 1.1 compile parity（必須）
- 入力 fixture:
  - `openspec/changes/<change-id>/tasks.md`
  - `task_configs/overrides/<change-id>.yaml`（存在時）
- 比較対象（`compile-openspec` 出力 JSON）:
  - `teammates`
  - `tasks[].id`
  - `tasks[].title`
  - `tasks[].description`
  - `tasks[].target_paths`
  - `tasks[].depends_on`
  - `tasks[].requires_plan`
  - `tasks[].persona_policy`
  - `persona_defaults`
  - `personas`
  - `meta.verification_items`

### 1.2 state parity（必須）
- 入力 fixture:
  - 同一 task config で実行した state snapshot 群
  - 比較ポイント: bootstrap 後、claim 後、plan 提出後、approval 後、完了後、resume 復旧後
- 比較対象（`state.json`）:
  - `tasks.<id>.title`
  - `tasks.<id>.description`
  - `tasks.<id>.status`
  - `tasks.<id>.owner`
  - `tasks.<id>.planner`
  - `tasks.<id>.requires_plan`
  - `tasks.<id>.plan_status`
  - `tasks.<id>.depends_on`
  - `tasks.<id>.target_paths`
  - `tasks.<id>.persona_policy`
  - `tasks.<id>.current_phase_index`
  - `tasks.<id>.progress_log[].source`
  - `tasks.<id>.progress_log[].text`
  - `messages[]`
  - `meta.sequence`
  - `meta.progress_counter`

### 1.3 CLI parity（必須）
- 比較対象コマンド:
  - `run`
  - `compile-openspec`
  - `print-openspec-template`
  - エラー系（例: `--config` と `--openspec-change` の同時指定）
- 比較対象:
  - `run` 開始時ログ:
    - `[run] run_mode=<new-run|resume-run>`
    - `[run] progress_log_ref=<state.json path>::tasks.<task_id>.progress_log`
    - （該当時）`[run] resume_requeued_in_progress=<task_id_csv>`
  - `run` 最終 JSON:
    - `stop_reason`
    - `elapsed_seconds`（存在チェックのみ）
    - `summary`
    - `tasks_total`
    - `provider_calls`
    - `provider`
    - `human_approval`
    - `persona_metrics`

## 2. 正規化ルール
- JSON は UTF-8 decode 後にキー昇順で比較。
- 改行コードは LF に統一。
- `tasks[]` は `id` 昇順、`messages[]` は `seq` 昇順で比較。
- `depends_on` / `target_paths` は trim + 重複除去後に比較。
- 揮発値（timestamp や実行時間）は除外。

## 3. Acceptance Gate
- Gate-A（compile parity）: 全 fixture 一致。
- Gate-B（state parity）: 全比較ポイント一致。
- Gate-C（CLI parity）: 全コマンド比較一致。
- 合格条件: Gate-A/B/C すべて PASS、`FAIL/ERROR/SKIP=0`。

## 4. tests/parity 配下の標準構成

```text
tests/parity/
  fixtures/
    compile/
    state/
    cli/
```

## 5. 必須実行チェック
- `deno task test`
- `deno test src --allow-read --allow-write --allow-run --allow-env`

## 6. parity テスト実装
- state シナリオ生成:
  - `tests/parity/scenarios/state_scenario_ts.ts`
- fixture:
  - `tests/parity/fixtures/compile/basic/*`
  - `tests/parity/fixtures/state/basic/*`
  - `tests/parity/fixtures/cli/basic/*`

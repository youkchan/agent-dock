# TypeScript ランタイム契約

## 目的
TypeScript 実装の外部契約（CLI / state / compile）を固定し、実装変更時の互換性崩れを防ぐ。

## 適用範囲
- CLI: `src/cli/main.ts`
- State 永続化: `src/infrastructure/state/store.ts`, `src/domain/task.ts`
- OpenSpec compile: `src/infrastructure/openspec/compiler.ts` と `compile-openspec` サブコマンド

## 1. CLI 契約

### 1.1 エントリポイントとサブコマンド
- `agent-dock` は次のサブコマンドを提供すること（MUST）。
  - `run`
  - `compile-openspec`
  - `print-openspec-template`

### 1.2 `run` の入力契約
- `--config` と `--openspec-change` は同時指定不可（MUST）。
- `--config` 未指定時の既定値は `examples/sample_tasks.json`（MUST）。
- 各 task は `target_paths` を必須とし、欠落時は失敗（MUST）。
- `--resume` 指定時は既存 state と task 定義の整合性（`id`/`requires_plan`/`depends_on`/`target_paths`）を検証（MUST）。

### 1.3 `run` の出力契約
- 実行開始時に次を標準出力へ出すこと（MUST）。
  - `[run] run_mode=new-run|resume-run`
  - `[run] progress_log_ref=<state.json>::tasks.<task_id>.progress_log`
- `resume-run` かつ `--resume-requeue-in-progress` 有効時、回復対象があれば次を出すこと（MUST）。
  - `[run] resume_requeued_in_progress=<task_id_csv>`
- 実行終了時、最終結果を JSON で標準出力すること（MUST）。
  - `stop_reason`, `elapsed_seconds`, `summary`, `tasks_total`, `provider_calls`, `provider`, `human_approval`, `persona_metrics`

### 1.4 `compile-openspec` / `print-openspec-template` 出力契約
- `compile-openspec` は compile 済み JSON を書き出し、標準出力へ出力先パスを 1 行で出すこと（MUST）。
- `print-openspec-template` はテンプレート本文のみを標準出力へ出すこと（MUST）。
- compile 失敗時は `openspec compile error: <detail>` 形式で終了すること（MUST）。

## 2. State 契約

### 2.1 永続化ファイル
- state は `<state-dir>/state.json` に保存（MUST）。
- lock は `<state-dir>/state.lock` を使用（MUST）。

### 2.2 ルートスキーマ
`state.json` ルートは次を持つこと（MUST）。
- `version`
- `tasks`（`task_id -> task_object` の map）
- `messages`（配列）
- `meta`（`sequence`, `progress_counter`, `last_progress_at`）

### 2.3 task オブジェクト必須キー
- `id`, `title`, `description`
- `target_paths`, `depends_on`
- `owner`, `planner`
- `status`, `requires_plan`, `plan_status`
- `plan_text`, `plan_feedback`
- `result_summary`, `block_reason`
- `progress_log`
- `created_at`, `updated_at`, `completed_at`
- `persona_policy`, `current_phase_index`

### 2.4 状態遷移ルール
- `status` は `pending|in_progress|blocked|needs_approval|completed` を維持（MUST）。
- `plan_status` は `not_required|pending|drafting|submitted|approved|rejected|revision_requested` を維持（MUST）。
- `target_paths` 交差は衝突扱いで並行実行を抑止（MUST）。
- `progress_log` は追記型、既定上限 200 件ローテーション（MUST）。

## 3. OpenSpec Compile 契約

### 3.1 入力契約
- 入力は `openspec/changes/<change-id>/tasks.md`（MUST）。
- `tasks.md` 不在、task 未検出、不正構文時は fail-closed で失敗（MUST）。
- override は `task_configs/overrides/<change-id>.yaml` を任意適用（MUST）。

### 3.2 出力契約
compiled payload は次を含むこと（MUST）。
- `teammates`（非空配列）
- `tasks`（非空配列、`id` 昇順）
- `meta.source_change_id`
- `meta.verification_items`

task 最低限キー（MUST）。
- `id`, `title`, `description`, `target_paths`, `depends_on`, `requires_plan`

## 4. 必須チェック
- `deno task check`
- `deno task test`
- `deno test src/cli/main_test.ts src/infrastructure/state/store_test.ts src/infrastructure/openspec/compiler_test.ts --allow-read --allow-write --allow-run --allow-env`

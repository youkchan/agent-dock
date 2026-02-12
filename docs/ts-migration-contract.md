# TypeScript移行 互換契約（Python現行固定）

## 目的
TypeScript 実装へ置き換える際に、現行 Python 実装の外部契約（CLI / state / compile）を壊さないための固定ルールを定義する。  
本書の MUST を破る変更は、移行完了まで禁止とする。

## 適用範囲
- CLI: `team_orchestrator/cli.py`
- State 永続化: `team_orchestrator/state_store.py`, `team_orchestrator/models.py`
- OpenSpec compile: `team_orchestrator/openspec_compiler.py` と `compile-openspec` サブコマンド

## 1. CLI 互換契約

### 1.1 エントリポイントとサブコマンド
- `python -m team_orchestrator.cli` は `run` と同義であること（MUST）。
- `python -m team_orchestrator.cli run` を維持すること（MUST）。
- `python -m team_orchestrator.cli compile-openspec` を維持すること（MUST）。
- `python -m team_orchestrator.cli print-openspec-template` を維持すること（MUST）。

### 1.2 `run` の入力契約
- `--config` と `--openspec-change` は同時指定不可であること（MUST）。
- `--config` 未指定時の既定値は `examples/sample_tasks.json`（MUST）。
- 各 task は `target_paths` を必須とし、欠落時は失敗すること（MUST）。
- `--resume` 指定時は既存 state と task 定義の整合性（`id`/`requires_plan`/`depends_on`/`target_paths`）を検証すること（MUST）。

### 1.3 `run` の出力契約
- 実行開始時に以下 2 行を標準出力へ出すこと（MUST）。
  - `[run] run_mode=new-run|resume-run`
  - `[run] progress_log_ref=<state.json>::tasks.<task_id>.progress_log`
- `resume-run` かつ `--resume-requeue-in-progress` 有効時、回復対象があれば次を出すこと（MUST）。
  - `[run] resume_requeued_in_progress=<task_id_csv>`
- 実行終了時、最終結果を JSON で標準出力すること（MUST）。少なくとも次のキーを含むこと（MUST）。
  - `stop_reason`
  - `elapsed_seconds`
  - `summary`
  - `tasks_total`
  - `provider_calls`
  - `provider`
  - `human_approval`
  - `persona_metrics`

### 1.4 `compile-openspec` / `print-openspec-template` の出力契約
- `compile-openspec` は compile 済み JSON を書き出し、標準出力へ出力先パス文字列を 1 行出すこと（MUST）。
- `print-openspec-template` はテンプレート本文のみを標準出力へ出すこと（MUST）。
- `OpenSpecCompileError` は `openspec compile error: <detail>` 形式で終了すること（MUST）。

## 2. State 互換契約

### 2.1 永続化ファイル
- state は `<state-dir>/state.json` に保存されること（MUST）。
- lock は `<state-dir>/state.lock` を使うこと（MUST）。
- state JSON は `indent=2` / `sort_keys=true` / `ensure_ascii=true` 相当で安定出力されること（MUST）。

### 2.2 ルートスキーマ
`state.json` ルートは次を持つこと（MUST）。
- `version`（現行値: `2`）
- `tasks`（`task_id -> task_object` の map）
- `messages`（配列）
- `meta`（`sequence`, `progress_counter`, `last_progress_at`）

### 2.3 task オブジェクトの必須キー
各 task は次のキーを保持すること（MUST）。
- `id`, `title`, `description`
- `target_paths`, `depends_on`
- `owner`, `planner`
- `status`, `requires_plan`, `plan_status`
- `plan_text`, `plan_feedback`
- `result_summary`, `block_reason`
- `progress_log`
- `created_at`, `updated_at`, `completed_at`
- `persona_policy`, `current_phase_index`

### 2.4 状態遷移と運用ルール
- `status` は `pending|in_progress|blocked|needs_approval|completed` を維持すること（MUST）。
- `plan_status` は `not_required|pending|drafting|submitted|approved|rejected|revision_requested` を維持すること（MUST）。
- `claim_execution_task` は依存解決済み・承認済み・owner 未設定・衝突なしの task のみ取得すること（MUST）。
- `target_paths` の交差は衝突扱いとし、並行実行を抑止すること（MUST）。
- `progress_log` は追記型で、既定上限 200 件ローテーションを維持すること（MUST）。
- `--resume` 復旧で `in_progress` を `pending` へ戻す際、progress log に system エントリを残すこと（MUST）。
- mailbox は単調増加 `seq` を持ち、`get_inbox(receiver, after_seq)` で差分取得できること（MUST）。

## 3. OpenSpec Compile 互換契約

### 3.1 入力契約
- 入力は `openspec/changes/<change-id>/tasks.md`（MUST）。
- `tasks.md` 不在、task 未検出、不正構文時は fail-closed で失敗すること（MUST）。
- override は `task_configs/overrides/<change-id>.yaml` を任意適用すること（MUST）。
- override で未知キーがあれば失敗すること（MUST）。

### 3.2 出力契約（compiled JSON）
compiled payload は次を含むこと（MUST）。
- `teammates`（非空配列）
- `tasks`（非空配列、`id` 昇順ソート）
- `meta.source_change_id`
- `meta.verification_items`

task の最低限キー（MUST）。
- `id`, `title`, `description`
- `target_paths`, `depends_on`, `requires_plan`

追加契約（MUST）。
- `target_paths` 未指定 task は `["*"]` を補完し、`meta.auto_target_path_tasks` に記録する。
- 依存先 unknown、循環依存、型不整合は失敗する。
- 各 task は `persona_policy.phase_overrides`（フェーズ担当）必須。欠落は失敗する。
- persona 指示を解決した場合、`meta.persona_resolution` を出力する。

### 3.3 検証項目抽出契約
- `検証項目` / `Verification` / `Validation` / `Checklist` / `Checks` / `Testing` / `QA` 系見出し配下のチェックボックスを `meta.verification_items` に抽出すること（MUST）。
- 各要素は `text`, `checked`, `line` を持つこと（MUST）。

## 4. 禁止変更点（TS移行完了まで）
- CLI サブコマンド名・主要フラグ名を変更しない。
- `run` 先頭の `[run] ...` 表示キー（`run_mode`, `progress_log_ref`, `resume_requeued_in_progress`）を削除・改名しない。
- `state.json` のルート/タスクキー名を削除・改名しない。
- `tasks` を map 以外へ変更しない（`task_id -> task_object` を維持）。
- `status` / `plan_status` の列挙値を変更しない。
- `target_paths` 未指定時の `["*"]` 補完を削除しない。
- compile の fail-closed 方針（不正入力はエラー停止）を緩和しない。
- `compile-openspec` の出力パス 1 行出力仕様を変更しない。

## 5. 互換確認（移行時の最低チェック）
- `python -m unittest discover -s tests -v`
- `python -m unittest tests.test_cli tests.test_state_store tests.test_openspec_compiler -v`

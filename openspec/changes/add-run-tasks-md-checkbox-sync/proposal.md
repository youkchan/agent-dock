# Change: run 完了時に tasks.md チェックボックスを自動同期する

## Why
- 現状は `tasks.md -> task_config.json -> state.json` の一方向更新のみで、完了状態が `tasks.md` に反映されない。
- そのため進捗確認には毎回 `state.json` の参照が必要で、`tasks.md` を手動更新しない限り OpenSpec 成果物と実行結果が乖離する。
- `tasks.md` を常に最新化することで、ファイル閲覧だけで進捗を把握でき、Git 履歴にも実行結果を残せるようにする。

## What Changes
- `run` 完了時に `state.json` の completed タスク ID を `tasks.md` のチェックボックスへ反映する処理を追加する。
- `src/infrastructure/openspec/compiler.ts` に `updateTasksMarkdownCheckboxes` を追加し、`- [ ] <task_id>` / `- [x] <task_id>` のチェック状態のみ更新する（`task_id` 以降の行末タイトルや説明文は保持する）。
- `src/cli/main.ts` で `store.listTasks()` から完了タスク ID を収集し、同期関数へ渡す。
- 同期結果を `[run] synced_tasks_md=<count>` として出力する。
- 同期は `--openspec-change` 経由実行時のみ有効化し、`--config` 経由実行時は `tasks.md` の場所が特定できないため対象外とする。
- 同一状態での再実行時に追加差分を生まない冪等動作を保証する。

## Impact
- Affected specs: `add-run-tasks-md-checkbox-sync`
- Affected code:
  - `src/infrastructure/openspec/compiler.ts`
  - `src/cli/main.ts`
  - `src/infrastructure/openspec/compiler_test.ts`
  - `src/cli/main_test.ts`
- ユーザー影響:
  - `run --openspec-change` 実行後に `tasks.md` が自動更新され、進捗確認の手間が減る。
  - `--config` 実行時の挙動は従来どおり（`tasks.md` 同期なし）。

## Non-Goals
- `--config` 実行時に `tasks.md` の場所を推測して同期すること。
- チェックボックス行以外の `tasks.md` 内容を編集すること。
- `state.json` 以外の進捗ソースを新設すること。

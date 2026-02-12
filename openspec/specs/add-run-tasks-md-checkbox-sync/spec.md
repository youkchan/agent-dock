# add-run-tasks-md-checkbox-sync Specification

## Purpose
TBD - created by archiving change add-run-tasks-md-checkbox-sync. Update Purpose after archive.
## Requirements
### Requirement: run は completed タスクを tasks.md へ同期すること
システムは `--openspec-change` 経由の run 完了時に、`state` 上で completed の task_id を `tasks.md` チェックボックスへ反映しなければならない（SHALL）。

#### Scenario: completed task_id がチェック済みとして反映される
- **WHEN** run が `--openspec-change <change-id>` で完了し、completed task_id が存在する
- **THEN** `tasks.md` の `- [ ] <task_id>` 行は `- [x] <task_id>` へ更新される
- **AND** completed でない task_id 行は更新されない
- **AND** `task_id` 以降の行末タイトルや説明文は変更されない

#### Scenario: 同一入力で再実行しても追加差分がない
- **WHEN** completed task_id が変わらない状態で run を再実行する
- **THEN** 2回目以降の `tasks.md` 変更件数は 0 である

### Requirement: run は `--config` 実行時に tasks.md 同期を行わないこと
システムは `--config` 直接指定で run した場合、`tasks.md` の場所を推測せず同期処理を実施してはならない（MUST NOT）。

#### Scenario: --config 実行は同期対象外
- **WHEN** run が `--config <path>` で実行される
- **THEN** `tasks.md` 同期は実行されない
- **AND** 既存の run 実行フローは維持される

### Requirement: run は tasks.md 同期結果を出力すること
システムは `tasks.md` 同期処理を実施した場合、同期件数を `[run] synced_tasks_md=<count>` 形式で出力しなければならない（SHALL）。

#### Scenario: 同期件数がログに表示される
- **WHEN** `--openspec-change` 経由 run の終了処理が完了する
- **THEN** 同期件数を含む1行ログが標準出力へ表示される


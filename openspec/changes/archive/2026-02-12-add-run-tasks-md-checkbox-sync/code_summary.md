# code_summary.md

`openspec/changes/add-run-tasks-md-checkbox-sync/tasks.md` の task と code unit の対応表。

## task_id: 1.1

### code_unit_1
- file: src/infrastructure/openspec/compiler.ts
- service: openspec-compiler
- function: updateTasksMarkdownCheckboxes
- purpose: completed task_id と一致する task 行だけを `- [ ]` / `- [x]` 形式のまま `- [x]` に更新する。
- input: `tasks.md` path, completed task_id list
- output: 更新件数（同期で `- [ ] -> - [x]` になった件数）
- error: `tasks.md` 読み書き失敗時はエラーを返す
- test: `src/infrastructure/openspec/compiler_test.ts` で completed のみ更新・未完了維持・冪等を検証

## task_id: 1.2

### code_unit_1
- file: src/cli/main.ts
- service: cli-run
- function: runCommand completion hook
- purpose: run 終了時に `store.listTasks()` から completed task_id を収集し、`--openspec-change` 実行時のみ同期処理を実行する。
- input: run options, `StateStore` task list
- output: completed task_id に基づく `tasks.md` 同期実行
- error: 同期失敗時は run のエラーとして扱う
- test: `src/cli/main_test.ts` で `--openspec-change` 時のみ同期されることを検証

## task_id: 1.3

### code_unit_1
- file: src/cli/main.ts
- service: cli-run
- function: runCommand completion hook (sync logging)
- purpose: 同期を実施した run で `[run] synced_tasks_md=<count>` を標準出力に1行出力する。
- input: 同期処理の更新件数
- output: 件数ログ（同期対象外の `--config` 実行では非出力）
- error: ログ生成失敗時は run エラーとして扱う
- test: `src/cli/main_test.ts` でログ有無と件数を検証

## task_id: 1.4

### code_unit_1
- file: src/infrastructure/openspec/compiler_test.ts
- service: openspec-compiler-test
- function: updateTasksMarkdownCheckboxes tests
- purpose: compiler 側同期ロジックの更新対象/非対象/冪等性を固定して回帰を防ぐ。
- input: completed を含む `tasks.md` fixture
- output: 更新後の `tasks.md` 内容と更新件数アサーション
- error: 未完了行の誤更新、再実行時差分残りを検出して失敗
- test: completed 行更新・未完了維持・再実行差分ゼロの3観点

## task_id: 1.5

### code_unit_1
- file: src/cli/main_test.ts
- service: cli-test
- function: run command tasks.md sync branch tests
- purpose: run 側での同期呼び出し分岐（`--openspec-change` / `--config`）とログ出力を固定する。
- input: run command fixtures（change 実行・config 実行）
- output: 同期実行有無と `[run] synced_tasks_md=<count>` の一致
- error: `--config` で同期された場合、または `--openspec-change` で未同期/未出力の場合に失敗
- test: 分岐2ケース + ログ件数アサーション

## task_id: 1.6

### code_unit_1
- file: src/infrastructure/openspec/compiler_test.ts
- service: acceptance-test
- function: compiler sync acceptance checks
- purpose: compiler 側の同期ロジックが受け入れ条件を満たすことを実行確認する。
- input: `deno test` 対象ファイル
- output: pass/fail
- error: 同期更新条件・冪等性条件の不一致で失敗
- test: `deno test --allow-read --allow-write --allow-env src/infrastructure/openspec/compiler_test.ts`

### code_unit_2
- file: src/cli/main_test.ts
- service: acceptance-test
- function: run sync acceptance checks
- purpose: run 側の同期分岐とログ要件を実行確認する。
- input: `deno test` 対象ファイル
- output: pass/fail
- error: `--openspec-change` 同期漏れや `--config` 同期誤実行を検出して失敗
- test: `deno test --allow-read --allow-write --allow-env src/cli/main_test.ts`

# Design

## Context
- この変更は `src/cli/main.ts` と `src/infrastructure/openspec/compiler.ts` をまたぐ実行経路の振る舞いを変更するため、設計判断を先に固定する必要がある。
- 現状は `tasks.md -> task_config.json -> state.json` の一方向更新で、完了情報が `tasks.md` に戻らない。
- 目的は run 完了時に `state.json` の completed を `tasks.md` へ反映し、成果物と実行結果の乖離をなくすこと。

## Goals / Non-Goals
- Goals:
  - `--openspec-change` 実行時に completed task_id を `tasks.md` チェックボックスへ同期する。
  - 同期処理を冪等にし、同一入力で追加差分を発生させない。
  - 同期件数を `[run] synced_tasks_md=<count>` として可視化する。
- Non-Goals:
  - `--config` 実行時の `tasks.md` 位置推定。
  - チェックボックス以外の Markdown 内容編集。
  - `state.json` のデータモデル変更。

## Decisions
- Decision: 同期対象は `--openspec-change` 実行時に限定する。
  - Reason: change-id から `tasks.md` の場所を決定でき、誤更新リスクを抑えられるため。
  - Alternative: `--config` でも設定から探索する。
  - Why not: path の確定根拠が弱く、誤った `tasks.md` 更新を招く。
- Decision: `tasks.md` は `- [ ]` / `- [x]` task 行のみを書き換える。
  - Reason: 文書構造の破壊を避け、差分を最小化するため。
  - Alternative: Markdown 全体を AST 解析して再出力する。
  - Why not: この要件に対して実装コストが高く、不要な整形差分が増える。
- Decision: completed の真実源は run 終了時の `store.listTasks()` とする。
  - Reason: 既存 state ストアを再利用でき、二重状態管理を避けられるため。
- Decision: 同期結果件数をログ出力する。
  - Reason: 自動反映の有無をユーザーが即時確認できるため。

## Risks / Trade-offs
- Risk: `tasks.md` の task 行フォーマット変更で task_id 抽出が失敗する。
  - Mitigation: 非一致行は無変更でスキップし、既存テストで想定形式を固定する。
- Trade-off: `--config` を同期対象外にすることで適用範囲は狭くなる。
  - Mitigation: 対象外を仕様として明示し、誤更新を防ぐ fail-safe を優先する。

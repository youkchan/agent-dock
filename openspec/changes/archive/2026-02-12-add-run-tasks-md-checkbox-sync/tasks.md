## 0. Persona Defaults
- persona_defaults.phase_order: implement, review, spec_check, test
- persona_defaults: {"phase_order":["implement","review","spec_check","test"]}
- フェーズ担当: implement=implementer; review=code-reviewer; spec_check=spec-checker; test=test-owner
- personas: [{"id":"implementer","role":"implementer","focus":"実装を前進させる","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}},{"id":"code-reviewer","role":"reviewer","focus":"品質と回帰リスクを確認する","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}},{"id":"spec-checker","role":"spec_guard","focus":"仕様逸脱を防ぐ","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}},{"id":"test-owner","role":"test_guard","focus":"検証の十分性を担保する","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}}]

### 0.1 テンプレート利用ルール
- この雛形を `openspec/changes/<change-id>/tasks.md` にコピーし、`<...>` を実タスクで置換する。
- `persona_defaults.phase_order` と `フェーズ担当` の固定行は削除しない。
- `personas:` は **1行JSON** で記述する（YAMLの複数行形式は compiler が受理しない）。
- ペルソナを実行主体にする場合は `personas` 行を残す。消すと実行主体は `teammate-*` になる。
- 各タスクに `- フェーズ担当:` を記述し、`implement=implementer; review=code-reviewer; spec_check=spec-checker; test=test-owner` から必要なフェーズだけ選ぶ。
- 例: `- フェーズ担当: implement=implementer; review=code-reviewer`（未指定フェーズはグローバル既定を使う）。
- すべての実施項目（検証を含む）は **`## 1. 実装タスク` のチェックボックス付きタスク** として記述する（`## 2. 検証項目` は使わない）。
- 人間向けメモは `## 2. 人間向けメモ（コンパイラ非対象）` に **チェックボックスなし** で記述する。

### 0.2 Provider 完了判定ゲート（固定）
- `ORCHESTRATOR_PROVIDER=mock` 実行のみでは完了扱いにしない。
- 対象プロジェクトの実運用実行経路での受け入れ実行を必須とする。
- `not implemented` 等の未実装エラーは未完了として扱う（fail-closed）。

## 1. 実装タスク
- [x] 1.1 `tasks.md` チェックボックス同期関数を実装する
  - 依存: なし
  - 対象: src/infrastructure/openspec/compiler.ts
  - フェーズ担当: implement=implementer; review=code-reviewer
  - 成果物: `updateTasksMarkdownCheckboxes` を追加し、`- [ ]`/`- [x]` 行の task_id を completed 集合で `- [x]` へ更新し、更新件数を返す。
- [x] 1.2 run 完了フックへ同期処理を組み込む
  - 依存: 1.1
  - 対象: src/cli/main.ts
  - フェーズ担当: implement=implementer; review=code-reviewer
  - 成果物: `store.listTasks()` から completed task_id を取得し、`--openspec-change` 実行時のみ同期関数を呼び出す。
- [x] 1.3 同期結果ログを追加する
  - 依存: 1.2
  - 対象: src/cli/main.ts
  - フェーズ担当: implement=implementer; review=code-reviewer
  - 成果物: 同期実行時に `[run] synced_tasks_md=<count>` を標準出力へ出し、`--config` 実行時は出力しない。
- [x] 1.4 compiler 側の同期ロジックをテストする
  - 依存: 1.1
  - 対象: src/infrastructure/openspec/compiler_test.ts
  - フェーズ担当: spec_check=spec-checker; test=test-owner
  - 成果物: completed 行のみ更新、未完了行維持、再実行差分ゼロ（冪等）をテストで担保する。
- [x] 1.5 run 側の分岐とログをテストする
  - 依存: 1.2, 1.3
  - 対象: src/cli/main_test.ts
  - フェーズ担当: spec_check=spec-checker; test=test-owner
  - 成果物: `--openspec-change` 時の同期呼び出しと件数ログ、`--config` 時の非同期をテストで担保する。
- [x] 1.6 受け入れ検証を実行する
  - 依存: 1.4, 1.5
  - 対象: src/infrastructure/openspec/compiler_test.ts, src/cli/main_test.ts
  - フェーズ担当: spec_check=spec-checker; test=test-owner
  - 成果物: `deno test --allow-read --allow-write --allow-env src/infrastructure/openspec/compiler_test.ts src/cli/main_test.ts` が成功する。

## 2. 人間向けメモ（コンパイラ非対象）
- 要件メモ: 同期は run の `--openspec-change` 経由時のみ実行し、`--config` は対象外とする。
- 要件メモ: `tasks.md` 更新は `- [ ]` / `- [x]` の task 行だけに限定し、他行は変更しない。
- 要件メモ: 同期入力は `store.listTasks()` の completed task_id 一覧を単一ソースとして扱う。
- 要件メモ: 同一 completed 集合で再実行しても追加変更が出ない冪等性を維持する。
- 要件メモ: 同期実行時は `[run] synced_tasks_md=<count>` の 1 行ログを出力する。
- メモ: 重大違反時は `REVIEWER_STOP:requirement_drift|over_editing|verbosity` を reviewer 出力に含める。

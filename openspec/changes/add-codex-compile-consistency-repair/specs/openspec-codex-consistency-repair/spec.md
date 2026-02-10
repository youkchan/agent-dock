## ADDED Requirements

### Requirement: compile-openspec は Codex 整合性レビューを実行できること
システムは `compile-openspec` で生成した `task_config` と OpenSpec change 内容を Codex に渡し、整合性判定を取得しなければならない（SHALL）。

#### Scenario: 生成後に Codex へ整合性チェックを依頼する
- **WHEN** `compile-openspec --change-id <id>` を実行する
- **THEN** システムは change 文書群と生成済み `task_config` を Codex レビュー入力として送る
- **AND** Codex の JSON 判定を受け取る

### Requirement: 不整合時に生成 task_config を補正できること
システムは Codex 判定が不整合で有効な patch を含む場合、出力前に `task_config` へ追記/修正を適用しなければならない（SHALL）。

#### Scenario: tasks_update により既存タスクが補正される
- **WHEN** Codex が `is_consistent=false` と `tasks_update` を返す
- **THEN** 指定タスクの許可フィールドが patch 内容で更新される

#### Scenario: tasks_append により不足タスクが追記される
- **WHEN** Codex が `is_consistent=false` と `tasks_append` を返す
- **THEN** 生成 `task_config` に新規タスクが追記される

### Requirement: 補正結果は安全に検証されること
システムは Codex 補正適用後に既存コンパイル検証を再実行し、整合しない結果を出力してはならない（MUST NOT）。

#### Scenario: 不正 patch は失敗する
- **WHEN** Codex patch が許可外キー、型不一致、依存不整合、循環依存のいずれかを含む
- **THEN** コンパイルは失敗する
- **AND** 不正理由を示すエラーが返る

### Requirement: レビュー実行結果を追跡できること
システムは Codex レビューの実行有無と補正有無を `task_config.meta` に記録しなければならない（SHALL）。

#### Scenario: meta にレビュー結果が残る
- **WHEN** compile-openspec が成功する
- **THEN** 出力 JSON の `meta.codex_consistency` にチェック有無・補正有無・指摘件数が含まれる

### Requirement: レビュー段を明示的に無効化できること
システムは運用都合で Codex レビューを明示的に無効化できる手段を提供しなければならない（SHALL）。

#### Scenario: skip オプションで従来互換動作になる
- **WHEN** `--skip-codex-consistency` を指定して compile-openspec を実行する
- **THEN** Codex レビューは実行されない
- **AND** 既存コンパイル挙動で `task_config` が生成される

### Requirement: 各タスクにフェーズ担当が明示されていなければならないこと
システムは OpenSpec の `tasks.md` をコンパイルする際、各タスクに `フェーズ担当` / `phase assignments`（または同等の `persona_policy.phase_overrides`）が定義されていない場合、コンパイルを失敗させなければならない（SHALL）。

#### Scenario: フェーズ担当が欠落したタスクでコンパイル失敗する
- **WHEN** `tasks.md` 内に `フェーズ担当` / `phase assignments` の指定がないタスクが1つでも存在する
- **THEN** コンパイルは失敗する
- **AND** エラーに対象タスク id が含まれる

#### Scenario: 全タスクにフェーズ担当がある場合はコンパイル継続する
- **WHEN** すべてのタスクで `フェーズ担当` / `phase assignments`（または同等指定）が定義されている
- **THEN** この要件に起因するエラーは発生しない

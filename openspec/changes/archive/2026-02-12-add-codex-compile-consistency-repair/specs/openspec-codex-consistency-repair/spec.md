## ADDED Requirements

### Requirement: compile-openspec は内部ロジックのみで整合性検証すること
システムは `compile-openspec` 実行時、外部コマンドを呼ばずに内部コンパイルロジックのみで整合性を検証しなければならない（SHALL）。

#### Scenario: 外部コマンド設定なしでコンパイルできる
- **WHEN** `compile-openspec --change-id <id>` を実行する
- **THEN** 外部整合性レビュー設定なしでコンパイルが進む
- **AND** 必須入力や依存整合性は内部検証で判定される

### Requirement: 不整合は fail-closed で停止すること
システムは依存未解決・循環依存・型不一致などの不整合を検出した場合、コンパイルを失敗として停止しなければならない（SHALL）。

#### Scenario: 依存未解決でコンパイル失敗する
- **WHEN** `depends_on` に存在しない task id が含まれる
- **THEN** コンパイルは失敗する
- **AND** エラーに対象 task id が含まれる

#### Scenario: 循環依存でコンパイル失敗する
- **WHEN** タスク依存グラフに循環がある
- **THEN** コンパイルは失敗する
- **AND** エラーに循環検出であることが含まれる

#### Scenario: 型不一致でコンパイル失敗する
- **WHEN** `target_paths` や `depends_on` が不正型で与えられる
- **THEN** コンパイルは失敗する
- **AND** エラーに不正フィールド名が含まれる

### Requirement: 各タスクにフェーズ担当が明示されていなければならないこと
システムは OpenSpec の `tasks.md` をコンパイルする際、各タスクに `フェーズ担当` / `phase assignments`（または同等の `persona_policy.phase_overrides`）が定義されていない場合、コンパイルを失敗させなければならない（SHALL）。

#### Scenario: フェーズ担当が欠落したタスクでコンパイル失敗する
- **WHEN** `tasks.md` 内に `フェーズ担当` / `phase assignments` の指定がないタスクが1つでも存在する
- **THEN** コンパイルは失敗する
- **AND** エラーに対象タスク id が含まれる

#### Scenario: 全タスクにフェーズ担当がある場合はコンパイル継続する
- **WHEN** すべてのタスクで `フェーズ担当` / `phase assignments`（または同等指定）が定義されている
- **THEN** この要件に起因するエラーは発生しない

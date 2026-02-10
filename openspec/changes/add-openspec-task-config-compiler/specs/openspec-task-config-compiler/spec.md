## ADDED Requirements

### Requirement: OpenSpec change を task_config に変換できること
システムは `openspec/changes/<change-id>/` を入力として解析し、`task_configs/<change-id>.json` を生成しなければならない（SHALL）。

#### Scenario: 基本コンパイルが成功する
- **WHEN** `change-id` に対応する `tasks.md` が存在し、必要なタスク属性が定義されている
- **THEN** `task_configs/<change-id>.json` が生成される
- **AND** 生成 JSON は既存ランタイムの `--config` 入力形式に一致する

### Requirement: 依存関係と計画必須フラグを保持すること
システムはコンパイル時に `depends_on` と `requires_plan` を欠落なく変換しなければならない（SHALL）。

#### Scenario: depends_on が順序制約として反映される
- **WHEN** タスク定義に `depends_on: [T-001]` が含まれる
- **THEN** 出力 JSON の同一タスクに `depends_on` が保持される

#### Scenario: requires_plan が承認ゲート用に反映される
- **WHEN** タスク定義に `requires_plan=true` が含まれる
- **THEN** 出力 JSON の同一タスクに `requires_plan: true` が保持される

### Requirement: overrides を上書きマージできること
システムは `overrides/<change-id>.yaml` が存在する場合、コンパイル結果へ決定的な順序で上書き適用しなければならない（SHALL）。

#### Scenario: override が title と target_paths を上書きする
- **WHEN** override にタスク単位で `title` と `target_paths` が定義されている
- **THEN** 生成 JSON では該当タスクの `title` と `target_paths` が override 値になる
- **AND** override で未指定の属性はコンパイル元の値を保持する

### Requirement: 不正入力を明確に拒否すること
システムは不正なタスク記述、循環依存、または不正 override を検出した場合、成功扱いにせず失敗しなければならない（SHALL）。

#### Scenario: 循環依存を検出して失敗する
- **WHEN** タスク依存グラフに循環が存在する
- **THEN** コンパイルは失敗する
- **AND** エラーに循環検出を示す説明が含まれる

#### Scenario: 未知 override キーを検出して失敗する
- **WHEN** override に許可されていないキーが含まれる
- **THEN** コンパイルは失敗する
- **AND** エラーに未知キー名が含まれる

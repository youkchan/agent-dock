## MODIFIED Requirements

### Requirement: overrides を上書きマージできること
システムは `task_configs/overrides/project.yaml` が存在する場合、コンパイル結果へ決定的な順序で上書き適用しなければならない（SHALL）。

#### Scenario: project override が title と target_paths を上書きする
- **WHEN** `task_configs/overrides/project.yaml` にタスク単位で `title` と `target_paths` が定義されている
- **THEN** 生成 JSON では該当タスクの `title` と `target_paths` が override 値になる
- **AND** override で未指定の属性はコンパイル元の値を保持する

#### Scenario: project override が存在しない場合は上書きなしで続行する
- **WHEN** `task_configs/overrides/project.yaml` が存在しない
- **THEN** コンパイルは失敗せず継続する
- **AND** 生成 JSON はベースコンパイル結果のみで構成される

## ADDED Requirements

### Requirement: change-id 個別 override を入力源にしないこと
システムは `task_configs/overrides/<change-id>.yaml` をコンパイル入力として読み込んではならない（MUST NOT）。

#### Scenario: change-id override が存在しても適用されない
- **WHEN** `task_configs/overrides/<change-id>.yaml` が存在している
- **THEN** コンパイラはそのファイルを入力として使わない
- **AND** 出力結果は `project.yaml` とベースコンパイル結果のみで決まる

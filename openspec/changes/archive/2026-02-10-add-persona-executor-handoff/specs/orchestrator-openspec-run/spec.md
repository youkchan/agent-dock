## ADDED Requirements

### Requirement: run は persona 実行主体モードを扱えること
システムは task_config に persona 実行設定がある場合、ペルソナを実行主体として run を進行できなければならない（SHALL）。

#### Scenario: persona 実行主体でタスクが進行する
- **WHEN** task_config の `personas[].execution.enabled=true` が定義されている
- **THEN** claim と実行 owner は persona_id ベースで管理される
- **AND** フェーズに応じた executor_personas から担当が選定される

### Requirement: 後方互換として teammates 実行へフォールバックできること
システムは persona 実行設定が未指定の場合、既存 teammates 実行へフォールバックしなければならない（SHALL）。

#### Scenario: personas 未指定で従来動作する
- **WHEN** task_config に `personas` が存在しない
- **THEN** 従来どおり `teammates` を実行主体として run が継続する

### Requirement: 実行主体不在の構成を拒否すること
システムは実行可能な persona も teammates も存在しない構成を受理してはならない（MUST NOT）。

#### Scenario: 実行主体ゼロで失敗する
- **WHEN** `personas[].execution.enabled=true` が 0 件かつ `teammates` も空で run を開始する
- **THEN** 実行は開始されない
- **AND** エラーには実行主体不足であることが含まれる

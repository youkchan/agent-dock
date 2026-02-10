## ADDED Requirements

### Requirement: ペルソナは実行主体プロファイルを持てること
システムはペルソナ定義に実行主体としての設定（execution profile）を持てなければならない（SHALL）。

#### Scenario: 実行可能ペルソナを定義する
- **WHEN** ペルソナ定義に `execution.enabled=true` が指定される
- **THEN** そのペルソナは実行主体候補として扱われる
- **AND** 実行設定（command/sandbox/timeout）を参照可能である

### Requirement: ペルソナ利用禁止を明示できること
システムは task 単位または change 単位で、特定ペルソナを利用禁止として指定できなければならない（SHALL）。

#### Scenario: disable 指定したペルソナが除外される
- **WHEN** `disable_personas` に `spec-checker` が指定される
- **THEN** `spec-checker` は実行と評価の両方から除外される

### Requirement: 不正な実行プロファイルを拒否すること
システムは execution profile の型不一致や未知キーを受理してはならない（MUST NOT）。

#### Scenario: execution 設定不正で失敗する
- **WHEN** `execution.timeout_sec` に数値以外が指定される
- **THEN** 読み込みは失敗する
- **AND** エラーに不正キーまたは不正型が含まれる

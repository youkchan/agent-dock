# persona-catalog Specification

## Purpose
TBD - created by archiving change add-persona-quality-gates. Update Purpose after archive.
## Requirements
### Requirement: デフォルト品質ペルソナを提供すること
システムは品質観点を分離するため、少なくとも4つのデフォルトペルソナ（実装者、コードレビュワー、仕様確認者、テスト担当）を提供しなければならない（SHALL）。

#### Scenario: デフォルトペルソナが初期化される
- **WHEN** ペルソナ設定を明示せずにオーケストレーターを起動する
- **THEN** 4つのデフォルトペルソナが有効な状態で読み込まれる
- **AND** 各ペルソナは識別可能な `id` を持つ

### Requirement: プロジェクト定義による上書きと追加をサポートすること
システムはプロジェクト固有ペルソナ定義を読み込み、同名 `id` は完全上書き、非同名 `id` は追加として扱わなければならない（SHALL）。

#### Scenario: 同名 id は完全上書きされる
- **WHEN** プロジェクト定義にデフォルトと同じ `id` のペルソナが含まれる
- **THEN** デフォルト定義は採用されない
- **AND** プロジェクト側の定義が100%使用される

#### Scenario: 非同名 id は追加される
- **WHEN** プロジェクト定義にデフォルトに存在しない `id` が含まれる
- **THEN** そのペルソナは追加ペルソナとして有効化される

### Requirement: block 権限をペルソナ単位で制御できること
システムはペルソナ定義に `can_block` 属性を持ち、即停止権限をペルソナ単位で制御できなければならない（SHALL）。

#### Scenario: カスタムペルソナに block 権限を付与できる
- **WHEN** プロジェクト定義でカスタムペルソナに `can_block=true` を設定する
- **THEN** そのペルソナは blocker 指摘による即停止候補として扱われる

### Requirement: 不正なペルソナ定義を拒否すること
システムは必須項目欠落、型不一致、未知キーを含むペルソナ定義を受理してはならない（MUST NOT）。

#### Scenario: 未知キーを検出して失敗する
- **WHEN** ペルソナ定義に許可されていないキーが含まれる
- **THEN** 起動または読み込みは失敗する
- **AND** エラーには問題キー名が含まれる

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


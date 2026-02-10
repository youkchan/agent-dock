## ADDED Requirements

### Requirement: OpenSpec のペルソナ方針を task_config へ変換できること
システムは OpenSpec change に記述されたペルソナ方針（利用/非利用、フェーズ担当）を task_config に変換しなければならない（SHALL）。

#### Scenario: change 既定ペルソナ方針が出力される
- **WHEN** OpenSpec change にフェーズ別の既定ペルソナ方針が定義される
- **THEN** 生成された task_config に `persona_defaults` が含まれる

#### Scenario: タスク個別のペルソナ上書きが出力される
- **WHEN** OpenSpec tasks 記述にタスク単位のペルソナ指定が存在する
- **THEN** 対応タスクに `persona_policy` が出力される

### Requirement: 利用禁止指定をコンパイル結果へ反映すること
システムは OpenSpec で指定された利用禁止ペルソナを task_config へ保持しなければならない（SHALL）。

#### Scenario: disable 指定が task_config へ保持される
- **WHEN** OpenSpec 側で `reviewer` を disable 指定する
- **THEN** task_config の `disable_personas` に `reviewer` が含まれる

### Requirement: 不正なペルソナ方針入力を拒否すること
システムは未知フェーズ、未知ペルソナ、または不正型の方針を成功扱いにしてはならない（MUST NOT）。

#### Scenario: 未知ペルソナ参照で失敗する
- **WHEN** タスクのペルソナ方針が未定義 persona_id を参照する
- **THEN** コンパイルは失敗する
- **AND** エラーに対象タスク id と未知 persona_id が含まれる

# persona-gate-engine Specification

## Purpose
TBD - created by archiving change add-persona-quality-gates. Update Purpose after archive.
## Requirements
### Requirement: ペルソナ指摘の重大度挙動を統一すること
システムはペルソナ指摘の `info / warn / critical / blocker` に対して、定義済みアクションを一貫して適用しなければならない（SHALL）。

#### Scenario: info はログのみで継続する
- **WHEN** `info` 重大度の指摘が発生する
- **THEN** 指摘はログに記録される
- **AND** タスク状態と実行停止条件は変更されない

#### Scenario: warn は次ラウンド再確認される
- **WHEN** `warn` 重大度の指摘が発生する
- **THEN** 次ラウンドに再確認対象として保持される

#### Scenario: critical は承認待ちへ遷移する
- **WHEN** `critical` 重大度の指摘が対象タスクに紐づいて発生する
- **THEN** 対象タスクは `needs_approval` に遷移する

### Requirement: blocker は権限保持ペルソナのみ即停止できること
システムは `can_block=true` のペルソナによる `blocker` 指摘のみで即停止しなければならない（SHALL）。

#### Scenario: 権限保持ペルソナの blocker で即停止する
- **WHEN** `can_block=true` のペルソナが `blocker` 指摘を出す
- **THEN** 実行は即停止する
- **AND** `stop_reason` は `persona_blocker:<persona_id>` になる

#### Scenario: 権限なしペルソナの blocker は即停止しない
- **WHEN** `can_block=false` のペルソナが `blocker` 指摘を出す
- **THEN** 即停止は発生しない
- **AND** 指摘は `critical` 相当として扱われる

### Requirement: 1イベントあたりのコメント上限を適用すること
システムは1イベントあたりのコメント件数に上限を適用し、既定値を2件にしなければならない（SHALL）。

#### Scenario: コメント上限でノイズが抑制される
- **WHEN** 1イベントで3件以上のコメント候補が発生する
- **THEN** 実際に出力されるコメントは2件以下になる
- **AND** 採用順位は重大度優先で決定される

### Requirement: 運用最適化のための計測情報を残すこと
システムは導入後の閾値調整に利用できるよう、ペルソナ指摘と停止の計測情報を出力しなければならない（SHALL）。

#### Scenario: severity と停止情報が集計される
- **WHEN** 実行が完了または停止する
- **THEN** severity 別件数および `persona_blocker` 停止有無が確認可能である

### Requirement: タスクはフェーズ単位でペルソナへハンドオフできること
システムはタスクごとにフェーズを定義し、フェーズ単位で担当ペルソナへ実行をハンドオフできなければならない（SHALL）。

#### Scenario: implement から review へ担当が切り替わる
- **WHEN** タスクの `implement` フェーズが完了する
- **THEN** 次フェーズ `review` に遷移する
- **AND** 実行担当は `review` の executor_personas から選定される

### Requirement: フェーズごとに複数ペルソナの意見を許可できること
システムは同一フェーズで複数ペルソナのコメントを受け付けられなければならない（SHALL）。

#### Scenario: review フェーズで複数意見が記録される
- **WHEN** `review.active_personas` に `reviewer` と `spec-checker` が含まれる
- **THEN** 両ペルソナのコメントが同一フェーズ内で評価される

### Requirement: 状態遷移権限はフェーズごとに分離できること
システムはコメント参加権限と状態遷移権限を分離しなければならない（SHALL）。

#### Scenario: コメントは可能だが遷移権限がない
- **WHEN** `active_personas` に含まれるが `state_transition_personas` に含まれないペルソナが `critical` を出す
- **THEN** そのコメントは記録される
- **AND** タスク状態遷移は発生しない

### Requirement: blocker は can_block と遷移権限の両方が必要であること
システムは `blocker` を適用する際、`can_block=true` と遷移権限の両方を満たさなければならない（MUST）。

#### Scenario: can_block だけでは停止しない
- **WHEN** `can_block=true` だが当該フェーズの `state_transition_personas` に含まれないペルソナが `blocker` を出す
- **THEN** 即停止は発生しない
- **AND** コメントは `critical` 相当として扱われる


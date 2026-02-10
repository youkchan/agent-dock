## ADDED Requirements

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

## ADDED Requirements

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

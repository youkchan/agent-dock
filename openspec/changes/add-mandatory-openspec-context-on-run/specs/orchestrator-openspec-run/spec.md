## ADDED Requirements

### Requirement: run は常に OpenSpec 文脈を解決してから開始すること
システムは `run` 実行時に、対象 change の OpenSpec 文書群を解決し、取得できない場合は実行を開始してはならない（MUST NOT）。

#### Scenario: --openspec-change 指定で文書群を読み込む
- **WHEN** ユーザーが `run --openspec-change <change-id>` を実行する
- **THEN** システムは `proposal.md` と `tasks.md` と `specs/**/spec.md` を読み込む
- **AND** 読み込み成功後にのみオーケストレーションを開始する

#### Scenario: --config 指定時に source_change_id で解決する
- **WHEN** ユーザーが `run --config <path>` を実行し、`meta.source_change_id` が存在する
- **THEN** システムは `source_change_id` から OpenSpec 文書群を解決する
- **AND** 解決成功後にのみ実行を開始する

#### Scenario: OpenSpec 解決不可なら開始拒否する
- **WHEN** `--config` で `meta.source_change_id` が欠落している、または change が存在しない
- **THEN** 実行は開始されない
- **AND** エラーに解決不能理由が示される

### Requirement: タスク実行 prompt に OpenSpec 要件文脈を常時含めること
システムは実行者へ渡す各タスク prompt に、関連する要求・シナリオ・検証観点を常時含めなければならない（SHALL）。

#### Scenario: 実行者 prompt に要求とシナリオが含まれる
- **WHEN** 任意タスクが実行者に割り当てられる
- **THEN** prompt には当該 change の要求要点とシナリオ要点が含まれる
- **AND** 単なる task title/description だけで実行は開始されない

### Requirement: SPEC_ACK を必須化すること
システムは実行者がタスク着手前に OpenSpec 理解を示す `SPEC_ACK` を返すことを必須とし、欠落時は進行させてはならない（MUST NOT）。

#### Scenario: SPEC_ACK 欠落時は進行を拒否する
- **WHEN** 実行者応答に `SPEC_ACK` が含まれない
- **THEN** 当該タスクは `completed` へ遷移しない
- **AND** 差し戻しまたは `blocked` として扱われる

### Requirement: SPEC_COVERAGE を完了条件に含めること
システムはタスク完了報告に、満たした要求/シナリオの対応関係（`SPEC_COVERAGE`）を含めなければならない（SHALL）。

#### Scenario: SPEC_COVERAGE 欠落時は完了扱いにしない
- **WHEN** 実行者が `RESULT: completed` を返すが `SPEC_COVERAGE` を返さない
- **THEN** システムは completed を確定しない
- **AND** 不足項目を示して再提出を要求する

## ADDED Requirements

### Requirement: implement フェーズのみ編集実行を担うこと
システムは persona 実行モードにおいて、編集実行フェーズを implement のみに限定しなければならない（SHALL）。

#### Scenario: review フェーズは判定のみを返す
- **WHEN** task が review フェーズで実行される
- **THEN** システムは実行結果を `pass|changes_required|blocked` の判定として扱う
- **AND** review フェーズは編集継続の実行主体にならない

### Requirement: 判定結果を3値に統一すること
システムは review/spec_check/test の判定結果を `pass | changes_required | blocked` の3値で管理しなければならない（SHALL）。

#### Scenario: spec_check の判定が正規化される
- **WHEN** spec_check フェーズが判定結果を返す
- **THEN** システムは結果を `pass|changes_required|blocked` のいずれかとして記録する
- **AND** それ以外の値は受け付けない

### Requirement: changes_required は implement へ差し戻すこと
システムは判定結果が `changes_required` の場合、必ず implement フェーズへ差し戻さなければならない（SHALL）。

#### Scenario: review で changes_required の場合
- **WHEN** review フェーズの判定が `changes_required` になる
- **THEN** task の `status` は `pending` になる
- **AND** task の `owner` は `null` になる
- **AND** task の `current_phase_index` は implement を指す値になる
- **AND** 差し戻し理由は progress log と mailbox に保存される

#### Scenario: spec_check で changes_required の場合
- **WHEN** spec_check フェーズの判定が `changes_required` になる
- **THEN** task は implement フェーズへ差し戻される
- **AND** 判定フェーズの実行主体は同一 task を継続実行しない

### Requirement: pass の場合のみ次フェーズへ handoff すること
システムは判定結果が `pass` の場合にのみ次フェーズへ handoff しなければならない（SHALL）。

#### Scenario: review/spec_check で pass の場合
- **WHEN** review または spec_check の判定が `pass` になる
- **THEN** task は次フェーズへ handoff される

### Requirement: blocked 遷移は既存仕様を維持すること
システムは判定結果が `blocked` の場合、既存の blocked 遷移を維持しなければならない（SHALL）。

#### Scenario: 判定が blocked の場合
- **WHEN** 判定フェーズの結果が `blocked` になる
- **THEN** task は blocked 状態へ遷移する
- **AND** 既存の blocked 処理フローは維持される

### Requirement: revision cycle guard で無限ループを防止すること
システムは差し戻し回数を `revision_count` として保持し、`revision_count > max_revision_cycles` の場合に `needs_approval` へ遷移しなければならない（SHALL）。

#### Scenario: 差し戻し回数が上限を超過した場合
- **WHEN** `changes_required` による差し戻しで `revision_count` が `max_revision_cycles` を超える
- **THEN** task は `needs_approval` へ遷移する
- **AND** 自動実行は停止する

### Requirement: teammate 実行モードは既存挙動を維持すること
システムは persona でない teammate 実行モードでは、本変更による遷移変更を適用してはならない（SHALL NOT）。

#### Scenario: teammate 実行モードの回帰がない
- **WHEN** persona を使わない teammate 実行モードで task を処理する
- **THEN** 既存の実行フローと状態遷移は維持される

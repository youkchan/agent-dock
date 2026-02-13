## ADDED Requirements

### Requirement: implement フェーズのみ編集実行を担うこと
システムは persona 実行モードにおいて、編集実行フェーズを implement のみに限定しなければならない（SHALL）。

#### Scenario: review フェーズは判定のみを返す
- **WHEN** task が review フェーズで実行される
- **THEN** システムは実行結果を `pass|changes_required|blocked` の判定として扱う
- **AND** review フェーズは編集継続の実行主体にならない

### Requirement: 判定結果を3値に統一すること
システムは review/spec_check/test の判定結果を `JUDGMENT: pass | changes_required | blocked` の3値で管理しなければならない（SHALL）。

#### Scenario: spec_check の判定が正規化される
- **WHEN** spec_check フェーズが判定結果を返す
- **THEN** システムは結果を `pass|changes_required|blocked` のいずれかとして記録する
- **AND** それ以外の値は受け付けない

### Requirement: 判定フェーズは JUDGMENT 出力契約を満たすこと
システムは review/spec_check/test フェーズで `JUDGMENT: pass|changes_required|blocked` を必須とし、欠落・未知値・矛盾時は fail-closed で `blocked` として扱わなければならない（SHALL）。

#### Scenario: review フェーズが JUDGMENT を返す
- **WHEN** review フェーズの実行結果に `JUDGMENT: pass` が含まれる
- **THEN** システムは判定を `pass` として扱う

#### Scenario: JUDGMENT が欠落している
- **WHEN** review/spec_check/test フェーズの実行結果に `JUDGMENT` 行が存在しない
- **THEN** システムは判定を `blocked` として扱う
- **AND** task は blocked 状態へ遷移する

#### Scenario: RESULT と JUDGMENT が矛盾する
- **WHEN** review/spec_check/test フェーズで `RESULT: blocked` かつ `JUDGMENT: pass` が返る
- **THEN** システムは `RESULT=blocked` を優先して判定を `blocked` とする
- **AND** task は blocked 状態へ遷移する

### Requirement: 非 implement フェーズの編集を強制拒否すること
システムは review/spec_check/test フェーズにおいて `CHANGED_FILES` が非空の場合、編集違反として fail-closed で `blocked` へ遷移しなければならない（SHALL）。`CHANGED_FILES` の正規空表現は `CHANGED_FILES: (none)` とし、互換入力として `none` / `-` / 空文字も空として正規化しなければならない（SHALL）。

#### Scenario: review で編集が検出される
- **WHEN** review フェーズの実行結果で `CHANGED_FILES` に1件以上のファイルが記録される
- **THEN** システムは task を blocked 状態へ遷移する
- **AND** blocked 理由に非 implement フェーズ編集違反が記録される

#### Scenario: CHANGED_FILES が空表現を返す
- **WHEN** review/spec_check/test フェーズの実行結果が `CHANGED_FILES: (none)` または互換空表現（`none` / `-` / 空文字）を返す
- **THEN** システムは `CHANGED_FILES` を空として扱う
- **AND** 編集違反による `blocked` 遷移を発生させない

### Requirement: フェーズ別 sandbox を実行時に強制適用すること
システムは persona 実行モードにおいて、実行主体 persona の `execution.sandbox` を各フェーズ実行時の実行コマンドへ反映しなければならない（SHALL）。

#### Scenario: implement は workspace-write で実行される
- **WHEN** implement フェーズを実行する
- **THEN** 実行コマンドには `CODEX_SANDBOX=workspace-write` が適用される

#### Scenario: review は read-only で実行される
- **WHEN** review/spec_check/test フェーズを実行する
- **THEN** 実行コマンドには `CODEX_SANDBOX=read-only` が適用される

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

#### Scenario: test で changes_required の場合
- **WHEN** test フェーズの判定が `changes_required` になる
- **THEN** task は implement フェーズへ差し戻される
- **AND** `current_phase_index` は `phase_order` 上の implement index を指す

### Requirement: pass 判定時は phase_order に従って前進すること
システムは判定結果が `pass` の場合、`phase_order` に従って前進しなければならない（SHALL）。次フェーズが存在する場合は handoff し、次フェーズが存在しない場合は `completed` へ遷移しなければならない（SHALL）。`pass` 以外の判定で前進してはならない（SHALL NOT）。

#### Scenario: review/spec_check で pass の場合
- **WHEN** review または spec_check の判定が `pass` になる
- **THEN** task は次フェーズへ handoff される

#### Scenario: 判定フェーズで pass かつ次フェーズがない場合
- **WHEN** 判定フェーズの判定が `pass` で、`phase_order` 上に次フェーズが存在しない
- **THEN** task は `completed` へ遷移する

### Requirement: blocked 遷移は既存仕様を維持すること
システムは判定結果が `blocked` の場合、既存の blocked 遷移を維持しなければならない（SHALL）。

#### Scenario: 判定が blocked の場合
- **WHEN** 判定フェーズの結果が `blocked` になる
- **THEN** task は blocked 状態へ遷移する
- **AND** 既存の blocked 処理フローは維持される

#### Scenario: test で blocked の場合
- **WHEN** test フェーズの判定が `blocked` になる
- **THEN** task は blocked 状態へ遷移する
- **AND** 既存の blocked 処理フローは維持される

### Requirement: revision cycle guard で無限ループを防止すること
システムは差し戻し回数を `revision_count` として保持し、`revision_count > max_revision_cycles` の場合に `needs_approval` へ遷移しなければならない（SHALL）。`max_revision_cycles` は task 単位の非負整数設定とし、未設定時は compile 時に既定値 `3` を補完しなければならない（SHALL）。

#### Scenario: max_revision_cycles が未設定の場合
- **WHEN** task 設定に `max_revision_cycles` が存在しない
- **THEN** compile は `max_revision_cycles=3` を補完する

#### Scenario: max_revision_cycles が不正値の場合
- **WHEN** `max_revision_cycles` が負数または整数以外で設定される
- **THEN** compile は fail-closed で失敗する
- **AND** run は開始されない

#### Scenario: revision_count の初期値
- **WHEN** task が新規作成される
- **THEN** `revision_count` は `0` で初期化される

#### Scenario: revision_count の加算条件
- **WHEN** review/spec_check/test で `changes_required` により implement へ差し戻される
- **THEN** `revision_count` は `+1` される
- **AND** それ以外の判定結果では増加しない

#### Scenario: pass では revision_count をリセットしない
- **WHEN** review/spec_check/test で `pass` 判定になり次フェーズへ進む
- **THEN** `revision_count` はリセットされない

#### Scenario: resume で revision_count を保持する
- **WHEN** `--resume` で既存 state から実行を再開する
- **THEN** 保存済み `revision_count` は再初期化されず保持される

#### Scenario: 差し戻し回数が上限を超過した場合
- **WHEN** `changes_required` による差し戻しで `revision_count` が `max_revision_cycles` を超える
- **THEN** task は `needs_approval` へ遷移する
- **AND** 自動実行は停止する

### Requirement: implement 差し戻し先を phase_order で一意に解決すること
システムは `changes_required` 差し戻し時、task の `phase_order` から `implement` の index を解決しなければならない（SHALL）。

#### Scenario: implement index を解決して差し戻す
- **WHEN** task の `phase_order` に `implement` が含まれる
- **THEN** `current_phase_index` は `phase_order` 上の `implement` index に設定される

#### Scenario: implement を含まない構成は compile で拒否する
- **WHEN** task の `phase_order` に `implement` が含まれない
- **THEN** compile は失敗する
- **AND** run は開始されない

### Requirement: teammate 実行モードは既存挙動を維持すること
システムは persona でない teammate 実行モードでは、本変更による遷移変更を適用してはならない（SHALL NOT）。

#### Scenario: teammate 実行モードの回帰がない
- **WHEN** persona を使わない teammate 実行モードで task を処理する
- **THEN** 既存の実行フローと状態遷移は維持される

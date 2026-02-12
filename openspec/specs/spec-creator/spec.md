# spec-creator Specification

## Purpose
TBD - created by archiving change add-spec-creator. Update Purpose after archive.
## Requirements
### Requirement: Spec Creator SHALL generate OpenSpec artifact set
The system SHALL generate `proposal.md` / `tasks.md` / `design.md` (when needed) / `code_summary.md` from requirement input.

#### Scenario: Generate full artifact set from requirements
- **WHEN** ユーザーが `change_id` と要件文を指定して spec creator を実行する
- **THEN** `openspec/changes/<change_id>/` 配下に OpenSpec 一式が生成される
- **AND** `code_summary.md` が生成される

### Requirement: Spec Creator SHALL use fixed task_config template with preprocessed context
The system SHALL execute spec creation by injecting `spec_context` into a fixed task_config template, then running through the existing run lifecycle via `run --config`.

#### Scenario: Use fixed tasks and context injection
- **WHEN** ユーザーが spec creator を開始する
- **THEN** 前処理で `spec_context` を収集する
- **AND** 固定 task_config テンプレート（可変生成しない）へ `spec_context` を注入する
- **AND** 既存 run ループ本体を `run --config` 経由で実行する

### Requirement: tasks.md SHALL follow compiler-compatible template
The system SHALL preserve fixed lines and structure from `print-openspec-template` when generating `tasks.md`.

#### Scenario: Enforce template fixed lines
- **WHEN** spec creator が `tasks.md` を生成する
- **THEN** `persona_defaults.phase_order` と `フェーズ担当` の固定行が含まれる
- **AND** すべての実施項目は `## 1. 実装タスク` のチェックボックスタスクとして出力される

### Requirement: code_summary.md SHALL provide task-to-code mapping
The system SHALL map each `task_id` in `tasks.md` to corresponding code units in `code_summary.md`.

#### Scenario: Keep task and code summary in sync
- **WHEN** spec creator が `tasks.md` と `code_summary.md` を生成する
- **THEN** `tasks.md` の全 `task_id` が `code_summary.md` に存在する
- **AND** `code_summary.md` は `file/service/function/purpose/input/output/error/test` を含む

### Requirement: Reviewer SHALL block requirement drift and over-editing
The system SHALL allow `spec-reviewer` to detect requirement drift, over-editing, and excessive verbosity, and SHALL stop on major violations.

#### Scenario: Block major inconsistency
- **WHEN** `proposal/tasks/design/code_summary` 間で重大な不整合が検出される
- **THEN** reviewer は `blocker` を返す
- **AND** 実行は停止する

### Requirement: Spec Creator SHALL use spec personas only
The system SHALL run spec creator tasks with `spec-planner`, `spec-reviewer`, and `spec-code-creator`, separate from normal run personas.

#### Scenario: Persona set separation
- **WHEN** spec creator が実行される
- **THEN** 実行主体は `spec` ペルソナ集合になる
- **AND** 通常 run の実装系ペルソナ集合は混在しない

### Requirement: Spec Creator SHALL inject completion readiness gates into generated artifacts
The system SHALL include mandatory completion gates in generated `proposal.md` and `tasks.md`.

#### Scenario: Mock-only execution is not accepted as completion
- **WHEN** 生成された OpenSpec の完了判定を行う
- **THEN** `ORCHESTRATOR_PROVIDER=mock` の実行結果のみでは完了扱いにしない

#### Scenario: Operational acceptance run is mandatory
- **WHEN** 生成された OpenSpec で完了判定を行う
- **THEN** 対象プロジェクトの実運用実行経路での受け入れ実行を必須とする
- **AND** 完了報告には実行コマンド、最終結果 JSON、使用 provider、失敗時ログ抜粋を含める

#### Scenario: Not implemented failures fail closed
- **WHEN** 受け入れ実行で `not implemented` 等の未実装エラーを検出する
- **THEN** 生成された OpenSpec は未完了として扱う
- **AND** 完了チェックを進めない

### Requirement: spec-creator polish は change 単位で fail-closed 実行すること
システムは `agent-dock spec-creator polish --change-id <id>` を受け付け、`--change-id` 未指定または `openspec/changes/<change-id>/` 非存在の場合は即時失敗しなければならない（SHALL）。

#### Scenario: 有効な change-id で実行する
- **WHEN** ユーザーが `agent-dock spec-creator polish --change-id add-foo` を実行する
- **THEN** `openspec/changes/add-foo/` 配下の処理を開始する

#### Scenario: change-id が無効なら失敗する
- **WHEN** `--change-id` が未指定または存在しない change-id を指定する
- **THEN** コマンドは fail-closed で失敗する
- **AND** 処理は開始しない

### Requirement: polish は change 配下の全ファイルを再帰走査すること
システムは `openspec/changes/<change-id>/` 配下を再帰走査し、対象ファイルを Markdown と非Markdownに分類して扱わなければならない（SHALL）。

#### Scenario: 再帰走査で対象総数を算出する
- **WHEN** polish を実行する
- **THEN** 対象総ファイル数を算出する
- **AND** 結果サマリに総ファイル数を出力する

### Requirement: Markdown だけを整備し、非Markdownは無変更とすること
システムは `*.md` に対して整形・固定行補完・見出し正規化を適用し、非Markdown（yaml/json等）は内容を変更してはならない（MUST NOT）。

#### Scenario: Markdown は整備される
- **WHEN** 対象に `*.md` が含まれる
- **THEN** Markdown 整備ルールを適用する
- **AND** 適用件数を結果サマリに含める

#### Scenario: 非Markdown は無変更である
- **WHEN** 対象に yaml/json 等が含まれる
- **THEN** 非Markdown の内容は変更されない
- **AND** 必要時は警告を出力する

### Requirement: polish 結果を監査可能な形式で出力すること
システムは実行結果として、対象総ファイル数、変更ファイル一覧、整備ルール別適用件数を出力しなければならない（SHALL）。

#### Scenario: 変更有無に応じてサマリを出力する
- **WHEN** polish が終了する
- **THEN** 変更ファイル一覧を出力する
- **AND** 変更なしの場合も件数ゼロとして明示する

### Requirement: polish は冪等であること
システムは同一入力に対する再実行で追加差分を発生させてはならない（MUST NOT）。

#### Scenario: 再実行で差分ゼロになる
- **WHEN** 同一 change-id に対して polish を連続実行する
- **THEN** 2回目以降の差分はゼロである

### Requirement: polish 後の compile-openspec が成功すること
システムは polish 実行後に `compile-openspec` が成功する状態を維持しなければならない（SHALL）。

#### Scenario: polish 後にコンパイルできる
- **WHEN** polish 完了後に `compile-openspec --change-id <id>` を実行する
- **THEN** task_config 生成が成功する


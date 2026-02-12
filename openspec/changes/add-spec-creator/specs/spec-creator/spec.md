## ADDED Requirements

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

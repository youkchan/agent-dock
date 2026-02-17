## ADDED Requirements
### Requirement: Spec Creator Polish SHALL perform re-generation with task-scoped multi-pass execution
The system SHALL accept `agent-dock spec-creator polish <change_id> [--feedback "指示内容"]`, collect all `.md` under `openspec/changes/<change_id>/` as input context, and regenerate target artifacts with one or more Codex calls on task-scoped execution.

#### Scenario: 有効な change-id で polish を実行する
- **WHEN** user executes `agent-dock spec-creator polish <existing-change-id>`
- **THEN** the system SHALL collect all `.md` from `openspec/changes/<change-id>/` as input context
- **AND** each Codex call SHALL include collected context on a best-effort basis within prompt length limits and return rewritten targets: `proposal.md`, `tasks.md`, `code_summary.md`, `specs/**/spec.md`, and `design.md` only when required

#### Scenario: プロンプト長上限を超える場合
- **WHEN** serialized prompt exceeds runtime prompt size limit
- **THEN** the system MAY truncate prompt content and continue execution as best-effort
- **AND** prompt size visibility (for example prompt_chars logging) SHALL be available for audit and troubleshooting

#### Scenario: CLI サブコマンド契約
- **WHEN** user executes `agent-dock spec-creator polish` without `<change_id>` or with invalid options
- **THEN** the system SHALL fail-closed with explicit argument error
- **AND** unknown subcommands under `spec-creator` SHALL be rejected

#### Scenario: 旧経路の扱い
- **WHEN** user executes `agent-dock spec-creator` without subcommand
- **THEN** the system SHALL treat it as legacy create flow (deprecated)
- **AND** polish behavior SHALL be available only via `spec-creator polish <change_id>`

### Requirement: Spec Creator Polish SHALL include feedback and current standards in the prompt
The system SHALL merge collected context, latest standards (implement required, 5-line judgment contract, 3-value decision), and provided `--feedback` before codex generation.

#### Scenario: feedback を付与して再設計する
- **WHEN** `--feedback` is provided
- **THEN** the system SHALL inject feedback into the rewrite prompt
- **AND** feedback intent SHALL be reflected in the regenerated artifacts

#### Scenario: 品質監査の spec 全件走査
- **WHEN** target contains multiple `specs/**/spec.md`
- **THEN** quality and semantic checks SHALL iterate all matched spec files
- **AND** no single-spec shortcut SHALL bypass violations in non-primary spec files

### Requirement: Spec Creator Polish SHALL enforce overwrite and judgment normalization
The system SHALL apply Codex outputs to `proposal.md`, `tasks.md`, `code_summary.md`, and `specs/**/spec.md` (plus `design.md` only when required), enforce `implement` presence, enforce JUDGMENT in `review/spec_check/test`, and normalize judgments to `pass|changes_required|blocked`.

#### Scenario: 判定値が3値化される
- **WHEN** validation of rewrite output is performed
- **THEN** judgment SHALL be one of `pass`, `changes_required`, or `blocked`
- **AND** when `CHANGED_FILES` is empty, it SHALL be shown as `CHANGED_FILES: (none)`

### Requirement: Spec Creator Polish SHALL run strict validation after rewrite
The system SHALL write rewritten artifacts to a temporary staging area, execute `openspec validate <change_id> --strict` against staged outputs, and SHALL fail-closed on validation failure.

#### Scenario: --no-run でも strict validate を省略しない
- **WHEN** user executes `agent-dock spec-creator polish <change_id> --no-run`
- **THEN** the system SHALL still run staged `openspec validate <change_id> --strict` before returning
- **AND** validation failure SHALL fail-closed and keep target files unchanged

#### Scenario: strict validate 失敗時の振る舞い
- **WHEN** strict validation reports an error
- **THEN** the system SHALL fail-closed and return an explicit failure state
- **AND** staged artifacts SHALL be discarded and target files SHALL remain unchanged

#### Scenario: strict validate 成功時の反映
- **WHEN** strict validation succeeds for staged artifacts
- **THEN** the system SHALL apply staged outputs to target files atomically (all-or-nothing)
- **AND** final accepted outputs SHALL match staged artifacts

### Requirement: Spec Creator Polish task execution SHALL treat scope as guidance and enforce completion gates
The system SHALL keep per-task scope fields (`target_paths`, `related_paths`) as editing guidance, not hard runtime blockers, and SHALL enforce completion gates for wiring, regression, and semantic consistency.

#### Scenario: 連動修正が必要な場合
- **WHEN** implementation requires minimal edits outside required scope
- **THEN** the system SHALL allow additional edits required for implementation completion
- **AND** the run result MAY include additional rationale in `SUMMARY` for auditability

#### Scenario: 最終監査で修正が入る場合
- **WHEN** whole-change audit introduces any follow-up edits
- **THEN** the system SHALL rerun `agent-dock compile-openspec --change-id <change_id>` and `openspec validate <change_id> --strict`
- **AND** completion SHALL be rejected until both checks pass

### Requirement: Scope declarations SHALL remain available for review guidance
The system SHALL preserve `target_paths` and `related_paths` in task context so reviewers can evaluate whether extra edits were justified.

#### Scenario: 実装中に追加ファイルが必要になった場合
- **WHEN** implementation changes files outside declared scope hints
- **THEN** the system SHALL continue execution without scope-based runtime blocking
- **AND** reviewers SHALL judge appropriateness through review/spec_check/test phases

## 0. Persona Defaults
- persona_defaults.phase_order: implement, review, spec_check, test
- persona_defaults: {"phase_order":["implement","review","spec_check","test"]}
- フェーズ担当: implement=implementer; review=code-reviewer; spec_check=spec-checker; test=test-owner
- personas: [{"id":"implementer","role":"implementer","focus":"実装を前進させる","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}},{"id":"code-reviewer","role":"reviewer","focus":"品質と回帰リスクを確認する","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}},{"id":"spec-checker","role":"spec_guard","focus":"仕様逸脱を防ぐ","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}},{"id":"test-owner","role":"test_guard","focus":"検証の十分性を担保する","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}}]

## 1. 実装タスク
- [ ] 1.1 TypeScript 層の責務と I/O 契約を定義する
  - 依存: なし
  - 対象: openspec/changes/refactor-codex-wrapper-to-typescript/*
  - フェーズ担当: implement=implementer; spec_check=spec-checker
  - 成果物: TypeScript 層の各モジュール責務と入出力を明記する
- [ ] 1.2 Shell 層の責務と I/O 契約を定義する
  - 依存: 1.1
  - 対象: openspec/changes/refactor-codex-wrapper-to-typescript/*
  - フェーズ担当: implement=implementer; review=code-reviewer
  - 成果物: codex_executor.sh の責務と入出力を明記する
- [ ] 1.3 2 層間のインターフェース契約を定義する
  - 依存: 1.1, 1.2
  - 対象: openspec/changes/refactor-codex-wrapper-to-typescript/*
  - フェーズ担当: spec_check=spec-checker; review=code-reviewer
  - 成果物: stdin/stdout/env/exit code の契約を明記する

## 2. 検証項目

### ドキュメント検証
- [ ] `openspec validate refactor-codex-wrapper-to-typescript --strict` が成功する
- [ ] `design.md` に TypeScript 層と Shell 層の責務が明記されている
- [ ] `design.md` に 2 層間のインターフェース契約が明記されている
- [ ] `spec.md` に各層の要件とシナリオが定義されている

### 互換性検証
- [ ] 現行 `codex_wrapper.sh` と同等の入出力契約が維持される
- [ ] 環境変数の意味が維持される
- [ ] 4 行出力フォーマットが維持される

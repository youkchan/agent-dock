## 0. Persona Defaults
- persona_defaults: {"phase_order":["implement","review","spec_check","test"]}
- personas: [{"id":"implementer","role":"implementer","focus":"implementation","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}},{"id":"code-reviewer","role":"reviewer","focus":"quality","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}},{"id":"spec-checker","role":"spec_guard","focus":"spec consistency","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}},{"id":"test-owner","role":"test_guard","focus":"test sufficiency","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}}]

## 1. 実装タスク
- [ ] T-001 仕様を定義する（`requires_plan=true`）
  - 依存: なし
  - 対象: src/a.ts, src/b.ts
  - フェーズ担当: implement=implementer; review=code-reviewer
- [ ] T-002 実装する
  - 依存: T-001
  - フェーズ担当: implement=implementer; test=test-owner

## 2. 検証項目
- [x] `deno test src --allow-read --allow-write --allow-run --allow-env` が通る
- [ ] `deno test -A src` が通る

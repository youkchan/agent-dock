## 0. Persona Defaults
- persona_defaults.phase_order: implement, review, spec_check, test
- persona_defaults: {"phase_order":["implement","review","spec_check","test"]}
- フェーズ担当: implement=implementer; review=code-reviewer; spec_check=spec-checker; test=test-owner
- personas: [{"id":"implementer","role":"implementer","focus":"実装を前進させる","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}},{"id":"code-reviewer","role":"reviewer","focus":"品質と回帰リスクを確認する","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}},{"id":"spec-checker","role":"spec_guard","focus":"仕様逸脱を防ぐ","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}},{"id":"test-owner","role":"test_guard","focus":"検証の十分性を担保する","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}}]

### 0.1 テンプレート利用ルール
- この雛形を `openspec/changes/<change-id>/tasks.md` にコピーし、`<...>` を実タスクで置換する。
- `persona_defaults.phase_order` と `フェーズ担当` の固定行は削除しない。
- `personas:` は **1行JSON** で記述する（YAMLの複数行形式は compiler が受理しない）。
- ペルソナを実行主体にする場合は `personas` 行を残す。消すと実行主体は `teammate-*` になる。
- 各タスクに `- フェーズ担当:` を記述し、`implement=implementer; review=code-reviewer; spec_check=spec-checker; test=test-owner` から必要なフェーズだけ選ぶ。
- 例: `- フェーズ担当: implement=implementer; review=code-reviewer`（未指定フェーズはグローバル既定を使う）。

## 1. 実装タスク
- [ ] 1.1 Lead decision JSON 出力上限を強化する
  - 依存: なし
  - 対象: src/infrastructure/provider/factory.ts, src/domain/decision.ts
  - フェーズ担当: implement=implementer; review=code-reviewer
  - 成果物: 既存の `reason_short/text_short/feedback` 文字数上限を維持しつつ、`decisions/task_updates/messages` の件数上限をスキーマとバリデーションに反映
- [ ] 1.2 Lead snapshot を軽量化する
  - 依存: 1.1
  - 対象: src/application/orchestrator/orchestrator.ts
  - フェーズ担当: implement=implementer; review=code-reviewer
  - 成果物: provider 入力から `completed` タスクを除外し、`recent_messages` 件数を削減
- [ ] 1.3 incomplete 時リトライ条件を調整する
  - 依存: 1.1, 1.2
  - 対象: src/infrastructure/provider/factory.ts
  - フェーズ担当: implement=implementer; review=code-reviewer
  - 成果物: 既存の1回リトライ実装を `status=incomplete` かつ `reason=max_output_tokens` 条件に限定し、再失敗時は fail-closed で停止
- [ ] 1.4 回帰テストを追加する
  - 依存: 1.1, 1.2, 1.3
  - 対象: src/application/orchestrator/orchestrator_test.ts, src/cli/main_test.ts, src/infrastructure/provider/factory_test.ts
  - フェーズ担当: spec_check=spec-checker; test=test-owner
  - 成果物: 出力上限、snapshot 軽量化、incomplete 再問い合わせ、再失敗停止のテストを追加
- [ ] 1.5 運用ドキュメントを更新する
  - 依存: 1.3, 1.4
  - 対象: README.md
  - フェーズ担当: spec_check=spec-checker; review=code-reviewer
  - 成果物: 推奨トークン設定と provider_error 再発時の再開手順を追記

## 2. 検証項目
- [ ] `deno task check`
- [ ] `deno test src/application/orchestrator/orchestrator_test.ts src/infrastructure/provider/factory_test.ts src/cli/main_test.ts`
- [ ] `agent-dock --openspec-change add-openai-decision-output-guardrails --provider openai --state-dir /tmp/codex_agent_openai_state --resume` で `provider_error(max_output_tokens)` が再現しないこと

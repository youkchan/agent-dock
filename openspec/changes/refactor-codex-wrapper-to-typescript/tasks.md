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
- すべての実施項目（検証を含む）は **`## 1. 実装タスク` のチェックボックス付きタスク** として記述する（`## 2. 検証項目` は使わない）。
- 人間向けメモは `## 2. 人間向けメモ（コンパイラ非対象）` に **チェックボックスなし** で記述する。

### 0.2 Provider 完了判定ゲート（固定）
- `ORCHESTRATOR_PROVIDER=mock` 実行のみでは完了扱いにしない。
- 対象プロジェクトの実運用実行経路での受け入れ実行を必須とする。
- `not implemented` 等の未実装エラーは未完了として扱う（fail-closed）。

## 1. 実装タスク
- [ ] 1.1 TypeScript 層の責務と I/O 契約を定義する
  - 依存: なし
  - 対象: openspec/changes/refactor-codex-wrapper-to-typescript/design.md
  - フェーズ担当: implement=implementer; review=code-reviewer
  - 成果物: `src/infrastructure/adapter/codex/` 配下のモジュール責務、入力、出力、エラー方針を明記する。
- [ ] 1.2 Shell 層の責務と I/O 契約を定義する
  - 依存: 1.1
  - 対象: openspec/changes/refactor-codex-wrapper-to-typescript/design.md
  - フェーズ担当: implement=implementer; review=code-reviewer
  - 成果物: `codex_executor.sh` の責務（exec 実行、ストリーム制御、4行出力、終了コード）と入出力を明記する。
- [ ] 1.3 2 層間のインターフェース契約を定義する
  - 依存: 1.1, 1.2
  - 対象: openspec/changes/refactor-codex-wrapper-to-typescript/design.md
  - フェーズ担当: review=code-reviewer; spec_check=spec-checker
  - 成果物: TypeScript→Shell、Shell→TypeScript の stdin/stdout/env/exit code 契約を明記する。
- [ ] 1.4 spec delta を更新し、各層の要件とシナリオを定義する
  - 依存: 1.1, 1.2, 1.3
  - 対象: openspec/changes/refactor-codex-wrapper-to-typescript/specs/codex-wrapper/spec.md
  - フェーズ担当: implement=implementer; review=code-reviewer
  - 成果物: TypeScript 層、Shell 層、層間インターフェースに対する Requirement/Scenario を追加・更新する。
- [ ] 1.5 proposal を更新し、スコープと非目標を設計内容と一致させる
  - 依存: 1.1, 1.2, 1.3, 1.4
  - 対象: openspec/changes/refactor-codex-wrapper-to-typescript/proposal.md
  - フェーズ担当: review=code-reviewer; spec_check=spec-checker
  - 成果物: 背景、変更内容、非目標、期待成果、影響範囲を最新設計と矛盾なく整合させる。
- [ ] 1.6 互換性契約（既存 wrapper 同等性）を明文化する
  - 依存: 1.3, 1.4
  - 対象: openspec/changes/refactor-codex-wrapper-to-typescript/design.md, openspec/changes/refactor-codex-wrapper-to-typescript/specs/codex-wrapper/spec.md
  - フェーズ担当: review=code-reviewer; spec_check=spec-checker
  - 成果物: 現行 `codex_wrapper.sh` と同等の入出力契約、環境変数の意味、4行出力フォーマット維持を要件化する。
- [ ] 1.7 Provider 完了判定ゲートを設計文書へ反映する
  - 依存: 1.5
  - 対象: openspec/changes/refactor-codex-wrapper-to-typescript/design.md
  - フェーズ担当: spec_check=spec-checker; test=test-owner
  - 成果物: `mock` 単独完了禁止、実運用経路での受け入れ必須、未実装エラー fail-closed を明記する。
- [ ] 1.8 `openspec validate refactor-codex-wrapper-to-typescript --strict` を成功させる
  - 依存: 1.4, 1.5, 1.6, 1.7
  - 対象: openspec/changes/refactor-codex-wrapper-to-typescript/proposal.md, openspec/changes/refactor-codex-wrapper-to-typescript/design.md, openspec/changes/refactor-codex-wrapper-to-typescript/tasks.md, openspec/changes/refactor-codex-wrapper-to-typescript/specs/codex-wrapper/spec.md
  - フェーズ担当: spec_check=spec-checker; test=test-owner
  - 成果物: strict validation が通過し、OpenSpec change 一式がコンパイラ受理形式で整合している状態にする。

## 2. 人間向けメモ（コンパイラ非対象）
- メモ: この change は実装ではなく設計定義と仕様化が対象で、実コード移行は別 change で実施する。
- 注意: 実装 change では `codex_wrapper.sh` を即時削除せず、互換確認後に段階移行する。

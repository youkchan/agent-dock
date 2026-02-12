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
- [x] 1.1 `spec-creator polish` の CLI 契約と fail-closed 条件を実装する
  - 依存: なし
  - 対象: src/cli/main.ts, src/cli/main_test.ts
  - フェーズ担当: implement=implementer; review=code-reviewer
  - 成果物: `agent-dock spec-creator polish --change-id <id>` を追加し、`--change-id` 未指定と対象 change 非存在時に即エラーで終了する。
- [x] 1.2 change 配下の再帰走査とファイル分類を実装する
  - 依存: 1.1
  - 対象: src/infrastructure/openspec/spec_creator.ts, src/infrastructure/openspec/spec_creator_test.ts
  - フェーズ担当: implement=implementer; review=code-reviewer
  - 成果物: `openspec/changes/<change-id>/` 配下を再帰走査し、Markdown と非Markdownを判定して処理キューを構築する。
- [x] 1.3 Markdown 整備ロジックを実装する
  - 依存: 1.2
  - 対象: src/infrastructure/openspec/spec_creator.ts, src/infrastructure/openspec/template.ts, src/infrastructure/openspec/spec_creator_test.ts
  - フェーズ担当: implement=implementer; review=code-reviewer
  - 成果物: `*.md` に対して整形、不足固定行補完、見出し正規化を適用し、再実行時に差分ゼロとなるよう冪等化する。
- [x] 1.4 非Markdown整合チェックと警告出力を実装する
  - 依存: 1.2
  - 対象: src/infrastructure/openspec/spec_creator.ts, src/infrastructure/openspec/spec_creator_test.ts
  - フェーズ担当: implement=implementer; review=code-reviewer
  - 成果物: 非Markdown (`yaml/json` 等) は無変更を維持し、整合チェック結果のみを警告として出力する。
- [x] 1.5 実行結果サマリ出力を実装する
  - 依存: 1.3, 1.4
  - 対象: src/cli/main.ts, src/cli/main_test.ts, src/infrastructure/openspec/spec_creator.ts
  - フェーズ担当: implement=implementer; review=code-reviewer
  - 成果物: 対象総ファイル数、変更ファイル一覧、整備ルール別適用件数を標準出力へ出し、変更なし時の表示を定義する。
- [x] 1.6 受け入れ条件を自動検証する
  - 依存: 1.1, 1.3, 1.4, 1.5
  - 対象: src/infrastructure/openspec/spec_creator_test.ts, src/cli/main_test.ts, tests/test_openspec_compiler.py
  - フェーズ担当: spec_check=spec-checker; test=test-owner
  - 成果物: 非存在 change-id の失敗、`compile-openspec` 成功、再実行差分ゼロ、非Markdown無変更をテストで担保する。

## 2. 人間向けメモ（コンパイラ非対象）
- 要件メモ: 対象は `openspec/changes/<change-id>/` 配下の全ファイル（再帰）に固定する。
- 要件メモ: `*.md` は整形・固定行補完・見出し正規化を行い、非Markdownは整合チェックのみで内容を変更しない。
- 要件メモ: 出力は総ファイル数、変更ファイル一覧、整備ルール別適用件数を必須とする。
- 非目標メモ: 非Markdownの自動修復と `compile-openspec` 仕様変更は本 change の対象外。
- メモ: 重大違反時は `REVIEWER_STOP:requirement_drift|over_editing|verbosity` を reviewer 出力に含める。

## 0. Persona Defaults
- persona_defaults.phase_order: implement, review, spec_check, test
- persona_defaults: {"phase_order":["implement","review","spec_check","test"]}
- フェーズ担当: implement=implementer; review=code-reviewer; spec_check=spec-checker; test=test-owner
- personas: [{"id":"implementer","role":"implementer","focus":"実装を前進させる","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}},{"id":"code-reviewer","role":"reviewer","focus":"品質と回帰リスクを確認する","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}},{"id":"spec-checker","role":"spec_guard","focus":"仕様逸脱を防ぐ","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}},{"id":"test-owner","role":"test_guard","focus":"検証の十分性を担保し、要件ごとにtransport経路テストとfail-closed拒否テストを確認する","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}}]

### 0.1 テンプレート利用ルール
- この雛形を `openspec/changes/<change-id>/tasks.md` にコピーし、`<...>` を実タスクで置換する。
- `persona_defaults.phase_order` と `フェーズ担当` の固定行は削除しない。
- `personas:` は1行JSONで記述する。
- すべての実施項目（検証を含む）は `## 1. 実装タスク` のチェックボックス付きタスクとして記述する。
- MUST/SHALL ごとに `transport` 経路、fail-closed 拒否点、経路テスト1件 + 拒否テスト1件を定義する。

### 0.2 Provider 完了判定ゲート（固定）
- `ORCHESTRATOR_PROVIDER=mock` 実行のみでは完了扱いにしない。
- 対象プロジェクトの実運用実行経路での受け入れ実行を必須とする。
- `not implemented` 等の未実装エラーは未完了として扱う（fail-closed）。

### 0.3 Reviewer 停止判定ゲート（固定）
- `spec-reviewer` が重大違反を検出したら `REVIEWER_STOP:requirement_drift|over_editing|verbosity` を出力する。
- `REVIEWER_STOP:` を含むレビュー結果は blocker として停止判定する。

## 1. 実装タスク
- [ ] 1.1 要件をOpenSpec要素へ正規化する
  - 依存: なし
  - 対象: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/proposal.md, openspec/changes/refactor-spec-creator-and-orchestrator-modularization/tasks.md, openspec/changes/refactor-spec-creator-and-orchestrator-modularization/code_summary.md, openspec/changes/refactor-spec-creator-and-orchestrator-modularization/specs/**/spec.md
  - 関連許可: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/design.md
  - フェーズ担当: implement=implementer; review=code-reviewer
  - 成果物: requirements_text を整理し、change の最小スコープを定義する。
- [ ] 1.2 proposal.md を生成する
  - 依存: 1.1
  - 対象: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/proposal.md
  - 関連許可: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/design.md
  - フェーズ担当: implement=implementer; review=code-reviewer
  - 成果物: 変更理由、変更内容、影響範囲を proposal.md に記述する。
- [ ] 1.3 tasks.md を固定テンプレート準拠で生成する
  - 依存: 1.2
  - 対象: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/tasks.md
  - 関連許可: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/design.md
  - フェーズ担当: implement=implementer; review=code-reviewer
  - 成果物: `print-openspec-template` の固定行維持、`## 1. 実装タスク` checklist 形式、RC-01..RC-12 の同義反映。
  - RC-01: RESULT の最終 block 抽出と completed|blocked 正規化を定義する。
  - RC-02: SUMMARY の抽出・必須化・用途を定義する。
  - RC-03: CHANGED_FILES の正規化、非implementで `(none)` 必須を定義する。
  - RC-04: CHECKS の抽出・必須化・禁止コマンド検査を定義する。
  - RC-05: JUDGMENT の必須化と pass|changes_required|blocked 正規化を定義する。
  - RC-06: 判定時系列（blocked停止 / changes_required sendback / pass前進）を定義する。
  - RC-07: `REVIEWER_STOP:requirement_drift|over_editing|verbosity` を明記する。
  - RC-08: 実行経路対象を run と spec-creator の両方とする。
  - RC-09: compile と runtime の責務分離を明記する。
  - RC-10: 入力契約キー `task_config.persona_policy.phase_overrides.<phase>.executor_personas` を明記する。
  - RC-11: sendback 条件に `blocked=false` 前提を明記する。
  - RC-12: MUST/SHALL ごとに経路テスト1件 + fail-closed拒否テスト1件を要求する。
  - fail-closed: RC 欠落、固定テンプレート行欠落、checklist 形式逸脱は reject とする。
- [ ] 1.4 必要時に design.md を生成する
  - 依存: 1.2
  - 対象: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/design.md
  - 関連許可: なし
  - フェーズ担当: implement=implementer; review=code-reviewer
  - 成果物: 設計上の判断が必要な場合のみ design.md を作成し、意思決定とトレードオフを記述する。
- [ ] 1.5 code_summary.md を生成する
  - 依存: 1.3
  - 対象: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/code_summary.md
  - 関連許可: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/design.md
  - フェーズ担当: implement=implementer; review=code-reviewer
  - 成果物: tasks.md の task_id と code unit の対応を code_summary.md に記述する。
- [ ] 1.6 生成成果物の整合性をレビューする
  - 依存: 1.2, 1.3, 1.4, 1.5
  - 対象: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/proposal.md, openspec/changes/refactor-spec-creator-and-orchestrator-modularization/tasks.md, openspec/changes/refactor-spec-creator-and-orchestrator-modularization/code_summary.md, openspec/changes/refactor-spec-creator-and-orchestrator-modularization/specs/**/spec.md
  - 関連許可: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/design.md
  - フェーズ担当: implement=implementer; review=code-reviewer
  - 成果物: proposal/tasks/design/code_summary の整合、要件逸脱、過剰修正、冗長化を検証する。
- [ ] 1.7 OpenSpec compile + strict validate を実行する
  - 依存: 1.6
  - 対象: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/proposal.md, openspec/changes/refactor-spec-creator-and-orchestrator-modularization/tasks.md, openspec/changes/refactor-spec-creator-and-orchestrator-modularization/code_summary.md, openspec/changes/refactor-spec-creator-and-orchestrator-modularization/specs/**/spec.md
  - 関連許可: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/design.md
  - フェーズ担当: implement=code-reviewer
  - 成果物: `agent-dock compile-openspec --change-id <change_id>` と `openspec validate <change_id> --strict` を実行し、失敗時は修正後に再実行する。

## 2. 人間向けメモ（コンパイラ非対象）
- 参照コンテキストを成果物本文へ転載しないこと（参照ダンプの埋め込み禁止）。
- 生成時に巨大コンテキストが渡されても、出力は要件本文のみを記述すること。

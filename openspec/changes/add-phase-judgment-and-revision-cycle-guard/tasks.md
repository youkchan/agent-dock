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
- [ ] 1.1 要件をOpenSpec要素へ正規化する
  - 依存: なし
  - 対象: openspec/changes/add-phase-judgment-and-revision-cycle-guard/proposal.md, openspec/changes/add-phase-judgment-and-revision-cycle-guard/tasks.md, openspec/changes/add-phase-judgment-and-revision-cycle-guard/design.md, openspec/changes/add-phase-judgment-and-revision-cycle-guard/code_summary.md, openspec/changes/add-phase-judgment-and-revision-cycle-guard/specs/add-phase-judgment-and-revision-cycle-guard/spec.md
  - フェーズ担当: implement=implementer; review=code-reviewer
  - 成果物: requirements_text を MUST/SHALL と受け入れシナリオへ整理し、change の最小スコープを固定する。
- [ ] 1.2 フェーズ判定結果モデルを導入する
  - 依存: 1.1
  - 対象: src/domain/task.ts, src/domain/decision.ts, src/application/orchestrator/orchestrator.ts
  - フェーズ担当: implement=implementer; review=code-reviewer; spec_check=spec-checker
  - 成果物: 判定値 `pass|changes_required|blocked` を扱う共通モデルと正規化処理を追加する。
- [ ] 1.3 changes_required 差し戻し遷移を実装する
  - 依存: 1.2
  - 対象: src/application/orchestrator/orchestrator.ts, src/infrastructure/state/store.ts
  - フェーズ担当: implement=implementer; review=code-reviewer; spec_check=spec-checker
  - 成果物: `changes_required` 時に `status=pending` / `owner=null` / `current_phase_index=implement` を適用し、判定者の連続実行を止める。
- [ ] 1.4 revision cycle guard を実装する
  - 依存: 1.3
  - 対象: src/domain/task.ts, src/infrastructure/state/store.ts, src/application/orchestrator/orchestrator.ts
  - フェーズ担当: implement=implementer; review=code-reviewer
  - 成果物: `revision_count` と `max_revision_cycles` を state 管理し、上限超過時に `needs_approval` へ遷移させる。
- [ ] 1.5 差し戻し通知の標準文言を実装する
  - 依存: 1.3, 1.4
  - 対象: src/application/orchestrator/orchestrator.ts, src/infrastructure/state/store.ts
  - フェーズ担当: implement=implementer; review=code-reviewer
  - 成果物: 差し戻し理由を progress log と mailbox に保存する定型メッセージを追加する。
- [ ] 1.6 orchestrator/state のユニットテストを追加する
  - 依存: 1.2, 1.3, 1.4, 1.5
  - 対象: src/application/orchestrator/orchestrator_test.ts, src/infrastructure/state/store_test.ts
  - フェーズ担当: implement=implementer; review=code-reviewer; test=test-owner
  - 成果物: pass / changes_required / blocked、差し戻し、上限超過遷移をテストで固定する。
- [ ] 1.7 persona mode / teammate mode の回帰を検証する
  - 依存: 1.6
  - 対象: src/application/orchestrator/orchestrator_test.ts
  - フェーズ担当: implement=implementer; review=code-reviewer; spec_check=spec-checker; test=test-owner
  - 成果物: persona mode は新挙動、teammate mode は既存挙動維持を確認し、`openspec validate add-phase-judgment-and-revision-cycle-guard --strict` を通過させる。

## 2. 人間向けメモ（コンパイラ非対象）
- MUST: 本変更の実装対象は TypeScript runtime（`src/**`）のみとし、Python runtime（`team_orchestrator/**`）は変更対象外とする。
- MUST: implement 以外のフェーズは判定のみを行う。
- MUST: 判定値は `pass|changes_required|blocked` の3値に統一する。
- MUST: `changes_required` は implement へ差し戻し、理由を progress log と mailbox に残す。
- MUST: `revision_count > max_revision_cycles` で `needs_approval` へ遷移して停止する。
- MUST: teammate 実行モードの挙動は変更しない。
- 非目標: Lead decision JSON、task config 全面改定、provider 切替ロジックは変更しない。

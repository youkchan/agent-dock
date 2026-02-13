# code_summary.md

`openspec/changes/add-phase-judgment-and-revision-cycle-guard/tasks.md` の `task_id` と code unit 対応表。  
本 change の実装対象は TypeScript runtime（`src/**`）のみ。

## task_id: 1.1

### code_unit_1
- file: openspec/changes/add-phase-judgment-and-revision-cycle-guard/proposal.md
- service: openspec-change-doc
- function: normalize-change-scope
- purpose: requirements_text を proposal の Why/What Changes/Impact に正規化する。
- input: requirements_text
- output: 最小スコープの提案定義
- error: 非目標混入は仕様差し戻し
- test: `openspec validate add-phase-judgment-and-revision-cycle-guard --strict`

### code_unit_2
- file: openspec/changes/add-phase-judgment-and-revision-cycle-guard/tasks.md
- service: openspec-task-plan
- function: align-task-breakdown
- purpose: 要求仕様を実装タスクへ分解し、依存関係と担当フェーズを固定する。
- input: 正規化済み要件
- output: チェックボックス付き実装タスク
- error: 依存や対象パス欠落は計画不備
- test: `openspec validate add-phase-judgment-and-revision-cycle-guard --strict`

### code_unit_3
- file: openspec/changes/add-phase-judgment-and-revision-cycle-guard/design.md
- service: openspec-design
- function: define-transition-design
- purpose: 判定モデル、差し戻し遷移、revision guard の設計を明文化する。
- input: requirements_text と非目標
- output: 実装判断の設計境界
- error: teammate 互換性境界の欠落は設計不備
- test: design 記述レビュー

### code_unit_4
- file: openspec/changes/add-phase-judgment-and-revision-cycle-guard/code_summary.md
- service: openspec-traceability
- function: map-task-to-code-unit
- purpose: task_id ごとの対象 code unit を追跡可能な形で列挙する。
- input: tasks.md の task_id/対象
- output: task_id-code unit 対応表
- error: 対象ファイルの対応漏れは追跡性欠如
- test: `rg -n "task_id|file:" openspec/changes/add-phase-judgment-and-revision-cycle-guard/code_summary.md`

### code_unit_5
- file: openspec/changes/add-phase-judgment-and-revision-cycle-guard/specs/add-phase-judgment-and-revision-cycle-guard/spec.md
- service: openspec-delta-spec
- function: encode-requirements-as-scenarios
- purpose: MUST/SHALL を Requirement/Scenario 形式へ展開する。
- input: 正規化済み要件
- output: ADDED Requirements と受け入れシナリオ
- error: Scenario 欠落は validate 失敗
- test: `openspec validate add-phase-judgment-and-revision-cycle-guard --strict`

## task_id: 1.2

### code_unit_1
- file: src/domain/task.ts
- service: task-model-ts
- function: phase-judgment-task-fields
- purpose: `pass|changes_required|blocked` 判定値を扱うための task 側フィールド/型を定義する。
- input: phase 実行結果
- output: 正規化済み判定値を保持できる task モデル
- error: 未知判定値は不正入力扱い
- test: `deno test src/domain/task_test.ts`

### code_unit_2
- file: src/domain/decision.ts
- service: decision-model-ts
- function: phase-judgment-normalizer
- purpose: 判定値 `pass|changes_required|blocked` の正規化・検証を定義する。
- input: 判定フェーズ出力
- output: 正規化済み判定値
- error: 判定未処理は遷移不整合
- test: `deno test src/infrastructure/provider/factory_test.ts`

### code_unit_3
- file: src/application/orchestrator/orchestrator.ts
- service: execution-orchestrator-ts
- function: consume-phase-judgment
- purpose: 判定モデルを遷移分岐へ組み込み、フェーズ処理へ適用する。
- input: 正規化済み判定値
- output: pass/changes_required/blocked 分岐
- error: 判定未処理は遷移不整合
- test: `deno test src/application/orchestrator/orchestrator_test.ts`

## task_id: 1.3

### code_unit_1
- file: src/application/orchestrator/orchestrator.ts
- service: execution-orchestrator-ts
- function: sendback-to-implement
- purpose: `changes_required` 時に implement へ差し戻す遷移を実装する。
- input: 判定フェーズの実行結果
- output: `status=pending`, `owner=null`, `current_phase_index=implement`
- error: 差し戻し失敗時は停止/要確認扱い
- test: `deno test src/application/orchestrator/orchestrator_test.ts`

### code_unit_2
- file: src/infrastructure/state/store.ts
- service: state-store-ts
- function: persist-sendback-transition
- purpose: 差し戻し時の status/owner/phase index 更新を永続化する。
- input: task_id と差し戻し更新内容
- output: 更新済み task state
- error: 不正遷移は保存拒否
- test: `deno test src/infrastructure/state/store_test.ts`

## task_id: 1.4

### code_unit_1
- file: src/domain/task.ts
- service: task-model-ts
- function: revision-cycle-fields
- purpose: `revision_count` と `max_revision_cycles` を task state に追加する。
- input: 既存 task payload
- output: 拡張 task payload
- error: 不正値はデフォルトへ補正
- test: `deno test src/domain/task_test.ts`

### code_unit_2
- file: src/infrastructure/state/store.ts
- service: state-store-ts
- function: persist-revision-cycle
- purpose: revision カウンタ更新を永続化し再開時も保持する。
- input: revision 更新イベント
- output: 永続化済み revision 値
- error: 保存失敗時は更新ロスト
- test: `deno test src/infrastructure/state/store_test.ts`

### code_unit_3
- file: src/application/orchestrator/orchestrator.ts
- service: execution-orchestrator-ts
- function: enforce-revision-cycle-guard
- purpose: `revision_count > max_revision_cycles` で `needs_approval` へ遷移する。
- input: revision_count と max_revision_cycles
- output: 継続可否判定
- error: 上限判定ミスは無限ループ誘発
- test: `deno test src/application/orchestrator/orchestrator_test.ts`

## task_id: 1.5

### code_unit_1
- file: src/application/orchestrator/orchestrator.ts
- service: execution-orchestrator-ts
- function: compose-sendback-message
- purpose: 差し戻し理由を含む progress log/mailbox 用の標準文言を生成する。
- input: task_id, phase, reason, revision_count
- output: 定型通知メッセージ
- error: 理由欠落時は監査情報不足
- test: `deno test src/application/orchestrator/orchestrator_test.ts`

### code_unit_2
- file: src/infrastructure/state/store.ts
- service: state-store-ts
- function: persist-sendback-audit-trail
- purpose: 差し戻し理由を progress log と mailbox へ保存する。
- input: sendback 通知 payload
- output: 永続化された監査ログ
- error: 片系保存失敗は追跡欠損
- test: `deno test src/infrastructure/state/store_test.ts`

## task_id: 1.6

### code_unit_1
- file: src/application/orchestrator/orchestrator_test.ts
- service: orchestrator-test-ts
- function: verify-phase-judgment-transitions
- purpose: pass/changes_required/blocked と差し戻し遷移を固定する。
- input: 各判定値の実行結果
- output: status/owner/current_phase_index の期待一致
- error: 誤遷移は assertion failure
- test: `deno test src/application/orchestrator/orchestrator_test.ts`

### code_unit_2
- file: src/infrastructure/state/store_test.ts
- service: state-store-test-ts
- function: verify-revision-persistence
- purpose: revision_count/max_revision_cycles の保存・更新を検証する。
- input: state 更新シーケンス
- output: 永続化後の状態一致
- error: 永続化不整合は assertion failure
- test: `deno test src/infrastructure/state/store_test.ts`

## task_id: 1.7

### code_unit_1
- file: src/application/orchestrator/orchestrator_test.ts
- service: orchestrator-regression-test-ts
- function: verify-persona-vs-teammate-regression
- purpose: persona mode は新挙動、teammate mode は既存挙動維持を検証する。
- input: persona 有効ケースと無効ケース
- output: mode 別遷移の期待一致
- error: teammate 回帰は assertion failure
- test: `deno test src/application/orchestrator/orchestrator_test.ts`

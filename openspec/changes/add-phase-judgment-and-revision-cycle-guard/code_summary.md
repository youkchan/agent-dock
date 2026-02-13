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

### code_unit_6
- file: openspec/changes/add-phase-judgment-and-revision-cycle-guard/specs/runtime-platform-migration/spec.md
- service: openspec-delta-spec
- function: align-wrapper-output-contract
- purpose: wrapper 出力契約を implement=4行維持 / 判定フェーズ=5行拡張（`JUDGMENT`）として既存仕様と整合させる。
- input: 判定3値化要件
- output: runtime-platform-migration への MODIFIED 要件
- error: 既存 wrapper 契約との矛盾は仕様衝突
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

### code_unit_4
- file: src/infrastructure/wrapper/helper.ts
- service: wrapper-helper-ts
- function: judgment-result-contract
- purpose: 判定フェーズで `JUDGMENT` を含む結果ブロックを抽出できるようにする。
- input: teammate の execute 出力
- output: `RESULT/SUMMARY/CHANGED_FILES/CHECKS/JUDGMENT` を扱える抽出結果
- error: `JUDGMENT` 欠落や未知値は fail-closed
- test: `deno test src/infrastructure/wrapper/helper_test.ts`

### code_unit_5
- file: docs/ts-wrapper-contract.md
- service: wrapper-contract-doc
- function: define-judgment-contract
- purpose: 判定フェーズの `JUDGMENT` 契約、`RESULT` との優先順位、`CHANGED_FILES` 空表現（`(none)` 正規値）と fail-closed 条件を仕様化する。
- input: 3値判定要件
- output: 実装間で一貫した I/O 契約
- error: 契約未定義は実装解釈ブレ
- test: 設計記述レビュー

## task_id: 1.3

### code_unit_1
- file: src/application/orchestrator/orchestrator.ts
- service: execution-orchestrator-ts
- function: sendback-to-implement
- purpose: `changes_required` 時に implement へ差し戻す遷移を実装し、非implement編集違反を `blocked` へ倒す。
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

### code_unit_3
- file: src/infrastructure/wrapper/helper.ts
- service: wrapper-helper-ts
- function: changed-files-contract
- purpose: `CHANGED_FILES` を正規化し、非implementフェーズ編集違反判定に必要な入力を提供する。
- input: teammate の execute 出力
- output: `CHANGED_FILES` の正規化済み配列/空判定
- error: 解析失敗や不正値は fail-closed
- test: `deno test src/infrastructure/wrapper/helper_test.ts`

### code_unit_4
- file: src/cli/main.ts
- service: cli-runtime-ts
- function: wire-persona-sandbox-to-adapter
- purpose: persona の `execution.sandbox` を実行時 `CODEX_SANDBOX` に反映できるよう adapter 呼び出しを接続する。
- input: 実行主体 persona の execution profile
- output: phase ごとに適用される sandbox 設定
- error: sandbox 未反映は implement-only 制約の形骸化
- test: `deno test src/cli/main_test.ts`

### code_unit_5
- file: src/infrastructure/adapter/subprocess.ts
- service: subprocess-adapter-ts
- function: per-execution-env-override
- purpose: 実行ごとに `CODEX_SANDBOX` を上書きできる経路を提供する。
- input: 実行時 env override
- output: subprocess 起動時の反映済み env
- error: 固定 env のままでは phase 別 sandbox が効かない
- test: `deno test src/infrastructure/adapter/subprocess_test.ts`

## task_id: 1.4

### code_unit_1
- file: src/domain/task.ts
- service: task-model-ts
- function: revision-cycle-fields
- purpose: `revision_count` と `max_revision_cycles` を task state に追加し、`revision_count` 初期値を `0` に固定する。
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
- purpose: `revision_count > max_revision_cycles` で `needs_approval` へ遷移し、`changes_required` 時のみ加算・`pass` 非リセット・resume保持を実装する。`max_revision_cycles` 未設定時は `3` を既定補完し、不正値は compile fail-closed とする。
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

### code_unit_3
- file: src/infrastructure/wrapper/helper_test.ts
- service: wrapper-helper-test-ts
- function: verify-judgment-and-changed-files-contract
- purpose: `JUDGMENT` 抽出、欠落時 fail-closed、`CHANGED_FILES` 非空判定を固定する。
- input: 判定フェーズ出力サンプル
- output: 契約どおりの抽出/エラー判定
- error: 契約逸脱は assertion failure
- test: `deno test src/infrastructure/wrapper/helper_test.ts`

### code_unit_4
- file: src/cli/main_test.ts
- service: cli-test-ts
- function: verify-persona-sandbox-wiring
- purpose: persona の `execution.sandbox` が adapter 起動環境へ反映されることを検証する。
- input: implement/review の persona execution profile
- output: `CODEX_SANDBOX` の期待一致
- error: sandbox 未反映は assertion failure
- test: `deno test src/cli/main_test.ts`

### code_unit_5
- file: src/infrastructure/adapter/subprocess_test.ts
- service: subprocess-adapter-test-ts
- function: verify-per-execution-env-override
- purpose: subprocess 実行時に `CODEX_SANDBOX` 上書きが有効になることを検証する。
- input: env override 付き execute 呼び出し
- output: spawn env の期待一致
- error: 実行ごと env 反映漏れは assertion failure
- test: `deno test src/infrastructure/adapter/subprocess_test.ts`

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

### code_unit_2
- file: src/infrastructure/openspec/compiler.ts
- service: openspec-compiler-ts
- function: validate-implement-phase-presence
- purpose: `phase_order` に implement が存在しない task 構成を compile 時に reject する。
- input: tasks.md 由来の persona policy / phase_order
- output: implement 必須制約を満たした task config
- error: implement 欠落は compile fail-closed
- test: `deno test src/infrastructure/openspec/compiler_test.ts`

### code_unit_3
- file: src/infrastructure/openspec/compiler_test.ts
- service: openspec-compiler-test-ts
- function: verify-implement-phase-rejection
- purpose: implement 欠落構成の compile reject とエラー理由を固定する。
- input: implement 欠落 fixture
- output: 期待どおりの compile 失敗
- error: 制約漏れは assertion failure
- test: `deno test src/infrastructure/openspec/compiler_test.ts`

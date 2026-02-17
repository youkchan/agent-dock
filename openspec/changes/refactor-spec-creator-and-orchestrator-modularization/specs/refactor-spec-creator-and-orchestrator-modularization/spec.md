## ADDED Requirements
### Requirement: refactor-spec-creator-and-orchestrator-modularization generated baseline
The system SHALL keep OpenSpec artifacts aligned for this change.

#### Scenario: Spec creator baseline is generated
- **WHEN** spec creator runs for this change
- **THEN** proposal/tasks/design/code_summary and this delta SHALL be generated
- **AND** requirements memo SHALL be captured: polish target: refactor-spec-creator-and-orchestrator-modularization
source_markdown_context:
### openspec/changes/refactor-spec-creator-and-orchestrator-modularization/code_summary.md
# code_summary.md

Implementation mapping from tasks.md to code units.

## task_id: 1.1

### code_unit_1
- file: <replace-with-target-file-1.1-1>
- service: <replace-with-service-1.1-1>
- function: <replace-with-function-1.1-1>
- purpose: <replace-with-purpose-1.1-1>
- input: <replace-with-input-1.1-1>
- output: <replace-with-output-1.1-1>
- error: <replace-with-error-1.1-1>
- test: <replace-with-test-1.1-1>

## task_id: 1.2

### code_unit_1
- file: <replace-with-target-file-1.2-1>
- service: <replace-with-service-1.2-1>
- function: <replace-with-function-1.2-1>
- purpose: <replace-with-purpose-1.2-1>
- input: <replace-with-input-1.2-1>
- output: <replace-with-output-1.2-1>
- error: <replace-with-error-1.2-1>
- test: <replace-with-test-1.2-1>

## task_id: 1.3

### code_unit_1
- file: <replace-with-target-file-1.3-1>
- service: <replace-with-service-1.3-1>
- function: <replace-with-function-1.3-1>
- purpose: <replace-with-purpose-1.3-1>
- input: <replace-with-input-1.3-1>
- output: <replace-with-output-1.3-1>
- error: <replace-with-error-1.3-1>
- test: <replace-with-test-1.3-1>

## task_id: 1.5

### code_unit_1
- file: <replace-with-target-file-1.5-1>
- service: <replace-with-service-1.5-1>
- function: <replace-with-function-1.5-1>
- purpose: <replace-with-purpose-1.5-1>
- input: <replace-with-input-1.5-1>
- output: <replace-with-output-1.5-1>
- error: <replace-with-error-1.5-1>
- test: <replace-with-test-1.5-1>

## task_id: 1.6

### code_unit_1
- file: <replace-with-target-file-1.6-1>
- service: <replace-with-service-1.6-1>
- function: <replace-with-function-1.6-1>
- purpose: <replace-with-purpose-1.6-1>
- input: <replace-with-input-1.6-1>
- output: <replace-with-output-1.6-1>
- error: <replace-with-error-1.6-1>
- test: <replace-with-test-1.6-1>

## task_id: 1.7

### code_unit_1
- file: <replace-with-target-file-1.7-1>
- service: <replace-with-service-1.7-1>
- function: <replace-with-function-1.7-1>
- purpose: <replace-with-purpose-1.7-1>
- input: <replace-with-input-1.7-1>
- output: <replace-with-output-1.7-1>
- error: <replace-with-error-1.7-1>
- test: <replace-with-test-1.7-1>
### openspec/changes/refactor-spec-creator-and-orchestrator-modularization/design.md
# Design: refactor-spec-creator-and-orchestrator-modularization

## design.md を作成する判断
この変更は以下に該当するため、`design.md` を作成・維持して設計判断を固定する。
- `main.ts` / `spec_creator.ts` / `orchestrator.ts` / `helper.ts` など複数モジュールに跨る責務再編
- 実行結果解釈（RESULT/SUMMARY/CHANGED_FILES/CHECKS/JUDGMENT）の共通化という横断判断
- 段階的移行順序を誤ると挙動差分が混入しやすい領域
- テスト green だけでなく意味論（sendback/blocked/イベント順序）の不変条件を明示する必要

## Context
- `spec-creator` / `orchestrator` 周辺は単一ファイルへの責務集中が進み、変更時の影響範囲とレビュー観点の追跡が難しい。
- 仕様上は通るが運用上の意味論がずれる問題が発生しており、構造起因の再発リスクがある。
- 本 change は「挙動不変」を前提に、責務分割と共通化のみを行う。

## Goals
- 構造分割で変更影響を局所化する。
- レビュー時に確認すべき責務境界を固定する。
- 完了判定を形式一致だけでなく意味論一致まで安定化する。

## Non-Goals
- 新規機能追加、判定ルール変更、公開シグネチャ変更。
- 責務分割と無関係な最適化、広域リネーム、仕様文言変更。

## 判定時系列と固定ゲート
- 判定時系列は `implement -> review -> spec_check -> test` を固定し、段階責務の逆流を許容しない。
- `review` で `REVIEWER_STOP:requirement_drift|over_editing|verbosity` を検出した場合は blocker として停止する。
- `test` 完了判定では `ORCHESTRATOR_PROVIDER=mock` 単独実行を不合格とし、`not implemented` は未完了扱いにする。
- 実行結果の入力契約は `RESULT` / `SUMMARY` / `CHANGED_FILES` / `CHECKS` / `JUDGMENT` の5キーを共通正規化対象とする。
- 利用可能性は `tasks.md` の `personas` 定義（`execution.enabled=true`, `command_ref=default`）とフェーズ割当で担保する。

## Decisions and Trade-offs

### 1) 分割順序を固定する
決定:
1. `src/cli/main.ts` 分割
2. result parser 共通化（`src/domain/execution_result.ts`）
3. `spec_creator.ts` 本線/補助分離
4. `orchestrator.ts` 段階抽出

理由:
- 依存の浅い領域から先に分割し、最難所の `orchestrator.ts` を最後に回すことで回帰時の原因切り分けを容易にする。

トレードオフ:
- 先行タスクで一時的な重複状態が残る期間が生まれるが、同時多発の大規模変更より安全性を優先する。

### 2) 「挙動不変」を公開契約と回帰テストで二重固定する
決定:
- `main.ts` に残す公開 export（`main`, `buildTeammateAdapter`, `defaultTeammateCommand`, `parseTeammatesArg`, `collectSpecCreatorApplyManifestForTest`）は不変とする。
- 完了条件は既存テスト green と `deno check` による型整合を必須化する。

理由:
- リファクタの目的は構造改善であり、外部契約の変更は別 change で扱うべきため。

トレードオフ:
- 内部設計の自由度は下がるが、利用側への影響を最小化できる。

### 3) result parser は共通化するが wrapper 固有制約は分離維持する
決定:
- `extractResultBlock` と `parseExecutionResultBlock` の重複は `src/domain/execution_result.ts` に集約する。
- forbidden command 検査など wrapper 固有制約は共通層に取り込まない。

理由:
- 共通化対象を「出力フォーマット解釈」に限定し、ドメイン責務と実行基盤責務の境界を保つ。

トレードオフ:
- 完全統合より実装重複が一部残る可能性はあるが、責務汚染と将来の副作用を抑制できる。

### 4) `spec_creator.ts` は再export ハブへ縮小する
決定:
- prompt/context/polish utilities を別モジュールへ分離し、`spec_creator.ts` は import 互換維持のハブとする。

理由:
- 本線実行経路を追いやすくし、テスト専用補助ロジックとの混在を解消する。

トレードオフ:
- ファイル数増加で探索コストは上がるが、責務境界が明確になりレビュー漏れを減らせる。

### 5) `orchestrator.ts` は pure 関数抽出から段階移行する
決定:
- 先に pure 関数を抽出し、次に decision 評価、最後に decision 実行を抽出する。
- `this.store` / `this.log` / `this.makeEvent` 依存は境界を明示しつつ引数化を進める。

理由:
- もっとも壊れやすい領域であり、責務移動と仕様変更を混在させると回帰要因を特定できなくなるため。

トレードオフ:
- 最終形到達まで段階数が増え実装期間は伸びるが、イベント順序・sendback・blocked 条件の不変を守りやすい。

## Fail-Closed 境界
- CLI 分割: 公開 export 互換崩れまたは `src/cli/main_test.ts` 失敗時は受け入れ不可。
- result parser 共通化: `src/infrastructure/wrapper/helper_test.ts` / `src/application/orchestrator/orchestrator_test.ts` 失敗時は受け入れ不可。
- `spec_creator.ts` 分離: `src/infrastructure/openspec/spec_creator_test.ts` 失敗または実行経路差分検出時は受け入れ不可。
- orchestrator 段階抽出: イベント順序・sendback・blocked 条件の差分検出時は受け入れ不可。

## Alternatives Considered
- 代替案: `main.ts` / parser / `spec_creator.ts` / `orchestrator.ts` を一括分割
  - 却下理由: 変更面積が大きすぎて差分原因の切り分けが困難になり、挙動不変保証が弱くなる。
- 代替案: parser 共通化を見送り、重複実装を維持
  - 却下理由: 判定解釈のズレ温床が残り、意味論一致の安定化という目的に反する。
- 代替案: `orchestrator.ts` をクラス分割から先に実施
  - 却下理由: 依存注入境界が曖昧なまま構造変更すると仕様変更混入リスクが高い。
### openspec/changes/refactor-spec-creator-and-orchestrator-modularization/proposal.md
# Change: <変更概要>

## Why
- polish target: refactor-spec-creator-and-orchestrator-modularization
source_markdown_context:
### openspec/changes/refactor-spec-creator-and-orchestrator-modularization/code_summary.md
# code_summary.md

Implementation mapping from tasks.md to code units.

## task_id: 1.1

### code_unit_1
- file: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/proposal.md
- service: change scope definition
- function: Why / Goals / What Changes / Non-Goals / Impact / Provider・Reviewer 固定ゲート sections
- purpose: requirements_text を OpenSpec proposal の標準要素へ正規化し、change の最小スコープと固定ゲートを明示する。
- input: 背景・目的・対応策の生テキスト
- output: スコープ境界と非スコープを明記した提案文
- error: 要件外の追加やスコープ未固定
- test: `openspec validate refactor-spec-creator-and-orchestrator-modularization --strict`

### code_unit_2
- file: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/specs/refactor-spec-creator-and-orchestrator-modularization/spec.md
- service: normative requirement decomposition
- function: ADDED Requirements
- purpose: 生テキストを SHALL 要件へ分解し、4つの分割対象・挙動不変・Provider/Reviewer 固定ゲートを Requirement/Scenario で定義する。
- input: 4つの対応策と完了条件
- output: 機械可読な OpenSpec delta
- error: Requirement 漏れ、Scenario 未定義
- test: `openspec validate refactor-spec-creator-and-orchestrator-modularization --strict`

### code_unit_3
- file: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/tasks.md
- service: execution traceability
- function: task 1.1 checklist + persona phase order + fixed-gate normalization
- purpose: task 1.1 の完了状態と最小スコープ要約、実行主体割当、固定ゲートを tasks 側に反映し、proposal/spec と整合させる。
- input: 正規化済み要件
- output: 実行計画と要件サマリの一致
- error: checklist と成果物の不一致
- test: `openspec validate refactor-spec-creator-and-orchestrator-modularization --strict`

### code_unit_4
- file: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/design.md
- service: scope boundary and fail-closed gates
- function: Context / Goals / Non-Goals / 判定時系列 / Fail-Closed 境界
- purpose: 変更境界、判定時系列、固定ゲート、回帰時の拒否条件を設計文脈として固定する。
- input: 要件の最小スコープと受け入れ条件
- output: 境界逸脱を防ぐ設計ガード
- error: fail-closed 条件の欠落
- test: `openspec validate refactor-spec-creator-and-orchestrator-modularization --strict`

## task_id: 1.2

### code_unit_1
- file: src/cli/main.ts
- service: CLI entrypoint compatibility
- function: main / buildTeammateAdapter / defaultTeammateCommand / parseTeammatesArg / collectSpecCreatorApplyManifestForTest
- purpose: `main.ts` をコマンドディスパッチ専用に縮小しつつ既存 export 互換を維持する。
- input: argv、環境変数、teammate 実行設定
- output: 分割済み command/args/workflow への委譲と互換 export
- error: 公開シグネチャ差分や分岐欠落
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/cli/main_test.ts`

### code_unit_2
- file: src/cli/commands/spec_creator.ts
- service: spec-creator command execution
- function: specCreatorCommand / specCreatorPolishCommand
- purpose: spec-creator 実行入口を `main.ts` から移設し、実行経路を明示化する。
- input: parse 済み spec-creator 引数、workflow 依存
- output: `runSpecCreatorWorkflow` 呼び出しと終了コード
- error: workflow 呼び出し漏れや polish 分岐崩れ
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/cli/main_test.ts`

### code_unit_3
- file: src/cli/commands/run.ts
- service: run command execution
- function: run command handler
- purpose: run 本体処理と adapter 組み立ての実処理責務を `main.ts` から分離する。
- input: parse 済み run 引数、runtime 設定
- output: run 実行フローの開始と完了状態
- error: run ルートの委譲欠落や引数不整合
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/cli/main_test.ts`

### code_unit_4
- file: src/cli/args/spec_creator_args.ts
- service: spec-creator args parser
- function: parseSpecCreatorArgs / parseSpecCreatorPolishArgs
- purpose: spec-creator 系引数解釈を独立モジュール化し、main から分離する。
- input: CLI 引数配列
- output: 正規化済み spec-creator 実行オプション
- error: 必須引数欠落や不正オプション許容
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/cli/main_test.ts`

### code_unit_5
- file: src/cli/args/run_args.ts
- service: run args parser
- function: parseRunArgs
- purpose: run 用引数解釈を独立化して責務境界を固定する。
- input: CLI 引数配列
- output: 正規化済み run 実行オプション
- error: run 引数の解釈差分
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/cli/main_test.ts`

### code_unit_6
- file: src/cli/spec_creator_workflow.ts
- service: spec-creator workflow orchestration
- function: runSpecCreatorWorkflow / runStagedStrictValidate / runSpecCreatorPostAuditGate / applyStagedArtifactsAtomically
- purpose: staged validate/post-audit/apply を workflow 層へ集約し、command 層と分離する。
- input: command 層から渡される workflow 実行コンテキスト
- output: apply 判定、監査ゲート結果、終了コード
- error: staged 検証スキップや apply 手順差分
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/cli/main_test.ts`

### code_unit_7
- file: src/cli/main_test.ts
- service: CLI regression guard
- function: main command routing and export compatibility tests
- purpose: 分割後も公開 API と実行経路が不変であることを検証する。
- input: CLI サブコマンド/引数のテストケース
- output: 挙動差分の fail-closed 検出
- error: 既存テスト失敗
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/cli/main_test.ts`

## task_id: 1.3

### code_unit_1
- file: src/domain/execution_result.ts
- service: shared execution result parsing contract
- function: result block extraction / judgment normalization / changed-files normalization / phase judgment requirement
- purpose: RESULT/SUMMARY/CHANGED_FILES/CHECKS/JUDGMENT の解釈を単一実装に統一する。
- input: teammate 実行ログ文字列、phase 情報
- output: wrapper/orchestrator 共通の正規化済み実行結果
- error: judgment 欠落や正規化不能値
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/infrastructure/wrapper/helper_test.ts src/application/orchestrator/orchestrator_test.ts`

### code_unit_2
- file: src/infrastructure/wrapper/helper.ts
- service: wrapper integration with shared parser
- function: replace extractResultBlock callsite with shared parser
- purpose: wrapper 側が共通 parser を利用しつつ forbidden command 検査など固有制約は維持する。
- input: wrapper の execute 出力
- output: 共通契約で正規化された result block
- error: wrapper 固有 fail-closed 制約の混在/欠落
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/infrastructure/wrapper/helper_test.ts`

### code_unit_3
- file: src/application/orchestrator/orchestrator.ts
- service: orchestrator integration with shared parser
- function: replace parseExecutionResultBlock callsite with shared parser
- purpose: orchestrator 側の判定入力解釈を domain 共通化に合わせ、解釈差を排除する。
- input: decision/execute フェーズの teammate 出力
- output: 共通契約での判定入力データ
- error: phase 別必須判定の取りこぼし
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/application/orchestrator/orchestrator_test.ts`

### code_unit_4
- file: src/infrastructure/wrapper/helper_test.ts
- service: wrapper parser regression tests
- function: execution result parsing expectations
- purpose: 共通化後も wrapper 側の期待文字列と fail-closed 条件を維持する。
- input: result block サンプル
- output: 既存期待値との一致
- error: 期待文字列差分
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/infrastructure/wrapper/helper_test.ts`

### code_unit_5
- file: src/application/orchestrator/orchestrator_test.ts
- service: orchestrator parser regression tests
- function: execution result parsing and decision feed expectations
- purpose: orchestrator 側で parser 置換後も判定入力の意味論を維持する。
- input: decision フェーズ実行サンプル
- output: 既存期待値との一致
- error: 判定分岐差分
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/application/orchestrator/orchestrator_test.ts`

## task_id: 1.4

### code_unit_1
- file: src/infrastructure/openspec/spec_creator_prompt.ts
- service: spec-creator prompt composition
- function: buildSpecCreatorPolishPrompt
- purpose: polish prompt 生成と language/contract 行生成を本線ロジックから分離する。
- input: markdown context、実行パラメータ、language 設定
- output: polish 用 prompt 文字列
- error: contract 行欠落や言語判定誤り
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/infrastructure/openspec/spec_creator_test.ts`

### code_unit_2
- file: src/infrastructure/openspec/spec_creator_context.ts
- service: spec-creator markdown context collection
- function: collectSpecCreatorPolishMarkdownContexts / collectChangeFilesRecursively
- purpose: markdown 収集と再帰探索責務を分離し、本線実行の追跡性を上げる。
- input: change directory、収集ルール
- output: polish 入力用 markdown context 一覧
- error: 収集漏れや非対象ファイル混入
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/infrastructure/openspec/spec_creator_test.ts`

### code_unit_3
- file: src/infrastructure/openspec/spec_creator_polish_utils.ts
- service: spec-creator polish utilities
- function: polishMarkdownFiles / checkNonMarkdownConsistency / buildPolishSummary
- purpose: markdown 整形・整合チェック・サマリ生成の補助ロジックを分離する。
- input: polish 生成結果、既存 artifacts
- output: 整形済み markdown、整合チェック結果、summary
- error: non-markdown 不整合の見逃し
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/infrastructure/openspec/spec_creator_test.ts`

### code_unit_4
- file: src/infrastructure/openspec/spec_creator.ts
- service: spec-creator public module surface
- function: re-export hub for prompt/context/polish utilities
- purpose: 既存 import 互換を維持しつつ、責務本体を分割モジュールへ委譲する。
- input: 既存呼び出し元からの import
- output: 互換 API surface
- error: 再 export 欠落による import 破壊
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/infrastructure/openspec/spec_creator_test.ts`

### code_unit_5
- file: src/cli/main.ts
- service: CLI import boundary update
- function: spec creator import rewiring
- purpose: 分割後モジュールへの import を main 側で差し替え、実行経路を維持する。
- input: spec creator 参照先モジュール
- output: `specCreatorPolishCommand -> runSpecCreatorWorkflow` 経路維持
- error: import 差し替え漏れ
- test: `deno check src/cli/main.ts src/infrastructure/openspec/spec_creator.ts`

### code_unit_6
- file: src/infrastructure/openspec/spec_creator_test.ts
- service: spec-creator split regression tests
- function: prompt/context/polish behavior parity tests
- purpose: 分割前後で本線挙動と補助ロジックの境界が崩れていないことを固定する。
- input: spec_creator 実行系テストケース
- output: 既存挙動との一致
- error: 実行経路差分
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/infrastructure/openspec/spec_creator_test.ts`

## task_id: 1.5

### code_unit_1
- file: src/application/orchestrator/orchestrator.ts
- service: orchestrator pure function extraction
- function: detectReviewerStopRule and parser-related pure helpers
- purpose: まず pure 関数を抽出して副作用境界を明確化し、段階分割の土台を作る。
- input: reviewer 出力・実行結果文字列
- output: side-effect free 判定結果
- error: pure 化時の意味論差分
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/application/orchestrator/orchestrator_test.ts`

### code_unit_2
- file: src/application/orchestrator/orchestrator.ts
- service: decision evaluation extraction
- function: resolveDecisionPhaseBlockReason equivalent helpers
- purpose: decision 判定理由の評価ロジックを分離し、分岐条件を追跡しやすくする。
- input: decision phase 状態、execution result
- output: block/sendback/pass 判定理由
- error: 判定優先順位の崩れ
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/application/orchestrator/orchestrator_test.ts`

### code_unit_3
- file: src/application/orchestrator/orchestrator.ts
- service: decision phase execution extraction
- function: executeDecisionPersonaResult / processOrderedDecisionPhaseExecution
- purpose: decision 実行制御を独立化し、class 本体から手続き混在を除去する。
- input: phase 順序、persona 実行結果
- output: phase 実行結果と次遷移
- error: sendback や blocked 遷移の崩れ
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/application/orchestrator/orchestrator_test.ts`

### code_unit_4
- file: src/application/orchestrator/orchestrator.ts
- service: orchestration boundary reduction
- function: class-level orchestration with injected store/log/event dependencies
- purpose: `this.store` / `this.log` / `this.makeEvent` 依存境界を明示し、class を orchestration 専用に縮小する。
- input: 抽出済み helper 関数群と依存注入
- output: 仕様不変の orchestrator class
- error: 依存境界の隠れ再結合
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/application/orchestrator/orchestrator_test.ts`

### code_unit_5
- file: src/application/orchestrator/orchestrator_test.ts
- service: orchestrator behavior regression tests
- function: event order / sendback / blocked invariance tests
- purpose: 段階分割中もイベント順序・sendback 挙動・blocked 条件の不変を保証する。
- input: orchestrator 実行シナリオ
- output: 分割前後の期待一致
- error: 期待イベント列差分
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/application/orchestrator/orchestrator_test.ts`

## task_id: 1.6

### code_unit_1
- file: src/cli/main_test.ts
- service: CLI regression verification
- function: main split parity tests
- purpose: `main.ts` 分割後もコマンドディスパッチと公開互換が不変であることを確認する。
- input: CLI 実行シナリオ
- output: 既存期待値の一致
- error: main 経路の回帰
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/cli/main_test.ts`

### code_unit_2
- file: src/infrastructure/wrapper/helper_test.ts
- service: wrapper parser regression verification
- function: helper parser parity tests
- purpose: parser 共通化後の wrapper 側 result 解釈を固定する。
- input: wrapper 結果ブロックテスト
- output: 既存期待値の一致
- error: parser 解釈差分
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/infrastructure/wrapper/helper_test.ts`

### code_unit_3
- file: src/infrastructure/openspec/spec_creator_test.ts
- service: spec-creator split regression verification
- function: prompt/context/polish split parity tests
- purpose: spec_creator 分割後の実行本線挙動を固定する。
- input: spec_creator 実行テスト
- output: 既存期待値の一致
- error: 本線/補助境界崩れ
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/infrastructure/openspec/spec_creator_test.ts`

### code_unit_4
- file: src/application/orchestrator/orchestrator_test.ts
- service: orchestrator split regression verification
- function: orchestrator stage extraction parity tests
- purpose: orchestrator 段階抽出後のイベント順序・sendback・blocked 条件を固定する。
- input: orchestrator シナリオテスト
- output: 既存期待値の一致
- error: decision 遷移差分
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/application/orchestrator/orchestrator_test.ts`

### code_unit_5
- file: src/**/*.ts
- service: TypeScript static check gate
- function: deno check compile surface
- purpose: 責務移動後の import/type 整合をコンパイルレベルで検証する。
- input: src 配下 TypeScript 全体
- output: 型検査成功
- error: unresolved import / type error
- test: `deno check src/**/*.ts`

## task_id: 1.7

### code_unit_1
- file: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/proposal.md
- service: OpenSpec strict validation gate
- function: change-level strict validator
- purpose: proposal/tasks/code_summary/specs の整合と format を strict モードで最終検証する。
- input: change 配下の OpenSpec artifacts 一式
- output: strict validate pass
- error: OpenSpec 形式違反や参照不整合
- test: `openspec validate refactor-spec-creator-and-orchestrator-modularization --strict`

### code_unit_2
- file: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/tasks.md
- service: implementation checklist closure
- function: task dependency and completion trace check
- purpose: `depends_on` 順序と成果物整合を strict validate の入力として成立させる。
- input: 実装タスク定義と依存関係
- output: 検証可能な task 閉路
- error: 依存関係や対象パス不整合
- test: `openspec validate refactor-spec-creator-and-orchestrator-modularization --strict`

### code_unit_3
- file: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/code_summary.md
- service: task-to-code traceability
- function: task_id to code_unit mapping coverage
- purpose: `tasks.md` 全 task_id を code unit に対応付け、実装追跡可能性を保証する。
- input: task_id と対象パス定義
- output: 欠落のない対応表
- error: task_id 対応漏れ
- test: `openspec validate refactor-spec-creator-and-orchestrator-modularization --strict`
### openspec/changes/refactor-spec-creator-and-orchestrator-modularization/design.md
# Design: refactor-spec-creator-and-orchestrator-modularization

## design.md を作成する判断
この変更は以下に該当するため、`design.md` を作成・維持して設計判断を固定する。
- `main.ts` / `spec_creator.ts` / `orchestrator.ts` / `helper.ts` など複数モジュールに跨る責務再編
- 実行結果解釈（RESULT/SUMMARY/CHANGED_FILES/CHECKS/JUDGMENT）の共通化という横断判断
- 段階的移行順序を誤ると挙動差分が混入しやすい領域
- テスト green だけでなく意味論（sendback/blocked/イベント順序）の不変条件を明示する必要

## Context
- `spec-creator` / `orchestrator` 周辺は単一ファイルへの責務集中が進み、変更時の影響範囲とレビュー観点の追跡が難しい。
- 仕様上は通るが運用上の意味論がずれる問題が発生しており、構造起因の再発リスクがある。
- 本 change は「挙動不変」を前提に、責務分割と共通化のみを行う。

## Goals
- 構造分割で変更影響を局所化する。
- レビュー時に確認すべき責務境界を固定する。
- 完了判定を形式一致だけでなく意味論一致まで安定化する。

## Non-Goals
- 新規機能追加、判定ルール変更、公開シグネチャ変更。
- 責務分割と無関係な最適化、広域リネーム、仕様文言変更。

## 判定時系列と固定ゲート
- 判定時系列は `implement -> review -> spec_check -> test` を固定し、段階責務の逆流を許容しない。
- `review` で `REVIEWER_STOP:requirement_drift|over_editing|verbosity` を検出した場合は blocker として停止する。
- `test` 完了判定では `ORCHESTRATOR_PROVIDER=mock` 単独実行を不合格とし、`not implemented` は未完了扱いにする。
- 実行結果の入力契約は `RESULT` / `SUMMARY` / `CHANGED_FILES` / `CHECKS` / `JUDGMENT` の5キーを共通正規化対象とする。
- 利用可能性は `tasks.md` の `personas` 定義（`execution.enabled=true`, `command_ref=default`）とフェーズ割当で担保する。

## Decisions and Trade-offs

### 1) 分割順序を固定する
決定:
1. `src/cli/main.ts` 分割
2. result parser 共通化（`src/domain/execution_result.ts`）
3. `spec_creator.ts` 本線/補助分離
4. `orchestrator.ts` 段階抽出

理由:
- 依存の浅い領域から先に分割し、最難所の `orchestrator.ts` を最後に回すことで回帰時の原因切り分けを容易にする。

トレードオフ:
- 先行タスクで一時的な重複状態が残る期間が生まれるが、同時多発の大規模変更より安全性を優先する。

### 2) 「挙動不変」を公開契約と回帰テストで二重固定する
決定:
- `main.ts` に残す公開 export（`main`, `buildTeammateAdapter`, `defaultTeammateCommand`, `parseTeammatesArg`, `collectSpecCreatorApplyManifestForTest`）は不変とする。
- 完了条件は既存テスト green と `deno check` による型整合を必須化する。

理由:
- リファクタの目的は構造改善であり、外部契約の変更は別 change で扱うべきため。

トレードオフ:
- 内部設計の自由度は下がるが、利用側への影響を最小化できる。

### 3) result parser は共通化するが wrapper 固有制約は分離維持する
決定:
- `extractResultBlock` と `parseExecutionResultBlock` の重複は `src/domain/execution_result.ts` に集約する。
- forbidden command 検査など wrapper 固有制約は共通層に取り込まない。

理由:
- 共通化対象を「出力フォーマット解釈」に限定し、ドメイン責務と実行基盤責務の境界を保つ。

トレードオフ:
- 完全統合より実装重複が一部残る可能性はあるが、責務汚染と将来の副作用を抑制できる。

### 4) `spec_creator.ts` は再export ハブへ縮小する
決定:
- prompt/context/polish utilities を別モジュールへ分離し、`spec_creator.ts` は import 互換維持のハブとする。

理由:
- 本線実行経路を追いやすくし、テスト専用補助ロジックとの混在を解消する。

トレードオフ:
- ファイル数増加で探索コストは上がるが、責務境界が明確になりレビュー漏れを減らせる。

### 5) `orchestrator.ts` は pure 関数抽出から段階移行する
決定:
- 先に pure 関数を抽出し、次に decision 評価、最後に decision 実行を抽出する。
- `this.store` / `this.log` / `this.makeEvent` 依存は境界を明示しつつ引数化を進める。

理由:
- もっとも壊れやすい領域であり、責務移動と仕様変更を混在させると回帰要因を特定できなくなるため。

トレードオフ:
- 最終形到達まで段階数が増え実装期間は伸びるが、イベント順序・sendback・blocked 条件の不変を守りやすい。

## Fail-Closed 境界
- CLI 分割: 公開 export 互換崩れまたは `src/cli/main_test.ts` 失敗時は受け入れ不可。
- result parser 共通化: `src/infrastructure/wrapper/helper_test.ts` / `src/application/orchestrator/orchestrator_test.ts` 失敗時は受け入れ不可。
- `spec_creator.ts` 分離: `src/infrastructure/openspec/spec_creator_test.ts` 失敗または実行経路差分検出時は受け入れ不可。
- orchestrator 段階抽出: イベント順序・sendback・blocked 条件の差分検出時は受け入れ不可。

## Alternatives Considered
- 代替案: `main.ts` / parser / `spec_creator.ts` / `orchestrator.ts` を一括分割
  - 却下理由: 変更面積が大きすぎて差分原因の切り分けが困難になり、挙動不変保証が弱くなる。
- 代替案: parser 共通化を見送り、重複実装を維持
  - 却下理由: 判定解釈のズレ温床が残り、意味論一致の安定化という目的に反する。
- 代替案: `orchestrator.ts` をクラス分割から先に実施
  - 却下理由: 依存注入境界が曖昧なまま構造変更すると仕様変更混入リスクが高い。
### openspec/changes/refactor-spec-creator-and-orchestrator-modularization/proposal.md
# 変更提案: spec-creator / orchestrator の責務分割を段階導入する

## 変更理由
- spec-creator 周辺は機能追加を優先した結果、1ファイルに責務が集まり、変更影響が読みにくい状態になっている。
- レビュー時に観点漏れが発生しやすく、仕様は通っても意味論がずれて運用で迷う事象が発生した。
- 今後も同等の速度で機能追加を継続するには、先に構造を整理し再発要因を減らす必要がある。

## 変更内容
- 目的:
  - 変更時に壊れる範囲を小さくする。
  - レビュー時に「どの責務をどこで見るか」を固定化する。
  - 完了判定を形式一致だけでなく意味論一致まで安定化する。
  - リファクタ中は外部挙動と公開シグネチャを変更しない。
- 最小スコープ:
  - `src/cli/main.ts` を command/args/workflow に分割し、`main.ts` にはディスパッチと既存 export 互換のみ残す。
  - 実行結果パーサ重複を `src/domain/execution_result.ts` へ集約し、`helper.ts` と `orchestrator.ts` から共通利用する。
  - `src/infrastructure/openspec/spec_creator.ts` の混在責務を prompt/context/polish utilities へ分割し、再export ハブへ縮小する。
  - `src/application/orchestrator/orchestrator.ts` を pure 関数抽出から段階分割し、判定ロジックと実行ロジックの境界を明確化する。
- この change でやらないこと:
  - 新機能追加、判定ルール変更、メッセージ仕様変更。
  - CLI 公開関数シグネチャ変更、既存実行経路変更。
  - 責務移動と無関係な最適化や広域リネーム。

## 影響範囲
- 影響する仕様:
  - `refactor-spec-creator-and-orchestrator-modularization`（ADDED）
- 主な実装対象:
  - `src/cli/main.ts`, `src/cli/commands/*`, `src/cli/args/*`, `src/cli/spec_creator_workflow.ts`
  - `src/domain/execution_result.ts`, `src/infrastructure/wrapper/helper.ts`
  - `src/infrastructure/openspec/spec_creator*.ts`
  - `src/application/orchestrator/orchestrator.ts`
- 受け入れゲート:
  - `src/cli/main_test.ts`
  - `src/infrastructure/wrapper/helper_test.ts`
  - `src/application/orchestrator/orchestrator_test.ts`
  - `src/infrastructure/openspec/spec_creator_test.ts`
  - `openspec validate refactor-spec-creator-and-orchestrator-modularization --strict`

## Provider 完了判定ゲート（固定）
- `ORCHESTRATOR_PROVIDER=mock` 実行のみでは完了扱いにしない。
- 対象プロジェクトの実運用実行経路での受け入れ実行を必須とする。
- `not implemented` 等の未実装エラーは未完了として扱う（fail-closed）。

## Reviewer 停止判定ゲート（固定）
- `spec-reviewer` が重大違反を検出したら `REVIEWER_STOP:requirement_drift|over_editing|verbosity` を出力する。
- `REVIEWER_STOP:` を含むレビュー結果は blocker として停止判定する。
### openspec/changes/refactor-spec-creator-and-orchestrator-modularization/specs/refactor-spec-creator-and-orchestrator-modularization/spec.md
## ADDED Requirements

### Requirement: 変更スコープを構造リファクタへ限定すること
システムは本 change の対象を責務分割と重複排除に限定し、機能仕様と外部挙動を変更してはならない（SHALL）。

#### Scenario: スコープ境界が維持される
- **WHEN** この change の成果物をレビューする
- **THEN** 変更は `main.ts` 分割、実行結果パーサ共通化、`spec_creator.ts` 分割、`orchestrator.ts` 段階抽出に限定される
- **AND** 新機能追加や公開契約変更が含まれない

### Requirement: `src/cli/main.ts` は入口責務へ縮小されること
システムは `src/cli/main.ts` から command/args/workflow 責務を分割し、`main.ts` にコマンドディスパッチと既存 export 互換のみを残さなければならない（SHALL）。

#### Scenario: CLI 分割後も互換性を維持する
- **WHEN** `main.ts` 分割を適用する
- **THEN** `specCreatorCommand` 系、`runSpecCreatorWorkflow` 系、`parse*Args` 系は新規モジュールへ移設される
- **AND** `main`, `buildTeammateAdapter`, `defaultTeammateCommand`, `parseTeammatesArg`, `collectSpecCreatorApplyManifestForTest` の公開シグネチャは維持される

### Requirement: 実行結果パーサは単一モジュールへ共通化されること
システムは `RESULT/SUMMARY/CHANGED_FILES/CHECKS/JUDGMENT` の5キー解釈（result block 抽出・RESULT/SUMMARY 抽出必須化・judgment 正規化・`CHANGED_FILES` 正規化・CHECKS 抽出と禁止コマンド検査・phase別 JUDGMENT 必須判定）を `src/domain/execution_result.ts` に集約しなければならない（SHALL）。

#### Scenario: wrapper と orchestrator が同一解釈を使う
- **WHEN** `helper.ts` と `orchestrator.ts` が実行結果を解釈する
- **THEN** 両者は `src/domain/execution_result.ts` の共通実装を利用する
- **AND** wrapper 固有の forbidden command 検査は共通化対象外として残る

### Requirement: `spec_creator.ts` の本線と補助ロジックを分離すること
システムは `spec_creator.ts` の責務を prompt/context/polish utilities に分離し、`spec_creator.ts` 自体は再export ハブへ縮小しなければならない（SHALL）。

#### Scenario: 実行経路を維持したまま責務を分離する
- **WHEN** `spec_creator.ts` の分割を適用する
- **THEN** prompt 生成は `spec_creator_prompt.ts`、context 収集は `spec_creator_context.ts`、整形補助は `spec_creator_polish_utils.ts` へ移設される
- **AND** `specCreatorPolishCommand -> runSpecCreatorWorkflow` の実行経路は変わらない

### Requirement: `orchestrator.ts` は安全順で段階分割されること
システムは `orchestrator.ts` を pure 関数抽出から始め、decision 評価、decision 実行の順で段階分割し、最後に class をオーケストレーション責務へ限定しなければならない（SHALL）。

#### Scenario: 段階抽出中も判定挙動を保持する
- **WHEN** orchestrator 分割を段階実施する
- **THEN** `this.store`, `this.log`, `this.makeEvent` 依存は境界を明示して引数化される
- **AND** イベント順序、sendback 挙動、blocked 条件に差分が発生しない

### Requirement: 挙動不変を fail-closed で担保すること
システムは既存テスト群による差分検知を必須とし、挙動差分が検出された場合は change を完了扱いにしてはならない（SHALL）。

#### Scenario: 回帰検知時に change を停止する
- **WHEN** `main_test`、`helper_test`、`spec_creator_test`、`orchestrator_test` のいずれかが失敗する、または `deno check src/**/*.ts` が失敗する
- **THEN** 変更は blocked と判定される
- **AND** 仕様変更ではなく構造変更として再修正される

### Requirement: Provider 完了判定は fail-closed に固定されること
システムは `ORCHESTRATOR_PROVIDER=mock` 実行のみを完了扱いにしてはならず、`not implemented` 等の未実装エラーを未完了として扱わなければならない（SHALL）。

#### Scenario: mock 単独または未実装エラーを完了として扱わない
- **WHEN** 完了判定が `ORCHESTRATOR_PROVIDER=mock` 単独実行結果のみ、または `not implemented` を含む結果で行われる
- **THEN** 変更は完了と判定されない
- **AND** 実運用実行経路での受け入れ実行が要求される

### Requirement: Reviewer 停止判定は blocker として扱われること
システムは `spec-reviewer` 出力に `REVIEWER_STOP:requirement_drift|over_editing|verbosity` が含まれる場合、停止判定として扱わなければならない（SHALL）。

#### Scenario: reviewer 重大違反時に遷移を停止する
- **WHEN** review 結果に `REVIEWER_STOP:` が含まれる
- **THEN** 変更は blocker として停止される
- **AND** 次フェーズへの遷移は許可されない
### openspec/changes/refactor-spec-creator-and-orchestrator-modularization/tasks.md
## 0. Persona Defaults
- persona_defaults.phase_order: implement, review, spec_check, test
- persona_defaults: {"phase_order":["implement","review","spec_check","test"]}
- フェーズ担当: implement=implementer; review=code-reviewer; spec_check=spec-checker; test=test-owner
- personas: [{"id":"implementer","role":"implementer","focus":"実装を前進させる","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}},{"id":"code-reviewer","role":"reviewer","focus":"品質と回帰リスクを確認する","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}},{"id":"spec-checker","role":"spec_guard","focus":"仕様逸脱を防ぐ","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}},{"id":"test-owner","role":"test_guard","focus":"検証の十分性を担保し、要件ごとにtransport経路テストとfail-closed拒否テストを確認する","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}}]

### 0.1 テンプレート利用ルール
- この雛形を `openspec/changes/<change-id>/tasks.md` にコピーし、`<...>` を実タスクで置換する。
- `persona_defaults.phase_order` と `フェーズ担当` の固定行は削除しない。
- `personas:` は **1行JSON** で記述する（YAMLの複数行形式は compiler が受理しない）。
- ペルソナを実行主体にする場合は `personas` 行を残す。消すと実行主体は `teammate-*` になる。
- 各タスクに `- フェーズ担当:` を記述し、`implement=implementer; review=code-reviewer; spec_check=spec-checker; test=test-owner` から必要なフェーズだけ選ぶ。
- 例: `- フェーズ担当: implement=implementer; review=code-reviewer`（未指定フェーズはグローバル既定を使う）。
- すべての実施項目（検証を含む）は **`## 1. 実装タスク` のチェックボックス付きタスク** として記述する（`## 2. 検証項目` は使わない）。
- 人間向けメモは `## 2. 人間向けメモ（コンパイラ非対象）` に **チェックボックスなし** で記述する。
- MUST/SHALL ごとに `transport` 経路（producer -> carrier -> consumer）を定義し、対象タスクへ明記する。
- MUST/SHALL ごとに fail-closed の拒否点（どこで、何を理由に reject/block するか）を定義し、対象タスクへ明記する。
- MUST/SHALL ごとに「経路テスト1件 + 拒否テスト1件」を対応付け、実行コマンドを対象タスクへ明記する。

### 0.2 Provider 完了判定ゲート（固定）
- `ORCHESTRATOR_PROVIDER=mock` 実行のみでは完了扱いにしない。
- 対象プロジェクトの実運用実行経路での受け入れ実行を必須とする。
- `not implemented` 等の未実装エラーは未完了として扱う（fail-closed）。

### 0.3 Reviewer 停止判定ゲート（固定）
- `spec-reviewer` が重大違反を検出したら `REVIEWER_STOP:requirement_drift|over_editing|verbosity` を出力する。
- `REVIEWER_STOP:` を含むレビュー結果は blocker として停止判定する。

## 1. 実装タスク
- [x] 1.1 要件をOpenSpec要素へ正規化する
  - 依存: なし
  - 対象: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/proposal.md, openspec/changes/refactor-spec-creator-and-orchestrator-modularization/tasks.md, openspec/changes/refactor-spec-creator-and-orchestrator-modularization/code_summary.md, openspec/changes/refactor-spec-creator-and-orchestrator-modularization/specs/**/spec.md
  - 関連許可: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/design.md
  - フェーズ担当: implement=implementer; review=code-reviewer
  - 成果物: requirements_text を Why/Goals/Scope/Non-Goals/Acceptance へ再構成し、change の最小スコープを固定する。
- [ ] 1.2 `src/cli/main.ts` を command/args/workflow へ分割する
  - 依存: 1.1
  - 対象: src/cli/main.ts, src/cli/commands/spec_creator.ts, src/cli/commands/run.ts, src/cli/args/spec_creator_args.ts, src/cli/args/run_args.ts, src/cli/spec_creator_workflow.ts, src/cli/main_test.ts
  - 関連許可: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/design.md
  - フェーズ担当: implement=implementer; review=code-reviewer
  - 成果物: `src/cli/main.ts` から command/args/workflow の責務を分割し、`main.ts` にはディスパッチと既存 export 互換のみを残す。
  - transport: `main.ts` 既存実装 -> `commands/*` / `args/*` / `spec_creator_workflow.ts` へ移設 -> `main()` から呼び出し
  - fail-closed: 公開関数シグネチャ差分または `src/cli/main_test.ts` 失敗時は受け入れ不可
  - 経路テスト: `deno test --allow-read --allow-write --allow-env --allow-run src/cli/main_test.ts`
  - 拒否テスト: 分割後に `main`, `buildTeammateAdapter`, `defaultTeammateCommand`, `parseTeammatesArg`, `collectSpecCreatorApplyManifestForTest` の export 差分がある場合は reject
- [ ] 1.3 実行結果パーサを `src/domain/execution_result.ts` へ共通化する
  - 依存: 1.2
  - 対象: src/domain/execution_result.ts, src/infrastructure/wrapper/helper.ts, src/infrastructure/wrapper/helper_test.ts, src/application/orchestrator/orchestrator.ts, src/application/orchestrator/orchestrator_test.ts
  - 関連許可: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/design.md
  - フェーズ担当: implement=implementer; review=code-reviewer
  - 成果物: `RESULT/SUMMARY/CHANGED_FILES/CHECKS/JUDGMENT` の5キー解釈（result block 抽出・RESULT/SUMMARY 抽出必須化・judgment 正規化・CHANGED_FILES 正規化・CHECKS 抽出と禁止コマンド検査・phase別 JUDGMENT 必須判定）を `src/domain/execution_result.ts` に共通化し、wrapper/orchestrator から共通利用する。
  - transport: wrapper/orchestrator の既存 parser -> `src/domain/execution_result.ts` 共通実装 -> 各呼び出し元へ置換
  - fail-closed: `helper.ts` の wrapper 固有制約（forbidden command 検査等）を共通化へ混在させない
  - 経路テスト: `deno test --allow-read --allow-write --allow-env --allow-run src/infrastructure/wrapper/helper_test.ts src/application/orchestrator/orchestrator_test.ts`
  - 拒否テスト: 既存 result block 期待文字列差分が出る実装は reject
- [ ] 1.4 `spec_creator.ts` を本線と補助ロジックへ分離する
  - 依存: 1.3
  - 対象: src/infrastructure/openspec/spec_creator.ts, src/infrastructure/openspec/spec_creator_prompt.ts, src/infrastructure/openspec/spec_creator_context.ts, src/infrastructure/openspec/spec_creator_polish_utils.ts, src/infrastructure/openspec/spec_creator_test.ts
  - 関連許可: src/cli/main.ts
  - フェーズ担当: implement=implementer; review=code-reviewer
  - 成果物: `spec_creator.ts` の責務を prompt/context/polish utilities へ分離し、`spec_creator.ts` は再export ハブへ縮小する。
  - transport: `spec_creator.ts` 混在ロジック -> `spec_creator_prompt.ts` / `spec_creator_context.ts` / `spec_creator_polish_utils.ts` -> 既存 import 経路へ再接続
  - fail-closed: `specCreatorPolishCommand -> runSpecCreatorWorkflow` 実行経路に差分が出た場合は受け入れ不可
  - 経路テスト: `deno test --allow-read --allow-write --allow-env --allow-run src/infrastructure/openspec/spec_creator_test.ts`
  - 拒否テスト: `deno check` 失敗または本線関数とテスト専用関数の参照境界崩れは reject
- [ ] 1.5 `orchestrator.ts` を安全順で段階抽出する
  - 依存: 1.3, 1.4
  - 対象: src/application/orchestrator/orchestrator.ts, src/application/orchestrator/orchestrator_test.ts
  - 関連許可: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/design.md
  - フェーズ担当: implement=implementer; review=code-reviewer
  - 成果物: orchestrator を pure 関数抽出 -> decision 評価抽出 -> decision 実行抽出 -> class責務縮小の安全順で段階分割する。
  - transport: `orchestrator.ts` 集中実装 -> pure/decision/execution の抽出関数 -> class orchestrate 専用化
  - fail-closed: 途中で仕様変更を混ぜず、`this.store`/`this.log`/`this.makeEvent` 依存境界を明示できない変更は reject
  - 経路テスト: `deno test --allow-read --allow-write --allow-env --allow-run src/application/orchestrator/orchestrator_test.ts`
  - 拒否テスト: イベント順序・sendback・blocked 条件の差分が出る実装は reject
- [ ] 1.6 回帰テストと型検査で挙動不変を検証する
  - 依存: 1.2, 1.3, 1.4, 1.5
  - 対象: src/cli/main_test.ts, src/infrastructure/wrapper/helper_test.ts, src/infrastructure/openspec/spec_creator_test.ts, src/application/orchestrator/orchestrator_test.ts
  - 関連許可: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/design.md
  - フェーズ担当: implement=implementer; review=code-reviewer; test=test-owner
  - 成果物: 4系統テストと `deno check` で挙動不変を検証し、責務移動のみであることを確認する。
  - transport: 分割済み各モジュール -> 既存コマンド/workflow 実行経路 -> 回帰テストで不変確認
  - fail-closed: いずれかの既存テスト失敗時は完了不可
  - 経路テスト: `deno test --allow-read --allow-write --allow-env --allow-run src/cli/main_test.ts src/infrastructure/wrapper/helper_test.ts src/infrastructure/openspec/spec_creator_test.ts src/application/orchestrator/orchestrator_test.ts`
  - 拒否テスト: `deno check src/**/*.ts` 失敗時は reject
- [ ] 1.7 OpenSpec strict validate を実行する
  - 依存: 1.6
  - 対象: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/proposal.md, openspec/changes/refactor-spec-creator-and-orchestrator-modularization/tasks.md, openspec/changes/refactor-spec-creator-and-orchestrator-modularization/code_summary.md, openspec/changes/refactor-spec-creator-and-orchestrator-modularization/specs/**/spec.md
  - 関連許可: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/design.md
  - フェーズ担当: implement=code-reviewer
  - 成果物: `openspec validate refactor-spec-creator-and-orchestrator-modularization --strict` を実行し、失敗時は修正後に再実行する。

## 2. 人間向けメモ（コンパイラ非対象）
- 要件正規化サマリ:
  - 背景: `spec-creator`/`orchestrator` の責務集中で、レビュー観点漏れと意味論ズレが発生している。
  - 目的: 影響範囲の局所化、レビュー観点固定、意味論を含む完了判定安定化、挙動不変。
  - 最小スコープ: `main.ts` 分割、result parser 共通化、`spec_creator.ts` 分離、`orchestrator.ts` 段階抽出。
  - 非スコープ: 新機能追加、公開シグネチャ変更、判定仕様変更。
  - fail-closed: 既存テスト (`main_test` / `helper_test` / `spec_creator_test` / `orchestrator_test`) 失敗時は完了不可。
- メモ: 重大違反時は `REVIEWER_STOP:requirement_drift|over_editing|verbosity` を reviewer 出力に含める。
- メモ: 利用可能性は `personas` 定義と `フェーズ担当` 割当で担保し、全ペルソナが `execution.enabled=true` かつ `command_ref=default` で実行可能とする。

regenerate targets:
- proposal.md
- tasks.md
- code_summary.md
- specs/**/spec.md
- design.md (必要時のみ)

latest contract (5 lines + judgment):
- review/spec_check/test の完了出力は `5行契約`（RESULT, SUMMARY, CHANGED_FILES, CHECKS, JUDGMENT）を必須とする。
- `JUDGMENT` は必須行で、値は `pass` / `changes_required` / `blocked` のみ許容する。
- 判定は3値化（pass / changes_required / blocked）を前提とする。

必須レビュー契約（RC-01..RC-12）:
- RC-01 RESULT: 最終 result block 抽出と completed|blocked 正規化を定義する
- RC-02 SUMMARY: 抽出・必須・要約用途を定義する
- RC-03 CHANGED_FILES: 正規化し、非implementフェーズでは (none) を必須化する
- RC-04 CHECKS: 抽出・必須・禁止コマンド検査を定義する
- RC-05 JUDGMENT: decision phase 必須、pass|changes_required|blocked 正規化を定義する
- RC-06 判定時系列: blocked 即停止 / changes_required sendback / pass 前進を定義する
- RC-07 reviewer stop: REVIEWER_STOP:requirement_drift|over_editing|verbosity を明記する
- RC-08 実行経路対象: run と spec-creator の両方を対象にする
- RC-09 段階責務: compile と runtime の責務分離を明記する
- RC-10 入力契約キー: task_config.persona_policy.phase_overrides.<phase>.executor_personas を明記する
- RC-11 遷移条件: sendback 条件に blocked=false 前提を明記する
- RC-12 テスト契約: MUST/SHALL ごとに経路テストと fail-closed拒否テストを要求する

## What Changes
- spec creator の固定 task_config テンプレートを使う
- tasks.md と code_summary.md を整合生成する

## Impact
- polish target: refactor-spec-creator-and-orchestrator-modularization
source_markdown_context:
### openspec/changes/refactor-spec-creator-and-orchestrator-modularization/code_summary.md
# code_summary.md

Implementation mapping from tasks.md to code units.

## task_id: 1.1

### code_unit_1
- file: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/proposal.md
- service: change scope definition
- function: Why / Goals / What Changes / Non-Goals / Impact / Provider・Reviewer 固定ゲート sections
- purpose: requirements_text を OpenSpec proposal の標準要素へ正規化し、change の最小スコープと固定ゲートを明示する。
- input: 背景・目的・対応策の生テキスト
- output: スコープ境界と非スコープを明記した提案文
- error: 要件外の追加やスコープ未固定
- test: `openspec validate refactor-spec-creator-and-orchestrator-modularization --strict`

### code_unit_2
- file: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/specs/refactor-spec-creator-and-orchestrator-modularization/spec.md
- service: normative requirement decomposition
- function: ADDED Requirements
- purpose: 生テキストを SHALL 要件へ分解し、4つの分割対象・挙動不変・Provider/Reviewer 固定ゲートを Requirement/Scenario で定義する。
- input: 4つの対応策と完了条件
- output: 機械可読な OpenSpec delta
- error: Requirement 漏れ、Scenario 未定義
- test: `openspec validate refactor-spec-creator-and-orchestrator-modularization --strict`

### code_unit_3
- file: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/tasks.md
- service: execution traceability
- function: task 1.1 checklist + persona phase order + fixed-gate normalization
- purpose: task 1.1 の完了状態と最小スコープ要約、実行主体割当、固定ゲートを tasks 側に反映し、proposal/spec と整合させる。
- input: 正規化済み要件
- output: 実行計画と要件サマリの一致
- error: checklist と成果物の不一致
- test: `openspec validate refactor-spec-creator-and-orchestrator-modularization --strict`

### code_unit_4
- file: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/design.md
- service: scope boundary and fail-closed gates
- function: Context / Goals / Non-Goals / 判定時系列 / Fail-Closed 境界
- purpose: 変更境界、判定時系列、固定ゲート、回帰時の拒否条件を設計文脈として固定する。
- input: 要件の最小スコープと受け入れ条件
- output: 境界逸脱を防ぐ設計ガード
- error: fail-closed 条件の欠落
- test: `openspec validate refactor-spec-creator-and-orchestrator-modularization --strict`

## task_id: 1.2

### code_unit_1
- file: src/cli/main.ts
- service: CLI entrypoint compatibility
- function: main / buildTeammateAdapter / defaultTeammateCommand / parseTeammatesArg / collectSpecCreatorApplyManifestForTest
- purpose: `main.ts` をコマンドディスパッチ専用に縮小しつつ既存 export 互換を維持する。
- input: argv、環境変数、teammate 実行設定
- output: 分割済み command/args/workflow への委譲と互換 export
- error: 公開シグネチャ差分や分岐欠落
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/cli/main_test.ts`

### code_unit_2
- file: src/cli/commands/spec_creator.ts
- service: spec-creator command execution
- function: specCreatorCommand / specCreatorPolishCommand
- purpose: spec-creator 実行入口を `main.ts` から移設し、実行経路を明示化する。
- input: parse 済み spec-creator 引数、workflow 依存
- output: `runSpecCreatorWorkflow` 呼び出しと終了コード
- error: workflow 呼び出し漏れや polish 分岐崩れ
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/cli/main_test.ts`

### code_unit_3
- file: src/cli/commands/run.ts
- service: run command execution
- function: run command handler
- purpose: run 本体処理と adapter 組み立ての実処理責務を `main.ts` から分離する。
- input: parse 済み run 引数、runtime 設定
- output: run 実行フローの開始と完了状態
- error: run ルートの委譲欠落や引数不整合
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/cli/main_test.ts`

### code_unit_4
- file: src/cli/args/spec_creator_args.ts
- service: spec-creator args parser
- function: parseSpecCreatorArgs / parseSpecCreatorPolishArgs
- purpose: spec-creator 系引数解釈を独立モジュール化し、main から分離する。
- input: CLI 引数配列
- output: 正規化済み spec-creator 実行オプション
- error: 必須引数欠落や不正オプション許容
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/cli/main_test.ts`

### code_unit_5
- file: src/cli/args/run_args.ts
- service: run args parser
- function: parseRunArgs
- purpose: run 用引数解釈を独立化して責務境界を固定する。
- input: CLI 引数配列
- output: 正規化済み run 実行オプション
- error: run 引数の解釈差分
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/cli/main_test.ts`

### code_unit_6
- file: src/cli/spec_creator_workflow.ts
- service: spec-creator workflow orchestration
- function: runSpecCreatorWorkflow / runStagedStrictValidate / runSpecCreatorPostAuditGate / applyStagedArtifactsAtomically
- purpose: staged validate/post-audit/apply を workflow 層へ集約し、command 層と分離する。
- input: command 層から渡される workflow 実行コンテキスト
- output: apply 判定、監査ゲート結果、終了コード
- error: staged 検証スキップや apply 手順差分
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/cli/main_test.ts`

### code_unit_7
- file: src/cli/main_test.ts
- service: CLI regression guard
- function: main command routing and export compatibility tests
- purpose: 分割後も公開 API と実行経路が不変であることを検証する。
- input: CLI サブコマンド/引数のテストケース
- output: 挙動差分の fail-closed 検出
- error: 既存テスト失敗
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/cli/main_test.ts`

## task_id: 1.3

### code_unit_1
- file: src/domain/execution_result.ts
- service: shared execution result parsing contract
- function: result block extraction / judgment normalization / changed-files normalization / phase judgment requirement
- purpose: RESULT/SUMMARY/CHANGED_FILES/CHECKS/JUDGMENT の解釈を単一実装に統一する。
- input: teammate 実行ログ文字列、phase 情報
- output: wrapper/orchestrator 共通の正規化済み実行結果
- error: judgment 欠落や正規化不能値
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/infrastructure/wrapper/helper_test.ts src/application/orchestrator/orchestrator_test.ts`

### code_unit_2
- file: src/infrastructure/wrapper/helper.ts
- service: wrapper integration with shared parser
- function: replace extractResultBlock callsite with shared parser
- purpose: wrapper 側が共通 parser を利用しつつ forbidden command 検査など固有制約は維持する。
- input: wrapper の execute 出力
- output: 共通契約で正規化された result block
- error: wrapper 固有 fail-closed 制約の混在/欠落
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/infrastructure/wrapper/helper_test.ts`

### code_unit_3
- file: src/application/orchestrator/orchestrator.ts
- service: orchestrator integration with shared parser
- function: replace parseExecutionResultBlock callsite with shared parser
- purpose: orchestrator 側の判定入力解釈を domain 共通化に合わせ、解釈差を排除する。
- input: decision/execute フェーズの teammate 出力
- output: 共通契約での判定入力データ
- error: phase 別必須判定の取りこぼし
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/application/orchestrator/orchestrator_test.ts`

### code_unit_4
- file: src/infrastructure/wrapper/helper_test.ts
- service: wrapper parser regression tests
- function: execution result parsing expectations
- purpose: 共通化後も wrapper 側の期待文字列と fail-closed 条件を維持する。
- input: result block サンプル
- output: 既存期待値との一致
- error: 期待文字列差分
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/infrastructure/wrapper/helper_test.ts`

### code_unit_5
- file: src/application/orchestrator/orchestrator_test.ts
- service: orchestrator parser regression tests
- function: execution result parsing and decision feed expectations
- purpose: orchestrator 側で parser 置換後も判定入力の意味論を維持する。
- input: decision フェーズ実行サンプル
- output: 既存期待値との一致
- error: 判定分岐差分
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/application/orchestrator/orchestrator_test.ts`

## task_id: 1.4

### code_unit_1
- file: src/infrastructure/openspec/spec_creator_prompt.ts
- service: spec-creator prompt composition
- function: buildSpecCreatorPolishPrompt
- purpose: polish prompt 生成と language/contract 行生成を本線ロジックから分離する。
- input: markdown context、実行パラメータ、language 設定
- output: polish 用 prompt 文字列
- error: contract 行欠落や言語判定誤り
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/infrastructure/openspec/spec_creator_test.ts`

### code_unit_2
- file: src/infrastructure/openspec/spec_creator_context.ts
- service: spec-creator markdown context collection
- function: collectSpecCreatorPolishMarkdownContexts / collectChangeFilesRecursively
- purpose: markdown 収集と再帰探索責務を分離し、本線実行の追跡性を上げる。
- input: change directory、収集ルール
- output: polish 入力用 markdown context 一覧
- error: 収集漏れや非対象ファイル混入
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/infrastructure/openspec/spec_creator_test.ts`

### code_unit_3
- file: src/infrastructure/openspec/spec_creator_polish_utils.ts
- service: spec-creator polish utilities
- function: polishMarkdownFiles / checkNonMarkdownConsistency / buildPolishSummary
- purpose: markdown 整形・整合チェック・サマリ生成の補助ロジックを分離する。
- input: polish 生成結果、既存 artifacts
- output: 整形済み markdown、整合チェック結果、summary
- error: non-markdown 不整合の見逃し
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/infrastructure/openspec/spec_creator_test.ts`

### code_unit_4
- file: src/infrastructure/openspec/spec_creator.ts
- service: spec-creator public module surface
- function: re-export hub for prompt/context/polish utilities
- purpose: 既存 import 互換を維持しつつ、責務本体を分割モジュールへ委譲する。
- input: 既存呼び出し元からの import
- output: 互換 API surface
- error: 再 export 欠落による import 破壊
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/infrastructure/openspec/spec_creator_test.ts`

### code_unit_5
- file: src/cli/main.ts
- service: CLI import boundary update
- function: spec creator import rewiring
- purpose: 分割後モジュールへの import を main 側で差し替え、実行経路を維持する。
- input: spec creator 参照先モジュール
- output: `specCreatorPolishCommand -> runSpecCreatorWorkflow` 経路維持
- error: import 差し替え漏れ
- test: `deno check src/cli/main.ts src/infrastructure/openspec/spec_creator.ts`

### code_unit_6
- file: src/infrastructure/openspec/spec_creator_test.ts
- service: spec-creator split regression tests
- function: prompt/context/polish behavior parity tests
- purpose: 分割前後で本線挙動と補助ロジックの境界が崩れていないことを固定する。
- input: spec_creator 実行系テストケース
- output: 既存挙動との一致
- error: 実行経路差分
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/infrastructure/openspec/spec_creator_test.ts`

## task_id: 1.5

### code_unit_1
- file: src/application/orchestrator/orchestrator.ts
- service: orchestrator pure function extraction
- function: detectReviewerStopRule and parser-related pure helpers
- purpose: まず pure 関数を抽出して副作用境界を明確化し、段階分割の土台を作る。
- input: reviewer 出力・実行結果文字列
- output: side-effect free 判定結果
- error: pure 化時の意味論差分
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/application/orchestrator/orchestrator_test.ts`

### code_unit_2
- file: src/application/orchestrator/orchestrator.ts
- service: decision evaluation extraction
- function: resolveDecisionPhaseBlockReason equivalent helpers
- purpose: decision 判定理由の評価ロジックを分離し、分岐条件を追跡しやすくする。
- input: decision phase 状態、execution result
- output: block/sendback/pass 判定理由
- error: 判定優先順位の崩れ
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/application/orchestrator/orchestrator_test.ts`

### code_unit_3
- file: src/application/orchestrator/orchestrator.ts
- service: decision phase execution extraction
- function: executeDecisionPersonaResult / processOrderedDecisionPhaseExecution
- purpose: decision 実行制御を独立化し、class 本体から手続き混在を除去する。
- input: phase 順序、persona 実行結果
- output: phase 実行結果と次遷移
- error: sendback や blocked 遷移の崩れ
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/application/orchestrator/orchestrator_test.ts`

### code_unit_4
- file: src/application/orchestrator/orchestrator.ts
- service: orchestration boundary reduction
- function: class-level orchestration with injected store/log/event dependencies
- purpose: `this.store` / `this.log` / `this.makeEvent` 依存境界を明示し、class を orchestration 専用に縮小する。
- input: 抽出済み helper 関数群と依存注入
- output: 仕様不変の orchestrator class
- error: 依存境界の隠れ再結合
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/application/orchestrator/orchestrator_test.ts`

### code_unit_5
- file: src/application/orchestrator/orchestrator_test.ts
- service: orchestrator behavior regression tests
- function: event order / sendback / blocked invariance tests
- purpose: 段階分割中もイベント順序・sendback 挙動・blocked 条件の不変を保証する。
- input: orchestrator 実行シナリオ
- output: 分割前後の期待一致
- error: 期待イベント列差分
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/application/orchestrator/orchestrator_test.ts`

## task_id: 1.6

### code_unit_1
- file: src/cli/main_test.ts
- service: CLI regression verification
- function: main split parity tests
- purpose: `main.ts` 分割後もコマンドディスパッチと公開互換が不変であることを確認する。
- input: CLI 実行シナリオ
- output: 既存期待値の一致
- error: main 経路の回帰
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/cli/main_test.ts`

### code_unit_2
- file: src/infrastructure/wrapper/helper_test.ts
- service: wrapper parser regression verification
- function: helper parser parity tests
- purpose: parser 共通化後の wrapper 側 result 解釈を固定する。
- input: wrapper 結果ブロックテスト
- output: 既存期待値の一致
- error: parser 解釈差分
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/infrastructure/wrapper/helper_test.ts`

### code_unit_3
- file: src/infrastructure/openspec/spec_creator_test.ts
- service: spec-creator split regression verification
- function: prompt/context/polish split parity tests
- purpose: spec_creator 分割後の実行本線挙動を固定する。
- input: spec_creator 実行テスト
- output: 既存期待値の一致
- error: 本線/補助境界崩れ
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/infrastructure/openspec/spec_creator_test.ts`

### code_unit_4
- file: src/application/orchestrator/orchestrator_test.ts
- service: orchestrator split regression verification
- function: orchestrator stage extraction parity tests
- purpose: orchestrator 段階抽出後のイベント順序・sendback・blocked 条件を固定する。
- input: orchestrator シナリオテスト
- output: 既存期待値の一致
- error: decision 遷移差分
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/application/orchestrator/orchestrator_test.ts`

### code_unit_5
- file: src/**/*.ts
- service: TypeScript static check gate
- function: deno check compile surface
- purpose: 責務移動後の import/type 整合をコンパイルレベルで検証する。
- input: src 配下 TypeScript 全体
- output: 型検査成功
- error: unresolved import / type error
- test: `deno check src/**/*.ts`

## task_id: 1.7

### code_unit_1
- file: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/proposal.md
- service: OpenSpec strict validation gate
- function: change-level strict validator
- purpose: proposal/tasks/code_summary/specs の整合と format を strict モードで最終検証する。
- input: change 配下の OpenSpec artifacts 一式
- output: strict validate pass
- error: OpenSpec 形式違反や参照不整合
- test: `openspec validate refactor-spec-creator-and-orchestrator-modularization --strict`

### code_unit_2
- file: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/tasks.md
- service: implementation checklist closure
- function: task dependency and completion trace check
- purpose: `depends_on` 順序と成果物整合を strict validate の入力として成立させる。
- input: 実装タスク定義と依存関係
- output: 検証可能な task 閉路
- error: 依存関係や対象パス不整合
- test: `openspec validate refactor-spec-creator-and-orchestrator-modularization --strict`

### code_unit_3
- file: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/code_summary.md
- service: task-to-code traceability
- function: task_id to code_unit mapping coverage
- purpose: `tasks.md` 全 task_id を code unit に対応付け、実装追跡可能性を保証する。
- input: task_id と対象パス定義
- output: 欠落のない対応表
- error: task_id 対応漏れ
- test: `openspec validate refactor-spec-creator-and-orchestrator-modularization --strict`
### openspec/changes/refactor-spec-creator-and-orchestrator-modularization/design.md
# Design: refactor-spec-creator-and-orchestrator-modularization

## design.md を作成する判断
この変更は以下に該当するため、`design.md` を作成・維持して設計判断を固定する。
- `main.ts` / `spec_creator.ts` / `orchestrator.ts` / `helper.ts` など複数モジュールに跨る責務再編
- 実行結果解釈（RESULT/SUMMARY/CHANGED_FILES/CHECKS/JUDGMENT）の共通化という横断判断
- 段階的移行順序を誤ると挙動差分が混入しやすい領域
- テスト green だけでなく意味論（sendback/blocked/イベント順序）の不変条件を明示する必要

## Context
- `spec-creator` / `orchestrator` 周辺は単一ファイルへの責務集中が進み、変更時の影響範囲とレビュー観点の追跡が難しい。
- 仕様上は通るが運用上の意味論がずれる問題が発生しており、構造起因の再発リスクがある。
- 本 change は「挙動不変」を前提に、責務分割と共通化のみを行う。

## Goals
- 構造分割で変更影響を局所化する。
- レビュー時に確認すべき責務境界を固定する。
- 完了判定を形式一致だけでなく意味論一致まで安定化する。

## Non-Goals
- 新規機能追加、判定ルール変更、公開シグネチャ変更。
- 責務分割と無関係な最適化、広域リネーム、仕様文言変更。

## 判定時系列と固定ゲート
- 判定時系列は `implement -> review -> spec_check -> test` を固定し、段階責務の逆流を許容しない。
- `review` で `REVIEWER_STOP:requirement_drift|over_editing|verbosity` を検出した場合は blocker として停止する。
- `test` 完了判定では `ORCHESTRATOR_PROVIDER=mock` 単独実行を不合格とし、`not implemented` は未完了扱いにする。
- 実行結果の入力契約は `RESULT` / `SUMMARY` / `CHANGED_FILES` / `CHECKS` / `JUDGMENT` の5キーを共通正規化対象とする。
- 利用可能性は `tasks.md` の `personas` 定義（`execution.enabled=true`, `command_ref=default`）とフェーズ割当で担保する。

## Decisions and Trade-offs

### 1) 分割順序を固定する
決定:
1. `src/cli/main.ts` 分割
2. result parser 共通化（`src/domain/execution_result.ts`）
3. `spec_creator.ts` 本線/補助分離
4. `orchestrator.ts` 段階抽出

理由:
- 依存の浅い領域から先に分割し、最難所の `orchestrator.ts` を最後に回すことで回帰時の原因切り分けを容易にする。

トレードオフ:
- 先行タスクで一時的な重複状態が残る期間が生まれるが、同時多発の大規模変更より安全性を優先する。

### 2) 「挙動不変」を公開契約と回帰テストで二重固定する
決定:
- `main.ts` に残す公開 export（`main`, `buildTeammateAdapter`, `defaultTeammateCommand`, `parseTeammatesArg`, `collectSpecCreatorApplyManifestForTest`）は不変とする。
- 完了条件は既存テスト green と `deno check` による型整合を必須化する。

理由:
- リファクタの目的は構造改善であり、外部契約の変更は別 change で扱うべきため。

トレードオフ:
- 内部設計の自由度は下がるが、利用側への影響を最小化できる。

### 3) result parser は共通化するが wrapper 固有制約は分離維持する
決定:
- `extractResultBlock` と `parseExecutionResultBlock` の重複は `src/domain/execution_result.ts` に集約する。
- forbidden command 検査など wrapper 固有制約は共通層に取り込まない。

理由:
- 共通化対象を「出力フォーマット解釈」に限定し、ドメイン責務と実行基盤責務の境界を保つ。

トレードオフ:
- 完全統合より実装重複が一部残る可能性はあるが、責務汚染と将来の副作用を抑制できる。

### 4) `spec_creator.ts` は再export ハブへ縮小する
決定:
- prompt/context/polish utilities を別モジュールへ分離し、`spec_creator.ts` は import 互換維持のハブとする。

理由:
- 本線実行経路を追いやすくし、テスト専用補助ロジックとの混在を解消する。

トレードオフ:
- ファイル数増加で探索コストは上がるが、責務境界が明確になりレビュー漏れを減らせる。

### 5) `orchestrator.ts` は pure 関数抽出から段階移行する
決定:
- 先に pure 関数を抽出し、次に decision 評価、最後に decision 実行を抽出する。
- `this.store` / `this.log` / `this.makeEvent` 依存は境界を明示しつつ引数化を進める。

理由:
- もっとも壊れやすい領域であり、責務移動と仕様変更を混在させると回帰要因を特定できなくなるため。

トレードオフ:
- 最終形到達まで段階数が増え実装期間は伸びるが、イベント順序・sendback・blocked 条件の不変を守りやすい。

## Fail-Closed 境界
- CLI 分割: 公開 export 互換崩れまたは `src/cli/main_test.ts` 失敗時は受け入れ不可。
- result parser 共通化: `src/infrastructure/wrapper/helper_test.ts` / `src/application/orchestrator/orchestrator_test.ts` 失敗時は受け入れ不可。
- `spec_creator.ts` 分離: `src/infrastructure/openspec/spec_creator_test.ts` 失敗または実行経路差分検出時は受け入れ不可。
- orchestrator 段階抽出: イベント順序・sendback・blocked 条件の差分検出時は受け入れ不可。

## Alternatives Considered
- 代替案: `main.ts` / parser / `spec_creator.ts` / `orchestrator.ts` を一括分割
  - 却下理由: 変更面積が大きすぎて差分原因の切り分けが困難になり、挙動不変保証が弱くなる。
- 代替案: parser 共通化を見送り、重複実装を維持
  - 却下理由: 判定解釈のズレ温床が残り、意味論一致の安定化という目的に反する。
- 代替案: `orchestrator.ts` をクラス分割から先に実施
  - 却下理由: 依存注入境界が曖昧なまま構造変更すると仕様変更混入リスクが高い。
### openspec/changes/refactor-spec-creator-and-orchestrator-modularization/proposal.md
# 変更提案: spec-creator / orchestrator の責務分割を段階導入する

## 変更理由
- spec-creator 周辺は機能追加を優先した結果、1ファイルに責務が集まり、変更影響が読みにくい状態になっている。
- レビュー時に観点漏れが発生しやすく、仕様は通っても意味論がずれて運用で迷う事象が発生した。
- 今後も同等の速度で機能追加を継続するには、先に構造を整理し再発要因を減らす必要がある。

## 変更内容
- 目的:
  - 変更時に壊れる範囲を小さくする。
  - レビュー時に「どの責務をどこで見るか」を固定化する。
  - 完了判定を形式一致だけでなく意味論一致まで安定化する。
  - リファクタ中は外部挙動と公開シグネチャを変更しない。
- 最小スコープ:
  - `src/cli/main.ts` を command/args/workflow に分割し、`main.ts` にはディスパッチと既存 export 互換のみ残す。
  - 実行結果パーサ重複を `src/domain/execution_result.ts` へ集約し、`helper.ts` と `orchestrator.ts` から共通利用する。
  - `src/infrastructure/openspec/spec_creator.ts` の混在責務を prompt/context/polish utilities へ分割し、再export ハブへ縮小する。
  - `src/application/orchestrator/orchestrator.ts` を pure 関数抽出から段階分割し、判定ロジックと実行ロジックの境界を明確化する。
- この change でやらないこと:
  - 新機能追加、判定ルール変更、メッセージ仕様変更。
  - CLI 公開関数シグネチャ変更、既存実行経路変更。
  - 責務移動と無関係な最適化や広域リネーム。

## 影響範囲
- 影響する仕様:
  - `refactor-spec-creator-and-orchestrator-modularization`（ADDED）
- 主な実装対象:
  - `src/cli/main.ts`, `src/cli/commands/*`, `src/cli/args/*`, `src/cli/spec_creator_workflow.ts`
  - `src/domain/execution_result.ts`, `src/infrastructure/wrapper/helper.ts`
  - `src/infrastructure/openspec/spec_creator*.ts`
  - `src/application/orchestrator/orchestrator.ts`
- 受け入れゲート:
  - `src/cli/main_test.ts`
  - `src/infrastructure/wrapper/helper_test.ts`
  - `src/application/orchestrator/orchestrator_test.ts`
  - `src/infrastructure/openspec/spec_creator_test.ts`
  - `openspec validate refactor-spec-creator-and-orchestrator-modularization --strict`

## Provider 完了判定ゲート（固定）
- `ORCHESTRATOR_PROVIDER=mock` 実行のみでは完了扱いにしない。
- 対象プロジェクトの実運用実行経路での受け入れ実行を必須とする。
- `not implemented` 等の未実装エラーは未完了として扱う（fail-closed）。

## Reviewer 停止判定ゲート（固定）
- `spec-reviewer` が重大違反を検出したら `REVIEWER_STOP:requirement_drift|over_editing|verbosity` を出力する。
- `REVIEWER_STOP:` を含むレビュー結果は blocker として停止判定する。
### openspec/changes/refactor-spec-creator-and-orchestrator-modularization/specs/refactor-spec-creator-and-orchestrator-modularization/spec.md
## ADDED Requirements

### Requirement: 変更スコープを構造リファクタへ限定すること
システムは本 change の対象を責務分割と重複排除に限定し、機能仕様と外部挙動を変更してはならない（SHALL）。

#### Scenario: スコープ境界が維持される
- **WHEN** この change の成果物をレビューする
- **THEN** 変更は `main.ts` 分割、実行結果パーサ共通化、`spec_creator.ts` 分割、`orchestrator.ts` 段階抽出に限定される
- **AND** 新機能追加や公開契約変更が含まれない

### Requirement: `src/cli/main.ts` は入口責務へ縮小されること
システムは `src/cli/main.ts` から command/args/workflow 責務を分割し、`main.ts` にコマンドディスパッチと既存 export 互換のみを残さなければならない（SHALL）。

#### Scenario: CLI 分割後も互換性を維持する
- **WHEN** `main.ts` 分割を適用する
- **THEN** `specCreatorCommand` 系、`runSpecCreatorWorkflow` 系、`parse*Args` 系は新規モジュールへ移設される
- **AND** `main`, `buildTeammateAdapter`, `defaultTeammateCommand`, `parseTeammatesArg`, `collectSpecCreatorApplyManifestForTest` の公開シグネチャは維持される

### Requirement: 実行結果パーサは単一モジュールへ共通化されること
システムは `RESULT/SUMMARY/CHANGED_FILES/CHECKS/JUDGMENT` の5キー解釈（result block 抽出・RESULT/SUMMARY 抽出必須化・judgment 正規化・`CHANGED_FILES` 正規化・CHECKS 抽出と禁止コマンド検査・phase別 JUDGMENT 必須判定）を `src/domain/execution_result.ts` に集約しなければならない（SHALL）。

#### Scenario: wrapper と orchestrator が同一解釈を使う
- **WHEN** `helper.ts` と `orchestrator.ts` が実行結果を解釈する
- **THEN** 両者は `src/domain/execution_result.ts` の共通実装を利用する
- **AND** wrapper 固有の forbidden command 検査は共通化対象外として残る

### Requirement: `spec_creator.ts` の本線と補助ロジックを分離すること
システムは `spec_creator.ts` の責務を prompt/context/polish utilities に分離し、`spec_creator.ts` 自体は再export ハブへ縮小しなければならない（SHALL）。

#### Scenario: 実行経路を維持したまま責務を分離する
- **WHEN** `spec_creator.ts` の分割を適用する
- **THEN** prompt 生成は `spec_creator_prompt.ts`、context 収集は `spec_creator_context.ts`、整形補助は `spec_creator_polish_utils.ts` へ移設される
- **AND** `specCreatorPolishCommand -> runSpecCreatorWorkflow` の実行経路は変わらない

### Requirement: `orchestrator.ts` は安全順で段階分割されること
システムは `orchestrator.ts` を pure 関数抽出から始め、decision 評価、decision 実行の順で段階分割し、最後に class をオーケストレーション責務へ限定しなければならない（SHALL）。

#### Scenario: 段階抽出中も判定挙動を保持する
- **WHEN** orchestrator 分割を段階実施する
- **THEN** `this.store`, `this.log`, `this.makeEvent` 依存は境界を明示して引数化される
- **AND** イベント順序、sendback 挙動、blocked 条件に差分が発生しない

### Requirement: 挙動不変を fail-closed で担保すること
システムは既存テスト群による差分検知を必須とし、挙動差分が検出された場合は change を完了扱いにしてはならない（SHALL）。

#### Scenario: 回帰検知時に change を停止する
- **WHEN** `main_test`、`helper_test`、`spec_creator_test`、`orchestrator_test` のいずれかが失敗する、または `deno check src/**/*.ts` が失敗する
- **THEN** 変更は blocked と判定される
- **AND** 仕様変更ではなく構造変更として再修正される

### Requirement: Provider 完了判定は fail-closed に固定されること
システムは `ORCHESTRATOR_PROVIDER=mock` 実行のみを完了扱いにしてはならず、`not implemented` 等の未実装エラーを未完了として扱わなければならない（SHALL）。

#### Scenario: mock 単独または未実装エラーを完了として扱わない
- **WHEN** 完了判定が `ORCHESTRATOR_PROVIDER=mock` 単独実行結果のみ、または `not implemented` を含む結果で行われる
- **THEN** 変更は完了と判定されない
- **AND** 実運用実行経路での受け入れ実行が要求される

### Requirement: Reviewer 停止判定は blocker として扱われること
システムは `spec-reviewer` 出力に `REVIEWER_STOP:requirement_drift|over_editing|verbosity` が含まれる場合、停止判定として扱わなければならない（SHALL）。

#### Scenario: reviewer 重大違反時に遷移を停止する
- **WHEN** review 結果に `REVIEWER_STOP:` が含まれる
- **THEN** 変更は blocker として停止される
- **AND** 次フェーズへの遷移は許可されない
### openspec/changes/refactor-spec-creator-and-orchestrator-modularization/tasks.md
## 0. Persona Defaults
- persona_defaults.phase_order: implement, review, spec_check, test
- persona_defaults: {"phase_order":["implement","review","spec_check","test"]}
- フェーズ担当: implement=implementer; review=code-reviewer; spec_check=spec-checker; test=test-owner
- personas: [{"id":"implementer","role":"implementer","focus":"実装を前進させる","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}},{"id":"code-reviewer","role":"reviewer","focus":"品質と回帰リスクを確認する","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}},{"id":"spec-checker","role":"spec_guard","focus":"仕様逸脱を防ぐ","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}},{"id":"test-owner","role":"test_guard","focus":"検証の十分性を担保し、要件ごとにtransport経路テストとfail-closed拒否テストを確認する","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}}]

### 0.1 テンプレート利用ルール
- この雛形を `openspec/changes/<change-id>/tasks.md` にコピーし、`<...>` を実タスクで置換する。
- `persona_defaults.phase_order` と `フェーズ担当` の固定行は削除しない。
- `personas:` は **1行JSON** で記述する（YAMLの複数行形式は compiler が受理しない）。
- ペルソナを実行主体にする場合は `personas` 行を残す。消すと実行主体は `teammate-*` になる。
- 各タスクに `- フェーズ担当:` を記述し、`implement=implementer; review=code-reviewer; spec_check=spec-checker; test=test-owner` から必要なフェーズだけ選ぶ。
- 例: `- フェーズ担当: implement=implementer; review=code-reviewer`（未指定フェーズはグローバル既定を使う）。
- すべての実施項目（検証を含む）は **`## 1. 実装タスク` のチェックボックス付きタスク** として記述する（`## 2. 検証項目` は使わない）。
- 人間向けメモは `## 2. 人間向けメモ（コンパイラ非対象）` に **チェックボックスなし** で記述する。
- MUST/SHALL ごとに `transport` 経路（producer -> carrier -> consumer）を定義し、対象タスクへ明記する。
- MUST/SHALL ごとに fail-closed の拒否点（どこで、何を理由に reject/block するか）を定義し、対象タスクへ明記する。
- MUST/SHALL ごとに「経路テスト1件 + 拒否テスト1件」を対応付け、実行コマンドを対象タスクへ明記する。

### 0.2 Provider 完了判定ゲート（固定）
- `ORCHESTRATOR_PROVIDER=mock` 実行のみでは完了扱いにしない。
- 対象プロジェクトの実運用実行経路での受け入れ実行を必須とする。
- `not implemented` 等の未実装エラーは未完了として扱う（fail-closed）。

### 0.3 Reviewer 停止判定ゲート（固定）
- `spec-reviewer` が重大違反を検出したら `REVIEWER_STOP:requirement_drift|over_editing|verbosity` を出力する。
- `REVIEWER_STOP:` を含むレビュー結果は blocker として停止判定する。

## 1. 実装タスク
- [x] 1.1 要件をOpenSpec要素へ正規化する
  - 依存: なし
  - 対象: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/proposal.md, openspec/changes/refactor-spec-creator-and-orchestrator-modularization/tasks.md, openspec/changes/refactor-spec-creator-and-orchestrator-modularization/code_summary.md, openspec/changes/refactor-spec-creator-and-orchestrator-modularization/specs/**/spec.md
  - 関連許可: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/design.md
  - フェーズ担当: implement=implementer; review=code-reviewer
  - 成果物: requirements_text を Why/Goals/Scope/Non-Goals/Acceptance へ再構成し、change の最小スコープを固定する。
- [ ] 1.2 `src/cli/main.ts` を command/args/workflow へ分割する
  - 依存: 1.1
  - 対象: src/cli/main.ts, src/cli/commands/spec_creator.ts, src/cli/commands/run.ts, src/cli/args/spec_creator_args.ts, src/cli/args/run_args.ts, src/cli/spec_creator_workflow.ts, src/cli/main_test.ts
  - 関連許可: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/design.md
  - フェーズ担当: implement=implementer; review=code-reviewer
  - 成果物: `src/cli/main.ts` から command/args/workflow の責務を分割し、`main.ts` にはディスパッチと既存 export 互換のみを残す。
  - transport: `main.ts` 既存実装 -> `commands/*` / `args/*` / `spec_creator_workflow.ts` へ移設 -> `main()` から呼び出し
  - fail-closed: 公開関数シグネチャ差分または `src/cli/main_test.ts` 失敗時は受け入れ不可
  - 経路テスト: `deno test --allow-read --allow-write --allow-env --allow-run src/cli/main_test.ts`
  - 拒否テスト: 分割後に `main`, `buildTeammateAdapter`, `defaultTeammateCommand`, `parseTeammatesArg`, `collectSpecCreatorApplyManifestForTest` の export 差分がある場合は reject
- [ ] 1.3 実行結果パーサを `src/domain/execution_result.ts` へ共通化する
  - 依存: 1.2
  - 対象: src/domain/execution_result.ts, src/infrastructure/wrapper/helper.ts, src/infrastructure/wrapper/helper_test.ts, src/application/orchestrator/orchestrator.ts, src/application/orchestrator/orchestrator_test.ts
  - 関連許可: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/design.md
  - フェーズ担当: implement=implementer; review=code-reviewer
  - 成果物: `RESULT/SUMMARY/CHANGED_FILES/CHECKS/JUDGMENT` の5キー解釈（result block 抽出・RESULT/SUMMARY 抽出必須化・judgment 正規化・CHANGED_FILES 正規化・CHECKS 抽出と禁止コマンド検査・phase別 JUDGMENT 必須判定）を `src/domain/execution_result.ts` に共通化し、wrapper/orchestrator から共通利用する。
  - transport: wrapper/orchestrator の既存 parser -> `src/domain/execution_result.ts` 共通実装 -> 各呼び出し元へ置換
  - fail-closed: `helper.ts` の wrapper 固有制約（forbidden command 検査等）を共通化へ混在させない
  - 経路テスト: `deno test --allow-read --allow-write --allow-env --allow-run src/infrastructure/wrapper/helper_test.ts src/application/orchestrator/orchestrator_test.ts`
  - 拒否テスト: 既存 result block 期待文字列差分が出る実装は reject
- [ ] 1.4 `spec_creator.ts` を本線と補助ロジックへ分離する
  - 依存: 1.3
  - 対象: src/infrastructure/openspec/spec_creator.ts, src/infrastructure/openspec/spec_creator_prompt.ts, src/infrastructure/openspec/spec_creator_context.ts, src/infrastructure/openspec/spec_creator_polish_utils.ts, src/infrastructure/openspec/spec_creator_test.ts
  - 関連許可: src/cli/main.ts
  - フェーズ担当: implement=implementer; review=code-reviewer
  - 成果物: `spec_creator.ts` の責務を prompt/context/polish utilities へ分離し、`spec_creator.ts` は再export ハブへ縮小する。
  - transport: `spec_creator.ts` 混在ロジック -> `spec_creator_prompt.ts` / `spec_creator_context.ts` / `spec_creator_polish_utils.ts` -> 既存 import 経路へ再接続
  - fail-closed: `specCreatorPolishCommand -> runSpecCreatorWorkflow` 実行経路に差分が出た場合は受け入れ不可
  - 経路テスト: `deno test --allow-read --allow-write --allow-env --allow-run src/infrastructure/openspec/spec_creator_test.ts`
  - 拒否テスト: `deno check` 失敗または本線関数とテスト専用関数の参照境界崩れは reject
- [ ] 1.5 `orchestrator.ts` を安全順で段階抽出する
  - 依存: 1.3, 1.4
  - 対象: src/application/orchestrator/orchestrator.ts, src/application/orchestrator/orchestrator_test.ts
  - 関連許可: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/design.md
  - フェーズ担当: implement=implementer; review=code-reviewer
  - 成果物: orchestrator を pure 関数抽出 -> decision 評価抽出 -> decision 実行抽出 -> class責務縮小の安全順で段階分割する。
  - transport: `orchestrator.ts` 集中実装 -> pure/decision/execution の抽出関数 -> class orchestrate 専用化
  - fail-closed: 途中で仕様変更を混ぜず、`this.store`/`this.log`/`this.makeEvent` 依存境界を明示できない変更は reject
  - 経路テスト: `deno test --allow-read --allow-write --allow-env --allow-run src/application/orchestrator/orchestrator_test.ts`
  - 拒否テスト: イベント順序・sendback・blocked 条件の差分が出る実装は reject
- [ ] 1.6 回帰テストと型検査で挙動不変を検証する
  - 依存: 1.2, 1.3, 1.4, 1.5
  - 対象: src/cli/main_test.ts, src/infrastructure/wrapper/helper_test.ts, src/infrastructure/openspec/spec_creator_test.ts, src/application/orchestrator/orchestrator_test.ts
  - 関連許可: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/design.md
  - フェーズ担当: implement=implementer; review=code-reviewer; test=test-owner
  - 成果物: 4系統テストと `deno check` で挙動不変を検証し、責務移動のみであることを確認する。
  - transport: 分割済み各モジュール -> 既存コマンド/workflow 実行経路 -> 回帰テストで不変確認
  - fail-closed: いずれかの既存テスト失敗時は完了不可
  - 経路テスト: `deno test --allow-read --allow-write --allow-env --allow-run src/cli/main_test.ts src/infrastructure/wrapper/helper_test.ts src/infrastructure/openspec/spec_creator_test.ts src/application/orchestrator/orchestrator_test.ts`
  - 拒否テスト: `deno check src/**/*.ts` 失敗時は reject
- [ ] 1.7 OpenSpec strict validate を実行する
  - 依存: 1.6
  - 対象: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/proposal.md, openspec/changes/refactor-spec-creator-and-orchestrator-modularization/tasks.md, openspec/changes/refactor-spec-creator-and-orchestrator-modularization/code_summary.md, openspec/changes/refactor-spec-creator-and-orchestrator-modularization/specs/**/spec.md
  - 関連許可: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/design.md
  - フェーズ担当: implement=code-reviewer
  - 成果物: `openspec validate refactor-spec-creator-and-orchestrator-modularization --strict` を実行し、失敗時は修正後に再実行する。

## 2. 人間向けメモ（コンパイラ非対象）
- 要件正規化サマリ:
  - 背景: `spec-creator`/`orchestrator` の責務集中で、レビュー観点漏れと意味論ズレが発生している。
  - 目的: 影響範囲の局所化、レビュー観点固定、意味論を含む完了判定安定化、挙動不変。
  - 最小スコープ: `main.ts` 分割、result parser 共通化、`spec_creator.ts` 分離、`orchestrator.ts` 段階抽出。
  - 非スコープ: 新機能追加、公開シグネチャ変更、判定仕様変更。
  - fail-closed: 既存テスト (`main_test` / `helper_test` / `spec_creator_test` / `orchestrator_test`) 失敗時は完了不可。
- メモ: 重大違反時は `REVIEWER_STOP:requirement_drift|over_editing|verbosity` を reviewer 出力に含める。
- メモ: 利用可能性は `personas` 定義と `フェーズ担当` 割当で担保し、全ペルソナが `execution.enabled=true` かつ `command_ref=default` で実行可能とする。

regenerate targets:
- proposal.md
- tasks.md
- code_summary.md
- specs/**/spec.md
- design.md (必要時のみ)

latest contract (5 lines + judgment):
- review/spec_check/test の完了出力は `5行契約`（RESULT, SUMMARY, CHANGED_FILES, CHECKS, JUDGMENT）を必須とする。
- `JUDGMENT` は必須行で、値は `pass` / `changes_required` / `blocked` のみ許容する。
- 判定は3値化（pass / changes_required / blocked）を前提とする。

必須レビュー契約（RC-01..RC-12）:
- RC-01 RESULT: 最終 result block 抽出と completed|blocked 正規化を定義する
- RC-02 SUMMARY: 抽出・必須・要約用途を定義する
- RC-03 CHANGED_FILES: 正規化し、非implementフェーズでは (none) を必須化する
- RC-04 CHECKS: 抽出・必須・禁止コマンド検査を定義する
- RC-05 JUDGMENT: decision phase 必須、pass|changes_required|blocked 正規化を定義する
- RC-06 判定時系列: blocked 即停止 / changes_required sendback / pass 前進を定義する
- RC-07 reviewer stop: REVIEWER_STOP:requirement_drift|over_editing|verbosity を明記する
- RC-08 実行経路対象: run と spec-creator の両方を対象にする
- RC-09 段階責務: compile と runtime の責務分離を明記する
- RC-10 入力契約キー: task_config.persona_policy.phase_overrides.<phase>.executor_personas を明記する
- RC-11 遷移条件: sendback 条件に blocked=false 前提を明記する
- RC-12 テスト契約: MUST/SHALL ごとに経路テストと fail-closed拒否テストを要求する

## Provider 完了判定ゲート（固定）
- `ORCHESTRATOR_PROVIDER=mock` 実行のみでは完了扱いにしない。
- 対象プロジェクトの実運用実行経路での受け入れ実行を必須とする。
- `not implemented` 等の未実装エラーは未完了として扱う（fail-closed）。

## Reviewer 停止判定ゲート（固定）
- `spec-reviewer` が重大違反を検出したら `REVIEWER_STOP:requirement_drift|over_editing|verbosity` を出力する。
- `REVIEWER_STOP:` を含むレビュー結果は blocker として停止判定する。
### openspec/changes/refactor-spec-creator-and-orchestrator-modularization/specs/refactor-spec-creator-and-orchestrator-modularization/spec.md
## ADDED Requirements
### Requirement: refactor-spec-creator-and-orchestrator-modularization generated baseline
The system SHALL keep OpenSpec artifacts aligned for this change.

#### Scenario: Spec creator baseline is generated
- **WHEN** spec creator runs for this change
- **THEN** proposal/tasks/design/code_summary and this delta SHALL be generated
- **AND** requirements memo SHALL be captured: polish target: refactor-spec-creator-and-orchestrator-modularization
source_markdown_context:
### openspec/changes/refactor-spec-creator-and-orchestrator-modularization/code_summary.md
# code_summary.md

Implementation mapping from tasks.md to code units.

## task_id: 1.1

### code_unit_1
- file: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/proposal.md
- service: change scope definition
- function: Why / Goals / What Changes / Non-Goals / Impact / Provider・Reviewer 固定ゲート sections
- purpose: requirements_text を OpenSpec proposal の標準要素へ正規化し、change の最小スコープと固定ゲートを明示する。
- input: 背景・目的・対応策の生テキスト
- output: スコープ境界と非スコープを明記した提案文
- error: 要件外の追加やスコープ未固定
- test: `openspec validate refactor-spec-creator-and-orchestrator-modularization --strict`

### code_unit_2
- file: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/specs/refactor-spec-creator-and-orchestrator-modularization/spec.md
- service: normative requirement decomposition
- function: ADDED Requirements
- purpose: 生テキストを SHALL 要件へ分解し、4つの分割対象・挙動不変・Provider/Reviewer 固定ゲートを Requirement/Scenario で定義する。
- input: 4つの対応策と完了条件
- output: 機械可読な OpenSpec delta
- error: Requirement 漏れ、Scenario 未定義
- test: `openspec validate refactor-spec-creator-and-orchestrator-modularization --strict`

### code_unit_3
- file: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/tasks.md
- service: execution traceability
- function: task 1.1 checklist + persona phase order + fixed-gate normalization
- purpose: task 1.1 の完了状態と最小スコープ要約、実行主体割当、固定ゲートを tasks 側に反映し、proposal/spec と整合させる。
- input: 正規化済み要件
- output: 実行計画と要件サマリの一致
- error: checklist と成果物の不一致
- test: `openspec validate refactor-spec-creator-and-orchestrator-modularization --strict`

### code_unit_4
- file: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/design.md
- service: scope boundary and fail-closed gates
- function: Context / Goals / Non-Goals / 判定時系列 / Fail-Closed 境界
- purpose: 変更境界、判定時系列、固定ゲート、回帰時の拒否条件を設計文脈として固定する。
- input: 要件の最小スコープと受け入れ条件
- output: 境界逸脱を防ぐ設計ガード
- error: fail-closed 条件の欠落
- test: `openspec validate refactor-spec-creator-and-orchestrator-modularization --strict`

## task_id: 1.2

### code_unit_1
- file: src/cli/main.ts
- service: CLI entrypoint compatibility
- function: main / buildTeammateAdapter / defaultTeammateCommand / parseTeammatesArg / collectSpecCreatorApplyManifestForTest
- purpose: `main.ts` をコマンドディスパッチ専用に縮小しつつ既存 export 互換を維持する。
- input: argv、環境変数、teammate 実行設定
- output: 分割済み command/args/workflow への委譲と互換 export
- error: 公開シグネチャ差分や分岐欠落
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/cli/main_test.ts`

### code_unit_2
- file: src/cli/commands/spec_creator.ts
- service: spec-creator command execution
- function: specCreatorCommand / specCreatorPolishCommand
- purpose: spec-creator 実行入口を `main.ts` から移設し、実行経路を明示化する。
- input: parse 済み spec-creator 引数、workflow 依存
- output: `runSpecCreatorWorkflow` 呼び出しと終了コード
- error: workflow 呼び出し漏れや polish 分岐崩れ
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/cli/main_test.ts`

### code_unit_3
- file: src/cli/commands/run.ts
- service: run command execution
- function: run command handler
- purpose: run 本体処理と adapter 組み立ての実処理責務を `main.ts` から分離する。
- input: parse 済み run 引数、runtime 設定
- output: run 実行フローの開始と完了状態
- error: run ルートの委譲欠落や引数不整合
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/cli/main_test.ts`

### code_unit_4
- file: src/cli/args/spec_creator_args.ts
- service: spec-creator args parser
- function: parseSpecCreatorArgs / parseSpecCreatorPolishArgs
- purpose: spec-creator 系引数解釈を独立モジュール化し、main から分離する。
- input: CLI 引数配列
- output: 正規化済み spec-creator 実行オプション
- error: 必須引数欠落や不正オプション許容
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/cli/main_test.ts`

### code_unit_5
- file: src/cli/args/run_args.ts
- service: run args parser
- function: parseRunArgs
- purpose: run 用引数解釈を独立化して責務境界を固定する。
- input: CLI 引数配列
- output: 正規化済み run 実行オプション
- error: run 引数の解釈差分
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/cli/main_test.ts`

### code_unit_6
- file: src/cli/spec_creator_workflow.ts
- service: spec-creator workflow orchestration
- function: runSpecCreatorWorkflow / runStagedStrictValidate / runSpecCreatorPostAuditGate / applyStagedArtifactsAtomically
- purpose: staged validate/post-audit/apply を workflow 層へ集約し、command 層と分離する。
- input: command 層から渡される workflow 実行コンテキスト
- output: apply 判定、監査ゲート結果、終了コード
- error: staged 検証スキップや apply 手順差分
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/cli/main_test.ts`

### code_unit_7
- file: src/cli/main_test.ts
- service: CLI regression guard
- function: main command routing and export compatibility tests
- purpose: 分割後も公開 API と実行経路が不変であることを検証する。
- input: CLI サブコマンド/引数のテストケース
- output: 挙動差分の fail-closed 検出
- error: 既存テスト失敗
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/cli/main_test.ts`

## task_id: 1.3

### code_unit_1
- file: src/domain/execution_result.ts
- service: shared execution result parsing contract
- function: result block extraction / judgment normalization / changed-files normalization / phase judgment requirement
- purpose: RESULT/SUMMARY/CHANGED_FILES/CHECKS/JUDGMENT の解釈を単一実装に統一する。
- input: teammate 実行ログ文字列、phase 情報
- output: wrapper/orchestrator 共通の正規化済み実行結果
- error: judgment 欠落や正規化不能値
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/infrastructure/wrapper/helper_test.ts src/application/orchestrator/orchestrator_test.ts`

### code_unit_2
- file: src/infrastructure/wrapper/helper.ts
- service: wrapper integration with shared parser
- function: replace extractResultBlock callsite with shared parser
- purpose: wrapper 側が共通 parser を利用しつつ forbidden command 検査など固有制約は維持する。
- input: wrapper の execute 出力
- output: 共通契約で正規化された result block
- error: wrapper 固有 fail-closed 制約の混在/欠落
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/infrastructure/wrapper/helper_test.ts`

### code_unit_3
- file: src/application/orchestrator/orchestrator.ts
- service: orchestrator integration with shared parser
- function: replace parseExecutionResultBlock callsite with shared parser
- purpose: orchestrator 側の判定入力解釈を domain 共通化に合わせ、解釈差を排除する。
- input: decision/execute フェーズの teammate 出力
- output: 共通契約での判定入力データ
- error: phase 別必須判定の取りこぼし
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/application/orchestrator/orchestrator_test.ts`

### code_unit_4
- file: src/infrastructure/wrapper/helper_test.ts
- service: wrapper parser regression tests
- function: execution result parsing expectations
- purpose: 共通化後も wrapper 側の期待文字列と fail-closed 条件を維持する。
- input: result block サンプル
- output: 既存期待値との一致
- error: 期待文字列差分
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/infrastructure/wrapper/helper_test.ts`

### code_unit_5
- file: src/application/orchestrator/orchestrator_test.ts
- service: orchestrator parser regression tests
- function: execution result parsing and decision feed expectations
- purpose: orchestrator 側で parser 置換後も判定入力の意味論を維持する。
- input: decision フェーズ実行サンプル
- output: 既存期待値との一致
- error: 判定分岐差分
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/application/orchestrator/orchestrator_test.ts`

## task_id: 1.4

### code_unit_1
- file: src/infrastructure/openspec/spec_creator_prompt.ts
- service: spec-creator prompt composition
- function: buildSpecCreatorPolishPrompt
- purpose: polish prompt 生成と language/contract 行生成を本線ロジックから分離する。
- input: markdown context、実行パラメータ、language 設定
- output: polish 用 prompt 文字列
- error: contract 行欠落や言語判定誤り
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/infrastructure/openspec/spec_creator_test.ts`

### code_unit_2
- file: src/infrastructure/openspec/spec_creator_context.ts
- service: spec-creator markdown context collection
- function: collectSpecCreatorPolishMarkdownContexts / collectChangeFilesRecursively
- purpose: markdown 収集と再帰探索責務を分離し、本線実行の追跡性を上げる。
- input: change directory、収集ルール
- output: polish 入力用 markdown context 一覧
- error: 収集漏れや非対象ファイル混入
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/infrastructure/openspec/spec_creator_test.ts`

### code_unit_3
- file: src/infrastructure/openspec/spec_creator_polish_utils.ts
- service: spec-creator polish utilities
- function: polishMarkdownFiles / checkNonMarkdownConsistency / buildPolishSummary
- purpose: markdown 整形・整合チェック・サマリ生成の補助ロジックを分離する。
- input: polish 生成結果、既存 artifacts
- output: 整形済み markdown、整合チェック結果、summary
- error: non-markdown 不整合の見逃し
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/infrastructure/openspec/spec_creator_test.ts`

### code_unit_4
- file: src/infrastructure/openspec/spec_creator.ts
- service: spec-creator public module surface
- function: re-export hub for prompt/context/polish utilities
- purpose: 既存 import 互換を維持しつつ、責務本体を分割モジュールへ委譲する。
- input: 既存呼び出し元からの import
- output: 互換 API surface
- error: 再 export 欠落による import 破壊
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/infrastructure/openspec/spec_creator_test.ts`

### code_unit_5
- file: src/cli/main.ts
- service: CLI import boundary update
- function: spec creator import rewiring
- purpose: 分割後モジュールへの import を main 側で差し替え、実行経路を維持する。
- input: spec creator 参照先モジュール
- output: `specCreatorPolishCommand -> runSpecCreatorWorkflow` 経路維持
- error: import 差し替え漏れ
- test: `deno check src/cli/main.ts src/infrastructure/openspec/spec_creator.ts`

### code_unit_6
- file: src/infrastructure/openspec/spec_creator_test.ts
- service: spec-creator split regression tests
- function: prompt/context/polish behavior parity tests
- purpose: 分割前後で本線挙動と補助ロジックの境界が崩れていないことを固定する。
- input: spec_creator 実行系テストケース
- output: 既存挙動との一致
- error: 実行経路差分
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/infrastructure/openspec/spec_creator_test.ts`

## task_id: 1.5

### code_unit_1
- file: src/application/orchestrator/orchestrator.ts
- service: orchestrator pure function extraction
- function: detectReviewerStopRule and parser-related pure helpers
- purpose: まず pure 関数を抽出して副作用境界を明確化し、段階分割の土台を作る。
- input: reviewer 出力・実行結果文字列
- output: side-effect free 判定結果
- error: pure 化時の意味論差分
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/application/orchestrator/orchestrator_test.ts`

### code_unit_2
- file: src/application/orchestrator/orchestrator.ts
- service: decision evaluation extraction
- function: resolveDecisionPhaseBlockReason equivalent helpers
- purpose: decision 判定理由の評価ロジックを分離し、分岐条件を追跡しやすくする。
- input: decision phase 状態、execution result
- output: block/sendback/pass 判定理由
- error: 判定優先順位の崩れ
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/application/orchestrator/orchestrator_test.ts`

### code_unit_3
- file: src/application/orchestrator/orchestrator.ts
- service: decision phase execution extraction
- function: executeDecisionPersonaResult / processOrderedDecisionPhaseExecution
- purpose: decision 実行制御を独立化し、class 本体から手続き混在を除去する。
- input: phase 順序、persona 実行結果
- output: phase 実行結果と次遷移
- error: sendback や blocked 遷移の崩れ
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/application/orchestrator/orchestrator_test.ts`

### code_unit_4
- file: src/application/orchestrator/orchestrator.ts
- service: orchestration boundary reduction
- function: class-level orchestration with injected store/log/event dependencies
- purpose: `this.store` / `this.log` / `this.makeEvent` 依存境界を明示し、class を orchestration 専用に縮小する。
- input: 抽出済み helper 関数群と依存注入
- output: 仕様不変の orchestrator class
- error: 依存境界の隠れ再結合
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/application/orchestrator/orchestrator_test.ts`

### code_unit_5
- file: src/application/orchestrator/orchestrator_test.ts
- service: orchestrator behavior regression tests
- function: event order / sendback / blocked invariance tests
- purpose: 段階分割中もイベント順序・sendback 挙動・blocked 条件の不変を保証する。
- input: orchestrator 実行シナリオ
- output: 分割前後の期待一致
- error: 期待イベント列差分
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/application/orchestrator/orchestrator_test.ts`

## task_id: 1.6

### code_unit_1
- file: src/cli/main_test.ts
- service: CLI regression verification
- function: main split parity tests
- purpose: `main.ts` 分割後もコマンドディスパッチと公開互換が不変であることを確認する。
- input: CLI 実行シナリオ
- output: 既存期待値の一致
- error: main 経路の回帰
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/cli/main_test.ts`

### code_unit_2
- file: src/infrastructure/wrapper/helper_test.ts
- service: wrapper parser regression verification
- function: helper parser parity tests
- purpose: parser 共通化後の wrapper 側 result 解釈を固定する。
- input: wrapper 結果ブロックテスト
- output: 既存期待値の一致
- error: parser 解釈差分
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/infrastructure/wrapper/helper_test.ts`

### code_unit_3
- file: src/infrastructure/openspec/spec_creator_test.ts
- service: spec-creator split regression verification
- function: prompt/context/polish split parity tests
- purpose: spec_creator 分割後の実行本線挙動を固定する。
- input: spec_creator 実行テスト
- output: 既存期待値の一致
- error: 本線/補助境界崩れ
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/infrastructure/openspec/spec_creator_test.ts`

### code_unit_4
- file: src/application/orchestrator/orchestrator_test.ts
- service: orchestrator split regression verification
- function: orchestrator stage extraction parity tests
- purpose: orchestrator 段階抽出後のイベント順序・sendback・blocked 条件を固定する。
- input: orchestrator シナリオテスト
- output: 既存期待値の一致
- error: decision 遷移差分
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/application/orchestrator/orchestrator_test.ts`

### code_unit_5
- file: src/**/*.ts
- service: TypeScript static check gate
- function: deno check compile surface
- purpose: 責務移動後の import/type 整合をコンパイルレベルで検証する。
- input: src 配下 TypeScript 全体
- output: 型検査成功
- error: unresolved import / type error
- test: `deno check src/**/*.ts`

## task_id: 1.7

### code_unit_1
- file: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/proposal.md
- service: OpenSpec strict validation gate
- function: change-level strict validator
- purpose: proposal/tasks/code_summary/specs の整合と format を strict モードで最終検証する。
- input: change 配下の OpenSpec artifacts 一式
- output: strict validate pass
- error: OpenSpec 形式違反や参照不整合
- test: `openspec validate refactor-spec-creator-and-orchestrator-modularization --strict`

### code_unit_2
- file: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/tasks.md
- service: implementation checklist closure
- function: task dependency and completion trace check
- purpose: `depends_on` 順序と成果物整合を strict validate の入力として成立させる。
- input: 実装タスク定義と依存関係
- output: 検証可能な task 閉路
- error: 依存関係や対象パス不整合
- test: `openspec validate refactor-spec-creator-and-orchestrator-modularization --strict`

### code_unit_3
- file: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/code_summary.md
- service: task-to-code traceability
- function: task_id to code_unit mapping coverage
- purpose: `tasks.md` 全 task_id を code unit に対応付け、実装追跡可能性を保証する。
- input: task_id と対象パス定義
- output: 欠落のない対応表
- error: task_id 対応漏れ
- test: `openspec validate refactor-spec-creator-and-orchestrator-modularization --strict`
### openspec/changes/refactor-spec-creator-and-orchestrator-modularization/design.md
# Design: refactor-spec-creator-and-orchestrator-modularization

## design.md を作成する判断
この変更は以下に該当するため、`design.md` を作成・維持して設計判断を固定する。
- `main.ts` / `spec_creator.ts` / `orchestrator.ts` / `helper.ts` など複数モジュールに跨る責務再編
- 実行結果解釈（RESULT/SUMMARY/CHANGED_FILES/CHECKS/JUDGMENT）の共通化という横断判断
- 段階的移行順序を誤ると挙動差分が混入しやすい領域
- テスト green だけでなく意味論（sendback/blocked/イベント順序）の不変条件を明示する必要

## Context
- `spec-creator` / `orchestrator` 周辺は単一ファイルへの責務集中が進み、変更時の影響範囲とレビュー観点の追跡が難しい。
- 仕様上は通るが運用上の意味論がずれる問題が発生しており、構造起因の再発リスクがある。
- 本 change は「挙動不変」を前提に、責務分割と共通化のみを行う。

## Goals
- 構造分割で変更影響を局所化する。
- レビュー時に確認すべき責務境界を固定する。
- 完了判定を形式一致だけでなく意味論一致まで安定化する。

## Non-Goals
- 新規機能追加、判定ルール変更、公開シグネチャ変更。
- 責務分割と無関係な最適化、広域リネーム、仕様文言変更。

## 判定時系列と固定ゲート
- 判定時系列は `implement -> review -> spec_check -> test` を固定し、段階責務の逆流を許容しない。
- `review` で `REVIEWER_STOP:requirement_drift|over_editing|verbosity` を検出した場合は blocker として停止する。
- `test` 完了判定では `ORCHESTRATOR_PROVIDER=mock` 単独実行を不合格とし、`not implemented` は未完了扱いにする。
- 実行結果の入力契約は `RESULT` / `SUMMARY` / `CHANGED_FILES` / `CHECKS` / `JUDGMENT` の5キーを共通正規化対象とする。
- 利用可能性は `tasks.md` の `personas` 定義（`execution.enabled=true`, `command_ref=default`）とフェーズ割当で担保する。

## Decisions and Trade-offs

### 1) 分割順序を固定する
決定:
1. `src/cli/main.ts` 分割
2. result parser 共通化（`src/domain/execution_result.ts`）
3. `spec_creator.ts` 本線/補助分離
4. `orchestrator.ts` 段階抽出

理由:
- 依存の浅い領域から先に分割し、最難所の `orchestrator.ts` を最後に回すことで回帰時の原因切り分けを容易にする。

トレードオフ:
- 先行タスクで一時的な重複状態が残る期間が生まれるが、同時多発の大規模変更より安全性を優先する。

### 2) 「挙動不変」を公開契約と回帰テストで二重固定する
決定:
- `main.ts` に残す公開 export（`main`, `buildTeammateAdapter`, `defaultTeammateCommand`, `parseTeammatesArg`, `collectSpecCreatorApplyManifestForTest`）は不変とする。
- 完了条件は既存テスト green と `deno check` による型整合を必須化する。

理由:
- リファクタの目的は構造改善であり、外部契約の変更は別 change で扱うべきため。

トレードオフ:
- 内部設計の自由度は下がるが、利用側への影響を最小化できる。

### 3) result parser は共通化するが wrapper 固有制約は分離維持する
決定:
- `extractResultBlock` と `parseExecutionResultBlock` の重複は `src/domain/execution_result.ts` に集約する。
- forbidden command 検査など wrapper 固有制約は共通層に取り込まない。

理由:
- 共通化対象を「出力フォーマット解釈」に限定し、ドメイン責務と実行基盤責務の境界を保つ。

トレードオフ:
- 完全統合より実装重複が一部残る可能性はあるが、責務汚染と将来の副作用を抑制できる。

### 4) `spec_creator.ts` は再export ハブへ縮小する
決定:
- prompt/context/polish utilities を別モジュールへ分離し、`spec_creator.ts` は import 互換維持のハブとする。

理由:
- 本線実行経路を追いやすくし、テスト専用補助ロジックとの混在を解消する。

トレードオフ:
- ファイル数増加で探索コストは上がるが、責務境界が明確になりレビュー漏れを減らせる。

### 5) `orchestrator.ts` は pure 関数抽出から段階移行する
決定:
- 先に pure 関数を抽出し、次に decision 評価、最後に decision 実行を抽出する。
- `this.store` / `this.log` / `this.makeEvent` 依存は境界を明示しつつ引数化を進める。

理由:
- もっとも壊れやすい領域であり、責務移動と仕様変更を混在させると回帰要因を特定できなくなるため。

トレードオフ:
- 最終形到達まで段階数が増え実装期間は伸びるが、イベント順序・sendback・blocked 条件の不変を守りやすい。

## Fail-Closed 境界
- CLI 分割: 公開 export 互換崩れまたは `src/cli/main_test.ts` 失敗時は受け入れ不可。
- result parser 共通化: `src/infrastructure/wrapper/helper_test.ts` / `src/application/orchestrator/orchestrator_test.ts` 失敗時は受け入れ不可。
- `spec_creator.ts` 分離: `src/infrastructure/openspec/spec_creator_test.ts` 失敗または実行経路差分検出時は受け入れ不可。
- orchestrator 段階抽出: イベント順序・sendback・blocked 条件の差分検出時は受け入れ不可。

## Alternatives Considered
- 代替案: `main.ts` / parser / `spec_creator.ts` / `orchestrator.ts` を一括分割
  - 却下理由: 変更面積が大きすぎて差分原因の切り分けが困難になり、挙動不変保証が弱くなる。
- 代替案: parser 共通化を見送り、重複実装を維持
  - 却下理由: 判定解釈のズレ温床が残り、意味論一致の安定化という目的に反する。
- 代替案: `orchestrator.ts` をクラス分割から先に実施
  - 却下理由: 依存注入境界が曖昧なまま構造変更すると仕様変更混入リスクが高い。
### openspec/changes/refactor-spec-creator-and-orchestrator-modularization/proposal.md
# 変更提案: spec-creator / orchestrator の責務分割を段階導入する

## 変更理由
- spec-creator 周辺は機能追加を優先した結果、1ファイルに責務が集まり、変更影響が読みにくい状態になっている。
- レビュー時に観点漏れが発生しやすく、仕様は通っても意味論がずれて運用で迷う事象が発生した。
- 今後も同等の速度で機能追加を継続するには、先に構造を整理し再発要因を減らす必要がある。

## 変更内容
- 目的:
  - 変更時に壊れる範囲を小さくする。
  - レビュー時に「どの責務をどこで見るか」を固定化する。
  - 完了判定を形式一致だけでなく意味論一致まで安定化する。
  - リファクタ中は外部挙動と公開シグネチャを変更しない。
- 最小スコープ:
  - `src/cli/main.ts` を command/args/workflow に分割し、`main.ts` にはディスパッチと既存 export 互換のみ残す。
  - 実行結果パーサ重複を `src/domain/execution_result.ts` へ集約し、`helper.ts` と `orchestrator.ts` から共通利用する。
  - `src/infrastructure/openspec/spec_creator.ts` の混在責務を prompt/context/polish utilities へ分割し、再export ハブへ縮小する。
  - `src/application/orchestrator/orchestrator.ts` を pure 関数抽出から段階分割し、判定ロジックと実行ロジックの境界を明確化する。
- この change でやらないこと:
  - 新機能追加、判定ルール変更、メッセージ仕様変更。
  - CLI 公開関数シグネチャ変更、既存実行経路変更。
  - 責務移動と無関係な最適化や広域リネーム。

## 影響範囲
- 影響する仕様:
  - `refactor-spec-creator-and-orchestrator-modularization`（ADDED）
- 主な実装対象:
  - `src/cli/main.ts`, `src/cli/commands/*`, `src/cli/args/*`, `src/cli/spec_creator_workflow.ts`
  - `src/domain/execution_result.ts`, `src/infrastructure/wrapper/helper.ts`
  - `src/infrastructure/openspec/spec_creator*.ts`
  - `src/application/orchestrator/orchestrator.ts`
- 受け入れゲート:
  - `src/cli/main_test.ts`
  - `src/infrastructure/wrapper/helper_test.ts`
  - `src/application/orchestrator/orchestrator_test.ts`
  - `src/infrastructure/openspec/spec_creator_test.ts`
  - `openspec validate refactor-spec-creator-and-orchestrator-modularization --strict`

## Provider 完了判定ゲート（固定）
- `ORCHESTRATOR_PROVIDER=mock` 実行のみでは完了扱いにしない。
- 対象プロジェクトの実運用実行経路での受け入れ実行を必須とする。
- `not implemented` 等の未実装エラーは未完了として扱う（fail-closed）。

## Reviewer 停止判定ゲート（固定）
- `spec-reviewer` が重大違反を検出したら `REVIEWER_STOP:requirement_drift|over_editing|verbosity` を出力する。
- `REVIEWER_STOP:` を含むレビュー結果は blocker として停止判定する。
### openspec/changes/refactor-spec-creator-and-orchestrator-modularization/specs/refactor-spec-creator-and-orchestrator-modularization/spec.md
## ADDED Requirements

### Requirement: 変更スコープを構造リファクタへ限定すること
システムは本 change の対象を責務分割と重複排除に限定し、機能仕様と外部挙動を変更してはならない（SHALL）。

#### Scenario: スコープ境界が維持される
- **WHEN** この change の成果物をレビューする
- **THEN** 変更は `main.ts` 分割、実行結果パーサ共通化、`spec_creator.ts` 分割、`orchestrator.ts` 段階抽出に限定される
- **AND** 新機能追加や公開契約変更が含まれない

### Requirement: `src/cli/main.ts` は入口責務へ縮小されること
システムは `src/cli/main.ts` から command/args/workflow 責務を分割し、`main.ts` にコマンドディスパッチと既存 export 互換のみを残さなければならない（SHALL）。

#### Scenario: CLI 分割後も互換性を維持する
- **WHEN** `main.ts` 分割を適用する
- **THEN** `specCreatorCommand` 系、`runSpecCreatorWorkflow` 系、`parse*Args` 系は新規モジュールへ移設される
- **AND** `main`, `buildTeammateAdapter`, `defaultTeammateCommand`, `parseTeammatesArg`, `collectSpecCreatorApplyManifestForTest` の公開シグネチャは維持される

### Requirement: 実行結果パーサは単一モジュールへ共通化されること
システムは `RESULT/SUMMARY/CHANGED_FILES/CHECKS/JUDGMENT` の5キー解釈（result block 抽出・RESULT/SUMMARY 抽出必須化・judgment 正規化・`CHANGED_FILES` 正規化・CHECKS 抽出と禁止コマンド検査・phase別 JUDGMENT 必須判定）を `src/domain/execution_result.ts` に集約しなければならない（SHALL）。

#### Scenario: wrapper と orchestrator が同一解釈を使う
- **WHEN** `helper.ts` と `orchestrator.ts` が実行結果を解釈する
- **THEN** 両者は `src/domain/execution_result.ts` の共通実装を利用する
- **AND** wrapper 固有の forbidden command 検査は共通化対象外として残る

### Requirement: `spec_creator.ts` の本線と補助ロジックを分離すること
システムは `spec_creator.ts` の責務を prompt/context/polish utilities に分離し、`spec_creator.ts` 自体は再export ハブへ縮小しなければならない（SHALL）。

#### Scenario: 実行経路を維持したまま責務を分離する
- **WHEN** `spec_creator.ts` の分割を適用する
- **THEN** prompt 生成は `spec_creator_prompt.ts`、context 収集は `spec_creator_context.ts`、整形補助は `spec_creator_polish_utils.ts` へ移設される
- **AND** `specCreatorPolishCommand -> runSpecCreatorWorkflow` の実行経路は変わらない

### Requirement: `orchestrator.ts` は安全順で段階分割されること
システムは `orchestrator.ts` を pure 関数抽出から始め、decision 評価、decision 実行の順で段階分割し、最後に class をオーケストレーション責務へ限定しなければならない（SHALL）。

#### Scenario: 段階抽出中も判定挙動を保持する
- **WHEN** orchestrator 分割を段階実施する
- **THEN** `this.store`, `this.log`, `this.makeEvent` 依存は境界を明示して引数化される
- **AND** イベント順序、sendback 挙動、blocked 条件に差分が発生しない

### Requirement: 挙動不変を fail-closed で担保すること
システムは既存テスト群による差分検知を必須とし、挙動差分が検出された場合は change を完了扱いにしてはならない（SHALL）。

#### Scenario: 回帰検知時に change を停止する
- **WHEN** `main_test`、`helper_test`、`spec_creator_test`、`orchestrator_test` のいずれかが失敗する、または `deno check src/**/*.ts` が失敗する
- **THEN** 変更は blocked と判定される
- **AND** 仕様変更ではなく構造変更として再修正される

### Requirement: Provider 完了判定は fail-closed に固定されること
システムは `ORCHESTRATOR_PROVIDER=mock` 実行のみを完了扱いにしてはならず、`not implemented` 等の未実装エラーを未完了として扱わなければならない（SHALL）。

#### Scenario: mock 単独または未実装エラーを完了として扱わない
- **WHEN** 完了判定が `ORCHESTRATOR_PROVIDER=mock` 単独実行結果のみ、または `not implemented` を含む結果で行われる
- **THEN** 変更は完了と判定されない
- **AND** 実運用実行経路での受け入れ実行が要求される

### Requirement: Reviewer 停止判定は blocker として扱われること
システムは `spec-reviewer` 出力に `REVIEWER_STOP:requirement_drift|over_editing|verbosity` が含まれる場合、停止判定として扱わなければならない（SHALL）。

#### Scenario: reviewer 重大違反時に遷移を停止する
- **WHEN** review 結果に `REVIEWER_STOP:` が含まれる
- **THEN** 変更は blocker として停止される
- **AND** 次フェーズへの遷移は許可されない
### openspec/changes/refactor-spec-creator-and-orchestrator-modularization/tasks.md
## 0. Persona Defaults
- persona_defaults.phase_order: implement, review, spec_check, test
- persona_defaults: {"phase_order":["implement","review","spec_check","test"]}
- フェーズ担当: implement=implementer; review=code-reviewer; spec_check=spec-checker; test=test-owner
- personas: [{"id":"implementer","role":"implementer","focus":"実装を前進させる","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}},{"id":"code-reviewer","role":"reviewer","focus":"品質と回帰リスクを確認する","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}},{"id":"spec-checker","role":"spec_guard","focus":"仕様逸脱を防ぐ","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}},{"id":"test-owner","role":"test_guard","focus":"検証の十分性を担保し、要件ごとにtransport経路テストとfail-closed拒否テストを確認する","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}}]

### 0.1 テンプレート利用ルール
- この雛形を `openspec/changes/<change-id>/tasks.md` にコピーし、`<...>` を実タスクで置換する。
- `persona_defaults.phase_order` と `フェーズ担当` の固定行は削除しない。
- `personas:` は **1行JSON** で記述する（YAMLの複数行形式は compiler が受理しない）。
- ペルソナを実行主体にする場合は `personas` 行を残す。消すと実行主体は `teammate-*` になる。
- 各タスクに `- フェーズ担当:` を記述し、`implement=implementer; review=code-reviewer; spec_check=spec-checker; test=test-owner` から必要なフェーズだけ選ぶ。
- 例: `- フェーズ担当: implement=implementer; review=code-reviewer`（未指定フェーズはグローバル既定を使う）。
- すべての実施項目（検証を含む）は **`## 1. 実装タスク` のチェックボックス付きタスク** として記述する（`## 2. 検証項目` は使わない）。
- 人間向けメモは `## 2. 人間向けメモ（コンパイラ非対象）` に **チェックボックスなし** で記述する。
- MUST/SHALL ごとに `transport` 経路（producer -> carrier -> consumer）を定義し、対象タスクへ明記する。
- MUST/SHALL ごとに fail-closed の拒否点（どこで、何を理由に reject/block するか）を定義し、対象タスクへ明記する。
- MUST/SHALL ごとに「経路テスト1件 + 拒否テスト1件」を対応付け、実行コマンドを対象タスクへ明記する。

### 0.2 Provider 完了判定ゲート（固定）
- `ORCHESTRATOR_PROVIDER=mock` 実行のみでは完了扱いにしない。
- 対象プロジェクトの実運用実行経路での受け入れ実行を必須とする。
- `not implemented` 等の未実装エラーは未完了として扱う（fail-closed）。

### 0.3 Reviewer 停止判定ゲート（固定）
- `spec-reviewer` が重大違反を検出したら `REVIEWER_STOP:requirement_drift|over_editing|verbosity` を出力する。
- `REVIEWER_STOP:` を含むレビュー結果は blocker として停止判定する。

## 1. 実装タスク
- [x] 1.1 要件をOpenSpec要素へ正規化する
  - 依存: なし
  - 対象: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/proposal.md, openspec/changes/refactor-spec-creator-and-orchestrator-modularization/tasks.md, openspec/changes/refactor-spec-creator-and-orchestrator-modularization/code_summary.md, openspec/changes/refactor-spec-creator-and-orchestrator-modularization/specs/**/spec.md
  - 関連許可: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/design.md
  - フェーズ担当: implement=implementer; review=code-reviewer
  - 成果物: requirements_text を Why/Goals/Scope/Non-Goals/Acceptance へ再構成し、change の最小スコープを固定する。
- [ ] 1.2 `src/cli/main.ts` を command/args/workflow へ分割する
  - 依存: 1.1
  - 対象: src/cli/main.ts, src/cli/commands/spec_creator.ts, src/cli/commands/run.ts, src/cli/args/spec_creator_args.ts, src/cli/args/run_args.ts, src/cli/spec_creator_workflow.ts, src/cli/main_test.ts
  - 関連許可: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/design.md
  - フェーズ担当: implement=implementer; review=code-reviewer
  - 成果物: `src/cli/main.ts` から command/args/workflow の責務を分割し、`main.ts` にはディスパッチと既存 export 互換のみを残す。
  - transport: `main.ts` 既存実装 -> `commands/*` / `args/*` / `spec_creator_workflow.ts` へ移設 -> `main()` から呼び出し
  - fail-closed: 公開関数シグネチャ差分または `src/cli/main_test.ts` 失敗時は受け入れ不可
  - 経路テスト: `deno test --allow-read --allow-write --allow-env --allow-run src/cli/main_test.ts`
  - 拒否テスト: 分割後に `main`, `buildTeammateAdapter`, `defaultTeammateCommand`, `parseTeammatesArg`, `collectSpecCreatorApplyManifestForTest` の export 差分がある場合は reject
- [ ] 1.3 実行結果パーサを `src/domain/execution_result.ts` へ共通化する
  - 依存: 1.2
  - 対象: src/domain/execution_result.ts, src/infrastructure/wrapper/helper.ts, src/infrastructure/wrapper/helper_test.ts, src/application/orchestrator/orchestrator.ts, src/application/orchestrator/orchestrator_test.ts
  - 関連許可: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/design.md
  - フェーズ担当: implement=implementer; review=code-reviewer
  - 成果物: `RESULT/SUMMARY/CHANGED_FILES/CHECKS/JUDGMENT` の5キー解釈（result block 抽出・RESULT/SUMMARY 抽出必須化・judgment 正規化・CHANGED_FILES 正規化・CHECKS 抽出と禁止コマンド検査・phase別 JUDGMENT 必須判定）を `src/domain/execution_result.ts` に共通化し、wrapper/orchestrator から共通利用する。
  - transport: wrapper/orchestrator の既存 parser -> `src/domain/execution_result.ts` 共通実装 -> 各呼び出し元へ置換
  - fail-closed: `helper.ts` の wrapper 固有制約（forbidden command 検査等）を共通化へ混在させない
  - 経路テスト: `deno test --allow-read --allow-write --allow-env --allow-run src/infrastructure/wrapper/helper_test.ts src/application/orchestrator/orchestrator_test.ts`
  - 拒否テスト: 既存 result block 期待文字列差分が出る実装は reject
- [ ] 1.4 `spec_creator.ts` を本線と補助ロジックへ分離する
  - 依存: 1.3
  - 対象: src/infrastructure/openspec/spec_creator.ts, src/infrastructure/openspec/spec_creator_prompt.ts, src/infrastructure/openspec/spec_creator_context.ts, src/infrastructure/openspec/spec_creator_polish_utils.ts, src/infrastructure/openspec/spec_creator_test.ts
  - 関連許可: src/cli/main.ts
  - フェーズ担当: implement=implementer; review=code-reviewer
  - 成果物: `spec_creator.ts` の責務を prompt/context/polish utilities へ分離し、`spec_creator.ts` は再export ハブへ縮小する。
  - transport: `spec_creator.ts` 混在ロジック -> `spec_creator_prompt.ts` / `spec_creator_context.ts` / `spec_creator_polish_utils.ts` -> 既存 import 経路へ再接続
  - fail-closed: `specCreatorPolishCommand -> runSpecCreatorWorkflow` 実行経路に差分が出た場合は受け入れ不可
  - 経路テスト: `deno test --allow-read --allow-write --allow-env --allow-run src/infrastructure/openspec/spec_creator_test.ts`
  - 拒否テスト: `deno check` 失敗または本線関数とテスト専用関数の参照境界崩れは reject
- [ ] 1.5 `orchestrator.ts` を安全順で段階抽出する
  - 依存: 1.3, 1.4
  - 対象: src/application/orchestrator/orchestrator.ts, src/application/orchestrator/orchestrator_test.ts
  - 関連許可: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/design.md
  - フェーズ担当: implement=implementer; review=code-reviewer
  - 成果物: orchestrator を pure 関数抽出 -> decision 評価抽出 -> decision 実行抽出 -> class責務縮小の安全順で段階分割する。
  - transport: `orchestrator.ts` 集中実装 -> pure/decision/execution の抽出関数 -> class orchestrate 専用化
  - fail-closed: 途中で仕様変更を混ぜず、`this.store`/`this.log`/`this.makeEvent` 依存境界を明示できない変更は reject
  - 経路テスト: `deno test --allow-read --allow-write --allow-env --allow-run src/application/orchestrator/orchestrator_test.ts`
  - 拒否テスト: イベント順序・sendback・blocked 条件の差分が出る実装は reject
- [ ] 1.6 回帰テストと型検査で挙動不変を検証する
  - 依存: 1.2, 1.3, 1.4, 1.5
  - 対象: src/cli/main_test.ts, src/infrastructure/wrapper/helper_test.ts, src/infrastructure/openspec/spec_creator_test.ts, src/application/orchestrator/orchestrator_test.ts
  - 関連許可: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/design.md
  - フェーズ担当: implement=implementer; review=code-reviewer; test=test-owner
  - 成果物: 4系統テストと `deno check` で挙動不変を検証し、責務移動のみであることを確認する。
  - transport: 分割済み各モジュール -> 既存コマンド/workflow 実行経路 -> 回帰テストで不変確認
  - fail-closed: いずれかの既存テスト失敗時は完了不可
  - 経路テスト: `deno test --allow-read --allow-write --allow-env --allow-run src/cli/main_test.ts src/infrastructure/wrapper/helper_test.ts src/infrastructure/openspec/spec_creator_test.ts src/application/orchestrator/orchestrator_test.ts`
  - 拒否テスト: `deno check src/**/*.ts` 失敗時は reject
- [ ] 1.7 OpenSpec strict validate を実行する
  - 依存: 1.6
  - 対象: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/proposal.md, openspec/changes/refactor-spec-creator-and-orchestrator-modularization/tasks.md, openspec/changes/refactor-spec-creator-and-orchestrator-modularization/code_summary.md, openspec/changes/refactor-spec-creator-and-orchestrator-modularization/specs/**/spec.md
  - 関連許可: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/design.md
  - フェーズ担当: implement=code-reviewer
  - 成果物: `openspec validate refactor-spec-creator-and-orchestrator-modularization --strict` を実行し、失敗時は修正後に再実行する。

## 2. 人間向けメモ（コンパイラ非対象）
- 要件正規化サマリ:
  - 背景: `spec-creator`/`orchestrator` の責務集中で、レビュー観点漏れと意味論ズレが発生している。
  - 目的: 影響範囲の局所化、レビュー観点固定、意味論を含む完了判定安定化、挙動不変。
  - 最小スコープ: `main.ts` 分割、result parser 共通化、`spec_creator.ts` 分離、`orchestrator.ts` 段階抽出。
  - 非スコープ: 新機能追加、公開シグネチャ変更、判定仕様変更。
  - fail-closed: 既存テスト (`main_test` / `helper_test` / `spec_creator_test` / `orchestrator_test`) 失敗時は完了不可。
- メモ: 重大違反時は `REVIEWER_STOP:requirement_drift|over_editing|verbosity` を reviewer 出力に含める。
- メモ: 利用可能性は `personas` 定義と `フェーズ担当` 割当で担保し、全ペルソナが `execution.enabled=true` かつ `command_ref=default` で実行可能とする。

regenerate targets:
- proposal.md
- tasks.md
- code_summary.md
- specs/**/spec.md
- design.md (必要時のみ)

latest contract (5 lines + judgment):
- review/spec_check/test の完了出力は `5行契約`（RESULT, SUMMARY, CHANGED_FILES, CHECKS, JUDGMENT）を必須とする。
- `JUDGMENT` は必須行で、値は `pass` / `changes_required` / `blocked` のみ許容する。
- 判定は3値化（pass / changes_required / blocked）を前提とする。

必須レビュー契約（RC-01..RC-12）:
- RC-01 RESULT: 最終 result block 抽出と completed|blocked 正規化を定義する
- RC-02 SUMMARY: 抽出・必須・要約用途を定義する
- RC-03 CHANGED_FILES: 正規化し、非implementフェーズでは (none) を必須化する
- RC-04 CHECKS: 抽出・必須・禁止コマンド検査を定義する
- RC-05 JUDGMENT: decision phase 必須、pass|changes_required|blocked 正規化を定義する
- RC-06 判定時系列: blocked 即停止 / changes_required sendback / pass 前進を定義する
- RC-07 reviewer stop: REVIEWER_STOP:requirement_drift|over_editing|verbosity を明記する
- RC-08 実行経路対象: run と spec-creator の両方を対象にする
- RC-09 段階責務: compile と runtime の責務分離を明記する
- RC-10 入力契約キー: task_config.persona_policy.phase_overrides.<phase>.executor_personas を明記する
- RC-11 遷移条件: sendback 条件に blocked=false 前提を明記する
- RC-12 テスト契約: MUST/SHALL ごとに経路テストと fail-closed拒否テストを要求する
### openspec/changes/refactor-spec-creator-and-orchestrator-modularization/tasks.md
## 0. Persona Defaults
- persona_defaults.phase_order: implement, review, spec_check, test
- persona_defaults: {"phase_order":["implement","review","spec_check","test"]}
- フェーズ担当: implement=implementer; review=code-reviewer; spec_check=spec-checker; test=test-owner
- personas: [{"id":"implementer","role":"implementer","focus":"実装を前進させる","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}},{"id":"code-reviewer","role":"reviewer","focus":"品質と回帰リスクを確認する","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}},{"id":"spec-checker","role":"spec_guard","focus":"仕様逸脱を防ぐ","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}},{"id":"test-owner","role":"test_guard","focus":"検証の十分性を担保し、要件ごとにtransport経路テストとfail-closed拒否テストを確認する","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}}]

### 0.1 テンプレート利用ルール
- この雛形を `openspec/changes/<change-id>/tasks.md` にコピーし、`<...>` を実タスクで置換する。
- `persona_defaults.phase_order` と `フェーズ担当` の固定行は削除しない。
- `personas:` は **1行JSON** で記述する（YAMLの複数行形式は compiler が受理しない）。
- ペルソナを実行主体にする場合は `personas` 行を残す。消すと実行主体は `teammate-*` になる。
- 各タスクに `- フェーズ担当:` を記述し、`implement=implementer; review=code-reviewer; spec_check=spec-checker; test=test-owner` から必要なフェーズだけ選ぶ。
- 例: `- フェーズ担当: implement=implementer; review=code-reviewer`（未指定フェーズはグローバル既定を使う）。
- すべての実施項目（検証を含む）は **`## 1. 実装タスク` のチェックボックス付きタスク** として記述する（`## 2. 検証項目` は使わない）。
- 人間向けメモは `## 2. 人間向けメモ（コンパイラ非対象）` に **チェックボックスなし** で記述する。
- MUST/SHALL ごとに `transport` 経路（producer -> carrier -> consumer）を定義し、対象タスクへ明記する。
- MUST/SHALL ごとに fail-closed の拒否点（どこで、何を理由に reject/block するか）を定義し、対象タスクへ明記する。
- MUST/SHALL ごとに「経路テスト1件 + 拒否テスト1件」を対応付け、実行コマンドを対象タスクへ明記する。

### 0.2 Provider 完了判定ゲート（固定）
- `ORCHESTRATOR_PROVIDER=mock` 実行のみでは完了扱いにしない。
- 対象プロジェクトの実運用実行経路での受け入れ実行を必須とする。
- `not implemented` 等の未実装エラーは未完了として扱う（fail-closed）。

## 1. 実装タスク
- [ ] 1.1 要件をOpenSpec要素へ正規化する
  - 依存: なし
  - 対象: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/proposal.md, openspec/changes/refactor-spec-creator-and-orchestrator-modularization/tasks.md, openspec/changes/refactor-spec-creator-and-orchestrator-modularization/code_summary.md, openspec/changes/refactor-spec-creator-and-orchestrator-modularization/specs/**/spec.md
  - 関連許可: なし
  - フェーズ担当: implement=implementer; review=code-reviewer
  - persona_policy: {"phase_order":["implement","review"]}
  - 成果物: requirements_text を整理し、change の最小スコープを定義する。
- [ ] 1.2 proposal.md を生成する
  - 依存: 1.1
  - 対象: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/proposal.md
  - 関連許可: なし
  - フェーズ担当: implement=implementer; review=code-reviewer
  - persona_policy: {"phase_order":["implement","review"]}
  - 成果物: 変更理由、変更内容、影響範囲を proposal.md に記述する。
- [ ] 1.3 tasks.md を固定テンプレート準拠で生成する
  - 依存: 1.2
  - 対象: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/tasks.md
  - 関連許可: なし
  - フェーズ担当: implement=implementer; review=code-reviewer
  - persona_policy: {"phase_order":["implement","review"]}
  - 成果物: print-openspec-template の固定行を維持し、実装タスクを checklist 形式で定義する。 RC-01..RC-12 を tasks.md(1.3) と specs/**/spec.md の両方へ同義で反映し、欠落は fail-closed とする。 - RC-01 RESULT: 最終 result block 抽出と completed|blocked 正規化を定義する - RC-02 SUMMARY: 抽出・必須・要約用途を定義する - RC-03 CHANGED_FILES: 正規化し、非implementフェーズでは (none) を必須化する - RC-04 CHECKS: 抽出・必須・禁止コマンド検査を定義する - RC-05 JUDGMENT: decision phase 必須、pass|changes_required|blocked 正規化を定義する - RC-06 判定時系列: blocked 即停止 / changes_required sendback / pass 前進を定義する - RC-07 reviewer stop: REVIEWER_STOP:requirement_drift|over_editing|verbosity を明記する - RC-08 実行経路対象: run と spec-creator の両方を対象にする - RC-09 段階責務: compile と runtime の責務分離を明記する - RC-10 入力契約キー: task_config.persona_policy.phase_overrides.<phase>.executor_personas を明記する - RC-11 遷移条件: sendback 条件に blocked=false 前提を明記する - RC-12 テスト契約: MUST/SHALL ごとに経路テストと fail-closed拒否テストを要求する
- [ ] 1.5 code_summary.md を生成する
  - 依存: 1.3
  - 対象: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/code_summary.md
  - 関連許可: なし
  - フェーズ担当: implement=implementer; review=code-reviewer
  - persona_policy: {"phase_order":["implement","review"]}
  - 成果物: tasks.md の task_id と code unit の対応を code_summary.md に記述する。
- [ ] 1.6 生成成果物の整合性をレビューする
  - 依存: 1.2, 1.3, 1.5
  - 対象: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/proposal.md, openspec/changes/refactor-spec-creator-and-orchestrator-modularization/tasks.md, openspec/changes/refactor-spec-creator-and-orchestrator-modularization/code_summary.md, openspec/changes/refactor-spec-creator-and-orchestrator-modularization/specs/**/spec.md
  - 関連許可: なし
  - フェーズ担当: implement=implementer; review=code-reviewer
  - persona_policy: {"phase_order":["implement","review"]}
  - 成果物: proposal/tasks/design/code_summary の整合、要件逸脱、過剰修正、冗長化を検証する。実行経路、段階責務、判定時系列、入力契約、テスト整合、データモデルキー整合、遷移条件、利用可能性(定義だけでなく割当/実行可能)を確認する。
- [ ] 1.7 OpenSpec compile + strict validate を実行する
  - 依存: 1.6
  - 対象: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/proposal.md, openspec/changes/refactor-spec-creator-and-orchestrator-modularization/tasks.md, openspec/changes/refactor-spec-creator-and-orchestrator-modularization/code_summary.md, openspec/changes/refactor-spec-creator-and-orchestrator-modularization/specs/**/spec.md
  - 関連許可: なし
  - フェーズ担当: implement=code-reviewer
  - persona_policy: {"phase_order":["implement"]}
  - 成果物: agent-dock compile-openspec --change-id <change_id> と openspec validate <change_id> --strict を実行し、失敗時は修正後に再実行する。

## 2. 人間向けメモ（コンパイラ非対象）
- 要件メモ:
  > polish target: refactor-spec-creator-and-orchestrator-modularization
  > source_markdown_context:
  > ### openspec/changes/refactor-spec-creator-and-orchestrator-modularization/code_summary.md
  > # code_summary.md
  > 
  > Implementation mapping from tasks.md to code units.
  > 
  > ## task_id: 1.1
  > 
  > ### code_unit_1
  > - file: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/proposal.md
  > - service: change scope definition
  > - function: Why / Goals / What Changes / Non-Goals / Impact / Provider・Reviewer 固定ゲート sections
  > - purpose: requirements_text を OpenSpec proposal の標準要素へ正規化し、change の最小スコープと固定ゲートを明示する。
  > - input: 背景・目的・対応策の生テキスト
  > - output: スコープ境界と非スコープを明記した提案文
  > - error: 要件外の追加やスコープ未固定
  > - test: `openspec validate refactor-spec-creator-and-orchestrator-modularization --strict`
  > 
  > ### code_unit_2
  > - file: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/specs/refactor-spec-creator-and-orchestrator-modularization/spec.md
  > - service: normative requirement decomposition
  > - function: ADDED Requirements
  > - purpose: 生テキストを SHALL 要件へ分解し、4つの分割対象・挙動不変・Provider/Reviewer 固定ゲートを Requirement/Scenario で定義する。
  > - input: 4つの対応策と完了条件
  > - output: 機械可読な OpenSpec delta
  > - error: Requirement 漏れ、Scenario 未定義
  > - test: `openspec validate refactor-spec-creator-and-orchestrator-modularization --strict`
  > 
  > ### code_unit_3
  > - file: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/tasks.md
  > - service: execution traceability
  > - function: task 1.1 checklist + persona phase order + fixed-gate normalization
  > - purpose: task 1.1 の完了状態と最小スコープ要約、実行主体割当、固定ゲートを tasks 側に反映し、proposal/spec と整合させる。
  > - input: 正規化済み要件
  > - output: 実行計画と要件サマリの一致
  > - error: checklist と成果物の不一致
  > - test: `openspec validate refactor-spec-creator-and-orchestrator-modularization --strict`
  > 
  > ### code_unit_4
  > - file: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/design.md
  > - service: scope boundary and fail-closed gates
  > - function: Context / Goals / Non-Goals / 判定時系列 / Fail-Closed 境界
  > - purpose: 変更境界、判定時系列、固定ゲート、回帰時の拒否条件を設計文脈として固定する。
  > - input: 要件の最小スコープと受け入れ条件
  > - output: 境界逸脱を防ぐ設計ガード
  > - error: fail-closed 条件の欠落
  > - test: `openspec validate refactor-spec-creator-and-orchestrator-modularization --strict`
  > 
  > ## task_id: 1.2
  > 
  > ### code_unit_1
  > - file: src/cli/main.ts
  > - service: CLI entrypoint compatibility
  > - function: main / buildTeammateAdapter / defaultTeammateCommand / parseTeammatesArg / collectSpecCreatorApplyManifestForTest
  > - purpose: `main.ts` をコマンドディスパッチ専用に縮小しつつ既存 export 互換を維持する。
  > - input: argv、環境変数、teammate 実行設定
  > - output: 分割済み command/args/workflow への委譲と互換 export
  > - error: 公開シグネチャ差分や分岐欠落
  > - test: `deno test --allow-read --allow-write --allow-env --allow-run src/cli/main_test.ts`
  > 
  > ### code_unit_2
  > - file: src/cli/commands/spec_creator.ts
  > - service: spec-creator command execution
  > - function: specCreatorCommand / specCreatorPolishCommand
  > - purpose: spec-creator 実行入口を `main.ts` から移設し、実行経路を明示化する。
  > - input: parse 済み spec-creator 引数、workflow 依存
  > - output: `runSpecCreatorWorkflow` 呼び出しと終了コード
  > - error: workflow 呼び出し漏れや polish 分岐崩れ
  > - test: `deno test --allow-read --allow-write --allow-env --allow-run src/cli/main_test.ts`
  > 
  > ### code_unit_3
  > - file: src/cli/commands/run.ts
  > - service: run command execution
  > - function: run command handler
  > - purpose: run 本体処理と adapter 組み立ての実処理責務を `main.ts` から分離する。
  > - input: parse 済み run 引数、runtime 設定
  > - output: run 実行フローの開始と完了状態
  > - error: run ルートの委譲欠落や引数不整合
  > - test: `deno test --allow-read --allow-write --allow-env --allow-run src/cli/main_test.ts`
  > 
  > ### code_unit_4
  > - file: src/cli/args/spec_creator_args.ts
  > - service: spec-creator args parser
  > - function: parseSpecCreatorArgs / parseSpecCreatorPolishArgs
  > - purpose: spec-creator 系引数解釈を独立モジュール化し、main から分離する。
  > - input: CLI 引数配列
  > - output: 正規化済み spec-creator 実行オプション
  > - error: 必須引数欠落や不正オプション許容
  > - test: `deno test --allow-read --allow-write --allow-env --allow-run src/cli/main_test.ts`
  > 
  > ### code_unit_5
  > - file: src/cli/args/run_args.ts
  > - service: run args parser
  > - function: parseRunArgs
  > - purpose: run 用引数解釈を独立化して責務境界を固定する。
  > - input: CLI 引数配列
  > - output: 正規化済み run 実行オプション
  > - error: run 引数の解釈差分
  > - test: `deno test --allow-read --allow-write --allow-env --allow-run src/cli/main_test.ts`
  > 
  > ### code_unit_6
  > - file: src/cli/spec_creator_workflow.ts
  > - service: spec-creator workflow orchestration
  > - function: runSpecCreatorWorkflow / runStagedStrictValidate / runSpecCreatorPostAuditGate / applyStagedArtifactsAtomically
  > - purpose: staged validate/post-audit/apply を workflow 層へ集約し、command 層と分離する。
  > - input: command 層から渡される workflow 実行コンテキスト
  > - output: apply 判定、監査ゲート結果、終了コード
  > - error: staged 検証スキップや apply 手順差分
  > - test: `deno test --allow-read --allow-write --allow-env --allow-run src/cli/main_test.ts`
  > 
  > ### code_unit_7
  > - file: src/cli/main_test.ts
  > - service: CLI regression guard
  > - function: main command routing and export compatibility tests
  > - purpose: 分割後も公開 API と実行経路が不変であることを検証する。
  > - input: CLI サブコマンド/引数のテストケース
  > - output: 挙動差分の fail-closed 検出
  > - error: 既存テスト失敗
  > - test: `deno test --allow-read --allow-write --allow-env --allow-run src/cli/main_test.ts`
  > 
  > ## task_id: 1.3
  > 
  > ### code_unit_1
  > - file: src/domain/execution_result.ts
  > - service: shared execution result parsing contract
  > - function: result block extraction / judgment normalization / changed-files normalization / phase judgment requirement
  > - purpose: RESULT/SUMMARY/CHANGED_FILES/CHECKS/JUDGMENT の解釈を単一実装に統一する。
  > - input: teammate 実行ログ文字列、phase 情報
  > - output: wrapper/orchestrator 共通の正規化済み実行結果
  > - error: judgment 欠落や正規化不能値
  > - test: `deno test --allow-read --allow-write --allow-env --allow-run src/infrastructure/wrapper/helper_test.ts src/application/orchestrator/orchestrator_test.ts`
  > 
  > ### code_unit_2
  > - file: src/infrastructure/wrapper/helper.ts
  > - service: wrapper integration with shared parser
  > - function: replace extractResultBlock callsite with shared parser
  > - purpose: wrapper 側が共通 parser を利用しつつ forbidden command 検査など固有制約は維持する。
  > - input: wrapper の execute 出力
  > - output: 共通契約で正規化された result block
  > - error: wrapper 固有 fail-closed 制約の混在/欠落
  > - test: `deno test --allow-read --allow-write --allow-env --allow-run src/infrastructure/wrapper/helper_test.ts`
  > 
  > ### code_unit_3
  > - file: src/application/orchestrator/orchestrator.ts
  > - service: orchestrator integration with shared parser
  > - function: replace parseExecutionResultBlock callsite with shared parser
  > - purpose: orchestrator 側の判定入力解釈を domain 共通化に合わせ、解釈差を排除する。
  > - input: decision/execute フェーズの teammate 出力
  > - output: 共通契約での判定入力データ
  > - error: phase 別必須判定の取りこぼし
  > - test: `deno test --allow-read --allow-write --allow-env --allow-run src/application/orchestrator/orchestrator_test.ts`
  > 
  > ### code_unit_4
  > - file: src/infrastructure/wrapper/helper_test.ts
  > - service: wrapper parser regression tests
  > - function: execution result parsing expectations
  > - purpose: 共通化後も wrapper 側の期待文字列と fail-closed 条件を維持する。
  > - input: result block サンプル
  > - output: 既存期待値との一致
  > - error: 期待文字列差分
  > - test: `deno test --allow-read --allow-write --allow-env --allow-run src/infrastructure/wrapper/helper_test.ts`
  > 
  > ### code_unit_5
  > - file: src/application/orchestrator/orchestrator_test.ts
  > - service: orchestrator parser regression tests
  > - function: execution result parsing and decision feed expectations
  > - purpose: orchestrator 側で parser 置換後も判定入力の意味論を維持する。
  > - input: decision フェーズ実行サンプル
  > - output: 既存期待値との一致
  > - error: 判定分岐差分
  > - test: `deno test --allow-read --allow-write --allow-env --allow-run src/application/orchestrator/orchestrator_test.ts`
  > 
  > ## task_id: 1.4
  > 
  > ### code_unit_1
  > - file: src/infrastructure/openspec/spec_creator_prompt.ts
  > - service: spec-creator prompt composition
  > - function: buildSpecCreatorPolishPrompt
  > - purpose: polish prompt 生成と language/contract 行生成を本線ロジックから分離する。
  > - input: markdown context、実行パラメータ、language 設定
  > - output: polish 用 prompt 文字列
  > - error: contract 行欠落や言語判定誤り
  > - test: `deno test --allow-read --allow-write --allow-env --allow-run src/infrastructure/openspec/spec_creator_test.ts`
  > 
  > ### code_unit_2
  > - file: src/infrastructure/openspec/spec_creator_context.ts
  > - service: spec-creator markdown context collection
  > - function: collectSpecCreatorPolishMarkdownContexts / collectChangeFilesRecursively
  > - purpose: markdown 収集と再帰探索責務を分離し、本線実行の追跡性を上げる。
  > - input: change directory、収集ルール
  > - output: polish 入力用 markdown context 一覧
  > - error: 収集漏れや非対象ファイル混入
  > - test: `deno test --allow-read --allow-write --allow-env --allow-run src/infrastructure/openspec/spec_creator_test.ts`
  > 
  > ### code_unit_3
  > - file: src/infrastructure/openspec/spec_creator_polish_utils.ts
  > - service: spec-creator polish utilities
  > - function: polishMarkdownFiles / checkNonMarkdownConsistency / buildPolishSummary
  > - purpose: markdown 整形・整合チェック・サマリ生成の補助ロジックを分離する。
  > - input: polish 生成結果、既存 artifacts
  > - output: 整形済み markdown、整合チェック結果、summary
  > - error: non-markdown 不整合の見逃し
  > - test: `deno test --allow-read --allow-write --allow-env --allow-run src/infrastructure/openspec/spec_creator_test.ts`
  > 
  > ### code_unit_4
  > - file: src/infrastructure/openspec/spec_creator.ts
  > - service: spec-creator public module surface
  > - function: re-export hub for prompt/context/polish utilities
  > - purpose: 既存 import 互換を維持しつつ、責務本体を分割モジュールへ委譲する。
  > - input: 既存呼び出し元からの import
  > - output: 互換 API surface
  > - error: 再 export 欠落による import 破壊
  > - test: `deno test --allow-read --allow-write --allow-env --allow-run src/infrastructure/openspec/spec_creator_test.ts`
  > 
  > ### code_unit_5
  > - file: src/cli/main.ts
  > - service: CLI import boundary update
  > - function: spec creator import rewiring
  > - purpose: 分割後モジュールへの import を main 側で差し替え、実行経路を維持する。
  > - input: spec creator 参照先モジュール
  > - output: `specCreatorPolishCommand -> runSpecCreatorWorkflow` 経路維持
  > - error: import 差し替え漏れ
  > - test: `deno check src/cli/main.ts src/infrastructure/openspec/spec_creator.ts`
  > 
  > ### code_unit_6
  > - file: src/infrastructure/openspec/spec_creator_test.ts
  > - service: spec-creator split regression tests
  > - function: prompt/context/polish behavior parity tests
  > - purpose: 分割前後で本線挙動と補助ロジックの境界が崩れていないことを固定する。
  > - input: spec_creator 実行系テストケース
  > - output: 既存挙動との一致
  > - error: 実行経路差分
  > - test: `deno test --allow-read --allow-write --allow-env --allow-run src/infrastructure/openspec/spec_creator_test.ts`
  > 
  > ## task_id: 1.5
  > 
  > ### code_unit_1
  > - file: src/application/orchestrator/orchestrator.ts
  > - service: orchestrator pure function extraction
  > - function: detectReviewerStopRule and parser-related pure helpers
  > - purpose: まず pure 関数を抽出して副作用境界を明確化し、段階分割の土台を作る。
  > - input: reviewer 出力・実行結果文字列
  > - output: side-effect free 判定結果
  > - error: pure 化時の意味論差分
  > - test: `deno test --allow-read --allow-write --allow-env --allow-run src/application/orchestrator/orchestrator_test.ts`
  > 
  > ### code_unit_2
  > - file: src/application/orchestrator/orchestrator.ts
  > - service: decision evaluation extraction
  > - function: resolveDecisionPhaseBlockReason equivalent helpers
  > - purpose: decision 判定理由の評価ロジックを分離し、分岐条件を追跡しやすくする。
  > - input: decision phase 状態、execution result
  > - output: block/sendback/pass 判定理由
  > - error: 判定優先順位の崩れ
  > - test: `deno test --allow-read --allow-write --allow-env --allow-run src/application/orchestrator/orchestrator_test.ts`
  > 
  > ### code_unit_3
  > - file: src/application/orchestrator/orchestrator.ts
  > - service: decision phase execution extraction
  > - function: executeDecisionPersonaResult / processOrderedDecisionPhaseExecution
  > - purpose: decision 実行制御を独立化し、class 本体から手続き混在を除去する。
  > - input: phase 順序、persona 実行結果
  > - output: phase 実行結果と次遷移
  > - error: sendback や blocked 遷移の崩れ
  > - test: `deno test --allow-read --allow-write --allow-env --allow-run src/application/orchestrator/orchestrator_test.ts`
  > 
  > ### code_unit_4
  > - file: src/application/orchestrator/orchestrator.ts
  > - service: orchestration boundary reduction
  > - function: class-level orchestration with injected store/log/event dependencies
  > - purpose: `this.store` / `this.log` / `this.makeEvent` 依存境界を明示し、class を orchestration 専用に縮小する。
  > - input: 抽出済み helper 関数群と依存注入
  > - output: 仕様不変の orchestrator class
  > - error: 依存境界の隠れ再結合
  > - test: `deno test --allow-read --allow-write --allow-env --allow-run src/application/orchestrator/orchestrator_test.ts`
  > 
  > ### code_unit_5
  > - file: src/application/orchestrator/orchestrator_test.ts
  > - service: orchestrator behavior regression tests
  > - function: event order / sendback / blocked invariance tests
  > - purpose: 段階分割中もイベント順序・sendback 挙動・blocked 条件の不変を保証する。
  > - input: orchestrator 実行シナリオ
  > - output: 分割前後の期待一致
  > - error: 期待イベント列差分
  > - test: `deno test --allow-read --allow-write --allow-env --allow-run src/application/orchestrator/orchestrator_test.ts`
  > 
  > ## task_id: 1.6
  > 
  > ### code_unit_1
  > - file: src/cli/main_test.ts
  > - service: CLI regression verification
  > - function: main split parity tests
  > - purpose: `main.ts` 分割後もコマンドディスパッチと公開互換が不変であることを確認する。
  > - input: CLI 実行シナリオ
  > - output: 既存期待値の一致
  > - error: main 経路の回帰
  > - test: `deno test --allow-read --allow-write --allow-env --allow-run src/cli/main_test.ts`
  > 
  > ### code_unit_2
  > - file: src/infrastructure/wrapper/helper_test.ts
  > - service: wrapper parser regression verification
  > - function: helper parser parity tests
  > - purpose: parser 共通化後の wrapper 側 result 解釈を固定する。
  > - input: wrapper 結果ブロックテスト
  > - output: 既存期待値の一致
  > - error: parser 解釈差分
  > - test: `deno test --allow-read --allow-write --allow-env --allow-run src/infrastructure/wrapper/helper_test.ts`
  > 
  > ### code_unit_3
  > - file: src/infrastructure/openspec/spec_creator_test.ts
  > - service: spec-creator split regression verification
  > - function: prompt/context/polish split parity tests
  > - purpose: spec_creator 分割後の実行本線挙動を固定する。
  > - input: spec_creator 実行テスト
  > - output: 既存期待値の一致
  > - error: 本線/補助境界崩れ
  > - test: `deno test --allow-read --allow-write --allow-env --allow-run src/infrastructure/openspec/spec_creator_test.ts`
  > 
  > ### code_unit_4
  > - file: src/application/orchestrator/orchestrator_test.ts
  > - service: orchestrator split regression verification
  > - function: orchestrator stage extraction parity tests
  > - purpose: orchestrator 段階抽出後のイベント順序・sendback・blocked 条件を固定する。
  > - input: orchestrator シナリオテスト
  > - output: 既存期待値の一致
  > - error: decision 遷移差分
  > - test: `deno test --allow-read --allow-write --allow-env --allow-run src/application/orchestrator/orchestrator_test.ts`
  > 
  > ### code_unit_5
  > - file: src/**/*.ts
  > - service: TypeScript static check gate
  > - function: deno check compile surface
  > - purpose: 責務移動後の import/type 整合をコンパイルレベルで検証する。
  > - input: src 配下 TypeScript 全体
  > - output: 型検査成功
  > - error: unresolved import / type error
  > - test: `deno check src/**/*.ts`
  > 
  > ## task_id: 1.7
  > 
  > ### code_unit_1
  > - file: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/proposal.md
  > - service: OpenSpec strict validation gate
  > - function: change-level strict validator
  > - purpose: proposal/tasks/code_summary/specs の整合と format を strict モードで最終検証する。
  > - input: change 配下の OpenSpec artifacts 一式
  > - output: strict validate pass
  > - error: OpenSpec 形式違反や参照不整合
  > - test: `openspec validate refactor-spec-creator-and-orchestrator-modularization --strict`
  > 
  > ### code_unit_2
  > - file: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/tasks.md
  > - service: implementation checklist closure
  > - function: task dependency and completion trace check
  > - purpose: `depends_on` 順序と成果物整合を strict validate の入力として成立させる。
  > - input: 実装タスク定義と依存関係
  > - output: 検証可能な task 閉路
  > - error: 依存関係や対象パス不整合
  > - test: `openspec validate refactor-spec-creator-and-orchestrator-modularization --strict`
  > 
  > ### code_unit_3
  > - file: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/code_summary.md
  > - service: task-to-code traceability
  > - function: task_id to code_unit mapping coverage
  > - purpose: `tasks.md` 全 task_id を code unit に対応付け、実装追跡可能性を保証する。
  > - input: task_id と対象パス定義
  > - output: 欠落のない対応表
  > - error: task_id 対応漏れ
  > - test: `openspec validate refactor-spec-creator-and-orchestrator-modularization --strict`
  > ### openspec/changes/refactor-spec-creator-and-orchestrator-modularization/design.md
  > # Design: refactor-spec-creator-and-orchestrator-modularization
  > 
  > ## design.md を作成する判断
  > この変更は以下に該当するため、`design.md` を作成・維持して設計判断を固定する。
  > - `main.ts` / `spec_creator.ts` / `orchestrator.ts` / `helper.ts` など複数モジュールに跨る責務再編
  > - 実行結果解釈（RESULT/SUMMARY/CHANGED_FILES/CHECKS/JUDGMENT）の共通化という横断判断
  > - 段階的移行順序を誤ると挙動差分が混入しやすい領域
  > - テスト green だけでなく意味論（sendback/blocked/イベント順序）の不変条件を明示する必要
  > 
  > ## Context
  > - `spec-creator` / `orchestrator` 周辺は単一ファイルへの責務集中が進み、変更時の影響範囲とレビュー観点の追跡が難しい。
  > - 仕様上は通るが運用上の意味論がずれる問題が発生しており、構造起因の再発リスクがある。
  > - 本 change は「挙動不変」を前提に、責務分割と共通化のみを行う。
  > 
  > ## Goals
  > - 構造分割で変更影響を局所化する。
  > - レビュー時に確認すべき責務境界を固定する。
  > - 完了判定を形式一致だけでなく意味論一致まで安定化する。
  > 
  > ## Non-Goals
  > - 新規機能追加、判定ルール変更、公開シグネチャ変更。
  > - 責務分割と無関係な最適化、広域リネーム、仕様文言変更。
  > 
  > ## 判定時系列と固定ゲート
  > - 判定時系列は `implement -> review -> spec_check -> test` を固定し、段階責務の逆流を許容しない。
  > - `review` で `REVIEWER_STOP:requirement_drift|over_editing|verbosity` を検出した場合は blocker として停止する。
  > - `test` 完了判定では `ORCHESTRATOR_PROVIDER=mock` 単独実行を不合格とし、`not implemented` は未完了扱いにする。
  > - 実行結果の入力契約は `RESULT` / `SUMMARY` / `CHANGED_FILES` / `CHECKS` / `JUDGMENT` の5キーを共通正規化対象とする。
  > - 利用可能性は `tasks.md` の `personas` 定義（`execution.enabled=true`, `command_ref=default`）とフェーズ割当で担保する。
  > 
  > ## Decisions and Trade-offs
  > 
  > ### 1) 分割順序を固定する
  > 決定:
  > 1. `src/cli/main.ts` 分割
  > 2. result parser 共通化（`src/domain/execution_result.ts`）
  > 3. `spec_creator.ts` 本線/補助分離
  > 4. `orchestrator.ts` 段階抽出
  > 
  > 理由:
  > - 依存の浅い領域から先に分割し、最難所の `orchestrator.ts` を最後に回すことで回帰時の原因切り分けを容易にする。
  > 
  > トレードオフ:
  > - 先行タスクで一時的な重複状態が残る期間が生まれるが、同時多発の大規模変更より安全性を優先する。
  > 
  > ### 2) 「挙動不変」を公開契約と回帰テストで二重固定する
  > 決定:
  > - `main.ts` に残す公開 export（`main`, `buildTeammateAdapter`, `defaultTeammateCommand`, `parseTeammatesArg`, `collectSpecCreatorApplyManifestForTest`）は不変とする。
  > - 完了条件は既存テスト green と `deno check` による型整合を必須化する。
  > 
  > 理由:
  > - リファクタの目的は構造改善であり、外部契約の変更は別 change で扱うべきため。
  > 
  > トレードオフ:
  > - 内部設計の自由度は下がるが、利用側への影響を最小化できる。
  > 
  > ### 3) result parser は共通化するが wrapper 固有制約は分離維持する
  > 決定:
  > - `extractResultBlock` と `parseExecutionResultBlock` の重複は `src/domain/execution_result.ts` に集約する。
  > - forbidden command 検査など wrapper 固有制約は共通層に取り込まない。
  > 
  > 理由:
  > - 共通化対象を「出力フォーマット解釈」に限定し、ドメイン責務と実行基盤責務の境界を保つ。
  > 
  > トレードオフ:
  > - 完全統合より実装重複が一部残る可能性はあるが、責務汚染と将来の副作用を抑制できる。
  > 
  > ### 4) `spec_creator.ts` は再export ハブへ縮小する
  > 決定:
  > - prompt/context/polish utilities を別モジュールへ分離し、`spec_creator.ts` は import 互換維持のハブとする。
  > 
  > 理由:
  > - 本線実行経路を追いやすくし、テスト専用補助ロジックとの混在を解消する。
  > 
  > トレードオフ:
  > - ファイル数増加で探索コストは上がるが、責務境界が明確になりレビュー漏れを減らせる。
  > 
  > ### 5) `orchestrator.ts` は pure 関数抽出から段階移行する
  > 決定:
  > - 先に pure 関数を抽出し、次に decision 評価、最後に decision 実行を抽出する。
  > - `this.store` / `this.log` / `this.makeEvent` 依存は境界を明示しつつ引数化を進める。
  > 
  > 理由:
  > - もっとも壊れやすい領域であり、責務移動と仕様変更を混在させると回帰要因を特定できなくなるため。
  > 
  > トレードオフ:
  > - 最終形到達まで段階数が増え実装期間は伸びるが、イベント順序・sendback・blocked 条件の不変を守りやすい。
  > 
  > ## Fail-Closed 境界
  > - CLI 分割: 公開 export 互換崩れまたは `src/cli/main_test.ts` 失敗時は受け入れ不可。
  > - result parser 共通化: `src/infrastructure/wrapper/helper_test.ts` / `src/application/orchestrator/orchestrator_test.ts` 失敗時は受け入れ不可。
  > - `spec_creator.ts` 分離: `src/infrastructure/openspec/spec_creator_test.ts` 失敗または実行経路差分検出時は受け入れ不可。
  > - orchestrator 段階抽出: イベント順序・sendback・blocked 条件の差分検出時は受け入れ不可。
  > 
  > ## Alternatives Considered
  > - 代替案: `main.ts` / parser / `spec_creator.ts` / `orchestrator.ts` を一括分割
  >   - 却下理由: 変更面積が大きすぎて差分原因の切り分けが困難になり、挙動不変保証が弱くなる。
  > - 代替案: parser 共通化を見送り、重複実装を維持
  >   - 却下理由: 判定解釈のズレ温床が残り、意味論一致の安定化という目的に反する。
  > - 代替案: `orchestrator.ts` をクラス分割から先に実施
  >   - 却下理由: 依存注入境界が曖昧なまま構造変更すると仕様変更混入リスクが高い。
  > ### openspec/changes/refactor-spec-creator-and-orchestrator-modularization/proposal.md
  > # 変更提案: spec-creator / orchestrator の責務分割を段階導入する
  > 
  > ## 変更理由
  > - spec-creator 周辺は機能追加を優先した結果、1ファイルに責務が集まり、変更影響が読みにくい状態になっている。
  > - レビュー時に観点漏れが発生しやすく、仕様は通っても意味論がずれて運用で迷う事象が発生した。
  > - 今後も同等の速度で機能追加を継続するには、先に構造を整理し再発要因を減らす必要がある。
  > 
  > ## 変更内容
  > - 目的:
  >   - 変更時に壊れる範囲を小さくする。
  >   - レビュー時に「どの責務をどこで見るか」を固定化する。
  >   - 完了判定を形式一致だけでなく意味論一致まで安定化する。
  >   - リファクタ中は外部挙動と公開シグネチャを変更しない。
  > - 最小スコープ:
  >   - `src/cli/main.ts` を command/args/workflow に分割し、`main.ts` にはディスパッチと既存 export 互換のみ残す。
  >   - 実行結果パーサ重複を `src/domain/execution_result.ts` へ集約し、`helper.ts` と `orchestrator.ts` から共通利用する。
  >   - `src/infrastructure/openspec/spec_creator.ts` の混在責務を prompt/context/polish utilities へ分割し、再export ハブへ縮小する。
  >   - `src/application/orchestrator/orchestrator.ts` を pure 関数抽出から段階分割し、判定ロジックと実行ロジックの境界を明確化する。
  > - この change でやらないこと:
  >   - 新機能追加、判定ルール変更、メッセージ仕様変更。
  >   - CLI 公開関数シグネチャ変更、既存実行経路変更。
  >   - 責務移動と無関係な最適化や広域リネーム。
  > 
  > ## 影響範囲
  > - 影響する仕様:
  >   - `refactor-spec-creator-and-orchestrator-modularization`（ADDED）
  > - 主な実装対象:
  >   - `src/cli/main.ts`, `src/cli/commands/*`, `src/cli/args/*`, `src/cli/spec_creator_workflow.ts`
  >   - `src/domain/execution_result.ts`, `src/infrastructure/wrapper/helper.ts`
  >   - `src/infrastructure/openspec/spec_creator*.ts`
  >   - `src/application/orchestrator/orchestrator.ts`
  > - 受け入れゲート:
  >   - `src/cli/main_test.ts`
  >   - `src/infrastructure/wrapper/helper_test.ts`
  >   - `src/application/orchestrator/orchestrator_test.ts`
  >   - `src/infrastructure/openspec/spec_creator_test.ts`
  >   - `openspec validate refactor-spec-creator-and-orchestrator-modularization --strict`
  > 
  > ## Provider 完了判定ゲート（固定）
  > - `ORCHESTRATOR_PROVIDER=mock` 実行のみでは完了扱いにしない。
  > - 対象プロジェクトの実運用実行経路での受け入れ実行を必須とする。
  > - `not implemented` 等の未実装エラーは未完了として扱う（fail-closed）。
  > 
  > ## Reviewer 停止判定ゲート（固定）
  > - `spec-reviewer` が重大違反を検出したら `REVIEWER_STOP:requirement_drift|over_editing|verbosity` を出力する。
  > - `REVIEWER_STOP:` を含むレビュー結果は blocker として停止判定する。
  > ### openspec/changes/refactor-spec-creator-and-orchestrator-modularization/specs/refactor-spec-creator-and-orchestrator-modularization/spec.md
  > ## ADDED Requirements
  > 
  > ### Requirement: 変更スコープを構造リファクタへ限定すること
  > システムは本 change の対象を責務分割と重複排除に限定し、機能仕様と外部挙動を変更してはならない（SHALL）。
  > 
  > #### Scenario: スコープ境界が維持される
  > - **WHEN** この change の成果物をレビューする
  > - **THEN** 変更は `main.ts` 分割、実行結果パーサ共通化、`spec_creator.ts` 分割、`orchestrator.ts` 段階抽出に限定される
  > - **AND** 新機能追加や公開契約変更が含まれない
  > 
  > ### Requirement: `src/cli/main.ts` は入口責務へ縮小されること
  > システムは `src/cli/main.ts` から command/args/workflow 責務を分割し、`main.ts` にコマンドディスパッチと既存 export 互換のみを残さなければならない（SHALL）。
  > 
  > #### Scenario: CLI 分割後も互換性を維持する
  > - **WHEN** `main.ts` 分割を適用する
  > - **THEN** `specCreatorCommand` 系、`runSpecCreatorWorkflow` 系、`parse*Args` 系は新規モジュールへ移設される
  > - **AND** `main`, `buildTeammateAdapter`, `defaultTeammateCommand`, `parseTeammatesArg`, `collectSpecCreatorApplyManifestForTest` の公開シグネチャは維持される
  > 
  > ### Requirement: 実行結果パーサは単一モジュールへ共通化されること
  > システムは `RESULT/SUMMARY/CHANGED_FILES/CHECKS/JUDGMENT` の5キー解釈（result block 抽出・RESULT/SUMMARY 抽出必須化・judgment 正規化・`CHANGED_FILES` 正規化・CHECKS 抽出と禁止コマンド検査・phase別 JUDGMENT 必須判定）を `src/domain/execution_result.ts` に集約しなければならない（SHALL）。
  > 
  > #### Scenario: wrapper と orchestrator が同一解釈を使う
  > - **WHEN** `helper.ts` と `orchestrator.ts` が実行結果を解釈する
  > - **THEN** 両者は `src/domain/execution_result.ts` の共通実装を利用する
  > - **AND** wrapper 固有の forbidden command 検査は共通化対象外として残る
  > 
  > ### Requirement: `spec_creator.ts` の本線と補助ロジックを分離すること
  > システムは `spec_creator.ts` の責務を prompt/context/polish utilities に分離し、`spec_creator.ts` 自体は再export ハブへ縮小しなければならない（SHALL）。
  > 
  > #### Scenario: 実行経路を維持したまま責務を分離する
  > - **WHEN** `spec_creator.ts` の分割を適用する
  > - **THEN** prompt 生成は `spec_creator_prompt.ts`、context 収集は `spec_creator_context.ts`、整形補助は `spec_creator_polish_utils.ts` へ移設される
  > - **AND** `specCreatorPolishCommand -> runSpecCreatorWorkflow` の実行経路は変わらない
  > 
  > ### Requirement: `orchestrator.ts` は安全順で段階分割されること
  > システムは `orchestrator.ts` を pure 関数抽出から始め、decision 評価、decision 実行の順で段階分割し、最後に class をオーケストレーション責務へ限定しなければならない（SHALL）。
  > 
  > #### Scenario: 段階抽出中も判定挙動を保持する
  > - **WHEN** orchestrator 分割を段階実施する
  > - **THEN** `this.store`, `this.log`, `this.makeEvent` 依存は境界を明示して引数化される
  > - **AND** イベント順序、sendback 挙動、blocked 条件に差分が発生しない
  > 
  > ### Requirement: 挙動不変を fail-closed で担保すること
  > システムは既存テスト群による差分検知を必須とし、挙動差分が検出された場合は change を完了扱いにしてはならない（SHALL）。
  > 
  > #### Scenario: 回帰検知時に change を停止する
  > - **WHEN** `main_test`、`helper_test`、`spec_creator_test`、`orchestrator_test` のいずれかが失敗する、または `deno check src/**/*.ts` が失敗する
  > - **THEN** 変更は blocked と判定される
  > - **AND** 仕様変更ではなく構造変更として再修正される
  > 
  > ### Requirement: Provider 完了判定は fail-closed に固定されること
  > システムは `ORCHESTRATOR_PROVIDER=mock` 実行のみを完了扱いにしてはならず、`not implemented` 等の未実装エラーを未完了として扱わなければならない（SHALL）。
  > 
  > #### Scenario: mock 単独または未実装エラーを完了として扱わない
  > - **WHEN** 完了判定が `ORCHESTRATOR_PROVIDER=mock` 単独実行結果のみ、または `not implemented` を含む結果で行われる
  > - **THEN** 変更は完了と判定されない
  > - **AND** 実運用実行経路での受け入れ実行が要求される
  > 
  > ### Requirement: Reviewer 停止判定は blocker として扱われること
  > システムは `spec-reviewer` 出力に `REVIEWER_STOP:requirement_drift|over_editing|verbosity` が含まれる場合、停止判定として扱わなければならない（SHALL）。
  > 
  > #### Scenario: reviewer 重大違反時に遷移を停止する
  > - **WHEN** review 結果に `REVIEWER_STOP:` が含まれる
  > - **THEN** 変更は blocker として停止される
  > - **AND** 次フェーズへの遷移は許可されない
  > ### openspec/changes/refactor-spec-creator-and-orchestrator-modularization/tasks.md
  > ## 0. Persona Defaults
  > - persona_defaults.phase_order: implement, review, spec_check, test
  > - persona_defaults: {"phase_order":["implement","review","spec_check","test"]}
  > - フェーズ担当: implement=implementer; review=code-reviewer; spec_check=spec-checker; test=test-owner
  > - personas: [{"id":"implementer","role":"implementer","focus":"実装を前進させる","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}},{"id":"code-reviewer","role":"reviewer","focus":"品質と回帰リスクを確認する","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}},{"id":"spec-checker","role":"spec_guard","focus":"仕様逸脱を防ぐ","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}},{"id":"test-owner","role":"test_guard","focus":"検証の十分性を担保し、要件ごとにtransport経路テストとfail-closed拒否テストを確認する","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}}]
  > 
  > ### 0.1 テンプレート利用ルール
  > - この雛形を `openspec/changes/<change-id>/tasks.md` にコピーし、`<...>` を実タスクで置換する。
  > - `persona_defaults.phase_order` と `フェーズ担当` の固定行は削除しない。
  > - `personas:` は **1行JSON** で記述する（YAMLの複数行形式は compiler が受理しない）。
  > - ペルソナを実行主体にする場合は `personas` 行を残す。消すと実行主体は `teammate-*` になる。
  > - 各タスクに `- フェーズ担当:` を記述し、`implement=implementer; review=code-reviewer; spec_check=spec-checker; test=test-owner` から必要なフェーズだけ選ぶ。
  > - 例: `- フェーズ担当: implement=implementer; review=code-reviewer`（未指定フェーズはグローバル既定を使う）。
  > - すべての実施項目（検証を含む）は **`## 1. 実装タスク` のチェックボックス付きタスク** として記述する（`## 2. 検証項目` は使わない）。
  > - 人間向けメモは `## 2. 人間向けメモ（コンパイラ非対象）` に **チェックボックスなし** で記述する。
  > - MUST/SHALL ごとに `transport` 経路（producer -> carrier -> consumer）を定義し、対象タスクへ明記する。
  > - MUST/SHALL ごとに fail-closed の拒否点（どこで、何を理由に reject/block するか）を定義し、対象タスクへ明記する。
  > - MUST/SHALL ごとに「経路テスト1件 + 拒否テスト1件」を対応付け、実行コマンドを対象タスクへ明記する。
  > 
  > ### 0.2 Provider 完了判定ゲート（固定）
  > - `ORCHESTRATOR_PROVIDER=mock` 実行のみでは完了扱いにしない。
  > - 対象プロジェクトの実運用実行経路での受け入れ実行を必須とする。
  > - `not implemented` 等の未実装エラーは未完了として扱う（fail-closed）。
  > 
  > ### 0.3 Reviewer 停止判定ゲート（固定）
  > - `spec-reviewer` が重大違反を検出したら `REVIEWER_STOP:requirement_drift|over_editing|verbosity` を出力する。
  > - `REVIEWER_STOP:` を含むレビュー結果は blocker として停止判定する。
  > 
  > ## 1. 実装タスク
  > - [x] 1.1 要件をOpenSpec要素へ正規化する
  >   - 依存: なし
  >   - 対象: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/proposal.md, openspec/changes/refactor-spec-creator-and-orchestrator-modularization/tasks.md, openspec/changes/refactor-spec-creator-and-orchestrator-modularization/code_summary.md, openspec/changes/refactor-spec-creator-and-orchestrator-modularization/specs/**/spec.md
  >   - 関連許可: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/design.md
  >   - フェーズ担当: implement=implementer; review=code-reviewer
  >   - 成果物: requirements_text を Why/Goals/Scope/Non-Goals/Acceptance へ再構成し、change の最小スコープを固定する。
  > - [ ] 1.2 `src/cli/main.ts` を command/args/workflow へ分割する
  >   - 依存: 1.1
  >   - 対象: src/cli/main.ts, src/cli/commands/spec_creator.ts, src/cli/commands/run.ts, src/cli/args/spec_creator_args.ts, src/cli/args/run_args.ts, src/cli/spec_creator_workflow.ts, src/cli/main_test.ts
  >   - 関連許可: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/design.md
  >   - フェーズ担当: implement=implementer; review=code-reviewer
  >   - 成果物: `src/cli/main.ts` から command/args/workflow の責務を分割し、`main.ts` にはディスパッチと既存 export 互換のみを残す。
  >   - transport: `main.ts` 既存実装 -> `commands/*` / `args/*` / `spec_creator_workflow.ts` へ移設 -> `main()` から呼び出し
  >   - fail-closed: 公開関数シグネチャ差分または `src/cli/main_test.ts` 失敗時は受け入れ不可
  >   - 経路テスト: `deno test --allow-read --allow-write --allow-env --allow-run src/cli/main_test.ts`
  >   - 拒否テスト: 分割後に `main`, `buildTeammateAdapter`, `defaultTeammateCommand`, `parseTeammatesArg`, `collectSpecCreatorApplyManifestForTest` の export 差分がある場合は reject
  > - [ ] 1.3 実行結果パーサを `src/domain/execution_result.ts` へ共通化する
  >   - 依存: 1.2
  >   - 対象: src/domain/execution_result.ts, src/infrastructure/wrapper/helper.ts, src/infrastructure/wrapper/helper_test.ts, src/application/orchestrator/orchestrator.ts, src/application/orchestrator/orchestrator_test.ts
  >   - 関連許可: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/design.md
  >   - フェーズ担当: implement=implementer; review=code-reviewer
  >   - 成果物: `RESULT/SUMMARY/CHANGED_FILES/CHECKS/JUDGMENT` の5キー解釈（result block 抽出・RESULT/SUMMARY 抽出必須化・judgment 正規化・CHANGED_FILES 正規化・CHECKS 抽出と禁止コマンド検査・phase別 JUDGMENT 必須判定）を `src/domain/execution_result.ts` に共通化し、wrapper/orchestrator から共通利用する。
  >   - transport: wrapper/orchestrator の既存 parser -> `src/domain/execution_result.ts` 共通実装 -> 各呼び出し元へ置換
  >   - fail-closed: `helper.ts` の wrapper 固有制約（forbidden command 検査等）を共通化へ混在させない
  >   - 経路テスト: `deno test --allow-read --allow-write --allow-env --allow-run src/infrastructure/wrapper/helper_test.ts src/application/orchestrator/orchestrator_test.ts`
  >   - 拒否テスト: 既存 result block 期待文字列差分が出る実装は reject
  > - [ ] 1.4 `spec_creator.ts` を本線と補助ロジックへ分離する
  >   - 依存: 1.3
  >   - 対象: src/infrastructure/openspec/spec_creator.ts, src/infrastructure/openspec/spec_creator_prompt.ts, src/infrastructure/openspec/spec_creator_context.ts, src/infrastructure/openspec/spec_creator_polish_utils.ts, src/infrastructure/openspec/spec_creator_test.ts
  >   - 関連許可: src/cli/main.ts
  >   - フェーズ担当: implement=implementer; review=code-reviewer
  >   - 成果物: `spec_creator.ts` の責務を prompt/context/polish utilities へ分離し、`spec_creator.ts` は再export ハブへ縮小する。
  >   - transport: `spec_creator.ts` 混在ロジック -> `spec_creator_prompt.ts` / `spec_creator_context.ts` / `spec_creator_polish_utils.ts` -> 既存 import 経路へ再接続
  >   - fail-closed: `specCreatorPolishCommand -> runSpecCreatorWorkflow` 実行経路に差分が出た場合は受け入れ不可
  >   - 経路テスト: `deno test --allow-read --allow-write --allow-env --allow-run src/infrastructure/openspec/spec_creator_test.ts`
  >   - 拒否テスト: `deno check` 失敗または本線関数とテスト専用関数の参照境界崩れは reject
  > - [ ] 1.5 `orchestrator.ts` を安全順で段階抽出する
  >   - 依存: 1.3, 1.4
  >   - 対象: src/application/orchestrator/orchestrator.ts, src/application/orchestrator/orchestrator_test.ts
  >   - 関連許可: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/design.md
  >   - フェーズ担当: implement=implementer; review=code-reviewer
  >   - 成果物: orchestrator を pure 関数抽出 -> decision 評価抽出 -> decision 実行抽出 -> class責務縮小の安全順で段階分割する。
  >   - transport: `orchestrator.ts` 集中実装 -> pure/decision/execution の抽出関数 -> class orchestrate 専用化
  >   - fail-closed: 途中で仕様変更を混ぜず、`this.store`/`this.log`/`this.makeEvent` 依存境界を明示できない変更は reject
  >   - 経路テスト: `deno test --allow-read --allow-write --allow-env --allow-run src/application/orchestrator/orchestrator_test.ts`
  >   - 拒否テスト: イベント順序・sendback・blocked 条件の差分が出る実装は reject
  > - [ ] 1.6 回帰テストと型検査で挙動不変を検証する
  >   - 依存: 1.2, 1.3, 1.4, 1.5
  >   - 対象: src/cli/main_test.ts, src/infrastructure/wrapper/helper_test.ts, src/infrastructure/openspec/spec_creator_test.ts, src/application/orchestrator/orchestrator_test.ts
  >   - 関連許可: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/design.md
  >   - フェーズ担当: implement=implementer; review=code-reviewer; test=test-owner
  >   - 成果物: 4系統テストと `deno check` で挙動不変を検証し、責務移動のみであることを確認する。
  >   - transport: 分割済み各モジュール -> 既存コマンド/workflow 実行経路 -> 回帰テストで不変確認
  >   - fail-closed: いずれかの既存テスト失敗時は完了不可
  >   - 経路テスト: `deno test --allow-read --allow-write --allow-env --allow-run src/cli/main_test.ts src/infrastructure/wrapper/helper_test.ts src/infrastructure/openspec/spec_creator_test.ts src/application/orchestrator/orchestrator_test.ts`
  >   - 拒否テスト: `deno check src/**/*.ts` 失敗時は reject
  > - [ ] 1.7 OpenSpec strict validate を実行する
  >   - 依存: 1.6
  >   - 対象: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/proposal.md, openspec/changes/refactor-spec-creator-and-orchestrator-modularization/tasks.md, openspec/changes/refactor-spec-creator-and-orchestrator-modularization/code_summary.md, openspec/changes/refactor-spec-creator-and-orchestrator-modularization/specs/**/spec.md
  >   - 関連許可: openspec/changes/refactor-spec-creator-and-orchestrator-modularization/design.md
  >   - フェーズ担当: implement=code-reviewer
  >   - 成果物: `openspec validate refactor-spec-creator-and-orchestrator-modularization --strict` を実行し、失敗時は修正後に再実行する。
  > 
  > ## 2. 人間向けメモ（コンパイラ非対象）
  > - 要件正規化サマリ:
  >   - 背景: `spec-creator`/`orchestrator` の責務集中で、レビュー観点漏れと意味論ズレが発生している。
  >   - 目的: 影響範囲の局所化、レビュー観点固定、意味論を含む完了判定安定化、挙動不変。
  >   - 最小スコープ: `main.ts` 分割、result parser 共通化、`spec_creator.ts` 分離、`orchestrator.ts` 段階抽出。
  >   - 非スコープ: 新機能追加、公開シグネチャ変更、判定仕様変更。
  >   - fail-closed: 既存テスト (`main_test` / `helper_test` / `spec_creator_test` / `orchestrator_test`) 失敗時は完了不可。
  > - メモ: 重大違反時は `REVIEWER_STOP:requirement_drift|over_editing|verbosity` を reviewer 出力に含める。
  > - メモ: 利用可能性は `personas` 定義と `フェーズ担当` 割当で担保し、全ペルソナが `execution.enabled=true` かつ `command_ref=default` で実行可能とする。
  > 
  > regenerate targets:
  > - proposal.md
  > - tasks.md
  > - code_summary.md
  > - specs/**/spec.md
  > - design.md (必要時のみ)
  > 
  > latest contract (5 lines + judgment):
  > - review/spec_check/test の完了出力は `5行契約`（RESULT, SUMMARY, CHANGED_FILES, CHECKS, JUDGMENT）を必須とする。
  > - `JUDGMENT` は必須行で、値は `pass` / `changes_required` / `blocked` のみ許容する。
  > - 判定は3値化（pass / changes_required / blocked）を前提とする。
  > 
  > 必須レビュー契約（RC-01..RC-12）:
  > - RC-01 RESULT: 最終 result block 抽出と completed|blocked 正規化を定義する
  > - RC-02 SUMMARY: 抽出・必須・要約用途を定義する
  > - RC-03 CHANGED_FILES: 正規化し、非implementフェーズでは (none) を必須化する
  > - RC-04 CHECKS: 抽出・必須・禁止コマンド検査を定義する
  > - RC-05 JUDGMENT: decision phase 必須、pass|changes_required|blocked 正規化を定義する
  > - RC-06 判定時系列: blocked 即停止 / changes_required sendback / pass 前進を定義する
  > - RC-07 reviewer stop: REVIEWER_STOP:requirement_drift|over_editing|verbosity を明記する
  > - RC-08 実行経路対象: run と spec-creator の両方を対象にする
  > - RC-09 段階責務: compile と runtime の責務分離を明記する
  > - RC-10 入力契約キー: task_config.persona_policy.phase_overrides.<phase>.executor_personas を明記する
  > - RC-11 遷移条件: sendback 条件に blocked=false 前提を明記する
  > - RC-12 テスト契約: MUST/SHALL ごとに経路テストと fail-closed拒否テストを要求する
- メモ: 重大違反時は `REVIEWER_STOP:requirement_drift|over_editing|verbosity` を reviewer 出力に含める。

regenerate targets:
- proposal.md
- tasks.md
- code_summary.md
- specs/**/spec.md
- design.md

latest contract (5 lines + judgment):
- review/spec_check/test の完了出力は `5行契約`（RESULT, SUMMARY, CHANGED_FILES, CHECKS, JUDGMENT）を必須とする。
- `JUDGMENT` は必須行で、値は `pass` / `changes_required` / `blocked` のみ許容する。
- 判定は3値化（pass / changes_required / blocked）を前提とする。

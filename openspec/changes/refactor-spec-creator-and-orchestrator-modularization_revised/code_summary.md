# code_summary.md

Implementation mapping from tasks.md to code units.

## task_id: 1.1

### code_unit_1
- file: openspec/changes/refactor-spec-creator-and-orchestrator-modularization_revised/proposal.md, openspec/changes/refactor-spec-creator-and-orchestrator-modularization_revised/tasks.md, openspec/changes/refactor-spec-creator-and-orchestrator-modularization_revised/code_summary.md, openspec/changes/refactor-spec-creator-and-orchestrator-modularization_revised/specs/refactor-spec-creator-and-orchestrator-modularization_revised/spec.md
- service: openspec-change-doc
- function: normalize-requirements-to-openspec-elements
- purpose: requirements_text を最小スコープ、固定ゲート、受け入れ境界へ正規化する。
- input: requirements_text, design.md（関連許可）
- output: proposal/tasks/spec/code_summary の前提となる要件整理
- error: 非スコープ混入や必須契約欠落は fail-closed で差し戻し
- test: `openspec validate refactor-spec-creator-and-orchestrator-modularization_revised --strict`

## task_id: 1.2

### code_unit_1
- file: openspec/changes/refactor-spec-creator-and-orchestrator-modularization_revised/proposal.md
- service: openspec-change-doc
- function: generate-proposal
- purpose: 変更理由、変更内容、影響範囲、固定ゲート、受け入れ条件を proposal.md に定義する。
- input: task 1.1 の正規化結果
- output: 構造リファクタ限定の提案文書
- error: scope drift や gate 欠落は proposal 不整合
- test: `openspec validate refactor-spec-creator-and-orchestrator-modularization_revised --strict`

## task_id: 1.3

### code_unit_1
- file: openspec/changes/refactor-spec-creator-and-orchestrator-modularization_revised/tasks.md
- service: openspec-task-plan
- function: generate-tasks-with-fixed-template
- purpose: 固定テンプレート行、`## 1. 実装タスク` checklist、RC-01..RC-12 同義性を tasks.md に固定する。
- input: proposal.md, required_review_contract
- output: 依存関係と fail-closed 条件を含む実装タスク定義
- error: 固定行欠落、checklist 逸脱、RC 欠落は reject
- test: `openspec validate refactor-spec-creator-and-orchestrator-modularization_revised --strict`

### review_contract_traceability
- RC-01 | transport: run/spec-creator/polish の最終結果 block から RESULT を抽出して completed|blocked に正規化する | reject: missing_result / invalid_result_value / malformed_result_block は fail-closed | path_test: 正常 RESULT=completed を受理し completed 遷移になることを確認する | reject_test: RESULT 欠落で missing_result を返し拒否することを確認する
- RC-02 | transport: SUMMARY を抽出して必須化し、要約用途へ受け渡す | reject: missing_summary は fail-closed | path_test: SUMMARY ありの正常応答で通過することを確認する | reject_test: SUMMARY 欠落で missing_summary を返すことを確認する
- RC-03 | transport: CHANGED_FILES を正規化し、非implementフェーズでは (none) を強制する | reject: missing_changed_files / nonimplement_changed_files は fail-closed | path_test: implement フェーズで変更ファイル配列を受理することを確認する | reject_test: review/spec_check/test でファイル名がある場合に nonimplement_changed_files を返すことを確認する
- RC-04 | transport: CHECKS を抽出して必須化し、禁止コマンド検査を適用する | reject: missing_checks / forbidden_checks_command は fail-closed | path_test: 許可コマンドのみを含む CHECKS を受理することを確認する | reject_test: 禁止コマンドを含む CHECKS で forbidden_checks_command を返すことを確認する
- RC-05 | transport: decision phase で JUDGMENT を必須化し pass|changes_required|blocked に正規化する | reject: missing_judgment / invalid_judgment は fail-closed | path_test: JUDGMENT=pass を受理して次フェーズへ進むことを確認する | reject_test: 不正値 JUDGMENT で invalid_judgment を返すことを確認する
- RC-06 | transport: 判定時系列を blocked即停止 / changes_required送返 / pass前進 で統一する | reject: 判定順序違反や未定義分岐は fail-closed | path_test: changes_required で sendback に遷移することを確認する | reject_test: blocked 判定後に継続しないことを確認する
- RC-07 | transport: review結果に REVIEWER_STOP:requirement_drift|over_editing|verbosity を反映する | reject: REVIEWER_STOP 欠落や未定義コードは fail-closed | path_test: 重大違反で REVIEWER_STOP が出力され停止することを確認する | reject_test: 未定義 REVIEWER_STOP コードを拒否することを確認する
- RC-08 | transport: run と spec-creator(polish含む) の両経路で同じ検証を実行する | reject: 片経路のみ実装は fail-closed | path_test: run と spec-creator の双方で同一 validation code になることを確認する | reject_test: 片経路で契約を無視する実装を拒否することを確認する
- RC-09 | transport: compile と runtime の責務境界を分離して扱う | reject: compile/runtime の混在判定は fail-closed | path_test: runtime 契約違反が runtime 側で検出されることを確認する | reject_test: compile エラーを runtime 経路で扱わないことを確認する
- RC-10 | transport: task_config.persona_policy.phase_overrides.<phase>.executor_personas を入力契約キーとして検証する | reject: 入力キー欠落や別キー使用は fail-closed | path_test: 正しい入力キーで reviewer 順序が解釈されることを確認する | reject_test: 誤キー task_config.review を拒否することを確認する
- RC-11 | transport: sendback 条件を blocked=false 前提で評価する | reject: blocked=true の sendback は fail-closed | path_test: changes_required かつ blocked=false で sendback することを確認する | reject_test: blocked=true で sendback を拒否することを確認する
- RC-12 | transport: MUST/SHALL ごとに transport・reject・path_test・reject_test を両成果物で追跡可能にする | reject: 4要素欠落または tasks/spec/code_summary 非同義は fail-closed | path_test: RC-01..RC-12 全件で4要素がそろっていることを確認する | reject_test: 任意RCの4要素欠落で品質ガードが reject することを確認する
## task_id: 1.4

### code_unit_1
- file: openspec/changes/refactor-spec-creator-and-orchestrator-modularization_revised/design.md
- service: openspec-design
- function: capture-design-decisions-when-needed
- purpose: 設計判断が必要な場合にのみ意思決定、順序、トレードオフ、fail-closed 境界を記録する。
- input: proposal.md, tasks.md
- output: 設計判断を固定した design.md
- error: 判断根拠不在や境界未定義は設計不備
- test: `openspec validate refactor-spec-creator-and-orchestrator-modularization_revised --strict`

## task_id: 1.5

### code_unit_1
- file: openspec/changes/refactor-spec-creator-and-orchestrator-modularization_revised/code_summary.md
- service: openspec-traceability
- function: map-task-id-to-code-units
- purpose: tasks.md の task_id と実装/文書 code unit の対応を追跡可能に記述する。
- input: tasks.md（1.1-1.7）, proposal.md, design.md, spec.md
- output: task 単位の file/service/function/purpose/input/output/error/test 対応表
- error: 対応漏れや task 依存不整合は traceability 不備
- test: `openspec validate refactor-spec-creator-and-orchestrator-modularization_revised --strict`

## task_id: 1.6

### code_unit_1
- file: openspec/changes/refactor-spec-creator-and-orchestrator-modularization_revised/proposal.md, openspec/changes/refactor-spec-creator-and-orchestrator-modularization_revised/tasks.md, openspec/changes/refactor-spec-creator-and-orchestrator-modularization_revised/code_summary.md, openspec/changes/refactor-spec-creator-and-orchestrator-modularization_revised/specs/refactor-spec-creator-and-orchestrator-modularization_revised/spec.md, openspec/changes/refactor-spec-creator-and-orchestrator-modularization_revised/design.md
- service: openspec-review
- function: review-artifact-consistency
- purpose: proposal/tasks/design/code_summary/spec の整合、要件逸脱、過剰修正、冗長化を検証する。
- input: task 1.2-1.5 の成果物
- output: 修正要否を含むレビュー結果
- error: `REVIEWER_STOP:*` 検出時は blocker 停止
- test: `openspec validate refactor-spec-creator-and-orchestrator-modularization_revised --strict`

## task_id: 1.7

### code_unit_1
- file: openspec/changes/refactor-spec-creator-and-orchestrator-modularization_revised/proposal.md, openspec/changes/refactor-spec-creator-and-orchestrator-modularization_revised/tasks.md, openspec/changes/refactor-spec-creator-and-orchestrator-modularization_revised/code_summary.md, openspec/changes/refactor-spec-creator-and-orchestrator-modularization_revised/specs/refactor-spec-creator-and-orchestrator-modularization_revised/spec.md, openspec/changes/refactor-spec-creator-and-orchestrator-modularization_revised/design.md
- service: openspec-validation
- function: run-strict-validation-gate
- purpose: 生成成果物に対して strict validate を実行し、失敗時は修正して再実行する。
- input: task 1.6 までに整合化された artifacts
- output: strict validate pass/fail
- error: validate 失敗は完了不可（fail-closed）
- test: `openspec validate refactor-spec-creator-and-orchestrator-modularization_revised --strict`

# code_summary.md

`openspec/changes/add-persona-dir-and-ordered-multi-judgment-phases/tasks.md` の task_id と code unit の対応表。

## task_id: 1.1

### code_unit_1
- file: src/cli/main.ts
- service: cli-runtime
- function: parseRunArgs
- purpose: `--persona-dir` を run 引数として 1 回のみ受理する。
- input: CLI parse result
- output: `runOptions.personaDir`
- test: `deno test --allow-read --allow-write --allow-env src/cli/main_test.ts`

### code_unit_2
- file: src/cli/main.ts
- service: cli-runtime
- function: parseSpecCreatorArgs / specCreatorCommand
- purpose: `spec-creator` が受け取った `--persona-dir` を `run --config` 呼び出しへ透過的に引き渡す。
- input: spec-creator CLI args
- output: run invocation args
- test: `deno test --allow-read --allow-write --allow-env src/cli/main_test.ts`

## task_id: 1.2

### code_unit_1
- file: src/infrastructure/persona/catalog.ts
- service: persona-catalog
- function: mergePersonas
- purpose: `default -> payload.personas -> --persona-dir` の順でペルソナをマージし、マージ後 id を `persona_policy.phase_overrides.<phase>.executor_personas` で参照可能にする。
- input: payload.personas と persona-dir persona
- output: 有効な persona 解決結果
- test: `deno test --allow-read --allow-write --allow-env src/infrastructure/persona/catalog_test.ts`

### code_unit_2
- file: src/infrastructure/persona/catalog.ts
- service: persona-catalog
- function: loadPersonaDirectory
- purpose: 外部ディレクトリの `<dir>/personas.json`（PersonaDefinition JSON配列）を読み込み・検証し、他形式の走査を行わない。
- input: `--persona-dir`（`<dir>`）
- output: ペルソナ定義配列
- test: `deno test --allow-read --allow-write --allow-env src/infrastructure/persona/catalog_test.ts`

## task_id: 1.3

### code_unit_1
- file: src/infrastructure/openspec/compiler.ts
- service: openspec-compiler
- function: validateExecutorPersonas
- purpose: implement フェーズの実行担当を1名に制限し、それ以外のフェーズは複数可とする compile 側検証を追加する。
- input: tasks.md phase assignments
- output: compile error / pass
- test: `deno test --allow-read --allow-write --allow-env src/infrastructure/openspec/compiler_test.ts`

### code_unit_2
- file: src/application/orchestrator/orchestrator.ts
- service: orchestrator
- function: validateImplementAssigneesAtRuntime
- purpose: `run --config` 経路で compile を通らない設定に対して、実行開始時に implement 複数指定を fail-closed する。
- input: loaded task_config
- output: runtime validation error / pass
- test: `deno test --allow-read --allow-write --allow-env src/application/orchestrator/orchestrator_test.ts`

## task_id: 1.4

### code_unit_1
- file: src/application/orchestrator/orchestrator.ts
- service: orchestrator
- function: executePhaseJudgments
- purpose: review/spec_check/test の担当者を記載順で実行し、blocked/changes_required をフェーズ内で集約する。
- input: executor_personas and phase metadata
- output: phase judgment aggregate state
- test: `deno test --allow-read --allow-write --allow-env src/application/orchestrator/orchestrator_test.ts`

### code_unit_2
- file: src/application/orchestrator/orchestrator.ts
- service: orchestrator
- function: aggregateChangesRequired
- purpose: フェーズ内の複数結果を OR 集約し、blocked を最優先で即時確定する。
- input: judgment results
- output: aggregate status
- test: `deno test --allow-read --allow-write --allow-env src/application/orchestrator/orchestrator_test.ts`

## task_id: 1.5

### code_unit_1
- file: src/application/orchestrator/orchestrator.ts
- service: orchestrator
- function: sendBackTaskToImplementOnce
- purpose: `blocked=false` かつ `changes_required=true` の場合のみ implement へ1回だけ差し戻す。
- input: aggregated judgment (`blocked`, `changes_required`)
- output: 単一 sendback 実行
- test: `deno test --allow-read --allow-write --allow-env src/application/orchestrator/orchestrator_test.ts`

### code_unit_2
- file: src/infrastructure/state/store.ts
- service: state-store
- function: updateRevisionCountOnSendback
- purpose: 差し戻し1回につき `revision_count` を1だけ加算する。
- input: sendback transition event
- output: 更新済み task state
- test: `deno test --allow-read --allow-write --allow-env src/infrastructure/state/store_test.ts`

## task_id: 1.6

### code_unit_1
- file: src/application/orchestrator/orchestrator.ts
- service: orchestrator
- function: evaluateBlockedAndNextPhase
- purpose: blocked 即時確定、changes_required 無し時のみ next phase を進める。
- input: phase aggregate status
- output: status transition / needs_approval
- test: `deno test --allow-read --allow-write --allow-env src/application/orchestrator/orchestrator_test.ts`

### code_unit_2
- file: src/infrastructure/state/store.ts
- service: state-store
- function: enforceRevisionGuard
- purpose: `revision_count > max_revision_cycles` 判定を維持し、加算タイミングを `changes_required` sendback 1回に統一。
- input: revision_count, max_revision_cycles
- output: guard violation transition
- test: `deno test --allow-read --allow-write --allow-env src/infrastructure/state/store_test.ts`

## task_id: 1.7

### code_unit_1
- file: openspec/changes/add-persona-dir-and-ordered-multi-judgment-phases/code_summary.md
- service: openspec-change-doc
- function: map_task_to_code_units
- purpose: task_id と code unit 対応表を作成する。
- input: tasks.md
- output: 本 artifact
- test: `openspec validate add-persona-dir-and-ordered-multi-judgment-phases --strict`

### code_unit_2
- file: openspec/changes/add-persona-dir-and-ordered-multi-judgment-phases/tasks.md
- service: openspec-change-doc
- function: change-task-list
- purpose: 実装タスク内容を検証可能な形で記録した tasks.md への追従。
- input: proposals and implementation artifacts
- output: 整合タスク定義
- test: `openspec validate add-persona-dir-and-ordered-multi-judgment-phases --strict`

### code_unit_3
- file: openspec/changes/add-persona-dir-and-ordered-multi-judgment-phases/design.md
- service: openspec-change-doc
- function: design-alignment
- purpose: 要件/境界/対話制御方針を設計文書で固定する。
- input: requirements
- output: design.md
- test: `openspec validate add-persona-dir-and-ordered-multi-judgment-phases --strict`

### code_unit_4
- file: openspec/changes/add-persona-dir-and-ordered-multi-judgment-phases/specs/add-persona-dir-and-ordered-multi-judgment-phases/spec.md
- service: openspec-spec
- function: encode-spec-deltas
- purpose: 要件を Requirement/Scenario へ変換した spec delta を維持する。
- input: requirements_text
- output: ADDED/MODIFIED の spec
- test: `openspec validate add-persona-dir-and-ordered-multi-judgment-phases --strict`

# code_summary.md

`tasks.md` の task_id と code unit 対応表。

## task_id: 1.1
### code_unit_1
- file: src/infrastructure/wrapper/runtime.ts
- service: runtime input/prompt bootstrap
- function: runRuntime / readPayloadOrFail / buildPrompt
- purpose: payload 読込、empty 判定、prompt 生成を legacy と同値で提供する。

## task_id: 1.2
### code_unit_1
- file: src/infrastructure/wrapper/runtime.ts
- service: codex command assembly
- function: buildCodexCommand
- purpose: env 解釈と codex 実行引数を legacy と同値で構築する。

## task_id: 1.3
### code_unit_1
- file: src/infrastructure/wrapper/runtime.ts
- service: stream rendering
- function: renderAssistantView / renderThinkingView / renderAllCompactView / renderAllView
- purpose: stream 表示契約（assistant/thinking/all_compact/all）を維持する。

## task_id: 1.4
### code_unit_1
- file: src/infrastructure/wrapper/runtime.ts
- service: result extraction and fail-closed control
- function: runRuntime / tryExtractResultFromStream / logCodexFailure
- purpose: result 抽出、empty output、exit code 制御を legacy と一致させる。

## task_id: 1.5
### code_unit_1
- file: src/infrastructure/wrapper/runtime.ts
- service: dotenv protection
- function: shouldDenyDotenv / writeDotenvSnapshot / verifyDotenvSnapshotUnchanged
- purpose: dotenv snapshot と改変検知の fail-closed 契約を維持する。

## task_id: 1.6
### code_unit_1
- file: src/infrastructure/wrapper/runtime_test.ts
- service: parity test harness
- function: runLegacyWrapper / runTsRuntime / compareParity
- purpose: legacy と ts の比較実行基盤を提供する。

## task_id: 1.7
### code_unit_1
- file: src/infrastructure/wrapper/runtime_test.ts
- service: parity scenarios
- function: parity scenarios for success/failure matrix
- purpose: 8 ケース以上の必須シナリオで 3 点一致を固定する。

## task_id: 1.8
### code_unit_1
- file: src/cli/main.ts
- service: default runtime command switch
- function: defaultTeammateCommand / buildTeammateAdapter
- purpose: default command を ts runtime に切替え、`CODEX_WRAPPER_RUNTIME` 非 ts 値の fail-closed を実装する。

## task_id: 1.9
### code_unit_1
- file: src/cli/main_test.ts
- service: runtime selection tests
- function: default command and precedence test cases
- purpose: 明示コマンド優先、default=ts、legacy 指定 fail-closed、invalid runtime をテスト固定する。

## task_id: 1.10
### code_unit_1
- file: docs/ts-wrapper-contract.md
- service: smoke execution record
- function: legacy/ts smoke comparison notes
- purpose: 実運用相当スモークの比較手順と結果記録フォーマットを定義する。

## task_id: 1.11
### code_unit_1
- file: openspec/changes/update-codex-wrapper-default-to-ts-runtime
- service: strict validation gate
- function: openspec validate gate
- purpose: change 全体の strict validate と必須テスト通過をゲート化する。

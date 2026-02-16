# code_summary.md

`tasks.md` の task_id と code unit の対応表。

## task_id: 1.1

### code_unit_1
- file: codex_wrapper.sh
- service: compat runtime entry
- function: emit_stderr_category / CODEX_WRAPPER_RUNTIME runtime selector branch
- purpose: `CODEX_WRAPPER_RUNTIME` を `legacy` として既定ルートを維持し、`ts` 指定時を明示 fail 扱いにするための基点を追加。
- input: runtime environment flags
- output: 既定ランタイム維持と将来拡張口の明示化
- error: 既存フロー逸脱時の不一致
- test: task 実装時の仕様整合チェック

## task_id: 1.2

### code_unit_1
- file: codex_wrapper.sh
- service: contract documentation
- function: top-of-file contract comment block
- purpose: RESULT/JUDGMENT/CHANGED_FILES/CHECKS/RESULT_PHASE/CODEX_STREAM_VIEW の判定契約を明文化。
- input: requirements と仕様
- output: 実装差分比較可能な規約表現
- error: 契約項目の欠落
- test: `rg -n "RESULT_PHASE\\|CHECKS\\|JUDGMENT\\|CHANGED_FILES" codex_wrapper.sh`

## task_id: 1.3

### code_unit_1
- file: codex_wrapper.sh
- service: stderr classification support
- function: emit_stderr_category
- purpose: 既存文言を維持しつつ stderr の失敗分類を追跡しやすく整備。
- input: error handling branches
- output: カテゴリ付きエラーパスの可観測化
- error: 本文変更や分類漏れ
- test: 失敗種別ごとの stderr 分類可否

## task_id: 1.4

### code_unit_1
- file: src/infrastructure/wrapper/helper.ts
- service: wrapper helper CLI dispatch
- function: runCli
- purpose: `runCli` を dispatch 専用に整理し、4サブコマンド処理を明示 API へ分離する準備を固定。
- input: helper CLI command
- output: 分岐専用 `runCli` と内部サブコマンドの境界
- error: 振る舞い変更・戻り値破壊
- test: runCli path 分岐の既存期待値固定

### code_unit_2
- file: src/infrastructure/wrapper/helper.ts
- service: helper command APIs
- function: runBuildPrompt / runSnapshotDotenv / runVerifyDotenv / runExtractResult
- purpose: サブコマンド関数を明示 API 化し既存 throw/戻り値を維持。
- input: command ごとの引数
- output: 内部 API の明確分離
- error: 実行順序・例外伝播の変更
- test: 各 API 呼び出し単位での互換性検証

## task_id: 1.5

### code_unit_1
- file: src/infrastructure/wrapper/helper.ts
- service: result contract constants
- function: RESULT_KEYS / OPTIONAL_RESULT_KEYS / exit code constants
- purpose: `RESULT` 判定関連定数を export const で固定し、spec との 1 対 1 対応を確立。
- input: result keys + exit code mapping
- output: 契約定数の参照先固定化
- error: 仕様と定数整合の不一致
- test: `rg -n "RESULT_KEYS\\|OPTIONAL_RESULT_KEYS\\|EXIT_CODE" src/infrastructure/wrapper/helper.ts`

## task_id: 1.6

### code_unit_1
- file: src/infrastructure/wrapper/helper_test.ts
- service: result contract tests
- function: extractResultBlock / CHANGED_FILES 解析テスト
- purpose: 正常ケース、非 implement の CHANGED_FILES 判定、欠落/stale 行、RESULT_PHASE エラーを固定化。
- input: fixture response text
- output: 契約崩れを検知するユニットテスト
- error: 回帰ケース不足
- test: `deno test --allow-read --allow-write --allow-env --allow-run src/infrastructure/wrapper/helper_test.ts`

## task_id: 1.7

### code_unit_1
- file: src/infrastructure/wrapper/helper_test.ts
- service: golden compatibility tests
- function: golden contract parity test (prompt/result block/exit code/stderr)
- purpose: shell 期待値と比較する golden 回帰観点のテスト整備。
- input: 固定入力（payload/prompt/stream/result block）
- output: 差分ゼロ条件の固定化
- error: 同値比較漏れ
- test: helper_test.ts の golden 系テスト群

## task_id: 1.8

### code_unit_1
- file: openspec/changes/add-codex-wrapper-step1-contract-first-golden-compat
- service: change validation
- function: spec validation gate
- purpose: `openspec validate add-codex-wrapper-step1-contract-first-golden-compat --strict` を必須ゲートとして成立させる。
- input: proposal/design/tasks/specs/code_summary
- output: strict validation pass
- error: spec/traceability の不整合
- test: `openspec validate add-codex-wrapper-step1-contract-first-golden-compat --strict`

# code_summary.md

`openspec/changes/add-spec-creator-polish/tasks.md` の task と code unit の対応表。

## task_id: 1.1

### code_unit_1
- file: src/cli/main.ts
- service: cli
- function: handleSpecCreatorPolish
- purpose: `spec-creator polish --change-id <id>` の引数を解釈し、必須入力と fail-closed 条件を強制する。
- input: CLI 引数（subcommand, `--change-id`）
- output: 有効入力時に polish 実行、無効入力時は終了コード非0で即時失敗
- error: `--change-id` 未指定、対象 change ディレクトリ非存在でエラー終了
- test: `src/cli/main_test.ts` の引数異常系/正常系で検証

### code_unit_2
- file: src/cli/main_test.ts
- service: cli-test
- function: specCreatorPolishCliContractTests
- purpose: CLI 契約（必須引数と fail-closed）を固定し回帰を防止する。
- input: 擬似 CLI 実行ケース（`--change-id` 有無、存在/非存在 change-id）
- output: 期待する終了コードとエラーメッセージ
- error: 仕様外の挙動（未指定を許容、非存在 change-id を通す）を検出して失敗
- test: テーブル駆動で契約検証

## task_id: 1.2

### code_unit_1
- file: src/infrastructure/openspec/spec_creator.ts
- service: openspec-spec-creator
- function: collectChangeFilesRecursively
- purpose: `openspec/changes/<change-id>/` 配下を再帰走査し、Markdown/非Markdownを分類した処理キューを生成する。
- input: change root path
- output: 対象総ファイル数、Markdown リスト、非Markdown リスト
- error: change root 非存在や走査不能時は fail-closed
- test: `src/infrastructure/openspec/spec_creator_test.ts` の再帰走査ケースで検証

### code_unit_2
- file: src/infrastructure/openspec/spec_creator_test.ts
- service: openspec-spec-creator-test
- function: fileClassificationTests
- purpose: 再帰走査の分類結果（Markdown/非Markdown）を固定し、誤分類回帰を防ぐ。
- input: テスト用 change ディレクトリ構成
- output: 分類件数と対象パスの一致
- error: 拡張子判定の誤り、対象漏れを検出して失敗
- test: 正常系/境界値（入れ子ディレクトリ）で検証

## task_id: 1.3

### code_unit_1
- file: src/infrastructure/openspec/spec_creator.ts
- service: openspec-spec-creator
- function: polishMarkdownFiles
- purpose: Markdown に整形、不足固定行補完、見出し正規化を適用し、冪等な出力を生成する。
- input: Markdown ファイル本文
- output: 正規化済み Markdown と適用ルール別カウント
- error: 不正な状態は対象ファイル情報付きエラーで返却
- test: `src/infrastructure/openspec/spec_creator_test.ts` で冪等性と整形結果を検証

### code_unit_2
- file: src/infrastructure/openspec/template.ts
- service: openspec-template
- function: normalizeFixedLinesAndHeadings
- purpose: 固定行補完と見出し正規化の共通処理を提供し、整備ルールを一元化する。
- input: Markdown 行列
- output: 補完/正規化済み行列
- error: ルール適用不能時は呼び出し元へ失敗を伝播
- test: `src/infrastructure/openspec/spec_creator_test.ts` から間接検証

## task_id: 1.4

### code_unit_1
- file: src/infrastructure/openspec/spec_creator.ts
- service: openspec-spec-creator
- function: checkNonMarkdownConsistency
- purpose: 非Markdown を無変更のまま整合チェックし、必要な警告のみを生成する。
- input: 非Markdown ファイル群
- output: 警告リスト、無変更保証
- error: 整合違反は警告として記録し、破壊的修正は行わない
- test: `src/infrastructure/openspec/spec_creator_test.ts` で内容不変を検証

### code_unit_2
- file: src/infrastructure/openspec/spec_creator_test.ts
- service: openspec-spec-creator-test
- function: nonMarkdownInvariantTests
- purpose: yaml/json 等が実行前後で一致することを自動検証する。
- input: 非Markdown フィクスチャ
- output: バイト列一致と警告出力確認
- error: 変更が発生した場合は即失敗
- test: 差分比較テスト

## task_id: 1.5

### code_unit_1
- file: src/infrastructure/openspec/spec_creator.ts
- service: openspec-spec-creator
- function: buildPolishSummary
- purpose: 実行結果（総ファイル数、変更ファイル一覧、整備ルール別件数）を集約する。
- input: 処理結果メタデータ
- output: 表示用サマリ構造体
- error: 集約不能時は終了コード非0につながる失敗を返す
- test: `src/infrastructure/openspec/spec_creator_test.ts` で件数/一覧を検証

### code_unit_2
- file: src/cli/main.ts
- service: cli
- function: renderSpecCreatorPolishSummary
- purpose: サマリ構造体を標準出力フォーマットへ変換し、変更なしケースの表示を固定する。
- input: polish summary
- output: 標準出力テキスト
- error: 出力生成不能時はエラーを表示して終了
- test: `src/cli/main_test.ts` の出力比較で検証

### code_unit_3
- file: src/cli/main_test.ts
- service: cli-test
- function: polishSummaryOutputTests
- purpose: 必須出力3要素と「変更なし」表示の回帰を防止する。
- input: サマリ出力ケース
- output: 期待文字列一致
- error: 必須項目欠落を検出して失敗
- test: 標準出力アサーション

## task_id: 1.6

### code_unit_1
- file: src/infrastructure/openspec/spec_creator_test.ts
- service: openspec-spec-creator-test
- function: acceptanceScenarioTests
- purpose: 非存在 change-id 失敗、再実行差分ゼロ、非Markdown無変更を統合検証する。
- input: 受け入れシナリオ用 fixture change
- output: 条件別の pass/fail
- error: いずれかの受け入れ条件未達で失敗
- test: 統合テスト

### code_unit_2
- file: src/cli/main_test.ts
- service: cli-test
- function: cliAcceptanceWiringTests
- purpose: CLI 経由で 1.6 の受け入れ条件が満たされることを確認する。
- input: CLI 実行ケース
- output: 終了コード/出力の一致
- error: CLI と内部処理の接続不整合を検出
- test: エンドツーエンド風テスト

### code_unit_3
- file: tests/test_openspec_compiler.py
- service: openspec-compiler-test
- function: compileAfterPolishRegressionTest
- purpose: polish 実行後に `compile-openspec` が成功する条件を自動検証する。
- input: polish 済み change データ
- output: compile-openspec 成功判定
- error: コンパイル失敗時は原因をテストログへ出力して失敗
- test: Python unittest

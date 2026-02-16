# Change: Add contract-first Step1 for codex_wrapper compatibility migration

## Why
- `codex_wrapper.sh` と `src/infrastructure/wrapper/helper.ts` の判定契約が暗黙実装されており、実装者ごとに解釈差分が起きやすい。
- 移行を段階的に進めるため、既存挙動を壊さずに、`RESULT`/`JUDGMENT`/`CHANGED_FILES`/`RESULT_PHASE` などの処理契約を先に固定したい。
- Step1 は互換性確保を最優先し、シェル既定経路 (`codex_wrapper.sh`) の破壊を避けながら、将来の TS 化を安全に受ける土台を作る。

## What Changes
- 変更対象として `codex_wrapper.sh` の Step1 側を明文化し、既定入り口としての挙動維持を提案する。
- `codex_wrapper.sh` は以下を契約ベースで整理し、現行フローを壊さない前提を明示する。
  - ランタイム切替変数追加（例: `CODEX_WRAPPER_RUNTIME=legacy` を既定化し、`ts` は将来実装のために明示的に不可）
  - `RESULT`/`SUMMARY`/`CHANGED_FILES`/`CHECKS`/`JUDGMENT` の必須要件をコメント化
  - stderr の失敗分類（カテゴリ名）をテスト固定しやすい形で整備
- `helper.ts` を Step1 仕様に合わせて分割し、`runBuildPrompt`/`runSnapshotDotenv`/`runVerifyDotenv`/`runExtractResult` のサブコマンド API を明示化する。
- `helper.ts` では `RESULT_KEYS`/`OPTIONAL_RESULT_KEYS`、`exit code (2/3/4)` を定数化し、spec 契約との 1 対 1 対応を固定する。
- `extractResultBlock` / `extractResultToFile` の解析契約（RESULT 以降、重複禁止、空行で停止、`RESULT_PHASE` 必須）を仕様として確立し、golden 回帰比較の基準にする。
- `helper_test.ts` に Step1 判定項目（正常 block、`CHANGED_FILES` 空・非空、`extract-result` 欠落、stale line、`RESULT_PHASE` 異常系）を追加し、契約崩れを検知する。
- spec 上では `openspec/changes/add-codex-wrapper-step1-contract-first-golden-compat/proposal.md`、`tasks.md`、`design.md`、`code_summary.md` を連動させ、変更目的・実行順序・ゲート条件を統一する。

## Impact
- 直接対象:
  - `codex_wrapper.sh`
  - `src/infrastructure/wrapper/helper.ts`
  - `src/infrastructure/wrapper/helper_test.ts`
- 変更スコープ境界:
  - 外部 I/O 契約、判定条件、既存エラー分類は互換維持（変更不可）
  - UX 文言の体裁更新は将来 change へ繰り越し
- 合否ゲート:
  - `openspec validate add-codex-wrapper-step1-contract-first-golden-compat --strict`
  - golden テストで現行 shell 実装との比較結果一致（result block / exit code / stderr）を確認

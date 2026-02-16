# Change: codex wrapper の既定実行経路を TypeScript runtime に切り替える

## Why
- `add-codex-wrapper-step1-contract-first-golden-compat` で wrapper 契約と比較基準（result block / exit code / stderr）は固定済み。
- 現在の既定経路は依然として `codex_wrapper.sh` であり、TypeScript 移行は未完了。
- 本 change では `default=ts` を達成し、最終的な shell 廃止へ進むための実行経路切り替えを完了させる。

## What Changes
- `src/infrastructure/wrapper/runtime.ts` を新規追加し、`codex_wrapper.sh` の責務を 1:1 で TypeScript 実装する。
- `src/infrastructure/wrapper/runtime_test.ts` を新規追加し、legacy shell と ts runtime の parity 比較を実装する。
- `src/cli/main.ts` の既定 teammate command を `runtime.ts` 経路へ変更する（default=ts）。
- `CODEX_WRAPPER_RUNTIME` は `ts` のみ受け付け、`legacy` 含む不正値は fail-closed で起動失敗させる。
- `TEAMMATE_COMMAND` / `TEAMMATE_PLAN_COMMAND` / `TEAMMATE_EXECUTE_COMMAND` 明示指定時は既存優先順位を維持する。

## Impact
- Affected code:
  - `src/infrastructure/wrapper/runtime.ts`（新規）
  - `src/infrastructure/wrapper/runtime_test.ts`（新規）
  - `src/cli/main.ts`
  - `src/cli/main_test.ts`
  - `src/infrastructure/adapter/subprocess_test.ts`（必要時）
- この change での非対象:
  - `codex_wrapper.sh` の削除（parity 比較用に残す）
  - wrapper 契約の意味論変更（I/O 契約を維持）
- 受け入れゲート:
  - parity 比較で `result block / exit code / stderr` が全ケース完全一致
  - wrapper/cli 関連テスト全緑

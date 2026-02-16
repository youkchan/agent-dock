# Design

## Context
- Step1 で wrapper 契約は固定済みだが、既定実行経路は shell のまま。
- この change は TypeScript runtime を既定経路にし、実運用の入口を ts 側へ移す。
- 最優先は既存運用破壊の回避であり、契約同値が崩れる変更は許可しない。

## Goals
- `src/infrastructure/wrapper/runtime.ts` で shell と同等の実行フローを実装する。
- `main.ts` の default teammate command を ts runtime に切り替える（default=ts）。
- `CODEX_WRAPPER_RUNTIME` は `ts` のみを許可し、`legacy` を含む不正値を fail-closed にする。
- parity 比較で `result block / exit code / stderr` の完全一致を保証する。

## Non-Goals
- この change で `codex_wrapper.sh` を削除しない。
- RESULT/JUDGMENT/CHANGED_FILES 等の既存契約意味を変更しない。
- orchestration 全体ログの同値比較は行わない（比較対象は wrapper/runtime 単体出力のみ）。

## Decisions
- Decision 1: runtime 実装は helper を直接 import して利用する。
  - `buildPrompt`
  - `writeDotenvSnapshot`
  - `verifyDotenvSnapshotUnchanged`
  - `extractResultToFile`
- Decision 2: runtime selector は `ts` 固定。`CODEX_WRAPPER_RUNTIME` が `ts` 以外なら起動失敗させる。
- Decision 3: コマンド解決優先順位は既存互換を維持する。
  1. `--plan-command` / `--execute-command`
  2. `TEAMMATE_COMMAND`
  3. default runtime resolver（`CODEX_WRAPPER_RUNTIME`、未設定時 `ts`）
- Decision 4: parity 判定は `result block / exit code / stderr` の完全一致のみを受け入れる。
- Decision 5: 差分が 1 件でも残る場合は default 切替を不合格にする。

## Runtime Contract Scope
- 移植対象責務:
  1. stdin payload 読込と empty 判定
  2. prompt 生成
  3. codex 実行
  4. stream 表示 (`assistant` / `thinking` / `all_compact` / `all`)
  5. result 抽出
  6. dotenv 保護
  7. exit code 制御
- 互換対象 env:
  - `TARGET_PROJECT_DIR`
  - `CODEX_BIN`
  - `CODEX_MODEL`
  - `CODEX_REASONING_EFFORT`
  - `CODEX_PROFILE`
  - `CODEX_SANDBOX`
  - `CODEX_FULL_AUTO`
  - `CODEX_SKIP_GIT_REPO_CHECK`
  - `CODEX_STREAM_LOGS`
  - `CODEX_STREAM_VIEW`
  - `CODEX_STREAM_EXEC_KEEP_LINES`
  - `CODEX_DENY_DOTENV`
  - `CODEX_WRAPPER_LANG`
  - `CODEX_RUST_BACKTRACE`
  - `RESULT_PHASE`
  - `CODEX_PROMPT_LOG_PATH`
  - `CODEX_ERROR_LOG_PATH`
  - `CODEX_WRAPPER_DEBUG`

## Failure Compatibility
- `empty stdin payload` -> exit `2`
- `codex returned empty output` -> exit `3`
- dotenv 改変検知 -> exit `4`
- codex 失敗 -> codex の exit code 透過
- その他は現行契約準拠

## Test Strategy
- fake codex スタブで決定論的に実行する。
- 同一入力を legacy shell / ts runtime に投入し、以下を完全一致比較する。
  - `result block`
  - `exit code`
  - `stderr`
- 最低ケース:
  - implement 正常系
  - decision phase 正常系（JUDGMENT あり）
  - RESULT_PHASE 不正
  - empty payload
  - 非implement + CHANGED_FILES 非空
  - codex 失敗
  - empty output
  - dotenv 改変検知

## Migration
- rollout:
  - default を `ts` に変更して出荷する。
  - `TEAMMATE_COMMAND` / `TEAMMATE_PLAN_COMMAND` / `TEAMMATE_EXECUTE_COMMAND` 明示指定は既存どおり優先される。
- legacy shell の削除は別 change で実施する。

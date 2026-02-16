# TypeScript wrapper 契約

## 目的
TypeScript runtime の外部契約を固定し、実行経路・I/O・既定コマンド解決順を壊さないための基準を定義する。

## 適用範囲
- `src/cli/main.ts`
- `src/infrastructure/adapter/subprocess.ts`
- `src/infrastructure/wrapper/runtime.ts`
- `src/infrastructure/wrapper/helper.ts`

## 1. 実行経路契約
- 実行経路は `subprocess adapter -> runtime.ts -> codex exec` を維持（MUST）。
- `--teammate-adapter template` 以外では plan/execute の両方で subprocess adapter を使用（MUST）。
- runtime エントリポイントは `src/infrastructure/wrapper/runtime.ts` とし、呼び出し方式は `deno run --no-prompt --allow-read --allow-write --allow-env --allow-run <runtime-path>` を維持（MUST）。
- wrapper 内部実装を変更しても、stdin 入力・stdout 結果・stderr 進捗の意味を変更しない（MUST NOT）。

## 2. 既定コマンド解決順
`teammate_adapter=subprocess` のとき、plan/execute コマンド解決順は以下を固定する。

### 2.1 plan コマンド
1. `--plan-command`
2. `TEAMMATE_PLAN_COMMAND`
3. 共有コマンド解決結果（2.3）

### 2.2 execute コマンド
1. `--execute-command`
2. `TEAMMATE_EXECUTE_COMMAND`
3. 共有コマンド解決結果（2.3）

### 2.3 共有コマンド（plan/execute 共通）
1. `--teammate-command`
2. `TEAMMATE_COMMAND`
3. `deno run --no-prompt --allow-read --allow-write --allow-env --allow-run <discovered-runtime-path>`

## 3. wrapper I/O 契約

### 3.1 入力（stdin）
- UTF-8 JSON を 1 payload 受け取る。
- 必須キー:
  - `mode`: `plan` または `execute`
  - `teammate_id`: 実行主体 ID
  - `task`: task オブジェクト

### 3.2 出力（stdout）
- `mode=plan`: plan 文字列を返す（形式は固定しない）。
- `mode=execute`:
  - implement フェーズは既存どおり 4 行契約を維持する。
  - `RESULT: completed|blocked`
  - `SUMMARY: <=100 chars`
  - `CHANGED_FILES: comma-separated`（変更なしは `CHANGED_FILES: (none)` を正規値とする）
  - `CHECKS: executed check commands`
  - review/spec_check/test フェーズは上記に `JUDGMENT` を追加した 5 行契約を使用する。
  - `JUDGMENT: pass|changes_required|blocked`
  - `CHANGED_FILES` の空判定は `(none)` を正規値とし、互換のため `none` / `-` / 空文字も空として扱う。

### 3.3 進捗（stderr）
- 実行中ログは stderr へストリーム出力する。
- `CODEX_STREAM_VIEW=all|all_compact|assistant|thinking` の表示意味を維持する。
- `TEAMMATE_STREAM_LOGS=1` のとき adapter が stderr を progress log に取り込む。

### 3.4 失敗時挙動
- 空 payload / 不正 JSON / 不正 mode は fail-closed で非 0 終了。
- `codex exec` が非 0 の場合、wrapper はエラーを stderr へ出し非 0 で終了。
- `.env/.env.*` 参照禁止または改変検知違反時は fail-closed で終了。

## 4. Runtime/Helper 契約
- helper 実体は `src/infrastructure/wrapper/helper.ts`。
- runtime は helper API を直接 import して利用する（subprocess 起動は行わない）。
- 利用 API:
  - `buildPrompt`
  - `writeDotenvSnapshot`
  - `verifyDotenvSnapshotUnchanged`
  - `extractResultToFile`

## 5. 実運用スモーク比較記録（legacy / ts）

- 確認日: 2026-02-16
- 条件: fake codex を使って legacy/ts を同一 payload で比較
- 比較ケース:
  - timeout
  - stream 表示
  - fail-closed
  - dotenv 保護

- 結果（raw diff）

| ケース | legacy | ts | 差分 |
| --- | --- | --- | --- |
| timeout | `timeout: command timed out` (`code=124`) | `timeout: command timed out` (`code=124`) | `0` |
| stream 表示 (`CODEX_STREAM_LOGS=1`) | stdout/stderr 一致 | stdout/stderr 一致 | `0` |
| fail-closed (`SKIP_RESULT=1`) | `codex returned empty output` | `codex returned empty output` | `0` |
| dotenv 保護 (`CODEX_DENY_DOTENV=1`, mutate `.env`) | `code=4`, `deny rule violation: .env/.env.* files were modified by codex` | `code=4`, `deny rule violation: .env/.env.* files were modified by codex` | `0` |

### 判定

- raw diff 合計: `0`
- `timeout` / `stream 表示` / `dotenv 保護`: diff `0`
- `fail-closed`: diff `0`（`codex returned empty output` 一致）

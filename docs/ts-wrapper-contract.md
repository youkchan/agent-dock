# TypeScript移行 wrapper 契約

## 目的
`codex_wrapper.sh` の外部契約を固定し、TypeScript 移行時に実行経路・I/O・既定解決順を壊さないための基準を定義する。

## 適用範囲
- `team_orchestrator/cli.py`
- `team_orchestrator/codex_adapter.py`
- `codex_wrapper.sh`

## 1. 実行経路契約
- TypeScript 移行期間中も実行経路は `subprocess adapter -> codex_wrapper.sh -> codex exec` を維持すること（MUST）。
- `--teammate-adapter template` 以外の実行では、plan/execute の両方で subprocess adapter を使うこと（MUST）。
- wrapper のエントリポイントは `codex_wrapper.sh` を維持し、呼び出し方式は `bash <wrapper-path>` を維持すること（MUST）。
- wrapper 内部実装を変更しても、stdin 入力・stdout 結果・stderr 進捗の意味を変更しないこと（MUST NOT）。

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
3. `bash <dirname(sys.argv[0])>/codex_wrapper.sh`

補足:
- `--config` など他の引数と同様に、CLI 引数は環境変数より優先される。
- 既定 wrapper が見つからない場合は fail-closed でエラー終了する。

## 3. wrapper I/O 契約

### 3.1 入力（stdin）
- UTF-8 JSON を 1 payload 受け取る。
- 必須キー:
  - `mode`: `plan` または `execute`
  - `teammate_id`: 実行主体 ID
  - `task`: task オブジェクト

### 3.2 出力（stdout）
- `mode=plan`:
  - plan 文字列を返す（形式は固定しない）。
  - orchestrator は返却文字列全体を `plan_text` として保存する。
- `mode=execute`:
  - 最終結果は次の 4 行契約を維持する。
  - `RESULT: completed|blocked`
  - `SUMMARY: <=100 chars`
  - `CHANGED_FILES: comma-separated`
  - `CHECKS: executed check commands`

### 3.3 進捗（stderr）
- 実行中ログは stderr へストリーム出力する。
- `CODEX_STREAM_VIEW=all|all_compact|assistant|thinking` の表示意味を維持する。
- `TEAMMATE_STREAM_LOGS=1` のとき adapter が stderr を progress log に取り込む。

### 3.4 失敗時挙動
- 空 payload / 不正 JSON / 不正 mode は fail-closed で非 0 終了する。
- `codex exec` が非 0 で終了した場合、wrapper はエラーを stderr へ出し非 0 で終了する。
- `.env/.env.*` 参照禁止または改変検知違反時は fail-closed で終了する。

## 4. 埋め込み `python3` から Deno helper への置換方針

### 4.1 置換対象
`codex_wrapper.sh` 内の埋め込み `python3` 処理を Deno helper に置換する。
- prompt 生成（payload 解釈と mode 分岐）
- `.env/.env.*` スナップショット作成
- `.env/.env.*` 改変検知
- 4 行結果抽出（stream log からの fallback 抽出）

### 4.2 非変更対象
- shell エントリポイント（`codex_wrapper.sh`）
- 実行経路（`subprocess adapter -> codex_wrapper.sh -> codex exec`）
- 外部 I/O 契約（stdin payload / stdout 結果 / stderr 進捗）
- セキュリティ契約（`.env/.env.*` 参照禁止 + 改変検知）

### 4.3 ランタイム前提
- wrapper 実行時の helper 前提ランタイムは `python3` から `deno` へ移行する。
- 移行後は wrapper 経路で `python3` を必須前提にしない。
- `deno` が利用不可の場合は fail-closed で明示エラーとする。

### 4.4 移行受け入れ条件
- `mode=plan` と `mode=execute` の入出力互換が維持される。
- 4 行結果抽出の fallback 契約が維持される。
- `CODEX_STREAM_VIEW` の 4 モード表示が維持される。
- `.env/.env.*` 保護が置換前後で同等に機能する。

### 4.5 Deno helper 呼び出し契約
- helper 実体は `src/infrastructure/wrapper/helper.ts` とする。
- wrapper は helper を `deno run --no-prompt --allow-read --allow-write --allow-env <helper>` で起動する。
- helper サブコマンド:
  - `build-prompt`: `PAYLOAD` を解釈して prompt を stdout へ出力する。
  - `snapshot-dotenv`: `TARGET_PROJECT_DIR` を走査し、`SNAPSHOT_PATH` へハッシュ JSON を保存する。
  - `verify-dotenv`: `SNAPSHOT_PATH` と現行スナップショットを比較し、差分時は fail-closed で終了する。
  - `extract-result`: `STREAM_PATH` から 4 行結果を抽出して `OUTPUT_PATH` へ保存する。

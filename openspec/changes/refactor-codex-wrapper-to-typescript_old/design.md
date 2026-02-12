## 現行構成の分析

`codex_wrapper.sh`（661 行）の責務分布:

| 行 | 処理 | 実装言語 |
|----|------|----------|
| 1-29 | 環境変数読み込み | Bash |
| 30-34 | stdin payload 読み込み | Bash |
| 36-249 | プロンプト生成・deny チェック | Python 埋め込み |
| 251-256 | 一時ファイル管理 | Bash |
| 258-318 | .env スナップショット・変更検知 | Python 埋め込み |
| 320-352 | codex exec コマンド構築 | Bash |
| 369-535 | ストリーム表示フィルタ | awk |
| 537-621 | codex 実行・パイプ処理 | Bash |
| 555-598 | 結果抽出 | Python 埋め込み |
| 623-661 | エラーハンドリング | Bash |

## 目標

- Python 埋め込みを排除し、ロジックを TypeScript に移行する。
- シェルは codex exec の実行に特化した薄いラッパーにする。
- 責務を明確に分離し、テスト可能にする。

## 2 層構成

```
┌─────────────────────────────────────────────────────────┐
│ TypeScript (src/infrastructure/adapter/codex/)         │
│                                                         │
│ - payload 検証                                          │
│ - .env deny チェック                                    │
│ - プロンプト生成                                        │
│ - .env スナップショット                                 │
│ - 結果パース・正規化                                    │
└──────────────────────┬──────────────────────────────────┘
                       │ stdin: プロンプト文字列
                       │ env: 設定（CODEX_MODEL 等）
                       ▼
┌─────────────────────────────────────────────────────────┐
│ Shell (codex_executor.sh) - 薄いラッパー                │
│                                                         │
│ - codex exec 実行                                       │
│ - ストリーム表示制御（awk）                             │
│ - パイプ処理（tee, tail -f）                            │
│ - 一時ファイル管理（trap）                              │
│ - stdout: 結果 4 行                                     │
│ - stderr: ストリームログ                                │
└─────────────────────────────────────────────────────────┘
```

## TypeScript 層の責務

### 1) payload 検証
- stdin から JSON を読み込み、必須フィールドを検証する。
- `mode`, `teammate_id`, `task` の存在確認。
- `task.id`, `task.title`, `task.target_paths` 等の型チェック。

### 2) .env deny チェック
- `CODEX_DENY_DOTENV=1` の場合、payload 内の .env 参照を検出して拒否する。
- `title`, `description`, `target_paths`, `depends_on` をスキャン。

### 3) プロンプト生成
- `mode=plan` または `mode=execute` に応じてプロンプトを生成する。
- `progress_log` の整形（直近 N 件、文字数制限）。
- 出力: プロンプト文字列。

### 4) .env スナップショット
- codex 実行前に `.env*` ファイルのハッシュを取得。
- 実行後に再取得し、差分があれば失敗。

### 5) 結果パース・正規化
- codex 実行後の stdout から 4 行フォーマットを抽出。
- `RESULT`, `SUMMARY`, `CHANGED_FILES`, `CHECKS` を正規化。

## Shell 層の責務

### 1) codex exec 実行
- 環境変数から設定を読み込み、`codex exec` コマンドを構築・実行。
- `CODEX_MODEL`, `CODEX_SANDBOX`, `CODEX_FULL_AUTO` 等。

### 2) ストリーム表示制御
- `CODEX_STREAM_VIEW` に応じて awk でフィルタリング。
- `all`, `all_compact`, `assistant`, `thinking`。

### 3) パイプ処理
- `tee`, `tail -f` によるログ分岐。
- stderr へのストリーム出力。

### 4) 一時ファイル管理
- `mktemp` で一時ファイル作成。
- `trap` で確実に cleanup。

### 5) 結果出力
- stdout に 4 行フォーマットを出力。
- exit code で成功/失敗を通知。

## インターフェース契約

### TypeScript → Shell

- **stdin**: プロンプト文字列（UTF-8）
- **env**:
  - `CODEX_MODEL`, `CODEX_SANDBOX`, `CODEX_FULL_AUTO`
  - `CODEX_STREAM_LOGS`, `CODEX_STREAM_VIEW`, `CODEX_STREAM_EXEC_MAX_CHARS`
  - `TARGET_PROJECT_DIR`

### Shell → TypeScript

- **stdout**: 4 行フォーマット
  ```
  RESULT: completed|blocked
  SUMMARY: <=100 chars
  CHANGED_FILES: comma-separated
  CHECKS: executed check commands
  ```
- **stderr**: ストリームログ
- **exit code**: 0=成功, 非0=失敗

## ファイル構成

```
src/infrastructure/adapter/codex/
├── payload_validator.ts      # payload 検証
├── deny_checker.ts           # .env deny チェック
├── prompt_builder.ts         # プロンプト生成
├── env_snapshot.ts           # .env スナップショット
├── result_parser.ts          # 結果パース
└── codex_adapter.ts          # 統合エントリポイント

scripts/
└── codex_executor.sh         # 薄いシェルラッパー
```

## 移行順序

1. TypeScript 層の実装（単体テスト付き）
2. `codex_executor.sh` の作成（現行 wrapper から抽出）
3. 統合テスト
4. 現行 `codex_wrapper.sh` の非推奨化
5. 安定後に削除

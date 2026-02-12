# TypeScript移行 環境変数互換マトリクス

## 目的
TypeScript ランタイム移行時に、Python 現行実装の環境変数契約を維持するための基準を固定する。

## 判定ルール
- 優先順位の基本: `CLI引数 > 環境変数 > デフォルト`
- `互換可否` の意味:
  - `可`: 同名・同義で維持する
  - `一部可`: 受理はするが値または実装範囲に制約がある
  - `条件付き可`: 現行実装の制約込みで互換対象（別 change で是正可能）

## Orchestrator 系
| Env | デフォルト値 | 型 / 許容値 | 優先順位（高→低） | 互換可否 | 備考 |
|---|---|---|---|---|---|
| `ORCHESTRATOR_PROVIDER` | `mock` | enum: `mock/openai/claude/gemini` | `--provider` > env > default | 一部可 | 現行実装は `mock/openai` のみ実装、`claude/gemini` は未実装エラー |
| `ORCHESTRATOR_OPENAI_MODEL` | `gpt-5-mini` | non-empty string | CLI明示指定なしのため env > default | 可 | `ORCHESTRATOR_PROVIDER=openai` 時に使用 |
| `ORCHESTRATOR_INPUT_TOKENS` | `4000` | int（最小1, 最大16000） | CLI明示指定なしのため env > default | 可 | 不正値は default にフォールバック |
| `ORCHESTRATOR_OUTPUT_TOKENS` | `800` | int（最小1, 最大2000） | CLI明示指定なしのため env > default | 可 | 不正値は default にフォールバック |
| `ORCHESTRATOR_REASONING_EFFORT` | `minimal` | string（推奨: `minimal/low`） | CLI明示指定なしのため env > default | 可 | OpenAI Responses API の reasoning effort |
| `ORCHESTRATOR_AUTO_APPROVE_FALLBACK` | `1` | bool-like（`1` で true、それ以外は false） | CLI明示指定なしのため env > default | 可 | 承認更新欠落時の安全側フォールバック |
| `HUMAN_APPROVAL` | `0` | bool-like（`1` で true） | `--human-approval` > `OrchestratorConfig.human_approval` > env > default | 条件付き可 | `run` CLI 経路では `OrchestratorConfig.human_approval=False` が常に設定されるため env 単独有効化は効かない |
| `OPENAI_API_KEY` | なし | non-empty string | env のみ（CLI明示指定なし） | 可 | `openai` provider 利用時は必須 |

## Teammate adapter 系
| Env | デフォルト値 | 型 / 許容値 | 優先順位（高→低） | 互換可否 | 備考 |
|---|---|---|---|---|---|
| `TEAMMATE_ADAPTER` | `subprocess` | enum: `subprocess/template` | `--teammate-adapter` > env > default | 可 | |
| `TEAMMATE_COMMAND` | `""` | shell command string | `--teammate-command` > env > default | 可 | `plan/execute` 個別指定がない場合の共通コマンド |
| `TEAMMATE_PLAN_COMMAND` | `""` | shell command string | `--plan-command` > env > `--teammate-command` / `TEAMMATE_COMMAND` > default wrapper | 可 | `TEAMMATE_COMMAND` より優先 |
| `TEAMMATE_EXECUTE_COMMAND` | `""` | shell command string | `--execute-command` > env > `--teammate-command` / `TEAMMATE_COMMAND` > default wrapper | 可 | `TEAMMATE_COMMAND` より優先 |
| `TEAMMATE_COMMAND_TIMEOUT` | `120` | int（実効値は最小1） | `--command-timeout` > env > default | 可 | env 不正値は `120`、0以下は実効時に1へ補正 |
| `TEAMMATE_STREAM_LOGS` | `1` | bool-like（`1` で true） | env > default | 可 | teammate subprocess の stderr ミラー表示制御 |
| `RESUME_REQUEUE_IN_PROGRESS` | `true` | bool-like（`1/true/yes/on`, `0/false/no/off`） | `--resume-requeue-in-progress` / `--no-resume-requeue-in-progress` > env > default | 可 | resume-run で `in_progress -> pending` 自動復旧制御 |

## codex_wrapper 系
| Env | デフォルト値 | 型 / 許容値 | 優先順位（高→低） | 互換可否 | 備考 |
|---|---|---|---|---|---|
| `TARGET_PROJECT_DIR` | wrapper 配置ディレクトリ | path | env > default | 可 | `codex exec -C` と `.env*` 監視ルートに使用 |
| `CODEX_BIN` | `codex` | executable name/path | env > default | 可 | |
| `CODEX_MODEL` | `""` | string | env > default | 可 | 指定時のみ `-m` を追加 |
| `CODEX_REASONING_EFFORT` | `""` | string（`minimal/low/medium/high` など） | env > default | 可 | 指定時のみ `-c model_reasoning_effort=...` を追加 |
| `CODEX_PROFILE` | `""` | string | env > default | 可 | 指定時のみ `-p` を追加 |
| `CODEX_SANDBOX` | `workspace-write` | string | env > default | 可 | `CODEX_FULL_AUTO!=1` のとき `-s` に適用 |
| `CODEX_FULL_AUTO` | `0` | bool-like（`1` で true） | env > default | 可 | `1` なら `--full-auto`、それ以外は `-s CODEX_SANDBOX` |
| `CODEX_SKIP_GIT_REPO_CHECK` | `1` | bool-like（`1` で true） | env > default | 可 | `1` のとき `--skip-git-repo-check` |
| `CODEX_STREAM_LOGS` | `1` | bool-like（`1` で true） | env > default | 可 | ストリーム表示有効化 |
| `CODEX_STREAM_VIEW` | `all` | enum: `all/all_compact/assistant/thinking` | env > default | 可 | 未知値は実質 `all` 相当の分岐に入る |
| `CODEX_STREAM_EXEC_MAX_CHARS` | `180` | int-like | env > default | 可 | `all_compact` 時のみ利用、数値化できない値は awk 側で 0 扱い |
| `CODEX_DENY_DOTENV` | `1` | bool-like（`0` 以外で有効） | env > default | 可 | `.env/.env.*` 参照禁止と改変検知の fail-closed 制御 |
| `CODEX_WRAPPER_LANG` | `en_US.UTF-8` | locale string | env > default | 可 | `LANG` / `LC_ALL` へ反映 |
| `CODEX_RUST_BACKTRACE` | `0` | string/int-like | env > default | 可 | `RUST_BACKTRACE` へ反映 |
| `CODEX_PROMPT_LOG_PATH` | `/tmp/codex_wrapper_last_prompt.txt` | path | env > default | 可 | `CODEX_WRAPPER_DEBUG=1` 時の prompt 保存先 |
| `CODEX_ERROR_LOG_PATH` | `/tmp/codex_wrapper_last_error.log` | path | env > default | 可 | codex 失敗時ログ保存先 |
| `CODEX_PROGRESS_RECENT_LINES` | `8` | int（最小1, 最大20） | env > default | 可 | prompt へ埋める進捗行数 |
| `CODEX_PROGRESS_RECENT_TEXT_CHARS` | `220` | int（最小80, 最大1200） | env > default | 可 | 各進捗行の文字数上限 |
| `CODEX_PROGRESS_RECENT_TOTAL_CHARS` | `2000` | int（最小400, 最大12000） | env > default | 可 | 進捗ブロック総文字数上限 |
| `CODEX_PROMPT_MAX_CHARS` | `16000` | int（最小2000, 最大120000） | env > default | 可 | wrapper に渡す prompt 全体上限 |
| `CODEX_WRAPPER_DEBUG` | `0` | bool-like（`1` で true） | env > default | 可 | wrapper デバッグログ有効化 |

## 互換維持ポリシー（TS 実装）
- 変数名は変更しない（alias 追加のみ許容、置換は禁止）。
- 既定値・型変換・クランプ条件を現行と同じ意味で維持する。
- 優先順位はこのマトリクスを正とし、`spec > design > 実装` の順で解釈する。

## コンテキスト（現行コードレビュー結果）
現行 Python 実装は以下の責務分割になっている。

- `team_orchestrator/cli.py`:
  - `run` / `compile-openspec` / `print-openspec-template` の CLI。
  - config 読込、resume/new-run 判定、adapter/provider 初期化。
- `team_orchestrator/openspec_compiler.py`:
  - `tasks.md` パース、overrides マージ、依存循環チェック、persona policy 検証。
- `team_orchestrator/state_store.py`:
  - `state.json` + lock による排他更新、claim/handoff/complete、progress log、mailbox。
- `team_orchestrator/orchestrator.py`:
  - 実行ループ本体、event 駆動 provider 呼出、persona pipeline と phase handoff。
- `team_orchestrator/provider.py`:
  - decision JSON の正規化/検証、mock/openai provider。
- `team_orchestrator/codex_adapter.py` + `codex_wrapper.sh`:
  - 外部 codex 実行連携、進捗ログの取り込み。
- `team_orchestrator/persona_*`:
  - persona catalog 読込（YAML）、policy 正規化、severity パイプライン。
- `tests/`:
  - 上記全モジュールの回帰仕様を担保。

この構造は機能的には安定しているため、TypeScript 化は「意味の再設計」ではなく「責務単位の移植 + 互換性検証」とする。

## 目標
- 既存挙動（CLI 入出力、state 遷移、OpenSpec compile 結果）を維持したまま TypeScript 実装へ移行する。
- Python 参照実装と TypeScript 実装の差分を機械的に検出できる。
- 移行中も `agent-dock` 実行運用を継続できる。
- 実装者ごとの解釈で判定がぶれないよう、比較項目と正規化ルールを固定する。

## 非目標
- 新機能追加を優先すること
- 仕様未定義領域の挙動変更
- テスト無しでの置換

## 技術選定

| カテゴリ | 選定 | 理由 |
|----------|------|------|
| ランタイム | Deno | Web標準、TS ネイティブ、単一バイナリ配布 |
| ビルド | 不要 (deno compile) | Deno 組み込みで完結 |
| テスト | Deno.test | 依存ゼロ、Python unittest と対応しやすい |
| CLI | Cliffy | Deno 専用、サブコマンド対応、排他制約対応 |
| YAML | std/yaml | 依存ゼロ、PyYAML と同じ YAML 1.1 |
| ファイルロック | proper-lockfile | stale検出・リトライ組み込み、実装コスト低 |

### 依存関係サマリ

```typescript
// Deno 標準（依存なし）
import { parse as parseYaml } from "https://deno.land/std/yaml/mod.ts";
import { assertEquals } from "https://deno.land/std/assert/mod.ts";

// Deno 専用サードパーティ
import { Command } from "https://deno.land/x/cliffy/command/mod.ts";

// npm 互換（1つだけ）
import lockfile from "npm:proper-lockfile";
```

## あるべき全体構成（TypeScript）

### 1) レイヤ分割
- `src/domain/`
  - Task, persona, decision などの純粋型・バリデーション。
- `src/application/`
  - orchestrator loop、use case（claim/execute/review/handoff）。
- `src/infrastructure/state/`
  - file-based state store、lock、atomic write。
- `src/infrastructure/provider/`
  - mock/openai provider 実装と decision schema 検証。
- `src/infrastructure/adapter/`
  - subprocess adapter（codex wrapper 呼出、stream 取り込み）。
- `src/infrastructure/openspec/`
  - compiler と template 出力。
- `src/cli/`
  - コマンド定義と引数解釈。

### 2) 互換境界（必須）
- CLI 互換:
  - サブコマンド: `run`, `compile-openspec`, `print-openspec-template`。
  - 主要オプション: `--config`, `--openspec-change`, `--save-compiled`, `--resume`,
    `--resume-requeue-in-progress`, `--teammate-adapter`, `--teammate-command`,
    `--plan-command`, `--execute-command`, `--state-dir`, `--provider`。
  - 排他条件: `--config` と `--openspec-change` の同時指定禁止。
- ファイル互換:
  - `state.json` の以下を互換対象とする:
    - `tasks.<id>` の `title`, `description`, `status`, `owner`, `planner`, `requires_plan`, `plan_status`,
      `depends_on`, `target_paths`, `persona_policy`, `current_phase_index`, `progress_log`
    - `messages[]`
    - `meta.sequence`, `meta.progress_counter`, `meta.last_progress_at`
  - `progress_log` は「空文字拒否」「上限件数ローテーション（既定 200）」の意味を維持する。
- compile 互換:
  - `tasks.md` -> `task_config` で以下を比較対象とする:
    - `teammates`
    - `tasks[].id/title/description/target_paths/depends_on/requires_plan/persona_policy`
    - `persona_defaults`
    - `personas`
    - `meta.verification_items`
- 実行互換:
  - persona phase handoff / approval / fallback 挙動を維持。

### 3) 型と検証
- Python 側の `normalize_*` 群・decision validation と同等の strict validation を TypeScript 側で実装する。
- 仕様に現れない暗黙型変換は避ける（fail-closed）。

### 4) テスト戦略
- 単体テスト移植:
  - `tests/` の主要ケースを TypeScript 側でも等価に再現。
- ゴールデン比較:
  - 同一入力に対する Python と TypeScript の `compile` 出力比較。
  - 代表シナリオで `state.json` 遷移の比較。
- 移行ゲート:
  - parity 合格まで Python を本番 runner として維持。

### 5) 比較時の正規化ルール（ぶれ防止）
- JSON 比較はキー順ソート済みで行う。
- `tasks` は `id` 昇順で比較する。
- `depends_on` は文字列として正規化し昇順比較する。
- `target_paths` は空白トリム後、重複除去したうえで辞書順に正規化して比較する。
- タイムスタンプ等の揮発値は compare 対象から除外する。
- 仕様で auto 補完される値（例: `target_paths=["*"]`）は補完後の最終値で比較する。

### 6) 成果物（将来 change で必須）
- `docs/ts-migration-contract.md`:
  - CLI 契約、state 契約、compile 契約、禁止変更点。
- `docs/ts-architecture-blueprint.md`:
  - domain/application/infrastructure/cli の責務境界。
- `docs/ts-parity-gate.md`:
  - parity test 入出力、正規化、合否判定。
- `docs/ts-cutover-runbook.md`:
  - 切替、監視、ロールバック条件。
- `docs/ts-wrapper-contract.md`:
  - wrapper 実行経路、I/O 契約、既定解決順。
- `docs/ts-env-compat-matrix.md`:
  - env 一覧、デフォルト値、型、優先順位、互換可否。

### 7) codex_wrapper 経路方針（固定）
- 移行期間中（TS parity gate 合格まで）は `codex_wrapper.sh` を維持する。
- Teammate 実行経路は `subprocess adapter -> codex_wrapper.sh -> codex exec` を維持する。
- TypeScript 実装でも wrapper 呼び出しは互換挙動とする（stdin payload, stdout result, stderr progress）。
- wrapper の置換（TS 実装化）は別 change とし、本 change のスコープ外とする。
- 既定 wrapper 解決は「実行ファイル隣の `codex_wrapper.sh`」を維持する。

### 8) wrapper I/O 契約（固定）
- 入力: stdin JSON（`mode`, `teammate_id`, `task`）
- 出力: stdout の最終結果4行
- `RESULT: completed|blocked`
- `SUMMARY: <=100 chars`
- `CHANGED_FILES: comma-separated`
- `CHECKS: executed check commands`
- 進捗: stderr ストリーム（`CODEX_STREAM_*` 設定に従う）

### 9) 環境変数互換（固定）
- 優先順位は `CLI引数 > 環境変数 > デフォルト`。
- TypeScript 移行後も下記 env は同名・同義で受理する。

- Orchestrator:
  - `ORCHESTRATOR_PROVIDER`
  - `ORCHESTRATOR_OPENAI_MODEL`
  - `ORCHESTRATOR_INPUT_TOKENS`
  - `ORCHESTRATOR_OUTPUT_TOKENS`
  - `ORCHESTRATOR_REASONING_EFFORT`
  - `ORCHESTRATOR_AUTO_APPROVE_FALLBACK`
  - `HUMAN_APPROVAL`
  - `OPENAI_API_KEY`

- Teammate adapter:
  - `TEAMMATE_ADAPTER`
  - `TEAMMATE_COMMAND`
  - `TEAMMATE_PLAN_COMMAND`
  - `TEAMMATE_EXECUTE_COMMAND`
  - `TEAMMATE_COMMAND_TIMEOUT`
  - `TEAMMATE_STREAM_LOGS`
  - `RESUME_REQUEUE_IN_PROGRESS`

- Codex wrapper:
  - `CODEX_BIN`
  - `CODEX_MODEL`
  - `CODEX_REASONING_EFFORT`
  - `CODEX_PROFILE`
  - `CODEX_SANDBOX`
  - `CODEX_FULL_AUTO`
  - `CODEX_SKIP_GIT_REPO_CHECK`
  - `CODEX_STREAM_LOGS`
  - `CODEX_STREAM_VIEW`
  - `CODEX_STREAM_EXEC_MAX_CHARS`
  - `CODEX_DENY_DOTENV`
  - `CODEX_WRAPPER_LANG`
  - `CODEX_RUST_BACKTRACE`
  - `CODEX_PROMPT_LOG_PATH`
  - `CODEX_ERROR_LOG_PATH`
  - `CODEX_PROGRESS_RECENT_LINES`
  - `CODEX_PROGRESS_RECENT_TEXT_CHARS`
  - `CODEX_PROGRESS_RECENT_TOTAL_CHARS`
  - `CODEX_PROMPT_MAX_CHARS`
  - `CODEX_WRAPPER_DEBUG`
  - `TARGET_PROJECT_DIR`

### 10) プラットフォーム方針（固定）
- 本 change では Windows はスコープ外（非対応維持）とする。
- 対応対象 OS は `macOS` / `Linux`。
- 理由:
  - `codex_wrapper.sh` の bash 前提を維持するため。
  - file lock 実装差異（Unix 系と Windows）による挙動差をこの change では吸収しないため。
- 受け入れ条件:
  - Windows CI / Windows 動作検証は必須としない。
- 将来対応:
  - Windows 対応は別 change として要件化する。

### 11) 参照と優先順位（固定）
- parity 比較の正規化ルールは `design.md` の「5) 比較時の正規化ルール（ぶれ防止）」を正とする。
- 仕様解釈の優先順位は `spec > design > 実装` とする。

## 依存関係グラフと移行順序の根拠

### 1) モジュール依存グラフ（Python 現行）
主要な内部 import 依存は以下。

```text
models <- adapter <- codex_adapter <- cli
models <- state_store <- orchestrator <- cli
persona_catalog <- persona_pipeline <- orchestrator <- cli
persona_catalog <- openspec_compiler <- cli
persona_policy  <- openspec_compiler <- cli
provider <- orchestrator <- cli
openspec_template <- cli
```

補足:
- `openspec_compiler` は `orchestrator` / `state_store` に直接依存しない。
- `orchestrator` は `state_store` API を多数呼ぶ（`self.store.*` の呼び出し点が多い）。

### 2) 結合度の評価
- `state_store` と `orchestrator` は import 循環はないが、実行時契約の結合が強い。
- 従って「`state_store` だけ先に本移行して、後で `orchestrator`」は回帰リスクが高い。
- 安全な順序は、`state_store` と `orchestrator` を同一マイルストーンで扱い、
  parity fixture を同時更新して検証する方式。

### 3) この change における移行順序の根拠
- 先行移植:
  - `domain` + `persona_*` + `openspec_compiler` + `openspec_template`
  - 理由: 実行ループに直接依存せず、入出力が fixture 化しやすい。
- 同時移植（同一マイルストーン）:
  - `state_store` + `orchestrator`
  - 理由: API 結合が強く、分離移植だと中間状態で破綻しやすい。
- 後続移植:
  - `provider` + `adapter` + `cli`
  - 理由: 上記コア移植後に配線・外部連携を接続する方が差分特定が容易。

## 段階移行計画
1. 契約固定フェーズ:
- 現行 Python の I/O 契約（CLI、state、compile）を fixture 化。

2. 基盤移植フェーズ:
- domain + persona_* + compiler + template を移植。

3. 実行移植フェーズ:
- state_store + orchestrator を同一マイルストーンで移植し、状態遷移 parity を先に通す。

4. 連携移植フェーズ:
- provider + adapter + cli を移植。

5. 切替フェーズ:
- `agent-dock` を TS 実装へ切替（Python fallback を残す）。

6. 収束フェーズ:
- 安定後に Python 実装を段階縮退。

## リスクと緩和
- リスク: lock/atomic write の挙動差で state 破損
  - 緩和: state store parity test + 障害注入テストを先行実装。

- リスク: OpenSpec compiler の解釈差分
  - 緩和: golden fixtures で差分を fail-fast。

- リスク: 実運用中の切替時回帰
  - 緩和: runner 切替を段階化し、Python fallback を維持。

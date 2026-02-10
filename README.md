# Codex Agent Teams 風ランタイム

「Lead + 複数 Teammate」で協調実行するための再利用可能なランタイムです。  
現在は Thin Orchestrator モデルを採用しており、重い処理は Teammate、Lead は短い JSON 判断のみを担当します。

## 提供機能
- Lead 専任のオーケストレーションループ（Lead は実装作業をしない）。
- アダプタ層経由の Teammate 計画・実行フロー。
- イベント駆動の Provider 呼び出し（tick ごとの LLM 呼び出しなし）。
- 共有タスクボード:
  - `pending / in_progress / blocked / needs_approval / completed`
  - `depends_on` による依存関係
  - `owner` による所有権
  - `target_paths` による担当境界
- 共有メールボックス API:
  - `send_message(...)`
  - `get_inbox(...)`
- `requires_plan=true` タスクの `approve/reject/revise` 承認ゲート。
- ファイルロックによるプロセス安全な排他的 claim。
- Provider 抽象化:
  - `ORCHESTRATOR_PROVIDER=mock|openai|claude|gemini`
- 停止条件:
  - 全タスク完了
  - idle ラウンド上限
  - idle 秒数上限
  - 人手承認待ち（`HUMAN_APPROVAL=1`）

## 前提条件
- Python `3.10+`
- 外部 Codex CLI 連携時は Node.js `18+`（任意）
- `ORCHESTRATOR_PROVIDER=openai` を使う場合のみ `OPENAI_API_KEY` が必要

## Thin Orchestrator ルール
- API コストを抑えるため、Provider は次イベント時のみ呼び出す:
  - `Kickoff`
  - `TaskCompleted`
  - `Blocked`
  - `NeedsApproval`
  - `NoProgress`
  - `Collision`
- Lead に渡す入力は圧縮済み snapshot のみを使う。
- 生ログ全文は直接渡さない。
- Lead の出力は JSON decision のみとする。

## クイックスタート
```bash
python3 -m venv .venv
python -m venv .venv
source .venv/bin/activate
python -m pip install -U pip
python -m pip install -e .
python -m pip install -U openai  # ORCHESTRATOR_PROVIDER=openai を使う場合
python -m unittest discover -s tests -v
ORCHESTRATOR_PROVIDER=mock python -m team_orchestrator.cli --teammate-adapter template --config examples/sample_tasks.json
```

## `--resume` で再開実行する
同じ `state-dir` を使って再開する場合は `--resume` を付けて起動します。

```bash
python -m team_orchestrator.cli \
  --config examples/sample_tasks.json \
  --state-dir /tmp/codex_agent_state \
  --resume
```

起動時には次の情報が表示されます。
- `[run] run_mode=new-run|resume-run`
- `[run] progress_log_ref=<state.json>::tasks.<task_id>.progress_log`

注意:
- `--resume` なしで起動すると常に `new-run` になり、既存タスク状態（`completed` / `blocked` / `progress_log` 含む）は再初期化されます。
- `--resume` 指定時に state 内タスクが存在する場合、`id` / `requires_plan` / `depends_on` / `target_paths` が入力 task_config と一致しないと失敗します。
- `--resume` を付けても、state が未作成または task が空なら `new-run` として初期投入されます。
- `--resume` では `in_progress` のまま残ったタスクを自動で `pending` に戻して再試行可能にします（`[run] resume_requeued_in_progress=...` を表示）。
- この自動復旧を無効にする場合は `--no-resume-requeue-in-progress` を指定します。

## progress log の使い方
Teammate 実行中の出力は、各タスクの `progress_log` に追記されます（`timestamp` / `source` / `text`）。

```bash
jq '.tasks["T-001"].progress_log' /tmp/codex_agent_state/state.json
```

運用上のポイント:
- 1 タスクあたり保持される `progress_log` は最新 200 件までです（古いものからローテーション）。
- `codex_wrapper.sh` の execute プロンプトには、`existing_progress_log_count` と直近ログ（最大 8 件）が渡されるため、途中再開時の文脈として利用できます。

## OpenSpec から実行する
運用フロー:
1. `openspec/changes/<change-id>/tasks.md` を入力にコンパイル
2. `task_configs/overrides/<change-id>.yaml` を任意で上書き適用
3. 生成された task_config で run

コンパイルのみ:
```bash
python -m team_orchestrator.cli compile-openspec \
  --change-id add-openspec-task-config-compiler \
  --openspec-root ./openspec \
  --overrides-root ./task_configs/overrides \
  --task-config-root ./task_configs
```

OpenSpec 直接実行:
```bash
python -m team_orchestrator.cli run \
  --openspec-change add-openspec-task-config-compiler \
  --save-compiled \
  --state-dir /tmp/codex_agent_openspec_state
```

注意:
- `--config` と `--openspec-change` は同時指定できません。
- `target_paths` 未指定タスクは自動で `["*"]` が補完されます（`meta.auto_target_path_tasks` に記録）。
- `overrides/*.yaml` を使う場合は `pyyaml` が必要です。
- 生成 JSON には `meta.verification_items` が含まれ、`tasks.md` の「検証項目」チェックリストを保持します。
- 検証セクション見出しは日本語/英語の両方に対応します（例: `検証項目`, `Verification Checklist`, `Validation`, `Checks`）。

`override yaml requires PyYAML` が出る場合:
```bash
source .venv/bin/activate
python -m pip install -e .
```

## OpenAI 最小確認手順
`OPENAI_API_KEY` 以外は `.env.orchestrator` から読み込み、API キーのみ `export` する運用を推奨します。

```bash
cd /path/to/codex_agent
source .venv/bin/activate
set -a; source .env.orchestrator; set +a
export OPENAI_API_KEY="YOUR_KEY"
export TEAMMATE_ADAPTER="subprocess"
export TEAMMATE_COMMAND="bash ./codex_wrapper.sh"
export CODEX_STREAM_LOGS="1"
export CODEX_STREAM_VIEW="assistant"
python -m team_orchestrator.cli --config examples/sample_tasks.json --state-dir /tmp/codex_agent_openai_state
```

成功判定:
- 終了時 JSON の `provider` が `openai`
- `provider_calls` が `1` 以上
- `stop_reason` が `all_tasks_completed`（サンプル時）

Lead(OpenAI) 接続だけを最小確認したい場合は、`--teammate-adapter template` を指定します。

## 環境変数
- `ORCHESTRATOR_PROVIDER`:
  - `mock`（既定）
  - `openai`（実装済み）
  - `claude` / `gemini`（予約済み、現時点では未実装）
- `ORCHESTRATOR_OPENAI_MODEL`:
  - 既定値: `gpt-5-mini`
- `ORCHESTRATOR_INPUT_TOKENS`:
  - 既定値: `4000`
  - ハード上限: `16000`
- `ORCHESTRATOR_OUTPUT_TOKENS`:
  - 既定値: `800`
  - ハード上限: `2000`
- `ORCHESTRATOR_REASONING_EFFORT`:
  - 既定値: `minimal`
  - 推奨値: `minimal` または `low`
- `ORCHESTRATOR_AUTO_APPROVE_FALLBACK`:
  - 既定値: `1`
  - `1` の場合、Provider が承認待ちタスクに有効な承認更新を返さないときに安全側の自動承認を実施
  - `0` の場合、Provider の判断のみで進行
- `HUMAN_APPROVAL`:
  - `1` で承認が必要な時点で停止し、人手判断を待つ
- `TEAMMATE_ADAPTER`:
  - `subprocess`（既定）
  - `template`（疎通確認用）
- `TEAMMATE_COMMAND`:
  - `plan/execute` 共通で使う外部コマンド
- `TEAMMATE_PLAN_COMMAND`:
  - 計画作成専用コマンド（`TEAMMATE_COMMAND` より優先）
- `TEAMMATE_EXECUTE_COMMAND`:
  - 実行専用コマンド（`TEAMMATE_COMMAND` より優先）
- `TEAMMATE_COMMAND_TIMEOUT`:
  - 外部コマンドのタイムアウト秒（既定 `120`）
  - 暫定運用では `900` を推奨（長時間の Codex 実行を途中停止させないため）
- `TEAMMATE_STREAM_LOGS`:
  - `1`（既定）で Teammate 外部コマンドの実行中ログを端末へ表示
  - `0` で stderr を内部捕捉（エラー時のみ本文へ表示）
- `CODEX_STREAM_LOGS`:
  - `1`（既定）で `codex_wrapper.sh` 実行中のログを表示
  - `0` でログ非表示
- `CODEX_STREAM_VIEW`:
  - `all`（既定）で Codex の実行ログをそのまま表示
  - `assistant` で `user`/`thinking`/`codex` のみ表示し、`exec`・diff・コマンド出力を非表示
  - `thinking` で `thinking`/`codex` のみ表示（`user` も非表示）
- `CODEX_REASONING_EFFORT`:
  - `codex exec` の `model_reasoning_effort` を上書き（例: `minimal`, `low`, `medium`, `high`）
  - 未指定時は `~/.codex/config.toml` 側の設定値を使用
- `CODEX_DENY_DOTENV`:
  - `1`（既定）で `.env` / `.env.*` の参照を含むタスク payload を拒否
  - `1`（既定）で Codex 実行前後に `.env` / `.env.*` の改変を検出した場合は失敗
  - `0` でこの deny ルールを無効化

## プロジェクト構成
- `team_orchestrator/models.py`: タスクモデルと状態フィールド。
- `team_orchestrator/state_store.py`: 共有 JSON 状態 + ファイルロック + メールボックス + claim/衝突ロジック。
- `team_orchestrator/orchestrator.py`: イベント駆動の Lead/Teammate 実行ループ。
- `team_orchestrator/provider.py`: Provider 抽象化、decision 検証、mock/openai Provider。
- `team_orchestrator/openspec_compiler.py`: OpenSpec change を task_config に変換。
- `team_orchestrator/adapter.py`: Teammate アダプタ Protocol と最小デモ向けテンプレート実装。
- `team_orchestrator/codex_adapter.py`: Codex 連携用の外部コマンドアダプタ。
- `team_orchestrator/cli.py`: CLI エントリポイント。
- `docs/agent_teams_like_spec.md`: 汎用仕様。
- `docs/thin_orchestrator_spec.md`: Thin Orchestrator 移行仕様。
- `bug_fixes/`: 不具合修正ログ。
- `examples/sample_tasks.json`: デモ用タスクグラフ。
- `task_configs/overrides/`: OpenSpec コンパイル結果の上書き定義。
- `tests/`: 単体テスト。

## タスク設定フォーマット
`examples/sample_tasks.json` の構造:
- `teammates`: Teammate ID 一覧。
- `tasks[]`:
  - `id`, `title`, `description`
  - `target_paths`（必須）
  - `depends_on`
  - `requires_plan`
- `personas[]`（任意）:
  - `id`, `role`, `focus`, `can_block`, `enabled`
  - `execution`（任意）:
    - `enabled`（bool）
    - `command_ref`（non-empty string）
    - `sandbox`（non-empty string）
    - `timeout_sec`（positive integer）
  - 同名 `id` はデフォルト定義を完全上書き、非同名 `id` は追加
- `persona_defaults`（任意）:
  - `phase_order`: フェーズ順序（例: `["implement", "review", "spec_check", "test"]`）
  - `phase_policies`:
    - `active_personas`: コメント参加可能なペルソナ
    - `executor_personas`: 実行主体になれるペルソナ
    - `state_transition_personas`: `critical` / `blocker` で状態遷移できるペルソナ
- `tasks[].persona_policy`（任意）:
  - `disable_personas`: 当該タスクで実行/評価の両方から除外するペルソナ
  - `phase_overrides`: タスク単位のフェーズ別上書き

## ペルソナ実行モード設定例
```json
{
  "teammates": ["teammate-a", "teammate-b"],
  "personas": [
    {
      "id": "implementer",
      "role": "implementer",
      "focus": "implementation ownership",
      "can_block": false,
      "enabled": true,
      "execution": {
        "enabled": true,
        "command_ref": "default",
        "sandbox": "workspace-write",
        "timeout_sec": 900
      }
    },
    {
      "id": "code-reviewer",
      "role": "reviewer",
      "focus": "quality and regression review",
      "can_block": false,
      "enabled": true,
      "execution": {
        "enabled": true,
        "command_ref": "default",
        "sandbox": "workspace-write",
        "timeout_sec": 900
      }
    },
    {
      "id": "spec-checker",
      "role": "spec_guard",
      "focus": "spec conformance check",
      "can_block": false,
      "enabled": true
    }
  ],
  "persona_defaults": {
    "phase_order": ["implement", "review"],
    "phase_policies": {
      "implement": {
        "active_personas": ["implementer"],
        "executor_personas": ["implementer"],
        "state_transition_personas": ["implementer"]
      },
      "review": {
        "active_personas": ["code-reviewer", "spec-checker"],
        "executor_personas": ["code-reviewer"],
        "state_transition_personas": ["code-reviewer"]
      }
    }
  },
  "tasks": [
    {
      "id": "1.1",
      "title": "README/運用手順を更新する",
      "target_paths": ["README.md"],
      "depends_on": [],
      "requires_plan": false,
      "persona_policy": {
        "disable_personas": ["spec-checker"],
        "phase_overrides": {
          "review": {
            "active_personas": ["code-reviewer"],
            "executor_personas": ["code-reviewer"],
            "state_transition_personas": ["code-reviewer"]
          }
        }
      }
    }
  ]
}
```

## フェーズ設計ガイド
- 推奨の既定順序は `implement -> review -> spec_check -> test` です。
- `active_personas` は同一フェーズで複数指定できます（複数コメントを許可）。
- `executor_personas` は実行 claim 対象を決めます。フェーズ内に少なくとも1つ必要です。
- `state_transition_personas` はコメント参加権限とは独立です。ここに含まれないペルソナの `critical` / `blocker` は状態遷移できません。
- `blocker` は `can_block=true` かつ `state_transition_personas` に含まれる場合のみ即停止します。

## 移行手順（teammate 実行から persona 実行へ）
1. 既存 `teammates` 構成を維持したまま `personas` を追加する（最初は `execution.enabled=false` でも可）。
2. 実行主体にしたいペルソナだけ `execution.enabled=true` にする。
3. `persona_defaults.phase_order` と `phase_policies` を定義し、`executor_personas` を各フェーズに割り当てる。
4. 必要なタスクに `tasks[].persona_policy`（`disable_personas`, `phase_overrides`）を追加する。
5. `python -m unittest discover -s tests -v` を実行し、phase handoff と fallback を確認してから本番反映する。

## 制約と失敗条件
- `personas[].execution` は `enabled/command_ref/sandbox/timeout_sec` をすべて含む必要があります。
- `persona_defaults` / `persona_policy` で未知ペルソナを参照すると起動またはコンパイルは失敗します。
- OpenSpec コンパイル時、未知フェーズ（`phase_order` にないフェーズ）を `phase_policies` / `phase_overrides` へ指定すると失敗します。
- `disable_personas` は実行主体選定とコメント評価の両方に適用されます。
- `personas` が未指定、または有効な `execution.enabled=true` が0件のときは `teammates` 実行へフォールバックします。
- 有効な実行主体（persona または teammate）が1件もない構成は起動できません。

## ペルソナ品質ゲート
- デフォルト4ペルソナ:
  - `implementer`
  - `code-reviewer`
  - `spec-checker`
  - `test-owner`
- 重大度挙動:
  - `info`: ログ記録のみ
  - `warn`: 次ラウンド再確認（`WarnRecheck`）へ追加
  - `critical`: 対象タスクを `needs_approval` へ遷移
  - `blocker`: `can_block=true` のペルソナのみ即停止（`stop_reason=persona_blocker:<id>`）
  - `can_block=false` の `blocker` は `critical` 相当へフォールバック
  - `ORCHESTRATOR_AUTO_APPROVE_FALLBACK=1` の場合、`requires_plan=false` の `needs_approval` は Lead 側で `pending` へ自動復帰
- コメント上限:
  - 1イベントあたり最大2件（重大度優先 + 決定的ソート）

## 出力例
```text
1770605270.871 [teammate-a] plan submitted task=T-001
1770605270.872 [lead] update task=T-001 status=pending plan_status=approved
1770605270.874 [teammate-a] completed task=T-001
1770605270.875 [teammate-b] plan submitted task=T-002
1770605270.876 [lead] update task=T-002 status=pending plan_status=approved
1770605270.877 [teammate-a] completed task=T-002
1770605270.878 [teammate-b] completed task=T-003
{
  "stop_reason": "all_tasks_completed",
  "elapsed_seconds": 0.008,
  "summary": {
    "pending": 0,
    "in_progress": 0,
    "blocked": 0,
    "needs_approval": 0,
    "completed": 3
  },
  "tasks_total": 3,
  "provider_calls": 2,
  "provider": "mock",
  "human_approval": false,
  "persona_metrics": {
    "severity_counts": {
      "info": 2,
      "warn": 1,
      "critical": 0,
      "blocker": 0
    },
    "persona_blocker_triggered": false,
    "warn_recheck_queue_remaining": 1
  }
}
```

## Teammate 側 Codex 実行
`SubprocessCodexAdapter` は以下 2 コマンドを受け取ります:
- `plan_command`
- `execute_command`

両コマンドは STDIN から JSON を受け取り、STDOUT にプレーンテキストを返します。  
これによりコアランタイムを汎用のまま維持しつつ、プロジェクトごとの Codex ラッパーを差し替えられます。

CLI からは次の優先順でコマンドを解決します:
- `--plan-command` / `--execute-command`
- `TEAMMATE_PLAN_COMMAND` / `TEAMMATE_EXECUTE_COMMAND`
- `--teammate-command`
- `TEAMMATE_COMMAND`

このリポジトリには `codex_wrapper.sh` を同梱しています。  
まずは次で動かせます:

```bash
export TARGET_PROJECT_DIR="$(pwd)"
export TEAMMATE_ADAPTER="subprocess"
export TEAMMATE_COMMAND="bash ./codex_wrapper.sh"
export CODEX_STREAM_LOGS="1"
export CODEX_STREAM_VIEW="assistant"
```

## 実運用時の注意
- `TemplateTeammateAdapter` は疎通確認用です。
- 実運用では `SubprocessCodexAdapter` を使い、対象プロジェクト側の Codex 実行コマンドに接続してください。
- CLI 既定は `SubprocessCodexAdapter` です。外部コマンド未設定で起動するとエラーになります。

## OpenAI Lead Provider
`ORCHESTRATOR_PROVIDER=openai` の場合、OpenAI API を使うのは Lead Provider のみです。  
Teammate 側の重い処理は Codex 実行経路に残ります。

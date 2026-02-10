# 変更提案: `run` に resume モードを追加する

## Why
現行の `run` は起動時に常に `replace=True` でタスクを再投入するため、同じ `--state-dir` でも途中再開できない。
長時間実行でタイムアウトや provider error が起きた場合、毎回最初からやり直しになり運用効率が悪い。

## What Changes
- `run` に `--resume` オプションを追加し、既存 state があればその状態から再開できるようにする。
- `--resume` 指定時に state 内タスクと入力 task_config の整合性を検証し、不一致なら安全側で失敗する。
- state が空または未初期化の場合は、`--resume` でも初期投入して通常開始できるようにする。
- Teammate 実行中コマンドの途中出力（progress log）を逐次 state に保存し、再開時に参照できるようにする。
- 起動時ログに `new-run` / `resume-run` を明示して運用上の誤認を防ぐ。

## Impact
- 影響する仕様:
  - `orchestrator-openspec-run`（ADDED）
- 主な実装対象:
  - `team_orchestrator/cli.py`
  - `team_orchestrator/state_store.py`
  - `team_orchestrator/codex_adapter.py`
  - `team_orchestrator/orchestrator.py`
  - `tests/test_cli.py`
  - `tests/test_orchestrator.py`
  - `tests/test_state_store.py`
  - `README.md`

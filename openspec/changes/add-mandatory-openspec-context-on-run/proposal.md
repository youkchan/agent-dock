# 変更提案: run 実行時に OpenSpec 文脈を常時参照させる

## Why
現行の `run --config` フローでは、実行者が OpenSpec の意図・要求・検証観点を読まずに作業できてしまう。
その結果、タスクの見出しだけで進行して仕様逸脱や受け入れ漏れが発生するリスクがある。

## What Changes
- `task_config` は実行インデックスとして扱い、仕様の真実源は OpenSpec (`changes/<id>`) に固定する。
- `run` は各タスク配布前に、対象 change の `proposal.md` / `tasks.md` / `specs/**/spec.md` を必ず読み込む。
- `run --config` を使う場合も、`meta.source_change_id` から OpenSpec を解決し、解決できない場合は実行を開始しない。
- タスク実行プロンプトに OpenSpec 要点（要求・シナリオ・受け入れ観点）を同梱する。
- 実行者は開始前に `SPEC_ACK`（理解要約）を返すことを必須化し、欠落時は当該タスクを進行させない。
- 完了報告に `SPEC_COVERAGE`（満たした要求/シナリオ）を必須化する。

## Impact
- 影響する仕様:
  - `orchestrator-openspec-run`（変更）
- 主な実装対象:
  - `team_orchestrator/cli.py`
  - `team_orchestrator/openspec_compiler.py`
  - `team_orchestrator/orchestrator.py`
  - `team_orchestrator/codex_adapter.py`
  - `tests/` 配下の run/adapter/orchestrator テスト
  - `README.md`

# 変更提案: `target_paths=*` の自動絞り込みと実行中スコープ拡張

## Why
`target_paths` が `*` のタスクは探索範囲が広すぎて、実行時間・コスト・ノイズが増えやすい。
一方で、最初から固定の狭い範囲にすると実装途中で必要ファイルが見つかった際に詰まりやすい。
そのため、初期スキャンで自動絞り込みし、必要時に安全にスコープ更新できる仕組みが必要。

## What Changes
- `target_paths=*` を「プロジェクト全体許可」の意味で維持しつつ、タスク開始時に初期スキャンで実効スコープを自動算出する。
- 実行中に未想定の必要ファイルが見つかった場合、スコープ拡張要求を出して `target_paths` を更新できるようにする。
- スコープ更新は監査可能なログとして state に保存し、誰がなぜ拡張したか追跡できるようにする。
- スコープは常に `TARGET_PROJECT_DIR` 配下に制限し、外部ディレクトリは対象外とする。

## Impact
- 影響する仕様:
  - `orchestrator-openspec-run`（ADDED）
- 主な実装対象:
  - `team_orchestrator/orchestrator.py`
  - `team_orchestrator/state_store.py`
  - `team_orchestrator/models.py`
  - `team_orchestrator/codex_adapter.py`
  - `tests/test_orchestrator.py`
  - `tests/test_state_store.py`
  - `README.md`

# 変更提案: OpenSpec から実行用 task_config をコンパイルする

## Why
現行ランタイムは `--config` で直接 JSON を指定して実行する方式であり、`openspec/changes/*` から実行可能なタスク定義を直接生成できない。
そのため、OpenSpec で変更提案を作っても実行までに手動変換が必要で、運用の再現性と速度が落ちている。

## What Changes
- `openspec/changes/<change-id>/` を読み取り、`task_configs/<change-id>.json` を生成するコンパイラを追加する。
- コンパイラに `depends_on` を自然に構成できる変換ルール（解析 -> 変換 -> マージ -> 実行）を追加する。
- `overrides/<change-id>.yaml` を任意で読み込み、生成済みタスクへ上書きマージする仕組みを追加する。
- `compile-openspec` CLI を追加し、明示的にコンパイルできるようにする。
- `run --openspec-change <change-id>` を追加し、実行時に OpenSpec から task_config を生成・読込できるようにする。

## Impact
- 影響する仕様:
  - `openspec-task-config-compiler`（新規）
  - `orchestrator-openspec-run`（新規）
- 主な実装対象:
  - `team_orchestrator/cli.py`
  - `team_orchestrator/` 配下の OpenSpec 解析・変換モジュール（新規）
  - `tests/` 配下の単体テスト
  - `README.md` の実行手順
- 互換性:
  - 既存 `--config` フローは維持し、OpenSpec フローは追加導線として導入する。

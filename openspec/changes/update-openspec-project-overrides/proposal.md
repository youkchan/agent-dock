# 変更提案: OpenSpec コンパイルの override をプロジェクト固定にする

## Why
現行の OpenSpec コンパイルでは `task_configs/overrides/<change-id>.yaml` を前提としており、change ごとに override ファイルを作る運用になっている。
一方、実際に上書きしたい値はプロジェクト共通であることが多く、change ごとの override 管理は冗長でメンテナンスコストが高い。

## What Changes
- `compile-openspec` は `task_configs/overrides/project.yaml` を存在時のみ自動読み込みする。
- `task_configs/overrides/<change-id>.yaml` は標準入力源から外し、コンパイル対象に含めない。
- override ファイルが存在しない場合は、上書きなしで通常どおりコンパイルを続行する。
- README と運用ドキュメントに、project override の用途と具体例を追加する。

## Impact
- 影響する仕様:
  - `openspec-task-config-compiler`（MODIFIED）
- 主な実装対象:
  - `team_orchestrator/openspec_compiler.py`
  - `team_orchestrator/cli.py`
  - `tests/test_openspec_compiler.py`
  - `README.md`

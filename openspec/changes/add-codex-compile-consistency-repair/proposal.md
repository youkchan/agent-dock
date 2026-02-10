# 変更提案: compile-openspec の内部整合性チェックを強化する

## 背景
`compile-openspec` は `openspec/changes/<change-id>/tasks.md` を中心に `task_config` を生成できるが、入力不備やタスク定義不足が残ると実行段階で手戻りが発生する。

## 変更内容
- `compile-openspec` 実行時に、コンパイラ内部ロジックのみで整合性チェックを行う。
- 既存の構造バリデーション（依存・循環・必須項目）を強化し、安全性を担保する。
- 既存コンパイル検証を強化し、`tasks.md` の各タスクに `フェーズ担当` / `phase assignments`（または同等の `persona_policy.phase_overrides`）がない場合は失敗させる。
- 検証に失敗した場合はコンパイルを失敗させ、原因を明示する。

## 目的
OpenSpec change の意図と実行用 `task_config` のギャップをコンパイル時点で縮め、実行前の品質ゲートを強化する。

## 影響範囲
- 影響する仕様:
  - `openspec-codex-consistency-repair`
- 主な実装対象:
  - `team_orchestrator/openspec_compiler.py`
  - `team_orchestrator/cli.py`
  - `tests/test_openspec_compiler.py`
  - `README.md`

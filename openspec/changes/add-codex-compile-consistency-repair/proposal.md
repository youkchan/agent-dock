# 変更提案: compile-openspec に Codex 整合性レビューと自動補正を追加する

## 背景
`compile-openspec` は `openspec/changes/<change-id>/tasks.md` を中心に `task_config` を生成できるが、提案本文や spec delta との意味的なズレは静的ルールだけでは検出しづらい。
このため、コンパイル結果に不足タスクや属性不整合が残ると、実行段階で手戻りが発生する。

## 変更内容
- `compile-openspec` 実行時に、OpenSpec change と生成 `task_config` を Codex に渡して整合性レビューする段を追加する。
- Codex が不整合を返した場合、許可された補正形式に従って `task_config` へ追記/修正を適用する。
- 補正後は既存の構造バリデーション（依存・循環・必須項目）を再実行し、安全性を担保する。
- 既存コンパイル検証を強化し、`tasks.md` の各タスクに `フェーズ担当` / `phase assignments`（または同等の `persona_policy.phase_overrides`）がない場合は失敗させる。
- 補正不可または不正補正の場合はコンパイルを失敗させ、原因を明示する。
- 出力 `task_config` の `meta` にレビュー結果（整合判定、補正有無、指摘件数）を残し、追跡可能にする。

## 目的
OpenSpec change の意図と実行用 `task_config` のギャップをコンパイル時点で縮め、実行前の品質ゲートを強化する。

## 影響範囲
- 影響する仕様:
  - `openspec-codex-consistency-repair`（新規）
- 主な実装対象:
  - `team_orchestrator/openspec_compiler.py`
  - `team_orchestrator/cli.py`
  - Codex レビュー連携用の新規モジュール
  - `tests/test_openspec_compiler.py`
  - `README.md`

# 変更提案: 要件から OpenSpec 一式を生成する spec creator を追加する

## 背景
現在は要件を対話で整理しながら `proposal.md` / `tasks.md` / `design.md` を手作業で作成しているため、次の問題がある。

- テンプレート準拠が揺れ、`compile-openspec` と齟齬が出る。
- `spec` / `design` が抽象的になり、実装段階で解釈ブレが出る。
- OpenSpec と実装コードの対応が見えにくく、レビュー時の認知負荷が高い。

## 変更内容
- 要件入力から OpenSpec 一式を生成する `spec creator` 機能を追加する。
- 生成時の `tasks.md` は `agent-dock print-openspec-template --lang ja|en` のテンプレート形式を必須適用する。
- 実装対応を明確化するため、`code_summary.md` を新規出力する。
- `spec creator` は可変タスク生成ではなく、固定 `task_config` テンプレートへ `spec_context` を注入して実行する。
- `run` 本体に大きな分岐は追加せず、実行前の前処理で `spec_context` を収集し、固定 `task_config` を生成して `run --config` に渡す。
- `spec creator` 実行時のペルソナ集合は `spec-planner` / `spec-reviewer` / `spec-code-creator` を使い、通常 `run` の実行ペルソナ集合と分離する。
- ペルソナを追加し、役割を明確化する。
  - `spec-planner`: 構成設計
  - `spec-reviewer`: 整合・過不足レビュー
  - `spec-code-creator`: `code_summary.md` 作成
- `spec-reviewer` は「要件外追加」「過剰修正」「冗長化」の検出を必須化し、重大不整合は停止できるようにする。
- `spec creator` は常時インタラクティブで実行し、必須入力が確定しない場合は fail-closed で停止する。

## 目的
- OpenSpec のフォーマット揺れを抑制する。
- 仕様から実装へのトレーサビリティを高める。
- 提案レビューと実装レビューの認知負荷を下げる。

## この change でやらないこと
- OpenAI/Claude/Gemini など Provider 実装詳細の新規追加。
- 既存 `run` ループ（claim/状態遷移/停止条件）の改変。
- OpenSpec 本体仕様（Requirement/Scenario 文法）の変更。

## 影響範囲
- 影響する仕様:
  - `spec-creator`（新規）
  - `persona-execution-policy`（MODIFIED）
- 想定実装対象:
  - `src/cli/main.ts`（spec creator 前処理導線）
  - 新規 `src/application/spec_creator/preprocess.ts`（spec_context 収集と固定 task_config 生成）
  - `src/infrastructure/openspec/template.ts`（テンプレート適用）
  - 新規 `src/infrastructure/openspec/spec_creator.ts`（生成ロジック）
  - `team_orchestrator/personas/default/*.yaml`（新規ペルソナ定義）
  - `README.md`（運用手順）

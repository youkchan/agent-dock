## Context
要件から OpenSpec を起こす作業が対話依存になっており、テンプレート逸脱と実装ブレが起きやすい。
特に `tasks.md` の形式ズレと、仕様からコードへの対応関係が見えないことが、レビュー時の認知負荷を増やしている。

## Goals / Non-Goals
- Goals:
  - `tasks.md` をテンプレート固定で生成する。
  - `proposal/tasks/design/code_summary` の対応関係を明示する。
  - ペルソナで「構成作成」「整合レビュー」「コード要約」を分離する。
- Non-Goals:
  - LLM provider 実装の追加。
  - OpenSpec Requirement/Scenario 文法そのものの変更。

## Decisions
- Decision 1: `run` ループ本体は共通利用し、spec creator 専用分岐は前処理に限定する。
  - 理由: 既存 `run` の安定した状態機械を維持し、分岐増加による保守コストを避けるため。
- Decision 2: `spec creator` は固定 `task_config` テンプレートを使う。
  - 理由: タスク自体を可変化すると生成品質と再現性が下がるため。
- Decision 3: 前処理で `spec_context` を収集し、固定 `task_config` を生成して `run --config` へ渡す。
  - 理由: ユーザー要件の可変部分を入力コンテキストに閉じ込め、`run` 実装を共通化するため。
- Decision 4: `tasks.md` は `print-openspec-template` の固定文言をベースに生成する。
  - 理由: compile-openspec 互換を揺らさないため。
- Decision 5: `code_summary.md` を必須出力にする。
  - 理由: 実装時に参照するコード粒度情報を先に固定し、実装ブレを減らすため。
- Decision 6: `spec-reviewer` に停止権限（block）を付与する。
  - 理由: 要件外追加や過剰修正をレビュー段階で止めるため。
- Decision 7: spec creator は常時インタラクティブ実行とし、非TTY/未確定入力は fail-closed で停止する。
  - 理由: 仕様入力の曖昧さを残したまま生成しないため。

## Data Contract
- spec creator input:
  - `change_id`（必須）
  - `spec_context`（前処理で収集）
    - `requirements_text`
    - `scope_paths`（任意）
    - `non_goals`
    - `acceptance_criteria`
    - `language`（ja/en）
    - `persona_policy`（spec creator 用）
- fixed task_config template:
  - `S-1` 要件正規化（spec-planner）
  - `S-2` proposal 生成（spec-planner）
  - `S-3` tasks 生成（spec-planner）
  - `S-4` design 生成（spec-planner）
  - `S-5` code_summary 生成（spec-code-creator）
  - `S-6` 整合レビュー（spec-reviewer）
  - `S-7` strict validate（spec-reviewer）
- spec creator output:
  - `task_configs/spec_creator/<change_id>.json`
  - `proposal.md`
  - `tasks.md`
  - `design.md`（必要時）
  - `code_summary.md`

## code_summary.md Minimal Schema
- `task_id`
- `code_units[]`
  - `file`
  - `service`
  - `function`
  - `purpose`
  - `input`
  - `output`
  - `error`
  - `test`

## Validation Rules
- `tasks.md` 固定行が欠落していたら失敗。
- 各 `task_id` は `code_summary.md` に最低1件の `code_unit` を持つ。
- `code_summary.md` の `task_id` は `tasks.md` に存在するIDのみ許可。
- reviewer 指摘の重大度が `blocker` の場合は停止。
- spec creator 実行時は `spec` ペルソナ集合のみ使用し、通常 run ペルソナ集合を混在させない。
- 前処理完了後の実行経路は既存 `run` と同じ結果契約（stop_reason/summary/provider_calls）を維持する。
- spec creator 実行時は `--config` 経路のみを使い、OpenSpec入力前提の処理に依存しない。

## Risks / Trade-offs
- リスク: `code_summary.md` 記述量が増える。
  - 対策: 最小スキーマに限定し、詳細設計を混在させない。
- リスク: reviewer の停止が厳しすぎる。
  - 対策: `blocker` 以外は修正要求に留める運用を定義する。

## Migration Plan
1. 現行テンプレート準拠の spec creator を追加する。
2. 新規ペルソナ3種を default catalog に追加する。
3. 既存変更1件で試行し、レビュー工数の差分を測定する。
4. 問題がなければ標準フローに組み込む。

## Open Questions
- `code_summary.md` の粒度（関数単位/モジュール単位）の既定をどこまで厳格化するか。

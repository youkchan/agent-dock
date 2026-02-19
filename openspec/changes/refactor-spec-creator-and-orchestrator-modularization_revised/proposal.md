# 変更提案: spec-creator / orchestrator の責務分割を段階導入する

## 変更理由
- `spec-creator` / `orchestrator` 周辺は機能追加を優先した結果、責務が単一ファイルへ集中し、変更影響とレビュー観点の追跡が難しい。
- 仕様上は通っても意味論がずれる運用問題が発生しており、構造起因の再発リスクが高い。
- 継続的な開発速度を維持するため、先に責務境界を整理し、回帰原因を局所化する必要がある。

## 変更内容
- 目的:
  - 構造分割で変更影響を局所化する。
  - レビュー時に確認すべき責務境界を固定する。
  - 完了判定を形式一致だけでなく意味論一致まで安定化する。
  - リファクタ中は外部挙動と公開シグネチャを不変に保つ。
- 最小スコープ（in scope）:
  - `src/cli/main.ts` を command/args/workflow へ分割し、`main.ts` にはディスパッチと既存 export 互換のみを残す。
  - 実行結果パーサ重複を `src/domain/execution_result.ts` に集約し、`helper.ts` と `orchestrator.ts` から共通利用する。
  - `src/infrastructure/openspec/spec_creator.ts` の混在責務を prompt/context/polish utilities へ分割し、再export ハブへ縮小する。
  - `src/application/orchestrator/orchestrator.ts` を pure 関数抽出から段階分割し、判定ロジックと実行ロジックの境界を明確化する。
- 非スコープ（out of scope）:
  - 新機能追加、判定ルール変更、メッセージ仕様変更。
  - CLI 公開関数シグネチャ変更、既存実行経路変更。
  - 責務移動と無関係な最適化や広域リネーム。
- 判定契約:
  - review/spec_check/test の完了出力は `RESULT` / `SUMMARY` / `CHANGED_FILES` / `CHECKS` / `JUDGMENT` の5行契約を必須とする。
  - `JUDGMENT` は必須行で、`pass` / `changes_required` / `blocked` のみ許容する。

## 影響範囲
- 影響する仕様:
  - `refactor-spec-creator-and-orchestrator-modularization_revised`（ADDED）
- 主な実装対象:
  - `src/cli/main.ts`, `src/cli/commands/*`, `src/cli/args/*`, `src/cli/spec_creator_workflow.ts`
  - `src/domain/execution_result.ts`, `src/infrastructure/wrapper/helper.ts`
  - `src/infrastructure/openspec/spec_creator*.ts`
  - `src/application/orchestrator/orchestrator.ts`
- 受け入れゲート:
  - `src/cli/main_test.ts`
  - `src/infrastructure/wrapper/helper_test.ts`
  - `src/infrastructure/openspec/spec_creator_test.ts`
  - `src/application/orchestrator/orchestrator_test.ts`
  - `openspec validate refactor-spec-creator-and-orchestrator-modularization_revised --strict`

## Provider 完了判定ゲート（固定）
- `ORCHESTRATOR_PROVIDER=mock` 実行のみでは完了扱いにしない。
- 対象プロジェクトの実運用実行経路での受け入れ実行を必須とする。
- `not implemented` 等の未実装エラーは未完了として扱う（fail-closed）。

## Reviewer 停止判定ゲート（固定）
- `spec-reviewer` が重大違反を検出したら `REVIEWER_STOP:requirement_drift|over_editing|verbosity` を出力する。
- `REVIEWER_STOP:` を含むレビュー結果は blocker として停止判定する。

## 受け入れ条件
- `openspec validate refactor-spec-creator-and-orchestrator-modularization_revised --strict` が成功する。
- `src/cli/main_test.ts`, `src/infrastructure/wrapper/helper_test.ts`, `src/infrastructure/openspec/spec_creator_test.ts`, `src/application/orchestrator/orchestrator_test.ts` の既存回帰テストと `deno check src/**/*.ts` が成功する。
- 5行契約違反は fail-closed で扱われる。

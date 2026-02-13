# 2026-02-09 Orchestrator / OpenAI 安定化ログ

## 概要

OpenAI Provider 連携時に発生した停止・不整合・進行停止バグを修正し、`all_tasks_completed` まで完走できる状態に改善した。

## Fix 1: OpenAI 応答が空扱いになる

- 症状:
  - `provider_error: openai provider returned empty output`
- 原因:
  - SDK/モデルの応答形式差分で `output_text` が空になり、本文抽出に失敗していた。
- 修正:
  - `response.output_text` 以外の経路からも本文を抽出するフォールバックを追加。
  - 空応答時に診断情報（`status` / `incomplete_details` / `output_items`）を出力。
- 対象:
  - `src/infrastructure/provider/factory.ts`

## Fix 2: `verbosity` 引数の互換性エラー

- 症状:
  - `Responses.create() got an unexpected keyword argument 'verbosity'`
- 原因:
  - ローカルの `openai` SDK バージョンが `verbosity` に未対応。
- 修正:
  - `responses.create()` から `verbosity` 引数を削除。
- 対象:
  - `src/infrastructure/provider/factory.ts`

## Fix 3: JSON パース失敗（壊れた文字列）

- 症状:
  - `Unterminated string ...`
- 原因:
  - 応答から不要要素を混ぜて抽出し、JSON が壊れていた。
- 修正:
  - `message` の `output_text/text` のみを抽出対象に限定。
  - `json_schema(strict)` を優先し、失敗時は `json_object` にフォールバック。
  - JSON パース救済（`{...}` 再抽出）を追加。
- 対象:
  - `src/infrastructure/provider/factory.ts`

## Fix 4: Provider の不正 `task_updates` で停止

- 症状:
  - `provider_error: task is not waiting approval`
- 原因:
  - 承認待ちでないタスクに `plan_action` を適用しようとして例外停止。
- 修正:
  - `_apply_decision()` で状態妥当性を検証し、不正更新はスキップして継続。
- 対象:
  - `src/application/orchestrator/orchestrator.ts`

## Fix 5: Provider が実行状態を直接更新して進行が壊れる

- 症状:
  - `in_progress` / `completed` を Provider が直接設定し、状態機械と競合。
- 原因:
  - 実行状態更新責務が Teammate と Provider で衝突。
- 修正:
  - Provider からの `in_progress` / `completed` 更新を禁止（Teammate 管理に限定）。
- 対象:
  - `src/application/orchestrator/orchestrator.ts`

## Fix 6: Provider が `pending -> blocked` を作って詰む

- 症状:
  - 本来進めるタスクが `blocked` になり、再開できず `idle_rounds_limit` 停止。
- 原因:
  - Provider が不適切に `blocked` を付与可能だった。
- 修正:
  - `current.status != blocked` のタスクへの `blocked` 遷移を拒否。
- 対象:
  - `src/application/orchestrator/orchestrator.ts`

## Fix 7: 承認後に `owner` が残留し claim 不能

- 症状:
  - `plan` は承認済みでも `pending` タスクが claim されず停滞。
- 原因:
  - 承認遷移時に `owner` がクリアされず、未所有タスクとして扱えなかった。
- 修正:
  - `review_plan()` で `status=pending` に戻す際、`owner=None` を強制。
  - `pending` 更新時の `owner` 正規化も合わせて強化。
- 対象:
  - `src/infrastructure/state/store.ts`

## Fix 8: 承認更新が返らないと承認待ちで停滞

- 症状:
  - Provider が承認更新を返さない場合、`needs_approval` が残って進捗停止。
- 原因:
  - Provider 出力品質に依存しすぎていた。
- 修正:
  - `ORCHESTRATOR_AUTO_APPROVE_FALLBACK=1`（既定）を導入し、
    有効な承認更新がない場合は安全側で自動承認。
- 対象:
  - `src/application/orchestrator/orchestrator.ts`
  - `README.md`

## Fix 9: 失敗時に `provider_calls` が 0 表示

- 症状:
  - Provider 呼び出し失敗時に試行回数が結果に反映されない。
- 原因:
  - カウント更新が成功後に行われていた。
- 修正:
  - Provider 実行直前に `provider_calls` をインクリメント。
- 対象:
  - `src/application/orchestrator/orchestrator.ts`

## 回帰テスト追加

- 追加・更新テスト:
  - `src/application/orchestrator/orchestrator_test.ts`
  - `src/infrastructure/state/store_test.ts`
- 検証:
  - `deno task test` で全件成功。

# 変更提案: OpenAI Lead decision 出力を安定化する

## Why
`ORCHESTRATOR_PROVIDER=openai` 実行時に、Lead の decision 応答が `max_output_tokens` 超過で途中切れし、`provider_error`（invalid json）で停止する事象が継続している。  
この停止はタスク実装の成否と無関係に発生し、長時間実行の完走率を下げる。

## What Changes
- 既存の Lead decision JSON バリデーションを強化し、配列件数上限を追加する（文字列長上限は維持）。
- Lead へ渡す snapshot を軽量化する（`completed` タスク除外、`recent_messages` 件数削減）。
- 既存の incomplete 時リトライ挙動を調整し、`status=incomplete` かつ `reason=max_output_tokens` の場合にのみ1回だけ最小再問い合わせを行う。
- 再問い合わせでも JSON 契約を満たせない場合は fail-closed で停止し、診断情報を明示する。
- 上記挙動に対する単体テストと回帰テストを追加する。

## Impact
- 影響する仕様:
  - `orchestrator-openspec-run`（変更）
- 主な実装対象:
  - `src/application/orchestrator/orchestrator.ts`
  - `src/infrastructure/provider/factory.ts`
  - `src/domain/decision.ts`（必要時）
  - `src/application/orchestrator/orchestrator_test.ts`
  - `src/cli/main_test.ts`（必要時）
  - `README.md`

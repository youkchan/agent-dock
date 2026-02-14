# Change: Takt由来ペルソナ定義の移植

## Why
- `add-file-based-persona-catalog` で分離された default persona ファイル基盤は整備済みであり、次段として中身（実装時の注意事項）を `takt` 由来へそろえたい。
- ペルソナ定義の内容移植は基盤変更とは関心が異なるため、別 change として分離する。
- 既存ランタイムの読込互換を維持しつつ、実装・レビュー品質のガードレールを強化したい。

## Preconditions
- `add-file-based-persona-catalog` は完了済み（archive 済み）。
- TypeScript runtime で `personas/default/*.yaml` 読込が有効。

## What Changes
- default 4 persona（`implementer`, `code-reviewer`, `spec-checker`, `test-owner`）の `focus` は既存内容を保持したまま、`takt` 起点の実装注意事項を追記で統合する。
- 採用方針は 4 persona 共通で `focus` の加筆のみとし、`personas/default/*.yaml` の既存キーは変更しない。
- `focus` の意味統合方針は以下とする。
  - 既存 focus の意図（主語・対象・制約・禁止事項）を最優先で保持し、`takt` 由来情報は追記で補強する。
  - 意味重複・衝突がある場合は既存文言を削除せず、要件条件を明確化する形で言い換え統合する。
  - 置換ではなく「既存 focus + 追記（必要なら同義再表現）」のみを許可し、既存ガードレールの削除を禁止する。
  - 追記後の焦点文は、実装・レビュー・仕様確認・検証観点を網羅する 1 つ以上の観点文を持つことを確認する。
- 採用対象ファイルは以下で固定する（`codex_agent` ルート基準の相対パス）。
  - `implementer`: `../takt/builtins/ja/personas/coder.md`, `../takt/builtins/ja/instructions/implement.md`, `../takt/builtins/ja/instructions/ai-fix.md`
  - `code-reviewer`: `../takt/builtins/ja/personas/architecture-reviewer.md`, `../takt/builtins/ja/personas/ai-antipattern-reviewer.md`, `../takt/builtins/ja/policies/review.md`, `../takt/builtins/ja/instructions/review-arch.md`, `../takt/builtins/ja/instructions/review-qa.md`, `../takt/builtins/ja/instructions/review-ai.md`
  - `spec-checker`: `../takt/builtins/ja/personas/planner.md`
  - `test-owner`: `../takt/builtins/ja/personas/qa-reviewer.md`, `../takt/builtins/ja/personas/test-planner.md`, `../takt/builtins/ja/instructions/review-test.md`, `../takt/builtins/ja/instructions/implement-test.md`
- ランタイム互換維持のため、persona YAML のスキーマは既存互換を維持する（`id`, `role`, `focus`, `can_block`, `enabled`, optional `execution`）。
- 現行 persona loader 互換のため、YAML 表現は単純形式に限定する（トップレベルはスカラーのみ、`execution` のみ1段ネスト可）。`focus` は1行スカラーで記述し、複数行ブロックスカラー（`|`/`>`）、配列、2段以上のネストは使用しない。
- 参照する `takt` 情報は、`focus` の再構成・追加ルール（優先度・確認観点・禁止事項・実施条件）に限定し、既存の人格像 (`role`, `can_block`, `enabled`, `execution`) は維持する。
- 配布物整合のため、ソース定義 `personas/default/*.yaml` を更新し、配布物 `npm/personas/default/*.yaml` を同期更新する。

## Non-Goals
- runtime での新キー使用（`principles`, `do_not`, `checklist` 等）。
- persona loader のパーサ仕様変更。

## Impact
- Affected specs: `persona-catalog`
- Affected code:
  - `personas/default/*.yaml`
  - `npm/personas/default/*.yaml`
  - （必要時）対応テスト

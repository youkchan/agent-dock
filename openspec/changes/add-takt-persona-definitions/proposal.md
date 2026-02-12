# Change: Takt由来ペルソナ定義の移植

## Why
- `add-file-based-persona-catalog` で分離された default persona ファイル基盤は整備済みであり、次段として中身（実装時の注意事項）を `takt` 由来へそろえたい。
- ペルソナ定義の内容移植は基盤変更とは関心が異なるため、別 change として分離する。
- 既存ランタイムの読込互換を維持しつつ、実装・レビュー品質のガードレールを強化したい。

## Preconditions
- `add-file-based-persona-catalog` は完了済み（archive 済み）。
- TypeScript runtime で `team_orchestrator/personas/default/*.yaml` 読込が有効。

## What Changes
- default 4 persona（`implementer`, `code-reviewer`, `spec-checker`, `test-owner`）の `focus` は既存内容を保持しつつ、`takt` の persona/instruction/policy 由来の実装注意事項をマージする（置き換えしない）。
- コピー元の基準ファイルを以下に固定する（`codex_agent` ルート基準の相対パス）。
  - `implementer`: `../takt/builtins/ja/personas/coder.md`, `../takt/builtins/ja/instructions/implement.md`, `../takt/builtins/ja/instructions/ai-fix.md`
  - `code-reviewer`: `../takt/builtins/ja/personas/architecture-reviewer.md`, `../takt/builtins/ja/personas/ai-antipattern-reviewer.md`, `../takt/builtins/ja/policies/review.md`, `../takt/builtins/ja/instructions/review-arch.md`, `../takt/builtins/ja/instructions/review-qa.md`, `../takt/builtins/ja/instructions/review-ai.md`
  - `spec-checker`: `../takt/builtins/ja/personas/planner.md`
  - `test-owner`: `../takt/builtins/ja/personas/qa-reviewer.md`, `../takt/builtins/ja/personas/test-planner.md`, `../takt/builtins/ja/instructions/review-test.md`, `../takt/builtins/ja/instructions/implement-test.md`
- ランタイム互換維持のため、persona YAML のスキーマは既存互換を維持する（`id`, `role`, `focus`, `can_block`, `enabled`, optional `execution`）。
- 配布物整合のため、`team_orchestrator/personas/default/*.yaml` と `npm/team_orchestrator/personas/default/*.yaml` の両方を同期更新する。

## Non-Goals
- runtime での新キー使用（`principles`, `do_not`, `checklist` 等）。
- persona loader のパーサ仕様変更。

## Impact
- Affected specs: `persona-catalog`
- Affected code:
  - `team_orchestrator/personas/default/*.yaml`
  - `npm/team_orchestrator/personas/default/*.yaml`
  - （必要時）対応テスト

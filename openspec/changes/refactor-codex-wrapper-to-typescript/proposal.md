# 変更提案: codex_wrapper.sh を TypeScript 層と薄いシェル層に分離する

## 背景
現行の `codex_wrapper.sh` は 661 行あり、Bash の中に Python と awk が埋め込まれている。
責務が混在しており、テストが困難で可読性も低い。

TypeScript 移行（`add-typescript-runtime-rewrite-plan`）に伴い、wrapper のロジック部分を TypeScript に移行し、シェルは codex exec の実行に特化した薄いラッパーに整理する。

## 変更内容（この change のスコープ）
- `codex_wrapper.sh` の責務を分析し、TypeScript に移行する部分とシェルに残す部分を定義する。
- TypeScript 層（`src/infrastructure/adapter/codex/`）の責務と I/O 契約を定義する。
- 薄いシェル層（`codex_executor.sh`）の責務と I/O 契約を定義する。
- 2 層間のインターフェース（プロンプト文字列 + 設定 JSON）を定義する。

## この change でやらないこと
- 実際の TypeScript 実装（別 change で実施）
- 既存の `codex_wrapper.sh` の即時削除
- codex CLI 自体の変更

## 期待成果
- wrapper のロジック部分が TypeScript で単体テスト可能になる。
- シェル層が薄くなり、可読性・保守性が向上する。
- 責務が明確に分離され、将来の拡張が容易になる。

## 影響範囲
- 影響する仕様:
  - `codex-wrapper`（ADDED）
- 依存する change:
  - `add-typescript-runtime-rewrite-plan`（技術選定に従う）

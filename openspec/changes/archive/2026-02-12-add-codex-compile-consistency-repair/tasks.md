## 1. 実装タスク
- [x] 1.1 Codex 整合性レビュー用インターフェースを追加する
  - 成果物: OpenSpec change + compiled payload を受けるレビュークライアント
- [x] 1.2 内部整合性チェックを強化する
  - 成果物: 依存未解決/循環/型不一致の fail-closed 検証
- [x] 1.3 `compile-openspec` へ検証段を統合する
  - 成果物: コンパイル -> 検証 -> 再バリデーションの実行順
- [x] 1.4 外部コマンド依存を削除する
  - 成果物: 外部整合性レビュー関連の設定/CLI オプションの除去
- [x] 1.5 監査情報出力を内部検証ベースに統一する
  - 成果物: 外部レビュー依存の `meta` 記述を除去
- [x] 1.6 テストを追加する
  - 成果物: 内部整合性検証とフェーズ担当必須化のテスト
- [x] 1.7 README を更新する
  - 成果物: 利用手順、失敗時挙動（内部チェック前提）
- [x] 1.8 フェーズ担当必須バリデーションを追加する
  - 成果物: 各タスクに `フェーズ担当` / `phase assignments`（`persona_policy.phase_overrides`）がない場合の compile 失敗

## 2. 検証項目
- [x] `python -m unittest discover -s tests -v` が通る
- [x] 依存未解決・循環依存・型不一致がコンパイル失敗になる
- [x] 外部コマンド設定なしで `compile-openspec` が実行できる
- [x] `tasks.md` のいずれかのタスクで `フェーズ担当` / `phase assignments` が欠落すると compile が失敗する

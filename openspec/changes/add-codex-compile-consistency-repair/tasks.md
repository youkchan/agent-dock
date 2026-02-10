## 1. 実装タスク
- [x] 1.1 Codex 整合性レビュー用インターフェースを追加する
  - 成果物: OpenSpec change + compiled payload を受けるレビュークライアント
- [ ] 1.2 Codex 応答スキーマ検証と patch 適用ロジックを実装する
  - 成果物: `tasks_append` / `tasks_update` / `teammates` の安全適用
- [x] 1.3 `compile-openspec` へレビュー段を統合する
  - 成果物: コンパイル後レビュー -> 補正 -> 再バリデーションの実行順
- [ ] 1.4 CLI オプションを追加する
  - 成果物: `--skip-codex-consistency`, `--codex-consistency-command`
- [ ] 1.5 メタ情報出力を追加する
  - 成果物: `meta.codex_consistency.*` の出力
- [ ] 1.6 テストを追加する
  - 成果物: 整合/不整合補正/不正 patch/コマンド失敗/フェーズ担当必須化のテスト
- [ ] 1.7 README を更新する
  - 成果物: 利用手順、無効化方法、失敗時挙動
- [ ] 1.8 フェーズ担当必須バリデーションを追加する
  - 成果物: 各タスクに `フェーズ担当` / `phase assignments`（`persona_policy.phase_overrides`）がない場合の compile 失敗

## 2. 検証項目
- [ ] `python -m unittest discover -s tests -v` が通る
- [ ] 不整合を返す Codex 応答で `task_config` が補正される
- [ ] 不正 patch はコンパイル失敗になる
- [ ] `--skip-codex-consistency` で既存挙動互換になる
- [ ] `tasks.md` のいずれかのタスクで `フェーズ担当` / `phase assignments` が欠落すると compile が失敗する

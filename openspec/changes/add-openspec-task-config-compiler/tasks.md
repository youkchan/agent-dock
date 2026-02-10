## 1. 実装タスク
- [x] T-001 変換ルール定義を作成する（`requires_plan=true`）
  - 依存: なし
  - 成果物: OpenSpec 変更から task エンティティへ落とし込む規則、`depends_on` 解決方針、エラー規則
- [x] T-002 `changes/*` 全読込パーサを実装する
  - 依存: `T-001`
  - 成果物: `openspec/changes/<change-id>/` の必須ファイル読込、基本バリデーション
- [x] T-003 `overrides/<change_id>.yaml` マージを実装する
  - 依存: `T-001`, `T-002`
  - 成果物: 既定値・コンパイル結果へ上書き適用、衝突時の優先順位定義
- [x] T-004 `compile-openspec` CLI を追加する
  - 依存: `T-002`, `T-003`
  - 成果物: `task_configs/<change-id>.json` 生成コマンド、失敗時の明確なエラーメッセージ
- [x] T-005 `run --openspec-change` 連携を実装する
  - 依存: `T-004`
  - 成果物: 実行前コンパイルまたは既存生成物読込、`--config` との排他制御
- [x] T-006 テストと README を更新する
  - 依存: `T-004`, `T-005`
  - 成果物: パーサ/マージ/CLI/統合導線のテスト、利用手順ドキュメント

## 2. 検証項目
- [x] `python -m unittest discover -s tests -v` が通る
- [x] `python -m team_orchestrator.cli compile-openspec --change-id <id>` で JSON が生成される
- [x] `python -m team_orchestrator.cli run --openspec-change <id>` で実行開始できる

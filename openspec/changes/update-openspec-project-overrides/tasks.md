## 1. 実装タスク
- [ ] 1.1 project override の読込仕様を確定する
  - 成果物: 読込場所、存在しない場合の挙動、マージ優先順位の明文化
- [ ] 1.2 コンパイラの override 読込を `project.yaml` 固定へ変更する
  - 成果物: `task_configs/overrides/project.yaml` の存在時のみ読み込み
- [ ] 1.3 `change-id` 個別 override の読込経路を削除する
  - 成果物: `<change-id>.yaml` を参照しない実装
- [ ] 1.4 テストを更新する
  - 成果物: project override あり/なし、旧 override が無視されるケースのテスト
- [ ] 1.5 README を更新する
  - 成果物: 運用例とマイグレーション手順の追記

## 2. 検証項目
- [ ] `python -m unittest discover -s tests -v` が通る
- [ ] `project.yaml` ありで override が適用される
- [ ] `project.yaml` なしでコンパイルが成功する
- [ ] `<change-id>.yaml` が存在してもコンパイル結果に影響しない

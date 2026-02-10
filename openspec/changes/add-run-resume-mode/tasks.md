## 1. 実装タスク
- [ ] 1.1 `run --resume` オプションを追加する
  - 成果物: CLI 引数定義と起動モード分岐
- [ ] 1.2 state の再開可否判定を実装する
  - 成果物: 既存 state 有無、タスク存在有無、初期投入判定
- [ ] 1.3 `--resume` 時の task_config 整合性チェックを追加する
  - 成果物: task id 集合と主要属性の不一致検出、明確なエラー
- [ ] 1.4 起動ログへ run モードを出力する
  - 成果物: `new-run` / `resume-run` の表示
- [ ] 1.5 Teammate 実行途中ログの逐次保存を実装する
  - 成果物: タスク単位 progress log の追記保存、再開時の参照導線
- [ ] 1.6 テストを追加する
  - 成果物: 新規実行、正常再開、不一致エラー、途中ログ保持のテスト
- [ ] 1.7 README を更新する
  - 成果物: `--resume` と progress log の使い方、注意事項

## 2. 検証項目
- [ ] `python -m unittest tests/test_cli.py -v` が通る
- [ ] `--resume` なしでは従来どおり再初期化される
- [ ] `--resume` ありで completed/blocked 状態を保持して再開できる
- [ ] `--resume` ありで task_config 不一致時は失敗する
- [ ] 実行途中ログが state に逐次保存され、再開後も失われない

## 1. 実装タスク
- [x] 1.1 OpenSpec テンプレート文字列（ja/en）を定義する
  - 成果物: compile-openspec 互換の固定雛形
- [x] 1.2 CLI サブコマンドを追加する
  - 成果物: `print-openspec-template --lang ja|en`
- [x] 1.3 フェーズ固定文言をテンプレートへ追加する
  - 成果物: `persona_defaults.phase_order` と `フェーズ担当/phase assignments` の固定行
- [x] 1.4 テンプレートの compile 互換テストを追加する
  - 成果物: 出力テンプレートを parser に通した単体テスト
- [x] 1.5 README を更新する
  - 成果物: 利用例と推奨フローの追記
- [x] 1.6 未対応言語指定のエラーテストを追加する
  - 成果物: `--lang fr` など未対応値で失敗し、許可値を示すテスト

## 2. 検証項目
- [x] `python -m team_orchestrator.cli print-openspec-template --lang ja` で日本語テンプレートが出る
- [x] `python -m team_orchestrator.cli print-openspec-template --lang en` で英語テンプレートが出る
- [x] テンプレートに `persona_defaults.phase_order` と `フェーズ担当/phase assignments` が含まれる
- [x] テンプレートから作成した `tasks.md` を `compile-openspec` でコンパイルできる
- [x] `python -m team_orchestrator.cli print-openspec-template --lang fr` で失敗し、許可値（`ja`, `en`）が表示される

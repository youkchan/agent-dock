## 1. 実装タスク（Phase 1: 分離のみ）
- [ ] 1.1 デフォルトペルソナ YAML を新設する
  - 成果物: `team_orchestrator/personas/default/*.yaml` に4ペルソナ
- [ ] 1.2 `persona_catalog.py` のデフォルト読込をファイル化する
  - 成果物: コード直書き定義を廃止し、ファイル読込へ移行
- [ ] 1.3 project payload の上書き/追加互換を維持する
  - 成果物: 同名完全上書き・非同名追加の互換動作
- [ ] 1.4 execution profile 互換を維持する
  - 成果物: `execution` の読込/未指定時挙動を既存どおり維持
- [ ] 1.5 バリデーションとエラーを整備する
  - 成果物: 欠落/重複/未知キー/型不一致の明示エラー（execution 含む）
- [ ] 1.6 テストを更新する
  - 成果物: デフォルト読込・上書き互換・異常系の回帰テスト
- [ ] 1.7 README を更新する
  - 成果物: ペルソナ定義の配置と上書き順序の説明

## 2. フォローアップ（別 change）
- [ ] 2.1 `principles` / `do_not` / `checklist` の追加設計
- [ ] 2.2 `persona_pipeline` での活用可否判断

## 3. 検証項目
- [ ] `python -m unittest discover -s tests -v` が通る
- [ ] デフォルト4ペルソナがファイルから読まれる
- [ ] project payload で同名 `id` が完全上書きされる
- [ ] `execution` 指定あり/なしの両ケースで読込互換が維持される
- [ ] `personas` 未指定時の teammates fallback 挙動が変わらない

## 1. 実装タスク
- [ ] 1.1 OpenSpec 文脈ローダーを追加する
  - 依存: なし
  - 成果物: `proposal.md` / `tasks.md` / `specs/**/spec.md` を収集し、実行用コンテキストへ正規化する処理
- [ ] 1.2 run の事前検証に OpenSpec 解決を組み込む
  - 依存: `1.1`
  - 成果物: `--openspec-change` または `--config.meta.source_change_id` から change を解決し、失敗時は開始拒否
- [ ] 1.3 タスク配布プロンプトへ OpenSpec 要点を同梱する
  - 依存: `1.1`, `1.2`
  - 成果物: 要求/シナリオ/検証観点の要約を各タスク prompt に常時付与
- [ ] 1.4 SPEC_ACK 必須化を実装する
  - 依存: `1.3`
  - 成果物: 実行者応答に `SPEC_ACK` が無い場合は `blocked` または差し戻し扱い
- [ ] 1.5 SPEC_COVERAGE 必須化を実装する
  - 依存: `1.3`
  - 成果物: 完了報告に満たした要件/シナリオを含め、欠落時は completed 扱いにしない
- [ ] 1.6 テストと README を更新する
  - 依存: `1.2`, `1.4`, `1.5`
  - 成果物: 単体/統合テスト追加、実行フローと失敗ケースを README に追記

## 2. 検証項目
- [ ] `python -m unittest discover -s tests -v` が通る
- [ ] `python -m team_orchestrator.cli run --openspec-change <id> ...` で OpenSpec 文脈が task prompt に含まれる
- [ ] `python -m team_orchestrator.cli run --config <json>` で `meta.source_change_id` が無い場合は開始拒否される
- [ ] `SPEC_ACK` 欠落時にタスクが completed にならない
- [ ] `SPEC_COVERAGE` 欠落時にタスクが completed にならない

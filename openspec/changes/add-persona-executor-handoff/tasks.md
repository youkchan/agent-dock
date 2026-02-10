## 1. 実装タスク
- [ ] 1.1 task_config スキーマを拡張する
  - 成果物: `personas`, `persona_defaults`, `tasks[].persona_policy` の受理
- [ ] 1.2 persona 実行主体モードを追加する
  - 成果物: claim/owner を persona_id ベースで実行できる
- [ ] 1.3 フェーズ単位ハンドオフを実装する
  - 成果物: `phase_order` と `phase_policies` に従う実行制御
- [ ] 1.4 複数ペルソナ意見 + 遷移権限分離を実装する
  - 成果物: `active_personas` と `state_transition_personas` の別制御
- [ ] 1.5 OpenSpec compiler を拡張する
  - 成果物: OpenSpec 指定（利用/非利用、フェーズ担当）を task_config へ出力
- [ ] 1.6 互換フォールバックを実装する
  - 成果物: `personas` 未指定時は既存 `teammates` 実行を維持
- [ ] 1.7 テストを追加する
  - 成果物: persona実行、複数参加、disable、互換fallback、不正設定失敗
- [ ] 1.8 README/運用手順を更新する
  - 成果物: 設定例、フェーズ設計、移行手順、制約の明記

## 2. 検証項目
- [ ] `python -m unittest discover -s tests -v` が通る
- [ ] implement フェーズで implementer が実行主体として動作する
- [ ] review フェーズで reviewer が実行主体として動作する
- [ ] 同一フェーズで複数ペルソナがコメントできる
- [ ] `disable_personas` 指定が実行/評価の両方に反映される
- [ ] OpenSpec 指定のペルソナ方針が task_config へ反映される
- [ ] personas 未指定時に既存 teammates 実行へフォールバックする

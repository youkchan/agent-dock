## 1. Source Mapping
- [ ] 1.1 `takt` のコピー元ファイルを確定し、4 persona ごとの移植対象ルールを整理する
- [ ] 1.2 移植対象を `focus` へ要約する際に、意味欠落がないことを確認する

## 2. Persona Definition Update
- [ ] 2.1 `team_orchestrator/personas/default/implementer.yaml` の `focus` を既存内容にマージする
- [ ] 2.2 `team_orchestrator/personas/default/code-reviewer.yaml` の `focus` を既存内容にマージする
- [ ] 2.3 `team_orchestrator/personas/default/spec-checker.yaml` の `focus` を既存内容にマージする
- [ ] 2.4 `team_orchestrator/personas/default/test-owner.yaml` の `focus` を既存内容にマージする
- [ ] 2.5 `npm/team_orchestrator/personas/default/*.yaml` を同内容へ同期する

## 3. Compatibility Guard
- [ ] 3.1 既存スキーマ（`id`, `role`, `focus`, `can_block`, `enabled`, optional `execution`）以外のキーを追加しない
- [ ] 3.2 default persona の読込テストを実行し、未知キーエラーや型エラーが発生しないことを確認する

## 4. Validation
- [ ] 4.1 `openspec validate add-takt-persona-definitions --strict` を実行し成功させる

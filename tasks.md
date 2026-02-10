## Thin Orchestrator 移行タスク

- [x] 1. Thin Orchestrator 仕様書を追加（`docs/thin_orchestrator_spec.md`）
- [x] 2. Provider 抽象化（`OrchestratorProvider`）と切替ファクトリを導入
- [x] 3. `MockProvider` と `OpenAIProvider`（Responses API）を実装
- [x] 4. 厳格な decision JSON スキーマ検証と安全停止動作を実装
- [x] 5. オーケストレーターの呼び出しをイベント駆動のみに移行
- [x] 6. タスク状態 `blocked` と `needs_approval` を追加
- [x] 7. `approve / reject / revise` の plan 遷移を強制
- [x] 8. `target_paths` ベースの衝突検知を追加
- [x] 9. snapshot 専用コンテキスト（生ログ非転送）を追加
- [x] 10. `HUMAN_APPROVAL=1` の停止待機モードを追加
- [x] 11. Teammate 側の Codex subprocess 実行フローを維持
- [x] 12. Provider とトークン上限の CLI/設定面を更新
- [x] 13. Provider 切替と承認ゲートのテストを拡張
- [x] 14. Thin Orchestrator 運用・費用制御に合わせて README を更新

## 次フェーズ（未対応）

- [ ] 15. `claude` Provider プラグインを実装
- [ ] 16. `gemini` Provider プラグインを実装
- [ ] 17. `HUMAN_APPROVAL=1` 停止後に再開する手動承認コマンドを追加
- [ ] 18. `ORCHESTRATOR_PROVIDER=openai` の CI 安全な統合テストを追加

## Future Task（plan / execute 分離）

- [ ] 19. `TEAMMATE_PLAN_COMMAND` / `TEAMMATE_EXECUTE_COMMAND` を標準運用として README に明記
- [ ] 20. `plan` 用プロンプト最適化（短文・低コスト・要約中心）をテンプレート化
- [ ] 21. `execute` 用プロンプト最適化（編集・テスト・結果報告）をテンプレート化
- [ ] 22. `plan` と `execute` で別モデル/別トークン上限を設定できる環境変数を追加
- [ ] 23. `execute` のみ厳格 sandbox/approval を有効化する運用ガイドを追加
- [ ] 24. `plan` 失敗と `execute` 失敗を分離して集計するメトリクスを追加

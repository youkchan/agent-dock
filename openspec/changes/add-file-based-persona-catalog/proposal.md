# 変更提案: ペルソナ定義を独立ファイル化する（Phase 1）

## 背景
現状の `team_orchestrator/persona_catalog.py` はデフォルト4ペルソナをコード内に直接保持しているため、内容更新やレビューがコード変更に密結合している。
さらに `add-persona-executor-handoff` で「ペルソナが実行主体になれる」前提が入ったため、カタログ定義は実行プロファイル互換を保ったまま運用可能である必要がある。
ペルソナを詳細化していく前に、まず定義をファイル分離し、運用しやすい土台を作る必要がある。

## 変更内容（この change のスコープ）
- `personas/default/*.yaml` を新設し、デフォルト4ペルソナを独立ファイルへ移す。
- `persona_catalog.py` はファイル読込を行う形へ変更する。
- 既存の project payload (`personas[]`) による上書き・追加ルールは維持する（同名 `id` は完全上書き）。
- 既存の実行挙動（`id/role/focus/can_block/enabled` と `execution`）を互換維持する。
- `add-persona-executor-handoff` で導入された persona 実行主体・フェーズ制御の挙動は変更しない。

## この change でやらないこと
- ペルソナへの詳細フィールド（`principles`, `do_not`, `checklist`）追加
- `persona_pipeline` のコメント生成への詳細フィールド反映
- executor handoff ロジック自体の仕様変更（`phase_order` / `phase_policies` / `persona_policy` の意味変更）

## 次フェーズ（別 change で実施）
1. ペルソナ詳細化（`principles` / `do_not` / `checklist` の導入）
2. 必要に応じた runtime 反映（`focus` / `checklist` をコメント生成へ反映）

## 影響範囲
- 影響する仕様:
  - `persona-catalog`（MODIFIED/ADDED）
- 想定実装対象:
  - `team_orchestrator/persona_catalog.py`
  - 新規 `team_orchestrator/personas/default/*.yaml`
  - `tests/test_cli.py` などのペルソナ読込テスト
  - `tests/test_orchestrator.py`（persona executor fallback 互換確認）
  - `README.md` の設定説明

# 変更提案: ペルソナ定義を独立ファイル化する（Phase 1）

## 背景
現状の `team_orchestrator/persona_catalog.py` はデフォルト4ペルソナをコード内に直接保持しているため、内容更新やレビューがコード変更に密結合している。
ペルソナを詳細化していく前に、まず定義をファイル分離し、運用しやすい土台を作る必要がある。

## 変更内容（この change のスコープ）
- `personas/default/*.yaml` を新設し、デフォルト4ペルソナを独立ファイルへ移す。
- `persona_catalog.py` はファイル読込を行う形へ変更する。
- 既存の project payload (`personas[]`) による上書き・追加ルールは維持する（同名 `id` は完全上書き）。
- 既存の実行挙動（`id/role/focus/can_block/enabled` の利用）を互換維持する。

## この change でやらないこと
- ペルソナへの詳細フィールド（`principles`, `do_not`, `checklist`）追加
- `persona_pipeline` のコメント生成への詳細フィールド反映

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
  - `README.md` の設定説明

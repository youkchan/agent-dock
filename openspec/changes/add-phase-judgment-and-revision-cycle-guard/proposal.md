# 変更提案: フェーズ判定3値化と差し戻しサイクル上限の導入

## 変更理由
review/spec_check が修正実行と判定を同時に担うため、`changes_required` の指摘後も同一フェーズが自分で修正を継続し、役割分離が崩れる。
実装と判定の責務を分離し、差し戻しサイクルに上限を設けることで、自己修正ループと無限再試行を防止する。

## 変更内容
- implement フェーズのみをコード編集可能フェーズとして扱う。
- review/spec_check/test フェーズは判定のみを行い、判定結果を `pass | changes_required | blocked` の3値に統一する。
- 判定が `changes_required` の場合は必ず implement へ差し戻し、`status=pending`、`owner=null`、`current_phase_index=implement` を適用する。
- 差し戻し理由を progress log と mailbox に保存し、判定フェーズの実行主体は続行実行しない。
- 判定が `pass` の場合のみ次フェーズへ handoff する。
- 判定が `blocked` の場合は既存どおり blocked 遷移を維持する。
- `revision_count` と `max_revision_cycles` を state 管理し、`revision_count > max_revision_cycles` で `needs_approval` へ遷移する。
- persona 実行モードにのみ上記挙動を適用し、既存 teammate 実行モードの挙動は変更しない。

## 非目標
- Lead の意思決定 JSON 形式の変更
- 既存 task config フォーマットの全面変更
- provider 切替ロジックの変更

## 影響範囲
- 影響する仕様: `add-phase-judgment-and-revision-cycle-guard`（ADDED）
- 主な実装対象: `team_orchestrator/models.py`, `team_orchestrator/orchestrator.py`, `team_orchestrator/state_store.py`
- 主な検証対象: `tests/test_orchestrator.py`, `tests/test_state_store.py`
- 互換性: teammate 実行モード（persona でない経路）は現状維持

# 変更提案: フェーズ判定3値化と差し戻しサイクル上限の導入

## 変更理由
review/spec_check が修正実行と判定を同時に担うため、`changes_required` の指摘後も同一フェーズが自分で修正を継続し、役割分離が崩れる。
実装と判定の責務を分離し、差し戻しサイクルに上限を設けることで、自己修正ループと無限再試行を防止する。

## 変更内容
- implement フェーズのみをコード編集可能フェーズとして扱う。
- persona 実行設定の既定を implement=`workspace-write`、review/spec_check/test=`read-only` に分離する。
- review/spec_check/test フェーズは判定のみを行い、判定結果を `pass | changes_required | blocked` の3値に統一する。
- review/spec_check/test フェーズで `CHANGED_FILES` が非空の場合は、編集違反として `blocked` へ遷移する（fail-closed）。
- `CHANGED_FILES` の空表現は `CHANGED_FILES: (none)` を正規値とし、互換のため `none` / `-` / 空文字も空として正規化する。
- 判定フェーズ（review/spec_check/test）の最終出力に `JUDGMENT: pass|changes_required|blocked` を必須化し、未定義値や欠落は `blocked` として扱う。
- 判定フェーズでは `RESULT` と `JUDGMENT` の優先順位を `RESULT=blocked` > `JUDGMENT` とし、矛盾時は `blocked` へ倒す。
- wrapper 出力契約は互換拡張とし、implement は既存4行（`RESULT/SUMMARY/CHANGED_FILES/CHECKS`）を維持しつつ、review/spec_check/test は `JUDGMENT` 行を必須追加する。
- 判定が `changes_required` の場合は必ず implement へ差し戻し、`status=pending`、`owner=null`、`current_phase_index=implement` を適用する。
- 差し戻し理由を progress log と mailbox に保存し、判定フェーズの実行主体は続行実行しない。
- 判定が `pass` の場合は `phase_order` に従って前進し、次フェーズがある場合は handoff、ない場合は `completed` へ遷移する。
- 判定が `blocked` の場合は既存どおり blocked 遷移を維持する。
- `revision_count` の初期値は task 作成時に `0` とし、`changes_required` 差し戻し時のみ `+1` する。
- `max_revision_cycles` は task 単位の非負整数設定とし、未設定時は `3` を既定値として補完する。不正値は compile で reject する。
- `revision_count` は task が `completed` または `blocked` へ終端遷移するまで保持し、途中の `pass` ではリセットしない。
- `--resume` 実行時は保存済み `revision_count` を保持し、再初期化しない。
- `revision_count > max_revision_cycles`（`>=` ではない）で `needs_approval` へ遷移する。
- `changes_required` 差し戻し時の戻し先 implement は、当該 task の `phase_order` から `implement` の index を検索して設定する。`implement` が存在しない構成は compile 時にエラーとして reject する。
- persona の `execution.sandbox` は実行時に強制反映し、implement=`workspace-write`、review/spec_check/test=`read-only` が実行コマンドへ適用される。
- persona 実行モードにのみ上記挙動を適用し、既存 teammate 実行モードの挙動は変更しない。

## 非目標
- Lead の意思決定 JSON 形式の変更
- 既存 task config フォーマットの全面変更
- provider 切替ロジックの変更

## 影響範囲
- 影響する仕様: `add-phase-judgment-and-revision-cycle-guard`（ADDED）, `runtime-platform-migration`（MODIFIED）
- 主な実装対象: `src/domain/task.ts`, `src/domain/decision.ts`, `src/application/orchestrator/orchestrator.ts`, `src/infrastructure/state/store.ts`, `src/cli/main.ts`, `src/infrastructure/adapter/subprocess.ts`, `src/infrastructure/wrapper/helper.ts`, `docs/ts-wrapper-contract.md`
- 主な検証対象: `src/application/orchestrator/orchestrator_test.ts`, `src/infrastructure/state/store_test.ts`, `src/infrastructure/wrapper/helper_test.ts`, `src/cli/main_test.ts`, `src/infrastructure/adapter/subprocess_test.ts`
- 対象ランタイム: TypeScript 実装（`src/**`）のみ。本 change では Python 実装（`team_orchestrator/**`）は変更対象外
- 互換性: teammate 実行モード（persona でない経路）は現状維持

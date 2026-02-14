## MODIFIED Requirements

### Requirement: codex wrapper の内部ヘルパは Deno に移行すること
システムは `codex_wrapper.sh` の外部契約を維持したまま、埋め込み `python3` 処理を Deno helper に移行しなければならない（SHALL）。

#### Scenario: wrapper の外部挙動を維持したまま内部実装を移行する
- **WHEN** TypeScript 移行で wrapper 内部実装を更新する
- **THEN** prompt 生成 / `.env` スナップショット検証 / 結果ブロック抽出は Deno helper で実行される
- **AND** wrapper の入力契約（stdin JSON: `mode`, `teammate_id`, `task`）は維持される
- **AND** implement フェーズの出力契約は既存どおり `RESULT` / `SUMMARY` / `CHANGED_FILES` / `CHECKS` の4行を維持する
- **AND** review/spec_check/test フェーズの出力契約は `RESULT` / `SUMMARY` / `CHANGED_FILES` / `CHECKS` / `JUDGMENT` の5行とする
- **AND** `JUDGMENT` は `pass|changes_required|blocked` の3値へ正規化して扱う
- **AND** `CHANGED_FILES` の変更なし表現は `(none)` を正規値とし、互換入力 `none` / `-` / 空文字は空として正規化する

#### Scenario: 判定フェーズの JUDGMENT 欠落は fail-closed で扱う
- **WHEN** review/spec_check/test フェーズの結果ブロックに `JUDGMENT` が存在しない
- **THEN** helper または orchestrator は fail-closed で `blocked` として扱う
- **AND** `JUDGMENT` が未知値の場合も fail-closed で `blocked` として扱う
- **AND** 判定入力の曖昧解釈は行わない

#### Scenario: 判定フェーズで RESULT と JUDGMENT が矛盾した場合は blocked を優先する
- **WHEN** review/spec_check/test フェーズで `RESULT: blocked` かつ `JUDGMENT: pass` が返る
- **THEN** helper または orchestrator は `blocked` として扱う
- **AND** 判定結果は `pass` へ緩和しない

#### Scenario: wrapper 実行時のランタイム前提を Deno に統一する
- **WHEN** `codex_wrapper.sh` を実行する
- **THEN** wrapper は `deno` を必須前提として起動する
- **AND** wrapper 経路では `python3` 前提を要求しない

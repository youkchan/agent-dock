# Change: spec-creator polish の処理範囲と挙動固定

## Why
- `requirements_text` と `non_goals` が重複し、polish の実装境界が曖昧だった。
- change 配下以外への誤編集と、非Markdownへの破壊的変更リスクを防ぐ必要がある。

## What Changes
- コマンドを `agent-dock spec-creator polish --change-id <id>` に固定する。
- `--change-id` を必須にし、`openspec/changes/<change-id>/` が存在しない場合は fail-closed で即時エラーにする。
- 処理対象を `openspec/changes/<change-id>/` 配下の全ファイル再帰走査に固定する。
- Markdown (`*.md`) は整形・不足固定行補完・見出し正規化を適用する。
- 非Markdown (`yaml/json` 等) は内容無変更を原則とし、整合チェックと必要時の警告出力のみを行う。
- 実行結果の必須出力を以下に固定する。
  - 対象総ファイル数
  - 変更ファイル一覧
  - 整備ルール別の適用件数
- 受け入れ条件を以下に固定する。
  - 非存在 `change-id` で失敗
  - 既存 change に対し実行後 `compile-openspec` が通る
  - 再実行で差分ゼロ（idempotent）
  - 非Markdownファイルは無変更

## Impact
- Affected specs: `spec-creator`
- Affected code:
  - `spec-creator polish` の引数検証
  - change 配下の再帰走査
  - Markdown 整備処理
  - 非Markdown整合チェックと警告出力
  - 実行結果サマリ生成

## Non-Goals
- 非Markdownファイルの自動修復や内容書き換え
- `openspec/changes/<change-id>/` 外のファイルを polish 対象にすること
- `compile-openspec` 自体の仕様変更

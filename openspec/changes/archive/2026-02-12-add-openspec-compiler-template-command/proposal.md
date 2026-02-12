# 変更提案: compile-openspec 互換テンプレート出力コマンドを追加する

## 背景
`compile-openspec` は `tasks.md` の行形式に依存して解析するため、自由形式で OpenSpec を書くとコンパイルに失敗することがある。
このため、最初からコンパイラ互換の固定テンプレートを出力し、その形式に沿って記述できる導線が必要。

## 変更内容
- `team_orchestrator.cli` に OpenSpec テンプレート専用コマンドを追加する。
- コマンドは「形式のみ」を出力し、内容生成や自動補完は行わない。
- 出力言語を `ja` / `en` で切り替え可能にする。
- 出力テンプレートは `compile-openspec` が読み取れるキー/見出し/箇条書き形式に固定する。
- 出力テンプレートにはフェーズ明示の固定文言（`persona_defaults.phase_order` と `フェーズ担当/phase assignments`）を必ず含める。
- README に運用手順（テンプレート取得 -> 内容記入 -> compile-openspec 実行）を追記する。

## 目的
OpenSpec 記述時のフォーマット揺れを削減し、`compile-openspec` での失敗率を下げる。

## 影響範囲
- 影響する仕様:
  - `openspec-template-command`（新規）
- 想定実装対象:
  - `team_orchestrator/cli.py`
  - 新規テンプレート生成モジュール
  - `tests/test_cli.py` ほか関連テスト
  - `README.md`

# 変更提案: ペルソナ品質ゲートの導入

## 背景
現在の `codex_agent` は、`requires_plan`、`depends_on`、承認ゲート、イベント駆動、OpenSpec 連携まで実装され、実行オーケストレーションの骨格は整っている。
一方で Teammate は ID ベースのため、実装・レビュー・仕様適合性確認・テスト観点が混在しやすく、仕様逸脱やレビュー観点漏れが後段で発覚しやすい。

## 変更内容
- デフォルト4ペルソナ（実装者、コードレビュワー、仕様確認者、テスト担当）を導入する。
- プロジェクト固有のカスタムペルソナを追加可能にする。
- 同名ペルソナ衝突時は「完全上書き」を採用し、プロジェクト定義を100%優先する。
- 1イベントあたりのコメント上限デフォルトを2件に設定し、ノイズを抑制する。
- 重大度ごとの統一挙動を導入する:
  - `info`: ログ記録のみ
  - `warn`: 次ラウンドで再確認
  - `critical`: `needs_approval` に遷移
  - `blocker`: `can_block=true` のペルソナのみ即停止（`stop_reason=persona_blocker:<persona_id>`）
- 指摘・停止の運用最適化に必要な計測情報を残せるよう、イベントログ/結果サマリ出力を拡張する。

## 目的
人格表現の高度化ではなく、観点責務の分離と品質ゲートの早期化を行う。
実行中の指摘・牽制・仕様整合チェックを基盤に組み込み、チーム開発に近いフィードバックループを再現する。

## 影響範囲
- 影響する仕様:
  - `persona-catalog`（新規）
  - `persona-gate-engine`（新規）
- 想定実装対象:
  - `team_orchestrator/orchestrator.py`
  - `team_orchestrator/models.py`
  - `team_orchestrator/cli.py`
  - 新規 `team_orchestrator/persona_*.py` モジュール
  - `tests/` の単体/統合テスト
  - `README.md` の運用手順

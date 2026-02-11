# 変更提案: ランタイムを TypeScript へ段階移行する

## 背景
現行ランタイムは Python 実装で、責務は明確に分離されている一方、将来的な Deno/TypeScript エコシステム統合（CLI 配布、型共有、周辺ツール接続）を見据えると TypeScript 実装への移行価値が高い。
ただし本プロジェクトは状態管理・OpenSpec コンパイル・実行制御が密接に連動しており、単純な全面置換は回帰リスクが高い。

## 変更内容（この change のスコープ）
- Python 実装を参照実装（source of truth）として固定し、TypeScript 移行の仕様・段階計画・受け入れ基準を定義する。
- 既存機能の同等性を検証するための「互換性ゲート（parity gate）」を仕様化する。
- TypeScript 側のあるべき全体構成（レイヤ分割・責務境界・互換要件）を定義する。
- 既存の `agent-dock` 運用フローを壊さない移行・ロールバック方針を定義する。
- 上記定義に基づき、この change 内で段階移行の実装（TS 実装追加、parity 検証、切替）まで実施する。
- 互換判定の曖昧さを排除するため、以下を固定する:
  - CLI 互換対象サブコマンド/主要オプション
  - `state.json` 互換対象フィールドと非互換時の fail-closed 条件
  - OpenSpec compile parity の比較対象フィールドと正規化ルール
  - parity gate の合格条件と移行完了条件
- `codex_wrapper.sh` は実行経路を維持し、内部の埋め込み `python3` を Deno helper 呼び出しに置換する。
- wrapper の I/O 契約（stdin payload / 4行結果 / stderr 進捗）を維持する。
- `CODEX_STREAM_VIEW=all|all_compact|assistant|thinking` の表示契約を維持する。
- `.env/.env.*` 参照禁止と改変検知のセキュリティ契約を維持する。
- wrapper 実行時の前提ランタイムを `python3` から `deno` へ変更する。

## この change でやらないこと
- Python 実装の即時削除
- Node/TypeScript 実装の一括置換リリース（段階切替のみを許可）
- 実行仕様（task status 遷移、persona 制御ルール、OpenSpec 解釈規則）の意味変更
- `codex_wrapper.sh` の実行経路や I/O 契約の意味変更

## 期待成果
- TypeScript への移行着手前に、実装順序・互換条件・検証方法が OpenSpec 上で合意される。
- 将来の実装 change で「どのモジュールから移植し、何をもって完了とするか」を機械的に判定できる。
- 実装者ごとの解釈差で出力がぶれないよう、比較項目と判定方法が明文化される。
- この change の完了時点で、TypeScript 実装が parity gate を満たし、切替可否を判定できる。
- `codex_wrapper.sh` 経路で `python3` 非依存（Deno 依存）に移行しつつ、既存運用コマンドを維持できる。

## 影響範囲
- 影響する仕様:
  - `runtime-platform-migration`（ADDED）
- 想定実装対象（将来 change）:
  - `team_orchestrator/*.py` 相当を TypeScript で再構成
  - CLI、OpenSpec compiler、StateStore、Provider、Orchestrator、Adapter 層
  - 互換性テスト基盤（golden / parity）

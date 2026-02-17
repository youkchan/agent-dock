# Design

## Context
`spec-creator polish` は既存 change の markdown 群をコンテキストとして再設計し、
openspec の最新規約（implement 必須、5行契約、3値判定）へ一括整合する機能。
入力コンテキストは `openspec/changes/<change_id>/` 配下の全 `.md` とする。
再生成対象は `proposal.md` `tasks.md` `code_summary.md` `specs/**/spec.md` とし、`design.md` は必要時のみ対象に含める。
今回の要件は、`design.md` は必要時のみ作成・更新する判定を導入する点が核心。

## Goals
- 指定 change 配下の全 `.md` を入力として読み取り、Codex により再生成対象（`proposal.md` `tasks.md` `code_summary.md` `specs/**/spec.md` + 必要時 `design.md`）の全体整合を再設計する。
- `design.md` は、技術的な判断が必要な場合のみ生成（既存があり判断不要なら維持、存在しないなら生成）する。
- `--feedback` を反映し、`openspec validate <change_id> --strict` の通過を担保する。

## Non-Goals
- change 外ファイルの編集
- 実装コードの直接変更（仕様作成ロジックのみ）
- 対話型承認フロー
- 非 Markdown ファイルの変更

## Decisions
### 1) 対象ファイルと出力方針
対象は `openspec/changes/<change_id>/` 配下の全 `.md` を原則とし、Codex の出力は「必要な変更セット」だけを更新する。
この change_id 専用実装では、設計情報が必要な条件があるときのみ `design.md` を更新・作成する。

### 2) design.md 必要性の判定条件
- 既存設計上の矛盾解消、段階・ロールの再構成、外部実行系との統合が発生
- 以前 `openspec validate` 失敗の原因が設計仕様（契約不備・責務分解・実行経路）に起因
- 変更が複数ファイルを跨ぐ整合再設計で、`tasks.md` だけでは再現できない技術判断が発生
  
上記以外では `design.md` は再生成しない。新規変更で既存が存在せず、かつ条件を満たす場合のみ新規作成する。

### 3) 実行フロー
単発の Codex 呼び出しで「既存コンテキスト + 最新基準 + ユーザー feedback」を入力し、多ファイル再設計を行う。
候補出力は一時領域へ書き出し、openspec strict validate は一時領域に対して実行する。
strict validate 成功時のみ本体ファイルへ反映し、失敗時は一時領域を破棄して本体ファイルを不変に保つ。
反映単位は対象ファイル全体で atomic（all-or-nothing）とし、逐次反映は行わない。
`--no-run` の場合も strict validate は省略せず、validate 成功時のみ staged 出力を確定する。

### 4) 5行契約と3値判定の強制
出力時に `review/spec_check/test` の 5行契約（JUDGMENT 必須）と
判定値 `pass | changes_required | blocked` を満たさせることを最優先条件とする。

### 5) 実装スコープと完了ゲート
各実装タスクは `target_paths` を必須対象（実処理に直結）として持ち、
最小追加修正は `関連許可` に定義した範囲のみ許可する。
完了判定は次の3ゲートで行う。
- 配線ゲート: 実装内容が実実行経路に接続されていること
- 回帰ゲート: compile/test/validate の必須チェックが通ること
- 整合ゲート: 文書とコードの全体監査で矛盾がないこと

整合ゲートで修正が入った場合は `agent-dock compile-openspec --change-id <change_id>` と
`openspec validate <change_id> --strict` を再実行し、両方通過後のみ完了扱いとする。

### 6) CLI移行契約
`spec-creator polish <change_id>` を正規経路とする。
`spec-creator` 直実行は legacy create 経路として当面残すが deprecate 扱いとし、
未知サブコマンド・`polish` の引数不正は fail-closed で拒否する。

### 7) scope 判定の正規化
許可範囲判定は canonical path 比較で行う。
`..` を含む相対パス、絶対パス、traversal を reject し、
`target_paths` と `related_paths` の比較前に同一正規化規則を適用する。
正規化規則は lexical normalization を基本とし、実在パスは realpath で canonical 化する。
canonical 解決結果がリポジトリ外へ出る場合（例: symlink 経由）は fail-closed で reject する。

## Risks and Trade-offs
- リスク: 判定条件が不足し、必要な design 更新を見逃す可能性
  - 緩和: 判定条件を設計上の不整合・実行経路変更で保守的に定義し、初回実行後は feedback 経由で条件を拡張する
- リスク: すべての md を再設計対象にすると処理負荷とノイズが増える
  - 緩和: 変更は最終的な差分最小化を要求し、`design.md` は最小生成で churn を抑制
- リスク: validate fail で処理が stop される場合の再試行コスト
  - 緩和: 事前プロンプトに最新版ルールを固定し、失敗原因を feedback として再投入しやすい形式で返却

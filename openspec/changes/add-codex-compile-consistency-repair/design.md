## コンテキスト
現行コンパイラは構文的な整合性（`target_paths` 必須、依存解決、循環検出など）には強いが、変更提案全体との意味整合性は保証しない。
今回の変更では、コンパイルパイプラインに Codex ベースの整合性審査を追加し、不整合があれば生成物を補正してから出力する。

## 目標
- OpenSpec change と生成 `task_config` の意味整合性をコンパイル時に確認する。
- Codex 指摘に基づく追記/修正を決定的な形式で適用する。
- 補正後も既存安全ルール（スキーマ、依存、循環、必須項目）を満たすことを保証する。

## 非目標
- タスク内容の自由生成（制約なし自動作成）
- コンパイル無限リトライ
- OpenSpec change 文書そのものの自動書換え

## 設計判断

### 1) レビュー入力
Codex には以下の入力を JSON で渡す:
- `change_id`
- `source`:
  - `proposal.md`
  - `tasks.md`
  - `design.md`（存在時）
  - `specs/*/spec.md`（存在分）
- `compiled_task_config`（override 適用後の現行結果）

### 2) Codex 応答契約
Codex 応答は JSON のみを許可し、最低限次を含む:
- `is_consistent`: bool
- `issues`: list
- `patch`: object（不整合時のみ）

`patch` は許可キーを限定する:
- `tasks_append`: list[task object]
- `tasks_update`: object (`task_id` -> allowed fields)
- `teammates`: list[str]（任意）

`tasks_update` の許可項目は既存 override と揃え、初期導入では
`title`, `description`, `target_paths`, `depends_on`, `requires_plan` に限定する。

### 3) 適用フロー
1. 既存コンパイル（parse + override + static validate）
2. Codex 整合性レビュー
3. `is_consistent=false` かつ有効 `patch` の場合に補正適用
4. 補正後 payload に static validate を再適用
5. 成功時のみ出力

補正後にバリデーションを通らない場合は fail-closed（エラーで停止）とする。

### 4) 実行モード
`compile-openspec` に Codex レビュー制御を追加する:
- 既定: 実行する（ユーザー要求に合わせる）
- 無効化オプション: `--skip-codex-consistency`

Codex コマンド解決順:
1. `--codex-consistency-command`
2. `CODEX_CONSISTENCY_COMMAND`
3. 既定 `codex reply --stdin`

### 5) 監査情報
出力 `meta` に以下を追加する:
- `codex_consistency.checked`: bool
- `codex_consistency.consistent_before_patch`: bool
- `codex_consistency.patched`: bool
- `codex_consistency.issues_count`: int

## リスクと緩和
- リスク: Codex 応答の揺れ
  - 緩和: 厳格 JSON 契約と許可キー制限、型検証
- リスク: 過剰補正で想定外タスクが混入
  - 緩和: 許可フィールド限定 + 再バリデーション
- リスク: Codex コマンド不達で運用停止
  - 緩和: 明確エラー + 明示的無効化オプション提供

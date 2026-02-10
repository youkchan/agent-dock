## コンテキスト
この変更は、OpenSpec で管理される `changes/*` をランタイム実行に直結させるためのもの。
対象は以下の 4 段フローを最小構成で実現すること:

1. 解析（OpenSpec change の読込）
2. 変換（内部タスクモデル化）
3. マージ（`overrides` 適用）
4. 実行（CLI `run` 連携）

## 目標
- OpenSpec 変更提案から、実行可能な `task_configs/*.json` を機械的に生成できること。
- `depends_on` と `requires_plan` を運用ルールに沿って安定的に表現できること。
- 実行時に `--openspec-change` を指定するだけで、手動 JSON 生成なしに run できること。

## 非目標
- OpenSpec 仕様記述全体（自由記述文）の完全意味解析。
- 複数変更の同時統合コンパイル。
- 既存 `--config` フローの廃止。

## 決定事項
### 1) コンパイル入力
- 入力の主対象は `openspec/changes/<change-id>/`。
- `tasks.md` を正規入力とし、`T-xxx` タスク定義（依存・requires_plan）を抽出する。
- `proposal.md` と `design.md` は補助情報として扱い、実行属性の一次ソースにはしない。

### 2) コンパイル出力
- 出力先は `task_configs/<change-id>.json`。
- 形式は既存 `--config` が受け取る JSON 形式（`teammates` と `tasks[]`）に合わせる。
- `target_paths` は未指定時に安全な既定値（例: `["*"]` ではなく、明示不足としてエラー）を採用し、曖昧な自動補完を避ける。

### 3) overrides マージ
- `overrides/<change-id>.yaml` が存在する場合のみ適用する。
- 優先順位は `compiled base < override`。
- 上書き可能項目は初期実装で `title`, `description`, `target_paths`, `depends_on`, `requires_plan`, `teammates` に限定する。
- 未知キーは警告ではなくエラーにして、設定ミスを早期検出する。

### 4) CLI 連携
- `compile-openspec` サブコマンドを追加する。
- `run` サブコマンドに `--openspec-change` を追加し、指定時は実行前にコンパイルを行う。
- `--config` と `--openspec-change` の同時指定はエラーにする（入力ソース曖昧性を排除）。

## 代替案と却下理由
- 代替案: `run` 時に毎回 `tasks.md` だけを直接読み込んで in-memory 実行する。
  - 却下理由: 生成物が残らず追跡性が弱い。再実行時の入力固定が難しい。
- 代替案: `proposal.md` の自然言語からタスクを推論する。
  - 却下理由: 決定性が低く、テストで固定しにくい。

## リスクと緩和
- リスク: `tasks.md` 記法の揺れで解析が壊れる。
  - 緩和: 受理記法を限定し、違反時は位置付きエラーを返す。
- リスク: 依存関係の循環で実行不能になる。
  - 緩和: コンパイル時に循環検出して失敗させる。
- リスク: override がベースを破壊する。
  - 緩和: スキーマ検証と型検証を実施し、型不一致を即失敗にする。

## マイグレーション方針
1. 既存 `--config` フローはそのまま維持。
2. 新規フローとして `compile-openspec` を導入。
3. 運用が安定したら README で `--openspec-change` を推奨導線として追加。

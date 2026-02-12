## コンテキスト
ペルソナ品質ゲートは稼働しているが、デフォルト定義が Python コードに埋め込まれているため、内容更新やレビューの粒度が粗くなる。
今後の詳細化（`principles` / `do_not` / `checklist`）に備え、まず定義の配置を「コード -> ファイル」に分離する。
また、`add-persona-executor-handoff` によりペルソナは実行主体になれるため、カタログ分離時に execution profile 互換を壊さないことが必須になっている。

## 目標
- デフォルト4ペルソナを独立 YAML ファイルとして管理できること。
- project payload での上書き/追加挙動を壊さないこと。
- runtime 挙動を変えずに移行できること。

## 非目標
- ペルソナの新フィールド利用
- `persona_pipeline` のコメント生成ロジック変更

## 設計判断

### 1) ファイル配置
- 既定配置: `team_orchestrator/personas/default/*.yaml`
- 1ファイル1ペルソナとし、レビュー差分を局所化する。

### 2) 読込順序
- `default files -> project payload(personas[])` の順序でマージする。
- 同名 `id` は project payload を完全採用（フィールド単位マージなし）。
- 非同名 `id` は追加する。

### 3) 互換性
- runtime が参照する有効フィールドは `id`, `role`, `focus`, `can_block`, `enabled`, `execution`。
- `execution` は optional とし、未指定時は現行どおり「実行主体候補にならない」扱いを維持する。
- 既存のテスト期待値（デフォルト4件、上書き規則、バリデーション）を維持する。
- `personas` 未指定時 fallback（teammates 実行）の挙動は変更しない。

### 4) 検証
- 既存 `personas[]` の挙動を回帰テストで担保する。
- ファイル欠落/重複ID/必須キー欠落/未知キーを失敗させる。
- execution profile あり/なし両ケースで、読込とバリデーション互換を担保する。

## リスクと緩和
- リスク: パス解決ミスでデフォルトが空になる
  - 緩和: 起動時に必須4件の読込を検証し、欠落時は明示エラー
- リスク: 将来フィールド追加時に既存バリデーションが阻害
  - 緩和: この change では互換維持を優先し、拡張は別 change で段階導入

## 段階計画（参考）
1. Phase 1（本 change）: 分離のみ
2. Phase 2（次 change）: `principles` / `do_not` / `checklist` の追加
3. Phase 3（次 change）: 必要なら runtime 反映

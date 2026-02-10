## コンテキスト
`compile-openspec` で生成される `task_config` は、プロジェクト固有の運用ルールで微調整されることがある。
しかし現行方式（`<change-id>.yaml`）では change ごとに同種の override を繰り返し管理する必要があり、運用と監査が煩雑になる。

## 目標
- project 単位で 1 つの override ファイルを使い、運用を単純化する。
- override 未配置時も通常運用できるようにし、必須ファイルを増やさない。
- OpenSpec change ごとの差分は `tasks.md` と spec delta 側に集約し、override は例外調整のみに限定する。

## 非目標
- 複数 override の優先順位解決（レイヤー管理）
- change 単位 override の互換維持
- override による自由記述メタデータ拡張

## 決定事項
### 1) override 入力源
- 標準入力源は `task_configs/overrides/project.yaml` のみ。
- ファイルが存在する場合のみ適用し、存在しない場合はスキップする。

### 2) マージ優先順位
- 優先順位は `compiled base < project override`。
- 許可フィールドと型検証は現行仕様を維持する。

### 3) 旧方式の扱い
- `task_configs/overrides/<change-id>.yaml` は読まない。
- 旧ファイルが残っていてもコンパイル結果へ影響させない。

## 具体例（project override が必要なケース）
- 全 change で `teammates` の既定値を固定したい場合。
- `target_paths` をプロジェクト標準パターンへ寄せたい場合。
- `requires_plan` を特定タスク群で常に強制したい場合。
- 文言統一のため、特定 task の `title` / `description` を上書きしたい場合。

## マイグレーション方針
1. 既存の `<change-id>.yaml` から必要項目を `project.yaml` へ移す。
2. コンパイル結果差分を確認し、不要になった `<change-id>.yaml` を削除する。
3. README の新運用手順へ切り替える。

## リスクと緩和
- リスク: `project.yaml` が肥大化し、局所変更の追跡が難しくなる。
  - 緩和: コメントで用途を区分し、項目を task ID 単位で最小化する。
- リスク: 旧方式に依存する手順が残る。
  - 緩和: README と CI 手順を同時更新し、旧方式を参照しないようにする。

## ADDED Requirements

### Requirement: `target_paths=*` タスクは開始時に実効スコープへ自動絞り込みできること
システムは `target_paths` が `*` のタスクについて、実行開始時に `effective_target_paths` を自動算出しなければならない（SHALL）。

#### Scenario: 初期スキャンで実効スコープが生成される
- **WHEN** `target_paths=*` のタスクが開始される
- **THEN** タスクに `effective_target_paths` が設定される
- **AND** 初期スキャン結果は state に保存される

### Requirement: 実行中に必要ファイルが見つかった場合はスコープ更新できること
システムはタスク実行中にスコープ外ファイルの必要性が判明した場合、拡張要求により `effective_target_paths` を更新できなければならない（SHALL）。

#### Scenario: 拡張要求でスコープが更新される
- **WHEN** Teammate が理由付きで拡張要求を送る
- **THEN** Lead の承認後に `effective_target_paths` へ追加反映される
- **AND** タスクは再実行せず継続できる

### Requirement: スコープは `TARGET_PROJECT_DIR` 内に限定すること
システムは実効スコープに含めるパスを常に `TARGET_PROJECT_DIR` 配下へ制限しなければならない（SHALL）。

#### Scenario: ルート外パス要求を拒否する
- **WHEN** 拡張要求に `TARGET_PROJECT_DIR` 外のパスが含まれる
- **THEN** 要求は拒否される
- **AND** 拒否理由がログに記録される

### Requirement: スコープ更新履歴を監査可能に保存すること
システムはスコープ更新の履歴を再開後も失われない形で state に保存しなければならない（SHALL）。

#### Scenario: resume 後も更新履歴が保持される
- **WHEN** スコープ更新済み state で再開実行する
- **THEN** `scope_change_log` は保持される
- **AND** 再開後の更新履歴は追記される

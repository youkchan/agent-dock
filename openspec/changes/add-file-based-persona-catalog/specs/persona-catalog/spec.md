## ADDED Requirements

### Requirement: デフォルトペルソナは独立ファイルで管理されること
システムはデフォルトペルソナ定義をコード直書きではなく、独立したファイル群から読み込まなければならない（SHALL）。

#### Scenario: デフォルト4ペルソナをファイルから読込む
- **WHEN** ペルソナ設定を明示せずに起動する
- **THEN** `personas/default/*.yaml` から4つのデフォルトペルソナが読み込まれる
- **AND** 各ペルソナは `id`, `role`, `focus`, `can_block`, `enabled` を持つ
- **AND** `execution` は任意で、指定時は実行プロファイルとして読込まれる

### Requirement: ファイル読込後も project 上書き規則を維持すること
システムはデフォルトファイル読込後に project payload の `personas[]` を適用し、既存の上書き/追加挙動を維持しなければならない（SHALL）。

#### Scenario: 同名 id は project payload で完全上書きされる
- **WHEN** project payload にデフォルトと同じ `id` が含まれる
- **THEN** デフォルトファイル定義は採用されない
- **AND** project payload の定義が100%使われる

#### Scenario: 非同名 id は追加される
- **WHEN** project payload にデフォルトに存在しない `id` が含まれる
- **THEN** そのペルソナは追加ペルソナとして有効化される

#### Scenario: 同名 id の execution を含めて完全上書きされる
- **WHEN** project payload が既存 id に `execution` を含む定義を与える
- **THEN** デフォルト側の同名定義は採用されない
- **AND** `execution` を含む project payload 側定義が100%適用される

### Requirement: 不正なデフォルト定義ファイルを拒否すること
システムは必須キー欠落、型不一致、未知キー、重複 `id` を含むデフォルト定義ファイルを受理してはならない（MUST NOT）。

#### Scenario: 重複 id を検出して失敗する
- **WHEN** デフォルト定義ファイル群に重複 `id` がある
- **THEN** 起動または読み込みは失敗する
- **AND** エラーには重複した `id` が含まれる

#### Scenario: execution 型不一致を検出して失敗する
- **WHEN** デフォルト定義ファイルの `execution.timeout_sec` に数値以外が指定される
- **THEN** 起動または読み込みは失敗する
- **AND** エラーには `execution` の不正型情報が含まれる

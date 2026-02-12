## ADDED Requirements
### Requirement: spec-creator polish は change 単位で fail-closed 実行すること
システムは `agent-dock spec-creator polish --change-id <id>` を受け付け、`--change-id` 未指定または `openspec/changes/<change-id>/` 非存在の場合は即時失敗しなければならない（SHALL）。

#### Scenario: 有効な change-id で実行する
- **WHEN** ユーザーが `agent-dock spec-creator polish --change-id add-foo` を実行する
- **THEN** `openspec/changes/add-foo/` 配下の処理を開始する

#### Scenario: change-id が無効なら失敗する
- **WHEN** `--change-id` が未指定または存在しない change-id を指定する
- **THEN** コマンドは fail-closed で失敗する
- **AND** 処理は開始しない

### Requirement: polish は change 配下の全ファイルを再帰走査すること
システムは `openspec/changes/<change-id>/` 配下を再帰走査し、対象ファイルを Markdown と非Markdownに分類して扱わなければならない（SHALL）。

#### Scenario: 再帰走査で対象総数を算出する
- **WHEN** polish を実行する
- **THEN** 対象総ファイル数を算出する
- **AND** 結果サマリに総ファイル数を出力する

### Requirement: Markdown だけを整備し、非Markdownは無変更とすること
システムは `*.md` に対して整形・固定行補完・見出し正規化を適用し、非Markdown（yaml/json等）は内容を変更してはならない（MUST NOT）。

#### Scenario: Markdown は整備される
- **WHEN** 対象に `*.md` が含まれる
- **THEN** Markdown 整備ルールを適用する
- **AND** 適用件数を結果サマリに含める

#### Scenario: 非Markdown は無変更である
- **WHEN** 対象に yaml/json 等が含まれる
- **THEN** 非Markdown の内容は変更されない
- **AND** 必要時は警告を出力する

### Requirement: polish 結果を監査可能な形式で出力すること
システムは実行結果として、対象総ファイル数、変更ファイル一覧、整備ルール別適用件数を出力しなければならない（SHALL）。

#### Scenario: 変更有無に応じてサマリを出力する
- **WHEN** polish が終了する
- **THEN** 変更ファイル一覧を出力する
- **AND** 変更なしの場合も件数ゼロとして明示する

### Requirement: polish は冪等であること
システムは同一入力に対する再実行で追加差分を発生させてはならない（MUST NOT）。

#### Scenario: 再実行で差分ゼロになる
- **WHEN** 同一 change-id に対して polish を連続実行する
- **THEN** 2回目以降の差分はゼロである

### Requirement: polish 後の compile-openspec が成功すること
システムは polish 実行後に `compile-openspec` が成功する状態を維持しなければならない（SHALL）。

#### Scenario: polish 後にコンパイルできる
- **WHEN** polish 完了後に `compile-openspec --change-id <id>` を実行する
- **THEN** task_config 生成が成功する

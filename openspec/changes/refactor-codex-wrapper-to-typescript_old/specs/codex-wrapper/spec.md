## ADDED Requirements

### Requirement: TypeScript 層は payload 検証を担当すること
システムは TypeScript 層で stdin から受け取った JSON payload を検証しなければならない（SHALL）。

#### Scenario: 必須フィールドが検証される
- **WHEN** TypeScript 層が JSON payload を受け取る
- **THEN** `mode`, `teammate_id`, `task` の存在を確認する
- **AND** 不足がある場合は fail-closed でエラーを返す

### Requirement: TypeScript 層は .env deny チェックを担当すること
システムは TypeScript 層で `CODEX_DENY_DOTENV=1` の場合に payload 内の .env 参照を検出しなければならない（SHALL）。

#### Scenario: .env 参照が検出されて拒否される
- **WHEN** `CODEX_DENY_DOTENV=1` で payload 内に `.env` 参照がある
- **THEN** 実行を拒否してエラーを返す
- **AND** 違反箇所をエラーメッセージに含める

### Requirement: TypeScript 層はプロンプト生成を担当すること
システムは TypeScript 層で `mode=plan` または `mode=execute` に応じたプロンプトを生成しなければならない（SHALL）。

#### Scenario: plan モードでプロンプトが生成される
- **WHEN** `mode=plan` の payload を受け取る
- **THEN** 計画作成用のプロンプトを生成する
- **AND** `task_id`, `title`, `description`, `target_paths` を含める

#### Scenario: execute モードでプロンプトが生成される
- **WHEN** `mode=execute` の payload を受け取る
- **THEN** 実行用のプロンプトを生成する
- **AND** `progress_log` の直近 N 件を含める

### Requirement: TypeScript 層は .env スナップショットを担当すること
システムは TypeScript 層で codex 実行前後の `.env*` ファイル変更を検知しなければならない（SHALL）。

#### Scenario: .env 変更が検知されて失敗する
- **WHEN** `CODEX_DENY_DOTENV=1` で codex 実行後に `.env*` が変更されている
- **THEN** 実行を失敗としてエラーを返す
- **AND** 変更内容（追加/削除/変更）をエラーメッセージに含める

### Requirement: TypeScript 層は結果パースを担当すること
システムは TypeScript 層で codex 実行結果から 4 行フォーマットを抽出しなければならない（SHALL）。

#### Scenario: 4 行フォーマットが抽出される
- **WHEN** codex 実行が成功して出力がある
- **THEN** `RESULT`, `SUMMARY`, `CHANGED_FILES`, `CHECKS` を抽出する
- **AND** 抽出できない場合はエラーを返す

### Requirement: Shell 層は codex exec 実行を担当すること
システムは Shell 層で `codex exec` コマンドを実行しなければならない（SHALL）。

#### Scenario: 環境変数に応じてコマンドが構築される
- **WHEN** Shell 層が起動される
- **THEN** `CODEX_MODEL`, `CODEX_SANDBOX`, `CODEX_FULL_AUTO` 等からコマンドを構築する
- **AND** stdin からプロンプトを受け取って実行する

### Requirement: Shell 層はストリーム表示制御を担当すること
システムは Shell 層で `CODEX_STREAM_VIEW` に応じたログフィルタリングを行わなければならない（SHALL）。

#### Scenario: all_compact モードで diff が折りたたまれる
- **WHEN** `CODEX_STREAM_VIEW=all_compact` で実行する
- **THEN** codex 出力の diff ブロックを折りたたむ
- **AND** 長い行を `CODEX_STREAM_EXEC_MAX_CHARS` で切り詰める

### Requirement: 2 層間のインターフェースは固定契約であること
システムは TypeScript 層と Shell 層の間のインターフェースを固定しなければならない（SHALL）。

#### Scenario: TypeScript → Shell の契約が維持される
- **WHEN** TypeScript 層が Shell 層を呼び出す
- **THEN** stdin にプロンプト文字列を渡す
- **AND** 環境変数で設定を渡す

#### Scenario: Shell → TypeScript の契約が維持される
- **WHEN** Shell 層が終了する
- **THEN** stdout に 4 行フォーマットを出力する
- **AND** stderr にストリームログを出力する
- **AND** exit code で成功/失敗を通知する

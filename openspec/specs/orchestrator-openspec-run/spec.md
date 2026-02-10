# orchestrator-openspec-run Specification

## Purpose
TBD - created by archiving change add-openspec-task-config-compiler. Update Purpose after archive.
## Requirements
### Requirement: run コマンドは OpenSpec change 指定で実行できること
システムは `run --openspec-change <change-id>` を受け付け、指定 change の task_config を使ってオーケストレーター実行を開始しなければならない（SHALL）。

#### Scenario: run 時に change-id から実行できる
- **WHEN** ユーザーが `run --openspec-change add-openspec-task-config-compiler` を実行する
- **THEN** 対応する task_config が解決される
- **AND** オーケストレーターが通常の run と同様に開始される

### Requirement: config 入力ソースの曖昧性を禁止すること
システムは `--config` と `--openspec-change` の同時指定を許可してはならない（MUST NOT）。

#### Scenario: 排他違反をエラーで返す
- **WHEN** ユーザーが `run --config x.json --openspec-change y` を同時指定する
- **THEN** 実行は開始されない
- **AND** エラーメッセージに排他違反であることが示される

### Requirement: コンパイル失敗時は実行を中断すること
システムは `--openspec-change` 指定時のコンパイルに失敗した場合、部分実行せずに停止しなければならない（SHALL）。

#### Scenario: 無効な change-id を指定した場合
- **WHEN** 存在しない change-id を `--openspec-change` で指定する
- **THEN** run は失敗として終了する
- **AND** エラーに解決不能な change-id が含まれる


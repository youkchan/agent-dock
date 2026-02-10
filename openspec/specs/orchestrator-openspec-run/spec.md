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

### Requirement: run は persona 実行主体モードを扱えること
システムは task_config に persona 実行設定がある場合、ペルソナを実行主体として run を進行できなければならない（SHALL）。

#### Scenario: persona 実行主体でタスクが進行する
- **WHEN** task_config の `personas[].execution.enabled=true` が定義されている
- **THEN** claim と実行 owner は persona_id ベースで管理される
- **AND** フェーズに応じた executor_personas から担当が選定される

### Requirement: 後方互換として teammates 実行へフォールバックできること
システムは persona 実行設定が未指定の場合、既存 teammates 実行へフォールバックしなければならない（SHALL）。

#### Scenario: personas 未指定で従来動作する
- **WHEN** task_config に `personas` が存在しない
- **THEN** 従来どおり `teammates` を実行主体として run が継続する

### Requirement: 実行主体不在の構成を拒否すること
システムは実行可能な persona も teammates も存在しない構成を受理してはならない（MUST NOT）。

#### Scenario: 実行主体ゼロで失敗する
- **WHEN** `personas[].execution.enabled=true` が 0 件かつ `teammates` も空で run を開始する
- **THEN** 実行は開始されない
- **AND** エラーには実行主体不足であることが含まれる

### Requirement: run コマンドは明示指定で途中再開できること
システムは `run --resume` が指定された場合、既存 state を利用して途中状態から実行を継続できなければならない（SHALL）。

#### Scenario: 途中状態から再開する
- **WHEN** `--resume` 付きで起動し、`state_dir` に既存 task 状態が存在する
- **THEN** 既存 task の `status` / `owner` / `block_reason` / `result_summary` を保持して実行を継続する
- **AND** 起動ログに `run_mode=resume-run` が出力される

#### Scenario: state が空なら初期投入して開始する
- **WHEN** `--resume` 付きで起動したが `state_dir` に task が存在しない
- **THEN** 入力 task_config から task を初期投入して実行を開始する
- **AND** 起動ログに `run_mode=new-run` が出力される

### Requirement: 再開時は task 定義不一致を拒否すること
システムは `--resume` 時に state と入力 task_config の task 定義が不一致な場合、実行を開始してはならない（MUST NOT）。

#### Scenario: task 定義不一致で失敗する
- **WHEN** `--resume` で起動し、`id` / `requires_plan` / `depends_on` / `target_paths` のいずれかが state と入力で一致しない
- **THEN** 実行は失敗として終了する
- **AND** エラーには不一致 task id と差分種別が含まれる

### Requirement: Teammate 実行中ログを逐次保存すること
システムは Teammate 実行中に得られる途中出力を state に逐次保存し、再開後も参照できなければならない（SHALL）。

#### Scenario: 実行途中ログが state に追記される
- **WHEN** タスク実行中に途中出力が発生する
- **THEN** `state_dir/state.json` にタスク単位の progress log が追記される
- **AND** progress log には `timestamp` / `source` / `text` が含まれる

#### Scenario: resume 後も途中ログが保持される
- **WHEN** 途中ログ付き state で `run --resume` を実行する
- **THEN** 既存 progress log は失われない
- **AND** 再開後の追加ログは既存ログへ追記される


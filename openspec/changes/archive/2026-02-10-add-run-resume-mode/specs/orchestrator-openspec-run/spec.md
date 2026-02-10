## ADDED Requirements

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

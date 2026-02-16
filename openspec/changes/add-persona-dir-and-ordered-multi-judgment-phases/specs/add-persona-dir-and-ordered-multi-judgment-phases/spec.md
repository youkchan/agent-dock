## MODIFIED Requirements
### Requirement: フェーズ担当の人数制限と実行順を固定する
システム SHALL、`review` / `spec_check` / `test` のみ複数担当を許可し、`implement` は単数のみ許可する。
同一フェーズ内の担当者は `フェーズ担当` に記載された順（左→右）で順次実行される。

#### Scenario: implement は compile 経路で単数固定
- **GIVEN** `run --openspec-change` で読み込まれる `tasks.md` に `implement` が 2 つ以上指定される
- **WHEN** compile が `task_config` を生成する
- **THEN** compile error で停止し、orchestrator は起動しない

#### Scenario: implement は run --config 経路でも単数固定
- **GIVEN** `run --config` の `task_config` で `implement` が 2 つ以上指定される
- **WHEN** run 開始時に `task_config` を検証する
- **THEN** runtime validation error で停止し、task 実行を開始しない

#### Scenario: review は順序付きで複数実行
- **GIVEN** `run --config` の `task_config.persona_policy.phase_overrides.review.executor_personas` に `[code-reviewer, spec-checker]` が設定される
- **WHEN** review phase を開始する
- **THEN** `code-reviewer` の結果を先に受け取り、次に `spec-checker` を実行する

### Requirement: フェーズ内判定は changes_required 集約で1回差し戻しする
システム SHALL、`blocked` と `changes_required` の扱いを明確化する。
フェーズ担当を順次実行し、`blocked` が1人でも出た時点で即時 blocked 確定とする。
`blocked` がない場合のみ、全担当完了後に `changes_required` を OR 集約し、`any=true` なら implement へ1回だけ差し戻す。

#### Scenario: changes_required の集約
- **GIVEN** 1 つのフェーズで 3 名の判定担当が実行される
- **WHEN** 3 名目に `changes_required=true` が含まれる
- **THEN** フェーズ終了後に `any_changes_required=true` として 1 回だけ implement へ戻す

#### Scenario: blocked は即時確定
- **GIVEN** フェーズ内に `blocked` を返す担当者がいる
- **WHEN** その結果を受信する
- **THEN** 直ちにフェーズを blocked とし、残り担当者は実行しない

### Requirement: 次フェーズ遷移と revision guard を維持する
システム SHALL、フェーズ遷移は `blocked` が存在せず、かつ `changes_required` が false の場合のみ次フェーズへ進む。
`revision_count` は差し戻し実行1回ごとに +1 し、`revision_count > max_revision_cycles` で上限超過を判定する。

#### Scenario: 次フェーズ進行条件
- **GIVEN** フェーズ結果が `blocked=false` かつ `changes_required=false`
- **WHEN** 全担当結果が集約される
- **THEN** 次のフェーズへ進める

#### Scenario: revision_count guard
- **GIVEN** implement へ戻した回数が `max_revision_cycles` と同値の場合
- **WHEN** さらに1回戻しが必要になる
- **THEN** `revision_count > max_revision_cycles` として差し戻し不可と判定する

## ADDED Requirements
### Requirement: 外部ペルソナの単一ディレクトリ読込を追加する
システム SHALL、`--persona-dir <dir>` で 1 つのディレクトリを指定し、ペルソナ定義を補助入力する。
システム SHALL、`run` と `spec-creator` の両方で `--persona-dir` を受け付ける。
システム SHALL、`run --config` のトップレベル `task_config.personas` を基底とし、最後に `--persona-dir` を解決して最終結果を作る。
システム SHALL、`--persona-dir` では `<dir>/personas.json` のみを読込対象とし、ディレクトリ走査（`*.yaml` など）は行わない。
システム SHALL、`<dir>/personas.json` は `task_config.personas` と同一スキーマの PersonaDefinition 配列（JSON配列）であることを要求する。
システム SHALL、`<dir>` 不在、`personas.json` 不在、JSON パース失敗、スキーマ不一致のいずれも runtime validation error として fail-closed で停止する。
同一 `id` は完全上書き、異なる `id` は追加として扱う。

#### Scenario: persona merge の優先順位
- **GIVEN** persona が default、`payload.personas`、`--persona-dir` で定義されている
- **WHEN** 実行時に解決処理を行う
- **THEN** default < payload < persona-dir の優先順で上書きされ、異なる id は追加される

#### Scenario: persona-dir 由来 id をフェーズ担当で利用できる
- **GIVEN** `--persona-dir` の `personas.json` に `custom-reviewer` が定義され、`task_config.persona_policy.phase_overrides.review.executor_personas` に `[code-reviewer, custom-reviewer]` が設定される
- **WHEN** run 開始時にフェーズ担当を検証し、review phase を実行する
- **THEN** unknown persona error を出さず、review は `code-reviewer` -> `custom-reviewer` の順に実行される

#### Scenario: persona-dir 同時複数指定
- **GIVEN** `--persona-dir` が複数指定される
- **WHEN** run オプションを解釈する
- **THEN** 1つのみ許容し、それ以外はエラーとして扱う

#### Scenario: persona-dir 入力フォーマット固定
- **GIVEN** `--persona-dir /tmp/personas` が指定される
- **WHEN** ペルソナ定義を読み込む
- **THEN** `/tmp/personas/personas.json` の JSON 配列のみを読み込み、ディレクトリ走査は行わない

#### Scenario: persona-dir 読込失敗は fail-closed
- **GIVEN** `--persona-dir` の指定先で `personas.json` が存在しない、または JSON/スキーマが不正である
- **WHEN** run 開始時にペルソナ解決を行う
- **THEN** runtime validation error で停止し、task 実行を開始しない

#### Scenario: spec-creator は persona-dir を run へ引き渡す
- **GIVEN** `spec-creator --persona-dir /tmp/personas` が指定される
- **WHEN** spec-creator が `run --config` を起動する
- **THEN** `--persona-dir /tmp/personas` は run 呼び出しへ透過的に引き渡される

## ADDED Requirements

### Requirement: 変更スコープを構造リファクタへ限定すること
システムは本 change の対象を責務分割と重複排除に限定し、機能仕様と外部挙動を変更してはならない（SHALL）。

#### Scenario: スコープ境界が維持される
- **WHEN** この change の成果物をレビューする
- **THEN** 変更は `main.ts` 分割、実行結果パーサ共通化、`spec_creator.ts` 分割、`orchestrator.ts` 段階抽出に限定される
- **AND** 新機能追加や公開契約変更が含まれない

### Requirement: `src/cli/main.ts` は入口責務へ縮小されること
システムは `src/cli/main.ts` から command/args/workflow 責務を分割し、`main.ts` にコマンドディスパッチと既存 export 互換のみを残さなければならない（SHALL）。

#### Scenario: CLI 分割後も互換性を維持する
- **WHEN** `main.ts` 分割を適用する
- **THEN** `specCreatorCommand` 系、`runSpecCreatorWorkflow` 系、`parse*Args` 系は新規モジュールへ移設される
- **AND** `main`, `buildTeammateAdapter`, `defaultTeammateCommand`, `parseTeammatesArg`, `collectSpecCreatorApplyManifestForTest` の公開シグネチャは維持される

### Requirement: 実行結果パーサは単一モジュールへ共通化されること
システムは `RESULT/SUMMARY/CHANGED_FILES/CHECKS/JUDGMENT` の5キー解釈を `src/domain/execution_result.ts` に集約しなければならない（SHALL）。

#### Scenario: wrapper と orchestrator が同一解釈を使う
- **WHEN** `helper.ts` と `orchestrator.ts` が実行結果を解釈する
- **THEN** 両者は `src/domain/execution_result.ts` の共通実装を利用する
- **AND** wrapper 固有の禁止コマンド検査は共通化対象外として残る

### Requirement: `spec_creator.ts` の本線と補助ロジックを分離すること
システムは `spec_creator.ts` の責務を prompt/context/polish utilities に分離し、`spec_creator.ts` 自体は再export ハブへ縮小しなければならない（SHALL）。

#### Scenario: 実行経路を維持したまま責務を分離する
- **WHEN** `spec_creator.ts` の分割を適用する
- **THEN** prompt 生成は `spec_creator_prompt.ts`、context 収集は `spec_creator_context.ts`、整形補助は `spec_creator_polish_utils.ts` へ移設される
- **AND** `specCreatorPolishCommand -> runSpecCreatorWorkflow` の実行経路は変わらない

### Requirement: `orchestrator.ts` は安全順で段階分割されること
システムは `orchestrator.ts` を pure 関数抽出から始め、decision 評価、decision 実行の順で段階分割し、最後に class をオーケストレーション責務へ限定しなければならない（SHALL）。

#### Scenario: 段階抽出中も判定挙動を保持する
- **WHEN** orchestrator 分割を段階実施する
- **THEN** `this.store`, `this.log`, `this.makeEvent` 依存は境界を明示して引数化される
- **AND** イベント順序、sendback 挙動、blocked 条件に差分が発生しない

### Requirement: 挙動不変を fail-closed で担保すること
システムは既存テスト群による差分検知を必須とし、挙動差分が検出された場合は change を完了扱いにしてはならない（SHALL）。

#### Scenario: 回帰検知時に change を停止する
- **WHEN** `main_test`、`helper_test`、`spec_creator_test`、`orchestrator_test` のいずれかが失敗する、または `deno check src/**/*.ts` が失敗する
- **THEN** 変更は blocked と判定される
- **AND** 仕様変更ではなく構造変更として再修正される

### Requirement: Provider 完了判定は fail-closed に固定されること
システムは `ORCHESTRATOR_PROVIDER=mock` 実行のみを完了扱いにしてはならず、`not implemented` 等の未実装エラーを未完了として扱わなければならない（SHALL）。

#### Scenario: mock 単独または未実装エラーを完了として扱わない
- **WHEN** 完了判定が `ORCHESTRATOR_PROVIDER=mock` 単独実行結果のみ、または `not implemented` を含む結果で行われる
- **THEN** 変更は完了と判定されない
- **AND** 実運用実行経路での受け入れ実行が要求される

### Requirement: Reviewer 停止判定は blocker として扱われること
システムは `spec-reviewer` 出力に `REVIEWER_STOP:requirement_drift|over_editing|verbosity` が含まれる場合、停止判定として扱わなければならない（SHALL）。

#### Scenario: reviewer 重大違反時に遷移を停止する
- **WHEN** review 結果に `REVIEWER_STOP:` が含まれる
- **THEN** 変更は blocker として停止される
- **AND** 次フェーズへの遷移は許可されない

### Requirement (RC-01): RESULT 抽出と正規化を定義すること
システムは最終 result block から `RESULT` を抽出し、`completed|blocked` へ正規化しなければならない（SHALL）。

#### Scenario: RESULT が正規化される
- **WHEN** 実行結果を受信する
- **THEN** 最終 block の `RESULT` が `completed` または `blocked` として解釈される

### Requirement (RC-02): SUMMARY 抽出を定義すること
システムは `SUMMARY` を抽出し、要約用途として必須項目にしなければならない（SHALL）。

#### Scenario: SUMMARY 欠落を reject する
- **WHEN** `SUMMARY` が欠落した結果を受信する
- **THEN** fail-closed で拒否される

### Requirement (RC-03): CHANGED_FILES 正規化を定義すること
システムは `CHANGED_FILES` を正規化し、非implementフェーズでは `(none)` を必須化しなければならない（SHALL）。

#### Scenario: 非implementでファイル変更を拒否する
- **WHEN** review/spec_check/test で `CHANGED_FILES` が `(none)` 以外になる
- **THEN** fail-closed で拒否される

### Requirement (RC-04): CHECKS 抽出と禁止コマンド検査を定義すること
システムは `CHECKS` を抽出し、禁止コマンドを検知した場合は拒否しなければならない（SHALL）。

#### Scenario: 禁止コマンドを拒否する
- **WHEN** `CHECKS` に禁止コマンドが含まれる
- **THEN** fail-closed で拒否される

### Requirement (RC-05): JUDGMENT 正規化を定義すること
システムは decision phase で `JUDGMENT` を必須とし、`pass|changes_required|blocked` へ正規化しなければならない（SHALL）。

#### Scenario: 不正 JUDGMENT を拒否する
- **WHEN** `JUDGMENT` が未定義値になる
- **THEN** fail-closed で拒否される

### Requirement (RC-06): 判定時系列を定義すること
システムは `blocked` 即停止、`changes_required` sendback、`pass` 前進の時系列を維持しなければならない（SHALL）。

#### Scenario: changes_required で差し戻す
- **WHEN** 判定が `changes_required` になる
- **THEN** sendback 遷移が選択される

### Requirement (RC-07): reviewer stop 契約を明記すること
システムは `REVIEWER_STOP:requirement_drift|over_editing|verbosity` を停止トリガーとして扱わなければならない（SHALL）。

#### Scenario: reviewer stop で停止する
- **WHEN** `REVIEWER_STOP:` を検出する
- **THEN** blocker 停止になる

### Requirement (RC-08): 実行経路対象を明示すること
システムは run と spec-creator の両経路を対象に同一契約を適用しなければならない（SHALL）。

#### Scenario: 両経路で同一契約を適用する
- **WHEN** run または spec-creator を実行する
- **THEN** 同じ validation ルールが適用される

### Requirement (RC-09): compile/runtime 責務を分離すること
システムは compile 段階の静的契約と runtime 段階の実行契約を分離しなければならない（SHALL）。

#### Scenario: compile と runtime を分離する
- **WHEN** 契約違反を検出する
- **THEN** compile 拒否と runtime 停止が混同されない

### Requirement (RC-10): 入力契約キーを明示すること
システムは `task_config.persona_policy.phase_overrides.<phase>.executor_personas` を入力契約キーとして扱わなければならない（SHALL）。

#### Scenario: 入力キー欠落を検知する
- **WHEN** 入力契約キーが欠落する
- **THEN** fail-closed で拒否される

### Requirement (RC-11): sendback 条件を限定すること
システムは `changes_required` の sendback 遷移を `blocked=false` の場合に限定しなければならない（SHALL）。

#### Scenario: blocked=true では sendback しない
- **WHEN** 判定が `changes_required` かつ `blocked=true`
- **THEN** sendback は許可されない

### Requirement (RC-12): テスト契約と同義性を維持すること
システムは MUST/SHALL ごとに「経路テスト1件 + fail-closed 拒否テスト1件」を要求し、`tasks.md(1.3)` とこの `spec.md` の同義性を維持しなければならない（SHALL）。

#### Scenario: task/spec 同義性を検証する
- **WHEN** artifacts を検証する
- **THEN** RC-01..RC-12 が `tasks.md(1.3)` と `spec.md` の双方に存在する
- **AND** 固定テンプレート行欠落または checklist 形式逸脱は fail-closed で拒否される

## 0. Persona Defaults
- persona_defaults.phase_order: implement, review, spec_check, test
- persona_defaults: {"phase_order":["implement","review","spec_check","test"]}
- フェーズ担当: implement=implementer; review=code-reviewer; spec_check=spec-checker; test=test-owner
- personas: [{"id":"implementer","role":"implementer","focus":"実装を前進させる","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}},{"id":"code-reviewer","role":"reviewer","focus":"品質と回帰リスクを確認する","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}},{"id":"spec-checker","role":"spec_guard","focus":"仕様逸脱を防ぐ","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}},{"id":"test-owner","role":"test_guard","focus":"検証の十分性を担保し、要件ごとに transport 経路テストと fail-closed 拒否テストを確認する","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}}]

### 0.1 テンプレート利用ルール
- この雛形を `openspec/changes/<change-id>/tasks.md` にコピーし、`<...>` を実タスクで置換する。
- `persona_defaults.phase_order` と `フェーズ担当` の固定行は削除しない。
- `personas:` は **1行JSON** で記述する（YAMLの複数行形式は compiler が受理しない）。
- ペルソナを実行主体にする場合は `personas:` 行を残す。消すと実行主体は `teammate-*` になる。
- 各タスクに `- フェーズ担当:` を記述し、`implement=implementer; review=code-reviewer; spec_check=spec-checker; test=test-owner` から必要なフェーズだけ選ぶ。
- すべての実施項目（検証含む）は `## 1. 実装タスク` のチェックボックス付きタスクとして記述する（`## 2. 検証項目` は使わない）。
- 人間向けメモは `## 2. 人間向けメモ（コンパイラ非対象）` にチェックボックスなしで記述する。
- MUST/SHALL ごとに `transport`（producer -> carrier -> consumer）を明記する。
- MUST/SHALL ごとに `fail-closed` の拒否条件（reject/block）を明記する。
- MUST/SHALL ごとに経路テスト1件と拒否テスト1件を対応付ける。

### 0.2 Provider 完了判定ゲート（固定）
- `ORCHESTRATOR_PROVIDER=mock` 実行のみでは完了扱いにしない。
- 対象プロジェクトの実運用実行経路での受け入れ実行を必須とする。
- `not implemented` 等の未実装エラーは未完了として扱う（fail-closed）。

### 0.3 OpenSpec validate 実行ガード（固定）
- `openspec validate` は task `1.7` でのみ実行する。
- task `1.1`〜`1.6` のローカルチェックでは `openspec validate` を実行しない。
- `openspec validate` の対象は task_id ではなく change-id を使う（例: `openspec validate add-persona-dir-and-ordered-multi-judgment-phases --strict`）。
- task `1.1`〜`1.6` で `openspec validate` を実行した結果を完了根拠として扱わない（fail-closed）。

## 1. 実装タスク
- [x] 1.1 `--persona-dir` を run/spec-creator 引数として追加し、複数指定をエラー扱いにする
  - 依存: なし
  - 対象: src/cli/main.ts, src/cli/main_test.ts
  - フェーズ担当: implement=implementer; review=code-reviewer
  - 成果物: `run` と `spec-creator` で `--persona-dir <dir>` を 1回のみ許可し、`spec-creator` は `run --config` へ透過的に引き渡す。
  - transport: CLI args (`--persona-dir`) -> run/spec-creator parser -> run invocation -> persona 解決処理
  - fail-closed: `--persona-dir` が2回以上指定されると起動前に拒否する。`spec-creator` でも同条件で拒否する。
  - 経路テスト: `agent-dock run --config ... --persona-dir /tmp/personas` が起動引数として受理される
  - 拒否テスト: `run/spec-creator` ともに `--persona-dir A --persona-dir B` で起動エラーとなる
- [x] 1.2 外部ディレクトリ由来 `personas` を `payload.personas` とマージし、同一ID上書き・異なるID追加を実装する
  - 依存: 1.1
  - 対象: src/infrastructure/persona/catalog.ts, src/infrastructure/persona/catalog_test.ts
  - フェーズ担当: implement=implementer; spec_check=spec-checker
  - 成果物: 解決順序 `default -> payload.personas -> --persona-dir` のマージを実装し、`--persona-dir` は `<dir>/personas.json`（JSON配列）読込に限定する。
  - transport: personas/default/*.yaml -> payload.personas -> `<persona-dir>/personas.json` -> runtime persona 解決
  - fail-closed: `<dir>` 不在、`personas.json` 不在、JSON パース失敗、スキーマ不一致時は runtime validation error で reject/block する。
  - 経路テスト: 同一ID上書きと新規ID追加の結果をユニットテストで確認し、`custom-reviewer` が `persona_policy.phase_overrides.review.executor_personas` で参照可能になることを確認
  - 拒否テスト: `personas.json` 以外を前提とした読込（例: `*.yaml` 走査）を行わず、`--persona-dir` の読み込み失敗で不正終了
- [x] 1.3 implement フェーズの担当者数を 1 固定とし、compile 時と run 開始時の両方で fail-closed する
  - 依存: 1.2
  - 対象: src/infrastructure/openspec/compiler.ts, src/infrastructure/openspec/compiler_test.ts, src/application/orchestrator/orchestrator.ts, src/application/orchestrator/orchestrator_test.ts
  - フェーズ担当: implement=implementer; review=code-reviewer; spec_check=spec-checker
  - 成果物: implement フェーズの `executor_personas` が 2 つ以上なら、`run --openspec-change` は compile error、`run --config` は runtime validation error で停止する。
  - transport: tasks.md phase assignments -> compile -> task_config、および task_config -> run startup validation -> orchestrator
  - fail-closed: implement 重複指定を compile/run いずれの経路でも pass させない。
  - 経路テスト: `run --openspec-change` で implement 重複を compile error で拒否し、`run --config` でも起動直後に runtime validation error で拒否することを確認
  - 拒否テスト: review のみ複数指定は許容しつつ implement 複数を両経路で拒否するケース
- [x] 1.4 レビュー/仕様検証/テストフェーズで担当者を `フェーズ担当` の順序どおり実行し、blocked / changes_required をフェーズ内集約する
  - 依存: 1.3
  - 対象: src/application/orchestrator/orchestrator.ts, src/application/orchestrator/orchestrator_test.ts
  - フェーズ担当: implement=implementer; review=code-reviewer; test=test-owner
  - 成果物: decision フェーズでは `left -> right` の担当順で実行し、1人でも blocked は即時 blocked、changes_required は phase完了後 OR 集約。
  - transport: task.current_phase_index -> executor_persona 選択 -> 実行結果の累積 -> 最終判定
  - fail-closed: blocked 判定を無視して pass に進めない。
  - 経路テスト: review に 3 人設定し、2人目で blocked を返した時点で 3 人目は実行されず blocked 確定になることを確認する。
  - 拒否テスト: changes_required が1人だけでも複数回 implement へ戻る実装を検知する
- [x] 1.5 changes_required 集約時は implement へ 1 回のみ送戻し、revision_count を 1 増分する
  - 依存: 1.4
  - 対象: src/application/orchestrator/orchestrator.ts, src/infrastructure/state/store.ts, src/application/orchestrator/orchestrator_test.ts
  - フェーズ担当: implement=implementer; review=code-reviewer
  - 成果物: `blocked` がない場合のみ、phase の `changes_required` 集約結果に基づいて 1 回だけ `sendBackTaskToPhase(..., implement, true)` を実行する。
  - transport: phase judgment aggregate (`blocked`, `changes_required`) -> sendback decision -> revision_count
  - fail-closed: `blocked=true` のときに sendback しない。changes_required が複数検知時でも増分は1回固定。
  - 経路テスト: changes_required 複数で revision_count が +1 のみであることを検証
  - 拒否テスト: `blocked=true` でも implement へ送戻ししてしまう実装、および implement への再送が複数回生じる実装を検知する
- [x] 1.6 blocked/nextフェーズ遷移条件と `revision_count > max_revision_cycles` ガードを維持し、回帰テストを拡張する
  - 依存: 1.5
  - 対象: src/application/orchestrator/orchestrator.ts, src/infrastructure/state/store.ts, src/infrastructure/state/store_test.ts, src/application/orchestrator/orchestrator_test.ts
  - フェーズ担当: implement=implementer; test=test-owner
  - 成果物: blocked の即時確定、`changes_required` と `blocked` 条件の判定順序、revision ガードの境界条件を不変で保持する。
  - transport: phase aggregate -> handoff/sendback -> isRevisionGuardExceeded
  - fail-closed: `revision_count > max_revision_cycles` が `>=` で扱われる実装を拒否する。
  - 経路テスト: `max_revision_cycles` 達した直後の 1 回目の changes_required を needs_approval へ進める。
  - 拒否テスト: guard 不一致時に test が赤字するケース
- [x] 1.7 変更成果物の整合として `openspec validate ... --strict` を実行する
  - 依存: 1.2, 1.3, 1.4, 1.5, 1.6
  - 対象: openspec/changes/add-persona-dir-and-ordered-multi-judgment-phases/{proposal.md,tasks.md,design.md,code_summary.md,specs/add-persona-dir-and-ordered-multi-judgment-phases/spec.md}
  - フェーズ担当: implement=code-reviewer
  - 成果物: 全 artifact が strict 検証をする
  - transport: 実装成果物 -> openspec validator -> pass/fail
  - fail-closed: validate エラーを未解消でタスク完了扱いしない。
  - 経路テスト: `openspec validate add-persona-dir-and-ordered-multi-judgment-phases --strict` を 1 回実行し成功を確認
  - 拒否テスト: old-style コマンド名を残している場合は fail

## 2. 人間向けメモ（コンパイラ非対象）
- この変更は `src/**` に限定し、Python 実装には触れない。
- `tasks.md` は checklist 形式の実装タスクとして保持し、レビュー時に固定行の欠落がないことを確認する。

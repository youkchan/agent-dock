## 0 Persona Defaults
- persona_defaults.phase_order: implement, review, spec_check, test
- persona_defaults: {"phase_order":["implement","review","spec_check","test"]}
- フェーズ担当: implement=implementer; review=code-reviewer; spec_check=spec-checker; test=test-owner
- personas: [{"id":"implementer","role":"implementer","focus":"実装を前進させる","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}},{"id":"code-reviewer","role":"reviewer","focus":"品質と回帰リスクを確認する","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}},{"id":"spec-checker","role":"spec_guard","focus":"仕様逸脱を防ぐ","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}},{"id":"test-owner","role":"test_guard","focus":"検証の十分性を担保し、要件ごとにtransport経路テストとfail-closed拒否テストを確認する","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}}]

### 0.1 テンプレート利用ルール
- この雛形を `openspec/changes/<change-id>/tasks.md` にコピーし、`<...>` を実タスクで置換する。
- `persona_defaults.phase_order` と `フェーズ担当` の固定行は削除しない。
- `personas:` は **1行JSON** で記述する（YAMLの複数行形式は compiler が受理しない）。
- ペルソナを実行主体にする場合は `personas` 行を残す。消すと実行主体は `teammate-*` になる。
- 各タスクに `- フェーズ担当:` を記述し、`implement=implementer; review=code-reviewer; spec_check=spec-checker; test=test-owner` から必要なフェーズだけ選ぶ。
- 例: `- フェーズ担当: implement=implementer; review=code-reviewer`（未指定フェーズはグローバル既定を使う）。
- すべての実施項目（検証を含む）は **`## 1. 実装タスク` のチェックボックス付きタスク** として記述する（`## 2. 検証項目` は使わない）。
- 人間向けメモは `## 2. 人間向けメモ（コンパイラ非対象）` に **チェックボックスなし** で記述する。
- MUST/SHALL ごとに `transport` 経路（producer -> carrier -> consumer）を定義し、対象タスクへ明記する。
- MUST/SHALL ごとに fail-closed の拒否点（どこで、何を理由に reject/block するか）を定義し、対象タスクへ明記する。
- MUST/SHALL ごとに「経路テスト1件 + 拒否テスト1件」を対応付け、実行コマンドを対象タスクへ明記する。
- `target_paths` と `関連許可` は実行時の編集ヒントとして扱う（機械ブロック条件ではない）。
- 実装中に追加で必要になった編集は許可し、最終レビューで「なぜ必要だったか」を説明できる状態にする。
- scope は fail-closed の機械判定に使わず、review/spec_check/test の判定で適否を確認する。

### 0.2 Provider 完了判定ゲート（固定）
- `ORCHESTRATOR_PROVIDER=mock` 実行のみでは完了扱いにしない。
- 対象プロジェクトの実運用実行経路での受け入れ実行を必須とする。
- `not implemented` 等の未実装エラーは未完了として扱う（fail-closed）。


## 1. 実装タスク
- [x] 1.1 `agent-dock spec-creator polish` の仕様収集対象を実装する
  - 依存: なし
  - 対象: src/cli/main.ts, src/infrastructure/openspec/spec_creator.ts
  - 関連許可: src/cli/main_test.ts, src/infrastructure/openspec/spec_creator_test.ts
  - フェーズ担当: implement=implementer; review=code-reviewer
  - 成果物: `change_id` 存在チェックを含む、`openspec/changes/<change_id>/` 配下 `.md` の入力コンテキスト収集ロジック。
  - 完了ゲート: 配線ゲート（収集ロジックが実行経路に接続されること）

- [x] 1.2 Polish 用プロンプトの組み立てを実装する
  - 依存: 1.1
  - 対象: src/infrastructure/openspec/spec_creator.ts, src/infrastructure/openspec/spec_creator_test.ts
  - 関連許可: src/cli/main.ts, src/cli/main_test.ts
  - フェーズ担当: implement=implementer; review=code-reviewer
  - 成果物: 既存コンテキスト（対象 change の全 `.md`）を収集し、`--feedback`＋最新基準（5行契約、JUDGMENT必須、判定3値化）をタスク単位の1回以上（複数回）呼び出しで、プロンプト長上限内ベストエフォートとして扱う。再生成対象は `proposal.md` `tasks.md` `code_summary.md` `specs/**/spec.md` + 必要時 `design.md`。
  - 完了ゲート: 配線ゲート（生成プロンプトが実実行で使用されること）

- [x] 1.3 `runSpecCreatorWorkflow` に polish 用ロジックを接続する
  - 依存: 1.2
  - 対象: src/cli/main.ts, src/cli/main_test.ts, src/infrastructure/openspec/spec_creator.ts
  - 関連許可: src/infrastructure/openspec/spec_creator_test.ts
  - フェーズ担当: implement=implementer; review=code-reviewer
  - 成果物: `spec-creator polish` の実行経路（`specCreatorPolishCommand -> runSpecCreatorWorkflow`）で、`buildSpecCreatorPolishPrompt` と `includeDesignTarget` 判定を使って再生成条件を反映する。
  - 完了ゲート: 配線ゲート（polish 実行時の文脈生成・design 条件分岐が runSpecCreatorWorkflow 経路で有効）

- [x] 1.4 `agent-dock spec-creator polish` コマンドを追加する
  - 依存: 1.3
  - 対象: src/cli/main.ts, src/cli/main_test.ts
  - 関連許可: src/infrastructure/openspec/spec_creator.ts, src/infrastructure/openspec/spec_creator_test.ts
  - フェーズ担当: implement=implementer; review=code-reviewer
  - 成果物: `agent-dock spec-creator polish <change_id> [--feedback "..."]` の CLI サブコマンドを追加。`spec-creator` 直実行は legacy create 経路（deprecate）として扱い、未知サブコマンド・`polish` の引数不正は fail-closed で拒否する。
  - 完了ゲート: 配線ゲート（CLIから polish 本体が呼ばれること）

- [x] 1.5 polish 実行後の `openspec validate` を自動実行する
  - 依存: 1.4
  - 対象: src/infrastructure/openspec/spec_creator.ts, src/infrastructure/openspec/spec_creator_test.ts, src/cli/main.ts, src/cli/main_test.ts
  - 関連許可: openspec/changes/add-spec-creator-polish-auto-remaster/
  - フェーズ担当: implement=implementer; spec_check=spec-checker; review=code-reviewer; test=test-owner
  - 成果物: 候補出力を一時領域へ書き出し、`openspec validate <change_id> --strict` 成功時のみ本体反映、失敗時は一時領域破棄で本体無変更。反映は全対象ファイル atomic（all-or-nothing）で行う。
  - 完了ゲート: 回帰ゲート（`openspec validate` 失敗時に本体無変更を検証）

- [x] 1.6 コンパイルエラー／実行時エラーの使い分けを含む最終整合レビューを行う
  - 依存: 1.1,1.2,1.3,1.4,1.5
  - 対象: openspec/changes/add-spec-creator-polish-auto-remaster/
  - 関連許可: src/cli/main.ts, src/cli/main_test.ts, src/infrastructure/openspec/spec_creator.ts, src/infrastructure/openspec/spec_creator_test.ts, src/infrastructure/openspec/spec_creator_quality_test.ts
  - フェーズ担当: review=code-reviewer; implement=implementer
  - 成果物: 入力コンテキスト（全 `.md` 収集）と再生成対象（`proposal.md` `tasks.md` `code_summary.md` `specs/**/spec.md` + 必要時 `design.md`）の分離、ならびに投入時が上限内ベストエフォートである点を確認し、`implement` 必須化・3値判定・`(none)` ルール・CHANGED_FILES整合を確認する。
  - 完了ゲート: 整合ゲート（全体監査で修正が入った場合、`agent-dock compile-openspec --change-id <change_id>` と `openspec validate <change_id> --strict` を再実行してから完了）


## 2. 人間向けメモ（コンパイラ非対象）
- メモ: Polish は対象 change 配下のみ扱い、外部ファイルへの副作用を作らない。
- 注意: 実装対象外のフェーズや追加要件は `--feedback` へ明示し、実装側で最小スコープに反映する。

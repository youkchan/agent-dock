## 0. Persona Defaults
- persona_defaults.phase_order: implement, review, spec_check, test
- persona_defaults: {"phase_order":["implement","review","spec_check","test"]}
- フェーズ担当: implement=implementer; review=code-reviewer; spec_check=spec-checker; test=test-owner
- personas: [{"id":"implementer","role":"implementer","focus":"実装を前進させる","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}},{"id":"code-reviewer","role":"reviewer","focus":"品質と回帰リスクを確認する","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}},{"id":"spec-checker","role":"spec_guard","focus":"仕様逸脱を防ぐ","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}},{"id":"test-owner","role":"test_guard","focus":"検証の十分性を担保し、要件ごとにtransport経路テストとfail-closed拒否テストを確認する","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}}]

### 0.1 テンプレート利用ルール
- この雛形を `openspec/changes/<change-id>/tasks.md` にコピーし、`<...>` を実タスクで置換する。
- `persona_defaults.phase_order` と `フェーズ担当` の固定行は削除しない。
- `personas:` は1行JSONで記述する。
- すべての実施項目（検証を含む）は `## 1. 実装タスク` のチェックボックス付きタスクとして記述する。
- MUST/SHALL ごとに `transport` 経路、fail-closed 拒否点、経路テスト1件 + 拒否テスト1件を定義する。

### 0.2 Provider 完了判定ゲート（固定）
- `ORCHESTRATOR_PROVIDER=mock` 実行のみでは完了扱いにしない。
- 対象プロジェクトの実運用実行経路での受け入れ実行を必須とする。
- `not implemented` 等の未実装エラーは未完了として扱う（fail-closed）。

### 0.3 Reviewer 停止判定ゲート（固定）
- `spec-reviewer` が重大違反を検出したら `REVIEWER_STOP:requirement_drift|over_editing|verbosity` を出力する。
- `REVIEWER_STOP:` を含むレビュー結果は blocker として停止判定する。

## 1. 実装タスク
- [ ] 1.1 要件をOpenSpec要素へ正規化する
  - 依存: なし
  - 対象: openspec/changes/refactor-spec-creator-and-orchestrator-modularization_revised/proposal.md, openspec/changes/refactor-spec-creator-and-orchestrator-modularization_revised/tasks.md, openspec/changes/refactor-spec-creator-and-orchestrator-modularization_revised/code_summary.md, openspec/changes/refactor-spec-creator-and-orchestrator-modularization_revised/specs/**/spec.md
  - 関連許可: openspec/changes/refactor-spec-creator-and-orchestrator-modularization_revised/design.md
  - フェーズ担当: implement=implementer; review=code-reviewer
  - persona_policy.phase_order: implement, review, spec_check, test
  - persona_policy: {"phase_order":["implement","review","spec_check","test"]}
  - 成果物: requirements_text を整理し、change の最小スコープを定義する。
- [ ] 1.2 proposal.md を生成する
  - 依存: 1.1
  - 対象: openspec/changes/refactor-spec-creator-and-orchestrator-modularization_revised/proposal.md
  - 関連許可: openspec/changes/refactor-spec-creator-and-orchestrator-modularization_revised/design.md
  - フェーズ担当: implement=implementer; review=code-reviewer
  - persona_policy.phase_order: implement, review, spec_check, test
  - persona_policy: {"phase_order":["implement","review","spec_check","test"]}
  - 成果物: 変更理由、変更内容、影響範囲を proposal.md に記述する。
- [ ] 1.3 tasks.md を固定テンプレート準拠で生成する
  - 依存: 1.2
  - 対象: openspec/changes/refactor-spec-creator-and-orchestrator-modularization_revised/tasks.md
  - 関連許可: openspec/changes/refactor-spec-creator-and-orchestrator-modularization_revised/design.md
  - フェーズ担当: implement=implementer; review=code-reviewer
  - persona_policy.phase_order: implement, review, spec_check, test
  - persona_policy: {"phase_order":["implement","review","spec_check","test"]}
  - 成果物: `print-openspec-template` の固定行維持、`## 1. 実装タスク` checklist 形式、RC-01..RC-12 の同義反映。
  - RC-01 | transport: run/spec-creator/polish の最終結果 block から RESULT を抽出して completed|blocked に正規化する | reject: missing_result / invalid_result_value / malformed_result_block は fail-closed | path_test: 正常 RESULT=completed を受理し completed 遷移になることを確認する | reject_test: RESULT 欠落で missing_result を返し拒否することを確認する
  - RC-02 | transport: SUMMARY を抽出して必須化し、要約用途へ受け渡す | reject: missing_summary は fail-closed | path_test: SUMMARY ありの正常応答で通過することを確認する | reject_test: SUMMARY 欠落で missing_summary を返すことを確認する
  - RC-03 | transport: CHANGED_FILES を正規化し、非implementフェーズでは (none) を強制する | reject: missing_changed_files / nonimplement_changed_files は fail-closed | path_test: implement フェーズで変更ファイル配列を受理することを確認する | reject_test: review/spec_check/test でファイル名がある場合に nonimplement_changed_files を返すことを確認する
  - RC-04 | transport: CHECKS を抽出して必須化し、禁止コマンド検査を適用する | reject: missing_checks / forbidden_checks_command は fail-closed | path_test: 許可コマンドのみを含む CHECKS を受理することを確認する | reject_test: 禁止コマンドを含む CHECKS で forbidden_checks_command を返すことを確認する
  - RC-05 | transport: decision phase で JUDGMENT を必須化し pass|changes_required|blocked に正規化する | reject: missing_judgment / invalid_judgment は fail-closed | path_test: JUDGMENT=pass を受理して次フェーズへ進むことを確認する | reject_test: 不正値 JUDGMENT で invalid_judgment を返すことを確認する
  - RC-06 | transport: 判定時系列を blocked即停止 / changes_required送返 / pass前進 で統一する | reject: 判定順序違反や未定義分岐は fail-closed | path_test: changes_required で sendback に遷移することを確認する | reject_test: blocked 判定後に継続しないことを確認する
  - RC-07 | transport: review結果に REVIEWER_STOP:requirement_drift|over_editing|verbosity を反映する | reject: REVIEWER_STOP 欠落や未定義コードは fail-closed | path_test: 重大違反で REVIEWER_STOP が出力され停止することを確認する | reject_test: 未定義 REVIEWER_STOP コードを拒否することを確認する
  - RC-08 | transport: run と spec-creator(polish含む) の両経路で同じ検証を実行する | reject: 片経路のみ実装は fail-closed | path_test: run と spec-creator の双方で同一 validation code になることを確認する | reject_test: 片経路で契約を無視する実装を拒否することを確認する
  - RC-09 | transport: compile と runtime の責務境界を分離して扱う | reject: compile/runtime の混在判定は fail-closed | path_test: runtime 契約違反が runtime 側で検出されることを確認する | reject_test: compile エラーを runtime 経路で扱わないことを確認する
  - RC-10 | transport: task_config.persona_policy.phase_overrides.<phase>.executor_personas を入力契約キーとして検証する | reject: 入力キー欠落や別キー使用は fail-closed | path_test: 正しい入力キーで reviewer 順序が解釈されることを確認する | reject_test: 誤キー task_config.review を拒否することを確認する
  - RC-11 | transport: sendback 条件を blocked=false 前提で評価する | reject: blocked=true の sendback は fail-closed | path_test: changes_required かつ blocked=false で sendback することを確認する | reject_test: blocked=true で sendback を拒否することを確認する
  - RC-12 | transport: MUST/SHALL ごとに transport・reject・path_test・reject_test を両成果物で追跡可能にする | reject: 4要素欠落または tasks/spec/code_summary 非同義は fail-closed | path_test: RC-01..RC-12 全件で4要素がそろっていることを確認する | reject_test: 任意RCの4要素欠落で品質ガードが reject することを確認する
  - fail-closed: RC 欠落、固定テンプレート行欠落、checklist 形式逸脱は reject とする。
- [ ] 1.4 必要時に design.md を生成する
  - 依存: 1.2
  - 対象: openspec/changes/refactor-spec-creator-and-orchestrator-modularization_revised/design.md
  - 関連許可: なし
  - フェーズ担当: implement=implementer; review=code-reviewer
  - persona_policy.phase_order: implement, review, spec_check, test
  - persona_policy: {"phase_order":["implement","review","spec_check","test"]}
  - 成果物: 設計上の判断が必要な場合のみ design.md を作成し、意思決定とトレードオフを記述する。
- [ ] 1.5 code_summary.md を生成する
  - 依存: 1.3
  - 対象: openspec/changes/refactor-spec-creator-and-orchestrator-modularization_revised/code_summary.md
  - 関連許可: openspec/changes/refactor-spec-creator-and-orchestrator-modularization_revised/design.md
  - フェーズ担当: implement=implementer; review=code-reviewer
  - persona_policy.phase_order: implement, review, spec_check, test
  - persona_policy: {"phase_order":["implement","review","spec_check","test"]}
  - 成果物: tasks.md の task_id と code unit の対応を code_summary.md に記述する。
- [ ] 1.6 生成成果物の整合性をレビューする
  - 依存: 1.2, 1.3, 1.4, 1.5
  - 対象: openspec/changes/refactor-spec-creator-and-orchestrator-modularization_revised/proposal.md, openspec/changes/refactor-spec-creator-and-orchestrator-modularization_revised/tasks.md, openspec/changes/refactor-spec-creator-and-orchestrator-modularization_revised/code_summary.md, openspec/changes/refactor-spec-creator-and-orchestrator-modularization_revised/specs/**/spec.md
  - 関連許可: openspec/changes/refactor-spec-creator-and-orchestrator-modularization_revised/design.md
  - フェーズ担当: implement=implementer; review=code-reviewer
  - persona_policy.phase_order: implement, review, spec_check, test
  - persona_policy: {"phase_order":["implement","review","spec_check","test"]}
  - 成果物: proposal/tasks/design/code_summary の整合、要件逸脱、過剰修正、冗長化を検証する。
- [ ] 1.7 OpenSpec strict validate を実行する
  - 依存: 1.6
  - 対象: openspec/changes/refactor-spec-creator-and-orchestrator-modularization_revised/proposal.md, openspec/changes/refactor-spec-creator-and-orchestrator-modularization_revised/tasks.md, openspec/changes/refactor-spec-creator-and-orchestrator-modularization_revised/code_summary.md, openspec/changes/refactor-spec-creator-and-orchestrator-modularization_revised/specs/**/spec.md
  - 関連許可: openspec/changes/refactor-spec-creator-and-orchestrator-modularization_revised/design.md
  - フェーズ担当: implement=implementer; review=code-reviewer
  - persona_policy.phase_order: implement, review, spec_check, test
  - persona_policy: {"phase_order":["implement","review","spec_check","test"]}
  - 成果物: `openspec validate refactor-spec-creator-and-orchestrator-modularization_revised --strict` を実行し、失敗時は修正後に再実行する。

## 2. 人間向けメモ（コンパイラ非対象）
- 参照コンテキストを成果物本文へ転載しないこと（参照ダンプの埋め込み禁止）。
- 生成時に巨大コンテキストが渡されても、出力は要件本文のみを記述すること。

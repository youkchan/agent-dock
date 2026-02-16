## 0. Persona Defaults
- persona_defaults.phase_order: implement, review, spec_check, test
- persona_defaults: {"phase_order":["implement","review","spec_check","test"]}
- フェーズ担当: implement=implementer; review=code-reviewer; spec_check=spec-checker; test=test-owner
- personas: [{"id":"implementer","role":"implementer","focus":"実装を前進させる","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}},{"id":"code-reviewer","role":"reviewer","focus":"品質と回帰リスクを確認する","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}},{"id":"spec-checker","role":"spec_guard","focus":"仕様逸脱を防ぐ","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}},{"id":"test-owner","role":"test_guard","focus":"検証の十分性を担保する","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}}]

### 0.1 テンプレート利用ルール
- この雛形を `openspec/changes/<change-id>/tasks.md` にコピーし、`<...>` を実タスクで置換する。
- `persona_defaults.phase_order` と `フェーズ担当` の固定行は削除しない。
- `personas:` は **1行JSON** で記述する（YAMLの複数行形式は compiler が受理しない）。
- ペルソナを実行主体にする場合は `personas` 行を残す。消すと実行主体は `teammate-*` になる。
- 各タスクに `- フェーズ担当:` を記述し、`implement=implementer; review=code-reviewer; spec_check=spec-checker; test=test-owner` から必要なフェーズだけ選ぶ。
- 例: `- フェーズ担当: implement=implementer; review=code-reviewer`（未指定フェーズはグローバル既定を使う）。
- すべての実施項目（検証を含む）は **`## 1. 実装タスク` のチェックボックス付きタスク** として記述する（`## 2. 検証項目` は使わない）。
- 人間向けメモは `## 2. 人間向けメモ（コンパイラ非対象）` に **チェックボックスなし** で記述する。

## 1. 実装タスク
- [ ] 1.1 既定の `codex_wrapper.sh` ランタイム導線を追加し、既定は互換維持経路を維持する
  - 依存: なし
  - 対象: openspec/changes/add-codex-wrapper-step1-contract-first-golden-compat/specs/add-codex-wrapper-step1-contract-first-golden-compat/spec.md, codex_wrapper.sh
  - フェーズ担当: implement=implementer; review=code-reviewer
  - 成果物: `CODEX_WRAPPER_RUNTIME=legacy` を導入し、legacy 時は既存フローを完全維持、ts 指定時は明示 fail する分岐を追加する。

- [ ] 1.2 `codex_wrapper.sh` の判定契約説明を上部コメント化して、抽出・判定・例外の運用差分を固定する
  - 依存: 1.1
  - 対象: codex_wrapper.sh
  - フェーズ担当: implement=implementer; review=code-reviewer
  - 成果物: RESULT / SUMMARY / CHANGED_FILES / CHECKS / JUDGMENT / RESULT_PHASE / CODEX_STREAM_VIEW の要件と失敗種別をコメント化し、実装と一致させる。

- [ ] 1.3 `codex_wrapper.sh` の stderr 出力を分類しやすい形へ整理する
  - 依存: 1.2
  - 対象: codex_wrapper.sh
  - フェーズ担当: implement=implementer; review=code-reviewer
  - 成果物: 本体メッセージ文字列を変更せず、カテゴリ名コメント/ラベル追加で失敗タイプ追跡を可能にする。

- [ ] 1.4 `src/infrastructure/wrapper/helper.ts` で `runCli` を dispatch 専用にし、4サブコマンドを明示的 API に分割する
  - 依存: 1.3
  - 対象: src/infrastructure/wrapper/helper.ts
  - フェーズ担当: implement=implementer; review=code-reviewer
  - 成果物: `runBuildPrompt` / `runSnapshotDotenv` / `runVerifyDotenv` / `runExtractResult` を内部 API 化し、既存 throw/戻り値を保持したまま `runCli` は分岐のみ担当にする。

- [ ] 1.5 `extractResultToFile` 系の契約定数を固定化する
  - 依存: 1.4
  - 対象: src/infrastructure/wrapper/helper.ts
  - フェーズ担当: implement=implementer; spec_check=spec-checker
  - 成果物: `RESULT_KEYS` / `OPTIONAL_RESULT_KEYS` / exit code `2/3/4` を `export const` 化し、spec と 1:1 で固定する。

- [ ] 1.6 helper の主要契約をテストで固定する
  - 依存: 1.4, 1.5
  - 対象: src/infrastructure/wrapper/helper_test.ts
  - フェーズ担当: implement=implementer; test=test-owner
  - 成果物: 正常 block 解析、非 implement の CHANGED_FILES 非空判定、extract-result 欠落・stale 行、RESULT_PHASE 未設定/不正値の 3 系列失敗を追加する。

- [ ] 1.7 変更結果を同一出力比較で検証可能にするため、golden 観点の最小回帰チェックを追加する
  - 依存: 1.6
  - 対象: src/infrastructure/wrapper/helper_test.ts
  - フェーズ担当: implement=implementer; test=test-owner
  - 成果物: payload/prompt/stream/result block の固定入力に対して shell 期待値と同等結果を比較し、差分ゼロ条件を明文化する。

- [ ] 1.8 `openspec validate add-codex-wrapper-step1-contract-first-golden-compat --strict` を通過させる
  - 依存: 1.1,1.2,1.3,1.4,1.5,1.6,1.7
  - 対象: openspec/changes/add-codex-wrapper-step1-contract-first-golden-compat
  - フェーズ担当: spec_check=spec-checker; test=test-owner; implement=code-reviewer
  - persona_policy: {"phase_order":["spec_check","test","implement"]}
  - 成果物: strict validation 成功

## 2. 人間向けメモ（コンパイラ非対象）
- 方針A-B-C-D-E と成功条件を満たすため、runtime 本体は Step1 で壊れた挙動を起こさない最小移行として扱う。
- `spec_check` と `test` は `tasks.md` の checkbox 運用で結果差分と fail-closed 条件を監査する。

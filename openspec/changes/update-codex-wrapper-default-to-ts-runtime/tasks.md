## 0. Persona Defaults
- persona_defaults.phase_order: implement, review, spec_check, test
- persona_defaults: {"phase_order":["implement","review","spec_check","test"]}
- フェーズ担当: implement=implementer; review=code-reviewer; spec_check=spec-checker; test=test-owner
- personas: [{"id":"implementer","role":"implementer","focus":"実装を前進させる","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}},{"id":"code-reviewer","role":"reviewer","focus":"品質と回帰リスクを確認する","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}},{"id":"spec-checker","role":"spec_guard","focus":"仕様逸脱を防ぐ","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}},{"id":"test-owner","role":"test_guard","focus":"検証の十分性を担保する","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}}]

## 1. 実装タスク
- [x] 1.1 `src/infrastructure/wrapper/runtime.ts` を新規作成し、payload 読込・empty 判定・prompt 生成を実装する
  - 依存: なし
  - 対象: src/infrastructure/wrapper/runtime.ts, src/infrastructure/wrapper/helper.ts
  - フェーズ担当: implement=implementer; review=code-reviewer
  - 成果物: helper 直接 import で `buildPrompt` を利用し、legacy 互換の入力前処理を実装する。

- [x] 1.2 `runtime.ts` に codex 実行コマンド組立と env 解釈を移植する
  - 依存: 1.1
  - 対象: src/infrastructure/wrapper/runtime.ts, codex_wrapper.sh
  - フェーズ担当: implement=implementer; review=code-reviewer
  - 成果物: env 解釈・引数組立が legacy と同値であること。

- [x] 1.3 `runtime.ts` に stream view (`assistant` / `thinking` / `all_compact` / `all`) を移植する
  - 依存: 1.2
  - 対象: src/infrastructure/wrapper/runtime.ts, codex_wrapper.sh
  - フェーズ担当: implement=implementer; review=code-reviewer
  - 成果物: stream 表示契約を legacy と一致させる。

- [x] 1.4 `runtime.ts` に result 抽出・empty output fail-closed・exit code 制御を実装する
  - 依存: 1.3
  - 対象: src/infrastructure/wrapper/runtime.ts, src/infrastructure/wrapper/helper.ts
  - フェーズ担当: implement=implementer; review=code-reviewer
  - 成果物: result block 抽出と失敗系 exit code が legacy と同値であること。

- [x] 1.5 `runtime.ts` に dotenv snapshot/verify 保護を実装する
  - 依存: 1.4
  - 対象: src/infrastructure/wrapper/runtime.ts, src/infrastructure/wrapper/helper.ts
  - フェーズ担当: implement=implementer; review=code-reviewer
  - 成果物: dotenv 保護契約（検知時 fail-closed）を維持する。

- [x] 1.6 `src/infrastructure/wrapper/runtime_test.ts` を新規作成し parity 比較基盤を実装する
  - 依存: 1.5
  - 対象: src/infrastructure/wrapper/runtime_test.ts, src/infrastructure/wrapper/codex_wrapper_test.ts
  - フェーズ担当: implement=implementer; test=test-owner
  - 成果物: fake codex スタブを使い、legacy vs ts の 3 点一致比較を実装する。

- [x] 1.7 parity ケースを追加し、差分 1 件でも fail するゲートを固定する
  - 依存: 1.6
  - 対象: src/infrastructure/wrapper/runtime_test.ts
  - フェーズ担当: implement=implementer; test=test-owner
  - 成果物: implement 正常、decision 正常、RESULT_PHASE 不正、empty payload、非implement+CHANGED_FILES 非空、codex 失敗、empty output、dotenv 改変検知を網羅する。

- [x] 1.8 `src/cli/main.ts` の default teammate command を ts runtime へ切替える（default=ts）
  - 依存: 1.7
  - 対象: src/cli/main.ts
  - フェーズ担当: implement=implementer; review=code-reviewer
  - 成果物: default は ts、`CODEX_WRAPPER_RUNTIME` は `ts` のみ許可し、それ以外は fail-closed で起動失敗する。

- [x] 1.9 `src/cli/main_test.ts` を更新し、runtime 選択優先順位を固定する
  - 依存: 1.8
  - 対象: src/cli/main_test.ts
  - フェーズ担当: implement=implementer; test=test-owner
  - 成果物: 明示コマンド優先、default=ts、legacy 指定の fail-closed、invalid runtime error を検証する。

- [x] 1.10 実運用スモークを legacy/ts 両方で実施し、結果比較ログを残す
  - 依存: 1.9
  - 対象: docs/ts-wrapper-contract.md
  - フェーズ担当: spec_check=spec-checker; test=test-owner; implement=implementer
  - persona_policy: {"phase_order":["spec_check","test","implement"]}
  - 成果物: timeout、stream 表示、fail-closed、dotenv 保護の比較結果を記録し差分 0 を確認する。

- [x] 1.11 strict validate と必須テストを通過させる
  - 依存: 1.1,1.2,1.3,1.4,1.5,1.6,1.7,1.8,1.9,1.10
  - 対象: openspec/changes/update-codex-wrapper-default-to-ts-runtime
  - フェーズ担当: spec_check=spec-checker; test=test-owner; implement=code-reviewer
  - persona_policy: {"phase_order":["spec_check","test","implement"]}
  - 成果物: `openspec validate update-codex-wrapper-default-to-ts-runtime --strict` と wrapper/cli/parity テストが全て成功する。

## 2. 人間向けメモ（コンパイラ非対象）
- この change では `default=ts` まで実施する。
- `codex_wrapper.sh` は parity 比較用に残す。削除は別 change で実施する。
- parity 比較対象は wrapper/runtime 単体の `result block / exit code / stderr` のみとする。

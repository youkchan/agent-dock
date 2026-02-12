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

## 1. 実装タスク
- [x] 1.1 現行 Python 契約を固定する
  - 依存: なし
  - 対象: team_orchestrator/*.py, tests/*.py, README.md, docs/ts-migration-contract.md
  - フェーズ担当: implement=implementer; review=code-reviewer
  - 成果物: `docs/ts-migration-contract.md` に CLI/state/compile の互換契約（I/O 要件・禁止変更点）を明記する
- [x] 1.2 TypeScript の目標構成を定義する
  - 依存: 1.1
  - 対象: docs/ts-architecture-blueprint.md, openspec/changes/add-typescript-runtime-rewrite-plan/*
  - フェーズ担当: implement=implementer; spec_check=spec-checker
  - 成果物: `docs/ts-architecture-blueprint.md` に domain/application/infrastructure/cli の責務境界を定義する
- [x] 1.3 パリティ検証方式を定義する
  - 依存: 1.1
  - 対象: docs/ts-parity-gate.md, tests/parity/*
  - フェーズ担当: test=test-owner; review=code-reviewer
  - 成果物: `docs/ts-parity-gate.md` に golden fixture 比較対象、正規化ルール、acceptance gate を定義する
- [x] 1.4 段階移行・切替・ロールバック手順を定義する
  - 依存: 1.2, 1.3
  - 対象: README.md, docs/ts-cutover-runbook.md
  - フェーズ担当: implement=implementer; review=code-reviewer; test=test-owner
  - 成果物: `docs/ts-cutover-runbook.md` に runner 切替順序、fallback 条件、完了判定を定義する
- [x] 1.5 wrapper 契約を文書化する
  - 依存: 1.1
  - 対象: docs/ts-wrapper-contract.md, openspec/changes/add-typescript-runtime-rewrite-plan/*
  - フェーズ担当: implement=implementer; review=code-reviewer
  - 成果物: wrapper 実行経路、I/O契約、既定解決順、埋め込み `python3` から Deno helper への置換方針を明記する
- [x] 1.6 環境変数互換マトリクスを文書化する
  - 依存: 1.1
  - 対象: docs/ts-env-compat-matrix.md, openspec/changes/add-typescript-runtime-rewrite-plan/*
  - フェーズ担当: spec_check=spec-checker; test=test-owner
  - 成果物: env 一覧、デフォルト値、型、優先順位、互換可否を明記する

## 2. TypeScript 実装タスク
- [x] 2.1 TypeScript プロジェクト骨格を作成する
  - 依存: 1.1, 1.2
  - 対象: src/**, deno.json, deno.lock
  - フェーズ担当: implement=implementer; review=code-reviewer
  - 成果物: `src/domain`, `src/application`, `src/infrastructure`, `src/cli` の最小構成を作成する
- [x] 2.2 domain / persona / policy 系を移植する
  - 依存: 2.1
  - 対象: src/domain/**, src/infrastructure/persona/**
  - フェーズ担当: implement=implementer; spec_check=spec-checker
  - 成果物: Task/Persona/Policy の型・正規化ロジックを Python と等価に実装する
- [x] 2.3 openspec compiler/template を移植する
  - 依存: 2.2
  - 対象: src/infrastructure/openspec/**, src/cli/**
  - フェーズ担当: implement=implementer; spec_check=spec-checker; test=test-owner
  - 成果物: `compile-openspec` / `print-openspec-template` が Python と同等に動作する
- [x] 2.4 state store と orchestrator を同一マイルストーンで移植する
  - 依存: 2.2
  - 対象: src/infrastructure/state/**, src/application/orchestrator/**, src/domain/**
  - フェーズ担当: implement=implementer; review=code-reviewer; test=test-owner
  - 成果物: state 遷移・claim/handoff/approval・persona handoff を Python と等価に実装する
- [x] 2.5 provider / adapter / wrapper 連携を移植する
  - 依存: 2.4
  - 対象: src/infrastructure/provider/**, src/infrastructure/adapter/**, src/cli/**
  - フェーズ担当: implement=implementer; review=code-reviewer
  - 成果物: `subprocess adapter -> codex_wrapper.sh -> codex exec` 経路を維持して run 実行できる
  - 注記: `codex_wrapper.sh` の実行経路・I/O 契約は維持し、置換対象は内部の埋め込み `python3` 部分に限定する
- [x] 2.8 codex_wrapper の埋め込み Python を Deno helper に置換する
  - 依存: 2.5
  - 対象: codex_wrapper.sh, src/infrastructure/wrapper/**, docs/ts-wrapper-contract.md
  - フェーズ担当: implement=implementer; review=code-reviewer; test=test-owner
  - 成果物: prompt 生成 / `.env` スナップショット検証 / 4行結果抽出を Deno helper で実行し、外部挙動を維持する
- [x] 2.9 npm 生成物ビルドスクリプトを実装する
  - 依存: 2.1
  - 対象: scripts/build_npm.ts, npm/**
  - フェーズ担当: implement=implementer; review=code-reviewer; test=test-owner
  - 成果物: `scripts/build_npm.ts` で npm 配布物が再生成でき、`npm link` 運用に利用できる
- [x] 2.10 runner 更新スクリプトを build 主体へ整理する
  - 依存: 2.9
  - 対象: scripts/update_runner.sh, docs/ts-cutover-runbook.md
  - フェーズ担当: implement=implementer; review=code-reviewer
  - 成果物: `scripts/update_runner.sh` が再 install ではなく再生成（build）主体の更新フローを提供する
- [x] 2.11 開発運用手順を README に追記する
  - 依存: 2.9, 2.10
  - 対象: README.md
  - フェーズ担当: spec_check=spec-checker; review=code-reviewer; test=test-owner
  - 成果物: 初回 `npm link`、日常ループ（`build_npm.ts --watch`）、`./node_modules/.bin/agent-dock` 実行手順を明記する
- [x] 2.6 parity テスト基盤を実装する
  - 依存: 2.3, 2.4, 2.5, 2.8
  - 対象: tests/parity/**, docs/ts-parity-gate.md
  - フェーズ担当: test=test-owner; spec_check=spec-checker
  - 成果物: compile/state/主要 CLI フローの Python vs TS 比較テストを実装する
- [x] 2.7 切替判定とロールバック手順を実行可能化する
  - 依存: 2.6
  - 対象: README.md, docs/ts-cutover-runbook.md
  - フェーズ担当: review=code-reviewer; test=test-owner
  - 成果物: 切替条件を満たした場合のみ TS 実装へ切替し、失敗時は Python へ戻せる状態にする

## 3. 検証項目

- [x] 3.1 ドキュメント互換を実行検証する
  - 依存: 2.7
  - 対象: openspec/changes/add-typescript-runtime-rewrite-plan/*, docs/*.md, README.md
  - フェーズ担当: review=code-reviewer; spec_check=spec-checker
  - 成果物: `openspec validate add-typescript-runtime-rewrite-plan --strict` 成功と、design/contract/runbook/env の必須記述確認結果を残す
- [x] 3.2 CLI 互換を実行検証する
  - 依存: 2.7
  - 対象: src/cli/**, team_orchestrator/cli.py, tests/parity/**, docs/ts-parity-gate.md
  - フェーズ担当: review=code-reviewer; spec_check=spec-checker
  - 成果物: `compile-openspec` / `print-openspec-template` / エラー系 / `--help` の互換検証結果を残す
- [x] 3.3 wrapper 互換を実行検証する
  - 依存: 2.8
  - 対象: codex_wrapper.sh, src/infrastructure/wrapper/**, docs/ts-wrapper-contract.md
  - フェーズ担当: review=code-reviewer; spec_check=spec-checker
  - 成果物: mode受理、4行出力、stream view、`.env` 保護、Deno前提、APIキー注入の互換検証結果を残す
- [x] 3.4 state.json 互換を実行検証する
  - 依存: 2.7
  - 対象: src/infrastructure/state/**, src/application/orchestrator/**, tests/parity/**
  - フェーズ担当: review=code-reviewer; spec_check=spec-checker
  - 成果物: resume/状態遷移/claim排他/progress_log運用の互換検証結果を残す
- [x] 3.5 compile 互換を実行検証する
  - 依存: 2.6
  - 対象: src/infrastructure/openspec/**, team_orchestrator/openspec_compiler.py, tests/parity/**
  - フェーズ担当: review=code-reviewer; spec_check=spec-checker
  - 成果物: 代表入力のJSON等価、循環検出、`target_paths` 補完、`persona_policy` 検証の互換結果を残す
- [x] 3.6 ファイルロックを実行検証する（テストコード）
  - 依存: 2.7
  - 対象: src/infrastructure/state/**, tests/parity/**, tests/**
  - フェーズ担当: review=code-reviewer; spec_check=spec-checker
  - 成果物: 同時実行破損防止、stale解放、ロック取得タイムアウトの検証結果を残す

### 実行互換性検証（人間による手動実行）
上記の実行タスクがすべて完了した後、人間に以下のコマンドを提示して手動実行を依頼する。

**Python 実行コマンド:**
```bash
ORCHESTRATOR_PROVIDER=mock python -m team_orchestrator.cli \
  --teammate-adapter template \
  --config examples/sample_tasks.json \
  --state-dir /tmp/python_state
```

**TypeScript 実行コマンド:**
```bash
deno run --allow-read --allow-write --allow-run \
  src/cli/main.ts run \
  --teammate-adapter template \
  --config examples/sample_tasks.json \
  --state-dir /tmp/ts_state
```

**検証項目:**
- Kickoff イベントで Provider に渡す snapshot 構造が一致する
- mock provider の Kickoff 応答後の state 更新が一致する
- 最初のタスク claim 対象が一致する
- claim 後の `state.json`（owner, status）が一致する
- plan 呼び出し時の adapter 入力 JSON が一致する
- execute 呼び出し時の adapter 入力 JSON が一致する
- persona phase handoff が同じ順序で実行される
- `requires_plan=true` タスクの承認フローが同じ
- Provider イベント（Kickoff, TaskCompleted, Blocked 等）の発火タイミングが同じ
- mock provider での実行結果が Python 実装と一致する

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
- [ ] 1.1 現行 Python 契約を固定する
  - 依存: なし
  - 対象: team_orchestrator/*.py, tests/*.py, README.md, docs/ts-migration-contract.md
  - フェーズ担当: implement=implementer; review=code-reviewer
  - 成果物: `docs/ts-migration-contract.md` に CLI/state/compile の互換契約（I/O 要件・禁止変更点）を明記する
- [ ] 1.2 TypeScript の目標構成を定義する
  - 依存: 1.1
  - 対象: docs/ts-architecture-blueprint.md, openspec/changes/add-typescript-runtime-rewrite-plan/*
  - フェーズ担当: implement=implementer; spec_check=spec-checker
  - 成果物: `docs/ts-architecture-blueprint.md` に domain/application/infrastructure/cli の責務境界を定義する
- [ ] 1.3 パリティ検証方式を定義する
  - 依存: 1.1
  - 対象: docs/ts-parity-gate.md, tests/parity/*
  - フェーズ担当: test=test-owner; review=code-reviewer
  - 成果物: `docs/ts-parity-gate.md` に golden fixture 比較対象、正規化ルール、acceptance gate を定義する
- [ ] 1.4 段階移行・切替・ロールバック手順を定義する
  - 依存: 1.2, 1.3
  - 対象: README.md, docs/ts-cutover-runbook.md
  - フェーズ担当: implement=implementer; review=code-reviewer; test=test-owner
  - 成果物: `docs/ts-cutover-runbook.md` に runner 切替順序、fallback 条件、完了判定を定義する
- [ ] 1.5 wrapper 契約を文書化する
  - 依存: 1.1
  - 対象: docs/ts-wrapper-contract.md, openspec/changes/add-typescript-runtime-rewrite-plan/*
  - フェーズ担当: implement=implementer; review=code-reviewer
  - 成果物: wrapper 実行経路、I/O契約、既定解決順、埋め込み `python3` から Deno helper への置換方針を明記する
- [ ] 1.6 環境変数互換マトリクスを文書化する
  - 依存: 1.1
  - 対象: docs/ts-env-compat-matrix.md, openspec/changes/add-typescript-runtime-rewrite-plan/*
  - フェーズ担当: spec_check=spec-checker; test=test-owner
  - 成果物: env 一覧、デフォルト値、型、優先順位、互換可否を明記する

## 2. TypeScript 実装タスク
- [ ] 2.1 TypeScript プロジェクト骨格を作成する
  - 依存: 1.1, 1.2
  - 対象: src/**, deno.json, deno.lock
  - フェーズ担当: implement=implementer; review=code-reviewer
  - 成果物: `src/domain`, `src/application`, `src/infrastructure`, `src/cli` の最小構成を作成する
- [ ] 2.2 domain / persona / policy 系を移植する
  - 依存: 2.1
  - 対象: src/domain/**, src/infrastructure/persona/**
  - フェーズ担当: implement=implementer; spec_check=spec-checker
  - 成果物: Task/Persona/Policy の型・正規化ロジックを Python と等価に実装する
- [ ] 2.3 openspec compiler/template を移植する
  - 依存: 2.2
  - 対象: src/infrastructure/openspec/**, src/cli/**
  - フェーズ担当: implement=implementer; spec_check=spec-checker; test=test-owner
  - 成果物: `compile-openspec` / `print-openspec-template` が Python と同等に動作する
- [ ] 2.4 state store と orchestrator を同一マイルストーンで移植する
  - 依存: 2.2
  - 対象: src/infrastructure/state/**, src/application/orchestrator/**, src/domain/**
  - フェーズ担当: implement=implementer; review=code-reviewer; test=test-owner
  - 成果物: state 遷移・claim/handoff/approval・persona handoff を Python と等価に実装する
- [ ] 2.5 provider / adapter / wrapper 連携を移植する
  - 依存: 2.4
  - 対象: src/infrastructure/provider/**, src/infrastructure/adapter/**, src/cli/**
  - フェーズ担当: implement=implementer; review=code-reviewer
  - 成果物: `subprocess adapter -> codex_wrapper.sh -> codex exec` 経路を維持して run 実行できる
  - 注記: `codex_wrapper.sh` の実行経路・I/O 契約は維持し、置換対象は内部の埋め込み `python3` 部分に限定する
- [ ] 2.8 codex_wrapper の埋め込み Python を Deno helper に置換する
  - 依存: 2.5
  - 対象: codex_wrapper.sh, src/infrastructure/wrapper/**, docs/ts-wrapper-contract.md
  - フェーズ担当: implement=implementer; review=code-reviewer; test=test-owner
  - 成果物: prompt 生成 / `.env` スナップショット検証 / 4行結果抽出を Deno helper で実行し、外部挙動を維持する
- [ ] 2.9 npm 生成物ビルドスクリプトを実装する
  - 依存: 2.1
  - 対象: scripts/build_npm.ts, npm/**
  - フェーズ担当: implement=implementer; review=code-reviewer; test=test-owner
  - 成果物: `scripts/build_npm.ts` で npm 配布物が再生成でき、`npm link` 運用に利用できる
- [ ] 2.10 runner 更新スクリプトを build 主体へ整理する
  - 依存: 2.9
  - 対象: scripts/update_runner.sh, docs/ts-cutover-runbook.md
  - フェーズ担当: implement=implementer; review=code-reviewer
  - 成果物: `scripts/update_runner.sh` が再 install ではなく再生成（build）主体の更新フローを提供する
- [ ] 2.11 開発運用手順を README に追記する
  - 依存: 2.9, 2.10
  - 対象: README.md
  - フェーズ担当: spec_check=spec-checker; review=code-reviewer; test=test-owner
  - 成果物: 初回 `npm link`、日常ループ（`build_npm.ts --watch`）、`./node_modules/.bin/agent-dock` 実行手順を明記する
- [ ] 2.6 parity テスト基盤を実装する
  - 依存: 2.3, 2.4, 2.5, 2.8
  - 対象: tests/parity/**, docs/ts-parity-gate.md
  - フェーズ担当: test=test-owner; spec_check=spec-checker
  - 成果物: compile/state/主要 CLI フローの Python vs TS 比較テストを実装する
- [ ] 2.7 切替判定とロールバック手順を実行可能化する
  - 依存: 2.6
  - 対象: README.md, docs/ts-cutover-runbook.md
  - フェーズ担当: review=code-reviewer; test=test-owner
  - 成果物: 切替条件を満たした場合のみ TS 実装へ切替し、失敗時は Python へ戻せる状態にする

## 3. 検証項目

### ドキュメント検証
- [ ] `openspec validate add-typescript-runtime-rewrite-plan --strict` が成功する
- [ ] `design.md` に技術選定（ランタイム、テスト、CLI、YAML、ファイルロック）と選定理由が明記されている
- [ ] `docs/ts-migration-contract.md` に CLI/state/compile の互換境界が列挙されている
- [ ] `docs/ts-parity-gate.md` に比較対象フィールドと正規化ルールが明記されている
- [ ] `docs/ts-cutover-runbook.md` に切替・ロールバック手順と判定基準が明記されている
- [ ] `docs/ts-wrapper-contract.md` に wrapper 経路・入出力契約・Deno helper 置換境界が明記されている
- [ ] `docs/ts-env-compat-matrix.md` に ORCHESTRATOR/TEAMMATE/CODEX env の互換表がある
- [ ] `README.md` に `npm link` を使う開発手順と `./node_modules/.bin/agent-dock` 優先実行ルールが明記されている

### CLI 互換性検証
- [ ] `compile-openspec --change-id ...` の出力 JSON が Python 実装と一致する（正規化後）
- [ ] `print-openspec-template --lang ja` の出力が一致する
- [ ] `print-openspec-template --lang en` の出力が一致する
- [ ] `--config` と `--openspec-change` 同時指定でエラーになる
- [ ] 不正なオプション指定時のエラーメッセージが同等
- [ ] 存在しない `--state-dir` 指定時の挙動が一致する
- [ ] `--help` 出力の主要項目が一致する
- [ ] `./node_modules/.bin/agent-dock --help` でローカルリンク実体の実行確認ができる

### wrapper 互換性検証
- [ ] `codex_wrapper.sh` が `mode=plan|execute` の stdin JSON を受理できる
- [ ] 最終出力が `RESULT/SUMMARY/CHANGED_FILES/CHECKS` の4行契約を満たす
- [ ] `CODEX_STREAM_VIEW=all|all_compact|assistant|thinking` の表示契約が維持される
- [ ] `.env/.env.*` 参照禁止チェックが維持される
- [ ] `.env/.env.*` 改変検知（前後比較）が維持される
- [ ] wrapper 実行時に `deno` を必須とし、`python3` 前提を排除できている
- [ ] `OPENAI_API_KEY` は環境変数注入で利用でき、`.env.*` 参照なしで実行できる
- [ ] `scripts/build_npm.ts` 再生成後、再 install なしでローカルリンク実行に変更が反映される

### state.json 互換性検証
- [ ] 新規実行で生成される `state.json` の構造が Python 実装と一致する
- [ ] `--resume` で Python が生成した state を正しく読み込める
- [ ] task status 遷移（pending → in_progress → completed/blocked）が同じ
- [ ] claim の排他制御が正しく動作する（同時実行テスト）
- [ ] `progress_log` の上限ローテーション（200件）が動作する
- [ ] 空文字の `progress_log` 追記が拒否される

### compile 互換性検証
- [ ] 代表的な `tasks.md` 入力で Python/TS の出力 JSON が一致する
- [ ] `depends_on` 循環検出が同じエラーを返す
- [ ] `target_paths` 未指定時の `["*"]` 自動補完が動作する
- [ ] `persona_policy` の検証エラーが同じ

### ファイルロック検証（テストコードで検証）
- [ ] 複数プロセス同時実行で state 破損が発生しない
- [ ] プロセスクラッシュ後にロックが解放される（stale 検出）
- [ ] ロック取得タイムアウトが動作する

### 実行互換性検証（人間による手動実行）
上記の検証項目がすべて完了した後、人間に以下のコマンドを提示して手動実行を依頼する。

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
- [ ] Kickoff イベントで Provider に渡す snapshot 構造が一致する
- [ ] mock provider の Kickoff 応答後の state 更新が一致する
- [ ] 最初のタスク claim 対象が一致する
- [ ] claim 後の `state.json`（owner, status）が一致する
- [ ] plan 呼び出し時の adapter 入力 JSON が一致する
- [ ] execute 呼び出し時の adapter 入力 JSON が一致する
- [ ] persona phase handoff が同じ順序で実行される
- [ ] `requires_plan=true` タスクの承認フローが同じ
- [ ] Provider イベント（Kickoff, TaskCompleted, Blocked 等）の発火タイミングが同じ
- [ ] mock provider での実行結果が Python 実装と一致する

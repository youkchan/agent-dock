<!-- OPENSPEC:START -->
# OpenSpec Instructions

These instructions are for AI assistants working in this project.

Always open `@/openspec/AGENTS.md` when the request:
- Mentions planning or proposals (words like proposal, spec, change, plan)
- Introduces new capabilities, breaking changes, architecture shifts, or big performance/security work
- Sounds ambiguous and you need the authoritative spec before coding

Use `@/openspec/AGENTS.md` to learn:
- How to create and apply change proposals
- Spec format and conventions
- Project structure and guidelines

Keep this managed block so 'openspec update' can refresh the instructions.

<!-- OPENSPEC:END -->

# エージェントランタイム運用ガイド

## 適用範囲
このリポジトリは、マルチエージェント実行のための再利用可能な協調ランタイムを提供する。

## セットアップ
- Python: `3.10+`
- 外部 Codex CLI 連携時は Node.js `18+`（任意）
- 仮想環境作成と実行:
  - `python3 -m venv .venv`
  - `python -m venv .venv`
  - `source .venv/bin/activate`
  - `python -m unittest discover -s tests -v`

## 開発コマンド
- デモオーケストレーター実行:
  - `python -m team_orchestrator.cli --config examples/sample_tasks.json`
- OpenAI 最小確認実行:
  - `set -a; source .env.orchestrator; set +a`
  - `export OPENAI_API_KEY=...`
  - `export ORCHESTRATOR_REASONING_EFFORT=minimal`
  - `python -m team_orchestrator.cli --config examples/sample_tasks.json --state-dir /tmp/codex_agent_openai_state`
- テスト実行:
  - `python -m unittest discover -s tests -v`

## チーム運用ルール
- `Lead` は調整専任とし、実装タスクを実行しない。
- タスク実行は、排他的 claim により取得した `owner` のみが行う。
- `requires_plan=true` のタスクは承認完了まで実装開始しない。
- すべてのタスクで `target_paths` を定義し、並行編集の重複を避ける。
- 全タスク完了または idle 上限でループを停止する。
- 追跡性のため、メールボックスとタスクボード状態を永続化する。
- Templateアダプタは使用しない。
- `ORCHESTRATOR_PROVIDER=mock` はテスト目的でのみ使用し、本番/実運用実行では使用しない。
- 実運用では `ORCHESTRATOR_PROVIDER=openai`（または将来追加される実プロバイダ）を明示する。

## 指示の優先順
- ルートの `AGENTS.md` はこのリポジトリ全体に適用する。
- 下位ディレクトリの `AGENTS.md` は、必要に応じてより厳しいルールを追加できる。

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
- Deno: `2.x`
- Node.js: `18+`
- 初期確認:
  - `npm install`
  - `deno task check`
  - `deno task test`

## 開発コマンド
- デモオーケストレーター実行:
  - `ORCHESTRATOR_PROVIDER=mock ./node_modules/.bin/agent-dock run --teammate-adapter template --config examples/sample_tasks.json`
- OpenAI 最小確認実行:
  - `set -a; source .env.orchestrator; set +a`
  - `export OPENAI_API_KEY=...`
  - `export ORCHESTRATOR_REASONING_EFFORT=minimal`
  - `export TEAMMATE_ADAPTER=subprocess`
  - `export TEAMMATE_COMMAND="bash ./codex_wrapper.sh"`
  - `./node_modules/.bin/agent-dock run --config examples/sample_tasks.json --state-dir /tmp/codex_agent_openai_state`
- テスト実行:
  - `deno task test`

## チーム運用ルール
- `Lead` は調整専任とし、実装タスクを実行しない。
- タスク実行は、排他的 claim により取得した `owner` のみが行う。
- `requires_plan=true` のタスクは承認完了まで実装開始しない。
- すべてのタスクで `target_paths` を定義し、並行編集の重複を避ける。
- 全タスク完了または idle 上限でループを停止する。
- 追跡性のため、メールボックスとタスクボード状態を永続化する。
- `Template` アダプタは検証用途のみで使用し、本番運用では使用しない。
- `ORCHESTRATOR_PROVIDER=mock` はテスト目的でのみ使用し、本番/実運用実行では使用しない。
- 実運用では `ORCHESTRATOR_PROVIDER=openai`（または将来追加される実プロバイダ）を明示する。
- 指示されていない変更を行わない。
- 過剰な修正を行わない。
- 回答と変更内容を冗長にしすぎない。

## 回答コミュニケーション規約
- 回答は原則 `前段` → `本文` → `詳細` の順で構成する。
- `前段` はコンテキスト共有が目的。少し間が空いた話題では「今どの論点の話か」を先に明示する。
- `本文` は端的に答える。まず抽象度を合わせて結論を短く示し、必要以上に広げない。
- `詳細` は必要な場合のみ出す。ファイル名・関数名・行番号は本文の後段に分離する。
- 「情報量が多いほど良い」とは考えず、判断に必要な最小情報を優先する。
- ユーザーが抽象化を求めた場合は、詳細列挙よりも意図と方針の共有を優先する。
- `正確には` / `厳密には` の補足で先に話を広げない。補足は要求されたときだけ行う。
- 不具合報告・レビュー指摘を複数列挙する場合も、**各項目ごとに** `前段` → `本文` → `詳細` を適用する。
- 不具合報告の `前段` は「その項目が何の論点か」を短く示す。`本文` は結論1-2文。`詳細` に根拠（必要ならファイル参照）を置く。
- 重大度（High/Medium/Low）を付ける場合、重大度ラベルだけ先に示してすぐ本文へ入り、長い前置きを避ける。
- 不具合報告は「問題の説明」で終わらせず、**各項目ごとに対応方針（どう直すか）を必ず記載**する。
- 不具合報告の各項目には、可能な限り `未対応時の影響` と `修正後の期待状態` も短く添える。
- ユーザーが修正を求めている文脈では、各項目に「最小修正案（実施順）」まで書いてから実編集に入る。

## 指示の優先順
- ルートの `AGENTS.md` はこのリポジトリ全体に適用する。
- 下位ディレクトリの `AGENTS.md` は、必要に応じてより厳しいルールを追加できる。

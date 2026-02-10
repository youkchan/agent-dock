# 変更提案: ペルソナを実行主体へ昇格し、フェーズ単位でハンドオフする

## 背景
現状は `teammates` が実行主体で、ペルソナは後段の評価コメント生成のみを担っている。
そのため「実装者/レビュワー/仕様確認者/テスト担当」といった役割制約が実行時に強制されず、レビュー工程や責務分離が弱い。

## 目的
- ペルソナを実行主体として扱い、タスクのフェーズごとに担当ペルソナへハンドオフできるようにする。
- フェーズごとに複数ペルソナが意見できる構造を維持しつつ、状態遷移権限は制御できるようにする。
- OpenSpec 側でのペルソナ指定（利用/非利用）を task_config へ反映し、run 時に実際の挙動へ適用する。

## 変更内容（この change のスコープ）
- task_config にペルソナ実行ポリシーを追加する（既存形式は互換維持）。
- タスク単位でフェーズ定義とフェーズ別ペルソナポリシーを指定可能にする。
- オーケストレーターで実行主体を `teammates` 優先から `personas` 優先へ移行する。
- フェーズごとの「参加ペルソナ」と「状態遷移権限ペルソナ」を分離する。
- OpenSpec compiler で change 由来のペルソナ指定を task_config へ出力する。

## この change でやらないこと
- 各ペルソナの推論モデル最適化（モデル自動切替、コスト最適化アルゴリズム）
- 外部 provider（claude/gemini）専用のペルソナ実行チューニング
- UI ダッシュボードの追加

## 影響範囲
- 影響する仕様:
  - `persona-catalog`（MODIFIED）
  - `persona-gate-engine`（MODIFIED）
  - `openspec-task-config-compiler`（MODIFIED）
  - `orchestrator-openspec-run`（MODIFIED）
- 想定実装対象:
  - `team_orchestrator/models.py`
  - `team_orchestrator/cli.py`
  - `team_orchestrator/orchestrator.py`
  - `team_orchestrator/persona_pipeline.py`
  - `team_orchestrator/openspec_compiler.py`
  - `task_configs/*.json`（コンパイル出力）
  - `tests/*`
  - `README.md`

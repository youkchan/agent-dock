# Codex Agent Teams 風仕様

## 目的
この文書は、Codex を使う複数 Teammate 向けの再利用可能な協調ランタイムを定義する。  
特定プロジェクトに依存せず、他リポジトリにも移植できる設計を目的とする。

## 必須機能
1. 役割分離:
   - `Lead`: 調整専任で実装作業は行わない。
   - `Teammate`: 計画作成と実装実行を担当する。
2. 共有タスクボード:
   - 状態: `pending`, `in_progress`, `completed`
   - 依存関係: `depends_on`
   - 所有者: `owner`
3. 共有メールボックス:
   - API: `send_message(sender, receiver, content, task_id?)`
   - API: `get_inbox(receiver, after_seq?)`
4. Plan 承認ゲート:
   - `requires_plan=true` のタスクは
     `pending -> drafting -> submitted -> approved -> execution`
     の順で進む。
5. 排他的 claim:
   - タスク取得は原子的で、複数プロセスでも安全であること。
   - この実装では共有状態ファイルへのファイルロックを使う。
6. 停止条件:
   - 全タスク完了。
   - 設定ラウンド数の無進捗。
   - 設定秒数の無進捗。

## 非目標
- 完全自動のコード品質保証。
- Git マージコンフリクト解消。
- 単一 LLM ベンダーへの固定。

## データモデル
### Task
- `id`: 一意で安定した識別子。
- `title`: 短い概要。
- `description`: 任意の詳細説明。
- `target_paths`: このタスクの編集対象ファイル/領域。
- `depends_on`: 先行タスク ID 一覧。
- `status`: `pending | in_progress | completed`
- `owner`: 実行担当の Teammate。
- `requires_plan`: 承認付き計画が必須かどうか。
- `plan_status`: `not_required | pending | drafting | submitted | approved | rejected`
- `planner`: 現在の計画草案担当 Teammate。
- `plan_text`, `plan_feedback`: 承認関連の成果物。
- `result_summary`: 実行結果の要約。

### Message
- `seq`: 単調増加の連番。
- `sender`, `receiver`: 送受信先。
- `content`: メッセージ本文。
- `task_id`: 関連タスク（任意）。
- `created_at`: エポック時刻。

## 状態遷移
### 計画フェーズ
1. `pending + requires_plan=true + plan_status=pending`
2. Teammate が計画作成枠を claim -> `plan_status=drafting`
3. Teammate が計画を提出 -> `plan_status=submitted`
4. Lead の判断:
   - approve -> `plan_status=approved`
   - reject -> `plan_status=rejected` かつ `planner` を解除

### 実行フェーズ
1. `pending` タスクは次条件を満たす場合のみ claim 可能:
   - 依存タスクが完了済み
   - `requires_plan=true` の場合は `plan_status=approved`
2. claim 時に `status=in_progress` と `owner=<teammate>` を設定
3. 完了時に `status=completed` を設定

## 競合回避戦略
- 各タスクで `target_paths` を必須とし、所有境界として使う。
- 並列実行時に `target_paths` が重複するタスク割当を避ける。
- 共有状態に対する原子的 claim とファイルロックを使う。

## 運用メモ
- Lead は割当・承認・監視のみを担当する。
- Teammate は未承認の plan 必須タスクを実行しない。
- ログにはラウンド番号、承認、claim、完了を含める。
- 監査可能性のため、状態ディレクトリは実行単位で保存またはアーカイブする。

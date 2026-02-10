# Thin Orchestrator 仕様

## 目的
既存の「Agent Teams 風」ランタイムを維持しつつ、Lead ロジックを薄い Orchestrator モデルへ移行する。  
重い実装処理は Teammate 側（Codex 実行経路）に残す。

## 役割分離
- Teammate:
  - 調査、実装、テスト実行、コード編集を担当する。
  - 報告は短い構造化メッセージのみを送る。
- Orchestrator（Lead）:
  - ルーティングと割当判断。
  - タスクボード状態遷移。
  - 衝突検知と停止判断。
  - `requires_plan` タスクの承認判断。
- Orchestrator はコード実装作業を行わない。

## Provider 抽象化
- Provider の入口:
  - `run(snapshot_json) -> decision_json`
- 対応 Provider:
  - `openai`
  - `claude`（将来対応）
  - `gemini`（将来対応）
  - `mock`
- Provider 切替:
  - `ORCHESTRATOR_PROVIDER=openai|claude|gemini|mock`

## イベント駆動呼び出し
Orchestrator Provider 呼び出しは次イベント時のみ許可する:
1. `Kickoff`
2. `TaskCompleted`
3. `Blocked`
4. `NeedsApproval`
5. `NoProgress`
6. `Collision`

イベントがない tick での Provider 呼び出しは禁止する。

## コスト制御
- 1 ターンあたりの既定トークン予算:
  - 入力: `4000`
  - 出力: `800`
- 環境変数で上書き可能とする。
- 暴発防止のため、コード側でハード上限を持つ。
- Provider へ渡す入力は圧縮済み snapshot のみを使う。
- 生ログ全文は直接渡さない。

## Plan 承認
- `requires_plan=true` タスクは次の順で処理する:
  1. Teammate が plan を提出
  2. タスクを `needs_approval` に遷移
  3. Lead が `approve|reject|revise` を返す
  4. `approve` まで実装は開始しない
- 人手介入モード:
  - `HUMAN_APPROVAL=1` の場合、承認が必要な時点で停止する。

## 共有状態の要件
- タスク状態:
  - `pending`
  - `in_progress`
  - `blocked`
  - `needs_approval`
  - `completed`
- 必須タスク項目:
  - `depends_on`
  - `owner`
  - `target_paths`
- claim 操作は原子的かつプロセス安全であること。

## Decision JSON 契約
Provider は短文の JSON のみを返す:

```json
{
  "decisions": [
    {"type": "approve_plan", "task_id": "T-001", "reason_short": "ok"}
  ],
  "task_updates": [
    {"task_id": "T-001", "new_status": "pending", "plan_action": "approve"}
  ],
  "messages": [
    {"to": "teammate-a", "text_short": "Plan approved, start implementation"}
  ],
  "stop": {"should_stop": false, "reason_short": ""},
  "meta": {
    "provider": "openai",
    "model": "gpt-5-mini",
    "token_budget": {"input": 4000, "output": 800},
    "elapsed_ms": 100
  }
}
```

decision JSON が不正な場合は fail-closed（安全停止または明示的差し戻し）で処理する。

## 停止条件
- 全タスク完了。
- `NoProgress` の連続回数が上限超過。
- 重大な実行エラー。
- 人手承認モードで手動判断待ちが発生。

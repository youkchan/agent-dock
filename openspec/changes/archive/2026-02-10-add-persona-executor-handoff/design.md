## コンテキスト
現行ランタイムは `teammates` が実作業を行い、ペルソナはイベント評価だけを担う。
この構造では、実装/レビュー/仕様確認/テストの責務分離が「コメント」でしか効かず、実行主体に制約が掛からない。

## 目標
- ペルソナを実行主体に昇格する。
- タスクごとにフェーズを持ち、フェーズ単位で担当ペルソナへハンドオフする。
- 各フェーズで複数ペルソナの意見を許可しつつ、状態遷移権限は分離する。
- OpenSpec のペルソナ指定（利用/非利用）を task_config に反映する。

## 非目標
- 実行プロバイダごとの最適化ロジック
- UI 管理画面
- 既存 change 全体の再コンパイル強制

## 設計判断

### 1) task_config 拡張（後方互換）
- 既存キー `meta`, `tasks`, `teammates` は維持する。
- 追加キーを任意として導入する。
  - `personas`: 実行可能ペルソナ定義
  - `persona_defaults`: フェーズ共通ポリシー
  - `tasks[].persona_policy`: タスク単位上書き

### 2) 実行主体の選定
- 新モードでは `personas[].execution.enabled=true` のペルソナを実行候補とする。
- 互換のため、`personas` 未指定時は既存 `teammates` 実行にフォールバックする。
- `teammates` は将来的に deprecated とする。

### 3) フェーズベース制御
- タスクは `phase_order` に従って進行する。
- フェーズごとに以下を持つ。
  - `active_personas`: コメント参加可能
  - `executor_personas`: 実行担当可能
  - `state_transition_personas`: `needs_approval` 等の遷移権限
- 複数ペルソナ参加は許可するが、遷移権限は明示指定のみ有効化する。

### 4) OpenSpec compiler 連携
- change から task_config 生成時に、ペルソナ指定を `meta` と `tasks[].persona_policy` へ落とす。
- 指定ソースは以下を対象とする。
  - タスク記述内のペルソナ指定（フェーズ別）
  - 変更全体のデフォルト指定
  - 利用禁止指定（disable）

### 5) 安全性・運用
- `disable` 指定されたペルソナは、実行/評価の両方から除外する。
- 実行停止系（`blocker`）は `state_transition_personas` と `can_block` の両方を満たす場合のみ有効とする。
- 失敗時ログは task 単位の `progress_log` へ継続保存し、resume で再利用する。

## データモデル案（要点）
```json
{
  "personas": [
    {
      "id": "implementer",
      "role": "implementer",
      "focus": "...",
      "can_block": false,
      "enabled": true,
      "execution": {
        "enabled": true,
        "command_ref": "default",
        "sandbox": "workspace-write",
        "timeout_sec": 900
      }
    }
  ],
  "persona_defaults": {
    "phase_order": ["implement", "review", "spec_check", "test"],
    "phase_policies": {
      "implement": {
        "active_personas": ["implementer"],
        "executor_personas": ["implementer"],
        "state_transition_personas": ["implementer"]
      }
    }
  },
  "tasks": [
    {
      "id": "1.1",
      "persona_policy": {
        "disable_personas": ["spec-checker"],
        "phase_overrides": {
          "review": {
            "active_personas": ["reviewer", "custom-auditor"],
            "executor_personas": ["reviewer"],
            "state_transition_personas": ["reviewer"]
          }
        }
      }
    }
  ]
}
```

## 移行計画
1. 互換モードで導入（`personas` 優先、未指定時は `teammates` 使用）。
2. テストで persona 実行と fallback の両系統を担保。
3. 次段階で `teammates` 必須制約を解除し、deprecated 表示を追加。

## リスクと緩和
- リスク: ポリシー未設定で担当不在になる
  - 緩和: 既定フェーズポリシーを必須化し、未設定時は起動失敗
- リスク: 複数意見で状態遷移が競合する
  - 緩和: 遷移権限ロールを別フィールドで明示し、競合時は deterministic 優先順を適用
- リスク: compiler の入力差異で期待と異なる task_config が生成される
  - 緩和: 生成物に `meta.persona_resolution` を出力して監査可能にする

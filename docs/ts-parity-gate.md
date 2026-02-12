# TypeScript移行 parity gate 定義

## 目的
TypeScript 実装が Python 参照実装と互換であることを、golden fixture 比較で機械的に判定する。  
本書は比較対象・正規化ルール・acceptance gate を固定し、`spec > design > 実装` の優先順位で解釈する。

## 1. Golden Fixture 比較対象

### 1.1 compile parity（必須）
- 入力 fixture:
  - `openspec/changes/<change-id>/tasks.md`
  - `task_configs/overrides/<change-id>.yaml`（存在時）
- 比較対象（`compile-openspec` 出力 JSON）:
  - `teammates`
  - `tasks[].id`
  - `tasks[].title`
  - `tasks[].description`
  - `tasks[].target_paths`
  - `tasks[].depends_on`
  - `tasks[].requires_plan`
  - `tasks[].persona_policy`
  - `persona_defaults`
  - `personas`
  - `meta.verification_items`
- 除外:
  - 仕様で未定義の拡張メタデータ（比較対象に列挙されていないキー）

### 1.2 state parity（必須）
- 入力 fixture:
  - 同一 task config で実行した Python / TS の state snapshot 群
  - 比較ポイント: bootstrap 後、claim 後、plan 提出後、approval 後、完了後、resume 復旧後
- 比較対象（`state.json`）:
  - `tasks.<id>.title`
  - `tasks.<id>.description`
  - `tasks.<id>.status`
  - `tasks.<id>.owner`
  - `tasks.<id>.planner`
  - `tasks.<id>.requires_plan`
  - `tasks.<id>.plan_status`
  - `tasks.<id>.depends_on`
  - `tasks.<id>.target_paths`
  - `tasks.<id>.persona_policy`
  - `tasks.<id>.current_phase_index`
  - `tasks.<id>.progress_log[].source`
  - `tasks.<id>.progress_log[].text`
  - `messages[]`
  - `meta.sequence`
  - `meta.progress_counter`
- 除外（揮発値）:
  - `tasks.<id>.created_at`
  - `tasks.<id>.updated_at`
  - `tasks.<id>.completed_at`
  - `tasks.<id>.progress_log[].timestamp`
  - `messages[].created_at`
  - `meta.last_progress_at`

### 1.3 CLI parity（必須）
- 比較対象コマンド:
  - `run`
  - `compile-openspec`
  - `print-openspec-template`
  - エラー系（例: `--config` と `--openspec-change` の同時指定）
- 比較対象:
  - `run` 開始時ログ:
    - `[run] run_mode=<new-run|resume-run>`
    - `[run] progress_log_ref=<state.json path>::tasks.<task_id>.progress_log`
    - （該当時）`[run] resume_requeued_in_progress=<task_id_csv>`
  - `run` 最終 JSON:
    - `stop_reason`
    - `elapsed_seconds`（存在チェックのみ）
    - `summary`
    - `tasks_total`
    - `provider_calls`
    - `provider`
    - `human_approval`
    - `persona_metrics`
  - `compile-openspec`: 標準出力 1 行（出力先パス）
  - `print-openspec-template`: テンプレート本文（余計な前後出力なし）
  - compile 失敗時: `openspec compile error: <detail>`

## 2. 正規化ルール（比較前処理）
比較前に Python / TS の出力へ同一正規化を適用する。  
正規化ルールは `openspec/changes/add-typescript-runtime-rewrite-plan/design.md` の「5) 比較時の正規化ルール（ぶれ防止）」を正とする。

### 2.1 共通 JSON 正規化
- JSON は UTF-8 として decode し、再シリアライズ時にキー昇順で比較する。
- 改行コードは `LF` に統一する。
- 文字列配列は要素の前後空白を trim して扱う。

### 2.2 配列正規化
- `tasks[]` は `id` 昇順にソートして比較する。
- `depends_on` は文字列化 + trim 後に重複除去し、昇順で比較する。
- `target_paths` は trim 後に空要素を除外し、重複除去 + 辞書順で比較する。
- `messages[]` は `seq` 昇順で比較する。

### 2.3 仕様補完後比較
- 仕様上の自動補完値は補完後の最終値を比較する。
- 例:
  - `target_paths` 未指定は `["*"]` 補完後に比較する。
  - `requires_plan=false` かつ `plan_status` 欠落は `not_required` と同値扱いで比較する。

### 2.4 揮発値の除外
- タイムスタンプ・経過秒などの実行時揺らぎは比較対象から除外する。
- `elapsed_seconds` は値一致ではなく「キー存在」と「非負数」を判定する。
- CLI エラー出力はスタックトレース差異を吸収するため、意味メッセージ（例: 排他制約違反文言）で比較する。

## 3. Acceptance Gate

### 3.1 Gate 判定
- Gate-A（compile parity）:
  - 全 golden fixture で `1.1` が一致すること。
- Gate-B（state parity）:
  - 全シナリオの各比較ポイントで `1.2` が一致すること。
  - `progress_log` は `source/text` の系列一致を必須とする。
- Gate-C（CLI parity）:
  - `1.3` の全コマンド比較が一致すること。
  - `run` の必須開始ログ 2 行と最終 JSON 必須キーが一致すること。

### 3.2 合格条件
- Gate-A/B/C がすべて `PASS`。
- `FAIL` / `ERROR` / `SKIP` が 0 件。
- 差分がある場合は fail-closed（移行完了判定を禁止）とする。

### 3.3 運用ルール
- parity gate 合格までは Python 実装を本番 runner として維持する。
- fixture 更新は「仕様変更（spec/design/contract）に追従する場合のみ」許可する。
- fixture 更新時は、変更理由と影響範囲を同一 PR に記録する。

## 4. tests/parity 配下の標準構成
実装タスク（2.6）で以下の構成を使用する。

```text
tests/parity/
  README.md
  fixtures/
    compile/
    state/
    cli/
```

- `fixtures/compile`: compile 入力と expected 正規化済み JSON
- `fixtures/state`: 実行ステップごとの state snapshot
- `fixtures/cli`: コマンド実行入出力（stdout/stderr/exit code）

## 5. 必須実行チェック
parity 実装導入前後で、少なくとも以下の既存テストを常時通過させる。

- `python -m unittest discover -s tests -v`

## 6. parity テスト実装（task 2.6）
- テスト本体: `tests/parity/test_parity.py`
- state シナリオ生成:
  - `tests/parity/scenarios/state_scenario_python.py`
  - `tests/parity/scenarios/state_scenario_ts.ts`
- fixture:
  - `tests/parity/fixtures/compile/basic/*`
  - `tests/parity/fixtures/state/basic/*`
  - `tests/parity/fixtures/cli/basic/*`

実行コマンド:
- `python -m unittest tests.parity.test_parity -v`
- `python -m unittest discover -s tests -v`

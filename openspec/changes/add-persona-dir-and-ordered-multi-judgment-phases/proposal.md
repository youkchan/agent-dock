# Change: review/spec_check/test の順序付き多人数運用と外部ペルソナ読込を仕様化

## Why
agent-dock 本体と実行対象プロジェクトを分離して運用する運用形態で、プロジェクト固有ペルソナを外部ディレクトリから注入する前提が不足している。
review/spec_check/test の複数担当運用では、実行順・`changes_required` 集約タイミング・差し戻し回数の扱いが運用ルール化されておらず、実務上の差戻しループが肥大化していた。

## What Changes
- `--persona-dir <dir>`（1件のみ）を追加し、`run` と `spec-creator` の両方で同一のペルソナ解決経路を扱う。
  - `spec-creator` は `run --config` 実行時に `--persona-dir` を透過的に引き渡す。
  - ペルソナ解決は `run --config` の `task_config` トップレベル `personas` とあわせて行う。
  - 入力フォーマットは `<dir>/personas.json`（PersonaDefinition JSON配列）に固定し、ディレクトリ走査は行わない。
  - `<dir>` 不在、`personas.json` 不在、JSON パース失敗、スキーマ不一致は fail-closed で停止する。
  - ペルソナ解決の優先順を `default -> payload.personas -> persona-dir` とする。
  - 同一 id は完全上書き、異なる id は追加とする。
- review/spec_check/test フェーズを複数担当可とし、implement フェーズは複数担当不可として固定する。
  - `run --openspec-change` 経路では compile error で fail-closed する。
  - `run --config` 経路では実行開始時の runtime validation error で fail-closed する。
- フェーズ内実行順は「フェーズ担当」の記述順（左から右）で順次実行し、フェーズ内の結果を順守した運用にする。
- `blocked` は従来どおり安全側動作を維持し、1人でも `blocked` があればそのフェーズで即時 `blocked` 確定する。
- `changes_required` はフェーズ内担当者全員の実行完了後に集約し、`any` の場合のみ implement へ差し戻す。差し戻しは「1回に限定」する。
- 次フェーズ進行条件は `blocked` なし かつ `changes_required` なし（実質的に全担当 pass）とする。
- `revision_count` は差し戻し実行 1 回ごとに +1 とし、上限判定は既存どおり `revision_count > max_revision_cycles` を維持する。
- `payload.personas` は `run --config` の `task_config` JSON トップレベル `personas` から読み込むことを確定する。

## Impact
- 影響仕様: judge フェーズ実行フロー、判定集約ルール、差し戻しガード、ペルソナ解決優先順位。
- 影響範囲: `run --config` と `spec-creator` の設定解決、review/spec_check/test 判定制御、implement 遷移時の `blocked/changes_required/revision_count` ハンドリング。

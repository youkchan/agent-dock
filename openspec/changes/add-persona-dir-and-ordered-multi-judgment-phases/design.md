# Design

## 1. 方針

- review / spec_check / test のみ複数担当を許可し、implement は単数固定。
- implement の単数制約は二重保証し、`run --openspec-change` は compile 時、`run --config` は実行開始時に fail-closed する。
- 複数担当はフェーズ定義順（左→右）で実行し、順序を保存する。
- blocked は「1人でも blocked なら即時 blocked」とし、結果確定処理を優先する。
- changes_required はフェーズ内全担当完了後に OR 集約し、`true` の場合のみ implement へ 1 回のみ差し戻す。
- revision_count は差し戻し1回につき `+1`、上限判定は既存どおり `revision_count > max_revision_cycles`。

## 2. ペルソナ解決

- 解決優先順位は `default -> payload.personas -> persona-dir`。
- `--persona-dir <dir>` は 1 つのみ受け付ける。
- `--persona-dir` の入力フォーマットは `<dir>/personas.json` 固定とし、`*.yaml` などのディレクトリ走査は行わない。
- `<dir>/personas.json` は `task_config.personas` と同一スキーマの PersonaDefinition 配列（JSON配列）とする。
- `<dir>` 不在、`personas.json` 不在、JSON パース失敗、スキーマ不一致は runtime validation error として fail-closed する。
- マージ後の persona 集合を基準に `persona_policy.phase_overrides.<phase>.executor_personas` の id 妥当性を検証し、`--persona-dir` で追加した id も有効なフェーズ担当として扱う。
- `run` と `spec-creator` は同一の `--persona-dir` 契約を持つ。
- `spec-creator` は実行フェーズで `run --config` を呼ぶ際に、受け取った `--persona-dir` をそのまま引き渡す。
- 既存ペルソナとの衝突時は同一 `id` を完全上書き、異なる `id` は追加（配列置換ではなくマージ）。
- `payload.personas` は `run --config` で読み込まれる task_config JSON トップレベル `personas` を参照する。

## 3. 判定統合ロジック

- blocked が先行した場合は他担当の結果を待たずに「blocked」固定。
- blocked でなければ、フェーズ内担当結果から
  - `any(changes_required)` と `all(passed)` を集約。
- 次フェーズ遷移条件は `blocked=false` かつ `changes_required=false`（実質全員 pass）。

## 4. 代替案とトレードオフ

- 代替案: changes_required を担当ごとに implement へ都度戻す
  - 却下: 同一フェーズ内で差し戻しが増え、review コストと revision 増が必要以上に増加する。
- 代替案: implement を複数担当許可
  - 却下: 責務の分散で差分競合・最終決定責任が曖昧化し、レビュー工程の統制が崩れる。
- 代替案: 無制限に並列実行
  - 却下: レビュー順序や再試行時点の観測可能性が下がり、運用上の再現性が悪化する。

## design.md を作成する判断
この変更は以下に該当するため、`design.md` を作成して設計判断を固定する。
- 複数モジュール（`models` / `orchestrator` / `state_store`）に跨る遷移変更
- state への新規項目（`revision_count`, `max_revision_cycles`）追加
- 無限ループ防止と承認停止を含む運用上の安全性判断
- persona 経路限定という互換性境界の明示が必要

## コンテキスト
現状の persona 実行は、フェーズ成功時に次フェーズへ機械的に handoff する。
そのため review/spec_check が修正要求を返しても、差し戻し遷移がなく、判定フェーズ側で修正継続が起き得る。

## 決定事項とトレードオフ
### 1) 判定値を `pass|changes_required|blocked` に統一する
- 決定: `PhaseJudgment = Literal["pass", "changes_required", "blocked"]` を導入し、review/spec_check/test の結果をこの3値へ正規化する。
- トレードオフ: 表現力は3値に制限されるが、遷移分岐が単純化され実装と監査の一貫性が上がる。

### 2) `changes_required` は implement へ強制差し戻しする
- 決定: 判定フェーズで `changes_required` の場合、`status=pending`、`owner=null`、`current_phase_index=implement` を適用する。
- トレードオフ: handoff 回数は増えるが、実装担当と判定担当の責務分離を強制できる。

### 3) revision cycle guard を導入する
- 決定: `changes_required` ごとに `revision_count` を加算し、`revision_count > max_revision_cycles` で `needs_approval` へ遷移して自動実行を停止する。
- トレードオフ: 早期に人手承認が必要になる可能性はあるが、無限差し戻しループを確実に止められる。

### 4) 差し戻し理由を progress log と mailbox の両方へ記録する
- 決定: `changes_required` 時は `task id`、`phase`、`reason`、`revision_count` を標準文言で保存する。
- トレードオフ: ログ量は増えるが、追跡性と再現性を確保できる。

### 5) 新挙動は persona 実行経路のみに適用する
- 決定: teammate 実行モード（persona でない経路）は既存遷移を維持する。
- トレードオフ: 分岐管理コストは増えるが、既存ユーザーへの回帰リスクを抑えられる。

## 非目標
- Lead provider の decision JSON 仕様変更
- 既存 task config フォーマットの全面変更
- provider 切替ロジックの変更

## design.md を作成する判断
この変更は以下に該当するため、`design.md` を作成して設計判断を固定する。
- 複数モジュール（`models` / `orchestrator` / `state_store`）に跨る遷移変更
- state への新規項目（`revision_count`, `max_revision_cycles`）追加
- 無限ループ防止と承認停止を含む運用上の安全性判断
- persona 経路限定という互換性境界の明示が必要

## コンテキスト
現状の persona 実行は、フェーズ成功時に次フェーズへ機械的に handoff する。
そのため review/spec_check が修正要求を返しても、差し戻し遷移がなく、判定フェーズ側で修正継続が起き得る。
また execute 出力契約は `RESULT: completed|blocked` の2値のみで、`changes_required` を受け取る入力契約が未定義である。

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
- 決定: `revision_count` は task 作成時 `0` で開始し、`changes_required` 差し戻し時のみ `+1` する。
- 決定: `max_revision_cycles` は task 単位の非負整数とし、未設定時は compile 時に既定値 `3` を補完する。
- 決定: `max_revision_cycles` が負数または整数以外の場合は compile を fail-closed で失敗させる。
- 決定: `revision_count` は task が `completed` または `blocked` へ終端遷移するまで保持し、途中の `pass` ではリセットしない。
- 決定: `--resume` 時は state の `revision_count` を保持し、再初期化しない。
- 決定: 境界条件は `>` を正とし、`revision_count == max_revision_cycles` では継続可能、`revision_count > max_revision_cycles` で停止する。

### 4) 差し戻し理由を progress log と mailbox の両方へ記録する
- 決定: `changes_required` 時は `task id`、`phase`、`reason`、`revision_count` を標準文言で保存する。
- トレードオフ: ログ量は増えるが、追跡性と再現性を確保できる。

### 5) 判定フェーズの出力契約に `JUDGMENT` を追加する
- 決定: review/spec_check/test では `RESULT` に加えて `JUDGMENT: pass|changes_required|blocked` を必須化する。
- 決定: 解釈優先順位は `RESULT=blocked` > `JUDGMENT` とし、矛盾・欠落・未知値は `blocked` へ倒す（fail-closed）。
- 決定: wrapper 契約は互換拡張とし、implement は既存4行を維持、review/spec_check/test は `JUDGMENT` を追加した5行を必須とする。
- トレードオフ: wrapper/helper/orchestrator の同時更新が必要になるが、判定入力の再現性を担保できる。

### 6) 非 implement フェーズ編集を `CHANGED_FILES` で強制ブロックする
- 決定: review/spec_check/test で `CHANGED_FILES` が非空なら、判定値に関わらず編集違反として `blocked` へ遷移する。
- 決定: `CHANGED_FILES` の正規空表現は `(none)` とし、互換入力として `none` / `-` / 空文字も空として正規化する。
- 決定: 併せて persona 実行設定は implement=`workspace-write`、review/spec_check/test=`read-only` を既定にする。
- 決定: `execution.sandbox` は実行時に `CODEX_SANDBOX` として反映し、設定値が実行経路に未配線のままにならないようにする。
- トレードオフ: 誤検知時の停止が増える可能性はあるが、implement-only 編集制約を実行時に強制できる。

### 7) 新挙動は persona 実行経路のみに適用する
- 決定: teammate 実行モード（persona でない経路）は既存遷移を維持する。
- トレードオフ: 分岐管理コストは増えるが、既存ユーザーへの回帰リスクを抑えられる。

### 8) implement への差し戻しインデックス解決を固定する
- 決定: `changes_required` 時は当該 task の `phase_order` から `implement` の index を探索し、その index を `current_phase_index` に設定する。
- 決定: `phase_order` に `implement` が存在しない task 構成は compile 時にエラーとして reject する（実行時フォールバックは行わない）。
- トレードオフ: compile 制約が厳格化されるが、戻し先曖昧性を排除できる。

### 9) test フェーズの終端規則を固定する
- 決定: 判定フェーズで `pass` の場合は `phase_order` に従って前進し、次フェーズがある場合は handoff、ない場合は `completed` とする。
- 決定: test フェーズで `changes_required` の場合は implement へ差し戻す。
- 決定: test フェーズで `blocked` の場合は既存 blocked 遷移を維持する。
- トレードオフ: 分岐は増えるが、最終フェーズ解釈の実装ブレを排除できる。

## 非目標
- Lead provider の decision JSON 仕様変更
- 既存 task config フォーマットの全面変更
- provider 切替ロジックの変更

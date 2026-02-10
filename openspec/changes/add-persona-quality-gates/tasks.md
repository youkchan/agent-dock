## 1. 実装タスク
- [x] 1.1 ペルソナ定義スキーマとデフォルト4ペルソナを追加する
  - 成果物: `id/role/focus/can_block/enabled` を持つ定義、ロード時バリデーション
- [x] 1.2 プロジェクト上書き/追加ローダーを実装する
  - 成果物: 同名 `id` 完全上書き、非同名は追加、未知キー拒否
- [x] 1.3 オーケストレーターへペルソナ評価パイプラインを組み込む
  - 成果物: イベント処理中にペルソナ指摘を生成・集約する導線
- [x] 1.4 severity ごとの制御アクションを実装する
  - 成果物: `info/warn/critical/blocker` の統一挙動、`persona_blocker:<id>` 停止
- [x] 1.5 コメント上限（デフォルト2件/イベント）と優先度ソートを実装する
  - 成果物: 上限超過時の決定的トリミング
- [x] 1.6 CLI/設定・READMEを更新する
  - 成果物: ペルソナ設定導線、運用ポリシー、制限事項
- [x] 1.7 テストを追加する
  - 成果物: マージ規則、重大度遷移、停止条件、上限、回帰テスト
- [x] 1.8 `can_block=false` の `blocker` を `critical` 相当へフォールバックする
  - 成果物: 即停止を発生させず `needs_approval` 遷移に統一する制御
- [x] 1.9 ペルソナ評価の計測情報を実行結果へ出力する
  - 成果物: severity別件数、`persona_blocker` 停止有無、`warn` 再確認キュー残数の集計

## 2. 検証項目
- [x] `python -m unittest discover -s tests -v` が通る
- [x] custom ペルソナ（`can_block=true`）の `blocker` 指摘で `stop_reason=persona_blocker:<persona_id>` になる
- [x] 同名ペルソナ衝突時に project 定義が完全採用される
- [x] 1イベント内コメント件数が既定上限2件を超えない
- [x] `can_block=false` のペルソナが `blocker` を出しても即停止せず、`critical` 相当（`needs_approval`）として扱われる
- [x] 実行結果に severity別件数、`persona_blocker` 停止有無、`warn` 再確認キュー残数が出力される

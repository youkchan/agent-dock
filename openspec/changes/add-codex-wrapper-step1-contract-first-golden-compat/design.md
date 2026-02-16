# Design

## Context
- `codex_wrapper.sh` を既定エントリポイントとして維持しつつ、`helper.ts` の将来 TS 化を破綻なく進める。
- 実装仕様の境界が曖昧だと parser/判定ロジックの差異が静かに混入するため、Step1 ではまず現行契約を固定化する。
- したがってこの設計文書は「実装可否の条件を明確化する必要がある場合」に限定し、ここで合意できないと次フェーズへ進めない。

## Goals
- Step1 で「現行動作の同値性」を壊さず、`codex_wrapper.sh` を既定経路で継続する。
- `RESULT/SUMMARY/CHECKS/CHANGED_FILES/JUDGMENT` と `RESULT_PHASE` の解釈を明文化し、差分比較で使う Golden 判定に直接接続する。
- `codex_wrapper.sh` と `src/infrastructure/wrapper/helper.ts` の Step1 分担を固定し、将来の TS 実装切替時のロールバック容易性を担保する。
- 設計文書自体は契約/比較条件に限定し、表示文言やフォーマット最適化は次 change へ委譲する。

## Non-Goals
- codex 自体の API 仕様変更
- 実行順序、sandbox、外部プロセス起動の変更
- `RESULT/JUDGMENT/CHANGED_FILES/CHECKS` の解釈を変えるような意味論変更
- 新規外部依存追加、UX/レポート文言の最適化

## Decisions
- Decision A（契約先行）: コード変更前に現行挙動を契約化する。仕様不整合は実装承認を阻止条件とする。
  - 固定対象:
    - `RESULT`/`SUMMARY`/`CHANGED_FILES`/`CHECKS` の存在条件と必須/任意キー
    - `RESULT_PHASE` の解釈と `extract-result` の前提
    - 空 payload / JSON parse 失敗 / 異常分類時の exit code（`2/3/4`）と stderr 種別
    - `CODEX_STREAM_VIEW` の分岐 (`assistant`/`thinking`/`all_compact`/`all`)
    - `.env*` 読み込み拒否対象（設定ファイル保護）の境界
- Decision B（golden 比較）: 既存 shell 実装を基準値化し、固定入力に対する結果ブロック・stderr・終了コードを比較する。
- Decision C（2層化）: Step1 は shell 継続 + TS 入口差し込み準備に限定し、実行経路の既定値は不変。
  - `CODEX_WRAPPER_RUNTIME`（既定: `legacy`）を経路選択キーとして設計し、`ts` は Step1 では未対応として即 fail。
- Decision D（差分ゼロ）: 将来の TS 直接化前提として、比較対象は `result block`、`exit code`、`stderr` の 3 点でゼロ差分を基準化。
- Decision E（変更不可原則）: I/O 契約・判断意味・既存分類の基本動作は Step1 で不変。表示整形だけは必要なら許容。
- Decision F（design.md の生成条件）: 本件のように「契約・移行経路・比較条件が未定義なため実装誤差が発生し得る場合」だけ design を作成し、単純実装タスクのみなら design を省略する。

## Contract Specification (Step1)
- `RESULT_KEYS`（必須）:
  - `RESULT`（値は `completed` または `blocked`）
  - `SUMMARY`
  - `CHANGED_FILES`
  - `CHECKS`
- `OPTIONAL_RESULT_KEYS`（任意）:
  - `JUDGMENT`
- `exit code`:
  - `helper.ts`（`build-prompt`/`snapshot-dotenv`/`verify-dotenv`/`extract-result`）: 不正入力・必須env不足・`RESULT_PHASE` 不正・`result block` 抽出失敗は `2`
  - `helper.ts`（`verify-dotenv` 不一致）: `4`
  - `codex_wrapper.sh`: 空 stdin -> `2`、codex 実行失敗は原則透過、`TMP_OUTPUT` が空なら fail-closed `3`。
  - 予期しない内部失敗は既存の `1` を維持
- `CHANGED_FILES` は `extractResultBlock` では文字列として受け取り、空文字は正規化して `(none)` と扱う（`RESULT=blocked` を特別扱いしない）。
- `RESULT_PHASE`:
  - `RESULT_PHASE` は `helper.ts` では必須（`implement`/`review`/`spec_check`/`test` 以外は `missing or invalid RESULT_PHASE`）。
  - `extract-result` は最終の `RESULT:` 行を起点にブロックを解析し、空行で打ち切る。
  - 同一ブロック内の重複キーは失敗扱い（重複拒否）。
- stderr:
  - 既存本文は原則不変
  - 分類は本文の固定フレーズで `input-validation` / `environment` / `codex-fail` / `result-block` を識別可能に固定する。

## Risks / Trade-offs
- 仕様の過不足: ここで固定したら実装の自由度は下がるが、差分ゼロ保証に必要な最小契約を先に固定することで後戻りリスクを下げる。
- 過度な保守性優先: shell 側の文言固定を維持し続けるため、UI/UX 改善は意図的に遅らせる。
- ゴールデン更新コスト: 対象ケースを増やすと初回維持コストが上がるが、比較の確度が上がるため長期保守性は改善する。
- runtime 分岐の将来導線: Step1 で `ts` を未対応のまま明示 fail させることで、現行運用を壊さず TS 導線の土台を安全に残せる。

## Migration Plan
- この change の完了条件:
  - `codex_wrapper.sh` は既定入り口を維持し、現行フロー変更なし
  - 主要契約を doc で固定し、曖昧点（exit code / RESULT_PHASE / 空 CHANGED_FILES）を明文化
  - Golden 比較用の観測項目を Step1 で共通化
- Step1 実施内容（実装チーム）:
  - `codex_wrapper.sh` は現行 subcommand 呼び出しをそのまま保持
  - `CODEX_WRAPPER_RUNTIME` を導入し、`legacy` 時は 0 改変
  - `ts` は Step1 では未実装として明示的失敗
  - helper は契約固定に対応する定数明文化、サブコマンド API 分割、テスト追加を Step1 で実施
- 受け入れ条件:
  - `openspec validate add-codex-wrapper-step1-contract-first-golden-compat --strict` 通過
  - 既存 golden 回帰テストの比較差分ゼロ（result block / exit code / stderr）
  - 実行時の既存外部 I/O 契約を維持

## Test Design
- 最低カバレッジ:
  - `extract-result` 正常ケース（`RESULT` 行含有、`SUMMARY`/`CHANGED_FILES` 正常、重複拒否）
  - `extract-result` 例外ケース（missing result block、`stale` line 混在、`RESULT_PHASE` 未設定）
  - `RESULT_PHASE` 未設定・不正値
- 検証軸:
  - shell 実装（現行）を Golden とし、将来の TS 実装との差分は 0 であることを確認
  - ストリームビューは `assistant/thinking/all_compact/all` 全ルートを固定入力で検証

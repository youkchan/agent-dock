# Design: refactor-spec-creator-and-orchestrator-modularization

## design.md を作成する判断
この変更は以下に該当するため、`design.md` を作成・維持して設計判断を固定する。
- `main.ts` / `spec_creator.ts` / `orchestrator.ts` / `helper.ts` など複数モジュールに跨る責務再編
- 実行結果解釈（RESULT/SUMMARY/CHANGED_FILES/CHECKS/JUDGMENT）の共通化という横断判断
- 段階的移行順序を誤ると挙動差分が混入しやすい領域
- テスト green だけでなく意味論（sendback/blocked/イベント順序）の不変条件を明示する必要

## Context
- `spec-creator` / `orchestrator` 周辺は単一ファイルへの責務集中が進み、変更時の影響範囲とレビュー観点の追跡が難しい。
- 仕様上は通るが運用上の意味論がずれる問題が発生しており、構造起因の再発リスクがある。
- 本 change は「挙動不変」を前提に、責務分割と共通化のみを行う。

## Goals
- 構造分割で変更影響を局所化する。
- レビュー時に確認すべき責務境界を固定する。
- 完了判定を形式一致だけでなく意味論一致まで安定化する。

## Non-Goals
- 新規機能追加、判定ルール変更、公開シグネチャ変更。
- 責務分割と無関係な最適化、広域リネーム、仕様文言変更。

## 判定時系列と固定ゲート
- 判定時系列は `implement -> review -> spec_check -> test` を固定し、段階責務の逆流を許容しない。
- `review` で `REVIEWER_STOP:requirement_drift|over_editing|verbosity` を検出した場合は blocker として停止する。
- `test` 完了判定では `ORCHESTRATOR_PROVIDER=mock` 単独実行を不合格とし、`not implemented` は未完了扱いにする。
- 実行結果の入力契約は `RESULT` / `SUMMARY` / `CHANGED_FILES` / `CHECKS` / `JUDGMENT` の5キーを共通正規化対象とする。
- 利用可能性は `tasks.md` の `personas` 定義（`execution.enabled=true`, `command_ref=default`）とフェーズ割当で担保する。

## Decisions and Trade-offs

### 1) 分割順序を固定する
決定:
1. `src/cli/main.ts` 分割
2. result parser 共通化（`src/domain/execution_result.ts`）
3. `spec_creator.ts` 本線/補助分離
4. `orchestrator.ts` 段階抽出

理由:
- 依存の浅い領域から先に分割し、最難所の `orchestrator.ts` を最後に回すことで回帰時の原因切り分けを容易にする。

トレードオフ:
- 先行タスクで一時的な重複状態が残る期間が生まれるが、同時多発の大規模変更より安全性を優先する。

### 2) 「挙動不変」を公開契約と回帰テストで二重固定する
決定:
- `main.ts` に残す公開 export（`main`, `buildTeammateAdapter`, `defaultTeammateCommand`, `parseTeammatesArg`, `collectSpecCreatorApplyManifestForTest`）は不変とする。
- 完了条件は既存テスト green と `deno check` による型整合を必須化する。

理由:
- リファクタの目的は構造改善であり、外部契約の変更は別 change で扱うべきため。

トレードオフ:
- 内部設計の自由度は下がるが、利用側への影響を最小化できる。

### 3) result parser は共通化するが wrapper 固有制約は分離維持する
決定:
- `extractResultBlock` と `parseExecutionResultBlock` の重複は `src/domain/execution_result.ts` に集約する。
- forbidden command 検査など wrapper 固有制約は共通層に取り込まない。

理由:
- 共通化対象を「出力フォーマット解釈」に限定し、ドメイン責務と実行基盤責務の境界を保つ。

トレードオフ:
- 完全統合より実装重複が一部残る可能性はあるが、責務汚染と将来の副作用を抑制できる。

### 4) `spec_creator.ts` は再export ハブへ縮小する
決定:
- prompt/context/polish utilities を別モジュールへ分離し、`spec_creator.ts` は import 互換維持のハブとする。

理由:
- 本線実行経路を追いやすくし、テスト専用補助ロジックとの混在を解消する。

トレードオフ:
- ファイル数増加で探索コストは上がるが、責務境界が明確になりレビュー漏れを減らせる。

### 5) `orchestrator.ts` は pure 関数抽出から段階移行する
決定:
- 先に pure 関数を抽出し、次に decision 評価、最後に decision 実行を抽出する。
- `this.store` / `this.log` / `this.makeEvent` 依存は境界を明示しつつ引数化を進める。

理由:
- もっとも壊れやすい領域であり、責務移動と仕様変更を混在させると回帰要因を特定できなくなるため。

トレードオフ:
- 最終形到達まで段階数が増え実装期間は伸びるが、イベント順序・sendback・blocked 条件の不変を守りやすい。

## Fail-Closed 境界
- CLI 分割: 公開 export 互換崩れまたは `src/cli/main_test.ts` 失敗時は受け入れ不可。
- result parser 共通化: `src/infrastructure/wrapper/helper_test.ts` / `src/application/orchestrator/orchestrator_test.ts` 失敗時は受け入れ不可。
- `spec_creator.ts` 分離: `src/infrastructure/openspec/spec_creator_test.ts` 失敗または実行経路差分検出時は受け入れ不可。
- orchestrator 段階抽出: イベント順序・sendback・blocked 条件の差分検出時は受け入れ不可。

## Alternatives Considered
- 代替案: `main.ts` / parser / `spec_creator.ts` / `orchestrator.ts` を一括分割
  - 却下理由: 変更面積が大きすぎて差分原因の切り分けが困難になり、挙動不変保証が弱くなる。
- 代替案: parser 共通化を見送り、重複実装を維持
  - 却下理由: 判定解釈のズレ温床が残り、意味論一致の安定化という目的に反する。
- 代替案: `orchestrator.ts` をクラス分割から先に実施
  - 却下理由: 依存注入境界が曖昧なまま構造変更すると仕様変更混入リスクが高い。

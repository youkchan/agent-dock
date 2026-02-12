# TypeScript移行 目標アーキテクチャブループリント

## 目的
TypeScript 実装への移行時に、責務の混在を防ぎ、互換性検証を容易にするためのレイヤ境界を固定する。

## 適用範囲
- `src/domain/**`
- `src/application/**`
- `src/infrastructure/**`
- `src/cli/**`

## レイヤ責務（固定）

| レイヤ | 主責務 | 許可される依存 | 禁止事項 |
|---|---|---|---|
| `domain` | Task/Persona/Decision の型、ドメイン検証、正規化ルール | なし（同レイヤ内のみ） | ファイルI/O、HTTP、CLI引数解釈、外部SDK直接呼び出し |
| `application` | use case 実行、orchestrator loop、状態遷移制御、approval/handoff 制御 | `domain`、`application` 内 Port/Interface | 具体的なファイルパス操作、subprocess 直接実行、外部APIクライアント直接生成 |
| `infrastructure` | state保存、provider 呼び出し、wrapper 連携、OpenSpec compile 入出力、Port 実装 | `domain`、`application` の Port/型 | ドメイン判断の再定義、CLIポリシー判断の重複実装 |
| `cli` | サブコマンド定義、引数検証、設定組み立て、エントリポイント提供 | `application`、`infrastructure` の composition root | 業務ルール実装、state 遷移ロジック実装、compile ルール本体実装 |

## 1. Domain 境界
- Domain は「純粋ロジック層」とし、副作用を持たない（MUST）。
- 以下を Domain に配置する（MUST）。
  - Task/Plan/Persona/Decision などのエンティティ・値オブジェクト
  - `normalize_*` 相当の strict validation
  - parity 比較で使う正規化関数（キー順、配列順、補完後比較）
- Domain の失敗は例外または Result 型で fail-closed とする（MUST）。

## 2. Application 境界
- Application はユースケース実行順序を定義し、外部依存には Port 経由でアクセスする（MUST）。
- 以下を Application に配置する（MUST）。
  - `run` 実行ループ
  - task claim/execute/review/handoff/approve の制御
  - `requires_plan=true` の承認ゲート制御
- Application は具体実装を知らず、`StateStorePort` / `ProviderPort` / `TeammateAdapterPort` へ依存する（MUST）。

## 3. Infrastructure 境界
- Infrastructure は Application Port の実装を提供する（MUST）。
- サブモジュール責務を次の通り固定する（MUST）。
  - `infrastructure/state`: `state.json` と lock の排他・永続化
  - `infrastructure/provider`: mock/openai provider 実装と decision schema 検証
  - `infrastructure/adapter`: `codex_wrapper.sh` 呼び出しと stream 取り込み
  - `infrastructure/openspec`: `tasks.md` compile と template 出力
- Infrastructure は「仕様を変える判断」を持ってはならない（MUST NOT）。
  - 例: status 列挙値の追加、CLI フラグ意味変更、`target_paths` 補完規則変更

## 4. CLI 境界
- CLI は入出力境界としてのみ振る舞う（MUST）。
- 維持対象サブコマンド:
  - `run`
  - `compile-openspec`
  - `print-openspec-template`
- `--config` と `--openspec-change` の排他条件は CLI 層で即時検証する（MUST）。
- CLI は実行時に dependency graph を構築し、Application に委譲する（MUST）。

## 5. 依存方向ルール（固定）
- 基本方向は `cli -> application -> domain`（MUST）。
- `infrastructure -> domain` は許可、`application -> infrastructure(具体実装)` は禁止（MUST NOT）。
- 具体実装注入は `cli` の composition root でのみ行う（MUST）。
- 循環依存は全レイヤで禁止（MUST NOT）。

## 6. 互換性を守る境界面
- CLI 互換、state 互換、compile 互換の判定は `domain + application` の契約を正とし、`infrastructure` はその実現手段とする。
- `state.json` の互換対象フィールド、compile 比較対象フィールドは `docs/ts-migration-contract.md` に従う。
- parity 比較の正規化ルールは `openspec/changes/add-typescript-runtime-rewrite-plan/design.md` の定義を正とする。

## 7. 実装チェックリスト（レビュー基準）
- 変更が domain に入るべきか、infrastructure に入るべきかを説明できる。
- Application から具体 I/O API を直接呼んでいない。
- CLI が業務ロジックを持っていない。
- 互換契約（CLI/state/compile）を破る変更がない。

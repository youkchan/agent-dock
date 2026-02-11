## ADDED Requirements

### Requirement: TypeScript 移行は既存 CLI 契約を維持すること
システムは TypeScript 実装への移行時、既存の主要 CLI 契約（`run`, `compile-openspec`, `print-openspec-template`）を維持しなければならない（SHALL）。

#### Scenario: 主要サブコマンドが同等に実行できる
- **WHEN** ユーザーが TypeScript 実装の `agent-dock` を実行する
- **THEN** 既存 Python 実装と同じサブコマンド群が利用できる
- **AND** 既存運用手順の破壊的変更が発生しない

#### Scenario: 主要オプションの意味が維持される
- **WHEN** `--resume`, `--resume-requeue-in-progress`, `--openspec-change`, `--save-compiled`, `--teammate-adapter` を指定して実行する
- **THEN** Python 実装と同じ意味で解釈される
- **AND** `--config` と `--openspec-change` の排他制約が維持される
- **AND** `design.md` の CLI 互換に列挙された主要オプション群（`--provider`, `--teammate-command`, `--plan-command`, `--execute-command`, `--state-dir` を含む）と矛盾しない

### Requirement: TypeScript 移行は state 互換を維持すること
システムは TypeScript 実装でも `state.json` の主要フィールドと状態遷移意味を維持しなければならない（SHALL）。

#### Scenario: 同一 state_dir で再開意味が維持される
- **WHEN** Python 実装が出力した state を TypeScript 実装が `--resume` で読み込む
- **THEN** task status / owner / progress_log の意味が維持される
- **AND** task の `title` / `description` が維持される
- **AND** 不整合がある場合は fail-closed で明示エラーになる

#### Scenario: progress log の運用ルールが維持される
- **WHEN** タスク実行中に progress log が追記される
- **THEN** 空文字ログは拒否される
- **AND** 上限件数ローテーション（既定 200）が維持される

### Requirement: TypeScript 移行は OpenSpec compile 互換を担保すること
システムは TypeScript 実装での compile 結果が、仕様上 Python 実装と等価になることを検証しなければならない（SHALL）。

#### Scenario: 同一入力で compile 結果がパリティ判定を満たす
- **WHEN** 同一 `openspec/changes/<change-id>/tasks.md` を Python 実装と TypeScript 実装で compile する
- **THEN** `teammates`, `tasks[].id/title/description/target_paths/depends_on/requires_plan/persona_policy`, `persona_defaults`, `personas`, `meta.verification_items` が等価である
- **AND** 差分がある場合は移行ゲートで失敗する

### Requirement: parity 比較は正規化ルールを固定すること
システムは parity 比較時に、比較前の正規化ルールを固定しなければならない（SHALL）。

#### Scenario: 正規化済み比較で判定が安定する
- **WHEN** Python 実装と TypeScript 実装の JSON を比較する
- **THEN** キー順、tasks の `id` 順、依存配列の正規化ルールが適用される
- **AND** 正規化ルールは `design.md` の「5) 比較時の正規化ルール（ぶれ防止）」に従う
- **AND** 揮発値（時刻など）は比較対象から除外される

### Requirement: プラットフォーム方針を固定すること
システムは本 change のスコープとして、対応対象 OS と非対応 OS を明示しなければならない（SHALL）。

#### Scenario: Windows をスコープ外として扱う
- **WHEN** 本 change の受け入れ条件を定義する
- **THEN** Windows は非対応（スコープ外）として扱われる
- **AND** `macOS` と `Linux` を対応対象とする
- **AND** Windows CI / Windows 動作検証は必須条件に含めない

### Requirement: 仕様解釈の優先順位を固定すること
システムは仕様解釈の優先順位を固定し、判定のぶれを防止しなければならない（SHALL）。

#### Scenario: 参照優先順位で解釈が一意に決まる
- **WHEN** spec と design の解釈差が疑われる
- **THEN** `spec > design > 実装` の順で解釈する
- **AND** 実装は spec と design の定義を逸脱してはならない

### Requirement: codex wrapper 実行経路を互換維持すること
システムは TypeScript 移行期間中、`subprocess adapter -> codex_wrapper.sh -> codex exec` の実行経路を維持しなければならない（SHALL）。

#### Scenario: 既定 wrapper 経路が維持される
- **WHEN** `--teammate-command` 未指定で run を実行する
- **THEN** 実行ファイル隣の `codex_wrapper.sh` が既定で使用される
- **AND** Python 実装と同等の入出力契約で動作する

### Requirement: codex wrapper の内部ヘルパは Deno に移行すること
システムは `codex_wrapper.sh` の外部契約を維持したまま、埋め込み `python3` 処理を Deno helper に移行しなければならない（SHALL）。

#### Scenario: wrapper の外部挙動を維持したまま内部実装を移行する
- **WHEN** TypeScript 移行で wrapper 内部実装を更新する
- **THEN** prompt 生成 / `.env` スナップショット検証 / 4行結果抽出は Deno helper で実行される
- **AND** wrapper の入力契約（stdin JSON: `mode`, `teammate_id`, `task`）は維持される
- **AND** wrapper の出力契約（`RESULT` / `SUMMARY` / `CHANGED_FILES` / `CHECKS`）は維持される

#### Scenario: wrapper 実行時のランタイム前提を Deno に統一する
- **WHEN** `codex_wrapper.sh` を実行する
- **THEN** wrapper は `deno` を必須前提として起動する
- **AND** wrapper 経路では `python3` 前提を要求しない

### Requirement: 環境変数契約を互換維持すること
システムは定義済みの `ORCHESTRATOR_*`, `TEAMMATE_*`, `CODEX_*` 環境変数および `OPENAI_API_KEY` を互換維持しなければならない（SHALL）。

#### Scenario: env 優先順位が維持される
- **WHEN** 同一設定が CLI 引数と環境変数の両方で指定される
- **THEN** `CLI引数 > 環境変数 > デフォルト` の優先順位が適用される
- **AND** 既存運用スクリプトを変更せずに実行できる

#### Scenario: API キーを `.env.*` 参照なしで扱える
- **WHEN** `OPENAI_API_KEY` が環境変数として注入されて run を実行する
- **THEN** wrapper と orchestrator は `.env.*` 参照なしで実行できる
- **AND** API キー取得方法の意味は Python 実装と矛盾しない

### Requirement: wrapper のストリーム表示契約を維持すること
システムは wrapper のストリーム表示モード（`all`, `all_compact`, `assistant`, `thinking`）の意味を維持しなければならない（SHALL）。

#### Scenario: stream view のモード意味が維持される
- **WHEN** `CODEX_STREAM_VIEW=all|all_compact|assistant|thinking` を切り替えて run する
- **THEN** 各モードで表示対象と省略方針が Python 実装と同等である
- **AND** 実行失敗時のエラーログ出力契約が維持される

### Requirement: wrapper の `.env` セキュリティ契約を維持すること
システムは wrapper における `.env/.env.*` 参照禁止と改変検知を維持しなければならない（SHALL）。

#### Scenario: `.env` 参照禁止と改変検知が継続する
- **WHEN** タスク payload に `.env/.env.*` 参照が含まれる、または実行中に `.env/.env.*` が変更される
- **THEN** wrapper は fail-closed で明示エラーにする
- **AND** 参照禁止と改変検知の両方が Deno helper 移行後も有効である

### Requirement: TypeScript 移行は段階切替を前提にすること
システムは移行期間中、Python 実装へのフォールバック手段を維持しなければならない（SHALL）。

#### Scenario: 切替後に回帰が検出された場合に戻せる
- **WHEN** TypeScript 実装への切替後に回帰が検出される
- **THEN** 定義済み手順で Python 実装へロールバックできる
- **AND** 運用停止時間を最小化できる

### Requirement: TypeScript 移行は互換性ゲートを満たすまで完了扱いにしないこと
システムは定義された parity gate（テスト・fixture 比較・主要フロー検証）を満たすまで移行完了と判定してはならない（MUST NOT）。

#### Scenario: parity gate 未達で完了判定が拒否される
- **WHEN** 互換検証のいずれかが失敗している
- **THEN** 移行ステータスは完了にならない
- **AND** 次段階への進行は停止される

#### Scenario: gate の合格条件を満たしたときのみ切替できる
- **WHEN** 定義済み parity gate（compile/state/主要 CLI フロー）がすべて合格している
- **THEN** TypeScript 実装への切替判定が可能になる
- **AND** 未合格項目が残る限り Python runner を維持する

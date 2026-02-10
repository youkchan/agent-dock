## 0. Persona Defaults
- persona_defaults.phase_order: implement, review, spec_check, test
- persona_defaults: {"phase_order":["implement","review","spec_check","test"]}
- フェーズ担当: implement=implementer; review=code-reviewer; spec_check=spec-checker; test=test-owner
- personas: [{"id":"implementer","role":"implementer","focus":"実装を前進させる","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}},{"id":"code-reviewer","role":"reviewer","focus":"品質と回帰リスクを確認する","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}},{"id":"spec-checker","role":"spec_guard","focus":"仕様逸脱を防ぐ","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}},{"id":"test-owner","role":"test_guard","focus":"検証の十分性を担保する","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}}]

### 0.1 テンプレート利用ルール
- この雛形を `openspec/changes/<change-id>/tasks.md` にコピーし、`<...>` を実タスクで置換する。
- `persona_defaults.phase_order` と `フェーズ担当` の固定行は削除しない。
- `personas:` は **1行JSON** で記述する（YAMLの複数行形式は compiler が受理しない）。
- ペルソナを実行主体にする場合は `personas` 行を残す。消すと実行主体は `teammate-*` になる。
- 各タスクに `- フェーズ担当:` を記述し、`implement=implementer; review=code-reviewer; spec_check=spec-checker; test=test-owner` から必要なフェーズだけ選ぶ。
- 例: `- フェーズ担当: implement=implementer; review=code-reviewer`（未指定フェーズはグローバル既定を使う）。

## 1. 実装タスク
- [ ] 1.1 デフォルトペルソナ YAML を新設する
  - フェーズ担当: implement=implementer
  - 依存: なし
  - 対象: `team_orchestrator/personas/default/*.yaml`
  - 成果物: デフォルト4ペルソナ（implementer, code-reviewer, spec-checker, test-owner）を独立ファイルとして定義する
- [ ] 1.2 `persona_catalog.py` のデフォルト読込をファイル化する
  - フェーズ担当: implement=implementer
  - 依存: 1.1
  - 対象: `team_orchestrator/persona_catalog.py`
  - 成果物: コード直書き定義を廃止し、`personas/default/*.yaml` から読込む実装へ移行する
- [ ] 1.3 project payload の上書き/追加互換を維持する
  - フェーズ担当: review=code-reviewer
  - 依存: 1.2
  - 対象: `team_orchestrator/persona_catalog.py`
  - 成果物: 同名 `id` 完全上書き・非同名追加の既存挙動を維持する
- [ ] 1.4 execution profile 互換を維持する
  - フェーズ担当: implement=implementer
  - 依存: 1.2
  - 対象: `team_orchestrator/persona_catalog.py`
  - 成果物: `execution` の読込/未指定時挙動を既存どおり維持する
- [ ] 1.5 バリデーションとエラーを整備する
  - フェーズ担当: spec_check=spec-checker
  - 依存: 1.2
  - 対象: `team_orchestrator/persona_catalog.py`
  - 成果物: 欠落/重複/未知キー/型不一致（execution 含む）を明示エラー化する
- [ ] 1.6 テストを更新する
  - フェーズ担当: test=test-owner
  - 依存: 1.2, 1.3, 1.4, 1.5
  - 対象: `tests/test_cli.py`, `tests/test_orchestrator.py`
  - 成果物: デフォルト読込・上書き互換・異常系・execution互換の回帰テストを追加/更新する
- [ ] 1.7 README を更新する
  - フェーズ担当: review=code-reviewer
  - 依存: 1.6
  - 対象: `README.md`
  - 成果物: ペルソナ定義の配置、上書き順序、execution互換の説明を追記する

## 2. 検証項目
- [ ] `python -m unittest discover -s tests -v` が通る
- [ ] デフォルト4ペルソナがファイルから読まれる
- [ ] project payload で同名 `id` が完全上書きされる
- [ ] `execution` 指定あり/なしの両ケースで読込互換が維持される
- [ ] `personas` 未指定時の teammates fallback 挙動が変わらない

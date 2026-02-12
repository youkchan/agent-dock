## ADDED Requirements
### Requirement: デフォルト4ペルソナはtakt由来の実装注意事項をマージ反映すること
システムは default persona カタログの4ペルソナ（`implementer`, `code-reviewer`, `spec-checker`, `test-owner`）に対し、既存 `focus` の意図を保持したまま、`takt` の persona/instruction/policy 由来の実装注意事項を `focus` にマージ反映しなければならない（SHALL）。

#### Scenario: implementer が実装時禁止事項と検証姿勢を保持する
- **WHEN** `implementer` の default persona 定義を更新する
- **THEN** `focus` には「推測実装の禁止」「不要な後方互換/過剰変更の禁止」「事実確認に基づく修正姿勢」が含まれる

#### Scenario: code-reviewer が品質ゲート観点を保持する
- **WHEN** `code-reviewer` の default persona 定義を更新する
- **THEN** `focus` には「構造/設計レビュー」「AI由来アンチパターン検出」「曖昧指摘の禁止」「ブロッキング基準」が含まれる

#### Scenario: spec-checker と test-owner が仕様/検証観点を保持する
- **WHEN** `spec-checker` と `test-owner` の default persona 定義を更新する
- **THEN** `spec-checker.focus` には「仕様逸脱防止」「ソース・オブ・トゥルースでの裏取り」が含まれる
- **AND** `test-owner.focus` には「テストカバレッジ/品質重視」「計画と実装の突合」「テスト実行の必須化」が含まれる

#### Scenario: 既存focusの要点を維持してtakt由来要素を追加する
- **WHEN** default 4 persona の `focus` を更新する
- **THEN** 既存 `focus` に含まれていた要点（役割のコア責務）は削除されない
- **AND** `takt` 由来の実装注意事項が追記・統合される

### Requirement: takt由来移植後も既存ペルソナ読込互換を維持すること
システムは takt 由来の内容移植後も、既存 persona loader の入力スキーマ互換を維持しなければならない（SHALL）。

#### Scenario: 既存 loader で default persona が継続読込できる
- **WHEN** runtime が `personas/default/*.yaml` を読み込む
- **THEN** 読込は既存パーサで成功する
- **AND** 各 persona は既存キー（`id`, `role`, `focus`, `can_block`, `enabled`, optional `execution`）のみを持つ

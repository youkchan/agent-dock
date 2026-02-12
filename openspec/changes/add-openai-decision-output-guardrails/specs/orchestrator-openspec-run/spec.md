## ADDED Requirements

### Requirement: Lead decision JSON 出力を上限付きで生成すること
システムは OpenAI Lead の decision JSON 出力を、定義済みの件数・文字数上限内で生成しなければならない（SHALL）。

#### Scenario: decision 出力が上限を超えない
- **WHEN** Lead が `decisions` / `task_updates` / `messages` を返す
- **THEN** 各配列は定義済みの件数上限以内である
- **AND** `reason_short` / `text_short` / `feedback` は定義済み文字数上限以内である

### Requirement: Provider snapshot は未完了タスク中心で送信すること
システムは Provider へ渡す snapshot から不要文脈を除外し、未完了タスク中心の情報だけを送信しなければならない（SHALL）。

#### Scenario: completed タスクを除外して送信する
- **WHEN** Provider snapshot を構築する
- **THEN** `status=completed` のタスクは snapshot に含めない
- **AND** `recent_messages` は定義済み件数上限以内に圧縮される

### Requirement: max_output_tokens incomplete を1回だけ再問い合わせすること
システムは OpenAI 応答が `incomplete` かつ `reason=max_output_tokens` の場合、1回だけ最小再問い合わせを実施しなければならない（SHALL）。

#### Scenario: incomplete 応答で1回再試行する
- **WHEN** OpenAI 応答が `status=incomplete` かつ `incomplete_details.reason=max_output_tokens` になる
- **THEN** システムは1回だけ最小再問い合わせを実施する
- **AND** 再問い合わせ成功時は通常の decision 適用を継続する

#### Scenario: 再問い合わせでも不正なら停止する
- **WHEN** 再問い合わせ後も JSON 契約を満たせない
- **THEN** 実行は fail-closed で停止する
- **AND** エラーには `status` / `incomplete_details` を含む診断情報が出力される

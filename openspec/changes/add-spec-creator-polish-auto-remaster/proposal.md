# Change: Spec Creator polish の自動リマスター能力を追加する

## Why
- Agent Dock と openspec の仕様更新（implement フェーズ必須化、判定値3値化、5行契約）により、既存の polish 仕様は現行ルールでの受理が担保されない。
- proposal/design/tasks/spec の更新漏れが発生しやすく、手作業では論理矛盾（要件追加時の反映不足）を解消しきれない。
- 仕様修正を機械置換ではなく、最新基準に基づく AI 主導の再設計（再構築）として実行する。

## What Changes
- `agent-dock spec-creator polish <change_id> [--feedback "..."]` を追加し、入力コンテキストとして `openspec/changes/<change_id>/` 配下の全 `.md` を収集する。
- CLI契約は `spec-creator polish` を正規経路とし、`spec-creator` 直実行は legacy create 経路（deprecate）として扱う。未知サブコマンドや `polish` の引数不正は fail-closed で拒否する。
- 再生成対象は `proposal.md` `tasks.md` `code_summary.md` `specs/**/spec.md` とし、`design.md` は必要時のみ生成または更新する。
- `SpecCreator` に `polish` フローを実装し、対象 change の既存ファイル群を収集して「最新基準（5行契約・3値判定・implement必須）」とユーザー `--feedback` を統合したプロンプトを生成する。
- Codex 呼び出しはタスク単位で1回以上（複数回）を許容し、入力コンテキストは `openspec/changes/<change_id>/` 配下の全 `.md` を収集した上で、各呼び出しにはプロンプト長上限内でベストエフォート投入する。最終的に再生成対象ファイルを相互矛盾のない形で上書きし、`design.md` は必要時のみ生成または更新する。
- 生成完了後に `openspec validate <change_id> --strict` を必須実行し、失敗時は fail-closed として更新を確定しない。成功時反映は全対象ファイルを atomic（all-or-nothing）で行う。
- 実装タスクでは `target_paths` と `関連許可(related_paths)` を「編集ヒント」として扱い、実行時の強制ブロック条件にはしない。
- 追加編集の理由は `SUMMARY` へ記録を推奨するが、機械的な必須条件にはしない。
- `CHANGED_FILES` は変更なし時に `(none)` を明示し、judge 判定は `pass | changes_required | blocked` の3値に正規化して扱う。

## Impact
- Affected spec: `spec-creator polish`（対象仕様）
- Affected code:
  - `src/cli/main.ts`
  - `src/cli/main_test.ts`
  - `src/infrastructure/openspec/spec_creator.ts`
  - `src/infrastructure/openspec/spec_creator_test.ts`
  - `src/infrastructure/openspec/spec_creator_quality_test.ts`

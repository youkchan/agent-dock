# code_summary.md

## task_id: 1.1
- code_unit: spec-creator polishing input validation & task orchestration gate
- 対象パス: src/cli/main.ts / src/infrastructure/openspec/spec_creator.ts
- 入力コンテキスト: openspec/changes/<change_id>/ 配下の全 .md
- 再生成対象: proposal.md / tasks.md / code_summary.md / specs/**/spec.md / (必要時)design.md

## task_id: 1.2
- code_unit: markdown artifact collection and prompt context assembly
- 対象パス: src/infrastructure/openspec/spec_creator.ts / src/infrastructure/openspec/spec_creator_test.ts
- 入力コンテキスト: openspec/changes/<change_id>/ 配下の全 .md
- 再生成対象: proposal.md / tasks.md / code_summary.md / specs/**/spec.md / (必要時)design.md

## task_id: 1.3
- code_unit: `polish()` orchestration and Codex multi-file parse path
- 対象パス: src/infrastructure/openspec/spec_creator.ts / src/infrastructure/openspec/spec_creator_test.ts
- 入力コンテキスト: openspec/changes/<change_id>/ 配下の全 .md
- 再生成対象: proposal.md / tasks.md / code_summary.md / specs/**/spec.md / (必要時)design.md

## task_id: 1.4
- code_unit: CLI subcommand wiring
- 対象パス: src/cli/main.ts / src/cli/main_test.ts
- 入力コンテキスト: openspec/changes/<change_id>/ 配下の全 .md
- 再生成対象: proposal.md / tasks.md / code_summary.md / specs/**/spec.md / (必要時)design.md

## task_id: 1.5
- code_unit: post-polish strict validation
- 対象パス: src/infrastructure/openspec/spec_creator.ts / src/infrastructure/openspec/spec_creator_test.ts / src/cli/main.ts / src/cli/main_test.ts
- 入力コンテキスト: openspec/changes/<change_id>/ 配下の全 .md
- 再生成対象: proposal.md / tasks.md / code_summary.md / specs/**/spec.md / (必要時)design.md
- command: `openspec validate <change_id> --strict`

## task_id: 1.6
- code_unit: final review consistency for context-and-target boundary
- 対象パス: openspec/changes/add-spec-creator-polish-auto-remaster/
- 入力コンテキスト: openspec/changes/<change_id>/ 配下の全 .md
- 再生成対象: proposal.md / tasks.md / code_summary.md / specs/**/spec.md / (必要時)design.md

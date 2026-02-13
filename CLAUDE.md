# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Agent Dock is a TypeScript coordination runtime for multi-agent systems. It uses a "Lead + Teammates" model where a Lead agent orchestrates multiple Teammate agents. The Lead only makes JSON decisions while Teammates handle implementation work.

## Development Commands

```bash
# Setup
npm install
deno task check
deno task test
./node_modules/.bin/agent-dock --help

# Run with mock provider (testing)
ORCHESTRATOR_PROVIDER=mock ./node_modules/.bin/agent-dock run \
  --teammate-adapter template \
  --config examples/sample_tasks.json

# Run with OpenAI provider
set -a; source .env.orchestrator; set +a
export OPENAI_API_KEY="..."
export TEAMMATE_ADAPTER="subprocess"
export TEAMMATE_COMMAND="bash ./codex_wrapper.sh"
./node_modules/.bin/agent-dock run \
  --config examples/sample_tasks.json \
  --state-dir /tmp/state

# Resume a run
./node_modules/.bin/agent-dock run \
  --config examples/sample_tasks.json \
  --state-dir /tmp/state \
  --resume

# OpenSpec compile
./node_modules/.bin/agent-dock compile-openspec \
  --change-id <change-id> \
  --openspec-root ./openspec

# OpenSpec template generation
./node_modules/.bin/agent-dock print-openspec-template --lang en
```

## Architecture

### Core Components

| Module | Purpose |
|--------|---------|
| `src/application/orchestrator/orchestrator.ts` | Main event loop, Lead decision logic |
| `src/infrastructure/state/store.ts` | JSON state persistence with file locking, mailbox, collision detection |
| `src/infrastructure/provider/factory.ts` | LLM abstraction (Mock, OpenAI implementations) |
| `src/infrastructure/adapter/subprocess.ts` / `src/infrastructure/adapter/template.ts` | Teammate adapter implementations |
| `src/infrastructure/wrapper/helper.ts` / `codex_wrapper.sh` | Wrapper prompt/result handling, dotenv guard, Codex exec bridge |
| `src/application/orchestrator/persona_pipeline.ts` / `src/infrastructure/persona/catalog.ts` | Persona-based quality gates and phase routing |
| `src/infrastructure/openspec/compiler.ts` | Markdown -> JSON task config compilation |
| `src/cli/main.ts` | CLI entry point |
| `src/domain/task.ts` | Task model definitions |

### Event-Driven Model

The Lead provider is only called on specific events (not every tick):
- `Kickoff`, `TaskCompleted`, `Blocked`, `NeedsApproval`, `NoProgress`, `Collision`

### Task States

`pending` -> `in_progress` -> `completed` | `blocked` | `needs_approval`

Tasks with `requires_plan=true` require approval before execution (states: `not_required` -> `pending` -> `drafting` -> `submitted` -> `approved` -> `executed`).

### Persona System

Default personas: `implementer`, `code-reviewer`, `spec-checker`, `test-owner` (defined in `personas/default/`).

Tasks flow through configurable phases (e.g., `implement -> review -> spec_check -> test`) with persona evaluation at each phase.

### Provider Selection

- `ORCHESTRATOR_PROVIDER=mock` - Testing only
- `ORCHESTRATOR_PROVIDER=openai` - Production use

## Key Conventions

- Lead is orchestration-only, no implementation
- All tasks must define `target_paths` to avoid parallel editing conflicts
- Exclusive task ownership via claim mechanism
- `TemplateTeammateAdapter` is for testing only; use `SubprocessCodexAdapter` in production
- Input to Lead is compressed snapshots, not raw logs

## OpenSpec Workflow

When the request involves proposals, specs, changes, new capabilities, or architecture shifts:

1. Read `openspec/AGENTS.md` for detailed instructions
2. Search existing work: `openspec list`, `openspec spec list --long`
3. Scaffold: `proposal.md`, `tasks.md`, optional `design.md`, and delta specs
4. Validate: `openspec validate <change-id> --strict`
5. Implement only after proposal approval

OpenSpec rule: Only implement what is explicitly written in the spec. No speculation.

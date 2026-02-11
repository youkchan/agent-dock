# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Agent Dock is a Python coordination runtime for multi-agent systems. It uses a "Lead + Teammates" model where a Lead agent orchestrates multiple Teammate agents. The Lead only makes JSON decisions while Teammates handle implementation work.

## Development Commands

```bash
# Setup
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
pip install openai  # For OpenAI provider

# Run tests
python -m unittest discover -s tests -v

# Run with mock provider (testing)
ORCHESTRATOR_PROVIDER=mock python -m team_orchestrator.cli \
  --teammate-adapter template \
  --config examples/sample_tasks.json

# Run with OpenAI provider
set -a; source .env.orchestrator; set +a
export OPENAI_API_KEY="..."
python -m team_orchestrator.cli \
  --config examples/sample_tasks.json \
  --state-dir /tmp/state

# Resume a run
python -m team_orchestrator.cli \
  --config examples/sample_tasks.json \
  --state-dir /tmp/state \
  --resume

# OpenSpec compile
python -m team_orchestrator.cli compile-openspec \
  --change-id <change-id> \
  --openspec-root ./openspec

# OpenSpec template generation
python -m team_orchestrator.cli print-openspec-template --lang en
```

## Architecture

### Core Components

| Module | Purpose |
|--------|---------|
| `orchestrator.py` | Main event loop, Lead decision logic |
| `state_store.py` | JSON state persistence with file locking, mailbox, collision detection |
| `provider.py` | LLM abstraction (Mock, OpenAI implementations) |
| `adapter.py` / `codex_adapter.py` | Teammate adapter protocol and subprocess implementation |
| `persona_catalog.py` / `persona_pipeline.py` | Persona-based quality gates and phase routing |
| `openspec_compiler.py` | Markdown → JSON task config compilation |
| `cli.py` | CLI entry point |
| `models.py` | Task dataclasses |

### Event-Driven Model

The Lead provider is only called on specific events (not every tick):
- `Kickoff`, `TaskCompleted`, `Blocked`, `NeedsApproval`, `NoProgress`, `Collision`

### Task States

`pending` → `in_progress` → `completed` | `blocked` | `needs_approval`

Tasks with `requires_plan=true` require approval before execution (states: `not_required` → `pending` → `drafting` → `submitted` → `approved` → `executed`).

### Persona System

Default personas: `implementer`, `code-reviewer`, `spec-checker`, `test-owner` (defined in `team_orchestrator/personas/default/`).

Tasks flow through configurable phases (e.g., `implement → review → spec_check → test`) with persona evaluation at each phase.

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

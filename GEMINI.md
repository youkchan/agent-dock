# Agent Dock (codex-agent-teams-like)

Agent Dock is a coordination runtime for collaborative AI agents, inspired by agent teams. It employs a **Thin Orchestrator** model where a "Lead" agent handles high-level orchestration via JSON decisions, while "Teammate" agents perform heavy lifting like code implementation, testing, and reviews.

## Project Overview

- **Lead Agent:** Dedicated orchestration loop. Does not perform implementation. Communicates via JSON decisions.
- **Teammate Agents:** Perform tasks via adapters. Supports `subprocess` execution (for example, calling `codex` or local scripts).
- **Shared State:** Process-safe JSON state with file locking, task board, and mailbox for inter-agent communication.
- **Persona System:** Quality gates (Implementer, Code Reviewer, Spec Checker, Test Owner) that evaluate events and can escalate tasks or block execution.
- **OpenSpec:** Integration for defining tasks and changes in Markdown, compiled into runtime task configuration.

## Core Technologies

- **Language:** TypeScript (Deno runtime)
- **Primary API:** OpenAI (for the Lead Provider)
- **External Tools:** Codex CLI (used by the default teammate wrapper)
- **Configuration:** JSON (task configs), YAML (persona overrides), Markdown (OpenSpec)

## Architecture

- `src/application/orchestrator/orchestrator.ts`: The event-driven Lead/Teammate execution loop.
- `src/infrastructure/state/store.ts`: Centralized state management with file locking.
- `src/infrastructure/provider/factory.ts`: Abstraction for the Lead's brain (supports OpenAI, Mock).
- `src/infrastructure/adapter/subprocess.ts`: Subprocess adapter for teammate execution.
- `src/infrastructure/wrapper/helper.ts` + `codex_wrapper.sh`: Prompt/result conversion, dotenv guard, and Codex bridge.
- `src/application/orchestrator/persona_pipeline.ts`: Evaluates events against defined personas for quality control.
- `src/infrastructure/openspec/compiler.ts`: Compiles OpenSpec `tasks.md` into task configurations.

## Development Setup

### 1. Prerequisites
- Deno 2.x
- Node.js 18+

### 2. Installation
```bash
npm install
deno task check
deno task test
./node_modules/.bin/agent-dock --help
```

### 3. Environment Variables
The runtime relies on several environment variables for configuration:
- `ORCHESTRATOR_PROVIDER`: `mock` (default), `openai`.
- `OPENAI_API_KEY`: Required if using `openai` provider.
- `TEAMMATE_ADAPTER`: `subprocess` (default), `template`.
- `TEAMMATE_COMMAND`: Command for teammates (for example, `bash ./codex_wrapper.sh`).
- `HUMAN_APPROVAL`: Set to `1` to stop for manual confirmation on `needs_approval` tasks.

## Key Commands

### Running the Orchestrator
```bash
# Using a static config
./node_modules/.bin/agent-dock run --config examples/sample_tasks.json

# Resuming a previous run
./node_modules/.bin/agent-dock run --state-dir .team_state --resume
```

### OpenSpec Workflow
```bash
# Generate a template
./node_modules/.bin/agent-dock print-openspec-template --lang en > openspec/changes/my-feat/tasks.md

# Compile and Run OpenSpec change
./node_modules/.bin/agent-dock run --openspec-change my-feat --save-compiled
```

### Testing
```bash
deno task test
```

## Development Conventions

- **Type Safety:** Keep strict TypeScript checks enabled.
- **Event-Driven:** The Lead only acts on specific events (Kickoff, TaskCompleted, Blocked, etc.) to minimize API costs.
- **Fail-Closed:** State transitions and OpenSpec compilation should fail early if inconsistencies are detected.
- **Subprocess Safety:** Teammate execution via subprocess should respect timeouts and handle resource cleanup.
- **Log Management:** Teammate logs are streamed and also captured in each task's `progress_log` (limited to 200 entries).

## File Structure Highlights
- `src/`: Main TypeScript runtime implementation.
- `personas/default/`: Built-in persona definitions.
- `openspec/`: OpenSpec root for changes and project definitions.
- `task_configs/overrides/`: YAML overrides for compiled task configs.
- `codex_wrapper.sh`: Default wrapper script for teammate execution using `codex`.

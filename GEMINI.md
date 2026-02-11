# Agent Dock (codex-agent-teams-like)

Agent Dock is a coordination runtime for collaborative AI agents, inspired by agent teams. it employs a **Thin Orchestrator** model where a "Lead" agent handles high-level orchestration via JSON decisions, while "Teammate" agents perform heavy lifting like code implementation, testing, and reviews.

## Project Overview

- **Lead Agent:** Dedicated orchestration loop. Does not perform implementation. Communicates via JSON decisions.
- **Teammate Agents:** Perform tasks via adapters. Supports `subprocess` execution (e.g., calling `codex` or local scripts).
- **Shared State:** Process-safe JSON state with file locking, task board, and mailbox for inter-agent communication.
- **Persona System:** Quality gates (Implementer, Code Reviewer, Spec Checker, Test Owner) that evaluate events and can escalate tasks or block execution.
- **OpenSpec:** Integration with OpenSpec for defining tasks and changes in Markdown, which are compiled into the runtime's task configuration.

## Core Technologies

- **Language:** Python 3.10+
- **Primary API:** OpenAI (for the Lead Provider)
- **External Tools:** Codex CLI (used by the default teammate wrapper)
- **Configuration:** JSON (task configs), YAML (persona overrides), Markdown (OpenSpec)

## Architecture

- `team_orchestrator/orchestrator.py`: The event-driven Lead/Teammate execution loop.
- `team_orchestrator/state_store.py`: Centralized state management with ACID-like file locking.
- `team_orchestrator/provider.py`: Abstraction for the Lead's brain (supports OpenAI, Mock).
- `team_orchestrator/adapter.py`: Interface for Teammate execution.
- `team_orchestrator/persona_pipeline.py`: Evaluates events against defined personas for quality control.
- `team_orchestrator/openspec_compiler.py`: Compiles OpenSpec `tasks.md` into task configurations.

## Development Setup

### 1. Prerequisites
- Python 3.10+
- (Optional) Node.js 18+ for Codex CLI.

### 2. Installation
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
# If using OpenAI provider
pip install -e ".[openai]"
```

### 3. Environment Variables
The runtime relies on several environment variables for configuration:
- `ORCHESTRATOR_PROVIDER`: `mock` (default), `openai`.
- `OPENAI_API_KEY`: Required if using `openai` provider.
- `TEAMMATE_ADAPTER`: `subprocess` (default), `template`.
- `TEAMMATE_COMMAND`: Command for teammates (e.g., `bash ./codex_wrapper.sh`).
- `HUMAN_APPROVAL`: Set to `1` to stop for manual confirmation on `needs_approval` tasks.

## Key Commands

### Running the Orchestrator
```bash
# Using a static config
python -m team_orchestrator.cli run --config examples/sample_tasks.json

# Resuming a previous run
python -m team_orchestrator.cli run --state-dir .team_state --resume
```

### OpenSpec Workflow
```bash
# Generate a template
python -m team_orchestrator.cli print-openspec-template --lang en > openspec/changes/my-feat/tasks.md

# Compile and Run OpenSpec change
python -m team_orchestrator.cli run --openspec-change my-feat --save-compiled
```

### Testing
```bash
python -m unittest discover -s tests -v
```

## Development Conventions

- **Type Annotations:** Strictly use Python type hints.
- **Event-Driven:** The Lead only acts on specific events (Kickoff, TaskCompleted, Blocked, etc.) to minimize API costs.
- **Fail-Closed:** State transitions and OpenSpec compilation should fail early if inconsistencies are detected.
- **Subprocess Safety:** Teammate execution via `subprocess` should respect timeouts and handle resource cleanup.
- **Log Management:** Teammate logs are streamed and also captured in the task's `progress_log` (limited to 200 entries).

## File Structure Highlights
- `team_orchestrator/`: Main package.
- `openspec/`: OpenSpec root for changes and project definitions.
- `task_configs/overrides/`: YAML overrides for compiled task configs.
- `codex_wrapper.sh`: Default wrapper script for teammate execution using `codex`.

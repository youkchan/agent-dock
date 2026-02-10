# Change Proposal: Introduce Persona-Based Quality Gates

## Background
The current `codex_agent` already has the core orchestration controls in place (`requires_plan`, `depends_on`, approval gate, event-driven loop, and OpenSpec task_config compilation).
However, teammates are still treated mostly as plain IDs, so implementation, review, spec-conformance checks, and test coverage checks can get mixed together. This makes responsibility unclear and allows quality gaps to be discovered too late.

## What Changes
- Introduce four default personas: implementer, code reviewer, spec checker, and test owner.
- Allow project-specific custom personas to be added.
- Use full override on same-name conflicts: when a project persona has the same `id`, the project definition is used 100%.
- Set the default comment cap to 2 comments per event to reduce noise.
- Standardize severity behavior:
  - `info`: log only
  - `warn`: re-check on next round
  - `critical`: transition task to `needs_approval`
  - `blocker`: immediate stop only when emitted by a persona with `can_block=true` (`stop_reason=persona_blocker:<persona_id>`)
- Extend event/result outputs with metrics needed for operational tuning.

## Objective
This change is not about personality realism. It is about separating quality perspectives and enforcing earlier quality gates.
The goal is to embed continuous review pressure, spec conformance checks, and test scrutiny directly into orchestration flow.

## Impact
- Affected specs:
  - `persona-catalog` (new)
  - `persona-gate-engine` (new)
- Expected implementation touchpoints:
  - `team_orchestrator/orchestrator.py`
  - `team_orchestrator/models.py`
  - `team_orchestrator/cli.py`
  - new `team_orchestrator/persona_*.py` modules
  - unit/integration tests under `tests/`
  - operational docs in `README.md`

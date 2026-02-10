## Context
Execution control is already stable (dependency control, approvals, stop conditions), but quality feedback is still tied to teammate IDs and lacks explicit perspective ownership.
This change adds perspective-based role separation to the orchestration layer so spec drift and testing gaps can be caught earlier.

## Goals
- Provide default personas with clear quality perspectives.
- Support project-level persona additions and overrides.
- Apply deterministic severity actions (log, re-check, approval gate, immediate stop).
- Limit comment volume with a per-event cap.

## Non-Goals
- Rich free-form chat behavior
- Personality expression enhancements
- Persona-specific independent LLM optimization in this first iteration

## Design Decisions

### 1) Persona definition model
Use a minimal schema:
- `id`: unique identifier
- `name`: display name
- `role`: `implementer | reviewer | spec_guard | test_guard | custom`
- `focus`: short perspective definition
- `can_block`: whether immediate-stop authority is allowed (default `false`)
- `enabled`: enabled/disabled flag

Default set includes:
- implementer
- code reviewer
- spec checker
- test owner

### 2) Project override rules
Load order is `default -> project`.
- If project and default share the same `id`, use full replacement (no field-level merge).
- If project `id` does not exist in default, add it as an extra persona.

This keeps project intent explicit and unambiguous.

### 3) Severity actions
Persona comments carry one of `info | warn | critical | blocker`:
- `info`: log only
- `warn`: enqueue for next-round re-check
- `critical`: move target task to `needs_approval`
- `blocker`: immediate stop only if persona has `can_block=true`, with `stop_reason=persona_blocker:<persona_id>`

If `can_block=false` emits `blocker`, downgrade behavior to `critical`.

### 4) Comment cap
Apply a default cap of 2 comments per event.
When candidates exceed the cap, keep comments by deterministic priority:
- severity order: `blocker > critical > warn > info`
- tie-break: stable sort by `persona_id`, then `task_id`

### 5) Observability
Record at least:
- comment counts by severity
- number of `persona_blocker` stops
- pending `warn` re-check queue size

## Risks and Mitigations
- Risk: Too many comments can stall execution.
  - Mitigation: cap comments, severity-first filtering, default `can_block=false`
- Risk: Custom persona misconfiguration may cause unexpected behavior.
  - Mitigation: strict schema validation, reject unknown keys
- Risk: Overuse of `critical` can flood approval gates.
  - Mitigation: suppress duplicate transitions per task and apply re-check pacing

## Open Questions for Implementation
- Default persona config path strategy (CLI-first vs env-first)
- `warn` re-check scope (same task/event only vs round-level abstraction)

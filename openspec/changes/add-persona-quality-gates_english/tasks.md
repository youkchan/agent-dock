## 1. Implementation Tasks
- [ ] 1.1 Add persona schema and default four personas
  - Deliverable: definitions with `id/role/focus/can_block/enabled` and load-time validation
- [ ] 1.2 Implement project override/addition loader
  - Deliverable: full replacement on same `id`, additive merge for new IDs, unknown-key rejection
- [ ] 1.3 Integrate persona evaluation pipeline into orchestrator
  - Deliverable: event-time collection and aggregation of persona comments
- [ ] 1.4 Implement severity-based control actions
  - Deliverable: unified `info/warn/critical/blocker` behavior and `persona_blocker:<id>` stop reason
- [ ] 1.5 Implement comment cap (default: 2/event) and deterministic prioritization
  - Deliverable: stable trimming when comment candidates exceed cap
- [ ] 1.6 Update CLI/configuration and README
  - Deliverable: persona configuration path, operational policy, and limitations
- [ ] 1.7 Add tests
  - Deliverable: merge rules, severity transitions, stop conditions, cap behavior, regression coverage

## 2. Validation Checklist
- [ ] `python -m unittest discover -s tests -v` passes
- [ ] A custom persona (`can_block=true`) emitting `blocker` produces `stop_reason=persona_blocker:<persona_id>`
- [ ] Same-ID persona conflicts fully adopt the project definition
- [ ] Per-event emitted comments never exceed the default cap of 2

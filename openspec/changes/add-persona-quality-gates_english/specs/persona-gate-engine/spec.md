## ADDED Requirements

### Requirement: Standardize severity behavior for persona comments
The system SHALL apply deterministic actions for persona comment severities: `info`, `warn`, `critical`, and `blocker`.

#### Scenario: info logs only
- **WHEN** an `info` comment is produced
- **THEN** it is recorded in logs
- **AND** no task state or stop condition is changed

#### Scenario: warn is re-checked next round
- **WHEN** a `warn` comment is produced
- **THEN** it is queued for next-round re-check

#### Scenario: critical transitions to approval gate
- **WHEN** a `critical` comment is produced for a task
- **THEN** that task transitions to `needs_approval`

### Requirement: Only authorized blocker can stop immediately
The system SHALL immediately stop only when a `blocker` comment is emitted by a persona with `can_block=true`.

#### Scenario: Authorized blocker triggers immediate stop
- **WHEN** a persona with `can_block=true` emits `blocker`
- **THEN** execution stops immediately
- **AND** `stop_reason` is set to `persona_blocker:<persona_id>`

#### Scenario: Unauthorized blocker does not immediately stop
- **WHEN** a persona with `can_block=false` emits `blocker`
- **THEN** immediate stop does not occur
- **AND** behavior is handled as `critical`

### Requirement: Enforce per-event comment cap
The system SHALL enforce a per-event comment cap with a default value of 2.

#### Scenario: Comment cap suppresses noise
- **WHEN** three or more comment candidates are produced for a single event
- **THEN** emitted comments are at most two
- **AND** retained comments follow severity-first priority

### Requirement: Expose metrics for operational tuning
The system SHALL emit measurable outputs for persona comments and stop outcomes to support post-introduction tuning.

#### Scenario: Severity and blocker-stop metrics are available
- **WHEN** execution completes or stops
- **THEN** counts by severity and whether a `persona_blocker` stop occurred can be observed

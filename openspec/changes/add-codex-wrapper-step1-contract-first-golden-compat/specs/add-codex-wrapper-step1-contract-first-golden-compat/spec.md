## ADDED Requirements
### Requirement: Step1 Scope and Compatibility Contract Scope
The system SHALL define a minimal-change scope for `add-codex-wrapper-step1-contract-first-golden-compat`.

#### Scenario: Step1 scope is frozen
- **WHEN** this change is executed
- **THEN** `codex_wrapper.sh` is kept as the default runtime entry
- **AND** `src/infrastructure/wrapper/helper.ts` is updated only for Step1 contract/fidelity work
- **AND** runtime compatibility is stated as the first-order requirement.

### Requirement: Contract-First Contract Definition
The system SHALL capture explicit definitions for Step1 compatibility contracts including RESULT/JUDGMENT/CHANGED_FILES, `RESULT_PHASE` interpretation, environment-file protection, and empty-payload or JSON parse-failure exit behavior.

#### Scenario: Contract is documented consistently
- **WHEN** `proposal.md` and `spec.md` are reviewed together
- **THEN** each contract topic SHALL be represented in normative form
- **AND** success/failure handling rules SHALL be compatible with existing behaviour.

### Requirement: Golden and Validation Readiness
The system SHALL create a change artifact set that enables future golden regression and TS migration work by clarifying transport, invariants, and acceptance gates.

#### Scenario: Validation gate is executable
- **WHEN** validating the change definition
- **THEN** `openspec validate add-codex-wrapper-step1-contract-first-golden-compat --strict` SHALL be the mandatory gate
- **AND** task artifacts SHALL align with the same requirements and scope.

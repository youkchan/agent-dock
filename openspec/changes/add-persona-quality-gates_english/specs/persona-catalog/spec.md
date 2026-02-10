## ADDED Requirements

### Requirement: Provide default quality personas
The system SHALL provide at least four default personas to separate quality perspectives: implementer, code reviewer, spec checker, and test owner.

#### Scenario: Default personas are initialized
- **WHEN** the orchestrator starts without explicit persona configuration
- **THEN** the four default personas are loaded as enabled
- **AND** each persona has a unique and identifiable `id`

### Requirement: Support project-defined override and addition
The system SHALL load project persona definitions such that same-`id` entries fully override defaults, while new IDs are added.

#### Scenario: Same ID uses full override
- **WHEN** a project persona definition includes an `id` that already exists in defaults
- **THEN** the default definition is not used
- **AND** the project definition is applied 100%

#### Scenario: New ID is added
- **WHEN** a project persona definition includes an `id` that does not exist in defaults
- **THEN** it is added as an additional persona

### Requirement: Control blocking authority per persona
The system SHALL support persona-level blocking authority through a `can_block` attribute.

#### Scenario: Custom persona can be granted block authority
- **WHEN** a project custom persona is configured with `can_block=true`
- **THEN** that persona is eligible to trigger immediate stop via `blocker`

### Requirement: Reject invalid persona definitions
The system MUST NOT accept persona definitions with missing required fields, type mismatches, or unknown keys.

#### Scenario: Unknown key causes failure
- **WHEN** a persona definition contains a non-supported key
- **THEN** loading fails
- **AND** the error includes the offending key name

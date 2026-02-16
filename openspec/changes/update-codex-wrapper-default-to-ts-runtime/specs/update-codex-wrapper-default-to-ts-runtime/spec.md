## ADDED Requirements

### Requirement: TypeScript Runtime Default Path
The system SHALL use TypeScript wrapper runtime as the default teammate execution path.

#### Scenario: Default runtime is ts
- **WHEN** subprocess adapter runs without explicit command override
- **THEN** default command SHALL execute `src/infrastructure/wrapper/runtime.ts`
- **AND** shell wrapper SHALL NOT be used by default.

### Requirement: Runtime Selector Fail-Closed
The system SHALL reject non-ts runtime selector values.

#### Scenario: Runtime selector is not ts
- **WHEN** `CODEX_WRAPPER_RUNTIME` is set to a value other than `ts`
- **AND** no explicit command override is provided (`TEAMMATE_COMMAND`, `TEAMMATE_PLAN_COMMAND`, `TEAMMATE_EXECUTE_COMMAND`)
- **THEN** startup SHALL fail with a clear validation error
- **AND** the system SHALL NOT fall back to `codex_wrapper.sh`.

### Requirement: Explicit Command Override Precedence
The system SHALL preserve explicit command override precedence.

#### Scenario: TEAMMATE_COMMAND is explicitly set
- **WHEN** `TEAMMATE_COMMAND` or explicit plan/execute command overrides are provided
- **THEN** the provided command SHALL take precedence over runtime default resolution
- **AND** runtime selector SHALL NOT override explicit commands.

#### Scenario: Explicit command bypasses runtime selector validation
- **WHEN** `TEAMMATE_COMMAND` or explicit plan/execute command overrides are provided
- **AND** `CODEX_WRAPPER_RUNTIME` is set to a non-ts value
- **THEN** startup SHALL use the explicit command path
- **AND** runtime selector validation SHALL NOT block startup.

### Requirement: Wrapper Contract Parity
The TypeScript runtime SHALL preserve legacy contract behavior.

#### Scenario: Runtime output parity
- **WHEN** the same payload and environment are executed on legacy and ts runtime
- **THEN** `result block`, `exit code`, and `stderr` SHALL be exactly identical
- **AND** any mismatch SHALL fail tests.

### Requirement: Fail-Closed Compatibility
The TypeScript runtime SHALL keep fail-closed behavior identical to legacy.

#### Scenario: Empty payload
- **WHEN** stdin payload is empty
- **THEN** runtime SHALL exit with code `2`
- **AND** stderr SHALL include `empty stdin payload`.

#### Scenario: Empty output
- **WHEN** codex output and result extraction produce empty output
- **THEN** runtime SHALL exit with code `3`
- **AND** stderr SHALL include `codex returned empty output`.

#### Scenario: Dotenv mutation
- **WHEN** dotenv snapshot verification detects mutation
- **THEN** runtime SHALL exit with code `4`
- **AND** stderr SHALL follow the existing helper contract.

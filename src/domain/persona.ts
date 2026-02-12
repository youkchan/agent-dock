export type PersonaRole =
  | "implementer"
  | "reviewer"
  | "spec_guard"
  | "test_guard"
  | "custom";

export interface PersonaExecutionConfig {
  enabled: boolean;
  command_ref: string;
  sandbox: string;
  timeout_sec: number;
}

export interface PersonaDefinition {
  id: string;
  role: PersonaRole;
  focus: string;
  can_block: boolean;
  enabled: boolean;
  execution: PersonaExecutionConfig | null;
}

export function personaExecutionConfigToRecord(
  config: PersonaExecutionConfig,
): Record<string, unknown> {
  return {
    enabled: config.enabled,
    command_ref: config.command_ref,
    sandbox: config.sandbox,
    timeout_sec: config.timeout_sec,
  };
}

export function personaDefinitionToRecord(
  persona: PersonaDefinition,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    id: persona.id,
    role: persona.role,
    focus: persona.focus,
    can_block: persona.can_block,
    enabled: persona.enabled,
  };
  if (persona.execution !== null) {
    payload.execution = personaExecutionConfigToRecord(persona.execution);
  }
  return payload;
}

const PHASE_POLICY_KEYS = [
  "active_personas",
  "executor_personas",
  "state_transition_personas",
] as const;

const PERSONA_DEFAULTS_KEYS = [
  "phase_order",
  "phase_policies",
] as const;

const TASK_PERSONA_POLICY_KEYS = [
  "disable_personas",
  "phase_order",
  "phase_overrides",
] as const;

export type PhasePolicyKey = (typeof PHASE_POLICY_KEYS)[number];

export interface PhasePolicy {
  active_personas?: string[];
  executor_personas?: string[];
  state_transition_personas?: string[];
}

export interface PersonaDefaults {
  phase_order?: string[];
  phase_policies?: Record<string, PhasePolicy>;
}

export interface TaskPersonaPolicy {
  disable_personas?: string[];
  phase_order?: string[];
  phase_overrides?: Record<string, PhasePolicy>;
}

export interface NormalizePersonaDefaultsOptions {
  sourceLabel: string;
  knownPersonaIds: ReadonlySet<string>;
}

export interface NormalizeTaskPersonaPolicyOptions {
  sourceLabel: string;
  taskId: string;
  knownPersonaIds: ReadonlySet<string>;
}

export function normalizePersonaDefaults(
  raw: unknown,
  options: NormalizePersonaDefaultsOptions,
): PersonaDefaults | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  if (!isRecord(raw)) {
    throw new Error(
      `persona_defaults must be an object (${options.sourceLabel})`,
    );
  }

  const unknownKeys = findUnknownKeys(raw, PERSONA_DEFAULTS_KEYS);
  if (unknownKeys.length > 0) {
    throw new Error(
      `persona_defaults has unknown keys: ${
        unknownKeys.join(", ")
      } (${options.sourceLabel})`,
    );
  }

  const normalized: PersonaDefaults = {};
  if ("phase_order" in raw) {
    normalized.phase_order = normalizePhaseOrder(raw.phase_order, {
      fieldName: "persona_defaults.phase_order",
      sourceLabel: options.sourceLabel,
    });
  }
  if ("phase_policies" in raw) {
    normalized.phase_policies = normalizePhasePolicyMap(raw.phase_policies, {
      fieldName: "persona_defaults.phase_policies",
      sourceLabel: options.sourceLabel,
      knownPersonaIds: options.knownPersonaIds,
    });
  }
  return normalized;
}

export function normalizeTaskPersonaPolicy(
  raw: unknown,
  options: NormalizeTaskPersonaPolicyOptions,
): TaskPersonaPolicy | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  if (!isRecord(raw)) {
    throw new Error(
      `task ${options.taskId} persona_policy must be an object (${options.sourceLabel})`,
    );
  }

  const unknownKeys = findUnknownKeys(raw, TASK_PERSONA_POLICY_KEYS);
  if (unknownKeys.length > 0) {
    throw new Error(
      `task ${options.taskId} persona_policy has unknown keys: ${
        unknownKeys.join(", ")
      } (${options.sourceLabel})`,
    );
  }

  const normalized: TaskPersonaPolicy = {};
  if ("disable_personas" in raw) {
    normalized.disable_personas = normalizePersonaIdList(raw.disable_personas, {
      fieldName: `task ${options.taskId} persona_policy.disable_personas`,
      sourceLabel: options.sourceLabel,
      knownPersonaIds: options.knownPersonaIds,
    });
  }
  if ("phase_order" in raw) {
    normalized.phase_order = normalizePhaseOrder(raw.phase_order, {
      fieldName: `task ${options.taskId} persona_policy.phase_order`,
      sourceLabel: options.sourceLabel,
    });
  }
  if ("phase_overrides" in raw) {
    normalized.phase_overrides = normalizePhasePolicyMap(raw.phase_overrides, {
      fieldName: `task ${options.taskId} persona_policy.phase_overrides`,
      sourceLabel: options.sourceLabel,
      knownPersonaIds: options.knownPersonaIds,
    });
  }
  return normalized;
}

interface PhaseOrderOptions {
  fieldName: string;
  sourceLabel: string;
}

function normalizePhaseOrder(
  raw: unknown,
  options: PhaseOrderOptions,
): string[] {
  if (!Array.isArray(raw)) {
    throw new Error(
      `${options.fieldName} must be a list (${options.sourceLabel})`,
    );
  }

  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const [index, item] of raw.entries()) {
    if (typeof item !== "string" || item.trim().length === 0) {
      throw new Error(
        `${options.fieldName}[${index}] must be a non-empty string (${options.sourceLabel})`,
      );
    }
    const phase = item.trim();
    if (seen.has(phase)) {
      continue;
    }
    seen.add(phase);
    normalized.push(phase);
  }
  return normalized;
}

interface PhasePolicyMapOptions {
  fieldName: string;
  sourceLabel: string;
  knownPersonaIds: ReadonlySet<string>;
}

function normalizePhasePolicyMap(
  raw: unknown,
  options: PhasePolicyMapOptions,
): Record<string, PhasePolicy> {
  if (!isRecord(raw)) {
    throw new Error(
      `${options.fieldName} must be an object (${options.sourceLabel})`,
    );
  }

  const normalized: Record<string, PhasePolicy> = {};
  for (const [phaseRaw, policyRaw] of Object.entries(raw)) {
    const phase = String(phaseRaw).trim();
    if (!phase) {
      throw new Error(
        `${options.fieldName} contains an empty phase key (${options.sourceLabel})`,
      );
    }
    normalized[phase] = normalizePhasePolicy(policyRaw, {
      fieldName: `${options.fieldName}.${phase}`,
      sourceLabel: options.sourceLabel,
      knownPersonaIds: options.knownPersonaIds,
    });
  }
  return normalized;
}

interface PhasePolicyOptions {
  fieldName: string;
  sourceLabel: string;
  knownPersonaIds: ReadonlySet<string>;
}

function normalizePhasePolicy(
  raw: unknown,
  options: PhasePolicyOptions,
): PhasePolicy {
  if (!isRecord(raw)) {
    throw new Error(
      `${options.fieldName} must be an object (${options.sourceLabel})`,
    );
  }

  const unknownKeys = findUnknownKeys(raw, PHASE_POLICY_KEYS);
  if (unknownKeys.length > 0) {
    throw new Error(
      `${options.fieldName} has unknown keys: ${
        unknownKeys.join(", ")
      } (${options.sourceLabel})`,
    );
  }

  const normalized: PhasePolicy = {};
  for (const key of [...PHASE_POLICY_KEYS].sort()) {
    if (!(key in raw)) {
      continue;
    }
    normalized[key] = normalizePersonaIdList(raw[key], {
      fieldName: `${options.fieldName}.${key}`,
      sourceLabel: options.sourceLabel,
      knownPersonaIds: options.knownPersonaIds,
    });
  }
  return normalized;
}

interface PersonaIdListOptions {
  fieldName: string;
  sourceLabel: string;
  knownPersonaIds: ReadonlySet<string>;
}

function normalizePersonaIdList(
  raw: unknown,
  options: PersonaIdListOptions,
): string[] {
  if (!Array.isArray(raw)) {
    throw new Error(
      `${options.fieldName} must be a list (${options.sourceLabel})`,
    );
  }

  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const [index, item] of raw.entries()) {
    if (typeof item !== "string" || item.trim().length === 0) {
      throw new Error(
        `${options.fieldName}[${index}] must be a non-empty string (${options.sourceLabel})`,
      );
    }
    const personaId = item.trim();
    if (!options.knownPersonaIds.has(personaId)) {
      throw new Error(
        `${options.fieldName}[${index}] references unknown persona: ${personaId} (${options.sourceLabel})`,
      );
    }
    if (seen.has(personaId)) {
      continue;
    }
    seen.add(personaId);
    normalized.push(personaId);
  }
  return normalized;
}

function findUnknownKeys(
  raw: Record<string, unknown>,
  allowedKeys: readonly string[],
): string[] {
  const allowed = new Set(allowedKeys);
  return Object.keys(raw).filter((key) => !allowed.has(key)).sort();
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw);
}

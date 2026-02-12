import type {
  PersonaDefinition,
  PersonaExecutionConfig,
  PersonaRole,
} from "../../domain/persona.ts";

const REQUIRED_KEYS = ["id", "role", "focus", "can_block", "enabled"] as const;
const OPTIONAL_KEYS = ["execution"] as const;
const ALLOWED_KEYS = new Set<string>([...REQUIRED_KEYS, ...OPTIONAL_KEYS]);
const ALLOWED_ROLES = new Set<string>([
  "implementer",
  "reviewer",
  "spec_guard",
  "test_guard",
  "custom",
]);
const ALLOWED_EXECUTION_KEYS = new Set<string>([
  "enabled",
  "command_ref",
  "sandbox",
  "timeout_sec",
]);
const DEFAULT_PERSONA_IDS = [
  "implementer",
  "code-reviewer",
  "spec-checker",
  "test-owner",
] as const;
const DEFAULT_PERSONAS_DIR = new URL(
  "../../../team_orchestrator/personas/default/",
  import.meta.url,
);

let defaultPersonasDir: URL = DEFAULT_PERSONAS_DIR;
let defaultPersonasCache: PersonaDefinition[] | null = null;

interface ParsePersonaOptions {
  index: number;
  sourceLabel: string;
}

interface ParseExecutionOptions extends ParsePersonaOptions {
  hasExecution: boolean;
}

export function defaultPersonas(): PersonaDefinition[] {
  if (defaultPersonasCache === null) {
    defaultPersonasCache = loadDefaultPersonas();
  }
  return defaultPersonasCache.map(clonePersonaDefinition);
}

export function loadPersonas(
  raw: unknown,
  sourceLabel: string,
): PersonaDefinition[] {
  if (raw === null || raw === undefined) {
    return defaultPersonas();
  }
  const projectPersonas = parsePersonaList(raw, sourceLabel);
  return mergePersonas(defaultPersonas(), projectPersonas);
}

export function loadPersonasFromPayload(
  raw: Record<string, unknown>,
  sourceLabel: string,
): PersonaDefinition[] {
  if (!isRecord(raw)) {
    throw new Error(`payload must be an object (${sourceLabel})`);
  }
  return loadPersonas(raw.personas, sourceLabel);
}

export function resetDefaultPersonasCacheForTest(): void {
  defaultPersonasCache = null;
}

export function setDefaultPersonasDirForTest(path: URL): void {
  defaultPersonasDir = path;
  defaultPersonasCache = null;
}

function loadDefaultPersonas(): PersonaDefinition[] {
  assertDefaultPersonaDirectoryExists(defaultPersonasDir);

  const personaFiles = new Map<string, URL>();
  for (const entry of Deno.readDirSync(defaultPersonasDir)) {
    if (!entry.isFile || !entry.name.endsWith(".yaml")) {
      continue;
    }
    const personaId = entry.name.slice(0, -5);
    personaFiles.set(personaId, new URL(entry.name, defaultPersonasDir));
  }

  const missingFiles = DEFAULT_PERSONA_IDS.filter((personaId) =>
    !personaFiles.has(personaId)
  );
  if (missingFiles.length > 0) {
    throw new Error(
      `missing default persona file(s): ${missingFiles.join(", ")} (${
        displayPath(defaultPersonasDir)
      })`,
    );
  }

  const orderedPaths: URL[] = [];
  for (const personaId of DEFAULT_PERSONA_IDS) {
    const path = personaFiles.get(personaId);
    if (!path) {
      continue;
    }
    orderedPaths.push(path);
  }

  const personas: PersonaDefinition[] = [];
  const seenIds = new Set<string>();
  const duplicateIds = new Set<string>();
  for (const path of orderedPaths) {
    const raw = readDefaultPersonaYaml(path);
    const persona = parsePersona(raw, {
      index: 0,
      sourceLabel: `default persona file: ${fileNameFromUrl(path)}`,
    });
    if (seenIds.has(persona.id)) {
      duplicateIds.add(persona.id);
    }
    seenIds.add(persona.id);
    personas.push(persona);
  }

  if (duplicateIds.size > 0) {
    throw new Error(
      `duplicate persona id(s): ${
        [...duplicateIds].sort().join(", ")
      } (default persona files)`,
    );
  }
  return personas;
}

function readDefaultPersonaYaml(path: URL): unknown {
  let content: string;
  try {
    content = Deno.readTextFileSync(path);
  } catch (_error) {
    throw new Error(
      `failed to read default persona file: ${displayPath(path)}`,
    );
  }

  try {
    return parseSimpleYamlObject(content);
  } catch (_error) {
    throw new Error(
      `invalid YAML in default persona file: ${displayPath(path)}`,
    );
  }
}

function parsePersonaList(
  raw: unknown,
  sourceLabel: string,
): PersonaDefinition[] {
  if (!Array.isArray(raw)) {
    throw new Error(`personas must be a list (${sourceLabel})`);
  }

  const personas: PersonaDefinition[] = [];
  const seenIds = new Set<string>();
  const duplicateIds = new Set<string>();
  for (const [index, item] of raw.entries()) {
    const persona = parsePersona(item, { index, sourceLabel });
    if (seenIds.has(persona.id)) {
      duplicateIds.add(persona.id);
    }
    seenIds.add(persona.id);
    personas.push(persona);
  }

  if (duplicateIds.size > 0) {
    throw new Error(
      `duplicate persona id(s): ${
        [...duplicateIds].sort().join(", ")
      } (${sourceLabel})`,
    );
  }
  return personas;
}

function mergePersonas(
  defaults: PersonaDefinition[],
  project: PersonaDefinition[],
): PersonaDefinition[] {
  const projectById = new Map<string, PersonaDefinition>();
  for (const persona of project) {
    projectById.set(persona.id, persona);
  }
  const defaultIds = new Set(defaults.map((persona) => persona.id));
  const merged = defaults.map((persona) =>
    projectById.get(persona.id) ?? persona
  );
  merged.push(...project.filter((persona) => !defaultIds.has(persona.id)));
  return merged.map(clonePersonaDefinition);
}

function parsePersona(
  raw: unknown,
  options: ParsePersonaOptions,
): PersonaDefinition {
  if (!isRecord(raw)) {
    throw new Error(
      `personas[${options.index}] must be an object (${options.sourceLabel})`,
    );
  }

  const unknownKeys = Object.keys(raw).filter((key) => !ALLOWED_KEYS.has(key))
    .sort();
  if (unknownKeys.length > 0) {
    throw new Error(
      `personas[${options.index}] has unknown keys: ${
        unknownKeys.join(", ")
      } (${options.sourceLabel})`,
    );
  }

  const missing = REQUIRED_KEYS.filter((key) => !(key in raw));
  if (missing.length > 0) {
    throw new Error(
      `personas[${options.index}] missing required keys: ${
        missing.join(", ")
      } (${options.sourceLabel})`,
    );
  }

  const personaIdRaw = raw.id;
  const roleRaw = raw.role;
  const focusRaw = raw.focus;
  const canBlockRaw = raw.can_block;
  const enabledRaw = raw.enabled;
  const execution = parseExecution(raw.execution, {
    index: options.index,
    sourceLabel: options.sourceLabel,
    hasExecution: Object.prototype.hasOwnProperty.call(raw, "execution"),
  });

  if (typeof personaIdRaw !== "string" || personaIdRaw.trim().length === 0) {
    throw new Error(
      `personas[${options.index}].id must be a non-empty string (${options.sourceLabel})`,
    );
  }
  const personaId = personaIdRaw.trim();

  if (typeof roleRaw !== "string" || !ALLOWED_ROLES.has(roleRaw)) {
    throw new Error(
      `personas[${options.index}].role must be one of: ${
        [...ALLOWED_ROLES].sort().join(", ")
      } (${options.sourceLabel})`,
    );
  }

  if (typeof focusRaw !== "string" || focusRaw.trim().length === 0) {
    throw new Error(
      `personas[${options.index}].focus must be a non-empty string (${options.sourceLabel})`,
    );
  }
  const focus = focusRaw.trim();

  if (typeof canBlockRaw !== "boolean") {
    throw new Error(
      `personas[${options.index}].can_block must be bool (${options.sourceLabel})`,
    );
  }

  if (typeof enabledRaw !== "boolean") {
    throw new Error(
      `personas[${options.index}].enabled must be bool (${options.sourceLabel})`,
    );
  }

  return {
    id: personaId,
    role: roleRaw as PersonaRole,
    focus,
    can_block: canBlockRaw,
    enabled: enabledRaw,
    execution,
  };
}

function parseExecution(
  raw: unknown,
  options: ParseExecutionOptions,
): PersonaExecutionConfig | null {
  if (!options.hasExecution || raw === null || raw === undefined) {
    return null;
  }
  if (!isRecord(raw)) {
    throw new Error(
      `personas[${options.index}].execution must be an object (${options.sourceLabel})`,
    );
  }

  const unknownKeys = Object.keys(raw).filter((key) =>
    !ALLOWED_EXECUTION_KEYS.has(key)
  ).sort();
  if (unknownKeys.length > 0) {
    throw new Error(
      `personas[${options.index}].execution has unknown keys: ${
        unknownKeys.join(", ")
      } (${options.sourceLabel})`,
    );
  }

  const required = ["enabled", "command_ref", "sandbox", "timeout_sec"];
  const missing = required.filter((key) => !(key in raw));
  if (missing.length > 0) {
    throw new Error(
      `personas[${options.index}].execution missing required keys: ${
        missing.join(", ")
      } (${options.sourceLabel})`,
    );
  }

  const enabled = raw.enabled;
  const commandRef = raw.command_ref;
  const sandbox = raw.sandbox;
  const timeoutSec = raw.timeout_sec;

  if (typeof enabled !== "boolean") {
    throw new Error(
      `personas[${options.index}].execution.enabled must be bool (${options.sourceLabel})`,
    );
  }
  if (typeof commandRef !== "string" || commandRef.trim().length === 0) {
    throw new Error(
      `personas[${options.index}].execution.command_ref must be a non-empty string (${options.sourceLabel})`,
    );
  }
  if (typeof sandbox !== "string" || sandbox.trim().length === 0) {
    throw new Error(
      `personas[${options.index}].execution.sandbox must be a non-empty string (${options.sourceLabel})`,
    );
  }
  if (
    typeof timeoutSec !== "number" || !Number.isInteger(timeoutSec) ||
    timeoutSec <= 0
  ) {
    throw new Error(
      `personas[${options.index}].execution.timeout_sec must be a positive integer (${options.sourceLabel})`,
    );
  }

  return {
    enabled,
    command_ref: commandRef.trim(),
    sandbox: sandbox.trim(),
    timeout_sec: timeoutSec,
  };
}

function assertDefaultPersonaDirectoryExists(path: URL): void {
  try {
    const stat = Deno.statSync(path);
    if (!stat.isDirectory) {
      throw new Error();
    }
  } catch (_error) {
    throw new Error(
      `default persona directory not found: ${displayPath(path)}`,
    );
  }
}

function parseSimpleYamlObject(content: string): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  let nested: Record<string, unknown> | null = null;
  let nestedKey = "";

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }

    const indent = countLeadingSpaces(line);
    if (indent === 0) {
      const parsed = parseYamlKeyValue(trimmed);
      if (parsed.value === null) {
        nested = {};
        nestedKey = parsed.key;
        root[parsed.key] = nested;
      } else {
        nested = null;
        nestedKey = "";
        root[parsed.key] = parseYamlScalar(parsed.value);
      }
      continue;
    }

    if (indent === 2) {
      if (nested === null) {
        throw new Error("unexpected indentation");
      }
      const parsed = parseYamlKeyValue(line.slice(2).trim());
      if (parsed.value === null) {
        throw new Error(
          `nested object not supported: ${nestedKey}.${parsed.key}`,
        );
      }
      nested[parsed.key] = parseYamlScalar(parsed.value);
      continue;
    }

    throw new Error("invalid indentation");
  }

  return root;
}

function parseYamlKeyValue(
  line: string,
): { key: string; value: string | null } {
  const separatorIndex = line.indexOf(":");
  if (separatorIndex <= 0) {
    throw new Error("invalid key-value line");
  }
  const key = line.slice(0, separatorIndex).trim();
  if (!key) {
    throw new Error("empty key");
  }
  const valueRaw = line.slice(separatorIndex + 1).trim();
  if (valueRaw.length === 0) {
    return { key, value: null };
  }
  return { key, value: valueRaw };
}

function parseYamlScalar(raw: string): string | number | boolean {
  if (
    (raw.startsWith("'") && raw.endsWith("'")) ||
    (raw.startsWith('"') && raw.endsWith('"'))
  ) {
    return raw.slice(1, -1);
  }

  const lower = raw.toLowerCase();
  if (lower === "true") {
    return true;
  }
  if (lower === "false") {
    return false;
  }
  if (/^[+-]?\d+$/.test(raw)) {
    return Number.parseInt(raw, 10);
  }
  return raw;
}

function countLeadingSpaces(text: string): number {
  let index = 0;
  while (index < text.length && text[index] === " ") {
    index += 1;
  }
  return index;
}

function fileNameFromUrl(path: URL): string {
  const segments = path.pathname.split("/");
  return decodeURIComponent(segments[segments.length - 1] ?? "");
}

function displayPath(path: URL): string {
  const decoded = decodeURIComponent(path.pathname);
  return decoded.endsWith("/") ? decoded.slice(0, -1) : decoded;
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw);
}

function clonePersonaDefinition(persona: PersonaDefinition): PersonaDefinition {
  return {
    ...persona,
    execution: persona.execution === null ? null : { ...persona.execution },
  };
}

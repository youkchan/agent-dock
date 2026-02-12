import path from "node:path";

import { loadPersonasFromPayload } from "../persona/catalog.ts";
import {
  normalizePersonaDefaults,
  normalizeTaskPersonaPolicy,
} from "../../domain/persona_policy.ts";

export class OpenSpecCompileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenSpecCompileError";
  }
}

const TASK_ID_PATTERN =
  /(?:T-[A-Za-z0-9_-]+|TASK-[A-Za-z0-9_-]+|\d+(?:\.\d+)*)/gi;
const TASK_ID_FULL_PATTERN =
  /^(?:T-[A-Za-z0-9_-]+|TASK-[A-Za-z0-9_-]+|\d+(?:\.\d+)*)$/i;
const TASK_HEADER_PATTERN = /^\s*-\s*\[[ xX]\]\s*(.+?)\s*$/;
const CHECK_ITEM_PATTERN = /^\s*-\s*\[([ xX])\]\s*(.+?)\s*$/;
const DEPENDENCY_PATTERN =
  /^\s*-\s*(?:依存|depends?\s*on|depends_on)\s*:\s*(.+?)\s*$/i;
const TARGET_PATHS_PATTERN =
  /^\s*-\s*(?:対象|target[_\s-]*paths?)\s*:\s*(.+?)\s*$/i;
const DESCRIPTION_PATTERN =
  /^\s*-\s*(?:成果物|説明|description|deliverable|outcome)\s*:\s*(.+?)\s*$/i;
const PERSONA_DEFAULTS_PATTERN =
  /^\s*-\s*(?:persona[_\s-]*defaults?|ペルソナ(?:既定|デフォルト))\s*:\s*(.+?)\s*$/i;
const PERSONAS_PATTERN =
  /^\s*-\s*(?:personas|ペルソナ(?:定義)?)\s*:\s*(.+?)\s*$/i;
const DISABLE_PERSONAS_PATTERN =
  /^\s*-\s*(?:disable[_\s-]*personas?|利用禁止(?:ペルソナ)?|disable)\s*:\s*(.+?)\s*$/i;
const TASK_PERSONA_POLICY_PATTERN =
  /^\s*-\s*(?:persona[_\s-]*policy|ペルソナ方針)\s*:\s*(.+?)\s*$/i;
const PHASE_OVERRIDES_PATTERN =
  /^\s*-\s*(?:phase[_\s-]*overrides?|フェーズ上書き)\s*:\s*(.+?)\s*$/i;
const PHASE_ASSIGNMENTS_PATTERN =
  /^\s*-\s*(?:phase[_\s-]*(?:assignments?|owners?|executors?)|フェーズ(?:担当|実行))\s*:\s*(.+?)\s*$/i;
const REQUIRES_PLAN_PATTERN = /requires_plan\s*=\s*(true|false)/i;
const REQUIRES_PLAN_TITLE_SUFFIX_PATTERN =
  /\s*[（(][^）)]*requires_plan\s*=\s*(?:true|false)[^）)]*[）)]\s*$/i;

const ALLOWED_OVERRIDE_TOP_LEVEL_KEYS = new Set<string>([
  "teammates",
  "tasks",
  "requires_plan",
  "depends_on",
]);
const ALLOWED_TASK_OVERRIDE_KEYS = new Set<string>([
  "title",
  "description",
  "target_paths",
  "depends_on",
  "requires_plan",
]);
const DEFAULT_PERSONA_PHASE_ORDER = [
  "implement",
  "review",
  "spec_check",
  "test",
];

interface ParseTasksResult {
  tasks: Record<string, unknown>[];
  verificationItems: Record<string, unknown>[];
  personaDirectives: Record<string, unknown>;
}

interface CompileChangeOptions {
  openspecRoot?: string;
  overridesRoot?: string;
  teammates?: string[] | null;
}

interface ValidateCompiledConfigOptions {
  changeId: string;
}

export function defaultCompiledOutputPath(
  changeId: string,
  taskConfigRoot: string = "task_configs",
): string {
  return path.join(taskConfigRoot, `${changeId}.json`);
}

export function writeCompiledConfig(
  configPayload: Record<string, unknown>,
  outputPath: string,
): string {
  const target = path.resolve(outputPath);
  Deno.mkdirSync(path.dirname(target), { recursive: true });
  const serialized = JSON.stringify(sortJsonValue(configPayload), null, 2);
  Deno.writeTextFileSync(target, serialized);
  return target;
}

export function compileChangeToConfig(
  changeId: string,
  options: CompileChangeOptions = {},
): Record<string, unknown> {
  const openspecRoot = options.openspecRoot ?? "openspec";
  const overridesRoot = options.overridesRoot ?? "task_configs/overrides";
  const changeDir = path.join(openspecRoot, "changes", changeId);
  if (!isDirectory(changeDir)) {
    throw new OpenSpecCompileError(`change not found: ${changeDir}`);
  }

  const tasksPath = path.join(changeDir, "tasks.md");
  if (!isFile(tasksPath)) {
    throw new OpenSpecCompileError(`tasks.md not found: ${tasksPath}`);
  }

  const parsed = parseTasksMarkdown(tasksPath);
  const payload: Record<string, unknown> = {
    teammates: options.teammates && options.teammates.length > 0
      ? options.teammates
      : ["teammate-a", "teammate-b"],
    tasks: parsed.tasks,
    meta: {
      source_change_id: changeId,
      verification_items: parsed.verificationItems,
    },
  };

  applyPersonaDirectives(payload, parsed.personaDirectives);
  const merged = applyOverrides(
    payload,
    path.join(overridesRoot, `${changeId}.yaml`),
  );

  return validateCompiledConfig(merged, { changeId });
}

export function validateCompiledConfig(
  payload: Record<string, unknown>,
  options: ValidateCompiledConfigOptions,
): Record<string, unknown> {
  if (!isRecord(payload)) {
    throw new OpenSpecCompileError("compiled payload must be an object");
  }

  const normalizedPayload = deepClone(payload);
  validateCompiledPayload(normalizedPayload, options.changeId);
  validatePersonaPayload(normalizedPayload, options.changeId);

  const tasks = asRecordArray(normalizedPayload.tasks);
  tasks.sort((left, right) => {
    const leftId = String(left.id ?? "");
    const rightId = String(right.id ?? "");
    return leftId.localeCompare(rightId);
  });
  normalizedPayload.tasks = tasks;

  return normalizedPayload;
}

export function parseTasksMarkdown(tasksPath: string): ParseTasksResult {
  const lines = Deno.readTextFileSync(tasksPath).split(/\r?\n/);
  const parsedTasks: Record<string, unknown>[] = [];
  const verificationItems: Record<string, unknown>[] = [];
  let personaDefaults: Record<string, unknown> | null = null;
  let personas: Record<string, unknown>[] | null = null;
  let globalDisablePersonas: string[] = [];
  let currentTask: Record<string, unknown> | null = null;
  let currentDescriptionParts: string[] = [];
  const knownIds = new Set<string>();
  let currentSection = "";
  let autoIdCounter = 1;

  const finalizeCurrent = () => {
    if (currentTask === null) {
      return;
    }
    currentTask.description = currentDescriptionParts.join("\n").trim();
    parsedTasks.push(currentTask);
    currentTask = null;
  };

  for (const [index, line] of lines.entries()) {
    const lineNo = index + 1;

    const headingMatch = /^\s*##+\s+(.+?)\s*$/.exec(line);
    if (headingMatch) {
      finalizeCurrent();
      currentDescriptionParts = [];
      currentSection = headingMatch[1].trim();
      continue;
    }

    if (isVerificationSection(currentSection)) {
      const checkMatch = CHECK_ITEM_PATTERN.exec(line);
      if (checkMatch) {
        verificationItems.push({
          text: checkMatch[2].trim(),
          checked: checkMatch[1].trim().toLowerCase() === "x",
          line: lineNo,
        });
        continue;
      }
    }

    const headerMatch = TASK_HEADER_PATTERN.exec(line);
    if (headerMatch) {
      finalizeCurrent();
      currentDescriptionParts = [];

      const [taskId, titleRaw] = extractTaskIdAndTitle(
        headerMatch[1],
        autoIdCounter,
      );
      autoIdCounter += 1;

      if (knownIds.has(taskId)) {
        throw new OpenSpecCompileError(
          `duplicate task id ${taskId} at ${tasksPath}:${lineNo}`,
        );
      }
      knownIds.add(taskId);

      const requiresPlan = extractRequiresPlan(titleRaw);
      const normalizedTitle = REQUIRES_PLAN_TITLE_SUFFIX_PATTERN
          .exec(titleRaw)
        ? titleRaw.replace(REQUIRES_PLAN_TITLE_SUFFIX_PATTERN, "").trim() ||
          titleRaw
        : titleRaw;

      currentTask = {
        id: taskId,
        title: normalizedTitle,
        description: "",
        target_paths: [],
        depends_on: [],
        requires_plan: requiresPlan,
      };
      continue;
    }

    if (currentTask === null) {
      const personaDefaultsMatch = PERSONA_DEFAULTS_PATTERN.exec(line);
      if (personaDefaultsMatch) {
        const parsedDefaults = parseInlineJsonObject(personaDefaultsMatch[1], {
          expectedType: "object",
          label: "persona_defaults",
          tasksPath,
          lineNo,
        });
        personaDefaults = mergeDictValues(personaDefaults, parsedDefaults);
        continue;
      }

      const personasMatch = PERSONAS_PATTERN.exec(line);
      if (personasMatch) {
        const parsedPersonas = parseInlineJsonArray(personasMatch[1], {
          expectedType: "array",
          label: "personas",
          tasksPath,
          lineNo,
        });
        const normalized = parsedPersonas.filter(isRecord);
        if (normalized.length !== parsedPersonas.length) {
          throw new OpenSpecCompileError(
            `personas must be an array of objects at ${tasksPath}:${lineNo}`,
          );
        }
        personas = normalized;
        continue;
      }

      const globalDisableMatch = DISABLE_PERSONAS_PATTERN.exec(line);
      if (globalDisableMatch) {
        globalDisablePersonas = mergeUnique(
          globalDisablePersonas,
          parsePersonaIdList(globalDisableMatch[1]),
        );
        continue;
      }

      const globalPhaseAssignmentsMatch = PHASE_ASSIGNMENTS_PATTERN.exec(line);
      if (globalPhaseAssignmentsMatch) {
        const assignments = parsePhaseAssignments(
          globalPhaseAssignmentsMatch[1],
          {
            tasksPath,
            lineNo,
          },
        );
        if (personaDefaults === null) {
          personaDefaults = {};
        }
        const phasePolicies = personaDefaults.phase_policies;
        if (phasePolicies !== undefined && !isRecord(phasePolicies)) {
          throw new OpenSpecCompileError(
            `persona_defaults.phase_policies must be object at ${tasksPath}:${lineNo}`,
          );
        }
        personaDefaults.phase_policies = mergeDictValues(
          asRecordOrNull(phasePolicies),
          assignments,
        );

        const phaseOrderRaw = personaDefaults.phase_order;
        if (phaseOrderRaw !== undefined && !Array.isArray(phaseOrderRaw)) {
          throw new OpenSpecCompileError(
            `persona_defaults.phase_order must be list at ${tasksPath}:${lineNo}`,
          );
        }
        const phaseOrder = Array.isArray(phaseOrderRaw)
          ? [...phaseOrderRaw.map((value) => String(value))]
          : [];
        for (const phase of Object.keys(assignments)) {
          if (!phaseOrder.includes(phase)) {
            phaseOrder.push(phase);
          }
        }
        personaDefaults.phase_order = phaseOrder;
        continue;
      }

      continue;
    }

    const personaPolicyMatch = TASK_PERSONA_POLICY_PATTERN.exec(line);
    if (personaPolicyMatch) {
      const parsedPolicy = parseInlineJsonObject(personaPolicyMatch[1], {
        expectedType: "object",
        label: "persona_policy",
        tasksPath,
        lineNo,
      });
      currentTask.persona_policy = mergePersonaPolicy(
        asRecordOrNull(currentTask.persona_policy),
        parsedPolicy,
      );
      continue;
    }

    const taskPhaseOverridesMatch = PHASE_OVERRIDES_PATTERN.exec(line);
    if (taskPhaseOverridesMatch) {
      const parsedPhaseOverrides = parseInlineJsonObject(
        taskPhaseOverridesMatch[1],
        {
          expectedType: "object",
          label: "phase_overrides",
          tasksPath,
          lineNo,
        },
      );
      currentTask.persona_policy = mergePersonaPolicy(
        asRecordOrNull(currentTask.persona_policy),
        { phase_overrides: parsedPhaseOverrides },
      );
      continue;
    }

    const taskDisableMatch = DISABLE_PERSONAS_PATTERN.exec(line);
    if (taskDisableMatch) {
      currentTask.persona_policy = mergePersonaPolicy(
        asRecordOrNull(currentTask.persona_policy),
        { disable_personas: parsePersonaIdList(taskDisableMatch[1]) },
      );
      continue;
    }

    const taskPhaseAssignmentsMatch = PHASE_ASSIGNMENTS_PATTERN.exec(line);
    if (taskPhaseAssignmentsMatch) {
      currentTask.persona_policy = mergePersonaPolicy(
        asRecordOrNull(currentTask.persona_policy),
        {
          phase_overrides: parsePhaseAssignments(taskPhaseAssignmentsMatch[1], {
            tasksPath,
            lineNo,
          }),
        },
      );
      continue;
    }

    const depMatch = DEPENDENCY_PATTERN.exec(line);
    if (depMatch) {
      currentTask.depends_on = parseDependencyValue(depMatch[1], {
        tasksPath,
        lineNo,
      });
      continue;
    }

    const targetMatch = TARGET_PATHS_PATTERN.exec(line);
    if (targetMatch) {
      currentTask.target_paths = parsePathValue(targetMatch[1]);
      continue;
    }

    const descriptionMatch = DESCRIPTION_PATTERN.exec(line);
    if (descriptionMatch) {
      currentDescriptionParts.push(descriptionMatch[1].trim());
      continue;
    }
  }

  finalizeCurrent();

  if (parsedTasks.length === 0) {
    throw new OpenSpecCompileError(`no tasks found in ${tasksPath}`);
  }

  const personaDirectives: Record<string, unknown> = {};
  if (personas !== null) {
    personaDirectives.personas = personas;
  }
  if (personaDefaults !== null) {
    personaDirectives.persona_defaults = personaDefaults;
  }
  if (globalDisablePersonas.length > 0) {
    personaDirectives.global_disable_personas = globalDisablePersonas;
  }

  return {
    tasks: parsedTasks,
    verificationItems,
    personaDirectives,
  };
}

function isVerificationSection(sectionTitle: string): boolean {
  const normalized = sectionTitle.trim().replace(/\s+/g, " ").toLowerCase();
  const patterns = [
    /検証項目/,
    /verification/,
    /validation/,
    /checklist/,
    /checks?/,
    /testing/,
    /\bqa\b/,
  ];
  return patterns.some((pattern) => pattern.test(normalized));
}

function extractRequiresPlan(text: string): boolean {
  const match = REQUIRES_PLAN_PATTERN.exec(text);
  if (!match) {
    return false;
  }
  return match[1].toLowerCase() === "true";
}

function extractTaskIdAndTitle(
  rawHeader: string,
  autoIdCounter: number,
): [string, string] {
  const stripped = rawHeader.trim();
  const matched =
    /^(?<task_id>(?:T-[A-Za-z0-9_-]+|TASK-[A-Za-z0-9_-]+|\d+(?:\.\d+)*))\s+(?<title>.+)$/i
      .exec(stripped);
  if (matched?.groups) {
    return [matched.groups.task_id.trim(), matched.groups.title.trim()];
  }
  return [`AUTO-${String(autoIdCounter).padStart(3, "0")}`, stripped];
}

function parseDependencyValue(
  raw: string,
  options: { tasksPath: string; lineNo: number },
): string[] {
  const cleaned = raw.trim();
  if (
    cleaned === "なし" || cleaned === "none" || cleaned === "None" ||
    cleaned === "-"
  ) {
    return [];
  }
  const dependencies = cleaned.match(TASK_ID_PATTERN) ?? [];
  if (dependencies.length > 0) {
    return dependencies;
  }
  throw new OpenSpecCompileError(
    `dependency parse failed at ${options.tasksPath}:${options.lineNo}. ` +
      "use task ids like T-001/TASK-1/1.1 or 'none'.",
  );
}

function parsePathValue(raw: string): string[] {
  const value = raw.trim();
  if (value.length === 0) {
    return [];
  }
  if (
    value === "なし" || value === "none" || value === "None" || value === "-"
  ) {
    return [];
  }

  const backticked = [...value.matchAll(/`([^`]+)`/g)]
    .map((matched) => matched[1].trim())
    .filter((item) => item.length > 0);
  if (backticked.length > 0) {
    return backticked;
  }

  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim();
    if (inner.length === 0) {
      return [];
    }
    return inner.split(",").map((item) => stripQuotes(item.trim())).filter(
      (item) => item.length > 0,
    );
  }

  if (value.includes(",") || value.includes("、")) {
    return value.split(/[、,]/).map((item) => stripQuotes(item.trim())).filter(
      (item) => item.length > 0,
    );
  }

  return [stripQuotes(value)];
}

function parseInlineJson(
  raw: string,
  options: {
    expectedType: "object" | "array";
    label: string;
    tasksPath: string;
    lineNo: number;
  },
): Record<string, unknown> | unknown[] {
  let value = raw.trim();
  if (value.startsWith("`") && value.endsWith("`") && value.length >= 2) {
    value = value.slice(1, -1).trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (_error) {
    throw new OpenSpecCompileError(
      `${options.label} must be JSON at ${options.tasksPath}:${options.lineNo}`,
    );
  }

  if (options.expectedType === "object") {
    if (!isRecord(parsed)) {
      throw new OpenSpecCompileError(
        `${options.label} must be JSON object at ${options.tasksPath}:${options.lineNo}`,
      );
    }
    return parsed;
  }

  if (!Array.isArray(parsed)) {
    throw new OpenSpecCompileError(
      `${options.label} must be JSON array at ${options.tasksPath}:${options.lineNo}`,
    );
  }
  return parsed;
}

function parseInlineJsonObject(
  raw: string,
  options: {
    expectedType: "object";
    label: string;
    tasksPath: string;
    lineNo: number;
  },
): Record<string, unknown> {
  return parseInlineJson(raw, options) as Record<string, unknown>;
}

function parseInlineJsonArray(
  raw: string,
  options: {
    expectedType: "array";
    label: string;
    tasksPath: string;
    lineNo: number;
  },
): unknown[] {
  return parseInlineJson(raw, options) as unknown[];
}

function parsePersonaIdList(raw: string): string[] {
  const candidates = parsePathValue(raw);
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const item of candidates) {
    let parts = item.split(/[\/]/).map((part) => part.trim()).filter((part) =>
      part.length > 0
    );
    if (parts.length === 0) {
      parts = [item.trim()];
    }

    for (const part of parts) {
      if (part.length === 0 || seen.has(part)) {
        continue;
      }
      seen.add(part);
      normalized.push(part);
    }
  }

  return normalized;
}

function mergeUnique(existing: string[], incoming: string[]): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();

  for (const item of [...existing, ...incoming]) {
    const value = String(item).trim();
    if (value.length === 0 || seen.has(value)) {
      continue;
    }
    seen.add(value);
    merged.push(value);
  }

  return merged;
}

function parsePhaseAssignments(
  raw: string,
  options: { tasksPath: string; lineNo: number },
): Record<string, unknown> {
  const parsed: Record<string, unknown> = {};
  const chunks = raw.split(/[;|]/).map((chunk) => chunk.trim()).filter((
    chunk,
  ) => chunk.length > 0);
  if (chunks.length === 0) {
    throw new OpenSpecCompileError(
      `phase assignments must not be empty at ${options.tasksPath}:${options.lineNo}`,
    );
  }

  for (const chunk of chunks) {
    const matched = /^(?<phase>[^=:]+)\s*(?:=|:)\s*(?<personas>.+)$/.exec(
      chunk,
    );
    if (!matched?.groups) {
      throw new OpenSpecCompileError(
        `invalid phase assignment '${chunk}' at ${options.tasksPath}:${options.lineNo}`,
      );
    }

    const phase = normalizePhaseId(matched.groups.phase);
    const personaIds = parsePersonaIdList(matched.groups.personas);
    if (personaIds.length === 0) {
      throw new OpenSpecCompileError(
        `phase assignment has no personas for phase '${phase}' at ${options.tasksPath}:${options.lineNo}`,
      );
    }

    parsed[phase] = {
      active_personas: personaIds,
      executor_personas: personaIds,
      state_transition_personas: personaIds,
    };
  }

  return parsed;
}

function mergePersonaPolicy(
  existing: Record<string, unknown> | null,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const merged = isRecord(existing) ? deepClone(existing) : {};

  for (const [key, value] of Object.entries(incoming)) {
    if (key === "disable_personas") {
      const incomingValues = Array.isArray(value)
        ? mergeUnique(
          [],
          value.map((item) => String(item).trim()).filter((item) =>
            item.length > 0
          ),
        )
        : parsePersonaIdList(String(value));
      const existingValues = Array.isArray(merged.disable_personas)
        ? merged.disable_personas.map((item) => String(item))
        : [];
      merged.disable_personas = mergeUnique(existingValues, incomingValues);
      continue;
    }

    if (key === "phase_overrides") {
      const incomingOverrides = isRecord(value) ? value : {};
      const existingOverrides = asRecordOrNull(merged.phase_overrides);
      merged.phase_overrides = mergeDictValues(
        existingOverrides,
        incomingOverrides,
      );
      continue;
    }

    merged[key] = deepClone(value);
  }

  return merged;
}

function mergeDictValues(
  existing: Record<string, unknown> | null,
  incoming: Record<string, unknown> | null,
): Record<string, unknown> {
  if (!isRecord(existing)) {
    return isRecord(incoming) ? deepClone(incoming) : {};
  }
  if (!isRecord(incoming)) {
    return deepClone(existing);
  }

  const merged = deepClone(existing);
  for (const [key, value] of Object.entries(incoming)) {
    const existingValue = merged[key];
    if (isRecord(value) && isRecord(existingValue)) {
      merged[key] = mergeDictValues(existingValue, value);
      continue;
    }
    if (Array.isArray(value) && Array.isArray(existingValue)) {
      merged[key] = mergeUnique(
        existingValue.map((item) => String(item)),
        value.map((item) => String(item)),
      );
      continue;
    }
    merged[key] = deepClone(value);
  }

  return merged;
}

function normalizePhaseId(raw: string): string {
  const base = String(raw).trim().toLowerCase().replace(/[\s\-]+/g, "_");
  const aliases: Record<string, string> = {
    speccheck: "spec_check",
    spec_checker: "spec_check",
    spec_review: "spec_check",
  };
  return aliases[base] ?? base;
}

function applyPersonaDirectives(
  payload: Record<string, unknown>,
  personaDirectives: Record<string, unknown>,
): void {
  if (Object.keys(personaDirectives).length === 0) {
    return;
  }

  if ("personas" in personaDirectives) {
    payload.personas = deepClone(personaDirectives.personas);
  }
  if ("persona_defaults" in personaDirectives) {
    payload.persona_defaults = deepClone(personaDirectives.persona_defaults);
  }

  const globalDisable = Array.isArray(personaDirectives.global_disable_personas)
    ? personaDirectives.global_disable_personas
    : [];
  const globalDisableList = globalDisable
    .map((item) => String(item).trim())
    .filter((item) => item.length > 0);

  if (globalDisableList.length > 0) {
    for (const task of asRecordArray(payload.tasks)) {
      task.persona_policy = mergePersonaPolicy(
        asRecordOrNull(task.persona_policy),
        { disable_personas: globalDisableList },
      );
    }
  }

  const taskPolicyIds = asRecordArray(payload.tasks)
    .filter((task) => isRecord(task.persona_policy))
    .map((task) => String(task.id ?? "").trim())
    .filter((taskId) => taskId.length > 0)
    .sort();

  const meta = ensureRecordField(payload, "meta");
  meta.persona_resolution = {
    global_disable_personas: [...globalDisableList].sort(),
    tasks_with_persona_policy: taskPolicyIds,
  };
}

function applyOverrides(
  basePayload: Record<string, unknown>,
  overridePath: string,
): Record<string, unknown> {
  if (!isFile(overridePath)) {
    return basePayload;
  }

  const overrideData = loadOverrideYaml(overridePath);
  const unknownTopLevel = Object.keys(overrideData)
    .filter((key) => !ALLOWED_OVERRIDE_TOP_LEVEL_KEYS.has(key));
  if (unknownTopLevel.length > 0) {
    const unknownSorted = unknownTopLevel.sort().join(", ");
    throw new OpenSpecCompileError(`unknown override keys: ${unknownSorted}`);
  }

  const merged = deepClone(basePayload);
  const tasks = asRecordArray(merged.tasks);
  const tasksById = new Map<string, Record<string, unknown>>();
  for (const task of tasks) {
    tasksById.set(String(task.id), task);
  }

  if ("teammates" in overrideData) {
    const teammates = overrideData.teammates;
    if (!Array.isArray(teammates) || teammates.length === 0) {
      throw new OpenSpecCompileError(
        "override teammates must be a non-empty list",
      );
    }
    const normalized = teammates
      .map((item) => String(item).trim())
      .filter((item) => item.length > 0);
    if (normalized.length === 0) {
      throw new OpenSpecCompileError(
        "override teammates must contain at least one non-empty id",
      );
    }
    merged.teammates = normalized;
  }

  if ("requires_plan" in overrideData) {
    const requiresMap = overrideData.requires_plan;
    if (!isRecord(requiresMap)) {
      throw new OpenSpecCompileError(
        "override requires_plan must be an object",
      );
    }
    for (const [taskId, flag] of Object.entries(requiresMap)) {
      const task = resolveTaskForOverride(tasksById, taskId);
      if (typeof flag !== "boolean") {
        throw new OpenSpecCompileError(
          `requires_plan override must be bool: ${taskId}`,
        );
      }
      task.requires_plan = flag;
    }
  }

  if ("depends_on" in overrideData) {
    const dependsMap = overrideData.depends_on;
    if (!isRecord(dependsMap)) {
      throw new OpenSpecCompileError("override depends_on must be an object");
    }
    for (const [taskId, deps] of Object.entries(dependsMap)) {
      const task = resolveTaskForOverride(tasksById, taskId);
      task.depends_on = normalizeDependsOverride(taskId, deps);
    }
  }

  if ("tasks" in overrideData) {
    const taskOverrides = overrideData.tasks;
    if (!isRecord(taskOverrides)) {
      throw new OpenSpecCompileError("override tasks must be an object");
    }

    for (const [taskId, overrideItem] of Object.entries(taskOverrides)) {
      const task = resolveTaskForOverride(tasksById, taskId);
      if (!isRecord(overrideItem)) {
        throw new OpenSpecCompileError(
          `task override must be object: ${taskId}`,
        );
      }

      const unknownTaskKeys = Object.keys(overrideItem)
        .filter((key) => !ALLOWED_TASK_OVERRIDE_KEYS.has(key));
      if (unknownTaskKeys.length > 0) {
        const unknownSorted = unknownTaskKeys.sort().join(", ");
        throw new OpenSpecCompileError(
          `unknown task override keys for ${taskId}: ${unknownSorted}`,
        );
      }

      if ("title" in overrideItem) {
        const title = String(overrideItem.title).trim();
        if (!title) {
          throw new OpenSpecCompileError(
            `title override must be non-empty: ${taskId}`,
          );
        }
        task.title = title;
      }

      if ("description" in overrideItem) {
        task.description = String(overrideItem.description);
      }

      if ("target_paths" in overrideItem) {
        if (!Array.isArray(overrideItem.target_paths)) {
          throw new OpenSpecCompileError(
            `target_paths override must be list: ${taskId}`,
          );
        }
        task.target_paths = overrideItem.target_paths
          .map((item) => String(item).trim())
          .filter((item) => item.length > 0);
      }

      if ("depends_on" in overrideItem) {
        task.depends_on = normalizeDependsOverride(
          taskId,
          overrideItem.depends_on,
        );
      }

      if ("requires_plan" in overrideItem) {
        if (typeof overrideItem.requires_plan !== "boolean") {
          throw new OpenSpecCompileError(
            `requires_plan override must be bool: ${taskId}`,
          );
        }
        task.requires_plan = overrideItem.requires_plan;
      }
    }
  }

  return merged;
}

function loadOverrideYaml(pathValue: string): Record<string, unknown> {
  const content = Deno.readTextFileSync(pathValue);
  const loaded = parseYamlDocument(content);
  if (loaded === null || loaded === undefined) {
    return {};
  }
  if (!isRecord(loaded)) {
    throw new OpenSpecCompileError(
      `override root must be object: ${pathValue}`,
    );
  }
  return loaded;
}

function resolveTaskForOverride(
  tasksById: Map<string, Record<string, unknown>>,
  taskId: string,
): Record<string, unknown> {
  const task = tasksById.get(taskId);
  if (!task) {
    throw new OpenSpecCompileError(
      `override references unknown task id: ${taskId}`,
    );
  }
  return task;
}

function normalizeDependsOverride(taskId: string, value: unknown): string[] {
  if (typeof value === "string") {
    const cleaned = value.trim();
    if (
      cleaned === "" || cleaned === "-" || cleaned === "なし" ||
      cleaned === "none" || cleaned === "None"
    ) {
      return [];
    }

    const dependencies = cleaned.match(TASK_ID_PATTERN) ?? [];
    if (dependencies.length === 0) {
      throw new OpenSpecCompileError(
        `depends_on override must include task ids: ${taskId}`,
      );
    }
    return dependencies;
  }

  if (Array.isArray(value)) {
    const normalized = value.map((item) => String(item).trim()).filter((item) =>
      item.length > 0
    );
    for (const dep of normalized) {
      if (!TASK_ID_FULL_PATTERN.test(dep)) {
        throw new OpenSpecCompileError(
          `depends_on override contains invalid id '${dep}' for ${taskId}`,
        );
      }
    }
    return normalized;
  }

  throw new OpenSpecCompileError(
    `depends_on override must be list or string: ${taskId}`,
  );
}

function validateCompiledPayload(
  payload: Record<string, unknown>,
  changeId: string,
): void {
  const teammates = payload.teammates;
  if (!Array.isArray(teammates) || teammates.length === 0) {
    throw new OpenSpecCompileError(
      "compiled teammates must be a non-empty list",
    );
  }

  const normalizedTeammates = teammates
    .map((item) => String(item).trim())
    .filter((item) => item.length > 0);
  if (normalizedTeammates.length === 0) {
    throw new OpenSpecCompileError(
      "compiled teammates must contain non-empty values",
    );
  }
  payload.teammates = normalizedTeammates;

  const tasks = payload.tasks;
  if (!Array.isArray(tasks) || tasks.length === 0) {
    throw new OpenSpecCompileError("compiled tasks must be a non-empty list");
  }

  const taskIds = new Set<string>();
  const autoTargetPathTasks: string[] = [];
  const dependencyGraph = new Map<string, string[]>();

  for (const rawTask of tasks) {
    if (!isRecord(rawTask)) {
      throw new OpenSpecCompileError("each compiled task must be an object");
    }

    const taskId = String(rawTask.id ?? "").trim();
    if (!taskId) {
      throw new OpenSpecCompileError("task id is required");
    }
    if (taskIds.has(taskId)) {
      throw new OpenSpecCompileError(
        `duplicate task id in compiled config: ${taskId}`,
      );
    }
    taskIds.add(taskId);

    const title = String(rawTask.title ?? "").trim();
    if (!title) {
      throw new OpenSpecCompileError(`task title is required: ${taskId}`);
    }
    rawTask.title = title;
    rawTask.description = String(rawTask.description ?? "").trim();

    if (!Array.isArray(rawTask.target_paths)) {
      throw new OpenSpecCompileError(`target_paths must be list: ${taskId}`);
    }
    let normalizedPaths = rawTask.target_paths
      .map((item) => String(item).trim())
      .filter((item) => item.length > 0);
    if (normalizedPaths.length === 0) {
      normalizedPaths = ["*"];
      autoTargetPathTasks.push(taskId);
    }
    rawTask.target_paths = normalizedPaths;

    const dependsOn = rawTask.depends_on ?? [];
    if (!Array.isArray(dependsOn)) {
      throw new OpenSpecCompileError(`depends_on must be list: ${taskId}`);
    }
    const normalizedDeps = dependsOn
      .map((item) => String(item).trim())
      .filter((item) => item.length > 0);
    rawTask.depends_on = normalizedDeps;
    dependencyGraph.set(taskId, normalizedDeps);

    const requiresPlan = rawTask.requires_plan ?? false;
    if (typeof requiresPlan !== "boolean") {
      throw new OpenSpecCompileError(`requires_plan must be bool: ${taskId}`);
    }
    rawTask.requires_plan = requiresPlan;
  }

  const missingDependencies: string[] = [];
  for (const [taskId, dependencies] of dependencyGraph.entries()) {
    for (const dep of dependencies) {
      if (!taskIds.has(dep)) {
        missingDependencies.push(
          `unknown dependency '${dep}' in task ${taskId} for change ${changeId}`,
        );
      }
    }
  }
  if (missingDependencies.length > 0) {
    throw new OpenSpecCompileError(missingDependencies.join("; "));
  }

  const meta = ensureRecordField(payload, "meta");
  meta.auto_target_path_tasks = [...autoTargetPathTasks].sort();

  validateNoDependencyCycle(dependencyGraph);
}

function validatePersonaPayload(
  payload: Record<string, unknown>,
  changeId: string,
): void {
  canonicalizePhaseFields(payload);
  const sourceLabel = `openspec:${changeId}`;

  try {
    const personas = loadPersonasFromPayload(payload, sourceLabel);
    const knownPersonaIds = new Set(personas.map((persona) => persona.id));
    const validationErrors: string[] = [];

    if ("persona_defaults" in payload) {
      try {
        payload.persona_defaults = normalizePersonaDefaults(
          payload.persona_defaults,
          {
            sourceLabel,
            knownPersonaIds,
          },
        );
      } catch (error) {
        validationErrors.push(errorToMessage(error));
      }
    }

    let knownPhases = new Set<string>(DEFAULT_PERSONA_PHASE_ORDER);
    const personaDefaults = payload.persona_defaults;
    if (isRecord(personaDefaults)) {
      if (
        Array.isArray(personaDefaults.phase_order) &&
        personaDefaults.phase_order.length > 0
      ) {
        knownPhases = new Set(
          personaDefaults.phase_order.map((phase) => String(phase)),
        );
      }

      if (isRecord(personaDefaults.phase_policies)) {
        const unknownPhases = Object.keys(personaDefaults.phase_policies)
          .filter((phase) => !knownPhases.has(phase))
          .sort();
        if (unknownPhases.length > 0) {
          validationErrors.push(
            `unknown persona phase(s) in persona_defaults: ${
              unknownPhases.join(", ")
            }`,
          );
        }
      }
    }

    for (const task of asRecordArray(payload.tasks)) {
      const taskId = String(task.id ?? "").trim() || "<unknown>";
      const rawPolicy = task.persona_policy;

      let normalizedPolicy: Record<string, unknown> | null = null;
      try {
        normalizedPolicy = normalizeTaskPersonaPolicy(rawPolicy, {
          sourceLabel,
          taskId,
          knownPersonaIds,
        }) as Record<string, unknown> | null;
      } catch (error) {
        validationErrors.push(`task ${taskId}: ${errorToMessage(error)}`);
        continue;
      }

      let taskHasError = false;
      if (isRecord(normalizedPolicy)) {
        if (Array.isArray(normalizedPolicy.phase_order)) {
          const unknownPhases = normalizedPolicy.phase_order
            .map((phase) => String(phase))
            .filter((phase) => !knownPhases.has(phase))
            .sort();
          if (unknownPhases.length > 0) {
            validationErrors.push(
              `unknown persona phase(s) in task ${taskId} phase_order: ${
                unknownPhases.join(", ")
              }`,
            );
            taskHasError = true;
          }
        }

        const phaseOverrides = normalizedPolicy.phase_overrides;
        if (isRecord(phaseOverrides)) {
          const unknownPhases = Object.keys(phaseOverrides)
            .filter((phase) => !knownPhases.has(phase))
            .sort();
          if (unknownPhases.length > 0) {
            validationErrors.push(
              `unknown persona phase(s) in task ${taskId}: ${
                unknownPhases.join(", ")
              }`,
            );
            taskHasError = true;
          }
        }

        if (
          !isRecord(phaseOverrides) || Object.keys(phaseOverrides).length === 0
        ) {
          validationErrors.push(
            `task ${taskId} must define phase assignments via persona_policy.phase_overrides`,
          );
          taskHasError = true;
        }
      } else {
        validationErrors.push(
          `task ${taskId} must define phase assignments via persona_policy.phase_overrides`,
        );
        taskHasError = true;
      }

      if (taskHasError) {
        continue;
      }
      if (normalizedPolicy === null) {
        delete task.persona_policy;
      } else {
        task.persona_policy = normalizedPolicy;
      }
    }

    if ("personas" in payload) {
      payload.personas = personas.map((persona) => {
        const serialized: Record<string, unknown> = {
          id: persona.id,
          role: persona.role,
          focus: persona.focus,
          can_block: persona.can_block,
          enabled: persona.enabled,
        };
        if (persona.execution !== null) {
          serialized.execution = {
            enabled: persona.execution.enabled,
            command_ref: persona.execution.command_ref,
            sandbox: persona.execution.sandbox,
            timeout_sec: persona.execution.timeout_sec,
          };
        }
        return serialized;
      });
    }

    if (validationErrors.length > 0) {
      throw new OpenSpecCompileError(validationErrors.join("; "));
    }
  } catch (error) {
    if (error instanceof OpenSpecCompileError) {
      throw error;
    }
    throw new OpenSpecCompileError(errorToMessage(error));
  }
}

function canonicalizePhaseFields(payload: Record<string, unknown>): void {
  let defaultPhaseOrder: string[] = [];

  if (isRecord(payload.persona_defaults)) {
    const personaDefaults = payload.persona_defaults;

    if (Array.isArray(personaDefaults.phase_order)) {
      const normalizedOrder: string[] = [];
      const seen = new Set<string>();
      for (const item of personaDefaults.phase_order) {
        const phase = normalizePhaseId(String(item));
        if (!phase || seen.has(phase)) {
          continue;
        }
        seen.add(phase);
        normalizedOrder.push(phase);
      }
      personaDefaults.phase_order = normalizedOrder;
      defaultPhaseOrder = [...normalizedOrder];
    }

    if (isRecord(personaDefaults.phase_policies)) {
      const normalizedPolicies: Record<string, unknown> = {};
      for (
        const [phaseRaw, phasePolicy] of Object.entries(
          personaDefaults.phase_policies,
        )
      ) {
        normalizedPolicies[normalizePhaseId(String(phaseRaw))] = phasePolicy;
      }
      personaDefaults.phase_policies = normalizedPolicies;
    }
  }

  for (const task of asRecordArray(payload.tasks)) {
    if (!isRecord(task.persona_policy)) {
      continue;
    }
    const policy = task.persona_policy;

    const normalizedTaskPhaseOrder: string[] = [];
    if (Array.isArray(policy.phase_order)) {
      const seen = new Set<string>();
      for (const item of policy.phase_order) {
        const phase = normalizePhaseId(String(item));
        if (!phase || seen.has(phase)) {
          continue;
        }
        seen.add(phase);
        normalizedTaskPhaseOrder.push(phase);
      }
      policy.phase_order = normalizedTaskPhaseOrder;
    }

    if (isRecord(policy.phase_overrides)) {
      const normalizedOverrides: Record<string, unknown> = {};
      for (
        const [phaseRaw, phasePolicy] of Object.entries(policy.phase_overrides)
      ) {
        normalizedOverrides[normalizePhaseId(String(phaseRaw))] = phasePolicy;
      }
      policy.phase_overrides = normalizedOverrides;

      if (normalizedTaskPhaseOrder.length === 0) {
        const taskOverridePhases = Object.keys(normalizedOverrides);
        if (defaultPhaseOrder.length > 0) {
          const ordered = defaultPhaseOrder.filter((phase) =>
            Object.prototype.hasOwnProperty.call(normalizedOverrides, phase)
          );
          for (const phase of taskOverridePhases) {
            if (!ordered.includes(phase)) {
              ordered.push(phase);
            }
          }
          policy.phase_order = ordered;
        } else {
          policy.phase_order = taskOverridePhases;
        }
      }
    }
  }
}

function validateNoDependencyCycle(graph: Map<string, string[]>): void {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  const dfs = (node: string) => {
    if (visited.has(node)) {
      return;
    }
    if (visiting.has(node)) {
      const cycleStart = stack.indexOf(node);
      const cycle = [...stack.slice(cycleStart >= 0 ? cycleStart : 0), node];
      throw new OpenSpecCompileError(
        `dependency cycle detected: ${cycle.join(" -> ")}`,
      );
    }

    visiting.add(node);
    stack.push(node);
    for (const dep of graph.get(node) ?? []) {
      dfs(dep);
    }
    stack.pop();
    visiting.delete(node);
    visited.add(node);
  };

  for (const taskId of [...graph.keys()].sort()) {
    dfs(taskId);
  }
}

interface YamlLine {
  indent: number;
  text: string;
}

function parseYamlDocument(content: string): unknown {
  const lines = tokenizeYaml(content);
  if (lines.length === 0) {
    return {};
  }

  const [value, nextIndex] = parseYamlNode(lines, 0, lines[0].indent);
  if (nextIndex !== lines.length) {
    throw new OpenSpecCompileError("invalid override yaml structure");
  }
  return value;
}

function tokenizeYaml(content: string): YamlLine[] {
  const lines: YamlLine[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const withoutComment = stripYamlComment(rawLine).replace(/\s+$/, "");
    if (withoutComment.trim().length === 0) {
      continue;
    }
    const indent = countLeadingSpaces(withoutComment);
    lines.push({
      indent,
      text: withoutComment.slice(indent),
    });
  }
  return lines;
}

function parseYamlNode(
  lines: YamlLine[],
  startIndex: number,
  indent: number,
): [unknown, number] {
  const line = lines[startIndex];
  if (line === undefined || line.indent < indent) {
    throw new OpenSpecCompileError("invalid override yaml indentation");
  }

  if (line.text.startsWith("- ")) {
    return parseYamlArray(lines, startIndex, indent);
  }
  return parseYamlMap(lines, startIndex, indent);
}

function parseYamlArray(
  lines: YamlLine[],
  startIndex: number,
  indent: number,
): [unknown[], number] {
  const values: unknown[] = [];
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index];
    if (line.indent < indent) {
      break;
    }
    if (line.indent !== indent || !line.text.startsWith("- ")) {
      break;
    }

    const rawValue = line.text.slice(2).trim();
    index += 1;

    if (rawValue.length === 0) {
      if (index < lines.length && lines[index].indent > indent) {
        const [nested, nextIndex] = parseYamlNode(
          lines,
          index,
          lines[index].indent,
        );
        values.push(nested);
        index = nextIndex;
      } else {
        values.push(null);
      }
      continue;
    }

    values.push(parseYamlScalar(rawValue));
  }

  return [values, index];
}

function parseYamlMap(
  lines: YamlLine[],
  startIndex: number,
  indent: number,
): [Record<string, unknown>, number] {
  const values: Record<string, unknown> = {};
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index];
    if (line.indent < indent) {
      break;
    }
    if (line.indent !== indent || line.text.startsWith("- ")) {
      break;
    }

    const parsed = parseYamlKeyValue(line.text);
    index += 1;

    if (parsed.value === null) {
      if (index < lines.length && lines[index].indent > indent) {
        const [nested, nextIndex] = parseYamlNode(
          lines,
          index,
          lines[index].indent,
        );
        values[parsed.key] = nested;
        index = nextIndex;
      } else {
        values[parsed.key] = null;
      }
      continue;
    }

    values[parsed.key] = parseYamlScalar(parsed.value);
  }

  return [values, index];
}

function parseYamlKeyValue(
  line: string,
): { key: string; value: string | null } {
  const separatorIndex = line.indexOf(":");
  if (separatorIndex <= 0) {
    throw new OpenSpecCompileError("invalid override yaml key-value line");
  }

  const key = line.slice(0, separatorIndex).trim();
  if (key.length === 0) {
    throw new OpenSpecCompileError("invalid override yaml key");
  }

  const valueRaw = line.slice(separatorIndex + 1).trim();
  if (valueRaw.length === 0) {
    return { key, value: null };
  }
  return { key, value: valueRaw };
}

function parseYamlScalar(raw: string): unknown {
  if (
    (raw.startsWith("'") && raw.endsWith("'")) ||
    (raw.startsWith('"') && raw.endsWith('"'))
  ) {
    if (raw.startsWith("'")) {
      return raw.slice(1, -1).replace(/''/g, "'");
    }
    try {
      return JSON.parse(raw);
    } catch (_error) {
      return raw.slice(1, -1);
    }
  }

  const lower = raw.toLowerCase();
  if (lower === "true") {
    return true;
  }
  if (lower === "false") {
    return false;
  }
  if (lower === "null" || lower === "~") {
    return null;
  }
  if (/^[+-]?\d+$/.test(raw)) {
    return Number.parseInt(raw, 10);
  }

  if (raw.startsWith("[") && raw.endsWith("]")) {
    const inner = raw.slice(1, -1).trim();
    if (inner.length === 0) {
      return [];
    }
    return splitTopLevel(inner).map((part) => parseYamlScalar(part.trim()));
  }

  if (raw.startsWith("{") && raw.endsWith("}")) {
    const inner = raw.slice(1, -1).trim();
    const parsed: Record<string, unknown> = {};
    if (inner.length === 0) {
      return parsed;
    }

    for (const part of splitTopLevel(inner)) {
      const keyValue = parseYamlKeyValue(part.trim());
      parsed[keyValue.key] = keyValue.value === null
        ? null
        : parseYamlScalar(keyValue.value);
    }
    return parsed;
  }

  return raw;
}

function splitTopLevel(raw: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depthSquare = 0;
  let depthCurly = 0;
  let inSingle = false;
  let inDouble = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];

    if (char === "'" && !inDouble) {
      inSingle = !inSingle;
      current += char;
      continue;
    }
    if (char === '"' && !inSingle) {
      const escaped = index > 0 && raw[index - 1] === "\\";
      if (!escaped) {
        inDouble = !inDouble;
      }
      current += char;
      continue;
    }

    if (!inSingle && !inDouble) {
      if (char === "[") {
        depthSquare += 1;
      } else if (char === "]") {
        depthSquare -= 1;
      } else if (char === "{") {
        depthCurly += 1;
      } else if (char === "}") {
        depthCurly -= 1;
      } else if (char === "," && depthSquare === 0 && depthCurly === 0) {
        parts.push(current);
        current = "";
        continue;
      }
    }

    current += char;
  }

  if (current.length > 0) {
    parts.push(current);
  }

  return parts;
}

function stripYamlComment(line: string): string {
  let inSingle = false;
  let inDouble = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }

    if (char === '"' && !inSingle) {
      const escaped = index > 0 && line[index - 1] === "\\";
      if (!escaped) {
        inDouble = !inDouble;
      }
      continue;
    }

    if (char === "#" && !inSingle && !inDouble) {
      if (index === 0 || /\s/.test(line[index - 1])) {
        return line.slice(0, index);
      }
    }
  }

  return line;
}

function countLeadingSpaces(text: string): number {
  let index = 0;
  while (index < text.length && text[index] === " ") {
    index += 1;
  }
  return index;
}

function stripQuotes(raw: string): string {
  if (
    (raw.startsWith("'") && raw.endsWith("'")) ||
    (raw.startsWith('"') && raw.endsWith('"'))
  ) {
    return raw.slice(1, -1);
  }
  return raw;
}

function isDirectory(pathValue: string): boolean {
  try {
    return Deno.statSync(pathValue).isDirectory;
  } catch (_error) {
    return false;
  }
}

function isFile(pathValue: string): boolean {
  try {
    return Deno.statSync(pathValue).isFile;
  } catch (_error) {
    return false;
  }
}

function asRecordArray(raw: unknown): Record<string, unknown>[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter(isRecord);
}

function asRecordOrNull(raw: unknown): Record<string, unknown> | null {
  return isRecord(raw) ? raw : null;
}

function ensureRecordField(
  payload: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const current = payload[key];
  if (isRecord(current)) {
    return current;
  }
  const created: Record<string, unknown> = {};
  payload[key] = created;
  return created;
}

function errorToMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortJsonValue(item));
  }
  if (isRecord(value)) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortJsonValue(value[key]);
    }
    return sorted;
  }
  return value;
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw);
}

function deepClone<T>(value: T): T {
  return structuredClone(value);
}

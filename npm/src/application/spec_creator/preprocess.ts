import {
  createSpecCreatorTaskConfigTemplate,
  type SpecCreatorTaskConfigTemplate,
} from "../../domain/spec_creator.ts";

export const SPEC_CREATOR_LANGS = ["ja", "en"] as const;

export type SpecCreatorLanguage = (typeof SPEC_CREATOR_LANGS)[number];

export interface SpecContext {
  requirements_text: string;
  scope_paths: string[];
  non_goals: string;
  acceptance_criteria: string;
  language: SpecCreatorLanguage;
  persona_policy: {
    active_personas: string[];
  };
}

export interface SpecCreatorPreprocessResult {
  change_id: string;
  spec_context: SpecContext;
  task_config: SpecCreatorTaskConfig;
}

export interface SpecCreatorPromptIO {
  prompt(message: string): string | null;
  isInteractiveTerminal(): boolean;
}

interface CollectSpecContextOptions {
  changeId: string;
  io?: SpecCreatorPromptIO;
}

export interface SpecCreatorTaskConfig extends SpecCreatorTaskConfigTemplate {
  meta: {
    source_change_id: string;
    generated_by: "spec-creator-preprocess";
    spec_context: SpecContext;
  };
}

const DEFAULT_SPEC_CREATOR_PERSONAS = [
  "spec-planner",
  "spec-reviewer",
  "spec-code-creator",
];

const DEFAULT_PROMPT_IO: SpecCreatorPromptIO = {
  prompt(message: string): string | null {
    return prompt(message);
  },
  isInteractiveTerminal(): boolean {
    return Deno.stdin.isTerminal() && Deno.stdout.isTerminal();
  },
};

export function normalizeChangeId(raw: string): string {
  const normalized = raw.trim();
  if (!/^[a-z][a-z0-9-]*$/u.test(normalized)) {
    throw new Error(
      "spec creator requires --change-id in kebab-case (e.g. add-sample-change)",
    );
  }
  return normalized;
}

export function collectSpecContextInteractive(
  options: CollectSpecContextOptions,
): SpecCreatorPreprocessResult {
  const io = options.io ?? DEFAULT_PROMPT_IO;
  const changeId = normalizeChangeId(options.changeId);

  if (!io.isInteractiveTerminal()) {
    throw new Error(
      "spec creator preprocessing requires interactive TTY (fail-closed)",
    );
  }

  const requirementsText = promptRequired(io, "requirements_text (required)");
  const nonGoals = promptRequired(io, "non_goals (required)");
  const acceptanceCriteria = promptRequired(
    io,
    "acceptance_criteria (required)",
  );
  const language = promptLanguage(io);
  const scopePathsRaw = promptOptional(
    io,
    "scope_paths (optional, comma-separated)",
  );
  const scopePaths = parseScopePaths(scopePathsRaw);

  if (!confirmSpecContext(io, changeId)) {
    throw new Error(
      "spec creator preprocessing aborted before spec_context confirmation (fail-closed)",
    );
  }

  const specContext: SpecContext = {
    requirements_text: requirementsText,
    scope_paths: scopePaths,
    non_goals: nonGoals,
    acceptance_criteria: acceptanceCriteria,
    language,
    persona_policy: {
      active_personas: [...DEFAULT_SPEC_CREATOR_PERSONAS],
    },
  };

  return {
    change_id: changeId,
    spec_context: specContext,
    task_config: buildSpecCreatorTaskConfig(changeId, specContext),
  };
}

export function buildSpecCreatorTaskConfig(
  changeId: string,
  specContext: SpecContext,
): SpecCreatorTaskConfig {
  const template = createSpecCreatorTaskConfigTemplate(changeId);
  const contextText = buildSpecContextPromptSection(specContext);
  const tasks = template.tasks.map((task) => ({
    ...task,
    target_paths: [...task.target_paths],
    depends_on: [...task.depends_on],
    persona_policy: task.persona_policy === null
      ? null
      : structuredClone(task.persona_policy),
    description: `${task.description}\n\n${contextText}`,
  }));

  return {
    teammates: [...template.teammates],
    personas: template.personas.map((persona) => structuredClone(persona)),
    persona_defaults: structuredClone(template.persona_defaults),
    tasks,
    meta: {
      source_change_id: changeId,
      generated_by: "spec-creator-preprocess",
      spec_context: structuredClone(specContext),
    },
  };
}

function buildSpecContextPromptSection(specContext: SpecContext): string {
  const scopePaths = specContext.scope_paths.length > 0
    ? specContext.scope_paths.join(", ")
    : "(none)";
  const activePersonas = specContext.persona_policy.active_personas.length > 0
    ? specContext.persona_policy.active_personas.join(", ")
    : "(none)";

  return [
    "spec_context:",
    `- requirements_text: ${normalizeLine(specContext.requirements_text)}`,
    `- non_goals: ${normalizeLine(specContext.non_goals)}`,
    `- acceptance_criteria: ${normalizeLine(specContext.acceptance_criteria)}`,
    `- language: ${specContext.language}`,
    `- scope_paths: ${scopePaths}`,
    `- active_personas: ${activePersonas}`,
  ].join("\n");
}

function normalizeLine(raw: string): string {
  return raw.replaceAll(/\s+/gu, " ").trim();
}

function promptRequired(io: SpecCreatorPromptIO, label: string): string {
  const value = io.prompt(`${label}:`);
  if (value === null) {
    throw new Error(
      `spec creator preprocessing failed: ${label} is required (fail-closed)`,
    );
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(
      `spec creator preprocessing failed: ${label} is required (fail-closed)`,
    );
  }
  return normalized;
}

function promptOptional(io: SpecCreatorPromptIO, label: string): string {
  const value = io.prompt(`${label}:`);
  return value === null ? "" : value.trim();
}

function promptLanguage(io: SpecCreatorPromptIO): SpecCreatorLanguage {
  const value = promptRequired(
    io,
    `language (${SPEC_CREATOR_LANGS.join("/")})`,
  );
  const normalized = value.toLowerCase();
  if (!SPEC_CREATOR_LANGS.includes(normalized as SpecCreatorLanguage)) {
    throw new Error(
      `spec creator preprocessing failed: language must be ${
        SPEC_CREATOR_LANGS.join(" or ")
      } (fail-closed)`,
    );
  }
  return normalized as SpecCreatorLanguage;
}

function parseScopePaths(raw: string): string[] {
  if (!raw) {
    return [];
  }
  const unique = new Set<string>();
  for (const token of raw.split(",")) {
    const normalized = token.trim();
    if (normalized) {
      unique.add(normalized);
    }
  }
  return [...unique];
}

function confirmSpecContext(
  io: SpecCreatorPromptIO,
  changeId: string,
): boolean {
  const response = io.prompt(
    `Confirm spec_context for change_id='${changeId}'? [y/N]:`,
  );
  if (response === null) {
    return false;
  }
  const normalized = response.trim().toLowerCase();
  return normalized === "y" || normalized === "yes";
}

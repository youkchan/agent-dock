import {
  createSpecCreatorTaskConfigTemplate,
  type SpecCreatorTaskConfigTemplate,
} from "../../domain/spec_creator.ts";

export const SPEC_CREATOR_LANGS = ["ja", "en"] as const;

export type SpecCreatorLanguage = (typeof SPEC_CREATOR_LANGS)[number];

export interface SpecContext {
  requirements_text: string;
  language: SpecCreatorLanguage;
  runtime_stack: "typescript";
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
  changeId?: string | null;
  io?: SpecCreatorPromptIO;
  proposeChangeId?: (requirementsText: string) => string;
}

export interface SpecCreatorTaskConfig extends SpecCreatorTaskConfigTemplate {
  meta: {
    source_change_id: string;
    generated_by: "spec-creator-preprocess";
    spec_context: SpecContext;
  };
}

interface BuildSpecCreatorTaskConfigOptions {
  includeDesignTarget?: boolean;
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
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(normalized)) {
    throw new Error(
      "spec creator requires --change-id in kebab-case (e.g. sample-change)",
    );
  }
  if (normalized.length > 64) {
    throw new Error(
      "spec creator requires --change-id length <= 64 characters",
    );
  }
  return normalized;
}

export function collectSpecContextInteractive(
  options: CollectSpecContextOptions,
): SpecCreatorPreprocessResult {
  const io = options.io ?? DEFAULT_PROMPT_IO;

  if (!io.isInteractiveTerminal()) {
    throw new Error(
      "spec creator preprocessing requires interactive TTY (fail-closed)",
    );
  }

  const requirementsText = promptRequired(io, "requirements_text (required)");
  const language = promptLanguage(io);
  const changeId = resolveChangeIdInteractive(
    io,
    options.changeId,
    requirementsText,
    options.proposeChangeId ?? proposeChangeIdFromCodex,
  );

  if (!confirmSpecContext(io, changeId)) {
    throw new Error(
      "spec creator preprocessing aborted before spec_context confirmation (fail-closed)",
    );
  }

  const specContext: SpecContext = {
    requirements_text: requirementsText,
    language,
    runtime_stack: "typescript",
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
  options: BuildSpecCreatorTaskConfigOptions = {},
): SpecCreatorTaskConfig {
  const template = createSpecCreatorTaskConfigTemplate(changeId);
  const includeDesignTarget = options.includeDesignTarget !== false;
  const tasksForScope = scopeSpecCreatorTasksByDesignTarget(
    template.tasks,
    changeId,
    includeDesignTarget,
  );
  const contextText = buildSpecContextPromptSection(specContext);
  const tasks = tasksForScope.map((task) => ({
    ...task,
    target_paths: [...task.target_paths],
    related_paths: [...task.related_paths],
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

function scopeSpecCreatorTasksByDesignTarget(
  tasks: SpecCreatorTaskConfigTemplate["tasks"],
  changeId: string,
  includeDesignTarget: boolean,
): SpecCreatorTaskConfigTemplate["tasks"] {
  const cloned = tasks.map((task) => ({
    ...task,
    target_paths: [...task.target_paths],
    related_paths: [...task.related_paths],
    depends_on: [...task.depends_on],
    persona_policy: task.persona_policy === null
      ? null
      : structuredClone(task.persona_policy),
  }));
  if (includeDesignTarget) {
    return cloned;
  }

  const designPath = `openspec/changes/${changeId}/design.md`;
  const removedTaskIds = new Set<string>();
  const withoutDesignPaths = cloned.map((task) => ({
    ...task,
    target_paths: task.target_paths.filter((item) => item !== designPath),
    related_paths: task.related_paths.filter((item) => item !== designPath),
  }));
  const keptTasks = withoutDesignPaths.filter((task) => {
    if (task.target_paths.length > 0) {
      return true;
    }
    removedTaskIds.add(task.id);
    return false;
  });
  if (removedTaskIds.size === 0) {
    return keptTasks;
  }
  return keptTasks.map((task) => ({
    ...task,
    depends_on: task.depends_on.filter((dep) => !removedTaskIds.has(dep)),
  }));
}

function buildSpecContextPromptSection(specContext: SpecContext): string {
  const activePersonas = specContext.persona_policy.active_personas.length > 0
    ? specContext.persona_policy.active_personas.join(", ")
    : "(none)";
  const requirementsLines = toPromptMultilineBlock(specContext.requirements_text);

  return [
    "spec_context:",
    "- requirements_text: |",
    ...requirementsLines.map((line) => `  ${line}`),
    `- language: ${specContext.language}`,
    `- runtime_stack: ${specContext.runtime_stack} (TypeScript-only runtime, use src/**/*.ts)`,
    `- active_personas: ${activePersonas}`,
  ].join("\n");
}

function toPromptMultilineBlock(raw: string): string[] {
  const normalized = raw.replaceAll(/\r\n?/gu, "\n");
  const lines = normalized.split("\n");
  while (lines.length > 1 && lines[lines.length - 1].trim().length === 0) {
    lines.pop();
  }
  return lines.length > 0 ? lines : [""];
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

function resolveChangeIdInteractive(
  io: SpecCreatorPromptIO,
  rawChangeId: string | null | undefined,
  requirementsText: string,
  proposeChangeIdFn: (requirementsText: string) => string,
): string {
  const seeded = typeof rawChangeId === "string" ? rawChangeId.trim() : "";
  if (seeded.length > 0) {
    return normalizeChangeId(seeded);
  }

  const proposal = proposeChangeIdWithFallback(
    requirementsText,
    proposeChangeIdFn,
  );
  const entered = promptOptional(
    io,
    `change_id 第1案: ${proposal}\nchange_id (Enterで採用)`,
  );
  const selected = entered.trim().length > 0 ? entered.trim() : proposal;
  return normalizeChangeId(selected);
}

function proposeChangeIdWithFallback(
  requirementsText: string,
  proposeChangeIdFn: (requirementsText: string) => string,
): string {
  try {
    return normalizeChangeId(proposeChangeIdFn(requirementsText));
  } catch {
    return normalizeChangeId(proposeChangeIdLocal(requirementsText));
  }
}

function proposeChangeIdFromCodex(requirementsText: string): string {
  const prompt = [
    "Return only one change_id.",
    "Constraints:",
    "- one line only",
    "- kebab-case only",
    "- max 64 chars",
    "",
    `requirements_text: ${requirementsText}`,
  ].join("\n");

  const outputPath = Deno.makeTempFileSync({
    prefix: "spec_creator_change_id_",
    suffix: ".txt",
  });
  try {
    const { code, stderr } = new Deno.Command("codex", {
      args: [
        "exec",
        "--skip-git-repo-check",
        "--output-last-message",
        outputPath,
        prompt,
      ],
      stdout: "null",
      stderr: "piped",
    }).outputSync();
    if (code !== 0) {
      const message = new TextDecoder().decode(stderr).trim();
      throw new Error(message || "codex exec failed");
    }
    const raw = Deno.readTextFileSync(outputPath).trim();
    if (!raw) {
      throw new Error("codex returned empty change_id");
    }
    const line = raw.split(/\r?\n/u).map((item) => item.trim()).find((item) =>
      item.length > 0
    );
    if (!line) {
      throw new Error("codex returned no usable change_id line");
    }
    return line.replace(/^['"`]+|['"`]+$/gu, "");
  } finally {
    try {
      Deno.removeSync(outputPath);
    } catch {
      // noop
    }
  }
}

function proposeChangeIdLocal(requirementsText: string): string {
  const stopWords = new Set([
    "a",
    "an",
    "and",
    "the",
    "to",
    "for",
    "with",
    "of",
    "on",
    "in",
    "add",
    "change",
    "changes",
    "change_id",
    "id",
    "openspec",
    "markdown",
    "md",
    "yaml",
    "json",
    "agent",
    "dock",
  ]);
  const uniqueTokens: string[] = [];
  const tokens = requirementsText
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, " ")
    .trim()
    .split(/\s+/u)
    .filter((token) =>
      token.length > 1 &&
      !stopWords.has(token)
    );
  for (const token of tokens) {
    if (!uniqueTokens.includes(token)) {
      uniqueTokens.push(token);
    }
  }
  const body = uniqueTokens.slice(0, 4).join("-");
  if (!body) {
    return "change";
  }
  const candidate = body.slice(0, 64).replace(/-+$/u, "");
  return candidate || "change";
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

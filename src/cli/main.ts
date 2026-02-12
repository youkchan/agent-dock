import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  AgentTeamsLikeOrchestrator,
  OrchestratorConfig,
  type TeammateAdapter,
} from "../application/orchestrator/orchestrator.ts";
import { collectSpecContextInteractive } from "../application/spec_creator/preprocess.ts";
import { createApplicationModule } from "../application/mod.ts";
import type { PersonaDefinition } from "../domain/persona.ts";
import {
  normalizePersonaDefaults,
  normalizeTaskPersonaPolicy,
  type PersonaDefaults,
  type TaskPersonaPolicy,
} from "../domain/persona_policy.ts";
import {
  createTask,
  type Task,
  type TaskPlanStatus,
  type TaskStatus,
} from "../domain/task.ts";
import { createDomainModule } from "../domain/mod.ts";
import {
  parseCommand,
  SubprocessCodexAdapter,
  type SubprocessCodexAdapterOptions,
  TemplateTeammateAdapter,
} from "../infrastructure/adapter/mod.ts";
import {
  compileChangeToConfig,
  defaultCompiledOutputPath,
  OpenSpecCompileError,
  writeCompiledConfig,
} from "../infrastructure/openspec/compiler.ts";
import {
  writeCodeSummaryMarkdown,
  writeProposalMarkdown,
  writeTasksMarkdown,
} from "../infrastructure/openspec/spec_creator.ts";
import {
  DEFAULT_TEMPLATE_LANG,
  getOpenSpecTasksTemplate,
  SUPPORTED_TEMPLATE_LANGS,
} from "../infrastructure/openspec/template.ts";
import { loadPersonasFromPayload } from "../infrastructure/persona/catalog.ts";
import { buildProviderFromEnv } from "../infrastructure/provider/mod.ts";
import { StateStore } from "../infrastructure/state/store.ts";
import { createInfrastructureModule } from "../infrastructure/mod.ts";

export interface CliIO {
  stdout(text: string): void;
  stderr(text: string): void;
}

const DEFAULT_IO: CliIO = {
  stdout(text: string): void {
    Deno.stdout.writeSync(new TextEncoder().encode(text));
  },
  stderr(text: string): void {
    Deno.stderr.writeSync(new TextEncoder().encode(text));
  },
};

interface CompileOpenSpecArgs {
  changeId: string;
  openspecRoot: string;
  overridesRoot: string;
  taskConfigRoot: string;
  output: string | null;
  teammates: string;
}

interface PrintTemplateArgs {
  lang: string;
}

interface SpecCreatorPreprocessArgs {
  changeId: string;
}

interface SpecCreatorArgs {
  changeId: string;
  output: string | null;
  noRun: boolean;
  stateDir: string | null;
}

interface RunArgs {
  config: string | null;
  openspecChange: string | null;
  openspecRoot: string;
  overridesRoot: string;
  taskConfigRoot: string;
  saveCompiled: boolean;
  teammates: string;
  stateDir: string;
  resume: boolean;
  leadId: string;
  maxRounds: number;
  maxIdleRounds: number;
  maxIdleSeconds: number;
  noProgressEventInterval: number;
  tickSeconds: number;
  provider: string | null;
  humanApproval: boolean;
  teammateAdapter: "subprocess" | "template";
  teammateCommand: string;
  planCommand: string;
  executeCommand: string;
  commandTimeout: number;
  resumeRequeueInProgress: boolean;
}

interface LoadedTasks {
  tasks: Task[];
  teammates: string[];
  personas: PersonaDefinition[] | null;
  personaDefaults: PersonaDefaults | null;
}

export interface TeammateAdapterArgs {
  teammateAdapter: "subprocess" | "template";
  teammateCommand: string;
  planCommand: string;
  executeCommand: string;
  commandTimeout: number;
}

const RUN_USAGE = [
  "usage: run [--config PATH] [--openspec-change CHANGE_ID] [--openspec-root DIR]",
  "           [--overrides-root DIR] [--task-config-root DIR] [--save-compiled]",
  "           [--teammates CSV] [--state-dir DIR] [--resume]",
  "           [--lead-id ID] [--max-rounds N] [--max-idle-rounds N]",
  "           [--max-idle-seconds N] [--no-progress-event-interval N]",
  "           [--tick-seconds N] [--provider mock|openai|claude|gemini]",
  "           [--human-approval]",
  "           [--teammate-adapter subprocess|template]",
  "           [--teammate-command CMD] [--plan-command CMD] [--execute-command CMD]",
  "           [--command-timeout N]",
  "           [--resume-requeue-in-progress|--no-resume-requeue-in-progress]",
].join("\n");

const COMPILE_USAGE = [
  "usage: compile-openspec --change-id CHANGE_ID [--openspec-root DIR] [--overrides-root DIR]",
  "                        [--task-config-root DIR] [--output PATH] [--teammates CSV]",
].join("\n");

const PRINT_TEMPLATE_USAGE = [
  "usage: print-openspec-template [--lang {ja,en}]",
].join("\n");

const SPEC_CREATOR_PREPROCESS_USAGE = [
  "usage: spec-creator-preprocess --change-id CHANGE_ID",
].join("\n");

const SPEC_CREATOR_USAGE = [
  "usage: spec-creator --change-id CHANGE_ID [--output PATH] [--state-dir DIR] [--no-run]",
].join("\n");

export function buildSkeletonSummary(): string {
  const domain = createDomainModule();
  const application = createApplicationModule(domain);
  const infrastructure = createInfrastructureModule(application);

  return [
    domain.name,
    application.name,
    infrastructure.name,
    "cli",
  ].join(" -> ");
}

export function parseTeammatesArg(raw: string): string[] | null {
  const value = (raw || "").trim();
  if (!value) {
    return null;
  }

  let parts: string[];
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim();
    parts = inner.split(",").map((part) =>
      part.trim().replace(/^['"]|['"]$/gu, "")
    );
  } else {
    parts = value.split(",").map((part) => part.trim());
  }

  const teammates = parts.filter((part) => part.length > 0);
  return teammates.length > 0 ? teammates : null;
}

export function buildTeammateAdapter(
  args: TeammateAdapterArgs,
  executablePath?: string,
): TeammateAdapter {
  if (args.teammateAdapter === "template") {
    return new TemplateTeammateAdapter();
  }

  let shared = args.teammateCommand.trim();
  let planRaw = args.planCommand.trim();
  let executeRaw = args.executeCommand.trim();

  if (!shared && (!planRaw || !executeRaw)) {
    shared = defaultTeammateCommand(executablePath);
  }
  if (!planRaw) {
    planRaw = shared;
  }
  if (!executeRaw) {
    executeRaw = shared;
  }

  if (!planRaw || !executeRaw) {
    throw new Error(
      "subprocess adapter requires command settings. " +
        "Set TEAMMATE_COMMAND or both TEAMMATE_PLAN_COMMAND and TEAMMATE_EXECUTE_COMMAND, " +
        "or pass --teammate-command / --plan-command / --execute-command.",
    );
  }

  const options: SubprocessCodexAdapterOptions = {
    planCommand: parseCommand(planRaw, "plan command"),
    executeCommand: parseCommand(executeRaw, "execute command"),
    timeoutSeconds: Math.max(1, Math.trunc(args.commandTimeout)),
  };
  return new SubprocessCodexAdapter(options);
}

export function defaultTeammateCommand(executablePath?: string): string {
  const wrapperPath = resolveDefaultWrapperPath(executablePath);
  return `bash ${shellQuote(wrapperPath)}`;
}

export function resolveDefaultWrapperPath(executablePath?: string): string {
  const resolvedEntry = resolveExecutablePath(executablePath);
  const wrapperPath = findWrapperFrom(path.dirname(resolvedEntry));
  if (wrapperPath === null) {
    throw new Error(
      "subprocess adapter requires command settings. " +
        "Set TEAMMATE_COMMAND or both TEAMMATE_PLAN_COMMAND and TEAMMATE_EXECUTE_COMMAND, " +
        "or pass --teammate-command / --plan-command / --execute-command. " +
        `Default wrapper was not found: ${
          path.resolve(path.dirname(resolvedEntry), "codex_wrapper.sh")
        }`,
    );
  }
  return wrapperPath;
}

export function shouldBootstrapRunState(
  options: {
    resume: boolean;
    hasExistingState: boolean;
    hasTasksInState: boolean;
  },
): boolean {
  if (!options.resume) {
    return true;
  }
  if (!options.hasExistingState) {
    return true;
  }
  return !options.hasTasksInState;
}

export function resolveRunMode(options: {
  resume: boolean;
  hasExistingState: boolean;
  hasTasksInState: boolean;
}): "new-run" | "resume-run" {
  return shouldBootstrapRunState(options) ? "new-run" : "resume-run";
}

export function bootstrapRunState(
  store: StateStore,
  tasks: Task[],
  options: {
    resume: boolean;
    hasExistingState: boolean;
    tasksInState?: Task[];
  },
): void {
  const tasksInState = options.tasksInState ?? store.listTasks();
  const shouldBootstrap = shouldBootstrapRunState({
    resume: options.resume,
    hasExistingState: options.hasExistingState,
    hasTasksInState: tasksInState.length > 0,
  });

  if (!shouldBootstrap) {
    validateResumeTaskConfigConsistency(tasks, tasksInState);
    return;
  }

  store.bootstrapTasks(tasks, true);
}

function parseCompileOpenSpecArgs(argv: string[]): CompileOpenSpecArgs {
  if (argv.includes("-h") || argv.includes("--help")) {
    throw new HelpRequestedError(COMPILE_USAGE);
  }

  const parsed: CompileOpenSpecArgs = {
    changeId: "",
    openspecRoot: "openspec",
    overridesRoot: "task_configs/overrides",
    taskConfigRoot: "task_configs",
    output: null,
    teammates: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--change-id") {
      parsed.changeId = requireOptionValue(arg, next);
      index += 1;
      continue;
    }
    if (arg === "--openspec-root") {
      parsed.openspecRoot = requireOptionValue(arg, next);
      index += 1;
      continue;
    }
    if (arg === "--overrides-root") {
      parsed.overridesRoot = requireOptionValue(arg, next);
      index += 1;
      continue;
    }
    if (arg === "--task-config-root") {
      parsed.taskConfigRoot = requireOptionValue(arg, next);
      index += 1;
      continue;
    }
    if (arg === "--output") {
      parsed.output = requireOptionValue(arg, next);
      index += 1;
      continue;
    }
    if (arg === "--teammates") {
      parsed.teammates = requireOptionValue(arg, next);
      index += 1;
      continue;
    }

    throw new Error(`unrecognized argument: ${arg}`);
  }

  if (!parsed.changeId) {
    throw new Error("argument --change-id is required");
  }

  return parsed;
}

function parsePrintTemplateArgs(argv: string[]): PrintTemplateArgs {
  if (argv.includes("-h") || argv.includes("--help")) {
    throw new HelpRequestedError(PRINT_TEMPLATE_USAGE);
  }

  const parsed: PrintTemplateArgs = {
    lang: DEFAULT_TEMPLATE_LANG,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--lang") {
      parsed.lang = requireOptionValue(arg, next);
      index += 1;
      continue;
    }

    throw new Error(`unrecognized argument: ${arg}`);
  }

  const normalizedLang = parsed.lang.trim().toLowerCase();
  if (!SUPPORTED_TEMPLATE_LANGS.includes(normalizedLang as "ja" | "en")) {
    throw new Error(
      `argument --lang: invalid choice: '${parsed.lang}' (choose from 'ja', 'en')`,
    );
  }
  parsed.lang = normalizedLang;
  return parsed;
}

function parseSpecCreatorPreprocessArgs(
  argv: string[],
): SpecCreatorPreprocessArgs {
  if (argv.includes("-h") || argv.includes("--help")) {
    throw new HelpRequestedError(SPEC_CREATOR_PREPROCESS_USAGE);
  }

  const parsed: SpecCreatorPreprocessArgs = {
    changeId: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--change-id") {
      parsed.changeId = requireOptionValue(arg, next);
      index += 1;
      continue;
    }

    throw new Error(`unrecognized argument: ${arg}`);
  }

  if (!parsed.changeId) {
    throw new Error("argument --change-id is required");
  }

  return parsed;
}

function parseSpecCreatorArgs(argv: string[]): SpecCreatorArgs {
  if (argv.includes("-h") || argv.includes("--help")) {
    throw new HelpRequestedError(SPEC_CREATOR_USAGE);
  }

  const parsed: SpecCreatorArgs = {
    changeId: "",
    output: null,
    noRun: false,
    stateDir: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--change-id") {
      parsed.changeId = requireOptionValue(arg, next);
      index += 1;
      continue;
    }
    if (arg === "--output") {
      parsed.output = requireOptionValue(arg, next);
      index += 1;
      continue;
    }
    if (arg === "--state-dir") {
      parsed.stateDir = requireOptionValue(arg, next);
      index += 1;
      continue;
    }
    if (arg === "--no-run") {
      parsed.noRun = true;
      continue;
    }

    throw new Error(`unrecognized argument: ${arg}`);
  }

  if (!parsed.changeId) {
    throw new Error("argument --change-id is required");
  }

  return parsed;
}

function parseRunArgs(argv: string[]): RunArgs {
  if (argv.includes("-h") || argv.includes("--help")) {
    throw new HelpRequestedError(RUN_USAGE);
  }

  const parsed: RunArgs = {
    config: null,
    openspecChange: null,
    openspecRoot: "openspec",
    overridesRoot: "task_configs/overrides",
    taskConfigRoot: "task_configs",
    saveCompiled: false,
    teammates: "",
    stateDir: ".team_state",
    resume: false,
    leadId: "lead",
    maxRounds: 200,
    maxIdleRounds: 20,
    maxIdleSeconds: 120,
    noProgressEventInterval: 3,
    tickSeconds: 0.0,
    provider: null,
    humanApproval: false,
    teammateAdapter: parseTeammateAdapter(
      getEnv("TEAMMATE_ADAPTER", "subprocess"),
    ),
    teammateCommand: getEnv("TEAMMATE_COMMAND", ""),
    planCommand: getEnv("TEAMMATE_PLAN_COMMAND", ""),
    executeCommand: getEnv("TEAMMATE_EXECUTE_COMMAND", ""),
    commandTimeout: safeIntEnv("TEAMMATE_COMMAND_TIMEOUT", 120),
    resumeRequeueInProgress: safeBoolEnv("RESUME_REQUEUE_IN_PROGRESS", true),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--config") {
      parsed.config = requireOptionValue(arg, next);
      index += 1;
      continue;
    }
    if (arg === "--openspec-change") {
      parsed.openspecChange = requireOptionValue(arg, next);
      index += 1;
      continue;
    }
    if (arg === "--openspec-root") {
      parsed.openspecRoot = requireOptionValue(arg, next);
      index += 1;
      continue;
    }
    if (arg === "--overrides-root") {
      parsed.overridesRoot = requireOptionValue(arg, next);
      index += 1;
      continue;
    }
    if (arg === "--task-config-root") {
      parsed.taskConfigRoot = requireOptionValue(arg, next);
      index += 1;
      continue;
    }
    if (arg === "--save-compiled") {
      parsed.saveCompiled = true;
      continue;
    }
    if (arg === "--teammates") {
      parsed.teammates = requireOptionValue(arg, next);
      index += 1;
      continue;
    }
    if (arg === "--state-dir") {
      parsed.stateDir = requireOptionValue(arg, next);
      index += 1;
      continue;
    }
    if (arg === "--resume") {
      parsed.resume = true;
      continue;
    }
    if (arg === "--lead-id") {
      parsed.leadId = requireOptionValue(arg, next);
      index += 1;
      continue;
    }
    if (arg === "--max-rounds") {
      parsed.maxRounds = parseIntOption(arg, next);
      index += 1;
      continue;
    }
    if (arg === "--max-idle-rounds") {
      parsed.maxIdleRounds = parseIntOption(arg, next);
      index += 1;
      continue;
    }
    if (arg === "--max-idle-seconds") {
      parsed.maxIdleSeconds = parseIntOption(arg, next);
      index += 1;
      continue;
    }
    if (arg === "--no-progress-event-interval") {
      parsed.noProgressEventInterval = parseIntOption(arg, next);
      index += 1;
      continue;
    }
    if (arg === "--tick-seconds") {
      parsed.tickSeconds = parseFloatOption(arg, next);
      index += 1;
      continue;
    }
    if (arg === "--provider") {
      parsed.provider = parseProviderOption(requireOptionValue(arg, next));
      index += 1;
      continue;
    }
    if (arg === "--human-approval") {
      parsed.humanApproval = true;
      continue;
    }
    if (arg === "--teammate-adapter") {
      parsed.teammateAdapter = parseTeammateAdapter(
        requireOptionValue(arg, next),
      );
      index += 1;
      continue;
    }
    if (arg === "--teammate-command") {
      parsed.teammateCommand = requireOptionValue(arg, next);
      index += 1;
      continue;
    }
    if (arg === "--plan-command") {
      parsed.planCommand = requireOptionValue(arg, next);
      index += 1;
      continue;
    }
    if (arg === "--execute-command") {
      parsed.executeCommand = requireOptionValue(arg, next);
      index += 1;
      continue;
    }
    if (arg === "--command-timeout") {
      parsed.commandTimeout = parseIntOption(arg, next);
      index += 1;
      continue;
    }
    if (arg === "--resume-requeue-in-progress") {
      parsed.resumeRequeueInProgress = true;
      continue;
    }
    if (arg === "--no-resume-requeue-in-progress") {
      parsed.resumeRequeueInProgress = false;
      continue;
    }

    throw new Error(`unrecognized argument: ${arg}`);
  }

  return parsed;
}

function requireOptionValue(option: string, value: string | undefined): string {
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`argument ${option}: expected one argument`);
  }
  return value;
}

function parseIntOption(option: string, rawValue: string | undefined): number {
  const value = requireOptionValue(option, rawValue);
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`argument ${option}: invalid int value: '${value}'`);
  }
  return parsed;
}

function parseFloatOption(
  option: string,
  rawValue: string | undefined,
): number {
  const value = requireOptionValue(option, rawValue);
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`argument ${option}: invalid float value: '${value}'`);
  }
  return parsed;
}

function parseProviderOption(raw: string): string {
  const normalized = raw.trim().toLowerCase();
  const allowed = ["openai", "claude", "gemini", "mock"];
  if (!allowed.includes(normalized)) {
    throw new Error(
      `argument --provider: invalid choice: '${raw}' (choose from 'openai', 'claude', 'gemini', 'mock')`,
    );
  }
  return normalized;
}

function parseTeammateAdapter(raw: string): "subprocess" | "template" {
  const normalized = raw.trim().toLowerCase();
  if (normalized === "subprocess" || normalized === "template") {
    return normalized;
  }
  throw new Error(
    `argument --teammate-adapter: invalid choice: '${raw}' (choose from 'subprocess', 'template')`,
  );
}

function compileOpenSpecCommand(argv: string[], io: CliIO): number {
  const args = parseCompileOpenSpecArgs(argv);
  const payload = compileChangeToConfig(args.changeId, {
    openspecRoot: args.openspecRoot,
    overridesRoot: args.overridesRoot,
    teammates: parseTeammatesArg(args.teammates),
  });
  const outputPath = args.output ?? defaultCompiledOutputPath(
    args.changeId,
    args.taskConfigRoot,
  );
  const writtenPath = writeCompiledConfig(payload, outputPath);
  io.stdout(`${writtenPath}\n`);
  return 0;
}

function printTemplateCommand(argv: string[], io: CliIO): number {
  const args = parsePrintTemplateArgs(argv);
  io.stdout(getOpenSpecTasksTemplate(args.lang));
  return 0;
}

function specCreatorPreprocessCommand(argv: string[], io: CliIO): number {
  const args = parseSpecCreatorPreprocessArgs(argv);
  const context = collectSpecContextInteractive({
    changeId: args.changeId,
  });
  io.stdout(`${JSON.stringify(context, null, 2)}\n`);
  return 0;
}

function defaultSpecCreatorOutputPath(changeId: string): string {
  return path.join("task_configs", "spec_creator", `${changeId}.json`);
}

function defaultSpecCreatorStateDir(changeId: string): string {
  return path.join(".team_state", "spec_creator", changeId);
}

function specCreatorCommand(argv: string[], io: CliIO): number {
  const args = parseSpecCreatorArgs(argv);
  const context = collectSpecContextInteractive({
    changeId: args.changeId,
  });
  const changeDir = path.resolve("openspec", "changes", context.change_id);
  const proposalPath = path.join(changeDir, "proposal.md");
  const tasksPath = path.join(changeDir, "tasks.md");
  const designPath = path.join(changeDir, "design.md");
  const codeSummaryPath = path.join(changeDir, "code_summary.md");
  const lang = context.spec_context.language;

  writeProposalMarkdown({
    proposalPath,
    lang,
    whyMarkdown: asBulletLines([
      context.spec_context.requirements_text,
      context.spec_context.acceptance_criteria,
    ]),
    whatChangesMarkdown: asBulletLines([
      lang === "ja"
        ? "spec creator の固定 task_config テンプレートを使う"
        : "Use fixed task_config template for spec creator",
      lang === "ja"
        ? "tasks.md と code_summary.md を整合生成する"
        : "Generate aligned tasks.md and code_summary.md",
    ]),
    impactMarkdown: asBulletLines([
      `${lang === "ja" ? "non_goals" : "non_goals"}: ${
        context.spec_context.non_goals
      }`,
      `${lang === "ja" ? "scope_paths" : "scope_paths"}: ${
        context.spec_context.scope_paths.length > 0
          ? context.spec_context.scope_paths.join(", ")
          : "(none)"
      }`,
    ]),
  });

  writeTasksMarkdown({
    tasksPath,
    lang,
    implementationMarkdown: buildImplementationMarkdownForSpecCreator(
      context.task_config.tasks,
      lang,
    ),
    humanNotesMarkdown: buildHumanNotesMarkdownForSpecCreator(
      context.spec_context,
      lang,
    ),
  });

  writeCodeSummaryMarkdown({
    tasksPath,
    outputPath: codeSummaryPath,
  });
  writeDesignMarkdownStub({
    designPath,
    lang,
    acceptanceCriteria: context.spec_context.acceptance_criteria,
  });

  const outputPath = path.resolve(
    args.output ?? defaultSpecCreatorOutputPath(context.change_id),
  );
  Deno.mkdirSync(path.dirname(outputPath), { recursive: true });
  Deno.writeTextFileSync(
    outputPath,
    `${JSON.stringify(context.task_config, null, 2)}\n`,
  );
  io.stdout(`[spec-creator] wrote ${proposalPath}\n`);
  io.stdout(`[spec-creator] wrote ${tasksPath}\n`);
  io.stdout(`[spec-creator] wrote ${designPath}\n`);
  io.stdout(`[spec-creator] wrote ${codeSummaryPath}\n`);
  io.stdout(`[spec-creator] wrote ${outputPath}\n`);

  if (args.noRun) {
    return 0;
  }

  const stateDir = args.stateDir
    ? path.resolve(args.stateDir)
    : path.resolve(defaultSpecCreatorStateDir(context.change_id));
  io.stdout(`[spec-creator] run --config ${outputPath}\n`);
  return runCommand([
    "--config",
    outputPath,
    "--state-dir",
    stateDir,
  ], io);
}

function asBulletLines(items: string[]): string {
  const normalized = items
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (normalized.length === 0) {
    return "- (none)";
  }
  return normalized.map((item) => `- ${item}`).join("\n");
}

function buildImplementationMarkdownForSpecCreator(
  tasks: Array<{
    id: string;
    title: string;
    description: string;
    depends_on: string[];
    target_paths: string[];
    persona_policy: TaskPersonaPolicy | null;
  }>,
  lang: "ja" | "en",
): string {
  const lines: string[] = [];
  for (const task of tasks) {
    const dependsOn = task.depends_on.length > 0
      ? task.depends_on.join(", ")
      : (lang === "ja" ? "なし" : "none");
    const targetPaths = task.target_paths.length > 0
      ? task.target_paths.join(", ")
      : "*";
    const description = compactTaskDescription(task.description);
    const phaseAssignments = formatPhaseAssignments(task.persona_policy, lang);

    lines.push(`- [ ] ${task.id} ${task.title}`);
    if (lang === "ja") {
      lines.push(`  - 依存: ${dependsOn}`);
      lines.push(`  - 対象: ${targetPaths}`);
      lines.push(`  - フェーズ担当: ${phaseAssignments}`);
      lines.push(`  - 成果物: ${description}`);
    } else {
      lines.push(`  - Depends on: ${dependsOn}`);
      lines.push(`  - Target paths: ${targetPaths}`);
      lines.push(`  - phase assignments: ${phaseAssignments}`);
      lines.push(`  - Description: ${description}`);
    }
  }
  return lines.join("\n");
}

function compactTaskDescription(raw: string): string {
  const normalized = raw.trim();
  if (!normalized) {
    return "(none)";
  }
  const marker = "\nspec_context:";
  const markerIndex = normalized.indexOf(marker);
  const base = markerIndex >= 0 ? normalized.slice(0, markerIndex) : normalized;
  const oneLine = base.replaceAll(/\s+/gu, " ").trim();
  return oneLine || "(none)";
}

function formatPhaseAssignments(
  policyRaw: TaskPersonaPolicy | null,
  lang: "ja" | "en",
): string {
  if (!policyRaw) {
    return lang === "ja"
      ? "implement=implementer; review=code-reviewer"
      : "implement=implementer; review=code-reviewer";
  }

  const phaseOverridesRaw = policyRaw.phase_overrides;
  if (phaseOverridesRaw === undefined) {
    return lang === "ja"
      ? "implement=implementer; review=code-reviewer"
      : "implement=implementer; review=code-reviewer";
  }

  const assignments: string[] = [];
  for (const [phase, phasePolicyRaw] of Object.entries(phaseOverridesRaw)) {
    if (phasePolicyRaw === undefined || phasePolicyRaw === null) {
      continue;
    }
    const executor = firstPersonaIdFromPhasePolicy(phasePolicyRaw);
    if (!executor) {
      continue;
    }
    assignments.push(`${phase}=${executor}`);
  }

  if (assignments.length === 0) {
    return lang === "ja"
      ? "implement=implementer; review=code-reviewer"
      : "implement=implementer; review=code-reviewer";
  }
  return assignments.join("; ");
}

function firstPersonaIdFromPhasePolicy(
  phasePolicy: {
    active_personas?: string[];
    executor_personas?: string[];
    state_transition_personas?: string[];
  },
): string | null {
  for (
    const key of ["executor_personas", "active_personas", "state_transition_personas"] as const
  ) {
    const value = phasePolicy[key];
    if (!Array.isArray(value) || value.length === 0) {
      continue;
    }
    const first = String(value[0] ?? "").trim();
    if (first) {
      return first;
    }
  }
  return null;
}

function buildHumanNotesMarkdownForSpecCreator(
  specContext: {
    requirements_text: string;
    non_goals: string;
    acceptance_criteria: string;
    scope_paths: string[];
  },
  lang: "ja" | "en",
): string {
  if (lang === "ja") {
    return [
      `- 要件メモ: ${specContext.requirements_text}`,
      `- 非目標: ${specContext.non_goals}`,
      `- 受け入れ条件: ${specContext.acceptance_criteria}`,
      `- 対象パス: ${
        specContext.scope_paths.length > 0
          ? specContext.scope_paths.join(", ")
          : "(none)"
      }`,
    ].join("\n");
  }
  return [
    `- Requirement memo: ${specContext.requirements_text}`,
    `- Non-goals: ${specContext.non_goals}`,
    `- Acceptance criteria: ${specContext.acceptance_criteria}`,
    `- Scope paths: ${
      specContext.scope_paths.length > 0
        ? specContext.scope_paths.join(", ")
        : "(none)"
    }`,
  ].join("\n");
}

function writeDesignMarkdownStub(options: {
  designPath: string;
  lang: "ja" | "en";
  acceptanceCriteria: string;
}): void {
  const body = options.lang === "ja"
    ? [
      "# Design",
      "",
      "## 目的",
      "- 必要時のみ設計判断を追記する。",
      "",
      "## 受け入れ条件メモ",
      `- ${options.acceptanceCriteria}`,
      "",
    ].join("\n")
    : [
      "# Design",
      "",
      "## Purpose",
      "- Add design decisions only when needed.",
      "",
      "## Acceptance Criteria Memo",
      `- ${options.acceptanceCriteria}`,
      "",
    ].join("\n");
  Deno.mkdirSync(path.dirname(options.designPath), { recursive: true });
  Deno.writeTextFileSync(options.designPath, body);
}

function runCommand(argv: string[], io: CliIO): number {
  const args = parseRunArgs(argv);

  if (args.provider) {
    Deno.env.set("ORCHESTRATOR_PROVIDER", args.provider);
  }
  if (args.humanApproval) {
    Deno.env.set("HUMAN_APPROVAL", "1");
  }

  const loaded = resolveTasksForRun(args, io);
  if (loaded.tasks.length === 0) {
    throw new Error("No tasks found in config");
  }

  const stateFilePath = path.join(path.resolve(args.stateDir), "state.json");
  const hasExistingState = isFile(stateFilePath);
  const store = new StateStore(args.stateDir);
  const tasksInState = store.listTasks();

  const runMode = resolveRunMode({
    resume: args.resume,
    hasExistingState,
    hasTasksInState: tasksInState.length > 0,
  });
  io.stdout(`[run] run_mode=${runMode}\n`);
  io.stdout(
    `[run] progress_log_ref=${stateFilePath}::tasks.<task_id>.progress_log\n`,
  );

  bootstrapRunState(store, loaded.tasks, {
    resume: args.resume,
    hasExistingState,
    tasksInState,
  });

  if (runMode === "resume-run" && args.resumeRequeueInProgress) {
    const recovered = store.requeueInProgressTasks();
    if (recovered.length > 0) {
      io.stdout(
        `[run] resume_requeued_in_progress=${
          recovered.map((task) => task.id).join(",")
        }\n`,
      );
    }
  }

  const adapter = buildTeammateAdapter({
    teammateAdapter: args.teammateAdapter,
    teammateCommand: args.teammateCommand,
    planCommand: args.planCommand,
    executeCommand: args.executeCommand,
    commandTimeout: args.commandTimeout,
  });

  const orchestrator = new AgentTeamsLikeOrchestrator({
    store,
    adapter,
    provider: buildProviderFromEnv(),
    config: new OrchestratorConfig({
      leadId: args.leadId,
      teammateIds: loaded.teammates.length > 0 ? loaded.teammates : null,
      personas: loaded.personas,
      maxRounds: args.maxRounds,
      maxIdleRounds: args.maxIdleRounds,
      maxIdleSeconds: args.maxIdleSeconds,
      noProgressEventInterval: args.noProgressEventInterval,
      tickSeconds: args.tickSeconds,
      humanApproval: args.humanApproval,
      personaDefaults: loaded.personaDefaults === null
        ? null
        : (structuredClone(loaded.personaDefaults) as Record<string, unknown>),
    }),
    eventLogger: (message: string): void => {
      io.stdout(`${message}\n`);
    },
  });

  const result = orchestrator.run();
  io.stdout(`${JSON.stringify(result, null, 2)}\n`);
  return 0;
}

function resolveTasksForRun(args: RunArgs, io: CliIO): LoadedTasks {
  if (args.config !== null && args.openspecChange !== null) {
    throw new Error("--config and --openspec-change cannot be used together");
  }

  if (args.openspecChange !== null) {
    const compiled = compileChangeToConfig(args.openspecChange, {
      openspecRoot: args.openspecRoot,
      overridesRoot: args.overridesRoot,
      teammates: parseTeammatesArg(args.teammates),
    });
    const outputPath = args.saveCompiled
      ? defaultCompiledOutputPath(args.openspecChange, args.taskConfigRoot)
      : Deno.makeTempFileSync({ suffix: ".json" });
    const writtenPath = writeCompiledConfig(compiled, outputPath);
    if (args.saveCompiled) {
      io.stdout(`[compile] wrote ${writtenPath}\n`);
    }
    try {
      return loadTasksFromConfigPath(writtenPath);
    } finally {
      if (!args.saveCompiled) {
        Deno.removeSync(writtenPath);
      }
    }
  }

  return loadTasksFromConfigPath(args.config ?? "examples/sample_tasks.json");
}

function loadTasksFromConfigPath(configPath: string): LoadedTasks {
  const loaded = JSON.parse(Deno.readTextFileSync(configPath)) as unknown;
  if (!isRecord(loaded)) {
    throw new Error(`task config must be an object (${configPath})`);
  }
  return loadTasksPayload(loaded, configPath);
}

function loadTasksPayload(
  raw: Record<string, unknown>,
  sourceLabel: string,
): LoadedTasks {
  const personas = loadPersonasFromPayload(raw, sourceLabel);
  const knownPersonaIds = new Set(personas.map((persona) => persona.id));
  const personaDefaults = normalizePersonaDefaults(raw.persona_defaults, {
    sourceLabel,
    knownPersonaIds,
  });

  const rawTasks = raw.tasks ?? [];
  if (!Array.isArray(rawTasks)) {
    throw new Error(`tasks must be a list (${sourceLabel})`);
  }

  const tasks: Task[] = [];
  for (const [index, taskRaw] of rawTasks.entries()) {
    if (!isRecord(taskRaw)) {
      throw new Error(`tasks[${index}] must be an object (${sourceLabel})`);
    }

    const id = parseRequiredString(
      taskRaw.id,
      `tasks[${index}].id`,
      sourceLabel,
    );
    const title = parseRequiredString(
      taskRaw.title,
      `tasks[${index}].title`,
      sourceLabel,
    );

    const task = createTask({
      id,
      title,
      description: asOptionalString(taskRaw.description) ?? "",
      target_paths: asStringArray(taskRaw.target_paths),
      depends_on: asStringArray(taskRaw.depends_on),
      owner: asOptionalString(taskRaw.owner),
      planner: asOptionalString(taskRaw.planner),
      status: asTaskStatus(taskRaw.status),
      requires_plan: typeof taskRaw.requires_plan === "boolean"
        ? taskRaw.requires_plan
        : false,
      plan_status: asTaskPlanStatus(taskRaw.plan_status),
      plan_text: asOptionalString(taskRaw.plan_text),
      plan_feedback: asOptionalString(taskRaw.plan_feedback),
      result_summary: asOptionalString(taskRaw.result_summary),
      block_reason: asOptionalString(taskRaw.block_reason),
      progress_log: asRecordArray(taskRaw.progress_log),
      created_at: asOptionalNumber(taskRaw.created_at),
      updated_at: asOptionalNumber(taskRaw.updated_at),
      completed_at: asOptionalNumber(taskRaw.completed_at),
      persona_policy: normalizeTaskPersonaPolicy(taskRaw.persona_policy, {
        sourceLabel,
        taskId: id,
        knownPersonaIds,
      }),
      current_phase_index: asOptionalNumber(taskRaw.current_phase_index),
    });

    tasks.push(task);
  }

  for (const task of tasks) {
    if (task.target_paths.length === 0) {
      throw new Error(
        `task ${task.id} must define target_paths (${sourceLabel})`,
      );
    }
  }

  const teammatesRaw = raw.teammates ?? [];
  const teammates = Array.isArray(teammatesRaw)
    ? teammatesRaw.map((teammate) => String(teammate))
    : [];
  const personasForRuntime =
    Object.prototype.hasOwnProperty.call(raw, "personas") ? personas : null;

  return {
    tasks,
    teammates,
    personas: personasForRuntime,
    personaDefaults,
  };
}

function validateResumeTaskConfigConsistency(
  configTasks: Task[],
  stateTasks: Task[],
): void {
  const configById = new Map(configTasks.map((task) => [task.id, task]));
  const stateById = new Map(stateTasks.map((task) => [task.id, task]));

  const configIds = new Set(configById.keys());
  const stateIds = new Set(stateById.keys());

  const mismatches: string[] = [];
  const missingInState = [...configIds].filter((id) => !stateIds.has(id))
    .sort();
  const extraInState = [...stateIds].filter((id) => !configIds.has(id)).sort();
  if (missingInState.length > 0 || extraInState.length > 0) {
    mismatches.push(
      `task_ids(missing_in_state=${
        JSON.stringify(missingInState)
      }, extra_in_state=${JSON.stringify(extraInState)})`,
    );
  }

  for (const taskId of [...configIds].filter((id) => stateIds.has(id)).sort()) {
    const configTask = configById.get(taskId);
    const stateTask = stateById.get(taskId);
    if (!configTask || !stateTask) {
      continue;
    }

    if (configTask.requires_plan !== stateTask.requires_plan) {
      mismatches.push(
        `${taskId}:requires_plan(config=${configTask.requires_plan}, state=${stateTask.requires_plan})`,
      );
    }

    const configDependsOn = normalizeStringList(configTask.depends_on);
    const stateDependsOn = normalizeStringList(stateTask.depends_on);
    if (JSON.stringify(configDependsOn) !== JSON.stringify(stateDependsOn)) {
      mismatches.push(
        `${taskId}:depends_on(config=${
          JSON.stringify(configDependsOn)
        }, state=${JSON.stringify(stateDependsOn)})`,
      );
    }

    const configTargetPaths = normalizeStringList(configTask.target_paths);
    const stateTargetPaths = normalizeStringList(stateTask.target_paths);
    if (
      JSON.stringify(configTargetPaths) !== JSON.stringify(stateTargetPaths)
    ) {
      mismatches.push(
        `${taskId}:target_paths(config=${
          JSON.stringify(configTargetPaths)
        }, state=${JSON.stringify(stateTargetPaths)})`,
      );
    }
  }

  if (mismatches.length > 0) {
    throw new Error(`resume task_config mismatch: ${mismatches.join("; ")}`);
  }
}

function normalizeStringList(values: string[]): string[] {
  return values
    .map((value) => String(value).trim())
    .filter((value) => value.length > 0)
    .sort();
}

function resolveExecutablePath(explicitPath?: string): string {
  if (explicitPath && explicitPath.trim().length > 0) {
    return path.resolve(explicitPath);
  }

  const argvPath = process.argv.length > 1 ? process.argv[1] : "";
  if (argvPath.trim().length > 0) {
    return path.resolve(argvPath);
  }

  return path.resolve(fileURLToPath(Deno.mainModule));
}

function shellQuote(raw: string): string {
  if (/^[A-Za-z0-9_\-./]+$/u.test(raw)) {
    return raw;
  }
  return `'${raw.replace(/'/gu, `'"'"'`)}'`;
}

function findWrapperFrom(startDir: string): string | null {
  let current = path.resolve(startDir);
  while (true) {
    const candidate = path.join(current, "codex_wrapper.sh");
    if (isFile(candidate)) {
      return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function isFile(filePath: string): boolean {
  try {
    return Deno.statSync(filePath).isFile;
  } catch (_error) {
    return false;
  }
}

function parseRequiredString(
  raw: unknown,
  fieldName: string,
  sourceLabel: string,
): string {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string (${sourceLabel})`);
  }
  return raw.trim();
}

function asOptionalString(raw: unknown): string | null {
  return typeof raw === "string" ? raw : null;
}

function asOptionalNumber(raw: unknown): number | undefined {
  if (typeof raw !== "number") {
    return undefined;
  }
  if (!Number.isFinite(raw)) {
    return undefined;
  }
  return raw;
}

function asStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.map((item) => String(item));
}

function asRecordArray(raw: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter(isRecord).map((item) => ({ ...item }));
}

function asTaskStatus(raw: unknown): TaskStatus | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const normalized = raw.trim();
  if (
    normalized === "pending" || normalized === "in_progress" ||
    normalized === "blocked" || normalized === "needs_approval" ||
    normalized === "completed"
  ) {
    return normalized;
  }
  return undefined;
}

function asTaskPlanStatus(raw: unknown): TaskPlanStatus | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const normalized = raw.trim();
  if (
    normalized === "not_required" || normalized === "pending" ||
    normalized === "drafting" || normalized === "submitted" ||
    normalized === "approved" || normalized === "rejected" ||
    normalized === "revision_requested"
  ) {
    return normalized;
  }
  return undefined;
}

function safeIntEnv(name: string, fallback: number): number {
  const raw = getEnv(name, "");
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return parsed;
}

function safeBoolEnv(name: string, fallback: boolean): boolean {
  const raw = getEnv(name, "").toLowerCase();
  if (!raw) {
    return fallback;
  }
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") {
    return true;
  }
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") {
    return false;
  }
  return fallback;
}

function getEnv(name: string, fallback: string): string {
  try {
    return (Deno.env.get(name) ?? fallback).trim();
  } catch (_error) {
    return fallback;
  }
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw);
}

export function main(
  argv: string[] = Deno.args,
  io: CliIO = DEFAULT_IO,
): number {
  try {
    const args = [...argv];
    if (args.length === 0) {
      io.stdout(`${buildSkeletonSummary()}\n`);
      return 0;
    }

    const command = args[0];
    const commandArgs = args.slice(1);

    if (command === "print-openspec-template") {
      return printTemplateCommand(commandArgs, io);
    }
    if (command === "compile-openspec") {
      return compileOpenSpecCommand(commandArgs, io);
    }
    if (command === "spec-creator-preprocess") {
      return specCreatorPreprocessCommand(commandArgs, io);
    }
    if (command === "spec-creator") {
      return specCreatorCommand(commandArgs, io);
    }
    if (command === "run") {
      return runCommand(commandArgs, io);
    }

    throw new Error(`unknown command: ${command}`);
  } catch (error) {
    if (error instanceof HelpRequestedError) {
      io.stdout(`${error.message}\n`);
      return 0;
    }
    if (error instanceof OpenSpecCompileError) {
      io.stderr(`openspec compile error: ${error.message}\n`);
      return 1;
    }
    if (error instanceof Error) {
      io.stderr(`${error.message}\n`);
      return 1;
    }
    io.stderr(`${String(error)}\n`);
    return 1;
  }
}

class HelpRequestedError extends Error {}

if (import.meta.main) {
  Deno.exit(main(Deno.args));
}

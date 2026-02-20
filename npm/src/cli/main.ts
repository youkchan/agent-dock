import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  AgentTeamsLikeOrchestrator,
  OrchestratorConfig,
  type TeammateAdapter,
} from "../application/orchestrator/orchestrator.ts";
import {
  buildSpecCreatorTaskConfig,
  collectSpecContextInteractive,
  normalizeChangeId,
  normalizeSpecContextForReviewContract,
  type SpecContext,
  type SpecCreatorTaskConfig,
} from "../application/spec_creator/preprocess.ts";
import { createApplicationModule } from "../application/mod.ts";
import type { PersonaDefinition } from "../domain/persona.ts";
import {
  normalizePersonaDefaults,
  normalizeTaskPersonaPolicy,
  type PersonaDefaults,
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
  updateTasksMarkdownCheckboxes,
  writeCompiledConfig,
} from "../infrastructure/openspec/compiler.ts";
import {
  buildSpecCreatorPolishPrompt,
  collectSpecCreatorPolishMarkdownContexts,
  writeCodeSummaryMarkdown,
  writeDeltaSpecMarkdown,
  writeProposalMarkdown,
  writeTasksMarkdown,
} from "../infrastructure/openspec/spec_creator.ts";
import {
  assertSpecCreatorSemanticContracts,
  collectSpecCreatorQualityViolations,
  REQUIRED_REVIEW_CONTRACT_IDS,
  type SpecCreatorQualityOptions,
  type SpecCreatorQualityViolation,
} from "../infrastructure/openspec/spec_creator_quality.ts";
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
  changeId: string | null;
}

type SpecCreatorPolishMode = "preserve-supplement" | "regenerate";

interface SpecCreatorArgs {
  changeId: string | null;
  output: string | null;
  noRun: boolean;
  applyOnPostRunFail: boolean;
  stateDir: string | null;
  resume: boolean;
  personaDir: string | null;
  mode: SpecCreatorPolishMode;
  emitReviewContractToArtifacts: boolean;
}

interface SpecCreatorPolishArgs {
  changeId: string;
  feedback: string | null;
  output: string | null;
  noRun: boolean;
  applyOnPostRunFail: boolean;
  stateDir: string | null;
  resume: boolean;
  personaDir: string | null;
  mode: SpecCreatorPolishMode;
  emitReviewContractToArtifacts: boolean;
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
  personaDir: string | null;
}

interface LoadedTasks {
  tasks: Task[];
  teammates: string[];
  personas: PersonaDefinition[] | null;
  personaDefaults: PersonaDefaults | null;
  sourceChangeId: string | null;
}

export interface TeammateAdapterArgs {
  teammateAdapter: "subprocess" | "template";
  teammateCommand: string;
  planCommand: string;
  executeCommand: string;
  commandTimeout: number;
  personaExecutionSandboxes?: Record<string, string> | null;
  openspecChangeId?: string | null;
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
  "           [--persona-dir DIR]",
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
  "usage: spec-creator-preprocess [--change-id CHANGE_ID]",
].join("\n");

const SPEC_CREATOR_USAGE = [
  "usage: spec-creator polish <change_id> [--feedback TEXT] [--output PATH] [--state-dir DIR] [--resume] [--no-run] [--apply-on-post-run-fail] [--persona-dir DIR]",
  "                                 [--mode preserve-supplement|regenerate] [--emit-review-contract-to-artifacts]",
  "       spec-creator [--change-id CHANGE_ID] [--output PATH] [--state-dir DIR] [--resume] [--no-run] [--apply-on-post-run-fail] [--persona-dir DIR]  (deprecated)",
].join("\n");

const SPEC_CREATOR_POLISH_USAGE = [
  "usage: spec-creator polish <change_id> [--feedback TEXT] [--output PATH] [--state-dir DIR] [--resume] [--no-run] [--apply-on-post-run-fail] [--persona-dir DIR]",
  "                                 [--mode preserve-supplement|regenerate] [--emit-review-contract-to-artifacts]",
].join("\n");

const DEFAULT_WRAPPER_RUNTIME = "ts";

const GLOBAL_USAGE = [
  "usage: agent-dock <command> [options]",
  "",
  "commands:",
  "  run                      execute orchestrator runtime",
  "  compile-openspec         compile openspec/tasks.md to task_config",
  "  print-openspec-template  print tasks.md template (ja|en)",
  "  spec-creator-preprocess  collect spec context interactively and output JSON",
  "  spec-creator             generate OpenSpec artifacts and run with generated task_config",
  "",
  "use '<command> --help' for command details",
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
    executionSandboxByTeammateId: normalizeExecutionSandboxMap(
      args.personaExecutionSandboxes,
    ),
    extraEnv: resolveOpenSpecChangeEnv(args.openspecChangeId),
  };
  return new SubprocessCodexAdapter(options);
}

function resolveOpenSpecChangeEnv(
  openspecChangeIdRaw: string | null | undefined,
): Record<string, string> | undefined {
  const openspecChangeId = String(openspecChangeIdRaw ?? "").trim();
  if (!openspecChangeId) {
    return undefined;
  }
  return { OPENSPEC_CHANGE_ID: openspecChangeId };
}

function normalizeExecutionSandboxMap(
  rawMap: Record<string, string> | null | undefined,
): Record<string, string> | undefined {
  if (rawMap === null || rawMap === undefined) {
    return undefined;
  }
  const normalized: Record<string, string> = {};
  for (const [teammateId, sandboxRaw] of Object.entries(rawMap)) {
    const id = teammateId.trim();
    const sandbox = String(sandboxRaw).trim();
    if (!id || !sandbox) {
      continue;
    }
    normalized[id] = sandbox;
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function collectPersonaExecutionSandboxes(
  personas: PersonaDefinition[] | null,
): Record<string, string> {
  if (!personas) {
    return {};
  }
  const sandboxes: Record<string, string> = {};
  for (const persona of personas) {
    if (!persona.enabled || persona.execution === null) {
      continue;
    }
    if (!persona.execution.enabled) {
      continue;
    }
    const sandbox = persona.execution.sandbox.trim();
    if (!sandbox) {
      continue;
    }
    sandboxes[persona.id] = sandbox;
  }
  return sandboxes;
}

export function defaultTeammateCommand(executablePath?: string): string {
  resolveWrapperRuntime();
  const runtimePath = resolveDefaultRuntimePath(executablePath);
  return `deno run --no-prompt --allow-read --allow-write --allow-env --allow-run ${
    shellQuote(runtimePath)
  }`;
}

function resolveDefaultRuntimePath(executablePath?: string): string {
  const resolvedEntry = resolveExecutablePath(executablePath);
  const runtimePath = findRuntimeFrom(path.dirname(resolvedEntry));
  if (runtimePath === null) {
    throw new Error(
      "subprocess adapter requires command settings. " +
        "Set TEAMMATE_COMMAND or both TEAMMATE_PLAN_COMMAND and TEAMMATE_EXECUTE_COMMAND, " +
        "or pass --teammate-command / --plan-command / --execute-command. " +
        `Default ts wrapper was not found: ${
          path.resolve(
            path.dirname(resolvedEntry),
            "src",
            "infrastructure",
            "wrapper",
            "runtime.ts",
          )
        }`,
    );
  }
  return runtimePath;
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
    changeId: null,
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

  return parsed;
}

function parseSpecCreatorArgs(argv: string[]): SpecCreatorArgs {
  if (argv.includes("-h") || argv.includes("--help")) {
    throw new HelpRequestedError(SPEC_CREATOR_USAGE);
  }

  const parsed: SpecCreatorArgs = {
    changeId: null,
    output: null,
    noRun: false,
    applyOnPostRunFail: false,
    stateDir: null,
    resume: false,
    personaDir: null,
    mode: "regenerate",
    emitReviewContractToArtifacts: true,
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
    if (arg === "--persona-dir") {
      parsed.personaDir = parseSingleArgValue(
        "--persona-dir",
        parsed.personaDir,
        next,
      );
      index += 1;
      continue;
    }
    if (arg === "--no-run") {
      parsed.noRun = true;
      continue;
    }
    if (arg === "--apply-on-post-run-fail") {
      parsed.applyOnPostRunFail = true;
      continue;
    }
    if (arg === "--resume") {
      parsed.resume = true;
      continue;
    }

    throw new Error(`unrecognized argument: ${arg}`);
  }

  return parsed;
}

function parseSpecCreatorPolishArgs(argv: string[]): SpecCreatorPolishArgs {
  if (argv.includes("-h") || argv.includes("--help")) {
    throw new HelpRequestedError(SPEC_CREATOR_POLISH_USAGE);
  }
  if (argv.length === 0 || argv[0].startsWith("--")) {
    throw new Error(
      "spec-creator polish requires positional <change_id> (fail-closed)",
    );
  }

  const parsed: SpecCreatorPolishArgs = {
    changeId: normalizeChangeId(argv[0]),
    feedback: null,
    output: null,
    noRun: false,
    applyOnPostRunFail: false,
    stateDir: null,
    resume: false,
    personaDir: null,
    mode: "preserve-supplement",
    emitReviewContractToArtifacts: false,
  };

  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--feedback") {
      parsed.feedback = parseSingleArgValue(
        "--feedback",
        parsed.feedback,
        next,
      );
      index += 1;
      continue;
    }
    if (arg === "--output") {
      parsed.output = parseSingleArgValue("--output", parsed.output, next);
      index += 1;
      continue;
    }
    if (arg === "--state-dir") {
      parsed.stateDir = parseSingleArgValue(
        "--state-dir",
        parsed.stateDir,
        next,
      );
      index += 1;
      continue;
    }
    if (arg === "--persona-dir") {
      parsed.personaDir = parseSingleArgValue(
        "--persona-dir",
        parsed.personaDir,
        next,
      );
      index += 1;
      continue;
    }
    if (arg === "--mode") {
      parsed.mode = parseSpecCreatorPolishMode(
        requireOptionValue(arg, next),
      );
      index += 1;
      continue;
    }
    if (arg.startsWith("--mode=")) {
      parsed.mode = parseSpecCreatorPolishMode(
        requireOptionValue("--mode", arg.slice("--mode=".length)),
      );
      continue;
    }
    if (arg === "--emit-review-contract-to-artifacts") {
      if (next !== undefined && !next.startsWith("--")) {
        parsed.emitReviewContractToArtifacts = parseBooleanFlagValue(
          "--emit-review-contract-to-artifacts",
          next,
        );
        index += 1;
      } else {
        parsed.emitReviewContractToArtifacts = true;
      }
      continue;
    }
    if (arg.startsWith("--emit-review-contract-to-artifacts=")) {
      parsed.emitReviewContractToArtifacts = parseBooleanFlagValue(
        "--emit-review-contract-to-artifacts",
        requireOptionValue(
          "--emit-review-contract-to-artifacts",
          arg.slice("--emit-review-contract-to-artifacts=".length),
        ),
      );
      continue;
    }
    if (arg === "--no-run") {
      parsed.noRun = true;
      continue;
    }
    if (arg === "--apply-on-post-run-fail") {
      parsed.applyOnPostRunFail = true;
      continue;
    }
    if (arg === "--resume") {
      parsed.resume = true;
      continue;
    }

    throw new Error(`unrecognized argument: ${arg}`);
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
    personaDir: null,
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
    if (arg === "--persona-dir") {
      parsed.personaDir = parseSingleArgValue(
        "--persona-dir",
        parsed.personaDir,
        next,
      );
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

function parseSingleArgValue(
  option: string,
  existingValue: string | null,
  value: string | undefined,
): string {
  if (existingValue !== null) {
    throw new Error(`${option} can only be used once`);
  }
  return requireOptionValue(option, value);
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

function parseSpecCreatorPolishMode(raw: string): SpecCreatorPolishMode {
  const normalized = raw.trim().toLowerCase();
  if (normalized === "preserve-supplement" || normalized === "regenerate") {
    return normalized;
  }
  throw new Error(
    `argument --mode: invalid choice: '${raw}' (choose from 'preserve-supplement', 'regenerate')`,
  );
}

function parseBooleanFlagValue(option: string, raw: string): boolean {
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") {
    return true;
  }
  if (normalized === "false" || normalized === "0") {
    return false;
  }
  throw new Error(
    `argument ${option}: invalid boolean value: '${raw}' (use true/false)`,
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
  if (args.changeId !== null) {
    assertSpecCreatorChangeDirAbsent(args.changeId, "spec-creator-preprocess");
  }
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

const SPEC_CREATOR_FORBIDDEN_COMMAND_PATTERNS = [
  {
    label: "agent-dock openspec",
    pattern: /\bagent-dock\s+openspec\b/iu,
  },
  {
    label: "node_modules/.bin/openspec",
    pattern: /(?:\.\/)?node_modules\/\.bin\/openspec\b/iu,
  },
] as const;

const SPEC_CREATOR_FORBIDDEN_COMMAND_EXEMPT_CONTEXT_PATTERNS = [
  /使用禁止/u,
  /実行指示として記載しない/u,
  /forbidden/iu,
  /do not use/iu,
  /must not use/iu,
] as const;

function specCreatorCommand(argv: string[], io: CliIO): number {
  const subcommand = argv[0] ?? "";
  if (subcommand === "polish") {
    return specCreatorPolishCommand(argv.slice(1), io);
  }
  if (subcommand.length > 0 && !subcommand.startsWith("--")) {
    throw new Error(
      `unrecognized spec-creator subcommand: ${subcommand} (supported: polish)`,
    );
  }

  const hasHelpFlag = argv.includes("-h") || argv.includes("--help");
  if (!hasHelpFlag) {
    io.stderr(
      "[spec-creator] legacy direct mode is deprecated; use `spec-creator polish <change_id>`.\n",
    );
  }
  const args = parseSpecCreatorArgs(argv);
  if (args.changeId !== null) {
    assertSpecCreatorChangeDirAbsent(args.changeId, "spec-creator");
  }
  const context = collectSpecContextInteractive({
    changeId: args.changeId,
  });
  assertSpecCreatorChangeDirAbsent(context.change_id, "spec-creator");
  return runSpecCreatorWorkflow(args, context, io);
}

function specCreatorPolishCommand(argv: string[], io: CliIO): number {
  const args = parseSpecCreatorPolishArgs(argv);
  const revisedChangeId = resolveSpecCreatorPolishRevisedChangeId(
    args.changeId,
  );
  assertSpecCreatorChangeDirAbsent(revisedChangeId, "spec-creator polish");
  const context = buildSpecCreatorPolishContextFromMarkdown(
    args.changeId,
    revisedChangeId,
    args.feedback,
    {
      mode: args.mode,
      emitReviewContractToArtifacts: args.emitReviewContractToArtifacts,
    },
    "spec-creator polish",
  );
  return runSpecCreatorWorkflow(args, context, io);
}

function resolveSpecCreatorChangeDir(changeId: string): string {
  return path.resolve("openspec", "changes", changeId);
}

function assertSpecCreatorChangeDirAbsent(
  changeId: string,
  commandLabel: string,
): void {
  const changeDir = resolveSpecCreatorChangeDir(changeId);
  if (isDirectory(changeDir)) {
    throw new Error(
      `${commandLabel} requires non-existing change_id: ${changeId}`,
    );
  }
}

const SPEC_CREATOR_POLISH_REVISED_SUFFIX = "_revised";

function resolveSpecCreatorPolishRevisedChangeId(
  sourceChangeId: string,
): string {
  return `${sourceChangeId}${SPEC_CREATOR_POLISH_REVISED_SUFFIX}`;
}

const SPEC_CREATOR_POLISH_ACTIVE_PERSONAS = [
  "spec-planner",
  "spec-reviewer",
  "spec-code-creator",
];

function buildSpecCreatorPolishContextFromMarkdown(
  sourceChangeId: string,
  outputChangeId: string,
  feedbackRaw: string | null,
  options: {
    mode: SpecCreatorPolishMode;
    emitReviewContractToArtifacts: boolean;
  },
  commandLabel: string,
): SpecCreatorContextPayload {
  const markdownContexts = collectSpecCreatorPolishMarkdownContexts(
    sourceChangeId,
    commandLabel,
  );
  const feedback = feedbackRaw?.trim() ?? "";
  const prompt = buildSpecCreatorPolishPrompt({
    changeId: outputChangeId,
    markdownContexts,
    feedback,
  });
  const specContext = normalizeSpecContextForReviewContract({
    requirements_text: prompt.requirementsText,
    language: prompt.language,
    runtime_stack: "typescript",
    persona_policy: {
      active_personas: [...SPEC_CREATOR_POLISH_ACTIVE_PERSONAS],
    },
  }, { includeReviewContractInContext: false });

  return {
    change_id: outputChangeId,
    spec_context: structuredClone(specContext),
    task_config: buildSpecCreatorTaskConfig(outputChangeId, specContext, {
      includeReviewContractInContext: false,
      includeReviewContractInTaskDescription: false,
    }),
    polish: {
      sourceChangeId,
      mode: options.mode,
      emitReviewContractToArtifacts: options.emitReviewContractToArtifacts,
    },
  };
}

function runSpecCreatorWorkflow(
  args: {
    output: string | null;
    noRun: boolean;
    applyOnPostRunFail: boolean;
    stateDir: string | null;
    resume: boolean;
    personaDir: string | null;
    mode: SpecCreatorPolishMode;
    emitReviewContractToArtifacts: boolean;
  },
  context: SpecCreatorContextPayload,
  io: CliIO,
): number {
  const paths = resolveSpecCreatorArtifactPaths(context.change_id, {
    sourceChangeId: context.polish?.sourceChangeId,
    preserveSourceSpecPaths: args.mode === "preserve-supplement",
  });
  const qualityOptions = resolveSpecCreatorQualityOptions(args, context);
  const outputPath = path.resolve(
    args.output ?? defaultSpecCreatorOutputPath(context.change_id),
  );
  const artifactSnapshotBeforeWorkflow = snapshotArtifactContents(paths);
  const outputSnapshotBeforeWorkflow = readArtifactContentOrNull(outputPath);
  const stagingRoot = Deno.makeTempDirSync({
    prefix: `spec_creator_stage_${context.change_id}_`,
  });
  const stagedPaths = toStagedArtifactPaths(paths, stagingRoot);
  const stagedOutputPath = resolveStagedOutputPath(outputPath, stagingRoot);

  try {
    prepareSpecCreatorStagingWorkspace(stagingRoot);
    writeSpecCreatorArtifacts({
      context,
      paths: stagedPaths,
      outputPath: stagedOutputPath,
    });
    normalizeSpecCreatorReviewContractCoverage(
      stagedPaths,
      "post-generate",
      io,
      {
        emitReviewContractToArtifacts: args.emitReviewContractToArtifacts,
      },
    );
    assertNoForbiddenSpecCreatorCommands(stagedPaths, "post-generate");
    assertSpecCreatorSemanticContracts(
      stagedPaths,
      "post-generate",
      qualityOptions,
    );
    runStagedStrictValidate(context.change_id, stagingRoot);
    for (const artifactPath of listSpecCreatorArtifactPaths(paths)) {
      io.stdout(`[spec-creator] wrote ${artifactPath}\n`);
    }
    io.stdout(`[spec-creator] wrote ${outputPath}\n`);

    if (args.noRun) {
      applyStagedArtifactsAtomically({
        stagingRoot,
        stagedPaths,
        targetPaths: paths,
        stagedOutputPath,
        outputPath,
        artifactSnapshotBeforeWorkflow,
        outputSnapshotBeforeWorkflow,
      });
      return 0;
    }

    const stateDir = args.stateDir
      ? path.resolve(args.stateDir)
      : path.resolve(defaultSpecCreatorStateDir(context.change_id));

    const maxQualityRetriesRaw = safeIntEnv(
      "SPEC_CREATOR_QUALITY_MAX_RETRIES",
      1,
    );
    const maxQualityRetries = Math.max(0, Math.min(3, maxQualityRetriesRaw));
    let attempt = 0;
    const qualityRetryCountsByFile = new Map<string, number>();
    while (true) {
      const preRunViolations = collectSpecCreatorQualityViolations(
        stagedPaths,
        qualityOptions,
      );
      const qualityTargetSelection = selectQualityTargetFile(
        preRunViolations,
        qualityRetryCountsByFile,
        maxQualityRetries,
      );
      const qualityTargetFile = qualityTargetSelection.targetFile;
      if (preRunViolations.length > 0) {
        if (qualityTargetFile === null) {
          throw new Error(
            `spec-creator quality retry exhausted: no eligible target file (targets=${
              qualityTargetSelection.targetFiles.map((filePath) =>
                toRelativePath(filePath)
              ).join(", ")
            })`,
          );
        }
        const scopedViolations = qualityTargetFile === null
          ? preRunViolations
          : preRunViolations.filter((violation) =>
            path.resolve(violation.file) === qualityTargetFile
          );
        const issues = formatSpecCreatorQualityIssues(
          scopedViolations.length > 0 ? scopedViolations : preRunViolations,
        );
        Deno.env.set("SPEC_CREATOR_QUALITY_ISSUES", issues);
        if (qualityTargetFile !== null) {
          Deno.env.set("SPEC_CREATOR_QUALITY_TARGET_FILE", qualityTargetFile);
          Deno.env.set(
            "SPEC_CREATOR_QUALITY_TARGET_INDEX",
            String(qualityTargetSelection.targetIndex),
          );
          Deno.env.set(
            "SPEC_CREATOR_QUALITY_TARGET_TOTAL",
            String(qualityTargetSelection.targetTotal),
          );
        } else {
          Deno.env.delete("SPEC_CREATOR_QUALITY_TARGET_FILE");
          Deno.env.delete("SPEC_CREATOR_QUALITY_TARGET_INDEX");
          Deno.env.delete("SPEC_CREATOR_QUALITY_TARGET_TOTAL");
        }
        io.stdout(
          `[spec-creator] quality_preflight_issues=${preRunViolations.length} attempt=${attempt}\n`,
        );
        if (qualityTargetFile !== null) {
          io.stdout(
            `[spec-creator] quality_target_file=${
              toRelativePath(qualityTargetFile)
            } index=${qualityTargetSelection.targetIndex}/${qualityTargetSelection.targetTotal}\n`,
          );
        }
      } else {
        Deno.env.delete("SPEC_CREATOR_QUALITY_ISSUES");
        Deno.env.delete("SPEC_CREATOR_QUALITY_TARGET_FILE");
        Deno.env.delete("SPEC_CREATOR_QUALITY_TARGET_INDEX");
        Deno.env.delete("SPEC_CREATOR_QUALITY_TARGET_TOTAL");
      }
      const artifactSnapshotBeforeRun = snapshotArtifactContentsForQualityRetry(
        stagedPaths,
      );

      const runArgs = [
        "--config",
        stagedOutputPath,
        "--state-dir",
        stateDir,
        ...(args.resume ? ["--resume"] : []),
        ...(args.personaDir ? ["--persona-dir", args.personaDir] : []),
      ];
      const runArgsForLog = [
        `--config ${stagedOutputPath}`,
        `--state-dir ${stateDir}`,
        ...(args.resume ? ["--resume"] : []),
        ...(args.personaDir ? [`--persona-dir ${args.personaDir}`] : []),
      ];
      io.stdout(`[spec-creator] run ${runArgsForLog.join(" ")}\n`);
      const runExitCode = runWithCurrentDirectory(
        stagingRoot,
        () => runCommand(runArgs, io),
      );
      Deno.env.delete("SPEC_CREATOR_QUALITY_ISSUES");
      Deno.env.delete("SPEC_CREATOR_QUALITY_TARGET_FILE");
      Deno.env.delete("SPEC_CREATOR_QUALITY_TARGET_INDEX");
      Deno.env.delete("SPEC_CREATOR_QUALITY_TARGET_TOTAL");
      if (runExitCode !== 0) {
        return runExitCode;
      }
      if (qualityTargetFile !== null) {
        assertQualityRetryEditedTargetOnly(
          artifactSnapshotBeforeRun,
          qualityTargetFile,
        );
      }

      try {
        normalizeSpecCreatorReviewContractCoverage(
          stagedPaths,
          "post-run",
          io,
          {
            emitReviewContractToArtifacts: args
              .emitReviewContractToArtifacts,
          },
        );
        assertNoForbiddenSpecCreatorCommands(stagedPaths, "post-run");
        assertSpecCreatorSemanticContracts(
          stagedPaths,
          "post-run",
          qualityOptions,
        );
        runSpecCreatorPostAuditGate(context.change_id, io, stagingRoot);
        applyStagedArtifactsAtomically({
          stagingRoot,
          stagedPaths,
          targetPaths: paths,
          stagedOutputPath,
          outputPath,
          artifactSnapshotBeforeWorkflow,
          outputSnapshotBeforeWorkflow,
        });
        return 0;
      } catch (error) {
        const maybeApplyArtifactsOnPostRunFailure = (): void => {
          if (!args.applyOnPostRunFail) {
            return;
          }
          applyStagedArtifactsAtomically({
            stagingRoot,
            stagedPaths,
            targetPaths: paths,
            stagedOutputPath,
            outputPath,
            artifactSnapshotBeforeWorkflow,
            outputSnapshotBeforeWorkflow,
          });
          io.stdout("[spec-creator] applied_staged_artifacts_on_post_run_fail=1\n");
        };
        if (qualityTargetFile !== null) {
          const currentRetry =
            qualityRetryCountsByFile.get(qualityTargetFile) ??
              0;
          const nextRetry = currentRetry + 1;
          qualityRetryCountsByFile.set(qualityTargetFile, nextRetry);
          if (nextRetry > maxQualityRetries) {
            maybeApplyArtifactsOnPostRunFailure();
            throw error;
          }
          const reason = error instanceof Error ? error.message : String(error);
          io.stdout(
            `[spec-creator] quality_retry file=${
              toRelativePath(qualityTargetFile)
            } retry=${nextRetry}/${maxQualityRetries} reason=${reason}\n`,
          );
          continue;
        }
        if (attempt >= maxQualityRetries) {
          maybeApplyArtifactsOnPostRunFailure();
          throw error;
        }
        attempt += 1;
        const reason = error instanceof Error ? error.message : String(error);
        io.stdout(
          `[spec-creator] quality_retry=${attempt}/${maxQualityRetries} reason=${reason}\n`,
        );
      }
    }
  } finally {
    Deno.removeSync(stagingRoot, { recursive: true });
  }
}

function resolveSpecCreatorQualityOptions(
  args: {
    mode: SpecCreatorPolishMode;
    emitReviewContractToArtifacts: boolean;
  },
  context: SpecCreatorContextPayload,
): SpecCreatorQualityOptions {
  const sourcePaths = args.mode === "preserve-supplement"
    ? resolveSpecCreatorPolishSourceArtifactPaths(context.polish?.sourceChangeId)
    : null;
  return {
    emitReviewContractToArtifacts: args.emitReviewContractToArtifacts,
    polishMode: args.mode,
    sourcePaths: sourcePaths ?? undefined,
  };
}

export interface SpecCreatorArtifactPaths {
  changeId: string;
  changeDir: string;
  proposalPath: string;
  tasksPath: string;
  designPath: string;
  codeSummaryPath: string;
  deltaSpecPath: string;
  deltaSpecPaths: string[];
}

interface SpecCreatorContextPayload {
  change_id: string;
  spec_context: SpecContext;
  task_config: SpecCreatorTaskConfig;
  polish?: {
    sourceChangeId?: string;
    mode?: SpecCreatorPolishMode;
    emitReviewContractToArtifacts?: boolean;
  };
}

function resolveSpecCreatorArtifactPaths(
  changeId: string,
  options: {
    sourceChangeId?: string;
    preserveSourceSpecPaths?: boolean;
  } = {},
): SpecCreatorArtifactPaths {
  const changeDir = path.resolve("openspec", "changes", changeId);
  const deltaSpecPaths = collectDeltaSpecPaths(changeDir, changeId, {
    sourceChangeId: options.sourceChangeId,
    preserveSourceSpecPaths: options.preserveSourceSpecPaths ?? false,
  });
  return {
    changeId,
    changeDir,
    proposalPath: path.join(changeDir, "proposal.md"),
    tasksPath: path.join(changeDir, "tasks.md"),
    designPath: path.join(changeDir, "design.md"),
    codeSummaryPath: path.join(changeDir, "code_summary.md"),
    deltaSpecPath: deltaSpecPaths[0],
    deltaSpecPaths,
  };
}

function writeSpecCreatorArtifacts(
  options: {
    context: SpecCreatorContextPayload;
    paths: SpecCreatorArtifactPaths;
    outputPath: string;
  },
): void {
  const { context, paths, outputPath } = options;
  const lang = context.spec_context.language;
  if (context.polish?.mode === "preserve-supplement") {
    writeSpecCreatorArtifactsPreserveSupplement({ context, paths, lang });
  } else {
    writeSpecCreatorArtifactsRegenerate({ context, paths, lang });
  }

  writeTaskConfigFile(context.task_config, outputPath);
}

function writeSpecCreatorArtifactsRegenerate(
  options: {
    context: SpecCreatorContextPayload;
    paths: SpecCreatorArtifactPaths;
    lang: "ja" | "en";
  },
): void {
  const { context, paths, lang } = options;
  writeProposalMarkdown({
    proposalPath: paths.proposalPath,
    lang,
    whyMarkdown: asBulletLines([
      context.spec_context.requirements_text,
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
      context.spec_context.requirements_text,
    ]),
  });

  const preservedOutputPhaseAssignmentsPath =
    resolveSpecCreatorPreservedOutputPhaseAssignmentsPath(context, paths);
  const preservedOutputPhaseAssignments =
    collectExistingTaskOutputPhaseAssignments(
      preservedOutputPhaseAssignmentsPath,
    );
  writeTasksMarkdown({
    tasksPath: paths.tasksPath,
    lang,
    implementationMarkdown: buildImplementationMarkdownForSpecCreator(
      context.task_config.tasks,
      lang,
      { preservedOutputPhaseAssignments },
    ),
    humanNotesMarkdown: buildHumanNotesMarkdownForSpecCreator(
      context.spec_context,
      lang,
    ),
  });

  writeCodeSummaryMarkdown({
    tasksPath: paths.tasksPath,
    outputPath: paths.codeSummaryPath,
  });
  if (shouldGenerateDesignMarkdown(context) && !isFile(paths.designPath)) {
    writeDesignMarkdownStub({
      designPath: paths.designPath,
      lang,
    });
  }
  for (const deltaSpecPath of collectAllDeltaSpecPaths(paths)) {
    writeDeltaSpecMarkdown({
      specPath: deltaSpecPath,
      lang,
      requirementName: `${context.change_id} generated baseline`,
      requirementsText: context.spec_context.requirements_text,
    });
  }
}

function writeSpecCreatorArtifactsPreserveSupplement(
  options: {
    context: SpecCreatorContextPayload;
    paths: SpecCreatorArtifactPaths;
    lang: "ja" | "en";
  },
): void {
  const { context, paths, lang } = options;
  const sourcePaths = resolveSpecCreatorPolishSourceArtifactPaths(
    context.polish?.sourceChangeId,
  );
  if (sourcePaths !== null) {
    copyFileContentIfExists(sourcePaths.proposalPath, paths.proposalPath);
    copyFileContentIfExists(sourcePaths.tasksPath, paths.tasksPath);
    copyFileContentIfExists(sourcePaths.designPath, paths.designPath);
    copyFileContentIfExists(sourcePaths.codeSummaryPath, paths.codeSummaryPath);
    for (const targetSpecPath of collectAllDeltaSpecPaths(paths)) {
      const relative = path.relative(paths.changeDir, targetSpecPath);
      if (
        relative.length === 0 || relative === "." || relative.startsWith("..")
      ) {
        continue;
      }
      const sourceSpecPath = path.join(sourcePaths.changeDir, relative);
      copyFileContentIfExists(sourceSpecPath, targetSpecPath);
    }
  }

  if (!isFile(paths.proposalPath)) {
    writeProposalMarkdown({
      proposalPath: paths.proposalPath,
      lang,
      whyMarkdown: asBulletLines([
        context.spec_context.requirements_text,
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
        context.spec_context.requirements_text,
      ]),
    });
  }
  if (!isFile(paths.tasksPath)) {
    const preservedOutputPhaseAssignmentsPath =
      resolveSpecCreatorPreservedOutputPhaseAssignmentsPath(context, paths);
    const preservedOutputPhaseAssignments =
      collectExistingTaskOutputPhaseAssignments(
        preservedOutputPhaseAssignmentsPath,
      );
    writeTasksMarkdown({
      tasksPath: paths.tasksPath,
      lang,
      implementationMarkdown: buildImplementationMarkdownForSpecCreator(
        context.task_config.tasks,
        lang,
        { preservedOutputPhaseAssignments },
      ),
      humanNotesMarkdown: buildHumanNotesMarkdownForSpecCreator(
        context.spec_context,
        lang,
      ),
    });
  }
  if (!isFile(paths.codeSummaryPath)) {
    writeCodeSummaryMarkdown({
      tasksPath: paths.tasksPath,
      outputPath: paths.codeSummaryPath,
    });
  }
  if (shouldGenerateDesignMarkdown(context) && !isFile(paths.designPath)) {
    writeDesignMarkdownStub({
      designPath: paths.designPath,
      lang,
    });
  }
  for (const deltaSpecPath of collectAllDeltaSpecPaths(paths)) {
    if (isFile(deltaSpecPath)) {
      continue;
    }
    writeDeltaSpecMarkdown({
      specPath: deltaSpecPath,
      lang,
      requirementName: `${context.change_id} generated baseline`,
      requirementsText: context.spec_context.requirements_text,
    });
  }
}

function copyFileContentIfExists(sourcePath: string, targetPath: string): void {
  if (!isFile(sourcePath)) {
    return;
  }
  Deno.mkdirSync(path.dirname(targetPath), { recursive: true });
  Deno.copyFileSync(sourcePath, targetPath);
}

function resolveSpecCreatorPreservedOutputPhaseAssignmentsPath(
  context: SpecCreatorContextPayload,
  paths: SpecCreatorArtifactPaths,
): string {
  const sourceChangeId = context.polish?.sourceChangeId;
  if (sourceChangeId !== undefined) {
    const sourceTasksPath = path.resolve(
      "openspec",
      "changes",
      sourceChangeId,
      "tasks.md",
    );
    if (isFile(sourceTasksPath)) {
      return sourceTasksPath;
    }
  }
  return paths.tasksPath;
}

function resolveSpecCreatorPolishSourceArtifactPaths(
  sourceChangeId: string | undefined,
): SpecCreatorArtifactPaths | null {
  if (sourceChangeId === undefined) {
    return null;
  }
  const sourceChangeDir = resolveSpecCreatorChangeDir(sourceChangeId);
  if (!isDirectory(sourceChangeDir)) {
    return null;
  }
  return resolveSpecCreatorArtifactPaths(sourceChangeId);
}

export function normalizeSpecCreatorReviewContractCoverageForTest(
  paths: SpecCreatorArtifactPaths,
  options: {
    emitReviewContractToArtifacts?: boolean;
  } = {},
): void {
  normalizeSpecCreatorReviewContractCoverage(paths, "post-run", null, {
    emitReviewContractToArtifacts:
      options.emitReviewContractToArtifacts ?? true,
  });
}

function normalizeSpecCreatorReviewContractCoverage(
  paths: SpecCreatorArtifactPaths,
  phase: "post-generate" | "post-run",
  io: CliIO | null,
  options: {
    emitReviewContractToArtifacts: boolean;
  },
): void {
  const tasksResult = normalizeTasksReviewContractCoverage(
    paths.tasksPath,
    {
      emitReviewContractToArtifacts: options.emitReviewContractToArtifacts,
    },
  );
  const codeSummaryResult = options.emitReviewContractToArtifacts
    ? normalizeCodeSummaryReviewContractCoverage(
      paths.codeSummaryPath,
      tasksResult.language,
    )
    : { changed: false };
  const specsResult = options.emitReviewContractToArtifacts
    ? normalizeDeltaSpecReviewContractCoverage(
      paths,
      tasksResult.language,
    )
    : { changed: false };
  if (
    !tasksResult.changed &&
    !specsResult.changed &&
    !codeSummaryResult.changed
  ) {
    return;
  }
  io?.stdout(
    `[spec-creator] normalize_review_contract phase=${phase} tasks_changed=${
      tasksResult.changed ? 1 : 0
    } code_summary_changed=${codeSummaryResult.changed ? 1 : 0} specs_changed=${
      specsResult.changed ? 1 : 0
    }\n`,
  );
}

function normalizeTasksReviewContractCoverage(
  tasksPath: string,
  options: {
    emitReviewContractToArtifacts: boolean;
  },
): { changed: boolean; language: "ja" | "en" } {
  const original = Deno.readTextFileSync(tasksPath);
  const language = detectReviewContractLanguage(original);
  const lines = original.split(/\r?\n/u);
  let changed = false;

  if (options.emitReviewContractToArtifacts) {
    let sectionRange = findTaskSectionRange(lines, "1.3");
    if (sectionRange === null) {
      const insertionIndex = findImplementationSectionEnd(lines);
      lines.splice(
        insertionIndex,
        0,
        buildTask13HeaderLine(language),
        ...buildTaskReviewContractLines(
          [...REQUIRED_REVIEW_CONTRACT_IDS],
          language,
        ),
      );
      changed = true;
      sectionRange = findTaskSectionRange(lines, "1.3");
    }

    if (sectionRange === null) {
      throw new Error(
        `failed to normalize review contract coverage: missing task 1.3 section in ${tasksPath}`,
      );
    }

    const originalSectionLines = lines.slice(
      sectionRange.start,
      sectionRange.end,
    );
    const sectionWithoutContractLines = originalSectionLines.filter(
      (line, index) => index === 0 || !isReviewContractTraceLine(line),
    );
    const insertionIndex = findTaskReviewContractInsertIndex(
      sectionWithoutContractLines,
    );
    const rewrittenSectionLines = [
      ...sectionWithoutContractLines.slice(0, insertionIndex),
      ...buildTaskReviewContractLines(REQUIRED_REVIEW_CONTRACT_IDS, language),
      ...sectionWithoutContractLines.slice(insertionIndex),
    ];
    if (!areStringArraysEqual(originalSectionLines, rewrittenSectionLines)) {
      lines.splice(
        sectionRange.start,
        sectionRange.end - sectionRange.start,
        ...rewrittenSectionLines,
      );
      changed = true;
    }
  }

  if (normalizeTaskPersonaPolicyCoverage(lines, tasksPath)) {
    changed = true;
  }

  if (!changed) {
    return { changed: false, language };
  }
  Deno.writeTextFileSync(tasksPath, ensureTrailingNewline(lines.join("\n")));
  return { changed: true, language };
}

function normalizeTaskPersonaPolicyCoverage(
  lines: string[],
  tasksPath: string,
): boolean {
  const taskPattern =
    /^\s*-\s*\[[ xX]\]\s*((?:T-[A-Za-z0-9_-]+|TASK-[A-Za-z0-9_-]+|\d+(?:\.\d+)*))\b/iu;
  const headingPattern = /^##\s+/u;
  const personaPolicyPattern = /^\s*-\s*persona_policy\s*:/u;
  const phaseAssignmentsPattern =
    /^\s*-\s*(?:フェーズ担当|phase assignments)\s*:\s*(.+?)\s*$/u;
  const descriptionPattern = /^\s*-\s*(?:成果物|Description)\s*:/u;
  const fallbackPhaseOrder = parseOutputPhaseAssignments(
    DEFAULT_TASK_OUTPUT_PHASE_ASSIGNMENTS,
    `${toRelativePath(tasksPath)} fallback`,
  ).phaseOrder;

  let changed = false;
  let index = 0;
  while (index < lines.length) {
    const matched = taskPattern.exec(lines[index]);
    if (matched === null) {
      index += 1;
      continue;
    }
    const taskId = matched[1];
    const sectionStart = index;
    let sectionEnd = lines.length;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      if (taskPattern.test(lines[cursor]) || headingPattern.test(lines[cursor])) {
        sectionEnd = cursor;
        break;
      }
    }

    const sectionLines = lines.slice(sectionStart, sectionEnd);
    const hasPersonaPolicy = sectionLines.some((line) =>
      personaPolicyPattern.test(line)
    );
    if (hasPersonaPolicy) {
      index = sectionEnd;
      continue;
    }

    let phaseOrder = [...fallbackPhaseOrder];
    const phaseAssignmentsRaw = sectionLines
      .map((line) => phaseAssignmentsPattern.exec(line)?.[1]?.trim() ?? "")
      .find((value) => value.length > 0);
    if (phaseAssignmentsRaw !== undefined) {
      try {
        phaseOrder = parseOutputPhaseAssignments(
          phaseAssignmentsRaw,
          `${toRelativePath(tasksPath)} task=${taskId}`,
        ).phaseOrder;
      } catch {
        phaseOrder = [...fallbackPhaseOrder];
      }
    }

    const personaPolicyLine = `  - persona_policy: ${
      JSON.stringify({ phase_order: phaseOrder })
    }`;
    const insertionOffset = sectionLines.findIndex((line, sectionIndex) =>
      sectionIndex > 0 && descriptionPattern.test(line)
    );
    const insertionIndex = insertionOffset >= 0
      ? sectionStart + insertionOffset
      : sectionEnd;
    lines.splice(insertionIndex, 0, personaPolicyLine);
    changed = true;
    index = sectionEnd + 1;
  }
  return changed;
}

function normalizeCodeSummaryReviewContractCoverage(
  codeSummaryPath: string,
  language: "ja" | "en",
): { changed: boolean } {
  const original = readTextFileOrEmpty(codeSummaryPath);
  const lines = original.length > 0
    ? original.split(/\r?\n/u)
    : ["# code_summary.md", ""];
  let changed = false;

  let sectionRange = findCodeSummaryTaskSectionRange(lines, "1.3");
  if (sectionRange === null) {
    if (lines.length > 0 && lines[lines.length - 1] !== "") {
      lines.push("");
    }
    const sectionLines = buildCodeSummaryTaskSectionLines(language);
    lines.push(...sectionLines);
    changed = true;
    sectionRange = findCodeSummaryTaskSectionRange(lines, "1.3");
  }

  if (sectionRange === null) {
    throw new Error(
      `failed to normalize review contract coverage: missing task_id 1.3 section in ${codeSummaryPath}`,
    );
  }

  const originalSectionLines = lines.slice(
    sectionRange.start,
    sectionRange.end,
  );
  const sectionWithoutTraceability = originalSectionLines.filter((line) =>
    !isReviewContractTraceLine(line) &&
    !isCodeSummaryReviewContractTraceabilityHeading(line)
  );
  const rewrittenSectionLines = appendCodeSummaryTraceabilityLines(
    sectionWithoutTraceability,
    language,
  );
  if (!areStringArraysEqual(originalSectionLines, rewrittenSectionLines)) {
    lines.splice(
      sectionRange.start,
      sectionRange.end - sectionRange.start,
      ...rewrittenSectionLines,
    );
    changed = true;
  }

  if (!changed) {
    return { changed: false };
  }

  Deno.mkdirSync(path.dirname(codeSummaryPath), { recursive: true });
  Deno.writeTextFileSync(
    codeSummaryPath,
    ensureTrailingNewline(lines.join("\n")),
  );
  return { changed: true };
}

function normalizeDeltaSpecReviewContractCoverage(
  paths: SpecCreatorArtifactPaths,
  language: "ja" | "en",
): { changed: boolean } {
  const deltaSpecPaths = collectAllDeltaSpecPaths(paths);
  if (deltaSpecPaths.length === 0) {
    return { changed: false };
  }

  const mergedSpecText = deltaSpecPaths
    .map((specPath) => readTextFileOrEmpty(specPath))
    .join("\n");
  const missingIds = REQUIRED_REVIEW_CONTRACT_IDS.filter((id) =>
    !mergedSpecText.includes(id)
  );
  if (missingIds.length === 0) {
    return { changed: false };
  }

  const primarySpecPath = deltaSpecPaths[0];
  const base = readTextFileOrEmpty(primarySpecPath).trimEnd();
  const prefixedBase = base.length > 0
    ? `${base}\n\n`
    : "## ADDED Requirements\n\n";
  const appended = missingIds.map((id) =>
    buildSpecReviewContractBlock(id, language)
  ).join("\n\n");
  Deno.mkdirSync(path.dirname(primarySpecPath), { recursive: true });
  Deno.writeTextFileSync(
    primarySpecPath,
    ensureTrailingNewline(`${prefixedBase}${appended}`),
  );
  return { changed: true };
}

function collectAllDeltaSpecPaths(paths: SpecCreatorArtifactPaths): string[] {
  const merged = [
    ...(Array.isArray(paths.deltaSpecPaths) ? paths.deltaSpecPaths : []),
    paths.deltaSpecPath,
  ].filter((item): item is string =>
    typeof item === "string" && item.length > 0
  );
  const unique = [...new Set(merged.map((item) => path.resolve(item)))];
  unique.sort((left, right) => left.localeCompare(right));
  return unique;
}

function readTextFileOrEmpty(filePath: string): string {
  try {
    return Deno.readTextFileSync(filePath);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return "";
    }
    throw error;
  }
}

function detectReviewContractLanguage(text: string): "ja" | "en" {
  if (
    text.includes("## 1. 実装タスク") || /[ぁ-ゖァ-ヺ一-龯]/u.test(text)
  ) {
    return "ja";
  }
  return "en";
}

function findTaskSectionRange(
  lines: string[],
  taskId: string,
): { start: number; end: number } | null {
  const startPattern = new RegExp(
    `^\\s*-\\s*\\[[ xX]\\]\\s*${escapeRegex(taskId)}\\b`,
    "u",
  );
  const taskPattern =
    /^\s*-\s*\[[ xX]\]\s*(?:T-[A-Za-z0-9_-]+|TASK-[A-Za-z0-9_-]+|\d+(?:\.\d+)*)\b/iu;
  const headingPattern = /^##\s+/u;
  let start = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (startPattern.test(lines[index])) {
      start = index;
      break;
    }
  }
  if (start < 0) {
    return null;
  }
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (taskPattern.test(lines[index]) || headingPattern.test(lines[index])) {
      end = index;
      break;
    }
  }
  return { start, end };
}

function findCodeSummaryTaskSectionRange(
  lines: string[],
  taskId: string,
): { start: number; end: number } | null {
  const sectionPattern = /^##\s+task_id:\s*(\S+)\s*$/u;
  const sectionStartPattern = /^##\s+task_id:\s*/u;
  let start = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const matched = sectionPattern.exec(lines[index]);
    if (matched?.[1] === taskId) {
      start = index;
      break;
    }
  }
  if (start < 0) {
    return null;
  }
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (sectionStartPattern.test(lines[index])) {
      end = index;
      break;
    }
  }
  return { start, end };
}

function findImplementationSectionEnd(lines: string[]): number {
  const implementationHeadingPattern = /^##\s+1\./u;
  const headingPattern = /^##\s+/u;
  const headingIndex = lines.findIndex((line) =>
    implementationHeadingPattern.test(line)
  );
  if (headingIndex < 0) {
    return lines.length;
  }
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    if (headingPattern.test(lines[index])) {
      return index;
    }
  }
  return lines.length;
}

function buildTask13HeaderLine(language: "ja" | "en"): string {
  return language === "ja"
    ? "- [ ] 1.3 実行結果レビュー契約（RC-01..RC-12）を明示する"
    : "- [ ] 1.3 Document execution-result review contract (RC-01..RC-12)";
}

type ReviewContractId = (typeof REQUIRED_REVIEW_CONTRACT_IDS)[number];

interface ReviewContractTraceDefinition {
  id: ReviewContractId;
  ja: {
    transport: string;
    reject: string;
    pathTest: string;
    rejectTest: string;
  };
  en: {
    transport: string;
    reject: string;
    pathTest: string;
    rejectTest: string;
  };
}

const REVIEW_CONTRACT_TRACE_DEFINITIONS: ReviewContractTraceDefinition[] = [
  {
    id: "RC-01",
    ja: {
      transport:
        "run/spec-creator/polish の最終結果 block から RESULT を抽出して completed|blocked に正規化する",
      reject:
        "missing_result / invalid_result_value / malformed_result_block は fail-closed",
      pathTest:
        "正常 RESULT=completed を受理し completed 遷移になることを確認する",
      rejectTest: "RESULT 欠落で missing_result を返し拒否することを確認する",
    },
    en: {
      transport:
        "extract RESULT from final block on run/spec-creator/polish and normalize to completed|blocked",
      reject:
        "fail-closed on missing_result / invalid_result_value / malformed_result_block",
      pathTest: "accept RESULT=completed and transition to completed",
      rejectTest: "reject when RESULT is missing with missing_result",
    },
  },
  {
    id: "RC-02",
    ja: {
      transport: "SUMMARY を抽出して必須化し、要約用途へ受け渡す",
      reject: "missing_summary は fail-closed",
      pathTest: "SUMMARY ありの正常応答で通過することを確認する",
      rejectTest: "SUMMARY 欠落で missing_summary を返すことを確認する",
    },
    en: {
      transport: "extract SUMMARY, require it, and pass it to summary usage",
      reject: "fail-closed on missing_summary",
      pathTest: "pass when SUMMARY exists in normal response",
      rejectTest: "return missing_summary when SUMMARY is absent",
    },
  },
  {
    id: "RC-03",
    ja: {
      transport:
        "CHANGED_FILES を正規化し、非implementフェーズでは (none) を強制する",
      reject:
        "missing_changed_files / nonimplement_changed_files は fail-closed",
      pathTest: "implement フェーズで変更ファイル配列を受理することを確認する",
      rejectTest:
        "review/spec_check/test でファイル名がある場合に nonimplement_changed_files を返すことを確認する",
    },
    en: {
      transport:
        "normalize CHANGED_FILES and enforce (none) in non-implement phases",
      reject:
        "fail-closed on missing_changed_files / nonimplement_changed_files",
      pathTest: "accept changed files array in implement phase",
      rejectTest:
        "return nonimplement_changed_files when review/spec_check/test reports files",
    },
  },
  {
    id: "RC-04",
    ja: {
      transport: "CHECKS を抽出して必須化し、禁止コマンド検査を適用する",
      reject: "missing_checks / forbidden_checks_command は fail-closed",
      pathTest: "許可コマンドのみを含む CHECKS を受理することを確認する",
      rejectTest:
        "禁止コマンドを含む CHECKS で forbidden_checks_command を返すことを確認する",
    },
    en: {
      transport:
        "extract CHECKS, require it, and apply forbidden command detection",
      reject: "fail-closed on missing_checks / forbidden_checks_command",
      pathTest: "accept CHECKS with allowed commands only",
      rejectTest:
        "return forbidden_checks_command when CHECKS includes banned command",
    },
  },
  {
    id: "RC-05",
    ja: {
      transport:
        "decision phase で JUDGMENT を必須化し pass|changes_required|blocked に正規化する",
      reject: "missing_judgment / invalid_judgment は fail-closed",
      pathTest: "JUDGMENT=pass を受理して次フェーズへ進むことを確認する",
      rejectTest: "不正値 JUDGMENT で invalid_judgment を返すことを確認する",
    },
    en: {
      transport:
        "require JUDGMENT in decision phase and normalize to pass|changes_required|blocked",
      reject: "fail-closed on missing_judgment / invalid_judgment",
      pathTest: "accept JUDGMENT=pass and advance phase",
      rejectTest: "return invalid_judgment when JUDGMENT value is invalid",
    },
  },
  {
    id: "RC-06",
    ja: {
      transport:
        "判定時系列を blocked即停止 / changes_required送返 / pass前進 で統一する",
      reject: "判定順序違反や未定義分岐は fail-closed",
      pathTest: "changes_required で sendback に遷移することを確認する",
      rejectTest: "blocked 判定後に継続しないことを確認する",
    },
    en: {
      transport:
        "unify decision timeline as blocked stop / changes_required sendback / pass advance",
      reject: "fail-closed on invalid decision ordering or undefined branch",
      pathTest: "verify sendback transition on changes_required",
      rejectTest: "verify no continuation after blocked judgment",
    },
  },
  {
    id: "RC-07",
    ja: {
      transport:
        "review結果に REVIEWER_STOP:requirement_drift|over_editing|verbosity を反映する",
      reject: "REVIEWER_STOP 欠落や未定義コードは fail-closed",
      pathTest: "重大違反で REVIEWER_STOP が出力され停止することを確認する",
      rejectTest: "未定義 REVIEWER_STOP コードを拒否することを確認する",
    },
    en: {
      transport:
        "propagate REVIEWER_STOP:requirement_drift|over_editing|verbosity in review outputs",
      reject: "fail-closed on missing REVIEWER_STOP or unknown code",
      pathTest: "stop when major violation emits REVIEWER_STOP",
      rejectTest: "reject undefined REVIEWER_STOP code",
    },
  },
  {
    id: "RC-08",
    ja: {
      transport: "run と spec-creator(polish含む) の両経路で同じ検証を実行する",
      reject: "片経路のみ実装は fail-closed",
      pathTest:
        "run と spec-creator の双方で同一 validation code になることを確認する",
      rejectTest: "片経路で契約を無視する実装を拒否することを確認する",
    },
    en: {
      transport:
        "apply identical validation on both run and spec-creator (including polish) paths",
      reject: "fail-closed when only one path is covered",
      pathTest: "verify run and spec-creator return the same validation code",
      rejectTest: "reject implementation that bypasses contract on one path",
    },
  },
  {
    id: "RC-09",
    ja: {
      transport: "compile と runtime の責務境界を分離して扱う",
      reject: "compile/runtime の混在判定は fail-closed",
      pathTest: "runtime 契約違反が runtime 側で検出されることを確認する",
      rejectTest: "compile エラーを runtime 経路で扱わないことを確認する",
    },
    en: {
      transport: "separate compile and runtime responsibility boundaries",
      reject: "fail-closed when compile/runtime checks are mixed",
      pathTest: "verify runtime contract errors are detected at runtime path",
      rejectTest: "verify compile errors are not handled as runtime path",
    },
  },
  {
    id: "RC-10",
    ja: {
      transport:
        "task_config.persona_policy.phase_overrides.<phase>.executor_personas を入力契約キーとして検証する",
      reject: "入力キー欠落や別キー使用は fail-closed",
      pathTest: "正しい入力キーで reviewer 順序が解釈されることを確認する",
      rejectTest: "誤キー task_config.review を拒否することを確認する",
    },
    en: {
      transport:
        "validate task_config.persona_policy.phase_overrides.<phase>.executor_personas as input contract key",
      reject: "fail-closed on missing key or wrong key usage",
      pathTest: "verify reviewer order resolves with the correct key",
      rejectTest: "reject wrong key task_config.review",
    },
  },
  {
    id: "RC-11",
    ja: {
      transport: "sendback 条件を blocked=false 前提で評価する",
      reject: "blocked=true の sendback は fail-closed",
      pathTest:
        "changes_required かつ blocked=false で sendback することを確認する",
      rejectTest: "blocked=true で sendback を拒否することを確認する",
    },
    en: {
      transport: "evaluate sendback with blocked=false precondition",
      reject: "fail-closed when sendback is attempted with blocked=true",
      pathTest: "verify sendback on changes_required with blocked=false",
      rejectTest: "verify sendback is rejected when blocked=true",
    },
  },
  {
    id: "RC-12",
    ja: {
      transport:
        "MUST/SHALL ごとに transport・reject・path_test・reject_test を両成果物で追跡可能にする",
      reject: "4要素欠落または tasks/spec/code_summary 非同義は fail-closed",
      pathTest: "RC-01..RC-12 全件で4要素がそろっていることを確認する",
      rejectTest: "任意RCの4要素欠落で品質ガードが reject することを確認する",
    },
    en: {
      transport:
        "make transport/reject/path_test/reject_test traceable per MUST/SHALL across artifacts",
      reject:
        "fail-closed on missing four fields or non-equivalent tasks/spec/code_summary",
      pathTest: "verify all RC-01..RC-12 entries include the four fields",
      rejectTest: "verify quality guard rejects when any RC misses one field",
    },
  },
];

const REVIEW_CONTRACT_TRACE_BY_ID = new Map(
  REVIEW_CONTRACT_TRACE_DEFINITIONS.map((definition) => [
    definition.id,
    definition,
  ]),
);

function buildTaskReviewContractLines(
  ids: readonly ReviewContractId[],
  language: "ja" | "en",
): string[] {
  return ids.map((id) => {
    const traceDefinition = REVIEW_CONTRACT_TRACE_BY_ID.get(id);
    if (traceDefinition === undefined) {
      throw new Error(`missing review contract trace definition for ${id}`);
    }
    const trace = language === "ja" ? traceDefinition.ja : traceDefinition.en;
    return `  - ${id} | transport: ${trace.transport} | reject: ${trace.reject} | path_test: ${trace.pathTest} | reject_test: ${trace.rejectTest}`;
  });
}

function buildCodeSummaryReviewContractLines(
  ids: readonly ReviewContractId[],
  language: "ja" | "en",
): string[] {
  return ids.map((id) => {
    const traceDefinition = REVIEW_CONTRACT_TRACE_BY_ID.get(id);
    if (traceDefinition === undefined) {
      throw new Error(`missing review contract trace definition for ${id}`);
    }
    const trace = language === "ja" ? traceDefinition.ja : traceDefinition.en;
    return `- ${id} | transport: ${trace.transport} | reject: ${trace.reject} | path_test: ${trace.pathTest} | reject_test: ${trace.rejectTest}`;
  });
}

function buildCodeSummaryTaskSectionLines(language: "ja" | "en"): string[] {
  return [
    "## task_id: 1.3",
    "",
    "### review_contract_traceability",
    ...buildCodeSummaryReviewContractLines(
      REQUIRED_REVIEW_CONTRACT_IDS,
      language,
    ),
  ];
}

function appendCodeSummaryTraceabilityLines(
  sectionLines: string[],
  language: "ja" | "en",
): string[] {
  const trimmed = trimTrailingBlankLines(sectionLines);
  const next = [...trimmed];
  if (next.length > 0 && next[next.length - 1] !== "") {
    next.push("");
  }
  next.push("### review_contract_traceability");
  next.push(
    ...buildCodeSummaryReviewContractLines(
      REQUIRED_REVIEW_CONTRACT_IDS,
      language,
    ),
  );
  return next;
}

function trimTrailingBlankLines(lines: string[]): string[] {
  const next = [...lines];
  while (next.length > 0 && next[next.length - 1].trim().length === 0) {
    next.pop();
  }
  return next;
}

function isReviewContractTraceLine(line: string): boolean {
  return /^\s*-\s*(?:\[[ xX]\]\s*)?RC-(?:0[1-9]|1[0-2])\b/u.test(line);
}

function isCodeSummaryReviewContractTraceabilityHeading(line: string): boolean {
  return /^\s*###\s+review_contract_traceability\s*$/iu.test(line);
}

function findTaskReviewContractInsertIndex(sectionLines: string[]): number {
  const failClosedIndex = sectionLines.findIndex((line, index) =>
    index > 0 && /\bfail-closed\b/iu.test(line)
  );
  return failClosedIndex >= 0 ? failClosedIndex : sectionLines.length;
}

function areStringArraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

function buildSpecReviewContractBlock(
  id: string,
  language: "ja" | "en",
): string {
  if (language === "ja") {
    return [
      `### Requirement (${id}): レビュー契約を明示すること`,
      `システムは ${id} を tasks.md(1.3) と specs/**/spec.md の双方に明示しなければならない（SHALL）。`,
      "",
      `#### Scenario: ${id} が成果物に反映される`,
      "- **WHEN** spec-creator が成果物を再生成する",
      `- **THEN** tasks.md の task 1.3 に ${id} が含まれる`,
      `- **AND** specs/**/spec.md に ${id} が含まれる`,
    ].join("\n");
  }
  return [
    `### Requirement (${id}): review contract coverage`,
    `The system SHALL explicitly include ${id} in tasks.md(1.3) and specs/**/spec.md.`,
    "",
    `#### Scenario: ${id} is mirrored in generated artifacts`,
    "- **WHEN** spec-creator regenerates artifacts",
    `- **THEN** tasks.md task 1.3 includes ${id}`,
    `- **AND** specs/**/spec.md includes ${id}`,
  ].join("\n");
}

function escapeRegex(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function ensureTrailingNewline(text: string): string {
  return text.endsWith("\n") ? text : `${text}\n`;
}

function listSpecCreatorArtifactPaths(
  paths: SpecCreatorArtifactPaths,
): string[] {
  const ordered = [
    paths.proposalPath,
    paths.tasksPath,
    paths.codeSummaryPath,
    ...(isFile(paths.designPath) ? [paths.designPath] : []),
    ...collectAllDeltaSpecPaths(paths),
  ];
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const artifactPath of ordered) {
    if (seen.has(artifactPath)) {
      continue;
    }
    seen.add(artifactPath);
    unique.push(artifactPath);
  }
  return unique;
}

function listSpecCreatorArtifactPathsForApply(
  paths: SpecCreatorArtifactPaths,
): string[] {
  const ordered = [
    paths.proposalPath,
    paths.tasksPath,
    paths.codeSummaryPath,
    paths.designPath,
    ...collectAllDeltaSpecPaths(paths),
  ];
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const artifactPath of ordered) {
    const resolved = path.resolve(artifactPath);
    if (seen.has(resolved)) {
      continue;
    }
    seen.add(resolved);
    unique.push(resolved);
  }
  return unique;
}

function collectSpecCreatorApplyManifest(
  targetPaths: SpecCreatorArtifactPaths,
  stagedPaths: SpecCreatorArtifactPaths,
  stagingRoot: string,
): string[] {
  const seen = new Set<string>();
  const manifest: string[] = [];
  const pushPath = (artifactPath: string): void => {
    const resolved = path.resolve(artifactPath);
    if (seen.has(resolved)) {
      return;
    }
    seen.add(resolved);
    manifest.push(resolved);
  };

  for (
    const targetArtifactPath of listSpecCreatorArtifactPathsForApply(
      targetPaths,
    )
  ) {
    pushPath(targetArtifactPath);
  }
  for (
    const stagedArtifactPath of listSpecCreatorArtifactPathsForApply(
      stagedPaths,
    )
  ) {
    pushPath(mapPathFromStagingWorkspace(stagedArtifactPath, stagingRoot));
  }
  return manifest;
}

export function collectSpecCreatorApplyManifestForTest(
  targetPaths: SpecCreatorArtifactPaths,
  stagedPaths: SpecCreatorArtifactPaths,
  stagingRoot: string,
): string[] {
  return collectSpecCreatorApplyManifest(targetPaths, stagedPaths, stagingRoot);
}

function shouldGenerateDesignMarkdown(
  _context: SpecCreatorContextPayload,
): boolean {
  return true;
}

function collectDeltaSpecPaths(
  changeDir: string,
  changeId: string,
  options: {
    sourceChangeId?: string;
    preserveSourceSpecPaths?: boolean;
  } = {},
): string[] {
  const specsRoot = path.join(changeDir, "specs");
  const discovered: string[] = [];
  if (isDirectory(specsRoot)) {
    walkSpecFiles(specsRoot, discovered);
  }
  discovered.sort((left, right) => left.localeCompare(right));
  if (discovered.length > 0) {
    return discovered;
  }
  if (options.preserveSourceSpecPaths && options.sourceChangeId !== undefined) {
    const sourceChangeDir = resolveSpecCreatorChangeDir(options.sourceChangeId);
    const sourceSpecsRoot = path.join(sourceChangeDir, "specs");
    const sourceSpecPaths: string[] = [];
    if (isDirectory(sourceSpecsRoot)) {
      walkSpecFiles(sourceSpecsRoot, sourceSpecPaths);
    }
    sourceSpecPaths.sort((left, right) => left.localeCompare(right));
    if (sourceSpecPaths.length > 0) {
      return sourceSpecPaths.map((sourceSpecPath) => {
        const relative = path.relative(sourceChangeDir, sourceSpecPath);
        return path.join(changeDir, relative);
      });
    }
  }
  return [path.join(specsRoot, changeId, "spec.md")];
}

function walkSpecFiles(root: string, output: string[]): void {
  for (const entry of Deno.readDirSync(root)) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory) {
      walkSpecFiles(target, output);
      continue;
    }
    if (!entry.isFile) {
      continue;
    }
    if (entry.name !== "spec.md") {
      continue;
    }
    output.push(target);
  }
}

function toStagedArtifactPaths(
  paths: SpecCreatorArtifactPaths,
  stagingRoot: string,
): SpecCreatorArtifactPaths {
  const deltaSpecPaths = paths.deltaSpecPaths.map((item) =>
    mapPathToStagingWorkspace(item, stagingRoot)
  );
  return {
    changeId: paths.changeId,
    changeDir: mapPathToStagingWorkspace(paths.changeDir, stagingRoot),
    proposalPath: mapPathToStagingWorkspace(paths.proposalPath, stagingRoot),
    tasksPath: mapPathToStagingWorkspace(paths.tasksPath, stagingRoot),
    designPath: mapPathToStagingWorkspace(paths.designPath, stagingRoot),
    codeSummaryPath: mapPathToStagingWorkspace(
      paths.codeSummaryPath,
      stagingRoot,
    ),
    deltaSpecPath: mapPathToStagingWorkspace(paths.deltaSpecPath, stagingRoot),
    deltaSpecPaths,
  };
}

function mapPathToStagingWorkspace(
  absolutePath: string,
  stagingRoot: string,
): string {
  const resolved = path.resolve(absolutePath);
  const relative = path.relative(Deno.cwd(), resolved);
  if (
    relative.length === 0 || relative === "." ||
    relative.startsWith("..") || path.isAbsolute(relative)
  ) {
    throw new Error(`staging path must stay in workspace: ${absolutePath}`);
  }
  return path.join(stagingRoot, relative);
}

function mapPathFromStagingWorkspace(
  stagedPath: string,
  stagingRoot: string,
): string {
  const resolved = path.resolve(stagedPath);
  const relative = path.relative(stagingRoot, resolved);
  if (
    relative.length === 0 || relative === "." ||
    relative.startsWith("..") || path.isAbsolute(relative)
  ) {
    throw new Error(`invalid staged artifact path: ${stagedPath}`);
  }
  return path.resolve(Deno.cwd(), relative);
}

function resolveStagedOutputPath(
  outputPath: string,
  stagingRoot: string,
): string {
  const fileName = path.basename(outputPath);
  const outputDir = path.join(stagingRoot, "task_configs", "spec_creator");
  Deno.mkdirSync(outputDir, { recursive: true });
  return path.join(outputDir, fileName);
}

function prepareSpecCreatorStagingWorkspace(stagingRoot: string): void {
  copyDirectoryTreeIfExists(
    path.resolve("openspec"),
    path.join(stagingRoot, "openspec"),
  );
  copyDirectoryTreeIfExists(
    path.resolve("task_configs"),
    path.join(stagingRoot, "task_configs"),
  );
}

function copyDirectoryTreeIfExists(source: string, destination: string): void {
  if (!isDirectory(source)) {
    return;
  }
  Deno.mkdirSync(destination, { recursive: true });
  for (const entry of Deno.readDirSync(source)) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (entry.isDirectory) {
      copyDirectoryTreeIfExists(sourcePath, destinationPath);
      continue;
    }
    if (entry.isFile) {
      Deno.mkdirSync(path.dirname(destinationPath), { recursive: true });
      Deno.copyFileSync(sourcePath, destinationPath);
    }
  }
}

function runWithCurrentDirectory<T>(dirPath: string, fn: () => T): T {
  const original = Deno.cwd();
  Deno.chdir(dirPath);
  try {
    return fn();
  } finally {
    Deno.chdir(original);
  }
}

function runStagedStrictValidate(
  changeId: string,
  workspaceRoot: string,
): void {
  const validateResult = new Deno.Command("openspec", {
    args: ["validate", changeId, "--strict"],
    stdout: "piped",
    stderr: "piped",
    cwd: workspaceRoot,
  }).outputSync();
  if (validateResult.code === 0) {
    return;
  }
  const stderr = new TextDecoder().decode(validateResult.stderr).trim();
  const stdout = new TextDecoder().decode(validateResult.stdout).trim();
  const detail = stderr || stdout || "openspec validate failed";
  throw new Error(`spec-creator staged validate failed: ${detail}`);
}

function applyStagedArtifactsAtomically(
  options: {
    stagingRoot: string;
    stagedPaths: SpecCreatorArtifactPaths;
    targetPaths: SpecCreatorArtifactPaths;
    stagedOutputPath: string;
    outputPath: string;
    artifactSnapshotBeforeWorkflow: ArtifactSnapshot;
    outputSnapshotBeforeWorkflow: string | null;
  },
): void {
  const {
    stagingRoot,
    stagedPaths,
    stagedOutputPath,
    outputPath,
    artifactSnapshotBeforeWorkflow,
    outputSnapshotBeforeWorkflow,
    targetPaths,
  } = options;
  const applyManifest = collectSpecCreatorApplyManifest(
    targetPaths,
    stagedPaths,
    stagingRoot,
  );

  try {
    for (const targetArtifactPath of applyManifest) {
      const stagedArtifactPath = mapPathToStagingWorkspace(
        targetArtifactPath,
        stagingRoot,
      );
      const stagedContent = readArtifactContentOrNull(stagedArtifactPath);
      restoreSingleFileContent(targetArtifactPath, stagedContent);
    }
    const stagedOutputContent = readArtifactContentOrNull(stagedOutputPath);
    restoreSingleFileContent(outputPath, stagedOutputContent);
  } catch (error) {
    restoreArtifactContents(applyManifest, artifactSnapshotBeforeWorkflow);
    restoreSingleFileContent(outputPath, outputSnapshotBeforeWorkflow);
    throw error;
  }
}

type ArtifactSnapshot = Record<string, string | null>;

function snapshotArtifactContents(
  paths: SpecCreatorArtifactPaths,
): ArtifactSnapshot {
  const snapshot: ArtifactSnapshot = {};
  for (const artifactPath of listSpecCreatorArtifactPaths(paths)) {
    snapshot[artifactPath] = readArtifactContentOrNull(artifactPath);
  }
  return snapshot;
}

function snapshotArtifactContentsForQualityRetry(
  paths: SpecCreatorArtifactPaths,
): ArtifactSnapshot {
  const artifactPaths = listSpecCreatorArtifactPathsForApply(paths).map((
    artifactPath,
  ) => path.resolve(artifactPath));
  const snapshot: ArtifactSnapshot = {};
  for (const artifactPath of artifactPaths) {
    snapshot[artifactPath] = readArtifactContentOrNull(artifactPath);
  }
  return snapshot;
}

function readArtifactContentOrNull(artifactPath: string): string | null {
  try {
    return Deno.readTextFileSync(artifactPath);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return null;
    }
    throw error;
  }
}

function restoreArtifactContents(
  artifactPaths: string[],
  snapshot: ArtifactSnapshot,
): void {
  for (const artifactPath of artifactPaths) {
    restoreSingleFileContent(artifactPath, snapshot[artifactPath] ?? null);
  }
}

function assertQualityRetryEditedTargetOnly(
  snapshotBeforeRun: ArtifactSnapshot,
  targetFile: string,
): void {
  const target = path.resolve(targetFile);
  const changedArtifactPaths: string[] = [];
  for (
    const [artifactPath, beforeContent] of Object.entries(snapshotBeforeRun)
  ) {
    const afterContent = readArtifactContentOrNull(artifactPath);
    if (afterContent !== beforeContent) {
      changedArtifactPaths.push(artifactPath);
    }
  }
  const nonTargetChanges = changedArtifactPaths.filter((artifactPath) =>
    path.resolve(artifactPath) !== target
  );
  if (nonTargetChanges.length === 0) {
    return;
  }
  throw new Error(
    `spec-creator quality retry target mismatch: only ${
      toRelativePath(target)
    } may change (changed: ${
      nonTargetChanges.map((artifactPath) => toRelativePath(artifactPath)).join(
        ", ",
      )
    })`,
  );
}

function restoreSingleFileContent(
  filePath: string,
  snapshotValue: string | null,
): void {
  if (snapshotValue === null) {
    try {
      Deno.removeSync(filePath);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
    }
    return;
  }
  Deno.mkdirSync(path.dirname(filePath), { recursive: true });
  Deno.writeTextFileSync(filePath, snapshotValue);
}

function runSpecCreatorPostAuditGate(
  changeId: string,
  io: CliIO,
  workspaceRoot: string = Deno.cwd(),
): void {
  io.stdout(
    `[spec-creator] post-audit revalidate: internal compile gate (compile-openspec equivalent) --change-id ${changeId}\n`,
  );
  compileChangeToConfig(changeId, {
    openspecRoot: path.join(workspaceRoot, "openspec"),
    overridesRoot: path.join(workspaceRoot, "task_configs", "overrides"),
  });

  io.stdout(
    `[spec-creator] post-audit revalidate: openspec validate ${changeId} --strict\n`,
  );
  const validateResult = new Deno.Command("openspec", {
    args: ["validate", changeId, "--strict"],
    stdout: "piped",
    stderr: "piped",
    cwd: workspaceRoot,
  }).outputSync();
  if (validateResult.code === 0) {
    return;
  }
  const stderr = new TextDecoder().decode(validateResult.stderr).trim();
  const stdout = new TextDecoder().decode(validateResult.stdout).trim();
  const detail = stderr || stdout || "openspec validate failed";
  throw new Error(`spec-creator post-audit gate failed: ${detail}`);
}

function assertNoForbiddenSpecCreatorCommands(
  paths: SpecCreatorArtifactPaths,
  phase: "post-generate" | "post-run",
): void {
  const artifactPaths = listSpecCreatorArtifactPaths(paths);
  const violations: string[] = [];

  for (const artifactPath of artifactPaths) {
    let content = "";
    try {
      content = Deno.readTextFileSync(artifactPath);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(
        `spec-creator ${phase} guard failed: could not read ${artifactPath}: ${reason}`,
      );
    }
    const lines = content.split(/\r?\n/u);
    for (const [index, line] of lines.entries()) {
      for (const rule of SPEC_CREATOR_FORBIDDEN_COMMAND_PATTERNS) {
        if (!rule.pattern.test(line)) {
          continue;
        }
        if (isForbiddenCommandExemptContext(line)) {
          continue;
        }
        const relativePath = path.relative(Deno.cwd(), artifactPath);
        const labelPath = relativePath.length > 0 ? relativePath : artifactPath;
        violations.push(`${labelPath}:${index + 1}:${rule.label}`);
      }
    }
  }

  if (violations.length > 0) {
    throw new Error(
      `spec-creator ${phase} guard failed: forbidden OpenSpec command detected (${
        violations.join("; ")
      })`,
    );
  }
}

function isForbiddenCommandExemptContext(line: string): boolean {
  for (
    const pattern of SPEC_CREATOR_FORBIDDEN_COMMAND_EXEMPT_CONTEXT_PATTERNS
  ) {
    if (pattern.test(line)) {
      return true;
    }
  }
  return false;
}

function formatSpecCreatorQualityIssues(
  violations: SpecCreatorQualityViolation[],
): string {
  const lines = violations.map((violation) =>
    `${
      toRelativePath(violation.file)
    }:${violation.line}:${violation.rule_id}:${violation.message}`
  );
  const joined = lines.join("\n");
  if (joined.length <= 4000) {
    return joined;
  }
  return `${joined.slice(0, 3960)}\n...`;
}

interface QualityTargetSelection {
  targetFile: string | null;
  targetFiles: string[];
  targetIndex: number;
  targetTotal: number;
}

function selectQualityTargetFile(
  violations: SpecCreatorQualityViolation[],
  retryCountsByFile: Map<string, number>,
  maxQualityRetries: number,
): QualityTargetSelection {
  const targetFiles: string[] = [];
  const seen = new Set<string>();
  for (const violation of violations) {
    if (
      typeof violation.file !== "string" || violation.file.trim().length === 0
    ) {
      continue;
    }
    const resolved = path.resolve(violation.file);
    if (seen.has(resolved)) {
      continue;
    }
    seen.add(resolved);
    targetFiles.push(resolved);
  }
  if (targetFiles.length === 0) {
    return {
      targetFile: null,
      targetFiles,
      targetIndex: 0,
      targetTotal: 0,
    };
  }

  const eligibleTargets = targetFiles.filter((filePath) =>
    (retryCountsByFile.get(filePath) ?? 0) <= maxQualityRetries
  );
  if (eligibleTargets.length === 0) {
    return {
      targetFile: null,
      targetFiles,
      targetIndex: 0,
      targetTotal: targetFiles.length,
    };
  }

  let selectedTarget = eligibleTargets[0];
  let selectedRetryCount = retryCountsByFile.get(selectedTarget) ?? 0;
  for (const filePath of eligibleTargets.slice(1)) {
    const retryCount = retryCountsByFile.get(filePath) ?? 0;
    if (retryCount < selectedRetryCount) {
      selectedTarget = filePath;
      selectedRetryCount = retryCount;
    }
  }

  return {
    targetFile: selectedTarget,
    targetFiles,
    targetIndex: targetFiles.indexOf(selectedTarget) + 1,
    targetTotal: targetFiles.length,
  };
}

function toRelativePath(filePath: string): string {
  const relative = path.relative(Deno.cwd(), filePath);
  return relative.length > 0 ? relative : filePath;
}

function writeTaskConfigFile(
  taskConfig: SpecCreatorTaskConfig,
  outputPath: string,
): void {
  Deno.mkdirSync(path.dirname(outputPath), { recursive: true });
  Deno.writeTextFileSync(
    outputPath,
    `${JSON.stringify(taskConfig, null, 2)}\n`,
  );
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
    related_paths: string[];
    output_phase_assignments?: string | null;
  }>,
  lang: "ja" | "en",
  options: {
    preservedOutputPhaseAssignments: Map<string, string>;
  },
): string {
  const lines: string[] = [];
  for (const task of tasks) {
    const dependsOn = task.depends_on.length > 0
      ? task.depends_on.join(", ")
      : (lang === "ja" ? "なし" : "none");
    const targetPaths = task.target_paths.length > 0
      ? task.target_paths.join(", ")
      : "*";
    const relatedPaths = task.related_paths.length > 0
      ? task.related_paths.join(", ")
      : (lang === "ja" ? "なし" : "none");
    const description = compactTaskDescription(task.description);
    const phaseAssignments = resolveTaskOutputPhaseAssignments(
      task,
      options.preservedOutputPhaseAssignments,
    );
    const personaPolicy = JSON.stringify({
      phase_order: phaseAssignments.phaseOrder,
    });

    lines.push(`- [ ] ${task.id} ${task.title}`);
    if (lang === "ja") {
      lines.push(`  - 依存: ${dependsOn}`);
      lines.push(`  - 対象: ${targetPaths}`);
      lines.push(`  - 関連許可: ${relatedPaths}`);
      lines.push(`  - フェーズ担当: ${phaseAssignments.text}`);
      lines.push(`  - persona_policy: ${personaPolicy}`);
      lines.push(`  - 成果物: ${description}`);
    } else {
      lines.push(`  - Depends on: ${dependsOn}`);
      lines.push(`  - Target paths: ${targetPaths}`);
      lines.push(`  - Related paths: ${relatedPaths}`);
      lines.push(`  - phase assignments: ${phaseAssignments.text}`);
      lines.push(`  - persona_policy: ${personaPolicy}`);
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

const DEFAULT_TASK_OUTPUT_PHASE_ASSIGNMENTS =
  "implement=implementer; review=code-reviewer";

const ALLOWED_OUTPUT_PHASES = new Set([
  "implement",
  "review",
  "spec_check",
  "test",
]);

const ALLOWED_OUTPUT_EXECUTORS = new Set([
  "implementer",
  "code-reviewer",
  "spec-checker",
  "test-owner",
]);

function collectExistingTaskOutputPhaseAssignments(
  tasksPath: string,
): Map<string, string> {
  const text = readArtifactContentOrNull(tasksPath);
  if (text === null || text.trim().length === 0) {
    return new Map<string, string>();
  }

  const lines = text.replaceAll(/\r\n?/gu, "\n").split("\n");
  const taskHeaderPattern = /^\s*-\s*\[[ xX]\]\s*(\S+)/u;
  const phaseAssignmentsPattern =
    /^\s*-\s*(?:フェーズ担当|phase assignments)\s*:\s*(.+?)\s*$/u;
  const assignmentsByTask = new Map<string, string>();

  let currentTaskId: string | null = null;
  for (const line of lines) {
    if (/^##\s+/u.test(line)) {
      currentTaskId = null;
    }

    const taskHeaderMatch = taskHeaderPattern.exec(line);
    if (taskHeaderMatch) {
      currentTaskId = taskHeaderMatch[1];
      continue;
    }
    if (currentTaskId === null) {
      continue;
    }

    const phaseAssignmentsMatch = phaseAssignmentsPattern.exec(line);
    if (!phaseAssignmentsMatch) {
      continue;
    }

    const parsed = parseOutputPhaseAssignments(
      phaseAssignmentsMatch[1],
      `${toRelativePath(tasksPath)} task=${currentTaskId}`,
    );
    assignmentsByTask.set(currentTaskId, parsed.text);
  }

  return assignmentsByTask;
}

function resolveTaskOutputPhaseAssignments(
  task: {
    id: string;
    output_phase_assignments?: string | null;
  },
  preservedOutputPhaseAssignments: Map<string, string>,
): {
  text: string;
  phaseOrder: string[];
} {
  const preserved = preservedOutputPhaseAssignments.get(task.id);
  const configured = normalizeOptionalOutputPhaseAssignments(
    task.output_phase_assignments,
  );
  const source = preserved ?? configured ??
    DEFAULT_TASK_OUTPUT_PHASE_ASSIGNMENTS;
  return parseOutputPhaseAssignments(source, `task ${task.id}`);
}

function normalizeOptionalOutputPhaseAssignments(
  raw: string | null | undefined,
): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  const normalized = raw.trim();
  return normalized.length > 0 ? normalized : null;
}

function parseOutputPhaseAssignments(
  raw: string,
  sourceLabel: string,
): {
  text: string;
  phaseOrder: string[];
} {
  const chunks = raw.split(/[;|]/u).map((chunk) => chunk.trim()).filter((
    chunk,
  ) => chunk.length > 0);
  if (chunks.length === 0) {
    throw new Error(`${sourceLabel}: phase assignments must not be empty`);
  }

  const normalizedChunks: string[] = [];
  const phaseOrder: string[] = [];
  const seenPhases = new Set<string>();

  for (const chunk of chunks) {
    const matched = /^(?<phase>[^=:]+)\s*(?:=|:)\s*(?<executor>.+)$/u.exec(
      chunk,
    );
    if (!matched?.groups) {
      throw new Error(
        `${sourceLabel}: invalid phase assignment '${chunk}'`,
      );
    }
    const phase = normalizeOutputPhase(matched.groups.phase);
    if (!ALLOWED_OUTPUT_PHASES.has(phase)) {
      throw new Error(
        `${sourceLabel}: unknown output phase '${phase}'`,
      );
    }
    if (seenPhases.has(phase)) {
      throw new Error(
        `${sourceLabel}: duplicate output phase '${phase}'`,
      );
    }

    const executor = matched.groups.executor.trim().toLowerCase();
    if (!ALLOWED_OUTPUT_EXECUTORS.has(executor)) {
      throw new Error(
        `${sourceLabel}: unknown output executor '${executor}'`,
      );
    }

    seenPhases.add(phase);
    phaseOrder.push(phase);
    normalizedChunks.push(`${phase}=${executor}`);
  }

  if (!seenPhases.has("implement")) {
    throw new Error(
      `${sourceLabel}: phase assignments must include implement`,
    );
  }

  return {
    text: normalizedChunks.join("; "),
    phaseOrder,
  };
}

function normalizeOutputPhase(rawPhase: string): string {
  return rawPhase.trim().toLowerCase().replaceAll("-", "_");
}

function buildHumanNotesMarkdownForSpecCreator(
  specContext: {
    requirements_text: string;
  },
  lang: "ja" | "en",
): string {
  const quotedRequirements = toBlockquoteLinesForHumanNotes(
    specContext.requirements_text,
  );
  if (lang === "ja") {
    return [
      "- 要件メモ:",
      ...quotedRequirements,
    ].join("\n");
  }
  return [
    "- Requirement memo:",
    ...quotedRequirements,
  ].join("\n");
}

function toBlockquoteLinesForHumanNotes(raw: string): string[] {
  const normalized = raw.replaceAll(/\r\n?/gu, "\n").trim();
  if (normalized.length === 0) {
    return ["  > (none)"];
  }
  return normalized.split("\n").map((line) => `  > ${line}`);
}

function writeDesignMarkdownStub(options: {
  designPath: string;
  lang: "ja" | "en";
}): void {
  const body = options.lang === "ja"
    ? [
      "# Design",
      "",
      "## 目的",
      "- この change の設計判断とトレードオフを記録する。",
      "",
    ].join("\n")
    : [
      "# Design",
      "",
      "## Purpose",
      "- Document design decisions and trade-offs for this change.",
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
    personaExecutionSandboxes: collectPersonaExecutionSandboxes(
      loaded.personas,
    ),
    openspecChangeId: loaded.sourceChangeId ?? args.openspecChange,
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
  if (args.openspecChange !== null) {
    const completedTaskIds = store.listTasks()
      .filter((task) => task.status === "completed")
      .map((task) => task.id);
    const syncedCount = updateTasksMarkdownCheckboxes(
      path.join(args.openspecRoot, "changes", args.openspecChange, "tasks.md"),
      completedTaskIds,
    );
    io.stdout(`[run] synced_tasks_md=${syncedCount}\n`);
  }
  const runResult = loaded.sourceChangeId === null
    ? result
    : { ...result, openspec_change_id: loaded.sourceChangeId };
  io.stdout(`${JSON.stringify(runResult, null, 2)}\n`);
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
      const loaded = loadTasksFromConfigPath(writtenPath, args.personaDir);
      return {
        ...loaded,
        sourceChangeId: loaded.sourceChangeId ?? args.openspecChange,
      };
    } finally {
      if (!args.saveCompiled) {
        Deno.removeSync(writtenPath);
      }
    }
  }

  return loadTasksFromConfigPath(
    args.config ?? "examples/sample_tasks.json",
    args.personaDir,
  );
}

function loadTasksFromConfigPath(
  configPath: string,
  personaDir: string | null,
): LoadedTasks {
  const loaded = JSON.parse(Deno.readTextFileSync(configPath)) as unknown;
  if (!isRecord(loaded)) {
    throw new Error(`task config must be an object (${configPath})`);
  }
  return loadTasksPayload(loaded, configPath, personaDir);
}

function loadTasksPayload(
  raw: Record<string, unknown>,
  sourceLabel: string,
  personaDir: string | null,
): LoadedTasks {
  const personas = resolveRunPersonas(raw, sourceLabel, personaDir);
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
      related_paths: asStringArray(taskRaw.related_paths),
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
      revision_count: asOptionalNonNegativeInteger(
        taskRaw.revision_count,
        `tasks[${index}].revision_count`,
        sourceLabel,
      ),
      max_revision_cycles: asOptionalNonNegativeInteger(
        taskRaw.max_revision_cycles,
        `tasks[${index}].max_revision_cycles`,
        sourceLabel,
      ),
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
    Object.prototype.hasOwnProperty.call(raw, "personas") || personaDir !== null
      ? personas
      : null;

  return {
    tasks,
    teammates,
    personas: personasForRuntime,
    personaDefaults,
    sourceChangeId: readSourceChangeId(raw),
  };
}

function resolveRunPersonas(
  raw: Record<string, unknown>,
  sourceLabel: string,
  personaDir: string | null,
): PersonaDefinition[] {
  try {
    return loadPersonasFromPayload(raw, sourceLabel, personaDir);
  } catch (error) {
    if (personaDir === null) {
      throw error;
    }
    if (error instanceof Error) {
      throw new Error(`argument --persona-dir: ${error.message}`);
    }
    throw error;
  }
}

function readSourceChangeId(raw: Record<string, unknown>): string | null {
  const metaRaw = raw.meta;
  if (!isRecord(metaRaw)) {
    return null;
  }
  const value = metaRaw.source_change_id;
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
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

    const configRelatedPaths = normalizeStringList(configTask.related_paths);
    const stateRelatedPaths = normalizeStringList(stateTask.related_paths);
    if (
      JSON.stringify(configRelatedPaths) !== JSON.stringify(stateRelatedPaths)
    ) {
      mismatches.push(
        `${taskId}:related_paths(config=${
          JSON.stringify(configRelatedPaths)
        }, state=${JSON.stringify(stateRelatedPaths)})`,
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

function findRuntimeFrom(startDir: string): string | null {
  let current = path.resolve(startDir);
  while (true) {
    const candidate = path.join(
      current,
      "src",
      "infrastructure",
      "wrapper",
      "runtime.ts",
    );
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

function isDirectory(dirPath: string): boolean {
  try {
    return Deno.statSync(dirPath).isDirectory;
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

function asOptionalNonNegativeInteger(
  raw: unknown,
  fieldName: string,
  sourceLabel: string,
): number | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (
    typeof raw !== "number" || !Number.isFinite(raw) ||
    !Number.isInteger(raw) ||
    raw < 0
  ) {
    throw new Error(
      `${fieldName} must be a non-negative integer (${sourceLabel})`,
    );
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

function resolveWrapperRuntime(
  rawRuntime: string = getEnv("CODEX_WRAPPER_RUNTIME", DEFAULT_WRAPPER_RUNTIME),
): "ts" {
  const normalized = String(rawRuntime).trim().toLowerCase();
  if (!normalized || normalized === "ts") {
    return "ts";
  }
  throw new Error(
    `unsupported CODEX_WRAPPER_RUNTIME=${rawRuntime}. supported values: ts`,
  );
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
    if (args[0] === "-h" || args[0] === "--help") {
      io.stdout(`${GLOBAL_USAGE}\n`);
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

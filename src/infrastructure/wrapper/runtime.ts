import {
  EXIT_CODE_INVALID_INPUT,
  EXIT_CODE_RESULT_BLOCK_EMPTY,
  WrapperHelperError,
  buildPrompt as helperBuildPrompt,
  extractResultToFile,
  verifyDotenvSnapshotUnchanged,
  writeDotenvSnapshot,
} from "./helper.ts";
import { fileURLToPath } from "node:url";

const STDIN_EMPTY_MESSAGE = "empty stdin payload";
const DEFAULT_TARGET_PROJECT_DIR = fileURLToPath(new URL("../../../", import.meta.url));
const DEFAULT_PROMPT_LOG_PATH = "/tmp/codex_wrapper_last_prompt.txt";
const DEFAULT_ERROR_LOG_PATH = "/tmp/codex_wrapper_last_error.log";

type RuntimePayload = Record<string, unknown>;
type EnvReader = (name: string) => string | undefined;

type RuntimeEnv = {
  targetProjectDir: string;
  codexBin: string;
  codexModel: string;
  codexReasoningEffort: string;
  codexProfile: string;
  codexSandbox: string;
  codexFullAuto: string;
  codexSkipGitRepoCheck: string;
  codexStreamLogs: string;
  codexStreamView: string;
  codexStreamExecKeepLines: string;
  codexDenyDotenv: string;
  codexPromptLogPath: string;
  codexErrorLogPath: string;
  codexWrapperDebug: string;
  codeWrapperLang: string;
  codeRustBacktrace: string;
};

// deno-lint-ignore no-control-regex -- intentional ANSI escape matcher
const ANSI_SGR_PATTERN = /\x1b\[[0-9;]*[A-Za-z]/gu;
const EMPTY_STRING = "";
const STREAM_VIEW_ASSISTANT = "assistant";
const STREAM_VIEW_THINKING = "thinking";
const STREAM_VIEW_ALL_COMPACT = "all_compact";
const STREAM_VIEW_ALL = "all";
type StreamView = "assistant" | "thinking" | "all_compact" | "all";
type StreamSectionMode = "default" | "thinking" | "codex" | "user" | "exec";
type StreamRenderer = {
  render(line: string): string[];
  flush(): string[];
};

function normalizeStreamLine(rawLine: string): string {
  return rawLine
    .replace(ANSI_SGR_PATTERN, EMPTY_STRING)
    .replaceAll("\r", EMPTY_STRING)
    .trim()
    .toLowerCase();
}

function normalizeText(value: string): string {
  return value.replaceAll("\r\n", "\n");
}

function isCodexDiffStart(loweredLine: string): boolean {
  return loweredLine.startsWith("file update:") || loweredLine.startsWith("diff --git ");
}

function isCodexDiffEnd(loweredLine: string): boolean {
  return loweredLine === "tokens used" ||
    loweredLine.startsWith("result:") ||
    loweredLine.startsWith("summary:") ||
    loweredLine.startsWith("changed_files:") ||
    loweredLine.startsWith("checks:");
}

function renderAssistantView(
  rawLine: string,
  state: { mode: StreamSectionMode; includeUser: boolean },
): string[] {
  const loweredLine = normalizeStreamLine(rawLine);
  if (loweredLine === "thinking") {
    state.mode = "thinking";
    return [rawLine];
  }
  if (loweredLine === "codex") {
    state.mode = "codex";
    return [rawLine];
  }
  if (loweredLine === "user") {
    state.mode = "user";
    return state.includeUser ? [rawLine] : [];
  }
  if (loweredLine.startsWith("exec")) {
    state.mode = "exec";
    return [];
  }

  if (state.mode === "exec") {
    return [];
  }
  if (state.mode === "user" && !state.includeUser) {
    return [];
  }
  return [rawLine];
}

function renderThinkingView(
  rawLine: string,
  state: { mode: StreamSectionMode; includeUser: boolean },
): string[] {
  const includeUser = false;
  state.includeUser = includeUser;
  return renderAssistantView(rawLine, state);
}

function flushAllCompactLine(state: {
  mode: StreamSectionMode;
  execKeepLines: number;
  execKeptLines: number;
  execOmittedLines: number;
  inCodexDiff: boolean;
  codexDiffLines: number;
}): string[] {
  const output: string[] = [];
  if (state.mode === "exec" && state.execOmittedLines > 0) {
    output.push(`[all_compact] exec output omitted lines=${state.execOmittedLines}`);
  }
  if (state.inCodexDiff) {
    output.push(`[all_compact] codex diff omitted lines=${state.codexDiffLines}`);
  }
  state.execKeptLines = 0;
  state.execOmittedLines = 0;
  state.inCodexDiff = false;
  state.codexDiffLines = 0;
  return output;
}

function renderAllCompactView(
  rawLine: string,
  state: {
    mode: StreamSectionMode;
    inCodexDiff: boolean;
    codexDiffLines: number;
    execKeepLines: number;
    execKeptLines: number;
    execOmittedLines: number;
  },
): string[] {
  const output: string[] = [];
  const loweredLine = normalizeStreamLine(rawLine);
  const transitionMode = (nextMode: StreamSectionMode) => {
    output.push(...flushAllCompactLine(state));
    state.mode = nextMode;
    output.push(rawLine);
  };

  if (loweredLine === "thinking") {
    transitionMode("thinking");
    return output;
  }
  if (loweredLine === "codex") {
    transitionMode("codex");
    return output;
  }
  if (loweredLine === "user") {
    transitionMode("user");
    return output;
  }
  if (loweredLine.startsWith("exec")) {
    transitionMode("exec");
    state.execKeptLines = 0;
    state.execOmittedLines = 0;
    return output;
  }

  if (state.mode === "exec") {
    if (state.execKeptLines < state.execKeepLines) {
      state.execKeptLines += 1;
      return [rawLine];
    }
    state.execOmittedLines += 1;
    return [];
  }

  if (state.mode === "codex") {
    if (!state.inCodexDiff && isCodexDiffStart(loweredLine)) {
      state.inCodexDiff = true;
      state.codexDiffLines = 1;
      return [];
    }

    if (state.inCodexDiff) {
      if (isCodexDiffEnd(loweredLine)) {
        output.push(`[all_compact] codex diff omitted lines=${state.codexDiffLines}`);
        state.inCodexDiff = false;
      } else {
        state.codexDiffLines += 1;
        return [];
      }
    }
  }

  output.push(rawLine);
  return output;
}

function renderAllView(rawLine: string): string[] {
  return [rawLine];
}

function parseStreamExecKeepLines(raw: string): number {
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildStreamRenderer(
  streamView: string,
  execKeepLinesRaw: string,
): StreamRenderer {
  const normalized = streamView.trim().toLowerCase();
  if (normalized === STREAM_VIEW_ASSISTANT) {
    const state = { mode: "default" as StreamSectionMode, includeUser: true };
    return {
      render(rawLine: string): string[] {
        return renderAssistantView(rawLine, state);
      },
      flush(): string[] {
        return [];
      },
    };
  }

  if (normalized === STREAM_VIEW_THINKING) {
    const state = { mode: "default" as StreamSectionMode, includeUser: false };
    return {
      render(rawLine: string): string[] {
        return renderThinkingView(rawLine, state);
      },
      flush(): string[] {
        return [];
      },
    };
  }

  if (normalized === STREAM_VIEW_ALL_COMPACT) {
    const state = {
      mode: "default" as StreamSectionMode,
      inCodexDiff: false,
      codexDiffLines: 0,
      execKeepLines: parseStreamExecKeepLines(execKeepLinesRaw),
      execKeptLines: 0,
      execOmittedLines: 0,
    };
    return {
      render(rawLine: string): string[] {
        return renderAllCompactView(rawLine, state);
      },
      flush(): string[] {
        return flushAllCompactLine(state);
      },
    };
  }

  return {
    render(rawLine: string): string[] {
      return renderAllView(rawLine);
    },
    flush(): string[] {
      return [];
    },
  };
}

async function drainStreamForRenderer(
  stream: ReadableStream<Uint8Array> | null,
  renderer: StreamRenderer,
  emitOutputLine: (line: string) => void,
  rawOutput: string[],
): Promise<void> {
  if (stream === null) {
    return;
  }

  const decoder = new TextDecoder();
  const reader = stream.getReader();
  let carry = EMPTY_STRING;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      if (value === null) {
        continue;
      }
      const chunk = decoder.decode(value, { stream: true });
      if (chunk.length > 0) {
        rawOutput.push(chunk);
      }
      const split = (carry + chunk).split(/\r?\n/gu);
      carry = split.pop() ?? EMPTY_STRING;
      for (const line of split) {
        for (const outputLine of renderer.render(line)) {
          emitOutputLine(outputLine);
        }
      }
    }
    const tail = decoder.decode();
    if (tail.length > 0) {
      rawOutput.push(tail);
      carry += tail;
    }
    if (carry.length > 0) {
      for (const outputLine of renderer.render(carry)) {
        emitOutputLine(outputLine);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function runCodexCommandWithStream(
  command: string[],
  prompt: string,
  env: RuntimeEnv,
): Promise<{ exitCode: number; streamLogText: string }> {
  const streamRenderer = buildStreamRenderer(
    env.codexStreamView,
    env.codexStreamExecKeepLines,
  );
  const commandProcess = new Deno.Command(command[0], {
    args: command.slice(1),
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();

  const stdinWriter = commandProcess.stdin.getWriter();
  await stdinWriter.write(new TextEncoder().encode(prompt));
  await stdinWriter.close();

  const outputLog: string[] = [];
  const encoder = new TextEncoder();
  const emitOutputLine = env.codexStreamLogs === "1"
    ? (line: string) => {
      Deno.stderr.writeSync(encoder.encode(`${line}\n`));
    }
    : () => {};

  let streamError: unknown = null;
  let statusCode = 1;
  try {
    await Promise.all([
      drainStreamForRenderer(
        commandProcess.stdout,
        streamRenderer,
        emitOutputLine,
        outputLog,
      ),
      drainStreamForRenderer(
        commandProcess.stderr,
        streamRenderer,
        emitOutputLine,
        outputLog,
      ),
    ]);
  } catch (error) {
    streamError = error;
  } finally {
    const status = await commandProcess.status;
    statusCode = status.code;
    for (const outputLine of streamRenderer.flush()) {
      emitOutputLine(outputLine);
    }
  }

  if (streamError !== null) {
    throw streamError;
  }
  return { exitCode: statusCode, streamLogText: outputLog.join(EMPTY_STRING) };
}

function removeTempOutput(outputPath: string): void {
  try {
    Deno.removeSync(outputPath);
  } catch (_error) {
    // ignore cleanup errors
  }
}

function isRecord(value: unknown): value is RuntimePayload {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
}

function emitStderrCategory(category: string, ...lines: string[]): void {
  console.error(`# [${category}]`);
  for (const line of lines) {
    console.error(line);
  }
}

function tailLines(raw: string, count: number): string[] {
  const lines = normalizeText(raw).split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines.slice(Math.max(0, lines.length - count));
}

function streamPreview(raw: string): string {
  return tailLines(raw, 60)
    .join(" ")
    .replaceAll(/\s+/gu, " ")
    .trim()
    .slice(0, 1200);
}

function outputPreview(raw: string): string {
  return raw.replaceAll("\n", " ").slice(0, 400);
}

function shellQuote(raw: string): string {
  if (/^[A-Za-z0-9_\-./]+$/u.test(raw)) {
    return raw;
  }
  return `'${raw.replace(/'/gu, `'"'"'`)}'`;
}

function renderCommandForDebug(command: string[]): string {
  return command.map((part) => shellQuote(part)).join(" ");
}

function normalizeTaskFromLegacyPayload(payload: RuntimePayload): RuntimePayload {
  const task: RuntimePayload = {};

  if ("task_id" in payload) {
    task.id = payload.task_id;
  } else if ("id" in payload) {
    task.id = payload.id;
  }

  if ("title" in payload) {
    task.title = payload.title;
  }

  if ("description" in payload) {
    task.description = payload.description;
  }

  if ("target_paths" in payload) {
    task.target_paths = payload.target_paths;
  }

  if ("depends_on" in payload) {
    task.depends_on = payload.depends_on;
  }

  if ("requires_plan" in payload) {
    task.requires_plan = payload.requires_plan;
  }

  if ("progress_log" in payload) {
    task.progress_log = payload.progress_log;
  }

  if ("persona_policy" in payload) {
    task.persona_policy = payload.persona_policy;
  }

  if ("current_phase" in payload) {
    task.current_phase = payload.current_phase;
  }

  if ("current_phase_index" in payload) {
    task.current_phase_index = payload.current_phase_index;
  }

  if (Object.keys(task).length === 0) {
    return task;
  }

  return task;
}

function resolveEnv(name: string, fallback: string, readEnv: EnvReader): string {
  const value = readEnv(name);
  if (value === "" || value === undefined) {
    return fallback;
  }
  return value;
}

function resolveRuntimeEnvironment(readEnv: EnvReader): RuntimeEnv {
  return {
    targetProjectDir: resolveEnv(
      "TARGET_PROJECT_DIR",
      DEFAULT_TARGET_PROJECT_DIR,
      readEnv,
    ),
    codexBin: resolveEnv("CODEX_BIN", "codex", readEnv),
    codexModel: resolveEnv("CODEX_MODEL", "", readEnv),
    codexReasoningEffort: resolveEnv("CODEX_REASONING_EFFORT", "", readEnv),
    codexProfile: resolveEnv("CODEX_PROFILE", "", readEnv),
    codexSandbox: resolveEnv("CODEX_SANDBOX", "workspace-write", readEnv),
    codexFullAuto: resolveEnv("CODEX_FULL_AUTO", "0", readEnv),
    codexSkipGitRepoCheck: resolveEnv("CODEX_SKIP_GIT_REPO_CHECK", "1", readEnv),
    codexStreamLogs: resolveEnv("CODEX_STREAM_LOGS", "1", readEnv),
    codexStreamView: resolveEnv("CODEX_STREAM_VIEW", STREAM_VIEW_ALL, readEnv),
    codexStreamExecKeepLines: resolveEnv("CODEX_STREAM_EXEC_KEEP_LINES", "3", readEnv),
    codexDenyDotenv: resolveEnv("CODEX_DENY_DOTENV", "1", readEnv),
    codexPromptLogPath: resolveEnv(
      "CODEX_PROMPT_LOG_PATH",
      DEFAULT_PROMPT_LOG_PATH,
      readEnv,
    ),
    codexErrorLogPath: resolveEnv(
      "CODEX_ERROR_LOG_PATH",
      DEFAULT_ERROR_LOG_PATH,
      readEnv,
    ),
    codexWrapperDebug: resolveEnv("CODEX_WRAPPER_DEBUG", "0", readEnv),
    codeWrapperLang: resolveEnv("CODEX_WRAPPER_LANG", "en_US.UTF-8", readEnv),
    codeRustBacktrace: resolveEnv("CODEX_RUST_BACKTRACE", "0", readEnv),
  };
}

export function buildCodexCommand(outputPath: string, readEnv: EnvReader = Deno.env.get): string[] {
  const env = resolveRuntimeEnvironment(readEnv);

  const command = [
    "env",
    `LANG=${env.codeWrapperLang}`,
    `LC_ALL=${env.codeWrapperLang}`,
    `RUST_BACKTRACE=${env.codeRustBacktrace}`,
    env.codexBin,
    "exec",
    "-C",
    env.targetProjectDir,
    "--output-last-message",
    outputPath,
  ];

  if (env.codexSkipGitRepoCheck === "1") {
    command.push("--skip-git-repo-check");
  }

  if (env.codexModel.length > 0) {
    command.push("-m", env.codexModel);
  }

  if (env.codexReasoningEffort.length > 0) {
    command.push("-c", `model_reasoning_effort=\"${env.codexReasoningEffort}\"`);
  }

  if (env.codexProfile.length > 0) {
    command.push("-p", env.codexProfile);
  }

  if (env.codexFullAuto === "1") {
    command.push("--full-auto");
  } else {
    command.push("-s", env.codexSandbox);
  }

  command.push("-");
  return command;
}

function hasLegacyTaskShape(payload: RuntimePayload): boolean {
  const legacyKeys = [
    "task_id",
    "title",
    "description",
    "target_paths",
    "depends_on",
    "requires_plan",
    "progress_log",
    "persona_policy",
    "current_phase",
    "current_phase_index",
  ];

  for (const key of legacyKeys) {
    if (key in payload) {
      return true;
    }
  }

  return false;
}

export function readPayloadOrFail(rawPayload: string): RuntimePayload {
  if (rawPayload.trim().length === 0) {
    throw new WrapperHelperError(STDIN_EMPTY_MESSAGE, EXIT_CODE_INVALID_INPUT);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawPayload);
  } catch (error) {
    throw new WrapperHelperError(
      `invalid input payload: ${formatError(error)}`,
      EXIT_CODE_INVALID_INPUT,
    );
  }

  if (!isRecord(parsed)) {
    throw new WrapperHelperError(
      "invalid input payload: root must be an object",
      EXIT_CODE_INVALID_INPUT,
    );
  }

  const payload: RuntimePayload = { ...parsed };

  if (!isRecord(payload.task) && hasLegacyTaskShape(payload)) {
    payload.task = normalizeTaskFromLegacyPayload(payload);
  }

  if (typeof payload.mode === "string") {
    payload.mode = payload.mode.trim().toLowerCase();
  }

  if (typeof payload.teammate_id === "string") {
    payload.teammate_id = payload.teammate_id.trim();
  }

  return payload;
}

export function buildPrompt(payload: RuntimePayload): string {
  return helperBuildPrompt(payload);
}

function shouldDenyDotenv(env: RuntimeEnv): boolean {
  return env.codexDenyDotenv !== "0";
}

function normalizePayloadFromStream(chunks: Uint8Array[]): string {
  let totalLength = 0;
  for (const chunk of chunks) {
    totalLength += chunk.length;
  }

  if (totalLength === 0) {
    return "";
  }

  const payload = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    payload.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(payload);
}

async function readStdinPayload(): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of Deno.stdin.readable) {
    chunks.push(chunk);
  }
  return normalizePayloadFromStream(chunks);
}

function logCodexFailure(
  exitCode: number,
  streamLogText: string,
  outputText: string,
  env: RuntimeEnv,
): void {
  if (streamLogText.length > 0) {
    try {
      Deno.writeTextFileSync(env.codexErrorLogPath, streamLogText);
    } catch (_error) {
      // ignore snapshot/write failures to preserve legacy failure propagation
    }
    emitStderrCategory(
      "codex-fail",
      `codex command failed (exit=${exitCode})`,
      `codex stderr/stdout tail (full: ${env.codexErrorLogPath}):`,
    );
    for (const line of tailLines(streamLogText, 80)) {
      console.error(line);
    }
  }

  if (streamLogText.length > 0) {
    emitStderrCategory(
      "codex-fail",
      `codex command failed (exit=${exitCode}): ${streamPreview(streamLogText)}`,
    );
    return;
  }

  if (outputText.length > 0) {
    emitStderrCategory(
      "codex-fail",
      `codex command failed (exit=${exitCode}): ${outputPreview(outputText)}`,
    );
    return;
  }

  emitStderrCategory("codex-fail", `codex command failed (exit=${exitCode})`);
}

function tryExtractResultFromStream(
  streamLogText: string,
  outputPath: string,
): void {
  const streamPath = Deno.makeTempFileSync();
  try {
    Deno.writeTextFileSync(streamPath, streamLogText);
    extractResultToFile(streamPath, outputPath);
  } catch (error) {
    if (error instanceof WrapperHelperError) {
      console.error(error.message);
      return;
    }
    console.error(formatError(error));
  } finally {
    removeTempOutput(streamPath);
  }
}

function maybeEmitRuntimeDebug(
  env: RuntimeEnv,
  prompt: string,
  promptPath: string,
  command: string[],
): void {
  if (env.codexWrapperDebug !== "1") {
    return;
  }
  try {
    Deno.writeTextFileSync(env.codexPromptLogPath, prompt);
  } catch (_error) {
    // keep execution flow; debug logging is best-effort
  }
  console.error(
    `[codex_wrapper] prompt_chars=${prompt.length} prompt_log=${env.codexPromptLogPath}`,
  );
  console.error(`[codex_wrapper] prompt_stdin=${promptPath}`);
  console.error(`[codex_wrapper] cmd=${renderCommandForDebug(command)}`);
}

export async function runRuntime(rawPayload?: string): Promise<number> {
  const payloadText = rawPayload ?? await readStdinPayload();
  try {
    const env = resolveRuntimeEnvironment(Deno.env.get);
    const payload = readPayloadOrFail(payloadText);
    const prompt = buildPrompt(payload);
    const outputPath = Deno.makeTempFileSync();
    const command = buildCodexCommand(outputPath);
    const promptPath = Deno.makeTempFileSync();
    const dotenvSnapshotPath = Deno.makeTempFileSync();
    try {
      Deno.writeTextFileSync(promptPath, prompt);
      maybeEmitRuntimeDebug(env, prompt, promptPath, command);
      if (shouldDenyDotenv(env)) {
        writeDotenvSnapshot(env.targetProjectDir, dotenvSnapshotPath);
      }
      const { exitCode, streamLogText } = await runCodexCommandWithStream(
        command,
        prompt,
        env,
      );
      if (exitCode !== 0) {
        const outputTextOnFailure = Deno.readTextFileSync(outputPath);
        logCodexFailure(exitCode, streamLogText, outputTextOnFailure, env);
        return exitCode;
      }

      let outputText = Deno.readTextFileSync(outputPath);
      if (outputText.length === 0) {
        tryExtractResultFromStream(streamLogText, outputPath);
        outputText = Deno.readTextFileSync(outputPath);
      }

      if (outputText.length === 0) {
        emitStderrCategory("result-block", "codex returned empty output");
        if (streamLogText.length > 0) {
          emitStderrCategory("result-block", "last stream lines:");
          for (const line of tailLines(streamLogText, 40)) {
            console.error(line);
          }
        }
        return EXIT_CODE_RESULT_BLOCK_EMPTY;
      }

      if (shouldDenyDotenv(env)) {
        verifyDotenvSnapshotUnchanged(env.targetProjectDir, dotenvSnapshotPath);
      }

      if (outputText.length > 0) {
        await Deno.stdout.write(new TextEncoder().encode(outputText));
      }
      return 0;
    } finally {
      removeTempOutput(outputPath);
      removeTempOutput(promptPath);
      removeTempOutput(dotenvSnapshotPath);
    }
  } catch (error) {
    if (error instanceof WrapperHelperError) {
      if (error.message === STDIN_EMPTY_MESSAGE) {
        emitStderrCategory("input-validation", error.message);
      } else {
        console.error(error.message);
      }
      return error.exitCode;
    }
    console.error(formatError(error));
    return 1;
  }
}

if (import.meta.main) {
  Deno.exit(await runRuntime());
}

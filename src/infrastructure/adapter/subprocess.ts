import { spawnSync } from "node:child_process";
import process from "node:process";

import type {
  ProgressCallback,
  TeammateAdapter,
} from "../../application/orchestrator/orchestrator.ts";
import type { Task, TaskPhase } from "../../domain/task.ts";
import { normalizeTaskPhase, taskToRecord } from "../../domain/task.ts";

const DEFAULT_TIMEOUT_SECONDS = 120;

export interface SubprocessCodexAdapterOptions {
  planCommand: string[];
  executeCommand: string[];
  timeoutSeconds?: number;
  extraEnv?: Record<string, string>;
  executionSandboxByTeammateId?: Record<string, string>;
}

export class SubprocessCodexAdapter implements TeammateAdapter {
  readonly planCommand: string[];
  readonly executeCommand: string[];
  readonly timeoutSeconds: number;
  readonly extraEnv: Record<string, string>;
  readonly executionSandboxByTeammateId: Record<string, string>;

  constructor(options: SubprocessCodexAdapterOptions) {
    this.planCommand = [...options.planCommand];
    this.executeCommand = [...options.executeCommand];
    this.timeoutSeconds = Math.max(
      1,
      Math.trunc(options.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS),
    );
    this.extraEnv = { ...(options.extraEnv ?? {}) };
    this.executionSandboxByTeammateId = {
      ...(options.executionSandboxByTeammateId ?? {}),
    };
  }

  static emitProgress(
    progressCallback: ProgressCallback | undefined,
    source: string,
    chunk: string,
  ): void {
    if (!progressCallback) {
      return;
    }
    for (const line of chunk.split(/\r?\n/u)) {
      const text = line.replace(/\r$/u, "");
      if (!text.trim()) {
        continue;
      }
      progressCallback(source, text);
    }
  }

  buildPlan(teammateId: string, task: Task): string {
    return this.run(
      this.planCommand,
      {
        mode: "plan",
        teammate_id: teammateId,
        task: taskToRecord(task),
      },
      undefined,
      this.sandboxEnvForTeammate(teammateId),
    );
  }

  executeTask(
    teammateId: string,
    task: Task,
    progressCallback?: ProgressCallback,
  ): string {
    const runtimeEnv = {
      ...this.sandboxEnvForTeammate(teammateId),
      RESULT_PHASE: this.resolveResultPhase(task),
    };
    return this.run(
      this.executeCommand,
      {
        mode: "execute",
        teammate_id: teammateId,
        task: taskToRecord(task),
      },
      progressCallback,
      runtimeEnv,
    );
  }

  private run(
    command: string[],
    payload: Record<string, unknown>,
    progressCallback?: ProgressCallback,
    runtimeEnv: Record<string, string> = {},
  ): string {
    if (command.length === 0) {
      throw new Error("command is empty");
    }

    const displayCommand = command.join(" ");
    const payloadText = JSON.stringify(payload);
    const streamLogs = getEnv("TEAMMATE_STREAM_LOGS", "1") === "1";
    const stdio: Array<"pipe" | "inherit"> = streamLogs
      ? ["pipe", "pipe", "inherit"]
      : ["pipe", "pipe", "pipe"];

    const result = spawnSync(command[0], command.slice(1), {
      input: payloadText,
      encoding: "utf8",
      timeout: this.timeoutSeconds * 1000,
      stdio,
      env: {
        ...process.env,
        ...this.extraEnv,
        ...runtimeEnv,
      },
      maxBuffer: 10 * 1024 * 1024,
    });

    const stdoutRaw = typeof result.stdout === "string" ? result.stdout : "";
    const stderrRaw = typeof result.stderr === "string" ? result.stderr : "";

    SubprocessCodexAdapter.emitProgress(progressCallback, "stdout", stdoutRaw);
    if (!streamLogs) {
      SubprocessCodexAdapter.emitProgress(progressCallback, "stderr", stderrRaw);
    }

    if (isTimeoutError(result.error)) {
      throw new Error(
        `command timed out: ${displayCommand} (${this.timeoutSeconds}s)`,
      );
    }

    if (result.error) {
      throw new Error(
        `command failed: ${displayCommand} :: ${String(result.error.message)}`,
      );
    }

    if (result.status !== 0) {
      const stderr = stderrRaw.trim() ||
        (streamLogs
          ? "see stderr logs above (set TEAMMATE_STREAM_LOGS=0 to capture stderr)"
          : "no stderr");
      throw new Error(`command failed: ${displayCommand} :: ${stderr}`);
    }

    const stdout = stdoutRaw.trim();
    if (!stdout) {
      throw new Error(`empty response from command: ${displayCommand}`);
    }
    return stdout;
  }

  private sandboxEnvForTeammate(teammateId: string): Record<string, string> {
    const sandbox = this.executionSandboxByTeammateId[teammateId]?.trim();
    if (!sandbox) {
      return {};
    }
    return { CODEX_SANDBOX: sandbox };
  }

  private resolveResultPhase(task: Task): TaskPhase {
    const fromProgressLog = this.resolveResultPhaseFromProgressLog(
      task.progress_log,
    );
    if (fromProgressLog !== null) {
      return fromProgressLog;
    }

    const fromPhaseIndex = this.resolveResultPhaseFromCurrentPhaseIndex(task);
    if (fromPhaseIndex !== null) {
      return fromPhaseIndex;
    }

    return "implement";
  }

  private resolveResultPhaseFromProgressLog(
    progressLog: Array<Record<string, unknown>>,
  ): TaskPhase | null {
    for (let index = progressLog.length - 1; index >= 0; index -= 1) {
      const text = String(progressLog[index]?.text ?? "");
      const match = /\bphase=([a-z0-9_-]+)\b/iu.exec(text);
      if (!match) {
        continue;
      }
      const phase = normalizeTaskPhase(match[1]);
      if (phase !== null) {
        return phase;
      }
    }
    return null;
  }

  private resolveResultPhaseFromCurrentPhaseIndex(task: Task): TaskPhase | null {
    const phaseIndexRaw = task.current_phase_index;
    if (typeof phaseIndexRaw !== "number" || !Number.isFinite(phaseIndexRaw)) {
      return null;
    }
    const phaseIndex = Math.trunc(phaseIndexRaw);
    if (phaseIndex < 0) {
      return null;
    }

    const phaseOrder = task.persona_policy?.phase_order;
    if (!Array.isArray(phaseOrder) || phaseIndex >= phaseOrder.length) {
      return null;
    }
    return normalizeTaskPhase(phaseOrder[phaseIndex]);
  }
}

export function parseCommand(raw: string, label: string): string[] {
  const parts = splitCommand(raw);
  if (parts.length === 0) {
    throw new Error(`${label} is empty`);
  }
  return parts;
}

function splitCommand(raw: string): string[] {
  const text = raw.trim();
  if (!text) {
    return [];
  }

  const tokens: string[] = [];
  let current = "";
  let quote: "single" | "double" | null = null;
  let escaping = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (quote === null) {
      if (char === "\\") {
        escaping = true;
        continue;
      }
      if (char === '"') {
        quote = "double";
        continue;
      }
      if (char === "'") {
        quote = "single";
        continue;
      }
      if (/\s/u.test(char)) {
        if (current.length > 0) {
          tokens.push(current);
          current = "";
        }
        continue;
      }
      current += char;
      continue;
    }

    if (quote === "single") {
      if (char === "'") {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === "\\") {
      escaping = true;
      continue;
    }
    if (char === '"') {
      quote = null;
      continue;
    }
    current += char;
  }

  if (escaping || quote !== null) {
    throw new Error("unterminated quote or escape in command");
  }

  if (current.length > 0) {
    tokens.push(current);
  }
  return tokens;
}

function getEnv(name: string, fallback: string): string {
  try {
    return (Deno.env.get(name) ?? fallback).trim();
  } catch (_error) {
    return fallback;
  }
}

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const nodeError = error as NodeJS.ErrnoException;
  if (nodeError.code === "ETIMEDOUT") {
    return true;
  }
  return /timed\s*out/iu.test(error.message);
}

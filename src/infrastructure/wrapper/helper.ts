import { createHash } from "node:crypto";
import path from "node:path";

const DOTENV_DENY_MESSAGE =
  "deny rule violation: .env/.env.* references are forbidden in task payload";
const DOTENV_CHANGED_MESSAGE =
  "deny rule violation: .env/.env.* files were modified by codex";

const RESULT_KEYS = [
  "RESULT",
  "SUMMARY",
  "CHANGED_FILES",
  "CHECKS",
] as const;

type ResultKey = (typeof RESULT_KEYS)[number];
type EnvReader = (name: string, fallback: string) => string;

export class WrapperHelperError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode: number) {
    super(message);
    this.name = "WrapperHelperError";
    this.exitCode = exitCode;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
}

function boolAsPython(value: boolean): string {
  return value ? "True" : "False";
}

function defaultEnv(name: string, fallback: string): string {
  return (Deno.env.get(name) ?? fallback).trim();
}

function safeInt(
  raw: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const text = (raw ?? "").trim();
  if (!text) {
    return fallback;
  }
  const parsed = Number.parseInt(text, 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }
  if (parsed < minimum) {
    return minimum;
  }
  if (parsed > maximum) {
    return maximum;
  }
  return parsed;
}

function safeIntEnv(
  readEnv: EnvReader,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  return safeInt(readEnv(name, ""), fallback, minimum, maximum);
}

export function sanitizePromptText(raw: string): string {
  const text = raw.replaceAll("\r", " ").replaceAll("\n", " ").trim();
  const cleaned: string[] = [];
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (char === "\t" || code >= 0x20) {
      cleaned.push(char);
    }
  }
  return cleaned.join("").replaceAll(/\s+/gu, " ").trim();
}

export function containsDotenvReference(raw: string): boolean {
  const text = raw.toLowerCase().trim();
  if (!text.includes(".env")) {
    return false;
  }
  const tokens = text.split(/[,\s]+/u);
  for (const tokenRaw of tokens) {
    const token = tokenRaw.replaceAll(/^['"()[\]{}]+|['"()[\]{}]+$/gu, "");
    if (!token) {
      continue;
    }
    if (token.startsWith(".env")) {
      return true;
    }
    if (token.includes("/.env") || token.includes("\\.env")) {
      return true;
    }
  }
  return false;
}

export function collectDotenvHits(name: string, value: unknown): string[] {
  if (Array.isArray(value)) {
    const hits: string[] = [];
    for (const item of value) {
      const text = String(item);
      if (containsDotenvReference(text)) {
        hits.push(`${name}:${text}`);
      }
    }
    return hits;
  }
  const text = String(value);
  if (containsDotenvReference(text)) {
    return [`${name}:${text}`];
  }
  return [];
}

function normalizeListText(value: unknown): string {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "(none)";
    }
    return value.map((item) => String(item)).join(", ");
  }
  return String(value);
}

function buildProgressLogSummary(
  progressLog: unknown[],
  readEnv: EnvReader,
): { count: number; recent: string } {
  const count = progressLog.length;
  const maxRecentLines = safeIntEnv(
    readEnv,
    "CODEX_PROGRESS_RECENT_LINES",
    8,
    1,
    20,
  );
  const maxRecentTextChars = safeIntEnv(
    readEnv,
    "CODEX_PROGRESS_RECENT_TEXT_CHARS",
    220,
    80,
    1200,
  );
  const maxRecentTotalChars = safeIntEnv(
    readEnv,
    "CODEX_PROGRESS_RECENT_TOTAL_CHARS",
    2000,
    400,
    12000,
  );

  const recentLines: string[] = [];
  for (const entry of progressLog.slice(-maxRecentLines)) {
    if (!isRecord(entry)) {
      continue;
    }
    let text = sanitizePromptText(String(entry.text ?? ""));
    if (!text) {
      continue;
    }
    if (text.length > maxRecentTextChars) {
      text = `${text.slice(0, maxRecentTextChars - 3)}...`;
    }
    const source = String(entry.source ?? "unknown").trim() || "unknown";
    const timestamp = entry.timestamp;
    const stamp = typeof timestamp === "number" && Number.isFinite(timestamp)
      ? timestamp.toFixed(3)
      : "-";
    recentLines.push(`- [${stamp}] ${source}: ${text}`);
  }

  if (recentLines.length === 0) {
    return { count, recent: "(none)" };
  }

  let recent = recentLines.join("\n");
  if (recent.length > maxRecentTotalChars) {
    recent = `${recent.slice(0, maxRecentTotalChars - 3)}...`;
  }
  return { count, recent };
}

export function buildPrompt(
  payload: Record<string, unknown>,
  readEnv: EnvReader = defaultEnv,
): string {
  const mode = payload.mode;
  const teammateId = String(payload.teammate_id || "teammate");
  const task = isRecord(payload.task) ? payload.task : {};

  const taskId = String(task.id || "");
  const title = String(task.title || "");
  const description = String(task.description || "");
  const targetPaths = task.target_paths || [];
  const dependsOn = task.depends_on || [];
  const requiresPlan = Boolean(task.requires_plan);
  const progressLog = Array.isArray(task.progress_log) ? task.progress_log : [];

  const denyDotenv = readEnv("CODEX_DENY_DOTENV", "1") !== "0";
  if (denyDotenv) {
    const violations: string[] = [];
    violations.push(...collectDotenvHits("title", title));
    violations.push(...collectDotenvHits("description", description));
    violations.push(...collectDotenvHits("target_paths", targetPaths));
    violations.push(...collectDotenvHits("depends_on", dependsOn));
    if (violations.length > 0) {
      const preview = violations.slice(0, 5).join(", ");
      throw new WrapperHelperError(
        `${DOTENV_DENY_MESSAGE} (task_id=${taskId || "unknown"}; ${preview})`,
        3,
      );
    }
  }

  const targetPathsText = normalizeListText(targetPaths);
  const dependsOnText = normalizeListText(dependsOn);
  const progress = buildProgressLogSummary(progressLog, readEnv);
  const requiresPlanText = boolAsPython(requiresPlan);

  if (mode === "plan") {
    return `You are implementation teammate ${teammateId}.
Create only the execution plan for this task.

task_id: ${taskId}
title: ${title}
description: ${description}
target_paths: ${targetPathsText}
depends_on: ${dependsOnText}
requires_plan: ${requiresPlanText}

Constraints:
- Do not propose edits outside target_paths
- Do not read/reference/edit .env or .env.*
- Keep steps short and concrete
- Include local verification commands at the end
- For \`deno test\`, use \`--allow-read --allow-write --allow-env\` by default

Output format:
1) Acceptance criteria
2) Implementation steps
3) Files to edit
4) Local checks
Keep total output within 12 lines.`;
  }

  if (mode === "execute") {
    let prompt = `You are implementation teammate ${teammateId}.
Execute the task below.

task_id: ${taskId}
title: ${title}
description: ${description}
target_paths: ${targetPathsText}
depends_on: ${dependsOnText}
requires_plan: ${requiresPlanText}
existing_progress_log_count: ${progress.count}
existing_progress_log_recent:
${progress.recent}

Constraints:
- Do not edit outside target_paths
- Do not read/reference/edit .env or .env.*
- Run required local checks
- For \`deno test\`, use \`--allow-read --allow-write --allow-env\` by default
- If failed, provide a short root cause

Final output must be exactly these 4 lines:
RESULT: completed|blocked
SUMMARY: <=100 chars
CHANGED_FILES: comma-separated
CHECKS: executed check commands`;

    const maxPromptChars = safeIntEnv(
      readEnv,
      "CODEX_PROMPT_MAX_CHARS",
      16000,
      2000,
      120000,
    );
    if (prompt.length > maxPromptChars) {
      prompt = `${
        prompt.slice(0, maxPromptChars - 60)
      }\n\n[truncated by codex_wrapper]`;
    }
    return prompt;
  }

  throw new WrapperHelperError(`unknown mode: ${String(mode)}`, 2);
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}

function sortedRecord(input: Record<string, string>): Record<string, string> {
  const sorted: Record<string, string> = {};
  const keys = Object.keys(input).sort();
  for (const key of keys) {
    sorted[key] = input[key];
  }
  return sorted;
}

function hashFile(filePath: string): string {
  const bytes = Deno.readFileSync(filePath);
  return createHash("sha256").update(bytes).digest("hex");
}

function walkDotenvFiles(
  rootPath: string,
  currentPath: string,
  output: Record<string, string>,
): void {
  for (const entry of Deno.readDirSync(currentPath)) {
    const candidatePath = path.join(currentPath, entry.name);
    if (entry.isDirectory) {
      walkDotenvFiles(rootPath, candidatePath, output);
      continue;
    }
    if (!entry.isFile) {
      continue;
    }
    if (!entry.name.startsWith(".env")) {
      continue;
    }
    const relative = toPosixPath(path.relative(rootPath, candidatePath));
    output[relative] = hashFile(candidatePath);
  }
}

export function collectDotenvSnapshot(
  rootPathRaw: string,
): Record<string, string> {
  const rootPath = path.resolve(rootPathRaw);
  const payload: Record<string, string> = {};
  walkDotenvFiles(rootPath, rootPath, payload);
  return sortedRecord(payload);
}

function parseSnapshot(raw: string): Record<string, string> {
  const parsed = JSON.parse(raw);
  if (!isRecord(parsed)) {
    return {};
  }
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === "string") {
      output[String(key)] = value;
    }
  }
  return sortedRecord(output);
}

function recordsEqual(
  left: Record<string, string>,
  right: Record<string, string>,
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  for (const key of leftKeys) {
    if (left[key] !== right[key]) {
      return false;
    }
  }
  return true;
}

export function writeDotenvSnapshot(
  rootPathRaw: string,
  snapshotPath: string,
): void {
  const snapshot = collectDotenvSnapshot(rootPathRaw);
  Deno.writeTextFileSync(snapshotPath, JSON.stringify(snapshot));
}

export function verifyDotenvSnapshotUnchanged(
  rootPathRaw: string,
  snapshotPath: string,
): void {
  const beforeRaw = Deno.readTextFileSync(snapshotPath).trim();
  const before = beforeRaw ? parseSnapshot(beforeRaw) : {};
  const after = collectDotenvSnapshot(rootPathRaw);

  if (recordsEqual(before, after)) {
    return;
  }

  const beforeKeys = new Set(Object.keys(before));
  const afterKeys = new Set(Object.keys(after));

  const added = [...afterKeys].filter((key) => !beforeKeys.has(key)).sort();
  const removed = [...beforeKeys].filter((key) => !afterKeys.has(key)).sort();
  const changed = [...beforeKeys]
    .filter((key) => afterKeys.has(key) && before[key] !== after[key])
    .sort();

  const details: string[] = [];
  if (added.length > 0) {
    details.push(`added=${added.join(",")}`);
  }
  if (removed.length > 0) {
    details.push(`removed=${removed.join(",")}`);
  }
  if (changed.length > 0) {
    details.push(`changed=${changed.join(",")}`);
  }
  const suffix = details.length > 0 ? ` (${details.join("; ")})` : "";
  throw new WrapperHelperError(`${DOTENV_CHANGED_MESSAGE}${suffix}`, 4);
}

export function extractResultBlock(raw: string): string | null {
  const lines = raw.split(/\r?\n/u).map((line) => line.trim()).filter((line) =>
    line.length > 0
  );
  const patterns: Record<ResultKey, RegExp> = {
    RESULT: /^RESULT:\s*(.+)$/u,
    SUMMARY: /^SUMMARY:\s*(.+)$/u,
    CHANGED_FILES: /^CHANGED_FILES:\s*(.+)$/u,
    CHECKS: /^CHECKS:\s*(.+)$/u,
  };
  const found: Partial<Record<ResultKey, string>> = {};

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    for (const key of RESULT_KEYS) {
      if (found[key] !== undefined) {
        continue;
      }
      const match = patterns[key].exec(line);
      if (match) {
        found[key] = match[1].trim();
      }
    }
  }

  for (const key of RESULT_KEYS) {
    if (found[key] === undefined) {
      return null;
    }
  }

  return [
    `RESULT: ${found.RESULT}`,
    `SUMMARY: ${found.SUMMARY}`,
    `CHANGED_FILES: ${found.CHANGED_FILES}`,
    `CHECKS: ${found.CHECKS}`,
  ].join("\n");
}

export function extractResultToFile(
  streamPath: string,
  outputPath: string,
): void {
  const raw = Deno.readTextFileSync(streamPath);
  const extracted = extractResultBlock(raw);
  if (extracted === null) {
    throw new WrapperHelperError("result block not found", 2);
  }
  Deno.writeTextFileSync(outputPath, extracted);
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (value === undefined) {
    throw new WrapperHelperError(`missing required env: ${name}`, 2);
  }
  return value;
}

export function runCli(args: string[]): number {
  const command = args[0] ?? "";
  try {
    if (command === "build-prompt") {
      const payloadRaw = requiredEnv("PAYLOAD");
      let payload: unknown;
      try {
        payload = JSON.parse(payloadRaw);
      } catch (error) {
        throw new WrapperHelperError(
          `invalid input payload: ${formatError(error)}`,
          2,
        );
      }
      if (!isRecord(payload)) {
        throw new WrapperHelperError(
          "invalid input payload: root must be JSON object",
          2,
        );
      }
      const prompt = buildPrompt(payload, defaultEnv);
      console.log(prompt);
      return 0;
    }

    if (command === "snapshot-dotenv") {
      const rootPath = requiredEnv("TARGET_PROJECT_DIR");
      const snapshotPath = requiredEnv("SNAPSHOT_PATH");
      writeDotenvSnapshot(rootPath, snapshotPath);
      return 0;
    }

    if (command === "verify-dotenv") {
      const rootPath = requiredEnv("TARGET_PROJECT_DIR");
      const snapshotPath = requiredEnv("SNAPSHOT_PATH");
      verifyDotenvSnapshotUnchanged(rootPath, snapshotPath);
      return 0;
    }

    if (command === "extract-result") {
      const streamPath = requiredEnv("STREAM_PATH");
      const outputPath = requiredEnv("OUTPUT_PATH");
      extractResultToFile(streamPath, outputPath);
      return 0;
    }

    throw new WrapperHelperError(`unknown helper mode: ${command}`, 2);
  } catch (error) {
    if (error instanceof WrapperHelperError) {
      console.error(error.message);
      return error.exitCode;
    }
    console.error(formatError(error));
    return 1;
  }
}

if (import.meta.main) {
  Deno.exit(runCli(Deno.args));
}

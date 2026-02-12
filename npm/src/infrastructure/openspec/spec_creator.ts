import path from "node:path";
import {
  DEFAULT_TEMPLATE_LANG,
  getOpenSpecTasksTemplateSections,
  getProviderCompletionGateSection,
  normalizeFixedLinesAndHeadings,
  type SupportedTemplateLang,
} from "./template.ts";

const TASK_HEADER_PATTERN = /^\s*-\s*\[[ xX]\]\s*(.+?)\s*$/;
const TASK_ID_PREFIX_PATTERN =
  /^(?:T-[A-Za-z0-9_-]+|TASK-[A-Za-z0-9_-]+|\d+(?:\.\d+)*)/i;
const CHECKBOX_ITEM_PATTERN = /^\s*-\s*\[[ xX]\]\s*.+$/m;

const REVIEWER_STOP_BULLETS_BY_LANG: Record<SupportedTemplateLang, string[]> = {
  ja: [
    "- `spec-reviewer` が重大違反を検出したら `REVIEWER_STOP:requirement_drift|over_editing|verbosity` を出力する。",
    "- `REVIEWER_STOP:` を含むレビュー結果は blocker として停止判定する。",
  ],
  en: [
    "- When `spec-reviewer` detects a major violation, output `REVIEWER_STOP:requirement_drift|over_editing|verbosity`.",
    "- Treat review output containing `REVIEWER_STOP:` as a blocker stop signal.",
  ],
};

export interface CodeUnitSummary {
  file: string;
  service: string;
  function: string;
  purpose: string;
  input: string;
  output: string;
  error: string;
  test: string;
}

export interface TaskCodeSummary {
  task_id: string;
  code_units: CodeUnitSummary[];
}

export interface TaskCodeSummaryInput {
  task_id: string;
  code_units?: Array<Partial<CodeUnitSummary>>;
}

export interface BuildCodeSummaryOptions {
  tasksMarkdown: string;
  summaries?: TaskCodeSummaryInput[];
}

export interface WriteCodeSummaryOptions {
  tasksPath: string;
  outputPath?: string;
  summaries?: TaskCodeSummaryInput[];
}

export interface BuildProposalMarkdownOptions {
  lang?: string;
  whyMarkdown?: string;
  whatChangesMarkdown?: string;
  impactMarkdown?: string;
}

export interface WriteProposalMarkdownOptions
  extends BuildProposalMarkdownOptions {
  proposalPath: string;
}

export interface BuildTasksMarkdownOptions {
  lang?: string;
  implementationMarkdown?: string;
  humanNotesMarkdown?: string;
}

export interface WriteTasksMarkdownOptions extends BuildTasksMarkdownOptions {
  tasksPath: string;
}

export interface BuildDeltaSpecMarkdownOptions {
  lang?: string;
  requirementName?: string;
  requirementsText?: string;
}

export interface WriteDeltaSpecMarkdownOptions
  extends BuildDeltaSpecMarkdownOptions {
  specPath: string;
}

export type ChangeFileKind = "markdown" | "non-markdown";

export interface ChangeFileQueueItem {
  path: string;
  kind: ChangeFileKind;
}

export interface ChangeFileQueue {
  changeRoot: string;
  totalFileCount: number;
  markdownFiles: string[];
  nonMarkdownFiles: string[];
  processingQueue: ChangeFileQueueItem[];
}

export interface MarkdownPolishRuleCounts {
  formatting: number;
  fixedLines: number;
  headings: number;
}

export interface MarkdownPolishResult {
  changedFiles: string[];
  ruleCounts: MarkdownPolishRuleCounts;
}

export interface NonMarkdownConsistencyResult {
  checkedFiles: string[];
  warnings: string[];
}

export interface BuildPolishSummaryOptions {
  totalFileCount: number;
  changedFiles: string[];
  ruleCounts: MarkdownPolishRuleCounts;
}

export interface SpecCreatorPolishSummary {
  totalFileCount: number;
  changedFileCount: number;
  changedFiles: string[];
  ruleCounts: MarkdownPolishRuleCounts;
}

const PROPOSAL_TEMPLATE_BY_LANG: Record<
  SupportedTemplateLang,
  {
    title: string;
    whyHeading: string;
    defaultWhyBody: string;
    whatChangesHeading: string;
    defaultWhatChangesBody: string;
    impactHeading: string;
    defaultImpactBody: string;
    completionGateHeading: string;
    reviewerStopHeading: string;
  }
> = {
  ja: {
    title: "# Change: <変更概要>",
    whyHeading: "## Why",
    defaultWhyBody: "<背景・課題を記述>",
    whatChangesHeading: "## What Changes",
    defaultWhatChangesBody: "- <変更点1>\n- <変更点2>",
    impactHeading: "## Impact",
    defaultImpactBody:
      "- Affected specs: <spec-id>\n- Affected code: <path/to/file>",
    completionGateHeading: "## Provider 完了判定ゲート（固定）",
    reviewerStopHeading: "## Reviewer 停止判定ゲート（固定）",
  },
  en: {
    title: "# Change: <brief description>",
    whyHeading: "## Why",
    defaultWhyBody: "<describe background and problem>",
    whatChangesHeading: "## What Changes",
    defaultWhatChangesBody: "- <change item 1>\n- <change item 2>",
    impactHeading: "## Impact",
    defaultImpactBody:
      "- Affected specs: <spec-id>\n- Affected code: <path/to/file>",
    completionGateHeading: "## Provider Completion Gates (fixed)",
    reviewerStopHeading: "## Reviewer Stop Gates (fixed)",
  },
};

export function collectChangeFilesRecursively(
  changeRootPath: string,
): ChangeFileQueue {
  const changeRoot = path.resolve(changeRootPath);
  const changeRootStat = safeStat(changeRoot);
  if (!changeRootStat?.isDirectory) {
    throw new Error(`change root is not a directory: ${changeRoot}`);
  }

  const filePaths: string[] = [];
  walkDirectoryRecursively(changeRoot, filePaths);
  filePaths.sort((left, right) => left.localeCompare(right));

  const processingQueue = filePaths.map(
    (filePath): ChangeFileQueueItem => ({
      path: filePath,
      kind: isMarkdownPath(filePath) ? "markdown" : "non-markdown",
    }),
  );
  const markdownFiles = processingQueue
    .filter((item) => item.kind === "markdown")
    .map((item) => item.path);
  const nonMarkdownFiles = processingQueue
    .filter((item) => item.kind === "non-markdown")
    .map((item) => item.path);

  return {
    changeRoot,
    totalFileCount: processingQueue.length,
    markdownFiles,
    nonMarkdownFiles,
    processingQueue,
  };
}

export function polishMarkdownFiles(
  markdownPaths: string[],
): MarkdownPolishResult {
  const changedFiles: string[] = [];
  const ruleCounts: MarkdownPolishRuleCounts = {
    formatting: 0,
    fixedLines: 0,
    headings: 0,
  };

  for (const markdownPathRaw of markdownPaths) {
    const markdownPath = path.resolve(markdownPathRaw);
    const original = safeReadTextFile(markdownPath);
    const polished = polishMarkdownContent(original, markdownPath);

    ruleCounts.formatting += polished.formatting;
    ruleCounts.fixedLines += polished.fixedLines;
    ruleCounts.headings += polished.headings;

    if (polished.markdown === original) {
      continue;
    }

    safeWriteTextFile(markdownPath, polished.markdown);
    changedFiles.push(markdownPath);
  }

  changedFiles.sort((left, right) => left.localeCompare(right));
  return {
    changedFiles,
    ruleCounts,
  };
}

export function checkNonMarkdownConsistency(
  nonMarkdownPaths: string[],
): NonMarkdownConsistencyResult {
  const checkedFiles: string[] = [];
  const warnings: string[] = [];

  for (const nonMarkdownPathRaw of nonMarkdownPaths) {
    const nonMarkdownPath = path.resolve(nonMarkdownPathRaw);
    const before = safeReadBinaryFile(nonMarkdownPath);
    checkedFiles.push(nonMarkdownPath);

    warnings.push(...collectNonMarkdownWarnings(nonMarkdownPath, before));

    const after = safeReadBinaryFile(nonMarkdownPath);
    if (!isSameBytes(before, after)) {
      warnings.push(
        `non-markdown consistency warning: ${nonMarkdownPath}: content changed during read-only check`,
      );
    }
  }

  checkedFiles.sort((left, right) => left.localeCompare(right));
  warnings.sort((left, right) => left.localeCompare(right));
  return { checkedFiles, warnings };
}

export function buildPolishSummary(
  options: BuildPolishSummaryOptions,
): SpecCreatorPolishSummary {
  const totalFileCount = normalizeNonNegativeInteger(
    options.totalFileCount,
    "total file count",
  );
  const changedFiles = [...options.changedFiles]
    .map((item) => path.resolve(item))
    .sort((left, right) => left.localeCompare(right));
  const ruleCounts = {
    formatting: normalizeNonNegativeInteger(
      options.ruleCounts.formatting,
      "formatting rule count",
    ),
    fixedLines: normalizeNonNegativeInteger(
      options.ruleCounts.fixedLines,
      "fixed lines rule count",
    ),
    headings: normalizeNonNegativeInteger(
      options.ruleCounts.headings,
      "headings rule count",
    ),
  };

  return {
    totalFileCount,
    changedFileCount: changedFiles.length,
    changedFiles,
    ruleCounts,
  };
}

export function buildProposalMarkdown(
  options: BuildProposalMarkdownOptions = {},
): string {
  const proposalTemplate = getProposalTemplate(
    options.lang ?? DEFAULT_TEMPLATE_LANG,
  );
  const whyBody = normalizeSectionBody(
    options.whyMarkdown,
    proposalTemplate.defaultWhyBody,
  );
  const whatChangesBody = normalizeSectionBody(
    options.whatChangesMarkdown,
    proposalTemplate.defaultWhatChangesBody,
  );
  const impactBody = normalizeSectionBody(
    options.impactMarkdown,
    proposalTemplate.defaultImpactBody,
  );
  const completionGateBullets = extractProviderCompletionGateBullets(
    options.lang ?? DEFAULT_TEMPLATE_LANG,
  );
  const reviewerStopBullets = reviewerStopBulletsForLang(
    options.lang ?? DEFAULT_TEMPLATE_LANG,
  );

  return [
    proposalTemplate.title,
    "",
    proposalTemplate.whyHeading,
    whyBody,
    "",
    proposalTemplate.whatChangesHeading,
    whatChangesBody,
    "",
    proposalTemplate.impactHeading,
    impactBody,
    "",
    proposalTemplate.completionGateHeading,
    ...completionGateBullets,
    "",
    proposalTemplate.reviewerStopHeading,
    ...reviewerStopBullets,
    "",
  ].join("\n");
}

export function writeProposalMarkdown(
  options: WriteProposalMarkdownOptions,
): string {
  const proposalPath = path.resolve(options.proposalPath);
  const proposalMarkdown = buildProposalMarkdown(options);
  Deno.mkdirSync(path.dirname(proposalPath), { recursive: true });
  Deno.writeTextFileSync(proposalPath, proposalMarkdown);
  return proposalPath;
}

export function buildTasksMarkdown(
  options: BuildTasksMarkdownOptions = {},
): string {
  const sections = getOpenSpecTasksTemplateSections(
    options.lang ?? DEFAULT_TEMPLATE_LANG,
  );

  const implementationBody = normalizeSectionBody(
    options.implementationMarkdown,
    sections.defaultImplementationBody,
  );
  if (!CHECKBOX_ITEM_PATTERN.test(implementationBody)) {
    throw new Error(
      "implementation section must include checkbox tasks",
    );
  }

  let humanNotesBody = normalizeSectionBody(
    options.humanNotesMarkdown,
    sections.defaultHumanNotesBody,
  );
  const reviewerStopNote = reviewerStopHumanNote(
    options.lang ?? DEFAULT_TEMPLATE_LANG,
  );
  humanNotesBody = appendLineIfMissing(humanNotesBody, reviewerStopNote);

  return [
    sections.preamble,
    "",
    sections.implementationHeading,
    implementationBody,
    "",
    sections.humanNotesHeading,
    humanNotesBody,
    "",
  ].join("\n");
}

export function writeTasksMarkdown(options: WriteTasksMarkdownOptions): string {
  const tasksPath = path.resolve(options.tasksPath);
  const tasksMarkdown = buildTasksMarkdown(options);
  Deno.mkdirSync(path.dirname(tasksPath), { recursive: true });
  Deno.writeTextFileSync(tasksPath, tasksMarkdown);
  return tasksPath;
}

export function buildDeltaSpecMarkdown(
  options: BuildDeltaSpecMarkdownOptions = {},
): string {
  const lang = normalizeTemplateLang(options.lang ?? DEFAULT_TEMPLATE_LANG);
  const requirementName = normalizeText(
    options.requirementName,
    lang === "ja"
      ? "Spec Creator Draft Baseline"
      : "Spec Creator Draft Baseline",
  );
  const requirementsText = normalizeText(
    options.requirementsText,
    lang === "ja" ? "(none)" : "(none)",
  );

  if (lang === "ja") {
    return [
      "## ADDED Requirements",
      `### Requirement: ${requirementName}`,
      "The system SHALL keep OpenSpec artifacts aligned for this change.",
      "",
      "#### Scenario: Spec creator baseline is generated",
      "- **WHEN** spec creator runs for this change",
      "- **THEN** proposal/tasks/design/code_summary and this delta SHALL be generated",
      `- **AND** requirements memo SHALL be captured: ${requirementsText}`,
      "",
    ].join("\n");
  }

  return [
    "## ADDED Requirements",
    `### Requirement: ${requirementName}`,
    "The system SHALL keep OpenSpec artifacts aligned for this change.",
    "",
    "#### Scenario: Spec creator baseline is generated",
    "- **WHEN** spec creator runs for this change",
    "- **THEN** proposal/tasks/design/code_summary and this delta SHALL be generated",
    `- **AND** requirements memo SHALL be captured: ${requirementsText}`,
    "",
  ].join("\n");
}

export function writeDeltaSpecMarkdown(
  options: WriteDeltaSpecMarkdownOptions,
): string {
  const specPath = path.resolve(options.specPath);
  const content = buildDeltaSpecMarkdown(options);
  Deno.mkdirSync(path.dirname(specPath), { recursive: true });
  Deno.writeTextFileSync(specPath, content);
  return specPath;
}

export function extractTaskIdsFromTasksMarkdown(
  tasksMarkdown: string,
): string[] {
  const taskIds: string[] = [];
  const seen = new Set<string>();

  for (const line of tasksMarkdown.split(/\r?\n/)) {
    const headerMatch = TASK_HEADER_PATTERN.exec(line);
    if (!headerMatch) {
      continue;
    }

    const taskHeader = headerMatch[1].trim();
    const taskIdMatch = TASK_ID_PREFIX_PATTERN.exec(taskHeader);
    if (!taskIdMatch) {
      continue;
    }

    const taskId = taskIdMatch[0].trim();
    if (seen.has(taskId)) {
      throw new Error(`duplicate task_id in tasks.md: ${taskId}`);
    }
    seen.add(taskId);
    taskIds.push(taskId);
  }

  if (taskIds.length === 0) {
    throw new Error(
      "tasks.md does not include checkbox tasks with parseable task_id",
    );
  }

  return taskIds;
}

export function createCodeSummaryEntries(
  taskIds: string[],
  summaries: TaskCodeSummaryInput[] = [],
): TaskCodeSummary[] {
  const normalizedTaskIds = normalizeTaskIds(taskIds);
  const allowedTaskIds = new Set<string>(normalizedTaskIds);
  const summaryByTaskId = new Map<string, TaskCodeSummaryInput>();

  for (const summary of summaries) {
    const taskId = String(summary.task_id ?? "").trim();
    if (!taskId) {
      throw new Error("code_summary includes empty task_id");
    }
    if (!allowedTaskIds.has(taskId)) {
      throw new Error(`code_summary has unknown task_id: ${taskId}`);
    }
    if (summaryByTaskId.has(taskId)) {
      throw new Error(`code_summary has duplicate task_id: ${taskId}`);
    }
    summaryByTaskId.set(taskId, summary);
  }

  return normalizedTaskIds.map((taskId) => {
    const provided = summaryByTaskId.get(taskId);
    const units = provided?.code_units ?? [];
    const normalizedUnits = units.length === 0
      ? [createPlaceholderCodeUnit(taskId, 0)]
      : units.map((unit, index) => normalizeCodeUnit(taskId, unit, index));

    return {
      task_id: taskId,
      code_units: normalizedUnits,
    };
  });
}

export function buildCodeSummaryMarkdown(
  options: BuildCodeSummaryOptions,
): string {
  const taskIds = extractTaskIdsFromTasksMarkdown(options.tasksMarkdown);
  const entries = createCodeSummaryEntries(taskIds, options.summaries ?? []);

  const lines: string[] = [
    "# code_summary.md",
    "",
    "Implementation mapping from tasks.md to code units.",
    "",
  ];

  for (const entry of entries) {
    lines.push(`## task_id: ${entry.task_id}`);
    lines.push("");

    for (const [index, unit] of entry.code_units.entries()) {
      lines.push(`### code_unit_${index + 1}`);
      lines.push(`- file: ${unit.file}`);
      lines.push(`- service: ${unit.service}`);
      lines.push(`- function: ${unit.function}`);
      lines.push(`- purpose: ${unit.purpose}`);
      lines.push(`- input: ${unit.input}`);
      lines.push(`- output: ${unit.output}`);
      lines.push(`- error: ${unit.error}`);
      lines.push(`- test: ${unit.test}`);
      lines.push("");
    }
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export function defaultCodeSummaryOutputPath(tasksPath: string): string {
  const resolvedTasksPath = path.resolve(tasksPath);
  return path.join(path.dirname(resolvedTasksPath), "code_summary.md");
}

export function writeCodeSummaryMarkdown(
  options: WriteCodeSummaryOptions,
): string {
  const tasksPath = path.resolve(options.tasksPath);
  const tasksMarkdown = Deno.readTextFileSync(tasksPath);
  const codeSummary = buildCodeSummaryMarkdown({
    tasksMarkdown,
    summaries: options.summaries ?? [],
  });
  const outputPath = path.resolve(
    options.outputPath ?? defaultCodeSummaryOutputPath(tasksPath),
  );
  Deno.mkdirSync(path.dirname(outputPath), { recursive: true });
  Deno.writeTextFileSync(outputPath, codeSummary);
  return outputPath;
}

function normalizeTaskIds(taskIds: string[]): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const rawTaskId of taskIds) {
    const taskId = String(rawTaskId).trim();
    if (!taskId) {
      throw new Error("tasks.md includes empty task_id");
    }
    if (seen.has(taskId)) {
      throw new Error(`tasks.md includes duplicate task_id: ${taskId}`);
    }
    seen.add(taskId);
    normalized.push(taskId);
  }

  if (normalized.length === 0) {
    throw new Error("tasks.md does not include any task_id");
  }

  return normalized;
}

function normalizeCodeUnit(
  taskId: string,
  codeUnit: Partial<CodeUnitSummary>,
  index: number,
): CodeUnitSummary {
  const placeholder = createPlaceholderCodeUnit(taskId, index);
  return {
    file: normalizeText(codeUnit.file, placeholder.file),
    service: normalizeText(codeUnit.service, placeholder.service),
    function: normalizeText(codeUnit.function, placeholder.function),
    purpose: normalizeText(codeUnit.purpose, placeholder.purpose),
    input: normalizeText(codeUnit.input, placeholder.input),
    output: normalizeText(codeUnit.output, placeholder.output),
    error: normalizeText(codeUnit.error, placeholder.error),
    test: normalizeText(codeUnit.test, placeholder.test),
  };
}

function createPlaceholderCodeUnit(
  taskId: string,
  index: number,
): CodeUnitSummary {
  const suffix = index + 1;
  return {
    file: `<replace-with-target-file-${taskId}-${suffix}>`,
    service: `<replace-with-service-${taskId}-${suffix}>`,
    function: `<replace-with-function-${taskId}-${suffix}>`,
    purpose: `<replace-with-purpose-${taskId}-${suffix}>`,
    input: `<replace-with-input-${taskId}-${suffix}>`,
    output: `<replace-with-output-${taskId}-${suffix}>`,
    error: `<replace-with-error-${taskId}-${suffix}>`,
    test: `<replace-with-test-${taskId}-${suffix}>`,
  };
}

function normalizeText(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const normalized = value.trim();
  return normalized.length === 0 ? fallback : normalized;
}

function reviewerStopBulletsForLang(lang: string): string[] {
  return REVIEWER_STOP_BULLETS_BY_LANG[normalizeTemplateLang(lang)];
}

function reviewerStopHumanNote(lang: string): string {
  const stopSignal = "`REVIEWER_STOP:requirement_drift|over_editing|verbosity`";
  const normalized = normalizeTemplateLang(lang);
  if (normalized === "ja") {
    return `- メモ: 重大違反時は ${stopSignal} を reviewer 出力に含める。`;
  }
  return `- Note: include ${stopSignal} in reviewer output for major violations.`;
}

function appendLineIfMissing(body: string, line: string): string {
  const lines = body.split(/\r?\n/).map((item) => item.trim());
  if (lines.includes(line.trim())) {
    return body;
  }
  return `${body}\n${line}`;
}

function normalizeSectionBody(
  raw: string | undefined,
  fallback: string,
): string {
  if (typeof raw !== "string") {
    return fallback;
  }
  const normalized = raw.trim();
  return normalized.length === 0 ? fallback : normalized;
}

function getProposalTemplate(
  lang: string,
): (typeof PROPOSAL_TEMPLATE_BY_LANG)["ja"] {
  return PROPOSAL_TEMPLATE_BY_LANG[normalizeTemplateLang(lang)];
}

function normalizeTemplateLang(lang: string): SupportedTemplateLang {
  const normalized = String(lang).trim().toLowerCase();
  if (normalized !== "ja" && normalized !== "en") {
    throw new Error(
      "unsupported template language: " + lang + " (allowed: ja, en)",
    );
  }
  return normalized;
}

function extractProviderCompletionGateBullets(lang: string): string[] {
  const section = getProviderCompletionGateSection(lang);
  const bullets = section.split(/\r?\n/).filter((line) =>
    line.trimStart().startsWith("- ")
  );
  if (bullets.length === 0) {
    throw new Error(
      `provider completion gates are missing bullet lines: ${lang}`,
    );
  }
  return bullets;
}

function polishMarkdownContent(
  markdown: string,
  filePath: string,
): {
  markdown: string;
  formatting: number;
  fixedLines: number;
  headings: number;
} {
  const normalizedLf = normalizeLineEnding(markdown);
  let lines = normalizedLf.split("\n");

  const trimmedResult = trimTrailingWhitespace(lines);
  lines = trimmedResult.lines;

  const blankLineResult = collapseBlankLines(lines);
  lines = blankLineResult.lines;

  let normalizedMarkdown = finalizeMarkdownLines(lines);
  const fixedAndHeadingResult = normalizeFixedLinesAndHeadings(
    normalizedMarkdown,
    { filePath },
  );
  normalizedMarkdown = fixedAndHeadingResult.markdown;

  const formattingChanged = normalizedMarkdown !== markdown &&
    (normalizedLf !== markdown ||
      trimmedResult.changes > 0 ||
      blankLineResult.changes > 0);

  return {
    markdown: normalizedMarkdown,
    formatting: formattingChanged ? 1 : 0,
    fixedLines: fixedAndHeadingResult.fixedLineInsertions,
    headings: fixedAndHeadingResult.headingNormalizations,
  };
}

function trimTrailingWhitespace(
  lines: string[],
): { lines: string[]; changes: number } {
  const normalized: string[] = [];
  let changes = 0;

  for (const line of lines) {
    const next = line.replace(/[ \t]+$/u, "");
    if (next !== line) {
      changes += 1;
    }
    normalized.push(next);
  }

  return { lines: normalized, changes };
}

function collapseBlankLines(
  lines: string[],
): { lines: string[]; changes: number } {
  const normalized: string[] = [];
  let changes = 0;
  let inFence = false;
  let blankRun = 0;

  for (const line of lines) {
    if (isFenceLine(line)) {
      inFence = !inFence;
      blankRun = 0;
      normalized.push(line);
      continue;
    }

    if (inFence) {
      normalized.push(line);
      continue;
    }

    if (line.trim().length === 0) {
      blankRun += 1;
      if (blankRun > 1) {
        changes += 1;
        continue;
      }
      normalized.push("");
      continue;
    }

    blankRun = 0;
    normalized.push(line);
  }

  return { lines: normalized, changes };
}

function finalizeMarkdownLines(lines: string[]): string {
  let end = lines.length;
  while (end > 0 && lines[end - 1].trim().length === 0) {
    end -= 1;
  }
  if (end === 0) {
    return "";
  }
  return `${lines.slice(0, end).join("\n")}\n`;
}

function normalizeLineEnding(markdown: string): string {
  return markdown.replaceAll(/\r\n?/gu, "\n");
}

function safeReadTextFile(filePath: string): string {
  try {
    return Deno.readTextFileSync(filePath);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`failed to read markdown file: ${filePath}: ${reason}`);
  }
}

function safeWriteTextFile(filePath: string, content: string): void {
  try {
    Deno.writeTextFileSync(filePath, content);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`failed to write markdown file: ${filePath}: ${reason}`);
  }
}

function safeReadBinaryFile(filePath: string): Uint8Array {
  try {
    return Deno.readFileSync(filePath);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`failed to read non-markdown file: ${filePath}: ${reason}`);
  }
}

function isFenceLine(line: string): boolean {
  return /^\s*(?:```|~~~)/u.test(line);
}

function walkDirectoryRecursively(rootPath: string, output: string[]): void {
  const entries = safeReadDir(rootPath);
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const entryPath = path.join(rootPath, entry.name);
    if (entry.isDirectory) {
      walkDirectoryRecursively(entryPath, output);
      continue;
    }
    if (entry.isFile) {
      output.push(entryPath);
      continue;
    }
    throw new Error(`unsupported entry type under change root: ${entryPath}`);
  }
}

function safeReadDir(dirPath: string): Deno.DirEntry[] {
  try {
    return Array.from(Deno.readDirSync(dirPath));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`failed to scan directory: ${dirPath}: ${reason}`);
  }
}

function safeStat(filePath: string): Deno.FileInfo | null {
  try {
    return Deno.statSync(filePath);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return null;
    }
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`failed to inspect path: ${filePath}: ${reason}`);
  }
}

function isMarkdownPath(filePath: string): boolean {
  return path.extname(filePath).toLowerCase() === ".md";
}

function collectNonMarkdownWarnings(
  filePath: string,
  bytes: Uint8Array,
): string[] {
  const ext = path.extname(filePath).toLowerCase();
  if (ext !== ".json") {
    return [];
  }

  const text = decodeUtf8(bytes);
  if (text === null) {
    return [
      `non-markdown consistency warning: ${filePath}: invalid UTF-8 JSON text`,
    ];
  }

  try {
    JSON.parse(text);
  } catch (error) {
    const reason = compactReason(error);
    return [
      `non-markdown consistency warning: ${filePath}: invalid JSON: ${reason}`,
    ];
  }

  return [];
}

function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function isSameBytes(left: Uint8Array, right: Uint8Array): boolean {
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

function compactReason(error: unknown): string {
  if (error instanceof Error) {
    return error.message.replaceAll(/\s+/gu, " ").trim();
  }
  return String(error).replaceAll(/\s+/gu, " ").trim();
}

function normalizeNonNegativeInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value;
}

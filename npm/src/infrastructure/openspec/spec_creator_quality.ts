import path from "node:path";

export type SpecCreatorGuardPhase = "post-generate" | "post-run";

export interface SpecCreatorArtifactPaths {
  proposalPath: string;
  tasksPath: string;
  designPath: string;
  codeSummaryPath: string;
  deltaSpecPath: string;
}

export interface SpecCreatorQualityViolation {
  rule_id: string;
  file: string;
  line: number;
  message: string;
}

interface LoadedArtifacts {
  proposal: string;
  tasks: string;
  design: string;
  codeSummary: string;
  spec: string;
}

interface TaskSection {
  startLine: number;
  text: string;
}

const RUN_CONFIG_PATTERN = /run\s+--config/iu;
const COMPILE_ERROR_PATTERN = /compile error/iu;
const PERSONA_DIR_PATTERN = /--persona-dir/iu;
const BLOCKED_IMMEDIATE_PATTERN = /即時\s*blocked|immediate(?:ly)?\s+blocked/iu;
const BLOCKED_WAIT_ALL_PATTERN =
  /(?:全員|全件|全担当).*(?:結果).*(?:取得|回収)|wait(?:s|ing)?\s+for\s+all\s+results/iu;

export function assertSpecCreatorSemanticContracts(
  paths: SpecCreatorArtifactPaths,
  phase: SpecCreatorGuardPhase,
): void {
  const violations = collectSpecCreatorQualityViolations(paths);
  if (violations.length === 0) {
    return;
  }
  const details = violations
    .map((violation) =>
      `${toRelativePath(violation.file)}:${violation.line}:${violation.rule_id}:${violation.message}`
    )
    .join("; ");
  throw new Error(`spec-creator ${phase} semantic guard failed (${details})`);
}

export function collectSpecCreatorQualityViolations(
  paths: SpecCreatorArtifactPaths,
): SpecCreatorQualityViolation[] {
  const artifacts = loadArtifacts(paths);
  const violations: SpecCreatorQualityViolation[] = [];
  const combined = [
    artifacts.proposal,
    artifacts.tasks,
    artifacts.design,
    artifacts.codeSummary,
    artifacts.spec,
  ].join("\n");

  pushRunConfigCompileConflict(violations, paths.deltaSpecPath, artifacts.spec);
  pushBlockedTimingConflict(violations, paths.deltaSpecPath, artifacts.spec);
  pushWrongTaskConfigKey(violations, paths.deltaSpecPath, artifacts.spec);
  pushTask14BlockedTestConflict(violations, paths.tasksPath, artifacts.tasks);
  pushTask15SendbackAmbiguity(violations, paths.tasksPath, artifacts.tasks);

  if (PERSONA_DIR_PATTERN.test(combined)) {
    pushRunSpecCreatorCoverage(violations, paths, artifacts);
    pushPersonaDirFormatContract(violations, paths, artifacts);
    pushCustomPersonaAssignmentCoverage(violations, paths, artifacts);
  }

  return violations;
}

function pushRunSpecCreatorCoverage(
  violations: SpecCreatorQualityViolation[],
  paths: SpecCreatorArtifactPaths,
  artifacts: LoadedArtifacts,
): void {
  const scope = `${artifacts.proposal}\n${artifacts.design}\n${artifacts.tasks}`;
  const hasRun = /\brun\b/iu.test(scope);
  const hasSpecCreator = /spec-creator/iu.test(scope);
  if (hasRun && hasSpecCreator) {
    return;
  }
  violations.push({
    rule_id: "path_coverage",
    file: paths.proposalPath,
    line: firstMatchLine(artifacts.proposal, PERSONA_DIR_PATTERN) ?? 1,
    message: "requirements must explicitly cover both run and spec-creator paths",
  });
}

function pushRunConfigCompileConflict(
  violations: SpecCreatorQualityViolation[],
  specPath: string,
  specText: string,
): void {
  const lines = specText.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    if (!RUN_CONFIG_PATTERN.test(lines[index])) {
      continue;
    }
    const end = Math.min(lines.length, index + 6);
    for (let cursor = index; cursor < end; cursor += 1) {
      if (COMPILE_ERROR_PATTERN.test(lines[cursor])) {
        violations.push({
          rule_id: "stage_contract",
          file: specPath,
          line: cursor + 1,
          message:
            "run --config scenario must not require compile error (use runtime validation error)",
        });
        return;
      }
    }
  }
}

function pushBlockedTimingConflict(
  violations: SpecCreatorQualityViolation[],
  specPath: string,
  specText: string,
): void {
  if (
    !BLOCKED_IMMEDIATE_PATTERN.test(specText) ||
    !BLOCKED_WAIT_ALL_PATTERN.test(specText)
  ) {
    return;
  }
  violations.push({
    rule_id: "judgment_timing",
    file: specPath,
    line: firstMatchLine(specText, BLOCKED_WAIT_ALL_PATTERN) ?? 1,
    message: "blocked timing is contradictory (wait-all and immediate coexist)",
  });
}

function pushPersonaDirFormatContract(
  violations: SpecCreatorQualityViolation[],
  paths: SpecCreatorArtifactPaths,
  artifacts: LoadedArtifacts,
): void {
  const scope = `${artifacts.spec}\n${artifacts.design}`;
  const hasPersonasJson = /personas\.json/iu.test(scope);
  const hasArraySchema = /JSON配列|json array/iu.test(scope);
  const hasMissingContract = /不在|missing|not found/iu.test(scope);
  const hasParseContract = /パース|parse|invalid json/iu.test(scope);
  const hasSchemaContract = /スキーマ|schema/iu.test(scope);
  if (
    hasPersonasJson &&
    hasArraySchema &&
    hasMissingContract &&
    hasParseContract &&
    hasSchemaContract
  ) {
    return;
  }
  violations.push({
    rule_id: "input_contract",
    file: paths.deltaSpecPath,
    line: firstMatchLine(artifacts.spec, PERSONA_DIR_PATTERN) ?? 1,
    message:
      "persona-dir contract must fix file path, schema, and fail-closed conditions",
  });
}

function pushTask14BlockedTestConflict(
  violations: SpecCreatorQualityViolation[],
  tasksPath: string,
  tasksText: string,
): void {
  const section = findTaskSection(tasksText, "1.4");
  if (section === null) {
    return;
  }
  const hasImmediateBlocked = BLOCKED_IMMEDIATE_PATTERN.test(section.text);
  const hasMixedRound =
    /(blocked\s*\/\s*changes_required\s*\/\s*pass)/iu.test(section.text) ||
    /1\s*blocked.*1\s*changes_required.*1\s*pass/iu.test(section.text);
  if (!hasImmediateBlocked || !hasMixedRound) {
    return;
  }
  violations.push({
    rule_id: "test_contract",
    file: tasksPath,
    line: section.startLine,
    message:
      "task 1.4 test must not mix blocked/changes_required/pass in one immediate-blocked round",
  });
}

function pushWrongTaskConfigKey(
  violations: SpecCreatorQualityViolation[],
  specPath: string,
  specText: string,
): void {
  const line = firstMatchLine(specText, /task_config\.review/iu);
  if (line === null) {
    return;
  }
  violations.push({
    rule_id: "data_model_key",
    file: specPath,
    line,
    message:
      "use task_config.persona_policy.phase_overrides.<phase>.executor_personas",
  });
}

function pushTask15SendbackAmbiguity(
  violations: SpecCreatorQualityViolation[],
  tasksPath: string,
  tasksText: string,
): void {
  const section = findTaskSection(tasksText, "1.5");
  if (section === null) {
    return;
  }
  const hasWaitAllWording = /全件回収|全担当.*回収|all.*results.*collect/iu.test(
    section.text,
  );
  const hasBlockedGuard =
    /blocked\s*=\s*false/iu.test(section.text) ||
    /blocked\s*がない/u.test(section.text) ||
    /blocked\s*なし/u.test(section.text);
  if (!hasWaitAllWording || hasBlockedGuard) {
    return;
  }
  violations.push({
    rule_id: "transition_condition",
    file: tasksPath,
    line: section.startLine,
    message: "task 1.5 sendback must declare blocked=false precondition",
  });
}

function pushCustomPersonaAssignmentCoverage(
  violations: SpecCreatorQualityViolation[],
  paths: SpecCreatorArtifactPaths,
  artifacts: LoadedArtifacts,
): void {
  const scope = `${artifacts.spec}\n${artifacts.tasks}`;
  const hasCustomPersona = /custom-reviewer|custom persona|カスタムペルソナ/iu.test(
    scope,
  );
  const hasAssignment = /executor_personas/iu.test(scope);
  if (hasCustomPersona && hasAssignment) {
    return;
  }
  violations.push({
    rule_id: "assignment_coverage",
    file: paths.deltaSpecPath,
    line: firstMatchLine(artifacts.spec, PERSONA_DIR_PATTERN) ?? 1,
    message:
      "requirements must include custom persona assignment acceptance scenario",
  });
}

function loadArtifacts(paths: SpecCreatorArtifactPaths): LoadedArtifacts {
  return {
    proposal: readText(paths.proposalPath),
    tasks: readText(paths.tasksPath),
    design: readText(paths.designPath),
    codeSummary: readText(paths.codeSummaryPath),
    spec: readText(paths.deltaSpecPath),
  };
}

function readText(filePath: string): string {
  try {
    return Deno.readTextFileSync(filePath);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`failed to read artifact ${filePath}: ${reason}`);
  }
}

function findTaskSection(markdown: string, taskId: string): TaskSection | null {
  const lines = markdown.split(/\r?\n/u);
  const startPattern = new RegExp(
    `^\\s*-\\s*\\[[ xX]\\]\\s*${escapeRegExp(taskId)}\\b`,
    "u",
  );
  const anotherTaskPattern = /^\s*-\s*\[[ xX]\]\s*\S+/u;
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
    if (anotherTaskPattern.test(lines[index])) {
      end = index;
      break;
    }
  }
  return {
    startLine: start + 1,
    text: lines.slice(start, end).join("\n"),
  };
}

function firstMatchLine(text: string, pattern: RegExp): number | null {
  const lines = text.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    if (pattern.test(lines[index])) {
      return index + 1;
    }
  }
  return null;
}

function toRelativePath(filePath: string): string {
  const relative = path.relative(Deno.cwd(), filePath);
  return relative.length > 0 ? relative : filePath;
}

function escapeRegExp(input: string): string {
  return input.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

import path from "node:path";

export type SpecCreatorGuardPhase = "post-generate" | "post-run";

export interface SpecCreatorArtifactPaths {
  changeDir?: string;
  proposalPath: string;
  tasksPath: string;
  designPath: string;
  codeSummaryPath: string;
  deltaSpecPath: string;
  deltaSpecPaths?: string[];
}

export type SpecCreatorPolishMode = "preserve-supplement" | "regenerate";

export interface SpecCreatorQualityOptions {
  emitReviewContractToArtifacts?: boolean;
  polishMode?: SpecCreatorPolishMode;
  sourcePaths?: SpecCreatorArtifactPaths;
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
  specs: Array<{ path: string; text: string }>;
}

interface TaskSection {
  taskId: string;
  startLine: number;
  text: string;
}

interface CodeSummaryTaskSection {
  taskId: string;
  startLine: number;
  text: string;
}

const RUN_CONFIG_PATTERN = /run\s+--config/iu;
const COMPILE_ERROR_PATTERN = /compile error/iu;
const PERSONA_DIR_PATTERN = /--persona-dir/iu;
const BLOCKED_IMMEDIATE_PATTERN = /即時\s*blocked|immediate(?:ly)?\s+blocked/iu;
const BLOCKED_WAIT_ALL_PATTERN =
  /(?:全員|全件|全担当).*(?:結果).*(?:取得|回収)|wait(?:s|ing)?\s+for\s+all\s+results/iu;
const DESIGN_OPTIONAL_PATTERN =
  /design\.md.*(?:必要時|必要な場合|必要に応じて|only when|required|as needed)/iu;
const DESIGN_BATCH_TARGET_PATTERN =
  /proposal(?:\.md)?[^。\n]*design(?:\.md)?[^。\n]*tasks(?:\.md)?[^。\n]*code_summary(?:\.md)?/iu;
const DESIGN_BATCH_ACTION_PATTERN =
  /一括(?:受領|生成|再生成|更新)|single context pass|all target artifacts|complete rewritten files/iu;
const DESIGN_BATCH_SHORTCUT_PATTERN =
  /proposal\/design\/tasks\/code_summary\/spec\.md/iu;
export const REQUIRED_REVIEW_CONTRACT_IDS = [
  "RC-01",
  "RC-02",
  "RC-03",
  "RC-04",
  "RC-05",
  "RC-06",
  "RC-07",
  "RC-08",
  "RC-09",
  "RC-10",
  "RC-11",
  "RC-12",
] as const;
const REVIEW_CONTRACT_ID_PATTERN = /\bRC-(?:0[1-9]|1[0-2])\b/gu;
const TASK_TARGET_PATHS_PATTERN =
  /^\s*-\s*(?:対象|Target paths)\s*:\s*(.+?)\s*$/imu;
const NOTIFICATION_PATTERN = /通知|notify|notification|alert|webhook/iu;
const SCENARIO_HEADER_PATTERN = /^####\s+(?:Scenario\b|シナリオ\b)/iu;
const REQUIREMENT_HEADER_PATTERN = /^###\s+(?:Requirement\b|要件\b)/iu;
const VALIDATION_INTENT_PATTERNS = [
  { id: "unit", pattern: /\bunit(?:\s+tests?)?\b|単体テスト/u },
  {
    id: "integration",
    pattern: /\bintegration(?:\s+tests?)?\b|結合テスト|統合テスト/u,
  },
  { id: "lint", pattern: /\blint(?:ing)?\b|静的解析/u },
  { id: "regression", pattern: /\bregression\b|回帰/u },
] as const;

export function assertSpecCreatorSemanticContracts(
  paths: SpecCreatorArtifactPaths,
  phase: SpecCreatorGuardPhase,
  options: SpecCreatorQualityOptions = {},
): void {
  const violations = collectSpecCreatorQualityViolations(paths, options);
  if (violations.length === 0) {
    return;
  }
  const details = violations
    .map((violation) =>
      `${
        toRelativePath(violation.file)
      }:${violation.line}:${violation.rule_id}:${violation.message}`
    )
    .join("; ");
  throw new Error(`spec-creator ${phase} semantic guard failed (${details})`);
}

export function collectSpecCreatorQualityViolations(
  paths: SpecCreatorArtifactPaths,
  options: SpecCreatorQualityOptions = {},
): SpecCreatorQualityViolation[] {
  const emitReviewContractToArtifacts =
    options.emitReviewContractToArtifacts ?? true;
  const artifacts = loadArtifacts(paths);
  const violations: SpecCreatorQualityViolation[] = [];
  const allSpecText = artifacts.specs.map((item) => item.text).join("\n");
  const combined = [
    artifacts.proposal,
    artifacts.tasks,
    artifacts.design,
    artifacts.codeSummary,
    allSpecText,
  ].join("\n");

  for (const specArtifact of artifacts.specs) {
    pushRunConfigCompileConflict(
      violations,
      specArtifact.path,
      specArtifact.text,
    );
    pushBlockedTimingConflict(violations, specArtifact.path, specArtifact.text);
    pushWrongTaskConfigKey(violations, specArtifact.path, specArtifact.text);
  }
  pushTask14BlockedTestConflict(violations, paths.tasksPath, artifacts.tasks);
  pushTask15SendbackAmbiguity(violations, paths.tasksPath, artifacts.tasks);
  pushTaskPhaseOrderCoverage(violations, paths.tasksPath, artifacts.tasks);
  pushDesignGenerationConsistency(
    violations,
    paths.proposalPath,
    artifacts.proposal,
  );
  if (emitReviewContractToArtifacts) {
    pushRequiredReviewContractCoverage(violations, paths, artifacts);
    pushReviewContractTraceability(violations, paths, artifacts);
  }
  if (options.polishMode === "preserve-supplement") {
    pushPreserveSupplementRegressionGuards(
      violations,
      paths,
      artifacts,
      options.sourcePaths,
    );
  }

  if (PERSONA_DIR_PATTERN.test(combined)) {
    pushRunSpecCreatorCoverage(violations, paths, artifacts);
    pushPersonaDirFormatContract(violations, paths, artifacts);
    pushCustomPersonaAssignmentCoverage(violations, paths, artifacts);
  }

  return violations;
}

function pushDesignGenerationConsistency(
  violations: SpecCreatorQualityViolation[],
  proposalPath: string,
  proposalText: string,
): void {
  if (!DESIGN_OPTIONAL_PATTERN.test(proposalText)) {
    return;
  }
  const lines = proposalText.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const hasBatchTarget = DESIGN_BATCH_TARGET_PATTERN.test(line) ||
      DESIGN_BATCH_SHORTCUT_PATTERN.test(line);
    if (!hasBatchTarget) {
      continue;
    }
    if (!DESIGN_BATCH_ACTION_PATTERN.test(line)) {
      continue;
    }
    violations.push({
      rule_id: "design_generation_mode",
      file: proposalPath,
      line: index + 1,
      message:
        "proposal must not mix `design.md required-only` with always-included batch regeneration wording",
    });
    return;
  }
}

function pushRunSpecCreatorCoverage(
  violations: SpecCreatorQualityViolation[],
  paths: SpecCreatorArtifactPaths,
  artifacts: LoadedArtifacts,
): void {
  const scope =
    `${artifacts.proposal}\n${artifacts.design}\n${artifacts.tasks}`;
  const hasRun = /\brun\b/iu.test(scope);
  const hasSpecCreator = /spec-creator/iu.test(scope);
  if (hasRun && hasSpecCreator) {
    return;
  }
  violations.push({
    rule_id: "path_coverage",
    file: paths.proposalPath,
    line: firstMatchLine(artifacts.proposal, PERSONA_DIR_PATTERN) ?? 1,
    message:
      "requirements must explicitly cover both run and spec-creator paths",
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
  const scope = `${
    artifacts.specs.map((item) => item.text).join("\n")
  }\n${artifacts.design}`;
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
    file: firstDeltaSpecPath(paths),
    line: firstMatchLine(scope, PERSONA_DIR_PATTERN) ?? 1,
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
  const hasWaitAllWording = /全件回収|全担当.*回収|all.*results.*collect/iu
    .test(
      section.text,
    );
  const hasBlockedGuard = /blocked\s*=\s*false/iu.test(section.text) ||
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

function pushTaskPhaseOrderCoverage(
  violations: SpecCreatorQualityViolation[],
  tasksPath: string,
  tasksText: string,
): void {
  const sections = findAllTaskSections(tasksText);
  for (const section of sections) {
    const phaseOrderValidation = validateTaskPhaseOrderInSection(section.text);
    if (phaseOrderValidation === null) {
      continue;
    }
    violations.push({
      rule_id: "phase_order_coverage",
      file: tasksPath,
      line: section.startLine,
      message:
        `task ${section.taskId} must declare persona_policy.phase_order (${phaseOrderValidation})`,
    });
  }
}

function validateTaskPhaseOrderInSection(sectionText: string): string | null {
  const lines = sectionText.split(/\r?\n/u);
  const personaPolicyLine = lines.find((line) =>
    /^\s*-\s*persona_policy\s*:/u.test(line)
  );
  if (personaPolicyLine === undefined) {
    return "missing persona_policy line";
  }
  const jsonMatch = /^\s*-\s*persona_policy\s*:\s*(.+?)\s*$/u.exec(
    personaPolicyLine,
  );
  if (!jsonMatch) {
    return "invalid persona_policy syntax";
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[1]);
  } catch {
    return "persona_policy is not valid JSON";
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return "persona_policy must be object JSON";
  }

  const phaseOrder = (parsed as { phase_order?: unknown }).phase_order;
  if (!Array.isArray(phaseOrder) || phaseOrder.length === 0) {
    return "phase_order must be non-empty array";
  }

  const normalized = phaseOrder
    .map((phase) => String(phase).trim())
    .filter((phase) => phase.length > 0);
  if (!normalized.includes("implement")) {
    return "phase_order must include implement";
  }
  return null;
}

function pushCustomPersonaAssignmentCoverage(
  violations: SpecCreatorQualityViolation[],
  paths: SpecCreatorArtifactPaths,
  artifacts: LoadedArtifacts,
): void {
  const scope = `${
    artifacts.specs.map((item) => item.text).join("\n")
  }\n${artifacts.tasks}`;
  const hasCustomPersona = /custom-reviewer|custom persona|カスタムペルソナ/iu
    .test(
      scope,
    );
  const hasAssignment = /executor_personas/iu.test(scope);
  if (hasCustomPersona && hasAssignment) {
    return;
  }
  violations.push({
    rule_id: "assignment_coverage",
    file: firstDeltaSpecPath(paths),
    line: firstMatchLine(scope, PERSONA_DIR_PATTERN) ?? 1,
    message:
      "requirements must include custom persona assignment acceptance scenario",
  });
}

function pushRequiredReviewContractCoverage(
  violations: SpecCreatorQualityViolation[],
  paths: SpecCreatorArtifactPaths,
  artifacts: LoadedArtifacts,
): void {
  const task13Section = findTaskSection(artifacts.tasks, "1.3");
  if (task13Section === null) {
    violations.push({
      rule_id: "review_contract_coverage",
      file: paths.tasksPath,
      line: 1,
      message:
        "tasks.md must include task 1.3 and mirror RC-01..RC-12 with spec.md",
    });
    return;
  }

  const taskContractIds = collectReviewContractIds(task13Section.text);
  const specsMergedText = artifacts.specs.map((item) => item.text).join("\n");
  const specContractIds = collectReviewContractIds(specsMergedText);
  const missingInTasks = REQUIRED_REVIEW_CONTRACT_IDS.filter((id) =>
    !taskContractIds.has(id)
  );
  const missingInSpecs = REQUIRED_REVIEW_CONTRACT_IDS.filter((id) =>
    !specContractIds.has(id)
  );

  if (missingInTasks.length === 0 && missingInSpecs.length === 0) {
    return;
  }

  const messageParts: string[] = [];
  if (missingInTasks.length > 0) {
    messageParts.push(
      `missing in tasks.md task 1.3: ${missingInTasks.join(", ")}`,
    );
  }
  if (missingInSpecs.length > 0) {
    messageParts.push(
      `missing in specs: ${missingInSpecs.join(", ")}`,
    );
  }

  const primaryMissingInTasks = missingInTasks.length > 0;
  violations.push({
    rule_id: "review_contract_coverage",
    file: primaryMissingInTasks ? paths.tasksPath : firstDeltaSpecPath(paths),
    line: primaryMissingInTasks ? task13Section.startLine : 1,
    message:
      `RC-01..RC-12 must be mirrored in tasks.md(1.3) and specs/**/spec.md (${
        messageParts.join("; ")
      })`,
  });
}

function pushReviewContractTraceability(
  violations: SpecCreatorQualityViolation[],
  paths: SpecCreatorArtifactPaths,
  artifacts: LoadedArtifacts,
): void {
  const task13Section = findTaskSection(artifacts.tasks, "1.3");
  const codeSummaryTask13Section = findCodeSummaryTaskSection(
    artifacts.codeSummary,
    "1.3",
  );

  const missingInTasks = task13Section === null
    ? [...REQUIRED_REVIEW_CONTRACT_IDS]
    : collectMissingReviewTraceabilityIds(task13Section.text);
  const missingInCodeSummary = codeSummaryTask13Section === null
    ? [...REQUIRED_REVIEW_CONTRACT_IDS]
    : collectMissingReviewTraceabilityIds(codeSummaryTask13Section.text);

  if (missingInTasks.length === 0 && missingInCodeSummary.length === 0) {
    return;
  }

  const messageParts: string[] = [];
  if (missingInTasks.length > 0) {
    messageParts.push(
      `missing in tasks.md task 1.3: ${missingInTasks.join(", ")}`,
    );
  }
  if (missingInCodeSummary.length > 0) {
    messageParts.push(
      `missing in code_summary.md task_id:1.3: ${
        missingInCodeSummary.join(", ")
      }`,
    );
  }

  const primaryMissingInTasks = missingInTasks.length > 0;
  violations.push({
    rule_id: "review_contract_traceability",
    file: primaryMissingInTasks ? paths.tasksPath : paths.codeSummaryPath,
    line: primaryMissingInTasks
      ? (task13Section?.startLine ?? 1)
      : (codeSummaryTask13Section?.startLine ?? 1),
    message:
      `RC-01..RC-12 must declare transport/reject/path_test/reject_test in tasks.md(1.3) and code_summary.md(task_id:1.3) (${
        messageParts.join("; ")
      })`,
  });
}

function pushPreserveSupplementRegressionGuards(
  violations: SpecCreatorQualityViolation[],
  paths: SpecCreatorArtifactPaths,
  artifacts: LoadedArtifacts,
  sourcePaths: SpecCreatorArtifactPaths | undefined,
): void {
  if (sourcePaths === undefined) {
    return;
  }
  const sourceArtifacts = loadArtifactsForComparison(sourcePaths);
  pushCapabilityPathDrift(
    violations,
    paths,
    sourcePaths,
  );
  pushTaskScopeRegression(
    violations,
    paths,
    artifacts,
    sourceArtifacts,
  );
  pushValidationStrengthRegression(
    violations,
    paths,
    artifacts,
    sourceArtifacts,
  );
  pushScenarioStrengthRegression(
    violations,
    paths,
    artifacts,
    sourceArtifacts,
  );
}

function pushCapabilityPathDrift(
  violations: SpecCreatorQualityViolation[],
  paths: SpecCreatorArtifactPaths,
  sourcePaths: SpecCreatorArtifactPaths,
): void {
  const source = collectSpecRelativePathSet(sourcePaths, { existingOnly: true });
  if (source.length === 0) {
    return;
  }
  const revised = collectSpecRelativePathSet(paths, { existingOnly: true });
  if (revised.length === source.length) {
    let differs = false;
    for (let index = 0; index < source.length; index += 1) {
      if (source[index] !== revised[index]) {
        differs = true;
        break;
      }
    }
    if (!differs) {
      return;
    }
  }

  const revisedSet = new Set(revised);
  const sourceSet = new Set(source);
  const missing = source.filter((item) => !revisedSet.has(item));
  const extra = revised.filter((item) => !sourceSet.has(item));
  const details: string[] = [];
  if (missing.length > 0) {
    details.push(`missing: ${missing.join(", ")}`);
  }
  if (extra.length > 0) {
    details.push(`extra: ${extra.join(", ")}`);
  }
  violations.push({
    rule_id: "capability_path_drift",
    file: firstDeltaSpecPath(paths),
    line: 1,
    message:
      `preserve-supplement must keep specs/**/spec.md relative path set aligned with source change (${
        details.join("; ")
      })`,
  });
}

function pushTaskScopeRegression(
  violations: SpecCreatorQualityViolation[],
  paths: SpecCreatorArtifactPaths,
  artifacts: LoadedArtifacts,
  sourceArtifacts: LoadedArtifacts,
): void {
  const sourceImplementationCount = countImplementationTaskTargets(
    sourceArtifacts.tasks,
  );
  if (sourceImplementationCount <= 0) {
    return;
  }
  const revisedImplementationCount = countImplementationTaskTargets(
    artifacts.tasks,
  );
  if (revisedImplementationCount > 0) {
    return;
  }
  violations.push({
    rule_id: "task_scope_regression",
    file: paths.tasksPath,
    line: 1,
    message:
      `implementation target paths disappeared into doc-only scope (${sourceImplementationCount} -> ${revisedImplementationCount})`,
  });
}

function countImplementationTaskTargets(tasksText: string): number {
  const sections = findAllTaskSections(tasksText);
  let count = 0;
  for (const section of sections) {
    const targetLine = TASK_TARGET_PATHS_PATTERN.exec(section.text)?.[1] ?? "";
    TASK_TARGET_PATHS_PATTERN.lastIndex = 0;
    if (targetLine.length === 0) {
      continue;
    }
    const targets = targetLine.split(",").map((item) => item.trim()).filter((
      item,
    ) => item.length > 0);
    if (targets.some((item) => isImplementationTargetPath(item))) {
      count += 1;
    }
  }
  return count;
}

function isImplementationTargetPath(target: string): boolean {
  const normalized = target.trim().toLowerCase();
  if (
    normalized.length === 0 ||
    normalized === "none" ||
    normalized === "(none)" ||
    normalized === "なし"
  ) {
    return false;
  }
  if (normalized === "*") {
    return true;
  }
  if (normalized.endsWith(".md") || normalized.endsWith("/**/spec.md")) {
    return false;
  }
  return true;
}

function pushValidationStrengthRegression(
  violations: SpecCreatorQualityViolation[],
  paths: SpecCreatorArtifactPaths,
  artifacts: LoadedArtifacts,
  sourceArtifacts: LoadedArtifacts,
): void {
  const sourceText = joinArtifactsForRegressionScan(sourceArtifacts);
  const revisedText = joinArtifactsForRegressionScan(artifacts);
  const missingIntents = VALIDATION_INTENT_PATTERNS.filter((item) =>
    item.pattern.test(sourceText) && !item.pattern.test(revisedText)
  ).map((item) => item.id);
  if (missingIntents.length === 0) {
    return;
  }
  violations.push({
    rule_id: "validation_strength_regression",
    file: paths.tasksPath,
    line: 1,
    message:
      `explicit validation intents were removed: ${missingIntents.join(", ")}`,
  });
}

function pushScenarioStrengthRegression(
  violations: SpecCreatorQualityViolation[],
  paths: SpecCreatorArtifactPaths,
  artifacts: LoadedArtifacts,
  sourceArtifacts: LoadedArtifacts,
): void {
  const sourceSpecText = sourceArtifacts.specs.map((item) => item.text).join(
    "\n",
  );
  const sourceLine = findNotificationScenarioLine(sourceSpecText);
  if (sourceLine === null) {
    return;
  }
  const revisedSpecText = artifacts.specs.map((item) => item.text).join("\n");
  if (findNotificationScenarioLine(revisedSpecText) !== null) {
    return;
  }
  violations.push({
    rule_id: "scenario_strength_regression",
    file: firstDeltaSpecPath(paths),
    line: sourceLine,
    message:
      "explicit notification scenario wording was weakened or removed",
  });
}

function findNotificationScenarioLine(text: string): number | null {
  const lines = text.split(/\r?\n/u);
  let insideScenario = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (SCENARIO_HEADER_PATTERN.test(line)) {
      insideScenario = true;
      continue;
    }
    if (insideScenario && REQUIREMENT_HEADER_PATTERN.test(line)) {
      insideScenario = false;
      continue;
    }
    if (!insideScenario) {
      continue;
    }
    if (NOTIFICATION_PATTERN.test(line)) {
      return index + 1;
    }
  }
  return null;
}

function collectSpecRelativePathSet(
  paths: SpecCreatorArtifactPaths,
  options: {
    existingOnly?: boolean;
  } = {},
): string[] {
  const baseDir = typeof paths.changeDir === "string"
    ? path.resolve(paths.changeDir)
    : null;
  const candidates = options.existingOnly
    ? allDeltaSpecPaths(paths).filter((specPath) => isFile(specPath))
    : allDeltaSpecPaths(paths);
  const normalized = candidates.map((specPath) =>
    normalizeSpecRelativePath(specPath, baseDir)
  );
  const unique = [...new Set(normalized)];
  unique.sort((left, right) => left.localeCompare(right));
  return unique;
}

function isFile(filePath: string): boolean {
  try {
    return Deno.statSync(filePath).isFile;
  } catch {
    return false;
  }
}

function normalizeSpecRelativePath(specPath: string, changeDir: string | null): string {
  const resolved = path.resolve(specPath);
  if (changeDir !== null) {
    const relative = path.relative(changeDir, resolved);
    if (
      relative.length > 0 &&
      relative !== "." &&
      !relative.startsWith("..") &&
      !path.isAbsolute(relative)
    ) {
      return relative.replaceAll("\\", "/");
    }
  }
  const normalized = resolved.replaceAll("\\", "/");
  const marker = "/specs/";
  const markerIndex = normalized.lastIndexOf(marker);
  if (markerIndex >= 0) {
    return normalized.slice(markerIndex + 1);
  }
  return path.basename(resolved);
}

function joinArtifactsForRegressionScan(artifacts: LoadedArtifacts): string {
  return [
    artifacts.proposal,
    artifacts.tasks,
    artifacts.design,
    artifacts.codeSummary,
    ...artifacts.specs.map((item) => item.text),
  ].join("\n");
}

function loadArtifacts(paths: SpecCreatorArtifactPaths): LoadedArtifacts {
  const specs = allDeltaSpecPaths(paths).map((specPath) => ({
    path: specPath,
    text: readText(specPath),
  }));
  return {
    proposal: readText(paths.proposalPath),
    tasks: readText(paths.tasksPath),
    design: readTextOptional(paths.designPath),
    codeSummary: readText(paths.codeSummaryPath),
    specs,
  };
}

function loadArtifactsForComparison(
  paths: SpecCreatorArtifactPaths,
): LoadedArtifacts {
  const specs = allDeltaSpecPaths(paths).map((specPath) => ({
    path: specPath,
    text: readTextOptional(specPath),
  }));
  return {
    proposal: readTextOptional(paths.proposalPath),
    tasks: readTextOptional(paths.tasksPath),
    design: readTextOptional(paths.designPath),
    codeSummary: readTextOptional(paths.codeSummaryPath),
    specs,
  };
}

function allDeltaSpecPaths(paths: SpecCreatorArtifactPaths): string[] {
  const merged = [
    ...(Array.isArray(paths.deltaSpecPaths) ? paths.deltaSpecPaths : []),
    paths.deltaSpecPath,
  ];
  const unique = [...new Set(merged.filter((item) => item.length > 0))];
  unique.sort((left, right) => left.localeCompare(right));
  return unique;
}

function firstDeltaSpecPath(paths: SpecCreatorArtifactPaths): string {
  const all = allDeltaSpecPaths(paths);
  return all[0] ?? paths.deltaSpecPath;
}

function readText(filePath: string): string {
  try {
    return Deno.readTextFileSync(filePath);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`failed to read artifact ${filePath}: ${reason}`);
  }
}

function readTextOptional(filePath: string): string {
  try {
    return Deno.readTextFileSync(filePath);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return "";
    }
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`failed to read artifact ${filePath}: ${reason}`);
  }
}

function findTaskSection(markdown: string, taskId: string): TaskSection | null {
  return findAllTaskSections(markdown).find((section) =>
    section.taskId === taskId
  ) ??
    null;
}

function findAllTaskSections(markdown: string): TaskSection[] {
  const lines = markdown.split(/\r?\n/u);
  const taskPattern =
    /^\s*-\s*\[[ xX]\]\s*((?:T-[A-Za-z0-9_-]+|TASK-[A-Za-z0-9_-]+|\d+(?:\.\d+)*))\b/iu;
  const sections: TaskSection[] = [];
  let start = -1;
  let currentTaskId = "";

  for (let index = 0; index < lines.length; index += 1) {
    const matched = taskPattern.exec(lines[index]);
    if (matched === null) {
      continue;
    }
    if (start >= 0) {
      sections.push({
        taskId: currentTaskId,
        startLine: start + 1,
        text: lines.slice(start, index).join("\n"),
      });
    }
    start = index;
    currentTaskId = matched[1];
  }
  if (start >= 0) {
    sections.push({
      taskId: currentTaskId,
      startLine: start + 1,
      text: lines.slice(start).join("\n"),
    });
  }
  return sections;
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

function collectMissingReviewTraceabilityIds(text: string): string[] {
  return REQUIRED_REVIEW_CONTRACT_IDS.filter((id) => {
    const tracePattern = new RegExp(
      `${
        escapeRegex(id)
      }[^\\n]*\\btransport\\s*:[^\\n]*\\breject\\s*:[^\\n]*\\bpath_test\\s*:[^\\n]*\\breject_test\\s*:`,
      "iu",
    );
    return !tracePattern.test(text);
  });
}

function findCodeSummaryTaskSection(
  markdown: string,
  taskId: string,
): CodeSummaryTaskSection | null {
  const lines = markdown.split(/\r?\n/u);
  const sectionPattern = /^##\s+task_id:\s*(\S+)\s*$/u;
  const sectionStartPattern = /^##\s+task_id:\s*\S+/u;
  let start = -1;
  let currentTaskId = "";

  for (let index = 0; index < lines.length; index += 1) {
    const matched = sectionPattern.exec(lines[index]);
    if (matched === null) {
      continue;
    }
    if (start >= 0 && currentTaskId === taskId) {
      return {
        taskId: currentTaskId,
        startLine: start + 1,
        text: lines.slice(start, index).join("\n"),
      };
    }
    start = index;
    currentTaskId = matched[1];
  }
  if (start >= 0 && currentTaskId === taskId) {
    return {
      taskId: currentTaskId,
      startLine: start + 1,
      text: lines.slice(start).join("\n"),
    };
  }
  if (!sectionStartPattern.test(markdown)) {
    return null;
  }
  return null;
}

function escapeRegex(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function toRelativePath(filePath: string): string {
  const relative = path.relative(Deno.cwd(), filePath);
  return relative.length > 0 ? relative : filePath;
}

function collectReviewContractIds(text: string): Set<string> {
  const ids = new Set<string>();
  const matches = text.matchAll(REVIEW_CONTRACT_ID_PATTERN);
  for (const match of matches) {
    ids.add(match[0]);
  }
  return ids;
}

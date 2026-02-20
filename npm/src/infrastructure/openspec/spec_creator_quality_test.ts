import path from "node:path";
import {
  collectSpecCreatorQualityViolations,
  type SpecCreatorArtifactPaths,
} from "./spec_creator_quality.ts";

const REQUIRED_REVIEW_CONTRACT_IDS = [
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
];
const REQUIRED_REVIEW_CONTRACT_IDS_TEXT = REQUIRED_REVIEW_CONTRACT_IDS.join(
  ", ",
);

function buildReviewTraceabilityLines(prefix: string): string[] {
  return REQUIRED_REVIEW_CONTRACT_IDS.map((id) =>
    `${prefix}${id} | transport: route coverage | reject: fail-closed gate | path_test: happy path | reject_test: rejection path`
  );
}

const DEFAULT_TASKS_TEXT = [
  "## 1. tasks",
  "- [ ] 1.3 result parser commonization",
  ...buildReviewTraceabilityLines("  - "),
  '  - persona_policy: {"phase_order":["implement","review"]}',
].join("\n");
const DEFAULT_DELTA_SPEC_TEXT = [
  "## ADDED Requirements",
  "### Requirement: baseline",
  "The system SHALL keep generated artifacts aligned.",
  "",
  "#### Scenario: baseline coverage",
  `- **THEN** ${REQUIRED_REVIEW_CONTRACT_IDS_TEXT}`,
].join("\n");

type ArtifactTextOverrides = Partial<
  Record<
    | "proposalPath"
    | "tasksPath"
    | "designPath"
    | "codeSummaryPath"
    | "deltaSpecPath",
    string
  >
>;

function withTempArtifacts(
  files: ArtifactTextOverrides,
  fn: (paths: SpecCreatorArtifactPaths) => void,
): void {
  const root = Deno.makeTempDirSync();
  try {
    const paths: SpecCreatorArtifactPaths = {
      proposalPath: `${root}/proposal.md`,
      tasksPath: `${root}/tasks.md`,
      designPath: `${root}/design.md`,
      codeSummaryPath: `${root}/code_summary.md`,
      deltaSpecPath: `${root}/spec.md`,
    };
    const defaults: Record<
      | "proposalPath"
      | "tasksPath"
      | "designPath"
      | "codeSummaryPath"
      | "deltaSpecPath",
      string
    > = {
      proposalPath: "# proposal\n",
      tasksPath: DEFAULT_TASKS_TEXT,
      designPath: "# design\n",
      codeSummaryPath: [
        "# code_summary",
        "",
        "## task_id: 1.3",
        "",
        ...buildReviewTraceabilityLines("- "),
      ].join("\n"),
      deltaSpecPath: DEFAULT_DELTA_SPEC_TEXT,
    };
    for (
      const key of Object.keys(paths) as Array<keyof SpecCreatorArtifactPaths>
    ) {
      if (key === "deltaSpecPaths") {
        continue;
      }
      const fileKey = key as keyof ArtifactTextOverrides;
      Deno.writeTextFileSync(
        paths[key] as string,
        files[fileKey] ?? defaults[fileKey],
      );
    }
    fn(paths);
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
}

function withTempArtifactsAndExtraSpecs(
  files: ArtifactTextOverrides,
  extraSpecs: Record<string, string>,
  fn: (paths: SpecCreatorArtifactPaths) => void,
): void {
  const root = Deno.makeTempDirSync();
  try {
    const paths: SpecCreatorArtifactPaths = {
      proposalPath: `${root}/proposal.md`,
      tasksPath: `${root}/tasks.md`,
      designPath: `${root}/design.md`,
      codeSummaryPath: `${root}/code_summary.md`,
      deltaSpecPath: `${root}/spec.md`,
      deltaSpecPaths: [`${root}/spec.md`],
    };
    const defaults: Record<
      | "proposalPath"
      | "tasksPath"
      | "designPath"
      | "codeSummaryPath"
      | "deltaSpecPath",
      string
    > = {
      proposalPath: "# proposal\n",
      tasksPath: DEFAULT_TASKS_TEXT,
      designPath: "# design\n",
      codeSummaryPath: [
        "# code_summary",
        "",
        "## task_id: 1.3",
        "",
        ...buildReviewTraceabilityLines("- "),
      ].join("\n"),
      deltaSpecPath: DEFAULT_DELTA_SPEC_TEXT,
    };
    for (
      const key of Object.keys(paths) as Array<keyof SpecCreatorArtifactPaths>
    ) {
      if (key === "deltaSpecPaths") {
        continue;
      }
      const fileKey = key as keyof ArtifactTextOverrides;
      Deno.writeTextFileSync(
        paths[key] as string,
        files[fileKey] ?? defaults[fileKey],
      );
    }
    for (const [relativePath, content] of Object.entries(extraSpecs)) {
      const specPath = `${root}/${relativePath}`;
      Deno.mkdirSync(path.dirname(specPath), {
        recursive: true,
      });
      Deno.writeTextFileSync(specPath, content);
      paths.deltaSpecPaths?.push(specPath);
    }
    fn(paths);
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
}

function writeArtifactsAt(
  root: string,
  files: {
    proposal: string;
    tasks: string;
    design: string;
    codeSummary: string;
    specs: Record<string, string>;
  },
): SpecCreatorArtifactPaths {
  const proposalPath = `${root}/proposal.md`;
  const tasksPath = `${root}/tasks.md`;
  const designPath = `${root}/design.md`;
  const codeSummaryPath = `${root}/code_summary.md`;
  Deno.mkdirSync(root, { recursive: true });
  Deno.writeTextFileSync(proposalPath, files.proposal);
  Deno.writeTextFileSync(tasksPath, files.tasks);
  Deno.writeTextFileSync(designPath, files.design);
  Deno.writeTextFileSync(codeSummaryPath, files.codeSummary);

  const specPaths = Object.entries(files.specs).map(([relative, content]) => {
    const specPath = `${root}/${relative}`;
    Deno.mkdirSync(path.dirname(specPath), { recursive: true });
    Deno.writeTextFileSync(specPath, content);
    return specPath;
  }).sort((left, right) => left.localeCompare(right));
  if (specPaths.length === 0) {
    throw new Error("writeArtifactsAt requires at least one spec file");
  }
  return {
    changeDir: root,
    proposalPath,
    tasksPath,
    designPath,
    codeSummaryPath,
    deltaSpecPath: specPaths[0],
    deltaSpecPaths: specPaths,
  };
}

function hasRule(
  violations: Array<{ rule_id: string }>,
  ruleId: string,
): boolean {
  return violations.some((violation) => violation.rule_id === ruleId);
}

Deno.test("quality guard detects run --config compile-error conflict", () => {
  withTempArtifacts({
    deltaSpecPath: [
      "#### Scenario: sample",
      "- GIVEN run --config uses task_config",
      "- THEN compile error",
    ].join("\n"),
  }, (paths) => {
    const violations = collectSpecCreatorQualityViolations(paths);
    if (!hasRule(violations, "stage_contract")) {
      throw new Error("expected stage_contract violation");
    }
  });
});

Deno.test("quality guard detects wrong task_config.review key", () => {
  withTempArtifacts({
    deltaSpecPath: "- GIVEN task_config.review includes [code-reviewer]\n",
  }, (paths) => {
    const violations = collectSpecCreatorQualityViolations(paths);
    if (!hasRule(violations, "data_model_key")) {
      throw new Error("expected data_model_key violation");
    }
  });
});

Deno.test("quality guard detects blocked timing contradiction", () => {
  withTempArtifacts({
    deltaSpecPath: [
      DEFAULT_DELTA_SPEC_TEXT,
      "",
      "system waits for all results before deciding blocked",
      "blocked is immediate blocked when one reviewer returns blocked",
    ].join("\n"),
  }, (paths) => {
    const violations = collectSpecCreatorQualityViolations(paths);
    if (!hasRule(violations, "judgment_timing")) {
      throw new Error("expected judgment_timing violation");
    }
  });
});

Deno.test("quality guard detects task 1.4 blocked test conflict", () => {
  withTempArtifacts({
    tasksPath: [
      "## 1. tasks",
      "- [ ] 1.3 review contract",
      `  - outcome: ${REQUIRED_REVIEW_CONTRACT_IDS_TEXT}`,
      "- [ ] 1.4 review flow",
      "  - outcome: immediate blocked",
      "  - test: 1 blocked/1 changes_required/1 pass in one round",
    ].join("\n"),
  }, (paths) => {
    const violations = collectSpecCreatorQualityViolations(paths);
    if (!hasRule(violations, "test_contract")) {
      throw new Error("expected test_contract violation");
    }
  });
});

Deno.test("quality guard detects task 1.5 sendback ambiguity", () => {
  withTempArtifacts({
    tasksPath: [
      "## 1. tasks",
      "- [ ] 1.3 review contract",
      `  - outcome: ${REQUIRED_REVIEW_CONTRACT_IDS_TEXT}`,
      "- [ ] 1.5 sendback",
      "  - outcome: phase 結果全件回収後に sendBack する",
    ].join("\n"),
  }, (paths) => {
    const violations = collectSpecCreatorQualityViolations(paths);
    if (!hasRule(violations, "transition_condition")) {
      throw new Error("expected transition_condition violation");
    }
  });
});

Deno.test("quality guard detects proposal contradiction for design generation mode", () => {
  withTempArtifacts({
    proposalPath: [
      "- 再生成対象は `proposal.md` `tasks.md` `code_summary.md` `specs/**/spec.md` とし、`design.md` は必要時のみ生成または更新する。",
      "- Codex から得た `proposal/design/tasks/code_summary/spec.md` の完成形を一括受領する。",
    ].join("\n"),
  }, (paths) => {
    const violations = collectSpecCreatorQualityViolations(paths);
    if (!hasRule(violations, "design_generation_mode")) {
      throw new Error("expected design_generation_mode violation");
    }
  });
});

Deno.test("quality guard detects persona-dir contract gaps and missing custom assignment", () => {
  withTempArtifacts({
    proposalPath: "- use --persona-dir for personas\n",
    designPath: "- use --persona-dir directory\n",
    deltaSpecPath: "- GIVEN --persona-dir path\n",
  }, (paths) => {
    const violations = collectSpecCreatorQualityViolations(paths);
    if (!hasRule(violations, "path_coverage")) {
      throw new Error("expected path_coverage violation");
    }
    if (!hasRule(violations, "input_contract")) {
      throw new Error("expected input_contract violation");
    }
    if (!hasRule(violations, "assignment_coverage")) {
      throw new Error("expected assignment_coverage violation");
    }
  });
});

Deno.test("quality guard detects review contract gaps between tasks 1.3 and spec", () => {
  withTempArtifacts({
    tasksPath: [
      "## 1. tasks",
      "- [ ] 1.3 review contract",
      "  - outcome: RC-01, RC-02",
      '  - persona_policy: {"phase_order":["implement","review"]}',
    ].join("\n"),
    deltaSpecPath: DEFAULT_DELTA_SPEC_TEXT,
  }, (paths) => {
    const violations = collectSpecCreatorQualityViolations(paths);
    if (!hasRule(violations, "review_contract_coverage")) {
      throw new Error("expected review_contract_coverage violation");
    }
  });
});

Deno.test("quality guard skips RC coverage rules when emitReviewContractToArtifacts=false", () => {
  withTempArtifacts({
    tasksPath: [
      "## 1. tasks",
      "- [ ] 1.3 review contract",
      "  - outcome: RC omitted intentionally",
      '  - persona_policy: {"phase_order":["implement","review"]}',
    ].join("\n"),
    codeSummaryPath: [
      "# code_summary",
      "",
      "## task_id: 1.3",
      "",
      "- no RC trace lines",
    ].join("\n"),
    deltaSpecPath: [
      "## ADDED Requirements",
      "### Requirement: baseline",
      "The system SHALL keep generated artifacts aligned.",
    ].join("\n"),
  }, (paths) => {
    const violations = collectSpecCreatorQualityViolations(paths, {
      emitReviewContractToArtifacts: false,
    });
    if (hasRule(violations, "review_contract_coverage")) {
      throw new Error("review_contract_coverage should be skipped");
    }
    if (hasRule(violations, "review_contract_traceability")) {
      throw new Error("review_contract_traceability should be skipped");
    }
  });
});

Deno.test("quality guard detects missing review traceability fields", () => {
  withTempArtifacts({
    tasksPath: [
      "## 1. tasks",
      "- [ ] 1.3 review contract",
      ...REQUIRED_REVIEW_CONTRACT_IDS.map((id) => `  - ${id}: only id`),
      '  - persona_policy: {"phase_order":["implement","review"]}',
    ].join("\n"),
    codeSummaryPath: [
      "# code_summary",
      "",
      "## task_id: 1.3",
      "",
      ...REQUIRED_REVIEW_CONTRACT_IDS.map((id) => `- ${id}: only id`),
    ].join("\n"),
  }, (paths) => {
    const violations = collectSpecCreatorQualityViolations(paths);
    if (!hasRule(violations, "review_contract_traceability")) {
      throw new Error("expected review_contract_traceability violation");
    }
  });
});

Deno.test("quality guard passes for aligned artifacts", () => {
  withTempArtifacts({
    proposalPath: [
      "- run and spec-creator both support --persona-dir",
      "- run --config uses runtime validation error for config checks",
    ].join("\n"),
    designPath: [
      "- --persona-dir reads <dir>/personas.json",
      "- personas.json must be JSON array",
      "- missing/not found, parse failure, schema mismatch are fail-closed",
      "- validate persona_policy.phase_overrides.<phase>.executor_personas after merge",
    ].join("\n"),
    tasksPath: [
      "## 1. tasks",
      "- [ ] 1.3 review contract",
      ...buildReviewTraceabilityLines("  - "),
      '  - persona_policy: {"phase_order":["implement","review"]}',
      "- [ ] 1.4 review flow",
      "  - outcome: immediate blocked",
      "  - test: blocked at reviewer 2 and reviewer 3 is not executed",
      '  - persona_policy: {"phase_order":["implement","review"]}',
      "- [ ] 1.5 sendback",
      "  - outcome: blocked=false and changes_required=true triggers one sendBack",
      '  - persona_policy: {"phase_order":["implement","review"]}',
    ].join("\n"),
    deltaSpecPath: [
      "#### Scenario: runtime validation",
      "- GIVEN run --config loads task_config",
      "- THEN runtime validation error",
      "#### Scenario: review order",
      "- GIVEN task_config.persona_policy.phase_overrides.review.executor_personas includes [code-reviewer, spec-checker]",
      "#### Scenario: custom assignment",
      "- GIVEN custom-reviewer exists and executor_personas includes [code-reviewer, custom-reviewer]",
      "- THEN review executes in order",
      "#### Scenario: blocked",
      "- THEN immediate blocked",
      "#### Scenario: review contract",
      `- **THEN** ${REQUIRED_REVIEW_CONTRACT_IDS_TEXT}`,
    ].join("\n"),
    codeSummaryPath: [
      "# code_summary",
      "",
      "## task_id: 1.3",
      "",
      ...buildReviewTraceabilityLines("- "),
    ].join("\n"),
  }, (paths) => {
    const violations = collectSpecCreatorQualityViolations(paths);
    if (violations.length > 0) {
      throw new Error(
        `expected no violations, got: ${
          violations.map((violation) => violation.rule_id).join(", ")
        }`,
      );
    }
  });
});

Deno.test("quality guard detects missing task persona_policy.phase_order", () => {
  withTempArtifacts({
    tasksPath: [
      "## 1. tasks",
      "- [ ] 1.3 review contract",
      `  - outcome: ${REQUIRED_REVIEW_CONTRACT_IDS_TEXT}`,
    ].join("\n"),
  }, (paths) => {
    const violations = collectSpecCreatorQualityViolations(paths);
    if (!hasRule(violations, "phase_order_coverage")) {
      throw new Error("expected phase_order_coverage violation");
    }
  });
});

Deno.test("quality guard ignores RC checkbox trace lines for phase_order_coverage", () => {
  withTempArtifacts({
    tasksPath: [
      "## 1. tasks",
      "- [ ] 1.3 review contract",
      ...buildReviewTraceabilityLines("  - [ ] "),
      '  - persona_policy: {"phase_order":["implement","review"]}',
    ].join("\n"),
  }, (paths) => {
    const violations = collectSpecCreatorQualityViolations(paths);
    if (hasRule(violations, "phase_order_coverage")) {
      throw new Error(
        `unexpected phase_order_coverage violation: ${
          violations
            .filter((violation) => violation.rule_id === "phase_order_coverage")
            .map((violation) =>
              `${path.basename(violation.file)}:${violation.line}`
            )
            .join(", ")
        }`,
      );
    }
  });
});

Deno.test("quality guard scans all delta spec files, not only first one", () => {
  withTempArtifactsAndExtraSpecs(
    {
      deltaSpecPath: "## ADDED Requirements\n### Requirement: baseline\n",
    },
    {
      "specs/extra/spec.md":
        "- GIVEN task_config.review includes [code-reviewer]\n",
    },
    (paths) => {
      const violations = collectSpecCreatorQualityViolations(paths);
      if (!hasRule(violations, "data_model_key")) {
        throw new Error("expected data_model_key violation from extra spec");
      }
    },
  );
});

Deno.test("quality guard detects capability path drift in preserve-supplement mode", () => {
  const root = Deno.makeTempDirSync();
  try {
    const sourcePaths = writeArtifactsAt(`${root}/source`, {
      proposal: "# proposal\n",
      tasks: [
        "## 1. tasks",
        "- [ ] 1.1 implement",
        "  - Target paths: src/app.ts",
        '  - persona_policy: {"phase_order":["implement","review"]}',
      ].join("\n"),
      design: "# design\n",
      codeSummary: "# code_summary\n",
      specs: {
        "specs/auth/spec.md":
          "## ADDED Requirements\n#### Scenario: auth\n- THEN keep auth path\n",
        "specs/billing/spec.md":
          "## ADDED Requirements\n#### Scenario: billing\n- THEN keep billing path\n",
      },
    });
    const revisedPaths = writeArtifactsAt(`${root}/revised`, {
      proposal: "# proposal\n",
      tasks: [
        "## 1. tasks",
        "- [ ] 1.1 implement",
        "  - Target paths: src/app.ts",
        '  - persona_policy: {"phase_order":["implement","review"]}',
      ].join("\n"),
      design: "# design\n",
      codeSummary: "# code_summary\n",
      specs: {
        "specs/auth/spec.md":
          "## ADDED Requirements\n#### Scenario: auth\n- THEN keep auth path\n",
      },
    });
    const violations = collectSpecCreatorQualityViolations(revisedPaths, {
      emitReviewContractToArtifacts: false,
      polishMode: "preserve-supplement",
      sourcePaths,
    });
    if (!hasRule(violations, "capability_path_drift")) {
      throw new Error("expected capability_path_drift violation");
    }
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("quality guard detects task scope regression in preserve-supplement mode", () => {
  const root = Deno.makeTempDirSync();
  try {
    const sourcePaths = writeArtifactsAt(`${root}/source`, {
      proposal: "# proposal\n",
      tasks: [
        "## 1. tasks",
        "- [ ] 1.1 implement",
        "  - Target paths: src/server.ts",
        '  - persona_policy: {"phase_order":["implement","review"]}',
      ].join("\n"),
      design: "# design\n",
      codeSummary: "# code_summary\n",
      specs: {
        "specs/server/spec.md":
          "## ADDED Requirements\n#### Scenario: server\n- THEN keep server path\n",
      },
    });
    const revisedPaths = writeArtifactsAt(`${root}/revised`, {
      proposal: "# proposal\n",
      tasks: [
        "## 1. tasks",
        "- [ ] 1.1 docs only",
        "  - Target paths: openspec/changes/revised/proposal.md",
        '  - persona_policy: {"phase_order":["implement","review"]}',
      ].join("\n"),
      design: "# design\n",
      codeSummary: "# code_summary\n",
      specs: {
        "specs/server/spec.md":
          "## ADDED Requirements\n#### Scenario: server\n- THEN keep server path\n",
      },
    });
    const violations = collectSpecCreatorQualityViolations(revisedPaths, {
      emitReviewContractToArtifacts: false,
      polishMode: "preserve-supplement",
      sourcePaths,
    });
    if (!hasRule(violations, "task_scope_regression")) {
      throw new Error("expected task_scope_regression violation");
    }
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("quality guard detects validation strength regression in preserve-supplement mode", () => {
  const root = Deno.makeTempDirSync();
  try {
    const sourcePaths = writeArtifactsAt(`${root}/source`, {
      proposal: "- validation: unit integration lint regression\n",
      tasks: [
        "## 1. tasks",
        "- [ ] 1.1 validation",
        "  - Target paths: src/server.ts",
        "  - Description: unit integration lint regression",
        '  - persona_policy: {"phase_order":["implement","review"]}',
      ].join("\n"),
      design: "# design\n",
      codeSummary: "# code_summary\n",
      specs: {
        "specs/server/spec.md":
          "## ADDED Requirements\n#### Scenario: validation\n- THEN run unit and integration tests\n",
      },
    });
    const revisedPaths = writeArtifactsAt(`${root}/revised`, {
      proposal: "- validation: smoke\n",
      tasks: [
        "## 1. tasks",
        "- [ ] 1.1 validation",
        "  - Target paths: src/server.ts",
        "  - Description: smoke only",
        '  - persona_policy: {"phase_order":["implement","review"]}',
      ].join("\n"),
      design: "# design\n",
      codeSummary: "# code_summary\n",
      specs: {
        "specs/server/spec.md":
          "## ADDED Requirements\n#### Scenario: validation\n- THEN run smoke checks\n",
      },
    });
    const violations = collectSpecCreatorQualityViolations(revisedPaths, {
      emitReviewContractToArtifacts: false,
      polishMode: "preserve-supplement",
      sourcePaths,
    });
    if (!hasRule(violations, "validation_strength_regression")) {
      throw new Error("expected validation_strength_regression violation");
    }
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("quality guard detects notification scenario weakening in preserve-supplement mode", () => {
  const root = Deno.makeTempDirSync();
  try {
    const sourcePaths = writeArtifactsAt(`${root}/source`, {
      proposal: "# proposal\n",
      tasks: [
        "## 1. tasks",
        "- [ ] 1.1 notifications",
        "  - Target paths: src/notify.ts",
        '  - persona_policy: {"phase_order":["implement","review"]}',
      ].join("\n"),
      design: "# design\n",
      codeSummary: "# code_summary\n",
      specs: {
        "specs/notify/spec.md": [
          "## ADDED Requirements",
          "### Requirement: notify",
          "#### Scenario: notify users",
          "- THEN send notification to each subscriber",
        ].join("\n"),
      },
    });
    const revisedPaths = writeArtifactsAt(`${root}/revised`, {
      proposal: "# proposal\n",
      tasks: [
        "## 1. tasks",
        "- [ ] 1.1 notifications",
        "  - Target paths: src/notify.ts",
        '  - persona_policy: {"phase_order":["implement","review"]}',
      ].join("\n"),
      design: "# design\n",
      codeSummary: "# code_summary\n",
      specs: {
        "specs/notify/spec.md": [
          "## ADDED Requirements",
          "### Requirement: notify",
          "#### Scenario: notify users",
          "- THEN persist status only",
        ].join("\n"),
      },
    });
    const violations = collectSpecCreatorQualityViolations(revisedPaths, {
      emitReviewContractToArtifacts: false,
      polishMode: "preserve-supplement",
      sourcePaths,
    });
    if (!hasRule(violations, "scenario_strength_regression")) {
      throw new Error("expected scenario_strength_regression violation");
    }
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("quality guard passes preserve-supplement when supplemented without weakening", () => {
  const root = Deno.makeTempDirSync();
  try {
    const sourcePaths = writeArtifactsAt(`${root}/source`, {
      proposal: "- validation: unit integration lint regression\n",
      tasks: [
        "## 1. tasks",
        "- [ ] 1.1 notifications",
        "  - Target paths: src/notify.ts",
        "  - Description: unit integration lint regression",
        '  - persona_policy: {"phase_order":["implement","review"]}',
      ].join("\n"),
      design: "# design\n",
      codeSummary: "# code_summary\n",
      specs: {
        "specs/notify/spec.md": [
          "## ADDED Requirements",
          "### Requirement: notify",
          "#### Scenario: notify users",
          "- THEN send notification to each subscriber",
        ].join("\n"),
      },
    });
    const revisedPaths = writeArtifactsAt(`${root}/revised`, {
      proposal: [
        "- validation: unit integration lint regression",
        "- supplement: preserve wording and add telemetry",
      ].join("\n"),
      tasks: [
        "## 1. tasks",
        "- [ ] 1.1 notifications",
        "  - Target paths: src/notify.ts, src/telemetry.ts",
        "  - Description: unit integration lint regression with telemetry",
        '  - persona_policy: {"phase_order":["implement","review"]}',
      ].join("\n"),
      design: "# design\n",
      codeSummary: "# code_summary\n",
      specs: {
        "specs/notify/spec.md": [
          "## ADDED Requirements",
          "### Requirement: notify",
          "#### Scenario: notify users",
          "- THEN send notification to each subscriber",
          "- AND log audit event",
        ].join("\n"),
      },
    });
    const violations = collectSpecCreatorQualityViolations(revisedPaths, {
      emitReviewContractToArtifacts: false,
      polishMode: "preserve-supplement",
      sourcePaths,
    }).filter((violation) =>
      [
        "capability_path_drift",
        "task_scope_regression",
        "validation_strength_regression",
        "scenario_strength_regression",
      ].includes(violation.rule_id)
    );
    if (violations.length > 0) {
      throw new Error(
        `expected no preserve regressions, got: ${
          violations.map((violation) => violation.rule_id).join(", ")
        }`,
      );
    }
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

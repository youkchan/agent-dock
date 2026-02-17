import path from "node:path";
import {
  collectSpecCreatorQualityViolations,
  type SpecCreatorArtifactPaths,
} from "./spec_creator_quality.ts";

type ArtifactTextOverrides = Partial<Record<
  "proposalPath" | "tasksPath" | "designPath" | "codeSummaryPath" | "deltaSpecPath",
  string
>>;

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
      "proposalPath" | "tasksPath" | "designPath" | "codeSummaryPath" | "deltaSpecPath",
      string
    > = {
      proposalPath: "# proposal\n",
      tasksPath: "## 1. tasks\n- [ ] 1.1 sample\n",
      designPath: "# design\n",
      codeSummaryPath: "# code_summary\n",
      deltaSpecPath: "## ADDED Requirements\n",
    };
    for (const key of Object.keys(paths) as Array<keyof SpecCreatorArtifactPaths>) {
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
      "proposalPath" | "tasksPath" | "designPath" | "codeSummaryPath" | "deltaSpecPath",
      string
    > = {
      proposalPath: "# proposal\n",
      tasksPath: "## 1. tasks\n- [ ] 1.1 sample\n",
      designPath: "# design\n",
      codeSummaryPath: "# code_summary\n",
      deltaSpecPath: "## ADDED Requirements\n",
    };
    for (const key of Object.keys(paths) as Array<keyof SpecCreatorArtifactPaths>) {
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
      "- [ ] 1.4 review flow",
      "  - outcome: immediate blocked",
      "  - test: blocked at reviewer 2 and reviewer 3 is not executed",
      "- [ ] 1.5 sendback",
      "  - outcome: blocked=false and changes_required=true triggers one sendBack",
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

Deno.test("quality guard scans all delta spec files, not only first one", () => {
  withTempArtifactsAndExtraSpecs(
    {
      deltaSpecPath: "## ADDED Requirements\n### Requirement: baseline\n",
    },
    {
      "specs/extra/spec.md": "- GIVEN task_config.review includes [code-reviewer]\n",
    },
    (paths) => {
      const violations = collectSpecCreatorQualityViolations(paths);
      if (!hasRule(violations, "data_model_key")) {
        throw new Error("expected data_model_key violation from extra spec");
      }
    },
  );
});

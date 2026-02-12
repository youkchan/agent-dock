import { parseTasksMarkdown } from "./compiler.ts";
import {
  buildCodeSummaryMarkdown,
  buildProposalMarkdown,
  buildTasksMarkdown,
} from "./spec_creator.ts";

function assertDeepEqual(actual: unknown, expected: unknown): void {
  const actualText = JSON.stringify(actual);
  const expectedText = JSON.stringify(expected);
  if (actualText !== expectedText) {
    throw new Error(`expected ${expectedText}, got ${actualText}`);
  }
}

function assertThrowsMessage(fn: () => void, text: string): void {
  let thrown: unknown = null;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }
  if (!(thrown instanceof Error)) {
    throw new Error("expected function to throw Error");
  }
  if (!thrown.message.includes(text)) {
    throw new Error(`expected '${thrown.message}' to include '${text}'`);
  }
}

function withTempDir(fn: (root: string) => void): void {
  const root = Deno.makeTempDirSync();
  try {
    fn(root);
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
}

Deno.test("buildTasksMarkdown preserves fixed template lines and compiles", () => {
  const tasksMarkdown = buildTasksMarkdown({
    lang: "ja",
    implementationMarkdown: [
      "- [ ] 1.1 tasks を生成する",
      "  - 依存: なし",
      "  - 対象: src/a.ts",
      "  - フェーズ担当: implement=spec-planner; review=spec-reviewer",
      "  - 成果物: tasks.md を更新する",
    ].join("\n"),
    humanNotesMarkdown: "- メモ: custom",
  });

  if (!tasksMarkdown.includes("persona_defaults.phase_order")) {
    throw new Error("tasks template must keep persona_defaults fixed line");
  }
  if (!tasksMarkdown.includes("### 0.2 Provider 完了判定ゲート（固定）")) {
    throw new Error("tasks template must include provider completion gate");
  }
  if (
    !tasksMarkdown.includes(
      "REVIEWER_STOP:requirement_drift|over_editing|verbosity",
    )
  ) {
    throw new Error("tasks template must include reviewer stop fixed note");
  }

  withTempDir((root) => {
    const tasksPath = `${root}/tasks.md`;
    Deno.writeTextFileSync(tasksPath, tasksMarkdown);
    const parsed = parseTasksMarkdown(tasksPath);
    assertDeepEqual(parsed.tasks.map((task) => task.id), ["1.1"]);
    assertDeepEqual(parsed.verificationItems.length, 0);
  });
});

Deno.test("buildTasksMarkdown rejects implementation without checkbox tasks", () => {
  assertThrowsMessage(
    () =>
      buildTasksMarkdown({
        implementationMarkdown: "- 1.1 this is not a checkbox task",
      }),
    "checkbox tasks",
  );
});

Deno.test("buildProposalMarkdown injects fixed completion and reviewer gates", () => {
  for (const lang of ["ja", "en"] as const) {
    const proposal = buildProposalMarkdown({ lang });
    if (!proposal.includes("ORCHESTRATOR_PROVIDER=mock")) {
      throw new Error(`proposal ${lang} must include mock completion guard`);
    }
    if (
      !proposal.includes(
        "REVIEWER_STOP:requirement_drift|over_editing|verbosity",
      )
    ) {
      throw new Error(`proposal ${lang} must include reviewer stop rule`);
    }
  }
});

Deno.test("buildCodeSummaryMarkdown validates task to code mapping integrity", () => {
  const tasksMarkdown = buildTasksMarkdown({
    lang: "en",
    implementationMarkdown: [
      "- [ ] 1.1 normalize requirements",
      "  - Depends on: none",
      "  - Target paths: src/a.ts",
      "  - phase assignments: implement=spec-planner; review=spec-reviewer",
      "  - Description: normalize",
      "- [ ] 1.2 verify consistency",
      "  - Depends on: 1.1",
      "  - Target paths: src/b.ts",
      "  - phase assignments: implement=spec-reviewer",
      "  - Description: review",
    ].join("\n"),
  });

  const markdown = buildCodeSummaryMarkdown({
    tasksMarkdown,
    summaries: [
      {
        task_id: "1.1",
        code_units: [{
          file: "src/a.ts",
          service: "spec-creator",
          function: "normalize",
          purpose: "normalize requirements",
          input: "raw requirement text",
          output: "normalized context",
          error: "throw on invalid input",
          test: "unit",
        }],
      },
    ],
  });

  if (!markdown.includes("## task_id: 1.1")) {
    throw new Error("code summary must include task_id 1.1");
  }
  if (!markdown.includes("## task_id: 1.2")) {
    throw new Error("code summary must include task_id 1.2");
  }
  if (!markdown.includes("<replace-with-target-file-1.2-1>")) {
    throw new Error("missing task summary must fallback to placeholders");
  }
  for (
    const key of [
      "file",
      "service",
      "function",
      "purpose",
      "input",
      "output",
      "error",
      "test",
    ]
  ) {
    if (!markdown.includes(`- ${key}:`)) {
      throw new Error(`code summary must include key: ${key}`);
    }
  }

  assertThrowsMessage(
    () =>
      buildCodeSummaryMarkdown({
        tasksMarkdown,
        summaries: [{ task_id: "9.9" }],
      }),
    "unknown task_id",
  );
});

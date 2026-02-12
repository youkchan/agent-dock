import { parseTasksMarkdown } from "./compiler.ts";
import {
  buildCodeSummaryMarkdown,
  buildDeltaSpecMarkdown,
  buildProposalMarkdown,
  buildTasksMarkdown,
  checkNonMarkdownConsistency,
  collectChangeFilesRecursively,
  polishMarkdownFiles,
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

function assertByteEqual(actual: Uint8Array, expected: Uint8Array): void {
  if (actual.length !== expected.length) {
    throw new Error(
      `expected byte length ${expected.length}, got ${actual.length}`,
    );
  }
  for (let index = 0; index < actual.length; index += 1) {
    if (actual[index] !== expected[index]) {
      throw new Error(`byte mismatch at index ${index}`);
    }
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

Deno.test("buildDeltaSpecMarkdown contains ADDED requirement and scenario", () => {
  const ja = buildDeltaSpecMarkdown({
    lang: "ja",
    requirementName: "add-spec-creator baseline",
    requirementsText: "要件本文",
  });
  if (!ja.includes("## ADDED Requirements")) {
    throw new Error("ja delta must include ADDED section");
  }
  if (!ja.includes("#### Scenario:")) {
    throw new Error("ja delta must include Scenario");
  }
  if (!ja.includes("要件本文")) {
    throw new Error("ja delta must include requirement memo");
  }

  const en = buildDeltaSpecMarkdown({
    lang: "en",
    requirementName: "add-spec-creator baseline",
    requirementsText: "requirements text",
  });
  if (!en.includes("## ADDED Requirements")) {
    throw new Error("en delta must include ADDED section");
  }
  if (!en.includes("#### Scenario:")) {
    throw new Error("en delta must include Scenario");
  }
  if (!en.includes("requirements text")) {
    throw new Error("en delta must include requirement memo");
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

Deno.test("collectChangeFilesRecursively classifies markdown and non-markdown recursively", () => {
  withTempDir((root) => {
    const changeRoot = `${root}/openspec/changes/add-foo`;
    Deno.mkdirSync(`${changeRoot}/specs/api`, { recursive: true });
    Deno.mkdirSync(`${changeRoot}/configs`, { recursive: true });
    Deno.mkdirSync(`${changeRoot}/docs`, { recursive: true });

    Deno.writeTextFileSync(`${changeRoot}/proposal.md`, "# proposal");
    Deno.writeTextFileSync(`${changeRoot}/specs/api/spec.md`, "## ADDED");
    Deno.writeTextFileSync(`${changeRoot}/docs/README.MD`, "# readme");
    Deno.writeTextFileSync(`${changeRoot}/configs/rules.json`, "{}");
    Deno.writeTextFileSync(`${changeRoot}/notes.txt`, "note");

    const queue = collectChangeFilesRecursively(changeRoot);
    const expectedMarkdown = [
      `${changeRoot}/docs/README.MD`,
      `${changeRoot}/proposal.md`,
      `${changeRoot}/specs/api/spec.md`,
    ].sort((left, right) => left.localeCompare(right));
    const expectedNonMarkdown = [
      `${changeRoot}/configs/rules.json`,
      `${changeRoot}/notes.txt`,
    ].sort((left, right) => left.localeCompare(right));

    assertDeepEqual(queue.changeRoot, changeRoot);
    assertDeepEqual(queue.totalFileCount, 5);
    assertDeepEqual(queue.markdownFiles, expectedMarkdown);
    assertDeepEqual(queue.nonMarkdownFiles, expectedNonMarkdown);
    assertDeepEqual(
      queue.processingQueue.map((item) => item.kind),
      ["non-markdown", "markdown", "non-markdown", "markdown", "markdown"],
    );
  });
});

Deno.test("collectChangeFilesRecursively fails closed when change root does not exist", () => {
  withTempDir((root) => {
    const missingRoot = `${root}/openspec/changes/not-found`;
    assertThrowsMessage(
      () => collectChangeFilesRecursively(missingRoot),
      "change root is not a directory",
    );
  });
});

Deno.test("checkNonMarkdownConsistency warns on invalid json and keeps bytes unchanged", () => {
  withTempDir((root) => {
    const changeRoot = `${root}/openspec/changes/add-foo`;
    Deno.mkdirSync(`${changeRoot}/configs`, { recursive: true });

    const validJsonPath = `${changeRoot}/configs/valid.json`;
    const invalidJsonPath = `${changeRoot}/configs/invalid.json`;
    const yamlPath = `${changeRoot}/configs/rules.yaml`;

    Deno.writeTextFileSync(validJsonPath, '{"ok":true}\n');
    Deno.writeTextFileSync(invalidJsonPath, '{"broken": }\n');
    Deno.writeTextFileSync(yamlPath, "a: b\n");

    const targets = [yamlPath, invalidJsonPath, validJsonPath];
    const beforeByPath = new Map<string, Uint8Array>();
    for (const target of targets) {
      beforeByPath.set(target, Deno.readFileSync(target));
    }

    const result = checkNonMarkdownConsistency(targets);
    assertDeepEqual(
      result.checkedFiles,
      [...targets].sort((left, right) => left.localeCompare(right)),
    );
    if (result.warnings.length !== 1) {
      throw new Error(`expected 1 warning, got ${result.warnings.length}`);
    }
    if (!result.warnings[0].includes(invalidJsonPath)) {
      throw new Error("warning must include invalid json path");
    }
    if (!result.warnings[0].includes("invalid JSON")) {
      throw new Error("warning must include invalid JSON reason");
    }

    for (const target of targets) {
      const before = beforeByPath.get(target);
      if (!before) {
        throw new Error(`missing before bytes for ${target}`);
      }
      const after = Deno.readFileSync(target);
      assertByteEqual(after, before);
    }
  });
});

Deno.test("checkNonMarkdownConsistency fails closed when file does not exist", () => {
  withTempDir((root) => {
    const missingPath = `${root}/openspec/changes/add-foo/configs/missing.json`;
    assertThrowsMessage(
      () => checkNonMarkdownConsistency([missingPath]),
      "failed to read non-markdown file",
    );
  });
});

Deno.test("polishMarkdownFiles complements tasks fixed lines and stays idempotent", () => {
  withTempDir((root) => {
    const tasksPath = `${root}/tasks.md`;
    Deno.writeTextFileSync(
      tasksPath,
      [
        "## 0. Persona Defaults",
        "##1. implementation",
        "- [ ] 1.1 normalize markdown",
        "  - Depends on: none",
        "  - Target paths: src/a.ts",
        "  - phase assignments: implement=implementer; review=code-reviewer",
        "  - Description: normalize",
        "##2.human notes",
        "- Note: custom",
        "",
      ].join("\r\n"),
    );

    const first = polishMarkdownFiles([tasksPath]);
    if (first.changedFiles.length !== 1) {
      throw new Error("first polish must update tasks markdown");
    }
    if (first.ruleCounts.fixedLines <= 0) {
      throw new Error("first polish must complement fixed lines");
    }
    if (first.ruleCounts.headings <= 0) {
      throw new Error("first polish must normalize headings");
    }

    const polished = Deno.readTextFileSync(tasksPath);
    if (!polished.includes("persona_defaults.phase_order")) {
      throw new Error("polished tasks markdown must include phase order line");
    }
    if (!polished.includes("### 0.2 Provider Completion Gates (fixed)")) {
      throw new Error("polished tasks markdown must include provider gate");
    }
    if (!polished.includes("## 1. Implementation")) {
      throw new Error(
        "polished tasks markdown must normalize section 1 heading",
      );
    }
    if (!polished.includes("## 2. Human Notes (non-compiled)")) {
      throw new Error(
        "polished tasks markdown must normalize section 2 heading",
      );
    }
    const parsed = parseTasksMarkdown(tasksPath);
    assertDeepEqual(parsed.tasks.map((task) => task.id), ["1.1"]);

    const second = polishMarkdownFiles([tasksPath]);
    assertDeepEqual(second.changedFiles, []);
    assertDeepEqual(second.ruleCounts, {
      formatting: 0,
      fixedLines: 0,
      headings: 0,
    });
  });
});

Deno.test("polishMarkdownFiles normalizes generic markdown formatting", () => {
  withTempDir((root) => {
    const proposalPath = `${root}/proposal.md`;
    Deno.writeTextFileSync(
      proposalPath,
      "#Title  \r\n\r\n\r\n##Why  \nBody",
    );

    const first = polishMarkdownFiles([proposalPath]);
    if (first.changedFiles.length !== 1) {
      throw new Error("generic markdown should be updated on first polish");
    }
    if (first.ruleCounts.headings <= 0) {
      throw new Error("generic markdown headings must be normalized");
    }

    const polished = Deno.readTextFileSync(proposalPath);
    if (!polished.includes("# Title")) {
      throw new Error("h1 heading must include single space after #");
    }
    if (!polished.includes("## Why")) {
      throw new Error("h2 heading must include single space after ##");
    }
    if (polished.includes("\r")) {
      throw new Error("line endings must be normalized to LF");
    }
    if (polished.includes("\n\n\n")) {
      throw new Error("blank lines must be collapsed");
    }

    const second = polishMarkdownFiles([proposalPath]);
    assertDeepEqual(second.changedFiles, []);
    assertDeepEqual(second.ruleCounts, {
      formatting: 0,
      fixedLines: 0,
      headings: 0,
    });
  });
});

Deno.test("acceptance scenario stays fail-closed and idempotent without mutating non-markdown files", () => {
  withTempDir((root) => {
    const changeRoot = `${root}/openspec/changes/add-acceptance`;
    const missingRoot = `${root}/openspec/changes/missing-change`;
    assertThrowsMessage(
      () => collectChangeFilesRecursively(missingRoot),
      "change root is not a directory",
    );

    Deno.mkdirSync(`${changeRoot}/configs`, { recursive: true });
    const tasksPath = `${changeRoot}/tasks.md`;
    const proposalPath = `${changeRoot}/proposal.md`;
    const jsonPath = `${changeRoot}/configs/settings.json`;
    const yamlPath = `${changeRoot}/configs/rules.yaml`;

    Deno.writeTextFileSync(
      tasksPath,
      [
        "## 0. Persona Defaults",
        "##1. implementation",
        "- [ ] 1.1 verify acceptance",
        "  - Depends on: none",
        "  - Target paths: src/a.ts",
        "  - phase assignments: implement=implementer; review=code-reviewer",
        "  - Description: keep compile-openspec compatible",
        "##2.human notes",
        "- Note: custom memo",
        "",
      ].join("\r\n"),
    );
    Deno.writeTextFileSync(
      proposalPath,
      "#Title  \r\n\r\n\r\n##Why  \nBody",
    );
    Deno.writeTextFileSync(jsonPath, '{"ok":true}\n');
    Deno.writeTextFileSync(yamlPath, "mode: strict\n");

    const jsonBefore = Deno.readFileSync(jsonPath);
    const yamlBefore = Deno.readFileSync(yamlPath);

    const firstQueue = collectChangeFilesRecursively(changeRoot);
    const firstMarkdown = polishMarkdownFiles(firstQueue.markdownFiles);
    const firstNonMarkdown = checkNonMarkdownConsistency(
      firstQueue.nonMarkdownFiles,
    );

    assertDeepEqual(firstQueue.totalFileCount, 4);
    assertDeepEqual(
      firstMarkdown.changedFiles,
      [proposalPath, tasksPath].sort((left, right) =>
        left.localeCompare(right)
      ),
    );
    if (firstMarkdown.ruleCounts.formatting <= 0) {
      throw new Error("first polish should apply formatting rules");
    }
    if (firstMarkdown.ruleCounts.headings <= 0) {
      throw new Error("first polish should apply heading rules");
    }
    assertDeepEqual(firstNonMarkdown.warnings, []);
    assertDeepEqual(
      firstNonMarkdown.checkedFiles,
      [jsonPath, yamlPath].sort((left, right) => left.localeCompare(right)),
    );

    const parsed = parseTasksMarkdown(tasksPath);
    assertDeepEqual(parsed.tasks.map((task) => task.id), ["1.1"]);
    assertByteEqual(Deno.readFileSync(jsonPath), jsonBefore);
    assertByteEqual(Deno.readFileSync(yamlPath), yamlBefore);

    const secondQueue = collectChangeFilesRecursively(changeRoot);
    const secondMarkdown = polishMarkdownFiles(secondQueue.markdownFiles);
    const secondNonMarkdown = checkNonMarkdownConsistency(
      secondQueue.nonMarkdownFiles,
    );

    assertDeepEqual(secondQueue.totalFileCount, 4);
    assertDeepEqual(secondMarkdown.changedFiles, []);
    assertDeepEqual(secondMarkdown.ruleCounts, {
      formatting: 0,
      fixedLines: 0,
      headings: 0,
    });
    assertDeepEqual(secondNonMarkdown.warnings, []);
    assertByteEqual(Deno.readFileSync(jsonPath), jsonBefore);
    assertByteEqual(Deno.readFileSync(yamlPath), yamlBefore);
  });
});

import {
  compileChangeToConfig,
  OpenSpecCompileError,
  parseTasksMarkdown,
  updateTasksMarkdownCheckboxes,
} from "./compiler.ts";
import { getOpenSpecTasksTemplate } from "./template.ts";

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

function writeChange(root: string, changeId: string, tasksMd: string): void {
  const changeDir = `${root}/openspec/changes/${changeId}`;
  Deno.mkdirSync(changeDir, { recursive: true });
  Deno.writeTextFileSync(`${changeDir}/tasks.md`, tasksMd);
}

Deno.test("compileChangeToConfig parses tasks markdown", () => {
  withTempDir((root) => {
    writeChange(
      root,
      "add-sample",
      [
        "## 1. 実装タスク",
        "- [ ] T-001 仕様を定義する（`requires_plan=true`）",
        "  - 依存: なし",
        "  - 対象: src/specs/contract.ts",
        "  - フェーズ担当: implement=implementer",
        "  - 成果物: 仕様を整理する",
        "- [ ] T-002 実装する",
        "  - 依存: T-001",
        "  - 対象: src/runtime/orchestrator.ts, src/runtime/store.ts",
        "  - フェーズ担当: implement=implementer",
        "## 2. 検証項目",
        "- [x] `deno test src --allow-read --allow-write --allow-run --allow-env` が通る",
        "- [ ] `./node_modules/.bin/agent-dock run --openspec-change add-sample` で実行開始できる",
      ].join("\n"),
    );

    const compiled = compileChangeToConfig("add-sample", {
      openspecRoot: `${root}/openspec`,
      overridesRoot: `${root}/task_configs/overrides`,
    });

    assertDeepEqual(compiled.teammates, ["teammate-a", "teammate-b"]);
    const tasks = compiled.tasks as Array<Record<string, unknown>>;
    assertDeepEqual(tasks.map((task) => task.id), ["T-001", "T-002"]);
    assertDeepEqual(tasks[0].requires_plan, true);
    assertDeepEqual(tasks[0].depends_on, []);
    assertDeepEqual(tasks[1].depends_on, ["T-001"]);
    assertDeepEqual(tasks[1].target_paths, [
      "src/runtime/orchestrator.ts",
      "src/runtime/store.ts",
    ]);

    const meta = compiled.meta as Record<string, unknown>;
    const verification = meta.verification_items as Array<
      Record<string, unknown>
    >;
    assertDeepEqual(verification.length, 2);
    assertDeepEqual(verification[0].checked, true);
  });
});

Deno.test("parseTasksMarkdown accepts ja template", () => {
  withTempDir((root) => {
    const tasksPath = `${root}/tasks.md`;
    Deno.writeTextFileSync(tasksPath, getOpenSpecTasksTemplate("ja"));

    const parsed = parseTasksMarkdown(tasksPath);
    assertDeepEqual(parsed.tasks.map((task) => task.id), ["1.1", "1.2"]);
    assertDeepEqual(parsed.verificationItems.length, 0);

    const directives = parsed.personaDirectives;
    const defaults = directives.persona_defaults as Record<string, unknown>;
    assertDeepEqual(defaults.phase_order, [
      "implement",
      "review",
      "spec_check",
      "test",
    ]);
  });
});

Deno.test("compileChangeToConfig fills default target paths", () => {
  withTempDir((root) => {
    writeChange(
      root,
      "add-missing-target",
      [
        "## 1. 実装タスク",
        "- [ ] T-001 仕様を定義する",
        "  - 依存: なし",
        "  - フェーズ担当: implement=implementer",
      ].join("\n"),
    );

    const compiled = compileChangeToConfig("add-missing-target", {
      openspecRoot: `${root}/openspec`,
      overridesRoot: `${root}/task_configs/overrides`,
    });
    const task = (compiled.tasks as Array<Record<string, unknown>>)[0];
    assertDeepEqual(task.target_paths, ["*"]);
    assertDeepEqual(
      (compiled.meta as Record<string, unknown>).auto_target_path_tasks,
      ["T-001"],
    );
  });
});

Deno.test("compileChangeToConfig rejects dependency cycle", () => {
  withTempDir((root) => {
    writeChange(
      root,
      "add-cycle",
      [
        "## 1. 実装タスク",
        "- [ ] T-001 A",
        "  - 依存: T-002",
        "  - 対象: src/a.ts",
        "  - フェーズ担当: implement=implementer",
        "- [ ] T-002 B",
        "  - 依存: T-001",
        "  - 対象: src/b.ts",
        "  - フェーズ担当: implement=implementer",
      ].join("\n"),
    );

    assertThrowsMessage(
      () =>
        compileChangeToConfig("add-cycle", {
          openspecRoot: `${root}/openspec`,
          overridesRoot: `${root}/task_configs/overrides`,
        }),
      "dependency cycle detected",
    );
  });
});

Deno.test("compileChangeToConfig applies override yaml", () => {
  withTempDir((root) => {
    writeChange(
      root,
      "add-override",
      [
        "## 1. 実装タスク",
        "- [ ] T-001 A",
        "  - 依存: なし",
        "  - 対象: src/a.ts",
        "  - フェーズ担当: implement=implementer",
        "- [ ] T-002 B",
        "  - 依存: T-001",
        "  - 対象: src/b.ts",
        "  - フェーズ担当: implement=implementer",
      ].join("\n"),
    );

    const overrideDir = `${root}/task_configs/overrides`;
    Deno.mkdirSync(overrideDir, { recursive: true });
    Deno.writeTextFileSync(
      `${overrideDir}/add-override.yaml`,
      [
        "teammates:",
        "  - tm-a",
        "  - tm-b",
        "requires_plan:",
        "  T-002: true",
        "tasks:",
        "  T-002:",
        "    target_paths:",
        "      - src/b-override.ts",
      ].join("\n"),
    );

    const compiled = compileChangeToConfig("add-override", {
      openspecRoot: `${root}/openspec`,
      overridesRoot: overrideDir,
    });

    assertDeepEqual(compiled.teammates, ["tm-a", "tm-b"]);
    const tasks = compiled.tasks as Array<Record<string, unknown>>;
    const byId = new Map(tasks.map((task) => [String(task.id), task]));
    assertDeepEqual(byId.get("T-002")?.requires_plan, true);
    assertDeepEqual(byId.get("T-002")?.target_paths, ["src/b-override.ts"]);
  });
});

Deno.test("compileChangeToConfig validates missing task phase assignments", () => {
  withTempDir((root) => {
    writeChange(
      root,
      "add-missing-phase-assignments",
      [
        "## 1. 実装タスク",
        "- [ ] 1.1 実装する",
        "  - 依存: なし",
        "  - 対象: src/a.ts",
        "  - フェーズ担当: implement=implementer",
        "- [ ] 1.2 レビューする",
        "  - 依存: 1.1",
        "  - 対象: src/b.ts",
      ].join("\n"),
    );

    assertThrowsMessage(
      () =>
        compileChangeToConfig("add-missing-phase-assignments", {
          openspecRoot: `${root}/openspec`,
          overridesRoot: `${root}/task_configs/overrides`,
        }),
      "task 1.2 must define phase assignments via persona_policy.phase_overrides",
    );
  });
});

Deno.test("updateTasksMarkdownCheckboxes updates only completed task lines", () => {
  withTempDir((root) => {
    const tasksPath = `${root}/tasks.md`;
    Deno.writeTextFileSync(
      tasksPath,
      [
        "## 1. 実装タスク",
        "- [ ] 1.1 完了済みにしたい",
        "- [ ] 1.2 未完了のまま維持する",
        "- [x] T-003 すでに完了済み",
      ].join("\n"),
    );

    const updatedCount = updateTasksMarkdownCheckboxes(tasksPath, [
      "1.1",
      "T-003",
    ]);
    const updated = Deno.readTextFileSync(tasksPath);

    assertDeepEqual(updatedCount, 1);
    assertDeepEqual(
      updated,
      [
        "## 1. 実装タスク",
        "- [x] 1.1 完了済みにしたい",
        "- [ ] 1.2 未完了のまま維持する",
        "- [x] T-003 すでに完了済み",
      ].join("\n"),
    );
  });
});

Deno.test("updateTasksMarkdownCheckboxes keeps markdown unchanged when no IDs complete", () => {
  withTempDir((root) => {
    const tasksPath = `${root}/tasks.md`;
    const original = [
      "## 1. 実装タスク",
      "- [ ] 1.1 未完了",
      "- [ ] 1.2 未完了",
    ].join("\n");
    Deno.writeTextFileSync(tasksPath, original);

    const updatedCount = updateTasksMarkdownCheckboxes(tasksPath, []);
    const after = Deno.readTextFileSync(tasksPath);

    assertDeepEqual(updatedCount, 0);
    assertDeepEqual(after, original);
  });
});

Deno.test("updateTasksMarkdownCheckboxes is idempotent on rerun", () => {
  withTempDir((root) => {
    const tasksPath = `${root}/tasks.md`;
    Deno.writeTextFileSync(
      tasksPath,
      [
        "## 1. 実装タスク",
        "- [ ] 1.1 1回目で完了",
        "- [ ] 1.2 未完了",
      ].join("\n"),
    );

    const firstUpdatedCount = updateTasksMarkdownCheckboxes(tasksPath, ["1.1"]);
    const afterFirst = Deno.readTextFileSync(tasksPath);
    const secondUpdatedCount = updateTasksMarkdownCheckboxes(tasksPath, [
      "1.1",
    ]);
    const afterSecond = Deno.readTextFileSync(tasksPath);

    assertDeepEqual(firstUpdatedCount, 1);
    assertDeepEqual(secondUpdatedCount, 0);
    assertDeepEqual(afterSecond, afterFirst);
  });
});

Deno.test("updateTasksMarkdownCheckboxes updates only implementation section checkboxes", () => {
  withTempDir((root) => {
    const tasksPath = `${root}/tasks.md`;
    Deno.writeTextFileSync(
      tasksPath,
      [
        "## 1. 実装タスク",
        "- [ ] 1.1 実装タスク",
        "## 2. 人間向けメモ（コンパイラ非対象）",
        "- [ ] 9.9 人間向けのメモ",
      ].join("\n"),
    );

    const updatedCount = updateTasksMarkdownCheckboxes(tasksPath, [
      "1.1",
      "9.9",
    ]);
    const updated = Deno.readTextFileSync(tasksPath);

    assertDeepEqual(updatedCount, 1);
    assertDeepEqual(
      updated,
      [
        "## 1. 実装タスク",
        "- [x] 1.1 実装タスク",
        "## 2. 人間向けメモ（コンパイラ非対象）",
        "- [ ] 9.9 人間向けのメモ",
      ].join("\n"),
    );
  });
});

Deno.test("updateTasksMarkdownCheckboxes supports english implementation heading", () => {
  withTempDir((root) => {
    const tasksPath = `${root}/tasks.md`;
    Deno.writeTextFileSync(
      tasksPath,
      [
        "## 1. Implementation",
        "- [ ] 1.1 implementation task",
        "## 2. Human Notes (non-compiled)",
        "- [ ] 2.1 should remain unchanged",
      ].join("\n"),
    );

    const updatedCount = updateTasksMarkdownCheckboxes(tasksPath, [
      "1.1",
      "2.1",
    ]);
    const updated = Deno.readTextFileSync(tasksPath);

    assertDeepEqual(updatedCount, 1);
    assertDeepEqual(
      updated,
      [
        "## 1. Implementation",
        "- [x] 1.1 implementation task",
        "## 2. Human Notes (non-compiled)",
        "- [ ] 2.1 should remain unchanged",
      ].join("\n"),
    );
  });
});

Deno.test("compiler error class is preserved", () => {
  const error = new OpenSpecCompileError("sample");
  if (!(error instanceof OpenSpecCompileError)) {
    throw new Error("OpenSpecCompileError type must be preserved");
  }
});

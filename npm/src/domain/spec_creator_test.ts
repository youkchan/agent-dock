import { createSpecCreatorTaskConfigTemplate } from "./spec_creator.ts";

function assertDeepEqual(actual: unknown, expected: unknown): void {
  const actualText = JSON.stringify(actual);
  const expectedText = JSON.stringify(expected);
  if (actualText !== expectedText) {
    throw new Error(`expected ${expectedText}, got ${actualText}`);
  }
}

Deno.test("createSpecCreatorTaskConfigTemplate builds fixed 1.1..1.7 tasks", () => {
  const config = createSpecCreatorTaskConfigTemplate("add-sample-change");
  const taskIds = config.tasks.map((task) => task.id);
  assertDeepEqual(taskIds, ["1.1", "1.2", "1.3", "1.4", "1.5", "1.6", "1.7"]);

  if (
    config.tasks[0].target_paths[0] !==
      "openspec/changes/add-sample-change/proposal.md"
  ) {
    throw new Error("task 1.1 should target change-specific outputs");
  }
});

Deno.test("createSpecCreatorTaskConfigTemplate enables only spec personas", () => {
  const config = createSpecCreatorTaskConfigTemplate("add-sample-change");
  const enabledIds = config.personas.filter((persona) => persona.enabled).map((
    persona,
  ) => persona.id);
  assertDeepEqual(enabledIds, [
    "spec-planner",
    "spec-reviewer",
    "spec-code-creator",
  ]);
});

Deno.test("createSpecCreatorTaskConfigTemplate embeds transport/fail-closed guidance in persona focus", () => {
  const config = createSpecCreatorTaskConfigTemplate("add-sample-change");
  const byId = new Map(config.personas.map((persona) => [persona.id, persona]));

  const specPlanner = byId.get("spec-planner");
  if (!specPlanner?.focus.includes("transport経路")) {
    throw new Error("spec-planner focus should include transport guidance");
  }
  if (!specPlanner.focus.includes("fail-closed拒否点")) {
    throw new Error("spec-planner focus should include fail-closed guidance");
  }

  const specReviewer = byId.get("spec-reviewer");
  if (!specReviewer?.focus.includes("transport経路未配線")) {
    throw new Error("spec-reviewer focus should include transport wiring gate");
  }
  if (!specReviewer.focus.includes("対応テスト欠落をblocker")) {
    throw new Error("spec-reviewer focus should include blocker gate");
  }

  const specCodeCreator = byId.get("spec-code-creator");
  if (!specCodeCreator?.focus.includes("transport経路")) {
    throw new Error("spec-code-creator focus should include transport mapping");
  }

  const testOwner = byId.get("test-owner");
  if (!testOwner?.focus.includes("transport経路テスト")) {
    throw new Error("test-owner focus should include transport-path tests");
  }
  if (!testOwner.focus.includes("fail-closed拒否テスト")) {
    throw new Error("test-owner focus should include rejection tests");
  }
});

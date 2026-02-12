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

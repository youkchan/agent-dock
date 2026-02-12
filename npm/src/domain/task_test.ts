import { createTask, taskFromRecord, taskToRecord } from "./task.ts";

function assertDeepEqual(actual: unknown, expected: unknown): void {
  const actualText = JSON.stringify(actual);
  const expectedText = JSON.stringify(expected);
  if (actualText !== expectedText) {
    throw new Error(`expected ${expectedText}, got ${actualText}`);
  }
}

Deno.test("createTask resolves plan_status from requires_plan", () => {
  const planRequired = createTask({
    id: "A",
    title: "plan",
    requires_plan: true,
  });
  const noPlan = createTask({
    id: "B",
    title: "no-plan",
  });

  if (planRequired.plan_status !== "pending") {
    throw new Error("expected pending plan_status for requires_plan=true");
  }
  if (noPlan.plan_status !== "not_required") {
    throw new Error(
      "expected not_required plan_status for requires_plan=false",
    );
  }
});

Deno.test("taskFromRecord keeps persona_policy deep-cloned", () => {
  const task = taskFromRecord({
    id: "T1",
    title: "sample",
    target_paths: ["src/a.ts"],
    depends_on: [],
    persona_policy: {
      disable_personas: ["spec-checker"],
    },
  });

  const record = taskToRecord(task);
  const policy = record.persona_policy as { disable_personas: string[] };
  policy.disable_personas.push("code-reviewer");
  assertDeepEqual(task.persona_policy, { disable_personas: ["spec-checker"] });
});

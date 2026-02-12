import { createTask, type Task } from "../../domain/task.ts";
import type { PersonaDefinition } from "../../domain/persona.ts";
import { StateStore } from "../../infrastructure/state/store.ts";
import {
  AgentTeamsLikeOrchestrator,
  MockOrchestratorProvider,
  OrchestratorConfig,
  type TeammateAdapter,
} from "./orchestrator.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual(
  actual: unknown,
  expected: unknown,
  message: string,
): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}: expected=${JSON.stringify(expected)} actual=${
        JSON.stringify(actual)
      }`,
    );
  }
}

function withTempDir(run: (dir: string) => void): void {
  const dir = Deno.makeTempDirSync();
  try {
    run(dir);
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
}

class TemplateAdapter implements TeammateAdapter {
  buildPlan(teammateId: string, task: Task): string {
    return `plan teammate=${teammateId} task=${task.id}`;
  }

  executeTask(_teammateId: string, task: Task): string {
    return `done task=${task.id}`;
  }
}

class RecordingAdapter implements TeammateAdapter {
  readonly seenExecutionIds: string[] = [];

  buildPlan(_teammateId: string, _task: Task): string {
    return "plan";
  }

  executeTask(teammateId: string, _task: Task): string {
    this.seenExecutionIds.push(teammateId);
    return `done:${teammateId}`;
  }
}

Deno.test("orchestrator completes plan approval flow", () => {
  withTempDir((dir) => {
    const store = new StateStore(dir);
    store.bootstrapTasks([
      createTask({
        id: "T1",
        title: "task1",
        requires_plan: true,
        target_paths: ["src/a.ts"],
      }),
      createTask({
        id: "T2",
        title: "task2",
        depends_on: ["T1"],
        target_paths: ["src/b.ts"],
      }),
    ]);

    const orchestrator = new AgentTeamsLikeOrchestrator({
      store,
      adapter: new TemplateAdapter(),
      provider: new MockOrchestratorProvider(),
      config: new OrchestratorConfig({
        teammateIds: ["tm-1"],
        maxRounds: 50,
        maxIdleRounds: 10,
        maxIdleSeconds: 60,
      }),
    });

    const result = orchestrator.run();
    assertEqual(result.stop_reason, "all_tasks_completed", "stop reason");
    assertEqual(
      (result.summary as Record<string, number>).completed,
      2,
      "completed count",
    );
    assert((result.provider_calls as number) >= 1, "provider should be called");
  });
});

Deno.test("orchestrator human approval stops before provider call", () => {
  withTempDir((dir) => {
    const store = new StateStore(dir);
    store.bootstrapTasks([
      createTask({
        id: "T1",
        title: "task1",
        requires_plan: true,
        target_paths: ["src/a.ts"],
      }),
    ]);

    const orchestrator = new AgentTeamsLikeOrchestrator({
      store,
      adapter: new TemplateAdapter(),
      provider: new MockOrchestratorProvider(),
      config: new OrchestratorConfig({
        teammateIds: ["tm-1"],
        maxRounds: 10,
        humanApproval: true,
      }),
    });

    const result = orchestrator.run();
    assertEqual(result.stop_reason, "human_approval_required", "stop reason");
    assertEqual(result.provider_calls, 0, "provider call count");
  });
});

Deno.test("orchestrator persona executor claims owner with persona id", () => {
  withTempDir((dir) => {
    const store = new StateStore(dir);
    store.bootstrapTasks([
      createTask({
        id: "T1",
        title: "task1",
        target_paths: ["src/a.ts"],
      }),
    ]);

    const adapter = new RecordingAdapter();
    const orchestrator = new AgentTeamsLikeOrchestrator({
      store,
      adapter,
      provider: new MockOrchestratorProvider(),
      config: new OrchestratorConfig({
        teammateIds: ["tm-1"],
        maxRounds: 5,
        maxIdleRounds: 5,
        maxIdleSeconds: 60,
        personas: [
          createPersona("impl-persona", {
            enabled: true,
          }),
        ],
      }),
    });

    const result = orchestrator.run();
    assertEqual(result.stop_reason, "all_tasks_completed", "stop reason");
    assertEqual(
      adapter.seenExecutionIds,
      ["impl-persona"],
      "execution subject",
    );

    const task = store.getTask("T1");
    assert(task !== null, "task should exist");
    assertEqual(task.owner, "impl-persona", "owner should keep persona id");
    assert(
      task.progress_log.some((entry) =>
        String(entry.text ?? "").startsWith(
          "execution started persona=impl-persona",
        )
      ),
      "progress log should include persona start",
    );
  });
});

Deno.test("orchestrator phase order handoff switches execution persona", () => {
  withTempDir((dir) => {
    const store = new StateStore(dir);
    store.bootstrapTasks([
      createTask({
        id: "T1",
        title: "task1",
        target_paths: ["src/a.ts"],
      }),
    ]);

    const adapter = new RecordingAdapter();
    const orchestrator = new AgentTeamsLikeOrchestrator({
      store,
      adapter,
      provider: new MockOrchestratorProvider(),
      config: new OrchestratorConfig({
        teammateIds: ["tm-1"],
        maxRounds: 5,
        maxIdleRounds: 5,
        maxIdleSeconds: 60,
        personas: [
          createPersona("implementer", { enabled: true }),
          createPersona("reviewer", { enabled: true }),
        ],
        personaDefaults: {
          phase_order: ["implement", "review"],
          phase_policies: {
            implement: { executor_personas: ["implementer"] },
            review: { executor_personas: ["reviewer"] },
          },
        },
      }),
    });

    const result = orchestrator.run();
    assertEqual(result.stop_reason, "all_tasks_completed", "stop reason");
    assertEqual(
      adapter.seenExecutionIds,
      ["implementer", "reviewer"],
      "phase handoff execution order",
    );

    const task = store.getTask("T1");
    assert(task !== null, "task should exist");
    assertEqual(task.status, "completed", "final status");
    assertEqual(task.current_phase_index, 1, "phase index should advance");
    assert(
      task.progress_log.some((entry) =>
        String(entry.text ?? "").includes("phase handoff to review")
      ),
      "progress log should include handoff",
    );
  });
});

function createPersona(
  id: string,
  options: {
    enabled: boolean;
  },
): PersonaDefinition {
  return {
    id,
    role: "custom",
    focus: `focus:${id}`,
    can_block: false,
    enabled: options.enabled,
    execution: {
      enabled: true,
      command_ref: "default",
      sandbox: "workspace-write",
      timeout_sec: 900,
    },
  };
}

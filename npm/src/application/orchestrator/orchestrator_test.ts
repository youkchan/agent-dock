import { createTask, type Task } from "../../domain/task.ts";
import type { PersonaDefinition } from "../../domain/persona.ts";
import { createSpecCreatorTaskConfigTemplate } from "../../domain/spec_creator.ts";
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

class FixedResultAdapter implements TeammateAdapter {
  readonly resultText: string;

  constructor(resultText: string) {
    this.resultText = resultText;
  }

  buildPlan(_teammateId: string, _task: Task): string {
    return "plan";
  }

  executeTask(_teammateId: string, _task: Task): string {
    return this.resultText;
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

Deno.test("orchestrator stops when spec-reviewer emits reviewer stop signal", () => {
  withTempDir((dir) => {
    const store = new StateStore(dir);
    store.bootstrapTasks([
      createTask({
        id: "T1",
        title: "task1",
        target_paths: ["src/a.ts"],
      }),
    ]);

    const orchestrator = new AgentTeamsLikeOrchestrator({
      store,
      adapter: new FixedResultAdapter(
        "REVIEWER_STOP:requirement_drift detected major drift",
      ),
      provider: new MockOrchestratorProvider(),
      config: new OrchestratorConfig({
        maxRounds: 5,
        maxIdleRounds: 5,
        maxIdleSeconds: 60,
        personas: [
          createPersona("spec-reviewer", {
            enabled: true,
            role: "reviewer",
            canBlock: true,
          }),
        ],
      }),
    });

    const result = orchestrator.run();
    assertEqual(
      result.stop_reason,
      "persona_blocker:spec-reviewer",
      "stop reason",
    );
    assertEqual(result.provider_calls, 0, "provider call count");

    const task = store.getTask("T1");
    assert(task !== null, "task should exist");
    assertEqual(task.status, "needs_approval", "task should be escalated");
    assert(
      task.progress_log.some((entry) =>
        String(entry.text ?? "").includes("reviewer stop candidate")
      ),
      "progress log should include reviewer stop marker",
    );
  });
});

Deno.test("orchestrator stops on idle round limit when tasks are unclaimable", () => {
  withTempDir((dir) => {
    const store = new StateStore(dir);
    store.bootstrapTasks([
      createTask({
        id: "T1",
        title: "blocked",
        depends_on: ["T999"],
        target_paths: ["src/a.ts"],
      }),
    ]);

    const orchestrator = new AgentTeamsLikeOrchestrator({
      store,
      adapter: new TemplateAdapter(),
      provider: new MockOrchestratorProvider(),
      config: new OrchestratorConfig({
        teammateIds: ["tm-1"],
        maxRounds: 5,
        maxIdleRounds: 1,
        maxIdleSeconds: 120,
      }),
    });

    const result = orchestrator.run();
    assertEqual(result.stop_reason, "idle_rounds_limit", "stop reason");
    assertEqual(
      (result.summary as Record<string, number>).pending,
      1,
      "pending count",
    );
    assertEqual(result.provider_calls, 1, "provider call count");
  });
});

Deno.test("orchestrator detects reviewer stop from natural language violation", () => {
  withTempDir((dir) => {
    const store = new StateStore(dir);
    store.bootstrapTasks([
      createTask({
        id: "T1",
        title: "task1",
        target_paths: ["src/a.ts"],
      }),
    ]);

    const orchestrator = new AgentTeamsLikeOrchestrator({
      store,
      adapter: new FixedResultAdapter(
        "重大な要件逸脱を検出したため停止します。blocker violation",
      ),
      provider: new MockOrchestratorProvider(),
      config: new OrchestratorConfig({
        maxRounds: 5,
        maxIdleRounds: 5,
        maxIdleSeconds: 60,
        personas: [
          createPersona("spec-reviewer", {
            enabled: true,
            role: "reviewer",
            canBlock: true,
          }),
        ],
      }),
    });

    const result = orchestrator.run();
    assertEqual(
      result.stop_reason,
      "persona_blocker:spec-reviewer",
      "stop reason",
    );
    assertEqual(result.provider_calls, 0, "provider call count");
  });
});

Deno.test("orchestrator runs fixed spec creator profile on normal run path", () => {
  withTempDir((dir) => {
    const store = new StateStore(dir);
    const taskConfig = createSpecCreatorTaskConfigTemplate("add-spec-change");
    store.bootstrapTasks(
      taskConfig.tasks.map((task) =>
        createTask({
          id: task.id,
          title: task.title,
          description: task.description,
          target_paths: task.target_paths,
          depends_on: task.depends_on,
          requires_plan: task.requires_plan,
          persona_policy: task.persona_policy,
        })
      ),
    );

    const adapter = new RecordingAdapter();
    const orchestrator = new AgentTeamsLikeOrchestrator({
      store,
      adapter,
      provider: new MockOrchestratorProvider(),
      config: new OrchestratorConfig({
        teammateIds: ["tm-1"],
        maxRounds: 80,
        maxIdleRounds: 10,
        maxIdleSeconds: 60,
        personas: taskConfig.personas,
        personaDefaults: taskConfig.persona_defaults as Record<string, unknown>,
      }),
    });

    const result = orchestrator.run();
    assertEqual(result.stop_reason, "all_tasks_completed", "stop reason");
    assertEqual(
      (result.summary as Record<string, number>).completed,
      taskConfig.tasks.length,
      "completed count",
    );

    const seen = new Set(adapter.seenExecutionIds);
    assert(seen.has("spec-planner"), "spec-planner should execute");
    assert(seen.has("spec-reviewer"), "spec-reviewer should execute");
    assert(seen.has("spec-code-creator"), "spec-code-creator should execute");
    assert(!seen.has("tm-1"), "teammate fallback must not execute");

    const task15 = store.getTask("1.5");
    assert(task15 !== null, "task 1.5 should exist");
    assert(
      task15.progress_log.some((entry) =>
        String(entry.text ?? "").startsWith(
          "execution started persona=spec-code-creator",
        )
      ),
      "task 1.5 should include spec-code-creator execution",
    );
  });
});

function createPersona(
  id: string,
  options: {
    enabled: boolean;
    canBlock?: boolean;
    role?: PersonaDefinition["role"];
  },
): PersonaDefinition {
  return {
    id,
    role: options.role ?? "custom",
    focus: `focus:${id}`,
    can_block: options.canBlock ?? false,
    enabled: options.enabled,
    execution: {
      enabled: true,
      command_ref: "default",
      sandbox: "workspace-write",
      timeout_sec: 900,
    },
  };
}

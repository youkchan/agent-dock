import { createTask, normalizeTaskPhase, type Task } from "../../domain/task.ts";
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

function assertThrowsMessage(fn: () => void, text: string): void {
  let thrown: unknown = null;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }
  if (!(thrown instanceof Error)) {
    throw new Error(`expected function to throw Error with message including ${text}`);
  }
  if (!thrown.message.includes(text)) {
    throw new Error(`expected '${thrown.message}' to include '${text}'`);
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

function withTempCwd(run: (dir: string) => void): void {
  withTempDir((dir) => {
    const previous = Deno.cwd();
    Deno.chdir(dir);
    try {
      run(dir);
    } finally {
      Deno.chdir(previous);
    }
  });
}

class TemplateAdapter implements TeammateAdapter {
  buildPlan(teammateId: string, task: Task): string {
    return `plan teammate=${teammateId} task=${task.id}`;
  }

  executeTask(_teammateId: string, task: Task): string {
    return phaseAwareResult(task, `done task=${task.id}`);
  }
}

class RecordingAdapter implements TeammateAdapter {
  readonly seenExecutionIds: string[] = [];

  buildPlan(_teammateId: string, _task: Task): string {
    return "plan";
  }

  executeTask(teammateId: string, task: Task): string {
    this.seenExecutionIds.push(teammateId);
    return phaseAwareResult(task, `done:${teammateId}`);
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

class OrderedResultAdapter implements TeammateAdapter {
  readonly seenExecutionIds: string[] = [];
  readonly resultByPersona: Record<string, string>;
  readonly defaultResult: string;

  constructor(
    resultByPersona: Record<string, string>,
    defaultResult: string = decisionPhaseResult({
      status: "completed",
      judgment: "pass",
      summary: "ok",
    }),
  ) {
    this.resultByPersona = resultByPersona;
    this.defaultResult = defaultResult;
  }

  buildPlan(_teammateId: string, _task: Task): string {
    return "plan";
  }

  executeTask(teammateId: string, _task: Task): string {
    this.seenExecutionIds.push(teammateId);
    return this.resultByPersona[teammateId] ?? this.defaultResult;
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

Deno.test("orchestrator run fails with runtime validation when implement has multiple executors", () => {
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
      adapter: new TemplateAdapter(),
      provider: new MockOrchestratorProvider(),
      config: new OrchestratorConfig({
        teammateIds: ["tm-1"],
        personas: [
          createPersona("impl-a", { enabled: true }),
          createPersona("impl-b", { enabled: true }),
          createPersona("reviewer", { enabled: true, role: "reviewer" }),
        ],
        personaDefaults: {
          phase_order: ["implement", "review", "test"],
          phase_policies: {
            implement: { executor_personas: ["impl-a", "impl-b"] },
            review: {
              executor_personas: ["reviewer"],
              state_transition_personas: ["lead"],
            },
            test: { executor_personas: ["reviewer"] },
          },
        },
        maxRounds: 3,
        maxIdleRounds: 1,
        maxIdleSeconds: 60,
      }),
    });

    assertThrowsMessage(
      () => orchestrator.run(),
      "runtime validation error",
    );
  });
});

Deno.test("orchestrator run fails with runtime validation when task implement has multiple executors", () => {
  withTempDir((dir) => {
    const store = new StateStore(dir);
    store.bootstrapTasks([
      createTask({
        id: "T1",
        title: "task1",
        target_paths: ["src/a.ts"],
        persona_policy: {
          phase_overrides: {
            implement: {
              executor_personas: ["impl-a", "impl-b"],
            },
          },
        },
      }),
    ]);

    const orchestrator = new AgentTeamsLikeOrchestrator({
      store,
      adapter: new TemplateAdapter(),
      provider: new MockOrchestratorProvider(),
      config: new OrchestratorConfig({
        teammateIds: ["tm-1"],
        maxRounds: 3,
        maxIdleRounds: 1,
        maxIdleSeconds: 60,
        personas: [
          createPersona("impl-a", { enabled: true }),
          createPersona("impl-b", { enabled: true }),
          createPersona("reviewer", { enabled: true, role: "reviewer" }),
        ],
        personaDefaults: {
          phase_order: ["implement", "review", "test"],
          phase_policies: {
            implement: { executor_personas: ["impl-a"] },
            review: {
              executor_personas: ["reviewer"],
              state_transition_personas: ["lead"],
            },
            test: { executor_personas: ["reviewer"] },
          },
        },
      }),
    });

    assertThrowsMessage(
      () => orchestrator.run(),
      "runtime validation error",
    );
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
            review: {
              executor_personas: ["reviewer"],
              state_transition_personas: ["lead"],
            },
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

Deno.test("orchestrator executes review phase in configured persona order and aggregates changes_required", () => {
  withTempDir((dir) => {
    const store = new StateStore(dir);
    store.bootstrapTasks([
      createTask({
        id: "T1",
        title: "review task",
        target_paths: ["src/a.ts"],
        current_phase_index: 1,
      }),
    ]);

    const adapter = new OrderedResultAdapter({
      "review-right": decisionPhaseResult({
        status: "completed",
        judgment: "changes_required",
        summary: "right requires fix",
      }),
      "review-left": decisionPhaseResult({
        status: "completed",
        judgment: "changes_required",
        summary: "left requires fix",
      }),
    });

    const orchestrator = new AgentTeamsLikeOrchestrator({
      store,
      adapter,
      provider: new MockOrchestratorProvider(),
      config: new OrchestratorConfig({
        maxRounds: 4,
        maxIdleRounds: 1,
        maxIdleSeconds: 60,
        teammateIds: ["review-left", "review-right"],
        personas: [
          createPersona("review-left", { enabled: true }),
          createPersona("review-right", { enabled: true }),
        ],
        personaDefaults: {
          phase_order: ["implement", "review"],
          phase_policies: {
            implement: { executor_personas: ["implementer"] },
            review: {
              executor_personas: ["review-right", "review-left"],
              state_transition_personas: ["lead"],
            },
          },
        },
      }),
    });

    const result = orchestrator.run();
    assertEqual(
      result.stop_reason,
      "idle_rounds_limit",
      "stop reason",
    );
    assertEqual(
      adapter.seenExecutionIds,
      ["review-right", "review-left"],
      "execution order",
    );

    const task = store.getTask("T1");
    assert(task !== null, "task should exist");
    assertEqual(task.status, "pending", "task status");
    assertEqual(task.current_phase_index, 0, "task returned to implement");
    assertEqual(task.revision_count, 1, "revision count");
    assertEqual(
      store.listRecentMessages(20).filter((message) =>
        String(message.content).includes("task sendback task=T1")
      ).length,
      1,
      "single sendback message should be emitted",
    );
    assert(
      task.progress_log.some((entry) =>
        String(entry.text ?? "").includes("task sendback task=T1")
      ),
      "progress log should include sendback marker",
    );
  });
});

Deno.test("orchestrator blocks when later reviewer blocks in ordered execution", () => {
  withTempDir((dir) => {
    const store = new StateStore(dir);
    store.bootstrapTasks([
      createTask({
        id: "T1",
        title: "review task",
        target_paths: ["src/a.ts"],
        current_phase_index: 1,
      }),
    ]);

    const adapter = new OrderedResultAdapter({
      "review-right": decisionPhaseResult({
        status: "completed",
        judgment: "changes_required",
        summary: "right requires fix",
      }),
      "review-left": decisionPhaseResult({
        status: "blocked",
        summary: "left blocked",
      }),
    });

    const orchestrator = new AgentTeamsLikeOrchestrator({
      store,
      adapter,
      provider: new MockOrchestratorProvider(),
      config: new OrchestratorConfig({
        maxRounds: 4,
        maxIdleRounds: 1,
        maxIdleSeconds: 60,
        teammateIds: ["review-left", "review-right"],
        personas: [
          createPersona("review-left", { enabled: true }),
          createPersona("review-right", { enabled: true }),
        ],
        personaDefaults: {
          phase_order: ["implement", "review"],
          phase_policies: {
            implement: { executor_personas: ["implementer"] },
            review: {
              executor_personas: ["review-right", "review-left"],
              state_transition_personas: ["lead"],
            },
          },
        },
      }),
    });

    const result = orchestrator.run();
    assertEqual(
      result.stop_reason,
      "idle_rounds_limit",
      "stop reason",
    );
    assertEqual(
      adapter.seenExecutionIds,
      ["review-right", "review-left"],
      "ordered execution before block",
    );
    const task = store.getTask("T1");
    assert(task !== null, "task should exist");
    assertEqual(task.status, "blocked", "task status");
    assert(
      String(task.block_reason).includes("execution result is blocked"),
      "block reason should indicate blocked execution result",
    );
    assert(
      !task.progress_log.some((entry) =>
        String(entry.text ?? "").includes("task sendback task=T1")
      ),
      "blocked should skip sendback",
    );
  });
});

Deno.test("orchestrator blocks immediately when any reviewer blocks in ordered execution", () => {
  withTempDir((dir) => {
    const store = new StateStore(dir);
    store.bootstrapTasks([
      createTask({
        id: "T1",
        title: "review task",
        target_paths: ["src/a.ts"],
        current_phase_index: 1,
      }),
    ]);

    const adapter = new OrderedResultAdapter({
      "review-right": decisionPhaseResult({
        status: "blocked",
        summary: "blocked by right reviewer",
      }),
      "review-left": decisionPhaseResult({
        status: "completed",
        judgment: "pass",
        summary: "left passed",
      }),
    });

    const orchestrator = new AgentTeamsLikeOrchestrator({
      store,
      adapter,
      provider: new MockOrchestratorProvider(),
      config: new OrchestratorConfig({
        maxRounds: 3,
        maxIdleRounds: 1,
        maxIdleSeconds: 60,
        teammateIds: ["review-left", "review-right"],
        personas: [
          createPersona("review-left", { enabled: true }),
          createPersona("review-right", { enabled: true }),
        ],
        personaDefaults: {
          phase_order: ["implement", "review"],
          phase_policies: {
            implement: { executor_personas: ["implementer"] },
            review: {
              executor_personas: ["review-right", "review-left"],
              state_transition_personas: ["lead"],
            },
          },
        },
      }),
    });

    const result = orchestrator.run();
    assertEqual(
      result.stop_reason,
      "idle_rounds_limit",
      "stop reason",
    );
    assertEqual(
      adapter.seenExecutionIds,
      ["review-right"],
      "blocked immediately by first reviewer",
    );
    const task = store.getTask("T1");
    assert(task !== null, "task should exist");
    assertEqual(task.status, "blocked", "task status");
    assert(
      String(task.block_reason).includes("execution result is blocked"),
      "block reason should indicate blocked execution result",
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

function phaseAwareResult(task: Task, summary: string): string {
  const phase = resolveTaskPhaseForFixture(task);
  if (phase === "review" || phase === "spec_check" || phase === "test") {
    return decisionPhaseResult({
      summary,
      judgment: "pass",
    });
  }
  const changedFile = task.target_paths[0] ?? "(none)";
  return completedResult(summary, changedFile);
}

function resolveTaskPhaseForFixture(task: Task): string | null {
  for (let index = task.progress_log.length - 1; index >= 0; index -= 1) {
    const text = String(task.progress_log[index]?.text ?? "");
    const match = /\bphase=([a-z0-9_-]+)\b/iu.exec(text);
    if (!match) {
      continue;
    }
    const phase = normalizeTaskPhase(match[1]);
    if (phase !== null) {
      return phase;
    }
  }

  if (
    typeof task.current_phase_index === "number" &&
    Number.isFinite(task.current_phase_index)
  ) {
    const phaseIndex = Math.trunc(task.current_phase_index);
    if (phaseIndex >= 0) {
      const phaseOrder = task.persona_policy?.phase_order;
      if (Array.isArray(phaseOrder) && phaseIndex < phaseOrder.length) {
        const phase = normalizeTaskPhase(phaseOrder[phaseIndex]);
        if (phase !== null) {
          return phase;
        }
      }
      if (phaseIndex > 0) {
        return "review";
      }
    }
  }

  return null;
}

function completedResult(summary: string, changedFiles: string = "(none)"): string {
  return [
    "RESULT: completed",
    `SUMMARY: ${summary}`,
    `CHANGED_FILES: ${changedFiles}`,
    "CHECKS: deno test src",
  ].join("\n");
}

function decisionPhaseResult(options: {
  status?: "completed" | "blocked";
  summary?: string;
  changedFiles?: string;
  checks?: string;
  judgment?: string | null;
} = {}): string {
  const lines = [
    `RESULT: ${options.status ?? "completed"}`,
    `SUMMARY: ${options.summary ?? "ok"}`,
    `CHANGED_FILES: ${options.changedFiles ?? "(none)"}`,
    `CHECKS: ${options.checks ?? "deno test src"}`,
  ];
  if (options.judgment !== undefined && options.judgment !== null) {
    lines.push(`JUDGMENT: ${options.judgment}`);
  }
  return lines.join("\n");
}

Deno.test("orchestrator blocks when RESULT is blocked", () => {
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
        [
          "RESULT: blocked",
          "SUMMARY: tests failed",
          "CHANGED_FILES: src/a.ts",
          "CHECKS: deno test src",
        ].join("\n"),
      ),
      provider: new MockOrchestratorProvider(),
      config: new OrchestratorConfig({
        teammateIds: ["tm-1"],
        personas: [],
        maxRounds: 3,
        maxIdleRounds: 1,
        maxIdleSeconds: 60,
      }),
    });

    const result = orchestrator.run();
    assertEqual(result.stop_reason, "idle_rounds_limit", "stop reason");
    const task = store.getTask("T1");
    assert(task !== null, "task should exist");
    assertEqual(task.status, "blocked", "task status");
    assert(
      String(task.block_reason).includes("execution result is blocked"),
      "block reason should include result status",
    );
  });
});

Deno.test("orchestrator teammate mode keeps legacy behavior for decision metadata", () => {
  withTempDir((dir) => {
    const store = new StateStore(dir);
    store.bootstrapTasks([
      createTask({
        id: "T1",
        title: "legacy task",
        target_paths: ["src/a.ts"],
        current_phase_index: 2,
      }),
    ]);

    const orchestrator = new AgentTeamsLikeOrchestrator({
      store,
      adapter: new FixedResultAdapter(
        decisionPhaseResult({
          summary: "legacy decision metadata",
          changedFiles: "src/a.ts",
          judgment: "blocked",
        }),
      ),
      provider: new MockOrchestratorProvider(),
      config: new OrchestratorConfig({
        teammateIds: ["tm-1"],
        personas: [],
        maxRounds: 3,
        maxIdleRounds: 1,
        maxIdleSeconds: 60,
        personaDefaults: {
          phase_order: ["implement", "review", "test"],
          phase_policies: {
            implement: { executor_personas: ["implementer"] },
            review: { executor_personas: ["reviewer"] },
            test: { executor_personas: ["tester"] },
          },
        },
      }),
    });

    const result = orchestrator.run();
    assertEqual(result.stop_reason, "all_tasks_completed", "stop reason");

    const task = store.getTask("T1");
    assert(task !== null, "task should exist");
    assertEqual(task.status, "completed", "task status");
    assert(
      task.progress_log.some((entry) =>
        String(entry.text ?? "").startsWith("execution started teammate=tm-1")
      ),
      "progress log should keep teammate mode",
    );
  });
});

Deno.test("orchestrator review phase completes when JUDGMENT is pass", () => {
  withTempDir((dir) => {
    const store = new StateStore(dir);
    store.bootstrapTasks([
      createTask({
        id: "T1",
        title: "review task",
        target_paths: ["src/a.ts"],
        current_phase_index: 1,
      }),
    ]);

    const orchestrator = new AgentTeamsLikeOrchestrator({
      store,
      adapter: new FixedResultAdapter(
        decisionPhaseResult({
          judgment: "pass",
        }),
      ),
      provider: new MockOrchestratorProvider(),
      config: new OrchestratorConfig({
        maxRounds: 4,
        maxIdleRounds: 1,
        maxIdleSeconds: 60,
        personas: [
          createPersona("reviewer", {
            enabled: true,
            role: "reviewer",
          }),
        ],
        personaDefaults: {
          phase_order: ["implement", "review"],
          phase_policies: {
            implement: { executor_personas: ["implementer"] },
            review: {
              executor_personas: ["reviewer"],
              state_transition_personas: ["lead"],
            },
          },
        },
      }),
    });

    const result = orchestrator.run();
    assertEqual(result.stop_reason, "all_tasks_completed", "stop reason");

    const task = store.getTask("T1");
    assert(task !== null, "task should exist");
    assertEqual(task.status, "completed", "task status");
  });
});

Deno.test("orchestrator review phase blocks when JUDGMENT is missing", () => {
  withTempDir((dir) => {
    const store = new StateStore(dir);
    store.bootstrapTasks([
      createTask({
        id: "T1",
        title: "review task",
        target_paths: ["src/a.ts"],
        current_phase_index: 1,
      }),
    ]);

    const orchestrator = new AgentTeamsLikeOrchestrator({
      store,
      adapter: new FixedResultAdapter(
        decisionPhaseResult({
          summary: "reviewed without explicit judgment",
        }),
      ),
      provider: new MockOrchestratorProvider(),
      config: new OrchestratorConfig({
        maxRounds: 3,
        maxIdleRounds: 1,
        maxIdleSeconds: 60,
        personas: [
          createPersona("reviewer", {
            enabled: true,
            role: "reviewer",
          }),
        ],
        personaDefaults: {
          phase_order: ["implement", "review"],
          phase_policies: {
            implement: { executor_personas: ["implementer"] },
            review: {
              executor_personas: ["reviewer"],
              state_transition_personas: ["lead"],
            },
          },
        },
      }),
    });

    const result = orchestrator.run();
    assertEqual(result.stop_reason, "idle_rounds_limit", "stop reason");

    const task = store.getTask("T1");
    assert(task !== null, "task should exist");
    assertEqual(task.status, "blocked", "task status");
    assert(
      String(task.block_reason).includes("missing JUDGMENT in decision phase"),
      "block reason should include missing judgment marker",
    );
  });
});

Deno.test("orchestrator review phase blocks when only stale JUDGMENT exists", () => {
  withTempDir((dir) => {
    const store = new StateStore(dir);
    store.bootstrapTasks([
      createTask({
        id: "T1",
        title: "review task",
        target_paths: ["src/a.ts"],
        current_phase_index: 1,
      }),
    ]);

    const orchestrator = new AgentTeamsLikeOrchestrator({
      store,
      adapter: new FixedResultAdapter(
        [
          "JUDGMENT: pass",
          "RESULT: completed",
          "SUMMARY: reviewed without current judgment",
          "CHANGED_FILES: (none)",
          "CHECKS: deno test src",
        ].join("\n"),
      ),
      provider: new MockOrchestratorProvider(),
      config: new OrchestratorConfig({
        maxRounds: 3,
        maxIdleRounds: 1,
        maxIdleSeconds: 60,
        personas: [
          createPersona("reviewer", {
            enabled: true,
            role: "reviewer",
          }),
        ],
        personaDefaults: {
          phase_order: ["implement", "review"],
          phase_policies: {
            implement: { executor_personas: ["implementer"] },
            review: {
              executor_personas: ["reviewer"],
              state_transition_personas: ["lead"],
            },
          },
        },
      }),
    });

    const result = orchestrator.run();
    assertEqual(result.stop_reason, "idle_rounds_limit", "stop reason");

    const task = store.getTask("T1");
    assert(task !== null, "task should exist");
    assertEqual(task.status, "blocked", "task status");
    assert(
      String(task.block_reason).includes("missing JUDGMENT in decision phase"),
      "block reason should include missing judgment marker",
    );
  });
});

Deno.test("orchestrator test phase completes when JUDGMENT is pass", () => {
  withTempDir((dir) => {
    const store = new StateStore(dir);
    store.bootstrapTasks([
      createTask({
        id: "T1",
        title: "test task",
        target_paths: ["src/a.ts"],
        current_phase_index: 2,
      }),
    ]);

    const orchestrator = new AgentTeamsLikeOrchestrator({
      store,
      adapter: new FixedResultAdapter(
        decisionPhaseResult({
          judgment: "pass",
        }),
      ),
      provider: new MockOrchestratorProvider(),
      config: new OrchestratorConfig({
        maxRounds: 4,
        maxIdleRounds: 1,
        maxIdleSeconds: 60,
        personas: [
          createPersona("tester", {
            enabled: true,
          }),
        ],
        personaDefaults: {
          phase_order: ["implement", "review", "test"],
          phase_policies: {
            implement: { executor_personas: ["implementer"] },
            review: { executor_personas: ["reviewer"] },
            test: {
              executor_personas: ["tester"],
              state_transition_personas: ["lead"],
            },
          },
        },
      }),
    });

    const result = orchestrator.run();
    assertEqual(result.stop_reason, "all_tasks_completed", "stop reason");

    const task = store.getTask("T1");
    assert(task !== null, "task should exist");
    assertEqual(task.status, "completed", "task status");
  });
});

Deno.test("orchestrator review phase sendback on JUDGMENT changes_required", () => {
  withTempDir((dir) => {
    const store = new StateStore(dir);
    store.bootstrapTasks([
      createTask({
        id: "T1",
        title: "review task",
        target_paths: ["src/a.ts"],
        current_phase_index: 1,
      }),
    ]);

    const orchestrator = new AgentTeamsLikeOrchestrator({
      store,
      adapter: new FixedResultAdapter(
        decisionPhaseResult({
          summary: "needs changes",
          judgment: "changes_required",
        }),
      ),
      provider: new MockOrchestratorProvider(),
      config: new OrchestratorConfig({
        maxRounds: 4,
        maxIdleRounds: 1,
        maxIdleSeconds: 60,
        personas: [
          createPersona("reviewer", {
            enabled: true,
            role: "reviewer",
          }),
        ],
        personaDefaults: {
          phase_order: ["implement", "review"],
          phase_policies: {
            implement: { executor_personas: ["implementer"] },
            review: {
              executor_personas: ["reviewer"],
              state_transition_personas: ["lead"],
            },
          },
        },
      }),
    });

    const result = orchestrator.run();
    assertEqual(result.stop_reason, "idle_rounds_limit", "stop reason");

    const task = store.getTask("T1");
    assert(task !== null, "task should exist");
    assertEqual(task.status, "pending", "task status");
    assertEqual(task.current_phase_index, 0, "phase index after sendback");
    assertEqual(task.revision_count, 1, "revision count");
    assert(
      task.progress_log.some((entry) =>
        String(entry.text ?? "").includes("task sendback task=T1")
      ),
      "progress log should include sendback marker",
    );
  });
});

Deno.test("orchestrator test phase sendback on JUDGMENT changes_required", () => {
  withTempDir((dir) => {
    const store = new StateStore(dir);
    store.bootstrapTasks([
      createTask({
        id: "T1",
        title: "test task",
        target_paths: ["src/a.ts"],
        current_phase_index: 2,
      }),
    ]);

    const orchestrator = new AgentTeamsLikeOrchestrator({
      store,
      adapter: new FixedResultAdapter(
        decisionPhaseResult({
          summary: "needs fixes",
          judgment: "changes_required",
        }),
      ),
      provider: new MockOrchestratorProvider(),
      config: new OrchestratorConfig({
        maxRounds: 4,
        maxIdleRounds: 1,
        maxIdleSeconds: 60,
        personas: [
          createPersona("tester", {
            enabled: true,
          }),
        ],
        personaDefaults: {
          phase_order: ["implement", "review", "test"],
          phase_policies: {
            implement: { executor_personas: ["implementer"] },
            review: { executor_personas: ["reviewer"] },
            test: {
              executor_personas: ["tester"],
              state_transition_personas: ["lead"],
            },
          },
        },
      }),
    });

    const result = orchestrator.run();
    assertEqual(result.stop_reason, "idle_rounds_limit", "stop reason");

    const task = store.getTask("T1");
    assert(task !== null, "task should exist");
    assertEqual(task.status, "pending", "task status");
    assertEqual(task.current_phase_index, 0, "phase index after sendback");
    assertEqual(task.revision_count, 1, "revision count");
    assert(
      task.progress_log.some((entry) =>
        String(entry.text ?? "").includes("task sendback task=T1")
      ),
      "progress log should include sendback marker",
    );
  });
});

Deno.test("orchestrator review phase blocks on JUDGMENT blocked", () => {
  withTempDir((dir) => {
    const store = new StateStore(dir);
    store.bootstrapTasks([
      createTask({
        id: "T1",
        title: "review task",
        target_paths: ["src/a.ts"],
        current_phase_index: 1,
      }),
    ]);

    const orchestrator = new AgentTeamsLikeOrchestrator({
      store,
      adapter: new FixedResultAdapter(
        decisionPhaseResult({
          summary: "cannot proceed",
          judgment: "blocked",
        }),
      ),
      provider: new MockOrchestratorProvider(),
      config: new OrchestratorConfig({
        maxRounds: 3,
        maxIdleRounds: 1,
        maxIdleSeconds: 60,
        personas: [
          createPersona("reviewer", {
            enabled: true,
            role: "reviewer",
          }),
        ],
        personaDefaults: {
          phase_order: ["implement", "review"],
          phase_policies: {
            implement: { executor_personas: ["implementer"] },
            review: {
              executor_personas: ["reviewer"],
              state_transition_personas: ["lead"],
            },
          },
        },
      }),
    });

    const result = orchestrator.run();
    assertEqual(result.stop_reason, "idle_rounds_limit", "stop reason");

    const task = store.getTask("T1");
    assert(task !== null, "task should exist");
    assertEqual(task.status, "blocked", "task status");
    assert(
      String(task.block_reason).includes("execution judgment is blocked"),
      "block reason should include judgment",
    );
  });
});

Deno.test("orchestrator test phase blocks on JUDGMENT blocked", () => {
  withTempDir((dir) => {
    const store = new StateStore(dir);
    store.bootstrapTasks([
      createTask({
        id: "T1",
        title: "test task",
        target_paths: ["src/a.ts"],
        current_phase_index: 2,
      }),
    ]);

    const orchestrator = new AgentTeamsLikeOrchestrator({
      store,
      adapter: new FixedResultAdapter(
        decisionPhaseResult({
          summary: "cannot verify",
          judgment: "blocked",
        }),
      ),
      provider: new MockOrchestratorProvider(),
      config: new OrchestratorConfig({
        maxRounds: 3,
        maxIdleRounds: 1,
        maxIdleSeconds: 60,
        personas: [
          createPersona("tester", {
            enabled: true,
          }),
        ],
        personaDefaults: {
          phase_order: ["implement", "review", "test"],
          phase_policies: {
            implement: { executor_personas: ["implementer"] },
            review: { executor_personas: ["reviewer"] },
            test: {
              executor_personas: ["tester"],
              state_transition_personas: ["lead"],
            },
          },
        },
      }),
    });

    const result = orchestrator.run();
    assertEqual(result.stop_reason, "idle_rounds_limit", "stop reason");

    const task = store.getTask("T1");
    assert(task !== null, "task should exist");
    assertEqual(task.status, "blocked", "task status");
    assert(
      String(task.block_reason).includes("execution judgment is blocked"),
      "block reason should include judgment",
    );
  });
});

Deno.test("orchestrator implement phase does not block CHANGED_FILES outside declared hint scope", () => {
  withTempDir((dir) => {
    const store = new StateStore(dir);
    store.bootstrapTasks([
      createTask({
        id: "T1",
        title: "implement task",
        target_paths: ["src/a.ts"],
      }),
    ]);

    const orchestrator = new AgentTeamsLikeOrchestrator({
      store,
      adapter: new FixedResultAdapter(
        completedResult("implemented", "src/out-of-scope.ts"),
      ),
      provider: new MockOrchestratorProvider(),
      config: new OrchestratorConfig({
        maxRounds: 3,
        maxIdleRounds: 1,
        maxIdleSeconds: 60,
        teammateIds: ["tm-1"],
        personas: [],
      }),
    });

    const result = orchestrator.run();
    assertEqual(result.stop_reason, "all_tasks_completed", "stop reason");
    const task = store.getTask("T1");
    assert(task !== null, "task should exist");
    assertEqual(task.status, "completed", "task status");
  });
});

Deno.test("orchestrator implement phase allows CHANGED_FILES in related_paths", () => {
  withTempDir((dir) => {
    const store = new StateStore(dir);
    store.bootstrapTasks([
      createTask({
        id: "T1",
        title: "implement task",
        target_paths: ["src/a.ts"],
        related_paths: ["docs/notes.md"],
      }),
    ]);

    const orchestrator = new AgentTeamsLikeOrchestrator({
      store,
      adapter: new FixedResultAdapter(
        completedResult(
          "implemented additional_edit_reason=docs_sync",
          "docs/notes.md",
        ),
      ),
      provider: new MockOrchestratorProvider(),
      config: new OrchestratorConfig({
        maxRounds: 3,
        maxIdleRounds: 1,
        maxIdleSeconds: 60,
        teammateIds: ["tm-1"],
        personas: [],
      }),
    });

    const result = orchestrator.run();
    assertEqual(result.stop_reason, "all_tasks_completed", "stop reason");
    const task = store.getTask("T1");
    assert(task !== null, "task should exist");
    assertEqual(task.status, "completed", "task status");
  });
});

Deno.test("orchestrator implement phase allows related_paths edit without summary reason tag", () => {
  withTempDir((dir) => {
    const store = new StateStore(dir);
    store.bootstrapTasks([
      createTask({
        id: "T1",
        title: "implement task",
        target_paths: ["src/a.ts"],
        related_paths: ["docs/notes.md"],
      }),
    ]);

    const orchestrator = new AgentTeamsLikeOrchestrator({
      store,
      adapter: new FixedResultAdapter(
        completedResult("implemented", "docs/notes.md"),
      ),
      provider: new MockOrchestratorProvider(),
      config: new OrchestratorConfig({
        maxRounds: 3,
        maxIdleRounds: 1,
        maxIdleSeconds: 60,
        teammateIds: ["tm-1"],
        personas: [],
      }),
    });

    const result = orchestrator.run();
    assertEqual(result.stop_reason, "all_tasks_completed", "stop reason");
    const task = store.getTask("T1");
    assert(task !== null, "task should exist");
    assertEqual(task.status, "completed", "task status");
  });
});

Deno.test("orchestrator implement phase accepts traversal-like CHANGED_FILES as non-binding scope hint", () => {
  withTempDir((dir) => {
    const store = new StateStore(dir);
    store.bootstrapTasks([
      createTask({
        id: "T1",
        title: "implement task",
        target_paths: ["src"],
      }),
    ]);

    const orchestrator = new AgentTeamsLikeOrchestrator({
      store,
      adapter: new FixedResultAdapter(
        completedResult("implemented", "src/../secret.txt"),
      ),
      provider: new MockOrchestratorProvider(),
      config: new OrchestratorConfig({
        maxRounds: 3,
        maxIdleRounds: 1,
        maxIdleSeconds: 60,
        teammateIds: ["tm-1"],
        personas: [],
      }),
    });

    const result = orchestrator.run();
    assertEqual(result.stop_reason, "all_tasks_completed", "stop reason");
    const task = store.getTask("T1");
    assert(task !== null, "task should exist");
    assertEqual(task.status, "completed", "task status");
  });
});

Deno.test("orchestrator implement phase accepts symlink CHANGED_FILES outside workspace when scope hints are non-binding", () => {
  if (Deno.build.os === "windows") {
    return;
  }
  withTempCwd((dir) => {
    const outsideDir = Deno.makeTempDirSync();
    try {
      Deno.mkdirSync("src", { recursive: true });
      Deno.symlinkSync(outsideDir, "src/outside-link");
      Deno.writeTextFileSync(`${outsideDir}/secret.ts`, "export const x = 1;\n");

      const store = new StateStore(`${dir}/state`);
      store.bootstrapTasks([
        createTask({
          id: "T1",
          title: "implement task",
          target_paths: ["src"],
        }),
      ]);

      const orchestrator = new AgentTeamsLikeOrchestrator({
        store,
        adapter: new FixedResultAdapter(
          completedResult("implemented", "src/outside-link/secret.ts"),
        ),
        provider: new MockOrchestratorProvider(),
        config: new OrchestratorConfig({
          maxRounds: 3,
          maxIdleRounds: 1,
          maxIdleSeconds: 60,
          teammateIds: ["tm-1"],
          personas: [],
        }),
      });

      const result = orchestrator.run();
      assertEqual(result.stop_reason, "all_tasks_completed", "stop reason");
      const task = store.getTask("T1");
      assert(task !== null, "task should exist");
      assertEqual(task.status, "completed", "task status");
    } finally {
      Deno.removeSync(outsideDir, { recursive: true });
    }
  });
});

Deno.test("orchestrator implement phase accepts symlink CHANGED_FILES with non-existing leaf when scope hints are non-binding", () => {
  if (Deno.build.os === "windows") {
    return;
  }
  withTempCwd((dir) => {
    const outsideDir = Deno.makeTempDirSync();
    try {
      Deno.mkdirSync("src", { recursive: true });
      Deno.symlinkSync(outsideDir, "src/outside-link");

      const store = new StateStore(`${dir}/state`);
      store.bootstrapTasks([
        createTask({
          id: "T1",
          title: "implement task",
          target_paths: ["src"],
        }),
      ]);

      const orchestrator = new AgentTeamsLikeOrchestrator({
        store,
        adapter: new FixedResultAdapter(
          completedResult("implemented", "src/outside-link/new.ts"),
        ),
        provider: new MockOrchestratorProvider(),
        config: new OrchestratorConfig({
          maxRounds: 3,
          maxIdleRounds: 1,
          maxIdleSeconds: 60,
          teammateIds: ["tm-1"],
          personas: [],
        }),
      });

      const result = orchestrator.run();
      assertEqual(result.stop_reason, "all_tasks_completed", "stop reason");
      const task = store.getTask("T1");
      assert(task !== null, "task should exist");
      assertEqual(task.status, "completed", "task status");
    } finally {
      Deno.removeSync(outsideDir, { recursive: true });
    }
  });
});

Deno.test("orchestrator review phase blocks when CHANGED_FILES is non-empty", () => {
  withTempDir((dir) => {
    const store = new StateStore(dir);
    store.bootstrapTasks([
      createTask({
        id: "T1",
        title: "review task",
        target_paths: ["src/a.ts"],
        current_phase_index: 1,
      }),
    ]);

    const orchestrator = new AgentTeamsLikeOrchestrator({
      store,
      adapter: new FixedResultAdapter(
        decisionPhaseResult({
          summary: "review complete",
          changedFiles: "src/a.ts",
          judgment: "pass",
        }),
      ),
      provider: new MockOrchestratorProvider(),
      config: new OrchestratorConfig({
        maxRounds: 3,
        maxIdleRounds: 1,
        maxIdleSeconds: 60,
        personas: [
          createPersona("reviewer", {
            enabled: true,
            role: "reviewer",
          }),
        ],
        personaDefaults: {
          phase_order: ["implement", "review"],
          phase_policies: {
            implement: { executor_personas: ["implementer"] },
            review: {
              executor_personas: ["reviewer"],
              state_transition_personas: ["lead"],
            },
          },
        },
      }),
    });

    orchestrator.run();
    const task = store.getTask("T1");
    assert(task !== null, "task should exist");
    assertEqual(task.status, "blocked", "task status");
    assert(
      String(task.block_reason).includes("non-implement phase edited files"),
      "block reason should include changed files violation",
    );
  });
});

Deno.test("orchestrator review phase blocks when CHANGED_FILES is non-empty even if JUDGMENT is changes_required", () => {
  withTempDir((dir) => {
    const store = new StateStore(dir);
    store.bootstrapTasks([
      createTask({
        id: "T1",
        title: "review task",
        target_paths: ["src/a.ts"],
        current_phase_index: 1,
      }),
    ]);

    const orchestrator = new AgentTeamsLikeOrchestrator({
      store,
      adapter: new FixedResultAdapter(
        decisionPhaseResult({
          summary: "needs more edits",
          changedFiles: "src/a.ts",
          judgment: "changes_required",
        }),
      ),
      provider: new MockOrchestratorProvider(),
      config: new OrchestratorConfig({
        maxRounds: 3,
        maxIdleRounds: 1,
        maxIdleSeconds: 60,
        personas: [
          createPersona("reviewer", {
            enabled: true,
            role: "reviewer",
          }),
        ],
        personaDefaults: {
          phase_order: ["implement", "review"],
          phase_policies: {
            implement: { executor_personas: ["implementer"] },
            review: {
              executor_personas: ["reviewer"],
              state_transition_personas: ["lead"],
            },
          },
        },
      }),
    });

    orchestrator.run();
    const task = store.getTask("T1");
    assert(task !== null, "task should exist");
    assertEqual(task.status, "blocked", "task status");
    assertEqual(task.revision_count, 0, "revision count should not increase");
    assert(
      String(task.block_reason).includes("non-implement phase edited files"),
      "block reason should include changed files violation",
    );
  });
});

Deno.test("orchestrator transitions to revision cycle guard when max is exceeded", () => {
  withTempDir((dir) => {
    const store = new StateStore(dir);
    store.bootstrapTasks([
      createTask({
        id: "T1",
        title: "review task",
        target_paths: ["src/a.ts"],
        current_phase_index: 1,
        revision_count: 1,
        max_revision_cycles: 1,
      }),
    ]);

    const orchestrator = new AgentTeamsLikeOrchestrator({
      store,
      adapter: new FixedResultAdapter(
        decisionPhaseResult({
          summary: "still requires work",
          judgment: "changes_required",
        }),
      ),
      provider: new MockOrchestratorProvider(),
      config: new OrchestratorConfig({
        maxRounds: 6,
        maxIdleRounds: 3,
        maxIdleSeconds: 60,
        personas: [
          createPersona("reviewer", {
            enabled: true,
            role: "reviewer",
          }),
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
    assertEqual(result.stop_reason, "revision_cycle_guard", "stop reason");

    const task = store.getTask("T1");
    assert(task !== null, "task should exist");
    assertEqual(task.status, "needs_approval", "task status");
    assertEqual(task.revision_count, 2, "revision count should be incremented");
    assert(
      task.progress_log.some((entry) =>
        String(entry.text ?? "").includes("revision cycle guard triggered")
      ),
      "progress log should include revision guard marker",
    );
  });
});

Deno.test("orchestrator does not trigger revision guard when count equals max at release", () => {
  withTempDir((dir) => {
    const store = new StateStore(dir);
    store.bootstrapTasks([
      createTask({
        id: "A",
        title: "ready task",
        target_paths: ["src/a.ts"],
        status: "needs_approval",
        revision_count: 1,
        max_revision_cycles: 1,
      }),
      createTask({
        id: "B",
        title: "normal task",
        target_paths: ["src/b.ts"],
      }),
    ]);

    const orchestrator = new AgentTeamsLikeOrchestrator({
      store,
      adapter: new TemplateAdapter(),
      provider: new MockOrchestratorProvider(),
      config: new OrchestratorConfig({
        maxRounds: 6,
        maxIdleRounds: 4,
        maxIdleSeconds: 60,
        teammateIds: ["tm-1"],
      }),
    });

    const result = orchestrator.run();
    assertEqual(result.stop_reason, "all_tasks_completed", "stop reason");

    const stalled = store.getTask("A");
    assert(stalled !== null, "task should exist");
    assertEqual(stalled.status, "completed", "task status");
    assertEqual(stalled.revision_count, 1, "revision count should remain equal");
  });
});

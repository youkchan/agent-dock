import path from "node:path";

import { createTask } from "../../../src/domain/task.ts";
import { StateStore } from "../../../src/infrastructure/state/store.ts";

function taskPolicy(): Record<string, unknown> {
  return {
    phase_order: ["implement"],
    phase_overrides: {
      implement: {
        active_personas: ["implementer"],
        executor_personas: ["implementer"],
        state_transition_personas: ["implementer"],
      },
    },
  };
}

function snapshot(stateDir: string): Record<string, unknown> {
  return JSON.parse(
    Deno.readTextFileSync(path.join(stateDir, "state.json")),
  ) as Record<string, unknown>;
}

function parseArgs(argv: string[]): { stateDir: string; output: string } {
  let stateDir = "";
  let output = "";
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--state-dir") {
      stateDir = next ?? "";
      index += 1;
      continue;
    }
    if (arg === "--output") {
      output = next ?? "";
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  if (!stateDir || !output) {
    throw new Error("usage: --state-dir DIR --output PATH");
  }

  return {
    stateDir: path.resolve(stateDir),
    output: path.resolve(output),
  };
}

const args = parseArgs(Deno.args);
const store = new StateStore(args.stateDir);
const snapshots: Record<string, unknown> = {};

store.bootstrapTasks(
  [
    createTask({
      id: "T-001",
      title: "Plan first",
      requires_plan: true,
      target_paths: ["src/a.ts"],
      persona_policy: taskPolicy(),
    }),
    createTask({
      id: "T-002",
      title: "Follow up",
      depends_on: ["T-001"],
      target_paths: ["src/b.ts"],
    }),
  ],
  true,
);
snapshots.after_bootstrap = snapshot(args.stateDir);

const claimedPlan = store.claimPlanTask("tm-1");
if (claimedPlan === null) {
  throw new Error("failed to claim plan task");
}
snapshots.after_claim = snapshot(args.stateDir);

store.submitPlan("T-001", "tm-1", "Plan: implement and validate.");
snapshots.after_plan_submitted = snapshot(args.stateDir);

store.reviewPlan("T-001", "lead", "approve", "approved");
snapshots.after_approval = snapshot(args.stateDir);

const claimedExec = store.claimExecutionTask("tm-1");
if (claimedExec === null) {
  throw new Error("failed to claim execution task");
}
store.appendTaskProgressLog("T-001", "stdout", "implemented");
snapshots.after_claim_execution = snapshot(args.stateDir);

store.completeTask("T-001", "tm-1", "done");
snapshots.after_completed = snapshot(args.stateDir);

const claimedNext = store.claimExecutionTask("tm-2");
if (claimedNext === null) {
  throw new Error("failed to claim dependent task");
}
snapshots.after_second_claim = snapshot(args.stateDir);

store.requeueInProgressTasks();
snapshots.after_resume_recovery = snapshot(args.stateDir);

Deno.mkdirSync(path.dirname(args.output), { recursive: true });
Deno.writeTextFileSync(args.output, JSON.stringify(snapshots, null, 2));


import { createTask } from "../../domain/task.ts";
import { StateStore } from "./store.ts";

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

Deno.test("StateStore enforces dependency and plan gate", () => {
  withTempDir((dir) => {
    const store = new StateStore(dir);
    store.bootstrapTasks([
      createTask({
        id: "A",
        title: "plan first",
        requires_plan: true,
        target_paths: ["src/a.ts"],
      }),
      createTask({
        id: "B",
        title: "depends",
        depends_on: ["A"],
        target_paths: ["src/b.ts"],
      }),
    ]);

    const planning = store.claimPlanTask("tm-1");
    assert(planning !== null, "plan task should be claimed");
    assertEqual(planning.id, "A", "first planning task should be A");

    const submitted = store.submitPlan("A", "tm-1", "plan text");
    assertEqual(submitted.status, "needs_approval", "submitted status");
    assertEqual(submitted.plan_status, "submitted", "submitted plan_status");

    const approved = store.reviewPlan("A", "lead", "approve", "ok");
    assertEqual(approved.plan_status, "approved", "approved plan_status");
    assertEqual(approved.status, "pending", "approved status");

    const firstExec = store.claimExecutionTask("tm-1");
    assert(firstExec !== null, "execution task should be claimed");
    assertEqual(firstExec.id, "A", "first execution should be A");

    store.completeTask("A", "tm-1", "done");

    const secondExec = store.claimExecutionTask("tm-2");
    assert(secondExec !== null, "second execution task should be claimed");
    assertEqual(secondExec.id, "B", "second execution should be B");
  });
});

Deno.test("StateStore mailbox sequence is ordered", () => {
  withTempDir((dir) => {
    const store = new StateStore(dir);
    store.sendMessage("lead", "tm-1", "hello", "A");
    store.sendMessage("lead", "tm-1", "world", "B");

    const inbox = store.getInbox("tm-1");
    assertEqual(inbox.length, 2, "inbox length");
    assert(inbox[0].seq < inbox[1].seq, "sequence should be increasing");
  });
});

Deno.test("StateStore collision is detected", () => {
  withTempDir((dir) => {
    const store = new StateStore(dir);
    store.bootstrapTasks([
      createTask({
        id: "A",
        title: "task A",
        target_paths: ["src/shared.ts"],
      }),
      createTask({
        id: "B",
        title: "task B",
        target_paths: ["src/shared.ts"],
      }),
    ]);

    const first = store.claimExecutionTask("tm-1");
    assert(first !== null, "first task should be claimed");
    assertEqual(first.id, "A", "first claim should be A");

    const second = store.claimExecutionTask("tm-2");
    assertEqual(second, null, "second claim should be blocked by collision");

    const collisions = store.detectCollisions();
    assertEqual(collisions.length, 1, "collision count");
    assertEqual(collisions[0].waiting_task_id, "B", "waiting id");
    assertEqual(collisions[0].running_task_id, "A", "running id");
  });
});

Deno.test("StateStore review plan clears owner", () => {
  withTempDir((dir) => {
    const store = new StateStore(dir);
    store.bootstrapTasks([
      createTask({
        id: "A",
        title: "plan task",
        requires_plan: true,
        target_paths: ["src/a.ts"],
      }),
    ]);

    const planning = store.claimPlanTask("tm-1");
    assert(planning !== null, "plan should be claimed");

    store.submitPlan("A", "tm-1", "plan");
    const contaminated = store.applyTaskUpdate(
      "A",
      "needs_approval",
      "tm-2",
      null,
      "",
    );
    assertEqual(
      contaminated.owner,
      "tm-2",
      "owner contamination should be set",
    );

    const approved = store.reviewPlan("A", "lead", "approve", "ok");
    assertEqual(approved.status, "pending", "status should reset to pending");
    assertEqual(approved.plan_status, "approved", "plan should be approved");
    assertEqual(approved.owner, null, "owner should be cleared");

    const executable = store.claimExecutionTask("tm-1");
    assert(executable !== null, "task should be executable");
    assertEqual(executable.id, "A", "expected A to execute");
  });
});

Deno.test("StateStore task progress log append and rotation", () => {
  withTempDir((dir) => {
    const store = new StateStore(dir);
    store.bootstrapTasks([
      createTask({
        id: "A",
        title: "task A",
        target_paths: ["src/a.ts"],
      }),
    ]);

    store.appendTaskProgressLog("A", "stdout", "line-1", 3);
    store.appendTaskProgressLog("A", "stdout", "line-2", 3);
    store.appendTaskProgressLog("A", "stderr", "line-3", 3);
    store.appendTaskProgressLog("A", "stdout", "line-4", 3);

    const task = store.getTask("A");
    assert(task !== null, "task should exist");
    assertEqual(task.progress_log.length, 3, "progress log should rotate");
    assertEqual(
      task.progress_log.map((entry) => String(entry.text ?? "")),
      ["line-2", "line-3", "line-4"],
      "progress text order",
    );
    const last = task.progress_log[task.progress_log.length - 1];
    assertEqual(last.source, "stdout", "last source");
    assert(typeof last.timestamp === "number", "timestamp should exist");
  });
});

Deno.test("StateStore requeue in-progress tasks", () => {
  withTempDir((dir) => {
    const store = new StateStore(dir);
    store.bootstrapTasks([
      createTask({
        id: "A",
        title: "task A",
        status: "in_progress",
        owner: "tm-1",
        target_paths: ["src/a.ts"],
      }),
      createTask({
        id: "B",
        title: "task B",
        status: "pending",
        target_paths: ["src/b.ts"],
      }),
    ]);

    const recovered = store.requeueInProgressTasks();
    assertEqual(recovered.map((task) => task.id), ["A"], "recovered tasks");

    const taskA = store.getTask("A");
    assert(taskA !== null, "task A should exist");
    assertEqual(taskA.status, "pending", "task A should be pending");
    assertEqual(taskA.owner, null, "task A owner should be cleared");
    assert(taskA.progress_log.length > 0, "progress log should be appended");
    const text = String(
      taskA.progress_log[taskA.progress_log.length - 1].text ?? "",
    );
    assert(text.includes("resume recovery"), "resume text should exist");
  });
});

Deno.test("StateStore claim execution task respects allowed ids", () => {
  withTempDir((dir) => {
    const store = new StateStore(dir);
    store.bootstrapTasks([
      createTask({
        id: "A",
        title: "task A",
        target_paths: ["src/a.ts"],
      }),
      createTask({
        id: "B",
        title: "task B",
        target_paths: ["src/b.ts"],
      }),
    ]);

    const claimed = store.claimExecutionTask("tm-1", new Set(["B"]));
    assert(claimed !== null, "expected claim result");
    assertEqual(claimed.id, "B", "allowed ids should restrict claim");
  });
});

Deno.test("StateStore handoff task phase requeues with next phase index", () => {
  withTempDir((dir) => {
    const store = new StateStore(dir);
    store.bootstrapTasks([
      createTask({
        id: "A",
        title: "task A",
        target_paths: ["src/a.ts"],
      }),
    ]);

    const claimed = store.claimExecutionTask("tm-1");
    assert(claimed !== null, "expected claim");

    const handed = store.handoffTaskPhase("A", "tm-1", 1);
    assertEqual(handed.status, "pending", "handoff should requeue task");
    assertEqual(handed.owner, null, "handoff should clear owner");
    assertEqual(handed.current_phase_index, 1, "next phase index");
  });
});

Deno.test("StateStore sendBackTaskToPhase increments revision count when requested", () => {
  withTempDir((dir) => {
    const store = new StateStore(dir);
    store.bootstrapTasks([
      createTask({
        id: "A",
        title: "task A",
        status: "in_progress",
        owner: "tm-1",
        target_paths: ["src/a.ts"],
        current_phase_index: 1,
      }),
    ]);

    const sentBack = store.sendBackTaskToPhase("A", "tm-1", 0, true);
    assertEqual(sentBack.status, "pending", "sendback should requeue task");
    assertEqual(sentBack.owner, null, "sendback should clear owner");
    assertEqual(sentBack.current_phase_index, 0, "sendback phase index");
    assertEqual(sentBack.revision_count, 1, "sendback revision count");
  });
});

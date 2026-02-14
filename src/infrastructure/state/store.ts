import path from "node:path";

import type { PlanAction } from "../../domain/decision.ts";
import type { MailMessage } from "../../domain/mail.ts";
import type { Task, TaskStatus } from "../../domain/task.ts";
import { taskFromRecord, taskToRecord } from "../../domain/task.ts";

export const DEFAULT_TASK_PROGRESS_LOG_LIMIT = 200;

interface StateMeta {
  sequence: number;
  progress_counter: number;
  last_progress_at: number;
}

interface StatePayload {
  version: number;
  tasks: Record<string, Record<string, unknown>>;
  messages: MailMessage[];
  meta: StateMeta;
}

interface StateStoreOptions {
  lockTimeoutMs?: number;
  lockRetryMs?: number;
  lockStaleMs?: number;
}

export class StateStore {
  readonly stateDir: string;
  readonly stateFile: string;
  readonly lockFile: string;

  private readonly lockTimeoutMs: number;
  private readonly lockRetryMs: number;
  private readonly lockStaleMs: number;

  constructor(stateDir: string, options: StateStoreOptions = {}) {
    this.stateDir = path.resolve(stateDir);
    Deno.mkdirSync(this.stateDir, { recursive: true });
    this.stateFile = path.join(this.stateDir, "state.json");
    this.lockFile = path.join(this.stateDir, "state.lock");
    this.lockTimeoutMs = options.lockTimeoutMs ?? 5000;
    this.lockRetryMs = options.lockRetryMs ?? 30;
    this.lockStaleMs = options.lockStaleMs ?? 30000;
    this.initializeStateIfMissing();
  }

  bootstrapTasks(tasks: Task[], replace: boolean = true): void {
    this.withLockedState((state) => {
      if (replace) {
        state.tasks = {};
      }
      for (const task of tasks) {
        state.tasks[task.id] = taskToRecord(task);
      }
      StateStore.touchProgress(state);
    });
  }

  addTask(task: Task): void {
    this.withLockedState((state) => {
      state.tasks[task.id] = taskToRecord(task);
      StateStore.touchProgress(state);
    });
  }

  getTask(taskId: string): Task | null {
    const state = this.readState();
    const rawTask = state.tasks[taskId];
    if (!rawTask) {
      return null;
    }
    return taskFromRecord(rawTask);
  }

  listTasks(): Task[] {
    const state = this.readState();
    const tasks = Object.values(state.tasks).map((raw) => taskFromRecord(raw));
    tasks.sort((left, right) => left.id.localeCompare(right.id));
    return tasks;
  }

  listRecentMessages(limit: number = 30): MailMessage[] {
    const state = this.readState();
    if (limit <= 0) {
      return [];
    }
    return state.messages.slice(-limit).map((message) => ({ ...message }));
  }

  claimPlanTask(teammateId: string): Task | null {
    let claimed: Task | null = null;
    this.withLockedState((state) => {
      for (const taskId of Object.keys(state.tasks).sort()) {
        const candidate = taskFromRecord(state.tasks[taskId]);
        if (candidate.status !== "pending") {
          continue;
        }
        if (!candidate.requires_plan) {
          continue;
        }
        if (
          candidate.plan_status !== "pending" &&
          candidate.plan_status !== "rejected" &&
          candidate.plan_status !== "revision_requested"
        ) {
          continue;
        }
        if (candidate.planner !== null) {
          continue;
        }
        if (!StateStore.areDependenciesCompleted(candidate, state.tasks)) {
          continue;
        }

        candidate.planner = teammateId;
        candidate.plan_status = "drafting";
        candidate.updated_at = nowSeconds();
        state.tasks[candidate.id] = taskToRecord(candidate);
        StateStore.touchProgress(state);
        claimed = candidate;
        return;
      }
    });
    return claimed;
  }

  submitPlan(taskId: string, teammateId: string, planText: string): Task {
    return this.withLockedState((state) => {
      const raw = state.tasks[taskId];
      if (!raw) {
        throw new Error(`task not found: ${taskId}`);
      }

      const task = taskFromRecord(raw);
      if (task.planner !== teammateId) {
        throw new Error("planner mismatch");
      }
      if (task.plan_status !== "drafting") {
        throw new Error("plan is not drafting");
      }

      task.plan_text = planText;
      task.status = "needs_approval";
      task.plan_status = "submitted";
      task.updated_at = nowSeconds();
      state.tasks[taskId] = taskToRecord(task);
      StateStore.touchProgress(state);
      return task;
    });
  }

  listSubmittedPlans(): Task[] {
    const submitted: Task[] = [];
    for (const task of this.listTasks()) {
      if (
        task.requires_plan && task.status === "needs_approval" &&
        task.plan_status === "submitted"
      ) {
        submitted.push(task);
      }
    }
    return submitted;
  }

  hasPendingApprovals(): boolean {
    return this.listSubmittedPlans().length > 0;
  }

  reviewPlan(
    taskId: string,
    leadId: string,
    action: PlanAction,
    feedback: string = "",
  ): Task {
    void leadId;
    if (action !== "approve" && action !== "reject" && action !== "revise") {
      throw new Error(`unknown action: ${action}`);
    }

    return this.withLockedState((state) => {
      const raw = state.tasks[taskId];
      if (!raw) {
        throw new Error(`task not found: ${taskId}`);
      }

      const task = taskFromRecord(raw);
      if (
        task.status !== "needs_approval" || task.plan_status !== "submitted"
      ) {
        throw new Error("task is not waiting approval");
      }

      task.plan_feedback = feedback;
      task.updated_at = nowSeconds();
      task.status = "pending";
      task.owner = null;

      if (action === "approve") {
        task.plan_status = "approved";
      } else if (action === "reject") {
        task.plan_status = "rejected";
        task.planner = null;
      } else {
        task.plan_status = "revision_requested";
        task.planner = null;
      }

      state.tasks[task.id] = taskToRecord(task);
      StateStore.touchProgress(state);
      return task;
    });
  }

  claimExecutionTask(
    teammateId: string,
    allowedTaskIds: ReadonlySet<string> | null = null,
  ): Task | null {
    let claimed: Task | null = null;
    this.withLockedState((state) => {
      for (const taskId of Object.keys(state.tasks).sort()) {
        const candidate = taskFromRecord(state.tasks[taskId]);
        if (allowedTaskIds !== null && !allowedTaskIds.has(candidate.id)) {
          continue;
        }
        if (!StateStore.isExecutionReady(candidate, state.tasks)) {
          continue;
        }
        if (StateStore.hasTargetCollision(candidate, state.tasks)) {
          continue;
        }

        candidate.owner = teammateId;
        candidate.status = "in_progress";
        candidate.block_reason = null;
        candidate.updated_at = nowSeconds();
        state.tasks[candidate.id] = taskToRecord(candidate);
        StateStore.touchProgress(state);
        claimed = candidate;
        return;
      }
    });
    return claimed;
  }

  handoffTaskPhase(
    taskId: string,
    teammateId: string,
    nextPhaseIndex: number,
  ): Task {
    return this.requeueInProgressTaskToPhase(
      taskId,
      teammateId,
      nextPhaseIndex,
    );
  }

  sendBackTaskToPhase(
    taskId: string,
    teammateId: string,
    phaseIndex: number,
    incrementRevisionCount: boolean = false,
  ): Task {
    return this.requeueInProgressTaskToPhase(
      taskId,
      teammateId,
      phaseIndex,
      incrementRevisionCount,
    );
  }

  detectCollisions(): Array<
    { waiting_task_id: string; running_task_id: string }
  > {
    const state = this.readState();
    const tasksRaw = state.tasks;
    const active = Object.values(tasksRaw)
      .filter((raw) => raw.status === "in_progress")
      .map((raw) => taskFromRecord(raw));

    const collisions: Array<
      { waiting_task_id: string; running_task_id: string }
    > = [];
    for (const raw of Object.values(tasksRaw)) {
      const pendingTask = taskFromRecord(raw);
      if (!StateStore.isExecutionReady(pendingTask, tasksRaw)) {
        continue;
      }
      if (pendingTask.target_paths.length === 0) {
        continue;
      }

      const pendingTargets = new Set(pendingTask.target_paths);
      for (const runningTask of active) {
        if (runningTask.target_paths.length === 0) {
          continue;
        }
        if (
          hasIntersection(pendingTargets, new Set(runningTask.target_paths))
        ) {
          collisions.push({
            waiting_task_id: pendingTask.id,
            running_task_id: runningTask.id,
          });
        }
      }
    }
    return collisions;
  }

  markTaskBlocked(taskId: string, teammateId: string, reason: string): Task {
    return this.withLockedState((state) => {
      const raw = state.tasks[taskId];
      if (!raw) {
        throw new Error(`task not found: ${taskId}`);
      }

      const task = taskFromRecord(raw);
      if (task.owner !== teammateId) {
        throw new Error("owner mismatch");
      }
      if (task.status !== "in_progress") {
        throw new Error("task not in progress");
      }

      task.status = "blocked";
      task.block_reason = reason;
      task.updated_at = nowSeconds();
      state.tasks[taskId] = taskToRecord(task);
      StateStore.touchProgress(state);
      return task;
    });
  }

  completeTask(
    taskId: string,
    teammateId: string,
    resultSummary: string,
  ): Task {
    return this.withLockedState((state) => {
      const raw = state.tasks[taskId];
      if (!raw) {
        throw new Error(`task not found: ${taskId}`);
      }

      const task = taskFromRecord(raw);
      if (task.owner !== teammateId) {
        throw new Error("owner mismatch");
      }
      if (task.status !== "in_progress") {
        throw new Error("task not in progress");
      }

      task.status = "completed";
      task.result_summary = resultSummary;
      task.block_reason = null;
      const now = nowSeconds();
      task.updated_at = now;
      task.completed_at = now;
      state.tasks[taskId] = taskToRecord(task);
      StateStore.touchProgress(state);
      return task;
    });
  }

  requeueInProgressTasks(): Task[] {
    const recovered: Task[] = [];
    this.withLockedState((state) => {
      for (const taskId of Object.keys(state.tasks).sort()) {
        const task = taskFromRecord(state.tasks[taskId]);
        if (task.status !== "in_progress") {
          continue;
        }

        const previousOwner = task.owner ?? "unknown";
        task.status = "pending";
        task.owner = null;
        task.block_reason = null;
        task.updated_at = nowSeconds();
        task.progress_log.push({
          timestamp: nowSeconds(),
          source: "system",
          text:
            `resume recovery: requeued from in_progress (owner=${previousOwner})`,
        });
        if (task.progress_log.length > DEFAULT_TASK_PROGRESS_LOG_LIMIT) {
          task.progress_log = task.progress_log.slice(
            -DEFAULT_TASK_PROGRESS_LOG_LIMIT,
          );
        }
        state.tasks[taskId] = taskToRecord(task);
        recovered.push(task);
      }

      if (recovered.length > 0) {
        StateStore.touchProgress(state);
      }
    });
    return recovered;
  }

  appendTaskProgressLog(
    taskId: string,
    source: string,
    text: string,
    maxEntries: number = DEFAULT_TASK_PROGRESS_LOG_LIMIT,
  ): Task {
    const normalizedSource = source.trim() || "unknown";
    const normalizedText = text.trim();
    if (!normalizedText) {
      throw new Error("progress log text is empty");
    }
    const limit = Math.max(1, maxEntries);

    return this.withLockedState((state) => {
      const raw = state.tasks[taskId];
      if (!raw) {
        throw new Error(`task not found: ${taskId}`);
      }

      const task = taskFromRecord(raw);
      task.progress_log.push({
        timestamp: nowSeconds(),
        source: normalizedSource,
        text: normalizedText,
      });
      if (task.progress_log.length > limit) {
        task.progress_log = task.progress_log.slice(-limit);
      }
      task.updated_at = nowSeconds();
      state.tasks[taskId] = taskToRecord(task);
      StateStore.touchProgress(state);
      return task;
    });
  }

  persistSendbackAuditTrail(
    taskId: string,
    progressSource: string,
    messageText: string,
    sender: string,
    receiver: string,
    maxProgressEntries: number = DEFAULT_TASK_PROGRESS_LOG_LIMIT,
  ): { task: Task; message: MailMessage } {
    const normalizedSource = progressSource.trim() || "unknown";
    const normalizedText = messageText.trim();
    if (!normalizedText) {
      throw new Error("sendback message text is empty");
    }
    const limit = Math.max(1, maxProgressEntries);

    return this.withLockedState((state) => {
      const raw = state.tasks[taskId];
      if (!raw) {
        throw new Error(`task not found: ${taskId}`);
      }

      const now = nowSeconds();
      const task = taskFromRecord(raw);
      task.progress_log.push({
        timestamp: now,
        source: normalizedSource,
        text: normalizedText,
      });
      if (task.progress_log.length > limit) {
        task.progress_log = task.progress_log.slice(-limit);
      }
      task.updated_at = now;
      state.tasks[taskId] = taskToRecord(task);

      state.meta.sequence += 1;
      const message: MailMessage = {
        seq: state.meta.sequence,
        sender,
        receiver,
        content: normalizedText,
        task_id: taskId,
        created_at: now,
      };
      state.messages.push(message);

      StateStore.touchProgress(state);
      return {
        task,
        message: { ...message },
      };
    });
  }

  applyTaskUpdate(
    taskId: string,
    newStatus: TaskStatus,
    owner: string | null = null,
    planAction: PlanAction | null = null,
    feedback: string = "",
  ): Task {
    if (planAction !== null) {
      return this.reviewPlan(taskId, "lead", planAction, feedback);
    }

    return this.withLockedState((state) => {
      const raw = state.tasks[taskId];
      if (!raw) {
        throw new Error(`task not found: ${taskId}`);
      }
      const task = taskFromRecord(raw);
      task.status = newStatus;
      if (owner !== null) {
        task.owner = owner;
      }
      if (newStatus === "pending") {
        task.block_reason = null;
        task.owner = null;
      }
      if (newStatus === "completed") {
        task.completed_at = nowSeconds();
      }
      task.updated_at = nowSeconds();
      state.tasks[task.id] = taskToRecord(task);
      StateStore.touchProgress(state);
      return task;
    });
  }

  sendMessage(
    sender: string,
    receiver: string,
    content: string,
    taskId: string | null = null,
  ): MailMessage {
    return this.withLockedState((state) => {
      state.meta.sequence += 1;
      const message: MailMessage = {
        seq: state.meta.sequence,
        sender,
        receiver,
        content,
        task_id: taskId,
        created_at: nowSeconds(),
      };
      state.messages.push(message);
      StateStore.touchProgress(state);
      return { ...message };
    });
  }

  getInbox(receiver: string, afterSeq: number = 0): MailMessage[] {
    const state = this.readState();
    const inbox = state.messages
      .filter((message) =>
        message.receiver === receiver && message.seq > afterSeq
      )
      .map((message) => ({ ...message }));
    inbox.sort((left, right) => left.seq - right.seq);
    return inbox;
  }

  progressMarker(): [number, number] {
    const state = this.readState();
    return [state.meta.progress_counter, state.meta.last_progress_at];
  }

  statusSummary(): Record<TaskStatus, number> {
    const summary: Record<TaskStatus, number> = {
      pending: 0,
      in_progress: 0,
      blocked: 0,
      needs_approval: 0,
      completed: 0,
    };

    for (const task of this.listTasks()) {
      summary[task.status] += 1;
    }
    return summary;
  }

  allTasksCompleted(): boolean {
    const tasks = this.listTasks();
    if (tasks.length === 0) {
      return false;
    }
    return tasks.every((task) => task.status === "completed");
  }

  private initializeStateIfMissing(): void {
    if (isFile(this.stateFile)) {
      return;
    }

    const payload: StatePayload = {
      version: 2,
      tasks: {},
      messages: [],
      meta: {
        sequence: 0,
        progress_counter: 0,
        last_progress_at: nowSeconds(),
      },
    };
    this.atomicWrite(payload);
  }

  private withLockedState<T>(mutate: (state: StatePayload) => T): T {
    const release = this.acquireLock();
    try {
      const state = this.readState();
      const result = mutate(state);
      this.atomicWrite(state);
      return result;
    } finally {
      release();
    }
  }

  private readState(): StatePayload {
    const text = Deno.readTextFileSync(this.stateFile);
    const parsed = JSON.parse(text);
    if (!isRecord(parsed)) {
      throw new Error("state payload must be an object");
    }

    return {
      version: typeof parsed.version === "number" ? parsed.version : 2,
      tasks: asTaskMap(parsed.tasks),
      messages: asMessages(parsed.messages),
      meta: {
        sequence: asInt(
          (parsed.meta as Record<string, unknown> | undefined)?.sequence,
          0,
        ),
        progress_counter: asInt(
          (parsed.meta as Record<string, unknown> | undefined)
            ?.progress_counter,
          0,
        ),
        last_progress_at: asFloat(
          (parsed.meta as Record<string, unknown> | undefined)
            ?.last_progress_at,
          nowSeconds(),
        ),
      },
    };
  }

  private atomicWrite(state: StatePayload): void {
    const tempPath = `${this.stateFile}.tmp`;
    const serialized = JSON.stringify(sortJsonValue(state), null, 2);
    Deno.writeTextFileSync(tempPath, serialized);
    Deno.renameSync(tempPath, this.stateFile);
  }

  private acquireLock(): () => void {
    const deadlineAt = Date.now() + this.lockTimeoutMs;
    while (true) {
      try {
        const handle = Deno.openSync(this.lockFile, {
          write: true,
          createNew: true,
        });
        try {
          const payload = `${Date.now()} pid=${Deno.pid}\n`;
          handle.writeSync(new TextEncoder().encode(payload));
        } finally {
          handle.close();
        }
        return () => {
          try {
            Deno.removeSync(this.lockFile);
          } catch (error) {
            if (!(error instanceof Deno.errors.NotFound)) {
              throw error;
            }
          }
        };
      } catch (error) {
        if (!(error instanceof Deno.errors.AlreadyExists)) {
          throw error;
        }

        if (this.isLockStale()) {
          try {
            Deno.removeSync(this.lockFile);
          } catch (_error) {
            // Lock holder won the race and released/updated before removal.
          }
          continue;
        }

        if (Date.now() >= deadlineAt) {
          throw new Error(
            `failed to acquire state lock: timeout (${this.lockFile})`,
          );
        }
        sleepSync(this.lockRetryMs);
      }
    }
  }

  private isLockStale(): boolean {
    try {
      const stat = Deno.statSync(this.lockFile);
      const modifiedAt = stat.mtime?.getTime();
      if (modifiedAt === undefined) {
        return false;
      }
      return Date.now() - modifiedAt >= this.lockStaleMs;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return true;
      }
      return false;
    }
  }

  private static touchProgress(state: StatePayload): void {
    state.meta.progress_counter += 1;
    state.meta.last_progress_at = nowSeconds();
  }

  private requeueInProgressTaskToPhase(
    taskId: string,
    teammateId: string,
    phaseIndex: number,
    incrementRevisionCount: boolean = false,
  ): Task {
    if (phaseIndex < 0) {
      throw new Error("next_phase_index must be non-negative");
    }

    return this.withLockedState((state) => {
      const raw = state.tasks[taskId];
      if (!raw) {
        throw new Error(`task not found: ${taskId}`);
      }
      const task = taskFromRecord(raw);
      if (task.owner !== teammateId) {
        throw new Error("owner mismatch");
      }
      if (task.status !== "in_progress") {
        throw new Error("task not in progress");
      }

      task.status = "pending";
      task.owner = null;
      task.block_reason = null;
      task.current_phase_index = phaseIndex;
      if (incrementRevisionCount) {
        task.revision_count += 1;
      }
      task.updated_at = nowSeconds();

      state.tasks[taskId] = taskToRecord(task);
      StateStore.touchProgress(state);
      return task;
    });
  }

  private static areDependenciesCompleted(
    task: Task,
    tasks: Record<string, Record<string, unknown>>,
  ): boolean {
    for (const dependencyId of task.depends_on) {
      const dependency = tasks[dependencyId];
      if (!dependency) {
        return false;
      }
      if (dependency.status !== "completed") {
        return false;
      }
    }
    return true;
  }

  private static hasTargetCollision(
    task: Task,
    tasks: Record<string, Record<string, unknown>>,
  ): boolean {
    if (task.target_paths.length === 0) {
      return false;
    }

    const taskTargets = new Set(task.target_paths);
    for (const otherRaw of Object.values(tasks)) {
      const other = taskFromRecord(otherRaw);
      if (other.id === task.id) {
        continue;
      }
      if (other.status !== "in_progress") {
        continue;
      }
      if (other.target_paths.length === 0) {
        continue;
      }
      if (hasIntersection(taskTargets, new Set(other.target_paths))) {
        return true;
      }
    }
    return false;
  }

  private static isExecutionReady(
    task: Task,
    tasks: Record<string, Record<string, unknown>>,
  ): boolean {
    if (task.status !== "pending") {
      return false;
    }
    if (task.owner !== null) {
      return false;
    }
    if (!StateStore.areDependenciesCompleted(task, tasks)) {
      return false;
    }
    if (task.requires_plan && task.plan_status !== "approved") {
      return false;
    }
    return true;
  }
}

function asTaskMap(raw: unknown): Record<string, Record<string, unknown>> {
  if (!isRecord(raw)) {
    return {};
  }

  const tasks: Record<string, Record<string, unknown>> = {};
  for (const [taskId, taskRaw] of Object.entries(raw)) {
    if (!isRecord(taskRaw)) {
      continue;
    }
    tasks[taskId] = { ...taskRaw };
  }
  return tasks;
}

function asMessages(raw: unknown): MailMessage[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const messages: MailMessage[] = [];
  for (const item of raw) {
    if (!isRecord(item)) {
      continue;
    }
    messages.push({
      seq: asInt(item.seq, 0),
      sender: String(item.sender ?? ""),
      receiver: String(item.receiver ?? ""),
      content: String(item.content ?? ""),
      task_id: typeof item.task_id === "string" ? item.task_id : null,
      created_at: asFloat(item.created_at, nowSeconds()),
    });
  }
  return messages;
}

function nowSeconds(): number {
  return Date.now() / 1000;
}

function sleepSync(ms: number): void {
  const buffer = new SharedArrayBuffer(4);
  const array = new Int32Array(buffer);
  Atomics.wait(array, 0, 0, Math.max(0, ms));
}

function hasIntersection(left: Set<string>, right: Set<string>): boolean {
  for (const value of left) {
    if (right.has(value)) {
      return true;
    }
  }
  return false;
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortJsonValue(item));
  }
  if (isRecord(value)) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortJsonValue(value[key]);
    }
    return sorted;
  }
  return value;
}

function asInt(raw: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(raw ?? fallback), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asFloat(raw: unknown, fallback: number): number {
  const parsed = Number.parseFloat(String(raw ?? fallback));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw);
}

function isFile(target: string): boolean {
  try {
    return Deno.statSync(target).isFile;
  } catch (_error) {
    return false;
  }
}

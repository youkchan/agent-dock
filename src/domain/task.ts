import type { TaskPersonaPolicy } from "./persona_policy.ts";

export type TaskStatus =
  | "pending"
  | "in_progress"
  | "blocked"
  | "needs_approval"
  | "completed";

export type TaskPlanStatus =
  | "not_required"
  | "pending"
  | "drafting"
  | "submitted"
  | "approved"
  | "rejected"
  | "revision_requested";

export interface Task {
  id: string;
  title: string;
  description: string;
  target_paths: string[];
  depends_on: string[];
  owner: string | null;
  planner: string | null;
  status: TaskStatus;
  requires_plan: boolean;
  plan_status: TaskPlanStatus;
  plan_text: string | null;
  plan_feedback: string | null;
  result_summary: string | null;
  block_reason: string | null;
  progress_log: Array<Record<string, unknown>>;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
  persona_policy: TaskPersonaPolicy | null;
  current_phase_index: number | null;
}

export interface TaskInit {
  id: string;
  title: string;
  description?: string;
  target_paths?: string[];
  depends_on?: string[];
  owner?: string | null;
  planner?: string | null;
  status?: TaskStatus;
  requires_plan?: boolean;
  plan_status?: TaskPlanStatus | null;
  plan_text?: string | null;
  plan_feedback?: string | null;
  result_summary?: string | null;
  block_reason?: string | null;
  progress_log?: Array<Record<string, unknown>>;
  created_at?: number;
  updated_at?: number;
  completed_at?: number | null;
  persona_policy?: TaskPersonaPolicy | null;
  current_phase_index?: number | null;
}

export function createTask(input: TaskInit): Task {
  const now = Date.now() / 1000;
  const requiresPlan = input.requires_plan ?? false;
  const resolvedPlanStatus = resolvePlanStatus(
    input.plan_status ?? null,
    requiresPlan,
  );

  return {
    id: input.id,
    title: input.title,
    description: input.description ?? "",
    target_paths: [...(input.target_paths ?? [])],
    depends_on: [...(input.depends_on ?? [])],
    owner: input.owner ?? null,
    planner: input.planner ?? null,
    status: input.status ?? "pending",
    requires_plan: requiresPlan,
    plan_status: resolvedPlanStatus,
    plan_text: input.plan_text ?? null,
    plan_feedback: input.plan_feedback ?? null,
    result_summary: input.result_summary ?? null,
    block_reason: input.block_reason ?? null,
    progress_log: cloneRecordList(input.progress_log ?? []),
    created_at: input.created_at ?? now,
    updated_at: input.updated_at ?? now,
    completed_at: input.completed_at ?? null,
    persona_policy: clonePersonaPolicy(input.persona_policy ?? null),
    current_phase_index: input.current_phase_index ?? null,
  };
}

export function taskToRecord(task: Task): Record<string, unknown> {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    target_paths: [...task.target_paths],
    depends_on: [...task.depends_on],
    owner: task.owner,
    planner: task.planner,
    status: task.status,
    requires_plan: task.requires_plan,
    plan_status: task.plan_status,
    plan_text: task.plan_text,
    plan_feedback: task.plan_feedback,
    result_summary: task.result_summary,
    block_reason: task.block_reason,
    progress_log: cloneRecordList(task.progress_log),
    created_at: task.created_at,
    updated_at: task.updated_at,
    completed_at: task.completed_at,
    persona_policy: clonePersonaPolicy(task.persona_policy),
    current_phase_index: task.current_phase_index,
  };
}

export function taskFromRecord(raw: Record<string, unknown>): Task {
  const now = Date.now() / 1000;
  const currentPhaseIndex = raw.current_phase_index;

  return createTask({
    id: String(raw.id),
    title: String(raw.title),
    description: asOptionalString(raw.description) ?? "",
    target_paths: asStringArray(raw.target_paths),
    depends_on: asStringArray(raw.depends_on),
    owner: asOptionalString(raw.owner),
    planner: asOptionalString(raw.planner),
    status: asTaskStatus(raw.status),
    requires_plan: typeof raw.requires_plan === "boolean"
      ? raw.requires_plan
      : false,
    plan_status: asTaskPlanStatus(raw.plan_status),
    plan_text: asOptionalString(raw.plan_text),
    plan_feedback: asOptionalString(raw.plan_feedback),
    result_summary: asOptionalString(raw.result_summary),
    block_reason: asOptionalString(raw.block_reason),
    progress_log: asRecordArray(raw.progress_log),
    created_at: typeof raw.created_at === "number" ? raw.created_at : now,
    updated_at: typeof raw.updated_at === "number" ? raw.updated_at : now,
    completed_at: typeof raw.completed_at === "number"
      ? raw.completed_at
      : null,
    persona_policy: isRecord(raw.persona_policy)
      ? clonePersonaPolicy(raw.persona_policy as TaskPersonaPolicy)
      : null,
    current_phase_index: typeof currentPhaseIndex === "number"
      ? Math.trunc(currentPhaseIndex)
      : null,
  });
}

function resolvePlanStatus(
  planStatus: TaskPlanStatus | null,
  requiresPlan: boolean,
): TaskPlanStatus {
  if (planStatus !== null) {
    return planStatus;
  }
  return requiresPlan ? "pending" : "not_required";
}

function asTaskStatus(raw: unknown): TaskStatus {
  if (typeof raw === "string") {
    return raw as TaskStatus;
  }
  return "pending";
}

function asTaskPlanStatus(raw: unknown): TaskPlanStatus | null {
  if (typeof raw === "string") {
    return raw as TaskPlanStatus;
  }
  return null;
}

function asStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.map((item) => String(item));
}

function asRecordArray(raw: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter(isRecord).map((item) => ({ ...item }));
}

function asOptionalString(raw: unknown): string | null {
  return typeof raw === "string" ? raw : null;
}

function cloneRecordList(
  raw: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return raw.map((item) => ({ ...item }));
}

function clonePersonaPolicy(
  policy: TaskPersonaPolicy | null,
): TaskPersonaPolicy | null {
  if (policy === null) {
    return null;
  }
  return structuredClone(policy);
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw);
}

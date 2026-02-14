import type { TaskStatus } from "./task.ts";

export const DEFAULT_INPUT_TOKEN_BUDGET = 4000;
export const DEFAULT_OUTPUT_TOKEN_BUDGET = 800;

export const PHASE_JUDGMENT_VALUES = [
  "pass",
  "changes_required",
  "blocked",
] as const;
export type PhaseJudgment = (typeof PHASE_JUDGMENT_VALUES)[number];

const PHASE_JUDGMENT_ALIASES: Record<string, PhaseJudgment> = {
  pass: "pass",
  changes_required: "changes_required",
  changesrequired: "changes_required",
  blocked: "blocked",
};

const CHANGED_FILES_EMPTY_ALIASES = new Set<string>([
  "",
  "(none)",
  "none",
  "-",
]);

export type PlanAction = "approve" | "reject" | "revise";

export interface DecisionItem {
  type: string;
  task_id: string | null;
  teammate: string | null;
  reason_short: string;
}

export interface TaskUpdateDecision {
  task_id: string;
  new_status: TaskStatus;
  owner: string | null;
  plan_action: PlanAction | null;
  feedback: string;
}

export interface MessageDecision {
  to: string;
  text_short: string;
}

export interface StopDecision {
  should_stop: boolean;
  reason_short: string;
}

export interface DecisionMeta {
  provider: string;
  model: string;
  token_budget: {
    input: number;
    output: number;
  };
  elapsed_ms: number;
}

export interface OrchestratorDecision {
  decisions: DecisionItem[];
  task_updates: TaskUpdateDecision[];
  messages: MessageDecision[];
  stop: StopDecision;
  meta: DecisionMeta;
}

export class DecisionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecisionValidationError";
  }
}

export function normalizePhaseJudgment(raw: unknown): PhaseJudgment | null {
  if (typeof raw !== "string") {
    return null;
  }
  const normalized = raw.trim().toLowerCase().replaceAll("-", "_");
  return PHASE_JUDGMENT_ALIASES[normalized] ?? null;
}

export function normalizeChangedFiles(raw: unknown): string[] {
  if (raw === null || raw === undefined) {
    return [];
  }

  if (Array.isArray(raw)) {
    const normalized: string[] = [];
    for (const item of raw) {
      normalized.push(...normalizeChangedFiles(item));
    }
    return normalized;
  }

  const text = String(raw).trim();
  if (isChangedFilesEmptyAlias(text)) {
    return [];
  }

  const normalized = text.split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .filter((item) => !isChangedFilesEmptyAlias(item));
  return normalized;
}

export function normalizeChangedFilesText(raw: unknown): string {
  const files = normalizeChangedFiles(raw);
  if (files.length === 0) {
    return "(none)";
  }
  return files.join(", ");
}

export function validateDecisionJson(payload: unknown): OrchestratorDecision {
  if (!isRecord(payload)) {
    throw new DecisionValidationError("decision payload must be an object");
  }

  const requiredKeys = [
    "decisions",
    "task_updates",
    "messages",
    "stop",
    "meta",
  ];
  const missing = requiredKeys.filter((key) => !(key in payload));
  if (missing.length > 0) {
    throw new DecisionValidationError(
      `missing keys: ${JSON.stringify(missing.sort())}`,
    );
  }

  const decisionsRaw = payload.decisions;
  const updatesRaw = payload.task_updates;
  const messagesRaw = payload.messages;
  const stopRaw = payload.stop;
  const metaRaw = payload.meta;

  if (!Array.isArray(decisionsRaw)) {
    throw new DecisionValidationError("decisions must be a list");
  }
  if (!Array.isArray(updatesRaw)) {
    throw new DecisionValidationError("task_updates must be a list");
  }
  if (!Array.isArray(messagesRaw)) {
    throw new DecisionValidationError("messages must be a list");
  }
  if (!isRecord(stopRaw) || !("should_stop" in stopRaw)) {
    throw new DecisionValidationError("stop.should_stop is required");
  }
  if (!isRecord(metaRaw)) {
    throw new DecisionValidationError("meta must be an object");
  }

  const normalizedUpdates = updatesRaw.map(normalizeTaskUpdate);
  const normalizedMessages = messagesRaw.map(normalizeMessage);
  const normalizedDecisions = decisionsRaw.map(normalizeDecisionItem);
  const normalizedStop: StopDecision = {
    should_stop: Boolean(stopRaw.should_stop),
    reason_short: String(stopRaw.reason_short ?? "").slice(0, 200),
  };
  const normalizedMeta: DecisionMeta = {
    provider: String(metaRaw.provider ?? "unknown").slice(0, 40),
    model: String(metaRaw.model ?? "unknown").slice(0, 80),
    token_budget: {
      input: safeInt(metaRaw.token_budget, "input", DEFAULT_INPUT_TOKEN_BUDGET),
      output: safeInt(
        metaRaw.token_budget,
        "output",
        DEFAULT_OUTPUT_TOKEN_BUDGET,
      ),
    },
    elapsed_ms: Number.parseInt(String(metaRaw.elapsed_ms ?? 0), 10) || 0,
  };

  return {
    decisions: normalizedDecisions,
    task_updates: normalizedUpdates,
    messages: normalizedMessages,
    stop: normalizedStop,
    meta: normalizedMeta,
  };
}

function normalizeTaskUpdate(raw: unknown): TaskUpdateDecision {
  if (!isRecord(raw)) {
    throw new DecisionValidationError("task_updates[] must be objects");
  }

  const taskId = raw.task_id;
  const newStatus = raw.new_status;
  if (typeof taskId !== "string" || taskId.length === 0) {
    throw new DecisionValidationError("task_updates[].task_id is required");
  }
  if (typeof newStatus !== "string") {
    throw new DecisionValidationError("task_updates[].new_status is required");
  }
  if (!isTaskStatus(newStatus)) {
    throw new DecisionValidationError(`invalid new_status: ${newStatus}`);
  }

  const planActionRaw = raw.plan_action;
  if (
    planActionRaw !== null &&
    planActionRaw !== undefined &&
    planActionRaw !== "approve" &&
    planActionRaw !== "reject" &&
    planActionRaw !== "revise"
  ) {
    throw new DecisionValidationError(
      `invalid plan_action: ${String(planActionRaw)}`,
    );
  }

  return {
    task_id: taskId,
    new_status: newStatus,
    owner: typeof raw.owner === "string" && raw.owner.length > 0
      ? raw.owner
      : null,
    plan_action: planActionRaw === undefined
      ? null
      : (planActionRaw as PlanAction | null),
    feedback: String(raw.feedback ?? "").slice(0, 200),
  };
}

function normalizeMessage(raw: unknown): MessageDecision {
  if (!isRecord(raw)) {
    throw new DecisionValidationError("messages[] must be objects");
  }
  const receiver = raw.to;
  const text = raw.text_short;
  if (typeof receiver !== "string" || receiver.length === 0) {
    throw new DecisionValidationError("messages[].to is required");
  }
  if (typeof text !== "string" || text.length === 0) {
    throw new DecisionValidationError("messages[].text_short is required");
  }
  return {
    to: receiver,
    text_short: text.slice(0, 300),
  };
}

function normalizeDecisionItem(raw: unknown): DecisionItem {
  if (!isRecord(raw)) {
    throw new DecisionValidationError("decisions[] must be objects");
  }
  return {
    type: String(raw.type ?? "").slice(0, 80),
    task_id: typeof raw.task_id === "string" ? raw.task_id : null,
    teammate: typeof raw.teammate === "string" ? raw.teammate : null,
    reason_short: String(raw.reason_short ?? "").slice(0, 200),
  };
}

function safeInt(
  tokenBudgetRaw: unknown,
  key: "input" | "output",
  fallback: number,
): number {
  if (!isRecord(tokenBudgetRaw)) {
    return fallback;
  }
  const raw = tokenBudgetRaw[key];
  const parsed = Number.parseInt(String(raw ?? fallback), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isTaskStatus(raw: string): raw is TaskStatus {
  return raw === "pending" || raw === "in_progress" || raw === "blocked" ||
    raw === "needs_approval" || raw === "completed";
}

function isChangedFilesEmptyAlias(raw: string): boolean {
  return CHANGED_FILES_EMPTY_ALIASES.has(raw.trim().toLowerCase());
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw);
}

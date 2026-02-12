import type {
  OrchestratorDecision,
  TaskUpdateDecision,
} from "../../domain/decision.ts";
import { validateDecisionJson } from "../../domain/decision.ts";
import type {
  PersonaDefinition,
  PersonaExecutionConfig,
} from "../../domain/persona.ts";
import type { Task } from "../../domain/task.ts";
import { defaultPersonas } from "../../infrastructure/persona/catalog.ts";
import {
  DEFAULT_TASK_PROGRESS_LOG_LIMIT,
  StateStore,
} from "../../infrastructure/state/store.ts";
import {
  type PersonaComment,
  PersonaEvaluationPipeline,
} from "./persona_pipeline.ts";

export interface ProgressCallback {
  (source: string, text: string): void;
}

export interface TeammateAdapter {
  buildPlan(teammateId: string, task: Task): string;
  executeTask(
    teammateId: string,
    task: Task,
    progressCallback?: ProgressCallback,
  ): string;
}

export interface OrchestratorProvider {
  providerName?: string;
  provider_name?: string;
  run(snapshotJson: Record<string, unknown>): unknown;
}

export interface OrchestratorConfigInit {
  leadId?: string;
  teammateIds?: string[] | null;
  personas?: PersonaDefinition[] | null;
  maxRounds?: number;
  maxIdleRounds?: number;
  maxIdleSeconds?: number;
  noProgressEventInterval?: number;
  taskProgressLogLimit?: number;
  tickSeconds?: number;
  humanApproval?: boolean | null;
  autoApproveFallback?: boolean | null;
  personaDefaults?: Record<string, unknown> | null;
}

interface EventPayload extends Record<string, string> {
  type: string;
}

interface ApplyDecisionResult {
  applied_updates: number;
  applied_plan_actions: number;
}

interface PhaseControls {
  phaseOrder: string[];
  phasePolicies: Record<string, Record<string, string[]>>;
}

interface PersonaActionResult {
  stopReason: string | null;
  nextRoundEvents: EventPayload[];
}

interface NormalizedTaskPersonaPolicy {
  disable_personas?: string[];
  phase_order?: string[];
  phase_overrides?: Record<string, Record<string, string[]>>;
}

const REVIEWER_STOP_RULE_ALIASES: Record<string, string> = {
  requirement_drift: "requirement_drift",
  requirementdrift: "requirement_drift",
  out_of_scope: "requirement_drift",
  outofscope: "requirement_drift",
  over_editing: "over_editing",
  overediting: "over_editing",
  verbosity: "verbosity",
  excessive_verbosity: "verbosity",
  redundancy: "verbosity",
  redundant: "verbosity",
};

const REVIEWER_STOP_TOKEN_PATTERN =
  /\b(?:reviewer_stop|review_stop|spec_reviewer_stop)\s*:\s*([a-z_-]+)\b/iu;

const REVIEWER_STOP_HINT_PATTERNS: RegExp[] = [
  /\bblocker\b/iu,
  /\bstop\b/iu,
  /\bhalt\b/iu,
  /\bdetected\b/iu,
  /\bviolation\b/iu,
  /停止/u,
  /中断/u,
  /検出/u,
  /違反/u,
  /ブロッカー/u,
];

const REVIEWER_STOP_RULE_PATTERNS: Record<string, RegExp[]> = {
  requirement_drift: [
    /要件外追加/u,
    /要件逸脱/u,
    /\brequirement drift\b/iu,
    /\bout[-\s]?of[-\s]?scope\b/iu,
    /\bscope creep\b/iu,
  ],
  over_editing: [
    /過剰修正/u,
    /\bover[-\s]?editing\b/iu,
    /\bover[-\s]?edited\b/iu,
    /\btoo many edits\b/iu,
  ],
  verbosity: [
    /冗長化/u,
    /\bexcessive verbosity\b/iu,
    /\bredundan(?:t|cy)\b/iu,
    /\btoo verbose\b/iu,
  ],
};

export class OrchestratorConfig {
  leadId: string;
  teammateIds: string[] | null;
  personas: PersonaDefinition[] | null;
  maxRounds: number;
  maxIdleRounds: number;
  maxIdleSeconds: number;
  noProgressEventInterval: number;
  taskProgressLogLimit: number;
  tickSeconds: number;
  humanApproval: boolean | null;
  autoApproveFallback: boolean | null;
  personaDefaults: Record<string, unknown> | null;

  constructor(init: OrchestratorConfigInit = {}) {
    this.leadId = init.leadId ?? "lead";
    this.teammateIds = init.teammateIds ?? null;
    this.personas = init.personas ?? null;
    this.maxRounds = init.maxRounds ?? 200;
    this.maxIdleRounds = init.maxIdleRounds ?? 20;
    this.maxIdleSeconds = init.maxIdleSeconds ?? 120;
    this.noProgressEventInterval = init.noProgressEventInterval ?? 3;
    this.taskProgressLogLimit = init.taskProgressLogLimit ??
      DEFAULT_TASK_PROGRESS_LOG_LIMIT;
    this.tickSeconds = init.tickSeconds ?? 0.0;
    this.humanApproval = init.humanApproval ?? null;
    this.autoApproveFallback = init.autoApproveFallback ?? null;
    this.personaDefaults = init.personaDefaults ?? null;
  }

  resolvedTeammates(): string[] {
    return this.teammateIds && this.teammateIds.length > 0
      ? [...this.teammateIds]
      : ["teammate-1", "teammate-2"];
  }

  resolvedExecutionPersonas(): string[] {
    if (!this.personas) {
      return [];
    }
    const ids: string[] = [];
    for (const persona of this.personas) {
      if (!persona.enabled) {
        continue;
      }
      if (!isExecutionEnabled(persona.execution)) {
        continue;
      }
      ids.push(persona.id);
    }
    return ids;
  }

  resolvedHumanApproval(): boolean {
    if (this.humanApproval !== null) {
      return this.humanApproval;
    }
    return getEnv("HUMAN_APPROVAL", "0") === "1";
  }

  resolvedAutoApproveFallback(): boolean {
    if (this.autoApproveFallback !== null) {
      return this.autoApproveFallback;
    }
    return getEnv("ORCHESTRATOR_AUTO_APPROVE_FALLBACK", "1") === "1";
  }
}

export class MockOrchestratorProvider implements OrchestratorProvider {
  readonly providerName = "mock";
  readonly model: string;
  readonly inputTokenBudget: number;
  readonly outputTokenBudget: number;

  constructor(options: {
    model?: string;
    inputTokenBudget?: number;
    outputTokenBudget?: number;
  } = {}) {
    this.model = options.model ?? "mock-v1";
    this.inputTokenBudget = options.inputTokenBudget ?? 4000;
    this.outputTokenBudget = options.outputTokenBudget ?? 800;
  }

  run(snapshotJson: Record<string, unknown>): OrchestratorDecision {
    const startedAt = nowSeconds();
    const result: OrchestratorDecision = {
      decisions: [],
      task_updates: [],
      messages: [],
      stop: {
        should_stop: false,
        reason_short: "",
      },
      meta: {
        provider: this.providerName,
        model: this.model,
        token_budget: {
          input: this.inputTokenBudget,
          output: this.outputTokenBudget,
        },
        elapsed_ms: 0,
      },
    };

    const tasks = Array.isArray(snapshotJson.tasks)
      ? (snapshotJson.tasks as Array<Record<string, unknown>>)
      : [];

    for (const task of tasks) {
      if (
        task.status !== "needs_approval" || task.plan_status !== "submitted"
      ) {
        continue;
      }
      const taskId = typeof task.id === "string" ? task.id : "";
      if (!taskId) {
        continue;
      }
      result.decisions.push({
        type: "approve_plan",
        task_id: taskId,
        teammate: null,
        reason_short: "auto approved",
      });
      result.task_updates.push({
        task_id: taskId,
        new_status: "pending",
        owner: null,
        plan_action: "approve",
        feedback: "approved by mock provider",
      });
      const planner = typeof task.planner === "string" ? task.planner : "";
      if (planner) {
        result.messages.push({
          to: planner,
          text_short: `Plan approved for ${taskId}`,
        });
      }
    }

    result.meta.elapsed_ms = Math.trunc((nowSeconds() - startedAt) * 1000);
    return validateDecisionJson(result);
  }
}

export class AgentTeamsLikeOrchestrator {
  readonly store: StateStore;
  readonly adapter: TeammateAdapter;
  readonly provider: OrchestratorProvider;
  readonly config: OrchestratorConfig;
  readonly personas: PersonaDefinition[];
  readonly personaById: Map<string, PersonaDefinition>;
  readonly personaPipeline: PersonaEvaluationPipeline;
  readonly eventLogger: (message: string) => void;

  providerCalls: number;
  decisionHistory: Array<Record<string, unknown>>;
  personaCommentHistory: Array<Record<string, unknown>>;
  personaSeverityCounts: Record<string, number>;
  personaBlockerTriggered: boolean;

  private readonly collisionCache: Set<string>;
  readonly executionSubjectMode: "persona" | "teammate";
  readonly executionSubjectIds: string[];
  readonly phaseOrder: string[];
  readonly phasePolicies: Record<string, Record<string, string[]>>;

  constructor(options: {
    store: StateStore;
    adapter: TeammateAdapter;
    provider: OrchestratorProvider;
    config?: OrchestratorConfig;
    personaPipeline?: PersonaEvaluationPipeline;
    eventLogger?: (message: string) => void;
  }) {
    this.store = options.store;
    this.adapter = options.adapter;
    this.provider = options.provider;
    this.config = options.config ?? new OrchestratorConfig();
    this.personas = this.config.personas
      ? [...this.config.personas]
      : defaultPersonas();
    this.personaById = new Map(
      this.personas.map((persona) => [persona.id, persona]),
    );
    this.personaPipeline = options.personaPipeline ??
      new PersonaEvaluationPipeline(this.personas);
    this.eventLogger = options.eventLogger ?? (() => undefined);

    this.providerCalls = 0;
    this.decisionHistory = [];
    this.personaCommentHistory = [];
    this.personaSeverityCounts = {
      info: 0,
      warn: 0,
      critical: 0,
      blocker: 0,
    };
    this.personaBlockerTriggered = false;
    this.collisionCache = new Set<string>();

    const [mode, ids] = this.resolveExecutionSubjects();
    this.executionSubjectMode = mode;
    this.executionSubjectIds = ids;

    const controls = this.resolvePhaseControls();
    this.phaseOrder = controls.phaseOrder;
    this.phasePolicies = controls.phasePolicies;
  }

  run(): Record<string, unknown> {
    const startAt = nowSeconds();
    let idleRounds = 0;
    let stopReason = "max_rounds";
    const executionSubjects = [...this.executionSubjectIds];
    const humanApproval = this.config.resolvedHumanApproval();
    const autoApproveFallback = this.config.resolvedAutoApproveFallback();

    if (executionSubjects.length === 0) {
      throw new Error("at least one execution subject is required");
    }

    let pendingEvents: EventPayload[] = [
      this.makeEvent("Kickoff", undefined, undefined, "start"),
    ];

    for (
      let roundIndex = 1;
      roundIndex <= this.config.maxRounds;
      roundIndex += 1
    ) {
      const markerBefore = this.store.progressMarker();
      const roundEvents = pendingEvents;
      pendingEvents = [];
      let progressFromTeammates = false;

      for (const teammateId of executionSubjects) {
        const planResult = this.teammateProcessPlan(teammateId);
        if (planResult.changed) {
          progressFromTeammates = true;
          roundEvents.push(...planResult.events);
          continue;
        }

        const execResult = this.teammateProcessExecution(teammateId);
        if (execResult.changed) {
          progressFromTeammates = true;
          roundEvents.push(...execResult.events);
        }
      }

      roundEvents.push(...this.collectCollisionEvents());

      if (this.store.allTasksCompleted()) {
        stopReason = "all_tasks_completed";
        break;
      }

      const markerAfter = this.store.progressMarker();
      const progressed = progressFromTeammates ||
        markerAfter[0] > markerBefore[0];
      if (progressed) {
        idleRounds = 0;
      } else {
        idleRounds += 1;
        const interval = Math.max(1, this.config.noProgressEventInterval);
        if (idleRounds % interval === 0) {
          roundEvents.push(
            this.makeEvent(
              "NoProgress",
              undefined,
              undefined,
              `idle_rounds=${idleRounds}`,
            ),
          );
        }
      }

      if (humanApproval && this.store.hasPendingApprovals()) {
        stopReason = "human_approval_required";
        this.log("[lead] waiting for human approval");
        break;
      }

      if (roundEvents.length > 0) {
        const personaComments = this.evaluatePersonaComments(
          roundIndex,
          roundEvents,
        );
        const personaAction = this.applyPersonaActions(personaComments);
        if (personaAction.nextRoundEvents.length > 0) {
          pendingEvents.push(...personaAction.nextRoundEvents);
        }
        if (personaAction.stopReason) {
          stopReason = personaAction.stopReason;
          break;
        }

        try {
          const decision = this.invokeProvider(
            roundEvents,
            personaComments,
            roundIndex,
            idleRounds,
          );
          const applyResult = this.applyDecision(decision);

          if (
            autoApproveFallback &&
            applyResult.applied_plan_actions === 0 &&
            this.store.hasPendingApprovals()
          ) {
            const submitted = this.store.listSubmittedPlans();
            if (submitted.length > 0) {
              const fallbackTask = submitted[0];
              const updated = this.store.reviewPlan(
                fallbackTask.id,
                this.config.leadId,
                "approve",
                "fallback auto-approval",
              );
              const receiver = updated.planner ?? "unknown";
              this.store.sendMessage(
                this.config.leadId,
                receiver,
                `plan approved by fallback for ${updated.id}`,
                updated.id,
              );
              this.log(
                `[lead] fallback approved task=${updated.id} ` +
                  `status=${updated.status} plan_status=${updated.plan_status}`,
              );
            }
          }

          if (autoApproveFallback && !humanApproval) {
            const released = this.autoReleaseNonplanApprovals();
            if (released.length > 0) {
              this.log(
                `[lead] fallback released nonplan approvals tasks=${
                  released.join(",")
                }`,
              );
            }
          }

          if (decision.stop.should_stop) {
            const detail = decision.stop.reason_short ||
              "provider requested stop";
            stopReason = `provider_stop:${detail}`;
            this.log(`[lead] provider stop reason=${detail}`);
            break;
          }
        } catch (error) {
          stopReason = "provider_error";
          this.log(`[lead] provider error: ${this.short(String(error), 220)}`);
          break;
        }
      }

      if (this.store.allTasksCompleted()) {
        stopReason = "all_tasks_completed";
        break;
      }

      const elapsedIdleSeconds = Math.trunc(
        nowSeconds() - this.store.progressMarker()[1],
      );
      if (idleRounds >= this.config.maxIdleRounds) {
        stopReason = "idle_rounds_limit";
        break;
      }
      if (elapsedIdleSeconds >= this.config.maxIdleSeconds) {
        stopReason = "idle_seconds_limit";
        break;
      }

      if (this.config.tickSeconds > 0) {
        sleepSync(this.config.tickSeconds * 1000);
      }

      this.log(
        `[orchestrator] round=${roundIndex} idle_rounds=${idleRounds} ` +
          `summary=${JSON.stringify(this.store.statusSummary())} ` +
          `provider_calls=${this.providerCalls}`,
      );
    }

    const providerName = this.provider.providerName ??
      this.provider.provider_name ?? "unknown";
    const pendingWarnRechecks =
      pendingEvents.filter((event) => event.type === "WarnRecheck").length;

    return {
      stop_reason: stopReason,
      elapsed_seconds: Math.round((nowSeconds() - startAt) * 1000) / 1000,
      summary: this.store.statusSummary(),
      tasks_total: this.store.listTasks().length,
      provider_calls: this.providerCalls,
      provider: providerName,
      human_approval: humanApproval,
      persona_metrics: {
        severity_counts: { ...this.personaSeverityCounts },
        persona_blocker_triggered: this.personaBlockerTriggered,
        warn_recheck_queue_remaining: pendingWarnRechecks,
      },
    };
  }

  private resolveExecutionSubjects(): ["persona" | "teammate", string[]] {
    const personaIds = this.config.resolvedExecutionPersonas();
    if (personaIds.length > 0) {
      return ["persona", personaIds];
    }
    const teammateIds = this.config.resolvedTeammates();
    if (teammateIds.length > 0) {
      return ["teammate", teammateIds];
    }
    throw new Error("at least one execution subject is required");
  }

  private resolvePhaseControls(): PhaseControls {
    const raw = this.config.personaDefaults;
    if (!isRecord(raw)) {
      return {
        phaseOrder: [],
        phasePolicies: {},
      };
    }

    const phaseOrder: string[] = [];
    const seen = new Set<string>();
    const rawOrder = Array.isArray(raw.phase_order) ? raw.phase_order : [];
    for (const item of rawOrder) {
      const phase = String(item).trim();
      if (!phase || seen.has(phase)) {
        continue;
      }
      seen.add(phase);
      phaseOrder.push(phase);
    }

    const phasePolicies: Record<string, Record<string, string[]>> = {};
    const rawMap = raw.phase_policies;
    if (isRecord(rawMap)) {
      for (const [phaseRaw, policyRaw] of Object.entries(rawMap)) {
        const phase = String(phaseRaw).trim();
        if (!phase || !isRecord(policyRaw)) {
          continue;
        }

        const normalized: Record<string, string[]> = {};
        for (
          const key of [
            "active_personas",
            "executor_personas",
            "state_transition_personas",
          ] as const
        ) {
          const rawPersonas = policyRaw[key];
          if (!Array.isArray(rawPersonas)) {
            continue;
          }
          normalized[key] = rawPersonas
            .map((personaId) => String(personaId).trim())
            .filter((personaId) => personaId.length > 0);
        }
        phasePolicies[phase] = normalized;
      }
    }

    return {
      phaseOrder,
      phasePolicies,
    };
  }

  private taskPhaseIndex(task: Task): number {
    if (task.current_phase_index === null) {
      return 0;
    }
    return Math.max(0, Math.trunc(task.current_phase_index));
  }

  private taskPhaseOrder(task: Task): string[] {
    if (this.executionSubjectMode !== "persona") {
      return [];
    }

    const policy = this.asTaskPersonaPolicy(task.persona_policy);
    if (policy && Array.isArray(policy.phase_order)) {
      const seen = new Set<string>();
      const normalized: string[] = [];
      for (const raw of policy.phase_order) {
        const phase = String(raw).trim();
        if (!phase || seen.has(phase)) {
          continue;
        }
        seen.add(phase);
        normalized.push(phase);
      }
      if (normalized.length > 0) {
        return normalized;
      }
    }

    return [...this.phaseOrder];
  }

  private taskCurrentPhase(task: Task): string | null {
    if (this.executionSubjectMode !== "persona") {
      return null;
    }

    const phaseOrder = this.taskPhaseOrder(task);
    if (phaseOrder.length === 0) {
      return null;
    }

    const index = this.taskPhaseIndex(task);
    if (index >= phaseOrder.length) {
      return null;
    }
    return phaseOrder[index];
  }

  private taskNextPhase(task: Task): [number, string] | null {
    if (this.executionSubjectMode !== "persona") {
      return null;
    }

    const phaseOrder = this.taskPhaseOrder(task);
    if (phaseOrder.length === 0) {
      return null;
    }

    const nextIndex = this.taskPhaseIndex(task) + 1;
    if (nextIndex >= phaseOrder.length) {
      return null;
    }
    return [nextIndex, phaseOrder[nextIndex]];
  }

  private phasePolicyForTask(
    task: Task,
    phase: string,
  ): Record<string, string[]> {
    const merged: Record<string, string[]> = {
      ...this.phasePolicies[phase],
    };

    const policy = this.asTaskPersonaPolicy(task.persona_policy);
    if (!policy || !isRecord(policy.phase_overrides)) {
      return merged;
    }

    const overrideRaw = policy.phase_overrides[phase];
    if (!isRecord(overrideRaw)) {
      return merged;
    }

    for (
      const key of [
        "active_personas",
        "executor_personas",
        "state_transition_personas",
      ] as const
    ) {
      const raw = overrideRaw[key];
      if (!Array.isArray(raw)) {
        continue;
      }
      merged[key] = raw.map((personaId) => String(personaId).trim()).filter((
        personaId,
      ) => personaId.length > 0);
    }

    return merged;
  }

  private taskDisabledPersonas(task: Task): Set<string> {
    const policy = this.asTaskPersonaPolicy(task.persona_policy);
    if (!policy || !Array.isArray(policy.disable_personas)) {
      return new Set<string>();
    }
    return new Set(
      policy.disable_personas
        .filter((personaId) => typeof personaId === "string")
        .map((personaId) => personaId.trim())
        .filter((personaId) => personaId.length > 0),
    );
  }

  private policyPersonasForTask(
    task: Task,
    key: "active_personas" | "executor_personas" | "state_transition_personas",
    fallbackKey: "executor_personas" | null = null,
  ): string[] | null {
    if (this.executionSubjectMode !== "persona") {
      return null;
    }

    const disabled = this.taskDisabledPersonas(task);
    if (this.taskPhaseOrder(task).length === 0) {
      return this.personas
        .filter((persona) => persona.enabled)
        .map((persona) => persona.id)
        .filter((personaId) => !disabled.has(personaId));
    }

    const phase = this.taskCurrentPhase(task);
    if (phase === null) {
      return [];
    }

    const policy = this.phasePolicyForTask(task, phase);
    let rawPersonas = policy[key];
    if (rawPersonas === undefined && fallbackKey !== null) {
      rawPersonas = policy[fallbackKey];
    }
    if (!Array.isArray(rawPersonas)) {
      return [];
    }

    const seen = new Set<string>();
    const normalized: string[] = [];
    for (const personaIdRaw of rawPersonas) {
      const personaId = String(personaIdRaw).trim();
      if (!personaId || seen.has(personaId)) {
        continue;
      }
      seen.add(personaId);
      if (disabled.has(personaId)) {
        continue;
      }
      normalized.push(personaId);
    }
    return normalized;
  }

  private activePersonasForEvent(event: EventPayload): Set<string> | null {
    if (this.executionSubjectMode !== "persona") {
      return null;
    }

    const taskId = event.task_id;
    if (typeof taskId !== "string" || taskId.length === 0) {
      return null;
    }

    const task = this.store.getTask(taskId);
    if (task === null) {
      return new Set<string>();
    }

    const active = this.policyPersonasForTask(
      task,
      "active_personas",
      "executor_personas",
    );
    if (active === null) {
      return null;
    }
    return new Set(active);
  }

  private canPersonaTransition(
    personaId: string,
    taskId: string | null,
  ): boolean {
    if (this.executionSubjectMode !== "persona") {
      return true;
    }
    if (!taskId) {
      return false;
    }

    const task = this.store.getTask(taskId);
    if (task === null) {
      return false;
    }
    if (this.taskDisabledPersonas(task).has(personaId)) {
      return false;
    }
    if (this.taskPhaseOrder(task).length === 0) {
      return true;
    }

    const allowed = this.policyPersonasForTask(
      task,
      "state_transition_personas",
      "executor_personas",
    );
    if (allowed === null) {
      return true;
    }
    return new Set(allowed).has(personaId);
  }

  private allowedExecutionTaskIds(
    executionSubjectId: string,
  ): Set<string> | null {
    if (this.executionSubjectMode !== "persona") {
      return null;
    }

    const allowedTaskIds = new Set<string>();
    for (const task of this.store.listTasks()) {
      const executors = this.policyPersonasForTask(task, "executor_personas");
      if (!executors || executors.length === 0) {
        continue;
      }
      if (new Set(executors).has(executionSubjectId)) {
        allowedTaskIds.add(task.id);
      }
    }
    return allowedTaskIds;
  }

  private makeEvent(
    eventType: string,
    taskId?: string,
    teammate?: string,
    detail: string = "",
  ): EventPayload {
    const payload: EventPayload = {
      type: eventType,
      detail: this.short(detail, 200),
    };
    if (taskId) {
      payload.task_id = taskId;
    }
    if (teammate) {
      payload.teammate = teammate;
    }
    return payload;
  }

  private appendTaskProgressLog(
    taskId: string,
    source: string,
    text: string,
  ): void {
    try {
      this.store.appendTaskProgressLog(
        taskId,
        source,
        text,
        this.config.taskProgressLogLimit,
      );
    } catch (error) {
      this.log(
        `[progress-log] append failed task=${taskId} source=${source} ` +
          `reason=${this.short(String(error), 120)}`,
      );
    }
  }

  private evaluatePersonaComments(
    roundIndex: number,
    events: EventPayload[],
  ): Array<Record<string, unknown>> {
    const serialized: Array<Record<string, unknown>> = [];

    for (const event of events) {
      const activePersonas = this.activePersonasForEvent(event);
      const commentsRaw = this.personaPipeline.evaluateEvents([event], {
        activePersonaIds: activePersonas,
      });

      for (const commentRaw of commentsRaw) {
        const normalized = normalizePersonaComment(commentRaw);
        serialized.push(normalized);
      }
    }

    if (serialized.length === 0) {
      return serialized;
    }

    for (const comment of serialized) {
      comment.round = roundIndex;
      const severity = String(comment.severity ?? "").trim();
      if (severity in this.personaSeverityCounts) {
        this.personaSeverityCounts[severity] += 1;
      }
      this.personaCommentHistory.push({ ...comment });
      this.log(
        `[persona:${comment.persona_id}] severity=${comment.severity} ` +
          `event=${comment.event_type} task=${comment.task_id ?? "-"} ` +
          `detail=${this.short(String(comment.detail ?? ""), 120)}`,
      );
    }

    return serialized;
  }

  private applyPersonaActions(
    comments: Array<Record<string, unknown>>,
  ): PersonaActionResult {
    const nextRoundEvents: EventPayload[] = [];
    const escalatedTasks = new Set<string>();

    for (const comment of comments) {
      const personaId = String(comment.persona_id ?? "").trim();
      const severity = String(comment.severity ?? "").trim();
      const taskIdRaw = comment.task_id;
      const taskId = typeof taskIdRaw === "string" && taskIdRaw
        ? taskIdRaw
        : null;

      if (!["info", "warn", "critical", "blocker"].includes(severity)) {
        this.log(
          `[persona] ignored severity=${severity} persona=${
            personaId || "unknown"
          }`,
        );
        continue;
      }

      if (severity === "warn") {
        nextRoundEvents.push(
          this.makeEvent(
            "WarnRecheck",
            taskId ?? undefined,
            undefined,
            `persona=${personaId} from=${
              String(comment.event_type ?? "unknown")
            }`,
          ),
        );
        continue;
      }

      if (severity === "critical") {
        if (!this.canPersonaTransition(personaId, taskId)) {
          this.log(
            `[persona] skip critical persona=${personaId || "unknown"} ` +
              `task=${taskId ?? "-"} reason=no_transition_permission`,
          );
          continue;
        }
        if (!taskId) {
          this.log(
            `[persona] skip critical persona=${
              personaId || "unknown"
            } reason=missing_task_id`,
          );
          continue;
        }
        if (escalatedTasks.has(taskId)) {
          continue;
        }

        const current = this.store.getTask(taskId);
        if (current === null) {
          this.log(
            `[persona] skip critical persona=${personaId || "unknown"} ` +
              `task=${taskId} reason=task_not_found`,
          );
          continue;
        }

        if (current.status !== "needs_approval") {
          const updated = this.store.applyTaskUpdate(taskId, "needs_approval");
          this.log(
            `[persona] escalated task=${updated.id} status=${updated.status} ` +
              `by=${personaId || "unknown"}`,
          );
        }
        escalatedTasks.add(taskId);
        continue;
      }

      if (severity === "blocker") {
        const persona = this.personaById.get(personaId);
        const canTransition = this.canPersonaTransition(personaId, taskId);

        if (persona && persona.can_block && canTransition) {
          const stopReason = `persona_blocker:${personaId}`;
          this.personaBlockerTriggered = true;
          this.log(`[persona] blocker stop triggered by=${personaId}`);
          return {
            stopReason,
            nextRoundEvents,
          };
        }

        if (!canTransition) {
          this.log(
            `[persona] skip blocker persona=${personaId || "unknown"} ` +
              `task=${taskId ?? "-"} reason=no_transition_permission`,
          );
          continue;
        }

        if (!taskId) {
          this.log(
            `[persona] skip blocker persona=${
              personaId || "unknown"
            } reason=missing_task_id`,
          );
          continue;
        }

        if (escalatedTasks.has(taskId)) {
          continue;
        }

        const current = this.store.getTask(taskId);
        if (current !== null && current.status !== "needs_approval") {
          const updated = this.store.applyTaskUpdate(taskId, "needs_approval");
          this.log(
            `[persona] downgraded blocker to critical task=${updated.id} ` +
              `by=${personaId || "unknown"}`,
          );
        }
        escalatedTasks.add(taskId);
      }
    }

    return {
      stopReason: null,
      nextRoundEvents,
    };
  }

  private buildSnapshot(
    events: EventPayload[],
    personaComments: Array<Record<string, unknown>>,
    roundIndex: number,
    idleRounds: number,
  ): Record<string, unknown> {
    const tasks = this.store.listTasks().map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      owner: task.owner,
      planner: task.planner,
      depends_on: task.depends_on,
      target_paths: task.target_paths,
      requires_plan: task.requires_plan,
      plan_status: task.plan_status,
      current_phase_index: task.current_phase_index,
      current_phase: this.taskCurrentPhase(task),
      plan_excerpt: this.short(task.plan_text ?? "", 240),
      block_reason: this.short(task.block_reason ?? "", 180),
    }));

    const recentMessages = this.store.listRecentMessages(20).map((message) => ({
      seq: message.seq,
      sender: message.sender,
      receiver: message.receiver,
      task_id: message.task_id,
      content_short: this.short(message.content, 120),
    }));

    return {
      lead_id: this.config.leadId,
      teammates: [...this.executionSubjectIds],
      personas: this.personas.map((persona) => personaToRecord(persona)),
      round_index: roundIndex,
      idle_rounds: idleRounds,
      status_summary: this.store.statusSummary(),
      events,
      persona_comments: personaComments,
      tasks,
      recent_messages: recentMessages,
      last_decisions: this.decisionHistory.slice(-5),
    };
  }

  private invokeProvider(
    events: EventPayload[],
    personaComments: Array<Record<string, unknown>>,
    roundIndex: number,
    idleRounds: number,
  ): OrchestratorDecision {
    const snapshot = this.buildSnapshot(
      events,
      personaComments,
      roundIndex,
      idleRounds,
    );
    this.providerCalls += 1;

    const decisionRaw = this.provider.run(snapshot);
    const validated = validateDecisionJson(decisionRaw);

    this.decisionHistory.push({
      round: roundIndex,
      events: events.map((event) => event.type),
      updates: validated.task_updates.length,
      messages: validated.messages.length,
      stop: validated.stop.should_stop,
    });

    return validated;
  }

  private applyDecision(decision: OrchestratorDecision): ApplyDecisionResult {
    let appliedUpdates = 0;
    let appliedPlanActions = 0;

    for (const update of decision.task_updates) {
      const current = this.store.getTask(update.task_id);
      if (current === null) {
        this.log(
          `[lead] skip update task=${update.task_id} reason=task_not_found`,
        );
        continue;
      }

      if (
        update.new_status === "in_progress" || update.new_status === "completed"
      ) {
        this.log(
          `[lead] skip update task=${update.task_id} ` +
            `reason=execution_state_managed_by_teammates requested=${update.new_status}`,
        );
        continue;
      }

      if (update.new_status === "blocked" && current.status !== "blocked") {
        this.log(
          `[lead] skip update task=${update.task_id} reason=blocked_transition_not_allowed ` +
            `current_status=${current.status}`,
        );
        continue;
      }

      const planAction = update.plan_action;
      if (
        planAction !== null &&
        !(current.status === "needs_approval" &&
          current.plan_status === "submitted")
      ) {
        this.log(
          `[lead] skip update task=${update.task_id} reason=plan_action_not_applicable ` +
            `status=${current.status} plan_status=${current.plan_status}`,
        );
        continue;
      }

      let updatedTask: Task;
      try {
        updatedTask = this.store.applyTaskUpdate(
          update.task_id,
          update.new_status,
          update.owner,
          planAction,
          update.feedback,
        );
      } catch (error) {
        this.log(
          `[lead] skip update task=${update.task_id} reason=${
            this.short(String(error), 180)
          }`,
        );
        continue;
      }

      appliedUpdates += 1;
      if (planAction !== null) {
        appliedPlanActions += 1;
      }
      this.log(
        `[lead] update task=${updatedTask.id} status=${updatedTask.status} ` +
          `plan_status=${updatedTask.plan_status}`,
      );
    }

    for (const message of decision.messages) {
      this.store.sendMessage(
        this.config.leadId,
        message.to,
        message.text_short,
      );
      this.log(`[lead] msg to=${message.to} text=${message.text_short}`);
    }

    return {
      applied_updates: appliedUpdates,
      applied_plan_actions: appliedPlanActions,
    };
  }

  private autoReleaseNonplanApprovals(): string[] {
    const released: string[] = [];
    for (const task of this.store.listTasks()) {
      if (task.status !== "needs_approval") {
        continue;
      }
      if (task.requires_plan && task.plan_status === "submitted") {
        continue;
      }

      const receiver = task.owner ?? task.planner ?? this.config.leadId;
      let updated: Task;
      try {
        updated = this.store.applyTaskUpdate(task.id, "pending");
      } catch (error) {
        this.log(
          `[lead] skip fallback approval release task=${task.id} ` +
            `reason=${this.short(String(error), 180)}`,
        );
        continue;
      }

      released.push(updated.id);
      this.store.sendMessage(
        this.config.leadId,
        receiver,
        `approval cleared by fallback for ${updated.id}`,
        updated.id,
      );
      this.log(
        `[lead] fallback released approval task=${updated.id} status=${updated.status}`,
      );
    }
    return released;
  }

  private teammateProcessPlan(
    teammateId: string,
  ): { changed: boolean; events: EventPayload[] } {
    const task = this.store.claimPlanTask(teammateId);
    if (!task) {
      return {
        changed: false,
        events: [],
      };
    }

    const planText = this.adapter.buildPlan(teammateId, task);
    this.store.submitPlan(task.id, teammateId, planText);
    this.store.sendMessage(
      teammateId,
      this.config.leadId,
      `plan submitted task=${task.id}`,
      task.id,
    );
    this.log(`[${teammateId}] plan submitted task=${task.id}`);

    return {
      changed: true,
      events: [
        this.makeEvent(
          "NeedsApproval",
          task.id,
          teammateId,
          "plan submitted",
        ),
      ],
    };
  }

  private teammateProcessExecution(
    teammateId: string,
  ): { changed: boolean; events: EventPayload[] } {
    const allowedTaskIds = this.allowedExecutionTaskIds(teammateId);
    if (allowedTaskIds !== null && allowedTaskIds.size === 0) {
      return {
        changed: false,
        events: [],
      };
    }

    const task = this.store.claimExecutionTask(teammateId, allowedTaskIds);
    if (!task) {
      return {
        changed: false,
        events: [],
      };
    }

    if (task.progress_log.length > 0) {
      this.log(
        `[${teammateId}] resume task=${task.id} ` +
          `progress_log_entries=${task.progress_log.length}`,
      );
    }

    const phase = this.taskCurrentPhase(task);
    let startDetail =
      `execution started ${this.executionSubjectMode}=${teammateId}`;
    if (phase) {
      startDetail = `${startDetail} phase=${phase}`;
    }
    this.appendTaskProgressLog(task.id, "system", startDetail);

    const taskForExecution = this.store.getTask(task.id) ?? task;

    const onProgress: ProgressCallback = (
      source: string,
      text: string,
    ): void => {
      this.appendTaskProgressLog(task.id, source, text);
    };

    let result: string;
    try {
      result = this.adapter.executeTask(
        teammateId,
        taskForExecution,
        onProgress,
      );
    } catch (error) {
      const blocked = this.store.markTaskBlocked(
        task.id,
        teammateId,
        this.short(String(error), 180),
      );
      this.appendTaskProgressLog(
        blocked.id,
        "system",
        `execution blocked: ${blocked.block_reason ?? "blocked"}`,
      );
      this.store.sendMessage(
        teammateId,
        this.config.leadId,
        `task blocked task=${blocked.id} reason=${blocked.block_reason}`,
        blocked.id,
      );
      this.log(
        `[${teammateId}] blocked task=${blocked.id} reason=${blocked.block_reason}`,
      );

      return {
        changed: true,
        events: [
          this.makeEvent(
            "Blocked",
            blocked.id,
            teammateId,
            blocked.block_reason ?? "blocked",
          ),
        ],
      };
    }

    const reviewerStopRule = this.detectReviewerStopRule(teammateId, result);
    if (reviewerStopRule !== null) {
      const flagged = this.store.applyTaskUpdate(task.id, "needs_approval");
      this.appendTaskProgressLog(
        flagged.id,
        "system",
        `reviewer stop candidate rule=${reviewerStopRule}: ${
          this.short(result, 160)
        }`,
      );
      this.store.sendMessage(
        teammateId,
        this.config.leadId,
        `reviewer stop candidate task=${flagged.id} rule=${reviewerStopRule}`,
        flagged.id,
      );
      this.log(
        `[${teammateId}] reviewer stop candidate task=${flagged.id} ` +
          `rule=${reviewerStopRule}`,
      );

      return {
        changed: true,
        events: [
          this.makeEvent(
            "ReviewerViolation",
            flagged.id,
            teammateId,
            `rule=${reviewerStopRule}`,
          ),
        ],
      };
    }

    const executionResult = parseExecutionResultBlock(result);
    if (executionResult.status !== "completed") {
      const blockReason = executionResult.status === "blocked"
        ? `execution result is blocked${
          executionResult.summary ? `: ${executionResult.summary}` : ""
        }`
        : "execution result must include RESULT: completed|blocked";
      const blocked = this.store.markTaskBlocked(
        task.id,
        teammateId,
        this.short(blockReason, 180),
      );
      this.appendTaskProgressLog(
        blocked.id,
        "system",
        `execution blocked: ${this.short(result, 160)}`,
      );
      this.store.sendMessage(
        teammateId,
        this.config.leadId,
        `task blocked task=${blocked.id} reason=${blocked.block_reason}`,
        blocked.id,
      );
      this.log(
        `[${teammateId}] blocked task=${blocked.id} reason=${blocked.block_reason}`,
      );
      return {
        changed: true,
        events: [
          this.makeEvent(
            "Blocked",
            blocked.id,
            teammateId,
            blocked.block_reason ?? "blocked",
          ),
        ],
      };
    }

    const nextPhase = this.taskNextPhase(taskForExecution);
    if (nextPhase !== null) {
      const [nextPhaseIndex, nextPhaseName] = nextPhase;
      const handedOff = this.store.handoffTaskPhase(
        task.id,
        teammateId,
        nextPhaseIndex,
      );
      this.appendTaskProgressLog(
        handedOff.id,
        "system",
        `phase handoff to ${nextPhaseName}: ${this.short(result, 160)}`,
      );
      this.store.sendMessage(
        teammateId,
        this.config.leadId,
        `task handed off task=${handedOff.id} next_phase=${nextPhaseName}`,
        handedOff.id,
      );
      this.log(
        `[${teammateId}] handed off task=${handedOff.id} next_phase=${nextPhaseName}`,
      );

      return {
        changed: true,
        events: [
          this.makeEvent(
            "TaskHandoff",
            handedOff.id,
            teammateId,
            `next_phase=${nextPhaseName}`,
          ),
        ],
      };
    }

    const completed = this.store.completeTask(task.id, teammateId, result);
    this.appendTaskProgressLog(
      completed.id,
      "system",
      `execution completed: ${this.short(result, 160)}`,
    );
    this.store.sendMessage(
      teammateId,
      this.config.leadId,
      `task completed task=${completed.id}`,
      completed.id,
    );
    this.log(`[${teammateId}] completed task=${completed.id}`);

    return {
      changed: true,
      events: [
        this.makeEvent(
          "TaskCompleted",
          completed.id,
          teammateId,
          this.short(result, 160),
        ),
      ],
    };
  }

  private detectReviewerStopRule(
    executionSubjectId: string,
    result: string,
  ): string | null {
    if (this.executionSubjectMode !== "persona") {
      return null;
    }
    if (!this.isReviewerExecutionSubject(executionSubjectId)) {
      return null;
    }
    return detectReviewerStopRule(result);
  }

  private isReviewerExecutionSubject(executionSubjectId: string): boolean {
    const persona = this.personaById.get(executionSubjectId);
    if (persona !== undefined && persona.role === "reviewer") {
      return true;
    }
    return /reviewer/iu.test(executionSubjectId);
  }

  private collectCollisionEvents(): EventPayload[] {
    const events: EventPayload[] = [];
    const collisions = this.store.detectCollisions();
    const currentKeys = new Set<string>();

    for (const item of collisions) {
      const key = `${item.waiting_task_id}::${item.running_task_id}`;
      currentKeys.add(key);
      if (this.collisionCache.has(key)) {
        continue;
      }
      events.push(
        this.makeEvent(
          "Collision",
          item.waiting_task_id,
          undefined,
          `waiting=${item.waiting_task_id} running=${item.running_task_id}`,
        ),
      );
    }

    this.collisionCache.clear();
    for (const key of currentKeys) {
      this.collisionCache.add(key);
    }

    return events;
  }

  private asTaskPersonaPolicy(
    raw: unknown,
  ): NormalizedTaskPersonaPolicy | null {
    if (!isRecord(raw)) {
      return null;
    }
    return raw as NormalizedTaskPersonaPolicy;
  }

  private log(message: string): void {
    this.eventLogger(`${nowSeconds().toFixed(3)} ${message}`);
  }

  private short(text: string, maxChars: number = 180): string {
    return text.length <= maxChars ? text : `${text.slice(0, maxChars - 3)}...`;
  }
}

function isExecutionEnabled(execution: PersonaExecutionConfig | null): boolean {
  return execution !== null && execution.enabled;
}

function normalizePersonaComment(raw: unknown): Record<string, unknown> {
  if (isRecord(raw)) {
    return {
      persona_id: String(raw.persona_id ?? ""),
      severity: String(raw.severity ?? "info"),
      task_id: typeof raw.task_id === "string" ? raw.task_id : null,
      event_type: String(raw.event_type ?? ""),
      detail: String(raw.detail ?? ""),
    };
  }

  const fallback = raw as Partial<PersonaComment>;
  return {
    persona_id: String(fallback.persona_id ?? ""),
    severity: String(fallback.severity ?? "info"),
    task_id: typeof fallback.task_id === "string" ? fallback.task_id : null,
    event_type: String(fallback.event_type ?? ""),
    detail: String(fallback.detail ?? ""),
  };
}

function personaToRecord(persona: PersonaDefinition): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    id: persona.id,
    role: persona.role,
    focus: persona.focus,
    can_block: persona.can_block,
    enabled: persona.enabled,
  };
  if (persona.execution !== null) {
    payload.execution = {
      enabled: persona.execution.enabled,
      command_ref: persona.execution.command_ref,
      sandbox: persona.execution.sandbox,
      timeout_sec: persona.execution.timeout_sec,
    };
  }
  return payload;
}

function detectReviewerStopRule(text: string): string | null {
  const normalizedText = text.trim();
  if (!normalizedText) {
    return null;
  }

  const tokenMatch = REVIEWER_STOP_TOKEN_PATTERN.exec(normalizedText);
  if (tokenMatch) {
    return normalizeReviewerStopRule(tokenMatch[1]);
  }

  if (
    !REVIEWER_STOP_HINT_PATTERNS.some((pattern) => pattern.test(normalizedText))
  ) {
    return null;
  }

  for (const [rule, patterns] of Object.entries(REVIEWER_STOP_RULE_PATTERNS)) {
    if (patterns.some((pattern) => pattern.test(normalizedText))) {
      return rule;
    }
  }

  return null;
}

function normalizeReviewerStopRule(rawRule: string): string {
  const normalizedKey = rawRule.trim().toLowerCase().replaceAll("-", "_");
  return REVIEWER_STOP_RULE_ALIASES[normalizedKey] ?? normalizedKey;
}

function parseExecutionResultBlock(
  text: string,
): { status: "completed" | "blocked" | null; summary: string | null } {
  const lines = text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  let status: "completed" | "blocked" | null = null;
  let summary: string | null = null;

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (status === null) {
      const resultMatch = /^RESULT:\s*(.+)$/iu.exec(line);
      if (resultMatch) {
        const normalized = resultMatch[1].trim().toLowerCase();
        if (normalized === "completed" || normalized === "blocked") {
          status = normalized;
        } else {
          status = null;
        }
      }
    }
    if (summary === null) {
      const summaryMatch = /^SUMMARY:\s*(.+)$/iu.exec(line);
      if (summaryMatch) {
        summary = summaryMatch[1].trim();
      }
    }
    if (status !== null && summary !== null) {
      break;
    }
  }

  return { status, summary };
}

function getEnv(name: string, fallback: string): string {
  try {
    return (Deno.env.get(name) ?? fallback).trim();
  } catch (_error) {
    return fallback;
  }
}

function nowSeconds(): number {
  return Date.now() / 1000;
}

function sleepSync(ms: number): void {
  const array = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(array, 0, 0, Math.max(0, Math.trunc(ms)));
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw);
}

export function toTaskUpdateDecisionSet(
  updates: TaskUpdateDecision[],
): Set<string> {
  return new Set(
    updates.map((update) =>
      `${update.task_id}:${update.new_status}:${update.plan_action ?? ""}`
    ),
  );
}

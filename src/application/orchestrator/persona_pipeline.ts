import type { PersonaDefinition } from "../../domain/persona.ts";

export type PersonaSeverity = "info" | "warn" | "critical" | "blocker";

const SEVERITY_BY_EVENT: Record<string, PersonaSeverity> = {
  Kickoff: "info",
  TaskCompleted: "info",
  NeedsApproval: "warn",
  NoProgress: "warn",
  Collision: "warn",
  Blocked: "critical",
  ReviewerViolation: "blocker",
};

const SEVERITY_PRIORITY: Record<PersonaSeverity, number> = {
  blocker: 0,
  critical: 1,
  warn: 2,
  info: 3,
};

export interface PersonaComment {
  persona_id: string;
  severity: PersonaSeverity;
  task_id: string | null;
  event_type: string;
  detail: string;
}

export interface EvaluateEventsOptions {
  activePersonaIds?: ReadonlySet<string> | null;
}

export class PersonaEvaluationPipeline {
  readonly personas: PersonaDefinition[];
  readonly maxCommentsPerEvent: number;

  constructor(personas: PersonaDefinition[], maxCommentsPerEvent: number = 2) {
    this.personas = [...personas];
    this.maxCommentsPerEvent = Math.max(1, Math.trunc(maxCommentsPerEvent));
  }

  evaluateEvents(
    events: Array<Record<string, string>>,
    options: EvaluateEventsOptions = {},
  ): PersonaComment[] {
    const comments: PersonaComment[] = [];
    const activePersonaIds = options.activePersonaIds ?? null;
    const enabledPersonas = this.personas.filter((persona) => {
      if (!persona.enabled) {
        return false;
      }
      if (activePersonaIds === null) {
        return true;
      }
      return activePersonaIds.has(persona.id);
    });

    for (const event of events) {
      const eventType = String(event.type ?? "").trim();
      if (!eventType) {
        continue;
      }
      const severity = SEVERITY_BY_EVENT[eventType];
      if (!severity) {
        continue;
      }

      const eventComments = enabledPersonas.map((persona) =>
        buildComment(persona, event, eventType, severity)
      );
      eventComments.sort((left, right) => {
        const severityDiff = SEVERITY_PRIORITY[left.severity] -
          SEVERITY_PRIORITY[right.severity];
        if (severityDiff !== 0) {
          return severityDiff;
        }
        const personaDiff = left.persona_id.localeCompare(right.persona_id);
        if (personaDiff !== 0) {
          return personaDiff;
        }
        return (left.task_id ?? "").localeCompare(right.task_id ?? "");
      });
      comments.push(...eventComments.slice(0, this.maxCommentsPerEvent));
    }

    return comments;
  }
}

function buildComment(
  persona: PersonaDefinition,
  event: Record<string, string>,
  eventType: string,
  severity: PersonaSeverity,
): PersonaComment {
  const taskId = event.task_id ? String(event.task_id) : null;
  const detail = String(event.detail ?? "").trim();
  let message = `${persona.id} observed ${eventType}`;
  if (taskId) {
    message = `${message} task=${taskId}`;
  }
  if (detail) {
    message = `${message} detail=${detail}`;
  }
  return {
    persona_id: persona.id,
    severity,
    task_id: taskId,
    event_type: eventType,
    detail: message.slice(0, 200),
  };
}

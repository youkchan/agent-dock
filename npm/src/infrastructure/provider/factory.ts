import {
  MockOrchestratorProvider,
  type OrchestratorProvider,
} from "../../application/orchestrator/orchestrator.ts";
import {
  DecisionValidationError,
  type OrchestratorDecision,
  validateDecisionJson,
} from "../../domain/decision.ts";

const MAX_INPUT_TOKEN_HARD_CAP = 16000;
const MAX_OUTPUT_TOKEN_HARD_CAP = 2000;
const DEFAULT_INPUT_TOKEN_BUDGET = 4000;
const DEFAULT_OUTPUT_TOKEN_BUDGET = 800;
const DEFAULT_OPENAI_MODEL = "gpt-5-mini";
const DEFAULT_REASONING_EFFORT = "minimal";
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

const DECISION_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["decisions", "task_updates", "messages", "stop", "meta"],
  properties: {
    decisions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "task_id", "teammate", "reason_short"],
        properties: {
          type: { type: "string" },
          task_id: { type: ["string", "null"] },
          teammate: { type: ["string", "null"] },
          reason_short: { type: "string" },
        },
      },
    },
    task_updates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["task_id", "new_status", "owner", "plan_action", "feedback"],
        properties: {
          task_id: { type: "string" },
          new_status: {
            type: "string",
            enum: [
              "pending",
              "in_progress",
              "blocked",
              "needs_approval",
              "completed",
            ],
          },
          owner: { type: ["string", "null"] },
          plan_action: {
            type: ["string", "null"],
            enum: ["approve", "reject", "revise", null],
          },
          feedback: { type: "string" },
        },
      },
    },
    messages: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["to", "text_short"],
        properties: {
          to: { type: "string" },
          text_short: { type: "string" },
        },
      },
    },
    stop: {
      type: "object",
      additionalProperties: false,
      required: ["should_stop", "reason_short"],
      properties: {
        should_stop: { type: "boolean" },
        reason_short: { type: "string" },
      },
    },
    meta: {
      type: "object",
      additionalProperties: false,
      required: ["provider", "model", "token_budget", "elapsed_ms"],
      properties: {
        provider: { type: "string" },
        model: { type: "string" },
        token_budget: {
          type: "object",
          additionalProperties: false,
          required: ["input", "output"],
          properties: {
            input: { type: "integer" },
            output: { type: "integer" },
          },
        },
        elapsed_ms: { type: "integer" },
      },
    },
  },
};

export class OpenAIOrchestratorProvider implements OrchestratorProvider {
  readonly providerName = "openai";
  readonly model: string;
  readonly inputTokenBudget: number;
  readonly outputTokenBudget: number;
  readonly apiKey: string;
  readonly reasoningEffort: string;
  readonly systemPrompt: string;

  constructor(options: {
    model?: string;
    inputTokenBudget?: number;
    outputTokenBudget?: number;
    apiKey?: string;
    reasoningEffort?: string;
    systemPrompt?: string;
  } = {}) {
    this.model = options.model ?? DEFAULT_OPENAI_MODEL;
    this.inputTokenBudget = options.inputTokenBudget ??
      DEFAULT_INPUT_TOKEN_BUDGET;
    this.outputTokenBudget = options.outputTokenBudget ??
      DEFAULT_OUTPUT_TOKEN_BUDGET;
    this.apiKey = (options.apiKey ?? getEnv("OPENAI_API_KEY", "")).trim();
    if (!this.apiKey) {
      throw new Error("OPENAI_API_KEY is required for openai provider");
    }
    this.reasoningEffort = (options.reasoningEffort ??
      getEnv("ORCHESTRATOR_REASONING_EFFORT", DEFAULT_REASONING_EFFORT)).trim() ||
      DEFAULT_REASONING_EFFORT;
    this.systemPrompt = options.systemPrompt ??
      [
        "You are a thin orchestrator lead.",
        "Return strict JSON only.",
        "No markdown. No prose.",
        "Decisions should be routing/state updates only.",
      ].join(" ");
  }

  run(snapshotJson: Record<string, unknown>): OrchestratorDecision {
    const startedAt = Date.now();
    const snapshotText = this.compressSnapshot(snapshotJson);
    const retrySnapshotText = this.compressSnapshotForRetry(snapshotJson);

    let parsed: Record<string, unknown> | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const currentSnapshotText = attempt === 0 ? snapshotText : retrySnapshotText;
      const requestPayload = this.buildRequestPayload(currentSnapshotText);
      const rawResponse = this.invokeResponsesApi(requestPayload);
      const outputText = this.extractText(rawResponse).trim();
      const incomplete = this.isIncompleteResponse(rawResponse);

      if (!outputText) {
        if (attempt === 0 && incomplete) {
          continue;
        }
        throw new DecisionValidationError(
          `openai provider returned empty output (status=${this.responseStatus(rawResponse)})`,
        );
      }

      try {
        parsed = this.parseJson(outputText, rawResponse);
        break;
      } catch (error) {
        if (attempt === 0 && incomplete) {
          continue;
        }
        throw error;
      }
    }

    if (parsed === null) {
      throw new DecisionValidationError(
        "openai provider returned invalid json (status=incomplete) after retry",
      );
    }

    const validated = validateDecisionJson(parsed);
    validated.meta.provider = this.providerName;
    validated.meta.model = this.model;
    validated.meta.token_budget = {
      input: this.inputTokenBudget,
      output: this.outputTokenBudget,
    };
    validated.meta.elapsed_ms = Math.max(0, Date.now() - startedAt);
    return validated;
  }

  private buildRequestPayload(snapshotText: string): Record<string, unknown> {
    return {
      model: this.model,
      instructions: this.systemPrompt,
      input: [
        "Return decision_json only.",
        "Use required keys exactly.",
        `Snapshot: ${snapshotText}`,
      ].join("\n"),
      max_output_tokens: this.outputTokenBudget,
      reasoning: { effort: this.reasoningEffort },
      text: {
        format: {
          type: "json_schema",
          name: "decision_json",
          strict: true,
          schema: DECISION_JSON_SCHEMA,
        },
      },
    };
  }

  private compressSnapshot(snapshotJson: Record<string, unknown>): string {
    const compact = JSON.stringify(snapshotJson);
    const maxChars = Math.max(1000, this.inputTokenBudget * 4);
    if (compact.length <= maxChars) {
      return compact;
    }
    const wrapped = {
      truncated: true,
      snapshot_prefix: compact.slice(0, maxChars - 80),
    };
    return JSON.stringify(wrapped);
  }

  private compressSnapshotForRetry(snapshotJson: Record<string, unknown>): string {
    const compact = JSON.stringify(snapshotJson);
    const retryMaxChars = Math.max(1000, this.inputTokenBudget * 2);
    const prefixMax = Math.max(120, retryMaxChars - 110);
    const prefixLen = Math.min(prefixMax, Math.max(120, Math.floor(compact.length / 2)));
    const wrapped = {
      truncated: true,
      retry_compaction: true,
      snapshot_prefix: compact.slice(0, prefixLen),
    };
    return JSON.stringify(wrapped);
  }

  private responseStatus(response: Record<string, unknown>): string {
    return typeof response.status === "string" ? response.status : "unknown";
  }

  private isIncompleteResponse(response: Record<string, unknown>): boolean {
    return this.responseStatus(response).toLowerCase() === "incomplete";
  }

  private invokeResponsesApi(payload: Record<string, unknown>): Record<string, unknown> {
    const command = new Deno.Command("curl", {
      args: [
        "-sS",
        "-X",
        "POST",
        OPENAI_RESPONSES_URL,
        "-H",
        `Authorization: Bearer ${this.apiKey}`,
        "-H",
        "Content-Type: application/json",
        "-d",
        JSON.stringify(payload),
      ],
      stdout: "piped",
      stderr: "piped",
    });
    const result = command.outputSync();
    const stderr = new TextDecoder().decode(result.stderr).trim();
    const stdout = new TextDecoder().decode(result.stdout).trim();
    if (!result.success) {
      throw new Error(
        `openai request failed (exit=${result.code}): ${
          stderr || stdout || "no stderr"
        }`,
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout);
    } catch (_error) {
      throw new DecisionValidationError(
        `openai provider returned non-json response: ${stdout.slice(0, 300)}`,
      );
    }
    if (!isRecord(parsed)) {
      throw new DecisionValidationError("openai provider response must be an object");
    }
    if (isRecord(parsed.error)) {
      throw new Error(`openai error: ${JSON.stringify(parsed.error)}`);
    }
    return parsed;
  }

  private extractText(response: Record<string, unknown>): string {
    const outputText = response.output_text;
    if (typeof outputText === "string" && outputText.trim()) {
      return this.stripFence(outputText);
    }
    const output = response.output;
    if (!Array.isArray(output)) {
      return "";
    }
    const chunks: string[] = [];
    for (const itemRaw of output) {
      if (!isRecord(itemRaw)) {
        continue;
      }
      if (itemRaw.type !== "message") {
        continue;
      }
      const content = itemRaw.content;
      if (!Array.isArray(content)) {
        continue;
      }
      for (const partRaw of content) {
        if (!isRecord(partRaw)) {
          continue;
        }
        if (partRaw.type !== "output_text" && partRaw.type !== "text") {
          continue;
        }
        const textValue = readText(partRaw);
        if (textValue) {
          chunks.push(textValue);
        }
      }
    }
    return this.stripFence(chunks.join("\n"));
  }

  private stripFence(text: string): string {
    const stripped = text.trim();
    if (stripped.startsWith("```") && stripped.endsWith("```")) {
      const lines = stripped.split("\n");
      if (lines.length >= 3) {
        return lines.slice(1, -1).join("\n").trim();
      }
    }
    return stripped;
  }

  private parseJson(
    outputText: string,
    response: Record<string, unknown>,
  ): Record<string, unknown> {
    try {
      const parsed = JSON.parse(outputText);
      if (!isRecord(parsed)) {
        throw new DecisionValidationError("decision json must be an object");
      }
      return parsed;
    } catch (_error) {
      const first = outputText.indexOf("{");
      const last = outputText.lastIndexOf("}");
      if (first !== -1 && last !== -1 && last > first) {
        try {
          const parsed = JSON.parse(outputText.slice(first, last + 1));
          if (isRecord(parsed)) {
            return parsed;
          }
        } catch (_inner) {
          // fallthrough
        }
      }
      const status = typeof response.status === "string"
        ? response.status
        : "unknown";
      throw new DecisionValidationError(
        `openai provider returned invalid json (status=${status}) preview=${
          outputText.slice(0, 300).replaceAll("\n", "\\n")
        }`,
      );
    }
  }
}

export function buildProviderFromEnv(): OrchestratorProvider {
  const providerName = getEnv("ORCHESTRATOR_PROVIDER", "mock").toLowerCase();
  const inputTokenBudget = safeIntEnv(
    "ORCHESTRATOR_INPUT_TOKENS",
    DEFAULT_INPUT_TOKEN_BUDGET,
    MAX_INPUT_TOKEN_HARD_CAP,
  );
  const outputTokenBudget = safeIntEnv(
    "ORCHESTRATOR_OUTPUT_TOKENS",
    DEFAULT_OUTPUT_TOKEN_BUDGET,
    MAX_OUTPUT_TOKEN_HARD_CAP,
  );

  if (providerName === "mock") {
    return new MockOrchestratorProvider({
      inputTokenBudget,
      outputTokenBudget,
    });
  }

  if (providerName === "openai") {
    const model = getEnv("ORCHESTRATOR_OPENAI_MODEL", DEFAULT_OPENAI_MODEL) ||
      DEFAULT_OPENAI_MODEL;
    const apiKey = getEnv("OPENAI_API_KEY", "");
    return new OpenAIOrchestratorProvider({
      model,
      inputTokenBudget,
      outputTokenBudget,
      apiKey,
    });
  }

  if (providerName === "claude" || providerName === "gemini") {
    throw new Error(
      `${providerName} provider is not implemented yet; use ORCHESTRATOR_PROVIDER=mock|openai`,
    );
  }

  throw new Error(`unknown orchestrator provider: ${providerName}`);
}

function safeIntEnv(name: string, fallback: number, hardCap: number): number {
  const raw = getEnv(name, "");
  const parsed = Number.parseInt(raw || String(fallback), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(hardCap, Math.max(1, parsed));
}

function getEnv(name: string, fallback: string): string {
  try {
    return (Deno.env.get(name) ?? fallback).trim();
  } catch (_error) {
    return fallback;
  }
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw);
}

function readText(partRaw: Record<string, unknown>): string {
  const value = partRaw.text;
  if (typeof value === "string") {
    return value.trim();
  }
  if (isRecord(value) && typeof value.value === "string") {
    return value.value.trim();
  }
  if (typeof partRaw.output_text === "string") {
    return partRaw.output_text.trim();
  }
  return "";
}

import {
  MockOrchestratorProvider,
  type OrchestratorProvider,
} from "../../application/orchestrator/orchestrator.ts";

const MAX_INPUT_TOKEN_HARD_CAP = 16000;
const MAX_OUTPUT_TOKEN_HARD_CAP = 2000;
const DEFAULT_INPUT_TOKEN_BUDGET = 4000;
const DEFAULT_OUTPUT_TOKEN_BUDGET = 800;

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
    throw new Error(
      "openai provider is not implemented yet; use ORCHESTRATOR_PROVIDER=mock",
    );
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

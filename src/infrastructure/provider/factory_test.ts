import { MockOrchestratorProvider } from "../../application/orchestrator/orchestrator.ts";
import { buildProviderFromEnv } from "./factory.ts";

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

function assertThrowsMessage(fn: () => void, messagePart: string): void {
  let thrown: unknown = null;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }
  if (!(thrown instanceof Error)) {
    throw new Error("expected function to throw Error");
  }
  if (!thrown.message.includes(messagePart)) {
    throw new Error(`expected '${thrown.message}' to include '${messagePart}'`);
  }
}

function withEnv(vars: Record<string, string>, run: () => void): void {
  const snapshots = new Map<string, string | undefined>();
  for (const name of Object.keys(vars)) {
    snapshots.set(name, Deno.env.get(name));
    Deno.env.set(name, vars[name]);
  }

  try {
    run();
  } finally {
    for (const [name, value] of snapshots.entries()) {
      if (value === undefined) {
        Deno.env.delete(name);
      } else {
        Deno.env.set(name, value);
      }
    }
  }
}

Deno.test("buildProviderFromEnv returns mock provider with token budgets", () => {
  withEnv({
    ORCHESTRATOR_PROVIDER: "mock",
    ORCHESTRATOR_INPUT_TOKENS: "20000",
    ORCHESTRATOR_OUTPUT_TOKENS: "0",
  }, () => {
    const provider = buildProviderFromEnv();
    assert(
      provider instanceof MockOrchestratorProvider,
      "provider should be MockOrchestratorProvider",
    );

    const mock = provider as MockOrchestratorProvider;
    assertEqual(mock.inputTokenBudget, 16000, "input token cap");
    assertEqual(mock.outputTokenBudget, 1, "output token floor");
  });
});

Deno.test("buildProviderFromEnv rejects unimplemented providers", () => {
  withEnv({ ORCHESTRATOR_PROVIDER: "claude" }, () => {
    assertThrowsMessage(
      () => buildProviderFromEnv(),
      "claude provider is not implemented yet",
    );
  });
});

Deno.test("buildProviderFromEnv rejects unknown provider", () => {
  withEnv({ ORCHESTRATOR_PROVIDER: "unknown-x" }, () => {
    assertThrowsMessage(
      () => buildProviderFromEnv(),
      "unknown orchestrator provider: unknown-x",
    );
  });
});

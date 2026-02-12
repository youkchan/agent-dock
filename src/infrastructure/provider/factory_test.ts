import { MockOrchestratorProvider } from "../../application/orchestrator/orchestrator.ts";
import { DecisionValidationError } from "../../domain/decision.ts";
import {
  buildProviderFromEnv,
  OpenAIOrchestratorProvider,
} from "./factory.ts";

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

Deno.test("buildProviderFromEnv builds openai provider", () => {
  withEnv({
    ORCHESTRATOR_PROVIDER: "openai",
    OPENAI_API_KEY: "dummy-key",
    ORCHESTRATOR_OPENAI_MODEL: "gpt-5-mini",
  }, () => {
    const provider = buildProviderFromEnv();
    assert(
      provider instanceof OpenAIOrchestratorProvider,
      "provider should be OpenAIOrchestratorProvider",
    );
  });
});

Deno.test("buildProviderFromEnv rejects openai without api key", () => {
  withEnv({
    ORCHESTRATOR_PROVIDER: "openai",
    OPENAI_API_KEY: "",
  }, () => {
    assertThrowsMessage(
      () => buildProviderFromEnv(),
      "OPENAI_API_KEY is required for openai provider",
    );
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

Deno.test("OpenAIOrchestratorProvider retries once with compact snapshot on incomplete response", () => {
  const provider = new OpenAIOrchestratorProvider({
    apiKey: "dummy-key",
    model: "gpt-5-mini",
    inputTokenBudget: 2000,
    outputTokenBudget: 800,
  });

  const validDecision = {
    decisions: [],
    task_updates: [],
    messages: [],
    stop: { should_stop: false, reason_short: "" },
    meta: {
      provider: "openai",
      model: "gpt-5-mini",
      token_budget: { input: 2000, output: 800 },
      elapsed_ms: 1,
    },
  };

  const responses: Array<Record<string, unknown>> = [
    { status: "incomplete", output: [] },
    { status: "completed", output_text: JSON.stringify(validDecision) },
  ];
  const payloads: Array<Record<string, unknown>> = [];
  const stub = provider as unknown as {
    invokeResponsesApi: (payload: Record<string, unknown>) => Record<string, unknown>;
  };
  stub.invokeResponsesApi = (payload: Record<string, unknown>) => {
    payloads.push(payload);
    const next = responses.shift();
    if (!next) {
      throw new Error("unexpected extra request");
    }
    return next;
  };

  const result = provider.run({ tasks: [{ id: "T-1", status: "pending" }] });
  assertEqual(payloads.length, 2, "should retry once");
  const secondInput = String(payloads[1]?.input ?? "");
  assert(
    secondInput.includes('"retry_compaction":true'),
    "second request should use retry_compaction snapshot",
  );
  assertEqual(result.stop.should_stop, false, "result should be validated");
});

Deno.test("OpenAIOrchestratorProvider does not retry on non-incomplete invalid json", () => {
  const provider = new OpenAIOrchestratorProvider({
    apiKey: "dummy-key",
    model: "gpt-5-mini",
    inputTokenBudget: 2000,
    outputTokenBudget: 800,
  });

  const payloads: Array<Record<string, unknown>> = [];
  const stub = provider as unknown as {
    invokeResponsesApi: (payload: Record<string, unknown>) => Record<string, unknown>;
  };
  stub.invokeResponsesApi = (payload: Record<string, unknown>) => {
    payloads.push(payload);
    return {
      status: "completed",
      output_text: "not-json",
    };
  };

  let thrown: unknown = null;
  try {
    provider.run({ tasks: [{ id: "T-1", status: "pending" }] });
  } catch (error) {
    thrown = error;
  }
  assert(thrown instanceof DecisionValidationError, "should throw DecisionValidationError");
  assertEqual(payloads.length, 1, "should not retry when status is not incomplete");
});

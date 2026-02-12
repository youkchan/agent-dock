import {
  collectSpecContextInteractive,
  normalizeChangeId,
} from "./preprocess.ts";

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

function createPromptIo(
  answers: Array<string | null>,
  interactive = true,
): {
  io: {
    prompt(message: string): string | null;
    isInteractiveTerminal(): boolean;
  };
} {
  const queue = [...answers];
  return {
    io: {
      prompt(_message: string): string | null {
        return queue.length > 0 ? queue.shift() ?? null : null;
      },
      isInteractiveTerminal(): boolean {
        return interactive;
      },
    },
  };
}

Deno.test("normalizeChangeId accepts kebab-case and trims", () => {
  const normalized = normalizeChangeId("  add-spec-creator  ");
  if (normalized !== "add-spec-creator") {
    throw new Error(`unexpected change id: ${normalized}`);
  }
});

Deno.test("normalizeChangeId rejects invalid format", () => {
  assertThrowsMessage(
    () => normalizeChangeId("Add Spec Creator"),
    "kebab-case",
  );
});

Deno.test("collectSpecContextInteractive collects required inputs", () => {
  const driver = createPromptIo([
    "要件本文",
    "ja",
    "yes",
  ]);

  const result = collectSpecContextInteractive({
    changeId: "add-spec-creator",
    io: driver.io,
  });

  if (result.change_id !== "add-spec-creator") {
    throw new Error("change_id mismatch");
  }
  if (result.spec_context.language !== "ja") {
    throw new Error("language mismatch");
  }
  if (
    JSON.stringify(result.spec_context.persona_policy.active_personas) !==
      JSON.stringify(["spec-planner", "spec-reviewer", "spec-code-creator"])
  ) {
    throw new Error("persona_policy mismatch");
  }
  if (
    JSON.stringify(result.task_config.tasks.map((task) => task.id)) !==
      JSON.stringify(["1.1", "1.2", "1.3", "1.4", "1.5", "1.6", "1.7"])
  ) {
    throw new Error("task_config ids mismatch");
  }
  if (
    !result.task_config.tasks[0].description.includes("spec_context:")
  ) {
    throw new Error("spec_context should be injected to task descriptions");
  }
  if (result.task_config.meta.source_change_id !== "add-spec-creator") {
    throw new Error("meta.source_change_id mismatch");
  }
});

Deno.test("collectSpecContextInteractive fails closed when non-interactive", () => {
  const driver = createPromptIo([], false);
  assertThrowsMessage(
    () =>
      collectSpecContextInteractive({
        changeId: "add-spec-creator",
        io: driver.io,
      }),
    "interactive TTY",
  );
});

Deno.test("collectSpecContextInteractive fails closed when required input missing", () => {
  const driver = createPromptIo([
    "",
    "ja",
    "yes",
  ]);

  assertThrowsMessage(
    () =>
      collectSpecContextInteractive({
        changeId: "add-spec-creator",
        io: driver.io,
      }),
    "is required",
  );
});

Deno.test("collectSpecContextInteractive fails closed for invalid language", () => {
  const driver = createPromptIo([
    "要件",
    "fr",
  ]);

  assertThrowsMessage(
    () =>
      collectSpecContextInteractive({
        changeId: "add-spec-creator",
        io: driver.io,
      }),
    "language must be",
  );
});

Deno.test("collectSpecContextInteractive fails closed when confirmation is denied", () => {
  const driver = createPromptIo([
    "要件",
    "en",
    "no",
  ]);

  assertThrowsMessage(
    () =>
      collectSpecContextInteractive({
        changeId: "add-spec-creator",
        io: driver.io,
      }),
    "aborted",
  );
});

Deno.test("collectSpecContextInteractive proposes change_id and accepts Enter", () => {
  const driver = createPromptIo([
    "Add Spec Creator Mode",
    "en",
    "",
    "yes",
  ]);

  const result = collectSpecContextInteractive({
    io: driver.io,
    proposeChangeId: () => "add-spec-creator-mode",
  });

  if (result.change_id !== "add-spec-creator-mode") {
    throw new Error(`unexpected change_id: ${result.change_id}`);
  }
});

Deno.test("collectSpecContextInteractive allows overriding proposed change_id", () => {
  const driver = createPromptIo([
    "Add Spec Creator Mode",
    "en",
    "add-custom-change-id",
    "yes",
  ]);

  const result = collectSpecContextInteractive({
    io: driver.io,
    proposeChangeId: () => "add-spec-creator-mode",
  });

  if (result.change_id !== "add-custom-change-id") {
    throw new Error(`unexpected change_id: ${result.change_id}`);
  }
});

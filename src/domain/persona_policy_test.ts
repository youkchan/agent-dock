import {
  normalizePersonaDefaults,
  normalizeTaskPersonaPolicy,
} from "./persona_policy.ts";

function assertDeepEqual(actual: unknown, expected: unknown): void {
  const actualText = JSON.stringify(actual);
  const expectedText = JSON.stringify(expected);
  if (actualText !== expectedText) {
    throw new Error(`expected ${expectedText}, got ${actualText}`);
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
    throw new Error(`expected "${thrown.message}" to include "${messagePart}"`);
  }
}

Deno.test("normalizePersonaDefaults normalizes phase order and policy", () => {
  const normalized = normalizePersonaDefaults(
    {
      phase_order: ["implement", "review", "review"],
      phase_policies: {
        review: {
          executor_personas: ["code-reviewer", "code-reviewer"],
          active_personas: ["code-reviewer"],
        },
      },
    },
    {
      sourceLabel: "inline",
      knownPersonaIds: new Set([
        "implementer",
        "code-reviewer",
        "spec-checker",
      ]),
    },
  );

  assertDeepEqual(normalized, {
    phase_order: ["implement", "review"],
    phase_policies: {
      review: {
        active_personas: ["code-reviewer"],
        executor_personas: ["code-reviewer"],
      },
    },
  });
});

Deno.test("normalizePersonaDefaults rejects unknown persona references", () => {
  assertThrowsMessage(
    () =>
      normalizePersonaDefaults(
        {
          phase_policies: {
            implement: {
              active_personas: ["missing"],
            },
          },
        },
        {
          sourceLabel: "inline",
          knownPersonaIds: new Set(["implementer"]),
        },
      ),
    "references unknown persona: missing",
  );
});

Deno.test("normalizeTaskPersonaPolicy normalizes disable_personas and phase_overrides", () => {
  const normalized = normalizeTaskPersonaPolicy(
    {
      disable_personas: ["spec-checker", "spec-checker"],
      phase_overrides: {
        review: {
          executor_personas: ["code-reviewer"],
          state_transition_personas: ["code-reviewer"],
        },
      },
    },
    {
      sourceLabel: "inline",
      taskId: "1.1",
      knownPersonaIds: new Set(["code-reviewer", "spec-checker"]),
    },
  );

  assertDeepEqual(normalized, {
    disable_personas: ["spec-checker"],
    phase_overrides: {
      review: {
        executor_personas: ["code-reviewer"],
        state_transition_personas: ["code-reviewer"],
      },
    },
  });
});

Deno.test("normalizeTaskPersonaPolicy rejects unknown keys", () => {
  assertThrowsMessage(
    () =>
      normalizeTaskPersonaPolicy(
        { unexpected: true },
        {
          sourceLabel: "inline",
          taskId: "1.1",
          knownPersonaIds: new Set(["implementer"]),
        },
      ),
    "persona_policy has unknown keys: unexpected",
  );
});

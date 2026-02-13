import {
  defaultPersonas,
  loadPersonas,
  loadPersonasFromPayload,
  resetDefaultPersonasCacheForTest,
  setDefaultPersonasDirForTest,
} from "./catalog.ts";

const REAL_DEFAULT_DIR = new URL(
  "../../../personas/default/",
  import.meta.url,
);

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

function withDefaultPersonaDir(path: URL, fn: () => void): void {
  setDefaultPersonasDirForTest(path);
  resetDefaultPersonasCacheForTest();
  try {
    fn();
  } finally {
    setDefaultPersonasDirForTest(REAL_DEFAULT_DIR);
    resetDefaultPersonasCacheForTest();
  }
}

Deno.test("defaultPersonas loads built-in default persona files", () => {
  withDefaultPersonaDir(REAL_DEFAULT_DIR, () => {
    const personas = defaultPersonas();
    assertDeepEqual(
      personas.map((persona) => persona.id),
      ["implementer", "code-reviewer", "spec-checker", "test-owner"],
    );
  });
});

Deno.test("loadPersonas fully overrides defaults for same id", () => {
  withDefaultPersonaDir(REAL_DEFAULT_DIR, () => {
    const personas = loadPersonas(
      [
        {
          id: "implementer",
          role: "custom",
          focus: "project override",
          can_block: true,
          enabled: false,
        },
      ],
      "inline",
    );
    const byId = new Map(personas.map((persona) => [persona.id, persona]));
    const implementer = byId.get("implementer");
    if (!implementer) {
      throw new Error("implementer should exist");
    }
    if (implementer.role !== "custom") {
      throw new Error("implementer.role should be custom");
    }
    if (implementer.execution !== null) {
      throw new Error(
        "implementer.execution should be null after full override",
      );
    }
  });
});

Deno.test("loadPersonas rejects duplicate persona ids", () => {
  assertThrowsMessage(
    () =>
      loadPersonas(
        [
          {
            id: "custom-a",
            role: "custom",
            focus: "first",
            can_block: false,
            enabled: true,
          },
          {
            id: "custom-a",
            role: "custom",
            focus: "second",
            can_block: false,
            enabled: true,
          },
        ],
        "inline",
      ),
    "duplicate persona id(s): custom-a",
  );
});

Deno.test("loadPersonasFromPayload rejects invalid execution timeout", () => {
  assertThrowsMessage(
    () =>
      loadPersonasFromPayload(
        {
          personas: [
            {
              id: "implementer",
              role: "implementer",
              focus: "implementation",
              can_block: false,
              enabled: true,
              execution: {
                enabled: true,
                command_ref: "default",
                sandbox: "workspace-write",
                timeout_sec: "600",
              },
            },
          ],
        },
        "inline",
      ),
    "execution.timeout_sec must be a positive integer",
  );
});

Deno.test("defaultPersonas fails when a required default file is missing", () => {
  const tempDir = Deno.makeTempDirSync();
  try {
    Deno.writeTextFileSync(
      `${tempDir}/implementer.yaml`,
      [
        "id: implementer",
        "role: implementer",
        "focus: implement",
        "can_block: false",
        "enabled: true",
      ].join("\n"),
    );
    Deno.writeTextFileSync(
      `${tempDir}/code-reviewer.yaml`,
      [
        "id: code-reviewer",
        "role: reviewer",
        "focus: review",
        "can_block: false",
        "enabled: true",
      ].join("\n"),
    );
    Deno.writeTextFileSync(
      `${tempDir}/spec-checker.yaml`,
      [
        "id: spec-checker",
        "role: spec_guard",
        "focus: spec",
        "can_block: false",
        "enabled: true",
      ].join("\n"),
    );

    withDefaultPersonaDir(new URL(`file://${tempDir}/`), () => {
      assertThrowsMessage(
        () => defaultPersonas(),
        "missing default persona file(s): test-owner",
      );
    });
  } finally {
    Deno.removeSync(tempDir, { recursive: true });
  }
});

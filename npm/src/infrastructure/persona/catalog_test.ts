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

Deno.test("loadPersonas merges payload and --persona-dir with overriding by id and append for new ids", () => {
  withDefaultPersonaDir(REAL_DEFAULT_DIR, () => {
    const personas = loadPersonas(
      [
        {
          id: "implementer",
          role: "custom",
          focus: "payload override",
          can_block: true,
          enabled: false,
        },
        {
          id: "custom-a",
          role: "custom",
          focus: "payload add",
          can_block: false,
          enabled: true,
        },
      ],
      "payload",
      [
        {
          id: "implementer",
          role: "implementer",
          focus: "dir override",
          can_block: false,
          enabled: true,
        },
        {
          id: "custom-b",
          role: "custom",
          focus: "dir add",
          can_block: true,
          enabled: false,
        },
      ],
    );

    const byId = new Map(personas.map((persona) => [persona.id, persona]));
    const implementer = byId.get("implementer");
    if (!implementer) {
      throw new Error("implementer should exist");
    }
    if (implementer.focus !== "dir override") {
      throw new Error("implementer.focus should use --persona-dir value");
    }

    if (!byId.has("custom-a")) {
      throw new Error("custom-a should be preserved from payload");
    }
    if (!byId.has("custom-b")) {
      throw new Error("custom-b should be added from --persona-dir");
    }
    if (personas[0]?.id !== "implementer") {
      throw new Error("implementer should remain first default position");
    }
    if (personas[4]?.id !== "custom-a") {
      throw new Error("payload custom-a should come before dir custom-b");
    }
    if (personas[5]?.id !== "custom-b") {
      throw new Error("dir custom-b should be appended after payload additions");
    }
  });
});

Deno.test("loadPersonasFromPayload merges payload.personas and --persona-dir", () => {
  withDefaultPersonaDir(REAL_DEFAULT_DIR, () => {
    const payload = {
      personas: [
        {
          id: "implementer",
          role: "custom",
          focus: "payload override",
          can_block: true,
          enabled: false,
        },
        {
          id: "custom-a",
          role: "custom",
          focus: "payload add",
          can_block: false,
          enabled: true,
        },
      ],
    };
    const personas = loadPersonasFromPayload(
      payload,
      "payload",
      [
        {
          id: "implementer",
          role: "implementer",
          focus: "dir override",
          can_block: false,
          enabled: true,
        },
        {
          id: "custom-b",
          role: "custom",
          focus: "dir add",
          can_block: true,
          enabled: false,
        },
      ],
    );

    const byId = new Map(personas.map((persona) => [persona.id, persona]));
    const implementer = byId.get("implementer");
    if (!implementer) {
      throw new Error("implementer should exist");
    }
    if (implementer.focus !== "dir override") {
      throw new Error("implementer.focus should use --persona-dir value");
    }
    if (!byId.has("custom-a")) {
      throw new Error("custom-a should be preserved from payload");
    }
    if (!byId.has("custom-b")) {
      throw new Error("custom-b should be added from --persona-dir");
    }
    if (personas[0]?.id !== "implementer") {
      throw new Error("implementer should remain first default position");
    }
    if (personas[4]?.id !== "custom-a") {
      throw new Error("payload custom-a should come before dir custom-b");
    }
    if (personas[5]?.id !== "custom-b") {
      throw new Error("dir custom-b should be appended after payload additions");
    }
  });
});

Deno.test(
  "loadPersonasFromPayload merges payload.personas and --persona-dir directory",
  () => {
    withDefaultPersonaDir(REAL_DEFAULT_DIR, () => {
      const personaDir = Deno.makeTempDirSync();
      try {
        Deno.mkdirSync(personaDir, { recursive: true });
        Deno.writeTextFileSync(
          `${personaDir}/personas.json`,
          JSON.stringify(
            [
              {
                id: "implementer",
                role: "implementer",
                focus: "dir override",
                can_block: false,
                enabled: true,
              },
              {
                id: "custom-b",
                role: "custom",
                focus: "dir add",
                can_block: true,
                enabled: false,
              },
            ],
            null,
            2,
          ),
        );

        const personas = loadPersonasFromPayload(
          {
            personas: [
              {
                id: "implementer",
                role: "custom",
                focus: "payload override",
                can_block: true,
                enabled: false,
              },
              {
                id: "custom-a",
                role: "custom",
                focus: "payload add",
                can_block: false,
                enabled: true,
              },
            ],
          },
          "payload",
          personaDir,
        );

        const byId = new Map(personas.map((persona) => [persona.id, persona]));
        const implementer = byId.get("implementer");
        if (!implementer) {
          throw new Error("implementer should exist");
        }
        if (implementer.focus !== "dir override") {
          throw new Error("implementer.focus should use persona-dir value");
        }

        if (!byId.has("custom-a")) {
          throw new Error("custom-a should be preserved from payload");
        }
        if (!byId.has("custom-b")) {
          throw new Error("custom-b should be added from persona-dir");
        }
        if (personas[0]?.id !== "implementer") {
          throw new Error("implementer should remain first default position");
        }
        if (personas[4]?.id !== "custom-a") {
          throw new Error("payload custom-a should come before persona-dir custom-b");
        }
        if (personas[5]?.id !== "custom-b") {
          throw new Error("persona-dir custom-b should be appended after payload additions");
        }
      } finally {
        Deno.removeSync(personaDir, { recursive: true });
      }
    });
  },
);

Deno.test(
  "loadPersonasFromPayload reads --persona-dir when path has trailing separator",
  () => {
    withDefaultPersonaDir(REAL_DEFAULT_DIR, () => {
      const payloadDir = Deno.makeTempDirSync();
      const personaDir = `${payloadDir}/`;
      try {
        Deno.mkdirSync(personaDir, { recursive: true });
        Deno.writeTextFileSync(
          `${personaDir}personas.json`,
          JSON.stringify(
            [
              {
                id: "implementer",
                role: "implementer",
                focus: "dir override",
                can_block: false,
                enabled: true,
              },
            ],
            null,
            2,
          ),
        );

        const personas = loadPersonasFromPayload(
          {
            personas: [
              {
                id: "implementer",
                role: "custom",
                focus: "payload override",
                can_block: true,
                enabled: false,
              },
            ],
          },
          "payload",
          personaDir,
        );

        const byId = new Map(personas.map((persona) => [persona.id, persona]));
        const implementer = byId.get("implementer");
        if (!implementer) {
          throw new Error("implementer should exist");
        }
        if (implementer.focus !== "dir override") {
          throw new Error("implementer.focus should use persona-dir value");
        }
      } finally {
        Deno.removeSync(payloadDir, { recursive: true });
      }
    });
  },
);

Deno.test(
  "loadPersonasFromPayload rejects non-array persona-dir file",
  () => {
    const personaDir = Deno.makeTempDirSync();
    try {
      Deno.mkdirSync(personaDir, { recursive: true });
      Deno.writeTextFileSync(
        `${personaDir}/personas.json`,
        JSON.stringify({ id: "implementer" }, null, 2),
      );

      assertThrowsMessage(
        () =>
          loadPersonasFromPayload(
            {
              personas: [
                {
                  id: "implementer",
                  role: "custom",
                  focus: "payload override",
                  can_block: true,
                  enabled: false,
                },
              ],
            },
            "payload",
            personaDir,
          ),
        "personas must be a list",
      );
    } finally {
      Deno.removeSync(personaDir, { recursive: true });
    }
  },
);

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

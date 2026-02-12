import { compileChangeToConfig } from "./compiler.ts";
import {
  DEFAULT_TEMPLATE_LANG,
  getOpenSpecTasksTemplate,
  SUPPORTED_TEMPLATE_LANGS,
} from "./template.ts";

function assertThrowsMessage(fn: () => void, text: string): void {
  let thrown: unknown = null;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }
  if (!(thrown instanceof Error)) {
    throw new Error("expected function to throw Error");
  }
  if (!thrown.message.includes(text)) {
    throw new Error(`expected '${thrown.message}' to include '${text}'`);
  }
}

function withTempDir(fn: (root: string) => void): void {
  const root = Deno.makeTempDirSync();
  try {
    fn(root);
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
}

Deno.test("template constants expose supported languages", () => {
  if (DEFAULT_TEMPLATE_LANG !== "ja") {
    throw new Error("default template language must be ja");
  }
  const joined = SUPPORTED_TEMPLATE_LANGS.join(",");
  if (joined !== "ja,en") {
    throw new Error("supported template languages must be ja,en");
  }
});

Deno.test("ja template contains required fixed lines", () => {
  const template = getOpenSpecTasksTemplate("ja");
  const required = [
    "persona_defaults.phase_order",
    '- personas: [{"id":"implementer"',
    "フェーズ担当",
    "テンプレート利用ルール",
    "1行JSON",
    "実行主体は `teammate-*`",
    "## 1. 実装タスク",
    "実施項目（検証を含む）",
    "## 2. 人間向けメモ（コンパイラ非対象）",
  ];
  for (const item of required) {
    if (!template.includes(item)) {
      throw new Error(`missing required line: ${item}`);
    }
  }
});

Deno.test("en template contains required fixed lines", () => {
  const template = getOpenSpecTasksTemplate("en");
  const required = [
    "persona_defaults.phase_order",
    '- personas: [{"id":"implementer"',
    "phase assignments",
    "Template Usage Rules",
    "one-line JSON",
    "execution falls back to `teammate-*`",
    "## 1. Implementation",
    "every executable item (including verification)",
    "## 2. Human Notes (non-compiled)",
  ];
  for (const item of required) {
    if (!template.includes(item)) {
      throw new Error(`missing required line: ${item}`);
    }
  }
});

Deno.test("template output is compile-compatible", () => {
  for (const lang of ["ja", "en"] as const) {
    withTempDir((root) => {
      const changeId = `add-template-${lang}`;
      const changeDir = `${root}/openspec/changes/${changeId}`;
      Deno.mkdirSync(changeDir, { recursive: true });
      Deno.writeTextFileSync(
        `${changeDir}/tasks.md`,
        getOpenSpecTasksTemplate(lang),
      );

      const compiled = compileChangeToConfig(changeId, {
        openspecRoot: `${root}/openspec`,
        overridesRoot: `${root}/task_configs/overrides`,
      });
      const tasks = compiled.tasks as Array<Record<string, unknown>>;
      const ids = tasks.map((task) => task.id);
      if (JSON.stringify(ids) !== JSON.stringify(["1.1", "1.2"])) {
        throw new Error(`template ${lang} should compile into ids 1.1,1.2`);
      }
    });
  }
});

Deno.test("template rejects unsupported language", () => {
  assertThrowsMessage(
    () => getOpenSpecTasksTemplate("fr"),
    "unsupported template language: fr (allowed: ja, en)",
  );
});

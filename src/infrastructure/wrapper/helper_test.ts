import {
  buildPrompt,
  collectDotenvSnapshot,
  containsDotenvReference,
  extractResultBlock,
  sanitizePromptText,
  verifyDotenvSnapshotUnchanged,
  WrapperHelperError,
} from "./helper.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function withTempDir(run: (root: string) => void): void {
  const root = Deno.makeTempDirSync();
  try {
    run(root);
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
}

function makeEnv(
  vars: Record<string, string>,
): (name: string, fallback: string) => string {
  return (name: string, fallback: string): string => {
    return (vars[name] ?? fallback).trim();
  };
}

Deno.test("containsDotenvReference detects .env path tokens", () => {
  assert(containsDotenvReference(".env.local"), "expected .env.local to match");
  assert(
    containsDotenvReference("docs/.env.sample"),
    "expected nested .env path to match",
  );
  assert(
    !containsDotenvReference("README.md"),
    "README.md should not match",
  );
});

Deno.test("sanitizePromptText removes control chars and normalizes spaces", () => {
  const sanitized = sanitizePromptText("A\tB\nC\r\u0001D");
  assert(sanitized === "A B C D", `unexpected sanitized text: ${sanitized}`);
});

Deno.test("buildPrompt renders execute template and truncates when too long", () => {
  const payload = {
    mode: "execute",
    teammate_id: "tm-1",
    task: {
      id: "2.8",
      title: "title",
      description: "x".repeat(3000),
      target_paths: ["codex_wrapper.sh"],
      depends_on: ["2.5"],
      requires_plan: false,
      progress_log: [
        {
          timestamp: 1770865151.067,
          source: "system",
          text: "execution started persona=implementer phase=implement",
        },
      ],
    },
  };
  const prompt = buildPrompt(
    payload,
    makeEnv({
      CODEX_DENY_DOTENV: "1",
      CODEX_PROMPT_MAX_CHARS: "2000",
    }),
  );
  assert(
    prompt.includes("You are implementation teammate tm-1."),
    "missing header",
  );
  assert(
    prompt.endsWith("[truncated by codex_wrapper]"),
    "expected truncation marker",
  );
});

Deno.test("buildPrompt keeps prompt bool text for requires_plan", () => {
  const payload = {
    mode: "execute",
    teammate_id: "tm-1",
    task: {
      id: "2.8",
      title: "title",
      description: "desc",
      target_paths: ["codex_wrapper.sh"],
      depends_on: ["2.5"],
      requires_plan: false,
      progress_log: [],
    },
  };
  const prompt = buildPrompt(payload, makeEnv({ CODEX_DENY_DOTENV: "1" }));
  assert(
    prompt.includes("requires_plan: False"),
    "requires_plan bool format changed",
  );
});

Deno.test("buildPrompt rejects .env references when deny rule is enabled", () => {
  const payload = {
    mode: "execute",
    teammate_id: "tm-1",
    task: {
      id: "2.8",
      title: "title",
      description: "touch .env.local",
      target_paths: [],
      depends_on: [],
      requires_plan: false,
      progress_log: [],
    },
  };
  let thrown: unknown = null;
  try {
    buildPrompt(payload, makeEnv({ CODEX_DENY_DOTENV: "1" }));
  } catch (error) {
    thrown = error;
  }
  assert(thrown instanceof WrapperHelperError, "expected WrapperHelperError");
  assert(thrown.exitCode === 3, "expected deny violation exit code 3");
});

Deno.test("collectDotenvSnapshot and verifyDotenvSnapshotUnchanged detect changes", () => {
  withTempDir((root) => {
    Deno.mkdirSync(`${root}/nested`, { recursive: true });
    Deno.writeTextFileSync(`${root}/nested/.env.local`, "A=1\n");
    Deno.writeTextFileSync(`${root}/nested/readme.txt`, "ok\n");

    const snapshot = collectDotenvSnapshot(root);
    assert(
      Object.keys(snapshot).length === 1 &&
        snapshot["nested/.env.local"] !== undefined,
      "snapshot should include only .env* files",
    );

    const snapshotPath = `${root}/snapshot.json`;
    Deno.writeTextFileSync(snapshotPath, JSON.stringify(snapshot));
    verifyDotenvSnapshotUnchanged(root, snapshotPath);

    Deno.writeTextFileSync(`${root}/nested/.env.local`, "A=2\n");

    let thrown: unknown = null;
    try {
      verifyDotenvSnapshotUnchanged(root, snapshotPath);
    } catch (error) {
      thrown = error;
    }
    assert(thrown instanceof WrapperHelperError, "expected WrapperHelperError");
    assert(thrown.exitCode === 4, "expected modified snapshot exit code 4");
    assert(
      thrown.message.includes("changed=nested/.env.local"),
      `unexpected message: ${thrown.message}`,
    );
  });
});

Deno.test("extractResultBlock reads last 4-line result block", () => {
  const raw = [
    "SUMMARY: old",
    "RESULT: blocked",
    "RESULT: completed",
    "SUMMARY: done",
    "CHANGED_FILES: a.ts",
    "CHECKS: deno test",
  ].join("\n");
  const extracted = extractResultBlock(raw);
  assert(extracted !== null, "expected extracted block");
  assert(
    extracted ===
      [
        "RESULT: completed",
        "SUMMARY: done",
        "CHANGED_FILES: a.ts",
        "CHECKS: deno test",
      ].join("\n"),
    `unexpected extracted block: ${extracted}`,
  );
});

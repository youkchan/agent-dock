import {
  buildPrompt,
  collectDotenvSnapshot,
  containsDotenvReference,
  extractResultBlock,
  extractResultToFile,
  runCli,
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

function withEnv(
  name: string,
  value: string | undefined,
  run: () => void,
): void {
  const original = Deno.env.get(name);
  if (value === undefined) {
    Deno.env.delete(name);
  } else {
    Deno.env.set(name, value);
  }
  try {
    run();
  } finally {
    if (original === undefined) {
      Deno.env.delete(name);
    } else {
      Deno.env.set(name, original);
    }
  }
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
    prompt.includes("[truncated by codex_wrapper]"),
    "expected truncation marker",
  );
  assert(
    prompt.includes("Final output must be exactly these 5 lines:"),
    "truncation must preserve output contract header",
  );
  assert(
    prompt.endsWith("JUDGMENT: pass|changes_required|blocked"),
    "truncation must preserve contract tail",
  );
  assert(
    prompt.length <= 2000,
    `prompt length exceeded cap: ${prompt.length}`,
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

Deno.test("buildPrompt includes related_paths and editable_paths scope", () => {
  const payload = {
    mode: "execute",
    teammate_id: "tm-1",
    task: {
      id: "2.8",
      title: "title",
      description: "desc",
      target_paths: ["src/main.ts"],
      related_paths: ["src/main_test.ts"],
      depends_on: [],
      requires_plan: false,
      progress_log: [],
    },
  };
  const prompt = buildPrompt(payload, makeEnv({ CODEX_DENY_DOTENV: "1" }));
  assert(
    prompt.includes("related_paths: src/main_test.ts"),
    "prompt should include related_paths",
  );
  assert(
    prompt.includes("editable_paths: src/main.ts, src/main_test.ts"),
    "prompt should include editable_paths",
  );
  assert(
    prompt.includes(
      "Treat editable_paths (target_paths + related_paths) as implementation hints, not hard limits",
    ),
    "prompt should include editable scope guidance",
  );
});

Deno.test("buildPrompt injects concrete openspec validate command when change id is provided", () => {
  const payload = {
    mode: "execute",
    teammate_id: "tm-1",
    task: {
      id: "1.2",
      title: "title",
      description: "desc",
      target_paths: ["src/a.ts"],
      depends_on: [],
      requires_plan: false,
      progress_log: [],
    },
  };
  const prompt = buildPrompt(
    payload,
    makeEnv({
      CODEX_DENY_DOTENV: "1",
      OPENSPEC_CHANGE_ID: " add-persona-dir-and-ordered-multi-judgment-phases ",
    }),
  );
  assert(
    prompt.includes(
      "OpenSpec change_id: add-persona-dir-and-ordered-multi-judgment-phases",
    ),
    "prompt should include concrete openspec change_id",
  );
  assert(
    prompt.includes(
      "`openspec validate add-persona-dir-and-ordered-multi-judgment-phases --strict`",
    ),
    "prompt should include concrete openspec validate command",
  );
  assert(
    prompt.includes("Never use task_id as openspec validate target"),
    "prompt should forbid task_id-based openspec validate",
  );
});

Deno.test("buildPrompt includes quality issues when provided", () => {
  const payload = {
    mode: "execute",
    teammate_id: "tm-1",
    task: {
      id: "1.6",
      title: "review",
      description: "fix semantic issues",
      target_paths: ["openspec/changes/foo/spec.md"],
      depends_on: [],
      requires_plan: false,
      progress_log: [],
      persona_policy: {
        phase_order: ["implement", "review"],
      },
      current_phase_index: 1,
    },
  };
  const prompt = buildPrompt(
    payload,
    makeEnv({
      CODEX_DENY_DOTENV: "1",
      SPEC_CREATOR_QUALITY_ISSUES:
        "spec.md:7:stage_contract:run --config must not require compile error",
      SPEC_CREATOR_QUALITY_TARGET_FILE: "openspec/changes/foo/tasks.md",
    }),
  );
  assert(
    prompt.includes("quality_issues:"),
    "prompt should include quality issues section",
  );
  assert(
    prompt.includes("stage_contract"),
    "prompt should include provided quality issue details",
  );
  assert(
    prompt.includes("quality_target_file: openspec/changes/foo/tasks.md"),
    "prompt should include quality target file",
  );
  assert(
    prompt.includes("edit only quality_target_file"),
    "prompt should include target-only edit constraint",
  );
});

Deno.test("golden contract has zero diff for fixed payload, prompt, stream and result", () => {
  const payload = {
    mode: "execute",
    teammate_id: "tm-1",
    task: {
      id: "1.7",
      title: "add golden parity check",
      description: "Verify fixed payload/prompt/stream/result block parity",
      target_paths: [
        "src/infrastructure/wrapper/helper.ts",
        "src/infrastructure/wrapper/helper_test.ts",
      ],
      depends_on: ["1.6"],
      requires_plan: false,
      progress_log: [
        {
          timestamp: 1771247093.362,
          source: "system",
          text: "execution started persona=implementer phase=implement",
        },
      ],
    },
  };

  const shellExpectedPrompt = [
    "You are implementation teammate tm-1.",
    "Execute the task below.",
    "",
    "task_id: 1.7",
    "title: add golden parity check",
    "description: Verify fixed payload/prompt/stream/result block parity",
    "target_paths: src/infrastructure/wrapper/helper.ts, src/infrastructure/wrapper/helper_test.ts",
    "related_paths: (none)",
    "editable_paths: src/infrastructure/wrapper/helper.ts, src/infrastructure/wrapper/helper_test.ts",
    "depends_on: 1.6",
    "requires_plan: False",
    "existing_progress_log_count: 1",
    "existing_progress_log_recent:",
    "- [1771247093.362] system: execution started persona=implementer phase=implement",
    "",
    "Constraints:",
    "- Treat editable_paths (target_paths + related_paths) as implementation hints, not hard limits",
    "- Do not read/reference/edit .env or .env.*",
    "- Run required local checks",
    "- OpenSpec change_id: add-codex-wrapper-step1-contract-first-golden-compat",
    "- For OpenSpec validation, use `openspec validate add-codex-wrapper-step1-contract-first-golden-compat --strict` only",
    "- Never use task_id as openspec validate target",
    "- Do not use `agent-dock openspec ...` or `./node_modules/.bin/openspec ...`",
    "- For `deno test`, use `--allow-read --allow-write --allow-env --allow-run` by default",
    "- If failed, provide a short root cause",
    "",
    "",
    "",
    "",
    "Final output must be exactly these 5 lines:",
    "RESULT: completed|blocked",
    "SUMMARY: <=100 chars",
    "CHANGED_FILES: comma-separated",
    "CHECKS: executed check commands",
    "JUDGMENT: pass|changes_required|blocked",
  ].join("\n");

  const shellStreamLog = [
    "setup",
    "RESULT: completed",
    "SUMMARY: Golden regression baseline reached",
    "CHANGED_FILES: src/infrastructure/wrapper/helper_test.ts, ",
    "CHECKS: deno test --allow-read --allow-write --allow-env --allow-run src/infrastructure/wrapper/helper_test.ts; openspec validate add-codex-wrapper-step1-contract-first-golden-compat --strict",
    "JUDGMENT: pass",
    "done",
  ].join("\n");
  const shellExpectedResult = [
    "RESULT: completed",
    "SUMMARY: Golden regression baseline reached",
    "CHANGED_FILES: src/infrastructure/wrapper/helper_test.ts",
    "CHECKS: deno test --allow-read --allow-write --allow-env --allow-run src/infrastructure/wrapper/helper_test.ts; openspec validate add-codex-wrapper-step1-contract-first-golden-compat --strict",
    "JUDGMENT: pass",
  ].join("\n");

  const actualPrompt = buildPrompt(
    payload,
    makeEnv({
      CODEX_DENY_DOTENV: "1",
      OPENSPEC_CHANGE_ID:
        " add-codex-wrapper-step1-contract-first-golden-compat ",
      CODEX_PROMPT_MAX_CHARS: "4000",
    }),
  );
  const actualResultBlock = extractResultBlock(shellStreamLog);
  const differences: string[] = [];

  if (actualPrompt !== shellExpectedPrompt) {
    differences.push("prompt");
  }
  if (actualResultBlock !== shellExpectedResult) {
    differences.push("result block");
  }

  withTempDir((root) => {
    const streamPath = `${root}/stream.log`;
    const outputPath = `${root}/result.log`;
    Deno.writeTextFileSync(streamPath, shellStreamLog);
    extractResultToFile(streamPath, outputPath);
    const actualFileResult = Deno.readTextFileSync(outputPath);
    if (actualFileResult !== shellExpectedResult) {
      differences.push("file result");
    }

    const stderrLines: string[] = [];
    const originalError = console.error;
    try {
      console.error = (...args: unknown[]) => {
        stderrLines.push(args.map((arg) => String(arg)).join(" "));
      };
      withEnv("STREAM_PATH", streamPath, () => {
        withEnv("OUTPUT_PATH", outputPath, () => {
          const actualExitCode = runCli(["extract-result"]);
          if (actualExitCode !== 0) {
            differences.push("exit code");
          }
        });
      });
    } finally {
      console.error = originalError;
    }
    const actualStderr = stderrLines.join("\n").trim();
    if (actualStderr.length > 0) {
      differences.push("stderr");
    }
  });

  assert(
    differences.length === 0,
    `golden comparison expected zero diff but found: ${differences.join(", ")}`,
  );
});

Deno.test("buildPrompt requires CHANGED_FILES to be (none) for non-implement phases", () => {
  const payload = {
    mode: "execute",
    teammate_id: "tm-1",
    task: {
      id: "2.9",
      title: "review docs",
      description: "inspect docs",
      target_paths: ["README.md"],
      depends_on: [],
      requires_plan: false,
      progress_log: [],
      current_phase: "review",
    },
  };
  const prompt = buildPrompt(payload, makeEnv({ CODEX_DENY_DOTENV: "1" }));
  assert(
    prompt.includes("In non-implement phases, CHANGED_FILES must be (none)"),
    "prompt should require no changed files for non-implement phase",
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

Deno.test("extractResultBlock correctly normalizes normal result block", () => {
  const raw = [
    "some log lines",
    "RESULT: completed",
    "SUMMARY: done",
    "CHANGED_FILES: src/a.ts,src/b.ts,   ",
    "CHECKS: deno test",
  ].join("\n");
  const extracted = extractResultBlock(raw);
  assert(extracted !== null, "expected extracted block");
  assert(
    extracted ===
      [
        "RESULT: completed",
        "SUMMARY: done",
        "CHANGED_FILES: src/a.ts, src/b.ts",
        "CHECKS: deno test",
      ].join("\n"),
    `unexpected extracted block: ${extracted}`,
  );
});

Deno.test("extractResultBlock fail-closes when decision phase result misses JUDGMENT", () => {
  const raw = [
    "RESULT: completed",
    "SUMMARY: done",
    "CHANGED_FILES: (none)",
    "CHECKS: deno test",
  ].join("\n");
  const extracted = extractResultBlock(raw, {
    requiresJudgment: true,
  });
  assert(extracted === null, "expected null when JUDGMENT is missing");
});

Deno.test("extractResultBlock ignores stale JUDGMENT outside last result block", () => {
  const raw = [
    "JUDGMENT: pass",
    "RESULT: completed",
    "SUMMARY: done",
    "CHANGED_FILES: (none)",
    "CHECKS: deno test",
  ].join("\n");
  const extracted = extractResultBlock(raw, {
    requiresJudgment: true,
  });
  assert(
    extracted === null,
    "expected null when JUDGMENT is not in the last result block",
  );
});

Deno.test("extractResultBlock keeps normalized JUDGMENT for decision phase", () => {
  const raw = [
    "RESULT: completed",
    "SUMMARY: done",
    "CHANGED_FILES: none",
    "CHECKS: deno test",
    "JUDGMENT: changes-required",
  ].join("\n");
  const extracted = extractResultBlock(raw, {
    requiresJudgment: true,
  });
  assert(extracted !== null, "expected extracted block");
  assert(
    extracted ===
      [
        "RESULT: completed",
        "SUMMARY: done",
        "CHANGED_FILES: (none)",
        "CHECKS: deno test",
        "JUDGMENT: changes_required",
      ].join("\n"),
    `unexpected extracted block: ${extracted}`,
  );
});

Deno.test("extractResultBlock fail-closes when CHECKS includes forbidden openspec command forms", () => {
  const raw = [
    "RESULT: completed",
    "SUMMARY: done",
    "CHANGED_FILES: (none)",
    "CHECKS: deno task check; ./node_modules/.bin/openspec validate add-foo --strict",
  ].join("\n");
  const extracted = extractResultBlock(raw);
  assert(
    extracted === null,
    "expected null when CHECKS includes forbidden openspec command",
  );
});

Deno.test("extractResultToFile fail-closes when JUDGMENT is missing", () => {
  withTempDir((root) => {
    const streamPath = `${root}/stream.log`;
    const outputPath = `${root}/output.log`;
    Deno.writeTextFileSync(
      streamPath,
      [
        "RESULT: completed",
        "SUMMARY: done",
        "CHANGED_FILES: (none)",
        "CHECKS: deno test",
      ].join("\n"),
    );

    let thrown: unknown = null;
    try {
      extractResultToFile(streamPath, outputPath);
    } catch (error) {
      thrown = error;
    }

    assert(thrown instanceof WrapperHelperError, "expected WrapperHelperError");
    assert(thrown.exitCode === 2, "expected missing judgment exit code 2");
    assert(
      thrown.message.includes("result block not found"),
      `unexpected message: ${thrown.message}`,
    );
  });
});

Deno.test("extractResultToFile fail-closes when extract-result block is missing", () => {
  withTempDir((root) => {
    const streamPath = `${root}/stream.log`;
    const outputPath = `${root}/output.log`;
    Deno.writeTextFileSync(
      streamPath,
      [
        "START",
        "SUMMARY: done",
        "CHANGED_FILES: (none)",
        "CHECKS: deno test",
      ].join("\n"),
    );

    let thrown: unknown = null;
    try {
      extractResultToFile(streamPath, outputPath);
    } catch (error) {
      thrown = error;
    }

    assert(thrown instanceof WrapperHelperError, "expected WrapperHelperError");
    assert(thrown.exitCode === 2, "expected missing block exit code 2");
    assert(
      thrown.message.includes("result block not found"),
      `unexpected message: ${thrown.message}`,
    );
  });
});

Deno.test("extractResultToFile fail-closes when stale JUDGMENT is outside last result block", () => {
  withTempDir((root) => {
    const streamPath = `${root}/stream.log`;
    const outputPath = `${root}/output.log`;
    Deno.writeTextFileSync(
      streamPath,
      [
        "JUDGMENT: pass",
        "RESULT: completed",
        "SUMMARY: done",
        "CHANGED_FILES: (none)",
        "CHECKS: deno test",
      ].join("\n"),
    );

    let thrown: unknown = null;
    try {
      extractResultToFile(streamPath, outputPath);
    } catch (error) {
      thrown = error;
    }

    assert(thrown instanceof WrapperHelperError, "expected WrapperHelperError");
    assert(thrown.exitCode === 2, "expected stale line exit code 2");
    assert(
      thrown.message.includes("result block not found"),
      `unexpected message: ${thrown.message}`,
    );
  });
});

Deno.test("extractResultToFile succeeds without RESULT_PHASE env when block is valid", () => {
  withTempDir((root) => {
    const streamPath = `${root}/stream.log`;
    const outputPath = `${root}/output.log`;
    Deno.writeTextFileSync(
      streamPath,
      [
        "RESULT: completed",
        "SUMMARY: done",
        "CHANGED_FILES: (none)",
        "CHECKS: deno test",
        "JUDGMENT: pass",
      ].join("\n"),
    );

    withEnv("RESULT_PHASE", undefined, () => {
      extractResultToFile(streamPath, outputPath);
    });
    const written = Deno.readTextFileSync(outputPath);
    assert(
      written ===
        [
          "RESULT: completed",
          "SUMMARY: done",
          "CHANGED_FILES: (none)",
          "CHECKS: deno test",
          "JUDGMENT: pass",
        ].join("\n"),
      `unexpected result: ${written}`,
    );
  });
});

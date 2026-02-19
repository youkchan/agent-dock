import {
  buildTeammateAdapter,
  collectSpecCreatorApplyManifestForTest,
  defaultTeammateCommand,
  main,
  normalizeSpecCreatorReviewContractCoverageForTest,
  parseTeammatesArg,
  type SpecCreatorArtifactPaths,
} from "./main.ts";
import {
  SubprocessCodexAdapter,
  TemplateTeammateAdapter,
} from "../infrastructure/adapter/mod.ts";
import { getOpenSpecTasksTemplate } from "../infrastructure/openspec/template.ts";

function createIoBuffer(): {
  state: { stdout: string; stderr: string };
  io: { stdout(text: string): void; stderr(text: string): void };
} {
  const state = {
    stdout: "",
    stderr: "",
  };
  return {
    state,
    io: {
      stdout(text: string): void {
        state.stdout += text;
      },
      stderr(text: string): void {
        state.stderr += text;
      },
    },
  };
}

function withTempDir(fn: (root: string) => void): void {
  const root = Deno.makeTempDirSync();
  try {
    fn(root);
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
}

function withTempCwd(fn: (root: string) => void): void {
  withTempDir((root) => {
    const original = Deno.cwd();
    Deno.chdir(root);
    try {
      fn(root);
    } finally {
      Deno.chdir(original);
    }
  });
}

function fileExists(filePath: string): boolean {
  try {
    return Deno.statSync(filePath).isFile;
  } catch {
    return false;
  }
}

function uniqueChangeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function revisedChangeId(changeId: string): string {
  return `${changeId}_revised`;
}

const REVIEW_CONTRACT_IDS = [
  "RC-01",
  "RC-02",
  "RC-03",
  "RC-04",
  "RC-05",
  "RC-06",
  "RC-07",
  "RC-08",
  "RC-09",
  "RC-10",
  "RC-11",
  "RC-12",
] as const;

function hasReviewTraceabilityLine(sectionText: string, id: string): boolean {
  const pattern = new RegExp(
    `${id}\\s*\\|\\s*transport:\\s*.+\\|\\s*reject:\\s*.+\\|\\s*path_test:\\s*.+\\|\\s*reject_test:\\s*.+`,
    "u",
  );
  return pattern.test(sectionText);
}

function withTemporaryChangeDir(changeId: string, fn: () => void): void {
  const dirPath = `openspec/changes/${changeId}`;
  const revisedDirPath = `openspec/changes/${revisedChangeId(changeId)}`;
  Deno.mkdirSync(dirPath, { recursive: true });
  try {
    fn();
  } finally {
    try {
      Deno.removeSync(dirPath, { recursive: true });
    } catch {
      // noop
    }
    try {
      Deno.removeSync(revisedDirPath, { recursive: true });
    } catch {
      // noop
    }
  }
}

function withEnv(name: string, value: string, run: () => void): void {
  const original = Deno.env.get(name);
  Deno.env.set(name, value);
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

function withEnvValue<T>(name: string, value: string, run: () => T): T {
  const original = Deno.env.get(name);
  Deno.env.set(name, value);
  try {
    return run();
  } finally {
    if (original === undefined) {
      Deno.env.delete(name);
    } else {
      Deno.env.set(name, original);
    }
  }
}

function withFakeOpenSpecValidate(
  mode: "fail" | "pass",
  run: () => void,
): void {
  const scriptExit = mode === "pass"
    ? "exit 0"
    : "echo openspec validate failed >&2\nexit 1";
  withTempDir((root) => {
    const commandPath = `${root}/openspec`;
    Deno.writeTextFileSync(
      commandPath,
      [
        "#!/bin/sh",
        'if [ "$1" = "validate" ] && [ "$3" = "--strict" ]; then',
        `  ${scriptExit}`,
        "fi",
        'echo "unexpected openspec args: $*" >&2',
        "exit 2",
      ].join("\n"),
    );
    Deno.chmodSync(commandPath, 0o755);
    withEnvValue("PATH", root, () => run());
  });
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

Deno.test("parseTeammatesArg parses csv and bracket formats", () => {
  const csv = parseTeammatesArg("teammate-a, teammate-b");
  if (JSON.stringify(csv) !== JSON.stringify(["teammate-a", "teammate-b"])) {
    throw new Error("csv teammate parser mismatch");
  }

  const bracket = parseTeammatesArg("[teammate-a, teammate-b]");
  if (
    JSON.stringify(bracket) !== JSON.stringify(["teammate-a", "teammate-b"])
  ) {
    throw new Error("bracket teammate parser mismatch");
  }

  if (parseTeammatesArg("   ") !== null) {
    throw new Error("empty teammates should return null");
  }
});

Deno.test("buildTeammateAdapter returns template adapter", () => {
  const adapter = buildTeammateAdapter({
    teammateAdapter: "template",
    teammateCommand: "",
    planCommand: "",
    executeCommand: "",
    commandTimeout: 120,
  });
  if (!(adapter instanceof TemplateTeammateAdapter)) {
    throw new Error("expected TemplateTeammateAdapter");
  }
});

Deno.test("buildTeammateAdapter builds subprocess adapter from shared command", () => {
  const adapter = buildTeammateAdapter({
    teammateAdapter: "subprocess",
    teammateCommand: "echo codex",
    planCommand: "",
    executeCommand: "",
    commandTimeout: 45,
  });

  if (!(adapter instanceof SubprocessCodexAdapter)) {
    throw new Error("expected SubprocessCodexAdapter");
  }
  if (
    JSON.stringify(adapter.planCommand) !== JSON.stringify(["echo", "codex"])
  ) {
    throw new Error("plan command mismatch");
  }
  if (
    JSON.stringify(adapter.executeCommand) !==
      JSON.stringify(["echo", "codex"])
  ) {
    throw new Error("execute command mismatch");
  }
  if (adapter.timeoutSeconds !== 45) {
    throw new Error(`expected timeout 45, got ${adapter.timeoutSeconds}`);
  }
});

Deno.test("buildTeammateAdapter requires default ts runtime when commands are missing", () => {
  withTempDir((root) => {
    const fakeExec = `${root}/bin/agent-dock`;
    Deno.mkdirSync(`${root}/bin`, { recursive: true });
    Deno.writeTextFileSync(fakeExec, "#!/usr/bin/env bash\n");

    assertThrowsMessage(
      () =>
        buildTeammateAdapter(
          {
            teammateAdapter: "subprocess",
            teammateCommand: "",
            planCommand: "",
            executeCommand: "",
            commandTimeout: 120,
          },
          fakeExec,
        ),
      "Default ts wrapper was not found",
    );
  });
});

Deno.test("buildTeammateAdapter uses runtime next to executable by default", () => {
  withTempDir((root) => {
    const fakeBin = `${root}/bin`;
    Deno.mkdirSync(fakeBin, { recursive: true });
    const fakeExec = `${fakeBin}/agent-dock`;
    const runtimePath = `${fakeBin}/src/infrastructure/wrapper/runtime.ts`;

    Deno.writeTextFileSync(fakeExec, "#!/usr/bin/env bash\n");
    Deno.mkdirSync(`${fakeBin}/src/infrastructure/wrapper`, {
      recursive: true,
    });
    Deno.writeTextFileSync(runtimePath, "export {};\n");

    const adapter = withEnvValue("CODEX_WRAPPER_RUNTIME", "ts", () => {
      const adapter = buildTeammateAdapter(
        {
          teammateAdapter: "subprocess",
          teammateCommand: "",
          planCommand: "",
          executeCommand: "",
          commandTimeout: 120,
        },
        fakeExec,
      );
      if (!(adapter instanceof SubprocessCodexAdapter)) {
        throw new Error("expected SubprocessCodexAdapter");
      }
      return adapter;
    });

    let defaultCommand = "";
    withEnv("CODEX_WRAPPER_RUNTIME", "ts", () => {
      defaultCommand = defaultTeammateCommand(fakeExec);
    });
    const expected = [
      "deno",
      "run",
      "--no-prompt",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-run",
      runtimePath,
    ];

    if (JSON.stringify(adapter.planCommand) !== JSON.stringify(expected)) {
      throw new Error(
        `plan command mismatch: ${JSON.stringify(adapter.planCommand)}`,
      );
    }
    if (JSON.stringify(adapter.executeCommand) !== JSON.stringify(expected)) {
      throw new Error(
        `execute command mismatch: ${JSON.stringify(adapter.executeCommand)}`,
      );
    }
    if (
      defaultCommand !==
        `deno run --no-prompt --allow-read --allow-write --allow-env --allow-run ${runtimePath}`
    ) {
      throw new Error(`unexpected default command: ${defaultCommand}`);
    }
  });
});

Deno.test("buildTeammateAdapter falls back to parent directory runtime", () => {
  withTempDir((root) => {
    const fakeExec = `${root}/dist/cli/agent-dock`;
    const runtimePath = `${root}/src/infrastructure/wrapper/runtime.ts`;

    Deno.mkdirSync(`${root}/dist/cli`, { recursive: true });
    Deno.mkdirSync(`${root}/src/infrastructure/wrapper`, { recursive: true });
    Deno.writeTextFileSync(fakeExec, "#!/usr/bin/env bash\n");
    Deno.writeTextFileSync(runtimePath, "export {};\n");

    const adapter = withEnvValue("CODEX_WRAPPER_RUNTIME", "ts", () => {
      const adapter = buildTeammateAdapter(
        {
          teammateAdapter: "subprocess",
          teammateCommand: "",
          planCommand: "",
          executeCommand: "",
          commandTimeout: 120,
        },
        fakeExec,
      );
      if (!(adapter instanceof SubprocessCodexAdapter)) {
        throw new Error("expected SubprocessCodexAdapter");
      }
      return adapter;
    });

    const expected = [
      "deno",
      "run",
      "--no-prompt",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-run",
      runtimePath,
    ];
    if (JSON.stringify(adapter.planCommand) !== JSON.stringify(expected)) {
      throw new Error("plan command should use parent wrapper");
    }
    if (JSON.stringify(adapter.executeCommand) !== JSON.stringify(expected)) {
      throw new Error("execute command should use parent wrapper");
    }
  });
});

Deno.test("buildTeammateAdapter with explicit plan and execute does not require default wrapper", () => {
  withTempDir((root) => {
    const fakeExec = `${root}/bin/agent-dock`;
    Deno.mkdirSync(`${root}/bin`, { recursive: true });
    Deno.writeTextFileSync(fakeExec, "#!/usr/bin/env bash\n");

    const adapter = buildTeammateAdapter(
      {
        teammateAdapter: "subprocess",
        teammateCommand: "",
        planCommand: "echo plan",
        executeCommand: "echo exec",
        commandTimeout: 120,
      },
      fakeExec,
    );

    if (!(adapter instanceof SubprocessCodexAdapter)) {
      throw new Error("expected SubprocessCodexAdapter");
    }
    if (
      JSON.stringify(adapter.planCommand) !== JSON.stringify(["echo", "plan"])
    ) {
      throw new Error("plan command mismatch");
    }
    if (
      JSON.stringify(adapter.executeCommand) !==
        JSON.stringify(["echo", "exec"])
    ) {
      throw new Error("execute command mismatch");
    }
  });
});

Deno.test("buildTeammateAdapter keeps explicit teammate command above wrapper runtime", () => {
  withEnv("CODEX_WRAPPER_RUNTIME", "invalid", () => {
    const adapter = buildTeammateAdapter({
      teammateAdapter: "subprocess",
      teammateCommand: "echo explicit",
      planCommand: "",
      executeCommand: "",
      commandTimeout: 120,
    });

    if (!(adapter instanceof SubprocessCodexAdapter)) {
      throw new Error("expected SubprocessCodexAdapter");
    }
    if (
      JSON.stringify(adapter.planCommand) !==
        JSON.stringify(["echo", "explicit"])
    ) {
      throw new Error("plan command should use explicit teammate command");
    }
    if (
      JSON.stringify(adapter.executeCommand) !==
        JSON.stringify(["echo", "explicit"])
    ) {
      throw new Error("execute command should use explicit teammate command");
    }
  });
});

Deno.test("buildTeammateAdapter default teammate command uses ts runtime", () => {
  withTempDir((root) => {
    const fakeExec = `${root}/bin/agent-dock`;
    const runtimePath = `${root}/src/infrastructure/wrapper/runtime.ts`;

    Deno.mkdirSync(`${root}/bin`, { recursive: true });
    Deno.mkdirSync(`${root}/src/infrastructure/wrapper`, { recursive: true });
    Deno.writeTextFileSync(fakeExec, "#!/usr/bin/env bash\n");
    Deno.writeTextFileSync(runtimePath, "export {};\n");

    withEnv("CODEX_WRAPPER_RUNTIME", "ts", () => {
      const command = defaultTeammateCommand(fakeExec);
      const expected =
        `deno run --no-prompt --allow-read --allow-write --allow-env --allow-run ${runtimePath}`;
      if (command !== expected) {
        throw new Error(`unexpected default command: ${command}`);
      }
    });
  });
});

Deno.test("buildTeammateAdapter default teammate command rejects legacy runtime", () => {
  withTempDir((root) => {
    const fakeExec = `${root}/bin/agent-dock`;

    Deno.mkdirSync(`${root}/bin`, { recursive: true });
    Deno.writeTextFileSync(fakeExec, "#!/usr/bin/env bash\n");

    withEnv("CODEX_WRAPPER_RUNTIME", "legacy", () => {
      assertThrowsMessage(
        () => defaultTeammateCommand(fakeExec),
        "unsupported CODEX_WRAPPER_RUNTIME=legacy. supported values: ts",
      );
    });
  });
});

Deno.test("buildTeammateAdapter default teammate command rejects invalid runtime", () => {
  withTempDir((root) => {
    const fakeExec = `${root}/bin/agent-dock`;

    Deno.mkdirSync(`${root}/bin`, { recursive: true });
    Deno.writeTextFileSync(fakeExec, "#!/usr/bin/env bash\n");

    withEnv("CODEX_WRAPPER_RUNTIME", "unknown", () => {
      assertThrowsMessage(
        () => defaultTeammateCommand(fakeExec),
        "unsupported CODEX_WRAPPER_RUNTIME=unknown. supported values: ts",
      );
    });
  });
});

Deno.test("buildTeammateAdapter forwards normalized persona sandbox mapping", () => {
  const adapter = buildTeammateAdapter({
    teammateAdapter: "subprocess",
    teammateCommand: "echo codex",
    planCommand: "",
    executeCommand: "",
    commandTimeout: 120,
    personaExecutionSandboxes: {
      " reviewer ": " workspace-write ",
      implementer: "danger-full-access",
      ignored: "   ",
      "": "workspace-write",
    },
  });

  if (!(adapter instanceof SubprocessCodexAdapter)) {
    throw new Error("expected SubprocessCodexAdapter");
  }
  if (
    JSON.stringify(adapter.executionSandboxByTeammateId) !== JSON.stringify({
      reviewer: "workspace-write",
      implementer: "danger-full-access",
    })
  ) {
    throw new Error(
      `sandbox mapping mismatch: ${
        JSON.stringify(adapter.executionSandboxByTeammateId)
      }`,
    );
  }
});

Deno.test("buildTeammateAdapter forwards openspec change id to subprocess env", () => {
  const adapter = buildTeammateAdapter({
    teammateAdapter: "subprocess",
    teammateCommand: "echo codex",
    planCommand: "",
    executeCommand: "",
    commandTimeout: 120,
    openspecChangeId: " add-persona-dir-and-ordered-multi-judgment-phases ",
  });

  if (!(adapter instanceof SubprocessCodexAdapter)) {
    throw new Error("expected SubprocessCodexAdapter");
  }
  if (
    JSON.stringify(adapter.extraEnv) !== JSON.stringify({
      OPENSPEC_CHANGE_ID: "add-persona-dir-and-ordered-multi-judgment-phases",
    })
  ) {
    throw new Error(
      `openspec env mismatch: ${JSON.stringify(adapter.extraEnv)}`,
    );
  }
});

Deno.test("main print-openspec-template outputs ja template", () => {
  const buffer = createIoBuffer();
  const exitCode = main(["print-openspec-template", "--lang", "ja"], buffer.io);

  if (exitCode !== 0) {
    throw new Error("print-openspec-template should return 0");
  }
  if (buffer.state.stderr.length !== 0) {
    throw new Error("stderr should be empty");
  }
  if (buffer.state.stdout !== getOpenSpecTasksTemplate("ja")) {
    throw new Error("stdout should match ja template");
  }
});

Deno.test("main print-openspec-template rejects unsupported lang", () => {
  const buffer = createIoBuffer();
  const exitCode = main(["print-openspec-template", "--lang", "fr"], buffer.io);

  if (exitCode === 0) {
    throw new Error("unsupported lang should fail");
  }
  if (!buffer.state.stderr.includes("invalid choice")) {
    throw new Error("stderr should include invalid choice");
  }
  if (
    !buffer.state.stderr.includes("ja") || !buffer.state.stderr.includes("en")
  ) {
    throw new Error("stderr should include supported languages");
  }
});

Deno.test("main supports global help flags", () => {
  const buffer = createIoBuffer();
  const exitCode = main(["--help"], buffer.io);

  if (exitCode !== 0) {
    throw new Error("--help should return 0");
  }
  if (buffer.state.stderr.length !== 0) {
    throw new Error("stderr should be empty");
  }
  if (!buffer.state.stdout.includes("usage: agent-dock <command> [options]")) {
    throw new Error("stdout should include global usage");
  }
  if (!buffer.state.stdout.includes("spec-creator")) {
    throw new Error("stdout should list spec-creator command");
  }
});

Deno.test("main compile-openspec writes compiled config", () => {
  withTempDir((root) => {
    const changeId = "add-cli-compile";
    const changeDir = `${root}/openspec/changes/${changeId}`;
    Deno.mkdirSync(changeDir, { recursive: true });
    Deno.writeTextFileSync(
      `${changeDir}/tasks.md`,
      [
        "## 1. 実装タスク",
        "- [ ] 1.1 実装する",
        "  - 依存: なし",
        "  - 対象: src/a.ts",
        "  - フェーズ担当: implement=implementer",
      ].join("\n"),
    );

    const outputPath = `${root}/task_configs/result.json`;
    const buffer = createIoBuffer();
    const exitCode = main([
      "compile-openspec",
      "--change-id",
      changeId,
      "--openspec-root",
      `${root}/openspec`,
      "--overrides-root",
      `${root}/task_configs/overrides`,
      "--output",
      outputPath,
    ], buffer.io);

    if (exitCode !== 0) {
      throw new Error(
        `compile-openspec should return 0: ${buffer.state.stderr}`,
      );
    }
    const printedPath = buffer.state.stdout.trim();
    if (printedPath !== outputPath) {
      throw new Error(
        `expected printed path ${outputPath}, got ${printedPath}`,
      );
    }

    const payload = JSON.parse(Deno.readTextFileSync(outputPath)) as {
      tasks: Array<{ id: string }>;
    };
    if (
      JSON.stringify(payload.tasks.map((task) => task.id)) !==
        JSON.stringify(["1.1"])
    ) {
      throw new Error("compiled tasks should contain 1.1");
    }
  });
});

Deno.test("main compile-openspec reports compile errors", () => {
  const buffer = createIoBuffer();
  const exitCode = main([
    "compile-openspec",
    "--change-id",
    "missing-change",
  ], buffer.io);

  if (exitCode === 0) {
    throw new Error("missing change should fail");
  }
  if (!buffer.state.stderr.includes("openspec compile error:")) {
    throw new Error(
      "compile errors should include openspec compile error prefix",
    );
  }
  if (!buffer.state.stderr.includes("change not found:")) {
    throw new Error(
      "compile errors should include missing change-id failure reason",
    );
  }
});

Deno.test("main run executes orchestrator with template adapter", () => {
  withTempDir((root) => {
    const configPath = `${root}/tasks.json`;
    const stateDir = `${root}/state`;

    Deno.writeTextFileSync(
      configPath,
      JSON.stringify(
        {
          teammates: ["tm-1"],
          tasks: [
            {
              id: "T1",
              title: "sample",
              target_paths: ["src/a.ts"],
            },
          ],
        },
        null,
        2,
      ),
    );

    const buffer = createIoBuffer();
    withEnv("ORCHESTRATOR_PROVIDER", "mock", () => {
      const exitCode = main([
        "run",
        "--config",
        configPath,
        "--state-dir",
        stateDir,
        "--teammate-adapter",
        "template",
        "--max-rounds",
        "20",
      ], buffer.io);

      if (exitCode !== 0) {
        throw new Error(`run should return 0: ${buffer.state.stderr}`);
      }
    });

    if (!buffer.state.stdout.includes("[run] run_mode=new-run")) {
      throw new Error("stdout should include run mode");
    }
    if (!buffer.state.stdout.includes("[run] progress_log_ref=")) {
      throw new Error("stdout should include progress_log_ref");
    }
    if (buffer.state.stdout.includes("[run] synced_tasks_md=")) {
      throw new Error("stdout should not include synced_tasks_md for --config");
    }
    if (!buffer.state.stdout.includes('"stop_reason": "all_tasks_completed"')) {
      throw new Error("stdout should include successful stop reason");
    }
  });
});

Deno.test("main run with --openspec-change syncs tasks.md and logs synced count", () => {
  withTempDir((root) => {
    const changeId = "sync-run-change";
    const openspecRoot = `${root}/openspec`;
    const changeDir = `${openspecRoot}/changes/${changeId}`;
    const stateDir = `${root}/state`;
    const tasksPath = `${changeDir}/tasks.md`;

    Deno.mkdirSync(changeDir, { recursive: true });
    Deno.writeTextFileSync(
      tasksPath,
      [
        "## 1. 実装タスク",
        "- [ ] 1.1 同期テスト",
        "  - 依存: なし",
        "  - 対象: src/a.ts",
        "  - フェーズ担当: implement=implementer",
      ].join("\n"),
    );

    const buffer = createIoBuffer();
    withEnv("ORCHESTRATOR_PROVIDER", "mock", () => {
      const exitCode = main([
        "run",
        "--openspec-change",
        changeId,
        "--openspec-root",
        openspecRoot,
        "--state-dir",
        stateDir,
        "--teammate-adapter",
        "template",
        "--max-rounds",
        "20",
      ], buffer.io);

      if (exitCode !== 0) {
        throw new Error(`run should return 0: ${buffer.state.stderr}`);
      }
    });

    if (!buffer.state.stdout.includes("[run] synced_tasks_md=1")) {
      throw new Error("stdout should include synced task count");
    }
    if (
      !buffer.state.stdout.includes('"openspec_change_id": "sync-run-change"')
    ) {
      throw new Error("stdout should include openspec_change_id");
    }
    const tasksAfterRun = Deno.readTextFileSync(tasksPath);
    if (!tasksAfterRun.includes("- [x] 1.1 同期テスト")) {
      throw new Error("tasks.md should be updated before main() returns");
    }
  });
});

const hasBashRunPermission =
  Deno.permissions.querySync({ name: "run", command: "bash" }).state ===
    "granted";

Deno.test({
  name: "main run executes orchestrator with subprocess adapter",
  ignore: !hasBashRunPermission,
  fn: () => {
    withTempDir((root) => {
      const configPath = `${root}/tasks.json`;
      const stateDir = `${root}/state`;
      const wrapperPath = `${root}/fake_wrapper.sh`;

      Deno.writeTextFileSync(
        configPath,
        JSON.stringify(
          {
            teammates: ["tm-1"],
            tasks: [
              {
                id: "T1",
                title: "sample",
                requires_plan: true,
                target_paths: ["src/a.ts"],
              },
            ],
          },
          null,
          2,
        ),
      );
      Deno.writeTextFileSync(
        wrapperPath,
        [
          "#!/usr/bin/env bash",
          "set -euo pipefail",
          'payload="$(cat)"',
          'if [[ "$payload" == *\'"mode":"plan"\'* ]]; then',
          "  echo 'plan from wrapper'",
          "else",
          "  echo 'RESULT: completed'",
          "  echo 'SUMMARY: ok'",
          "  echo 'CHANGED_FILES: src/a.ts'",
          "  echo 'CHECKS: deno test -A src'",
          "  echo 'JUDGMENT: pass'",
          "fi",
          "echo '[wrapper] progress' >&2",
        ].join("\n"),
      );
      Deno.chmodSync(wrapperPath, 0o755);

      const buffer = createIoBuffer();
      withEnv("ORCHESTRATOR_PROVIDER", "mock", () => {
        const exitCode = main([
          "run",
          "--config",
          configPath,
          "--state-dir",
          stateDir,
          "--teammate-adapter",
          "subprocess",
          "--teammate-command",
          `bash ${wrapperPath}`,
          "--max-rounds",
          "30",
        ], buffer.io);

        if (exitCode !== 0) {
          throw new Error(`run should return 0: ${buffer.state.stderr}`);
        }
      });

      if (
        !buffer.state.stdout.includes('"stop_reason": "all_tasks_completed"')
      ) {
        throw new Error("stdout should include successful stop reason");
      }
    });
  },
});

Deno.test("main run keeps task max_revision_cycles from config", () => {
  withTempDir((root) => {
    const configPath = `${root}/tasks.json`;
    const stateDir = `${root}/state`;

    Deno.writeTextFileSync(
      configPath,
      JSON.stringify(
        {
          teammates: ["tm-1"],
          tasks: [
            {
              id: "T1",
              title: "sample",
              target_paths: ["src/a.ts"],
              max_revision_cycles: 9,
            },
          ],
        },
        null,
        2,
      ),
    );

    const buffer = createIoBuffer();
    withEnv("ORCHESTRATOR_PROVIDER", "mock", () => {
      const exitCode = main([
        "run",
        "--config",
        configPath,
        "--state-dir",
        stateDir,
        "--teammate-adapter",
        "template",
        "--max-rounds",
        "20",
      ], buffer.io);

      if (exitCode !== 0) {
        throw new Error(`run should return 0: ${buffer.state.stderr}`);
      }
    });

    const state = JSON.parse(
      Deno.readTextFileSync(`${stateDir}/state.json`),
    ) as Record<string, unknown>;
    const tasks = state.tasks as Record<string, Record<string, unknown>>;
    const task = tasks.T1;
    if (!task) {
      throw new Error("state should include task T1");
    }
    if (task.max_revision_cycles !== 9) {
      throw new Error(
        `expected max_revision_cycles=9, got ${
          String(task.max_revision_cycles)
        }`,
      );
    }
  });
});

Deno.test("main run rejects invalid task max_revision_cycles in config", () => {
  withTempDir((root) => {
    const configPath = `${root}/tasks.json`;
    const stateDir = `${root}/state`;

    Deno.writeTextFileSync(
      configPath,
      JSON.stringify(
        {
          teammates: ["tm-1"],
          tasks: [
            {
              id: "T1",
              title: "sample",
              target_paths: ["src/a.ts"],
              max_revision_cycles: -1,
            },
          ],
        },
        null,
        2,
      ),
    );

    const buffer = createIoBuffer();
    const exitCode = main([
      "run",
      "--config",
      configPath,
      "--state-dir",
      stateDir,
      "--teammate-adapter",
      "template",
      "--max-rounds",
      "20",
    ], buffer.io);

    if (exitCode !== 1) {
      throw new Error("run should fail with invalid max_revision_cycles");
    }
    if (
      !buffer.state.stderr.includes(
        "tasks[0].max_revision_cycles must be a non-negative integer",
      )
    ) {
      throw new Error(
        `stderr should include validation error: ${buffer.state.stderr}`,
      );
    }
  });
});

Deno.test("main run includes openspec_change_id when config meta has source_change_id", () => {
  withTempDir((root) => {
    const configPath = `${root}/tasks.json`;
    const stateDir = `${root}/state`;

    Deno.writeTextFileSync(
      configPath,
      JSON.stringify(
        {
          meta: {
            source_change_id: "add-sample-change",
          },
          teammates: ["tm-1"],
          tasks: [
            {
              id: "T1",
              title: "sample",
              target_paths: ["src/a.ts"],
            },
          ],
        },
        null,
        2,
      ),
    );

    const buffer = createIoBuffer();
    withEnv("ORCHESTRATOR_PROVIDER", "mock", () => {
      const exitCode = main([
        "run",
        "--config",
        configPath,
        "--state-dir",
        stateDir,
        "--teammate-adapter",
        "template",
        "--max-rounds",
        "20",
      ], buffer.io);

      if (exitCode !== 0) {
        throw new Error(`run should return 0: ${buffer.state.stderr}`);
      }
    });

    if (
      !buffer.state.stdout.includes('"openspec_change_id": "add-sample-change"')
    ) {
      throw new Error("stdout should include openspec_change_id");
    }
    if (buffer.state.stdout.includes("[run] synced_tasks_md=")) {
      throw new Error(
        "stdout should not include synced_tasks_md when running with --config",
      );
    }
  });
});

Deno.test("main run loads personas from --persona-dir", () => {
  withTempDir((root) => {
    const configPath = `${root}/tasks.json`;
    const stateDir = `${root}/state`;
    const personaDir = `${root}/personas`;

    Deno.mkdirSync(personaDir, { recursive: true });
    Deno.writeTextFileSync(
      `${personaDir}/personas.json`,
      JSON.stringify(
        [
          {
            id: "custom-reviewer",
            role: "reviewer",
            focus: "review",
            can_block: true,
            enabled: true,
          },
        ],
        null,
        2,
      ),
    );
    Deno.writeTextFileSync(
      configPath,
      JSON.stringify(
        {
          teammates: ["tm-1"],
          tasks: [
            {
              id: "T1",
              title: "sample",
              target_paths: ["src/a.ts"],
              requires_plan: true,
              persona_policy: {
                phase_overrides: {
                  review: {
                    executor_personas: ["custom-reviewer"],
                  },
                },
              },
            },
          ],
        },
        null,
        2,
      ),
    );

    const bufferWithout = createIoBuffer();
    const exitWithout = main([
      "run",
      "--config",
      configPath,
      "--state-dir",
      stateDir,
      "--teammate-adapter",
      "template",
      "--max-rounds",
      "20",
    ], bufferWithout.io);
    if (exitWithout !== 1) {
      throw new Error("run should fail without --persona-dir");
    }

    const bufferWith = createIoBuffer();
    withEnv("ORCHESTRATOR_PROVIDER", "mock", () => {
      const exitWith = main([
        "run",
        "--config",
        configPath,
        "--state-dir",
        stateDir,
        "--persona-dir",
        personaDir,
        "--teammate-adapter",
        "template",
        "--max-rounds",
        "20",
      ], bufferWith.io);
      if (exitWith !== 0) {
        throw new Error(
          `run should return 0 with persona-dir: ${bufferWith.state.stderr}`,
        );
      }
    });

    if (
      !bufferWith.state.stdout.includes('"stop_reason": "all_tasks_completed"')
    ) {
      throw new Error("stdout should include successful stop reason");
    }
  });
});

Deno.test("main run merges payload.personas with --persona-dir personas", () => {
  withTempDir((root) => {
    const configPath = `${root}/tasks.json`;
    const stateDir = `${root}/state`;
    const personaDir = `${root}/personas`;

    Deno.mkdirSync(personaDir, { recursive: true });
    Deno.writeTextFileSync(
      `${personaDir}/personas.json`,
      JSON.stringify(
        [
          {
            id: "dir-reviewer",
            role: "reviewer",
            focus: "dir review",
            can_block: true,
            enabled: true,
          },
        ],
        null,
        2,
      ),
    );
    Deno.writeTextFileSync(
      configPath,
      JSON.stringify(
        {
          teammates: ["tm-1"],
          personas: [
            {
              id: "payload-reviewer",
              role: "reviewer",
              focus: "payload review",
              can_block: false,
              enabled: true,
            },
          ],
          tasks: [
            {
              id: "T1",
              title: "sample",
              target_paths: ["src/a.ts"],
              requires_plan: true,
              persona_policy: {
                phase_overrides: {
                  review: {
                    executor_personas: ["payload-reviewer", "dir-reviewer"],
                  },
                },
              },
            },
          ],
        },
        null,
        2,
      ),
    );

    const buffer = createIoBuffer();
    withEnv("ORCHESTRATOR_PROVIDER", "mock", () => {
      const exitCode = main([
        "run",
        "--config",
        configPath,
        "--state-dir",
        stateDir,
        "--persona-dir",
        personaDir,
        "--teammate-adapter",
        "template",
        "--max-rounds",
        "20",
      ], buffer.io);
      if (exitCode !== 0) {
        throw new Error(
          `run should merge payload and persona-dir personas: ${buffer.state.stderr}`,
        );
      }
    });

    if (!buffer.state.stdout.includes('"stop_reason": "all_tasks_completed"')) {
      throw new Error("stdout should include successful stop reason");
    }
  });
});

Deno.test("main run rejects duplicate --persona-dir", () => {
  withTempDir((root) => {
    const configPath = `${root}/tasks.json`;
    const stateDir = `${root}/state`;
    const buffer = createIoBuffer();

    Deno.writeTextFileSync(
      configPath,
      JSON.stringify(
        {
          teammates: ["tm-1"],
          tasks: [
            {
              id: "T1",
              title: "sample",
              target_paths: ["src/a.ts"],
            },
          ],
        },
        null,
        2,
      ),
    );

    const exitCode = main([
      "run",
      "--config",
      configPath,
      "--state-dir",
      stateDir,
      "--persona-dir",
      `${root}/personas`,
      "--persona-dir",
      `${root}/personas2`,
    ], buffer.io);

    if (exitCode !== 1) {
      throw new Error("run should reject duplicate --persona-dir");
    }
    if (!buffer.state.stderr.includes("can only be used once")) {
      throw new Error(
        `stderr should include duplication error: ${buffer.state.stderr}`,
      );
    }
  });
});

Deno.test("main spec-creator rejects duplicate --persona-dir", () => {
  withTempDir((root) => {
    const buffer = createIoBuffer();
    const exitCode = main([
      "spec-creator",
      "--change-id",
      "sample-change",
      "--persona-dir",
      `${root}/personas`,
      "--persona-dir",
      `${root}/personas2`,
    ], buffer.io);

    if (exitCode !== 1) {
      throw new Error("spec-creator should reject duplicate --persona-dir");
    }
    if (!buffer.state.stderr.includes("can only be used once")) {
      throw new Error(
        `stderr should include duplication error: ${buffer.state.stderr}`,
      );
    }
  });
});

Deno.test("main spec-creator rejects unknown subcommand", () => {
  const buffer = createIoBuffer();
  const exitCode = main(["spec-creator", "unknown-subcommand"], buffer.io);
  if (exitCode !== 1) {
    throw new Error("spec-creator should reject unknown subcommand");
  }
  if (!buffer.state.stderr.includes("unrecognized spec-creator subcommand")) {
    throw new Error(
      `stderr should include subcommand error: ${buffer.state.stderr}`,
    );
  }
});

Deno.test("main spec-creator polish requires positional change_id", () => {
  const buffer = createIoBuffer();
  const exitCode = main(["spec-creator", "polish"], buffer.io);
  if (exitCode !== 1) {
    throw new Error("spec-creator polish should require change_id");
  }
  if (!buffer.state.stderr.includes("requires positional <change_id>")) {
    throw new Error(
      `stderr should include missing change_id error: ${buffer.state.stderr}`,
    );
  }
});

Deno.test("main spec-creator polish rejects unknown polish option", () => {
  const buffer = createIoBuffer();
  const exitCode = main(
    ["spec-creator", "polish", "sample-change-id", "--unknown-option"],
    buffer.io,
  );
  if (exitCode !== 1) {
    throw new Error("spec-creator polish should reject unknown option");
  }
  if (
    !buffer.state.stderr.includes("unrecognized argument: --unknown-option")
  ) {
    throw new Error(
      `stderr should include polish option error: ${buffer.state.stderr}`,
    );
  }
});

Deno.test("main spec-creator polish rejects duplicated --feedback", () => {
  const buffer = createIoBuffer();
  const exitCode = main([
    "spec-creator",
    "polish",
    "sample-change-id",
    "--feedback",
    "first",
    "--feedback",
    "second",
  ], buffer.io);
  if (exitCode !== 1) {
    throw new Error("spec-creator polish should reject duplicate feedback");
  }
  if (!buffer.state.stderr.includes("can only be used once")) {
    throw new Error(
      `stderr should include duplicate option error: ${buffer.state.stderr}`,
    );
  }
});

Deno.test("main spec-creator polish rejects --feedback without value", () => {
  const buffer = createIoBuffer();
  const exitCode = main(
    ["spec-creator", "polish", "sample-change-id", "--feedback"],
    buffer.io,
  );
  if (exitCode !== 1) {
    throw new Error("spec-creator polish should reject missing feedback value");
  }
  if (!buffer.state.stderr.includes("expected one argument")) {
    throw new Error(
      `stderr should include option value error: ${buffer.state.stderr}`,
    );
  }
});

Deno.test("main spec-creator polish uses existing markdown context without interactive TTY", () => {
  const changeId = uniqueChangeId("update-polish-context");
  const polishedChangeId = revisedChangeId(changeId);
  const changeDir = `openspec/changes/${changeId}`;
  const outputPath = `task_configs/spec_creator/${changeId}.json`;
  Deno.mkdirSync(changeDir, { recursive: true });
  Deno.writeTextFileSync(
    `${changeDir}/README.md`,
    "# polish context\n- this file is used as source markdown context\n",
  );

  try {
    const buffer = createIoBuffer();
    withFakeOpenSpecValidate("pass", () => {
      const exitCode = main([
        "spec-creator",
        "polish",
        changeId,
        "--no-run",
        "--output",
        outputPath,
      ], buffer.io);

      if (exitCode !== 0) {
        throw new Error(
          `spec-creator polish should succeed: ${buffer.state.stderr}`,
        );
      }
    });

    if (buffer.state.stderr.includes("interactive TTY")) {
      throw new Error(
        `polish should not require interactive TTY: ${buffer.state.stderr}`,
      );
    }
    if (!fileExists(outputPath)) {
      throw new Error("spec-creator polish should produce task_config output");
    }
    const generatedTasks = Deno.readTextFileSync(
      `openspec/changes/${polishedChangeId}/tasks.md`,
    );
    const task17Section =
      /-\s*\[[ xX]\]\s*1\.7[\s\S]*?(?=\n-\s*\[[ xX]\]\s*\S+|\n##\s+|\s*$)/u
        .exec(generatedTasks);
    if (task17Section === null) {
      throw new Error("generated tasks.md should include task 1.7");
    }
    if (
      !task17Section[0].includes("フェーズ担当: implement=implementer") &&
      !task17Section[0].includes("phase assignments: implement=implementer")
    ) {
      throw new Error(
        "task 1.7 phase assignments should use output_phase_assignments instead of internal persona",
      );
    }
    const taskConfig = JSON.parse(Deno.readTextFileSync(outputPath)) as {
      tasks?: Array<Record<string, unknown>>;
    };
    if (!Array.isArray(taskConfig.tasks)) {
      throw new Error("task_config should include tasks");
    }
    const designPath = `openspec/changes/${polishedChangeId}/design.md`;
    const hasDesignPath = taskConfig.tasks.some((task) => {
      const targetPaths = Array.isArray(task.target_paths)
        ? task.target_paths.map((item) => String(item))
        : [];
      const relatedPaths = Array.isArray(task.related_paths)
        ? task.related_paths.map((item) => String(item))
        : [];
      return targetPaths.includes(designPath) ||
        relatedPaths.includes(designPath);
    });
    if (!hasDesignPath) {
      throw new Error(
        "design.md should be included in target_paths or related_paths",
      );
    }
    if (!taskConfig.tasks.some((task) => String(task.id) === "1.4")) {
      throw new Error("task 1.4 should be included");
    }
  } finally {
    try {
      Deno.removeSync(changeDir, { recursive: true });
    } catch {
      // noop
    }
    try {
      Deno.removeSync(`openspec/changes/${polishedChangeId}`, {
        recursive: true,
      });
    } catch {
      // noop
    }
    try {
      Deno.removeSync(outputPath);
    } catch {
      // noop
    }
  }
});

Deno.test("main spec-creator polish quotes checklist lines in human notes", () => {
  const changeId = uniqueChangeId("update-polish-quote-checklist");
  const polishedChangeId = revisedChangeId(changeId);
  const outputPath = `task_configs/spec_creator/${changeId}.json`;
  withTemporaryChangeDir(changeId, () => {
    Deno.writeTextFileSync(
      `openspec/changes/${changeId}/tasks.md`,
      [
        "## 1. 実装タスク",
        "- [x] 1.1 既存タスク",
        "- [ ] 1.2 次タスク",
        "",
        "## 2. 人間向けメモ（コンパイラ非対象）",
        "- メモ: sample",
      ].join("\n"),
    );

    const buffer = createIoBuffer();
    withFakeOpenSpecValidate("pass", () => {
      const exitCode = main([
        "spec-creator",
        "polish",
        changeId,
        "--no-run",
        "--output",
        outputPath,
      ], buffer.io);
      if (exitCode !== 0) {
        throw new Error(
          `spec-creator polish should succeed: ${buffer.state.stderr}`,
        );
      }
    });

    if (!fileExists(outputPath)) {
      throw new Error("spec-creator polish should produce task_config output");
    }

    const generatedTasks = Deno.readTextFileSync(
      `openspec/changes/${polishedChangeId}/tasks.md`,
    );
    if (!generatedTasks.includes("  > - [x] 1.1 既存タスク")) {
      throw new Error(
        "requirements memo checklist lines should be blockquoted",
      );
    }
    const generatedLines = generatedTasks.split(/\r?\n/u);
    const humanNotesHeadingIndex = generatedLines.findIndex((line) =>
      line.trim() === "## 2. 人間向けメモ（コンパイラ非対象）"
    );
    if (humanNotesHeadingIndex < 0) {
      throw new Error("tasks.md should include human notes section");
    }
    const humanNotesBody = generatedLines.slice(humanNotesHeadingIndex + 1)
      .join("\n");
    if (/^\s*-\s*\[[ xX]\]\s*1\.1\b/m.test(humanNotesBody)) {
      throw new Error(
        "human notes should not include top-level checklist items parsed as task ids",
      );
    }

    try {
      Deno.removeSync(outputPath);
    } catch {
      // noop
    }
  });
});

Deno.test("main spec-creator polish preserves existing phase assignments from tasks.md", () => {
  const changeId = uniqueChangeId("update-polish-preserve-phase-assignments");
  const polishedChangeId = revisedChangeId(changeId);
  const outputPath = `task_configs/spec_creator/${changeId}.json`;
  withTemporaryChangeDir(changeId, () => {
    Deno.writeTextFileSync(
      `openspec/changes/${changeId}/tasks.md`,
      [
        "## 0. Persona Defaults",
        "- persona_defaults.phase_order: implement, review, spec_check, test",
        "",
        "## 1. 実装タスク",
        "- [ ] 1.7 OpenSpec strict validate を実行する",
        "  - フェーズ担当: implement=code-reviewer",
      ].join("\n"),
    );

    const buffer = createIoBuffer();
    withFakeOpenSpecValidate("pass", () => {
      const exitCode = main([
        "spec-creator",
        "polish",
        changeId,
        "--no-run",
        "--output",
        outputPath,
      ], buffer.io);
      if (exitCode !== 0) {
        throw new Error(
          `spec-creator polish should succeed: ${buffer.state.stderr}`,
        );
      }
    });

    const generatedTasks = Deno.readTextFileSync(
      `openspec/changes/${polishedChangeId}/tasks.md`,
    );
    const task17Section =
      /-\s*\[[ xX]\]\s*1\.7[\s\S]*?(?=\n-\s*\[[ xX]\]\s*\S+|\n##\s+|\s*$)/u
        .exec(generatedTasks);
    if (task17Section === null) {
      throw new Error("generated tasks.md should include task 1.7");
    }
    if (!task17Section[0].includes("フェーズ担当: implement=code-reviewer")) {
      throw new Error(
        "existing phase assignments should be preserved when tasks.md already defines them",
      );
    }

    try {
      Deno.removeSync(outputPath);
    } catch {
      // noop
    }
  });
});

Deno.test("main spec-creator polish always includes design target", () => {
  const changeId = uniqueChangeId("update-polish-design-optional");
  const polishedChangeId = revisedChangeId(changeId);
  const outputPath = `task_configs/spec_creator/${changeId}.json`;
  withTemporaryChangeDir(changeId, () => {
    Deno.writeTextFileSync(
      `openspec/changes/${changeId}/README.md`,
      "# polish context\n- neutral content only\n",
    );
    Deno.writeTextFileSync(
      `openspec/changes/${changeId}/design.md`,
      "# notes\n- existing file only\n",
    );

    const buffer = createIoBuffer();
    withFakeOpenSpecValidate("pass", () => {
      const exitCode = main([
        "spec-creator",
        "polish",
        changeId,
        "--no-run",
        "--output",
        outputPath,
      ], buffer.io);
      if (exitCode !== 0) {
        throw new Error(
          `spec-creator polish should succeed: ${buffer.state.stderr}`,
        );
      }
    });

    if (!fileExists(outputPath)) {
      throw new Error("spec-creator polish should produce task_config output");
    }
    const taskConfig = JSON.parse(Deno.readTextFileSync(outputPath)) as {
      tasks?: Array<Record<string, unknown>>;
    };
    if (!Array.isArray(taskConfig.tasks)) {
      throw new Error("task_config should include tasks");
    }

    const designPath = `openspec/changes/${polishedChangeId}/design.md`;
    const hasDesignPath = taskConfig.tasks.some((task) => {
      const targetPaths = Array.isArray(task.target_paths)
        ? task.target_paths.map((item) => String(item))
        : [];
      const relatedPaths = Array.isArray(task.related_paths)
        ? task.related_paths.map((item) => String(item))
        : [];
      return targetPaths.includes(designPath) ||
        relatedPaths.includes(designPath);
    });
    if (!hasDesignPath) {
      throw new Error(
        "design.md should be included in target_paths or related_paths",
      );
    }
    if (!taskConfig.tasks.some((task) => String(task.id) === "1.4")) {
      throw new Error("task 1.4 should be included");
    }

    try {
      Deno.removeSync(outputPath);
    } catch {
      // noop
    }
  });
});

Deno.test("main spec-creator polish keeps design target even with noisy markdown context", () => {
  const changeId = uniqueChangeId("update-polish-design-signal-noise");
  const outputPath = `task_configs/spec_creator/${changeId}.json`;
  withTemporaryChangeDir(changeId, () => {
    Deno.writeTextFileSync(
      `openspec/changes/${changeId}/tasks.md`,
      [
        "## notes",
        "design.md は必要時のみ生成",
      ].join("\n"),
    );
    Deno.writeTextFileSync(
      `openspec/changes/${changeId}/code_summary.md`,
      "- 再生成対象: proposal.md / tasks.md / code_summary.md / (必要時)design.md\n",
    );
    Deno.writeTextFileSync(
      `openspec/changes/${changeId}/README.md`,
      "# neutral context\nno extra signal\n",
    );

    const buffer = createIoBuffer();
    withFakeOpenSpecValidate("pass", () => {
      const exitCode = main([
        "spec-creator",
        "polish",
        changeId,
        "--no-run",
        "--output",
        outputPath,
      ], buffer.io);
      if (exitCode !== 0) {
        throw new Error(
          `spec-creator polish should succeed: ${buffer.state.stderr}`,
        );
      }
    });

    const taskConfig = JSON.parse(Deno.readTextFileSync(outputPath)) as {
      tasks?: Array<Record<string, unknown>>;
    };
    if (!Array.isArray(taskConfig.tasks)) {
      throw new Error("task_config should include tasks");
    }
    if (!taskConfig.tasks.some((task) => String(task.id) === "1.4")) {
      throw new Error(
        "task 1.4 should stay included",
      );
    }

    try {
      Deno.removeSync(outputPath, { recursive: false });
    } catch {
      // noop
    }
  });
});

Deno.test("collectSpecCreatorApplyManifestForTest keeps target-only deleted spec paths", () => {
  withTempCwd(() => {
    const changeId = "sample-change";
    const targetChangeDir = `openspec/changes/${changeId}`;
    const stagingRoot = "staging";
    const stagedChangeDir = `${stagingRoot}/openspec/changes/${changeId}`;
    Deno.mkdirSync(`${targetChangeDir}/specs/a`, { recursive: true });
    Deno.mkdirSync(`${targetChangeDir}/specs/b`, { recursive: true });
    Deno.mkdirSync(`${stagedChangeDir}/specs/b`, { recursive: true });
    Deno.writeTextFileSync(`${targetChangeDir}/proposal.md`, "# proposal\n");
    Deno.writeTextFileSync(`${targetChangeDir}/tasks.md`, "## tasks\n");
    Deno.writeTextFileSync(`${targetChangeDir}/code_summary.md`, "# summary\n");
    Deno.writeTextFileSync(`${targetChangeDir}/design.md`, "# design\n");
    Deno.writeTextFileSync(`${targetChangeDir}/specs/a/spec.md`, "a\n");
    Deno.writeTextFileSync(`${targetChangeDir}/specs/b/spec.md`, "b\n");
    Deno.writeTextFileSync(`${stagedChangeDir}/proposal.md`, "# proposal\n");
    Deno.writeTextFileSync(`${stagedChangeDir}/tasks.md`, "## tasks\n");
    Deno.writeTextFileSync(`${stagedChangeDir}/code_summary.md`, "# summary\n");
    Deno.writeTextFileSync(`${stagedChangeDir}/design.md`, "# design\n");
    Deno.writeTextFileSync(`${stagedChangeDir}/specs/b/spec.md`, "b-new\n");

    const targetPaths: SpecCreatorArtifactPaths = {
      changeId,
      changeDir: `${Deno.cwd()}/${targetChangeDir}`,
      proposalPath: `${Deno.cwd()}/${targetChangeDir}/proposal.md`,
      tasksPath: `${Deno.cwd()}/${targetChangeDir}/tasks.md`,
      designPath: `${Deno.cwd()}/${targetChangeDir}/design.md`,
      codeSummaryPath: `${Deno.cwd()}/${targetChangeDir}/code_summary.md`,
      deltaSpecPath: `${Deno.cwd()}/${targetChangeDir}/specs/a/spec.md`,
      deltaSpecPaths: [
        `${Deno.cwd()}/${targetChangeDir}/specs/a/spec.md`,
        `${Deno.cwd()}/${targetChangeDir}/specs/b/spec.md`,
      ],
    };
    const stagedPaths: SpecCreatorArtifactPaths = {
      changeId,
      changeDir: `${Deno.cwd()}/${stagedChangeDir}`,
      proposalPath: `${Deno.cwd()}/${stagedChangeDir}/proposal.md`,
      tasksPath: `${Deno.cwd()}/${stagedChangeDir}/tasks.md`,
      designPath: `${Deno.cwd()}/${stagedChangeDir}/design.md`,
      codeSummaryPath: `${Deno.cwd()}/${stagedChangeDir}/code_summary.md`,
      deltaSpecPath: `${Deno.cwd()}/${stagedChangeDir}/specs/b/spec.md`,
      deltaSpecPaths: [
        `${Deno.cwd()}/${stagedChangeDir}/specs/b/spec.md`,
      ],
    };

    const manifest = collectSpecCreatorApplyManifestForTest(
      targetPaths,
      stagedPaths,
      `${Deno.cwd()}/${stagingRoot}`,
    );
    const deletedSpecPath = `${Deno.cwd()}/${targetChangeDir}/specs/a/spec.md`;
    if (!manifest.includes(deletedSpecPath)) {
      throw new Error(
        "apply manifest should include target-only spec path deleted from staging",
      );
    }
  });
});

Deno.test("normalizeSpecCreatorReviewContractCoverageForTest backfills missing RC contracts", () => {
  withTempCwd(() => {
    const changeId = "sample-change";
    const changeDir = `openspec/changes/${changeId}`;
    Deno.mkdirSync(`${changeDir}/specs/sample-change`, { recursive: true });
    Deno.writeTextFileSync(
      `${changeDir}/tasks.md`,
      [
        "## 0. Persona Defaults",
        "- persona_defaults.phase_order: implement, review",
        "",
        "## 1. 実装タスク",
        "- [ ] 1.2 既存タスク",
        "- [ ] 1.3 実行結果パーサを共通化する",
        "  - 成果物: src/domain/execution_result.ts",
        "- [ ] 1.4 検証",
      ].join("\n"),
    );
    Deno.writeTextFileSync(
      `${changeDir}/specs/sample-change/spec.md`,
      [
        "## ADDED Requirements",
        "### Requirement: baseline",
        "The system SHALL keep artifacts aligned.",
      ].join("\n"),
    );
    Deno.writeTextFileSync(`${changeDir}/code_summary.md`, "# code_summary\n");

    const paths: SpecCreatorArtifactPaths = {
      changeId,
      changeDir: `${Deno.cwd()}/${changeDir}`,
      proposalPath: `${Deno.cwd()}/${changeDir}/proposal.md`,
      tasksPath: `${Deno.cwd()}/${changeDir}/tasks.md`,
      designPath: `${Deno.cwd()}/${changeDir}/design.md`,
      codeSummaryPath: `${Deno.cwd()}/${changeDir}/code_summary.md`,
      deltaSpecPath: `${Deno.cwd()}/${changeDir}/specs/sample-change/spec.md`,
      deltaSpecPaths: [
        `${Deno.cwd()}/${changeDir}/specs/sample-change/spec.md`,
      ],
    };

    normalizeSpecCreatorReviewContractCoverageForTest(paths);

    const tasksText = Deno.readTextFileSync(paths.tasksPath);
    const sectionMatch =
      /-\s*\[[ xX]\]\s*1\.3[\s\S]*?(?=\n-\s*\[[ xX]\]\s*\S+|\n##\s+|\s*$)/u
        .exec(
          tasksText,
        );
    if (sectionMatch === null) {
      throw new Error("task 1.3 section should exist after normalization");
    }
    for (const id of REVIEW_CONTRACT_IDS) {
      if (!hasReviewTraceabilityLine(sectionMatch[0], id)) {
        throw new Error(`task 1.3 should include traceability line for ${id}`);
      }
    }

    const specText = Deno.readTextFileSync(paths.deltaSpecPath);
    for (const id of REVIEW_CONTRACT_IDS) {
      if (!specText.includes(`### Requirement (${id})`)) {
        throw new Error(`spec should include Requirement (${id})`);
      }
    }

    const codeSummaryText = Deno.readTextFileSync(paths.codeSummaryPath);
    const codeSummarySectionMatch =
      /##\s+task_id:\s*1\.3[\s\S]*?(?=\n##\s+task_id:|\s*$)/u.exec(
        codeSummaryText,
      );
    if (codeSummarySectionMatch === null) {
      throw new Error("code_summary should include task_id: 1.3 section");
    }
    for (const id of REVIEW_CONTRACT_IDS) {
      if (!hasReviewTraceabilityLine(codeSummarySectionMatch[0], id)) {
        throw new Error(
          `code_summary task_id:1.3 should include traceability line for ${id}`,
        );
      }
    }
  });
});

Deno.test("normalizeSpecCreatorReviewContractCoverageForTest rewrites checkbox RC lines to canonical non-checkbox lines", () => {
  withTempCwd(() => {
    const changeId = "sample-change";
    const changeDir = `openspec/changes/${changeId}`;
    Deno.mkdirSync(`${changeDir}/specs/sample-change`, { recursive: true });
    Deno.writeTextFileSync(
      `${changeDir}/tasks.md`,
      [
        "## 1. 実装タスク",
        "- [ ] 1.3 実行結果レビュー契約",
        "  - [ ] RC-01 | transport: legacy | reject: legacy | path_test: legacy | reject_test: legacy",
        "  - [x] RC-02 | transport: legacy | reject: legacy | path_test: legacy | reject_test: legacy",
        '  - persona_policy: {"phase_order":["implement","review"]}',
        "- [ ] 1.4 検証",
      ].join("\n"),
    );
    Deno.writeTextFileSync(
      `${changeDir}/specs/sample-change/spec.md`,
      [
        "## ADDED Requirements",
        "### Requirement: baseline",
        "The system SHALL keep artifacts aligned.",
      ].join("\n"),
    );
    Deno.writeTextFileSync(`${changeDir}/code_summary.md`, "# code_summary\n");

    const paths: SpecCreatorArtifactPaths = {
      changeId,
      changeDir: `${Deno.cwd()}/${changeDir}`,
      proposalPath: `${Deno.cwd()}/${changeDir}/proposal.md`,
      tasksPath: `${Deno.cwd()}/${changeDir}/tasks.md`,
      designPath: `${Deno.cwd()}/${changeDir}/design.md`,
      codeSummaryPath: `${Deno.cwd()}/${changeDir}/code_summary.md`,
      deltaSpecPath: `${Deno.cwd()}/${changeDir}/specs/sample-change/spec.md`,
      deltaSpecPaths: [
        `${Deno.cwd()}/${changeDir}/specs/sample-change/spec.md`,
      ],
    };

    normalizeSpecCreatorReviewContractCoverageForTest(paths);

    const tasksText = Deno.readTextFileSync(paths.tasksPath);
    const sectionMatch =
      /-\s*\[[ xX]\]\s*1\.3[\s\S]*?(?=\n-\s*\[[ xX]\]\s*\S+|\n##\s+|\s*$)/u
        .exec(
          tasksText,
        );
    if (sectionMatch === null) {
      throw new Error("task 1.3 section should exist after normalization");
    }
    if (/\n\s*-\s*\[[ xX]\]\s*RC-(?:0[1-9]|1[0-2])\b/u.test(sectionMatch[0])) {
      throw new Error("RC lines should be rewritten without checkbox markers");
    }
    for (const id of REVIEW_CONTRACT_IDS) {
      if (!hasReviewTraceabilityLine(sectionMatch[0], id)) {
        throw new Error(
          `task 1.3 should include canonical traceability for ${id}`,
        );
      }
    }
  });
});

Deno.test("normalizeSpecCreatorReviewContractCoverageForTest is idempotent", () => {
  withTempCwd(() => {
    const changeId = "sample-change";
    const changeDir = `openspec/changes/${changeId}`;
    Deno.mkdirSync(`${changeDir}/specs/sample-change`, { recursive: true });
    Deno.writeTextFileSync(
      `${changeDir}/tasks.md`,
      [
        "## 1. 実装タスク",
        "- [ ] 1.3 実行結果レビュー契約",
        ...REVIEW_CONTRACT_IDS.map((id) => `  - ${id}: already included`),
      ].join("\n"),
    );
    Deno.writeTextFileSync(
      `${changeDir}/code_summary.md`,
      [
        "# code_summary",
        "",
        "## task_id: 1.3",
        "",
        ...REVIEW_CONTRACT_IDS.map((id) => `- ${id}: already included`),
      ].join("\n"),
    );
    Deno.writeTextFileSync(
      `${changeDir}/specs/sample-change/spec.md`,
      [
        "## ADDED Requirements",
        ...REVIEW_CONTRACT_IDS.flatMap((id) => [
          `### Requirement (${id}): preset`,
          "The system SHALL keep preset requirement.",
          "",
          `#### Scenario: ${id} preset`,
          `- **THEN** ${id} exists`,
          "",
        ]),
      ].join("\n"),
    );

    const paths: SpecCreatorArtifactPaths = {
      changeId,
      changeDir: `${Deno.cwd()}/${changeDir}`,
      proposalPath: `${Deno.cwd()}/${changeDir}/proposal.md`,
      tasksPath: `${Deno.cwd()}/${changeDir}/tasks.md`,
      designPath: `${Deno.cwd()}/${changeDir}/design.md`,
      codeSummaryPath: `${Deno.cwd()}/${changeDir}/code_summary.md`,
      deltaSpecPath: `${Deno.cwd()}/${changeDir}/specs/sample-change/spec.md`,
      deltaSpecPaths: [
        `${Deno.cwd()}/${changeDir}/specs/sample-change/spec.md`,
      ],
    };

    normalizeSpecCreatorReviewContractCoverageForTest(paths);
    normalizeSpecCreatorReviewContractCoverageForTest(paths);

    const tasksText = Deno.readTextFileSync(paths.tasksPath);
    const codeSummaryText = Deno.readTextFileSync(paths.codeSummaryPath);
    const specText = Deno.readTextFileSync(paths.deltaSpecPath);
    for (const id of REVIEW_CONTRACT_IDS) {
      const taskMatches = tasksText.match(
        new RegExp(`^\\s*-\\s*${id}\\b`, "gmu"),
      ) ?? [];
      if (taskMatches.length !== 1) {
        throw new Error(`task should contain ${id} exactly once`);
      }
      if (!hasReviewTraceabilityLine(tasksText, id)) {
        throw new Error(`task should keep traceability line for ${id}`);
      }
      const codeSummaryMatches = codeSummaryText.match(
        new RegExp(`^\\s*-\\s*${id}\\b`, "gmu"),
      ) ?? [];
      if (codeSummaryMatches.length !== 1) {
        throw new Error(`code_summary should contain ${id} exactly once`);
      }
      if (!hasReviewTraceabilityLine(codeSummaryText, id)) {
        throw new Error(
          `code_summary should keep traceability line for ${id}`,
        );
      }
      const specMatches = specText.match(
        new RegExp(`### Requirement \\(${id}\\)`, "g"),
      ) ?? [];
      if (specMatches.length !== 1) {
        throw new Error(`spec should contain Requirement (${id}) exactly once`);
      }
    }
  });
});

Deno.test("main spec-creator direct mode is deprecated", () => {
  const buffer = createIoBuffer();
  const changeId = uniqueChangeId("legacy-spec-creator");
  const outputPath = `task_configs/spec_creator/${changeId}.json`;
  const exitCode = main([
    "spec-creator",
    "--change-id",
    changeId,
    "--output",
    outputPath,
    "--no-run",
  ], buffer.io);
  if (exitCode !== 1) {
    throw new Error(
      "legacy spec-creator should be rejected in non-interactive context",
    );
  }
  if (!buffer.state.stderr.includes("legacy direct mode is deprecated")) {
    throw new Error(
      `stderr should include deprecation warning: ${buffer.state.stderr}`,
    );
  }
});

Deno.test("main spec-creator polish --no-run still requires strict validate", () => {
  const changeId = uniqueChangeId("update-polish-no-run-validate");
  const outputPath = `task_configs/spec_creator/${changeId}.json`;
  withTemporaryChangeDir(changeId, () => {
    Deno.writeTextFileSync(
      `openspec/changes/${changeId}/README.md`,
      "# polish context\n- markdown source\n",
    );
    const buffer = createIoBuffer();
    withEnv("PATH", "", () => {
      const exitCode = main([
        "spec-creator",
        "polish",
        changeId,
        "--no-run",
        "--output",
        outputPath,
      ], buffer.io);
      if (exitCode !== 1) {
        throw new Error(
          "spec-creator polish --no-run should fail when strict validate cannot run",
        );
      }
    });
    if (!buffer.state.stderr.includes("openspec")) {
      throw new Error(
        `stderr should include openspec validate failure: ${buffer.state.stderr}`,
      );
    }
    if (fileExists(outputPath)) {
      throw new Error(
        "output should not be committed when staged validate fails",
      );
    }
  });
});

Deno.test({
  name:
    "main spec-creator polish run path applies missing_judgment validation code",
  ignore: !hasBashRunPermission,
  fn: () => {
    const changeId = uniqueChangeId("update-polish-run-validation");
    const outputPath = `task_configs/spec_creator/${changeId}.json`;
    const workerRoot = Deno.makeTempDirSync();
    const workerPath = `${workerRoot}/missing_judgment_worker.sh`;
    const stateDir = `${workerRoot}/state`;
    Deno.writeTextFileSync(
      workerPath,
      [
        "#!/bin/sh",
        "set -eu",
        "echo 'RESULT: completed'",
        "echo 'SUMMARY: missing judgment on purpose'",
        "echo 'CHANGED_FILES: src/a.ts'",
        "echo 'CHECKS: deno test src'",
      ].join("\n"),
    );
    Deno.chmodSync(workerPath, 0o755);

    const buffer = createIoBuffer();
    try {
      withTemporaryChangeDir(changeId, () => {
        Deno.writeTextFileSync(
          `openspec/changes/${changeId}/README.md`,
          "# polish context\n- markdown source\n",
        );

        withFakeOpenSpecValidate("pass", () => {
          withEnvValue("ORCHESTRATOR_PROVIDER", "mock", () => {
            withEnvValue("ORCHESTRATOR_VALIDATION_MAX_RETRY", "1", () => {
              withEnvValue("TEAMMATE_ADAPTER", "subprocess", () => {
                withEnvValue(
                  "TEAMMATE_COMMAND",
                  `/bin/sh '${workerPath}'`,
                  () => {
                    const exitCode = main([
                      "spec-creator",
                      "polish",
                      changeId,
                      "--output",
                      outputPath,
                      "--state-dir",
                      stateDir,
                    ], buffer.io);
                    if (exitCode !== 0) {
                      throw new Error(
                        `spec-creator polish run path should succeed: ${buffer.state.stderr}`,
                      );
                    }
                  },
                );
              });
            });
          });
        });

        if (!buffer.state.stdout.includes("code=missing_judgment")) {
          throw new Error(
            `stdout should include missing_judgment validation code: ${buffer.state.stdout}`,
          );
        }
        if (
          !buffer.state.stdout.includes(
            "validation_retry_exhausted:missing_judgment",
          )
        ) {
          throw new Error(
            `stdout should include missing_judgment retry exhausted reason: ${buffer.state.stdout}`,
          );
        }

        const state = JSON.parse(
          Deno.readTextFileSync(`${stateDir}/state.json`),
        ) as { tasks?: Record<string, { block_reason?: string | null }> };
        const reasons = Object.values(state.tasks ?? {}).map((task) =>
          String(task.block_reason ?? "")
        );
        if (
          !reasons.some((reason) =>
            reason.includes("validation_retry_exhausted:missing_judgment")
          )
        ) {
          throw new Error(
            "state should keep validation_retry_exhausted:missing_judgment reason",
          );
        }
      });
    } finally {
      try {
        Deno.removeSync(workerRoot, { recursive: true });
      } catch {
        // noop
      }
      try {
        Deno.removeSync(outputPath);
      } catch {
        // noop
      }
    }
  },
});

Deno.test({
  name:
    "main spec-creator polish post-run failure keeps staged artifacts unapplied by default",
  ignore: !hasBashRunPermission,
  fn: () => {
    const changeId = uniqueChangeId("update-polish-post-run-fail-default");
    const revisedId = revisedChangeId(changeId);
    const outputPath = `task_configs/spec_creator/${changeId}.json`;
    const workerRoot = Deno.makeTempDirSync();
    const workerPath = `${workerRoot}/force_post_run_failure_worker.sh`;
    const stateDir = `${workerRoot}/state`;
    Deno.writeTextFileSync(
      workerPath,
      [
        "#!/bin/sh",
        "set -eu",
        'payload="$(/bin/cat)"',
        'if printf "%s" "$payload" | /usr/bin/grep -q \'"mode":"execute"\'; then',
        '  change_id="${OPENSPEC_CHANGE_ID:-}"',
        '  target_path="openspec/changes/${change_id}/tasks.md"',
        '  if [ -f "$target_path" ]; then',
        '    tmp_path="${target_path}.tmp"',
        '    /usr/bin/awk \'!/persona_policy/\' "$target_path" > "$tmp_path"',
        '    /bin/mv "$tmp_path" "$target_path"',
        "  fi",
        "fi",
        "echo 'RESULT: completed'",
        "echo 'SUMMARY: force post-run semantic guard failure'",
        "echo 'CHANGED_FILES: (none)'",
        "echo 'CHECKS: openspec validate sample --strict'",
        "echo 'JUDGMENT: pass'",
      ].join("\n"),
    );
    Deno.chmodSync(workerPath, 0o755);

    const buffer = createIoBuffer();
    try {
      withTemporaryChangeDir(changeId, () => {
        Deno.writeTextFileSync(
          `openspec/changes/${changeId}/README.md`,
          "# polish context\n- markdown source\n",
        );
        withFakeOpenSpecValidate("pass", () => {
          withEnvValue("ORCHESTRATOR_PROVIDER", "mock", () => {
            withEnvValue("TEAMMATE_ADAPTER", "subprocess", () => {
              withEnvValue("TEAMMATE_COMMAND", `/bin/sh '${workerPath}'`, () => {
                const exitCode = main([
                  "spec-creator",
                  "polish",
                  changeId,
                  "--output",
                  outputPath,
                  "--state-dir",
                  stateDir,
                ], buffer.io);
                if (exitCode !== 1) {
                  throw new Error(
                    "spec-creator polish should fail when post-run guard fails",
                  );
                }
              });
            });
          });
        });

        const revisedTasksPath = `openspec/changes/${revisedId}/tasks.md`;
        if (fileExists(revisedTasksPath)) {
          throw new Error(
            "revised tasks should not be applied on post-run failure by default",
          );
        }
        if (fileExists(outputPath)) {
          throw new Error(
            "output config should not be applied on post-run failure by default",
          );
        }
        if (
          buffer.state.stdout.includes(
            "applied_staged_artifacts_on_post_run_fail=1",
          )
        ) {
          throw new Error(
            "stdout should not include apply-on-post-run-fail marker by default",
          );
        }
      });
    } finally {
      try {
        Deno.removeSync(workerRoot, { recursive: true });
      } catch {
        // noop
      }
      try {
        Deno.removeSync(outputPath);
      } catch {
        // noop
      }
    }
  },
});

Deno.test({
  name:
    "main spec-creator polish --apply-on-post-run-fail applies staged artifacts before failing",
  ignore: !hasBashRunPermission,
  fn: () => {
    const changeId = uniqueChangeId("update-polish-post-run-fail-apply");
    const revisedId = revisedChangeId(changeId);
    const outputPath = `task_configs/spec_creator/${changeId}.json`;
    const workerRoot = Deno.makeTempDirSync();
    const workerPath = `${workerRoot}/force_post_run_failure_worker.sh`;
    const stateDir = `${workerRoot}/state`;
    Deno.writeTextFileSync(
      workerPath,
      [
        "#!/bin/sh",
        "set -eu",
        'payload="$(/bin/cat)"',
        'if printf "%s" "$payload" | /usr/bin/grep -q \'"mode":"execute"\'; then',
        '  change_id="${OPENSPEC_CHANGE_ID:-}"',
        '  target_path="openspec/changes/${change_id}/tasks.md"',
        '  if [ -f "$target_path" ]; then',
        '    tmp_path="${target_path}.tmp"',
        '    /usr/bin/awk \'!/persona_policy/\' "$target_path" > "$tmp_path"',
        '    /bin/mv "$tmp_path" "$target_path"',
        "  fi",
        "fi",
        "echo 'RESULT: completed'",
        "echo 'SUMMARY: force post-run semantic guard failure'",
        "echo 'CHANGED_FILES: (none)'",
        "echo 'CHECKS: openspec validate sample --strict'",
        "echo 'JUDGMENT: pass'",
      ].join("\n"),
    );
    Deno.chmodSync(workerPath, 0o755);

    const buffer = createIoBuffer();
    try {
      withTemporaryChangeDir(changeId, () => {
        Deno.writeTextFileSync(
          `openspec/changes/${changeId}/README.md`,
          "# polish context\n- markdown source\n",
        );
        withFakeOpenSpecValidate("pass", () => {
          withEnvValue("ORCHESTRATOR_PROVIDER", "mock", () => {
            withEnvValue("TEAMMATE_ADAPTER", "subprocess", () => {
              withEnvValue("TEAMMATE_COMMAND", `/bin/sh '${workerPath}'`, () => {
                const exitCode = main([
                  "spec-creator",
                  "polish",
                  changeId,
                  "--apply-on-post-run-fail",
                  "--output",
                  outputPath,
                  "--state-dir",
                  stateDir,
                ], buffer.io);
                if (exitCode !== 1) {
                  throw new Error(
                    "spec-creator polish should still fail when post-run guard fails",
                  );
                }
              });
            });
          });
        });

        const revisedTasksPath = `openspec/changes/${revisedId}/tasks.md`;
        if (!fileExists(revisedTasksPath)) {
          throw new Error(
            "revised tasks should be applied when --apply-on-post-run-fail is set",
          );
        }
        if (!fileExists(outputPath)) {
          throw new Error(
            "output config should be applied when --apply-on-post-run-fail is set",
          );
        }
        if (
          !buffer.state.stdout.includes(
            "applied_staged_artifacts_on_post_run_fail=1",
          )
        ) {
          throw new Error(
            "stdout should include apply-on-post-run-fail marker when enabled",
          );
        }
      });
    } finally {
      try {
        Deno.removeSync(workerRoot, { recursive: true });
      } catch {
        // noop
      }
      try {
        Deno.removeSync(outputPath);
      } catch {
        // noop
      }
    }
  },
});

Deno.test("main spec-creator polish requires existing change directory", () => {
  const buffer = createIoBuffer();
  const missingChangeId = uniqueChangeId("update-spec-creator");
  const exitCode = main(
    ["spec-creator", "polish", missingChangeId],
    buffer.io,
  );
  if (exitCode !== 1) {
    throw new Error(
      "spec-creator polish should fail for missing change directory",
    );
  }
  if (!buffer.state.stderr.includes("requires existing change_id directory")) {
    throw new Error(
      `stderr should include missing change directory error: ${buffer.state.stderr}`,
    );
  }
});

Deno.test("main spec-creator polish rejects existing revised change directory", () => {
  const changeId = uniqueChangeId("update-polish-existing-revised");
  const revisedId = revisedChangeId(changeId);
  withTemporaryChangeDir(changeId, () => {
    Deno.mkdirSync(`openspec/changes/${revisedId}`, { recursive: true });
    Deno.writeTextFileSync(
      `openspec/changes/${changeId}/README.md`,
      "# polish context\n- markdown source\n",
    );

    const buffer = createIoBuffer();
    const exitCode = main(["spec-creator", "polish", changeId], buffer.io);
    if (exitCode !== 1) {
      throw new Error(
        "spec-creator polish should fail when revised change directory exists",
      );
    }
    if (
      !buffer.state.stderr.includes(
        `requires non-existing change_id: ${revisedId}`,
      )
    ) {
      throw new Error(
        `stderr should include existing revised change error: ${buffer.state.stderr}`,
      );
    }
  });
});

Deno.test("main spec-creator legacy create rejects existing change_id", () => {
  const existingChangeId = uniqueChangeId("update-spec-creator");
  withTemporaryChangeDir(existingChangeId, () => {
    const buffer = createIoBuffer();
    const exitCode = main(
      ["spec-creator", "--change-id", existingChangeId],
      buffer.io,
    );
    if (exitCode !== 1) {
      throw new Error(
        "spec-creator should fail when change directory already exists",
      );
    }
    if (!buffer.state.stderr.includes("requires non-existing change_id")) {
      throw new Error(
        `stderr should include existing change directory error: ${buffer.state.stderr}`,
      );
    }
  });
});

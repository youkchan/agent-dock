import {
  buildTeammateAdapter,
  defaultTeammateCommand,
  main,
  parseTeammatesArg,
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

function withTemporaryChangeDir(changeId: string, fn: () => void): void {
  const dirPath = `openspec/changes/${changeId}`;
  Deno.mkdirSync(dirPath, { recursive: true });
  try {
    fn();
  } finally {
    Deno.removeSync(dirPath, { recursive: true });
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
    Deno.mkdirSync(`${fakeBin}/src/infrastructure/wrapper`, { recursive: true });
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
      JSON.stringify(adapter.planCommand) !== JSON.stringify(["echo", "explicit"])
    ) {
      throw new Error("plan command should use explicit teammate command");
    }
    if (
      JSON.stringify(adapter.executeCommand) !== JSON.stringify(["echo", "explicit"])
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
      const expected = `deno run --no-prompt --allow-read --allow-write --allow-env --allow-run ${runtimePath}`;
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
        `expected max_revision_cycles=9, got ${String(task.max_revision_cycles)}`,
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
        throw new Error(`run should return 0 with persona-dir: ${bufferWith.state.stderr}`);
      }
    });

    if (!bufferWith.state.stdout.includes('"stop_reason": "all_tasks_completed"')) {
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
      throw new Error(`stderr should include duplication error: ${buffer.state.stderr}`);
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
      throw new Error(`stderr should include duplication error: ${buffer.state.stderr}`);
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
    throw new Error(`stderr should include subcommand error: ${buffer.state.stderr}`);
  }
});

Deno.test("main spec-creator polish requires positional change_id", () => {
  const buffer = createIoBuffer();
  const exitCode = main(["spec-creator", "polish"], buffer.io);
  if (exitCode !== 1) {
    throw new Error("spec-creator polish should require change_id");
  }
  if (!buffer.state.stderr.includes("requires positional <change_id>")) {
    throw new Error(`stderr should include missing change_id error: ${buffer.state.stderr}`);
  }
});

Deno.test("main spec-creator polish uses existing markdown context without interactive TTY", () => {
  const changeId = uniqueChangeId("update-polish-context");
  const changeDir = `openspec/changes/${changeId}`;
  const outputPath = `task_configs/spec_creator/${changeId}.json`;
  Deno.mkdirSync(changeDir, { recursive: true });
  Deno.writeTextFileSync(
    `${changeDir}/README.md`,
    "# polish context\n- this file is used as source markdown context\n",
  );

  try {
    const buffer = createIoBuffer();
    const exitCode = main([
      "spec-creator",
      "polish",
      changeId,
      "--no-run",
      "--output",
      outputPath,
    ], buffer.io);

    if (exitCode !== 0) {
      throw new Error(`spec-creator polish should succeed: ${buffer.state.stderr}`);
    }
    if (buffer.state.stderr.includes("interactive TTY")) {
      throw new Error(`polish should not require interactive TTY: ${buffer.state.stderr}`);
    }
    if (!fileExists(outputPath)) {
      throw new Error("spec-creator polish should produce task_config output");
    }
  } finally {
    try {
      Deno.removeSync(changeDir, { recursive: true });
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
        throw new Error("spec-creator polish --no-run should fail when strict validate cannot run");
      }
    });
    if (!buffer.state.stderr.includes("openspec")) {
      throw new Error(`stderr should include openspec validate failure: ${buffer.state.stderr}`);
    }
    if (fileExists(outputPath)) {
      throw new Error("output should not be committed when staged validate fails");
    }
  });
});

Deno.test("main spec-creator polish requires existing change directory", () => {
  const buffer = createIoBuffer();
  const missingChangeId = uniqueChangeId("update-spec-creator");
  const exitCode = main(
    ["spec-creator", "polish", missingChangeId],
    buffer.io,
  );
  if (exitCode !== 1) {
    throw new Error("spec-creator polish should fail for missing change directory");
  }
  if (!buffer.state.stderr.includes("requires existing change_id directory")) {
    throw new Error(
      `stderr should include missing change directory error: ${buffer.state.stderr}`,
    );
  }
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
      throw new Error("spec-creator should fail when change directory already exists");
    }
    if (!buffer.state.stderr.includes("requires non-existing change_id")) {
      throw new Error(
        `stderr should include existing change directory error: ${buffer.state.stderr}`,
      );
    }
  });
});

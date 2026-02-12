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

function withCwd(nextCwd: string, run: () => void): void {
  const original = Deno.cwd();
  Deno.chdir(nextCwd);
  try {
    run();
  } finally {
    Deno.chdir(original);
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

Deno.test("buildTeammateAdapter requires default wrapper when commands are missing", () => {
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
      "Default wrapper was not found",
    );
  });
});

Deno.test("buildTeammateAdapter uses wrapper next to executable by default", () => {
  withTempDir((root) => {
    const fakeBin = `${root}/bin`;
    Deno.mkdirSync(fakeBin, { recursive: true });
    const fakeExec = `${fakeBin}/agent-dock`;
    const wrapperPath = `${fakeBin}/codex_wrapper.sh`;

    Deno.writeTextFileSync(fakeExec, "#!/usr/bin/env bash\n");
    Deno.writeTextFileSync(wrapperPath, "#!/usr/bin/env bash\n");

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
    const defaultCommand = defaultTeammateCommand(fakeExec);
    const expected = ["bash", wrapperPath];

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
    if (defaultCommand !== `bash ${wrapperPath}`) {
      throw new Error(`unexpected default command: ${defaultCommand}`);
    }
  });
});

Deno.test("buildTeammateAdapter falls back to parent directory wrapper", () => {
  withTempDir((root) => {
    const fakeExec = `${root}/dist/cli/agent-dock`;
    const wrapperPath = `${root}/codex_wrapper.sh`;

    Deno.mkdirSync(`${root}/dist/cli`, { recursive: true });
    Deno.writeTextFileSync(fakeExec, "#!/usr/bin/env bash\n");
    Deno.writeTextFileSync(wrapperPath, "#!/usr/bin/env bash\n");

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
    const expected = ["bash", wrapperPath];
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
    if (!buffer.state.stdout.includes('"openspec_change_id": "sync-run-change"')) {
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

      if (!buffer.state.stdout.includes('"stop_reason": "all_tasks_completed"')) {
        throw new Error("stdout should include successful stop reason");
      }
    });
  },
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

    if (!buffer.state.stdout.includes('"openspec_change_id": "add-sample-change"')) {
      throw new Error("stdout should include openspec_change_id");
    }
    if (buffer.state.stdout.includes("[run] synced_tasks_md=")) {
      throw new Error(
        "stdout should not include synced_tasks_md when running with --config",
      );
    }
  });
});

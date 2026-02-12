import { createTask } from "../../domain/task.ts";
import { parseCommand, SubprocessCodexAdapter } from "./subprocess.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual(
  actual: unknown,
  expected: unknown,
  message: string,
): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}: expected=${JSON.stringify(expected)} actual=${
        JSON.stringify(actual)
      }`,
    );
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

function withTempDir(run: (dir: string) => void): void {
  const dir = Deno.makeTempDirSync();
  try {
    run(dir);
  } finally {
    Deno.removeSync(dir, { recursive: true });
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

Deno.test("parseCommand supports shell-style quoted values", () => {
  const parsed = parseCommand("echo 'hello world' --flag", "test command");
  assertEqual(parsed, ["echo", "hello world", "--flag"], "parsed command");

  assertThrowsMessage(
    () => parseCommand("echo 'unterminated", "test command"),
    "unterminated quote",
  );
});

Deno.test("SubprocessCodexAdapter.emitProgress skips whitespace-only lines", () => {
  const received: Array<[string, string]> = [];
  SubprocessCodexAdapter.emitProgress(
    (source, text): void => {
      received.push([source, text]);
    },
    "stderr",
    " \n\t\nok-line\n",
  );

  assertEqual(received, [["stderr", "ok-line"]], "emitted progress lines");
});

Deno.test("SubprocessCodexAdapter runs plan/execute command via stdin payload", () => {
  withTempDir((dir) => {
    const scriptPath = `${dir}/worker.sh`;
    Deno.writeTextFileSync(
      scriptPath,
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        'payload="$(cat)"',
        'if [[ "$payload" == *\'"mode":"plan"\'* ]]; then',
        "  echo 'plan-output'",
        "else",
        "  echo 'execute-output'",
        "fi",
        "echo 'stderr-progress' >&2",
      ].join("\n"),
    );
    Deno.chmodSync(scriptPath, 0o755);

    withEnv("TEAMMATE_STREAM_LOGS", "0", () => {
      const adapter = new SubprocessCodexAdapter({
        planCommand: ["bash", scriptPath],
        executeCommand: ["bash", scriptPath],
        timeoutSeconds: 5,
      });

      const task = createTask({
        id: "T1",
        title: "sample",
        target_paths: ["src/a.ts"],
      });

      const plan = adapter.buildPlan("tm-1", task);
      assertEqual(plan, "plan-output", "plan output");

      const progress: Array<[string, string]> = [];
      const execute = adapter.executeTask(
        "tm-1",
        task,
        (source, text): void => {
          progress.push([source, text]);
        },
      );
      assertEqual(execute, "execute-output", "execute output");
      assert(
        progress.some(([source, text]) =>
          source === "stderr" && text.includes("stderr-progress")
        ),
        "stderr progress should be forwarded",
      );
    });
  });
});

Deno.test("SubprocessCodexAdapter surfaces command failure", () => {
  withTempDir((dir) => {
    const scriptPath = `${dir}/fail.sh`;
    Deno.writeTextFileSync(
      scriptPath,
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        "echo 'boom' >&2",
        "exit 7",
      ].join("\n"),
    );
    Deno.chmodSync(scriptPath, 0o755);

    const adapter = new SubprocessCodexAdapter({
      planCommand: ["bash", scriptPath],
      executeCommand: ["bash", scriptPath],
      timeoutSeconds: 5,
    });

    const task = createTask({
      id: "T1",
      title: "sample",
      target_paths: ["src/a.ts"],
    });

    assertThrowsMessage(
      () => adapter.buildPlan("tm-1", task),
      "command failed",
    );
  });
});

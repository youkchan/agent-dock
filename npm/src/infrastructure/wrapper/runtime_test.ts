type EnvMap = Record<string, string>;

type CommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

type FakeCodexConfig = {
  resultBlock?: string;
  exitCode?: string;
  stdout?: string;
  stderr?: string;
  skipResultFile?: boolean;
  mutateDotenvCommand?: string;
};

type ParityScenario = {
  payload: string;
  fakeCodexConfig?: FakeCodexConfig;
  env?: EnvMap;
};

const hasBashRunPermission =
  Deno.permissions.querySync({ name: "run", command: "bash" }).state === "granted";

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();
const wrapperPath = decodeURIComponent(
  new URL("../../../codex_wrapper.sh", import.meta.url).pathname,
);
const runtimePath = decodeURIComponent(new URL("./runtime.ts", import.meta.url).pathname);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function withTempDir(
  run: (root: string) => Promise<void> | void,
): Promise<void> {
  const root = Deno.makeTempDirSync();
  try {
    await run(root);
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
}

function createFakeCodex(rootDir: string, config: FakeCodexConfig = {}): string {
  const resultBlock = config.resultBlock ??
    "RESULT: completed\nSUMMARY: codex runtime parity baseline\nCHANGED_FILES: src/infrastructure/wrapper/runtime.ts\nCHECKS: deno test --allow-read";
  const scriptPath = `${rootDir}/codex`;
  const script = `#!/usr/bin/env bash
set -euo pipefail

output_file=""
while [[ "$#" -gt 0 ]]; do
  if [[ "$1" == "--output-last-message" ]]; then
    shift
    output_file="\${1-}"
    shift || true
  else
    shift
  fi
done

if [[ -n "\${FAKE_CODEX_STDOUT-}" ]]; then
  printf '%s' "\${FAKE_CODEX_STDOUT}"
fi

if [[ -n "\${FAKE_CODEX_STDERR-}" ]]; then
  printf '%s' "\${FAKE_CODEX_STDERR}" >&2
fi

if [[ -z "\${FAKE_CODEX_SKIP_RESULT_FILE-}" && -n "$output_file" ]]; then
  printf '%s' "\${FAKE_CODEX_RESULT:-${resultBlock}}" > "$output_file"
fi

if [[ -n "\${FAKE_CODEX_MUTATE_DOTENV-}" ]]; then
  eval "\${FAKE_CODEX_MUTATE_DOTENV}"
fi

exit "\${FAKE_CODEX_EXIT_CODE:-${config.exitCode ?? "0"}}"
`;

  Deno.writeTextFileSync(scriptPath, script);
  Deno.chmodSync(scriptPath, 0o755);
  return scriptPath;
}

function buildPayload(taskOverrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    mode: "execute",
    teammate_id: "tm-implementer",
    task: {
      id: "1.6",
      title: "runtime parity baseline",
      description: "validate legacy and ts runtime parity",
      target_paths: ["src/infrastructure/wrapper/runtime.ts"],
      depends_on: ["1.5"],
      requires_plan: false,
      progress_log: [
        {
          timestamp: 1771250305.479,
          source: "system",
          text: "execution started persona=implementer phase=implement",
        },
      ],
      ...taskOverrides,
    },
  });
}

async function runCommand(
  command: string,
  args: string[],
  env: EnvMap,
  payload: string,
): Promise<CommandResult> {
  const process = new Deno.Command(command, {
    args,
    env,
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();

  const stdinWriter = process.stdin.getWriter();
  try {
    await stdinWriter.write(textEncoder.encode(`${payload}\n`));
  } finally {
    stdinWriter.close();
  }

  const output = await process.output();
  return {
    code: output.code,
    stdout: textDecoder.decode(output.stdout),
    stderr: textDecoder.decode(output.stderr),
  };
}

function runLegacyWrapper(
  payload: string,
  fakeCodexPath: string,
  env: EnvMap,
): Promise<CommandResult> {
  const codexDir = fakeCodexPath.substring(0, fakeCodexPath.lastIndexOf("/"));
  const originalPath = Deno.env.get("PATH") ?? "/usr/bin:/bin";
  return runCommand("bash", [wrapperPath], {
    PATH: `${codexDir}:${originalPath}`,
    CODEX_BIN: fakeCodexPath,
    CODEX_WRAPPER_RUNTIME: "legacy",
    CODEX_STREAM_LOGS: "0",
    ...env,
  }, payload);
}

function runTsRuntime(
  payload: string,
  fakeCodexPath: string,
  env: EnvMap,
): Promise<CommandResult> {
  return runCommand("deno", [
    "run",
    "--no-prompt",
    "--allow-read",
    "--allow-write",
    "--allow-env",
    "--allow-run",
    runtimePath,
  ], {
    CODEX_BIN: fakeCodexPath,
    CODEX_STREAM_LOGS: "0",
    ...env,
  }, payload);
}

function compareParity(
  label: string,
  legacy: CommandResult,
  ts: CommandResult,
): void {
  const differences: string[] = [];

  if (legacy.code !== ts.code) {
    differences.push(
      `${label}: exit code mismatch (legacy=${legacy.code}, ts=${ts.code})`,
    );
  }

  if (legacy.stdout !== ts.stdout) {
    differences.push(
      `${label}: result block mismatch (legacy=${JSON.stringify(legacy.stdout)}, ts=${JSON.stringify(ts.stdout)})`,
    );
  }

  if (legacy.stderr !== ts.stderr) {
    differences.push(
      `${label}: stderr mismatch (legacy=${JSON.stringify(legacy.stderr)}, ts=${JSON.stringify(ts.stderr)})`,
    );
  }

  assert(differences.length === 0, differences.join("; "));
}

async function runParityScenario(
  label: string,
  scenario: ParityScenario,
): Promise<void> {
  await withTempDir(async (rootDir) => {
    const fakeCodexConfig = scenario.fakeCodexConfig ?? {};
    const baseResultBlock =
      "RESULT: completed\nSUMMARY: codex runtime parity baseline\nCHANGED_FILES: src/infrastructure/wrapper/runtime.ts\nCHECKS: deno test --allow-read";

    const runSingleRuntime = async (
      runtimeKind: "legacy" | "ts",
    ): Promise<CommandResult> => {
      const runtimeRoot = `${rootDir}/${runtimeKind}`;
      Deno.mkdirSync(runtimeRoot, { recursive: true });
      const fakeCodexPath = createFakeCodex(runtimeRoot, fakeCodexConfig);
      const env: EnvMap = {
        TARGET_PROJECT_DIR: runtimeRoot,
        FAKE_CODEX_RESULT: fakeCodexConfig.resultBlock ?? baseResultBlock,
        FAKE_CODEX_EXIT_CODE: fakeCodexConfig.exitCode ?? "0",
        CODEX_DENY_DOTENV: "1",
        CODEX_STREAM_LOGS: "0",
        ...scenario.env,
      };

      if (fakeCodexConfig.skipResultFile) {
        env.FAKE_CODEX_SKIP_RESULT_FILE = "1";
      }
      if (fakeCodexConfig.mutateDotenvCommand) {
        env.FAKE_CODEX_MUTATE_DOTENV = fakeCodexConfig.mutateDotenvCommand;
      }
      if (fakeCodexConfig.stdout) {
        env.FAKE_CODEX_STDOUT = fakeCodexConfig.stdout;
      }
      if (fakeCodexConfig.stderr) {
        env.FAKE_CODEX_STDERR = fakeCodexConfig.stderr;
      }

      if (runtimeKind === "legacy") {
        return await runLegacyWrapper(
          scenario.payload,
          fakeCodexPath,
          env,
        );
      }
      return await runTsRuntime(
        scenario.payload,
        fakeCodexPath,
        env,
      );
    };

    const legacy = await runSingleRuntime("legacy");
    const ts = await runSingleRuntime("ts");
    compareParity(label, legacy, ts);
  });
}

const RESULT_BASELINE =
  "RESULT: completed\nSUMMARY: ts legacy parity baseline\nCHANGED_FILES: src/infrastructure/wrapper/runtime.ts\nCHECKS: deno test --allow-read";
const RESULT_DECISION =
  "RESULT: completed\nSUMMARY: ts legacy parity decision baseline\nCHANGED_FILES: src/infrastructure/wrapper/runtime.ts\nCHECKS: deno test --allow-read\nJUDGMENT: pass";
const RESULT_NONIMPLEMENT_CHANGED =
  "RESULT: completed\nSUMMARY: ts legacy parity nonimplement changed\nCHANGED_FILES: src/infrastructure/wrapper/runtime_test.ts\nCHECKS: deno test --allow-read\nJUDGMENT: pass";

Deno.test({
  name: "legacy and ts runtime parity: implement normal",
  ignore: !hasBashRunPermission,
  fn: async () => {
    await runParityScenario("implement normal", {
      payload: buildPayload(),
      fakeCodexConfig: {
        resultBlock: RESULT_BASELINE,
      },
    });
  },
});

Deno.test({
  name: "legacy and ts runtime parity: decision normal",
  ignore: !hasBashRunPermission,
  fn: async () => {
    await runParityScenario("decision normal", {
      payload: buildPayload({ current_phase: "review" }),
      fakeCodexConfig: {
        resultBlock: RESULT_DECISION,
      },
    });
  },
});

Deno.test({
  name: "legacy and ts runtime parity: RESULT_PHASE invalid",
  ignore: !hasBashRunPermission,
  fn: async () => {
    await runParityScenario("RESULT_PHASE invalid", {
      payload: buildPayload(),
      fakeCodexConfig: {
        resultBlock: RESULT_BASELINE,
      },
      env: {
        RESULT_PHASE: "invalid",
      },
    });
  },
});

Deno.test({
  name: "legacy and ts runtime parity: empty payload",
  ignore: !hasBashRunPermission,
  fn: async () => {
    await runParityScenario("empty payload", {
      payload: "",
      fakeCodexConfig: {
        resultBlock: RESULT_BASELINE,
      },
    });
  },
});

Deno.test({
  name: "legacy and ts runtime parity: nonimplement + non-empty CHANGED_FILES",
  ignore: !hasBashRunPermission,
  fn: async () => {
    await runParityScenario("nonimplement + non-empty CHANGED_FILES", {
      payload: buildPayload({
        current_phase: "review",
        progress_log: [
          {
            timestamp: 1771250633.684,
            source: "system",
            text: "execution started persona=reviewer phase=review",
          },
        ],
      }),
      fakeCodexConfig: {
        resultBlock: RESULT_NONIMPLEMENT_CHANGED,
      },
    });
  },
});

Deno.test({
  name: "legacy and ts runtime parity: codex failure",
  ignore: !hasBashRunPermission,
  fn: async () => {
    await runParityScenario("codex failure", {
      payload: buildPayload(),
      fakeCodexConfig: {
        resultBlock: RESULT_BASELINE,
        exitCode: "7",
      },
    });
  },
});

Deno.test({
  name: "legacy and ts runtime parity: codex failure keeps codex exit over dotenv",
  ignore: !hasBashRunPermission,
  fn: async () => {
    await runParityScenario("codex failure keeps codex exit over dotenv", {
      payload: buildPayload(),
      fakeCodexConfig: {
        resultBlock: RESULT_BASELINE,
        exitCode: "7",
        mutateDotenvCommand:
          "printf 'MODIFIED=1\\n' >> \"$TARGET_PROJECT_DIR/.env\"",
      },
      env: {
        CODEX_DENY_DOTENV: "1",
      },
    });
  },
});

Deno.test({
  name: "legacy and ts runtime parity: empty output",
  ignore: !hasBashRunPermission,
  fn: async () => {
    await runParityScenario("empty output", {
      payload: buildPayload(),
      fakeCodexConfig: {
        skipResultFile: true,
      },
    });
  },
});

Deno.test({
  name: "legacy and ts runtime parity: dotenv modified detection",
  ignore: !hasBashRunPermission,
  fn: async () => {
    await runParityScenario("dotenv modified detection", {
      payload: buildPayload(),
      fakeCodexConfig: {
        resultBlock: RESULT_BASELINE,
        mutateDotenvCommand:
          "printf 'MODIFIED=1\\n' >> \"$TARGET_PROJECT_DIR/.env\"",
      },
    });
  },
});

Deno.test({
  name: "legacy and ts runtime parity: dotenv mutation ignored when CODEX_DENY_DOTENV=0",
  ignore: !hasBashRunPermission,
  fn: async () => {
    await runParityScenario("dotenv mutation ignored when CODEX_DENY_DOTENV=0", {
      payload: buildPayload(),
      fakeCodexConfig: {
        resultBlock: RESULT_BASELINE,
        mutateDotenvCommand:
          "printf 'MODIFIED=1\\n' >> \"$TARGET_PROJECT_DIR/.env\"",
      },
      env: {
        CODEX_DENY_DOTENV: "0",
      },
    });
  },
});

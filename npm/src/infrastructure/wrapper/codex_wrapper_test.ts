const hasBashRunPermission =
  Deno.permissions.querySync({ name: "run", command: "bash" }).state ===
    "granted";

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();
const wrapperPath = decodeURIComponent(
  new URL("../../../codex_wrapper.sh", import.meta.url).pathname,
);

type EnvMap = Record<string, string>;

interface WrapperRunResult {
  code: number;
  stdout: string;
  stderr: string;
}

interface FakeCodexConfig {
  resultBlock?: string;
  exitCode?: string;
}

async function withTempDir(run: (root: string) => Promise<void> | void): Promise<void> {
  const root = Deno.makeTempDirSync();
  try {
    await run(root);
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
}

function createFakeCodex(rootDir: string, config: FakeCodexConfig = {}): string {
  const scriptPath = `${rootDir}/codex`;
  const resultBlock = config.resultBlock ??
    "RESULT: completed\nSUMMARY: codex wrapper legacy baseline\nCHANGED_FILES: src/infrastructure/wrapper/codex_wrapper_test.ts\nCHECKS: deno test --allow-read";

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

if [[ -n "$output_file" ]]; then
  printf '%s' "\${FAKE_CODEX_RESULT:-${resultBlock}}" > "$output_file"
fi

exit "\${FAKE_CODEX_EXIT_CODE:-${config.exitCode ?? "0"}}"
`;
  Deno.writeTextFileSync(scriptPath, script);
  Deno.chmodSync(scriptPath, 0o755);
  return scriptPath;
}

async function runWrapper(
  options: {
    runtime?: string;
    payload?: string;
    codexPath?: string;
  } = {},
): Promise<WrapperRunResult> {
  const shellPath = Deno.env.get("PATH") ?? "/usr/bin:/bin";
  const codexDir = options.codexPath
    ? options.codexPath.substring(0, options.codexPath.lastIndexOf("/"))
    : "";
  const codexPathPrefix = codexDir.length > 0 ? `${codexDir}:` : "";
  const env: EnvMap = {
    PATH: `${codexPathPrefix}${shellPath}`,
    CODEX_BIN: options.codexPath ?? "codex",
    CODEX_STREAM_LOGS: "0",
    CODEX_DENY_DOTENV: "0",
  };
  if (options.runtime !== undefined) {
    env.CODEX_WRAPPER_RUNTIME = options.runtime;
  }

  const command = new Deno.Command("bash", {
    args: [wrapperPath],
    env,
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  });
  const process = command.spawn();
  const stdinWriter = process.stdin.getWriter();
  try {
    await stdinWriter.write(textEncoder.encode(options.payload ?? "{}\n"));
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

function buildPayload(): string {
  return JSON.stringify({
    mode: "execute",
    teammate_id: "tm-implementer",
    task: {
      id: "1.6",
      title: "codex wrapper legacy baseline",
      description: "verify legacy wrapper path",
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
    },
  });
}

Deno.test({
  name: "codex_wrapper runs legacy path by default",
  ignore: !hasBashRunPermission,
  fn: async () => {
    await withTempDir(async (rootDir) => {
      const codexPath = createFakeCodex(rootDir);
      const result = await runWrapper({
        payload: buildPayload(),
        codexPath,
      });
      if (result.code !== 0) {
        throw new Error(
          `expected exit code 0, got ${result.code}, stderr=${JSON.stringify(result.stderr)}`,
        );
      }
      if (!result.stdout.includes("RESULT: completed")) {
        throw new Error(`stdout should include result block: ${result.stdout}`);
      }
      if (result.stderr.includes("codex command not found")) {
        throw new Error(
          `stderr should not include codex not found: ${result.stderr}`,
        );
      }
      if (result.stderr.includes("CODEX_WRAPPER_RUNTIME=ts is not supported")) {
        throw new Error(
          "wrapper should not take ts fail-fast path when runtime is unset",
        );
      }
    });
  },
});

Deno.test({
  name: "codex_wrapper fails fast when CODEX_WRAPPER_RUNTIME=ts",
  ignore: !hasBashRunPermission,
  fn: async () => {
    await withTempDir(async (rootDir) => {
      const codexPath = createFakeCodex(rootDir);
      const result = await runWrapper({
        runtime: "ts",
        payload: buildPayload(),
        codexPath,
      });
      if (result.code !== 64) {
        throw new Error(`expected exit code 64, got ${result.code}`);
      }
      if (!result.stderr.includes("# [input-validation]")) {
        throw new Error(
          `stderr should include input-validation category: ${result.stderr}`,
        );
      }
      if (
        !result.stderr.includes(
          "CODEX_WRAPPER_RUNTIME=ts is not supported yet in this runtime shim",
        )
      ) {
        throw new Error(`stderr should include ts unsupported message`);
      }
    });
  },
});

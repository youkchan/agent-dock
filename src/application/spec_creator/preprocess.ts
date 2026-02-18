import {
  createSpecCreatorTaskConfigTemplate,
  type SpecCreatorTaskConfigTemplate,
} from "../../domain/spec_creator.ts";

export const SPEC_CREATOR_LANGS = ["ja", "en"] as const;

export type SpecCreatorLanguage = (typeof SPEC_CREATOR_LANGS)[number];

export interface SpecContext {
  requirements_text: string;
  language: SpecCreatorLanguage;
  runtime_stack: "typescript";
  persona_policy: {
    active_personas: string[];
  };
}

export interface SpecCreatorPreprocessResult {
  change_id: string;
  spec_context: SpecContext;
  task_config: SpecCreatorTaskConfig;
}

export interface SpecCreatorPromptIO {
  prompt(message: string): string | null;
  isInteractiveTerminal(): boolean;
}

interface CollectSpecContextOptions {
  changeId?: string | null;
  io?: SpecCreatorPromptIO;
  proposeChangeId?: (requirementsText: string) => string;
}

export interface SpecCreatorTaskConfig extends SpecCreatorTaskConfigTemplate {
  meta: {
    source_change_id: string;
    generated_by: "spec-creator-preprocess";
    spec_context: SpecContext;
  };
}

const DEFAULT_SPEC_CREATOR_PERSONAS = [
  "spec-planner",
  "spec-reviewer",
  "spec-code-creator",
];

const REQUIRED_REVIEW_CONTRACT_IDS = [
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

const REQUIRED_REVIEW_CONTRACT_ITEMS_BY_LANG: Record<
  SpecCreatorLanguage,
  string[]
> = {
  ja: [
    "RC-01 RESULT: 最終 result block 抽出と completed|blocked 正規化を定義する",
    "RC-02 SUMMARY: 抽出・必須・要約用途を定義する",
    "RC-03 CHANGED_FILES: 正規化し、非implementフェーズでは (none) を必須化する",
    "RC-04 CHECKS: 抽出・必須・禁止コマンド検査を定義する",
    "RC-05 JUDGMENT: decision phase 必須、pass|changes_required|blocked 正規化を定義する",
    "RC-06 判定時系列: blocked 即停止 / changes_required sendback / pass 前進を定義する",
    "RC-07 reviewer stop: REVIEWER_STOP:requirement_drift|over_editing|verbosity を明記する",
    "RC-08 実行経路対象: run と spec-creator の両方を対象にする",
    "RC-09 段階責務: compile と runtime の責務分離を明記する",
    "RC-10 入力契約キー: task_config.persona_policy.phase_overrides.<phase>.executor_personas を明記する",
    "RC-11 遷移条件: sendback 条件に blocked=false 前提を明記する",
    "RC-12 テスト契約: MUST/SHALL ごとに経路テストと fail-closed拒否テストを要求する",
  ],
  en: [
    "RC-01 RESULT: define last result block extraction and completed|blocked normalization",
    "RC-02 SUMMARY: define extraction, requiredness, and summary use",
    "RC-03 CHANGED_FILES: define normalization and require (none) in non-implement phases",
    "RC-04 CHECKS: define extraction, requiredness, and forbidden-command checks",
    "RC-05 JUDGMENT: define decision-phase requiredness and pass|changes_required|blocked normalization",
    "RC-06 decision timeline: blocked immediate stop / changes_required sendback / pass advance",
    "RC-07 reviewer stop: include REVIEWER_STOP:requirement_drift|over_editing|verbosity",
    "RC-08 path scope: cover both run and spec-creator paths",
    "RC-09 stage responsibility: separate compile and runtime responsibilities",
    "RC-10 input contract key: task_config.persona_policy.phase_overrides.<phase>.executor_personas",
    "RC-11 transition condition: sendback requires blocked=false precondition",
    "RC-12 test contract: require path test and fail-closed rejection test for each MUST/SHALL",
  ],
};

const DEFAULT_PROMPT_IO: SpecCreatorPromptIO = {
  prompt(message: string): string | null {
    return prompt(message);
  },
  isInteractiveTerminal(): boolean {
    return Deno.stdin.isTerminal() && Deno.stdout.isTerminal();
  },
};

export function normalizeChangeId(raw: string): string {
  const normalized = raw.trim();
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(normalized)) {
    throw new Error(
      "spec creator requires --change-id in kebab-case (e.g. sample-change)",
    );
  }
  if (normalized.length > 64) {
    throw new Error(
      "spec creator requires --change-id length <= 64 characters",
    );
  }
  return normalized;
}

export function collectSpecContextInteractive(
  options: CollectSpecContextOptions,
): SpecCreatorPreprocessResult {
  const io = options.io ?? DEFAULT_PROMPT_IO;

  if (!io.isInteractiveTerminal()) {
    throw new Error(
      "spec creator preprocessing requires interactive TTY (fail-closed)",
    );
  }

  const requirementsText = promptRequired(io, "requirements_text (required)");
  const language = promptLanguage(io);
  const changeId = resolveChangeIdInteractive(
    io,
    options.changeId,
    requirementsText,
    options.proposeChangeId ?? proposeChangeIdFromCodex,
  );

  if (!confirmSpecContext(io, changeId)) {
    throw new Error(
      "spec creator preprocessing aborted before spec_context confirmation (fail-closed)",
    );
  }

  const specContext = normalizeSpecContextForReviewContract({
    requirements_text: requirementsText,
    language,
    runtime_stack: "typescript",
    persona_policy: {
      active_personas: [...DEFAULT_SPEC_CREATOR_PERSONAS],
    },
  });

  return {
    change_id: changeId,
    spec_context: specContext,
    task_config: buildSpecCreatorTaskConfig(changeId, specContext),
  };
}

export function buildSpecCreatorTaskConfig(
  changeId: string,
  specContext: SpecContext,
): SpecCreatorTaskConfig {
  const normalizedSpecContext = normalizeSpecContextForReviewContract(
    specContext,
  );
  const template = createSpecCreatorTaskConfigTemplate(changeId);
  const contextText = buildSpecContextPromptSection(normalizedSpecContext);
  const tasks = template.tasks.map((task) => ({
    ...task,
    target_paths: [...task.target_paths],
    related_paths: [...task.related_paths],
    depends_on: [...task.depends_on],
    persona_policy: task.persona_policy === null
      ? null
      : structuredClone(task.persona_policy),
    output_phase_assignments: task.output_phase_assignments,
    description: `${
      withTaskReviewContractDescription(
        task.id,
        task.description,
        normalizedSpecContext.language,
      )
    }\n\n${contextText}`,
  }));

  return {
    teammates: [...template.teammates],
    personas: template.personas.map((persona) => structuredClone(persona)),
    persona_defaults: structuredClone(template.persona_defaults),
    tasks,
    meta: {
      source_change_id: changeId,
      generated_by: "spec-creator-preprocess",
      spec_context: structuredClone(normalizedSpecContext),
    },
  };
}

export function normalizeSpecContextForReviewContract(
  specContext: SpecContext,
): SpecContext {
  return {
    requirements_text: ensureRequiredReviewContractInRequirementsText(
      specContext.requirements_text,
      specContext.language,
    ),
    language: specContext.language,
    runtime_stack: specContext.runtime_stack,
    persona_policy: {
      active_personas: [...specContext.persona_policy.active_personas],
    },
  };
}

export function ensureRequiredReviewContractInRequirementsText(
  requirementsText: string,
  language: SpecCreatorLanguage,
): string {
  const normalized = requirementsText.trim();
  if (
    REQUIRED_REVIEW_CONTRACT_IDS.every((id) => normalized.includes(id))
  ) {
    return normalized;
  }
  const heading = language === "ja"
    ? "必須レビュー契約（RC-01..RC-12）:"
    : "Required review contract (RC-01..RC-12):";
  const lines = REQUIRED_REVIEW_CONTRACT_ITEMS_BY_LANG[language];
  return [
    normalized,
    "",
    heading,
    ...lines.map((line) => `- ${line}`),
  ].join("\n").trim();
}

function buildSpecContextPromptSection(specContext: SpecContext): string {
  const activePersonas = specContext.persona_policy.active_personas.length > 0
    ? specContext.persona_policy.active_personas.join(", ")
    : "(none)";
  const requirementsLines = toPromptMultilineBlock(
    specContext.requirements_text,
  );
  const contractLines = REQUIRED_REVIEW_CONTRACT_ITEMS_BY_LANG[
    specContext.language
  ];

  return [
    "spec_context:",
    "- requirements_text: |",
    ...requirementsLines.map((line) => `  ${line}`),
    "- required_review_contract: |",
    ...contractLines.map((line) => `  - ${line}`),
    `- language: ${specContext.language}`,
    `- runtime_stack: ${specContext.runtime_stack} (TypeScript-only runtime, use src/**/*.ts)`,
    `- active_personas: ${activePersonas}`,
  ].join("\n");
}

function withTaskReviewContractDescription(
  taskId: string,
  description: string,
  language: SpecCreatorLanguage,
): string {
  if (taskId !== "1.3") {
    return description;
  }
  if (/\bRC-01\b/u.test(description) && /\bRC-12\b/u.test(description)) {
    return description;
  }
  const summary = language === "ja"
    ? "RC-01..RC-12 を tasks.md(1.3) と specs/**/spec.md の両方へ同義で反映し、欠落は fail-closed とする。"
    : "Mirror RC-01..RC-12 in both tasks.md (1.3) and specs/**/spec.md, and fail-closed on any omission.";
  const items = REQUIRED_REVIEW_CONTRACT_ITEMS_BY_LANG[language]
    .map((line) => `- ${line}`);
  return [description.trim(), summary, ...items].join("\n");
}

function toPromptMultilineBlock(raw: string): string[] {
  const normalized = raw.replaceAll(/\r\n?/gu, "\n");
  const lines = normalized.split("\n");
  while (lines.length > 1 && lines[lines.length - 1].trim().length === 0) {
    lines.pop();
  }
  return lines.length > 0 ? lines : [""];
}

function promptRequired(io: SpecCreatorPromptIO, label: string): string {
  const value = io.prompt(`${label}:`);
  if (value === null) {
    throw new Error(
      `spec creator preprocessing failed: ${label} is required (fail-closed)`,
    );
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(
      `spec creator preprocessing failed: ${label} is required (fail-closed)`,
    );
  }
  return normalized;
}

function promptOptional(io: SpecCreatorPromptIO, label: string): string {
  const value = io.prompt(`${label}:`);
  return value === null ? "" : value.trim();
}

function promptLanguage(io: SpecCreatorPromptIO): SpecCreatorLanguage {
  const value = promptRequired(
    io,
    `language (${SPEC_CREATOR_LANGS.join("/")})`,
  );
  const normalized = value.toLowerCase();
  if (!SPEC_CREATOR_LANGS.includes(normalized as SpecCreatorLanguage)) {
    throw new Error(
      `spec creator preprocessing failed: language must be ${
        SPEC_CREATOR_LANGS.join(" or ")
      } (fail-closed)`,
    );
  }
  return normalized as SpecCreatorLanguage;
}

function resolveChangeIdInteractive(
  io: SpecCreatorPromptIO,
  rawChangeId: string | null | undefined,
  requirementsText: string,
  proposeChangeIdFn: (requirementsText: string) => string,
): string {
  const seeded = typeof rawChangeId === "string" ? rawChangeId.trim() : "";
  if (seeded.length > 0) {
    return normalizeChangeId(seeded);
  }

  const proposal = proposeChangeIdWithFallback(
    requirementsText,
    proposeChangeIdFn,
  );
  const entered = promptOptional(
    io,
    `change_id 第1案: ${proposal}\nchange_id (Enterで採用)`,
  );
  const selected = entered.trim().length > 0 ? entered.trim() : proposal;
  return normalizeChangeId(selected);
}

function proposeChangeIdWithFallback(
  requirementsText: string,
  proposeChangeIdFn: (requirementsText: string) => string,
): string {
  try {
    return normalizeChangeId(proposeChangeIdFn(requirementsText));
  } catch {
    return normalizeChangeId(proposeChangeIdLocal(requirementsText));
  }
}

function proposeChangeIdFromCodex(requirementsText: string): string {
  const prompt = [
    "Return only one change_id.",
    "Constraints:",
    "- one line only",
    "- kebab-case only",
    "- max 64 chars",
    "",
    `requirements_text: ${requirementsText}`,
  ].join("\n");

  const outputPath = Deno.makeTempFileSync({
    prefix: "spec_creator_change_id_",
    suffix: ".txt",
  });
  try {
    const { code, stderr } = new Deno.Command("codex", {
      args: [
        "exec",
        "--skip-git-repo-check",
        "--output-last-message",
        outputPath,
        prompt,
      ],
      stdout: "null",
      stderr: "piped",
    }).outputSync();
    if (code !== 0) {
      const message = new TextDecoder().decode(stderr).trim();
      throw new Error(message || "codex exec failed");
    }
    const raw = Deno.readTextFileSync(outputPath).trim();
    if (!raw) {
      throw new Error("codex returned empty change_id");
    }
    const line = raw.split(/\r?\n/u).map((item) => item.trim()).find((item) =>
      item.length > 0
    );
    if (!line) {
      throw new Error("codex returned no usable change_id line");
    }
    return line.replace(/^['"`]+|['"`]+$/gu, "");
  } finally {
    try {
      Deno.removeSync(outputPath);
    } catch {
      // noop
    }
  }
}

function proposeChangeIdLocal(requirementsText: string): string {
  const stopWords = new Set([
    "a",
    "an",
    "and",
    "the",
    "to",
    "for",
    "with",
    "of",
    "on",
    "in",
    "add",
    "change",
    "changes",
    "change_id",
    "id",
    "openspec",
    "markdown",
    "md",
    "yaml",
    "json",
    "agent",
    "dock",
  ]);
  const uniqueTokens: string[] = [];
  const tokens = requirementsText
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, " ")
    .trim()
    .split(/\s+/u)
    .filter((token) =>
      token.length > 1 &&
      !stopWords.has(token)
    );
  for (const token of tokens) {
    if (!uniqueTokens.includes(token)) {
      uniqueTokens.push(token);
    }
  }
  const body = uniqueTokens.slice(0, 4).join("-");
  if (!body) {
    return "change";
  }
  const candidate = body.slice(0, 64).replace(/-+$/u, "");
  return candidate || "change";
}

function confirmSpecContext(
  io: SpecCreatorPromptIO,
  changeId: string,
): boolean {
  const response = io.prompt(
    `Confirm spec_context for change_id='${changeId}'? [y/N]:`,
  );
  if (response === null) {
    return false;
  }
  const normalized = response.trim().toLowerCase();
  return normalized === "y" || normalized === "yes";
}

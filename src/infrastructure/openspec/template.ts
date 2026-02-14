export const SUPPORTED_TEMPLATE_LANGS = ["ja", "en"] as const;
export type SupportedTemplateLang = (typeof SUPPORTED_TEMPLATE_LANGS)[number];
export const DEFAULT_TEMPLATE_LANG: SupportedTemplateLang = "ja";

export interface OpenSpecTasksTemplateSections {
  preamble: string;
  implementationHeading: string;
  defaultImplementationBody: string;
  humanNotesHeading: string;
  defaultHumanNotesBody: string;
}

export interface NormalizeFixedLinesAndHeadingsOptions {
  filePath?: string;
  lang?: string;
}

export interface NormalizeFixedLinesAndHeadingsResult {
  markdown: string;
  fixedLineInsertions: number;
  headingNormalizations: number;
}

const PROVIDER_COMPLETION_GATE_SECTION_BY_LANG: Record<
  SupportedTemplateLang,
  string
> = {
  ja: `### 0.2 Provider 完了判定ゲート（固定）
- \`ORCHESTRATOR_PROVIDER=mock\` 実行のみでは完了扱いにしない。
- 対象プロジェクトの実運用実行経路での受け入れ実行を必須とする。
- \`not implemented\` 等の未実装エラーは未完了として扱う（fail-closed）。
`,
  en: `### 0.2 Provider Completion Gates (fixed)
- Do not treat runs with \`ORCHESTRATOR_PROVIDER=mock\` only as completion.
- Require acceptance execution on the target project's operational execution path.
- Treat \`not implemented\` and equivalent unimplemented errors as incomplete (fail-closed).
`,
};

const OPENSPEC_TASKS_TEMPLATE_BY_LANG: Record<SupportedTemplateLang, string> = {
  ja: `## 0. Persona Defaults
- persona_defaults.phase_order: implement, review, spec_check, test
- persona_defaults: {"phase_order":["implement","review","spec_check","test"]}
- フェーズ担当: implement=implementer; review=code-reviewer; spec_check=spec-checker; test=test-owner
- personas: [{"id":"implementer","role":"implementer","focus":"実装を前進させる","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}},{"id":"code-reviewer","role":"reviewer","focus":"品質と回帰リスクを確認する","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}},{"id":"spec-checker","role":"spec_guard","focus":"仕様逸脱を防ぐ","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}},{"id":"test-owner","role":"test_guard","focus":"検証の十分性を担保し、要件ごとにtransport経路テストとfail-closed拒否テストを確認する","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}}]

### 0.1 テンプレート利用ルール
- この雛形を \`openspec/changes/<change-id>/tasks.md\` にコピーし、\`<...>\` を実タスクで置換する。
- \`persona_defaults.phase_order\` と \`フェーズ担当\` の固定行は削除しない。
- \`personas:\` は **1行JSON** で記述する（YAMLの複数行形式は compiler が受理しない）。
- ペルソナを実行主体にする場合は \`personas\` 行を残す。消すと実行主体は \`teammate-*\` になる。
- 各タスクに \`- フェーズ担当:\` を記述し、\`implement=implementer; review=code-reviewer; spec_check=spec-checker; test=test-owner\` から必要なフェーズだけ選ぶ。
- 例: \`- フェーズ担当: implement=implementer; review=code-reviewer\`（未指定フェーズはグローバル既定を使う）。
- すべての実施項目（検証を含む）は **\`## 1. 実装タスク\` のチェックボックス付きタスク** として記述する（\`## 2. 検証項目\` は使わない）。
- 人間向けメモは \`## 2. 人間向けメモ（コンパイラ非対象）\` に **チェックボックスなし** で記述する。
- MUST/SHALL ごとに \`transport\` 経路（producer -> carrier -> consumer）を定義し、対象タスクへ明記する。
- MUST/SHALL ごとに fail-closed の拒否点（どこで、何を理由に reject/block するか）を定義し、対象タスクへ明記する。
- MUST/SHALL ごとに「経路テスト1件 + 拒否テスト1件」を対応付け、実行コマンドを対象タスクへ明記する。

${PROVIDER_COMPLETION_GATE_SECTION_BY_LANG.ja}

## 1. 実装タスク
- [ ] 1.1 <タスクタイトル>
  - 依存: なし
  - 対象: *
  - フェーズ担当: implement=implementer; review=code-reviewer
  - 成果物: <成果物または説明>
- [ ] 1.2 <次のタスクタイトル>
  - 依存: 1.1
  - 対象: <path/to/file>
  - フェーズ担当: implement=implementer; spec_check=spec-checker; test=test-owner
  - 成果物: <成果物または説明>

## 2. 人間向けメモ（コンパイラ非対象）
- メモ: <自由記述>
- 注意: <自由記述>
`,
  en: `## 0. Persona Defaults
- persona_defaults.phase_order: implement, review, spec_check, test
- persona_defaults: {"phase_order":["implement","review","spec_check","test"]}
- phase assignments: implement=implementer; review=code-reviewer; spec_check=spec-checker; test=test-owner
- personas: [{"id":"implementer","role":"implementer","focus":"drive implementation forward","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}},{"id":"code-reviewer","role":"reviewer","focus":"check quality and regression risk","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}},{"id":"spec-checker","role":"spec_guard","focus":"prevent requirement drift","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}},{"id":"test-owner","role":"test_guard","focus":"ensure verification completeness by checking both transport-path tests and fail-closed rejection tests per requirement","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}}]

### 0.1 Template Usage Rules
- Copy this template to \`openspec/changes/<change-id>/tasks.md\` and replace \`<...>\` placeholders.
- Keep the fixed lines for \`persona_defaults.phase_order\` and \`phase assignments\`.
- \`personas:\` must be written as **one-line JSON** (multi-line YAML is not accepted by the compiler).
- Keep the \`personas\` line when personas should execute tasks; if removed, execution falls back to \`teammate-*\`.
- Add \`- phase assignments:\` to each task and choose only needed pairs from \`implement=implementer; review=code-reviewer; spec_check=spec-checker; test=test-owner\`.
- Example: \`- phase assignments: implement=implementer; review=code-reviewer\` (unspecified phases keep global defaults).
- Put every executable item (including verification) in **\`## 1. Implementation\` as checkbox tasks** (\`## 2. Verification Checklist\` should not be used).
- Keep human notes under \`## 2. Human Notes (non-compiled)\` with **no checkboxes**.
- For each MUST/SHALL, define the \`transport\` path (producer -> carrier -> consumer) and map it to implementation tasks.
- For each MUST/SHALL, define fail-closed rejection points (where and why to reject/block) and map them to implementation tasks.
- For each MUST/SHALL, attach one transport-path test and one rejection test, and record executable commands in implementation tasks.

${PROVIDER_COMPLETION_GATE_SECTION_BY_LANG.en}

## 1. Implementation
- [ ] 1.1 <task title>
  - Depends on: none
  - Target paths: *
  - phase assignments: implement=implementer; review=code-reviewer
  - Description: <deliverable or description>
- [ ] 1.2 <next task title>
  - Depends on: 1.1
  - Target paths: <path/to/file>
  - phase assignments: implement=implementer; spec_check=spec-checker; test=test-owner
  - Description: <deliverable or description>

## 2. Human Notes (non-compiled)
- Note: <free text>
- Caution: <free text>
`,
};

function normalizeTemplateLang(lang: string): SupportedTemplateLang {
  const normalized = String(lang).trim().toLowerCase();
  if (normalized !== "ja" && normalized !== "en") {
    const allowed = SUPPORTED_TEMPLATE_LANGS.join(", ");
    throw new Error(
      `unsupported template language: ${lang} (allowed: ${allowed})`,
    );
  }
  return normalized;
}

export function getOpenSpecTasksTemplate(
  lang: string = DEFAULT_TEMPLATE_LANG,
): string {
  const normalized = normalizeTemplateLang(lang);
  return OPENSPEC_TASKS_TEMPLATE_BY_LANG[normalized];
}

export function getProviderCompletionGateSection(
  lang: string = DEFAULT_TEMPLATE_LANG,
): string {
  return PROVIDER_COMPLETION_GATE_SECTION_BY_LANG[normalizeTemplateLang(lang)];
}

export function getOpenSpecTasksTemplateSections(
  lang: string = DEFAULT_TEMPLATE_LANG,
): OpenSpecTasksTemplateSections {
  const template = getOpenSpecTasksTemplate(lang);
  const lines = template.split(/\r?\n/);
  const implementationIndex = lines.findIndex((line) =>
    /^\s*##\s+1\./u.test(line)
  );
  const humanNotesIndex = lines.findIndex((line) => /^\s*##\s+2\./u.test(line));

  if (implementationIndex <= 0 || humanNotesIndex <= implementationIndex) {
    throw new Error(`invalid tasks template structure: ${lang}`);
  }

  const preamble = lines.slice(0, implementationIndex).join("\n").trimEnd();
  const implementationHeading = lines[implementationIndex].trimEnd();
  const defaultImplementationBody = lines.slice(
    implementationIndex + 1,
    humanNotesIndex,
  ).join("\n").trim();
  const humanNotesHeading = lines[humanNotesIndex].trimEnd();
  const defaultHumanNotesBody = lines.slice(humanNotesIndex + 1).join("\n")
    .trim();

  if (!implementationHeading || !humanNotesHeading) {
    throw new Error(`invalid tasks template headings: ${lang}`);
  }

  return {
    preamble,
    implementationHeading,
    defaultImplementationBody,
    humanNotesHeading,
    defaultHumanNotesBody,
  };
}

export function normalizeFixedLinesAndHeadings(
  markdown: string,
  options: NormalizeFixedLinesAndHeadingsOptions = {},
): NormalizeFixedLinesAndHeadingsResult {
  const source = normalizeToLf(markdown);
  let lines = source.split("\n");
  let headingNormalizations = 0;
  let fixedLineInsertions = 0;

  const normalizedHeadingLines = normalizeAtxHeadings(lines);
  lines = normalizedHeadingLines.lines;
  headingNormalizations += normalizedHeadingLines.changes;

  if (isTasksMarkdown(options.filePath, lines)) {
    const lang = normalizeTemplateLang(
      options.lang ?? detectTasksTemplateLang(lines),
    );

    const normalizedTasksHeadings = normalizeTasksHeadings(lines, lang);
    lines = normalizedTasksHeadings.lines;
    headingNormalizations += normalizedTasksHeadings.changes;

    const fixedLines = collectRequiredTasksFixedLines(lang);
    const completed = completeMissingFixedLines(lines, fixedLines);
    lines = completed.lines;
    fixedLineInsertions += completed.insertions;
  }

  return {
    markdown: finalizeMarkdown(lines),
    fixedLineInsertions,
    headingNormalizations,
  };
}

function normalizeTasksHeadings(
  lines: string[],
  lang: SupportedTemplateLang,
): { lines: string[]; changes: number } {
  const sections = getOpenSpecTasksTemplateSections(lang);
  const normalized = [...lines];
  let changes = 0;

  const implementationIndex = normalized.findIndex((line) =>
    /^\s*##\s*1\./u.test(line)
  );
  const humanNotesIndex = normalized.findIndex((line) =>
    /^\s*##\s*2\./u.test(line)
  );

  if (implementationIndex >= 0) {
    const current = normalized[implementationIndex].trim();
    if (current !== sections.implementationHeading) {
      normalized[implementationIndex] = sections.implementationHeading;
      changes += 1;
    }
  } else {
    appendLineWithSpacing(normalized, sections.implementationHeading);
    appendBodyLines(normalized, sections.defaultImplementationBody);
    changes += 1;
  }

  const updatedHumanNotesIndex = normalized.findIndex((line) =>
    /^\s*##\s*2\./u.test(line)
  );
  if (updatedHumanNotesIndex >= 0) {
    const current = normalized[updatedHumanNotesIndex].trim();
    if (current !== sections.humanNotesHeading) {
      normalized[updatedHumanNotesIndex] = sections.humanNotesHeading;
      changes += 1;
    }
  } else {
    appendLineWithSpacing(normalized, sections.humanNotesHeading);
    appendBodyLines(normalized, sections.defaultHumanNotesBody);
    changes += 1;
  }

  return { lines: normalized, changes };
}

function normalizeAtxHeadings(
  lines: string[],
): { lines: string[]; changes: number } {
  const normalized: string[] = [];
  let inFence = false;
  let changes = 0;

  for (const line of lines) {
    if (isFenceLine(line)) {
      inFence = !inFence;
      normalized.push(line);
      continue;
    }

    if (inFence) {
      normalized.push(line);
      continue;
    }

    const next = normalizeHeadingLine(line);
    if (next !== line) {
      changes += 1;
    }
    normalized.push(next);
  }

  return { lines: normalized, changes };
}

function normalizeHeadingLine(line: string): string {
  const match = /^(\s{0,3})(#{1,6})(?:[ \t]*)(.*?)\s*$/.exec(line);
  if (!match) {
    return line;
  }
  const [, indent, marker, titleRaw] = match;
  const title = titleRaw.trim();
  if (!title) {
    return `${indent}${marker}`;
  }
  return `${indent}${marker} ${title}`;
}

function completeMissingFixedLines(
  lines: string[],
  fixedLines: string[],
): { lines: string[]; insertions: number } {
  if (fixedLines.length === 0) {
    return { lines, insertions: 0 };
  }

  const normalized = [...lines];
  const existing = new Set(normalized.map((line) => line.trim()));
  const missing = fixedLines.filter((line) => !existing.has(line.trim()));
  if (missing.length === 0) {
    return { lines: normalized, insertions: 0 };
  }

  const implementationIndex = normalized.findIndex((line) =>
    /^\s*##\s*1\./u.test(line)
  );
  const insertAt = implementationIndex >= 0 ? implementationIndex : normalized.length;
  const block = [...missing];
  if (
    insertAt > 0 &&
    normalized[insertAt - 1].trim().length > 0 &&
    block[0].trim().length > 0
  ) {
    block.unshift("");
  }
  if (
    insertAt < normalized.length &&
    normalized[insertAt].trim().length > 0 &&
    block[block.length - 1].trim().length > 0
  ) {
    block.push("");
  }

  normalized.splice(insertAt, 0, ...block);
  return {
    lines: normalized,
    insertions: missing.length,
  };
}

function collectRequiredTasksFixedLines(lang: SupportedTemplateLang): string[] {
  const templateLines = getOpenSpecTasksTemplate(lang).split(/\r?\n/);
  const required: string[] = [];

  const phaseOrder = findTemplateLine(
    templateLines,
    /^\s*-\s*persona_defaults\.phase_order\s*:/i,
    "persona_defaults.phase_order",
    lang,
  );
  const personaDefaults = findTemplateLine(
    templateLines,
    /^\s*-\s*persona_defaults\s*:/i,
    "persona_defaults",
    lang,
  );
  const phaseAssignments = findTemplateLine(
    templateLines,
    /^\s*-\s*(?:フェーズ担当|phase assignments)\s*:/iu,
    "phase assignments",
    lang,
  );
  const personas = findTemplateLine(
    templateLines,
    /^\s*-\s*personas\s*:/i,
    "personas",
    lang,
  );

  required.push(phaseOrder, personaDefaults, phaseAssignments, personas);

  const providerLines = getProviderCompletionGateSection(lang)
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
  required.push(...providerLines);

  return required;
}

function findTemplateLine(
  lines: string[],
  pattern: RegExp,
  label: string,
  lang: SupportedTemplateLang,
): string {
  const line = lines.find((entry) => pattern.test(entry));
  if (!line) {
    throw new Error(`template fixed line is missing: ${label}: ${lang}`);
  }
  return line.trimEnd();
}

function appendBodyLines(lines: string[], body: string): void {
  const entries = body.split(/\r?\n/).map((line) => line.trimEnd()).filter((line) =>
    line.length > 0
  );
  lines.push(...entries);
}

function appendLineWithSpacing(lines: string[], line: string): void {
  if (lines.length > 0 && lines[lines.length - 1].trim().length > 0) {
    lines.push("");
  }
  lines.push(line);
}

function detectTasksTemplateLang(lines: string[]): SupportedTemplateLang {
  const markdown = lines.join("\n");
  if (
    /##\s*1\.\s*Implementation\b/u.test(markdown) ||
    /\bphase assignments\s*:/iu.test(markdown) ||
    /Template Usage Rules/u.test(markdown)
  ) {
    return "en";
  }
  return "ja";
}

function isTasksMarkdown(filePath: string | undefined, lines: string[]): boolean {
  const normalizedPath = String(filePath ?? "").trim().toLowerCase();
  if (
    normalizedPath.endsWith("/tasks.md") ||
    normalizedPath.endsWith("\\tasks.md") ||
    normalizedPath === "tasks.md"
  ) {
    return true;
  }
  const markdown = lines.join("\n");
  return /persona_defaults\.phase_order/u.test(markdown) &&
    /^\s*##\s*1\./mu.test(markdown);
}

function isFenceLine(line: string): boolean {
  return /^\s*(?:```|~~~)/u.test(line);
}

function normalizeToLf(markdown: string): string {
  return markdown.replaceAll(/\r\n?/gu, "\n");
}

function finalizeMarkdown(lines: string[]): string {
  let end = lines.length;
  while (end > 0 && lines[end - 1].trim().length === 0) {
    end -= 1;
  }
  if (end === 0) {
    return "";
  }
  return `${lines.slice(0, end).join("\n")}\n`;
}

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
- personas: [{"id":"implementer","role":"implementer","focus":"実装を前進させる","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}},{"id":"code-reviewer","role":"reviewer","focus":"品質と回帰リスクを確認する","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}},{"id":"spec-checker","role":"spec_guard","focus":"仕様逸脱を防ぐ","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}},{"id":"test-owner","role":"test_guard","focus":"検証の十分性を担保する","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}}]

### 0.1 テンプレート利用ルール
- この雛形を \`openspec/changes/<change-id>/tasks.md\` にコピーし、\`<...>\` を実タスクで置換する。
- \`persona_defaults.phase_order\` と \`フェーズ担当\` の固定行は削除しない。
- \`personas:\` は **1行JSON** で記述する（YAMLの複数行形式は compiler が受理しない）。
- ペルソナを実行主体にする場合は \`personas\` 行を残す。消すと実行主体は \`teammate-*\` になる。
- 各タスクに \`- フェーズ担当:\` を記述し、\`implement=implementer; review=code-reviewer; spec_check=spec-checker; test=test-owner\` から必要なフェーズだけ選ぶ。
- 例: \`- フェーズ担当: implement=implementer; review=code-reviewer\`（未指定フェーズはグローバル既定を使う）。
- すべての実施項目（検証を含む）は **\`## 1. 実装タスク\` のチェックボックス付きタスク** として記述する（\`## 2. 検証項目\` は使わない）。
- 人間向けメモは \`## 2. 人間向けメモ（コンパイラ非対象）\` に **チェックボックスなし** で記述する。

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
  - フェーズ担当: spec_check=spec-checker; test=test-owner
  - 成果物: <成果物または説明>

## 2. 人間向けメモ（コンパイラ非対象）
- メモ: <自由記述>
- 注意: <自由記述>
`,
  en: `## 0. Persona Defaults
- persona_defaults.phase_order: implement, review, spec_check, test
- persona_defaults: {"phase_order":["implement","review","spec_check","test"]}
- phase assignments: implement=implementer; review=code-reviewer; spec_check=spec-checker; test=test-owner
- personas: [{"id":"implementer","role":"implementer","focus":"drive implementation forward","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}},{"id":"code-reviewer","role":"reviewer","focus":"check quality and regression risk","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}},{"id":"spec-checker","role":"spec_guard","focus":"prevent requirement drift","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}},{"id":"test-owner","role":"test_guard","focus":"ensure verification completeness","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}}]

### 0.1 Template Usage Rules
- Copy this template to \`openspec/changes/<change-id>/tasks.md\` and replace \`<...>\` placeholders.
- Keep the fixed lines for \`persona_defaults.phase_order\` and \`phase assignments\`.
- \`personas:\` must be written as **one-line JSON** (multi-line YAML is not accepted by the compiler).
- Keep the \`personas\` line when personas should execute tasks; if removed, execution falls back to \`teammate-*\`.
- Add \`- phase assignments:\` to each task and choose only needed pairs from \`implement=implementer; review=code-reviewer; spec_check=spec-checker; test=test-owner\`.
- Example: \`- phase assignments: implement=implementer; review=code-reviewer\` (unspecified phases keep global defaults).
- Put every executable item (including verification) in **\`## 1. Implementation\` as checkbox tasks** (\`## 2. Verification Checklist\` should not be used).
- Keep human notes under \`## 2. Human Notes (non-compiled)\` with **no checkboxes**.

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
  - phase assignments: spec_check=spec-checker; test=test-owner
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

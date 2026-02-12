import type { PersonaDefinition } from "./persona.ts";
import type { PersonaDefaults, TaskPersonaPolicy } from "./persona_policy.ts";

const SPEC_CREATOR_EXECUTION = {
  enabled: true,
  command_ref: "default",
  sandbox: "workspace-write",
  timeout_sec: 900,
} as const;

const SPEC_CREATOR_CHANGE_TASK_IDS = [
  "1.1",
  "1.2",
  "1.3",
  "1.4",
  "1.5",
  "1.6",
  "1.7",
] as const;

export type SpecCreatorChangeTaskId =
  (typeof SPEC_CREATOR_CHANGE_TASK_IDS)[number];

export interface SpecCreatorConfigTask {
  id: SpecCreatorChangeTaskId;
  title: string;
  description: string;
  target_paths: string[];
  depends_on: SpecCreatorChangeTaskId[];
  requires_plan: boolean;
  persona_policy: TaskPersonaPolicy | null;
}

export interface SpecCreatorTaskConfigTemplate {
  teammates: string[];
  personas: PersonaDefinition[];
  persona_defaults: PersonaDefaults;
  tasks: SpecCreatorConfigTask[];
}

export function createSpecCreatorTaskConfigTemplate(
  changeId: string,
): SpecCreatorTaskConfigTemplate {
  const changeDir = `openspec/changes/${changeId}`;
  const proposalPath = `${changeDir}/proposal.md`;
  const tasksPath = `${changeDir}/tasks.md`;
  const designPath = `${changeDir}/design.md`;
  const codeSummaryPath = `${changeDir}/code_summary.md`;
  const allOutputPaths = [proposalPath, tasksPath, designPath, codeSummaryPath];

  return {
    teammates: ["spec-planner", "spec-reviewer", "spec-code-creator"],
    personas: [
      createPersona(
        "implementer",
        "implementer",
        "実装を前進させる",
        false,
        false,
      ),
      createPersona(
        "code-reviewer",
        "reviewer",
        "品質と回帰リスクを確認する",
        false,
        false,
      ),
      createPersona(
        "spec-checker",
        "spec_guard",
        "仕様逸脱を防ぐ",
        false,
        false,
      ),
      createPersona(
        "test-owner",
        "test_guard",
        "検証の十分性を担保する",
        false,
        false,
      ),
      createPersona(
        "spec-planner",
        "spec_guard",
        "要件をOpenSpec構成へ正規化し、要件外追加を禁止する",
        false,
        true,
      ),
      createPersona(
        "spec-reviewer",
        "reviewer",
        "proposal/tasks/design/code_summaryの整合と過不足を検証し、要件外追加・過剰修正・冗長化を禁止する",
        true,
        true,
      ),
      createPersona(
        "spec-code-creator",
        "spec_guard",
        "実装認知負荷低減のためcode_summary.mdにコード粒度と対応関係を明記する",
        false,
        true,
      ),
    ],
    persona_defaults: {
      phase_order: ["implement", "review"],
      phase_policies: {
        implement: createPhasePolicy("spec-planner"),
        review: createPhasePolicy("spec-reviewer"),
      },
    },
    tasks: [
      {
        id: "1.1",
        title: "要件をOpenSpec要素へ正規化する",
        description:
          "requirements/non_goals を整理し、change の最小スコープを定義する。",
        target_paths: [...allOutputPaths],
        depends_on: [],
        requires_plan: false,
        persona_policy: createTaskPersonaPolicy({
          implementPersona: "spec-planner",
          reviewPersona: "spec-reviewer",
        }),
      },
      {
        id: "1.2",
        title: "proposal.md を生成する",
        description: "変更理由、変更内容、影響範囲を proposal.md に記述する。",
        target_paths: [proposalPath],
        depends_on: ["1.1"],
        requires_plan: false,
        persona_policy: createTaskPersonaPolicy({
          implementPersona: "spec-planner",
          reviewPersona: "spec-reviewer",
        }),
      },
      {
        id: "1.3",
        title: "tasks.md を固定テンプレート準拠で生成する",
        description:
          "print-openspec-template の固定行を維持し、実装タスクを checklist 形式で定義する。",
        target_paths: [tasksPath],
        depends_on: ["1.2"],
        requires_plan: false,
        persona_policy: createTaskPersonaPolicy({
          implementPersona: "spec-planner",
          reviewPersona: "spec-reviewer",
        }),
      },
      {
        id: "1.4",
        title: "必要時に design.md を生成する",
        description:
          "設計上の判断が必要な場合のみ design.md を作成し、意思決定とトレードオフを記述する。",
        target_paths: [designPath],
        depends_on: ["1.2"],
        requires_plan: false,
        persona_policy: createTaskPersonaPolicy({
          implementPersona: "spec-planner",
          reviewPersona: "spec-reviewer",
        }),
      },
      {
        id: "1.5",
        title: "code_summary.md を生成する",
        description:
          "tasks.md の task_id と code unit の対応を code_summary.md に記述する。",
        target_paths: [codeSummaryPath],
        depends_on: ["1.3"],
        requires_plan: false,
        persona_policy: createTaskPersonaPolicy({
          implementPersona: "spec-code-creator",
          reviewPersona: "spec-reviewer",
        }),
      },
      {
        id: "1.6",
        title: "生成成果物の整合性をレビューする",
        description:
          "proposal/tasks/design/code_summary の整合、要件逸脱、過剰修正、冗長化を検証する。",
        target_paths: [...allOutputPaths],
        depends_on: ["1.2", "1.3", "1.4", "1.5"],
        requires_plan: false,
        persona_policy: createTaskPersonaPolicy({
          implementPersona: "spec-reviewer",
        }),
      },
      {
        id: "1.7",
        title: "OpenSpec strict validate を実行する",
        description:
          "openspec validate <change_id> --strict を実行し、失敗時は修正後に再実行する。",
        target_paths: [...allOutputPaths],
        depends_on: ["1.6"],
        requires_plan: false,
        persona_policy: createTaskPersonaPolicy({
          implementPersona: "spec-reviewer",
        }),
      },
    ],
  };
}

function createPersona(
  id: string,
  role: PersonaDefinition["role"],
  focus: string,
  canBlock: boolean,
  enabled: boolean,
): PersonaDefinition {
  return {
    id,
    role,
    focus,
    can_block: canBlock,
    enabled,
    execution: {
      ...SPEC_CREATOR_EXECUTION,
    },
  };
}

function createPhasePolicy(personaId: string): {
  active_personas: string[];
  executor_personas: string[];
  state_transition_personas: string[];
} {
  return {
    active_personas: [personaId],
    executor_personas: [personaId],
    state_transition_personas: [personaId],
  };
}

function createTaskPersonaPolicy(
  options: {
    implementPersona: string;
    reviewPersona?: string;
  },
): TaskPersonaPolicy {
  const policy: TaskPersonaPolicy = {
    phase_order: options.reviewPersona
      ? ["implement", "review"]
      : ["implement"],
    phase_overrides: {
      implement: createPhasePolicy(options.implementPersona),
    },
  };
  if (options.reviewPersona) {
    policy.phase_overrides = {
      ...policy.phase_overrides,
      review: createPhasePolicy(options.reviewPersona),
    };
  }
  return policy;
}

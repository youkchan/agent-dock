import type {
  ProgressCallback,
  TeammateAdapter,
} from "../../application/orchestrator/orchestrator.ts";
import type { Task } from "../../domain/task.ts";

export class TemplateTeammateAdapter implements TeammateAdapter {
  readonly planTemplate: string;
  readonly resultTemplate: string;

  constructor(options: {
    planTemplate?: string;
    resultTemplate?: string;
  } = {}) {
    this.planTemplate = options.planTemplate ?? [
      "1) Clarify acceptance criteria",
      "2) Edit owned files only",
      "3) Run local checks and report",
    ].join("\n");
    this.resultTemplate = options.resultTemplate ?? [
      "RESULT: completed",
      "SUMMARY: Implemented task {task_id} on {paths}",
      "CHANGED_FILES: {paths}",
      "CHECKS: template-adapter",
    ].join("\n");
  }

  buildPlan(teammateId: string, task: Task): string {
    const paths = task.target_paths.length > 0
      ? task.target_paths.join(", ")
      : "(no paths)";
    return [
      `teammate=${teammateId}`,
      `task=${task.id}`,
      `target_paths=${paths}`,
      this.planTemplate,
    ].join("\n");
  }

  executeTask(
    _teammateId: string,
    task: Task,
    _progressCallback?: ProgressCallback,
  ): string {
    const paths = task.target_paths.length > 0
      ? task.target_paths.join(", ")
      : "(no paths)";
    return this.resultTemplate
      .replace("{task_id}", task.id)
      .replace("{paths}", paths);
  }
}

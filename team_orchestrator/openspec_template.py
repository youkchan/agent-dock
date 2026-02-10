from __future__ import annotations

import textwrap

SUPPORTED_TEMPLATE_LANGS: tuple[str, ...] = ("ja", "en")
DEFAULT_TEMPLATE_LANG = "ja"

OPENSPEC_TASKS_TEMPLATE_BY_LANG: dict[str, str] = {
    "ja": textwrap.dedent(
        """\
        ## 0. Persona Defaults
        - persona_defaults.phase_order: implement, review, spec_check, test
        - persona_defaults: {"phase_order":["implement","review","spec_check","test"]}
        - フェーズ担当: implement=implementer; review=code-reviewer; spec_check=spec-checker; test=test-owner
        - personas: [{"id":"implementer","role":"implementer","focus":"実装を前進させる","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}},{"id":"code-reviewer","role":"reviewer","focus":"品質と回帰リスクを確認する","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}},{"id":"spec-checker","role":"spec_guard","focus":"仕様逸脱を防ぐ","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}},{"id":"test-owner","role":"test_guard","focus":"検証の十分性を担保する","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}}]

        ### 0.1 テンプレート利用ルール
        - この雛形を `openspec/changes/<change-id>/tasks.md` にコピーし、`<...>` を実タスクで置換する。
        - `persona_defaults.phase_order` と `フェーズ担当` の固定行は削除しない。
        - `personas:` は **1行JSON** で記述する（YAMLの複数行形式は compiler が受理しない）。
        - ペルソナを実行主体にする場合は `personas` 行を残す。消すと実行主体は `teammate-*` になる。
        - 各タスクに `- フェーズ担当:` を記述し、`implement=implementer; review=code-reviewer; spec_check=spec-checker; test=test-owner` から必要なフェーズだけ選ぶ。
        - 例: `- フェーズ担当: implement=implementer; review=code-reviewer`（未指定フェーズはグローバル既定を使う）。

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

        ## 2. 検証項目
        - [ ] <検証コマンドまたは確認内容>
        - [ ] <検証コマンドまたは確認内容>
        """
    ),
    "en": textwrap.dedent(
        """\
        ## 0. Persona Defaults
        - persona_defaults.phase_order: implement, review, spec_check, test
        - persona_defaults: {"phase_order":["implement","review","spec_check","test"]}
        - phase assignments: implement=implementer; review=code-reviewer; spec_check=spec-checker; test=test-owner
        - personas: [{"id":"implementer","role":"implementer","focus":"drive implementation forward","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}},{"id":"code-reviewer","role":"reviewer","focus":"check quality and regression risk","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}},{"id":"spec-checker","role":"spec_guard","focus":"prevent requirement drift","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}},{"id":"test-owner","role":"test_guard","focus":"ensure verification completeness","can_block":false,"enabled":true,"execution":{"enabled":true,"command_ref":"default","sandbox":"workspace-write","timeout_sec":900}}]

        ### 0.1 Template Usage Rules
        - Copy this template to `openspec/changes/<change-id>/tasks.md` and replace `<...>` placeholders.
        - Keep the fixed lines for `persona_defaults.phase_order` and `phase assignments`.
        - `personas:` must be written as **one-line JSON** (multi-line YAML is not accepted by the compiler).
        - Keep the `personas` line when personas should execute tasks; if removed, execution falls back to `teammate-*`.
        - Add `- phase assignments:` to each task and choose only needed pairs from `implement=implementer; review=code-reviewer; spec_check=spec-checker; test=test-owner`.
        - Example: `- phase assignments: implement=implementer; review=code-reviewer` (unspecified phases keep global defaults).

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

        ## 2. Verification Checklist
        - [ ] <check command or assertion>
        - [ ] <check command or assertion>
        """
    ),
}


def get_openspec_tasks_template(lang: str = DEFAULT_TEMPLATE_LANG) -> str:
    normalized_lang = str(lang).strip().lower()
    template = OPENSPEC_TASKS_TEMPLATE_BY_LANG.get(normalized_lang)
    if template is None:
        allowed = ", ".join(SUPPORTED_TEMPLATE_LANGS)
        raise ValueError(f"unsupported template language: {lang} (allowed: {allowed})")
    return template

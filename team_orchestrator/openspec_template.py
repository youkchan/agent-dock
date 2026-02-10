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

        ### 0.1 テンプレート利用ルール
        - この雛形を `openspec/changes/<change-id>/tasks.md` にコピーし、`<...>` を実タスクで置換する。
        - `persona_defaults.phase_order` と `フェーズ担当` の固定行は削除しない。
        - ペルソナを実行主体にする場合のみ `personas:` を追加し、対象ペルソナに `execution.enabled: true` を設定する。

        ## 1. 実装タスク
        - [ ] 1.1 <タスクタイトル>
          - 依存: なし
          - 対象: *
          - 成果物: <成果物または説明>
        - [ ] 1.2 <次のタスクタイトル>
          - 依存: 1.1
          - 対象: <path/to/file>
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

        ### 0.1 Template Usage Rules
        - Copy this template to `openspec/changes/<change-id>/tasks.md` and replace `<...>` placeholders.
        - Keep the fixed lines for `persona_defaults.phase_order` and `phase assignments`.
        - Only when personas should execute tasks directly, add `personas:` and set `execution.enabled: true` for those personas.

        ## 1. Implementation
        - [ ] 1.1 <task title>
          - Depends on: none
          - Target paths: *
          - Description: <deliverable or description>
        - [ ] 1.2 <next task title>
          - Depends on: 1.1
          - Target paths: <path/to/file>
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

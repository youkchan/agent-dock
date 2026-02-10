# overrides format

`task_configs/overrides/<change-id>.yaml` は OpenSpec コンパイル結果への上書き定義です。

## allowed top-level keys
- `teammates`
- `tasks`
- `requires_plan`
- `depends_on`

## example
```yaml
teammates:
  - teammate-a
  - teammate-b

requires_plan:
  T-003: true

depends_on:
  T-005:
    - T-001
    - T-002

tasks:
  T-002:
    title: "実行用タイトル"
    description: "補足説明"
    target_paths:
      - src/orchestrator/*
    depends_on:
      - T-001
    requires_plan: true
```

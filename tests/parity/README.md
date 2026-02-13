# parity fixtures 運用メモ

このディレクトリは TypeScript ランタイムの parity 比較専用 fixture を管理する。  
判定ルールは `docs/ts-parity-gate.md` を正とする。

## 構成

```text
tests/parity/
  fixtures/
    compile/
    state/
    cli/
```

## fixture ルール
- `compile/`: 同一入力に対する compile 出力の比較 fixture。
- `state/`: 実行ステップ単位の `state.json` snapshot 比較 fixture。
- `cli/`: CLI コマンドの stdout/stderr/exit code 比較 fixture。
- 期待値は正規化後データで保持し、揮発値（timestamp など）は保存しない。
- fixture 更新は仕様変更追従時のみ許可し、更新理由を PR に記録する。

# Design

## Context
- 本 change では `spec-creator polish` の処理境界を厳密化するため、CLI 契約、走査範囲、ファイル種別ごとの動作、出力契約を固定する。
- task 1.4 の要求は「設計判断が必要な場合のみ `design.md` を作成し、判断理由とトレードオフを残す」こと。
- 本 change は CLI 層・OpenSpec 処理層・受け入れ条件の横断的整合が必要なため、判断の明文化が必要と判断する。

## Goals / Non-Goals
- Goals:
  - `design.md` 作成要否の判定基準を固定し、不要な design 作成を防ぐ。
  - 必要時に残すべき設計情報（意思決定・代替案・トレードオフ）を明確化する。
  - polish の fail-closed/idempotent/非Markdown無変更の設計意図を実装前に固定する。
- Non-Goals:
  - design 不要ケースでの `design.md` 強制作成。
  - 非Markdownの整形・自動修復。
  - `openspec/changes/<change-id>/` 外への走査拡張。
  - polish 以外の spec creator 機能拡張。

## Decision
- Decision: `design.md` は以下のいずれかを満たす場合のみ作成する。
  - 複数モジュール/層にまたがる設計判断がある。
  - fail-closed、移行、性能、セキュリティなどで明示的なトレードオフがある。
  - 仕様文だけでは実装境界が曖昧で、実装前に判断固定が必要。
- Decision: 本 change は上記に該当するため `design.md` を作成する。
  - CLI 契約（必須引数・非存在 ID の即失敗）と処理層（再帰走査・非Markdown無変更）を一貫させる必要がある。
  - 受け入れ条件として idempotency と compile 成功を同時に満たす設計判断が必要。

## Alternatives Considered
- Alternative: `design.md` を作らず `proposal.md` と `tasks.md` のみで進める。
  - Rejected: fail-closed と非Markdown不変条件の意図が分散し、実装者解釈にぶれが出るため。
- Alternative: 常に `design.md` を作成する。
  - Rejected: 小規模変更でも文書コストが増え、要否判断の規律が失われるため。

## Trade-offs
- 明示的に `design.md` を作る利点:
  - 判断根拠と境界条件を先に固定でき、仕様逸脱を減らせる。
- 明示的に `design.md` を作る欠点:
  - 文書メンテナンスコストが増える。
- 採用方針:
  - 「必要時のみ作成」を原則にし、本 change のように横断判断がある場合だけ作成してコストと明確性を両立する。

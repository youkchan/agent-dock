from __future__ import annotations

import argparse
import json
from pathlib import Path

from team_orchestrator.models import Task
from team_orchestrator.state_store import StateStore


def _task_policy() -> dict:
    return {
        "phase_order": ["implement"],
        "phase_overrides": {
            "implement": {
                "active_personas": ["implementer"],
                "executor_personas": ["implementer"],
                "state_transition_personas": ["implementer"],
            }
        },
    }


def _snapshot(state_dir: Path) -> dict:
    return json.loads((state_dir / "state.json").read_text(encoding="utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate Python state parity snapshots")
    parser.add_argument("--state-dir", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    store = StateStore(args.state_dir)
    snapshots: dict[str, dict] = {}

    store.bootstrap_tasks(
        [
            Task(
                id="T-001",
                title="Plan first",
                requires_plan=True,
                target_paths=["src/a.ts"],
                persona_policy=_task_policy(),
            ),
            Task(
                id="T-002",
                title="Follow up",
                depends_on=["T-001"],
                target_paths=["src/b.ts"],
            ),
        ],
        replace=True,
    )
    snapshots["after_bootstrap"] = _snapshot(args.state_dir)

    claimed_plan = store.claim_plan_task("tm-1")
    if claimed_plan is None:
        raise RuntimeError("failed to claim plan task")
    snapshots["after_claim"] = _snapshot(args.state_dir)

    store.submit_plan("T-001", "tm-1", "Plan: implement and validate.")
    snapshots["after_plan_submitted"] = _snapshot(args.state_dir)

    store.review_plan("T-001", "lead", "approve", "approved")
    snapshots["after_approval"] = _snapshot(args.state_dir)

    claimed_exec = store.claim_execution_task("tm-1")
    if claimed_exec is None:
        raise RuntimeError("failed to claim execution task")
    store.append_task_progress_log("T-001", "stdout", "implemented")
    snapshots["after_claim_execution"] = _snapshot(args.state_dir)

    store.complete_task("T-001", "tm-1", "done")
    snapshots["after_completed"] = _snapshot(args.state_dir)

    claimed_next = store.claim_execution_task("tm-2")
    if claimed_next is None:
        raise RuntimeError("failed to claim dependent task")
    snapshots["after_second_claim"] = _snapshot(args.state_dir)

    store.requeue_in_progress_tasks()
    snapshots["after_resume_recovery"] = _snapshot(args.state_dir)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(snapshots, ensure_ascii=True, indent=2, sort_keys=True),
        encoding="utf-8",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


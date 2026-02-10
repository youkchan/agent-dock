from __future__ import annotations

import argparse
import json
import os
import shlex
import sys
from pathlib import Path
from typing import Any

from .adapter import TemplateTeammateAdapter
from .codex_adapter import SubprocessCodexAdapter
from .models import Task
from .openspec_compiler import (
    OpenSpecCompileError,
    compile_change_to_config,
    default_compiled_output_path,
    write_compiled_config,
)
from .orchestrator import AgentTeamsLikeOrchestrator, OrchestratorConfig
from .persona_catalog import PersonaDefinition, load_personas_from_payload
from .provider import build_provider_from_env
from .state_store import StateStore


def _load_tasks(config_path: Path) -> tuple[list[Task], list[str], list[PersonaDefinition]]:
    with config_path.open("r", encoding="utf-8") as handle:
        raw = json.load(handle)
    return _load_tasks_payload(raw, source_label=str(config_path))


def _load_tasks_payload(raw: dict[str, Any], source_label: str) -> tuple[list[Task], list[str], list[PersonaDefinition]]:
    personas = load_personas_from_payload(raw=raw, source_label=source_label)
    tasks = [Task.from_dict(item) for item in raw.get("tasks", [])]
    for task in tasks:
        if not task.target_paths:
            raise ValueError(f"task {task.id} must define target_paths ({source_label})")
    teammates = raw.get("teammates", [])
    return tasks, [str(item) for item in teammates], personas


def _safe_int_env(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _parse_command(raw: str, label: str) -> list[str]:
    parts = shlex.split(raw)
    if not parts:
        raise ValueError(f"{label} is empty")
    return parts


def _parse_teammates_arg(raw: str) -> list[str] | None:
    value = (raw or "").strip()
    if not value:
        return None
    if value.startswith("[") and value.endswith("]"):
        inner = value[1:-1].strip()
        parts = [part.strip().strip("\"'") for part in inner.split(",")]
    else:
        parts = [part.strip() for part in value.split(",")]
    teammates = [part for part in parts if part]
    if not teammates:
        return None
    return teammates


def _build_teammate_adapter(args: argparse.Namespace):
    adapter_name = args.teammate_adapter
    if adapter_name == "template":
        return TemplateTeammateAdapter()
    shared = (args.teammate_command or "").strip()
    plan_raw = (args.plan_command or "").strip() or shared
    execute_raw = (args.execute_command or "").strip() or shared
    if not plan_raw or not execute_raw:
        raise ValueError(
            "subprocess adapter requires command settings. "
            "Set TEAMMATE_COMMAND or both TEAMMATE_PLAN_COMMAND and TEAMMATE_EXECUTE_COMMAND, "
            "or pass --teammate-command / --plan-command / --execute-command."
        )
    return SubprocessCodexAdapter(
        plan_command=_parse_command(plan_raw, "plan command"),
        execute_command=_parse_command(execute_raw, "execute command"),
        timeout_seconds=max(1, int(args.command_timeout)),
    )


def _build_run_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run agent-teams-like orchestrator")
    parser.add_argument(
        "--config",
        type=Path,
        default=None,
        help="Path to task config JSON",
    )
    parser.add_argument(
        "--openspec-change",
        default=None,
        help="Use openspec/changes/<change-id>/tasks.md as source",
    )
    parser.add_argument(
        "--openspec-root",
        type=Path,
        default=Path("openspec"),
        help="OpenSpec root path",
    )
    parser.add_argument(
        "--overrides-root",
        type=Path,
        default=Path("task_configs/overrides"),
        help="Override YAML directory",
    )
    parser.add_argument(
        "--task-config-root",
        type=Path,
        default=Path("task_configs"),
        help="Compiled task config output directory",
    )
    parser.add_argument(
        "--save-compiled",
        action="store_true",
        help="Save compiled openspec config to task_configs/<change-id>.json",
    )
    parser.add_argument(
        "--teammates",
        default="",
        help="Override teammates for openspec compile (comma-separated)",
    )
    parser.add_argument(
        "--state-dir",
        type=Path,
        default=Path(".team_state"),
        help="Directory to store shared state",
    )
    parser.add_argument("--lead-id", default="lead")
    parser.add_argument("--max-rounds", type=int, default=200)
    parser.add_argument("--max-idle-rounds", type=int, default=20)
    parser.add_argument("--max-idle-seconds", type=int, default=120)
    parser.add_argument("--no-progress-event-interval", type=int, default=3)
    parser.add_argument("--tick-seconds", type=float, default=0.0)
    parser.add_argument(
        "--provider",
        choices=["openai", "claude", "gemini", "mock"],
        default=None,
        help="Orchestrator provider override",
    )
    parser.add_argument(
        "--human-approval",
        action="store_true",
        help="Stop and wait when tasks require approval",
    )
    parser.add_argument(
        "--teammate-adapter",
        choices=["subprocess", "template"],
        default=os.getenv("TEAMMATE_ADAPTER", "subprocess"),
        help="Teammate execution adapter",
    )
    parser.add_argument(
        "--teammate-command",
        default=os.getenv("TEAMMATE_COMMAND", ""),
        help="Shared command used for plan/execute (subprocess adapter)",
    )
    parser.add_argument(
        "--plan-command",
        default=os.getenv("TEAMMATE_PLAN_COMMAND", ""),
        help="Command for build_plan (subprocess adapter)",
    )
    parser.add_argument(
        "--execute-command",
        default=os.getenv("TEAMMATE_EXECUTE_COMMAND", ""),
        help="Command for execute_task (subprocess adapter)",
    )
    parser.add_argument(
        "--command-timeout",
        type=int,
        default=_safe_int_env("TEAMMATE_COMMAND_TIMEOUT", 120),
        help="Timeout seconds for subprocess teammate commands",
    )
    return parser


def _build_compile_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Compile OpenSpec change into task config JSON")
    parser.add_argument("--change-id", required=True, help="OpenSpec change id")
    parser.add_argument(
        "--openspec-root",
        type=Path,
        default=Path("openspec"),
        help="OpenSpec root path",
    )
    parser.add_argument(
        "--overrides-root",
        type=Path,
        default=Path("task_configs/overrides"),
        help="Override YAML directory",
    )
    parser.add_argument(
        "--task-config-root",
        type=Path,
        default=Path("task_configs"),
        help="Default output directory",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="Explicit output path for compiled JSON",
    )
    parser.add_argument(
        "--teammates",
        default="",
        help="Override teammates for compile (comma-separated)",
    )
    return parser


def _resolve_tasks_for_run(args: argparse.Namespace) -> tuple[list[Task], list[str], list[PersonaDefinition]]:
    if args.config is not None and args.openspec_change:
        raise ValueError("--config and --openspec-change cannot be used together")

    if args.openspec_change:
        compiled = compile_change_to_config(
            change_id=args.openspec_change,
            openspec_root=args.openspec_root,
            overrides_root=args.overrides_root,
            teammates=_parse_teammates_arg(args.teammates),
        )
        if args.save_compiled:
            output_path = default_compiled_output_path(
                change_id=args.openspec_change,
                task_config_root=args.task_config_root,
            )
            write_compiled_config(compiled, output_path)
            print(f"[compile] wrote {output_path}")
        return _load_tasks_payload(compiled, source_label=f"openspec:{args.openspec_change}")

    config_path = args.config or Path("examples/sample_tasks.json")
    return _load_tasks(config_path)


def _run_orchestrator(args: argparse.Namespace) -> int:
    if args.provider:
        os.environ["ORCHESTRATOR_PROVIDER"] = args.provider
    if args.human_approval:
        os.environ["HUMAN_APPROVAL"] = "1"
    tasks, teammates, personas = _resolve_tasks_for_run(args)
    if not tasks:
        raise ValueError("No tasks found in config")
    store = StateStore(state_dir=args.state_dir)
    store.bootstrap_tasks(tasks, replace=True)
    config = OrchestratorConfig(
        lead_id=args.lead_id,
        teammate_ids=teammates or None,
        max_rounds=args.max_rounds,
        max_idle_rounds=args.max_idle_rounds,
        max_idle_seconds=args.max_idle_seconds,
        no_progress_event_interval=args.no_progress_event_interval,
        tick_seconds=args.tick_seconds,
        human_approval=args.human_approval,
        personas=personas,
    )
    teammate_adapter = _build_teammate_adapter(args)
    orchestrator = AgentTeamsLikeOrchestrator(
        store=store,
        adapter=teammate_adapter,
        provider=build_provider_from_env(),
        config=config,
        event_logger=print,
    )
    result = orchestrator.run()
    print(json.dumps(result, ensure_ascii=True, indent=2))
    return 0


def _compile_openspec(args: argparse.Namespace) -> int:
    payload = compile_change_to_config(
        change_id=args.change_id,
        openspec_root=args.openspec_root,
        overrides_root=args.overrides_root,
        teammates=_parse_teammates_arg(args.teammates),
    )
    output_path = args.output or default_compiled_output_path(
        change_id=args.change_id,
        task_config_root=args.task_config_root,
    )
    write_compiled_config(payload, output_path)
    print(str(output_path))
    return 0


def main(argv: list[str] | None = None) -> int:
    args_list = list(argv) if argv is not None else sys.argv[1:]
    if args_list and args_list[0] == "compile-openspec":
        parser = _build_compile_parser()
        parsed = parser.parse_args(args_list[1:])
        return _compile_openspec(parsed)
    if args_list and args_list[0] == "run":
        parser = _build_run_parser()
        parsed = parser.parse_args(args_list[1:])
        return _run_orchestrator(parsed)
    parser = _build_run_parser()
    parsed = parser.parse_args(args_list)
    return _run_orchestrator(parsed)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except OpenSpecCompileError as error:
        raise SystemExit(f"openspec compile error: {error}")

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[2]
PARITY_ROOT = Path(__file__).resolve().parent
FIXTURES_ROOT = PARITY_ROOT / "fixtures"


def _canonical_json(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: _canonical_json(value[key]) for key in sorted(value.keys())}
    if isinstance(value, list):
        return [_canonical_json(item) for item in value]
    return value


def _normalize_string_list(values: Any) -> list[str]:
    if not isinstance(values, list):
        return []
    seen: set[str] = set()
    normalized: list[str] = []
    for item in values:
        text = str(item).strip()
        if not text or text in seen:
            continue
        seen.add(text)
        normalized.append(text)
    return sorted(normalized)


def _normalize_compile_payload(raw: dict[str, Any]) -> dict[str, Any]:
    tasks: list[dict[str, Any]] = []
    for task_raw in raw.get("tasks", []):
        if not isinstance(task_raw, dict):
            continue
        tasks.append(
            {
                "id": str(task_raw.get("id", "")).strip(),
                "title": str(task_raw.get("title", "")).strip(),
                "description": str(task_raw.get("description", "")),
                "target_paths": _normalize_string_list(task_raw.get("target_paths", [])),
                "depends_on": _normalize_string_list(task_raw.get("depends_on", [])),
                "requires_plan": bool(task_raw.get("requires_plan", False)),
                "persona_policy": _canonical_json(task_raw.get("persona_policy")),
            }
        )
    tasks.sort(key=lambda item: item["id"])

    verification_items: list[dict[str, Any]] = []
    for item_raw in raw.get("meta", {}).get("verification_items", []):
        if not isinstance(item_raw, dict):
            continue
        verification_items.append(
            {
                "checked": bool(item_raw.get("checked", False)),
                "text": str(item_raw.get("text", "")).strip(),
            }
        )

    personas: list[dict[str, Any]] = []
    for persona_raw in raw.get("personas", []) or []:
        if not isinstance(persona_raw, dict):
            continue
        personas.append(
            {
                "id": str(persona_raw.get("id", "")).strip(),
                "role": str(persona_raw.get("role", "")).strip(),
                "focus": str(persona_raw.get("focus", "")).strip(),
                "can_block": bool(persona_raw.get("can_block", False)),
                "enabled": bool(persona_raw.get("enabled", False)),
                "execution": _canonical_json(persona_raw.get("execution")),
            }
        )
    personas.sort(key=lambda item: item["id"])

    return {
        "teammates": _normalize_string_list(raw.get("teammates", [])),
        "tasks": tasks,
        "persona_defaults": _canonical_json(raw.get("persona_defaults")),
        "personas": personas,
        "meta": {
            "verification_items": verification_items,
        },
    }


def _normalize_state_snapshots(raw: dict[str, Any]) -> dict[str, Any]:
    normalized: dict[str, Any] = {}
    for step_name, state_raw in raw.items():
        if not isinstance(state_raw, dict):
            continue
        tasks_out: dict[str, Any] = {}
        tasks_raw = state_raw.get("tasks", {})
        if isinstance(tasks_raw, dict):
            for task_id in sorted(tasks_raw.keys()):
                task_raw = tasks_raw.get(task_id, {})
                if not isinstance(task_raw, dict):
                    continue
                requires_plan = bool(task_raw.get("requires_plan", False))
                plan_status_raw = task_raw.get("plan_status")
                if not requires_plan and (plan_status_raw is None or str(plan_status_raw).strip() == ""):
                    plan_status = "not_required"
                else:
                    plan_status = None if plan_status_raw is None else str(plan_status_raw).strip()

                progress_log: list[dict[str, str]] = []
                for entry in task_raw.get("progress_log", []):
                    if not isinstance(entry, dict):
                        continue
                    source = str(entry.get("source", "")).strip()
                    text = str(entry.get("text", "")).strip()
                    if not text:
                        continue
                    progress_log.append({"source": source or "unknown", "text": text})

                tasks_out[str(task_id)] = {
                    "title": str(task_raw.get("title", "")),
                    "description": str(task_raw.get("description", "")),
                    "status": str(task_raw.get("status", "")),
                    "owner": task_raw.get("owner"),
                    "planner": task_raw.get("planner"),
                    "requires_plan": requires_plan,
                    "plan_status": plan_status,
                    "depends_on": _normalize_string_list(task_raw.get("depends_on", [])),
                    "target_paths": _normalize_string_list(task_raw.get("target_paths", [])),
                    "persona_policy": _canonical_json(task_raw.get("persona_policy")),
                    "current_phase_index": task_raw.get("current_phase_index"),
                    "progress_log": progress_log,
                }

        messages_out: list[dict[str, Any]] = []
        for message_raw in state_raw.get("messages", []):
            if not isinstance(message_raw, dict):
                continue
            messages_out.append(
                {
                    "seq": int(message_raw.get("seq", 0)),
                    "sender": str(message_raw.get("sender", "")),
                    "receiver": str(message_raw.get("receiver", "")),
                    "content": str(message_raw.get("content", "")),
                    "task_id": message_raw.get("task_id"),
                }
            )
        messages_out.sort(key=lambda item: item["seq"])

        meta_raw = state_raw.get("meta", {})
        if not isinstance(meta_raw, dict):
            meta_raw = {}
        normalized[step_name] = {
            "tasks": tasks_out,
            "messages": messages_out,
            "meta": {
                "sequence": int(meta_raw.get("sequence", 0)),
                "progress_counter": int(meta_raw.get("progress_counter", 0)),
            },
        }
    return normalized


def _extract_last_json_object(text: str) -> dict[str, Any]:
    decoder = json.JSONDecoder()
    candidate: dict[str, Any] | None = None
    for index, ch in enumerate(text):
        if ch != "{":
            continue
        try:
            parsed, consumed = decoder.raw_decode(text[index:])
        except json.JSONDecodeError:
            continue
        if text[index + consumed :].strip():
            continue
        if isinstance(parsed, dict):
            candidate = parsed
    if candidate is None:
        raise AssertionError(f"failed to find trailing JSON object in output:\n{text}")
    return candidate


def _normalize_run_output(stdout: str) -> dict[str, Any]:
    lines = stdout.splitlines()
    run_mode_line = next((line for line in lines if line.startswith("[run] run_mode=")), None)
    progress_ref_line = next((line for line in lines if line.startswith("[run] progress_log_ref=")), None)
    if run_mode_line is None or progress_ref_line is None:
        raise AssertionError(f"missing required run lines:\n{stdout}")

    run_mode = run_mode_line.split("=", 1)[1].strip()
    progress_ref = progress_ref_line.split("=", 1)[1].strip()
    suffix = "::tasks.<task_id>.progress_log"
    if not progress_ref.endswith(suffix):
        raise AssertionError(f"invalid progress_log_ref: {progress_ref}")

    result = _extract_last_json_object(stdout)
    elapsed = result.get("elapsed_seconds")
    elapsed_ok = isinstance(elapsed, (int, float)) and float(elapsed) >= 0

    required_result = {
        "stop_reason": str(result.get("stop_reason", "")),
        "summary": _canonical_json(result.get("summary", {})),
        "tasks_total": int(result.get("tasks_total", 0)),
        "provider_calls": int(result.get("provider_calls", 0)),
        "provider": str(result.get("provider", "")),
        "human_approval": bool(result.get("human_approval", False)),
        "persona_metrics": _canonical_json(result.get("persona_metrics", {})),
        "elapsed_seconds_present": elapsed_ok,
    }

    return {
        "run_mode": run_mode,
        "progress_log_ref": f"<state_file>{suffix}",
        "result": required_result,
    }


class _ParityTestBase(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("deno") is None:
            raise unittest.SkipTest("deno command is required for parity tests")

    def _python_env(self) -> dict[str, str]:
        env = dict(os.environ)
        existing = env.get("PYTHONPATH", "")
        env["PYTHONPATH"] = str(REPO_ROOT) if not existing else f"{REPO_ROOT}{os.pathsep}{existing}"
        return env

    def _run_python_cli(self, args: list[str], *, cwd: Path = REPO_ROOT) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, "-m", "team_orchestrator.cli", *args],
            cwd=str(cwd),
            text=True,
            capture_output=True,
            env=self._python_env(),
        )

    def _run_python_script(self, script_path: Path, args: list[str], *, cwd: Path = REPO_ROOT) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(script_path), *args],
            cwd=str(cwd),
            text=True,
            capture_output=True,
            env=self._python_env(),
        )

    def _run_ts_cli(self, args: list[str], *, cwd: Path = REPO_ROOT) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["deno", "run", "-A", "src/cli/main.ts", *args],
            cwd=str(cwd),
            text=True,
            capture_output=True,
        )

    def _run_ts_script(self, script_path: Path, args: list[str], *, cwd: Path = REPO_ROOT) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["deno", "run", "-A", str(script_path), *args],
            cwd=str(cwd),
            text=True,
            capture_output=True,
        )

    def _assert_ok(self, proc: subprocess.CompletedProcess[str], label: str) -> None:
        if proc.returncode != 0:
            self.fail(
                f"{label} failed with exit={proc.returncode}\n"
                f"stdout:\n{proc.stdout}\n"
                f"stderr:\n{proc.stderr}"
            )


class CompileParityTests(_ParityTestBase):
    def test_compile_parity_matches_fixture(self) -> None:
        fixture_case = FIXTURES_ROOT / "compile" / "basic"
        expected_path = fixture_case / "expected.normalized.json"

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            shutil.copytree(fixture_case / "openspec", root / "openspec")
            (root / "task_configs" / "overrides").mkdir(parents=True, exist_ok=True)

            py_output = root / "py_compiled.json"
            ts_output = root / "ts_compiled.json"

            py_proc = self._run_python_cli(
                [
                    "compile-openspec",
                    "--change-id",
                    "add-parity-basic",
                    "--openspec-root",
                    str(root / "openspec"),
                    "--overrides-root",
                    str(root / "task_configs" / "overrides"),
                    "--output",
                    str(py_output),
                ]
            )
            self._assert_ok(py_proc, "python compile-openspec")
            self.assertEqual(py_proc.stdout.strip(), str(py_output))

            ts_proc = self._run_ts_cli(
                [
                    "compile-openspec",
                    "--change-id",
                    "add-parity-basic",
                    "--openspec-root",
                    str(root / "openspec"),
                    "--overrides-root",
                    str(root / "task_configs" / "overrides"),
                    "--output",
                    str(ts_output),
                ]
            )
            self._assert_ok(ts_proc, "ts compile-openspec")
            self.assertEqual(ts_proc.stdout.strip(), str(ts_output))

            py_payload = json.loads(py_output.read_text(encoding="utf-8"))
            ts_payload = json.loads(ts_output.read_text(encoding="utf-8"))
            expected_payload = json.loads(expected_path.read_text(encoding="utf-8"))

            py_normalized = _normalize_compile_payload(py_payload)
            ts_normalized = _normalize_compile_payload(ts_payload)

            self.assertEqual(py_normalized, ts_normalized)
            self.assertEqual(py_normalized, expected_payload)


class StateParityTests(_ParityTestBase):
    def test_state_snapshots_match_fixture(self) -> None:
        expected_path = FIXTURES_ROOT / "state" / "basic" / "expected.normalized.json"
        py_script = PARITY_ROOT / "scenarios" / "state_scenario_python.py"
        ts_script = PARITY_ROOT / "scenarios" / "state_scenario_ts.ts"

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            py_state_dir = root / "py_state"
            ts_state_dir = root / "ts_state"
            py_output = root / "py_state_snapshots.json"
            ts_output = root / "ts_state_snapshots.json"

            py_proc = self._run_python_script(
                py_script,
                [
                    "--state-dir",
                    str(py_state_dir),
                    "--output",
                    str(py_output),
                ],
            )
            self._assert_ok(py_proc, "python state scenario")

            ts_proc = self._run_ts_script(
                ts_script,
                [
                    "--state-dir",
                    str(ts_state_dir),
                    "--output",
                    str(ts_output),
                ],
            )
            self._assert_ok(ts_proc, "ts state scenario")

            py_snapshots = json.loads(py_output.read_text(encoding="utf-8"))
            ts_snapshots = json.loads(ts_output.read_text(encoding="utf-8"))
            expected_snapshots = json.loads(expected_path.read_text(encoding="utf-8"))

            py_normalized = _normalize_state_snapshots(py_snapshots)
            ts_normalized = _normalize_state_snapshots(ts_snapshots)

            self.assertEqual(py_normalized, ts_normalized)
            self.assertEqual(py_normalized, expected_snapshots)


class CliParityTests(_ParityTestBase):
    def test_cli_run_compile_template_and_error_flows(self) -> None:
        fixture_case = FIXTURES_ROOT / "cli" / "basic"
        run_expected_path = fixture_case / "run_expected.normalized.json"
        run_config_path = fixture_case / "run_config.json"
        expected_run = json.loads(run_expected_path.read_text(encoding="utf-8"))

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            py_state = root / "py_state"
            ts_state = root / "ts_state"

            py_run = self._run_python_cli(
                [
                    "run",
                    "--config",
                    str(run_config_path),
                    "--state-dir",
                    str(py_state),
                    "--teammate-adapter",
                    "template",
                    "--provider",
                    "mock",
                    "--max-rounds",
                    "30",
                ]
            )
            self._assert_ok(py_run, "python run")

            ts_run = self._run_ts_cli(
                [
                    "run",
                    "--config",
                    str(run_config_path),
                    "--state-dir",
                    str(ts_state),
                    "--teammate-adapter",
                    "template",
                    "--provider",
                    "mock",
                    "--max-rounds",
                    "30",
                ]
            )
            self._assert_ok(ts_run, "ts run")

            py_run_normalized = _normalize_run_output(py_run.stdout)
            ts_run_normalized = _normalize_run_output(ts_run.stdout)

            self.assertEqual(py_run_normalized, ts_run_normalized)
            self.assertEqual(py_run_normalized, expected_run)

            shutil.copytree(fixture_case / "openspec", root / "openspec")
            (root / "task_configs" / "overrides").mkdir(parents=True, exist_ok=True)
            py_compile_output = root / "py_cli_compile.json"
            ts_compile_output = root / "ts_cli_compile.json"

            py_compile = self._run_python_cli(
                [
                    "compile-openspec",
                    "--change-id",
                    "add-parity-cli",
                    "--openspec-root",
                    str(root / "openspec"),
                    "--overrides-root",
                    str(root / "task_configs" / "overrides"),
                    "--output",
                    str(py_compile_output),
                ]
            )
            self._assert_ok(py_compile, "python cli compile")
            self.assertEqual(py_compile.stdout.strip(), str(py_compile_output))
            self.assertEqual(len(py_compile.stdout.strip().splitlines()), 1)

            ts_compile = self._run_ts_cli(
                [
                    "compile-openspec",
                    "--change-id",
                    "add-parity-cli",
                    "--openspec-root",
                    str(root / "openspec"),
                    "--overrides-root",
                    str(root / "task_configs" / "overrides"),
                    "--output",
                    str(ts_compile_output),
                ]
            )
            self._assert_ok(ts_compile, "ts cli compile")
            self.assertEqual(ts_compile.stdout.strip(), str(ts_compile_output))
            self.assertEqual(len(ts_compile.stdout.strip().splitlines()), 1)

            py_compile_payload = _normalize_compile_payload(
                json.loads(py_compile_output.read_text(encoding="utf-8"))
            )
            ts_compile_payload = _normalize_compile_payload(
                json.loads(ts_compile_output.read_text(encoding="utf-8"))
            )
            self.assertEqual(py_compile_payload, ts_compile_payload)

            py_template = self._run_python_cli(["print-openspec-template", "--lang", "ja"])
            self._assert_ok(py_template, "python print-openspec-template")
            ts_template = self._run_ts_cli(["print-openspec-template", "--lang", "ja"])
            self._assert_ok(ts_template, "ts print-openspec-template")
            self.assertEqual(py_template.stdout, ts_template.stdout)

            conflict_py = self._run_python_cli(
                [
                    "run",
                    "--config",
                    str(run_config_path),
                    "--openspec-change",
                    "add-parity-cli",
                ]
            )
            conflict_ts = self._run_ts_cli(
                [
                    "run",
                    "--config",
                    str(run_config_path),
                    "--openspec-change",
                    "add-parity-cli",
                ]
            )
            self.assertNotEqual(conflict_py.returncode, 0)
            self.assertNotEqual(conflict_ts.returncode, 0)
            expected_message = "--config and --openspec-change cannot be used together"
            self.assertIn(expected_message, conflict_py.stderr)
            self.assertIn(expected_message, conflict_ts.stderr)

            missing_py = self._run_python_cli(
                [
                    "compile-openspec",
                    "--change-id",
                    "missing-change",
                    "--openspec-root",
                    str(root / "openspec"),
                ]
            )
            missing_ts = self._run_ts_cli(
                [
                    "compile-openspec",
                    "--change-id",
                    "missing-change",
                    "--openspec-root",
                    str(root / "openspec"),
                ]
            )
            self.assertNotEqual(missing_py.returncode, 0)
            self.assertNotEqual(missing_ts.returncode, 0)
            self.assertIn("openspec compile error:", missing_py.stderr)
            self.assertIn("openspec compile error:", missing_ts.stderr)


if __name__ == "__main__":
    unittest.main()

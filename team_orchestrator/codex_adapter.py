from __future__ import annotations

import json
import os
import subprocess
from dataclasses import dataclass, field

from .adapter import TeammateAdapter
from .models import Task


@dataclass
class SubprocessCodexAdapter(TeammateAdapter):
    """
    Adapter that delegates plan/execution text generation to external commands.

    Example:
    - plan_command: ["codex", "reply", "--stdin"]
    - execute_command: ["codex", "reply", "--stdin"]
    """

    plan_command: list[str]
    execute_command: list[str]
    timeout_seconds: int = 120
    extra_env: dict[str, str] = field(default_factory=dict)

    def _run(self, command: list[str], payload: dict) -> str:
        stream_logs = os.getenv("TEAMMATE_STREAM_LOGS", "1").strip() == "1"
        stderr_target = None if stream_logs else subprocess.PIPE
        process = subprocess.run(
            command,
            input=json.dumps(payload, ensure_ascii=True),
            text=True,
            stdout=subprocess.PIPE,
            stderr=stderr_target,
            timeout=self.timeout_seconds,
            env={**os.environ, **self.extra_env},
            check=False,
        )
        if process.returncode != 0:
            stderr = (
                process.stderr.strip()
                if isinstance(process.stderr, str)
                else "see stderr logs above (set TEAMMATE_STREAM_LOGS=0 to capture stderr)"
            )
            raise RuntimeError(f"command failed: {' '.join(command)} :: {stderr}")
        output = process.stdout.strip()
        if not output:
            raise RuntimeError(f"empty response from command: {' '.join(command)}")
        return output

    def build_plan(self, teammate_id: str, task: Task) -> str:
        payload = {
            "mode": "plan",
            "teammate_id": teammate_id,
            "task": task.to_dict(),
        }
        return self._run(self.plan_command, payload)

    def execute_task(self, teammate_id: str, task: Task) -> str:
        payload = {
            "mode": "execute",
            "teammate_id": teammate_id,
            "task": task.to_dict(),
        }
        return self._run(self.execute_command, payload)

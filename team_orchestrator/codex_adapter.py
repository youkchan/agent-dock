from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
from dataclasses import dataclass, field

from .adapter import ProgressCallback, TeammateAdapter
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

    @staticmethod
    def _emit_progress(
        progress_callback: ProgressCallback | None,
        source: str,
        chunk: str,
    ) -> None:
        if progress_callback is None:
            return
        for line in chunk.splitlines():
            text = line.rstrip("\r")
            if not text:
                continue
            progress_callback(source, text)

    def _run(
        self,
        command: list[str],
        payload: dict,
        progress_callback: ProgressCallback | None = None,
    ) -> str:
        stream_logs = os.getenv("TEAMMATE_STREAM_LOGS", "1").strip() == "1"
        process = subprocess.Popen(
            command,
            text=True,
            encoding="utf-8",
            errors="replace",
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            stdin=subprocess.PIPE,
            env={**os.environ, **self.extra_env},
            bufsize=1,
        )
        assert process.stdin is not None
        assert process.stdout is not None
        assert process.stderr is not None
        process.stdin.write(json.dumps(payload, ensure_ascii=True))
        process.stdin.close()

        stdout_chunks: list[str] = []
        stderr_chunks: list[str] = []

        def _consume(pipe, source: str, chunks: list[str], mirror_stderr: bool = False) -> None:
            for chunk in iter(pipe.readline, ""):
                chunks.append(chunk)
                self._emit_progress(progress_callback=progress_callback, source=source, chunk=chunk)
                if mirror_stderr:
                    print(chunk, end="", file=sys.stderr, flush=True)
            pipe.close()

        stdout_thread = threading.Thread(
            target=_consume,
            args=(process.stdout, "stdout", stdout_chunks),
            daemon=True,
        )
        stderr_thread = threading.Thread(
            target=_consume,
            args=(process.stderr, "stderr", stderr_chunks, stream_logs),
            daemon=True,
        )
        stdout_thread.start()
        stderr_thread.start()

        timeout_reached = False
        try:
            process.wait(timeout=self.timeout_seconds)
        except subprocess.TimeoutExpired:
            timeout_reached = True
            process.kill()
            process.wait()

        stdout_thread.join()
        stderr_thread.join()

        stdout_text = "".join(stdout_chunks).strip()
        stderr_text = "".join(stderr_chunks).strip()
        if timeout_reached:
            raise RuntimeError(f"command timed out: {' '.join(command)} ({self.timeout_seconds}s)")
        if process.returncode != 0:
            stderr = stderr_text or "no stderr"
            raise RuntimeError(f"command failed: {' '.join(command)} :: {stderr}")
        if not stdout_text:
            raise RuntimeError(f"empty response from command: {' '.join(command)}")
        return stdout_text

    def build_plan(self, teammate_id: str, task: Task) -> str:
        payload = {
            "mode": "plan",
            "teammate_id": teammate_id,
            "task": task.to_dict(),
        }
        return self._run(self.plan_command, payload)

    def execute_task(
        self,
        teammate_id: str,
        task: Task,
        progress_callback: ProgressCallback | None = None,
    ) -> str:
        payload = {
            "mode": "execute",
            "teammate_id": teammate_id,
            "task": task.to_dict(),
        }
        return self._run(self.execute_command, payload, progress_callback=progress_callback)

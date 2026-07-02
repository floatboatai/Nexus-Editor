"""模块 2：Runner —— 驱动 table-ops-bridge 执行列拖动探针。"""

from __future__ import annotations

import json
import queue
import subprocess
import sys
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from . import env
from .dataset import TestCase


class BridgeError(RuntimeError):
    pass


@dataclass
class RunResult:
    case_id: str
    table_op: dict[str, Any] = field(default_factory=dict)
    missing: bool = False
    batch_failure: str | None = None
    table_op_missing: bool = False
    table_op_batch_failure: str | None = None

    @property
    def table_op_ms(self) -> float:
        return float(self.table_op.get("ms", 0.0))

    @property
    def total_ms(self) -> float:
        return self.table_op_ms


def _newest_mtime(paths: list[Path]) -> float:
    newest = 0.0
    for path in paths:
        if path.is_dir():
            for child in path.rglob("*"):
                if child.is_file():
                    newest = max(newest, child.stat().st_mtime)
        elif path.is_file():
            newest = max(newest, path.stat().st_mtime)
    return newest


class Runner:
    def __init__(self, timeout_s: float = 60.0, node_bin: str = "node") -> None:
        self.timeout_s = timeout_s
        self.node_bin = node_bin

    def ensure_bridge_built(self, force: bool = False) -> Path:
        dist = env.TABLEOPS_DIST
        sources = [
            env.TABLEOPS_ENTRY,
            env.PREVIEW_SETUP,
            env.BRIDGE_CONFIG,
            env.CORE_SRC,
        ]
        stale = force or not dist.exists() or _newest_mtime(sources) > dist.stat().st_mtime
        if not stale:
            return dist

        if not env.TSUP_BIN.exists():
            raise BridgeError(f"未找到 tsup：{env.TSUP_BIN}。请先在仓库根目录执行 `pnpm install`。")

        print("[eval] 使用 tsup 打包 table-ops 桥 ...", file=sys.stderr)
        proc = subprocess.run(
            [str(env.TSUP_BIN)], cwd=str(env.BRIDGE_DIR), capture_output=True, text=True
        )
        if proc.returncode != 0:
            raise BridgeError("tsup 打包失败：\n" + (proc.stderr or proc.stdout or "<无输出>"))
        if not dist.exists():
            raise BridgeError(f"tsup 报告成功但产物缺失：{dist}")
        return dist

    def run_all(self, cases: list[TestCase], rebuild: bool = False) -> list[RunResult]:
        self.ensure_bridge_built(force=rebuild)

        def payload(case: TestCase) -> dict[str, Any]:
            move = case.expect.get("tableMove") or {"from": 0, "to": 1}
            payload_dict: dict[str, Any] = {"id": case.id, "input": case.input, "move": move}
            layout = case.expect.get("tableLayout")
            if layout:
                payload_dict["tableLayout"] = layout
            if "tableIndex" in case.expect:
                payload_dict["tableIndex"] = case.expect["tableIndex"]
            return payload_dict

        raw_results, failure_kind, stderr_lines = self._drive(env.TABLEOPS_DIST, cases, payload)
        for line in stderr_lines:
            print(f"[eval] table-ops stderr: {line}", file=sys.stderr)

        by_id = {r.get("id"): r for r in raw_results if isinstance(r, dict)}
        results: list[RunResult] = []
        for index, case in enumerate(cases):
            raw = by_id.get(case.id)
            if raw is not None:
                results.append(
                    RunResult(case_id=case.id, table_op=raw.get("tableOp", {}))
                )
            else:
                is_culprit = index == len(raw_results)
                results.append(
                    RunResult(
                        case_id=case.id,
                        missing=True,
                        batch_failure=(failure_kind if is_culprit else "aborted"),
                        table_op_missing=True,
                        table_op_batch_failure=(failure_kind if is_culprit else "aborted"),
                    )
                )
        return results

    def _drive(
        self,
        dist: Path,
        cases: list[TestCase],
        payload: Callable[[TestCase], dict[str, Any]],
    ) -> tuple[list[dict[str, Any]], str | None, list[str]]:
        proc = subprocess.Popen(
            [self.node_bin, str(dist)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )

        def write_stdin() -> None:
            try:
                assert proc.stdin is not None
                for case in cases:
                    proc.stdin.write(json.dumps(payload(case)) + "\n")
                proc.stdin.close()
            except (BrokenPipeError, ValueError):
                pass

        out_queue: queue.Queue[str | None] = queue.Queue()

        def read_stdout() -> None:
            assert proc.stdout is not None
            for line in proc.stdout:
                out_queue.put(line)
            out_queue.put(None)

        threading.Thread(target=write_stdin, daemon=True).start()
        threading.Thread(target=read_stdout, daemon=True).start()

        results: list[dict[str, Any]] = []
        deadline = time.monotonic() + self.timeout_s
        failure_kind: str | None = None
        stdout_closed = False

        while len(results) < len(cases) and not stdout_closed:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                failure_kind = "timeout"
                break
            try:
                line = out_queue.get(timeout=remaining)
            except queue.Empty:
                failure_kind = "timeout"
                break
            if line is None:
                stdout_closed = True
                break
            line = line.strip()
            if not line:
                continue
            try:
                results.append(json.loads(line))
            except json.JSONDecodeError:
                continue

        if failure_kind == "timeout":
            proc.kill()

        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()

        stderr_text = ""
        if proc.stderr is not None:
            try:
                stderr_text = proc.stderr.read()
            except ValueError:
                stderr_text = ""
        stderr_lines = [ln for ln in stderr_text.splitlines() if ln.strip()]

        if failure_kind is None and len(results) < len(cases):
            failure_kind = "crash"
        if failure_kind is None and proc.returncode not in (0, None):
            failure_kind = "crash"

        return results, failure_kind, stderr_lines

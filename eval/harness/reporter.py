"""模块 4：Reporter —— 表格列拖动评测报告。"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass
from typing import Any

from .evaluator import EvalScore, Outcome

try:
    from rich.console import Console
    from rich.table import Table

    _HAS_RICH = True
except ModuleNotFoundError:  # pragma: no cover
    _HAS_RICH = False


_BADGE = {
    Outcome.OK: ("✅", "green"),
    Outcome.DEGRADED: ("⚠️", "yellow"),
    Outcome.TABLE_CORRUPTION: ("🧱", "red"),
    Outcome.CRASH: ("💥", "red"),
    Outcome.TIMEOUT: ("⏱️", "red"),
}


@dataclass
class Report:
    total: int
    passed: int
    warned: int
    failed: int
    avg_score: float
    pass_rate: float


def build_report(scores: list[EvalScore]) -> Report:
    total = len(scores)
    passed = sum(1 for s in scores if s.outcome == Outcome.OK)
    warned = sum(1 for s in scores if not s.is_hard_failure and s.outcome != Outcome.OK)
    failed = sum(1 for s in scores if s.is_hard_failure)
    avg = sum(s.score for s in scores) / total if total else 0.0
    return Report(
        total=total,
        passed=passed,
        warned=warned,
        failed=failed,
        avg_score=avg,
        pass_rate=(passed + warned) / total if total else 0.0,
    )


class Reporter:
    def __init__(self, baseline_pass_rate: float | None = None) -> None:
        self.baseline = baseline_pass_rate
        self.console = Console(stderr=False) if _HAS_RICH else None

    def print_report(self, report: Report, scores: list[EvalScore], verbose: bool) -> None:
        if _HAS_RICH:
            self._print_rich(report, scores, verbose)
        else:
            self._print_plain(report, scores, verbose)

    def _print_rich(self, report: Report, scores: list[EvalScore], verbose: bool) -> None:
        c = self.console
        assert c is not None
        c.rule("[bold]Nexus Table Drag — Eval 报告[/bold]")

        show = scores if verbose else [s for s in scores if s.outcome != Outcome.OK]
        if show:
            table = Table(show_header=True, header_style="bold")
            table.add_column("用例", overflow="fold")
            table.add_column("耗时", justify="right")
            table.add_column("结果", justify="center")
            table.add_column("说明", overflow="fold")
            for s in show:
                icon, color = _BADGE[s.outcome]
                table.add_row(
                    s.case_id,
                    f"{s.total_ms:.1f}ms",
                    f"[{color}]{icon} {s.outcome.value}[/{color}]",
                    s.reason,
                )
            c.print(table)

        corrupt = sum(1 for s in scores if s.outcome == Outcome.TABLE_CORRUPTION)
        ok = sum(1 for s in scores if s.outcome == Outcome.OK)
        other = report.total - corrupt - ok
        c.print(
            f"通过 [green]{report.passed}[/green]  "
            f"警告 [yellow]{report.warned}[/yellow]  "
            f"失败 [red]{report.failed}[/red]  "
            f"/ 共 {report.total}   |   均分 {report.avg_score:.2f}   |   "
            f"通过率 {report.pass_rate:.0%}"
        )
        c.print(
            f"表格列拖动: 共 {report.total}  "
            f"🧱 行列错乱 {corrupt}  ✅ 守恒 {ok}  ⚠️ 其它 {other}"
        )
        self._print_baseline(report, rich=True)

        if report.failed:
            c.print(f"[bold red]RESULT: FAIL（{report.failed} 项硬失败）[/bold red]")
        else:
            c.print("[bold green]RESULT: PASS（无硬失败）[/bold green]")

    def _print_plain(self, report: Report, scores: list[EvalScore], verbose: bool) -> None:
        print("\nNexus Table Drag — Eval 报告")
        print("=" * 64)
        show = scores if verbose else [s for s in scores if s.outcome != Outcome.OK]
        for s in show:
            icon, _ = _BADGE[s.outcome]
            print(f"  {icon} {s.outcome.value:<16} {s.total_ms:7.1f}ms  {s.case_id:<36} {s.reason}")
        if show:
            print("-" * 64)
        print(
            f"  通过 {report.passed}  警告 {report.warned}  失败 {report.failed}  "
            f"/ 共 {report.total}  |  均分 {report.avg_score:.2f}  |  通过率 {report.pass_rate:.0%}"
        )
        self._print_baseline(report, rich=False)
        print("=" * 64)
        print(f"RESULT: {'FAIL' if report.failed else 'PASS'}")
        print()

    def _print_baseline(self, report: Report, rich: bool) -> None:
        if self.baseline is None:
            return
        delta = report.pass_rate - self.baseline
        msg = f"对比基线 {self.baseline:.0%}: {delta:+.0%}"
        if rich and self.console is not None:
            color = "green" if delta >= 0 else "red"
            self.console.print(f"[{color}]{msg}[/{color}]")
        else:
            print(f"  {msg}")


def to_json(scores: list[EvalScore], report: Report) -> dict[str, Any]:
    return {
        "summary": {
            "total": report.total,
            "pass": report.passed,
            "warn": report.warned,
            "fail": report.failed,
            "avgScore": round(report.avg_score, 3),
            "passRate": round(report.pass_rate, 3),
        },
        "cases": [
            {
                "id": s.case_id,
                "outcome": s.outcome.value,
                "score": s.score,
                "passed": s.passed,
                "hardFailure": s.is_hard_failure,
                "reason": s.reason,
                "tableOpMs": round(s.table_op_ms, 3),
                "tableOp": {"moved": s.table_moved},
            }
            for s in scores
        ],
    }


def print_json(scores: list[EvalScore], report: Report) -> None:
    json.dump(to_json(scores, report), sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")

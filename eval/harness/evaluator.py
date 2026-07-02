"""模块 3：Evaluator —— 表格列拖动规则判定。"""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import Enum

from .dataset import TestCase
from .runner import RunResult


class Outcome(str, Enum):
    OK = "ok"
    DEGRADED = "degraded"
    TABLE_CORRUPTION = "table-corruption"
    CRASH = "crash"
    TIMEOUT = "timeout"


HARD_FAILURES = {
    Outcome.TABLE_CORRUPTION,
    Outcome.CRASH,
    Outcome.TIMEOUT,
}

_SCORE = {
    Outcome.OK: 1.0,
    Outcome.DEGRADED: 0.5,
}


@dataclass
class EvalScore:
    case_id: str
    outcome: Outcome
    score: float
    passed: bool
    reason: str
    table_op_ms: float = 0.0
    table_moved: str | None = None

    @property
    def is_hard_failure(self) -> bool:
        return self.outcome in HARD_FAILURES

    @property
    def total_ms(self) -> float:
        return self.table_op_ms


class Evaluator:
    @staticmethod
    def _split_row_cells(line: str) -> list[str]:
        s = line.strip()
        if s.startswith("|"):
            s = s[1:]
        if s.endswith("|"):
            s = s[:-1]
        return [c.strip() for c in s.split("|")]

    def _parse_table(self, md: str) -> list[list[str]]:
        return [self._split_row_cells(line) for line in md.split("\n") if line.strip()]

    @staticmethod
    def _split_table_blocks(md: str) -> list[str]:
        return [block.strip() for block in re.split(r"\n\s*\n", md) if "|" in block]

    def _oracle_move(self, before: str, frm: int, to: int) -> list[list[str]]:
        out: list[list[str]] = []
        for row in self._parse_table(before):
            if 0 <= frm < len(row) and 0 <= to < len(row):
                rr = row[:]
                rr.insert(to, rr.pop(frm))
                out.append(rr)
            else:
                out.append(row[:])
        return out

    def _make(
        self,
        case: TestCase,
        result: RunResult,
        outcome: Outcome,
        reason: str,
        *,
        table_moved: str | None = None,
    ) -> EvalScore:
        return EvalScore(
            case_id=case.id,
            outcome=outcome,
            score=_SCORE.get(outcome, 0.0),
            passed=outcome not in HARD_FAILURES,
            reason=reason,
            table_op_ms=result.table_op_ms,
            table_moved=table_moved,
        )

    def _check_table_op(self, case: TestCase, result: RunResult) -> EvalScore:
        move = case.expect.get("tableMove") or {"from": 0, "to": 1}
        frm, to = int(move.get("from", 0)), int(move.get("to", 1))
        moved = f"{frm}→{to}"
        expect = case.expect

        if result.table_op_missing or result.missing:
            if result.table_op_batch_failure == "timeout" or result.batch_failure == "timeout":
                return self._make(case, result, Outcome.TIMEOUT, "列拖动全局超时", table_moved=moved)
            return self._make(
                case, result, Outcome.TABLE_CORRUPTION,
                "列拖动进程崩溃（无结果行）", table_moved=moved,
            )

        op = result.table_op
        if op.get("status") == "throw":
            return self._make(
                case, result, Outcome.TABLE_CORRUPTION,
                f"列拖动抛异常：{op.get('error', '?')}", table_moved=moved,
            )

        before, after = op.get("before"), op.get("after")
        if after is None:
            return self._make(
                case, result, Outcome.DEGRADED,
                op.get("error") or "未渲染出表格 widget", table_moved=moved,
            )

        layout = expect.get("tableLayout") or {}
        if layout and op.get("status") == "noop":
            table_w = op.get("tableWidth")
            view_w = op.get("viewportWidth")
            ratio = f"（表宽约 {table_w}px / 视口约 {view_w}px）" if table_w and view_w else ""
            return self._make(
                case, result, Outcome.TABLE_CORRUPTION,
                f"宽表列拖动未落到目标列：文档未变化{ratio}——拖动 {moved} 后仍无法放置到其他列",
                table_moved=moved,
            )

        if expect.get("normalizePipes") and not op.get("pipesNormalized"):
            sample = (op.get("nonPipeTableLines") or ["?"])[0]
            return self._make(
                case, result, Outcome.TABLE_CORRUPTION,
                f"表格已渲染但保存后未补全行首竖线，例如：{sample}",
                table_moved=moved,
            )

        want_tables = expect.get("tableCountAfter")
        if want_tables is not None:
            got = op.get("tableWidgetCount")
            if got != want_tables:
                return self._make(
                    case, result, Outcome.TABLE_CORRUPTION,
                    f"拖动后表格 widget 数量应为 {want_tables}，实为 {got}",
                    table_moved=moved,
                )

        if expect.get("secondTableUnchanged") and not op.get("secondTableUnchanged"):
            return self._make(
                case, result, Outcome.TABLE_CORRUPTION,
                "拖动上方表格列后，下方相邻表格内容被改变（可能发生合并或串写）",
                table_moved=moved,
            )

        expected = self._oracle_move(before or "", frm, to)
        actual = self._parse_table(after)

        table_idx = int(expect.get("tableIndex", 0))
        before_blocks = self._split_table_blocks(before or "")
        after_blocks = self._split_table_blocks(after or "")
        if before_blocks and (table_idx > 0 or expect.get("tableCountAfter") is not None):
            if table_idx >= len(before_blocks):
                return self._make(
                    case, result, Outcome.TABLE_CORRUPTION,
                    f"文档中只有 {len(before_blocks)} 个表格块，无法检查 index={table_idx}",
                    table_moved=moved,
                )
            expected = self._oracle_move(before_blocks[table_idx], frm, to)
            actual = (
                self._parse_table(after_blocks[table_idx])
                if table_idx < len(after_blocks)
                else []
            )

        counts = [len(r) for r in actual]
        if len(set(counts)) > 1:
            return self._make(
                case, result, Outcome.TABLE_CORRUPTION,
                f"列拖动后各行列数不一致：{counts}（表头与数据行错位）",
                table_moved=moved,
            )

        if actual != expected:
            detail = "整体与正确重排不符"
            for i in range(max(len(expected), len(actual))):
                exp = expected[i] if i < len(expected) else None
                act = actual[i] if i < len(actual) else None
                if exp != act:
                    detail = f"第 {i} 行：应为 {exp}，实为 {act}"
                    break
            return self._make(
                case, result, Outcome.TABLE_CORRUPTION,
                f"列拖动 {moved} 结果错误——{detail}",
                table_moved=moved,
            )

        return self._make(
            case, result, Outcome.OK,
            f"列拖动 {moved} 与正确重排逐格一致（各行 {counts[0] if counts else 0} 列）",
            table_moved=moved,
        )

    def evaluate(self, cases: list[TestCase], results: list[RunResult]) -> list[EvalScore]:
        by_id = {r.case_id: r for r in results}
        return [self._check_table_op(c, by_id[c.id]) for c in cases]

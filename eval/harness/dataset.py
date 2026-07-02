"""模块 1：Dataset —— 加载 table-drag.yaml 用例。"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from . import env

try:
    import yaml
except ModuleNotFoundError as exc:  # pragma: no cover
    raise SystemExit(
        "缺少依赖 pyyaml。请先安装：\n"
        "  python3 -m venv eval/.venv && eval/.venv/bin/pip install -r eval/requirements.txt"
    ) from exc


@dataclass(frozen=True)
class TestCase:
    id: str
    input: str
    source_file: str
    tags: tuple[str, ...] = ()
    note: str = ""
    expect: dict[str, Any] = field(default_factory=dict)


def load_dataset(corpus_file: Path | None = None) -> list[TestCase]:
    """加载 eval/corpus/table-drag.yaml。"""
    path = corpus_file or env.CORPUS_FILE
    if not path.is_file():
        raise FileNotFoundError(f"未找到语料文件：{path}")

    doc = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    raw_cases = doc.get("cases", [])
    if not isinstance(raw_cases, list):
        raise ValueError(f"{path.name} 顶层应为 cases 列表")

    cases: list[TestCase] = []
    seen: set[str] = set()
    for raw in raw_cases:
        case_id = raw.get("id")
        if not case_id:
            raise ValueError(f"{path.name} 中存在缺少 'id' 的用例")
        if case_id in seen:
            raise ValueError(f"用例 id 重复：{case_id!r}")
        if not str(case_id).lower().startswith(env.TABLE_DRAG_PREFIX):
            raise ValueError(
                f"用例 {case_id!r} 必须以 {env.TABLE_DRAG_PREFIX!r} 开头（仅支持 table-drag 语料）"
            )
        if "input" not in raw:
            raise ValueError(f"用例 {case_id!r} 缺少 'input'")
        seen.add(case_id)
        cases.append(
            TestCase(
                id=case_id,
                input=raw["input"],
                source_file=path.name,
                tags=tuple(raw.get("tags", []) or []),
                note=raw.get("note", "") or "",
                expect=dict(raw.get("expect", {}) or {}),
            )
        )
    return cases


def filter_cases(
    cases: list[TestCase], tag: str | None, id_substr: str | None
) -> list[TestCase]:
    result = cases
    if tag:
        result = [c for c in result if tag in c.tags]
    if id_substr:
        result = [c for c in result if id_substr in c.id]
    return result

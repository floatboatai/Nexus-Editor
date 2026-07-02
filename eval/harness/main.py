"""表格列拖动 Eval 入口：Dataset → Runner → Evaluator → Reporter

用法：
    ./eval/run.sh                          # 跑 table-drag.yaml 全部用例
    ./eval/run.sh --tag ragged             # 按标签过滤
    ./eval/run.sh --id user-report         # 按 id 子串过滤
    ./eval/run.sh --verbose --json --rebuild

无硬失败时退出码 0，否则 1。
"""

from __future__ import annotations

import argparse
import sys

from . import env
from .dataset import filter_cases, load_dataset
from .evaluator import Evaluator
from .reporter import Reporter, build_report, print_json
from .runner import BridgeError, Runner


def parse_args(argv: list[str]) -> env.Config:
    p = argparse.ArgumentParser(description="Nexus 表格列拖动 Eval（仅 table-drag.yaml）")
    p.add_argument("--tag", help="仅运行带此标签的用例")
    p.add_argument("--id", dest="id_substr", help="仅运行 id 含该子串的用例")
    p.add_argument("--verbose", action="store_true", help="列出每条用例而非仅失败项")
    p.add_argument("--json", dest="as_json", action="store_true", help="输出 JSON 报告")
    p.add_argument("--rebuild", action="store_true", help="强制重打包 Node 桥")
    p.add_argument("--timeout", type=float, default=60.0, help="全局墙钟超时（秒）")
    p.add_argument("--node", default="node", help="node 可执行文件")
    p.add_argument("--baseline", type=float, default=1.0,
                   help="基线通过率，用于回归对比（默认 1.0；传 -1 关闭）")
    a = p.parse_args(argv)
    return env.Config(
        tag=a.tag,
        id_substr=a.id_substr,
        verbose=a.verbose,
        as_json=a.as_json,
        rebuild=a.rebuild,
        timeout_s=a.timeout,
        node_bin=a.node,
        baseline_pass_rate=None if a.baseline is not None and a.baseline < 0 else a.baseline,
    )


def main(argv: list[str] | None = None) -> int:
    cfg = parse_args(sys.argv[1:] if argv is None else argv)

    cases = load_dataset()
    cases = filter_cases(cases, cfg.tag, cfg.id_substr)
    if not cases:
        print("没有用例匹配给定过滤条件", file=sys.stderr)
        return 1

    runner = Runner(timeout_s=cfg.timeout_s, node_bin=cfg.node_bin)
    try:
        results = runner.run_all(cases, rebuild=cfg.rebuild)
    except BridgeError as exc:
        print(f"[eval] 桥构建错误：{exc}", file=sys.stderr)
        return 1

    scores = Evaluator().evaluate(cases, results)
    report = build_report(scores)

    if cfg.as_json:
        print_json(scores, report)
    else:
        Reporter(baseline_pass_rate=cfg.baseline_pass_rate).print_report(
            report, scores, verbose=cfg.verbose
        )

    return 1 if report.failed else 0


if __name__ == "__main__":
    raise SystemExit(main())

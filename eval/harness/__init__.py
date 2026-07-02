"""Nexus-Editor Eval Harness —— Core 解析器健壮性评测。

四模块流水线（对齐参考 harness 的 Dataset → Runner → Evaluator → Reporter）：
    dataset.py    加载残缺 Markdown 用例（YAML）
    runner.py     打包并驱动 Node 解析桥，产出 RunResult
    evaluator.py  规则评测，判定 Outcome / 分数
    reporter.py   rich 表格 + 基线回归（纯文本回退）
    main.py       串联流水线，返回门禁退出码
"""

__all__ = ["dataset", "runner", "evaluator", "reporter", "env", "main"]

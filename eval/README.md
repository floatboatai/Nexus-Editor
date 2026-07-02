# Nexus Table Drag Eval

针对 **表格列拖动（`moveColumn`）** 的 headless 评测框架。仅加载 `corpus/table-drag.yaml`，
通过真实 `createEditor` + 模拟列把手拖动，断言列重排后单元格守恒。

## 架构

```
corpus/table-drag.yaml → Dataset → Runner → table-ops-bridge.mjs → Evaluator → Reporter
```

| 模块 | 文件 | 职责 |
|------|------|------|
| Dataset | `harness/dataset.py` | 加载 `table-drag.yaml` |
| Runner | `harness/runner.py` | 打包并驱动 `table-ops-bridge` |
| Evaluator | `harness/evaluator.py` | oracle 对照列重排结果 |
| Reporter | `harness/reporter.py` | 输出报告 |

## 环境

```bash
python3 -m venv eval/.venv
eval/.venv/bin/pip install -r eval/requirements.txt
pnpm install   # 仓库根目录，提供 tsup 与 core 依赖
```

## 用法

```bash
./eval/run.sh
./eval/run.sh --tag wide
./eval/run.sh --id wellformed
./eval/run.sh --verbose --json --rebuild
```

## 用例格式

见 `corpus/table-drag.yaml`。每条用例 `id` 必须以 `tabledrag-` 开头。

`expect` 常用字段：

- `tableMove: { from, to }` — 拖哪列到哪列（0 基）
- `tableLayout` — 模拟宽表视口（`viewportWidth`、`columnWidths` 等）
- `normalizePipes: true` — 保存后表格行必须以 `|` 开头
- `tableCountAfter` / `tableIndex` / `secondTableUnchanged` — 多表场景

## 判定结果

| Outcome | 含义 |
|---------|------|
| `ok` | 列重排与 oracle 一致 |
| `degraded` | 未渲染出表格 widget |
| `table-corruption` | 行列错乱、丢单元格、宽表无法放置等 |
| `crash` / `timeout` | Node 进程崩溃或超时 |

## 目录

```
eval/
├── run.sh
├── run_eval.py
├── requirements.txt
├── corpus/table-drag.yaml
├── harness/
└── bridge/
    ├── table-ops-bridge.ts
    ├── setup-dom.ts
    ├── tsup.config.ts
    └── dist/          # 打包产物（git 忽略）
```

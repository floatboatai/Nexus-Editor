# Nexus-Editor 项目全面分析

> 生成时间：2026-08-10 | 项目版本：v0.0.13 | 许可证：MIT

---

## 项目定位

Nexus-Editor 是一个 **Headless（无头）、AST 驱动的 Markdown 编辑器引擎**，基于 CodeMirror 6 和 Unified 生态构建。

核心设计理念：**以 Markdown 文本为唯一数据源**，提供 Obsidian 风格的实时预览，且完全不绑定 UI 框架。

- 技术栈：TypeScript + CodeMirror 6 + unified/remark + Lezer + Electron
- 包管理：pnpm workspaces（monorepo，13 个 workspace 项目）

---

## 文档体系

本文件是项目总览，详细分析见子文档：

| 子文档 | 内容 |
|---|---|
| [01-architecture.md](./01-architecture.md) | 架构设计 — 数据流、三层插件体系、Live Preview、安全、主题、多光标、Widget API |
| [02-packages-reference.md](./02-packages-reference.md) | 包与 API 参考 — 11 个 npm 包的全部源文件、导出 API、复杂度、Demo 加载状态 |
| [03-specs-compilation.md](./03-specs-compilation.md) | 规范汇总 — 9 个 OpenSpec 提案的所有功能定义与验收标准 + 追溯矩阵 |
| [04-roadmap.md](./04-roadmap.md) | 路线图 — 9 大类 29 项功能的优先级、状态、完成度统计 |
| [05-electron-demo.md](./05-electron-demo.md) | Electron Demo 分析 — 主进程/渲染进程、插件加载、测试覆盖 |

---

## 根目录结构

```
Nexus-Editor/
├── .claude/          ← Claude AI 助手 slash command
├── .github/          ← CI/CD 与 PR 模板
├── apps/             ← Electron Demo 应用
├── docs/             ← 路线图与设计文档
├── openspec/         ← 规范驱动开发（9 个变更提案）
├── packages/         ← 核心代码包（11 个 npm 包）
├── prd.md            ← 产品需求文档
└── 配置文件
```

---

## 核心数据流

```
用户输入 → CM6 Transaction → EditorState
  ↓
Lezer 增量解析 → mdast AST（同步，无 Worker）
  ↓
remark 插件（可选 transform）
  ↓
Live Preview Decorations
  ↓
onChange(markdown, ast) → 宿主持久化
```

---

## 11 个 npm 包

| 包 | 职责 | 复杂度 | Demo |
|---|---|---|---|
| core | 编辑器引擎（CM6 + Lezer + Live Preview + AST + 事件） | 极高 | 引擎 |
| react | React `useEditor` Hook + `<Editor />` 组件 | 中等 | — |
| vue | Vue 3 `useEditor` Composable + `<Editor />` 组件 | 中等 | — |
| preset-gfm | GFM 预设（表格、删除线、任务列表） | 简单 | 加载 |
| plugin-slash | 斜杠菜单（状态计算 + 浮动 UI ~500 行） | 复杂 | 加载 |
| plugin-search | 搜索替换（~1164 行，含表格内 CSS Highlight） | 复杂 | 加载 |
| plugin-toolbar | 格式化工具栏（8 快捷键 + 14 斜杠命令 + 颜色装饰） | 中等 | 加载 |
| plugin-wordcount | 字数/CJK/阅读时间统计 + ARIA 状态栏 | 中等 | 加载 |
| plugin-math | KaTeX 数学公式（块级+行内） | 中等 | — |
| plugin-history | 撤销/重做 | 简单 | 加载 |
| plugin-vim | Vim 键绑定 | 简单 | — |

---

## 路线图完成度

| 优先级 | 已完成 | 规划/进行中 |
|---|---|---|
| P0 | 6 | 1 |
| P1 | 5 | 4 |
| P2 | 1 | 8 |
| P3 | 0 | 3 |
| **总计** | **12 (41%)** | **17 (59%)** |

---

## 启动方式

```bash
# 安装依赖（国内镜像）
COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm install --registry=https://registry.npmmirror.com --ignore-scripts

# Electron 二进制
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ \
  node node_modules/.pnpm/electron@*/node_modules/electron/install.js

# 构建所有包
pnpm build

# 启动 Demo（Vite http://localhost:5173 + Electron 窗口）
pnpm dev:electron-demo
```

---

## AI 功能现状

项目当前 **没有任何 AI / LLM 集成**（无 DeepSeek、OpenAI、GPT 相关代码）。

根据 [GOVERNANCE.md](file:///Users/mac/PycharmProjects/Nexus_Editor/GOVERNANCE.md) §4.2，AI 功能被**明确排除在项目范围之外**——这属于宿主应用的职责。三层插件架构完全支持宿主自行接入 AI。

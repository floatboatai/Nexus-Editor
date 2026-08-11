# 04 — 路线图与状态

> 对应原始文档：`docs/ROADMAP.md` | 9 大类、29 项功能

---

## 状态定义

- `planned` — 规划中
- `in-progress` — 进行中
- `done` — 已合并到 main
- `dropped` — 已放弃
- `P0` — 当前迭代 | `P1` — 下一个 | `P2` — 中期 | `P3` — 长期

---

## 1. 工具栏 / 文本编辑

| # | 功能 | 包 | 优先级 | 状态 | OpenSpec | 备注 |
|---|---|---|---|---|---|---|
| 1 | 多行列表切换（有序/无序） | plugin-toolbar + core | P1 | **done** | add-selection-api | 随 `getSelectedText()` / `replaceRange()` 交付 |
| 12 | 高级工具栏（emoji/表格工具/颜色选择器） | plugin-toolbar | P2 | planned | 需要 | 引入 widgets，拆分为 3 个子提案 |

## 2. 搜索 / 命令

| # | 功能 | 包 | 优先级 | 状态 | OpenSpec | 备注 |
|---|---|---|---|---|---|---|
| 2 | 整词匹配 | plugin-search | P1 | **done** | — | `\b` 边界 |
| 15 | 正则搜索 | plugin-search | P1 | **done** | — | 无效正则保护 |
| 16 | 命令/搜索历史 | plugin-search + plugin-slash | P2 | **done** | add-search-query-history + add-slash-recent-command-history | 宿主注入存储 |
| 17 | 模糊搜索 | plugin-search | P2 | planned | — | 需要回溯匹配器 |
| 3 | 斜杠命令排序+限制 | plugin-slash | P0 | **done** | add-slash-menu-ui | 6 级排序 + limit |
| 27 | 斜杠命令浮动菜单 UI | plugin-slash | P0 | **done** | add-slash-menu-ui | `createSlashMenuUI()` |

## 3. 核心编辑器

| # | 功能 | 包 | 优先级 | 状态 | OpenSpec | 备注 |
|---|---|---|---|---|---|---|
| 5 | `getSelectedText()` API | core | P0 | **done** | add-selection-api | + 原子 `replaceRange()` |
| 6 | 多光标/多选区 | core | P1 | **done** | add-core-multi-cursor | `multiCursor` 配置 |
| 7 | AST 增强/Markdown 扩展 | core + preset-gfm | P2 | planned | 需要 | 影响所有 AST 依赖插件 |
| 8 | 撤销/重做分组 | plugin-history | P1 | planned | — | 需协调 tableEditingCount |

## 4. 插件系统

| # | 功能 | 包 | 优先级 | 状态 | OpenSpec | 备注 |
|---|---|---|---|---|---|---|
| 9 | Widget API 标准化 | core | P1 | planned | 需要 | 现有 widgets 有很多陷阱 |
| 10 | 插件事件总线 | core | P2 | planned | 需要 | 影响所有 plugin-* |
| 11 | 插件热重载 | core | P3 | planned | 需要 | 仅开发模式；依赖 #9 |

## 5. UI / 预览 / 键映射

| # | 功能 | 包 | 优先级 | 状态 | OpenSpec | 备注 |
|---|---|---|---|---|---|---|
| 13 | Live Preview 同步滚动 | core | P2 | planned | — | 仅分屏预览模式相关 |
| 14 | 自定义键映射 UI | react/vue + core | P2 | planned | 需要 | 需先暴露键映射注册/查询 API |

## 6. React / Vue SDK

| # | 功能 | 包 | 优先级 | 状态 | OpenSpec | 备注 |
|---|---|---|---|---|---|---|
| 4 | `<Editor />` props 透传 + `onReady` | react + vue | P0 | **done** | — | HTMLAttributes 透传 |
| 29 | 受控文档 `value` / `v-model` | react + vue | P0 | **done** | — | silent setDocument 同步 |

## 7. 协作

| # | 功能 | 包 | 优先级 | 状态 | OpenSpec | 备注 |
|---|---|---|---|---|---|---|
| 18 | 实时协作（OT/CRDT） | 新 plugin-collab | P3 | planned | 需要 | 大功能，需技术选型 |
| 19 | 版本历史/快照 | core + 宿主存储 | P2 | planned | 需要 | electron-demo 先落地参考实现 |
| 20 | 评论/@提及 | 新 plugin-annotation | P3 | planned | 需要 | 依赖 #18 |

## 8. 跨平台

| # | 功能 | 包 | 优先级 | 状态 | OpenSpec | 备注 |
|---|---|---|---|---|---|---|
| 21 | Electron 打包优化 | apps/electron-demo | P1 | planned | — | 大小、启动时间、自动更新 |
| 22 | Web Component / iframe 封装 | 新 wc 包 | P2 | planned | 需要 | 与 React/Vue SDK 共享 core |
| 23 | 云存储接口 | core 存储适配层 | P2 | planned | 需要 | NoteVault 接口 + 可插拔后端 |

## 9. 开发者体验

| # | 功能 | 包 | 优先级 | 状态 | OpenSpec | 备注 |
|---|---|---|---|---|---|---|
| 24 | TypeScript 类型覆盖 | 全仓库 | P0 | **in-progress** | — | 持续推进，新代码强制 strict |
| 25 | 端到端测试 | 仓库基础设施 | P1 | planned | — | 候选：Playwright 对 electron-demo |
| 26 | CI/CD 流水线完善 | .github/workflows | P1 | **in-progress** | — | PR 检查和发布流水线已有，缺 e2e 门禁 |
| 28 | Markdown 感知字数/阅读时间统计 | plugin-wordcount | P1 | **done** | add-plugin-wordcount | AST 复用 + CJK 优先 + ARIA 状态栏 |

---

## 完成度统计

| 状态 | 数量 | 占比 |
|---|---|---|
| **done** | 12 | 41% |
| **in-progress** | 2 | 7% |
| **planned** | 15 | 52% |

| 优先级 | done | planned/in-progress |
|---|---|---|
| P0 | 6 | 1 |
| P1 | 5 | 4 |
| P2 | 1 | 8 |
| P3 | 0 | 3 |

---

## AI 功能明确不在范围

根据 [GOVERNANCE.md](file:///Users/mac/PycharmProjects/Nexus_Editor/GOVERNANCE.md) §4.2：

> **AI / LLM integrations of any kind** — neither in `packages/` nor in `apps/electron-demo`. This includes: text generation, AI rewriting, autocomplete via cloud LLMs, agent panels, embedded AI tools. These are the responsibility of the host application that depends on Nexus.

AI 功能（文本生成、AI 重写、云端 LLM 自动补全、Agent 面板）被**明确排除在项目范围之外**，属于宿主应用的职责。

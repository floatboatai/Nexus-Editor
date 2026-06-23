# Nexus Editor Roadmap

本文档是 Nexus Editor 已规划功能的**功能 → 包归属 → 优先级 → 状态**映射表。

[English](./ROADMAP.md)

- 任何新加入 roadmap 的条目都应在此处登记一行，再决定是否走 OpenSpec proposal。
- 状态值：`planned`（规划中）/ `in-progress`（开发中）/ `blocked`（阻塞）/ `done`（已合并到 `main`）/ `dropped`（废弃）。
- 优先级：`P0`（当前迭代）/ `P1`（下一迭代）/ `P2`（中期）/ `P3`（远期）。
- "需要 OpenSpec" = 是否需要走 `openspec/changes/` 提案（详见 `CONTRIBUTING.md` §3.1）。

---

## 1. Toolbar / 文本处理

| # | 功能 | 归属包 | 优先级 | 状态 | 需要 OpenSpec | 备注 |
|---|---|---|---|---|---|---|
| 1 | 多行列表切换（ordered / unordered） | `plugin-toolbar` + `core` 命令 | P1 | done | 否 | 随 `getSelectedText()` / `replaceRange()` 一并落地 —— 见 `openspec/changes/add-selection-api` |
| 12 | 高级 toolbar（emoji picker / 表格工具 / 颜色选择） | `plugin-toolbar` | P2 | planned | 是 | 涉及新 widget，建议拆 3 个子提案 |

## 2. Search / 命令

| # | 功能 | 归属包 | 优先级 | 状态 | 需要 OpenSpec | 备注 |
|---|---|---|---|---|---|---|
| 2  | whole-word 匹配 | `plugin-search` | P1 | done | 否 | 经 `buildSearchPattern` 的 `wholeWord` 选项，使用 `\b` 边界 |
| 15 | 正则搜索 | `plugin-search` | P1 | done | 否 | `regexp` 选项与 whole-word 一并落地；非法正则有保护 |
| 16 | 历史命令 / 搜索记忆 | `plugin-search` + `plugin-slash` | P2 | done | 是 | 宿主注入式存储（不隐式写 localStorage）—— `add-search-query-history` + `add-slash-recent-command-history` |
| 17 | 模糊搜索 | `plugin-search` | P2 | planned | 否 | 评估 fzf-like 算法 vs. 第三方 lib；需带回溯的匹配器 |
| 3  | Slash 命令排序与 limit | `plugin-slash` | P0 | done | 是 | 与浮层菜单 UI 一并落地 —— 见 `openspec/changes/add-slash-menu-ui` |
| 27 | Slash 命令浮层菜单 UI | `plugin-slash` + `electron-demo` | P0 | done | 是 | `createSlashMenuUI(editor, options)` —— 见 `openspec/changes/add-slash-menu-ui` |

## 3. Core Editor

| # | 功能 | 归属包 | 优先级 | 状态 | 需要 OpenSpec | 备注 |
|---|---|---|---|---|---|---|
| 5 | `getSelectedText()` API | `core` | P0 | done | 否 | 另含原子 `replaceRange()`（单条 undo）—— 见 `openspec/changes/add-selection-api` |
| 6 | 多光标 / 多选支持 | `core` | P1 | done | 是 | `openspec/changes/add-core-multi-cursor` — opt-in `multiCursor` 配置；live-preview 揭示与表格检查已有回归测试覆盖 |
| 7 | AST 增强 / Markdown 扩展 | `core` + `preset-gfm` | P2 | planned | 是 | 影响序列化与所有依赖 AST 的插件 |
| 8 | undo / redo 分组 | `plugin-history` | P1 | planned | 否 | 注意与表格交互的 `tableEditingCount` 协同；合并前需收敛多个竞品实现 |

## 4. 插件系统

| # | 功能 | 归属包 | 优先级 | 状态 | 需要 OpenSpec | 备注 |
|---|---|---|---|---|---|---|
| 9  | Widget API 标准化 | `core` | P1 | planned | 是 | 现有 widget 已多次踩坑（见 CLAUDE.md），需先定 spec |
| 10 | 插件事件总线 | `core` | P2 | planned | 是 | 影响所有现存 plugin-* |
| 11 | 热加载插件 | `core` | P3 | planned | 是 | 仅 dev 模式，依赖 #9 完成 |

## 5. UI / Preview / 快捷键

| # | 功能 | 归属包 | 优先级 | 状态 | 需要 OpenSpec | 备注 |
|---|---|---|---|---|---|---|
| 13 | Markdown live preview 同步滚动 | `core` | P2 | planned | 否 | 仅在分屏 preview 场景生效 |
| 14 | 自定义快捷键界面 | `react` / `vue` + `core` | P2 | planned | 是 | 需要先暴露 keymap 注册 / 查询 API |

## 6. React / Vue SDK

| # | 功能 | 归属包 | 优先级 | 状态 | 需要 OpenSpec | 备注 |
|---|---|---|---|---|---|---|
| 4 | `<Editor />` 容器属性透传 + `onReady` 回调 | `react`（同步补 `vue`） | P0 | done | 否 | 完整 `HTMLAttributes` 透传 + `onReady`；react/vue 两端对齐 |
| 29 | 受控文档 `value` / `v-model` | `react` + `vue` | P0 | done | 否 | 父组件驱动 Markdown，`setDocument(..., { silent: true })` 防反馈环；helpers 在 `controlled-document.ts` |

## 7. 协作

| # | 功能 | 归属包 | 优先级 | 状态 | 需要 OpenSpec | 备注 |
|---|---|---|---|---|---|---|
| 18 | 实时协作（OT / CRDT） | 新包 `plugin-collab` | P3 | planned | 是 | 大特性，先做技术选型 design doc |
| 19 | 版本历史 / 快照 | `core` + 宿主存储 | P2 | planned | 是 | electron-demo 先落地参考实现 |
| 20 | 共享注释 / @mention | 新包 `plugin-annotation` | P3 | planned | 是 | 依赖 #18 完成 |

## 8. 跨平台

| # | 功能 | 归属包 | 优先级 | 状态 | 需要 OpenSpec | 备注 |
|---|---|---|---|---|---|---|
| 21 | Electron 打包优化 | `apps/electron-demo` | P1 | planned | 否 | 关注体积、启动时长、autoUpdater |
| 22 | Web Component / iframe 封装 | 新包 `wc` | P2 | planned | 是 | 与 React/Vue SDK 共享 core 实例 |
| 23 | 云端存储接口 | `core`（storage 适配层） | P2 | planned | 是 | 抽象 NoteVault interface，多后端实现 |

## 9. 开发体验

| # | 功能 | 归属包 | 优先级 | 状态 | 需要 OpenSpec | 备注 |
|---|---|---|---|---|---|---|
| 24 | TypeScript 类型覆盖 | 全仓库 | P0 | in-progress | 否 | 持续推进，新代码强制 strict |
| 25 | End-to-End 测试 | 仓库基建 | P1 | planned | 否 | 候选：Playwright，跑 electron-demo |
| 26 | CI/CD 流程完善 | `.github/workflows` | P1 | planned | 否 | 已有 publish workflow，缺 PR check / e2e gate |
| 28 | Markdown 感知字数 / 阅读时长统计 | 新包 `plugin-wordcount` | P1 | done | 是 | 复用编辑器 AST（不重复解析）+ 中日韩优先 + ARIA 状态栏 —— 见 `openspec/changes/add-plugin-wordcount` |

---

## 维护流程

1. **新增条目**：在合适的分组追加一行，编号往下递增；同时在 PR 描述中说明。
2. **状态变更**：开始开发 → `in-progress`；合并到 `main` → `done`；放弃 → `dropped`（保留行用于追溯）。
3. **优先级调整**：由 maintainer 在每次迭代规划时统一调整，不在功能 PR 中顺手改。
4. **关联 OpenSpec**：当某条目走 OpenSpec 流程后，把 `openspec/changes/<id>/` 链接补到该行"备注"列。

# Nexus-Editor 全面分析报告

> **生成日期**：2026-07-13
> **基准版本**：v0.0.13
> **分析范围**：全仓库（monorepo 11 包 + 1 Electron Demo）

---

## 一、项目概况

### 1.1 定位

Nexus-Editor 是一个**无头（Headless）、AST 驱动的 Markdown 编辑器引擎**，基于 CodeMirror 6 + unified（remark/rehype）生态。核心卖点：

- **Markdown 文本是数据的真值**，不做 JSON 中间表示的来回转换（与 Tiptap/Lexical/Milkdown 的根本区别）
- **Obsidian 风格的内联实时预览**（光标聚焦时展开原始语法，离开后渲染为富文本）
- **框架无关核心** + 官方 React / Vue 绑定
- **三层插件体系**：快捷键命令层 → AST/Widget 层 → CM6 原生扩展层
- **本地优先**，为 Electron / Tauri 桌面端场景设计

### 1.2 竞品对比摘要

| 维度 | Nexus | Tiptap | Lexical | Milkdown | MDXEditor |
|---|---|---|---|---|---|
| 文档真值 | Markdown 文本 | JSON 树 | JSON 树 | ProseMirror doc | Lexical state |
| 无损来回转换 | ✅ | ⚠️ | ⚠️ | ⚠️ | ⚠️ |
| UI 模式 | Headless | Headless | 偏 Headless | WYSIWYG | WYSIWYG |
| 实时预览 | Obsidian 风格内联 | 无 | 无 | 完全 WYSIWYG | 完全 WYSIWYG |
| 框架支持 | React/Vue/Vanilla | React/Vue/Svelte | React 优先 | React/Vue | 仅 React |
| 许可证 | MIT | MIT | MIT | MIT | MIT |

---

## 二、技术栈深度分析

### 2.1 核心技术选型

| 层级 | 技术 | 版本 | 用途 |
|---|---|---|---|
| 编辑器内核 | CodeMirror 6 | ^6.41.0 (view) | 文本编辑、选区管理、光标渲染 |
| Markdown 解析 | @lezer/markdown | ^1.4.0 | Lezer 语法树（CM6 原生） |
| AST 管道 | unified + remark-parse + remark-rehype + rehype-stringify | ^11.x | mdast 解析、HTML 导出 |
| 代码高亮 | highlight.js | ^11.11.0 | 代码块语法高亮 |
| 图表渲染 | mermaid | ^11.0.0 | Mermaid 图表 |
| 前端框架 | React 19 / Vue 3.5 | ^19.2.0 / ^3.5.22 | 框架绑定 SDK |
| 构建工具 | tsup | ^8.5.0 | 各包 ESM 构建 |
| 测试框架 | Vitest + jsdom | ^2.1.9 | 单元测试 + DOM 测试 |
| 包管理 | pnpm | 9.15.4 | workspace monorepo |
| 类型系统 | TypeScript | ^5.9.3 | strict 模式 |
| 桌面端 | Electron | ^35.0.0 | Electron Demo |
| 桌面构建 | electron-builder | ^25.1.8 | 打包（Win/Mac/Linux） |

### 2.2 依赖分析

**核心包 `@floatboat/nexus-core` 运行时依赖（14 个）**：
- CodeMirror 6 全家桶：state, view, language, commands, autocomplete, lang-markdown
- Lezer 解析器：common, markdown
- 辅助：indentation-markers, vim (@replit/codemirror-vim)
- AST 管道：unified, remark-parse, remark-rehype, rehype-stringify
- 代码高亮：highlight.js
- 图表：mermaid

**依赖风险点**：
- `mermaid` 体积较大（~1MB+），目前打包在 core 依赖中，后续可考虑拆为独立插件
- `highlight.js` 同样有体积问题，但已做 per-block LRU 缓存优化
- `@replit/codemirror-indentation-markers` 和 `@replit/codemirror-vim` 来自 Replit 社区，非 CodeMirror 官方

### 2.3 构建与 CI

- **构建**：`tsup` 打 ESM 格式 + DTS 类型声明，`electron-builder` 打桌面安装包
- **CI**（[ci.yml](file:///f:/AiAutoCode/A4-finished-Item/MarkdownEditor/Nexus-Editor/.github/workflows/ci.yml)）：GitHub Actions，Node 22 + pnpm 9.15.4，流程为 typecheck → test → build → build:electron-demo
- **发布**：Release 或 workflow_dispatch 触发，通过 `pnpm publish:packages` 发布到 npm
- **测试环境**：jsdom 模拟浏览器 DOM，所有测试在 Node 环境运行

---

## 三、架构分析

### 3.1 Monorepo 包结构

```
Nexus-Editor/
├── packages/
│   ├── core/              ← 核心引擎（8,733 行源码）
│   ├── preset-gfm/        ← GFM 预设（10 行，薄封装）
│   ├── plugin-history/    ← 撤销/重做（11 行，薄封装）
│   ├── plugin-search/     ← 搜索替换（1,164 行）
│   ├── plugin-slash/      ← 斜杠命令（650 行）
│   ├── plugin-toolbar/    ← 工具栏（1,342 行）
│   ├── plugin-math/       ← 数学公式 KaTeX（130 行）
│   ├── plugin-vim/        ← Vim 键位（9 行，薄封装）
│   ├── plugin-wordcount/  ← 字数统计（869 行）
│   ├── react/             ← React SDK（193 行）
│   └── vue/               ← Vue 3 SDK（291 行）
├── apps/
│   └── electron-demo/     ← 桌面端集成测试场（3,836 行）
├── openspec/              ← 规格驱动提案系统
│   └── changes/           ← 9 个变更提案
└── docs/
    ├── ROADMAP.zh.md      ← 功能路线图
    └── superpowers/       ← 历史设计文档
```

### 3.2 代码规模汇总

| 分类 | 行数 | 占比 |
|---|---|---|
| 全部源码 | 17,238 | 64.3% |
| 全部测试 | 9,571 | 35.7% |
| **总计** | **26,809** | 100% |

**各包源码规模排名**：
1. core — 8,733 行（核心引擎，占 50.7%）
2. electron-demo — 3,836 行（桌面端 Demo）
3. plugin-toolbar — 1,342 行
4. plugin-search — 1,164 行
5. plugin-wordcount — 869 行
6. plugin-slash — 650 行
7. vue — 291 行
8. react — 193 行
9. plugin-math — 130 行
10. 其余薄封装合计 — 30 行

**测试覆盖率**：核心包测试 5,418 行 / 源码 8,733 行 = 约 62% 测试代码比，整体质量较高。

### 3.3 核心引擎架构

核心引擎（[editor.ts](file:///f:/AiAutoCode/A4-finished-Item/MarkdownEditor/Nexus-Editor/packages/core/src/editor.ts)）围绕以下模块构建：

| 模块 | 文件 | 职责 |
|---|---|---|
| 编辑器生命周期 | editor.ts | createEditor 工厂、CM6 实例化、插件组合 |
| 类型系统 | types.ts | EditorConfig, EditorAPI, NexusPlugin, WidgetDefinition 等 |
| 实时预览 | live-preview.ts | ViewPlugin + StateField + Decoration 管理 |
| 预览范围检测 | live-preview-ranges.ts | AST 遍历 → LivePreviewRange 集合 |
| 预览渲染器 | live-preview-renderers.ts | 默认渲染器 + 自定义渲染器分发 |
| 表格编辑 | live-preview-table.ts | 可编辑表格 Widget（12 条严格规则） |
| 代码高亮 | live-preview-highlight.ts | highlight.js 集成 + LRU 缓存 |
| 诊断 | live-preview-diag.ts | 实时预览诊断信息 |
| Lezer 适配 | lezer-markdown.ts, lezer-mdast-adapter.ts | Lezer 语法树 → mdast 转换 |
| Markdown 快捷键 | markdown-keymap.ts | 加粗/斜体/列表等快捷键 |
| Markdown 自动配对 | markdown-autopair.ts | 自动闭合括号、引号等 |
| Markdown 折叠 | markdown-fold.ts | 标题和代码块折叠 |
| 多光标 | multi-cursor.ts | Alt+Click 加光标、Ctrl+D 选词等 |
| Wiki 链接 | wikilinks.ts | `[[target]]` 双向链接 + 自动补全 |
| 斜杠状态 | slash-state.ts | `/` 触发位置计算与命令匹配 |
| 主题 | theme.ts | CSS 变量主题系统（light/dark） |
| 国际化 | locale.ts | NexusLocale（en/zh 预设） |
| Widget 扩展 | widget-extension.ts | 通用 Widget 注册与渲染 |
| 事件系统 | event-emitter.ts | on/off 事件订阅 |

### 3.4 数据流

```
用户输入 → CM6 Transaction → EditorState 更新
  ├─→ 防抖 → unified/remark 解析 → mdast AST
  │     ├─→ onChange(doc, ast) 回调
  │     ├─→ live-preview: collectRanges(ast) → Decoration.replace
  │     │     └─→ 光标不在范围内 → Widget 替换渲染
  │     │     └─→ 光标在范围内 → 展开原始 Markdown
  │     └─→ wikilinks: scanWikiLinks(ast) → LinkIndex
  └─→ 快捷键/命令 → run(editor) → 直接操作 EditorState
```

---

## 四、当前进度详解

### 4.1 已完成功能（P0 + P1 大部分）

**P0（当前迭代）— 全部完成**：
- `getSelectedText()` API + `replaceRange()` 原子替换
- Slash 命令排序与浮层菜单 UI（vanilla DOM，支持键盘/鼠标/无障碍）
- `<Editor />` `onReady` 回调 + 容器属性透传（React/Vue 双向对齐）
- 受控文档 `value` / `v-model` 支持
- TypeScript 类型覆盖（持续推进中）

**P1（下一迭代）— 已基本完成**：
- 多光标/多选支持（opt-in `multiCursor` 配置）
- Whole-word 匹配 + 正则搜索（`plugin-search`）
- 多行列表切换（ordered/unordered）
- Markdown 感知字数/阅读时长统计（`plugin-wordcount`）
- `add-missing-features` 提案中 P0/P1 全部完成

**P0-P1 未完成项**：
- Widget API 标准化（P1）
- Undo/Redo 分组（P1）
- 列表拖拽重排（P1，`add-missing-features` 2.4）
- Electron 打包优化（P1）
- E2E 测试（P1）

### 4.2 各包功能状态

| 包名 | 状态 | 核心能力 |
|---|---|---|
| `@floatboat/nexus-core` | **生产可用** | 编辑器生命周期、AST 管道、实时预览、表格编辑、Wiki 链接、多光标、主题、i18n、事件系统 |
| `@floatboat/nexus-react` | **生产可用** | `useEditor` Hook + `<Editor />` 组件 + 受控文档 |
| `@floatboat/nexus-vue` | **生产可用** | `useEditor` Composable + `<Editor />` 组件 + v-model |
| `@floatboat/nexus-preset-gfm` | **生产可用** | GFM 表格/任务列表/删除线（薄封装 remark-gfm） |
| `@floatboat/nexus-plugin-history` | **生产可用** | 撤销/重做（薄封装 CM6 history） |
| `@floatboat/nexus-plugin-search` | **生产可用** | 搜索替换、正则、whole-word、查询历史 |
| `@floatboat/nexus-plugin-slash` | **生产可用** | 斜杠命令检测、排序、浮层菜单 UI、命令历史 |
| `@floatboat/nexus-plugin-toolbar` | **生产可用** | 工具栏基础 UI、格式化命令、颜色装饰 |
| `@floatboat/nexus-plugin-math` | **可用** | 行内/块级 KaTeX 数学公式渲染 |
| `@floatboat/nexus-plugin-vim` | **可用** | Vim 键位（薄封装 @replit/codemirror-vim） |
| `@floatboat/nexus-plugin-wordcount` | **生产可用** | 字数/字符数/CJK 字符/阅读时长 + ARIA 状态栏 |

### 4.3 OpenSpec 变更状态

**已完成的 8 个提案**：
- `add-selection-api` — 选区 API 与列表切换
- `add-slash-menu-ui` — 斜杠菜单 UI
- `add-slash-recent-command-history` — 斜杠命令历史排序
- `add-search-query-history` — 搜索查询历史
- `add-plugin-wordcount` — 字数统计插件
- `add-note-vault` — Electron Demo 笔记仓库
- `add-wikilinks` — Wiki 双向链接
- `add-core-multi-cursor` — 多光标支持

**进行中的 1 个提案**：
- `add-missing-features` — 14/18 完成，剩余 4 项：列表拖拽重排、Mermaid 插件、性能基准、API 文档

### 4.4 Roadmap 状态分布

| 状态 | 数量 | 内容 |
|---|---|---|
| ✅ done | 11 | P0 全部完成 + P1 大部分 + P2 部分 |
| 🔄 in-progress | 2 | TS 类型覆盖、CI/CD 完善 |
| 📋 planned | 16 | P1 剩余 + P2 全部 + P3 全部 |

---

## 五、发展方向分析（基于 CONTRIBUTING.zh.md）

### 5.1 治理模型

[CONTRIBUTING.zh.md](file:///f:/AiAutoCode/A4-finished-Item/MarkdownEditor/Nexus-Editor/CONTRIBUTING.zh.md) 定义的核心流程：

1. **分支命名**：`<type>/<scope>-<short-desc>`（如 `feat/toolbar-list-toggle`）
2. **Commit 规范**：Conventional Commits，scope 严格白名单（core/react/vue/gfm/各插件名等）
3. **PR 流程**：新 capability / 破坏性变更 / 跨包架构调整 → 必须先走 OpenSpec proposal
4. **测试矩阵**：core 渲染层 → vitest；plugin → vitest；SDK → 框架单测；live-preview → 回归用例必加
5. **代码风格**：TypeScript strict，公共 API 必须有类型签名，不写 what 注释

### 5.2 范围边界（GOVERNANCE.md）

**在接受范围内**：
- packages/core、preset-gfm、plugin-* 编辑器级别功能
- packages/react、packages/vue 框架绑定
- apps/electron-demo 引擎能力演示

**明确拒绝**：
- AI/LLM 集成（任何形式）
- 特定供应商 SDK 捆绑
- 通用 UI 组件库（toast/dialog/modal）
- 非编辑器原语的产品功能（笔记本管理、云同步 UI、账户系统）
- 超出 AST 的 schema 校验/内容 linting

### 5.3 贡献策略

- **CLA 签署**：通过 CLA Assistant，首次 PR 签署一次，覆盖后续所有贡献
- **AI 生成代码**：不接受主要由 AI 生成的功能代码 PR；AI 辅助需在 PR 描述中披露
- **新运行时依赖**：需 MIT 兼容许可证 + maintainer 审批
- **构建产物和密钥**：严禁提交 dist/、.env、凭证等

### 5.4 重点发展方向

从 CONTRIBUTING 和 ROADMAP 综合来看，当前重点：

1. **P1 收尾**：Widget API 标准化、Undo/Redo 分组、列表拖拽重排、E2E 测试
2. **P2 中期**：高级 Toolbar、模糊搜索、滚动同步预览、Web Component 封装、插件事件总线、版本历史
3. **P3 远期**：CRDT 实时协作、共享注释/@提醒、插件热重载

---

## 六、技术债务与风险

### 6.1 已识别的技术债务

1. **Widget API 未标准化**（P1 planned）
   - 现有 Widget 已多次踩坑（见 [CLAUDE.md](file:///f:/AiAutoCode/A4-finished-Item/MarkdownEditor/Nexus-Editor/CLAUDE.md) 中的 12 条 Table Widget 规则）
   - 表格编辑的复杂度集中体现在 `live-preview-table.ts`，维护成本高

2. **Mermaid 打包在 core 依赖中**（P2 `add-missing-features` 3.5 未完成）
   - ~1MB+ 体积对所有使用者都是负担，即使不用图表功能
   - 应拆为独立插件 `@floatboat/nexus-plugin-mermaid`

3. **插件薄封装问题**
   - `plugin-history`（11 行）、`plugin-vim`（9 行）、`preset-gfm`（10 行）本质上是 CM6 的一层 re-export
   - 价值在于统一插件接口，但维护成本低，可接受

4. **缺少 E2E 测试**（P1 planned）
   - 当前仅有 vitest + jsdom 单元测试，无法覆盖真实浏览器交互
   - 候选方案：Playwright + electron-demo

5. **缺少性能基准**（P2 `add-missing-features` 4.2）
   - 大文档（>10K 行）的 AST 解析和实时预览性能未知
   - 需要 benchmark 套件

6. **缺少 API 文档**（P2 `add-missing-features` 4.3）
   - 当前仅有 [README.zh.md](file:///f:/AiAutoCode/A4-finished-Item/MarkdownEditor/Nexus-Editor/README.zh.md) 中的快速开始和 API 参考
   - 无独立 API 文档站点或生成的类型文档

### 6.2 架构风险

1. **表格编辑复杂度**
   - `live-preview-table.ts` 的 12 条规则表明这是一个脆弱模块
   - 任何鼠标交互都可能触发 CM6 Widget 重建，需要 `tableEditingCount` 防护
   - 未来 Widget API 标准化必须解决这些问题

2. **Lezer → mdast 双解析器**
   - 同时维护 Lezer 语法树（CM6 原生）和 mdast（unified 生态）
   - `lezer-mdast-adapter.ts` 是转换桥梁，需持续维护
   - 两个解析器对同一 Markdown 的解析结果可能不一致

3. **实时预览性能**
   - 每次光标移动都触发 AST 重新解析 + Decoration 重新计算
   - 已做 rAF 节流和 LRU 缓存，但大文档下仍需验证

---

## 七、总结与建议

### 7.1 项目成熟度评估

| 维度 | 评级 | 说明 |
|---|---|---|
| 核心引擎 | ⭐⭐⭐⭐ | CM6 深度集成，AST 管道完善，实时预览稳定 |
| 框架 SDK | ⭐⭐⭐⭐ | React/Vue 绑定完整，受控/非受控模式都支持 |
| 插件生态 | ⭐⭐⭐ | 11 个插件覆盖常见需求，但高级 Toolbar 等缺失 |
| 测试覆盖 | ⭐⭐⭐⭐ | 9,571 行测试，核心包 62% 测试代码比 |
| 文档 | ⭐⭐⭐ | README 完善，缺独立 API 文档和 E2E 测试 |
| 工程规范 | ⭐⭐⭐⭐⭐ | Conventional Commits + OpenSpec + CLA + CI/CD，规范成熟 |
| 桌面端 | ⭐⭐⭐ | Electron Demo 可用，打包优化未完成 |

### 7.2 建议的短期优先事项

1. **完成 `add-missing-features` 剩余 4 项**：列表拖拽重排、Mermaid 独立插件、性能基准、API 文档
2. **Widget API 标准化**：解决表格编辑的 12 条规则痛点，降低 Widget 开发门槛
3. **E2E 测试框架搭建**：Playwright 跑 electron-demo 关键路径
4. **Electron 打包优化**：减小体积、autoUpdater 集成

### 7.3 中期发展建议

1. **P2 高级 Toolbar**：emoji picker / 表格工具 / 颜色选择，分 3 个子提案
2. **模糊搜索**：评估 fzf-like 算法 vs 第三方库
3. **Web Component 封装**：扩大框架覆盖范围
4. **插件事件总线**：解耦插件间通信

### 7.4 长期愿景

- CRDT 实时协作（Yjs 或类似方案）
- 共享注释 / @mention 系统
- 插件热重载（开发体验）
- 云端存储抽象层

---

> **报告基于**：`f:\AiAutoCode\A4-finished-Item\MarkdownEditor\Nexus-Editor` 仓库 `main` 分支，commit 状态截至 2026-07-13。

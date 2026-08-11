# 增强进度报告 - prd

> 生成时间: 2026-08-11
> 输入源: test/function_points/FP-prd-功能点.md
> 执行模式: 完整流程（基础+增强）
> 阶段: 阶段B 源码增强（Step B2 子智能体 → Step B3 主会话汇总）

## 全局增强统计

| 序号 | 一级功能点 | FP编号 | 用例数 | 步骤数 | 已增强步骤 | 覆盖率 | 新增陷阱 | import解析 | 报告路径 |
|------|-----------|--------|--------|--------|-----------|--------|---------|-----------|---------|
| 1 | EditorConfig配置 | FP-01 | 47 | 139 | 139 | 100% | 16 | 10 | test/testcases/prd/CASE-EditorConfig配置/增强报告-EditorConfig配置.md |
| 2 | NexusPlugin插件接口 | FP-02 | 38 | 86 | 86 | 100% | 21 | 14 | test/testcases/prd/CASE-NexusPlugin插件接口/增强报告-NexusPlugin插件接口.md |
| 3 | 核心数据流 | FP-03 | 32 | 129 | 129 | 100% | 15 | 6 | test/testcases/prd/CASE-核心数据流/增强报告-核心数据流.md |
| 4 | LivePreview实时预览 | FP-04 | 24 | 86 | 86 | 100% | 52 | 8 | test/testcases/prd/CASE-LivePreview实时预览/增强报告-LivePreview实时预览.md |
| 5 | 安全与零信任 | FP-05 | 28 | 129 | 129 | 100% | 103 | 4 | test/testcases/prd/CASE-安全与零信任/增强报告-安全与零信任.md |
| 6 | 模块化UI委托 | FP-06 | 28 | 95 | 95 | 100% | 35 | 3 | test/testcases/prd/CASE-模块化UI委托/增强报告-模块化UI委托.md |
| 7 | Roadmap演进路线 | FP-07 | 32 | 98 | 98 | 100% | 29 | 10 | test/testcases/prd/CASE-Roadmap演进路线/增强报告-Roadmap演进路线.md |
| **合计** | | | **229** | **762** | **762** | **100%** | **271** | **55** | |

---

## FP-01 EditorConfig配置 — 增强章节

- **增强报告**: test/testcases/prd/CASE-EditorConfig配置/增强报告-EditorConfig配置.md
- **统计**: 47 用例 / 139 步 / 100% 增强 / 16 条陷阱 / 10 个 import 解析
- **源码依据**: packages/core/src/{editor.ts, types.ts, theme.ts, index.ts}、packages/core/test/{editor.test.ts, events.test.ts}、AGENTS.md
- **关键发现**:
  1. `themePrefix` 源码硬编码为 `--nexus-*`，PRD 声明的默认 `'nx-'` **未实现**（theme.ts）
  2. `container` 声明为必填，但源码可能不抛错（契约型用例）
  3. 相关用例 FP-01-01-E01/E02 与 FP-01-04 全部 6 例为**契约型用例**，"留待 tcAIrunner 增强阶段与实现对齐"
- **import 映射**（代表）: `@floatboat/nexus-core`（createEditor, EditorAPI, EditorConfig 类型）

## FP-02 NexusPlugin插件接口 — 增强章节

- **增强报告**: test/testcases/prd/CASE-NexusPlugin插件接口/增强报告-NexusPlugin插件接口.md
- **统计**: 38 用例 / 86 步 / 100% 增强 / 21 条陷阱（32 处注释）/ 14 个 import 解析
- **源码依据**: packages/core/src（editor.ts / types.ts / slash-state.ts / widget-extension.ts / index.ts）、packages/plugin-slash、packages/plugin-toolbar、packages/preset-gfm、相关 test、AGENTS.md
- **关键修正**（子代理发现，3 处）:
  1. 初始光标在 offset 0，**非文档末尾**
  2. CM6 keymap `run` 回调第一参数是 `EditorView` **非 EditorAPI**
  3. 自定义 parser 时 remarkPlugins transform **不应用**（editor.ts:277-278）

## FP-03 核心数据流 — 增强章节

- **增强报告**: test/testcases/prd/CASE-核心数据流/增强报告-核心数据流.md
- **统计**: 32 用例 / 129 步 / 100% 增强 / 15 条陷阱 / 6 个 import 解析
- **源码依据**: packages/core/src/editor.ts、lezer-mdast-adapter.ts、live-preview.ts、live-preview-renderers.ts、types.ts；test/editor.test.ts、live-preview.test.ts；AGENTS.md

## FP-04 LivePreview实时预览 — 增强章节

- **增强报告**: test/testcases/prd/CASE-LivePreview实时预览/增强报告-LivePreview实时预览.md
- **统计**: 24 用例 / 86 步 / 100% 增强 / 52 条陷阱 / 8 个 import 解析
- **源码依据**: packages/core/src/live-preview.ts、live-preview-renderers.ts、live-preview-ranges.ts、live-preview-table.ts、widget-extension.ts、types.ts、core/test/*.test.ts、AGENTS.md
- **关键发现**:
  1. 行内格式（bold/italic 等）= **行级检测** `selectionOnSameLine`
  2. link/image/code 折叠 = `inclusiveEnd: true`
  3. selection-only 事务走 `reuseCache: true` **同步重建装饰，无需等待**（live-preview.ts:1374-1377）

## FP-05 安全与零信任 — 增强章节

- **增强报告**: test/testcases/prd/CASE-安全与零信任/增强报告-安全与零信任.md
- **统计**: 28 用例 / 129 步 / 100% 增强 / 103 条陷阱 / 4 个 import 解析
- **源码依据**: packages/core/src（live-preview.ts / live-preview-table.ts / live-preview-renderers.ts / types.ts / editor.ts）、core/test（live-preview.test.ts / mermaid.test.ts）、vitest.config.ts、AGENTS.md
- **关键发现**（源码与 PRD 差异）:
  1. 清洗实为 `defaultSanitizeHtml` 正则 4 规则（live-preview.ts:597-608），**`dangerouslyAllowHtml` 不存在**
  2. 行内链接为 `span[data-link-url]`（Decoration.mark）；linkHandler 监听 **mousedown**、**无 ctrlKey 判断**；表格内链接为原生 `a[rel="noopener noreferrer"][target="_blank"]`
  3. 代码块纯文本装饰渲染**永不 innerHTML**；唯一注入路径 mermaid `securityLevel: "strict"` + `diagramHost.innerHTML = svg`（406 行）
- **修正**: FP-05-01-B02、FP-05-03-F01 补充缺失 `md` 变量；FP-05-01-B01 "不含 Intro" 笔误修正

## FP-06 模块化UI委托 — 增强章节

- **增强报告**: test/testcases/prd/CASE-模块化UI委托/增强报告-模块化UI委托.md
- **统计**: 28 用例 / 95 步 / 100% 增强 / 35 条陷阱 / 3 个 import 解析
- **源码依据**: packages/core/src（editor.ts / slash-state.ts / menu-ui.ts 等）、AGENTS.md
- **关键发现**:
  1. `slashMenuChange` 仅在 `slashCommands.length > 0` 时 emit（editor.ts:634）；载荷 `{...state, coords}`
  2. jsdom 下 `coords` 恒为 null（editor.ts:643-646）
  3. 关闭态固定形状 `{isOpen:false,from:null,to:null,query:"",commands:[]}`（slash-state.ts:161）
  4. 菜单实际类名为 `nexus-slash-menu`（menu-ui.ts:97），非 PRD 声明的类名

## FP-07 Roadmap演进路线 — 增强章节

- **增强报告**: test/testcases/prd/CASE-Roadmap演进路线/增强报告-Roadmap演进路线.md
- **统计**: 32 用例 / 98 步 / 100% 增强 / 29 条陷阱 / 10 个 import 解析
- **源码依据**: packages/core（editor.ts / widget-extension.ts / types.ts）、packages/react、packages/vue、packages/preset-gfm、packages/plugin-history、packages/plugin-search、packages/plugin-wordcount、相关 test、AGENTS.md
- **关键发现**:
  1. **一致性修正**: `data-link-url` 属性实际由 `live-preview.ts:1008` 的 mark 装饰器 `attrs` 设置，原头部提示标注 `live-preview-renderers.ts:62` 有误（renderers 处是块级 `<a>` 渲染路径），已在头部提示与 FP-07-01-N03 中修正
  2. `parseDelayMs`（默认 0；>0 时 onChange/解析合并到防抖窗口后触发一次，editor.ts:346-361）为 IO 防抖落地配置
  3. Widget 生命周期: `data-nexus-widget` 自动附加 / `selectionIntersects` 光标相交回退源码 / `block` 默认 true / `ignoreEvents` / `destroy` 回调
  4. jsdom 平台 Mod 键解析差异（Ctrl 替换为 Meta/Alt）

---

## B4 完成检查清单

| # | 检查项 | 内容 | 状态 |
|---|--------|------|:----:|
| 1 | 每个FP增强报告 | 7/7 FP 有独立章节（统计+明细+陷阱+import映射），详见上方各章节 | ✅ |
| 2 | 全局增强覆盖率统计 | 229 用例 / 762 步，已增强 762 步 = **100%**；"待增强"残留 = 0 | ✅ |
| 3 | 未增强项列表 | **无**（7/7 FP 全部 100% 增强，unenhanced_items 均为空） | ✅ |
| 4 | 关键发现汇总 | 见上方各 FP 章节「关键发现」：themePrefix 未实现、keymap 回调参数、selection-only 同步重建、defaultSanitizeHtml 正则、slashMenuChange 条件 emit、data-link-url 来源修正等 | ✅ |
| 5 | import 路径映射汇总 | 见下方「import 路径映射汇总」表（55 个 import 解析归并为 12 条唯一路径） | ✅ |

### import 路径映射汇总

| API/类型 | import 来源 | 涉及的 FP |
|---------|------------|-----------|
| createEditor, EditorAPI, EditorConfig, Root, WidgetDefinition | @floatboat/nexus-core | FP-01, FP-03, FP-07 |
| destroy, setDocument, getDocument, getAst, setSelection, getSelection, getTableOfContents, onChange/on('change'), parseDelayMs | @floatboat/nexus-core | FP-01, FP-03, FP-07 |
| NexusPlugin 类型（name/shortcuts/slashCommands/remarkPlugins/widgets/cmExtensions） | @floatboat/nexus-core | FP-02 |
| createSlashPlugin 系列 | @floatboat/nexus-plugin-slash | FP-02 |
| createToolbarPlugin | @floatboat/nexus-plugin-toolbar | FP-02 |
| createGfmPreset | @floatboat/nexus-preset-gfm | FP-02, FP-07 |
| createHistoryPlugin | @floatboat/nexus-plugin-history | FP-07 |
| createSearchPlugin | @floatboat/nexus-plugin-search | FP-07 |
| createWordcountPlugin | @floatboat/nexus-plugin-wordcount | FP-07 |
| Editor, useEditor, onReady | @floatboat/nexus-react | FP-07 |
| Editor, useEditor, onReady | @floatboat/nexus-vue | FP-07 |
| render, fireEvent | @testing-library/react | FP-07 |
| mount | @vue/test-utils | FP-07 |
| vi, describe, it, expect | vitest | 全部 |

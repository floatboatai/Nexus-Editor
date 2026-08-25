# Change: 编辑器动态配置重配与 GFM 交互式任务列表全链路管线

## Why

Nexus-Editor 作为面向现代 Web 与桌面端的下一代 Markdown 编辑器，在运行时响应性与任务列表交互上存在两处关键断层：

1. **运行时配置无法响应式更新**：
   在 `@floatboat/nexus-core` 中，除 `theme` 外的配置（`readOnly`、`tabSize`、`direction`、`indentGuides`）均在初始化时静态固化；`@floatboat/nexus-vue` 和 `@floatboat/nexus-react` 仅监听 `modelValue`/`value`，导致无法支持运行时动态切换主题、只读权限和排版选项。
2. **GFM 任务列表（Task List）生态链路缺失**：
   虽然底层具备基本的复选框解析，但在生产级交互上缺少全链路支持：
   - Live Preview 复选框未受只读模式保护（只读下仍能点击触发 dispatch）。
   - 缺少快捷键在当前行/选区快速切换待办状态（`[ ]` ↔ `[x]`）。
   - 工具栏（`plugin-toolbar`）缺少任务列表格式化按钮与状态激活高亮。
   - 斜杠菜单（`plugin-slash`）缺少 `/todo` 和 `/task` 快捷命令。

本变更构建了基于 CodeMirror 6 `Compartment` 的原子配置重配机制，打通 Vue 3 / React 响应式监听，并完整构建了覆盖 Core、Toolbar、Slash 的 GFM 交互式任务列表全链路工程闭环。

## What Changes

- **Core 动态重配基础设施 (`packages/core`)**：
  - 引入 `Compartment` 体系管理 `readOnly`、`tabSize`、`direction`、`indentGuides` 和 `theme`。
  - 在 `EditorAPI` 暴露原子 `reconfigure(config: DynamicEditorConfig)` 派发接口及常用 Setter。
- **Core 交互式任务列表与快捷键增强 (`packages/core`)**：
  - 为 Live Preview 复选框增加 `readOnly` 状态守卫（只读模式下复选框处于 `disabled` 状态且点击被安全拦截）。
  - 在 `markdownKeymap` 中增加快捷键 `Mod-Enter` / `Alt-Enter` 智能切换当前行或多光标行的任务项状态（`- [ ]` ↔ `- [x]`）。
- **Vue 3 & React 响应式状态同步 (`packages/vue`, `packages/react`)**：
  - 在 `useEditor` 中深度监听动态 Props 变化并原子重配，杜绝全量 Remount。
- **Toolbar 工具栏 Checklist 按钮与状态感知 (`packages/plugin-toolbar`)**：
  - 新增 `toggleTaskList` 格式化算法（单事务原子 Undo 保护，四态流转：文本 → 任务 → 完成 → 清除）。
  - 工具栏 UI 新增 Checklist 按钮图标，并支持光标处任务状态激活高亮。
- **Slash 斜杠菜单 `/todo` & `/task` 命令集成 (`packages/plugin-slash`)**：
  - 内置 `/todo` 与 `/task` 斜杠命令，回车快速插入任务列表项。
- **全链路测试矩阵与 OpenSpec 规范交付**。

## Capabilities

### New / Modified Capabilities

- `editor-core`: 动态配置 `reconfigure`；只读守卫；任务状态快捷键。
- `editor-vue` & `editor-react`: 框架 Props 响应式同步。
- `plugin-toolbar`: `toggleTaskList` 格式化与工具栏任务列表按钮。
- `plugin-slash`: `/todo` 与 `/task` 斜杠命令定义。

## Impact

- 涉及包：`packages/core`、`packages/vue`、`packages/react`、`packages/plugin-toolbar`、`packages/plugin-slash`。
- 兼容性：100% 向后兼容。

# Design: 动态配置重配与 GFM 交互式任务列表全链路管线架构

## 1. 架构总览

```
                            ┌──────────────────────────────────────────────┐
                            │      Nexus-Editor 全链路架构与交互管线       │
                            └──────────────────────┬───────────────────────┘
                                                   │
         ┌────────────────────────┬────────────────┴────────────────────────┬────────────────────────┐
         ▼                        ▼                                         ▼                        ▼
  【Core 动态重配】         【Core 任务列表与键盘】                    【Toolbar 工具栏】       【Slash 斜杠菜单】
  - Compartment 槽位体系    - Live Preview Checkbox (只读保护)         - toggleTaskList         - /todo & /task
  - batch reconfigure       - Mod-Enter 任务状态切换 (多光标)           - Checklist 按钮         - 自动补全 - [ ]
  - Vue/React 响应式监听    - 单事务原子 Undo 保护                     - 激活高亮感知
```

## 2. 核心技术设计

### 2.1 CodeMirror 6 Compartments 槽位重配 (已实现)

- `readOnlyCompartment`、`tabSizeCompartment`、`directionCompartment`、`indentGuidesCompartment`、`themeCompartment`。
- 在 `EditorAPI` 暴露 `reconfigure(dynamicConfig)` 和专用 Setters。

### 2.2 Live Preview Checkbox 只读保护与原子修改

在 `packages/core/src/live-preview.ts` 中：

- 渲染 checkbox 时检查 `viewRef.current?.state.readOnly` 或配置中的 `readOnly` 状态。若为只读，`checkbox.disabled = true`，且点击事件被忽略。
- 点击时通过精确的 `changes: { from: toggleFrom, to: toggleFrom + 1, insert: isChecked ? " " : "x" }` 派发单个原子变更。

### 2.3 快捷键任务切换 (`markdown-keymap`)

在 `packages/core/src/markdown-keymap.ts` 中：

- 绑定 `Mod-Enter` (Mac `Cmd-Enter` / Win `Ctrl-Enter`) 或 `Alt-Enter` 执行 `handleToggleTaskItem`。
- 智能匹配当前行前缀：
  - 若为 `- [ ] ` → 切换为 `- [x] `
  - 若为 `- [x] ` 或 `- [X] ` → 切换为 `- [ ] `
  - 若为普通无序列表 `- ` / `* ` / `+ ` → 升级为 `- [ ] `
  - 若为普通文本行 → 包装为 `- [ ] `
- 支持多光标 (Multi-Cursor)：单次 `changeByRange` 派发，撤销栈仅占 1 步。

### 2.4 Toolbar Checklist 工具栏格式化与状态检测 (`packages/plugin-toolbar`)

在 `packages/plugin-toolbar/src/formatting.ts`：

- 新增 `toggleTaskList(editor: EditorAPI): boolean`：
  - 扫描选区内的所有行（`getLinesInRange`）。
  - 判断是否全部行均已为任务列表项（`allTaskList`）。
  - 若全部为任务项：移除 `[-*+]\s\[[ xX]\]\s` 前缀，恢复为普通文本或普通列表。
  - 否则将选区内的每一行统一转换为 `- [ ] ${content}`。
  - 使用 `applyLines(editor, lines, newLines)` 原子单事务替换，选区自动覆盖全块。
- 在 `toolbar-ui.ts` 中：
  - 增加 `CheckSquare` 图标。
  - 注册 `checklist` 工具项，点击调用 `toggleTaskList`。
  - `active` 状态判断：光标所在行包含 `^[-*+]\s\[[ xX]\]` 时工具栏按钮高亮。

### 2.5 Slash 斜杠菜单命令 (`packages/plugin-slash`)

在 `packages/plugin-slash` 中：

- 注册 `todo` / `task` 内置命令，title 为 `"To-do list"`，description 为 `"Track tasks with a to-do list"`。
- 执行时调用 `toggleTaskList` 或在当前插入点插入 `- [ ] `。

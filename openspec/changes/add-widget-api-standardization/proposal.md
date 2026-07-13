# Change: Widget API 标准化

## Why

当前 Nexus-Editor 存在**两套完全独立的 Widget 系统**：一套是面向插件作者的公开 `WidgetDefinition` 接口（`widget-extension.ts`），另一套是 live preview 系统内部自用的 Widget 类（`EditableTableWidget`、`MermaidWidget`、`CodeCopyWidget` 等）。两套系统不共享基础设施，导致：

1. **插件作者得不到 live preview 的能力**（光标感知的 show/hide、内联格式化、rAF 轮询选区等）
2. **每个交互式 Widget 反复重造同样的机制**——编辑锁、CM6 dispatch、高度估算、事件转发。`EditableTableWidget` 一个文件 1727 行，CLAUDE.md 里有 12 条专门规则只为了让它不出 bug
3. **`tableEditingCount` 是裸模块级变量**——不可测试、不可在 devtools 中检视、不可与其他 Widget 组合
4. **Widget 没有生命周期钩子**——没有 `init`/`update`/`destroy`/`activate`/`deactivate`，每个 Widget 在 `toDOM()` 里手动处理一切
5. **高度估算缺乏统一契约**——每个 Widget 各自猜测，margin vs padding 导致的 click-drift 问题反复出现

## What Changes

- **ADDED** `EditorWidget` 抽象基类（继承 `WidgetType`），提供编辑锁管理、生命周期钩子、dispatch/选区访问
- **ADDED** `WidgetInteractionState` 共享状态管理器（取代裸 `tableEditingCount` 全局变量），支持多 Widget 并发编辑
- **ADDED** Widget 生命周期钩子：`didMount`、`willUpdate`、`didUpdate`、`willDestroy`、`activate`（光标进入）、`deactivate`（光标离开）
- **ADDED** `WidgetContext` —— Widget 访问 CM6 view、dispatch 事务、获取坐标的标准接口
- **ADDED** `createWidgetFactory` 辅助函数 —— 将现有 `WidgetDefinition` 升级为标准化 Widget
- **MODIFIED** `EditableTableWidget` 迁移到 `EditorWidget` 基类（提取公共模式，不改变外部行为）
- **MODIFIED** live preview `StateField` 的 `isTableEditing()` 检查改为通用的 `isWidgetEditing()` 检查
- **ADDED** 公共文档：Widget 编写指南（pattern & anti-pattern，替代 CLAUDE.md 中的分散规则）

## Impact

- Affected specs: `widget-api`（新增）
- Affected code:
  - `packages/core/src/live-preview-table.ts` — 迁移到 EditorWidget
  - `packages/core/src/live-preview.ts` — 替换 `isTableEditing()` → `isWidgetEditing()`
  - `packages/core/src/widget-extension.ts` — `NexusWidget` 迁移到 EditorWidget
  - `packages/core/src/types.ts` — 新增 WidgetContext、EditorWidget 接口
  - `packages/core/src/editor.ts` — 初始化 WidgetInteractionState
  - 新增 `packages/core/src/widget-base.ts` — EditorWidget 基类
  - 新增 `packages/core/src/widget-state.ts` — WidgetInteractionState
  - `packages/core/src/index.ts` — 导出新的公共 API
- **BREAKING**: `WidgetDefinition.render` 签名变更为 `(node, source, ctx: WidgetContext) => HTMLElement`（ctx 从可选变为必需）
- **BREAKING**: `WidgetDefinition` 新增可选 `lifecycle` 字段；旧 `destroy` 字段标记为 deprecated（仍支持但推荐用 `lifecycle.willDestroy`）

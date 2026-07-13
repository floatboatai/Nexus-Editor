# Tasks: Widget API 标准化

## Phase 1: 基础设施（无行为变更）

- [ ] 1.1 创建 `packages/core/src/widget-base.ts`——`EditorWidget` 抽象基类
  - 继承 `WidgetType`
  - 提供 `acquireLock(reason)` / `releaseLock(reason)` / `hasAnyLock()` 方法
  - 生命周期钩子接口：`didMount(ctx)` / `willUpdate(ctx)` / `didUpdate(ctx)` / `willDestroy(ctx)` / `activate(ctx)` / `deactivate(ctx)`
  - `toDOM(view)` 中构建 `WidgetContext` 并调用 `didMount`
  - `destroy()` 中调用 `willDestroy` 并释放所有锁
  - `eq()` 默认实现：`isActive()` 时返回 `true`（保留 DOM）

- [ ] 1.2 创建 `packages/core/src/widget-state.ts`——`WidgetInteractionState` StateField
  - 定义 `WidgetInteractionState` 接口：`{ editingWidgetCount: number }`
  - 实现 `isWidgetEditing(state: EditorState): boolean`
  - 导出 `acquireWidgetEditingLock` / `releaseWidgetEditingLock` 事务辅助函数
  - 在 `EditorWidget` 基类中集成

- [ ] 1.3 创建 `packages/core/src/widget-context.ts`——`WidgetContext` 接口
  - `view: EditorView`（只读）
  - `from: number` / `to: number`（widget 在文档中的位置）
  - `dispatch(changes)`（代理到 `view.dispatch`）
  - `getCoordsAtPos(pos)`（代理到 `view.coordsAtPos`）
  - `isCursorInside(): boolean`
  - `requestMeasure(callback)`

- [ ] 1.4 重构 `isTableEditing()` → `isWidgetEditing()`
  - 在 `live-preview.ts` 中将 `isTableEditing()` 替换为 `isWidgetEditing(state)`
  - 在 `widget-state.ts` 中实现 `isWidgetEditing`
  - `EditableTableWidget` 内部使用新的锁 API（通过 `EditorWidget` 基类）

- [ ] 1.5 编写 `EditorWidget` 基类单元测试
  - 测试锁的获取/释放/自动清理
  - 测试生命周期钩子调用顺序
  - 测试 `eq()` 在 activated 状态下返回 true
  - 测试 `WidgetContext` 各方法可用性

## Phase 2: 核心 Widget 迁移

- [ ] 2.1 `EditableTableWidget` 继承 `EditorWidget`
  - 将 `editing` + `editingLocks` + `acquireEditingLock` / `releaseEditingLock` → 基类方法
  - 将 `cleanupEditingLocks` → 基类 `willDestroy` 自动处理
  - 保留 `toDOM()` 中的表格特定逻辑不变
  - `tableEditingCount++` / `tableEditingCount--` → `acquireLock()` / `releaseLock()`

- [ ] 2.2 `EditableTableWidget` 添加生命周期钩子
  - `didMount(ctx)`：启动 rAF 轮询（`checkSelection`）
  - `willDestroy(ctx)`：清理 document 级事件监听器
  - `deactivate(ctx)`：当光标离开表格时清理选区

- [ ] 2.3 提取表格事件管理辅助函数（可选重构）
  - `createDragHandler(element, ctx, config): DragController`
  - `createHoverController(element, config): HoverController`
  - 这些是 `EditorWidget` 的公共工具，不强制表格使用

- [ ] 2.4 运行所有表格相关测试确认无回归
  - `packages/core/test/live-preview.test.ts` 全部通过
  - 手动 electron-demo 验证：点击编辑、拖拽选区、列/行拖拽、右键菜单、Ctrl+C 复制

## Phase 3: 插件 Widget 升级

- [ ] 3.1 `NexusWidget` 继承 `EditorWidget`
  - 将 `WidgetDefinition.render` 的调用封装为 `didMount` 钩子
  - `destroy()` → `willDestroy()` 钩子
  - 支持 `WidgetDefinition.lifecycle` 可选钩子

- [ ] 3.2 `WidgetDefinition` 类型更新
  - 新增 `lifecycle?: Partial<WidgetLifecycle>` 字段
  - 新增 `id?: string` 字段（用于 WidgetInteractionState 标识）
  - `destroy` 标记为 `@deprecated`（用 `lifecycle.willDestroy` 替代）
  - `render` 签名中 `ctx?: WidgetRenderContext` → `ctx: WidgetContext`

- [ ] 3.3 创建 `createWidgetFactory` 辅助函数
  - 将旧 `WidgetDefinition`（带 `destroy`）包装为新格式
  - dev mode 下 warn 废弃字段

- [ ] 3.4 更新现有插件 Widget
  - `packages/plugin-math/src/index.ts` 中的 widget 定义（如有）
  - `packages/plugin-toolbar/src/color-decoration.ts` 中的 `HiddenTagWidget`

## Phase 4: 文档与导出

- [ ] 4.1 从 `packages/core/src/index.ts` 导出新 API
  - `EditorWidget`、`WidgetContext`、`WidgetInteractionState`
  - `isWidgetEditing`、`createWidgetFactory`

- [ ] 4.2 编写 Widget 编写指南文档
  - 路径：`docs/WIDGET_AUTHORING.md`（中文版：`docs/WIDGET_AUTHORING.zh.md`）
  - 内容包括：CLAUDE.md 12 条规则的通用化版本
  - Quick start：最简 Widget 示例
  - Pattern catalog：editable cell / drag handle / hover overlay / clipboard
  - Anti-pattern catalog：margin for spacing / HTML5 drag API / inline border styles

- [ ] 4.3 更新 CLAUDE.md
  - 12 条表格规则简化为指向 `docs/WIDGET_AUTHORING.md`
  - 添加"Widget 开发规则"章节链接

- [ ] 4.4 更新 `README.md` 和 `README.zh.md` 路线图
  - 将 "Widget API 标准化" 从 `planned` 改为 `in-progress`

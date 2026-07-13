## ADDED Requirements

### Requirement: EditorWidget Base Class

系统 SHALL 提供一个 `EditorWidget` 抽象基类，继承自 CodeMirror 6 的 `WidgetType`，封装所有交互式 Widget 的公共行为。

`EditorWidget` SHALL 提供以下能力：
- **编辑锁管理**：`acquireLock(reason)` 和 `releaseLock(reason)` 方法，支持多原因并发锁（如 focus + drag），自动在 `willDestroy` 时释放
- **生命周期钩子**：`didMount(ctx)`、`willUpdate(ctx)`、`didUpdate(ctx)`、`willDestroy(ctx)`、`activate(ctx)`、`deactivate(ctx)`
- **`eq()` 默认实现**：当 Widget 有活跃锁时返回 `true`（阻止 CM6 重建 DOM）
- **`estimatedHeight` 契约**：子类 MUST 返回合理的估算值（block widget 使用 padding 而非 margin）

#### Scenario: Widget activates editing lock during drag

- **GIVEN** 一个继承 `EditorWidget` 的 Widget 实例已挂载
- **WHEN** 用户在 Widget 上开始拖拽操作，Widget 调用 `acquireLock("drag")`
- **THEN** `isWidgetEditing(view.state)` 返回 `true`
- **AND** CM6 的 live preview StateField 在 update 中跳过完整 rebuild，仅执行 `decos.map(tr.changes)`
- **AND** Widget 的 DOM 在整个拖拽过程中不被 CM6 销毁

#### Scenario: All locks released on destroy

- **GIVEN** 一个 `EditorWidget` 持有 2 个活跃锁（"focus" 和 "drag"）
- **WHEN** CM6 调用 `widget.destroy()`
- **THEN** 基类 `destroy()` 自动调用 `willDestroy(ctx)`
- **AND** 所有锁被释放，`isWidgetEditing(state)` 返回 `false`
- **AND** 不会发生锁泄漏（lock counter 回到 0）

#### Scenario: Lifecycle hooks called in order

- **GIVEN** 一个继承 `EditorWidget` 的 Widget
- **WHEN** CM6 首次渲染该 Widget（调用 `toDOM(view)`）
- **THEN** 钩子调用顺序为：基类构建 `WidgetContext` → `didMount(ctx)` → `buildDOM()`（子类实现）
- **AND WHEN** CM6 后续 update 中决定重建 Widget
- **THEN** 钩子调用顺序为：`willDestroy(ctx)` → `destroy()` → 新实例 `toDOM(view)` → `didMount(ctx)`

---

### Requirement: WidgetInteractionState

系统 SHALL 通过 CM6 `StateField` 管理全局 Widget 交互状态，替代裸的模块级变量 `tableEditingCount`。

`WidgetInteractionState` SHALL 包含：
- `activeWidgetCount: number` —— 当前有多少 Widget 处于交互状态（有活跃锁）
- Widget ID 注册表（用于 devtools 调试和将来的 Widget 间通信）

系统 SHALL 提供 `isWidgetEditing(state: EditorState): boolean` 函数，供 live preview StateField 和其他组件查询。

#### Scenario: Multiple widgets cannot co-edit simultaneously (guarded)

- **GIVEN** 编辑器中有两个独立的交互式 Widget（表格 A 和表格 B）
- **WHEN** 用户在表格 A 的单元格中编辑时，`activeWidgetCount === 1`
- **AND** 用户点击表格 B 的单元格
- **THEN** 表格 A 的 blur 处理器释放其锁
- **AND** 表格 B 的 focus 处理器获取新锁
- **AND** `activeWidgetCount` 始终 ≤ 1（同一时刻只有一个 Widget 拥有焦点锁）

#### Scenario: Drag lock coexists with focus lock

- **GIVEN** 用户在表格中编辑单元格（`activeWidgetCount === 1`，原因 "focus"）
- **WHEN** 用户不 blur 当前单元格，直接拖拽列 grip（mousedown 时 `acquireLock("drag")`）
- **THEN** `activeWidgetCount === 2`（两个锁并发存在）
- **AND** 列 drag 完成后释放 "drag" 锁，`activeWidgetCount === 1`
- **AND** 单元格 blur 后释放 "focus" 锁，`activeWidgetCount === 0`

---

### Requirement: WidgetContext

系统 SHALL 为每个 `EditorWidget` 实例提供 `WidgetContext` 对象，在 `toDOM(view)` 时构建并存储在实例字段中。

`WidgetContext` SHALL 提供：
- `view: EditorView` —— 只读 CM6 view 引用
- `from: number` / `to: number` —— Widget 在文档中的起止位置
- `dispatch(changes)` —— 安全地派发 CM6 事务
- `isCursorInside(): boolean` —— 判断 CM6 选区是否与 Widget 范围相交
- `requestMeasure(callback)` —— 委托给 CM6 的 `requestMeasure`

#### Scenario: Widget dispatches source change

- **GIVEN** 表格 Widget 的某个单元格被编辑
- **WHEN** Widget 调用 `ctx.dispatch({ from: tableFrom, to: tableFrom + oldLen, insert: newSource })`
- **THEN** CM6 文档内容更新
- **AND** 事务在单个 undo 事件中（Ctrl+Z 一步撤销整个单元格变更）
- **AND** live preview StateField 接收到 `docChanged` 并重建 decoration

#### Scenario: Widget checks if cursor is inside

- **GIVEN** Widget 需要根据选区位置决定显示模式（渲染视图 vs 编辑视图）
- **WHEN** Widget 调用 `ctx.isCursorInside()`
- **THEN** 若 CM6 光标在 `[ctx.from, ctx.to]` 范围内，返回 `true`
- **AND** Widget 据此切换渲染策略（如在内部时显示原始 markdown）

---

### Requirement: Widget Lifecycle for Plugin Authors

系统 SHALL 在 `WidgetDefinition` 接口中提供可选的生命周期钩子 `lifecycle`，使插件作者可以参与 Widget 生命周期而无需手动管理 DOM。

`WidgetDefinition.lifecycle` SHALL 支持：
- `didMount(ctx: WidgetContext): void`
- `willDestroy(ctx: WidgetContext): void`
- `activate(ctx: WidgetContext): void`
- `deactivate(ctx: WidgetContext): void`

`WidgetDefinition.render` 签名 SHALL 变更为 `(node, source, ctx: WidgetContext) => HTMLElement`，其中 `ctx` 为必需参数。

原有 `WidgetDefinition.destroy` SHALL 标记为 deprecated，但继续支持 2 个大版本。

#### Scenario: Plugin widget cleans up on destroy

- **GIVEN** 插件定义了一个渲染 Mermaid 图表的 Widget，需要清理 SVG 引用的外部资源
- **WHEN** CM6 重建该 Widget 的 decoration（如文档内容变化导致位置移动）
- **THEN** `lifecycle.willDestroy(ctx)` 被调用
- **AND** 插件在此钩子中清理资源
- **AND** CM6 随后创建新的 Widget 实例，调用 `lifecycle.didMount(ctx)` 和 `render(node, source, ctx)`

#### Scenario: Plugin widget responds to cursor proximity

- **GIVEN** 插件 Widget 在 `lifecycle` 中实现了 `activate` 和 `deactivate`
- **WHEN** 用户光标移动到 Widget 所在的文档范围
- **THEN** `lifecycle.activate(ctx)` 被调用
- **AND** Widget 可以切换到"展开"模式（如显示工具栏）
- **WHEN** 用户光标离开该范围
- **THEN** `lifecycle.deactivate(ctx)` 被调用
- **AND** Widget 恢复到"折叠"模式

---

### Requirement: Backward Compatibility

系统 SHALL 保持与现有 `WidgetDefinition` 接口的向后兼容性，现有插件无需立即修改即可继续工作。

`createWidgetFactory` 辅助函数 SHALL 将旧格式 `WidgetDefinition`（`{ nodeType, match, render, destroy }`）自动适配为新的 `EditorWidget` 子类。

`WidgetDefinition.render` 的 `ctx` 参数 SHALL 在旧插件中 fallback 为最小可用实现（仅包含 `from`/`to`）。

#### Scenario: Old plugin widget still works without changes

- **GIVEN** 一个第三方插件使用了旧版 `WidgetDefinition` 接口（`destroy` 字段，无 `lifecycle`，`render` 不接收 ctx）
- **WHEN** 该插件在 Widget API 标准化后的 Nexus-Editor 中加载
- **THEN** Widget 正常渲染
- **AND** `destroy` 回调在 Widget 销毁时被调用（与旧行为一致）
- **AND** dev mode console 中出现 deprecation warning

#### Scenario: New plugin uses lifecycle hooks

- **GIVEN** 插件作者使用新格式 `WidgetDefinition`（含 `lifecycle.willDestroy`）
- **WHEN** Widget 被销毁
- **THEN** `lifecycle.willDestroy(ctx)` 被优先调用
- **AND** 若同时定义了 `destroy` 和 `lifecycle.willDestroy`，仅调用 `lifecycle.willDestroy`（不重复调用）

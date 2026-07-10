# Design: Widget API 标准化

## Context

Nexus-Editor 的 Widget 系统需要同时服务两类用户：
1. **插件作者** —— 想为自定义 AST 节点渲染只读/简单交互的 DOM
2. **核心开发者** —— 构建高度交互的 Widget（可编辑表格、Mermaid 图表等）

当前两套独立的系统导致知识无法迁移、bug 重复出现、每个新 Widget 都要从零开始。

### 约束
- 必须兼容 CM6 `WidgetType`（这是 CM6 decoration 系统的硬性要求）
- 不能破坏现有插件的 `WidgetDefinition` 接口（需要渐进式迁移）
- `live-preview.ts` 已有 1500+ 行代码，不能在此次变更中大规模重构

## Goals / Non-Goals

### Goals
- 提供一个 `EditorWidget` 基类，封装所有已知的 Widget 编写陷阱（CLAUDE.md 12 条规则）
- 用 `WidgetInteractionState` 替换裸的 `tableEditingCount` 全局变量
- 建立 Widget 生命周期钩子契约（`didMount`/`willUpdate`/`didUpdate`/`willDestroy`/`activate`/`deactivate`）
- 让插件 Widget（`WidgetDefinition`）和核心 Widget 共享同一套基础设施
- 提供 Widget 编写文档，集中管理 pattern 和 anti-pattern

### Non-Goals
- 不在此次变更中为 live preview 内部 Widget（table/mermaid/code）引入 AST 感知的通用框架
- 不建立 Widget 间通信机制（event bus）—— 那是 P2 的工作
- 不提供声明式 Widget 配置（JSX/模板）—— 保持程序化 API
- 不改变 Widget 在 CM6 decoration 层的工作方式（仍然用 `Decoration.replace`）

## Decisions

### Decision 1: `EditorWidget` 继承 `WidgetType`，不创建包装层

**选择**：`EditorWidget extends WidgetType`，添加生命周期钩子和编辑锁管理。

**替代方案**：创建一个包装 `WidgetType` 的 `WidgetController` 类。
- 否决原因：增加一层间接，CM6 直接调用 `WidgetType` 方法；包装层会让 `eq()`、`ignoreEvent()` 等需要两处实现。

### Decision 2: `WidgetInteractionState` 作为 CM6 StateField 而非模块级变量

**选择**：将编辑锁计数器实现为 `StateField<WidgetInteractionState>`，挂在 CM6 state 上。

```typescript
interface WidgetInteractionState {
  activeWidgetCount: number;  // 替代 tableEditingCount
  activeWidgets: Set<string>;  // 哪些 widget 正在交互
}
```

**替代方案**：保持模块级变量 + event emitter。
- 否决原因：不可序列化（无法在 devtools 中检视），不可测试，不能随 CM6 state 同步

### Decision 3: `WidgetContext` 通过 `toDOM()` 注入，不用全局单例

**选择**：每个 `EditorWidget.toDOM(view)` 调用时，基类从 CM6 WidgetType 的 `toDOM(view)` 签名中提取 `EditorView` 并构建 `WidgetContext`，存储在实例字段中。

```typescript
class EditorWidget extends WidgetType {
  protected ctx: WidgetContext | null = null;
  
  toDOM(view: EditorView): HTMLElement {
    this.ctx = this.buildContext(view);
    this.didMount?.(this.ctx);
    return this.buildDOM();
  }
}
```

**替代方案**：全局 `getCurrentWidgetContext()` 函数。
- 否决原因：多编辑器实例时互相干扰；测试困难

### Decision 4: 渐进式破坏性变更 —— `destroy` → `lifecycle.willDestroy`

**选择**：
- `WidgetDefinition.destroy` 标记为 deprecated，`lifecycle.willDestroy` 优先
- `NexusWidget` 同时检查两者
- 保留 2 个大版本后移除 `destroy`

**替代方案**：直接移除 `destroy`。
- 否决原因：破坏所有现有插件的 Widget 定义

### Decision 5: `estimatedHeight` 契约标准化

**选择**：`EditorWidget` 要求子类实现 `get estimatedHeight(): number`，在基类构造函数中自动检查（dev mode 下 warn）。

每个 Widget 子类必须提供高度估算值，遵循以下规则：
- Block widget: padding 而非 margin（CM6 `getBoundingClientRect` 排除 margin）
- Line decoration: 不改变 `font-family`/`font-size`（CM6 高度图用默认行高估算离屏行）
- Inline widget: 高度不超过当前行高的 1.5 倍

**替代方案**：让 CM6 自动测量。
- 否决原因：首帧测量前高度为 0 → click-drift；反复测量 → 布局抖动

## Architecture

### Before

```
┌─────────────────────────────────────────┐
│ Plugin Widget (WidgetDefinition)         │
│ └─ NexusWidget (WidgetType)              │
│    └─ toDOM() → render(node, source, ctx)│
├─────────────────────────────────────────┤
│ Live Preview Widget (EditableTableWidget)│
│ ├─ 编辑锁 (tableEditingCount 全局变量)   │
│ ├─ 12 条规则 (CLAUDE.md)                │
│ └─ 手写事件管理 (1727 行)               │
├─────────────────────────────────────────┤
│ Live Preview Widget (MermaidWidget)      │
│ ├─ 无编辑锁                             │
│ └─ 手写缓存逻辑                         │
└─────────────────────────────────────────┘
        ↑ 两套独立系统，零共享
```

### After

```
┌─────────────────────────────────────────────────┐
│              EditorWidget (WidgetType)            │
│  ├─ 编辑锁 (WidgetInteractionState)              │
│  ├─ 生命周期 (didMount/willUpdate/.../deactivate)│
│  ├─ WidgetContext (view/dispatch/coords)         │
│  └─ estimatedHeight 契约                         │
├─────────────────────────────────────────────────┤
│        ↙                    ↘                    │
│  Plugin Widget           Core Widget             │
│  (NexusWidget)           (EditableTableWidget)   │
│  └─ WidgetDefinition     └─ 从基类继承所有机制   │
│     + 可选生命周期间          + 专注表格特有逻辑  │
└─────────────────────────────────────────────────┘
        ↑ 所有 Widget 共享同一套基础设施
```

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| `WidgetInteractionState` StateField 开销 | 只在 `activeWidgetCount > 0` 时才阻止 rebuild；验证 1000+ tables 场景性能 |
| 现有 `EditableTableWidget` 迁移引入回归 | 分步迁移：先提取基类 → 不改 table 行为 → 再逐步采用钩子 |
| `WidgetContext` 必需参数破坏现有插件 | `WidgetContext` 作为 render 的必需参数；提供 `createWidgetFactory` 适配旧签名 |
| 状态字段序列化/恢复复杂 | `activeWidgets: Set<string>` 使用 widgetDOMId 标识，CM6 reconfigure 时自动清空 |
| 文档维护负担 | Widget 文档作为代码注释的同源生成，用工具提取而非手写两份 |

## Migration Plan

### Phase 1: 基础设施（无行为变更）
1. 创建 `WidgetInteractionState` StateField
2. 创建 `EditorWidget` 基类
3. `isTableEditing()` 内部改为调用通用的 `isWidgetEditing()`
4. 验证：所有现有测试通过

### Phase 2: 核心 Widget 迁移
5. `EditableTableWidget` 改为继承 `EditorWidget`
6. 提取编辑锁逻辑到基类
7. 添加 `didMount`/`willDestroy` 钩子
8. 验证：表格式交互测试全绿

### Phase 3: 插件 Widget 升级
9. `NexusWidget` 改为继承 `EditorWidget`
10. `WidgetDefinition.lifecycle` 可选字段生效
11. `createWidgetFactory` 辅助函数
12. 验证：现有插件 Widget 无回归

### Phase 4: 文档与清理
13. Widget 编写指南文档
14. `WidgetDefinition.destroy` 标记 deprecated
15. CLAUDE.md 12 条规则迁移到文档

### Rollback
每个 Phase 独立可回滚；`EditorWidget` 作为 `WidgetType` 的纯扩展，移除后不影响 CM6 行为。

## Open Questions

1. **Widget ID 策略**：用自增计数器还是要求插件作者提供唯一 id？倾向后者（`WidgetDefinition.id?: string`），冲突时 dev mode 下 warn。
2. **`activate`/`deactivate` 触发时机**：在 live preview 的 `buildDecorations` 里判断选区相交？还是用 CM6 的 `SelectionRange` 机制？倾向前者（与现有逻辑一致）。
3. **`WidgetInteractionState` 是否需要持久化**：跨文档切换时是否保留？倾向不保留（每次新建编辑器重置）。

# BUG 记录 - LivePreview实时预览

> 测试日期: 2026-08-11
> 测试工具: Vitest (jsdom)
> 测试环境: Nexus_Editor monorepo (packages/*)

## BUG-001：renderer widget 的 eqKey DOM 复用机制未生效（每次光标移动重新挂载）

| 项目 | 内容 |
|------|------|
| **严重程度** | 中（性能/状态丢失风险，非崩溃） |
| **关联用例** | FP-04-03-E01（eqKey 相同时 widget DOM 复用） |
| **测试框架** | Vitest (jsdom) |
| **所属模块** | `packages/core/src/live-preview.ts` `createWidget` |
| **状态** | 已定位根因，未修复（按规则需用户确认） |

### 现象

`createEditor` 的 `livePreview.renderers.strong` 自定义 renderer 中，`mountCount` 在光标移动（selection-only 事务）后增长：初始挂载 1 次，`setSelection(0)` 后变为 2 次。即 **renderer 被重复调用、React widget DOM 被重新创建**，与用例期望"eqKey 相同时 widget DOM 复用（mountCount 不增长）"不符。

### 复现路径

1. `createEditor({ container, livePreview: { renderers: { strong: (ctx) => {...} } } })`
2. `editor.setSelection(0)`（selection-only，无文档变化）
3. renderer 被再次调用 → mountCount=2

### 根因（证据链）

1. **StateField 对 selection-only 事务全量重建**：`live-preview.ts` L1375-1378，`if (tr.selection) return build(tr.state, tr.state.selection.ranges, true)`——`reuseCache=true` 只复用 AST/codeTokens，但 `buildDecorations` 依然生成**全新的 Decoration.set 与全新的 widget 实例**。
2. **`createWidget` 每次调用创建新匿名类**：`live-preview.ts` L110 `new (class extends WidgetType {...})()`——每次求值匿名类表达式生成**不同的类**。
3. **CM6 `WidgetType.compare` 依赖 constructor 相同**：`@codemirror/view` dist L139-141 `compare(other) { return this == other || this.constructor == other.constructor && this.eq(other); }`。匿名类导致 `this.constructor !== other.constructor` 短路，`eq(other)` **永远不会被调用**。
4. **TileCache.findWidget 两轮均不命中**：dist L2536-2538——pass 0 用 `compare`（constructor 不同→false），pass 1 用 `widget.updateDOM`（renderer widget 未实现，默认返回 false）→ 返回 null → 全新 `WidgetType.of` → 重新 `toDOM`。

### 结论

源码注释（L111-112 "Stable identity used by eq() so CM6 reuses old DOM across rebuilds"）表明 eqKey 复用是**设计意图**，但匿名类实现使其失效——**属真实实现缺陷**。修复方向（供参考，未执行）：将匿名类改为模块级具名类（每次 `new NamedWidget(...)` 同一类），使 `compare` 的 constructor 检查通过、`eq` 生效。

### 影响面

- 自定义 renderer（React/任何有状态 widget）在**每次光标移动**时被重新创建，DOM 状态（如 React 组件 state）丢失。
- 内置 widget（link/image/bullet 等）因 `createWidget` 传入的是**已构建元素**（eager 路径），toDOM 返回同一元素引用，无可见差异，仅存在潜在 DOM 重排。

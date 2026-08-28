# Widget API 标准化

> 状态：已按此方案落地内核合同（通用交互锁 + `eq()` 身份；math / mermaid / 表格走 `isWidgetInteracting()`）
> 对应路线图：[`docs/ROADMAP.md`](./ROADMAP.md) #9（P1，planned）
> 依赖此项的后续工作：#11 插件热重载、#12 高级工具栏、#8 undo 分组（表格 `tableEditingCount`）

本文说明：在当前 Nexus-Editor 代码上，**Widget API 标准化**要解决什么、做成什么样、分几步落地。先定合同，再迁现有实现，不重写 Live Preview。

---

## 1. 背景

### 1.1 产品里 Widget 扮演什么角色

Nexus 的文档真值是 Markdown 文本，不是 ProseMirror / Lexical 那种内部 JSON。Live Preview 的做法是：

- 光标不在某段源码上时，用 DOM **盖住**这段字符（看起来像渲染后的公式、表格、图）；
- 光标进入这段时，拆掉 DOM，露出原始 Markdown。

存盘、撤销、Git 始终看到源码。所谓 Widget，就是「这段源码在预览模式下请画成这个 DOM」。这是相对 Tiptap / Milkdown 的核心差异，也是插件扩展预览的正式入口。

### 1.2 今天仓库里其实有三套「像 Widget 的东西」

| 路径 | 代码位置 | 谁在用 | 公开合同 |
|---|---|---|---|
| A. 插件 Widget API | `packages/core/src/widget-extension.ts` + `WidgetDefinition` | `plugin-math`（KaTeX 行内/块公式） | 有，但很薄 |
| B. Live Preview 内置 `WidgetType` | `packages/core/src/live-preview.ts` 的 `createWidget` / `MermaidWidget` / `CodeCopyWidget` | 列表圆点、任务复选框、mermaid、代码复制按钮、图片等 | 无，内核私有 |
| C. 表格专用 Widget | `packages/core/src/live-preview-table.ts` 的 `EditableTableWidget` | GFM 表格（编辑、框选、拖列/拖行） | 无；用 `isTableEditing()` / `tableEditingCount` 特判 |

插件平台已经为路径 A 做了一层动态注册：

- `packages/plugin-runtime/src/markdown/widget-registry.ts`：`WidgetRegistry.register(owner, definition, { id })`
- `packages/core/src/markdown-contributions.ts`：`WidgetDefinitionSnapshot` 打进 CM6 Facet
- `packages/core/src/dynamic-contributions.ts`：`isInteractionActive()` 目前主要认表格 editing + IME，不认通用 widget 手势

也就是说：**注册/卸载的骨架有了，交互生命周期没有。** 表格能活下来，靠的是 `AGENTS.md` / `CLAUDE.md` 里那 12 条手工规则，而不是 API。

### 1.3 路径 A 今天长什么样

`NexusPlugin.widgets` 目前只有这些字段（`packages/core/src/types.ts`）：

```ts
interface WidgetDefinition {
  nodeType: string;
  match?: (node) => boolean;
  render(node, source, ctx?: WidgetRenderContext): HTMLElement;
  destroy?(element: HTMLElement): void;
  block?: boolean;          // 默认 true；行内公式必须 false
  ignoreEvents?: boolean;   // 默认 false
}

interface WidgetRenderContext {
  from: number;
  to: number;
  setSelection(anchor, head?): void;
  focus(): void;
}
```

内核行为（`widget-extension.ts`）：

1. 解析 mdast，按 `nodeType` + `match` 找定义；
2. 选区与 `[from, to)` 相交 → **不**替换，露源码；
3. 不相交 → `Decoration.replace` + `NexusWidget.toDOM()` 调用 `render()`；
4. `eq()` 比较的是 `definition` 引用 + `from/to/source`。任一变化就拆掉旧 DOM 重建；
5. 文档变化或选区变化都会 `build()` 全量重建 decoration（IME compose 除外）。

数学插件已经踩过两处：块公式必须 `ignoreEvents: true` 加 ✎ 按钮；行内公式必须 `block: false` 且不吞事件，否则会独占一行或点不进去。

### 1.4 为什么现在不能当「已经做完」

三套路径各自解决了一部分问题，但插件作者无法预知该走哪条：

```
想加一种自定义块（图表 / callout / embed）
        │
        ├─ 写 plugins.widgets          → 没 editing lock，跨帧拖拽会丢 DOM
        ├─ 改 live-preview renderers   → 不是插件 API，宿主才能覆盖
        └─ 自己写 CM6 WidgetType       → 复制表格那套 12 条规则
```

具体会炸的模式（表格已经反复验证）：

1. **CM6 在手势中途重建 widget DOM。** `eq()` 返回 false，或 StateField 在 `docChanged` / selection 时 `build()`，mousedown 绑的节点在 mousemove 时已经 detached。
2. **editing lock 只服务表格。** Live Preview 的 StateField 见 `isTableEditing()` 就 `decos.map` 保 DOM；通用 widget 没有等价开关。`isInteractionActive()` 同样偏表格。
3. **blur 与 mousedown 时序。** 单元格失焦会清 `editing`，grip 拖拽刚开始就被拆掉。
4. **视觉指示器用了结构边框。** 清 inline `border*` 会拆掉表格线。
5. **HTML5 Drag API** 对 grip 不可控；必须自管 mousedown/move/up。
6. **路径 B 的 `createWidget` 默认 `eq()` 为 false**，每笔 transaction 重建；只有传入 `eqKey` 才复用 DOM。两套管线的身份模型不一致。

这些不是「表格 bug」，而是 **缺少统一的 widget 运行时合同**。不先定合同，热重载、高级工具栏、undo 分组都会再踩一遍。

---

## 2. 目标

### 2.1 要达成什么

把路径 A/B/C 收成 **一套 Widget 运行时合同**，让公式、mermaid、表格、未来自定义块共用同一套规则：

1. **稳定身份**：每个 widget contribution 有稳定 id（已有 `pluginId:localId`），`eq()` 按 id + 源码范围 + 内容指纹比较，而不是对象引用。
2. **显式交互锁**：任何跨帧手势（拖选、拖列、按住编辑按钮）必须声明 `beginInteraction` / `endInteraction`；锁持有期间 StateField **禁止**拆 DOM（`docChanged` 只 `map`，selection-only 原样返回）。
3. **选区揭示仍是内核职责**：光标进入源码范围 → 拆 widget 露 Markdown；锁持有期间即使选区变化也不揭示、不重建。
4. **卸载可验证**：`destroy()` 必达；动态注销后 DOM、listener、rAF 为零残留（对齐 `WidgetRegistry.dispose`）。
5. **事件所有权写进定义**：`ignoreEvents`、行内/块级、以及「widget 自己的 input surface」（表格单元格）成为合同字段，而不是注释。
6. **迁现有实现，不新发明第四套**：math / mermaid / table / task checkbox 最终都通过这套运行时；Live Preview 变成「内置 widget 实现」，不再是平行世界。

用户体感：表格拖拽、公式进入编辑、mermaid 点图表或「✎ Edit」，不再出现「第一次能用、下一帧立刻坏」。插件作者只面对一份文档。验收步骤见 **§9**。

### 2.2 非目标（本轮不做）

- 不重写表格功能，不改 Markdown 语法。
- 不做插件热重载（#11）；只提供它依赖的锁与销毁语义。
- 不做 emoji / 颜色选择器等新 widget（#12）；合同就绪后它们才能安全加。
- 不改 undo 分组策略（#8）；但交互锁必须能被 history 查询，避免分组时拆 DOM。
- 不把 Widget 做成 React/Vue 组件树；`render()` 仍返回 `HTMLElement`。框架绑定是宿主的事。
- 不引入第二份文档模型。真值永远是 Markdown。

### 2.3 成功标准

- 插件作者只需要 `WidgetDefinition`（加少量生命周期字段），不必碰 `live-preview-table.ts`。
- 内核 Live Preview 对「交互中」的判断不再写死 `isTableEditing()`，改为通用 `isWidgetInteracting()`。
- 现有表格 8 条交互路径（点选编辑、拖选范围、grip 点选列、grip 拖列、点外部取消、Delete 清选区、单元格失焦、列移动后 DOM 与源码一致）在合同下全部仍通过。
- math 块/行内、mermaid 编辑芯片与点图表揭示、任务复选框，无需各自复制 lock 逻辑。一次 click 进源码不得持锁（§9.1）。
- 新增一个最小示例插件（例如 `lang === "nexus-widget-demo"` 的 code block）能完成：渲染 → 交互锁 → 光标揭示源码 → 卸载销毁。

---

## 3. 目标合同（实现时要落到类型上）

在现有 `WidgetDefinition` 上 **加字段、不拆包**。旧插件只提供 `nodeType` + `render` 仍能工作（块级、无锁、选区揭示）。

建议形状（草案，立项后以 OpenSpec 为准）：

```ts
interface WidgetDefinition {
  /** 已有 */
  nodeType: string;
  match?: (node: unknown) => boolean;
  render(node: unknown, source: string, ctx: WidgetRenderContext): HTMLElement;
  destroy?(element: HTMLElement): void;
  block?: boolean;
  ignoreEvents?: boolean;

  /** 新增 */
  /** 内容指纹；缺省用 source。eq() 用 id + from + to + contentKey */
  contentKey?: (node: unknown, source: string) => string;
  /**
   * 预估块级高度，避免首次布局把下方点击坐标算飞。
   * 对应 live-preview.ts createWidget 的 heightHint。
   */
  estimatedHeight?: number;
}

interface WidgetRenderContext {
  from: number;
  to: number;
  setSelection(anchor: number, head?: number): void;
  focus(): void;

  /** 新增：跨帧手势必须成对调用 */
  beginInteraction(): void;
  endInteraction(): void;
  /** 当前是否因本 widget（或任意 widget）持有锁 */
  isInteracting(): boolean;

  /**
   * 表格这类「widget 内部还有选区」时，把 input surface 登记给
   * paste/copy/Delete，避免误走文档级 replaceSelection。
   */
  registerInputTarget?(target: Omit<EditorInputTarget, "element">): () => void;
}
```

内核保证：

| 时机 | 行为 |
|---|---|
| 无锁 + 选区不相交 | `render()`，`Decoration.replace` |
| 无锁 + 选区相交 | 不替换，露源码 |
| **有锁** | 无论选区/文档如何，StateField 走 `decos.map` 或原样返回；`eq()` 必须让 CM6 复用 DOM |
| `endInteraction` 之后的下一帧 | 才允许按选区决定揭示或重建 |
| 插件卸载 / `destroy()` | 先 `endInteraction`（若仍持锁），再拆 DOM |

`eq()` 规则（统一路径 A/B/C）：

```
same contribution id
AND same from/to
AND same contentKey（默认 source）
AND 持锁时：即使 source 已变，也返回 true（先保 DOM，手势结束再重建）
```

视觉反馈禁止改表格等结构边框：合同文档写明用 `box-shadow` 或 overlay；实现层可在 dev 下对 `border*` 赋值做 debug 断言（测试环境即可，不必进生产）。

---

## 4. 如何实现（结合现有代码的分阶段路径）

原则：**先抽运行时，再迁调用方。** 每一阶段都可单独合并，表格回归测试必须全绿。

```
阶段 0  规格与测试清单
   │
阶段 1  通用交互锁 + eq() 身份
   │      widget-extension / dynamic-contributions / live-preview StateField
   │
阶段 2  路径 A 补齐（math 用新 ctx，行为不变）
   │
阶段 3  路径 B 迁入（mermaid / checkbox / createWidget）
   │
阶段 4  路径 C 迁入（表格改用通用锁，删除 isTableEditing 特判）
   │
阶段 5  示例插件 + 文档 + 路线图 #9 → done
```

### 阶段 0 — 规格与测试清单（不改行为）

把今天已经在测、以及表格规则要求测的路径写成验收表。落地后的完整用例、命令和踩坑见 **§9**。立项时的门禁范围：

- `packages/core/test/widgets.test.ts`：匹配节点、光标揭示、`block: false`、`ignoreEvents`、`destroy`、交互锁身份、泄漏锁销毁
- 表格：click-to-edit、drag-to-select-range、grip-click 选列、grip-drag 重排、click-outside 取消、Delete 清选区
- math：块公式 ✎、行内点击进源码（一次 click **不得**持锁）
- mermaid：光标外渲染图、光标内露源码、✎ Edit / 点图表进围栏
- 动态注册：`WidgetRegistry` activate / dispose 后 DOM 为零

产出：OpenSpec change（建议 id：`standardize-widget-api`）的 `proposal.md` + `design.md` + spec 场景。本文可作为 design 初稿。

### 阶段 1 — 通用交互锁（核心，先合）

**改动文件（预期）：**

- `packages/core/src/types.ts` — 扩展 `WidgetRenderContext` / `WidgetDefinition`
- `packages/core/src/widget-extension.ts` — `NexusWidget` 注入 `begin/endInteraction`；持锁时 `eq()` 为 true；StateField `update` 认通用锁
- `packages/core/src/dynamic-contributions.ts` — `isInteractionActive()` 覆盖 widget 锁，不只是表格 + IME
- `packages/core/src/live-preview.ts` — StateField 里 `isTableEditing()` 改为 `isWidgetInteracting()`（阶段 1 可先 **或** 起来，阶段 4 再删表格特判）

**做法：**

1. 在 core 增加与 `tableEditingCounts` 同构、但按 `EditorView` 计数的通用锁（可直接扩展现有 WeakMap，或新建 `widgetInteractionCounts`，表格暂且两边都 +1，避免行为空窗）。
2. `createWidgetExtension` 的 StateField：

   ```ts
   update(decos, tr) {
     if (isWidgetInteracting(view)) {
       return tr.docChanged ? decos.map(tr.changes) : decos;
     }
     // 现有 compose / contribution refresh / build ...
   }
   ```

3. `NexusWidget.eq()` 改为 id + range + contentKey；持锁时强制 true。
4. 给 `WidgetRenderContext.beginInteraction` 做配对断言：重复 begin 计数 +1，end 到 0 才释放；`destroy()` 时强制清零。

**测试：** 在 `widgets.test.ts` 里用假 widget：mousedown `beginInteraction`，随后 `setSelection` 进该范围，**DOM 节点 identity 不变**；`endInteraction` 后再揭示源码。

### 阶段 2 — 路径 A 对齐（math）

`packages/plugin-math/src/index.ts`：

- 块公式的 ✎：**一次 click 只 `setSelection(from)` + `focus()`，不要 `begin/endInteraction`。** 持锁时 StateField 会 `map` 旧 DOM，公式挡着源码；锁只给跨帧手势。
- `contentKey` 用 `node.value`，避免 source 含 `$$` 围栏时无意义重建。
- 行为对用户不变；补回归：行内公式仍不 `block`、不 `ignoreEvents`。

此阶段验证：**旧 `WidgetDefinition` 不传新字段仍然能渲染。**

### 阶段 3 — 路径 B 迁入 Live Preview 内置块

目标：`live-preview.ts` 不再直接 `new WidgetType`，改为「内置 WidgetDefinition 列表」走同一 extension，或走同一 `eq` / lock 助手。

优先迁移顺序（风险从低到高）：

1. **任务复选框 / 列表 bullet** — 已有 `eqKey`，交互是一次 click，适合当第一个内置定义。
2. **MermaidWidget** — `eq()` 走 `shouldReuseWidgetDom`；点图表或「✎ Edit」只 `dispatch` 选区进围栏，**不持锁**。芯片必须叠在 SVG 之上（chrome overlay），否则会被图盖住。
3. **CodeCopyWidget / 图片** — 注意 `estimatedHeight` 和「绝对定位按钮撑高行框」的既有修复，迁过去时原样保留。

`createWidget(..., eqKey)` 逐步收口到统一 `NexusWidget`。阶段 3 结束时，路径 B 可以还留在 `live-preview.ts` 文件里，但 **身份和锁必须走 core 助手**，不能再各写各的 `eq()`。

### 阶段 4 — 路径 C 表格改用通用锁

这是最大、也最值钱的一步。`live-preview-table.ts` **功能不砍**，只换锁的归属：

1. 所有「跨帧鼠标」入口（单元格 mousedown、range select、grip drag）改为 `ctx.beginInteraction()`，而不是只 `tableEditingCount++`。
2. `onDragEnd` 顺序保持现有正确顺序（见 `AGENTS.md` 规则 10）：先清视觉 → 复位 drag flag → **先释放锁** → 再 `dispatch` 列/行移动。锁若在 dispatch 时仍持有，StateField 会 `map` 旧 DOM，markdown 变了表格还显示旧列序。
3. 单元格 `blur` 仍须检查 grip drag 是否进行中（规则 9），但判断改为通用锁或 drag flag，而不是两套计数。
4. rAF 轮询清状态前检查：`isRangeSelecting`、`cellMouseDown`、`editing`、`rangeActive`、**以及通用锁**（规则 2 / 11）。
5. Live Preview StateField 删除 `isTableEditing()` 分支，只留 `isWidgetInteracting()`。
6. `isTableEditing` 暂时保留为 deprecated 别名，指向通用锁，避免插件-runtime 测试一次性爆炸。

**禁止事项原样写入合同测试：**

- 不用 HTML5 Drag API 做 grip；
- 不用 inline `border*` 做拖拽指示；
- 单元格默认 `contentEditable=false`，mousedown 才打开。

阶段 4 的 PR 必须跑现有 table 相关测试 + 手工 8 条路径。合入前不要并行改表格功能。

### 阶段 5 — 示例、文档、收尾

- 最小示例：`packages/plugin-math` 旁不必新包；可在 `packages/core/test` 或 `reference-plugins` 加一个 demo widget，证明「只靠公开 API」能做交互块。
- 更新 `docs/plugins/native-plugin-api.zh.md`、legacy 迁移表里 `widgets` 一行。
- README 特性里把 Widget API 从「能渲染」改成「有生命周期合同」。
- `docs/ROADMAP.md` #9 → `done`。
- 归档 OpenSpec change。

---

## 5. 和现有子系统怎么咬合

```
插件
  NexusPlugin.widgets[]          静态，createEditor 时收集
  WidgetRegistry.register(...)   动态，runtime 插件 onload
           │
           ▼
  WidgetDefinitionSnapshot ── Facet ── widget-extension StateField
           │
           ├─ 无锁：按选区 build decorations
           └─ 有锁：decos.map / 原样返回（与表格今天一样）
           │
           ▼
  Live Preview StateField（阶段 4 后共用同一把锁）
           │
           ▼
  CM6 Decoration.replace → DOM
```

动态贡献已经会在 `isInteractionActive()` 时推迟 `refresh()`。阶段 1 把 widget 锁接进去后，**热重载 #11 才有安全点**：卸载插件时若锁还在，等 `endInteraction` 再 `destroy`。

`EditorInputTarget` / `registerInputTarget` 已经存在（表格、外部 surface）。阶段 4 让表格通过 `ctx.registerInputTarget` 登记，paste/Delete 继续走 widget 内部选区，而不是文档选区。这与 `docs/plugins/security-and-events.zh.md` 里「永远优先 `replaceTargetSelection()`」一致。

---

## 6. 风险与顺序为什么不能反

| 风险 | 缓解 |
|---|---|
| 一步把表格迁到新 API，回归面太大 | 阶段 1 双计数（表格锁 + 通用锁），阶段 4 再删特判 |
| `eq()` 持锁时恒 true，手势结束源码已变但 DOM 旧 | `endInteraction` 后强制 `build()`；列移动必须先放锁再 dispatch（已有规则） |
| 插件忘记 `endInteraction` | `destroy` / blur（无 drag）/ editor.destroy 时强制清零；测试断言计数归零 |
| 路径 B 的 heightHint / 零高 wrapper 丢失导致点击漂移 | 阶段 3 逐个迁，保留 `estimatedHeight` 与 CodeCopy 的 span 技巧 |
| 与 undo 分组抢同一把锁 | 本轮只暴露 `isWidgetInteracting()` 给 history，不改分组算法 |

**不要先做：** 新的可视化 widget、热重载、undo 分组。它们都假设本合同已经存在。

---

## 7. 建议的落地顺序（给执行用）

1. 用本文开 OpenSpec change `standardize-widget-api`，把第 2–3 节收成 spec 场景。
2. 阶段 1 单独 PR：锁 + `eq()` + 一个假 widget 测试。**不碰表格逻辑。**
3. 阶段 2 PR：math 用新 ctx，黄金路径不变。
4. 阶段 3 PR：checkbox / mermaid 改走助手。
5. 阶段 4 PR：只迁表格锁；功能 diff 应接近「计数器换皮」。
6. 阶段 5：文档与路线图。

估计体量：阶段 1–2 是内核合同，相对可控；阶段 4 是高风险回归，需要按 `AGENTS.md` 表格规则做手工验收。整体是「完善现有能力」，不是新功能。

---

## 8. 参考代码

| 主题 | 文件 |
|---|---|
| 公开类型 | `packages/core/src/types.ts`（`WidgetDefinition`、`WidgetRenderContext`） |
| 插件 widget 管线 | `packages/core/src/widget-extension.ts` |
| 动态 snapshot | `packages/core/src/markdown-contributions.ts` |
| 交互中推迟刷新 | `packages/core/src/dynamic-contributions.ts` |
| 内置预览 WidgetType | `packages/core/src/live-preview.ts`（`createWidget`、`MermaidWidget`） |
| 表格 | `packages/core/src/live-preview-table.ts` |
| Runtime 注册表 | `packages/plugin-runtime/src/markdown/widget-registry.ts` |
| 数学插件 | `packages/plugin-math/src/index.ts` |
| 现有 widget 测试 | `packages/core/test/widgets.test.ts` |
| mermaid 揭示 | `packages/core/test/mermaid.test.ts` |
| 表格 / HTML 点进源码 | `packages/core/test/live-preview.test.ts` |
| 交互中推迟动态贡献 | `packages/core/test/dynamic-contributions.test.ts` |
| 表格交互不变量 | 仓库根 `AGENTS.md` / `CLAUDE.md`「Table Widget Development Rules」 |

---

## 9. 测试逻辑（落地后的验收合同）

测 **行为不变量**，不测偶发文件名或视觉像素。Fixture 原则见 `AGENTS.md`：sample-vault 文案改了，断言仍应成立。

### 9.1 三条路径，必须分开测

| 手势 | 锁 | StateField | 测试必须证明 |
|---|---|---|---|
| **跨帧**（拖选过程、grip 拖列、按住） | `begin` → **mouseup 就 `end`** | 持锁期间 `docChanged` 只 `map`，selection-only 原样返回 | 锁内 DOM 身份不变；mouseup 后可重建 |
| **持久选区**（表格 `rangeActive` 多格高亮） | mouseup **不**放锁，直到 `clearRangeSelection` | 同上，整段编辑器 decoration 冻结 | 这是有意的：表格永远整体渲染，靠锁保住 range 高亮。**不是** §9 里「手势结束必须放锁」的反例。点表格外必须能清锁：`document` 上 **capture** `mousedown`（bubble 收不到 mermaid / 另一张表单元格的 `stopPropagation`） |
| **一次 click 进源码**（mermaid 图 / ✎ Edit、math ✎、HTML 块） | **禁止持锁** | 这次 `dispatch({ selection })` 必须立刻 `build()` | 事件同步返回后 widget 已为 `null`。若套了 begin/end，会「光标已进块、图还盖着」——只断言 `anchor` 会漏掉 |

表格 `decrementTableEditing` 继续 `{ refresh: false }`：放锁后由紧接着的 `dispatch` 重建；点外部清 range 不应为了刷新整表闪一下。因此 Delete / 粘贴进 range 必须 **先 `clearRangeSelection()` 再 `dispatch`**（与 `onDragEnd` 同序）。不要依赖通用锁的 microtask 刷新来兜这两个路径。

`endInteraction` 用 `queueMicrotask` 派 `widgetInteractionRefreshEffect`。测试里 `end` 之后至少 `await Promise.resolve()` 再查 DOM（**不要**再派一次 `setSelection` 才断言，那会掩盖 refresh 没跑）。刷新 **不得** 因 `view.dom.isConnected === false` 跳过。

`destroy()` 时若仍持锁：必须清零且不抛。

### 9.2 自动化用例

**`packages/core/test/widgets.test.ts`（公开 Widget API）**

| 用例 | 断言 |
|---|---|
| 匹配 `nodeType` 则渲染 | `[data-widget]` 存在 |
| 光标进入范围 | widget 拆除，露出 ` ``` ` 源码 |
| `match` 谓词 | 只替换 mermaid fence，js fence 仍是文本 |
| `destroy` | 光标进入后 `destroy` 被调用 |
| 多插件组合 | code + thematicBreak 同时存在 |
| 与 live preview 共存 | 仍渲染 `**bold**` |
| `block: false` | 行内 widget 与周围文本同一 `.cm-line` |
| `ignoreEvents` + `setSelection` | 点 edit 按钮后 widget 拆除（**不持锁**） |
| 无 widgets 注册 | 不炸，live preview 正常 |
| **持锁保 DOM 身份** | `begin` → `setSelection` 进范围 → 同一节点；`end` + microtask 后 **立刻**拆除（不再补一次 setSelection） |
| **泄漏锁** | `begin` 后直接 `editor.destroy()` 不抛 |
| **demo fence** `lang === "nexus-widget-demo"` | 只靠公开合同：渲染 → 点按钮（begin/setSelection/end）→ 源码 + `destroy` |

**`packages/core/test/mermaid.test.ts`（路径 B，mock `mermaid` 包）**

容器必须 `document.body.appendChild`，否则部分查询不稳定。事件用 **`mousedown`**（实现听的是 mousedown，不是 click）。

| 用例 | 断言 |
|---|---|
| 光标在块外 | `.nexus-mermaid` 存在；可见文本不含 `graph TD` / ` ```mermaid ` |
| 编辑芯片可见 | `.nexus-mermaid-edit` 文案含 `Edit`，且在 `.nexus-mermaid-chrome` 内（叠在 SVG 上，避免被图盖住） |
| 光标在块内 | `.nexus-mermaid` 为 `null`，源码可见 |
| 非 mermaid fence | 不出现 `.nexus-mermaid`，js 代码仍在 |
| 点 ✎ Edit | `anchor` 落在围栏第一行内容；widget 拆除；`graph TD` 可见 |
| 点图表本体 | 同样拆除 widget，露出围栏源码 |
| 表格 range 锁仍在时点 mermaid | capture 清表锁后图拆除，源码可见；`isInteractionActive()` 为 false |

**`packages/core/test/live-preview.test.ts`（表格 + HTML，合同的「亲戚」）**

表格 8 条路径仍是阶段 4 门禁（规则见 `AGENTS.md`）：点选编辑、拖选范围、grip 点选列、grip 拖列、点外部取消、Delete 清选区、单元格失焦、列/行移动后 DOM 与源码一致。Delete / 粘贴进 **单元格 range** 必须断言 **单元格 DOM**，不能只看 `getDocument()`。另有：

- HTML 块：点 wrapper 进源码；点 `<summary>` / `a[href]` **不**进源码。
- 任务复选框：click 切换；光标在 item 行头则露源码。

**`packages/core/test/dynamic-contributions.test.ts`**

- `isWidgetInteracting()` / 鼠标按下期间，动态 `registerExtension` 不得立刻换物理 extension。
- 表格 range / grip 拖拽整段 defer 到 mouseup（range 在 mouseup 后仍 `isInteractionActive()`，直到点外部 capture 清选区）。
- 粘贴进 table range：`replaceTargetSelection` 后单元格 DOM 与 markdown 一致（不能只断言 `replaced: true`）。

数学插件目前没有独立 test 文件；块公式 ✎ 的「一次 click 不持锁」由 widgets 的 `setSelection` 用例 + mermaid 同源模式兜住。行内公式：`block: false` 且不 `ignoreEvents`。

### 9.3 命令

合同回归（改 widget / mermaid / 锁时必跑）：

```bash
pnpm exec vitest run \
  packages/core/test/widgets.test.ts \
  packages/core/test/mermaid.test.ts \
  packages/core/test/live-preview.test.ts \
  packages/core/test/dynamic-contributions.test.ts
```

只动表格实现时，至少再加 `live-preview.test.ts` 里所有 table 用例（文件内已包含）。全量：`pnpm test`。

### 9.4 手工（Electron demo）

```bash
pnpm dev:electron-demo
```

改了 renderer / core 源码后，窗口内 **`Cmd+R`** 刷新；HMR 没跟上则终端 `Ctrl+C` 再跑上面的命令。

| 文件 | 操作 | 期望 |
|---|---|---|
| `apps/electron-demo/sample-vault/mermaid-demo.md` | 光标离开 mermaid 块 | 渲染图；右上角常显「✎ Edit」（不被 SVG 挡住） |
| 同上 | 点「✎ Edit」或点图表 | 立刻露出 ` ```mermaid ` 源码；光标在第一行内容 |
| 同上 | 光标再离开块 | 回到图 |
| 任意含 GFM 表的笔记 | 见 `AGENTS.md` 规则 7 的 8 条路径 | 无「第一下能用、下一帧立刻坏」 |

Demo 默认 **不** 加载 `plugin-math`；公式路径用单元测试，不要在 demo 里当门禁。

### 9.5 写新测试时不要做的事

- 不要用 HTML5 Drag 事件测 grip；用 mousedown / mousemove / mouseup。
- 不要断言 sample-vault 里某篇笔记必须是某条 backlink 的唯一来源。
- 不要只断言 `getSelection().anchor` 而不断言 widget 节点已拆除——那测不出「锁把揭示推迟了」。
- mermaid 测试继续 `vi.mock("mermaid")`，不要在 jsdom 里跑真实渲染。

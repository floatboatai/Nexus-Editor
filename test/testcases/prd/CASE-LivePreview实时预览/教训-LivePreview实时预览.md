# 教训 - LivePreview实时预览

## 关联用例

### FP-04-01 折叠 Widget（9条）
- FP-04-01-N01 [P1] [正常] [Vitest] heading 折叠 `# ` 前缀为标题 Widget
- FP-04-01-N02 [P1] [正常] [Vitest] link 折叠为 data-link-url Widget
- FP-04-01-N03 [P1] [正常] [Vitest] 行内 strong/emphasis/inlineCode 跨行折叠
- FP-04-01-N04 [P3] [正常] [Vitest] 无序列表折叠为 bullet/checkbox Widget
- FP-04-01-N05 [P2] [正常] [Vitest] image 折叠为图片预览 Widget
- FP-04-01-N06 [P2] [正常] [Vitest] fenced code 块折叠
- FP-04-01-E01 [P3] [异常] [Vitest] mermaid 懒加载折叠
- FP-04-01-B01 [P4] [边界] [Vitest] table 始终折叠可编辑 Widget
- FP-04-01-B02 [P4] [边界] [Vitest] 嵌套格式折叠无残留标记

### FP-04-02 光标展开（9条）
- FP-04-02-N01 [P1] [正常] [Vitest] strong 光标移入所在行展开源码
- FP-04-02-N02 [P1] [正常] [Vitest] link 光标移入范围展开源码
- FP-04-02-N03 [P2] [正常] [Vitest] heading 光标移入展开前缀
- FP-04-02-N04 [P2] [正常] [Vitest] code 块光标移入 fence 恢复
- FP-04-02-N05 [P3] [正常] [Vitest] image 光标移入源码可见
- FP-04-02-N06 [P3] [正常] [Vitest] 展开↔折叠往返多次切换稳定
- FP-04-02-B01 [P4] [边界] [Vitest] link inclusiveEnd 边界
- FP-04-02-B02 [P3] [异常] [Vitest] heading 非 inclusiveEnd 边界
- FP-04-02-B03 [P3] [异常] [Vitest] 多选区混合展开折叠共存

### FP-04-03 React createPortal 渲染桥接（6条）
- FP-04-03-N01 [P1] [正常] [Vitest] 自定义 renderer + createPortal
- FP-04-03-N02 [P2] [正常] [Vitest] React 组件接收完整渲染上下文
- FP-04-03-N03 [P4] [边界] [Vitest] 多个折叠节点各自独立挂载
- FP-04-03-E01 [P4] [异常] [Vitest] eqKey 相同复用既有 DOM
- FP-04-03-B01 [P3] [边界] [Vitest] setDocument 后 React 组件重新挂载
- FP-04-03-D01 [P4] [设计约束] [Vitest] Widget 挂载层级约束

## 重要发现

### 本轮执行结果：23/24 通过，1 条被真实 BUG 阻塞（BUG-001）

1. **BUG-001（FP-04-03-E01）：renderer widget 的 eqKey DOM 复用机制未生效**（真实缺陷，详见 BUG 文档）
   - 现象：光标移动（selection-only）后自定义 renderer 被重复调用，mountCount 1→2。
   - 根因：`createWidget` 每次调用 `new (class extends WidgetType {...})()` 创建**新匿名类** → CM6 `WidgetType.compare` 的 `this.constructor == other.constructor` 短路失败 → `eq()` 永不生效 → 每次 rebuild 全新 toDOM。
   - 副产品：StateField 对 selection-only 走全量 `build`（`reuseCache=true` 仅复用 AST），而非 `decos.map`，进一步加剧重建。

2. **FP-04-03 六条 React 用例 setup 假设错误（非产品缺陷）**：`createPortal(element, host)` 单独调用**不触发渲染**（返回描述符，无副作用）；必须 `createRoot(host).render(portal)` 才挂载。对照实验确认 childNodes=0（裸 portal）vs 挂载成功（with root）。测试已按 `createRoot` 模式修正。

3. **FP-04-02-N02 测试自身 bug**：setup 用 `source.indexOf("here") + 1 = 8`，断言却期望 `anchor === 7`，自相矛盾。改用固定 `setSelection(7)`（落在 "here" 文本范围 [7,11) 内）。

## 额外教训

- **CM6 widget DOM 复用三路径**：①装饰 `map`（保留旧 widget 实例，`Reused.Full`，dist L2642）；②`TileCache.findWidget` pass 0 `compare`（`==` 或 **constructor 相同且 eq**）；③pass 1 `constructor 相同且 updateDOM`。任何自定义 WidgetType 想跨 rebuild 复用 DOM，必须满足 constructor 相同——**匿名类/内联类都会使 eq/updateDOM 失效**。
- **jsdom 中 React 渲染**：React 19 `createRoot().render()` 为异步提交，断言 DOM 前需 `await` 微任务/tick（本项目用 `flush() = setTimeout 20ms`）。
- **mermaid 测试**：`vi.mock("mermaid", ...)` 顶层声明即可（vitest hoisting），render 返回 `{ svg }` 形状；断言用 `vi.waitFor` 等待异步 svg。
- **selection-only 事务在 live-preview 中全量重建**：光标移动会重建全部 decorations（非 map），性能敏感场景（大文档 + 自定义 renderer）需注意。

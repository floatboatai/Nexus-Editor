# 测试进度 - LivePreview实时预览

- **测试日期**：2026-08-11
- **测试工具**：Vitest (jsdom)
- **测试环境**：Nexus_Editor monorepo (packages/*)
- **教训文档**：[教训-LivePreview实时预览](教训-LivePreview实时预览.md)
- **BUG文档**：[BUG-LivePreview实时预览](BUG-LivePreview实时预览.md)

## 统计汇总

| 状态 | 数量 | 占比 |
|------|------|------|
| ✅ 通过 | 23 | 95.8% |
| ❗ 与预期不符 | 0 | 0% |
| ❌ 被BUG阻塞 | 1 | 4.2% |
| ⏸️ 未执行/无法验证 | 0 | 0% |
| **合计** | **24** | **100%** |

> 说明：23 条通过。FP-04-03-E01 因真实缺陷 BUG-001（renderer widget eqKey DOM 复用未生效，每次光标移动重新挂载）失败，详见 [BUG-LivePreview实时预览](BUG-LivePreview实时预览.md#bug-001renderer-widget-的-eqkey-dom-复用机制未生效每次光标移动重新挂载)。另有 2 条为「用例文档假设修正」：FP-04-02-N02（测试自身断言与 setup 不一致，改用固定光标 7）；FP-04-03 共 6 条 React 用例的 setup 中 `createPortal` 需配合 `createRoot` 才触发渲染（用例文档假设错误，非产品缺陷）。

## BUG汇总

| BUG | 严重程度 | 关联用例数 | 测试框架 | 描述 |
|-----|---------|-----------|---------|------|
| BUG-001 | 中 | 1 | Vitest | renderer widget eqKey DOM 复用未生效（匿名类致 CM6 compare 短路） |

---

## 一、FP-04-01 折叠 Widget

| 用例ID | 优先级 | 测试框架 | 描述 | 测试结果 | 运行命令 | 说明 | 关联BUG |
|--------|--------|---------|------|---------|---------|------|---------|
| FP-04-01-N01 | P1 | Vitest | heading 折叠 `# ` 前缀为标题 Widget | ✅ 通过 | npx vitest run RUN-FP-04-01-N01.test.ts | - | - |
| FP-04-01-N02 | P1 | Vitest | link 折叠为 data-link-url Widget | ✅ 通过 | npx vitest run RUN-FP-04-01-N02.test.ts | - | - |
| FP-04-01-N03 | P1 | Vitest | 行内 strong/emphasis/inlineCode 跨行折叠 | ✅ 通过 | npx vitest run RUN-FP-04-01-N03.test.ts | - | - |
| FP-04-01-N04 | P3 | Vitest | 无序列表折叠为 bullet/checkbox Widget | ✅ 通过 | npx vitest run RUN-FP-04-01-N04.test.ts | - | - |
| FP-04-01-N05 | P2 | Vitest | image 折叠为图片预览 Widget | ✅ 通过 | npx vitest run RUN-FP-04-01-N05.test.ts | - | - |
| FP-04-01-N06 | P2 | Vitest | fenced code 块折叠 | ✅ 通过 | npx vitest run RUN-FP-04-01-N06.test.ts | - | - |
| FP-04-01-E01 | P3 | Vitest | mermaid 懒加载折叠 | ✅ 通过 | npx vitest run RUN-FP-04-01-E01.test.ts | vi.mock("mermaid") | - |
| FP-04-01-B01 | P4 | Vitest | table 始终折叠可编辑 Widget | ✅ 通过 | npx vitest run RUN-FP-04-01-B01.test.ts | - | - |
| FP-04-01-B02 | P4 | Vitest | 嵌套格式折叠无残留标记 | ✅ 通过 | npx vitest run RUN-FP-04-01-B02.test.ts | - | - |

---

## 二、FP-04-02 光标感知展开

| 用例ID | 优先级 | 测试框架 | 描述 | 测试结果 | 运行命令 | 说明 | 关联BUG |
|--------|--------|---------|------|---------|---------|------|---------|
| FP-04-02-N01 | P1 | Vitest | strong 光标移入所在行展开 | ✅ 通过 | npx vitest run RUN-FP-04-02-N01.test.ts | - | - |
| FP-04-02-N02 | P1 | Vitest | link 光标移入范围展开源码 | ✅ 通过 | npx vitest run RUN-FP-04-02-N02.test.ts | 修正：setSelection 固定 7（原 setup 与断言不一致） | - |
| FP-04-02-N03 | P1 | Vitest | heading 光标移入展开 `# ` | ✅ 通过 | npx vitest run RUN-FP-04-02-N03.test.ts | - | - |
| FP-04-02-N04 | P2 | Vitest | code 块光标移入 fence 恢复可见 | ✅ 通过 | npx vitest run RUN-FP-04-02-N04.test.ts | - | - |
| FP-04-02-N05 | P2 | Vitest | image 光标移入源码可见预览保留 | ✅ 通过 | npx vitest run RUN-FP-04-02-N05.test.ts | - | - |
| FP-04-02-N06 | P3 | Vitest | 展开↔折叠往返多次切换稳定 | ✅ 通过 | npx vitest run RUN-FP-04-02-N06.test.ts | - | - |
| FP-04-02-B01 | P4 | Vitest | link inclusiveEnd 边界 | ✅ 通过 | npx vitest run RUN-FP-04-02-B01.test.ts | - | - |
| FP-04-02-B02 | P4 | Vitest | heading 非 inclusiveEnd 边界 | ✅ 通过 | npx vitest run RUN-FP-04-02-B02.test.ts | - | - |
| FP-04-02-B03 | P4 | Vitest | 多选区混合展开/折叠共存 | ✅ 通过 | npx vitest run RUN-FP-04-02-B03.test.ts | - | - |

---

## 三、FP-04-03 React 渲染桥接

| 用例ID | 优先级 | 测试框架 | 描述 | 测试结果 | 运行命令 | 说明 | 关联BUG |
|--------|--------|---------|------|---------|---------|------|---------|
| FP-04-03-N01 | P1 | Vitest | createPortal 桥接到 widget DOM | ✅ 通过 | npx vitest run RUN-FP-04-03-N01.test.ts | 修正：setup 加 createRoot 才触发渲染 | - |
| FP-04-03-N02 | P2 | Vitest | 渲染上下文 nodeType/text/from/to | ✅ 通过 | npx vitest run RUN-FP-04-03-N02.test.ts | 同上 | - |
| FP-04-03-N03 | P2 | Vitest | 多 React widget 独立挂载 | ✅ 通过 | npx vitest run RUN-FP-04-03-N03.test.ts | 同上 | - |
| FP-04-03-E01 | P3 | Vitest | eqKey 相同时 widget DOM 复用 | ❌ 被BUG阻塞 | npx vitest run RUN-FP-04-03-E01.test.ts | mountCount 光标移动后增长（1→2） | BUG-001 |
| FP-04-03-B01 | P4 | Vitest | setDocument 后重新挂载新内容 | ✅ 通过 | npx vitest run RUN-FP-04-03-B01.test.ts | 同上 | - |
| FP-04-03-D01 | P5 | Vitest | 挂载层级 + 混合渲染共存 | ✅ 通过 | npx vitest run RUN-FP-04-03-D01.test.ts | 同上 | - |

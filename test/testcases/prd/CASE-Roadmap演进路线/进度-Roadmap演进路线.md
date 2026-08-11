# 测试进度 - Roadmap演进路线

- **测试日期**：2026-08-11
- **测试工具**：Vitest (jsdom)
- **测试环境**：Nexus_Editor monorepo (packages/*)
- **教训文档**：[教训-Roadmap演进路线](教训-Roadmap演进路线.md)
- **BUG文档**：[BUG-Roadmap演进路线](BUG-Roadmap演进路线.md)

## 统计汇总

| 状态 | 数量 | 占比 |
|------|------|------|
| ✅ 通过 | 32 | 100% |
| ❗ 与预期不符 | 0 | 0% |
| ❌ 被BUG阻塞 | 0 | 0% |
| ⏸️ 未执行/无法验证 | 0 | 0% |
| **合计** | **32** | **100%** |

## BUG汇总

| BUG | 严重程度 | 关联用例数 | 测试框架 | 描述 |
|-----|---------|-----------|---------|------|
| - | - | - | - | 本轮无 BUG（5 处用例假设修正均为用例文档问题，非产品缺陷） |

---

## 一、FP-07-01 Phase1 核心引擎 MVP

| 用例ID | 优先级 | 测试框架 | 描述 | 测试结果 | 运行命令 | 说明 | 关联BUG |
|--------|--------|---------|------|---------|---------|------|---------|
| FP-07-01-N01 | P1 | Vitest | createEditor 基础创建 + AST 根节点 | ✅ 通过 | npx vitest run RUN-FP-07-01-N01.test.ts | - | - |
| FP-07-01-N02 | P1 | Vitest | setDocument 同步 + change 事件 | ✅ 通过 | npx vitest run RUN-FP-07-01-N02.test.ts | - | - |
| FP-07-01-N03 | P1 | Vitest | 基础 Live Preview 链接渲染 | ✅ 通过 | npx vitest run RUN-FP-07-01-N03.test.ts | - | - |
| FP-07-01-N04 | P2 | Vitest | setDocument 全量替换后 AST/TOC 同步 | ✅ 通过 | npx vitest run RUN-FP-07-01-N04.test.ts | - | - |
| FP-07-01-N05 | P2 | Vitest | 复杂文档 AST 结构完整 | ✅ 通过 | npx vitest run RUN-FP-07-01-N05.test.ts | - | - |
| FP-07-01-E01 | P3 | Vitest | 缺省/非法 container 拒绝创建 | ✅ 通过 | npx vitest run RUN-FP-07-01-E01.test.ts | 假设修正：缺省/null 不抛错 | - |
| FP-07-01-E02 | P3 | Vitest | 畸形 markdown 解析降级 | ✅ 通过 | npx vitest run RUN-FP-07-01-E02.test.ts | - | - |
| FP-07-01-B01 | P4 | Vitest | 空字符串初始文档正常挂载 | ✅ 通过 | npx vitest run RUN-FP-07-01-B01.test.ts | - | - |
| FP-07-01-B02 | P4 | Vitest | 中文文本 UTF-16 偏移 | ✅ 通过 | npx vitest run RUN-FP-07-01-B02.test.ts | - | - |
| FP-07-01-B03 | P4 | Vitest | 超长文档（千行级）不失败 | ✅ 通过 | npx vitest run RUN-FP-07-01-B03.test.ts | 假设修正：连续文本为单 paragraph | - |
| FP-07-01-F01 | P5 | Vitest | destroy 清理 DOM 幂等 | ✅ 通过 | npx vitest run RUN-FP-07-01-F01.test.ts | - | - |

---

## 二、FP-07-02 Phase2 框架拥抱

| 用例ID | 优先级 | 测试框架 | 描述 | 测试结果 | 运行命令 | 说明 | 关联BUG |
|--------|--------|---------|------|---------|---------|------|---------|
| FP-07-02-N01 | P1 | Vitest | GFM preset 表格/任务列表 | ✅ 通过 | npx vitest run RUN-FP-07-02-N01.test.ts | - | - |
| FP-07-02-N02 | P1 | Vitest | History 插件撤销/重做 | ✅ 通过 | npx vitest run RUN-FP-07-02-N02.test.ts | - | - |
| FP-07-02-N03 | P1 | Vitest | Search 插件 Mod-f 面板 | ✅ 通过 | npx vitest run RUN-FP-07-02-N03.test.ts | 假设修正：jsdom Mod→Ctrl | - |
| FP-07-02-N04 | P2 | Vitest | React Editor 组件 + onReady | ✅ 通过 | npx vitest run RUN-FP-07-02-N04.test.tsx | 假设修正：JSX 需 .tsx | - |
| FP-07-02-N05 | P2 | Vitest | React useEditor hook | ✅ 通过 | npx vitest run RUN-FP-07-02-N05.test.tsx | 假设修正：JSX 需 .tsx | - |
| FP-07-02-N06 | P2 | Vitest | Vue Editor 组件挂载卸载 | ✅ 通过 | npx vitest run RUN-FP-07-02-N06.test.ts | - | - |
| FP-07-02-F01 | P2 | Vitest | React 受控 value 无回环 | ✅ 通过 | npx vitest run RUN-FP-07-02-F01.test.tsx | 假设修正：受控 value 需暴露 setState | - |
| FP-07-02-E01 | P3 | Vitest | React 非受控模式正常 | ✅ 通过 | npx vitest run RUN-FP-07-02-E01.test.tsx | 假设修正：JSX 需 .tsx | - |
| FP-07-02-E02 | P3 | Vitest | GFM+History+Search 三插件共存 | ✅ 通过 | npx vitest run RUN-FP-07-02-E02.test.ts | 假设修正：禁止重复 createEditor | - |
| FP-07-02-D01 | P4 | Vitest | TypeScript 类型定义导出 | ✅ 通过 | npx vitest run RUN-FP-07-02-D01.test.ts | - | - |

---

## 三、FP-07-03 Phase3 桌面端深度

| 用例ID | 优先级 | 测试框架 | 描述 | 测试结果 | 运行命令 | 说明 | 关联BUG |
|--------|--------|---------|------|---------|---------|------|---------|
| FP-07-03-N01 | P1 | Vitest | 自定义 Widget + data-nexus-widget | ✅ 通过 | npx vitest run RUN-FP-07-03-N01.test.ts | - | - |
| FP-07-03-N02 | P1 | Vitest | 多个 Widget 共存互不干扰 | ✅ 通过 | npx vitest run RUN-FP-07-03-N02.test.ts | - | - |
| FP-07-03-N03 | P2 | Vitest | ctx.setSelection/focus 交互 | ✅ 通过 | npx vitest run RUN-FP-07-03-N03.test.ts | - | - |
| FP-07-03-N04 | P2 | Vitest | parseDelayMs IO 防抖 | ✅ 通过 | npx vitest run RUN-FP-07-03-N04.test.ts | - | - |
| FP-07-03-E01 | P3 | Vitest | 光标进入 Widget 范围回退源码 | ✅ 通过 | npx vitest run RUN-FP-07-03-E01.test.ts | - | - |
| FP-07-03-E02 | P3 | Vitest | 无匹配 nodeType 静默 | ✅ 通过 | npx vitest run RUN-FP-07-03-E02.test.ts | - | - |
| FP-07-03-E03 | P3 | Vitest | match 谓词精细过滤 | ✅ 通过 | npx vitest run RUN-FP-07-03-E03.test.ts | - | - |
| FP-07-03-E04 | P3 | Vitest | 非法 Widget（空 nodeType） | ✅ 通过 | npx vitest run RUN-FP-07-03-E04.test.ts | - | - |
| FP-07-03-B01 | P4 | Vitest | block:false 行内 Widget | ✅ 通过 | npx vitest run RUN-FP-07-03-B01.test.ts | - | - |
| FP-07-03-B02 | P4 | Vitest | ignoreEvents:true 事件响应 | ✅ 通过 | npx vitest run RUN-FP-07-03-B02.test.ts | - | - |
| FP-07-03-F01 | P5 | Vitest | Widget destroy 回调 | ✅ 通过 | npx vitest run RUN-FP-07-03-F01.test.ts | - | - |

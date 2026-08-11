# 测试进度 - 模块化UI委托

- **测试日期**：2026-08-11
- **测试工具**：Vitest (jsdom) + Playwright (Electron demo)
- **测试环境**：Nexus_Editor monorepo (packages/*)
- **教训文档**：[教训-模块化UI委托](教训-模块化UI委托.md)
- **BUG文档**：[BUG-模块化UI委托](BUG-模块化UI委托.md)

## 统计汇总

| 状态 | 数量 | 占比 |
|------|------|------|
| ✅ 通过 | 28 | 100% |
| ❗ 与预期不符 | 0 | 0% |
| ❌ 被BUG阻塞 | 0 | 0% |
| ⏸️ 未执行/无法验证 | 0 | 0% |
| **合计** | **28** | **100%** |

## BUG汇总

| BUG | 严重程度 | 关联用例数 | 测试框架 | 描述 |
|-----|---------|-----------|---------|------|
| - | - | - | - | - |

---

## 一、FP-06-01 core 坐标+选区状态

| 用例ID | 优先级 | 测试框架 | 描述 | 测试结果 | 运行命令 | 说明 | 关联BUG |
|--------|--------|---------|------|---------|---------|------|---------|
| FP-06-01-N01 | P1 | Vitest | 斜杠触发坐标+状态并 emit | ✅ 通过 | npx vitest run RUN-FP-06-01-N01.test.ts | 4步骤全部通过（from=0/to=1/query=""） | - |
| FP-06-01-N02 | P1 | Vitest | coords 字段契约 | ✅ 通过 | npx vitest run RUN-FP-06-01-N02.test.ts | 4步骤全部通过（coords=null 降级） | - |
| FP-06-01-N03 | P1 | Vitest | core 零 UI 渲染 | ✅ 通过 | npx vitest run RUN-FP-06-01-N03.test.ts | 4步骤全部通过（无菜单 DOM 注入） | - |
| FP-06-01-N04 | P2 | Vitest | selection/slash 状态一致 | ✅ 通过 | npx vitest run RUN-FP-06-01-N04.test.ts | 4步骤全部通过 | - |
| FP-06-01-F01 | P2 | Vitest | 菜单状态随光标开/关 | ✅ 通过 | npx vitest run RUN-FP-06-01-F01.test.ts | 4步骤全部通过 | - |
| FP-06-01-E01 | P3 | Vitest | 无命令源不 emit | ✅ 通过 | npx vitest run RUN-FP-06-01-E01.test.ts | 2步骤全部通过 | - |
| FP-06-01-E02 | P3 | Vitest | 行内斜杠不触发 | ✅ 通过 | npx vitest run RUN-FP-06-01-E02.test.ts | 2步骤全部通过 | - |
| FP-06-01-E03 | P3 | Vitest | query 含空白关闭 | ✅ 通过 | npx vitest run RUN-FP-06-01-E03.test.ts | 3步骤全部通过 | - |
| FP-06-01-B01 | P4 | Vitest | doc="/" 边界 from/to | ✅ 通过 | npx vitest run RUN-FP-06-01-B01.test.ts | 4步骤全部通过 | - |
| FP-06-01-B02 | P4 | Vitest | 多行跨行偏移 | ✅ 通过 | npx vitest run RUN-FP-06-01-B02.test.ts | 3步骤全部通过 | - |
| FP-06-01-D01 | P5 | Vitest | coords 数据契约 | ✅ 通过 | npx vitest run RUN-FP-06-01-D01.test.ts | 3步骤全部通过 | - |

---

## 二、FP-06-02 on/off 状态订阅

| 用例ID | 优先级 | 测试框架 | 描述 | 测试结果 | 运行命令 | 说明 | 关联BUG |
|--------|--------|---------|------|---------|---------|------|---------|
| FP-06-02-N01 | P1 | Vitest | on 订阅六字段载荷 | ✅ 通过 | npx vitest run RUN-FP-06-02-N01.test.ts | 3步骤全部通过 | - |
| FP-06-02-N02 | P1 | Vitest | off 取消订阅 | ✅ 通过 | npx vitest run RUN-FP-06-02-N02.test.ts | 3步骤全部通过 | - |
| FP-06-02-N03 | P2 | Vitest | 多订阅者广播 | ✅ 通过 | npx vitest run RUN-FP-06-02-N03.test.ts | 3步骤全部通过 | - |
| FP-06-02-N04 | P2 | Vitest | 关闭状态推送 | ✅ 通过 | npx vitest run RUN-FP-06-02-N04.test.ts | 3步骤全部通过 | - |
| FP-06-02-F01 | P2 | Vitest | 连续键入回调序列 | ✅ 通过 | npx vitest run RUN-FP-06-02-F01.test.ts | 4步骤全部通过 | - |
| FP-06-02-E01 | P3 | Vitest | off 幂等安全 | ✅ 通过 | npx vitest run RUN-FP-06-02-E01.test.ts | 2步骤全部通过 | - |
| FP-06-02-E02 | P3 | Vitest | 重复 on 去重 | ✅ 通过 | npx vitest run RUN-FP-06-02-E02.test.ts | 3步骤全部通过 | - |
| FP-06-02-E03 | P3 | Vitest | limit=0 无结果占位 | ✅ 通过 | npx vitest run RUN-FP-06-02-E03.test.ts | 3步骤全部通过 | - |
| FP-06-02-B01 | P4 | Vitest | limit=3 截断 | ✅ 通过 | npx vitest run RUN-FP-06-02-B01.test.ts | 3步骤全部通过 | - |
| FP-06-02-B02 | P4 | Vitest | destroy 后静默 | ✅ 通过 | npx vitest run RUN-FP-06-02-B02.test.ts | 3步骤全部通过 | - |
| FP-06-02-D01 | P5 | Vitest | 载荷与命令同源 | ✅ 通过 | npx vitest run RUN-FP-06-02-D01.test.ts | 3步骤全部通过 | - |

---

## 三、FP-06-03 宿主渲染绝对定位组件

| 用例ID | 优先级 | 测试框架 | 描述 | 测试结果 | 运行命令 | 说明 | 关联BUG |
|--------|--------|---------|------|---------|---------|------|---------|
| FP-06-03-N01 | P1 | Vitest | 挂载 body + fixed | ✅ 通过 | npx vitest run RUN-FP-06-03-N01.test.ts | 4步骤全部通过 | - |
| FP-06-03-N02 | P2 | Vitest | reposition 定位公式 | ✅ 通过 | npx vitest run RUN-FP-06-03-N02.test.ts | 4步骤全部通过 | - |
| FP-06-03-E01 | P3 | Vitest | coords=null 可见不移动 | ✅ 通过 | npx vitest run RUN-FP-06-03-E01.test.ts | 4步骤全部通过 | - |
| FP-06-03-E02 | P3 | Vitest | destroy 清理 DOM | ✅ 通过 | npx vitest run RUN-FP-06-03-E02.test.ts | 3步骤全部通过 | - |
| FP-06-03-B01 | P4 | Vitest | 挂载 ShadowRoot | ✅ 通过 | npx vitest run RUN-FP-06-03-B01.test.ts | 4步骤全部通过 | - |
| FP-06-03-F01 | P2 | Vitest | 打开→选择→关闭 | ✅ 通过 | npx vitest run RUN-FP-06-03-F01.test.ts | 5步骤全部通过 | - |

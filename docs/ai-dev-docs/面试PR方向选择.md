# Nexus-Editor 面试 PR 方向选择

> 基于 2026-07-13 项目状态分析，针对 2 天面试题周期的推荐方案。

---

## 一、项目当前状态速览

- 项目可正常运行：`pnpm install --ignore-scripts` → `pnpm test`（537 测试全绿）→ `pnpm build`（11 包全成功）→ `pnpm typecheck`（strict 通过）
- 版本：v0.0.13
- Roadmap 共 29 项：11 项 done、2 项 in-progress、16 项 planned
- 代码总量：26,809 行（17,238 源码 + 9,571 测试）

---

## 二、三个推荐方向

### 方向 A：模糊搜索（Fuzzy Search）—— 首选推荐

| 维度 | 说明 |
|---|---|
| Roadmap 编号 | #17 |
| 优先级 | P2 |
| 归属包 | `plugin-search` |
| 需要 OpenSpec | 否（ROADMAP 明确标注） |
| 预计耗时 | 1.5 - 2 天 |
| 实现难度 | 中等 |
| 技术亮点 | fzf-like 匹配算法、带回溯的匹配器、匹配位置高亮、评分体系 |

**为什么首选**：

1. 在 Roadmap 里是真实 planned 项目，做出来就是「给项目补缺口」
2. 不需要 OpenSpec 提案流程，节省大量时间
3. 只改 `plugin-search` 一个包，边界清晰
4. 有现成测试文件可扩展：`packages/plugin-search/test/plugin-search.test.ts`
5. 能展示算法能力 + TypeScript 严格类型 + 单测覆盖

**实现思路**：

- 在 `SearchOptions` 中新增 `fuzzy?: boolean` 选项
- 新增 `plugin-search/src/fuzzy.ts`，实现 `fuzzyMatch(query, text)`：
  - 字符跳跃匹配（如 `hw` 匹配 `hello world`）
  - 返回匹配位置数组，供高亮使用
  - 评分维度：连续匹配加分、词首匹配加分、短距离跳跃加分、原始索引稳定性
- 在 `buildSearchPattern` 分支里，当 `fuzzy=true` 时走自定义匹配逻辑
- 默认 `fuzzy: false`，保持向后兼容
- 新增 15-20 个单测覆盖边界情况

**预期 PR 标题**：`feat(search): add fuzzy search support`

---

### 方向 B：Mermaid 从 core 拆成独立插件 —— 稳妥备选

| 维度 | 说明 |
|---|---|
| 来源 | `add-missing-features` OpenSpec 提案 3.5 未完成项 |
| 优先级 | P2 |
| 归属包 | 新包 `plugin-mermaid`，修改 `core` |
| 需要 OpenSpec | 是（新 capability / 新包） |
| 预计耗时 | 1.5 - 2 天 |
| 实现难度 | 中低 |
| 技术亮点 | 包体积优化、架构解耦、向后兼容 |

**为什么备选**：

1. 能显著减小 `@floatboat/nexus-core` 体积（Mermaid ~1MB+）
2. 改动边界清晰，不容易踩坑
3. 展示对 monorepo 包结构的理解

**注意事项**：

- 这是新 capability，需要先走 OpenSpec 提案
- 需要保证现有 `mermaid.test.ts` 测试能通过
- 需要把 core 里的 mermaid Widget 逻辑迁移到新包
- 可能涉及 `core` 依赖减少，需更新 `package.json`

**风险**：

- OpenSpec 流程会占用时间
- 技术展示力不如模糊搜索
- 面试官可能认为是「体力活」

**预期 PR 标题**：`feat(mermaid): extract mermaid preview into standalone plugin`

---

### 方向 C：Undo/Redo 分组 —— 中等风险

| 维度 | 说明 |
|---|---|
| Roadmap 编号 | #8 |
| 优先级 | P1 |
| 归属包 | `plugin-history` + `core` |
| 需要 OpenSpec | 否（ROADMAP 明确标注） |
| 预计耗时 | 2 天（偏紧） |
| 实现难度 | 中等 |
| 技术亮点 | CodeMirror 6 Transaction、事务边界控制、与 table 编辑协同 |

**为什么可考虑**：

1. 是 Roadmap P1 真实 planned 项目
2. 不需要 OpenSpec
3. 能展示对 CM6 事务系统的理解

**实现思路**：

- 在 `plugin-history` 中封装 `startHistoryGroup()` / `endHistoryGroup()` API
- 基于 CM6 的 `historyField` 和 `Annotation` 实现分组
- 注意与 `packages/core/src/live-preview-table.ts` 的 `tableEditingCount` 协同
- 工具栏/斜杠命令执行多个编辑步骤时，应合并为一个 undo 条目

**风险**：

- 涉及 `core` 事务边界，容易踩坑
- 2 天内完成 + 测试覆盖较紧
- 需要理解 `live-preview-table.ts` 的复杂交互

**预期 PR 标题**：`feat(history): add undo/redo grouping API`

---

## 三、不建议选择的方向

| 方向 | 原因 |
|---|---|
| 腾讯翻译接口 | 违反 GOVERNANCE §4：禁止特定供应商 SDK 捆绑 |
| Tauri 打包 | `apps/electron-demo` 只是引擎演示，不是产品；新增 Tauri 属于跨包架构调整 |
| AI / LLM 功能 | 项目明确拒绝任何 AI 集成 |
| Widget API 标准化 | 需要 OpenSpec，2 天走不完流程 |
| 实时协作 CRDT | 远超 2 天周期 |
| 表格编辑增强 | `live-preview-table.ts` 是项目最复杂模块，新手 2 天搞不定 |

---

## 四、选择建议

| 你的情况 | 推荐方向 |
|---|---|
| 想稳妥拿分、算法有信心 | **方向 A：模糊搜索** |
| 想展示架构能力、不怕走 OpenSpec | 方向 B：Mermaid 拆包 |
| 对 CM6 事务很熟悉 | 方向 C：Undo/Redo 分组 |

**总体推荐：方向 A（模糊搜索）**。它在 Roadmap 里是真实需求，不需要 OpenSpec，2 天可控，技术展示力强，且与现有 `plugin-search` 架构完美契合。

---

## 五、执行 checklist

以方向 A 为例：

1. [ ] 阅读 `packages/plugin-search/src/index.ts` 和测试文件
2. [ ] 跑基线测试：`pnpm test -- packages/plugin-search`
3. [ ] 新建 `packages/plugin-search/src/fuzzy.ts`
4. [ ] 实现 `fuzzyMatch` 核心算法 + 单测
5. [ ] 在 `SearchOptions` 中增加 `fuzzy` 选项并集成
6. [ ] 扩展 `plugin-search.test.ts` 覆盖模糊搜索
7. [ ] 跑全量测试：`pnpm test`
8. [ ] 跑构建：`pnpm build`
9. [ ] 跑类型检查：`pnpm typecheck`
10. [ ] 写 PR 描述，说明 Why / What / 测试覆盖
11. [ ] 提交 PR，标题：`feat(search): add fuzzy search support`

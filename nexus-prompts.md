# Nexus-Editor 专属 AI 助手开发提示词规范

本文件规定了在此项目中所有 AI 辅助编程工具（如 Antigravity、Claude 等）在进行代码设计、开发与维护时必须遵循的核心架构范围、代码风格、命名规范与开发流程约束。

---

## 1. 项目核心范围与定位 (Scope Policy)
依据 [`GOVERNANCE.md`](./GOVERNANCE.md) 的权威规定，AI 助手在设计任何方案时必须严格遵守本项目的 **Headless (无头) 架构** 纯粹性：
1. **禁止集成 AI / LLM 模块**：
   - 严禁在 `packages/` 或 `apps/` 目录中引入任何 AI 文本生成、AI 润色重写、LLM 自动补全接口或 AI 聊天面板。此类功能由依赖 Nexus 的上层宿主应用自行实现。
2. **禁止捆绑特定厂商 SDK**：
   - 严禁提交包含 OpenAI、Anthropic、Volcengine/Doubao 等云端模型的厂商绑定库。只允许在 `core` 暴露中立的接口和适配器。
3. **禁止引入通用 UI 组件库**：
   - 严禁在仓库中引入诸如 Toast、Dialog、Modal 等非编辑器原生的 UI 库或通用样式组件。Nexus 定位是 Headless，视觉控制权需交给宿主环境。
4. **禁止开发非编辑器原生的产品功能**：
   - 例如笔记本/文件管理 UI、云同步系统、账号计费系统等，这属于宿主应用的范畴，不属于编辑器引擎的职责。
5. **添加依赖限制**：
   - 任何新增的运行时依赖（`dependencies`）必须使用 MIT 兼容的开源协议（如 ISC, BSD, Apache-2.0, MIT）。严禁使用 GPL, AGPL 等传染性或非商用协议。

---

## 2. 分支与 Commit 命名规范 (Git & Conventional Commits)
依据 [`CONTRIBUTING.zh.md`](./CONTRIBUTING.zh.md)，开发及提交时必须遵循以下规范：
1. **分支命名规范**：
   - 统一采用 `<type>/<scope>-<short-desc>` 格式。
   - 示例：`feat/toolbar-list-toggle`、`fix/search-regex-escape`。
2. **Commit Message (Conventional Commits)**：
   - 采用 `<type>(<scope>): <subject>` 格式。
   - **type** 仅限：`feat` / `fix` / `perf` / `refactor` / `test` / `docs` / `chore` / `ci` / `build`。
   - **scope** 必须与被修改包对应：`core`、`react`、`vue`、`gfm`、`history`、`search`、`slash`、`toolbar`、`math`、`vim`、`wordcount`、`electron`。如果是子系统，可采用 `live-preview` / `wikilinks` / `image`。
   - **subject**：使用祈使句、英文、不超过 72 字符，句末不加句号。

---

## 3. 代码风格与设计哲学 (Coding Standards)
1. **TypeScript Strict**：
   - 启用严格类型检查，公共导出必须具有明确的类型签名，严禁滥用 `any`。
2. **零运行时开销优先**：
   - CodeMirror 6 (CM6) 的更新周期极为频繁。所有运行在主线程的 AST 遍历与 Decoration 计算必须是增量的。在 Live Preview 渲染等 hot-path 上，必须优先使用 Lezer 增量语法树解析器（即 `lezerTreeToMdast` 等适配函数），避免频繁全量重解析。
3. **Widget 性能优化与 DOM 复用**：
   - 自定义 `WidgetType` 必须重写 `eq(other)` 方法，并配合稳定唯一的 `eqKey` 以实现 DOM 节点的重复使用，避免卡顿。
4. **模块导出**：
   - 统一使用具名导出 (Named Exports)，禁止使用默认导出 (Default Exports)，以保证类型导出的可追溯性。
5. **单元测试与回归矩阵**：
   - 对核心层、插件及 Live-preview/表格/wikilinks 的改动**必须新增回归单测用例**。

---

## 4. 表格组件开发规约 (Table Widget Development Rules)
在修改 `packages/core/src/live-preview-table.ts` 时，必须逐条核对 [`CLAUDE.md`](./CLAUDE.md) 规定的 12 条硬性约束：
1. **禁止在同一个流中清除刚设置的状态**（追踪 mousedown → mousemove → mouseup 完整生命周期后再做清理）。
2. **rAF 轮询必须尊重所有交互状态**（在 rAF 中清理状态前检查 `isRangeSelecting`、`cellMouseDown`、`self.editing`）。
3. **禁止使用行内 border 样式作为拖拽指示器**（使用 `box-shadow` 或绝对定位的 overlay div，避免破坏原单元格结构边框）。
4. **单元格 `contentEditable` 默认必须关闭**（仅在 mousedown→focus 时开启，blur 时关闭，防止浏览器文本选择发生越界）。
5. **禁止使用 HTML5 原生 Drag API 作为表格调节手柄 (Grip)**（必须使用自定义的 mousedown/mousemove/mouseup 模拟拖拽以防止幽灵虚影）。
6. **列 Grip 药丸按钮必须相对表头单元格绝对定位**，禁止放在独立的 `<tr>` 行中。
7. **每次修改必须测试所有交互路径**：点击编辑、拖拽选择区域、点击列 Grip 选中整列、拖拽列重排、点击外部取消选择、在选择区按 Delete 键。
8. **跨多帧的鼠标交互必须设置 `self.editing = true` 并递增 `tableEditingCount`**，在 mouseup 时释放，防止 CM6 途中销毁 DOM。
9. **单元格 `blur` 处理器在清除 `editing` 前必须校验是否存在活动的手柄拖拽**（`if (draggingCol < 0 && draggingRow < 0)`），否则无法配合聚焦状态下的拖动。
10. **`onDragEnd` 必须在派发列/行重排 action 前释放 editing 锁**（清除视觉状态和标志位 → 设置 `self.editing = false; tableEditingCount--` → 最终派发 move）。
11. **rAF 轮询必须同时检查 `rangeActive` 状态**，防止 mouseup 后多选区域在下一帧丢失。
12. **StateField 更新在 `isTableEditing()` 期间必须跳过所有的重建 (Rebuild)**（对 `docChanged` 使用 `decos.map(tr.changes)`，对 selection-only 直接返回旧 decos）。

---

## 5. 注释规范 (Comments)
1. **全中文详细注释**：
   - 所有的头部、类、函数与关键逻辑块，必须使用**简体中文**编写完整注释。
   - 注释必须包含：时间、功能描述、版本、参数含义、返回值及注意事项。
   - **【核心红线】**：在注释的最末尾，**必须添加一段明确、简要的业务背景需求说明，说明为什么要新增或修改本段代码**。

---

## 6. 全局开发流程红线 (Workflow Constraints)
1. **先方案，后修改**：
   - AI 必须先给出具体的修改/解决方案，在用户明确同意后，才能对 codebase 的源文件进行实际的新增、修改或删除操作。禁止直接越过确认步骤进行文件改写。
2. **删除操作二次确认**：
   - 如果方案涉及文件或目录的删除，必须单独明确提示用户并等待二次确认后方可实施。
3. **拒绝自动打包与不必要的测试执行**：
   - 禁止在修改代码后自动执行打包（如 `pnpm build`）动作，除非有用户明确的指令。
   - 测试脚本（如 vitest）由用户自己在本地手动运行，AI 只需在完成修改后输出测试执行提示，不需要也禁止在环境中自行运行测试。
4. **数据库与测试环境安全**：
   - 开发与测试需要连接数据库时，必须使用专门的测试库配置（主机：`192.168.101.67:3306`），确保不污染生产环境。
   - 测试执行完毕后必须回滚/还原数据库数据。
   - 测试结果必须输出到 `md/` 下，文件格式为 Markdown，命名规则为 `[需求中文名]测试结果文档.md`，内容包含期望值与实际测试值对比。

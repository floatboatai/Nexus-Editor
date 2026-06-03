# Agent Harness PR Plan

## 背景

本次 PR 的目标不是单纯补几个单元测试，而是提交一份能体现 Agent Harness Engineer 思维的质量改进：用分层测试覆盖编辑器命令的原子行为和多步骤用户任务链路。

岗位评审重点包括自动化测试基础设施、真实场景模拟、回归检测、质量门禁和 eval-driven development。Nexus Editor 当前已有较完整的 Vitest 覆盖，但 toolbar formatting 命令和多步骤编辑任务仍适合补充一层更接近真实用户路径的测试 harness。

## PR 定位

```text
test(toolbar): add command regression and scenario harness coverage
```

建议一句话摘要：

```text
Add a layered toolbar formatting test harness that validates both individual command behavior and realistic multi-step editor scenarios.
```

## 目标

- 补齐 toolbar formatting 命令的零覆盖或弱覆盖区域。
- 用 table-driven cases 保持原子命令测试可读、可扩展、失败信号清晰。
- 增加 scenario-level harness，模拟真实用户意图下的一串编辑操作。
- 通过最终文档状态、选区状态和必要的自定义断言锁定回归。
- 保持实现轻量，不引入外部服务、不依赖真实浏览器、不把测试包装成过度抽象的 eval 平台。

## 非目标

- 不实现 LLM Agent 或真实 agent action runner。
- 不引入新的产品功能。
- 不修改 toolbar 命令语义，除非测试暴露出明确 bug。
- 不触碰 `packages/core/src/live-preview-table.ts`，避免引入高风险交互回归。
- 不新增 OpenSpec change；该 PR 属于测试覆盖和质量基础设施增强。

## 测试分层

### Layer 1: Command Regression Harness

文件建议：

```text
packages/plugin-toolbar/test/formatting-regression.test.ts
```

定位：

- 验证单个 formatting command 的输入、选区、输出。
- 使用类型化 case 描述每个命令的行为。
- 失败时能直接定位到具体命令和输入场景。

适合覆盖：

- bold / italic / strikethrough / inline code
- heading / quote / horizontal rule
- unordered list / ordered list / task list
- link insertion
- code block insertion
- empty selection 和 non-empty selection 两类行为

### Layer 2: Scenario Harness

文件建议：

```text
packages/plugin-toolbar/test/formatting-scenarios.test.ts
```

定位：

- 验证一组编辑器操作能否完成一个真实用户任务。
- 类似 agent eval 中的 task completion：不是测单个 tool call，而是测完整任务链路。
- 每个 scenario 都应该包含用户意图、初始文档、步骤列表和最终断言。

建议结构：

```ts
interface EditorScenario {
  id: string;
  description: string;
  initialDoc: string;
  steps: Array<{
    label: string;
    run: (ctx: ScenarioContext) => void;
  }>;
  expectedDoc: string;
  expectedSelection?: { anchor: number; head: number };
  assert?: (ctx: ScenarioContext) => void;
}
```

建议场景：

1. `draft-readme-section`
   - 用户意图：撰写 README 小节。
   - 操作链：插入 H2、正文、代码块、分割线。
   - 价值：验证多个 block-level 命令组合后结构稳定。

2. `layer-inline-emphasis`
   - 用户意图：格式化同一段重点文字。
   - 操作链：bold、italic、strikethrough、inline code。
   - 价值：验证 inline formatting 的嵌套和选区处理。

3. `convert-notes-to-task-list`
   - 用户意图：把普通 notes 整理成 checklist。
   - 操作链：多行选择、列表命令、任务列表命令。
   - 价值：验证多行文本转换和 Markdown 列表结构。

4. `quote-source-link`
   - 用户意图：添加引用并附来源链接。
   - 操作链：blockquote、link insertion。
   - 价值：覆盖常见写作工作流。

5. `undo-redo-composed-formatting`
   - 用户意图：多次修改后撤销/重做，文档结构仍完整。
   - 操作链：多个 formatting command、undo、redo。
   - 价值：验证命令组合与 history 插件协同。

## 实现原则

- 测试命名要表达用户意图，而不只是函数名。
- 每个 scenario 的 step label 要能说明失败发生在哪一步。
- 保持 helper 小而直，不做过早抽象。
- 优先复用已有 `createEditor`、toolbar command 和 Vitest 工具。
- 断言最终 Markdown 文档，不断言无关 DOM 细节。
- 对 selection 的断言只覆盖确实属于用户体验契约的场景。
- 如果发现 bug，先写能失败的 case，再做最小修复。

## 验收标准

- `pnpm --filter @floatboat/nexus-plugin-toolbar test` 通过，或等价的相关 Vitest 命令通过。
- `pnpm test` 全仓库通过。
- `pnpm typecheck` 通过。
- `pnpm build` 通过。
- 新增测试具备清晰 failure signal：失败信息能定位 scenario id、step label 或 command case。
- PR 描述明确说明两层测试的关系：command-level regression + scenario-level task harness。

## PR 描述要点

可在 PR 中强调：

- This PR adds layered coverage for toolbar formatting behavior.
- The command regression harness closes gaps for individually exported formatting helpers.
- The scenario harness models realistic multi-step editor tasks and validates final Markdown state.
- The approach is deterministic, table-driven, and cheap enough for regular CI.
- This gives the project a foundation for expanding editor task completion coverage over time.

## Review Checklist

- 是否只是测试增强，没有混入无关重构。
- 是否每个测试 case 都验证行为而不是 incidental implementation detail。
- 是否避免和上游已有 PR 撞功能范围。
- 是否保持代码风格和现有 Vitest 文件一致。
- 是否没有触碰 table live-preview 高风险路径。
- 是否在 PR 中列出实际运行过的验证命令。


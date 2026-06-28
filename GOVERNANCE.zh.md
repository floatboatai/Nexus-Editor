# 治理规则

本文说明 Nexus-Editor 项目如何治理，以及我们接受哪些贡献。

如果你只是想提交一个小修复，读到第 6 节即可。后续内容用于确保项目在成长过程中方向稳定。

[English](./GOVERNANCE.md)

---

## 1. 项目归属

- **Nexus-Editor** 是 [`floatboatai`](https://github.com/floatboatai) GitHub 组织下的开源项目。
- 项目采用 MIT 许可。所有被接受的贡献都按 MIT 许可授权（见 §6.1）。
- *"Nexus-Editor"*、*"floatboat"* 及其相关 Logo 由项目所有者保留权利。MIT 许可授予的是代码权利，**不包括**商标权。未经事先书面许可，请勿将这些名称用于 fork、衍生项目或商业产品。

## 2. 维护者

维护者是对此仓库拥有 **Maintain** 或更高权限的人。他们的职责包括：

- 分类和审查 pull request
- 决定哪些内容进入 `docs/ROADMAP.md`
- 审批并归档 OpenSpec 提案（见 `.claude/skills/openspec-*`、`.codex/skills/openspec-*` 工作流和 [`openspec/config.yaml`](./openspec/config.yaml)）
- 通过 `pnpm publish:packages` 发布版本

当前维护者列表以本仓库 GitHub 权限中拥有 **Maintain** 或更高权限的人为准。如需提议新增或移除维护者，请创建带 `governance` 标签的 issue。

## 3. 决策机制

- **Bug 修复、内部重构、文档、测试** —— 任一维护者可在一次 review 后合并。
- **公共 API 新增、新插件、破坏性变更、安全敏感工作** —— 必须先提交 OpenSpec 提案（见 [`CONTRIBUTING.zh.md`](./CONTRIBUTING.zh.md) §3.1），且实现开始前必须获得维护者批准。
- **Roadmap 优先级** —— 在迭代启动时由维护者设定。功能 PR 中顺手修改优先级不会被接受。

## 4. 范围政策

**Nexus 是一个 headless、AST-driven 的 Markdown 编辑器引擎。** 这是 [`README.zh.md`](./README.zh.md) 中最关键的一句话，也决定了我们接受什么。

### 范围内

- `packages/core` —— CodeMirror 6 状态、AST 管线、实时预览、Widget API、事件
- `packages/preset-gfm` —— 符合 GFM 的 Markdown 功能（表格、任务列表、删除线）
- `packages/plugin-*` —— 编辑器级功能（history、search、slash menu、toolbar、math、vim）
- `packages/react` / `packages/vue` —— 围绕 `packages/core` 的轻量框架绑定
- `apps/electron-demo` —— 仅用于展示引擎能力

### **不在**范围内（即使技术实现很好也会被拒绝）

1. **任何形式的 AI / LLM 集成** —— 不论是在 `packages/` 还是 `apps/electron-demo`。包括文本生成、AI 改写、云端 LLM 自动补全、agent 面板、内嵌 AI 工具。这些应由依赖 Nexus 的宿主应用负责。
2. **特定厂商的内置 SDK** —— OpenAI、Anthropic、火山/豆包、OpenRouter、云存储 SDK 等。`core` 中可以接受适配器和可插拔接口，但不能绑定具体厂商。
3. **通用 UI 组件库** —— toast、dialog、modal 等不应放在本仓库。Nexus 是 headless 的，UI 应属于宿主应用或专门的第三方包。
4. **非编辑器原语的产品功能** —— 例如 notebook 管理、云同步 UI、账号系统、应用内购买流程。
5. **超出 AST 能力之外的 schema 校验 / 内容 lint**。宿主可以基于 `editor.getAst()` 自行实现。

如果你需要上述能力，请在你的宿主应用中以 Nexus 作为依赖来构建。

### Demo 不是产品

`apps/electron-demo` 的存在是为了让人们能看到并试用引擎。它**不是**参考桌面产品。向 demo 添加产品级界面（文件管理 UI、AI 侧栏、agent 面板、设置系统）的 PR 不在范围内。

## 5. 模块归属

| 区域 | 外部 PR |
|---|---|
| `packages/core` | 欢迎 bug 修复；新增公共 API 需要 OpenSpec + 维护者批准 |
| `packages/preset-gfm` | 欢迎 bug 修复；新增功能需要 OpenSpec |
| `packages/plugin-*` | 新插件必须匹配 `docs/ROADMAP.md` 条目；否则请先创建 issue |
| `packages/react` / `packages/vue` | 绑定层保持同步；单个 PR 必须同时更新两者 |
| `apps/electron-demo` | 欢迎 bug 修复；新功能仅限用于展示引擎能力 |
| `openspec/` | 欢迎通过 OpenSpec 工作流提交提案 |
| 发布脚本、CI workflow | 由维护者主导；外部改动需要安全 review |

## 6. 贡献政策

### 6.1 贡献者许可协议（CLA）

本项目使用 [CLA Assistant](https://cla-assistant.io/floatboatai/Nexus-Editor) 管理贡献者许可协议。你第一次打开 pull request 时，CLA bot 会要求你通过 GitHub 账号签署一次。该签署覆盖你未来对本项目的所有贡献；之后不会重复要求。

签署 CLA 后，你授予 `floatboat`：

- 永久、全球、不可撤销的版权许可，其中包括**再许可和分发**你的贡献的权利（CLA §2）。这让项目未来有空间演进分发模式（例如双许可、向商业产品再许可），而不需要重新征询每个贡献者。
- 覆盖你的贡献必然涉及的权利要求的专利许可（CLA §3）。
- 对以下事项的声明：该贡献是**你的原创作品**，你有权授予相关权利，并且其中不包含未经许可的第三方版权材料（CLA §4）。

你保留自己作品的版权。

未签署 CLA 的 pull request 不会被合并。

### 6.2 AI 生成代码

**功能代码主要由 AI 工具生成的 pull request 不会被接受。**

- ✅ 可以接受：自动补全建议、你逐行审查过的 AI 辅助重构建议、为你自己写的代码生成测试、AI 编写的注释或文档。
- ❌ 不可接受："实现功能 X" → 整段粘贴进 PR，且贡献者无法解释或捍卫其中的设计决策。

你**必须**在 PR 描述中披露 AI 辅助使用情况（模板中有对应复选框）。

**为什么即使有 CLA，这仍然重要：正是 CLA 让它成为问题。**

- CLA §4(b) 要求每项贡献都是**你的原创作品**。美国版权局已认定纯 AI 生成内容不受版权保护；将这类代码作为你自己的贡献提交，会构成对 §4(b) 的不实声明。
- CLA §4(c) 要求你的贡献**不包含未经许可的第三方版权材料**。大模型输出可能包含 GPL/AGPL 训练数据的原文片段，而贡献者既没有权利，也未必意识到需要将这些材料授权给我们。
- CLA §6 要求你在发现上述声明不准确时通知我们。

一个受污染的 PR 可能迫使我们重写受影响文件并通知下游用户。除法律问题外，还有维护问题：难以解释的代码也难以维护。如果贡献者在 review 中无法解释它，我们也无法长期维护它。

### 6.3 新运行时依赖

新增运行时依赖（位于 `dependencies`，不包括 `devDependencies`）需要满足：

- 许可证与 MIT 兼容。明确拒绝：GPL、AGPL、SSPL、BUSL、CC-BY-NC。ISC/BSD/Apache-2.0/MIT 可以接受。
- 在 PR 描述中列出：包名、版本、许可证、为什么需要它，以及如果自行实现会失去什么。
- 合并前获得维护者批准。

构建时和测试时依赖（`devDependencies`）门槛较低，但仍必须与 MIT 兼容。

### 6.4 构建产物和敏感信息

以下内容**绝不能**提交，并会阻塞 PR：

- 构建输出：`dist/`、`dist-electron/`、`release/`、由 `.ts` 源码编译出的 `.js`
- 环境文件：`.env`、`.env.local`、任何非 `.env.example` 的文件
- 任何形式的凭据，即使是占位或测试凭据
- 个人 vault 数据、包含私人文档的屏幕录制、公司内部信息

仓库的 `.gitignore` 已覆盖大多数此类内容。如果某个匹配 `.gitignore` 规则的文件出现在你的 diff 中，说明你强行添加了它，应当撤回。

## 7. 安全

安全问题请私密报告，不要提交公开 issue。可以给维护者发邮件，或使用 GitHub Security 页面中的 *"Report a vulnerability"* 入口。公开披露应等到修复发布之后。

将来可能会添加单独的 `SECURITY.md`；在此之前，本节具有权威性。

## 8. 行为准则

我们遵循 [Contributor Covenant](https://www.contributor-covenant.org/version/2/1/code_of_conduct/) 的精神。简而言之：保持友善、假设善意、批评观点而不是人，并尊重维护者时间有限这一事实。

维护者保留关闭 PR 和 issue、以及屏蔽重复违规者的权利，且无需进一步讨论。

## 9. 修改本文档

对本文档的实质性修改（范围政策、DCO、AI 政策、许可条款）需要：

- 创建带 `governance` 标签的 issue，并至少开放 7 天
- 获得多数活跃维护者批准
- 创建链接该 issue 的 PR

编辑性修正（错别字、链接更新、不改变含义的澄清）可由任一维护者合并。

# 项目治理

本文档说明 Nexus-Editor 项目的治理方式以及我们接受的贡献类型。

如果你只想提交一个小修复，读到 §6 即可。其余内容用于在项目成长过程中保持方向稳定。

[English](./GOVERNANCE.md)

---

## 1. 项目所有权

- **Nexus-Editor** 是 [`floatboatai`](https://github.com/floatboatai) GitHub 组织下的开源项目。
- 项目采用 [MIT](./LICENSE) 许可证。所有被接受的贡献均以 MIT 许可证授权（见 §6.1）。
- “Nexus-Editor”、“floatboat”名称及其相关标识均为项目所有者保留内容。MIT 许可证授予的是代码权利，**不包括**商标权利。未经事先书面许可，请勿将这些名称用于 fork、衍生项目或商业产品。

## 2. 维护者

维护者是拥有本仓库写权限的人员，职责包括：

- 分类处理并审查 Pull Request
- 决定哪些内容进入 `docs/ROADMAP.md`
- 批准并归档 OpenSpec 提案（见 [`openspec/AGENTS.md`](./openspec/AGENTS.md)）
- 通过 `pnpm publish:packages` 和 tag 发布版本

当前维护者列表由在本仓库 GitHub 权限中拥有 **Maintain** 或更高权限的人员组成。如需建议添加或移除维护者，请创建带有 `governance` 标签的 issue。

## 3. 决策机制

- **Bug 修复、内部重构、文档和测试**：经一名维护者审查后即可合并。
- **公共 API 新增、新插件、破坏性变更和安全敏感工作**：必须先提交 OpenSpec 提案（见 [`CONTRIBUTING.zh.md`](./CONTRIBUTING.zh.md) §3.1），并在开始实现前获得维护者批准。
- **Roadmap 优先级**：由维护者在每次迭代启动时确定。功能 PR 中顺手修改优先级的做法不会被接受。

## 4. 项目范围政策

**Nexus 是一个无头、AST 驱动的 Markdown 编辑器引擎。** 这是 [`README.zh.md`](./README.zh.md) 中决定项目边界的核心定位，也是我们接受贡献的依据。

### 项目范围内

- `packages/core`：CodeMirror 6 状态、AST 管线、实时预览、Widget API 和事件
- `packages/preset-gfm`：符合 GFM 标准的 Markdown 功能（表格、任务列表、删除线）
- `packages/plugin-*`：编辑器层功能（历史记录、搜索、斜杠菜单、工具栏、数学公式、Vim）
- `packages/react` / `packages/vue`：围绕 `packages/core` 的轻量框架绑定
- `apps/electron-demo`：仅用于演示引擎能力

### 不在项目范围内

以下内容**不在项目范围内**，即使技术实现完善也会被拒绝：

1. 任何形式的 **AI / LLM 集成**，无论位于 `packages/` 还是 `apps/electron-demo`。包括文本生成、AI 改写、基于云端 LLM 的自动补全、Agent 面板和内嵌 AI 工具。这些功能应由依赖 Nexus 的宿主应用负责。
2. **特定厂商的内置 SDK**，例如 OpenAI、Anthropic、火山引擎 / 豆包、OpenRouter 或云存储 SDK。`core` 中的适配器和可插拔接口可以接受，但不接受内置具体厂商实现。
3. 本仓库中的**通用 UI 组件库**（如 toast、dialog、modal 等）。Nexus 是无头引擎；UI 应由宿主应用或专用的第三方包提供。
4. 不属于编辑器基础能力的**产品功能**，例如笔记本管理、云同步 UI、账户系统和应用内购流程。
5. 超出 AST 已暴露能力的**模式校验 / 内容 lint**。宿主可以基于 `editor.getAst()` 自行实现。

如果你需要上述任一功能，请在宿主应用中将 Nexus 作为依赖进行构建。

### Demo 不是产品

`apps/electron-demo` 的作用是让人们查看和体验引擎能力，它**不是**参考桌面产品。我们不接受在 demo 中添加产品层功能的 PR，包括文件管理 UI、AI 侧边栏、Agent 面板和设置系统等。

## 5. 模块归属

| 领域 | 外部 PR |
|---|---|
| `packages/core` | 欢迎 Bug 修复；新增公共 API 需要 OpenSpec 提案和维护者批准 |
| `packages/preset-gfm` | 欢迎 Bug 修复；新功能需要 OpenSpec |
| `packages/plugin-*` | 新插件必须与 `docs/ROADMAP.md` 中的条目匹配，否则请先创建 issue |
| `packages/react` / `packages/vue` | 两端绑定必须保持同步，同一个 PR 中必须同时更新 |
| `apps/electron-demo` | 欢迎 Bug 修复；仅当新功能用于演示引擎能力时才可接受 |
| `openspec/` | 欢迎通过 OpenSpec 流程提交提案 |
| 发布脚本、CI 工作流 | 由维护者主导；外部变更需要安全审查 |

## 6. 贡献政策

### 6.1 贡献者许可协议（CLA）

本项目使用 [CLA Assistant](https://cla-assistant.io/floatboatai/Nexus-Editor) 管理贡献者许可协议。首次创建 Pull Request 时，CLA 机器人会要求你通过 GitHub 账户签署一次。该签署适用于你今后对本项目的所有贡献，无需重复签署。

签署 CLA 后，你将向 `floatboatai` 授予：

- 永久、全球范围、不可撤销的著作权许可，包括**再许可和分发**你的贡献的权利（CLA §2）。这为项目未来调整分发模式（例如双重许可或再许可给商业产品）留出空间，而无需重新征得每位贡献者同意。
- 覆盖你的贡献必然依赖的专利权利要求的专利许可（CLA §3）。
- 你声明该贡献是**你的原创作品**，你拥有授予相应权利的权限，且贡献中未经许可不包含第三方受版权保护的材料（CLA §4）。

你仍然保留自己贡献内容的著作权。

未签署 CLA 的 Pull Request 不会被合并。

### 6.2 AI 生成代码

**本项目不接受功能代码主要由 AI 工具生成的 Pull Request。**

- ✅ 可接受：自动补全建议、你逐行审查过的 AI 辅助重构建议、针对你自己所写代码的 AI 生成测试、AI 编写的注释或文档。
- ❌ 不可接受：将“实现功能 X”交给 AI，然后把生成结果整段粘贴进 PR，而贡献者无法解释或为设计决策辩护。

你**必须**在 PR 描述中披露 AI 辅助情况（PR 模板已提供对应复选框）。

**为什么已经有 CLA 仍然需要重视这一问题？原因恰恰在于 CLA 本身：**

- CLA §4(b) 要求每项贡献都是**贡献者的原创作品**。美国版权局已裁定，纯 AI 生成内容不受著作权保护；将这类代码作为自己的贡献提交，会造成对 §4(b) 的不实陈述。
- CLA §4(c) 要求你的贡献**不得未经许可包含第三方受版权保护的材料**。大模型输出可能包含来自 GPL / AGPL 训练数据的逐字片段，贡献者既无权授许这些材料，也可能对此毫不知情。
- 如果这些陈述后来被发现不准确，CLA §6 要求你通知项目方。

一个被污染的 PR 就可能迫使我们重写受影响的文件，并通知下游用户。法律风险之外，无法辩护的代码也难以维护：如果贡献者在审查时无法解释它，维护者同样无法。

### 6.3 新增运行时依赖

新增运行时依赖（即任何加入 `dependencies` 而非 `devDependencies` 的依赖）需要满足：

- 许可证必须与 MIT 兼容。明确拒绝：GPL、AGPL、SSPL、BUSL、CC-BY-NC；可接受：ISC、BSD、Apache-2.0、MIT。
- PR 描述中必须列出：包名、版本、许可证、引入原因，以及改为自行实现时会损失什么。
- 合并前必须获得维护者批准。

构建时和测试时依赖（`devDependencies`）的要求较宽松，但仍必须与 MIT 兼容。

### 6.4 构建产物和敏感信息

以下内容**绝对不得**提交，否则 PR 会被阻止：

- 构建输出：`dist/`、`dist-electron/`、`release/`、由 `.ts` 源码编译而来的 `.js`
- 环境文件：`.env`、`.env.local`、任何非 `.env.example` 的环境文件
- 任何形式的凭据，即使是占位符或测试凭据
- 个人 vault 数据、包含私密文档的屏幕录像、公司内部信息

仓库的 `.gitignore` 已覆盖上述大部分内容。如果 diff 中出现与 `.gitignore` 规则匹配的文件，说明你强制添加了它，应将其移除。

## 7. 安全

安全问题应私下报告，而不是创建公开 issue。请向维护者发送邮件，或使用 GitHub Security 页面的 *"Report a vulnerability"* 入口。在修复版本发布前，不应公开披露。

项目后续可能会添加独立的 `SECURITY.md`；在此之前，本节是权威规范。

## 8. 行为准则

我们遵循 [贡献者公约](https://www.contributor-covenant.org/version/2/1/code_of_conduct/) 的精神。简而言之：保持友善，假定善意，批评观点而非针对个人，并尊重维护者有限的时间。

维护者保留终止 issue 和 PR 讨论，以及在不另行说明的情况下屏蔽屡次违规者的权利。

## 9. 修改本文档

对本文档的实质性修改（项目范围政策、DCO、AI 政策、许可条款）需要：

- 创建一个带有 `governance` 标签且至少开放 7 天的 issue
- 获得过半数活跃维护者批准
- 提交关联该 issue 的 PR

编辑性修正（错别字、链接更新、不改变含义的说明澄清）可由任一维护者合并。

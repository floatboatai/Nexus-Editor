# LLM Wiki 本次修改说明

更新时间：2026-06-23

## 背景

本次修改围绕 Electron demo 中的 LLM Wiki 能力展开，目标是参考“编译式 RAG：LLM Wiki 原理详解.ipynb”的编译式工作流，把人工文档从 `raw/` 编译为可链接、可检索、可问答的 `wiki/` Markdown 知识层。


- LLM Wiki 逻辑限制在 `apps/electron-demo/` 内。
- Python sidecar 负责 `ensure`、`ingest`、`ingest-file`、`lint`、`query`。
- Electron main 负责项目路径、IPC、Python 进程、队列、状态持久化和状态事件。
- Renderer 只负责保存流程、设置 UI、队列 UI、Ask Wiki UI 和状态展示。
- 不把 LLM、网络、Python、`.env` 或 provider 逻辑放入 `@floatboat/nexus-core`。
- 真实配置只写入 `apps/electron-demo/llm-wiki/.env`，不提交真实 key。

## 依赖说明

本次功能没有给 `@floatboat/nexus-core` 增加 LLM、Python 或网络相关依赖，LLM Wiki 依赖被限制在 Electron demo 内。

- 前端与 Electron 侧继续使用现有 pnpm workspace 依赖，测试命令通过 `pnpm --filter @floatboat/nexus-electron-demo test` 运行。
- Python sidecar 位于 `apps/electron-demo/llm-wiki/`，fixture provider 只依赖 Python 标准库；`requirements.txt` 当前不要求 CI 安装额外第三方包。
- 默认 provider 为 `fixture`，因此测试、构建和 CI 不需要 Claude/DeepSeek 登录、API key、网络请求或非确定性模型输出。
- DeepSeek 仅作为可选真实 provider，通过 `apps/electron-demo/llm-wiki/.env` 配置；仓库只提交 `.env.example`。
- Electron 打包时只把 sidecar 必需文件作为 `extraResources` 带入：`llm_wiki.py`、`schema.md`、`requirements.txt`、`README.md` 和 `.env.example`。

## 已实现能力

### 1. LLM Wiki 项目结构

项目根目录使用当前打开的 vault；没有打开 vault 时，使用 Electron `Documents/Nexus LLM Wiki/` 默认项目。

项目结构为：

- `raw/`：用户保存或导入的原始 Markdown。
- `wiki/`：DeepSeek 或 fixture 编译生成的 Wiki 页面。
- `.nexus/llm-wiki-schema.md`：项目内的人类规则层，替代 notebook 中类似 `CLAUDE.md` 的角色，避免和仓库级 agent 指令冲突。
- `.nexus/llm-wiki-state.json`：每个 raw 文档的解析状态和项目 lint issue。

### 2. DeepSeek provider 与配置 UI

Settings 中新增 LLM Wiki 配置区域：

- provider：`fixture` 或 `deepseek`。
- DeepSeek model。
- DeepSeek base URL。
- DeepSeek API key。
- submit mode：`manual` 或 `auto`。
- 打开 schema 的入口。

配置由 Electron main 通过 IPC 写入 sidecar 目录下的 `apps/electron-demo/llm-wiki/.env`。Renderer 不读取 `.env`，也不会接收明文 key。

默认 provider 仍可使用 `fixture`，保证测试和 CI 不依赖真实模型、网络或 API key。

### 3. Schema 抽取与结构化输出

DeepSeek 编译流程读取 `.nexus/llm-wiki-schema.md`，要求模型返回 ChatGPT-compatible structured JSON。返回结构必须包含：

- `schema_contract`
- `pages`
- `events`

`schema_contract` 需要覆盖页面命名、frontmatter、wikilink、特殊文件、操作边界和事件 schema。

事件模型要求包含事件及事件要素：

- `slug`
- `title`
- `time`
- `actors`
- `location`
- `action`
- `object`
- `outcome`
- `sources`
- `confidence`

在写入 `wiki/` 前，Python sidecar 会校验 schema contract、事件要素、页面 slug、frontmatter、sources、wikilink 和写入边界。

### 4. raw 到 wiki 的编译式流程

保存普通文档或 `raw/` 内文档时，会把内容写入 `raw/<safe-name>.md`，并根据 submit mode 更新 LLM Wiki 文档状态。

保存 `wiki/` 内文档不会反向写入 `raw/`，也不会触发 ingest，只刷新普通编辑器和链接状态。

DeepSeek 的文档级入口为 `ingest-file`，用于只提交某个 raw 文档：

```bash
python apps/electron-demo/llm-wiki/llm_wiki.py ingest-file --project ./tmp/wiki-project --raw raw/source.md --provider deepseek
```

编译结果写入 `wiki/`，并更新 `wiki/index.md` 与 `wiki/log.md`。

### 5. 文档状态与队列 UI

新增 LLM Wiki Queue 面板，展示 raw 文档状态和操作入口。

状态语义：

- `dirty`：raw 文档有新内容，尚未提交 DeepSeek。
- `queued`：已进入提交队列，等待 worker。
- `submitting`：DeepSeek 调用中，未返回前保持该状态。
- `parsed`：DeepSeek 返回并写入 wiki 成功。
- `failed`：provider、结构化输出、路径校验或写入流程失败。

用户操作：

- Submit current
- Submit all dirty
- Retry failed
- Open schema

并发限制：

- 文档级 DeepSeek 提交最多 4 个 `submitting`。
- 保存成功不等待 DeepSeek 返回。
- DeepSeek 未返回前，状态保持 `submitting`，队列面板和状态栏都能看到。

状态重置：

- raw 文档内容更新后，如果 content hash 变化，会重置 `submittedAt`、`completedAt`、`generated`、`events` 和 `error`。
- 因此已解析文档再次修改后会回到 `dirty`，避免旧的 parsed 元数据误导用户。

### 6. project issues 与解析失败解耦

修复了一个状态一致性问题：此前 sidecar 在 `ingest-file` 后执行项目级 lint，如果项目中已有无关 lint issue，Electron 会把当前文档标记为 `failed`。

现在逻辑调整为：

- DeepSeek 已成功返回并写入当前文档对应 pages/events 时，当前文档可以进入 `parsed`。
- 项目级 lint issue 单独存入 `projectIssues`。
- Queue 面板摘要显示 `Issues: N`，并展示前几个项目 issue。

这样可以区分“当前文档 DeepSeek 解析失败”和“项目里还有一致性问题”。

### 7. Ask Wiki 项目问答

新增 Ask Wiki 入口，用于针对当前编译后的 LLM Wiki 项目问答。

问答边界：

- 读取 `.nexus/llm-wiki-schema.md` 和 `wiki/`。
- 不读取 `raw/`。
- 不使用 embedding、向量召回或词法 fallback。
- 不持久化多会话聊天记忆。
- 要求 provider 使用 DeepSeek 时返回结构化 JSON answer。


## 主要修改文件

- `apps/electron-demo/electron/llm-wiki.ts`
- `apps/electron-demo/electron/main.ts`
- `apps/electron-demo/electron/preload.ts`
- `apps/electron-demo/src/renderer/app.ts`
- `apps/electron-demo/src/renderer/settings.ts`
- `apps/electron-demo/src/renderer/llm-wiki-queue-panel.ts`
- `apps/electron-demo/src/renderer/ask-wiki-panel.ts`
- `apps/electron-demo/src/renderer/style.css`
- `apps/electron-demo/src/renderer/bridge.d.ts`
- `apps/electron-demo/llm-wiki/llm_wiki.py`
- `apps/electron-demo/llm-wiki/schema.md`
- `apps/electron-demo/llm-wiki/README.md`
- `apps/electron-demo/llm-wiki/.env.example`
- `apps/electron-demo/test/llm-wiki.test.ts`
- `apps/electron-demo/test/app-handlers.test.ts`
- `apps/electron-demo/llm-wiki/test_llm_wiki.py`

## 验证结果

已执行并通过：

```bash
pnpm --filter @floatboat/nexus-electron-demo test
python -m unittest apps\electron-demo\llm-wiki\test_llm_wiki.py
pnpm --filter @floatboat/nexus-electron-demo build
```

验证结论：

- TypeScript/Vitest 覆盖 Electron LLM Wiki helpers、状态 store、队列、IPC bridge 和相关 renderer 行为。
- Python unittest 覆盖 ensure、schema、fixture/deepseek 结构、path guard、lint、query 和异常场景。
- Electron demo build 成功；存在已有 chunk size warning，不影响本次功能。

## 本地状态备注

本次说明不包含任何真实 API key。真实 DeepSeek 配置保留在本机 `apps/electron-demo/llm-wiki/.env`。

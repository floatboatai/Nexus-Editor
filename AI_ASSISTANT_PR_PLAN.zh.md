# Nexus-Editor AI Assistant PR 方案

## 目标

为 Nexus-Editor 增加一个 AI Assistant 侧边栏，让用户可以手动配置 OpenAI 兼容 API，并通过对话让 AI 使用受控工具读取、搜索、选择和修改当前 Markdown 文档。

这个 PR 的重点不是“简单接一个聊天接口”，而是提供一套可扩展的 AI 编辑框架：

- 用户在 UI 中手动输入 API Key、Base URL、Model。
- 只支持 OpenAI-compatible API，不绑定项目内置密钥。
- AI 不能直接任意修改编辑器，而是通过插件暴露的工具操作文档。
- 读操作可自动执行，写操作先生成 preview，由用户确认 Apply 后再落到文档。
- 插件可复用在 Electron demo 之外的宿主应用中。

## 为什么做这个

Nexus-Editor 已经具备 Markdown 编辑、插件、slash command、word count、wikilink、Mermaid 等能力。AI 辅助编辑是当前 Markdown/PKM 编辑器的重要方向，但直接把 AI 请求写进业务代码会带来供应商绑定和安全问题。

这个方案通过“OpenAI 兼容 provider + 编辑器工具层 + 侧边栏 UI”的方式，在功能价值和开源可维护性之间取得平衡。

## PR 标题建议

```text
feat(plugin-ai-assistant): add OpenAI-compatible assistant sidebar with editor tools
```

## 功能范围

### 1. 新增插件包

新增包：

```text
packages/plugin-ai-assistant
```

导出：

```ts
createAIAssistantPlugin(options)
createAIAssistantPanel(options)
executeAIToolCall(editor, toolCall)
```

### 2. OpenAI 兼容配置

侧边栏提供配置输入：

- API Key
- Base URL，默认 `https://api.openai.com/v1`
- Model，由用户手动输入
- System prompt，可选

API Key 不写死、不提交、不默认持久化。第一版可以只保存在内存中，关闭页面后失效。

### 3. AI 工具

第一版支持这些工具：

```ts
type AIToolCall =
  | { tool: "readDocument" }
  | { tool: "readSelection" }
  | { tool: "searchText"; query: string; caseSensitive?: boolean }
  | { tool: "replaceRange"; from: number; to: number; text: string }
  | { tool: "insertAt"; pos: number; text: string }
  | { tool: "replaceSelection"; text: string }
  | { tool: "setSelection"; anchor: number; head?: number }
  | { tool: "getTableOfContents" };
```

工具行为：

- `readDocument`：读取全文。
- `readSelection`：读取当前选区。
- `searchText`：返回匹配位置和片段。
- `replaceRange`：替换指定范围。
- `insertAt`：在指定位置插入文本。
- `replaceSelection`：替换当前选区。
- `setSelection`：移动或设置选区。
- `getTableOfContents`：读取标题结构。

### 4. 写操作确认机制

为了安全，写操作不直接执行：

1. AI 返回写操作。
2. 侧边栏展示变更预览。
3. 用户点击 `Apply`。
4. 插件调用 `editor.replaceRange` / `editor.replaceSelection` 等 API。

读操作可以自动执行并把结果回传给模型。

### 5. 侧边栏 UI

侧边栏包含：

- API 配置区
- 消息列表
- 用户输入框
- 发送按钮
- Loading 状态
- Error 状态
- Tool call 执行记录
- Pending changes 区域
- Apply / Discard 按钮

UI 不做复杂聊天产品，只做编辑器内可用的 AI 助手。

### 6. Electron Demo 集成

在 `apps/electron-demo` 中增加 AI 入口：

- 工具栏按钮：`AI`
- 点击后打开/关闭右侧 AI Assistant 面板
- 面板绑定当前 editor 实例

Demo 中不预置 API Key，用户自己输入。

## OpenAI API 交互设计

使用 OpenAI 兼容的 Chat Completions 风格接口：

```http
POST {baseUrl}/chat/completions
Authorization: Bearer {apiKey}
Content-Type: application/json
```

请求中包含：

- `model`
- `messages`
- `tools`
- `tool_choice: "auto"`

说明：

- OpenAI 官方现在更推荐新项目使用 Responses API。
- 但这个 PR 的目标是支持“OpenAI-compatible API”，多数兼容服务优先兼容 `/chat/completions`。
- 因此第一版选择 Chat Completions + function tools。
- 第一版采用非流式响应，降低实现复杂度。
- 后续可以扩展 Responses API 或 streaming，但不放入本 PR。

## Agent 多轮工具调用设计

AI Assistant 不是单次请求后直接结束，而是一个 bounded agent loop。流程如下：

1. 用户在侧边栏输入请求。
2. 插件将用户消息、上下文摘要和工具定义发送给 OpenAI-compatible provider。
3. 如果模型返回普通文本，直接显示 assistant message，循环结束。
4. 如果模型返回 `tool_calls`，插件解析工具名和 JSON 参数。
5. 插件执行只读工具，并把工具结果追加到 messages。
6. 如果模型请求写工具，插件生成 pending operation 和 preview，不立即修改文档。
7. 只读工具执行完成后，插件再次调用模型，让模型基于工具结果继续推理。
8. 循环最多执行 `maxToolRounds` 轮，默认 6 轮，避免无限调用。
9. 如果存在 pending write operation，循环暂停，等待用户 Apply 或 Discard。

### Agent Loop 伪代码

```ts
async function runAssistantTurn(input: string): Promise<void> {
  messages.push({ role: "user", content: input });

  for (let round = 0; round < maxToolRounds; round++) {
    const response = await provider.complete({
      config,
      messages,
      tools: AI_TOOL_DEFINITIONS
    });

    messages.push(response.assistantMessage);

    const toolCalls = parseToolCalls(response.assistantMessage);
    if (toolCalls.length === 0) {
      appendAssistantMessage(response.text);
      return;
    }

    const results: AIToolResult[] = [];
    for (const call of toolCalls) {
      const result = executeAIToolCall(editor, call);
      results.push(result);

      if (result.kind === "pending-operation") {
        pendingOperations.push(result.operation);
      }
    }

    appendToolMessages(messages, results);

    if (pendingOperations.length > 0) {
      renderPendingOperations(pendingOperations);
      appendAssistantMessage(response.text || "I prepared changes for review.");
      return;
    }
  }

  appendError("The assistant reached the tool-call limit. Try a narrower request.");
}
```

### 停止条件

循环在这些情况下停止：

- 模型返回普通 assistant content，且没有 `tool_calls`。
- 模型返回写操作，插件生成 pending changes，等待用户确认。
- 达到 `maxToolRounds`。
- provider 报错。
- 工具参数非法。
- 用户点击 Stop。

### 为什么写操作暂停循环

写操作会改变文档状态。如果 AI 连续发起多个写工具并自动执行，用户很难确认每一步。因此第一版规则是：

- 读工具自动执行。
- 写工具只生成 pending operation。
- pending operation 出现后 agent loop 暂停。
- 用户 Apply 后再真正修改 editor。
- 用户 Discard 后丢弃操作。

这样既保留 agent 能力，又符合编辑器安全边界。

## 提示词设计

### Developer/System Prompt

第一版使用 developer message，如果目标兼容服务不支持 developer role，则降级为 system message。

推荐提示词：

```text
You are Nexus AI Assistant, an editing agent embedded in a Markdown editor.

You help the user inspect and edit the current Markdown document.
You can use editor tools to read the document, inspect the selection, search text,
move the selection, and propose document edits.

Rules:
- Prefer tool calls over guessing when the request depends on the current document.
- Use readDocument before making broad document-level changes.
- Use readSelection when the user asks to rewrite, summarize, translate, or edit "this" and a selection may exist.
- Use searchText before replacing a phrase if the exact location is not known.
- Never invent character offsets. Use searchText or readDocument first.
- Keep edits minimal and targeted.
- For write tools, propose the smallest necessary change.
- Do not claim a write has been applied until the tool result says it was applied.
- If a write tool result says pending_approval, tell the user to review and apply it.
- If tool results report an error, explain the error and ask for clarification.
- Preserve Markdown structure unless the user asks to change it.
- Do not request or reveal API keys.
```

### User Context Message

每次用户发送消息时，插件可以附带轻量上下文，但不要默认塞全文，避免长文档消耗 token。

推荐上下文：

```text
Editor context:
- Document length: {characters} characters
- Selection: {selectionSummary}
- Headings: {topLevelHeadings}

If you need exact content, call readDocument or readSelection.
```

### 何时读取全文

不要每次请求都把全文塞给模型。让模型按需调用工具：

- 用户说“总结全文”“重构这篇文章”“检查错别字”时，模型应调用 `readDocument`。
- 用户说“改写选中的内容”“翻译这段”时，模型应调用 `readSelection`。
- 用户说“把所有 foo 改成 bar”时，模型应先调用 `searchText`，再提出 replace 操作。

## AI 返回什么才算调用工具

第一版采用 Chat Completions function tools。模型返回的 assistant message 中只要出现 `tool_calls`，就认为它请求调用工具。

典型返回结构：

```json
{
  "role": "assistant",
  "content": null,
  "tool_calls": [
    {
      "id": "call_123",
      "type": "function",
      "function": {
        "name": "searchText",
        "arguments": "{\"query\":\"TODO\",\"caseSensitive\":false}"
      }
    }
  ]
}
```

识别规则：

- 读取 `choices[0].message.tool_calls`。
- 只接受 `type === "function"`。
- `function.name` 必须是白名单工具名。
- `function.arguments` 必须能 `JSON.parse`。
- JSON 参数必须通过本地校验。
- 如果没有 `tool_calls`，则按普通 assistant message 处理。

不要从普通文本中解析类似 `CALL_TOOL(...)` 的伪协议。只认 OpenAI tool calling 字段。

## 工具定义 Schema

发送给 OpenAI-compatible API 的 `tools` 使用 function tool 结构。

示例：

```ts
const AI_TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "readDocument",
      description: "Read the entire current Markdown document.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "searchText",
      description: "Search the current document for text and return matching ranges.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          caseSensitive: { type: "boolean" }
        },
        required: ["query"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "replaceRange",
      description: "Propose replacing a document range. The edit requires user approval before it is applied.",
      parameters: {
        type: "object",
        properties: {
          from: { type: "integer", minimum: 0 },
          to: { type: "integer", minimum: 0 },
          text: { type: "string" }
        },
        required: ["from", "to", "text"],
        additionalProperties: false
      }
    }
  }
];
```

实现时要把全部工具补齐。`strict: true` 可以作为可选配置；为了兼容更多 OpenAI-compatible 服务，第一版可以不强依赖 strict。

## Tool Call 解析与校验

工具解析器建议单独实现：

```ts
parseAssistantToolCalls(message): ParsedToolCall[]
```

返回类型：

```ts
interface ParsedToolCall {
  id: string;
  name: AIToolName;
  arguments: unknown;
}
```

校验步骤：

1. `tool_calls` 必须是数组。
2. 每个 call 必须有 `id`。
3. `type` 必须是 `"function"`。
4. `function.name` 必须在 `AI_TOOL_NAMES` 白名单中。
5. `function.arguments` 必须是 JSON 字符串。
6. JSON 解析失败时返回 tool error。
7. 参数类型错误时返回 tool error。
8. 写工具必须生成 pending operation，不直接执行。

## 工具结果如何回传给模型

每个 tool call 都要追加一个 `role: "tool"` message，携带 `tool_call_id`。

示例：

```json
{
  "role": "tool",
  "tool_call_id": "call_123",
  "content": "{\"ok\":true,\"matches\":[{\"from\":10,\"to\":14,\"preview\":\"TODO\"}]}"
}
```

工具结果统一 JSON 格式：

```ts
type AIToolResult =
  | {
      ok: true;
      tool: AIToolName;
      data: unknown;
    }
  | {
      ok: false;
      tool: AIToolName;
      error: string;
    };
```

写工具结果示例：

```json
{
  "ok": true,
  "tool": "replaceRange",
  "data": {
    "status": "pending_approval",
    "operationId": "op_1",
    "from": 10,
    "to": 20,
    "replacementPreview": "new text"
  }
}
```

这能让模型知道：它已经提出修改，但还没有真正应用。

## Pending Operation 数据结构

写操作统一转成 pending operation：

```ts
type AIPendingOperation =
  | {
      id: string;
      kind: "replaceRange";
      from: number;
      to: number;
      text: string;
      before: string;
      after: string;
    }
  | {
      id: string;
      kind: "insertAt";
      pos: number;
      text: string;
      before: string;
      after: string;
    }
  | {
      id: string;
      kind: "replaceSelection";
      text: string;
      selection: { anchor: number; head: number };
      before: string;
      after: string;
    };
```

Apply 时：

- `replaceRange` 调用 `editor.replaceRange(from, to, text)`。
- `insertAt` 调用 `editor.replaceRange(pos, pos, text)`。
- `replaceSelection` 调用 `editor.replaceSelection(text)`。

Discard 时：

- 从 pending list 移除。
- 不修改文档。

## 多轮调用示例

用户：

```text
把文档里所有 TODO 改成 Done，但先让我确认。
```

第一轮请求：

- messages: developer prompt + user prompt
- tools: 全部工具定义

模型返回：

```json
{
  "tool_calls": [
    {
      "id": "call_1",
      "type": "function",
      "function": {
        "name": "searchText",
        "arguments": "{\"query\":\"TODO\"}"
      }
    }
  ]
}
```

插件执行 `searchText`，追加 tool result。

第二轮请求：

- messages 包含 searchText 的 tool result

模型返回：

```json
{
  "content": "I found 3 matches and prepared replacements for review.",
  "tool_calls": [
    {
      "id": "call_2",
      "type": "function",
      "function": {
        "name": "replaceRange",
        "arguments": "{\"from\":12,\"to\":16,\"text\":\"Done\"}"
      }
    }
  ]
}
```

插件生成 pending operation，侧边栏展示 preview，循环暂停。

用户点击 Apply 后，插件修改文档。

## 编码要求

后续所有开发文件统一使用 UTF-8：

- 新增 `.ts`、`.tsx`、`.css`、`.md` 文件均保存为 UTF-8。
- 不使用 GBK / ANSI。
- 中文文档和中文注释允许存在，但必须 UTF-8。
- 如果 PowerShell 输出中文乱码，以编辑器和 Git diff 为准；必要时用 `Get-Content -Encoding utf8` 或 Node 读取验证。

## 推荐实现结构

```text
packages/plugin-ai-assistant/
  package.json
  tsconfig.json
  src/
    index.ts
    types.ts
    openai-provider.ts
    tools.ts
    panel.ts
    plugin.ts
  test/
    tools.test.ts
    openai-provider.test.ts
    panel.test.ts
```

## 与当前项目实现风格对齐

检查现有实现后，这个 PR 应该遵循以下本地风格：

### 1. 插件包形态对齐 `plugin-wordcount`

`@floatboat/nexus-plugin-wordcount` 已经使用了“插件对象 + handle + attachEditor”的模式：

```ts
const wordcount = createWordCountPlugin();
const editor = createEditor({ container, plugins: [wordcount] });
attachWordCountPlugin(wordcount, editor);
```

AI Assistant 也应该采用相同形态：

```ts
const assistant = createAIAssistantPlugin();
const editor = createEditor({ container, plugins: [assistant] });
attachAIAssistantPlugin(assistant, editor);
```

这样不需要改 `EditorAPI`，也不需要让 core 知道 AI 的存在。

### 2. UI 形态对齐 `plugin-slash` / `plugin-toolbar`

当前插件 UI 都是原生 DOM：

- `createSlashMenuUI(editor, options)` 返回 `{ element, destroy }`
- `createToolbarUI(editor, options)` 返回 `{ element, destroy }`
- `createStatusBar(plugin, options)` 返回 `{ element, destroy }`

AI 侧边栏也应该是：

```ts
createAIAssistantPanel(assistant, options): AIAssistantPanel
```

返回：

```ts
interface AIAssistantPanel {
  element: HTMLElement;
  destroy(): void;
}
```

不要引入 React/Vue，也不要做全局 singleton。

### 3. Demo 集成方式对齐现有 Electron demo

Electron demo 当前在 `app.ts` 里管理 toolbar、outline、vault、backlinks 等面板；在 `editor-shell.ts` 里创建 editor 和插件。

AI 面板应按这个方式集成：

- `editor-shell.ts` 创建 `aiAssistant` 插件 handle。
- `EditorShell` 暴露 `aiAssistant`。
- `app.ts` 创建 AI panel，并在 toolbar 增加 toggle button。
- `style.css` 增加 `.nexus-ai-*` 样式。

不要在 core 插件里直接假设 Electron 环境，也不要依赖 preload / ipc。

### 4. 网络请求位置

OpenAI-compatible HTTP 调用应放在 `packages/plugin-ai-assistant/src/openai-provider.ts`。

不使用 OpenAI SDK，保持依赖轻量，和项目里很多插件“少依赖、直接 TS + DOM”的风格一致。

### 5. 配置与存储风格

当前 `plugin-search` / `plugin-slash` 的 history 都是 opt-in storage，不默认写 `localStorage`。

AI Assistant 也应遵守：

- API Key 默认只存在内存。
- 如果未来要持久化，必须由 host 显式传入 storage。
- 第一版不写 `localStorage`，不写磁盘。

### 6. 工具执行风格

写操作应该优先复用现有 `EditorAPI`：

- `editor.getDocument()`
- `editor.getSelectedText()`
- `editor.getSelection()`
- `editor.replaceRange()`
- `editor.replaceSelection()`
- `editor.setSelection()`
- `editor.getTableOfContents()`

不要新增 core API，除非现有 API 明确无法完成。

### 7. 测试风格

测试应和现有包保持一致：

- Vitest + jsdom。
- provider 测试 mock `fetch`。
- UI 测试直接 query DOM / dispatch Event。
- 工具测试使用 `createEditor` 搭建真实 editor。
- 不访问真实 OpenAI API。

### `types.ts`

定义公共类型：

```ts
export interface AIAssistantConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  systemPrompt?: string;
}

export interface AIAssistantMessage {
  role: "user" | "assistant" | "tool" | "system";
  content: string;
}

export interface AIAssistantOptions {
  config?: Partial<AIAssistantConfig>;
  container?: HTMLElement;
}
```

### `tools.ts`

实现工具执行器：

```ts
executeAIToolCall(editor, toolCall)
```

需要做范围校验：

- `from` / `to` 不能小于 0
- 不能超过文档长度
- `from <= to`
- 非法时返回错误，不抛出导致 UI 崩溃

### `openai-provider.ts`

实现 OpenAI-compatible provider：

```ts
createOpenAICompatibleProvider(config)
```

职责：

- 拼装 messages
- 声明 tools schema
- 调用 `/chat/completions`
- 解析 assistant message 和 tool calls
- 统一返回给 panel

### `panel.ts`

实现原生 DOM 侧边栏。

不引入 React/Vue，保持和项目现有插件风格一致。

### `plugin.ts`

实现：

```ts
createAIAssistantPlugin(options): NexusPlugin & AIAssistantHandle
```

返回值既是 Nexus plugin，也可以作为宿主持有的控制句柄：

```ts
const ai = createAIAssistantPlugin();
const editor = createEditor({ plugins: [ai] });
ai.attachEditor(editor);
```

## 测试计划

### 工具测试

覆盖：

- `readDocument` 返回全文
- `readSelection` 返回当前选区
- `searchText` 返回多个匹配位置
- `replaceRange` 对合法范围生成 pending operation
- 非法范围返回错误
- `insertAt` 位置越界返回错误
- `getTableOfContents` 返回标题结构

### Provider 测试

Mock `fetch`，验证：

- 请求 URL 使用用户配置的 base URL
- Authorization header 正确
- tools schema 被发送
- tool calls 能被解析
- API 错误能转换为用户可见错误

### Panel 测试

覆盖：

- 未配置 API Key 时发送按钮提示错误
- 发送消息后显示 loading
- provider 返回消息后追加 assistant message
- provider 返回写操作后展示 pending changes
- 点击 Apply 后修改 editor 文档
- 点击 Discard 后不修改文档

## 完成标准

PR 完成时应满足：

- 新包能 build。
- 相关单测通过。
- root `pnpm test` 尽量通过；至少目标包测试通过。
- Electron demo 可以打开 AI 面板。
- README 或包内 README 有使用示例。
- 不提交任何真实 API Key。
- 不默认持久化用户 API Key。

## 风险与控制

### 风险 1：真实 API 调用不适合单测

解决：测试全部 mock `fetch`，不访问真实网络。

### 风险 2：AI 修改文档有安全风险

解决：写操作只进入 pending 状态，用户点击 Apply 后才执行。

### 风险 3：OpenAI SDK 增加依赖和打包复杂度

解决：第一版不用 OpenAI SDK，直接调用 OpenAI-compatible HTTP API。

### 风险 4：范围操作可能破坏文档

解决：所有 range 工具统一校验边界，非法时返回错误。

## 不做的内容

第一版不做：

- 不支持多供应商适配。
- 不做 streaming。
- 不做 RAG / 文件库索引。
- 不持久化 API Key。
- 不实现复杂 diff 视图。
- 不让 AI 自动无确认写入文档。
- 不改 core `EditorAPI`，优先复用已有 API。

## 面试表达重点

可以这样介绍这个 PR：

> 我做的是一个 OpenAI-compatible AI Assistant 插件。它不是简单聊天框，而是给模型暴露了一组受控 editor tools，让模型能读取、搜索、选择和提出文档修改。写操作不会直接落地，而是进入 preview，需要用户确认 Apply。这样既有真实 AI 能力，也保持了编辑器安全边界和开源项目的可维护性。

这个选题能体现：

- 对编辑器插件架构的理解
- AI tool calling 的产品化落地
- API key 安全意识
- DOM UI 实现能力
- 测试和边界处理能力

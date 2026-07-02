# @floatboat/nexus-plugin-ai-assistant

OpenAI-compatible AI assistant sidebar for Nexus-Editor.

The plugin gives the model a small, controlled set of editor tools instead of
letting it mutate the document directly. Read tools run automatically; write
tools create pending edits that the user must apply.

## Usage

```ts
import { createEditor } from "@floatboat/nexus-core";
import {
  attachAIAssistantPlugin,
  createAIAssistantPanel,
  createAIAssistantPlugin
} from "@floatboat/nexus-plugin-ai-assistant";

const assistant = createAIAssistantPlugin({
  storage: localStorage,
  storageKey: "nexus-ai-assistant:sessions"
});
const editor = createEditor({
  container,
  plugins: [assistant]
});

attachAIAssistantPlugin(assistant, editor);

const panel = createAIAssistantPanel(assistant, {
  container: sidebar,
  storage: localStorage,
  storageKey: "nexus-ai-assistant"
});
```

The bundled panel asks the user for:

- API key
- OpenAI-compatible base URL
- model name
- optional system prompt

API keys and conversations are kept in memory by default. Pass a storage
adapter such as `localStorage` plus a `storageKey` when the host app wants to
persist config and per-file conversations.

## Tools

The assistant can request these tools via Chat Completions `tool_calls`:

- `readDocument`
- `readSelection`
- `searchText`
- `replaceRange`
- `insertAt`
- `replaceSelection`
- `setSelection`
- `getTableOfContents`

`replaceRange`, `insertAt`, and `replaceSelection` create pending operations.
Call `assistant.applyOperation(id)` after the user approves an edit.

## OpenAI-compatible API

The default provider calls:

```http
POST {baseUrl}/chat/completions
Authorization: Bearer {apiKey}
```

It uses non-streaming Chat Completions with function tools for broad
OpenAI-compatible provider support.

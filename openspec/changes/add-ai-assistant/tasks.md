# Implementation Tasks

## 1. Package and Protocol

- [x] 1.1 Add `packages/plugin-ai-assistant` package.
- [x] 1.2 Add workspace aliases and root build integration.
- [x] 1.3 Define AI assistant messages, tool calls, tool results, and pending operations.
- [x] 1.4 Implement OpenAI-compatible Chat Completions provider.
- [x] 1.5 Implement tool-call parsing and validation.

## 2. Editor Tools

- [x] 2.1 Implement `readDocument`, `readSelection`, `searchText`, and `getTableOfContents`.
- [x] 2.2 Implement immediate `setSelection`.
- [x] 2.3 Implement pending write operations for `replaceRange`, `insertAt`, and `replaceSelection`.
- [x] 2.4 Validate all document ranges before creating operations.

## 3. Assistant Runtime and UI

- [x] 3.1 Implement bounded multi-round tool loop.
- [x] 3.2 Pause on pending write operations.
- [x] 3.3 Add Apply / Discard operation handling.
- [x] 3.4 Add vanilla-DOM assistant panel.
- [x] 3.5 Keep API key in memory only.

## 4. Electron Demo

- [x] 4.1 Add the plugin to the Electron demo dependencies and Vite aliases.
- [x] 4.2 Register the plugin in `editor-shell`.
- [x] 4.3 Add a toolbar toggle and right-side assistant panel.
- [x] 4.4 Add panel CSS.

## 5. Verification

- [x] 5.1 Add focused Vitest coverage for tools, provider, plugin runtime, and panel.
- [x] 5.2 Run targeted AI assistant tests.
- [x] 5.3 Run package build.
- [x] 5.4 Run `pnpm typecheck`.
- [x] 5.5 Run Electron demo production build.
- [x] 5.6 Run full `pnpm test`.
- [ ] 5.7 Run `pnpm exec openspec validate add-ai-assistant --strict` once OpenSpec CLI is available locally.

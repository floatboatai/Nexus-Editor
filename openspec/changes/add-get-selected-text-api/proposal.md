# Change: 新增 getSelectedText() API 方法

## Why

Nexus-Editor 的 `EditorAPI` 提供了 `getSelection()`（获取选区位置）和 `replaceSelection()`（替换选中内容），但缺少直接获取选中文本的方法。这是项目 Roadmap P0 中列出的缺失功能，补上后可以让使用者更方便地读取用户选中的文字，而不必自己用 `getSelection()` + `getDocument().slice()` 来拼。

## What Changes

- 在 `packages/core/src/types.ts` 的 `EditorAPI` 接口中新增 `getSelectedText(): string` 方法签名
- 在 `packages/core/src/editor.ts` 的 `api` 对象中实现 `getSelectedText()` 方法，使用 `view.state.sliceDoc()` 获取选中文本，并通过 `Math.min/max` 规范化 anchor/head 顺序，正确处理正向和反向选区
- 在 `packages/core/test/editor.test.ts` 中新增测试用例，覆盖：无选区（光标状态）、正向选区、反向选区
- 新增 `docs/getSelectedText-dev-notes.md` 开发笔记，记录实现过程和遇到的问题

## Impact

- 受影响的 specs：`editor-core`（新增 public API 方法）
- 受影响的代码：`packages/core/src/types.ts`、`packages/core/src/editor.ts`、`packages/core/test/editor.test.ts`
- **无 breaking changes**，新增方法不影响现有 API

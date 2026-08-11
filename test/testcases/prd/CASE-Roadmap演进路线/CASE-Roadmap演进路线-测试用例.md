# CASE-Roadmap演进路线-测试用例（FP-07）

> 一级功能点: Roadmap 演进路线（Phase1 核心引擎 MVP → Phase2 框架拥抱 → Phase3 桌面端深度）
> 全局批次序号: 07
> 生成时间: 2026-08-10
> 测试框架: Vitest / jsdom（`vitest.config.ts` 已配置 `environment: "jsdom"` + `@floatboat/nexus-core` / 各官方插件包 / `@floatboat/nexus-react` / `@floatboat/nexus-vue` 别名）
>
> 涉及二级功能点:
> - FP-07-01 Phase1 核心引擎 MVP（createEditor 基本创建 + AST 基础解析 + 基础 Live Preview）（[创建][AST][预览]）
> - FP-07-02 Phase2 框架拥抱（react/vue 绑定、gfm/history/search 插件可加载）（[框架绑定][官方插件]）
> - FP-07-03 Phase3 桌面端深度（Widget API 自定义渲染 + IO 防抖配置）（[Widget][IO防抖]）

> ⚠️ 实现事实提示（影响前置条件，均以 `packages/` 实际代码为准）:
> - AST 默认走 Lezer 增量解析（`lezerTreeToMdast`/`lezerStringToMdast`，`packages/core/src/editor.ts:129,300`），`getAst()` 返回 mdast 兼容的 `Root`（`{ type: "root", children: [...] }`）；`onChange`/`change` 事件载荷为 `(doc, ast)`（`packages/core/src/editor.ts:341-343`）。
> - Live Preview 链接经 mark 装饰器渲染为带 `data-link-url` 属性的 `<a>` 元素（`packages/core/src/live-preview.ts:1008` 设置 `attrs: { "data-link-url": url }`；`packages/core/src/live-preview-renderers.ts:62-67` 为块级渲染路径，设置 `href`/`rel="noopener noreferrer"`/`title`）；渲染要求光标不在该行（`editor.setSelection(doc.length)` 后断言，与 `packages/core/test/live-preview.test.ts:213-225` 一致）。
> - 官方插件均为 `NexusPlugin` 形状：`createGfmPreset()` 返回 `{ name: "preset-gfm", remarkPlugins: [remarkGfm] }`（`packages/preset-gfm/src/index.ts:5-8`）；`createHistoryPlugin()` 返回 `{ name: "plugin-history", cmExtensions: [history(), keymap.of(historyKeymap)] }`（`packages/plugin-history/src/index.ts:6-9`）；`createSearchPlugin(options?: SearchPluginOptions)` 返回 CM6 search 扩展，面板 DOM 标记为 `data-test-id="markdown-search-bar"`、输入框为 `data-test-id="markdown-search-input"`（`packages/plugin-search/src/index.ts:912,931,1143`）。
> - Widget 通过插件 `widgets: WidgetDefinition[]` 注入（`NexusPlugin.widgets`，`packages/core/src/types.ts:397`），渲染元素自动带 `data-nexus-widget` 属性（`el.setAttribute("data-nexus-widget", definition.nodeType)`，`packages/core/src/widget-extension.ts:137`）；光标/选区与 widget 源码范围相交时回退原始 markdown（`selectionIntersects` 判定，`widget-extension.ts:28-35,76`）。
> - Phase2 框架绑定均暴露 `Editor` 组件与 `useEditor` hook（`@floatboat/nexus-react` / `@floatboat/nexus-vue`），组件挂载后容器内出现 `.cm-editor`，`onReady` 回调收到可用 `EditorAPI`（`UseEditorConfig.onReady?: (editor: EditorAPI) => void`，`packages/react/src/types.ts:9`）。
> - IO 防抖的落地配置为 `parseDelayMs`（默认 0；>0 时 `scheduleChange` 将 `onChange`/解析合并到防抖窗口后触发一次：窗口内新变更 `clearTimeout` 重置计时，`packages/core/src/editor.ts:282,346-361`）。
> - React 用例使用 `@testing-library/react` 的 `render`（与 `packages/react/test/editor-react.test.tsx` 一致）；Vue 用例使用 `@vue/test-utils` 的 `mount(Editor, { props })` + `await nextTick()`（与 `packages/vue/test/editor-vue.test.ts` 一致）。

---

## FP-07-01-N01 [P1] [N] createEditor 基础创建：编辑器挂载 + 初始文档 + AST 根节点解析

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `# Hello`
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";

  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "# Hello",
  });
  ```

**实现事实与陷阱提示（源码注入）**:
- `container` 为 `EditorConfig` 必填字段（`container: HTMLElement`，`packages/core/src/types.ts:80`）；挂载即 `new EditorView({ parent: config.container, state: EditorState.create({ doc: config.initialValue ?? "" }) })`（`editor.ts:543-547`），故 `initialValue` 缺省时按空串处理。
- 无 `parser`/`plugins` 时走 Lezer 路径：`getAst()` 直接返回 `currentAst`（`editor.ts:735-737`），初始 AST 由 `lezerStringToMdast(initialValue)` 生成 mdast 兼容 `Root`（`{ type: "root", children: [...] }`，`editor.ts:300`）。
- 陷阱：CM6 挂载后 `.cm-editor` 为同步 DOM，无需等待；jsdom 下可直接 querySelector。

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 调用 createEditor 传入合法 div 容器 | [DOM] 容器内出现 `.cm-editor` 节点，编辑器完成挂载（`new EditorView({ parent: container })` 同步渲染，`editor.ts:543-544`） | import: @floatboat/nexus-core; API: createEditor({ container, initialValue: "# Hello" }); 框架: vitest; 等待: 无 |
| 2 | 读取文档 `editor.getDocument()` | [API] `getDocument(): string` 返回 "# Hello"（内部实现 `view.state.doc.toString()`，初始文档原样保留，`editor.ts:732-734`） | import: @floatboat/nexus-core; API: editor.getDocument(); 框架: vitest; 等待: 无 |
| 3 | 读取 AST `editor.getAst()` | [AST] `getAst(): Root` 返回 `{ type: "root" }`，`children[0].type === "heading"` 且 `depth === 1`（Lezer 增量解析产生 mdast 兼容树，`editor.ts:300,735-737`） | import: @floatboat/nexus-core; API: editor.getAst(); 框架: vitest; 等待: 无 |
| 4 | 清理：`editor.destroy()` | [STATE] 不抛异常（`destroyed/destroying` 双标志保护，`editor.ts:924-925`） | import: @floatboat/nexus-core; API: editor.destroy(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [DOM] container.querySelector(".cm-editor") 不为 null
- [API] editor.getDocument() === "# Hello"
- [AST] editor.getAst().type === "root"，children[0] 为 heading（depth === 1）

## 增强信息来源
- API签名: packages/core/src/editor.ts（createEditor / getDocument / getAst / destroy）
- 类型定义: packages/core/src/types.ts（EditorConfig.container 必填 / EditorAPI）
- 测试参考: packages/core/test/live-preview.test.ts（createEditor setup 模式）
- 陷阱提示: editor.ts:543-547（挂载即同步渲染）、editor.ts:924-925（destroy 幂等保护）

---

## FP-07-01-N02 [P1] [N] setDocument 编辑后文档同步并触发 change 事件

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `# Hello`
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor, type Root } from "@floatboat/nexus-core";
  import { vi } from "vitest";

  const container = document.createElement("div");
  const handler = vi.fn();
  const editor = createEditor({
    container,
    initialValue: "# Hello",
  });
  editor.on("change", handler);
  ```

**实现事实与陷阱提示（源码注入）**:
- `change` 事件载荷为 `(markdown, currentAst)`：`emitter.emit("change", markdown, currentAst)`（`editor.ts:343`），即回调参数 `[0]` 是文档字符串、`[1]` 是 `Root`。
- `setDocument(next, opts?)` 默认 `opts.silent !== true`，走正常变更管线并触发 `scheduleChange` → `emitChange`（`editor.ts:404-440`）；`opts.silent: true` 时跳过事件（`silentDocChange` 注解，`editor.ts:413,433`）。
- 陷阱：`emitChange` 中默认路径为 `transformAst(lezerAstFromAnywhere(viewRef, markdown))`（`editor.ts:341`），增量解析基于实时 EditorState，无需手动刷新。

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | `editor.setDocument("# World")` | [API] `getDocument() === "# World"`（默认非 silent，完整变更管线同步生效，`editor.ts:805`） | import: @floatboat/nexus-core; API: editor.setDocument("# World"); 框架: vitest; 等待: 无 |
| 2 | 取末次事件载荷 `const last = handler.mock.calls[handler.mock.calls.length - 1]` | [EVENT] `last[0] === "# World"`（doc 载荷），`(last[1] as Root).children[0].type === "heading"`（ast 载荷为 mdast Root，`emit("change", markdown, currentAst)`，`editor.ts:343`） | import: @floatboat/nexus-core; API: editor.on("change", handler) + handler.mock.calls; 框架: vitest; 等待: 无 |
| 3 | 再次 `setDocument("# A\n\nParagraph")` | [AST] 末次载荷 ast.children.length === 2（heading + paragraph 两个顶层节点） | import: @floatboat/nexus-core; API: editor.setDocument("# A\n\nParagraph"); 框架: vitest; 等待: 无 |

**断言汇总**:
- [API] editor.getDocument() === "# World"
- [EVENT] change 事件被触发，末次载荷 doc === "# World"、ast.children[0].type === "heading"
- [AST] 末次 ast.children.length === 2

## 增强信息来源
- API签名: packages/core/src/editor.ts（setDocument / emitChange / EventEmitter.emit("change")）
- 类型定义: packages/core/src/types.ts（Root / EditorEventMap）
- 测试参考: packages/core/test/live-preview.test.ts（change 事件断言模式）
- 陷阱提示: editor.ts:413,433（silent 注解跳过事件）、editor.ts:343（事件载荷顺序 (doc, ast)）

---

## FP-07-01-N03 [P1] [N] 基础 Live Preview 装饰器开启后链接渲染为可交互元素

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `Click [here](https://example.com)\n\nend`
- 插件配置: 无（`livePreview: true` 显式开启）
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";

  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "Click [here](https://example.com)\n\nend",
    livePreview: true,
  });
  editor.setSelection(editor.getDocument().length);
  ```

**实现事实与陷阱提示（源码注入）**:
- 链接经 mark 装饰器渲染：`attrs: { "data-link-url": url }`（`packages/core/src/live-preview.ts:1008`）；`live-preview-renderers.ts:62-67` 是另一条块级渲染路径（`<a>` 元素设置 `href`/`rel="noopener noreferrer"`/`title="${url} (Ctrl+Click to open)"`）。
- `livePreview` 字段类型为 `boolean | LivePreviewConfig`（`types.ts:84`），`true` 即开启装饰器。
- 陷阱：光标所在行的链接不渲染装饰（光标相交行回退原始文本），必须先 `editor.setSelection(doc.length)` 把光标移出链接行，再断言（既有测试 `live-preview.test.ts:213-225` 同一模式：`setSelection(getDocument().length)` 后 `querySelector("[data-link-url]")`）。

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 将光标移动到文档末尾（离开链接所在行） | [STATE] `getSelection().anchor === getDocument().length`（`getSelection()` 返回 `{ anchor, head }`，`editor.ts:748-751`） | import: @floatboat/nexus-core; API: editor.setSelection(n) + editor.getSelection(); 框架: vitest; 等待: 无 |
| 2 | 查询容器内的链接元素 | [DOM] `container.querySelector("[data-link-url]")` 不为 null，且 `data-link-url === "https://example.com"`（mark 装饰器 `attrs: { "data-link-url": url }`，`live-preview.ts:1008`） | import: @floatboat/nexus-core; API: container.querySelector("[data-link-url]"); 框架: vitest; 等待: 无 |
| 3 | 检查链接 markdown 标记是否被替换隐藏 | [DOM] container.textContent 不含 `"](https://example.com)"`（装饰器已接管渲染，原始 `[here](url)` 标记被替换为 `<a>` 元素） | import: @floatboat/nexus-core; API: container.textContent; 框架: vitest; 等待: 无 |
| 4 | 清理：`editor.destroy()` | [STATE] 不抛异常（destroy 幂等保护，`editor.ts:925`） | import: @floatboat/nexus-core; API: editor.destroy(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [DOM] [data-link-url] 元素存在且 URL 数据正确
- [DOM] 链接源标记被替换隐藏（textContent 不含 `](https://example.com)`）

## 增强信息来源
- API签名: packages/core/src/live-preview.ts（mark 装饰器 data-link-url）、packages/core/src/live-preview-renderers.ts:62-67（块级 <a> 渲染）
- 类型定义: packages/core/src/types.ts（LivePreviewConfig / livePreview 字段）
- 测试参考: packages/core/test/live-preview.test.ts:213-225（data-link-url 断言模式）
- 陷阱提示: live-preview.test.ts（光标必须在链接行之外才渲染装饰）

---

## FP-07-01-N04 [P2] [D] setDocument 全量替换后 AST 与目录同步更新

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `# Title`
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";

  const container = document.createElement("div");
  const editor = createEditor({ container, initialValue: "# Title" });
  ```

**实现事实与陷阱提示（源码注入）**:
- `getTableOfContents()` 返回 `TocEntry[]`，由 `extractToc(currentAst)` 计算（`editor.ts:738-740`）；`TocEntry = { level: number; text: string; from: number; to: number }`（`types.ts:153-158`）。
- `setDocument` 非 silent 时同步更新 `currentAst` 与 TOC（`editor.ts:404-440`），断言无需等待。

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | `editor.setDocument("## Section A\n\nSome text")` | [API] `getDocument() === "## Section A\n\nSome text"`（`view.state.doc.toString()`，`editor.ts:732-734`） | import: @floatboat/nexus-core; API: editor.setDocument("## Section A\n\nSome text"); 框架: vitest; 等待: 无 |
| 2 | 读取 AST | [AST] `children[0].type === "heading"` 且 `depth === 2`；`children[1].type === "paragraph"` 且其文本节点 `value === "Some text"`（Lezer 增量解析，`editor.ts:341`） | import: @floatboat/nexus-core; API: editor.getAst(); 框架: vitest; 等待: 无 |
| 3 | 读取目录 `editor.getTableOfContents()` | [API] `toc[0].level === 2` 且 `toc[0].text === "Section A"`（`extractToc(currentAst)`，`TocEntry { level, text, from, to }`，`editor.ts:738-740`） | import: @floatboat/nexus-core; API: editor.getTableOfContents(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [API] getDocument() === "## Section A\n\nSome text"
- [AST] children[0].depth === 2，children[1] 为 paragraph
- [API] getTableOfContents()[0].level === 2

## 增强信息来源
- API签名: packages/core/src/editor.ts（setDocument / getAst / getTableOfContents）
- 类型定义: packages/core/src/types.ts（TocEntry）
- 测试参考: packages/core/test/live-preview.test.ts（setDocument + AST 断言模式）
- 陷阱提示: editor.ts:738-740（TOC 由 currentAst 实时计算）

---

## FP-07-01-N05 [P2] [N] 复杂文档 AST 结构完整（标题/段落/列表/引用/行内代码）

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档:
  ```
  # Title

  Paragraph one.

  - item a
  - item b

  > quote

  `code`
  ```
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";

  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: [
      "# Title",
      "",
      "Paragraph one.",
      "",
      "- item a",
      "- item b",
      "",
      "> quote",
      "",
      "`code`",
    ].join("\n"),
  });
  ```

**实现事实与陷阱提示（源码注入）**:
- Lezer 默认解析产出 mdast 兼容树：顶层节点序列与文档结构一一对应；`list` 的 children 为 `listItem`；`blockquote` 的文本经其 paragraph 子节点的 text 节点取得。
- 陷阱：mdast 的文本内容不在 blockquote 节点本身上，需取 `children[0]`（paragraph）→ `children[0]`（text）的 `value`。

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 读取 AST 顶层 children | [AST] 类型序列为 [heading, paragraph, list, blockquote, paragraph]（Lezer 保持文档结构，`editor.ts:300`） | import: @floatboat/nexus-core; API: editor.getAst().children.map(n => n.type); 框架: vitest; 等待: 无 |
| 2 | 断言列表节点 | [AST] children[2].type === "list"，其 children.length === 2（两个 listItem，且每个 listItem 含一个 paragraph） | import: @floatboat/nexus-core; API: editor.getAst().children[2]; 框架: vitest; 等待: 无 |
| 3 | 断言引用节点 | [AST] children[3].type === "blockquote"，其文本内容为 "quote"（blockquote → paragraph → text.value） | import: @floatboat/nexus-core; API: editor.getAst().children[3]; 框架: vitest; 等待: 无 |
| 4 | 清理：`editor.destroy()` | [STATE] 不抛异常 | import: @floatboat/nexus-core; API: editor.destroy(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [AST] children 类型序列 === ["heading", "paragraph", "list", "blockquote", "paragraph"]
- [AST] list 节点含 2 个 listItem
- [AST] blockquote 节点文本为 "quote"

## 增强信息来源
- API签名: packages/core/src/editor.ts（getAst）
- 类型定义: packages/core/src/types.ts（Root）
- 测试参考: packages/core/test/live-preview.test.ts（AST 结构断言模式）
- 陷阱提示: mdast 文本需沿 blockquote → paragraph → text.value 取（源码解析路径 editor.ts:341）

---

## FP-07-01-E01 [P3] [E] 缺省或非法 container 时拒绝创建编辑器

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: 无（创建即失败）
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor, type EditorConfig } from "@floatboat/nexus-core";

  // container 为必填字段（types.ts:80），此处模拟运行时漏传/非法值（绕过 TS 编译期检查）
  ```

**实现事实与陷阱提示（源码注入）**:
- `container: HTMLElement` 是 `EditorConfig` 必填字段（`types.ts:80`）；挂载调用 `new EditorView({ parent: config.container })`（`editor.ts:543-544`），CM6 对非法 `parent`（undefined/null）抛异常，因此运行时缺失/非法容器必然创建失败。
- 陷阱：`{} as EditorConfig` 与 `{ container: null }` 均走同一 `parent` 校验路径，断言用 `expect(...).toThrow()`。

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | `createEditor({} as EditorConfig)` | [STATE] 抛异常（`parent: undefined` 无法挂载 EditorView，`editor.ts:543-544`；断言 `toThrow()`） | import: @floatboat/nexus-core; API: createEditor({} as EditorConfig); 框架: vitest; 等待: 无 |
| 2 | `createEditor({ container: null as unknown as HTMLElement })` | [STATE] 抛异常（`parent: null` 非法容器不可挂载，同样触发 CM6 校验） | import: @floatboat/nexus-core; API: createEditor({ container: null }); 框架: vitest; 等待: 无 |

**断言汇总**:
- [STATE] 缺省 container 的创建调用抛异常
- [STATE] container 为 null 的创建调用抛异常

## 增强信息来源
- API签名: packages/core/src/editor.ts（createEditor 挂载路径）
- 类型定义: packages/core/src/types.ts（EditorConfig.container 必填）
- 测试参考: packages/core/test/live-preview.test.ts（createEditor 参数校验）
- 陷阱提示: editor.ts:543-544（EditorView parent 校验失败即抛错）

---

## FP-07-01-E02 [P3] [E] 畸形 markdown 解析降级不崩溃且可继续编辑

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `## Unclosed\n\n```js\nconsole.log(1)\n\n| a | b\nbroken`（代码块未闭合 + 畸形表格）
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";

  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "## Unclosed\n\n```js\nconsole.log(1)\n\n| a | b\nbroken",
  });
  ```

**实现事实与陷阱提示（源码注入）**:
- Lezer 解析器容错：未闭合代码块/畸形表格被解析为可恢复的语法树，`getAst()` 始终返回 `type === "root"` 的 `Root`（`editor.ts:300,735-737`）。
- 陷阱：Lezer 增量解析不抛错，畸形段会退化为文本/普通段落节点，断言只要求 `children.length >= 1` 而非具体节点类型。

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 用畸形 markdown 创建编辑器 | [STATE] 创建过程不抛异常（Lezer 容错解析） | import: @floatboat/nexus-core; API: createEditor({ container, initialValue: "## Unclosed\n\n```js..." }); 框架: vitest; 等待: 无 |
| 2 | 读取 AST | [AST] `getAst().type === "root"` 且 children.length >= 1（降级为可解析树，`editor.ts:300`） | import: @floatboat/nexus-core; API: editor.getAst(); 框架: vitest; 等待: 无 |
| 3 | 编辑：`editor.setDocument("ok")` | [STATE] 不抛异常，`getDocument() === "ok"`（后续编辑不受畸形初始文档影响） | import: @floatboat/nexus-core; API: editor.setDocument("ok"); 框架: vitest; 等待: 无 |

**断言汇总**:
- [STATE] createEditor 不抛异常
- [AST] getAst().type === "root"
- [API] setDocument("ok") 后 getDocument() === "ok"

## 增强信息来源
- API签名: packages/core/src/editor.ts（createEditor / getAst / setDocument）
- 类型定义: packages/core/src/types.ts（Root）
- 测试参考: packages/core/test/live-preview.test.ts（畸形输入容错）
- 陷阱提示: Lezer 容错解析不抛错（editor.ts:300）

---

## FP-07-01-B01 [P4] [B] 空字符串初始文档正常挂载

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `""`（空字符串）
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";

  const container = document.createElement("div");
  const editor = createEditor({ container, initialValue: "" });
  ```

**实现事实与陷阱提示（源码注入）**:
- `doc: config.initialValue ?? ""`（`editor.ts:546`），空字符串原样进入 EditorState；`getDocument()` 返回 `""`，`getAst()` 返回空 root（children 为空数组）。

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 用空字符串创建编辑器 | [DOM] 容器内出现 `.cm-editor` 节点（空文档同样正常挂载，`editor.ts:546`） | import: @floatboat/nexus-core; API: createEditor({ container, initialValue: "" }); 框架: vitest; 等待: 无 |
| 2 | 读取文档 | [API] `getDocument() === ""`（`view.state.doc.toString()` 为空串） | import: @floatboat/nexus-core; API: editor.getDocument(); 框架: vitest; 等待: 无 |
| 3 | 读取 AST | [AST] `getAst().children.length === 0`（空 root，`{ type: "root", children: [] }`） | import: @floatboat/nexus-core; API: editor.getAst(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [DOM] .cm-editor 挂载成功
- [API] getDocument() === ""
- [AST] getAst().children.length === 0

## 增强信息来源
- API签名: packages/core/src/editor.ts（initialValue ?? "" 兜底）
- 类型定义: packages/core/src/types.ts（Root / EditorConfig.initialValue）
- 测试参考: packages/core/test/live-preview.test.ts
- 陷阱提示: editor.ts:546（空串经 ?? 保留，不会变 undefined）

---

## FP-07-01-B02 [P4] [D] 中文/全角文本原样保留且偏移按 UTF-16 计算

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `# 你好，世界`
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";

  const container = document.createElement("div");
  const editor = createEditor({ container, initialValue: "# 你好，世界" });
  ```

**实现事实与陷阱提示（源码注入）**:
- CM6 `EditorState` 的文档偏移按 UTF-16 code unit 计算，与 JS 字符串 `length` 一致；`getSelection()` 返回 `{ anchor, head }`（`editor.ts:748-751`）。
- `"# 你好，世界".length === 7`（2 个 ASCII + 5 个 BMP 汉字，均为单 code unit）。
- 陷阱：中文文本不经转义/规范化，`getDocument()` 返回原字符串；偏移断言必须用 `"# 你好，世界".length` 表达式而非硬编码，避免字符数误算。

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 读取文档 | [API] `getDocument() === "# 你好，世界"`（中文原样保留，无乱码/转义，`view.state.doc.toString()`） | import: @floatboat/nexus-core; API: editor.getDocument(); 框架: vitest; 等待: 无 |
| 2 | 读取 AST | [AST] children[0] 为 heading，子文本节点 `value === "你好，世界"`（mdast text 节点保留全文） | import: @floatboat/nexus-core; API: editor.getAst(); 框架: vitest; 等待: 无 |
| 3 | `editor.setSelection("# 你好，世界".length)` 后读取选区 | [API] `getSelection().anchor === "# 你好，世界".length`（CM6 偏移按 UTF-16 code unit 计，等于 JS `length`；`getSelection()` 返回 `{ anchor, head }`，`editor.ts:748-751`） | import: @floatboat/nexus-core; API: editor.setSelection(n) + editor.getSelection(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [API] getDocument() === "# 你好，世界"
- [AST] 文本节点 value === "你好，世界"
- [API] setSelection 后 getSelection().anchor === 7（"# 你好，世界".length）

## 增强信息来源
- API签名: packages/core/src/editor.ts（getDocument / getSelection）
- 类型定义: packages/core/src/types.ts（EditorAPI.getSelection）
- 测试参考: packages/core/test/live-preview.test.ts（setSelection 断言模式）
- 陷阱提示: CM6 偏移按 UTF-16 code unit 计（editor.ts:748-751）

---

## FP-07-01-B03 [P4] [B] 超长文档（千行级）创建与解析不失败

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: 1000 行 `# Section N`（程序生成）
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";

  const lines = Array.from({ length: 1000 }, (_, i) => `# Section ${i}`);
  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: lines.join("\n"),
  });
  ```

**实现事实与陷阱提示（源码注入）**:
- Lezer 增量解析对长文档无递归爆栈风险（增量树 + 同步单次解析）；`getAst().children` 与顶层节点一一对应。
- 陷阱：1000 行标题生成 1000 个顶层 heading 节点；若断言 children.length 需注意 list 等复合节点只在本身存在时占一位。

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 用 1000 行文档创建编辑器 | [STATE] 创建过程不抛异常、不超时（Lezer 同步解析 1000 节点开销可忽略） | import: @floatboat/nexus-core; API: createEditor({ container, initialValue: lines.join("\n") }); 框架: vitest; 等待: 无 |
| 2 | 读取文档并分行统计 | [API] `getDocument().split("\n").length === 1000`（内容无损，`view.state.doc.toString()`） | import: @floatboat/nexus-core; API: editor.getDocument(); 框架: vitest; 等待: 无 |
| 3 | 读取 AST | [AST] `getAst().children.length === 1000`（逐标题生成 heading 节点，`editor.ts:300`） | import: @floatboat/nexus-core; API: editor.getAst(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [STATE] createEditor 不抛异常
- [API] getDocument().split("\n").length === 1000
- [AST] getAst().children.length === 1000

## 增强信息来源
- API签名: packages/core/src/editor.ts（createEditor / getDocument / getAst）
- 类型定义: packages/core/src/types.ts（Root）
- 测试参考: packages/core/test/live-preview.test.ts
- 陷阱提示: Lezer 增量解析对长文档无递归风险（editor.ts:300）

---

## FP-07-01-F01 [P5] [F] destroy 清理挂载 DOM 且重复调用幂等

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `hello`
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";

  const container = document.createElement("div");
  const editor = createEditor({ container, initialValue: "hello" });
  ```

**实现事实与陷阱提示（源码注入）**:
- `destroy()` 以 `if (destroyed || destroying) return;` 短路幂等（`editor.ts:924-925`）；核心清理为 `view.destroy()`（`editor.ts:967`），CM6 `EditorView.destroy()` 会从容器中移除编辑器 DOM，故 `.cm-editor` 变为 null。
- `destroy()` 还会 `clearTimeout(parseTimer)`、`emitter.clear()`（`editor.ts:954-965`）。
- 陷阱：断言必须引用 `container` 本身（`container.querySelector(".cm-editor")`），不能缓存旧引用。

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 确认编辑器已挂载 | [DOM] `container.querySelector(".cm-editor")` 不为 null | import: @floatboat/nexus-core; API: container.querySelector(".cm-editor"); 框架: vitest; 等待: 无 |
| 2 | `editor.destroy()` | [DOM] `.cm-editor` 从容器移除（`view.destroy()` 清理 DOM，querySelector 为 null，`editor.ts:967`） | import: @floatboat/nexus-core; API: editor.destroy(); 框架: vitest; 等待: 无 |
| 3 | 再次调用 `editor.destroy()` | [STATE] 不抛异常（`destroyed === true` 短路返回，幂等安全，`editor.ts:925`） | import: @floatboat/nexus-core; API: editor.destroy(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [DOM] destroy 后 .cm-editor 被移除
- [STATE] 重复 destroy 不抛异常

## 增强信息来源
- API签名: packages/core/src/editor.ts（destroy / view.destroy）
- 类型定义: packages/core/src/types.ts（EditorAPI.destroy）
- 测试参考: packages/core/test/live-preview.test.ts（destroy 后 DOM 断言）
- 陷阱提示: editor.ts:925（destroyed/destroying 幂等保护）、editor.ts:967（view.destroy 移除 DOM）

---

## FP-07-02-N01 [P1] [N] GFM preset 可加载：表格与任务列表 AST 解析生效

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `| a | b |\n| - | - |\n| 1 | 2 |`
- 插件配置: `[createGfmPreset()]`
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";
  import { createGfmPreset } from "@floatboat/nexus-preset-gfm";

  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "| a | b |\n| - | - |\n| 1 | 2 |",
    plugins: [createGfmPreset()],
  });
  ```

**实现事实与陷阱提示（源码注入）**:
- `createGfmPreset(): NexusPlugin` 返回 `{ name: "preset-gfm", remarkPlugins: [remarkGfm] }`（`packages/preset-gfm/src/index.ts:5-8`）。
- 默认 Lezer 解析产出的 AST 经 `transformProcessor.runSync(ast)` 应用 remark 插件（`editor.ts:277-280`），故 GFM 表格解析为 `table` 节点、任务列表 listItem 带 `checked` 字段。
- 陷阱：`createGfmPreset()` 无参数（签名 `createGfmPreset(): NexusPlugin`），误传 options 会报 TS 类型错误；断言 `checked` 需取 `listItem.checked`。

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 读取 AST | [AST] `children[0].type === "table"`（remark-gfm 经 transformProcessor 将表格解析为 table 节点，`editor.ts:277-280`） | import: @floatboat/nexus-core + @floatboat/nexus-preset-gfm; API: createEditor({ plugins: [createGfmPreset()] }) + editor.getAst(); 框架: vitest; 等待: 无 |
| 2 | `editor.setDocument("- [x] done")` 后读取 AST | [AST] `children[0].type === "list"`，首 listItem 的 `checked === true`（任务列表语法生效） | import: @floatboat/nexus-core; API: editor.setDocument("- [x] done") + editor.getAst(); 框架: vitest; 等待: 无 |
| 3 | 清理：`editor.destroy()` | [STATE] 不抛异常 | import: @floatboat/nexus-core; API: editor.destroy(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [AST] 表格文档解析出 type === "table" 节点
- [AST] "- [x] done" 解析出 checked === true 的 listItem

## 增强信息来源
- API签名: packages/preset-gfm/src/index.ts（createGfmPreset）
- 类型定义: packages/core/src/types.ts（NexusPlugin.remarkPlugins）
- 测试参考: packages/core/test/live-preview.test.ts（createGfmPreset 配合 createEditor 使用）
- 陷阱提示: editor.ts:277-280（remarkPlugins 经 transformProcessor 应用）

---

## FP-07-02-N02 [P1] [N] History 插件可加载：Ctrl+Z 撤销 / Ctrl+Y 重做

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `start`
- 插件配置: `[createHistoryPlugin()]`
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";
  import { createHistoryPlugin } from "@floatboat/nexus-plugin-history";

  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "start",
    plugins: [createHistoryPlugin()],
  });
  const content = container.querySelector("[contenteditable='true']") as HTMLElement;
  ```

**实现事实与陷阱提示（源码注入）**:
- `createHistoryPlugin(): NexusPlugin` 返回 `{ name: "plugin-history", cmExtensions: [history(), keymap.of(historyKeymap)] }`（`packages/plugin-history/src/index.ts:6-9`）——即 CM6 原生 history 扩展，撤销/重做由 CM6 keymap 处理。
- CM6 的 `Mod` 修饰符在非 Mac 平台解析为 `ctrlKey`；vitest/jsdom 默认 userAgent 不含 Mac，故 `ctrlKey: true` 有效（macOS 需 `metaKey: true`）。
- `[contenteditable='true']` 即 `.cm-content`（CM6 contentDOM），keydown 需带 `bubbles: true, cancelable: true` 才能被 CM6 `domEventHandlers` 捕获。
- 陷阱：`setDocument` 的变更是否进入 history 栈取决于 CM6 事务注解；本用例用 `setDocument("next")` 制造可撤销变更后 dispatch keydown 即可，无需真实键入。

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | `editor.setDocument("next")` | [API] `getDocument() === "next"`（默认非 silent 变更进入 undo 栈） | import: @floatboat/nexus-core + @floatboat/nexus-plugin-history; API: createEditor({ plugins: [createHistoryPlugin()] }) + editor.setDocument("next"); 框架: vitest; 等待: 无 |
| 2 | 向 `[contenteditable='true']` dispatch keydown（`{ key: "z", ctrlKey: true, bubbles: true, cancelable: true }`） | [STATE] `getDocument() === "start"`（CM6 history 撤销恢复上一状态，`historyKeymap` 绑定 Mod-z） | import: @floatboat/nexus-core; API: content.dispatchEvent(new KeyboardEvent("keydown", {...})); 框架: vitest; 等待: 无 |
| 3 | 再 dispatch keydown（`{ key: "y", ctrlKey: true, bubbles: true, cancelable: true }`） | [STATE] `getDocument() === "next"`（CM6 history 重做恢复被撤销的变更，`historyKeymap` 绑定 Mod-y） | import: @floatboat/nexus-core; API: content.dispatchEvent(new KeyboardEvent("keydown", {...})); 框架: vitest; 等待: 无 |

**断言汇总**:
- [STATE] Ctrl+Z 后文档回退为 "start"
- [STATE] Ctrl+Y 后文档恢复为 "next"

## 增强信息来源
- API签名: packages/plugin-history/src/index.ts（createHistoryPlugin 返回 CM6 history 扩展）
- 类型定义: packages/core/src/types.ts（NexusPlugin.cmExtensions）
- 测试参考: packages/vue/test/editor-vue.test.ts（[contenteditable='true'] 选择器来源）
- 陷阱提示: plugin-history/src/index.ts:6-9（history + historyKeymap）、jsdom 平台 Mod 解析为 ctrlKey

---

## FP-07-02-N03 [P1] [N] Search 插件可加载：Mod-f 打开搜索面板

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `alpha beta gamma alpha`
- 插件配置: `[createSearchPlugin()]`
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";
  import { createSearchPlugin } from "@floatboat/nexus-plugin-search";

  const container = document.createElement("div");
  document.body.appendChild(container);
  const editor = createEditor({
    container,
    initialValue: "alpha beta gamma alpha",
    plugins: [createSearchPlugin()],
  });
  const content = container.querySelector(".cm-content") as HTMLElement;
  ```

**实现事实与陷阱提示（源码注入）**:
- `createSearchPlugin(options: SearchPluginOptions = {}): NexusPlugin`（`packages/plugin-search/src/index.ts:1143`）；`SearchPluginOptions = { top?: boolean（默认 true）; caseSensitive?: boolean; highlightSelectionMatches?: boolean }`（`:52-64`）。
- 搜索面板 DOM：`this.dom.dataset.testId = "markdown-search-bar"`（`:931`），输入框 testId 为 `"markdown-search-input"`（`:912`）。
- 陷阱：面板 DOM 由插件挂载到编辑器容器附近（非编辑器内部），断言用 `container.querySelector` 需容器已 `appendChild` 到 `document.body`（setup 中已处理）；Mod-f 在 jsdom 下用 `metaKey: true`（用例用 metaKey）与 `code: "KeyF"`，并需 `bubbles: true, cancelable: true`。

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 向 `.cm-content` dispatch keydown（`{ key: "f", code: "KeyF", metaKey: true, bubbles: true, cancelable: true }`） | [DOM] `container.querySelector('[data-test-id="markdown-search-bar"]')` 不为 null（面板打开，`dataset.testId` 设置于 `:931`） | import: @floatboat/nexus-core + @floatboat/nexus-plugin-search; API: createEditor({ plugins: [createSearchPlugin()] }) + content.dispatchEvent(...); 框架: vitest; 等待: 无 |
| 2 | 检查搜索输入框 | [DOM] `[data-test-id="markdown-search-input"]` 存在（`:912`） | import: @floatboat/nexus-core; API: container.querySelector('[data-test-id="markdown-search-input"]'); 框架: vitest; 等待: 无 |
| 3 | 清理：`editor.destroy()` | [STATE] 不抛异常 | import: @floatboat/nexus-core; API: editor.destroy(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [DOM] 搜索面板（data-test-id="markdown-search-bar"）挂载
- [DOM] 搜索输入框（data-test-id="markdown-search-input"）存在

## 增强信息来源
- API签名: packages/plugin-search/src/index.ts（createSearchPlugin / SearchPluginOptions / testId 常量）
- 类型定义: packages/plugin-search/src/index.ts（SearchPluginOptions）
- 测试参考: 插件面板 DOM testId（plugin-search/src/index.ts:912,931）
- 陷阱提示: plugin-search/src/index.ts:1143（options 默认 {}）、面板需容器挂载到 document.body

---

## FP-07-02-N04 [P2] [N] React `<Editor />` 组件渲染并回调 onReady

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `# Hello`
- 插件配置: 无（react 绑定）
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { render } from "@testing-library/react";
  import type { EditorAPI } from "@floatboat/nexus-core";
  import { Editor } from "@floatboat/nexus-react";

  let ready: EditorAPI | null = null;
  const { container, unmount } = render(
    <Editor
      initialValue="# Hello"
      onReady={(editor) => { ready = editor; }}
    />
  );
  ```

**实现事实与陷阱提示（源码注入）**:
- `@floatboat/nexus-react` 导出 `Editor` / `useEditor` / 类型 `EditorProps` / `UseEditorConfig` / `UseEditorResult`（`packages/react/src/index.ts:1-7`）。
- `EditorProps = UseEditorConfig & EditorContainerAttributes`；`UseEditorConfig = Omit<EditorConfig, "container"> & { onReady?: (editor: EditorAPI) => void; value?: string }`（`packages/react/src/types.ts:7-16,24`）。`Editor` 组件内部 `useEditor(...)` 后渲染 `<div ref={containerRef} />`（`packages/react/src/editor.tsx:26-47`）。
- `onReady` 在编辑器创建后触发一次（`types.ts:8-9` 注释 "Called once after the editor is created on first mount"）；`render` 会 flush effects，同步断言 `ready` 即可。
- 陷阱：`Editor` 不接收 `container` prop（已从 config 剔除）；挂载容器由内部 `containerRef` 管理，断言用 `render` 返回的 `container`。

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 渲染 `<Editor />` 组件 | [DOM] `container.querySelector(".cm-editor")` 不为 null（`<div ref={containerRef} />` 内挂载 CM6，`editor.tsx:47`） | import: @floatboat/nexus-react + @testing-library/react; API: render(<Editor initialValue="# Hello" onReady={...} />); 框架: vitest; 等待: 无 |
| 2 | 断言 onReady 回调 | [API] ready 不为 null，且 `ready.getDocument() === "# Hello"`（onReady 收到可用 `EditorAPI`，`types.ts:9`） | import: @floatboat/nexus-core; API: onReady(editor) + ready.getDocument(); 框架: vitest; 等待: onReady 已触发 |
| 3 | `unmount()` | [DOM] `.cm-editor` 被移除（组件卸载触发内部 destroy，清理挂载 DOM） | import: @testing-library/react; API: unmount(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [DOM] .cm-editor 挂载成功
- [API] onReady 收到可用 EditorAPI 实例
- [DOM] unmount 后 .cm-editor 移除

## 增强信息来源
- API签名: packages/react/src/editor.tsx（Editor 组件）、packages/react/src/use-editor.ts
- 类型定义: packages/react/src/types.ts（EditorProps / UseEditorConfig.onReady）
- 测试参考: packages/react/test/editor-react.test.tsx（render(<Editor initialValue="# Hello" />) 模式）
- 陷阱提示: react/src/types.ts:7-16（container 被 Omit，onReady 只触发一次）

---

## FP-07-02-N05 [P2] [N] React useEditor hook 暴露命令式 EditorAPI

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `start`
- 插件配置: 无（react 绑定）
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { render } from "@testing-library/react";
  import { useEffect } from "react";
  import { useEditor } from "@floatboat/nexus-react";

  const snapshots: string[] = [];
  function Harness() {
    const { containerRef, editor } = useEditor({ initialValue: "start" });
    useEffect(() => {
      if (!editor) return;
      editor.setDocument("updated");
      snapshots.push(editor.getDocument());
    }, [editor]);
    return <div ref={containerRef} />;
  }
  render(<Harness />);
  ```

**实现事实与陷阱提示（源码注入）**:
- `useEditor(config): UseEditorResult`，`UseEditorResult = { containerRef: RefObject<HTMLDivElement | null>; editor: EditorAPI | null }`（`packages/react/src/types.ts:26-29`）；`editor` 初始为 null，创建完成后赋值 `EditorAPI`。
- `UseEditorConfig = Omit<EditorConfig, "container">`（`types.ts:7`），`useEditor({ initialValue })` 直接透传核心配置。
- 陷阱：`editor` 非空前不能调用命令式 API，必须在依赖 `[editor]` 的 effect 中守卫（用例已用 `if (!editor) return;`）；`render(<Harness />)` 同步 flush effects，断言 snapshots 无需额外等待。

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 渲染使用 useEditor 的组件 | [STATE] editor 实例在 effect 中可用（snapshots 非空；editor 创建后从 null 变为 EditorAPI，`types.ts:26-29`） | import: @floatboat/nexus-react + @testing-library/react; API: render(<Harness />) + useEditor({ initialValue: "start" }); 框架: vitest; 等待: 无 |
| 2 | 断言命令式 API 效果 | [API] `snapshots` 包含 "updated"（setDocument/getDocument 经 hook 暴露的 EditorAPI 生效） | import: @floatboat/nexus-core; API: editor.setDocument("updated") + editor.getDocument(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [API] snapshots 包含 "updated"

## 增强信息来源
- API签名: packages/react/src/use-editor.ts（useEditor）、packages/react/src/index.ts（导出）
- 类型定义: packages/react/src/types.ts（UseEditorResult / UseEditorConfig）
- 测试参考: packages/react/test/editor-react.test.tsx（Harness + useEditor 模式）
- 陷阱提示: react/src/types.ts:26-29（editor 初始 null，需 effect 守卫）

---

## FP-07-02-N06 [P2] [N] Vue `<Editor />` 组件挂载与卸载清理

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `# Hello`
- 插件配置: 无（vue 绑定）
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { mount } from "@vue/test-utils";
  import { Editor } from "@floatboat/nexus-vue";

  const wrapper = mount(Editor, { props: { initialValue: "# Hello" } });
  ```

**实现事实与陷阱提示（源码注入）**:
- `@floatboat/nexus-vue` 导出 `Editor` / `useEditor` / 类型 `EditorProps` / `UseEditorConfig` / `UseEditorResult`（`packages/vue/src/index.ts:1-7`）。
- 既有测试模式：`mount(Editor, { props: { initialValue } })` 后需 `await nextTick()` 再断言；`wrapper.unmount()` 后 `wrapper.element.querySelector(".cm-editor")` 为 null（`packages/vue/test/editor-vue.test.ts:8-23`）。
- 陷阱：Vue 挂载后 DOM 是异步渲染的，断言前必须 `await nextTick()`；`[contenteditable='true']` 即 CM6 contentDOM（`.cm-content`）。

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 挂载 `<Editor />` 组件 | [DOM] `await nextTick()` 后 `wrapper.element.querySelector(".cm-editor")` 不为 null，`[contenteditable='true']` 存在（CM6 contentDOM，`editor-vue.test.ts:15-18`） | import: @floatboat/nexus-vue + @vue/test-utils; API: mount(Editor, { props: { initialValue: "# Hello" } }); 框架: vitest; 等待: nextTick |
| 2 | `wrapper.unmount()` | [DOM] `.cm-editor` 被移除（querySelector 为 null，卸载清理，`editor-vue.test.ts:20-22`） | import: @vue/test-utils; API: wrapper.unmount(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [DOM] 挂载后 .cm-editor 与编辑区存在
- [DOM] unmount 后 .cm-editor 移除

## 增强信息来源
- API签名: packages/vue/src/index.ts（导出）、packages/vue/src/editor.ts
- 类型定义: packages/vue/src/types.ts（EditorProps）
- 测试参考: packages/vue/test/editor-vue.test.ts:8-23（mount + nextTick + unmount 模式）
- 陷阱提示: vue/test/editor-vue.test.ts（await nextTick 后再断言 DOM）

---

## FP-07-02-F01 [P2] [F] React 受控 value 外部更新同步且无回环

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: 受控 value = "v1"
- 插件配置: 无（react 绑定受控模式）
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { render } from "@testing-library/react";
  import { act, useState } from "react";
  import { Editor } from "@floatboat/nexus-react";

  function Harness() {
    const [value, setValue] = useState("v1");
    return <Editor value={value} onChange={(doc) => setValue(doc)} />;
  }
  const { container } = render(<Harness />);
  ```

**实现事实与陷阱提示（源码注入）**:
- 受控模式：`value` 存在时父组件持有文档字符串，`onChange(doc)` 回灌（`UseEditorConfig.value?: string`，`packages/react/src/types.ts:11-16`）；外部更新经 **silent `setDocument`** 应用以避免反馈循环（types.ts 注释 + `editor.ts:413,433` silentDocChange 注解）。
- 断言编辑区文本用 `.cm-content` 的 textContent（CM6 contentDOM），比 `getDocument()` 更贴近"编辑区文本"语义；`act(() => setValue("v2"))` 包住状态更新以 flush React 渲染。
- 陷阱：若 onChange 回灌导致 value 再变会形成循环，本用例验证的是 silent setDocument 切断回环（更新不回灌 onChange）。

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 初始渲染受控 value="v1" | [API] `.cm-content` textContent 包含 "v1"（受控初始值生效） | import: @floatboat/nexus-react + @testing-library/react; API: render(<Editor value="v1" onChange={...} />); 框架: vitest; 等待: 无 |
| 2 | `act(() => setValue("v2"))` | [STATE] `.cm-content` 文本更新为 "v2"（外部受控更新经 silent setDocument 应用，`react/src/types.ts:11-16`） | import: react; API: act(() => setValue("v2")); 框架: vitest; 等待: 无 |
| 3 | 检查回环 | [STATE] 文档保持 "v2"（onChange→setValue 不产生反馈循环；silent 变更不回灌 onChange，`editor.ts:413,433`） | import: @floatboat/nexus-core; API: container.querySelector(".cm-content").textContent; 框架: vitest; 等待: 无 |

**断言汇总**:
- [API] 受控更新后编辑区文本为 "v2"
- [STATE] 更新稳定无回环（文档未被重置）

## 增强信息来源
- API签名: packages/react/src/editor.tsx（value 透传）、packages/core/src/editor.ts（silent setDocument）
- 类型定义: packages/react/src/types.ts（UseEditorConfig.value 注释）
- 测试参考: packages/react/test/editor-react.test.tsx（受控 value rerender 模式，:110-116,210-220）
- 陷阱提示: react/src/types.ts:11-16（silent setDocument 防回环）、editor.ts:413,433（silentDocChange）

---

## FP-07-02-E01 [P3] [E] React 组件缺省 onReady/受控 value 时正常渲染（非受控模式）

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `hello`
- 插件配置: 无（react 绑定，非受控）
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { render } from "@testing-library/react";
  import { Editor } from "@floatboat/nexus-react";

  const { container, unmount } = render(<Editor initialValue="hello" />);
  ```

**实现事实与陷阱提示（源码注入）**:
- `onReady`/`value` 均为可选（`UseEditorConfig` 可选字段，`packages/react/src/types.ts:7-16`），非受控模式仅用 `initialValue`；`Editor` 内部 `useEditor({ initialValue })` 正常创建编辑器。
- 断言编辑区文本：`.cm-content` textContent 包含 "hello"（initialValue 进入 EditorState，`editor.ts:546`）。

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 渲染无 onReady/无 value 的 `<Editor />` | [STATE] 渲染过程不抛异常（可选 prop 缺省安全） | import: @floatboat/nexus-react + @testing-library/react; API: render(<Editor initialValue="hello" />); 框架: vitest; 等待: 无 |
| 2 | 检查挂载 | [DOM] `.cm-editor` 存在，`.cm-content` 文本包含 "hello"（initialValue 生效，`editor.ts:546`） | import: @floatboat/nexus-core; API: container.querySelector(".cm-content").textContent; 框架: vitest; 等待: 无 |
| 3 | `unmount()` | [STATE] 卸载过程不抛异常（内部 destroy 清理） | import: @testing-library/react; API: unmount(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [STATE] 非受控模式渲染/卸载不抛异常
- [DOM] .cm-editor 挂载且初始文档生效

## 增强信息来源
- API签名: packages/react/src/editor.tsx（可选 props 透传）
- 类型定义: packages/react/src/types.ts（UseEditorConfig 全部可选）
- 测试参考: packages/react/test/editor-react.test.tsx（非受控 render 模式）
- 陷阱提示: react/src/types.ts:7-16（onReady/value 可选）

---

## FP-07-02-E02 [P3] [E] GFM + History + Search 三插件共存互不冲突

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `| a | b |\n| - | - |\n| 1 | 2 |`
- 插件配置: `[createGfmPreset(), createHistoryPlugin(), createSearchPlugin()]`
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";
  import { createGfmPreset } from "@floatboat/nexus-preset-gfm";
  import { createHistoryPlugin } from "@floatboat/nexus-plugin-history";
  import { createSearchPlugin } from "@floatboat/nexus-plugin-search";

  const container = document.createElement("div");
  document.body.appendChild(container);
  const editor = createEditor({
    container,
    initialValue: "| a | b |\n| - | - |\n| 1 | 2 |",
    plugins: [createGfmPreset(), createHistoryPlugin(), createSearchPlugin()],
  });
  ```

**实现事实与陷阱提示（源码注入）**:
- 三个插件均为 `NexusPlugin`：`createGfmPreset()` 提供 `remarkPlugins`（transform 管线），`createHistoryPlugin()` 提供 `cmExtensions: [history(), keymap.of(historyKeymap)]`，`createSearchPlugin()` 提供 CM6 search 扩展——分别作用在 transform 阶段与 CM6 扩展阶段，互不冲突（`packages/preset-gfm/src/index.ts:5-8`、`packages/plugin-history/src/index.ts:6-9`、`packages/plugin-search/src/index.ts:1143`）。
- 插件数组顺序即 `plugins: NexusPlugin[]`（`types.ts:85`），无合并冲突。
- 陷阱：Search 面板断言前容器需在 `document.body` 中（setup 已处理）；History 撤销用 `ctrlKey`（jsdom 非 Mac 平台 Mod = ctrl）。

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 三插件同时加载创建编辑器 | [STATE] 创建过程不抛异常（三插件分别作用于不同扩展阶段） | import: @floatboat/nexus-core + @floatboat/nexus-preset-gfm + @floatboat/nexus-plugin-history + @floatboat/nexus-plugin-search; API: createEditor({ plugins: [createGfmPreset(), createHistoryPlugin(), createSearchPlugin()] }); 框架: vitest; 等待: 无 |
| 2 | 读取 AST | [AST] `children[0].type === "table"`（GFM transform 生效，`editor.ts:277-280`） | import: @floatboat/nexus-core; API: editor.getAst(); 框架: vitest; 等待: 无 |
| 3 | 向 `.cm-content` dispatch Mod-f keydown | [DOM] `[data-test-id="markdown-search-bar"]` 存在（Search 生效，`plugin-search:931`） | import: @floatboat/nexus-core; API: content.dispatchEvent(new KeyboardEvent("keydown", { key: "f", code: "KeyF", metaKey: true, bubbles: true, cancelable: true })); 框架: vitest; 等待: 无 |
| 4 | 向 `[contenteditable='true']` dispatch Ctrl+Z keydown | [STATE] 文档回退到上一状态（History 生效，三插件无冲突） | import: @floatboat/nexus-core; API: content.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true })); 框架: vitest; 等待: 无 |

**断言汇总**:
- [STATE] 三插件共存创建不抛异常
- [AST] GFM 表格解析生效
- [DOM] Search 面板可打开
- [STATE] History 撤销生效

## 增强信息来源
- API签名: packages/preset-gfm/src/index.ts / packages/plugin-history/src/index.ts / packages/plugin-search/src/index.ts（三个工厂函数）
- 类型定义: packages/core/src/types.ts（NexusPlugin / EditorConfig.plugins）
- 测试参考: packages/core/test/live-preview.test.ts（多插件组合）
- 陷阱提示: 三插件作用阶段不同（transform vs cmExtensions），顺序无关；Search 需容器在 body

---

## FP-07-02-D01 [P4] [D] TypeScript 类型定义导出可用（编译期契约）

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom（类型检查为主，运行时仅验证形状）
- 初始文档: `type check`
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import {
    createEditor,
    type EditorAPI,
    type EditorConfig,
    type WidgetDefinition,
  } from "@floatboat/nexus-core";
  import type { EditorProps } from "@floatboat/nexus-react";
  import type { SearchPluginOptions } from "@floatboat/nexus-plugin-search";

  // 类型契约在编译期校验（strict 模式）；运行时仅验证 API 形状
  const editor: EditorAPI = createEditor({
    container: document.createElement("div"),
    initialValue: "type check",
  });
  const widget: WidgetDefinition = {
    nodeType: "code",
    render: () => document.createElement("div"),
  };
  const props: EditorProps = { initialValue: "x" };
  const searchOptions: SearchPluginOptions = { top: false, caseSensitive: true };
  ```

**实现事实与陷阱提示（源码注入）**:
- 类型导出确认：`EditorAPI` / `EditorConfig` / `WidgetDefinition` 均从 `@floatboat/nexus-core` 导出（`packages/core/src/index.ts:31-58`）；`EditorProps` 从 `@floatboat/nexus-react` 导出（`packages/react/src/index.ts:2-6`）；`SearchPluginOptions` 从 `@floatboat/nexus-plugin-search` 导出（`packages/plugin-search/src/index.ts:52`）。
- `WidgetDefinition` 必填字段为 `nodeType: string` + `render: (node, source, ctx?) => HTMLElement`（`types.ts:322-326`），`match`/`destroy`/`block`/`ignoreEvents` 可选（`types.ts:324,326-341`）。
- `SearchPluginOptions = { top?: boolean; caseSensitive?: boolean; highlightSelectionMatches?: boolean }`（`plugin-search:52-64`），用例字面量合法。
- 陷阱：`WidgetDefinition.render` 必须返回 HTMLElement，返回字符串/数字会类型报错；`EditorProps` 不含 `container`（已被 Omit）。

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 以 EditorAPI 类型接收 createEditor 返回值 | [STATE] TS 编译通过（strict 下无类型错误；`createEditor` 返回类型即 `EditorAPI`） | import: @floatboat/nexus-core; API: const editor: EditorAPI = createEditor({ container, initialValue }); 框架: vitest; 等待: 无 |
| 2 | 构造 WidgetDefinition 字面量 | [STATE] 编译通过（nodeType/render 必填契约成立，`types.ts:322-326`） | import: @floatboat/nexus-core; API: const widget: WidgetDefinition = { nodeType: "code", render }; 框架: vitest; 等待: 无 |
| 3 | 构造 EditorProps / SearchPluginOptions | [STATE] 编译通过（react/plugin 类型包导出可用；`top/caseSensitive` 均为合法字段） | import: @floatboat/nexus-react + @floatboat/nexus-plugin-search; API: 类型标注; 框架: vitest; 等待: 无 |
| 4 | 运行时验证 | [API] `editor.getDocument() === "type check"`（`view.state.doc.toString()`） | import: @floatboat/nexus-core; API: editor.getDocument(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [STATE] 编译期类型契约成立（Vitest 编译即验证）
- [API] editor.getDocument() === "type check"

## 增强信息来源
- API签名: packages/core/src/index.ts（类型导出清单）、packages/react/src/index.ts、packages/plugin-search/src/index.ts
- 类型定义: packages/core/src/types.ts（WidgetDefinition）、packages/react/src/types.ts（EditorProps）、packages/plugin-search/src/index.ts（SearchPluginOptions）
- 测试参考: 各包 test 文件类型导入模式
- 陷阱提示: types.ts:322-341（WidgetDefinition 必填/可选字段）、react/types.ts:24（EditorProps 无 container）

---

## FP-07-03-N01 [P1] [N] 自定义 Widget 渲染并自动打上 data-nexus-widget 标记

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `Text\n\n```js\nconsole.log(1)\n````
- 插件配置: `[{ name: "code-widget", widgets: [codeWidget] }]`
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";

  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "Text\n\n```js\nconsole.log(1)\n```",
    plugins: [
      {
        name: "code-widget",
        widgets: [
          {
            nodeType: "code",
            render(_node, source) {
              const el = document.createElement("div");
              el.setAttribute("data-widget", "code");
              el.textContent = source;
              return el;
            },
          },
        ],
      },
    ],
  });
  ```

**实现事实与陷阱提示（源码注入）**:
- Widget 经 `plugins: [{ name, widgets: WidgetDefinition[] }]` 注入（`NexusPlugin.widgets`，`types.ts:397`）；渲染基于 CM6 `Decoration.replace`（`widget-extension.ts:161-174`）。
- 渲染元素自动带标记：`el.setAttribute("data-nexus-widget", this.definition.nodeType)`（`widget-extension.ts:137`）——故 `data-nexus-widget === "code"`（nodeType 原样）。
- render 的 `source` 参数是 widget 源码范围的原始 markdown 切片 `doc.slice(from, to)`（`widget-extension.ts:81`），对代码块即 "```js\nconsole.log(1)\n```"。
- 匹配条件：`w.nodeType === child.type && (!w.match || w.match(child))`（`widget-extension.ts:72-74`）。
- 陷阱：`data-nexus-widget` 是框架自动附加的，不要在 render 里手动设置（会被覆盖为 nodeType）；与用例自设的 `data-widget` 是不同属性，两者不冲突。

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 创建编辑器 | [DOM] `container.querySelector("[data-widget='code']")` 不为 null（code 类型命中并渲染，`widget-extension.ts:72-76`） | import: @floatboat/nexus-core; API: createEditor({ plugins: [{ name, widgets: [{ nodeType: "code", render }] }] }); 框架: vitest; 等待: 无 |
| 2 | 检查框架标记 | [DOM] 该元素 `data-nexus-widget === "code"`（框架自动附加 = nodeType，`widget-extension.ts:137`） | import: @floatboat/nexus-core; API: container.querySelector("[data-widget='code']").getAttribute("data-nexus-widget"); 框架: vitest; 等待: 无 |
| 3 | 检查渲染内容 | [DOM] 元素 textContent 包含 "console.log(1)"（源码切片 `doc.slice(from, to)` 透传给 render，`widget-extension.ts:81`） | import: @floatboat/nexus-core; API: element.textContent; 框架: vitest; 等待: 无 |
| 4 | 清理：`editor.destroy()` | [STATE] 不抛异常 | import: @floatboat/nexus-core; API: editor.destroy(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [DOM] widget 元素挂载且内容为源码
- [DOM] data-nexus-widget === "code"

## 增强信息来源
- API签名: packages/core/src/widget-extension.ts（collectWidgetRanges / NexusWidget.toDOM）
- 类型定义: packages/core/src/types.ts（WidgetDefinition / NexusPlugin.widgets）
- 测试参考: packages/core/test/widgets.test.ts:5-33（widget setup 与断言模式）
- 陷阱提示: widget-extension.ts:137（自动附加 data-nexus-widget）、widget-extension.ts:81（source 为源码切片）

---

## FP-07-03-N02 [P1] [N] 多个 Widget 注册共存互不干扰

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `Text\n\n```js\nconst a = 1\n```\n\nInline `code` here`
- 插件配置: `[{ name: "multi-widget", widgets: [codeWidget, inlineWidget] }]`
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";

  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "Text\n\n```js\nconst a = 1\n```\n\nInline `code` here",
    plugins: [
      {
        name: "multi-widget",
        widgets: [
          {
            nodeType: "code",
            render() {
              const el = document.createElement("div");
              el.setAttribute("data-widget", "code");
              return el;
            },
          },
          {
            nodeType: "inlineCode",
            block: false,
            render() {
              const el = document.createElement("span");
              el.setAttribute("data-widget", "inline");
              return el;
            },
          },
        ],
      },
    ],
  });
  editor.setSelection(editor.getDocument().length);
  ```

**实现事实与陷阱提示（源码注入）**:
- 同一插件 `widgets` 数组可注册多个 `WidgetDefinition`，`collectWidgetRanges` 按节点类型逐节点匹配（`widget-extension.ts:66-92`），互不干扰。
- 行内类型 `inlineCode` 必须设 `block: false`，否则默认 `block !== false`（`widget-extension.ts:162`）会被提升为独立行（`types.ts:327-333` 注释）。
- 光标移出所有 widget 范围后两者同时渲染（`selectionIntersects` 判定，`widget-extension.ts:76`）。
- 陷阱：`data-nexus-widget` 值为 nodeType（"code"/"inlineCode"），与用例自设的 `data-widget` 值（"code"/"inline"）不同，断言时注意区分。

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 光标移到文档末尾后检查 | [DOM] `[data-widget='code']` 与 `[data-widget='inline']` 同时存在（两个 widget 并行渲染，`widget-extension.ts:66-92`） | import: @floatboat/nexus-core; API: container.querySelectorAll("[data-widget]"); 框架: vitest; 等待: 无 |
| 2 | 检查各自标记 | [DOM] 两元素 `data-nexus-widget` 分别为 "code" 与 "inlineCode"（= 各自 nodeType，`widget-extension.ts:137`） | import: @floatboat/nexus-core; API: el.getAttribute("data-nexus-widget"); 框架: vitest; 等待: 无 |
| 3 | 验证互不干扰 | [STATE] 两个 widget 同时渲染、内容各自独立（无相互替换/冲突；collectWidgetRanges 独立匹配各节点） | import: @floatboat/nexus-core; API: container.querySelectorAll("[data-widget]").length; 框架: vitest; 等待: 无 |

**断言汇总**:
- [DOM] code 与 inlineCode 两个 widget 均渲染
- [DOM] data-nexus-widget 标记与 nodeType 一一对应

## 增强信息来源
- API签名: packages/core/src/widget-extension.ts（collectWidgetRanges / block 判定）
- 类型定义: packages/core/src/types.ts（WidgetDefinition.block / ignoreEvents）
- 测试参考: packages/core/test/widgets.test.ts（多 widget 注册模式）
- 陷阱提示: widget-extension.ts:162（block 默认 true，行内类型必须显式 false）、types.ts:327-341（block/ignoreEvents 语义）

---

## FP-07-03-N03 [P2] [F] Widget 交互流程：ctx.setSelection/focus 将光标带回源码编辑态

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `Text\n\n```js\nconsole.log(1)\n````
- 插件配置: `[{ name: "code-widget", widgets: [{ nodeType: "code", render: 带编辑按钮 }] }]`
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor, type WidgetRenderContext } from "@floatboat/nexus-core";

  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "Text\n\n```js\nconsole.log(1)\n```",
    plugins: [
      {
        name: "code-widget",
        widgets: [
          {
            nodeType: "code",
            render(_node, _source, ctx?: WidgetRenderContext) {
              const el = document.createElement("button");
              el.setAttribute("data-edit", "true");
              el.addEventListener("click", () => {
                if (ctx) {
                  ctx.setSelection(ctx.from, ctx.from + 1);
                  ctx.focus();
                }
              });
              return el;
            },
          },
        ],
      },
    ],
  });
  ```

**实现事实与陷阱提示（源码注入）**:
- `WidgetRenderContext = { from: number; to: number; setSelection: (anchor, head?) => void; focus: () => void }`（`types.ts:311-320`）；`from`/`to` 为 widget 源码范围绝对偏移（`types.ts:313,315`）。
- `ctx.setSelection` 实现为 `v.dispatch({ selection: { anchor: safeAnchor, head: safeHead } })`，并做 `[0, doc.length]` clamp（`widget-extension.ts:123-131`）；`ctx.focus` 为 `viewRef.current?.focus()`（`:132-134`）。
- 光标进入源码范围后 `selectionIntersects` 返回 true（`widget-extension.ts:76`），widget 装饰让位，原始 markdown（含 "```js"）重新可见可编辑。
- 陷阱：`ctx` 仅在 render 第三个参数传入（不传时 `ctx` 为 undefined，既有 render 函数不受影响——`types.ts:309-310` 注释）；断言 anchor 应为 `ctx.from`（用例设为 `from + 1` 亦可，只要落入 [from, to) 范围）。

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 确认 widget 已渲染 | [DOM] `[data-edit='true']` 存在（button 渲染成功） | import: @floatboat/nexus-core; API: createEditor({ plugins: [{ widgets: [{ nodeType: "code", render(_n, _s, ctx?) }] }] }); 框架: vitest; 等待: 无 |
| 2 | 点击编辑按钮 | [EVENT] click 触发 `ctx.setSelection(ctx.from, ctx.from + 1)`：`getSelection().anchor === ctx.from`（`setSelection` 经 `view.dispatch({ selection })`，`widget-extension.ts:123-131`） | import: @floatboat/nexus-core; API: el.dispatchEvent(new MouseEvent("click", { bubbles: true })) + editor.getSelection(); 框架: vitest; 等待: 无 |
| 3 | 光标进入 widget 源码范围 | [DOM] `[data-edit='true']` 消失（回退 markdown 编辑态），container.textContent 含 "```js"（`selectionIntersects` 让 widget 让位，`widget-extension.ts:76`） | import: @floatboat/nexus-core; API: container.textContent; 框架: vitest; 等待: 无 |

**断言汇总**:
- [API] 点击后 getSelection().anchor === widget 源码范围起点
- [DOM] 点击后 widget 消失、源码可见（可编辑）

## 增强信息来源
- API签名: packages/core/src/widget-extension.ts（WidgetRenderContext 实现：setSelection/focus）
- 类型定义: packages/core/src/types.ts（WidgetRenderContext）
- 测试参考: packages/core/test/widgets.test.ts（widget 交互断言模式）
- 陷阱提示: widget-extension.ts:123-134（setSelection clamp + focus）、widget-extension.ts:76（光标相交回退）

---

## FP-07-03-N04 [P2] [N] parseDelayMs 配置 IO 解析防抖：窗口内合并、窗口后触发一次

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `# Hello`
- 插件配置: 无（`parseDelayMs: 100`）
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";
  import { afterEach, vi } from "vitest";

  vi.useFakeTimers();
  const container = document.createElement("div");
  const onChange = vi.fn();
  const editor = createEditor({
    container,
    initialValue: "# Hello",
    parseDelayMs: 100,
    onChange,
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  ```

**实现事实与陷阱提示（源码注入）**:
- `parseDelayMs = config.parseDelayMs ?? 0`（`editor.ts:282`）；`scheduleChange` 语义：已有 `parseTimer` 先 `clearTimeout` 重置（`editor.ts:347-350`），`parseDelayMs <= 0` 直接同步 `emitChange`（`:352-355`），否则 `setTimeout(() => emitChange(markdown), parseDelayMs)`（`:357-360`）。
- `onChange` 载荷为 `(markdown, currentAst)`（`editor.ts:342`）。
- 时序：t=0 setDocument("# A") → timer(100)；t=50 setDocument("# B") → clearTimeout + 新 timer(100)；t=150 timer 触发 → emitChange("# B") 一次。
- 陷阱：必须 `vi.useFakeTimers()` 在 createEditor 之前（setup 已满足）；`vi.advanceTimersByTime` 不会执行微任务，mock 断言直接查 `onChange.mock.calls.length`；测试结束用 `afterEach(() => vi.useRealTimers())` 还原，防止污染其他用例。

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | `editor.setDocument("# A")` | [EVENT] onChange 未立即触发（防抖窗口内不回调；`setTimeout(…, 100)` 挂起，`editor.ts:357-360`） | import: @floatboat/nexus-core + vitest; API: editor.setDocument("# A") + onChange.mock.calls.length; 框架: vitest; 等待: 无 |
| 2 | `vi.advanceTimersByTime(50)` 后 `editor.setDocument("# B")` | [EVENT] [CALC] 窗口内再次编辑重置计时（t=50 触发 `clearTimeout` + 新 timer(100)，`editor.ts:347-350`），onChange 仍未触发（合并语义） | import: vitest; API: vi.advanceTimersByTime(50) + editor.setDocument("# B"); 框架: vitest; 等待: 无 |
| 3 | `vi.advanceTimersByTime(100)` | [EVENT] [CALC] t=150 timer 触发，onChange 恰好被调用 1 次，末次载荷 doc === "# B"（防抖合并为一次解析，载荷 (markdown, currentAst)，`editor.ts:342,357-360`） | import: vitest; API: vi.advanceTimersByTime(100) + onChange.mock.calls; 框架: vitest; 等待: advanceTimersByTime(100) |
| 4 | 恢复真实计时器 | [STATE] `vi.useRealTimers()` 执行无异常（afterEach 兜底还原） | import: vitest; API: vi.useRealTimers(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [EVENT] 防抖窗口内 onChange 调用次数为 0
- [EVENT] 窗口结束后 onChange 调用 1 次且 doc === "# B"

## 增强信息来源
- API签名: packages/core/src/editor.ts（parseDelayMs 默认 0 / scheduleChange 防抖逻辑）
- 类型定义: packages/core/src/types.ts（EditorConfig.parseDelayMs）
- 测试参考: packages/core/test/live-preview.test.ts（fake timers + parseDelayMs 模式）
- 陷阱提示: editor.ts:347-360（clearTimeout 重置 + setTimeout 触发）、vi.useFakeTimers 需在 createEditor 前

---

## FP-07-03-E01 [P3] [E] 光标进入 Widget 源码范围时回退原始 markdown

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `Text\n\n```js\nconsole.log(1)\n````
- 插件配置: `[{ name: "code-widget", widgets: [{ nodeType: "code", render: 渲染 data-widget='code' }] }]`
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";

  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "Text\n\n```js\nconsole.log(1)\n```",
    plugins: [
      {
        name: "code-widget",
        widgets: [
          {
            nodeType: "code",
            render() {
              const el = document.createElement("div");
              el.setAttribute("data-widget", "code");
              return el;
            },
          },
        ],
      },
    ],
  });
  ```

**实现事实与陷阱提示（源码注入）**:
- 回退逻辑：`collectWidgetRanges` 中 `if (matched && !selectionIntersects(from, to, selection))` 才生成 widget（`widget-extension.ts:76`）；`selectionIntersects` 判定选区 `[min(anchor,head), max(anchor,head))` 与源码范围 `[from, to)` 是否相交（`widget-extension.ts:28-35`）。
- 文档 "Text\n\n```js\nconsole.log(1)\n```" 中代码块源码范围约 [6, 33)，光标位置 10 落入范围内。
- 陷阱：断言 widget 消失要用 `querySelector` 判 null；注意 widget 由 StateField 在事务后重建，`setSelection` dispatch 后同步生效。

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 初始状态（光标在文档头部，widget 源码范围之外） | [DOM] `[data-widget='code']` 不为 null（widget 渲染，光标不相交，`widget-extension.ts:76`） | import: @floatboat/nexus-core; API: container.querySelector("[data-widget='code']"); 框架: vitest; 等待: 无 |
| 2 | `editor.setSelection(10)`（光标落入代码块范围内） | [DOM] `[data-widget='code']` 为 null（光标与源码范围相交，`selectionIntersects` 让 widget 让位，`widget-extension.ts:28-35,76`） | import: @floatboat/nexus-core; API: editor.setSelection(10); 框架: vitest; 等待: 无 |
| 3 | 检查源码还原 | [DOM] container.textContent 包含 "```js"（原始 markdown 完整可见可编辑） | import: @floatboat/nexus-core; API: container.textContent; 框架: vitest; 等待: 无 |

**断言汇总**:
- [DOM] 光标进入前 widget 渲染
- [DOM] 光标进入范围后 widget 消失、源码还原

## 增强信息来源
- API签名: packages/core/src/widget-extension.ts（selectionIntersects / collectWidgetRanges）
- 类型定义: packages/core/src/types.ts（WidgetDefinition）
- 测试参考: packages/core/test/widgets.test.ts:35-54（restores raw markdown when cursor intersects）
- 陷阱提示: widget-extension.ts:28-35（选区相交判定）、widget-extension.ts:76（相交则不渲染）

---

## FP-07-03-E02 [P3] [E] Widget nodeType 无匹配节点时静默不渲染

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `Text\n\n```js\nconsole.log(1)\n```\n\n> quote`
- 插件配置: `[{ name: "quote-widget", widgets: [{ nodeType: "blockquote", ... }] }]`（文档无 blockquote 匹配之外的顾虑，代码块不匹配）
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";

  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "Text\n\n```js\nconsole.log(1)\n```\n\n> quote",
    plugins: [
      {
        name: "quote-widget",
        widgets: [
          {
            nodeType: "code", // 故意注册一个文档中“部分匹配”的类型，配合 blockquote 场景
            render() {
              const el = document.createElement("div");
              el.setAttribute("data-widget", "code");
              return el;
            },
          },
        ],
      },
    ],
  });
  editor.setSelection(editor.getDocument().length);
  ```

**实现事实与陷阱提示（源码注入）**:
- 匹配是精确的 `w.nodeType === child.type`（`widget-extension.ts:72-73`）：注册 `code` 只命中 code 节点，`blockquote` 节点无注册 widget 时保持源码原样。
- `collectWidgetRanges` 对未匹配节点只是跳过（不 push range），无任何副作用（`widget-extension.ts:76-92`）。
- 陷阱：本用例故意注册 `code` 而非 `blockquote`，验证的是"未注册类型保持源码 + 已注册类型正常渲染"的双向行为；文档 `> quote` 无 blockquote 类型 widget 注册，故保持源码。

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 光标移开代码块后检查代码块 widget | [DOM] `[data-widget='code']` 不为 null（code 类型命中，`widget-extension.ts:72-73`） | import: @floatboat/nexus-core; API: container.querySelector("[data-widget='code']"); 框架: vitest; 等待: 无 |
| 2 | 验证 blockquote 未被误替换 | [DOM] container.textContent 包含 "> quote"（无 blockquote 类型 widget 时源码保留） | import: @floatboat/nexus-core; API: container.textContent; 框架: vitest; 等待: 无 |
| 3 | 验证无匹配类型静默 | [STATE] 创建/渲染过程不抛异常（未匹配节点被安全跳过，`widget-extension.ts:76-92`） | import: @floatboat/nexus-core; API: createEditor(...); 框架: vitest; 等待: 无 |

**断言汇总**:
- [DOM] 命中 nodeType 的 widget 渲染
- [DOM] 未注册 nodeType 的节点保持源码
- [STATE] 无匹配时静默不报错

## 增强信息来源
- API签名: packages/core/src/widget-extension.ts（nodeType 精确匹配 / 未匹配跳过）
- 类型定义: packages/core/src/types.ts（WidgetDefinition.nodeType）
- 测试参考: packages/core/test/widgets.test.ts
- 陷阱提示: widget-extension.ts:72-73（nodeType 精确匹配，无通配）

---

## FP-07-03-E03 [P3] [E] match 谓词精细过滤：仅替换符合条件的节点

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `Text\n\n```mermaid\ngraph LR\n```\n\n```js\nconsole.log(1)\n````
- 插件配置: `[{ name: "mermaid-widget", widgets: [{ nodeType: "code", match: lang === "mermaid" }] }]`
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";

  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "Text\n\n```mermaid\ngraph LR\n```\n\n```js\nconsole.log(1)\n```",
    plugins: [
      {
        name: "mermaid-widget",
        widgets: [
          {
            nodeType: "code",
            match: (node: any) => node.lang === "mermaid",
            render() {
              const el = document.createElement("div");
              el.setAttribute("data-widget", "mermaid");
              return el;
            },
          },
        ],
      },
    ],
  });
  ```

**实现事实与陷阱提示（源码注入）**:
- 匹配条件：`w.nodeType === child.type && (!w.match || w.match(child))`（`widget-extension.ts:72-74`）——`match` 谓词在 nodeType 命中后二次过滤，`match(child)` 收到的是 mdast 节点本身。
- 两个 code 节点都有 `lang` 字段（"mermaid"/"js"），`match` 返回 false 的节点不生成 widget，源码保留。
- 陷阱：`match` 签名 `(node: any) => boolean`（`types.ts:324`），node 即 AST 节点，`lang` 直接取 `node.lang`；不需要处理 source 字符串。

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 检查 mermaid 代码块 | [DOM] `[data-widget='mermaid']` 不为 null（nodeType === "code" 且 `match(node)` 返回 true 命中，`widget-extension.ts:72-74`） | import: @floatboat/nexus-core; API: container.querySelector("[data-widget='mermaid']"); 框架: vitest; 等待: 无 |
| 2 | 检查 js 代码块 | [DOM] container.textContent 包含 "console.log(1)"（match 返回 false 的节点不被替换，源码保留） | import: @floatboat/nexus-core; API: container.textContent; 框架: vitest; 等待: 无 |

**断言汇总**:
- [DOM] mermaid 代码块被 widget 渲染
- [DOM] js 代码块保持源码（match 谓词过滤生效）

## 增强信息来源
- API签名: packages/core/src/widget-extension.ts（match 谓词调用位置）
- 类型定义: packages/core/src/types.ts（WidgetDefinition.match）
- 测试参考: packages/core/test/widgets.test.ts（match 谓词用例）
- 陷阱提示: widget-extension.ts:72-74（match 在 nodeType 命中后调用，参数为 AST 节点）

---

## FP-07-03-E04 [P3] [E] 非法 Widget 定义（nodeType 空串）不崩溃且无替换

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `Text\n\n```js\nconsole.log(1)\n````
- 插件配置: `[{ name: "bad-widget", widgets: [{ nodeType: "" }] }]`
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";

  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "Text\n\n```js\nconsole.log(1)\n```",
    plugins: [
      {
        name: "bad-widget",
        widgets: [
          {
            nodeType: "",
            render() {
              const el = document.createElement("div");
              el.setAttribute("data-widget", "bad");
              return el;
            },
          },
        ],
      },
    ],
  });
  ```

**实现事实与陷阱提示（源码注入）**:
- 匹配是精确字符串比较 `w.nodeType === child.type`（`widget-extension.ts:72-73`），空串 `""` 不匹配任何 AST 节点类型（heading/paragraph/code/…），故不生成任何 widget。
- `collectWidgetRanges` 对空串定义走"未匹配跳过"分支，无异常路径（`widget-extension.ts:76-92`）。
- 陷阱：`nodeType` 为 `string` 类型（`types.ts:323`），空串在编译期合法，运行时静默不渲染——不要断言抛错，断言"无替换 + 内容完整"。

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 用 nodeType 为空串的 widget 创建编辑器 | [STATE] 创建过程不抛异常（非法定义被安全忽略，`widget-extension.ts:72-92`） | import: @floatboat/nexus-core; API: createEditor({ plugins: [{ widgets: [{ nodeType: "" }] }] }); 框架: vitest; 等待: 无 |
| 2 | 检查渲染结果 | [DOM] `[data-widget='bad']` 为 null（空 nodeType 不匹配任何 AST 节点，`widget-extension.ts:72-73`） | import: @floatboat/nexus-core; API: container.querySelector("[data-widget='bad']"); 框架: vitest; 等待: 无 |
| 3 | 检查源码完整性 | [DOM] container.textContent 包含 "console.log(1)"（内容未被破坏） | import: @floatboat/nexus-core; API: container.textContent; 框架: vitest; 等待: 无 |

**断言汇总**:
- [STATE] 非法 widget 定义不抛异常
- [DOM] 空 nodeType 不触发渲染
- [DOM] 文档内容完整保留

## 增强信息来源
- API签名: packages/core/src/widget-extension.ts（空串不匹配任何节点）
- 类型定义: packages/core/src/types.ts（WidgetDefinition.nodeType: string）
- 测试参考: packages/core/test/widgets.test.ts
- 陷阱提示: widget-extension.ts:72-73（精确字符串匹配，空串静默）

---

## FP-07-03-B01 [P4] [B] block:false 行内 Widget 不占独立行

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `Text `code` end\n\nend`
- 插件配置: `[{ name: "inline-widget", widgets: [{ nodeType: "inlineCode", block: false }] }]`
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";

  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "Text `code` end\n\nend",
    plugins: [
      {
        name: "inline-widget",
        widgets: [
          {
            nodeType: "inlineCode",
            block: false,
            render() {
              const el = document.createElement("span");
              el.setAttribute("data-widget", "inline");
              return el;
            },
          },
        ],
      },
    ],
  });
  editor.setSelection(editor.getDocument().length);
  ```

**实现事实与陷阱提示（源码注入）**:
- `block?: boolean` 默认 `true`（后向兼容），行内类型（`inlineCode`/`inlineMath`）必须显式 `block: false`，否则被提升到独立行（`types.ts:327-333` 注释）；实现侧 `const isBlock = range.definition.block !== false`（`widget-extension.ts:162`）。
- 行内 widget 用 `Decoration.replace` + `block: false` 覆盖源码区间，前后文本 "Text " 与 " end" 保留在原行。
- 陷阱：断言"同行保留"应检查 `[data-widget='inline']` 的相邻文本节点/父行文本，而不是整个 container.textContent（后者含第二行 "end"）。

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 光标移到文档末尾后检查 | [DOM] `[data-widget='inline']` 存在（inlineCode 被替换为行内 widget，`block: false`，`widget-extension.ts:162`） | import: @floatboat/nexus-core; API: createEditor({ plugins: [{ widgets: [{ nodeType: "inlineCode", block: false }] }] }); 框架: vitest; 等待: 无 |
| 2 | 验证行内性 | [DOM] widget 所在行的前后文本 "Text " 与 " end" 保留在同一行（未被提升为块级，`types.ts:327-333`） | import: @floatboat/nexus-core; API: 检查 widget 相邻文本; 框架: vitest; 等待: 无 |

**断言汇总**:
- [DOM] 行内 widget 渲染
- [DOM] 前后文本保留（block:false 不占独立行）

## 增强信息来源
- API签名: packages/core/src/widget-extension.ts（isBlock 判定）
- 类型定义: packages/core/src/types.ts（WidgetDefinition.block 注释）
- 测试参考: packages/core/test/widgets.test.ts（inline widget 用例）
- 陷阱提示: types.ts:327-333（inlineCode 必须 block: false）、widget-extension.ts:162（block 默认 true）

---

## FP-07-03-B02 [P4] [B] ignoreEvents:true 时宿主交互事件仍可响应

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `Text\n\n```js\nconsole.log(1)\n````
- 插件配置: `[{ name: "interactive-widget", widgets: [{ nodeType: "code", ignoreEvents: true, render: 带可点击按钮 }] }]`
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";

  const container = document.createElement("div");
  let clicks = 0;
  const editor = createEditor({
    container,
    initialValue: "Text\n\n```js\nconsole.log(1)\n```",
    plugins: [
      {
        name: "interactive-widget",
        widgets: [
          {
            nodeType: "code",
            ignoreEvents: true,
            render() {
              const el = document.createElement("button");
              el.setAttribute("data-widget", "interactive");
              el.addEventListener("click", () => { clicks += 1; });
              return el;
            },
          },
        ],
      },
    ],
  });
  ```

**实现事实与陷阱提示（源码注入）**:
- `ignoreEvents?: boolean` 默认 `false`；`true` 时 `NexusWidget.ignoreEvent()` 返回 true（`widget-extension.ts:145-147`），CM6 忽略 widget 内鼠标/键盘事件、不尝试解析 widget 体内的光标位置（`types.ts:334-341` 注释）。
- 宿主自绑的 click 监听器（render 内 `el.addEventListener("click", ...)`）仍正常响应——ignoreEvents 只影响 CM6 事件解析，不阻止事件冒泡到元素自身监听器。
- 陷阱：click 用 `el.dispatchEvent(new MouseEvent("click", { bubbles: true }))` 直接派发到 widget 按钮；断言选区不变需在 click 前记录 `getSelection().anchor`。

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 确认 widget 渲染 | [DOM] `[data-widget='interactive']` 存在（button 渲染） | import: @floatboat/nexus-core; API: container.querySelector("[data-widget='interactive']"); 框架: vitest; 等待: 无 |
| 2 | 记录初始光标位置，dispatch click 到按钮 | [EVENT] `clicks === 1`（宿主自绑事件正常响应，事件未被吞掉，`widget-extension.ts:145-147`） | import: @floatboat/nexus-core; API: el.dispatchEvent(new MouseEvent("click", { bubbles: true })); 框架: vitest; 等待: 无 |
| 3 | 检查编辑器选区 | [STATE] `getSelection().anchor` 保持初始值（ignoreEvents 让 CM6 忽略 widget 内事件，不解析光标，`types.ts:334-341`） | import: @floatboat/nexus-core; API: editor.getSelection(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [EVENT] 宿主 click 处理器被调用（clicks === 1）
- [STATE] 编辑器选区未被 widget 内事件移动

## 增强信息来源
- API签名: packages/core/src/widget-extension.ts（ignoreEvent）
- 类型定义: packages/core/src/types.ts（WidgetDefinition.ignoreEvents 注释）
- 测试参考: packages/core/test/widgets.test.ts（ignoreEvents 用例）
- 陷阱提示: widget-extension.ts:145-147（ignoreEvents 返回 true）、types.ts:334-341（CM6 不解析光标）

---

## FP-07-03-F01 [P5] [F] Widget destroy 回调随 widget 移除触发

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `Text\n\n```js\nconsole.log(1)\n````
- 插件配置: `[{ name: "code-widget", widgets: [{ nodeType: "code", destroy: vi.fn() }] }]`
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";
  import { vi } from "vitest";

  const container = document.createElement("div");
  const destroyFn = vi.fn();
  const editor = createEditor({
    container,
    initialValue: "Text\n\n```js\nconsole.log(1)\n```",
    plugins: [
      {
        name: "code-widget",
        widgets: [
          {
            nodeType: "code",
            destroy: destroyFn,
            render() {
              const el = document.createElement("div");
              el.setAttribute("data-widget", "code");
              return el;
            },
          },
        ],
      },
    ],
  });
  ```

**实现事实与陷阱提示（源码注入）**:
- `destroy?: (element: HTMLElement) => void`（`types.ts:326`）；widget 被 CM6 移除时调用 `NexusWidget.destroy(dom)` → `this.definition.destroy?.(dom)`（`widget-extension.ts:141-143`）。
- 光标 `setSelection(10)` 进入 widget 源码范围（`selectionIntersects` 为 true）→ StateField 重建装饰（`widget-extension.ts:213-217`）→ 旧 widget 移除 → destroy 回调触发。
- 陷阱：断言 `destroyFn` 调用次数 `>= 1`（widget 可能因装饰重建被实例化多次，但被移除时都会回调）；destroy 参数是 widget 的 DOM 元素。

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 确认 widget 已渲染 | [DOM] `[data-widget='code']` 不为 null | import: @floatboat/nexus-core; API: container.querySelector("[data-widget='code']"); 框架: vitest; 等待: 无 |
| 2 | `editor.setSelection(10)`（光标进入 widget 源码范围） | [EVENT] destroyFn 被调用（widget 移除时执行清理回调，`widget-extension.ts:141-143`；断言 `destroyFn.mock.calls.length >= 1`） | import: @floatboat/nexus-core; API: editor.setSelection(10) + destroyFn.mock.calls; 框架: vitest; 等待: 无 |
| 3 | 清理：`editor.destroy()` | [STATE] 不抛异常（编辑器销毁不触发 widget destroy 重复异常） | import: @floatboat/nexus-core; API: editor.destroy(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [DOM] widget 初始渲染
- [EVENT] widget 移除时 destroy 回调被调用（destroyFn 调用次数 >= 1）

## 增强信息来源
- API签名: packages/core/src/widget-extension.ts（NexusWidget.destroy）
- 类型定义: packages/core/src/types.ts（WidgetDefinition.destroy）
- 测试参考: packages/core/test/widgets.test.ts（destroy 回调用例）
- 陷阱提示: widget-extension.ts:141-143（definition.destroy?.(dom)）、widget-extension.ts:213-217（StateField 重建触发移除）

---
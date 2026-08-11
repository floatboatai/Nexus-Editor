# CASE-核心数据流-测试用例（FP-03）

> 一级功能点: 核心数据流（PRD §2.2）
> 全局批次序号: 03
> 生成时间: 2026-08-10
> 测试框架: Vitest / jsdom（`vitest.config.ts` 已配置 `environment: "jsdom"` + `@floatboat/nexus-core` 别名）
>
> 涉及二级功能点:
> - FP-03-01 用户输入→CM6 Transaction→EditorState（[AST解析][编辑交互]）
> - FP-03-02 防抖调用 Unified 生成 AST（[AST解析][性能]，parseDelayMs）
> - FP-03-03 Decorations 将 AST 节点→Widget/Mark（[AST解析][Live Preview]）
> - FP-03-04 onChange(markdown, ast) 对外输出（[API契约]）

> ⚠️ 实现差异提示（影响前置条件）:
> - `parseDelayMs` 在 PRD 中描述默认 100ms，但 `packages/core/src/editor.ts:282` 实际实现为 `config.parseDelayMs ?? 0`，即**默认不防抖、同步 emit**。本文件用例全部按实际代码行为编写：需要防抖的用例必须显式传入 `parseDelayMs`；FP-03-02-B02 专门验证该默认行为并标注差异。
> - AST 生成路径为 Lezer 驱动（`lezerAstFromAnywhere` / `lezerTreeToMdast`），输出结构上与 remark/unified 生成的 mdast Root 兼容（`type: "root"`）。
> - 模拟"用户输入"统一采用捕获 CM6 `EditorView` 后 `view.dispatch({ changes, userEvent: "input.type" })` 的方式（与 `packages/core/test/editor.test.ts` / `live-preview.test.ts` 既有测试一致）。

---

## FP-03-01-N01 [P1] [正常] 用户键入字符经 CM6 Transaction 更新 EditorState 与文档

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `""`（空文档）
- 插件配置: 无（仅捕获 CM6 view 的测试插件 capture-view）
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { afterEach, expect, it, vi } from "vitest";
  import { EditorView, ViewPlugin } from "@codemirror/view";
  import { createEditor } from "@floatboat/nexus-core";

  afterEach(() => {
    vi.useRealTimers();
  });

  const container = document.createElement("div");
  const docs: string[] = [];
  let capturedView: EditorView | null = null;
  const captureView = ViewPlugin.fromClass(
    class {
      constructor(readonly view: EditorView) {
        capturedView = view;
      }
    }
  );
  const editor = createEditor({
    container,
    initialValue: "",
    parseDelayMs: 0, // 显式关闭防抖，验证"输入即更新"的同步链路
    plugins: [{ name: "capture-view", cmExtensions: [captureView] }],
    onChange: (doc: string) => {
      docs.push(doc);
    },
  });
  ```

> 🔧 增强说明:
> - import 来源: `createEditor` ← `@floatboat/nexus-core`（editor.ts:232 `export function createEditor(config: EditorConfig): EditorAPI`）；`EditorView` / `ViewPlugin` ← `@codemirror/view`
> - capture-view 插件为 `ViewPlugin.fromClass`，其 constructor 在 CM6 view 构造时**同步执行**，故 `createEditor` 返回后 `capturedView` 立即可用（同款模式见 editor.test.ts:282-295）
> - 时间控制: `parseDelayMs: 0` → `scheduleChange` 走 `parseDelayMs <= 0` 同步 emit 分支（editor.ts:352-354），无需假计时器
> - 🕳️ 陷阱: `afterEach(() => vi.useRealTimers())` 必须保留——若本用例不启用假计时器但其他用例启用，缺清理会导致定时器泄漏跨用例

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 模拟用户键入：`capturedView!.dispatch({ changes: { from: 0, insert: "a" }, userEvent: "input.type" })` | [STATE] 一次 dispatch 生成一个 Transaction 并同步应用：`view.state.doc`（CM6 `Text`）立即包含 "a"；`userEvent: "input.type"` 供 updateListener 识别为用户编辑（editor.ts:584 检测 silent 注解区分用户/非用户路径） | import: @codemirror/view; API: capturedView.dispatch(TransactionSpec); 框架: vitest; 等待: 无(同步) |
| 2 | 断言 `capturedView!.state.doc.toString()` | [STATE] 返回 `"a"`——`Text.toString(): string` 是 CM6 文档的权威字符串视图，与 EditorState 同帧一致 | import: @codemirror/view; API: capturedView.state.doc.toString(): string; 框架: vitest; 等待: 无(同步) |
| 3 | 断言 `editor.getDocument()` | [API] 返回 `"a"`——`getDocument(): string` 实现为 `view.state.doc.toString()`（editor.ts:732-734），与 EditorState 一致 | import: @floatboat/nexus-core; API: editor.getDocument(): string; 框架: vitest; 等待: 无(同步) |
| 4 | 断言 `docs` 数组 | [EVENT] 同步触发 onChange 1 次，参数为 `"a"`——`onChange?: (doc: string, ast: Root) => void`（types.ts:113）；`parseDelayMs <= 0` 时 `scheduleChange` 直接调用 `emitChange`（editor.ts:352-354），`emitChange` 内 `config.onChange?.(markdown, currentAst)`（editor.ts:342） | import: @floatboat/nexus-core; API: onChange(doc: string, ast: Root); 框架: vitest; 等待: 无(同步 emit) |
| 5 | 断言 `editor.getAst()` | [AST] `ast.type === "root"`，`children[0].type === "paragraph"`——`Root = { type: "root", children: RootContent[] }`；"a" 由 `adaptParagraph` 产出 `{ type: "paragraph" }`（lezer-mdast-adapter.ts:627）；`getAst(): Root` 直接返回 `currentAst`（editor.ts:735-737） | import: @floatboat/nexus-core; API: editor.getAst(): Root; 框架: vitest; 等待: 无(同步) |

**断言汇总**:
- [STATE] `capturedView.state.doc.toString()` === "a"
- [API] `editor.getDocument()` === "a"
- [EVENT] `docs` 等于 `["a"]`（parseDelayMs=0 时同步 emit）
- [AST] `editor.getAst().type` === "root" 且首个 children 为 paragraph

---

## FP-03-01-N02 [P2] [正常] 连续多次输入各自形成 Transaction 且每次同步反映到文档

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `""`
- 插件配置: 无（捕获 CM6 view 的测试插件）
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { afterEach, expect, it, vi } from "vitest";
  import { EditorView, ViewPlugin } from "@codemirror/view";
  import { createEditor } from "@floatboat/nexus-core";

  afterEach(() => {
    vi.useRealTimers();
  });

  const container = document.createElement("div");
  const docs: string[] = [];
  let capturedView: EditorView | null = null;
  const captureView = ViewPlugin.fromClass(
    class {
      constructor(readonly view: EditorView) {
        capturedView = view;
      }
    }
  );
  const editor = createEditor({
    container,
    initialValue: "",
    parseDelayMs: 0,
    plugins: [{ name: "capture-view", cmExtensions: [captureView] }],
    onChange: (doc: string) => {
      docs.push(doc);
    },
  });
  ```

> 🔧 增强说明:
> - 三次 dispatch 各自产生独立 Transaction（CM6 无自动合并；合并仅发生于防抖场景的 parse 阶段，见 FP-03-02）
> - `parseDelayMs: 0` 同步 emit：每次 dispatch 后 `scheduleChange` 立即执行 `emitChange`（editor.ts:352-354），故 `docs` 顺序与 dispatch 顺序一一对应

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 依次 dispatch 三次输入：在 0 处插入 "a"、"b"、"c"（`userEvent: "input.type"`，插入位置 = 当前文档长度） | [STATE] 三次 dispatch 产生三个独立 Transaction，每次均同步更新 `view.state.doc`（插入位置依次为 0、1、2） | import: @codemirror/view; API: capturedView.dispatch(TransactionSpec); 框架: vitest; 等待: 无(同步) |
| 2 | 断言 `editor.getDocument()` | [API] 返回 `"abc"`——`getDocument(): string` 三次变更按序叠加（editor.ts:732-734） | import: @floatboat/nexus-core; API: editor.getDocument(): string; 框架: vitest; 等待: 无(同步) |
| 3 | 断言 `docs` 数组 | [EVENT] 每次输入各触发一次 onChange，`docs` 等于 `["a", "ab", "abc"]`——onChange 签名 `(doc: string, ast: Root)`，同步路径每 Transaction 一 emit（editor.ts:342） | import: @floatboat/nexus-core; API: onChange(doc: string, ast: Root); 框架: vitest; 等待: 无(同步 emit) |
| 4 | 断言 `editor.getAst().children[0]` | [AST] 解析出的 paragraph 文本为 `"abc"`，与文档一致——`getAst(): Root` 返回 `currentAst`，其 children[0] 为 `Paragraph`（adapter:627），`paragraph.children` 为 `PhrasingContent[]`（text 节点 `value: "abc"`） | import: @floatboat/nexus-core; API: editor.getAst(): Root; 框架: vitest; 等待: 无(同步) |

**断言汇总**:
- [API] `editor.getDocument()` === "abc"
- [EVENT] `docs` 等于 `["a", "ab", "abc"]`（每 Transaction 一次，同步路径）
- [AST] `editor.getAst().children[0].type` === "paragraph"，文本内容 === "abc"

---

## FP-03-01-F01 [P2] [流程] 输入→移动光标→继续输入的编辑流程（选区随 Transaction 更新）

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `""`
- 插件配置: 无（捕获 CM6 view 的测试插件）
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { afterEach, expect, it, vi } from "vitest";
  import { EditorView, ViewPlugin } from "@codemirror/view";
  import { createEditor } from "@floatboat/nexus-core";

  afterEach(() => {
    vi.useRealTimers();
  });

  const container = document.createElement("div");
  let capturedView: EditorView | null = null;
  const captureView = ViewPlugin.fromClass(
    class {
      constructor(readonly view: EditorView) {
        capturedView = view;
      }
    }
  );
  const editor = createEditor({
    container,
    initialValue: "",
    parseDelayMs: 0,
    plugins: [{ name: "capture-view", cmExtensions: [captureView] }],
  });
  ```

> 🔧 增强说明:
> - `setSelection(anchor, head = anchor)` 内部 dispatch `{ selection: { anchor, head }, scrollIntoView: true }`（editor.ts:775-791）——selection-only Transaction，`tr.docChanged === false`，不改文档
> - `getSelection(): { anchor: number; head: number }` 取 `view.state.selection.main`（editor.ts:748-751）
> - 🕳️ 陷阱: dispatch 中显式携带的 `selection` 会被 CM6 直接写入新 EditorState（change 会先应用、selection 基于新文档）；若省略 selection，CM6 默认保留旧选区位置

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | dispatch 输入 "Hello"（`from: 0`，并在 dispatch 中显式指定 `selection: { anchor: 5 }`） | [STATE] 文档变为 `"Hello"`，EditorState 主选区 `selection.main` 位于 `anchor = 5`（change 应用后 selection 落点于新文档坐标） | import: @codemirror/view; API: capturedView.dispatch(TransactionSpec); 框架: vitest; 等待: 无(同步) |
| 2 | 通过 `editor.setSelection(0)` 移动光标到行首 | [STATE] `getSelection()` 返回 `{ anchor: 0, head: 0 }`——selection-only Transaction（`scrollIntoView: true`，不改文档，editor.ts:787-790） | import: @floatboat/nexus-core; API: editor.setSelection(anchor: number, head?: number); 框架: vitest; 等待: 无(同步) |
| 3 | 在 0 处 dispatch 插入 "World"（`selection: { anchor: 5 }`） | [STATE] 文档变为 `"WorldHello"`，选区位于 `anchor = 5`（insert 应用后光标落在新文档 offset 5） | import: @codemirror/view; API: capturedView.dispatch(TransactionSpec); 框架: vitest; 等待: 无(同步) |
| 4 | 断言 `editor.getDocument()` 与 `editor.getSelection()` | [API] 文档为 `"WorldHello"`；选区为 `{ anchor: 5, head: 5 }`——`getSelection(): { anchor, head }`（editor.ts:748-751），head 默认等于 anchor | import: @floatboat/nexus-core; API: editor.getDocument(): string; editor.getSelection(): { anchor: number; head: number }; 框架: vitest; 等待: 无(同步) |
| 5 | 断言 `capturedView!.state.doc.lines` | [STATE] 文档行数仍为 1（无换行符）——CM6 `Text.lines: number` 属性 | import: @codemirror/view; API: capturedView.state.doc.lines: number; 框架: vitest; 等待: 无(同步) |

**断言汇总**:
- [API] `editor.getDocument()` === "WorldHello"
- [STATE] `editor.getSelection()` 等于 `{ anchor: 5, head: 5 }`
- [STATE] dispatch 中显式携带的 selection 会被写入 EditorState（Transaction → EditorState 选区映射）

---

## FP-03-01-F02 [P3] [流程] 多步编辑后沿 Transaction 历史 undo/redo 回退

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `""`
- 插件配置: `plugin-history`（`createHistoryPlugin` 提供 CM6 `history()` 扩展）
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { afterEach, expect, it, vi } from "vitest";
  import { EditorView, ViewPlugin } from "@codemirror/view";
  import { createEditor } from "@floatboat/nexus-core";
  import { createHistoryPlugin } from "@floatboat/nexus-plugin-history";

  afterEach(() => {
    vi.useRealTimers();
  });

  const container = document.createElement("div");
  let capturedView: EditorView | null = null;
  const captureView = ViewPlugin.fromClass(
    class {
      constructor(readonly view: EditorView) {
        capturedView = view;
      }
    }
  );
  const editor = createEditor({
    container,
    initialValue: "",
    parseDelayMs: 0,
    plugins: [
      { name: "capture-view", cmExtensions: [captureView] },
      createHistoryPlugin(),
    ],
  });
  ```

> 🔧 增强说明:
> - `createHistoryPlugin` ← `@floatboat/nexus-plugin-history`（独立包导出，注册 CM6 `history()` 扩展）
> - `undo(): boolean` / `redo(): boolean` 为 `cmUndo(view)` / `cmRedo(view)` 的包装（editor.ts:847-854），**返回是否有历史可回退**
> - `setDocument` 走 `performSetDocument` 的整文档替换 dispatch（editor.ts:405+），无 `userEvent` 标注 → 独立撤销单元
> - 🕳️ 陷阱: 缺 `createHistoryPlugin()` 时 `undo()` 恒返回 false（无 history 扩展则 CM6 无可撤销 Transaction）——与 editor.test.ts:599-609 同款前提

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | dispatch 输入 "a"（`from: 0`，`userEvent: "input.type"`） | [STATE] 文档为 `"a"`，该 Transaction 入 history 栈（history 扩展记录用户编辑 Transaction） | import: @codemirror/view; API: capturedView.dispatch(TransactionSpec); 框架: vitest; 等待: 无(同步) |
| 2 | 调用 `editor.setDocument("ab")`（非用户输入 Transaction，独立撤销单元） | [API] 文档为 `"ab"`——`setDocument(next: string, opts?: SetDocumentOptions)` 内部整文档 replaceSelection dispatch（editor.ts:805-822 → 405+） | import: @floatboat/nexus-core; API: editor.setDocument(next: string, opts?: SetDocumentOptions); 框架: vitest; 等待: 无(同步) |
| 3 | 调用 `editor.undo()` | [API] 返回 `true`，文档回退到 `"a"`——撤掉 setDocument 的 Transaction（editor.ts:847-850） | import: @floatboat/nexus-core; API: editor.undo(): boolean; 框架: vitest; 等待: 无(同步) |
| 4 | 再次调用 `editor.undo()` | [API] 返回 `true`，文档回退到 `""`——撤掉输入的 Transaction | import: @floatboat/nexus-core; API: editor.undo(): boolean; 框架: vitest; 等待: 无(同步) |
| 5 | 调用 `editor.redo()` | [API] 返回 `true`，文档前进到 `"a"`——redo 重放最近一次被撤销的 Transaction（editor.ts:851-854） | import: @floatboat/nexus-core; API: editor.redo(): boolean; 框架: vitest; 等待: 无(同步) |

**断言汇总**:
- [API] 两次 `undo()` 均返回 true 且文档依次为 "a"、""（按 Transaction 逆序回退）
- [API] `redo()` 返回 true 且文档为 "a"（Transaction 历史可重放）
- [STATE] 每个编辑操作 = 一个可独立撤销的 Transaction

---

## FP-03-01-D01 [P3] [数据] 输入后 AST 与文档内容保持一致（heading 解析）

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `""`
- 插件配置: 无（捕获 CM6 view 的测试插件）
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { afterEach, expect, it, vi } from "vitest";
  import { EditorView, ViewPlugin } from "@codemirror/view";
  import { createEditor } from "@floatboat/nexus-core";

  afterEach(() => {
    vi.useRealTimers();
  });

  const container = document.createElement("div");
  let capturedView: EditorView | null = null;
  const captureView = ViewPlugin.fromClass(
    class {
      constructor(readonly view: EditorView) {
        capturedView = view;
      }
    }
  );
  const editor = createEditor({
    container,
    initialValue: "",
    parseDelayMs: 0,
    plugins: [{ name: "capture-view", cmExtensions: [captureView] }],
  });
  ```

> 🔧 增强说明:
> - AST 经 `emitChange` → `currentAst = transformAst(lezerAstFromAnywhere(viewRef, markdown))`（editor.ts:341），Lezer 增量解析直接读 live EditorState
> - heading 节点映射: `adaptHeading` 产出 `{ type: "heading", depth: depth ?? 1, children, position: position(node.from, node.to) }`（lezer-mdast-adapter.ts:534-539）；`# ` marker 为 `HeaderMark` 节点被跳过（adapter:526），文本子节点用 `headingTextRange` 合成（adapter:93-124）
> - 所有 mdast 节点均带 `position: { start: { offset }, end: { offset } }`（Lezer offset 坐标，与文档字符偏移一致）

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | dispatch 输入 `"# Title\n"`（`from: 0`，`userEvent: "input.type"`） | [STATE] 文档为 `"# Title\n"`——`view.state.doc.toString()` | import: @codemirror/view; API: capturedView.dispatch(TransactionSpec); 框架: vitest; 等待: 无(同步) |
| 2 | 断言 `editor.getAst().children[0]` | [AST] 节点 `type === "heading"`，`depth === 1`——`Heading = { type: "heading", depth: number, children: PhrasingContent[], position }`（adapter:534-539）；`headingDepth("ATXHeading1")` 返回 1 | import: @floatboat/nexus-core; API: editor.getAst(): Root; 框架: vitest; 等待: 无(同步) |
| 3 | 断言 heading 节点位置 | [AST] `position.start.offset === 0`——Lezer node.from 即文档 0 偏移，与文档起点对齐（adapter:538 `position(node.from, node.to)`） | import: @floatboat/nexus-core; API: editor.getAst(): Root; 框架: vitest; 等待: 无(同步) |
| 4 | 追加输入 `"body"` 后再断言 `getAst()` | [AST] children 变为 `["heading", "paragraph"]`，与文档结构一致——`Root.children: RootContent[]` 顺序对应文档块级结构 | import: @floatboat/nexus-core; API: editor.getAst(): Root; 框架: vitest; 等待: 无(同步) |

**断言汇总**:
- [AST] `editor.getAst().children[0]` 为 `{ type: "heading", depth: 1 }`
- [AST] 文档变更后 `getAst().children.map(c => c.type)` 等于 `["heading", "paragraph"]`
- [AST] AST 与 EditorState 文档内容始终同步（单向确定性数据流第 1-2 步）

---

## FP-03-01-B01 [P4] [边界] 空文档上首次输入

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `""`
- 插件配置: 无（捕获 CM6 view 的测试插件）
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { afterEach, expect, it, vi } from "vitest";
  import { EditorView, ViewPlugin } from "@codemirror/view";
  import { createEditor } from "@floatboat/nexus-core";

  afterEach(() => {
    vi.useRealTimers();
  });

  const container = document.createElement("div");
  const docs: string[] = [];
  let capturedView: EditorView | null = null;
  const captureView = ViewPlugin.fromClass(
    class {
      constructor(readonly view: EditorView) {
        capturedView = view;
      }
    }
  );
  const editor = createEditor({
    container,
    initialValue: "",
    parseDelayMs: 0,
    plugins: [{ name: "capture-view", cmExtensions: [captureView] }],
    onChange: (doc: string) => {
      docs.push(doc);
    },
  });
  ```

> 🔧 增强说明:
> - 初始 `currentAst` 在 createEditor 内**同步**计算: `transformAst(lezerStringToMdast(config.initialValue ?? ""))`（editor.ts:298-300），无需等待——空串产出 `{ type: "root", children: [] }`
> - 初始解析**不经过** `emitChange`，故初始文档不触发 onChange（editor.ts:298-300 与 323-344 分离）——与 FP-03-04-D01 相互印证

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言初始状态 | [API] `getDocument()` 返回 `""`；`getAst()` 为 `{ type: "root", children: [] }`——空文档 Lezer parse 为空 Document，adapter 产出空 Root（editor.ts:298-300） | import: @floatboat/nexus-core; API: editor.getDocument(): string; editor.getAst(): Root; 框架: vitest; 等待: 无(同步) |
| 2 | dispatch 插入 "a"（`from: 0`） | [STATE] 文档为 `"a"`——`view.state.doc` 同步更新 | import: @codemirror/view; API: capturedView.dispatch(TransactionSpec); 框架: vitest; 等待: 无(同步) |
| 3 | 断言 `docs` | [EVENT] onChange 触发 1 次，参数为 `"a"`——`scheduleChange` 同步分支（editor.ts:352-354） | import: @floatboat/nexus-core; API: onChange(doc: string, ast: Root); 框架: vitest; 等待: 无(同步 emit) |
| 4 | 断言 `getAst()` | [AST] root 下生成一个 paragraph 节点——`children[0].type === "paragraph"`（adapter:627） | import: @floatboat/nexus-core; API: editor.getAst(): Root; 框架: vitest; 等待: 无(同步) |

**断言汇总**:
- [API] 初始 `getDocument()` === "" 且 `getAst()` children 为空
- [EVENT] 空文档首次输入后 `docs` 等于 `["a"]`
- [AST] `editor.getAst().children[0].type` === "paragraph"

---

## FP-03-01-B02 [P5] [边界] 超大单次输入（10k 字符）不破坏数据流

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `""`
- 插件配置: 无（捕获 CM6 view 的测试插件）
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { afterEach, expect, it, vi } from "vitest";
  import { EditorView, ViewPlugin } from "@codemirror/view";
  import { createEditor } from "@floatboat/nexus-core";

  afterEach(() => {
    vi.useRealTimers();
  });

  const container = document.createElement("div");
  let capturedView: EditorView | null = null;
  const captureView = ViewPlugin.fromClass(
    class {
      constructor(readonly view: EditorView) {
        capturedView = view;
      }
    }
  );
  const editor = createEditor({
    container,
    initialValue: "",
    parseDelayMs: 0,
    plugins: [{ name: "capture-view", cmExtensions: [captureView] }],
  });
  const bigText = "x".repeat(10_000);
  ```

> 🔧 增强说明:
> - Lezer 解析为**增量**解析，天然适配大文档（editor.ts:337-341 注释：cheap even on large docs）
> - 🕳️ 陷阱: 10k 字符在 jsdom + vitest 下仍是同步路径，无 worker、无 setTimeout——断言前无需任何等待，直接用 `expect` 同步断言即可

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | dispatch 一次性插入 `bigText`（`from: 0`） | [STATE] dispatch 不抛异常——单 Transaction 应用 10k 字符变更（CM6 `Text` 内部按 chunk 存储） | import: @codemirror/view; API: capturedView.dispatch(TransactionSpec); 框架: vitest; 等待: 无(同步) |
| 2 | 断言 `editor.getDocument()` | [API] 返回长度 10_000 的字符串——`getDocument(): string`（`Text.toString()`） | import: @floatboat/nexus-core; API: editor.getDocument(): string; 框架: vitest; 等待: 无(同步) |
| 3 | 断言 `editor.getAst()` | [AST] 不抛异常，`type === "root"`，`children[0].type === "paragraph"`——单段 10k 文本解析为一个 Paragraph（adapter:627），`getAst(): Root` | import: @floatboat/nexus-core; API: editor.getAst(): Root; 框架: vitest; 等待: 无(同步) |
| 4 | 再次 dispatch 在文档尾部插入 "y" | [API] `getDocument().length` 变为 10_001 且以 "y" 结尾——`insert` 位置 = `capturedView.state.doc.length` | import: @codemirror/view; API: capturedView.dispatch(TransactionSpec); 框架: vitest; 等待: 无(同步) |

**断言汇总**:
- [API] `editor.getDocument().length` === 10_000，`getDocument().endsWith("x")` 为 true
- [AST] 超大文档解析不抛异常且结构正确（root → paragraph）
- [API] 追加编辑后文档长度 10_001（数据流在大文档上仍连续可用）

---

## FP-03-01-E01 [P3] [异常] 越界偏移 replaceRange 抛出 RangeError

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `"Hello"`（长度 5）
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor } from "@floatboat/nexus-core";

  afterEach(() => {
    vi.useRealTimers();
  });

  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "Hello",
    parseDelayMs: 0,
  });
  ```

> 🔧 增强说明:
> - `replaceRange(from: number, to: number, insert: string, selection?, opts?)` 内部 `view.dispatch({ changes: { from, to, insert }, selection?, scrollIntoView: true, annotations: silent ? silentDocChange.of(true) : undefined })`（editor.ts:827-846）
> - 越界 change 由 CM6 `ChangeSet` 构造时校验抛 `RangeError`（信任模型，与 `setSelection` 的 `clampPosition` 不同——setSelection 会收敛越界值，replaceRange 不收敛）
> - 🕳️ 陷阱: 异常发生在 `view.dispatch` 内部（CM6 同步抛错），**不会**产生部分变更——dispatch 失败时整个 Transaction 被拒绝，EditorState 保持原状

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 调用 `editor.replaceRange(100, 200, "x")`（超出文档长度） | [API] 抛出 `RangeError`——CM6 `ChangeSet` 对 `from > doc.length` 的 change 同步抛错（editor.ts:827-837 直接透传 dispatch，无 pre-check） | import: @floatboat/nexus-core; API: editor.replaceRange(from: number, to: number, insert: string, selection?, opts?); 框架: vitest; 等待: 无(同步抛错) |
| 2 | 断言 `editor.getDocument()` | [API] 文档仍为 `"Hello"`——异常 dispatch 不产生部分变更，EditorState 未被污染（`getDocument(): string`） | import: @floatboat/nexus-core; API: editor.getDocument(): string; 框架: vitest; 等待: 无(同步) |
| 3 | 调用 `editor.replaceRange(0, 5, "Hi")`（合法范围） | [API] 正常执行，文档变为 `"Hi"`——合法 change 走正常 dispatch 路径 | import: @floatboat/nexus-core; API: editor.replaceRange(from, to, insert); 框架: vitest; 等待: 无(同步) |

**断言汇总**:
- [API] `expect(() => editor.replaceRange(100, 200, "x")).toThrow(RangeError)`
- [API] 异常后 `getDocument()` === "Hello"（状态未被污染）
- [API] 合法范围 replaceRange 恢复正常工作

---

## 增强信息来源
- API签名: packages/core/src/editor.ts
- AST映射: packages/core/src/lezer-mdast-adapter.ts
- 装饰生成: packages/core/src/live-preview.ts
- 测试参考: packages/core/test/editor.test.ts
- 陷阱提示: AGENTS.md

---

## FP-03-02-N01 [P1] [正常] 防抖窗口内（parseDelayMs=100ms）不触发 onChange

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `""`
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor } from "@floatboat/nexus-core";

  afterEach(() => {
    vi.useRealTimers();
  });

  vi.useFakeTimers(); // 必须先启用假计时器，才能精确控制防抖窗口

  const container = document.createElement("div");
  const docs: string[] = [];
  const editor = createEditor({
    container,
    initialValue: "",
    parseDelayMs: 100, // 显式开启 100ms 防抖
    onChange: (doc: string) => {
      docs.push(doc);
    },
  });
  ```

> 🔧 增强说明:
> - `scheduleChange`（editor.ts:346-361）: 先 `clearTimeout(parseTimer)` 清旧任务，`parseDelayMs > 0` 时 `parseTimer = setTimeout(() => { parseTimer = undefined; emitChange(markdown); }, parseDelayMs)`
> - `setDocument` 的文档更新（`performSetDocument` dispatch）与 parse 定时器**解耦**：EditorState 立即变，onChange 延迟发
> - 🕳️ 陷阱: `vi.useFakeTimers()` 必须在 `createEditor` **之前**调用，否则 parseTimer 使用真实计时器，`advanceTimersByTime` 无效（editor.test.ts:246 同款顺序）

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | `editor.setDocument("first")` | [API] 文档立即更新为 `"first"`——`setDocument` 直接 dispatch（EditorState 不受防抖影响，editor.ts:805-822 → performSetDocument） | import: @floatboat/nexus-core; API: editor.setDocument(next: string, opts?: SetDocumentOptions); 框架: vitest; 等待: 无(同步) |
| 2 | 断言 `docs` | [EVENT] 防抖窗口内 `docs` 为空——AST 生成/onChange 被推迟（`parseTimer` 已挂起 100ms，`emitChange` 未执行，editor.ts:357-360） | import: @floatboat/nexus-core; API: onChange(doc: string, ast: Root); 框架: vitest; 等待: 无(窗口内尚不触发) |
| 3 | `vi.advanceTimersByTime(50)`（< 100ms） | [EVENT] 仍不触发，`docs` 为空——假计时器推进 50ms 未达 100ms 窗口（editor.ts:357 setTimeout 未到期） | import: vitest; API: vi.advanceTimersByTime(ms: number); 框架: vitest; 等待: vi.advanceTimersByTime(50) |
| 4 | `vi.advanceTimersByTime(50)`（累计到达 100ms） | [EVENT] 触发 onChange 1 次，参数为 `"first"`——setTimeout 回调执行 `emitChange("first")` → `config.onChange?.("first", currentAst)`（editor.ts:342） | import: vitest; API: vi.advanceTimersByTime(ms: number); 框架: vitest; 等待: vi.advanceTimersByTime(50) |

**断言汇总**:
- [API] `editor.getDocument()` === "first"（编辑即时生效）
- [EVENT] 窗口内（0~99ms）`docs` 为空；满 100ms 后 `docs` 等于 `["first"]`

---

## FP-03-02-N02 [P1] [正常] 防抖窗口结束后仅触发一次且参数为最新文档

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `""`
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor } from "@floatboat/nexus-core";

  afterEach(() => {
    vi.useRealTimers();
  });

  vi.useFakeTimers();

  const container = document.createElement("div");
  const docs: string[] = [];
  const editor = createEditor({
    container,
    initialValue: "",
    parseDelayMs: 100,
    onChange: (doc: string) => {
      docs.push(doc);
    },
  });
  ```

> 🔧 增强说明:
> - 防抖合并机制: 第二次 `setDocument` 的 `scheduleChange` 开头 `clearTimeout(parseTimer)` 清掉第一次的定时器（editor.ts:347-350），因此只保留最后一次任务的 setTimeout
> - 与 editor.test.ts:245-276（"debounces parsing and emits only the latest document version"）同款断言模式：`expect(docs).toEqual([])` → `advanceTimersByTime` → `expect(docs).toEqual(["second"])`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | `editor.setDocument("first")` 后立即 `editor.setDocument("second")` | [API] 文档为 `"second"`——两次 dispatch 顺序应用，EditorState 反映最终值 | import: @floatboat/nexus-core; API: editor.setDocument(next: string, opts?); 框架: vitest; 等待: 无(同步) |
| 2 | 断言 `docs` | [EVENT] 防抖合并：`docs` 为空——第二个 `scheduleChange` `clearTimeout` 了第一个 100ms 定时器（editor.ts:347-350），两个变更只保留最后一次的解析任务 | import: @floatboat/nexus-core; API: onChange(doc: string, ast: Root); 框架: vitest; 等待: 无(窗口内尚不触发) |
| 3 | `vi.advanceTimersByTime(100)` | [EVENT] 仅触发 1 次 onChange，且参数为 `"second"`（最新文档，非 "first"）——残留定时器回调 `emitChange("second")`（editor.ts:357-360） | import: vitest; API: vi.advanceTimersByTime(ms: number); 框架: vitest; 等待: vi.advanceTimersByTime(100) |
| 4 | 断言 `editor.getDocument()` | [API] 仍为 `"second"`——`getDocument(): string` | import: @floatboat/nexus-core; API: editor.getDocument(): string; 框架: vitest; 等待: 无(同步) |

**断言汇总**:
- [EVENT] `docs` 等于 `["second"]`（仅最新文档，防抖合并）
- [API] `getDocument()` === "second"

---

## FP-03-02-F01 [P2] [流程] 连续三次编辑防抖后仅触发一次 onChange

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `""`
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor } from "@floatboat/nexus-core";

  afterEach(() => {
    vi.useRealTimers();
  });

  vi.useFakeTimers();

  const container = document.createElement("div");
  const docs: string[] = [];
  const editor = createEditor({
    container,
    initialValue: "",
    parseDelayMs: 100,
    onChange: (doc: string) => {
      docs.push(doc);
    },
  });
  ```

> 🔧 增强说明:
> - N 次编辑 → 1 次解析: 每次 `setDocument` 都经 `scheduleChange`，前一次的 `parseTimer` 被 clearTimeout（editor.ts:347-350），最终只留下最后一次的定时器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 连续调用 `editor.setDocument("v1")`、`setDocument("v2")`、`setDocument("v3")` | [API] 文档为 `"v3"`——三次 dispatch 按序叠加（editor.ts:805-822） | import: @floatboat/nexus-core; API: editor.setDocument(next: string, opts?); 框架: vitest; 等待: 无(同步) |
| 2 | 断言 `docs` | [EVENT] 触发 0 次（全部在窗口内）——三个 parseTimer 仅最后一个存活 | import: @floatboat/nexus-core; API: onChange(doc: string, ast: Root); 框架: vitest; 等待: 无(窗口内尚不触发) |
| 3 | `vi.advanceTimersByTime(100)` | [EVENT] 总触发次数为 1（不是 3），参数为 `"v3"`——残留定时器 emitChange("v3")（editor.ts:357-360） | import: vitest; API: vi.advanceTimersByTime(ms: number); 框架: vitest; 等待: vi.advanceTimersByTime(100) |
| 4 | `vi.advanceTimersByTime(1000)` | [EVENT] 不再产生额外触发（`docs` 仍只有 1 项）——回调已置 `parseTimer = undefined`（editor.ts:358），无残留定时器 | import: vitest; API: vi.advanceTimersByTime(ms: number); 框架: vitest; 等待: vi.advanceTimersByTime(1000) |

**断言汇总**:
- [EVENT] `docs` 等于 `["v3"]`（N 次编辑 → 1 次解析，防抖聚合）
- [EVENT] 窗口后再推进时间不产生重复触发

---

## FP-03-02-F02 [P2] [流程] 防抖窗口内再次编辑会重置计时器（真正防抖语义）

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `""`
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor } from "@floatboat/nexus-core";

  afterEach(() => {
    vi.useRealTimers();
  });

  vi.useFakeTimers();

  const container = document.createElement("div");
  const docs: string[] = [];
  const editor = createEditor({
    container,
    initialValue: "",
    parseDelayMs: 100,
    onChange: (doc: string) => {
      docs.push(doc);
    },
  });
  ```

> 🔧 增强说明:
> - 防抖重置语义: `scheduleChange` 每次调用都先 `clearTimeout(parseTimer)` 再重新 `setTimeout`（editor.ts:347-360）——从**最近一次编辑**时刻重新计时

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | `editor.setDocument("first")`，`vi.advanceTimersByTime(60)` | [EVENT] 已过 60ms（<100），`docs` 为空——定时器未到期（editor.ts:357） | import: vitest; API: editor.setDocument(next, opts?); vi.advanceTimersByTime(ms); 框架: vitest; 等待: vi.advanceTimersByTime(60) |
| 2 | 再次 `editor.setDocument("second")`（60ms 时点的新编辑） | [STATE] 旧的 100ms 定时器被 `clearTimeout` 并重置（从 60ms 起重新计时）——`scheduleChange` 开头 `if (parseTimer) { clearTimeout(parseTimer); parseTimer = undefined; }`（editor.ts:347-350） | import: @floatboat/nexus-core; API: editor.setDocument(next: string, opts?); 框架: vitest; 等待: 无(同步) |
| 3 | `vi.advanceTimersByTime(40)`（距第二次编辑仅 40ms） | [EVENT] 仍不触发，`docs` 为空（计时器已重置）——累计 60+40=100ms 但计时从第二次编辑起算，仅过 40ms | import: vitest; API: vi.advanceTimersByTime(ms: number); 框架: vitest; 等待: vi.advanceTimersByTime(40) |
| 4 | `vi.advanceTimersByTime(60)`（距第二次编辑满 100ms） | [EVENT] 触发 1 次，参数为 `"second"`——重置后的定时器到期 emitChange("second")（editor.ts:357-360） | import: vitest; API: vi.advanceTimersByTime(ms: number); 框架: vitest; 等待: vi.advanceTimersByTime(60) |

**断言汇总**:
- [EVENT] 窗口内编辑重置计时器：60+40=100ms 时仍不触发
- [EVENT] 从最新编辑起满 100ms 后 `docs` 等于 `["second"]`

---

## FP-03-02-D01 [P3] [数据] 防抖后 onChange 的 AST 与最新文档一致

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `""`
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { afterEach, expect, it, vi } from "vitest";
  import type { Root } from "mdast";
  import { createEditor } from "@floatboat/nexus-core";

  afterEach(() => {
    vi.useRealTimers();
  });

  vi.useFakeTimers();

  const container = document.createElement("div");
  const asts: Root[] = [];
  const docs: string[] = [];
  const editor = createEditor({
    container,
    initialValue: "",
    parseDelayMs: 100,
    onChange: (doc: string, ast: Root) => {
      docs.push(doc);
      asts.push(ast);
    },
  });
  ```

> 🔧 增强说明:
> - `import type { Root } from "mdast"` 为**类型导入**（仅编译期），`Root` 即 mdast 根节点类型 `{ type: "root"; children: RootContent[] }`——运行时不依赖 mdast 包
> - onChange 第二参 `ast: Root` 与 `getAst()` 同一 `currentAst` 引用（editor.ts:341-343 先更新再回调）

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | `editor.setDocument("# One")` 后立即 `editor.setDocument("# Two")` | [API] 文档为 `"# Two"`——两次 dispatch 顺序应用 | import: @floatboat/nexus-core; API: editor.setDocument(next: string, opts?); 框架: vitest; 等待: 无(同步) |
| 2 | `vi.advanceTimersByTime(100)` | [EVENT] onChange 触发 1 次，`docs` 等于 `["# Two"]`——防抖合并后仅最后一次 emitChange（editor.ts:347-360） | import: vitest; API: vi.advanceTimersByTime(ms: number); 框架: vitest; 等待: vi.advanceTimersByTime(100) |
| 3 | 断言 `asts[0]` | [AST] `asts[0].children[0].type === "heading"` 且 `depth === 1`——`Root.children[0]` 为 `Heading = { type: "heading", depth, children, position }`（adapter:534-539） | import: mdast; API: ast: Root (onChange 第二参); 框架: vitest; 等待: 无(同步) |
| 4 | 断言 `editor.getAst()` 与 `asts[0]` | [AST] 结构一致（heading 文本为 "Two"）——`getAst()` 与 onChange 收到同一 `currentAst` 实例（editor.ts:341-343, 735-737） | import: @floatboat/nexus-core; API: editor.getAst(): Root; 框架: vitest; 等待: 无(同步) |

**断言汇总**:
- [EVENT] `docs` 等于 `["# Two"]`
- [AST] 防抖触发的 AST 对应最新文档：`asts[0].children[0]` 为 depth=1 的 heading，文本 "Two"
- [AST] `editor.getAst()` 与 onChange 收到的 AST 描述同一文档

---

## FP-03-02-E01 [P3] [异常] destroy() 取消未触发的防抖任务

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `""`
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor } from "@floatboat/nexus-core";

  afterEach(() => {
    vi.useRealTimers();
  });

  vi.useFakeTimers();

  const container = document.createElement("div");
  const docs: string[] = [];
  const editor = createEditor({
    container,
    initialValue: "",
    parseDelayMs: 100,
    onChange: (doc: string) => {
      docs.push(doc);
    },
  });
  ```

> 🔧 增强说明:
> - `destroy()` 中清理: `if (parseTimer) { clearTimeout(parseTimer); parseTimer = undefined; }`（editor.ts:954-957）；`emitChange` 开头还有 `if (destroyed) return;` 双保险（editor.ts:324-326）
> - 与 editor.test.ts:315-334（"cancels pending parse work when the editor is destroyed"）同款模式: `vi.useFakeTimers()` → `setDocument` → `destroy()` → `vi.runAllTimers()` → `expect(docs).toEqual([])`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | `editor.setDocument("queued")` | [STATE] 解析任务进入 100ms 定时器排队——`parseTimer = setTimeout(...)`（editor.ts:357） | import: @floatboat/nexus-core; API: editor.setDocument(next: string, opts?); 框架: vitest; 等待: 无(同步) |
| 2 | 立即调用 `editor.destroy()` | [STATE] destroy 清理 parseTimer（`clearTimeout`）——editor.ts:954-957 将 `parseTimer` 置 undefined | import: @floatboat/nexus-core; API: editor.destroy(): void; 框架: vitest; 等待: 无(同步) |
| 3 | `vi.runAllTimers()`（推进并执行所有定时器） | [EVENT] `docs` 为空——排队中的 onChange 已被取消，不再触发（`clearTimeout` 后定时器不再执行；即便执行 `emitChange` 也因 `destroyed` 提前 return，editor.ts:324-326） | import: vitest; API: vi.runAllTimers(); 框架: vitest; 等待: vi.runAllTimers() |
| 4 | 断言容器 DOM | [DOM] `container.querySelector(".cm-editor")` 为 null（编辑器已卸载）——destroy 销毁 view 并移除 DOM | import: vitest; API: container.querySelector(selector): Element | null; 框架: vitest; 等待: 无(同步) |

**断言汇总**:
- [EVENT] `docs` 等于 `[]`（destroy 后定时器回调不执行）
- [DOM] `container.querySelector(".cm-editor")` 为 null

---

## FP-03-02-B01 [P4] [边界] parseDelayMs=0 时不防抖、同步触发 onChange

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `""`
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor } from "@floatboat/nexus-core";

  afterEach(() => {
    vi.useRealTimers();
  });

  const container = document.createElement("div");
  const docs: string[] = [];
  const editor = createEditor({
    container,
    initialValue: "",
    parseDelayMs: 0, // 边界：0ms 防抖 = 每次变更同步 emit
    onChange: (doc: string) => {
      docs.push(doc);
    },
  });
  ```

> 🔧 增强说明:
> - 同步分支精确位置: `scheduleChange` 中 `if (parseDelayMs <= 0) { emitChange(markdown); return; }`（editor.ts:352-354）——注意是 `<= 0`，0 与负值都走同步
> - 本用例无需 `vi.useFakeTimers()`（无定时器参与）

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | `editor.setDocument("x")` | [EVENT] onChange 同步触发（`scheduleChange` 中 `parseDelayMs <= 0` 走直接 emit 分支，editor.ts:352-354） | import: @floatboat/nexus-core; API: editor.setDocument(next: string, opts?); 框架: vitest; 等待: 无(同步 emit) |
| 2 | 断言 `docs` | [EVENT] `docs` 等于 `["x"]`——emitChange → `config.onChange?.("x", currentAst)`（editor.ts:342） | import: @floatboat/nexus-core; API: onChange(doc: string, ast: Root); 框架: vitest; 等待: 无(同步 emit) |
| 3 | 连续 `setDocument("y")`、`setDocument("z")` | [EVENT] 每次各触发一次，`docs` 等于 `["x", "y", "z"]`——无定时器、无合并，逐次同步 emit | import: @floatboat/nexus-core; API: editor.setDocument(next: string, opts?); 框架: vitest; 等待: 无(同步 emit) |

**断言汇总**:
- [EVENT] parseDelayMs=0 时无定时器，`docs` 等于 `["x", "y", "z"]`（每次编辑立即 emit）

---

## FP-03-02-B02 [P4] [边界] 未配置 parseDelayMs 时的实际默认行为（同步，与 PRD 的 100ms 描述存在差异）

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `""`
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor } from "@floatboat/nexus-core";

  afterEach(() => {
    vi.useRealTimers();
  });

  const container = document.createElement("div");
  const docs: string[] = [];
  const editor = createEditor({
    container,
    initialValue: "",
    // 注意：不传 parseDelayMs。PRD 描述默认 100ms，但 packages/core/src/editor.ts:282
    // 实际为 `config.parseDelayMs ?? 0`，即默认 0 = 同步 emit。本用例按代码实际行为断言。
    onChange: (doc: string) => {
      docs.push(doc);
    },
  });
  ```

> 🔧 增强说明:
> - 默认值来源: `const parseDelayMs = config.parseDelayMs ?? 0;`（editor.ts:282）——`undefined` 经 `??` 回退为 0 → `scheduleChange` 同步分支（editor.ts:352-354）
> - 🕳️ 陷阱: 若需求方确认默认应为 100ms，需同时修改 editor.ts:282 默认值与本用例断言（反转后需 `vi.useFakeTimers()` + `advanceTimersByTime(100)`）——**待确认差异项**

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | `editor.setDocument("x")` | [EVENT] 按实际实现（默认 0）同步触发 onChange——`config.parseDelayMs ?? 0`（editor.ts:282）→ `parseDelayMs <= 0` 同步 emit（editor.ts:352-354） | import: @floatboat/nexus-core; API: editor.setDocument(next: string, opts?); 框架: vitest; 等待: 无(同步 emit) |
| 2 | 断言 `docs` | [EVENT] `docs` 等于 `["x"]` | import: @floatboat/nexus-core; API: onChange(doc: string, ast: Root); 框架: vitest; 等待: 无(同步 emit) |
| 3 | 说明标注 | [STATE] 若需求方确认默认应为 100ms，需修改 `editor.ts` 默认值后本用例断言反转（需先触发定时器）——**待确认项** | import: 无; API: 无(说明性步骤); 框架: vitest; 等待: 无(非执行步骤) |

**断言汇总**:
- [EVENT] 未配置 parseDelayMs 时 `docs` 等于 `["x"]`（代码默认同步）
- [STATE] 标注实现与 PRD（默认 100ms）不一致，列为待确认差异项

---

## FP-03-02-B03 [P4] [边界] 防抖期间多轮快速编辑不丢失最终内容

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `""`
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor } from "@floatboat/nexus-core";

  afterEach(() => {
    vi.useRealTimers();
  });

  vi.useFakeTimers();

  const container = document.createElement("div");
  const docs: string[] = [];
  const editor = createEditor({
    container,
    initialValue: "",
    parseDelayMs: 100,
    onChange: (doc: string) => {
      docs.push(doc);
    },
  });
  ```

> 🔧 增强说明:
> - 10 次 `setDocument` 每次经 `scheduleChange` 清旧定时器（editor.ts:347-350），最终只解析 "doc-9"——高频编辑不丢失最终内容

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 连续 10 次 `editor.setDocument("doc-" + i)`（i=0..9，间隔不推进时间） | [API] 文档为 `"doc-9"`（最后一次覆盖）——10 次 dispatch 顺序应用，EditorState 反映最终值 | import: @floatboat/nexus-core; API: editor.setDocument(next: string, opts?); 框架: vitest; 等待: 无(同步) |
| 2 | 断言 `docs` | [EVENT] `docs` 为空（全部在窗口内）——10 个 parseTimer 仅最后 1 个存活 | import: @floatboat/nexus-core; API: onChange(doc: string, ast: Root); 框架: vitest; 等待: 无(窗口内尚不触发) |
| 3 | `vi.advanceTimersByTime(100)` | [EVENT] 仅触发 1 次，参数为 `"doc-9"`（最终内容不丢失）——残留定时器 emitChange("doc-9") | import: vitest; API: vi.advanceTimersByTime(ms: number); 框架: vitest; 等待: vi.advanceTimersByTime(100) |
| 4 | 断言 `editor.getDocument()` 与 `getAst()` | [API][AST] 文档 `"doc-9"`；`getAst()` 解析结果与 `"doc-9"` 一致（paragraph 文本）——`getAst(): Root` children[0] 为 Paragraph，text 节点 value === "doc-9" | import: @floatboat/nexus-core; API: editor.getDocument(): string; editor.getAst(): Root; 框架: vitest; 等待: 无(同步) |

**断言汇总**:
- [EVENT] `docs` 等于 `["doc-9"]`（高频编辑只解析最终版）
- [API] `getDocument()` === "doc-9"
- [AST] `getAst().children[0]` 文本内容 === "doc-9"

---

## 增强信息来源
- API签名: packages/core/src/editor.ts
- AST映射: packages/core/src/lezer-mdast-adapter.ts
- 装饰生成: packages/core/src/live-preview.ts
- 测试参考: packages/core/test/editor.test.ts
- 陷阱提示: AGENTS.md

---

## FP-03-03-N01 [P1] [正常] 标题节点→Mark+Replace 装饰（光标移开时隐藏 `# ` 前缀）

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `"# Heading\n\nend"`
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor } from "@floatboat/nexus-core";

  afterEach(() => {
    vi.useRealTimers();
  });

  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "# Heading\n\nend",
    livePreview: true, // 开启 Live Preview 装饰
    parseDelayMs: 0,
  });

  // 把光标移到标题结构之外（"end" 行末尾）
  editor.setSelection(editor.getDocument().length);
  ```

> 🔧 增强说明:
> - `livePreview: true` 经 `normalizeConfig` → `{ enabled: true, renderers: {}, labels: DEFAULT_LABELS }`（live-preview.ts:90-92）；`createLivePreviewExtension` 返回非空扩展数组（live-preview.ts:1306 仅 `!normalized.enabled` 时返回 `[]`）
> - heading 装饰实现（buildHeadingDecorations, live-preview.ts:440-471）: 光标不在 heading（`!selectionIntersects`）时 `Decoration.replace({}).range(range.from, textStart)` 隐藏 `# ` marker；内容区间 `Decoration.mark({ attributes: { style, "data-heading-level": String(depth), role: "heading", "aria-level": String(depth) } })`（live-preview.ts:460-469）
> - `textStart = firstChild?.position?.start.offset`（live-preview.ts:441），即 heading 首个子节点（文本）的起点
> - 🕳️ 陷阱: 光标**落在 heading 内**时 marker 不隐藏（改用 muted 样式的 Mark，live-preview.ts:450-455）——本用例先 `setSelection(doc.length)` 把光标移到 "end" 行，确保走 Replace 隐藏分支

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言标题文本装饰 | [DOM] `container.querySelector("[data-heading-level='1']")` 存在且 textContent 为 `"Heading"`——`Decoration.mark` attributes 携带 `data-heading-level`（live-preview.ts:464），作用于 `[textStart, range.to)` 内容区间 | import: vitest; API: container.querySelector("[data-heading-level='1']"): Element | null; 框架: vitest; 等待: 无(同步渲染) |
| 2 | 断言 `# ` 前缀被替换隐藏 | [DOM] `container.textContent` 不包含 `"# Heading"`——`Decoration.replace({}).range(range.from, textStart)` 用空内容替换 marker 区间（live-preview.ts:457） | import: vitest; API: container.textContent: string; 框架: vitest; 等待: 无(同步渲染) |
| 3 | 断言 heading 语义属性 | [DOM] 装饰元素带 `role="heading"` 与 `aria-level="1"`——Mark attributes 中的 `role` / `aria-level`（live-preview.ts:465-466） | import: vitest; API: container.querySelector("[data-heading-level='1']")?.getAttribute(name): string | null; 框架: vitest; 等待: 无(同步渲染) |
| 4 | 断言 `getAst()` | [AST] `children[0].type === "heading"`、`depth === 1`——AST 驱动装饰的数据源（`collectLivePreviewRanges` 遍历 ast，live-preview.ts:1061） | import: @floatboat/nexus-core; API: editor.getAst(): Root; 框架: vitest; 等待: 无(同步) |

**断言汇总**:
- [DOM] `container.querySelector("[data-heading-level='1']")?.textContent` === "Heading"
- [DOM] `container.textContent` 不含 "# Heading"（marker 被 Replace 装饰隐藏）
- [DOM] 装饰元素 `role`/`aria-level` 属性存在
- [AST] 装饰数据源 `getAst().children[0]` 为 depth=1 的 heading

---

## FP-03-03-N02 [P1] [正常] 链接节点→data-link-url Widget（隐藏 markdown 语法）

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `"[link](https://example.com)\n\nend"`
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor } from "@floatboat/nexus-core";

  afterEach(() => {
    vi.useRealTimers();
  });

  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "[link](https://example.com)\n\nend",
    livePreview: true,
    parseDelayMs: 0,
  });

  // 光标移到链接所在行之外，触发紧凑链接 Widget
  editor.setSelection(editor.getDocument().length);
  ```

> 🔧 增强说明:
> - link 装饰实现: `source.indexOf("](")` 定位 `[` 与 `](url)`，`openLen: 1`（hide `[`）、`closeLen: source.length - bracketClose`（hide `](url)`），mark attrs `{ "data-link-url": url }`（live-preview.ts:999-1009）；autolink `<URL>` 隐藏尖括号（1012-1017）；裸 URL 无 marker 可隐藏（1019-1024）
> - 🕳️ 陷阱: `data-link-url` 取值为**去除括号后的 URL**（`source.slice(bracketClose + 2, source.length - 1)`，live-preview.ts:1003）——断言时不要含 `]`/`)`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言链接 Widget 存在 | [DOM] `container.querySelector("[data-link-url]")` 非空——`Decoration.mark` attrs 携带 `data-link-url`（live-preview.ts:1008） | import: vitest; API: container.querySelector("[data-link-url]"): Element | null; 框架: vitest; 等待: 无(同步渲染) |
| 2 | 断言 data-link-url 属性值 | [DOM] 该元素 `getAttribute("data-link-url")` === `"https://example.com"`——attr 值为 `source.slice(bracketClose + 2, length - 1)`（live-preview.ts:1003, 1008） | import: vitest; API: element.getAttribute(name): string | null; 框架: vitest; 等待: 无(同步渲染) |
| 3 | 断言显示文本 | [DOM] 元素 textContent === `"link"`（隐藏 `[` 与 `](url)`）——openLen 1 / closeLen 隐藏两侧 marker（live-preview.ts:1005-1006） | import: vitest; API: element.textContent: string; 框架: vitest; 等待: 无(同步渲染) |
| 4 | 断言源码语法被替换 | [DOM] `container.textContent` 不包含 `"[link](https://example.com)"`——link 区间被 mark 装饰替换隐藏 | import: vitest; API: container.textContent: string; 框架: vitest; 等待: 无(同步渲染) |

**断言汇总**:
- [DOM] `container.querySelector("[data-link-url]")?.getAttribute("data-link-url")` === "https://example.com"
- [DOM] Widget textContent === "link"，容器文本不含原始链接语法
- [AST] `getAst()` 中对应节点为 link 类型（装饰由 AST 节点驱动）

---

## FP-03-03-N03 [P2] [正常] 列表节点→bullet Widget（`- ` marker 替换为圆点）

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `"- item\n\nend"`
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor } from "@floatboat/nexus-core";

  afterEach(() => {
    vi.useRealTimers();
  });

  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "- item\n\nend",
    livePreview: true,
    parseDelayMs: 0,
  });

  // 光标移到列表项之外
  editor.setSelection(editor.getDocument().length);
  ```

> 🔧 增强说明:
> - list 装饰实现（buildListDecorations, live-preview.ts:476+）: `LIST_MARKER_RE = /^(\s*)([-*+]|\d+[.)]) /`（473）匹配 marker；无序 bullet 用 `\u2022 `（"• "）widget（live-preview.ts:523-529），有序列表用 `${ordinal}. `（519）
> - marker 区间由 `Decoration.replace` 替换为 bullet widget（`createWidget(bullet, ...)`，live-preview.ts:529）
> - mdast `List = { type: "list", ordered: boolean, start?: number, children: ListItem[] }`（adapter:467）

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言圆点 Widget 渲染 | [DOM] `container.textContent` 包含 `"•"`——无序列表 bullet widget 文本 `\u2022 `（live-preview.ts:523-524） | import: vitest; API: container.textContent: string; 框架: vitest; 等待: 无(同步渲染) |
| 2 | 断言内容保留 | [DOM] `container.textContent` 包含 `"item"`——listItem 文本保留（仅 marker 被替换） | import: vitest; API: container.textContent: string; 框架: vitest; 等待: 无(同步渲染) |
| 3 | 断言原始 marker 被替换 | [DOM] `container.textContent` 不包含 `"- item"`——`- ` 前缀被 `Decoration.replace`（bullet widget）隐藏（live-preview.ts:529） | import: vitest; API: container.textContent: string; 框架: vitest; 等待: 无(同步渲染) |
| 4 | 断言 AST | [AST] `getAst().children[0].type === "list"`，`list.ordered === false`——mdast `List` 节点（adapter:467）无序（`ordered` 缺省 false） | import: @floatboat/nexus-core; API: editor.getAst(): Root; 框架: vitest; 等待: 无(同步) |

**断言汇总**:
- [DOM] 容器文本含 "•" 与 "item"，不含 "- item"
- [AST] `getAst().children[0]` 为无序 list（装饰数据源）

---

## FP-03-03-N04 [P2] [正常] 行内 strong/emphasis→样式 Mark（隐藏 `**`/`*` marker）

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `"Text **bold** *italic*\n\nend"`
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor } from "@floatboat/nexus-core";

  afterEach(() => {
    vi.useRealTimers();
  });

  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "Text **bold** *italic*\n\nend",
    livePreview: true,
    parseDelayMs: 0,
  });

  // 光标移到另一行，触发 marker 隐藏（line-level 检测）
  editor.setSelection(editor.getDocument().length);
  ```

> 🔧 增强说明:
> - 行内格式装饰（live-preview.ts:1216-1241）: marker 用 `Decoration.replace({}).range(from, from + openLen)` / `(to - closeLen, to)` 隐藏（1233-1236）；内容区间用 `Decoration.mark({ attributes: { style, ...attrs } })`（1241）
> - mdast 节点映射: strong → `{ type: "strong" }`（adapter:257），emphasis → `{ type: "emphasis" }`（adapter:265）
> - 🕳️ 陷阱: marker 隐藏仅在光标不在该行内生效（`selectionIntersects` 判定，live-preview.ts:1218 注释）——本用例 `setSelection(doc.length)` 移开光标

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言文本内容保留 | [DOM] `container.textContent` 包含 `"bold"` 与 `"italic"`——内容区间被 `Decoration.mark` 保留渲染 | import: vitest; API: container.textContent: string; 框架: vitest; 等待: 无(同步渲染) |
| 2 | 断言 strong marker 隐藏 | [DOM] `container.textContent` 不包含 `"**"`——strong 两侧 marker 被 `Decoration.replace` 隐藏（live-preview.ts:1233-1236） | import: vitest; API: container.textContent: string; 框架: vitest; 等待: 无(同步渲染) |
| 3 | 断言 emphasis marker 隐藏 | [DOM] `container.textContent` 不包含 `"*italic*"`——emphasis marker 隐藏（同 replace 机制） | import: vitest; API: container.textContent: string; 框架: vitest; 等待: 无(同步渲染) |
| 4 | 断言 AST | [AST] `getAst().children[0].children` 中包含 `{ type: "strong" }` 与 `{ type: "emphasis" }`——行内节点映射（adapter:257/265），Mark 装饰数据源 | import: @floatboat/nexus-core; API: editor.getAst(): Root; 框架: vitest; 等待: 无(同步) |

**断言汇总**:
- [DOM] 文本含 "bold"/"italic"，不含 "**" 与 "*italic*"
- [AST] 行内节点类型为 strong/emphasis（Mark 装饰数据源）

---

## FP-03-03-N05 [P1] [正常] 图片节点→data-live-preview-image Widget（源码替换为预览）

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `"![alt](img.png)\n\nend"`
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor } from "@floatboat/nexus-core";

  afterEach(() => {
    vi.useRealTimers();
  });

  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "![alt](img.png)\n\nend",
    livePreview: true,
    parseDelayMs: 0,
  });

  // 光标移出图片范围 → 图片替换为预览 Widget
  editor.setSelection(editor.getDocument().length);
  ```

> 🔧 增强说明:
> - 图片装饰（live-preview.ts:1112-1141）: 光标不在图片（`!cursorOnImage`）时 `Decoration.replace({ widget: createWidget(buildImg, true, undefined, imgKey) }).range(from, to)`（1130-1134）——整段源码被替换；`imgKey = "image:${from}:${to}:${in|out}:${source}"` 稳定身份供 CM6 复用 DOM（1126）
> - 渲染器（live-preview-renderers.ts:193-205）: wrapper `data-live-preview-image` = `context.node.url`（197）；img `src` = url（198）、`alt` = `node.alt ?? ""`（199）；label 显示 alt 或 url（201）
> - mdast `Image = { type: "image", url, alt?, title?, position }`（adapter:381）
> - 🕳️ 陷阱: `createWidget(buildImg, true, ...)` 第二参 `swallowEvents = true`（live-preview.ts:1119-1120 注释）——测试断言 DOM 属性不受影响，但不要试图派发鼠标事件到 widget 内部

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言图片 Widget 存在 | [DOM] `container.querySelector("[data-live-preview-image]")` 非空——wrapper 属性（live-preview-renderers.ts:197） | import: vitest; API: container.querySelector("[data-live-preview-image]"): Element | null; 框架: vitest; 等待: 无(同步渲染) |
| 2 | 断言 URL 属性 | [DOM] 该元素 `getAttribute("data-live-preview-image")` === `"img.png"`——attr = `context.node.url`（renderers.ts:197） | import: vitest; API: element.getAttribute(name): string | null; 框架: vitest; 等待: 无(同步渲染) |
| 3 | 断言 img 元素 | [DOM] Widget 内含 `<img>`，`src` === `"img.png"`，`alt` === `"alt"`——`element.src = context.node.url` / `element.alt = context.node.alt ?? ""`（renderers.ts:198-199） | import: vitest; API: container.querySelector("img")?.src/.alt; 框架: vitest; 等待: 无(同步渲染) |
| 4 | 断言源码被替换 | [DOM] `container.textContent` 不包含 `"![alt](img.png)"`——`Decoration.replace` 整段替换图片源码（live-preview.ts:1130-1134） | import: vitest; API: container.textContent: string; 框架: vitest; 等待: 无(同步渲染) |

**断言汇总**:
- [DOM] `container.querySelector("[data-live-preview-image]")?.getAttribute(...)` === "img.png"
- [DOM] Widget 内 `img` 的 src/alt 与 markdown 一致，源码语法不可见

---

## FP-03-03-D01 [P3] [数据] 表格节点→block Replace Widget（GFM 表格折叠为可编辑表格）

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `"| A | B |\n| --- | --- |\n| 1 | 2 |"`
- 插件配置: `preset-gfm`（`createGfmPreset`，表格需 GFM 解析）
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor } from "@floatboat/nexus-core";
  import { createGfmPreset } from "@floatboat/nexus-preset-gfm";

  afterEach(() => {
    vi.useRealTimers();
  });

  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "| A | B |\n| --- | --- |\n| 1 | 2 |",
    livePreview: true,
    parseDelayMs: 0,
    plugins: [createGfmPreset()],
  });
  ```

> 🔧 增强说明:
> - 表格装饰（live-preview.ts:1078-1086）: `Decoration.replace({ widget: new EditableTableWidget(range.node as Table, range.from, range.source, viewRef, config.labels), block: true }).range(from, to)`——`block: true` 整块替换
> - 单元格类名 `nexus-cell`: `td.className = "nexus-cell"`（live-preview-table.ts:1773）；表头 `th`（renderers.ts:173 首行 th）
> - mdast `Table = { type: "table", children: TableRow[] }`，`TableRow = { type: "tableRow", children: TableCell[] }`（adapter:482/489）
> - 🕳️ 陷阱: 表格渲染依赖 `createGfmPreset`（`@floatboat/nexus-preset-gfm`）提供 GFM 解析——缺 preset 时 lezer 不会产出 table 节点，装饰分支不触发

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言表格 Widget 渲染 | [DOM] `container.querySelector("table")` 非空——`EditableTableWidget` 渲染 `<table>` | import: vitest; API: container.querySelector("table"): Element | null; 框架: vitest; 等待: 无(同步渲染) |
| 2 | 断言表头/单元格 | [DOM] `container.querySelectorAll("th")` 长度为 2，`th` 文本为 `"A"`/`"B"`——首行渲染为 th（live-preview-renderers.ts:173） | import: vitest; API: container.querySelectorAll("th"): NodeListOf<Element>; 框架: vitest; 等待: 无(同步渲染) |
| 3 | 断言 nexus-cell 类 | [DOM] 数据行单元格带 `nexus-cell` 类（可编辑单元格契约）——`td.className = "nexus-cell"`（live-preview-table.ts:1773） | import: vitest; API: td.classList.contains("nexus-cell"): boolean; 框架: vitest; 等待: 无(同步渲染) |
| 4 | 断言源码被折叠 | [DOM] `container.textContent` 不包含 `"| --- | --- |"`（整表被 block replace Widget 替换）——`Decoration.replace(..., { block: true })`（live-preview.ts:1080-1085） | import: vitest; API: container.textContent: string; 框架: vitest; 等待: 无(同步渲染) |
| 5 | 断言 AST | [AST] `getAst()` 中包含 `type === "table"` 节点——`Table` 节点（adapter:489），Widget 数据源 | import: @floatboat/nexus-core; API: editor.getAst(): Root; 框架: vitest; 等待: 无(同步) |

**断言汇总**:
- [DOM] `container.querySelector("table")` 非空，`th` 数量 2，数据行含 `nexus-cell`
- [DOM] 表格源码（分隔行）不可见
- [AST] AST 含 table 节点（Widget 由 AST 节点驱动）

---

## FP-03-03-D02 [P5] [数据] 自定义 renderer 覆盖默认节点装饰（宿主接管渲染）

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `"Intro\n\n# Heading"`
- 插件配置: 无（通过 `LivePreviewConfig.renderers` 注入宿主渲染器）
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor } from "@floatboat/nexus-core";

  afterEach(() => {
    vi.useRealTimers();
  });

  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "Intro\n\n# Heading",
    livePreview: {
      // 宿主自定义 heading 渲染器：优先于内置 Mark+Replace 装饰
      renderers: {
        heading({ text }) {
          const element = document.createElement("div");
          element.setAttribute("data-heading", "custom");
          element.textContent = text.toUpperCase();
          return element;
        },
      },
    },
    parseDelayMs: 0,
  });
  ```

> 🔧 增强说明:
> - `livePreview: { renderers }` 经 `normalizeConfig` → `{ enabled: true, renderers: config.renderers ?? {}, labels }`（live-preview.ts:94）——`renderers.heading` 非空时 buildDecorations 走 `renderLivePreviewNode` 分支
> - 覆盖短路点: `if (range.node.type === "heading" && !config.renderers.heading) { buildHeadingDecorations(...) }`（live-preview.ts:1070）——存在 `renderers.heading` 时内置装饰分支被跳过
> - 渲染入口: `renderLivePreviewNode(node: LivePreviewNode, source: string, renderers, from = 0, to = 0): HTMLElement`（live-preview-renderers.ts:213-219），`renderers[node.type]?.(context) ?? createDefaultRenderer(context)`（229）
> - renderer context 含 `{ node, nodeType, source, text, from, to }`（220-227），`text` 为 `getText(node)`（节点纯文本）

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言自定义渲染器生效 | [DOM] `container.querySelector("[data-heading='custom']")` 非空——`renderLivePreviewNode` 调 `renderers.heading`（live-preview-renderers.ts:229） | import: vitest; API: container.querySelector("[data-heading='custom']"): Element | null; 框架: vitest; 等待: 无(同步渲染) |
| 2 | 断言渲染结果 | [DOM] 该元素 textContent === `"HEADING"`（自定义逻辑：大写）——渲染器返回元素直接挂载（renderers.ts:213-219） | import: vitest; API: element.textContent: string; 框架: vitest; 等待: 无(同步渲染) |
| 3 | 断言默认装饰被接管 | [DOM] `container.querySelector("[data-heading-level]")` 为 null（内置 heading 装饰分支被 `renderers.heading` 短路）——`!config.renderers.heading` 条件不成立（live-preview.ts:1070） | import: vitest; API: container.querySelector("[data-heading-level]"): Element | null; 框架: vitest; 等待: 无(同步渲染) |
| 4 | 断言 AST 仍由引擎提供 | [AST] `getAst().children[1].type === "heading"`（AST 不因自定义渲染而改变）——渲染器只影响 DOM 装饰，AST 仍由 Lezer adapter 产出 | import: @floatboat/nexus-core; API: editor.getAst(): Root; 框架: vitest; 等待: 无(同步) |

**断言汇总**:
- [DOM] `[data-heading='custom']` 存在且 textContent === "HEADING"
- [DOM] 内置 `[data-heading-level]` 装饰不出现（renderers 覆盖）
- [AST] AST 仍由解析器产出，不受渲染器影响

---

## FP-03-03-B01 [P4] [边界] 光标进入结构时恢复源码 marker（编辑态展开）

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `"Text **bold**\n\nend"`
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor } from "@floatboat/nexus-core";

  afterEach(() => {
    vi.useRealTimers();
  });

  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "Text **bold**\n\nend",
    livePreview: true,
    parseDelayMs: 0,
  });

  // 初始：光标在另一行
  editor.setSelection(editor.getDocument().length);
  ```

> 🔧 增强说明:
> - 光标感知机制: 行内格式装饰通过 `selectionIntersects(range.from, range.to, selection)` 判断光标是否与节点区间相交（live-preview.ts:1218-1241 注释）；相交时保留 marker（编辑态），不相交时 `Decoration.replace` 隐藏
> - 光标移动 = selection-only Transaction：StateField.update 中 `!tr.docChanged` 分支走 `build(tr.state, ...)` 重算装饰（live-preview.ts:1369+ 后置分支），AST 缓存复用（`reuseCache` 与 `lastBuilt` 命中，live-preview.ts:1323-1327）
> - 与 live-preview.test.ts:91-96 同款断言：`setSelection(8)` 后 `container.textContent` 含 "**bold**"
> - 🕳️ 陷阱: 装饰只影响视图 DOM，不改文档——`getDocument()` 始终保留源码 marker

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言光标在行外时 marker 隐藏 | [DOM] `container.textContent` 不包含 `"**bold**"`——光标不在 strong 区间，marker 被 replace 隐藏（live-preview.ts:1233-1236） | import: vitest; API: container.textContent: string; 框架: vitest; 等待: 无(同步渲染) |
| 2 | 移动光标到 bold 行内：`editor.setSelection(8)` | [STATE] selection-only Transaction 触发装饰重算（AST 缓存复用，仅光标感知装饰刷新）——`setSelection` dispatch `{ selection }` 无 changes（editor.ts:787-790）；StateField 缓存命中 `lastBuilt`（live-preview.ts:1323-1327） | import: @floatboat/nexus-core; API: editor.setSelection(anchor: number, head?: number); 框架: vitest; 等待: 无(同步) |
| 3 | 断言 marker 恢复 | [DOM] `container.textContent` 包含 `"**bold**"`（光标在行内时保留源码 marker 供直接编辑）——`selectionIntersects` 为真走编辑态分支（live-preview.ts:1218） | import: vitest; API: container.textContent: string; 框架: vitest; 等待: 无(同步渲染) |
| 4 | 断言 getDocument 未变 | [API] `getDocument()` 仍为 `"Text **bold**\n\nend"`（纯选区移动不改文档）——`getDocument(): string`，selection-only Transaction `docChanged === false` | import: @floatboat/nexus-core; API: editor.getDocument(): string; 框架: vitest; 等待: 无(同步) |

**断言汇总**:
- [DOM] 光标在行内时 `container.textContent` 含 "**bold**"，行外时不含
- [API] 光标切换前后 `getDocument()` 不变（装饰只影响视图，不影响文档/EditorState）
- [STATE] 选区变化触发装饰重算（Live Preview 光标感知）

---

## FP-03-03-E01 [P3] [异常] livePreview=false（未开启）时无任何装饰，源码直显

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `"# Heading\n\n[link](https://example.com)"`
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor } from "@floatboat/nexus-core";

  afterEach(() => {
    vi.useRealTimers();
  });

  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "# Heading\n\n[link](https://example.com)",
    // 不传 livePreview（默认 undefined = 不启用装饰扩展）
    parseDelayMs: 0,
  });
  ```

> 🔧 增强说明:
> - `normalizeConfig(undefined)` → `{ enabled: false, renderers: {}, labels }`（live-preview.ts:86-88）；`createLivePreviewExtension` 中 `if (!normalized.enabled) return [];`（live-preview.ts:1306）——无装饰扩展注入
> - 兜底: `buildDecorations` 中 `if (!config.enabled) return { decos: Decoration.none, ast: ctx.ast ?? createEmptyAst(), codeTokens: [] };`（live-preview.ts:1046）
> - 🕳️ 陷阱: livePreview 不传（undefined）与显式 `false` 行为一致（均 disabled）；显式 `true` 或对象才开启（87-94）

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言无 heading 装饰 | [DOM] `container.querySelector("[data-heading-level]")` 为 null——无装饰扩展（live-preview.ts:1306 返回 []） | import: vitest; API: container.querySelector("[data-heading-level]"): Element | null; 框架: vitest; 等待: 无(同步) |
| 2 | 断言无 link 装饰 | [DOM] `container.querySelector("[data-link-url]")` 为 null——同上 | import: vitest; API: container.querySelector("[data-link-url]"): Element | null; 框架: vitest; 等待: 无(同步) |
| 3 | 断言源码原样显示 | [DOM] `container.textContent` 包含 `"# Heading"` 与 `"[link](https://example.com)"`——`Decoration.none` 源码直显 | import: vitest; API: container.textContent: string; 框架: vitest; 等待: 无(同步) |
| 4 | 断言数据流仍完整 | [AST][EVENT] `getAst().children[0].type === "heading"`；修改文档时 onChange 仍触发（装饰关闭不影响解析与输出）——`emitChange`/`scheduleChange` 与装饰扩展解耦（editor.ts:341-343） | import: @floatboat/nexus-core; API: editor.getAst(): Root; onChange(doc: string, ast: Root); 框架: vitest; 等待: 无(同步) |

**断言汇总**:
- [DOM] livePreview 关闭时无任何装饰 DOM（源码直显）
- [AST][EVENT] AST 解析与 onChange 输出不受影响（装饰与数据流解耦）

---

## 增强信息来源
- API签名: packages/core/src/editor.ts
- AST映射: packages/core/src/lezer-mdast-adapter.ts
- 装饰生成: packages/core/src/live-preview.ts
- 测试参考: packages/core/test/editor.test.ts
- 陷阱提示: AGENTS.md

---

## FP-03-04-N01 [P1] [正常] onChange(doc, ast) 参数与文档及 AST 一致

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `""`
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { afterEach, expect, it, vi } from "vitest";
  import type { Root } from "mdast";
  import { createEditor } from "@floatboat/nexus-core";

  afterEach(() => {
    vi.useRealTimers();
  });

  const container = document.createElement("div");
  const onChange = vi.fn((_doc: string, _ast: Root) => {});
  const editor = createEditor({
    container,
    initialValue: "",
    parseDelayMs: 0,
    onChange,
  });
  ```

> 🔧 增强说明:
> - `onChange?: (doc: string, ast: Root) => void`（types.ts:113）——第一参 markdown 文档字符串，第二参 mdast Root
> - `vi.fn((_doc: string, _ast: Root) => {})` 泛型推导出 mock 签名，`onChange.mock.calls[0]` 为 `[string, Root]` 元组
> - 回调与 `getDocument()`/`getAst()` 一致性的根源: `emitChange` 中 `currentAst = transformAst(lezerAstFromAnywhere(viewRef, markdown))` **先更新**再 `config.onChange?.(markdown, currentAst)`（editor.ts:341-343）

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | `editor.setDocument("# Hello")` | [EVENT] onChange 被调用 1 次——`scheduleChange` 同步 emit（parseDelayMs=0，editor.ts:352-354） | import: @floatboat/nexus-core; API: editor.setDocument(next: string, opts?); 框架: vitest; 等待: 无(同步 emit) |
| 2 | 断言第一个参数 | [EVENT] `onChange.mock.calls[0][0]` === `"# Hello"`（markdown 文档）——第一参为 markdown 字符串（editor.ts:341 传入） | import: vitest; API: vi.fn().mock.calls[0][0]: string; 框架: vitest; 等待: 无(同步) |
| 3 | 断言第二个参数 | [EVENT] `onChange.mock.calls[0][1].type` === `"root"`，且 `children[0].type` === `"heading"`、`depth` === 1——第二参为 `currentAst: Root`（editor.ts:342），`Heading` 结构（adapter:534-539） | import: vitest; API: vi.fn().mock.calls[0][1]: Root; 框架: vitest; 等待: 无(同步) |
| 4 | 断言 getDocument/getAst 与回调一致 | [API][AST] `getDocument()` === `"# Hello"`；`getAst().children[0]` 为同一 heading——`getAst()` 返回同一 `currentAst`（editor.ts:735-737） | import: @floatboat/nexus-core; API: editor.getDocument(): string; editor.getAst(): Root; 框架: vitest; 等待: 无(同步) |

**断言汇总**:
- [EVENT] `onChange` 被调用 1 次，参数 `(markdown, ast)` 完整
- [EVENT] markdown 参数 === "# Hello"，ast 参数为含 heading 的 mdast Root
- [API][AST] 回调参数与 `getDocument()` / `getAst()` 一致（对外输出 = 引擎当前状态）

---

## FP-03-04-N02 [P2] [正常] getAst() 与 onChange 收到的 AST 为同一实例

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `""`
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { afterEach, expect, it, vi } from "vitest";
  import type { Root } from "mdast";
  import { createEditor } from "@floatboat/nexus-core";

  afterEach(() => {
    vi.useRealTimers();
  });

  const container = document.createElement("div");
  let lastAst: Root | null = null;
  const editor = createEditor({
    container,
    initialValue: "",
    parseDelayMs: 0,
    onChange: (_doc: string, ast: Root) => {
      lastAst = ast;
    },
  });
  ```

> 🔧 增强说明:
> - 同一实例的根源: `emitChange` 先 `currentAst = transformAst(...)`，后 `config.onChange?.(markdown, currentAst)`（editor.ts:341-343）——回调收到的引用即 `currentAst`；`getAst(): Root` 返回 `currentAst`（editor.ts:735-737）
> - 每次变更 `transformAst` 生成**新** AST 实例并替换 `currentAst`（无原地复用），所以同一性在每次变更后对最新实例成立

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | `editor.setDocument("hello world")` | [EVENT] onChange 触发，`lastAst` 被赋值——`config.onChange?.(markdown, currentAst)`（editor.ts:342） | import: @floatboat/nexus-core; API: editor.setDocument(next: string, opts?); 框架: vitest; 等待: 无(同步 emit) |
| 2 | 断言实例同一性 | [AST] `editor.getAst() === lastAst`——`emitChange` 先更新 `currentAst` 再传给回调，getAst 读同一引用（editor.ts:341-343, 735-737） | import: @floatboat/nexus-core; API: editor.getAst(): Root; 框架: vitest; 等待: 无(同步) |
| 3 | 再次 `editor.setDocument("changed")` | [AST] `editor.getAst() === lastAst` 仍然成立——每次变更替换为新实例并共享（transformAst 新对象） | import: @floatboat/nexus-core; API: editor.setDocument(next: string, opts?); 框架: vitest; 等待: 无(同步 emit) |

**断言汇总**:
- [AST] `editor.getAst() === lastAst`（onChange 与 getAst 共享同一 AST 实例，无二次拷贝）

---

## FP-03-04-D01 [P3] [数据] 初始创建不触发 onChange，首次变更才触发

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `"# Initial"`
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor } from "@floatboat/nexus-core";

  afterEach(() => {
    vi.useRealTimers();
  });

  const container = document.createElement("div");
  const onChange = vi.fn();
  const editor = createEditor({
    container,
    initialValue: "# Initial",
    parseDelayMs: 0,
    onChange,
  });
  ```

> 🔧 增强说明:
> - 初始 `currentAst` 由 `transformAst(lezerStringToMdast(config.initialValue ?? ""))` 同步计算（editor.ts:298-300），**不经过** `emitChange`——故初始文档不触发 onChange
> - `vi.fn()` 无参数签名时 `onChange.mock.calls` 元素为 `any[]`，断言类型需自行收窄（建议 `expect(onChange).not.toHaveBeenCalled()`）

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言创建后未触发 | [EVENT] `onChange` 未被调用（初始文档不视为"变更"，无 onChange 输出）——初始解析不经 emitChange（editor.ts:298-300 vs 323-344） | import: vitest; API: vi.fn().toHaveBeenCalled(); 框架: vitest; 等待: 无(同步) |
| 2 | 断言初始 AST 已就绪 | [AST] `getAst().children[0].type === "heading"`——初始 `currentAst` 在创建时同步解析（editor.ts:298-300），`# Initial` 产出 Heading（adapter:534） | import: @floatboat/nexus-core; API: editor.getAst(): Root; 框架: vitest; 等待: 无(同步) |
| 3 | `editor.setDocument("# Changed")` | [EVENT] onChange 触发 1 次，参数 `"# Changed"`——变更路径走 `scheduleChange` → `emitChange`（editor.ts:352-354, 341-343） | import: @floatboat/nexus-core; API: editor.setDocument(next: string, opts?); 框架: vitest; 等待: 无(同步 emit) |
| 4 | 断言回调次数 | [EVENT] `onChange` 总调用次数为 1——`expect(onChange).toHaveBeenCalledTimes(1)` | import: vitest; API: vi.fn().toHaveBeenCalledTimes(n); 框架: vitest; 等待: 无(同步) |

**断言汇总**:
- [EVENT] 创建时 `onChange` 调用次数为 0；首次变更后为 1
- [AST] 初始 `getAst()` 已包含 heading（引擎启动即完成初始解析）

---

## FP-03-04-E01 [P3] [异常] silent setDocument 不触发 onChange 但 getDocument/getAst 保持同步

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `"old content"`
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor } from "@floatboat/nexus-core";

  afterEach(() => {
    vi.useRealTimers();
  });

  const container = document.createElement("div");
  const onChange = vi.fn();
  const editor = createEditor({
    container,
    initialValue: "old content",
    parseDelayMs: 0,
    onChange,
  });
  ```

> 🔧 增强说明:
> - `silentDocChange = Annotation.define<boolean>()`（editor.ts:6）；`performSetDocument` 中 silent 时 dispatch `annotations: silentDocChange.of(true)`（editor.ts:433）
> - updateListener 检测: `update.transactions.some((t) => t.annotation(silentDocChange) === true)`（editor.ts:584）→ silent 时**跳过** `scheduleChange`（editor.ts:602-616），onChange 不触发
> - silent 模式仍同步重算 `currentAst`（editor.ts:439 注释），保证 `getAst()` 反映已载入文档
> - 同款既有测试: editor.test.ts:587-597（"replaceRange: silent suppresses onChange but getAst() stays consistent"）

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | `editor.setDocument("# New", { silent: true })` | [API] 文档更新为 `"# New"`（silent 走 `silentDocChange` Annotation，跳过用户编辑路径）——`setDocument(next, opts)` 透传 opts（editor.ts:805-822），silent 注解注入 dispatch（editor.ts:433） | import: @floatboat/nexus-core; API: editor.setDocument(next: string, opts?: { silent?: boolean }); 框架: vitest; 等待: 无(同步) |
| 2 | 断言 onChange 未触发 | [EVENT] `onChange` 未被调用（silent = 非用户编辑，如文件加载）——updateListener silent 检测跳过 scheduleChange（editor.ts:584, 602-616） | import: vitest; API: vi.fn().toHaveBeenCalled(); 框架: vitest; 等待: 无(同步) |
| 3 | 断言 getAst 已同步 | [AST] `getAst().children[0].type === "heading"`——silent 模式下仍内联重算 currentAst（editor.ts:439） | import: @floatboat/nexus-core; API: editor.getAst(): Root; 框架: vitest; 等待: 无(同步) |
| 4 | 后续非 silent 变更恢复正常 | [EVENT] `editor.setDocument("x")` 后 onChange 触发 1 次——无 silent 注解走正常 scheduleChange 路径 | import: @floatboat/nexus-core; API: editor.setDocument(next: string, opts?); 框架: vitest; 等待: 无(同步 emit) |

**断言汇总**:
- [EVENT] `setDocument(next, { silent: true })` 后 `onChange` 调用次数为 0
- [API][AST] `getDocument()` === "# New" 且 `getAst()` 反映新文档（silent 不破坏一致性）

---

## FP-03-04-E02 [P3] [异常] on("change") 事件与 onChange 回调同时触发且参数一致

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `""`
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor } from "@floatboat/nexus-core";

  afterEach(() => {
    vi.useRealTimers();
  });

  const container = document.createElement("div");
  const onChange = vi.fn();
  const onEvent = vi.fn();
  const editor = createEditor({
    container,
    initialValue: "",
    parseDelayMs: 0,
    onChange,
  });
  editor.on("change", onEvent);
  ```

> 🔧 增强说明:
> - 双通道根源: `emitChange` 依次执行 `config.onChange?.(markdown, currentAst)` **和** `emitter.emit("change", markdown, currentAst)`（editor.ts:342-343）——两个通道收到完全相同的 `(markdown, currentAst)` 参数
> - `EditorEventMap.change: (doc: string, ast: Root) => void`（types.ts:145）；`on(event, handler)` 为 `emitter.on(event, handler)`（editor.ts:895-897）
> - 🕳️ 陷阱: `onChange` 回调先于事件监听器执行（同帧顺序固定：342 行 config 回调 → 343 行 emitter.emit）——依赖顺序的断言需注意

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | `editor.setDocument("hello")` | [EVENT] onChange 与 change 事件各触发 1 次——emitChange 双通道（editor.ts:342-343） | import: @floatboat/nexus-core; API: editor.setDocument(next: string, opts?); 框架: vitest; 等待: 无(同步 emit) |
| 2 | 断言事件参数 | [EVENT] `onEvent.mock.calls[0][0]` === `"hello"`，`[0][1].type` === `"root"`——事件签名 `(doc: string, ast: Root)`（types.ts:145） | import: vitest; API: vi.fn().mock.calls[0]: [string, Root]; 框架: vitest; 等待: 无(同步) |
| 3 | 断言两个通道参数一致 | [EVENT] `onChange.mock.calls[0][0]` === `onEvent.mock.calls[0][0]` 且 `[1]` 为同一 AST 实例——同一 `currentAst` 传给两个通道（editor.ts:342-343） | import: vitest; API: vi.fn().mock.calls[0][1] === 同一实例; 框架: vitest; 等待: 无(同步) |
| 4 | 断言 silent 变更两个通道都不触发 | [EVENT] `setDocument("x", { silent: true })` 后两者调用次数均不增加——silent 注解跳过 emitChange（editor.ts:584, 602-616） | import: @floatboat/nexus-core; API: editor.setDocument(next, { silent: true }); 框架: vitest; 等待: 无(同步) |

**断言汇总**:
- [EVENT] `onChange` 与 `editor.on("change")` 同步触发、参数 `(doc, ast)` 完全一致（同一 currentAst 实例）
- [EVENT] silent 变更两通道均静默

---

## FP-03-04-B01 [P4] [边界] 空文档 setDocument 触发 onChange 且 AST 为空 root

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `"some content"`
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { afterEach, expect, it, vi } from "vitest";
  import type { Root } from "mdast";
  import { createEditor } from "@floatboat/nexus-core";

  afterEach(() => {
    vi.useRealTimers();
  });

  const container = document.createElement("div");
  const onChange = vi.fn((_doc: string, _ast: Root) => {});
  const editor = createEditor({
    container,
    initialValue: "some content",
    parseDelayMs: 0,
    onChange,
  });
  ```

> 🔧 增强说明:
> - 空文档 `""` 经 `lezerAstFromAnywhere` 产出空 `Root = { type: "root", children: [] }`（adapter 空 Document 映射）
> - 纯空白 `"   "`（全空格）在 Lezer markdown 中无块级节点 → children 仍为空（不产出空 paragraph）
> - `onChange` 每次变更都会触发（空文档也是"变更"）——与 FP-03-04-D01（初始不触发）区分：这里是**变更后**为空的场景

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | `editor.setDocument("")`（清空文档） | [EVENT] onChange 触发 1 次——变更路径正常 emit（editor.ts:352-354） | import: @floatboat/nexus-core; API: editor.setDocument(next: string, opts?); 框架: vitest; 等待: 无(同步 emit) |
| 2 | 断言 markdown 参数 | [EVENT] `onChange.mock.calls[0][0]` === `""`——第一参为空串 | import: vitest; API: vi.fn().mock.calls[0][0]: string; 框架: vitest; 等待: 无(同步) |
| 3 | 断言 AST 参数 | [EVENT] `onChange.mock.calls[0][1]` 为 `{ type: "root", children: [] }`——空文档空 Root（adapter） | import: vitest; API: vi.fn().mock.calls[0][1]: Root; 框架: vitest; 等待: 无(同步) |
| 4 | 断言编辑器状态 | [API] `getDocument()` === `""`；`getAst().children.length` === 0——`getAst(): Root` 空 root（editor.ts:735-737） | import: @floatboat/nexus-core; API: editor.getDocument(): string; editor.getAst(): Root; 框架: vitest; 等待: 无(同步) |
| 5 | 空白文档（空格）`setDocument("   ")` | [EVENT] 再次触发，AST children 为 0（纯空白解析为空 root）——全空格无块级节点，children 为空 | import: @floatboat/nexus-core; API: editor.setDocument(next: string, opts?); 框架: vitest; 等待: 无(同步 emit) |

**断言汇总**:
- [EVENT] 空文档变更正常输出：markdown 参数 ""，ast 为 `{ type: "root", children: [] }`
- [API] `getDocument()` 与 `getAst()` 一致反映空文档
- [EVENT] 纯空白文档同样输出空 root（不抛异常）

---

## 增强信息来源
- API签名: packages/core/src/editor.ts
- AST映射: packages/core/src/lezer-mdast-adapter.ts
- 装饰生成: packages/core/src/live-preview.ts
- 测试参考: packages/core/test/editor.test.ts
- 陷阱提示: AGENTS.md

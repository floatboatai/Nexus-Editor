# CASE-LivePreview实时预览-测试用例（FP-04）

> 一级功能点: Live Preview 实时预览（PRD §4.1）
> 全局批次序号: 04
> 生成时间: 2026-08-10
> 测试框架: Vitest / jsdom（`vitest.config.ts` 已配置 `environment: "jsdom"` + `@floatboat/nexus-core` 别名，`react` / `react-dom` / `mermaid` 均为项目依赖）
>
> 涉及二级功能点:
> - FP-04-01 光标不在结构内时折叠为 Widget（[Live Preview]）
> - FP-04-02 光标移入时展开源码（[Live Preview][编辑交互]）
> - FP-04-03 React createPortal 渲染桥接（[Live Preview][API契约]）

> ⚠️ 实现差异提示（影响前置条件，依据 `packages/core/src/live-preview.ts` / `live-preview-ranges.ts` 实际代码）:
> - **光标感知粒度不一致**：行内格式（strong/emphasis/delete/inlineCode）采用**行级检测**（`selectionOnSameLine`，`live-preview-ranges.ts:53`，行界算法 `nodeLineStart = doc.lastIndexOf("\n", from-1)+1`，`nodeLineEnd = doc.indexOf("\n", to)`，光标 `head` 落在 `[nodeLineStart, lineEnd]` 即展开）——光标在结构范围外但同一行时仍折叠，光标进入该行任意位置即展开；heading 采用**范围检测**（`selectionIntersects`，`live-preview-ranges.ts:34`，空选区 `anchor >= from && anchor < to`，**不含右边界**，光标落在 `range.to` 处仍折叠）；link/image/code 采用范围检测**含右边界**（`inclusiveEnd=true`，空选区 `anchor >= from && anchor <= to`，光标落在 `range.to` 处展开）。
> - **table 例外**：table 无论光标位置始终折叠为可编辑 block widget（`EditableTableWidget`，`live-preview.ts:1078` → `live-preview-table.ts:562`，DOM 类名 `.nexus-table-wrapper`（`:933`）/ `.nexus-cell`（`:1773`）），光标移入不展开源码，而是进入单元格编辑。
> - **自定义 renderer 优先级**：`LivePreviewConfig.renderers` 注册的节点类型走"始终 widget 折叠"分支（`live-preview.ts:1070` 起各 `!config.renderers.xxx` 判断），无光标判断，光标移入不展开源码。
> - 折叠机制为 `Decoration.replace` 隐藏源码 + `Decoration.mark` 应用样式（heading 的 `# ` 前缀、行内 `**`/`*`/`` ` ``/`~~` 标记被 replace 为空），断言通过 `container.textContent` 与 `querySelector` 完成。
> - **mermaid** 动态 `import("mermaid")` 懒加载（`live-preview.ts:206` `loadMermaid()`，随后 `m.initialize({startOnLoad:false,theme:"default",securityLevel:"strict"})`、`parse()` 预校验、`render()` 注入 svg，`MERMAID_CACHE` 缓存），jsdom 无布局 API，必须 `vi.mock("mermaid")` 模拟。
> - 折叠 Widget 查询统一在 `.cm-content` 下进行（`container.querySelector` 即可，container 即 CM6 挂载节点）。
> - 光标移动统一使用 `editor.setSelection(anchor, head?)`（与 `packages/core/test/live-preview.test.ts` 既有测试一致）；多选区使用 `multiCursor: true` + `editor.setSelections(...)`（与 `packages/core/test/live-preview-regressions.test.ts:66` 一致）。
> - **测试环境约定**（所有用例通用，参考 `packages/core/test/live-preview.test.ts:7-24`）：jsdom 缺 `Range.prototype.getClientRects` / `getBoundingClientRect`，若用例涉及 widget 测量需在 `beforeAll` 中 polyfill；`afterEach` 中 `vi.useRealTimers()` 复位；`editor.setSelection` 派发 selection-only 事务 → StateField `update` 走 `selection` 分支（`live-preview.ts:1374`）以 `reuseCache=true` 同步重建装饰，**无需额外等待**。

---

## FP-04-01-N01 [P1] [正常] heading 光标不在结构内时折叠 `# ` 前缀为标题 Widget

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `"Intro\n\n# Heading\n\nEnd"`
- 插件配置: 无（默认）
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  // import 路径: createEditor → @floatboat/nexus-core（packages/core/src/index.ts:1 导出自 ./editor）
  // ⚠️ 陷阱: heading 光标检测为 selectionIntersects(非 inclusiveEnd)（live-preview.ts:447），
  //          空选区 anchor>=from && anchor<to，光标落在 range.to=16 处仍折叠（对照 link 的 inclusiveEnd 语义，见 FP-04-02-B02）
  // ⚠️ 陷阱: setSelection 派发 selection-only 事务 → StateField 走 selection 分支（live-preview.ts:1374）
  //          以 reuseCache=true 同步重建装饰，折叠立即生效，无需等待/定时器
  import { afterEach, expect, it } from "vitest";
  import { createEditor } from "@floatboat/nexus-core";

  afterEach(() => {
    editor.destroy();
    container.remove();
  });

  const container = document.createElement("div");
  document.body.appendChild(container);
  const editor = createEditor({
    container,
    initialValue: "Intro\n\n# Heading\n\nEnd",
    livePreview: true,
  });
  // 光标移动到文档末尾（heading 结构范围 [7,16) 之外）
  editor.setSelection(editor.getDocument().length);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言折叠状态：`container.textContent` | [DOM] 包含标题文本 "Heading"，但不包含 "# Heading"（`# ` 前缀 `[7,9)` 被 `Decoration.replace({})` 隐藏，`live-preview.ts:456`） | import: @floatboat/nexus-core; API: container.textContent; 框架: vitest; 等待: 无（selection-only 同步重建） |
| 2 | 断言标题 Widget：`container.querySelector("[data-heading-level='1']")` | [DOM] 非空，其 textContent 为 "Heading"，且带加粗/字号样式（mark 装饰 `[9,16)`：`font-weight: bold; font-size: 1.6em`，`data-heading-level: "1"`，`role: heading`，`aria-level: "1"`，`live-preview.ts:459-468`，HEADING_FONT_SIZE[1]="1.6em"） | import: @floatboat/nexus-core; API: container.querySelector("[data-heading-level='1']"); 框架: vitest; 等待: 无 |
| 3 | 断言 `editor.getDocument()` | [API] 仍返回原始 markdown "Intro\n\n# Heading\n\nEnd"（折叠纯为视图层，不改文档） | import: @floatboat/nexus-core; API: editor.getDocument(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [DOM] `container.textContent` 含 "Heading" 且不含 "# Heading"
- [DOM] `container.querySelector("[data-heading-level='1']")?.textContent` === "Heading"
- [API] `editor.getDocument()` === "Intro\n\n# Heading\n\nEnd"

---

## FP-04-01-N02 [P1] [正常] link 光标不在结构内时折叠为 data-link-url Widget

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `"Click [here](https://example.com) now\n\nend"`
- 插件配置: 无（默认）
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  // import 路径: createEditor → @floatboat/nexus-core（packages/core/src/index.ts:1）
  // ⚠️ 陷阱: link 折叠走 live-preview.ts:1145 分支，cursorOnLink = selectionIntersects(..., true)（含右边界）；
  //          折叠 widget 由 getInlineMarkerStyle("link")（live-preview.ts:999）生成：
  //          openLen=1 隐藏 `[`，closeLen=source.length - bracketClose 隐藏 `](url)`，
  //          attrs.data-link-url = source.slice(bracketClose+2, length-1) = "https://example.com"
  // ⚠️ 陷阱: widget 带 eqKey `link:6-33:${source}`（live-preview.ts:1164），selection-only 更新时 CM6 复用同一 DOM
  import { afterEach, expect, it } from "vitest";
  import { createEditor } from "@floatboat/nexus-core";

  afterEach(() => {
    editor.destroy();
    container.remove();
  });

  const container = document.createElement("div");
  document.body.appendChild(container);
  const source = "Click [here](https://example.com) now\n\nend";
  const editor = createEditor({
    container,
    initialValue: source,
    livePreview: true,
  });
  // 光标在文档末尾：link 结构范围 [6,33) 之外 → 折叠为 Widget
  editor.setSelection(source.length);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言折叠 Widget：`container.querySelector("[data-link-url]")` | [DOM] 非空，`getAttribute("data-link-url")` 为 "https://example.com"，textContent 为 "here"（链接文本），内联样式 `color:var(--nexus-accent);text-decoration:underline;cursor:pointer`（mark/replace widget 由 `live-preview.ts:1156-1163` 生成） | import: @floatboat/nexus-core; API: container.querySelector("[data-link-url]").getAttribute("data-link-url"); 框架: vitest; 等待: 无 |
| 2 | 断言源码隐藏：`container.textContent` | [DOM] 不含 "[here](https://example.com)" 中的 `[` 与 `](`（markers 被 replace：`Decoration.replace({widget}).range(6,33)` 隐藏整段 `[here](https://example.com)`，`live-preview.ts:1165-1169`） | import: @floatboat/nexus-core; API: container.textContent; 框架: vitest; 等待: 无 |
| 3 | 断言 `editor.getDocument()` | [API] 仍为原始 markdown "Click [here](https://example.com) now\n\nend" | import: @floatboat/nexus-core; API: editor.getDocument(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [DOM] `container.querySelector("[data-link-url]")` 存在，url 属性为 "https://example.com"，文本为 "here"
- [DOM] `container.textContent` 不含 "[here](" 
- [API] `editor.getDocument()` === source

---

## FP-04-01-N03 [P1] [正常] 行内 strong/emphasis/inlineCode 光标在另一行时折叠语法标记

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `"Text **bold** *italic* \`code\`\n\nend"`
- 插件配置: 无（默认）
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  // import 路径: createEditor → @floatboat/nexus-core（packages/core/src/index.ts:1）
  // ⚠️ 陷阱: 行内格式用行级检测 selectionOnSameLine（live-preview-ranges.ts:53）而非范围检测——
  //          光标在结构范围外但同行仍折叠；结构范围: strong [5,13)、emphasis [14,22)、inlineCode [23,29)
  // ⚠️ 陷阱: 折叠只 replace 语法标记，内容区间仍保留 mark 样式（live-preview.ts:1224-1242）：
  //          strong → openLen/closeLen=2，style font-weight:bold；emphasis → 1/1，font-style:italic；
  //          inlineCode → ticks 反引号数，style font-family:monospace...
  import { afterEach, expect, it } from "vitest";
  import { createEditor } from "@floatboat/nexus-core";

  afterEach(() => {
    editor.destroy();
    container.remove();
  });

  const container = document.createElement("div");
  document.body.appendChild(container);
  const editor = createEditor({
    container,
    initialValue: "Text **bold** *italic* `code`\n\nend",
    livePreview: true,
  });
  // 光标在末尾行（end 行），与三个行内结构不在同一行 → 行级折叠
  editor.setSelection(editor.getDocument().length);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言内容文本：`container.textContent` | [DOM] 同时包含 "bold"、"italic"、"code"（内容保留，`live-preview.ts:1240-1242` 对 textFrom/textTo 区间加 mark 而非隐藏） | import: @floatboat/nexus-core; API: container.textContent; 框架: vitest; 等待: 无 |
| 2 | 断言语法标记隐藏：`container.textContent` | [DOM] 不含 `**`、不含 `*`、不含 `` ` ``（open/close markers 被 `Decoration.replace({}).range` 隐藏，`live-preview.ts:1231-1238`） | import: @floatboat/nexus-core; API: container.textContent; 框架: vitest; 等待: 无 |
| 3 | 断言样式保留：`container.querySelector('[style*="font-weight"]')` 与 `[style*="font-style"]` | [DOM] 加粗（font-weight）与斜体（font-style）mark 装饰存在，折叠后样式不丢失（mark range: strong 内容 [7,11)、emphasis 内容 [15,21)，`live-preview.ts:1241`） | import: @floatboat/nexus-core; API: container.querySelector('[style*="font-weight"]'); 框架: vitest; 等待: 无 |

**断言汇总**:
- [DOM] textContent 含 "bold" / "italic" / "code"
- [DOM] textContent 不含 "**"、不含 "*"、不含 "`"
- [DOM] 存在 `[style*="font-weight"]` 与 `[style*="font-style"]` 的 mark 元素

---

## FP-04-01-N04 [P3] [正常] 无序列表光标不在该项首行时折叠为 bullet/checkbox Widget

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `"- item one\n- [x] done\n\nend"`
- 插件配置: 无（默认）
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  // import 路径: createEditor → @floatboat/nexus-core（packages/core/src/index.ts:1）
  // ⚠️ 陷阱: buildListDecorations（live-preview.ts:475）以 mdast ListItem 结构遍历；
  //          LIST_MARKER_RE = /^(\s*)([-*+]|\d+[.)]) /（:472），CHECKBOX_RE = /^\[([ xX])\] /（:473）
  //          光标落在该项首行 [itemFrom, headLineEnd] 时（selectionIntersects inclusiveEnd=true，:509）显示源码不折叠
  // ⚠️ 陷阱: 无序 bullet 文本为 "\u2022 "（•）；checkbox 为 input[type=checkbox]，checked = checkMatch[1] !== " "（:538），
  //          taskKey=`task:${checkStart}-${checkEnd}:x`；已完成项 [checkEnd, headLineEnd) 加
  //          text-decoration:line-through mark（:569-575）
  import { afterEach, expect, it } from "vitest";
  import { createEditor } from "@floatboat/nexus-core";

  afterEach(() => {
    editor.destroy();
    container.remove();
  });

  const container = document.createElement("div");
  document.body.appendChild(container);
  const editor = createEditor({
    container,
    initialValue: "- item one\n- [x] done\n\nend",
    livePreview: true,
  });
  // 光标在末尾行，不在任一列表项首行 → 折叠 marker/checkbox
  editor.setSelection(editor.getDocument().length);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言 bullet Widget：`container.textContent` | [DOM] 包含 "•"（marker `- ` 被替换为圆点 bullet widget，textContent=`"\u2022 "`，`live-preview.ts:522`，bulletKey=`bullet:ul:${markerStart}-${markerEnd}`），且不含 "- item"（marker 源码隐藏） | import: @floatboat/nexus-core; API: container.textContent; 框架: vitest; 等待: 无 |
| 2 | 断言 checkbox Widget：`container.querySelector('input[type="checkbox"]')` | [DOM] 非空且 `checked === true`（`[x]` 被替换为勾选态复选框，`live-preview.ts:540-567`，swallowEvents=true），textContent 不含 "[x]" | import: @floatboat/nexus-core; API: container.querySelector('input[type="checkbox"]').checked; 框架: vitest; 等待: 无 |
| 3 | 断言已完成项样式：`container.querySelector('[style*="line-through"]')` | [DOM] 非空（"done" 文本带 `text-decoration: line-through; color: var(--nexus-text-muted)` mark 装饰，`live-preview.ts:569-575`，区间 [checkEnd, headLineEnd)） | import: @floatboat/nexus-core; API: container.querySelector('[style*="line-through"]'); 框架: vitest; 等待: 无 |

**断言汇总**:
- [DOM] textContent 含 "•"、"item one"、"done"，不含 "- item"、不含 "[x]"
- [DOM] `input[type="checkbox"]` 存在且 checked === true
- [DOM] 存在 `[style*="line-through"]` 元素

---

## FP-04-01-N05 [P2] [正常] image 光标不在结构内时折叠为图片预览 Widget

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `"Before\n\n![alt text](https://img.png)\n\nAfter"`
- 插件配置: 无（默认）
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  // import 路径: createEditor → @floatboat/nexus-core（packages/core/src/index.ts:1）
  // ⚠️ 陷阱: image 区间由 collectImageRanges 正则 /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g
  //          独立收集（live-preview-ranges.ts:75），范围 [8,40)，node.url="https://img.png"、alt="alt text"
  // ⚠️ 陷阱: 折叠分支 cursorOnImage=selectionIntersects(..., true)（live-preview.ts:1121），
  //          widget 经 renderLivePreviewNode（live-preview-renderers.ts:193）生成 wrapper span
  //          data-live-preview-image=url + img[src][alt][referrerPolicy=no-referrer] + 文本 label；
  //          imgKey=`image:8:40:out:${source}`（:1126），swallowEvents=true
  import { afterEach, expect, it } from "vitest";
  import { createEditor } from "@floatboat/nexus-core";

  afterEach(() => {
    editor.destroy();
    container.remove();
  });

  const container = document.createElement("div");
  document.body.appendChild(container);
  const editor = createEditor({
    container,
    initialValue: "Before\n\n![alt text](https://img.png)\n\nAfter",
    livePreview: true,
  });
  // 光标在末尾：image 结构范围 [8,40) 之外 → 折叠为预览 Widget
  editor.setSelection(editor.getDocument().length);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言图片预览 Widget：`container.querySelector("[data-live-preview-image]")` | [DOM] 非空，`getAttribute("data-live-preview-image")` 为 "https://img.png"（wrapper span 属性，`live-preview-renderers.ts:197`） | import: @floatboat/nexus-core; API: container.querySelector("[data-live-preview-image]").getAttribute("data-live-preview-image"); 框架: vitest; 等待: 无 |
| 2 | 断言 img 元素：`container.querySelector('img[src="https://img.png"]')` | [DOM] 非空，alt 为 "alt text"（img.src=node.url、img.alt=node.alt、referrerPolicy="no-referrer"，`live-preview-renderers.ts:198-200`） | import: @floatboat/nexus-core; API: container.querySelector('img[src="https://img.png"]'); 框架: vitest; 等待: 无 |
| 3 | 断言源码隐藏：`container.textContent` | [DOM] 不含 "!["（markdown 源码被 `Decoration.replace({widget}).range(8,40)` 隐藏，`live-preview.ts:1129-1134`） | import: @floatboat/nexus-core; API: container.textContent; 框架: vitest; 等待: 无 |

**断言汇总**:
- [DOM] `[data-live-preview-image]` 存在，url 为 "https://img.png"
- [DOM] `img[src="https://img.png"]` 存在
- [DOM] textContent 不含 "!["

---

## FP-04-01-N06 [P2] [正常] fenced code 块光标不在时折叠（fence 透明、role=code）

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `"before\n\n\`\`\`js\nconst a = 1;\n\`\`\`\n\nafter"`
- 插件配置: 无（默认）
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  // import 路径: createEditor → @floatboat/nexus-core（packages/core/src/index.ts:1）
  // ⚠️ 陷阱: buildCodeBlockDecorations（live-preview.ts:857），cursorOnCode = selectionIntersects(..., true)（:866，含右边界）；
  //          首行 Decoration.line attrs {role:"code", aria-label:`Code block: js`}（:913-916）；
  //          fence 行 mark：光标在外 color:transparent;cursor:text（:925），在内 color:var(--nexus-text-faint,#bbb)
  // ⚠️ 陷阱: Decoration.line 只设 background/border-radius，不得设 font-family/font-size（:883-895 高度图漂移陷阱），
  //          代码区字体经 Decoration.mark 的 font-family:monospace 提供
  // ⚠️ 陷阱: code 块范围 [7,32)；首行 fence 上还挂 Copy 按钮 CodeCopyWidget（side:1，:938-945）
  import { afterEach, expect, it } from "vitest";
  import { createEditor } from "@floatboat/nexus-core";

  afterEach(() => {
    editor.destroy();
    container.remove();
  });

  const container = document.createElement("div");
  document.body.appendChild(container);
  const editor = createEditor({
    container,
    initialValue: "before\n\n```js\nconst a = 1;\n```\n\nafter",
    livePreview: true,
  });
  // 光标在末尾：code 块范围 [7,32) 之外 → fence 行透明化
  editor.setSelection(editor.getDocument().length);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言代码块标记：`container.querySelector("[role='code']")` | [DOM] 非空（首行 fence 带 `Decoration.line` attrs `role: "code"`，`live-preview.ts:913-914`，selector 落在 `.cm-line` 上） | import: @floatboat/nexus-core; API: container.querySelector("[role='code']"); 框架: vitest; 等待: 无 |
| 2 | 断言语言标注：`container.querySelector("[aria-label='Code block: js']")` | [DOM] 非空（lang 存在时首行 line attrs `aria-label: "Code block: js"`，`live-preview.ts:915`） | import: @floatboat/nexus-core; API: container.querySelector("[aria-label='Code block: js']"); 框架: vitest; 等待: 无 |
| 3 | 断言 fence 透明：`container.querySelector('[style*="transparent"]')` | [DOM] 非空（光标不在时 fence 行 mark `color:transparent;cursor:text` 视觉折叠，`live-preview.ts:925`） | import: @floatboat/nexus-core; API: container.querySelector('[style*="transparent"]'); 框架: vitest; 等待: 无 |

**断言汇总**:
- [DOM] `[role="code"]` 存在
- [DOM] `[aria-label="Code block: js"]` 存在
- [DOM] 存在 `[style*="transparent"]` 元素

---

## FP-04-01-E01 [P3] [异常] mermaid 块懒加载折叠为 .nexus-mermaid Widget 且源码隐藏

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `"before\n\n\`\`\`mermaid\ngraph TD\n  A --> B\n\`\`\`\n\nafter"`
- 插件配置: 无（默认，`vi.mock("mermaid")` 模拟懒加载，jsdom 无布局 API）
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  // import 路径: createEditor → @floatboat/nexus-core；vi.mock("mermaid") 与 packages/core/test/mermaid.test.ts:7 同构
  // ⚠️ 陷阱: mermaid 折叠条件 = lang==="mermaid" && !cursorOnCode && firstNewline>=0（live-preview.ts:873）；
  //          整块 Decoration.replace({widget: MermaidWidget, block:true}).range(from, to)（:874-879）
  // ⚠️ 陷阱: MermaidWidget.toDOM（live-preview.ts:239）container.className="nexus-mermaid"（:242），
  //          编辑按钮 title/aria-label="Edit mermaid source"、textContent="✎"（:257-261）；
  //          loadMermaid() → import("mermaid").default ?? mod（:206-215），mock 必须导出 default
  // ⚠️ 陷阱: 渲染流程 parse() 预校验 → render(id, text) → diagramHost.innerHTML=svg（:383-407），
  //          MERMAID_CACHE 缓存 svg；异步渲染必须 await vi.waitFor(() => container.querySelector("svg"))，
  //          不可同步断言 svg（render 是 Promise）
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor } from "@floatboat/nexus-core";

  vi.mock("mermaid", () => ({
    default: {
      initialize: vi.fn(),
      parse: vi.fn(async () => true),
      render: vi.fn(async (id: string) => ({ svg: `<svg data-id="${id}"></svg>` })),
    },
  }));

  afterEach(() => {
    editor.destroy();
    container.remove();
  });

  const container = document.createElement("div");
  document.body.appendChild(container);
  const md = ["before", "", "```mermaid", "graph TD", "  A --> B", "```", "", "after"].join("\n");
  const editor = createEditor({
    container,
    initialValue: md,
    livePreview: true,
  });
  // 光标在末尾：mermaid 块之外 → 懒加载折叠为 diagram Widget
  editor.setSelection(md.length);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言 mermaid Widget：`container.querySelector(".nexus-mermaid")` | [DOM] 非空（container.className 为 "nexus-mermaid"，`live-preview.ts:242`；`.nexus-mermaid` 为 block 级 replace widget，位于 .cm-content 下） | import: @floatboat/nexus-core; API: container.querySelector(".nexus-mermaid"); 框架: vitest; 等待: 无（widget 同步挂载，svg 异步） |
| 2 | 断言源码隐藏：`container.textContent` | [DOM] 不含 "graph TD"、不含 "```mermaid"（整块 `[7,39)` 被 Decoration.replace 隐藏，`live-preview.ts:874-879`） | import: @floatboat/nexus-core; API: container.textContent; 框架: vitest; 等待: 无 |
| 3 | 断言编辑按钮：`.nexus-mermaid` 内 `button[aria-label="Edit mermaid source"]` | [DOM] 非空（`live-preview.ts:257-261`；点击会 dispatch `selection: {anchor: blockFrom + sourceOffsetInBlock}` 进入源码编辑，`live-preview.ts:283-292`） | import: @floatboat/nexus-core; API: container.querySelector('.nexus-mermaid button[aria-label="Edit mermaid source"]'); 框架: vitest; 等待: 无 |
| 4 | 等待异步渲染（`await vi.waitFor(() => container.querySelector("svg"))`） | [DOM] mock mermaid render 后 svg 注入到 `.nexus-mermaid` 内（懒加载成功渲染，`live-preview.ts:406` diagramHost.innerHTML=svg） | import: vitest(vi.waitFor); API: vi.waitFor(() => container.querySelector("svg")); 框架: vitest; 等待: mermaid render Promise resolve + 微任务队列刷新 |

**断言汇总**:
- [DOM] `.nexus-mermaid` 存在
- [DOM] textContent 不含 "graph TD"、不含 "```mermaid"
- [DOM] `.nexus-mermaid` 内存在编辑按钮 `[aria-label="Edit mermaid source"]`
- [DOM] 异步等待后 `.nexus-mermaid` 内出现 `svg`

---

## FP-04-01-B01 [P4] [边界] table 无论光标位置始终折叠为可编辑 Widget（不随光标展开）

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `"| a | b |\n|---|---|\n| 1 | 2 |"`
- 插件配置: 无（默认）
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  // import 路径: createEditor → @floatboat/nexus-core（packages/core/src/index.ts:1）
  // ⚠️ 陷阱: table 分支（live-preview.ts:1078）始终 Decoration.replace({widget: EditableTableWidget, block:true})
  //          不参与光标判断；widget 类在 live-preview-table.ts:562，
  //          wrapper.className="nexus-table-wrapper"（:933），td.className="nexus-cell"（:1773）
  // ⚠️ 陷阱(AGENTS.md Table Widget 规则12): StateField.update 在 isTableEditing(viewRef.current) 时
  //          跳过全部 rebuild（live-preview.ts:1350-1352）——docChanged 走 decos.map(tr.changes)、selection-only 原样返回；
  //          表内编辑期不应触发装饰重建，否则 widget DOM 被 CM6 重建导致交互中断
  // ⚠️ 陷阱(AGENTS.md 规则8/9/10/11): 表格单元格/grip 的跨帧鼠标交互依赖 self.editing 标志 +
  //          tableEditingCount 计数（mousedown 置位、mouseup 释放），cell blur 处理器必须检查 grip drag
  //          （draggingCol/draggingRow）后再清除 editing；rAF 轮询须同时尊重
  //          isRangeSelecting/cellMouseDown/self.editing/rangeActive 全部状态
  // ⚠️ 陷阱: 本用例只验证"光标移动不展开"，不触发单元格编辑流程（表编辑另见 live-preview-table 专项用例）
  import { afterEach, expect, it } from "vitest";
  import { createEditor } from "@floatboat/nexus-core";

  afterEach(() => {
    editor.destroy();
    container.remove();
  });

  const container = document.createElement("div");
  document.body.appendChild(container);
  const source = "| a | b |\n|---|---|\n| 1 | 2 |";
  const editor = createEditor({
    container,
    initialValue: source,
    livePreview: true,
  });
  // 初始光标在文档开头（表格外）
  editor.setSelection(0);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言折叠 Widget：`container.querySelector(".nexus-table-wrapper")` | [DOM] 非空；`.nexus-cell` 存在（可编辑单元格渲染，`live-preview-table.ts:933`/`:1773`；table 范围为 [0,21)） | import: @floatboat/nexus-core; API: container.querySelector(".nexus-table-wrapper"); 框架: vitest; 等待: 无 |
| 2 | 断言表格源码隐藏：`container.textContent` | [DOM] 不含 "|---|---|"（源码被 `Decoration.replace({widget, block:true}).range(0,21)` 隐藏，`live-preview.ts:1079-1086`） | import: @floatboat/nexus-core; API: container.textContent; 框架: vitest; 等待: 无 |
| 3 | 光标移入表格"内部"：`editor.setSelection(2)`（分隔行范围内） | [STATE] 光标移动到表格范围 [0,21) 内；selection 事务为 selection-only → StateField 走 selection 分支重建（非表格编辑期，不触发 isTableEditing 短路） | import: @floatboat/nexus-core; API: editor.setSelection(2); 框架: vitest; 等待: 无 |
| 4 | 重新断言折叠状态：`container.querySelector(".nexus-table-wrapper")` | [DOM] 仍非空，textContent 仍不含 "|---|---|"（table 是唯一不随光标展开的节点类型，进入的是单元格编辑而非源码） | import: @floatboat/nexus-core; API: container.querySelector(".nexus-table-wrapper"); 框架: vitest; 等待: 无 |

**断言汇总**:
- [DOM] `.nexus-table-wrapper` 与 `.nexus-cell` 存在
- [DOM] textContent 不含 "|---|---|"
- [STATE] `editor.getSelection()` 的 anchor === 2
- [DOM] 光标移入后 `.nexus-table-wrapper` 仍存在（table 始终折叠）

---

## FP-04-01-B02 [P4] [边界] 嵌套格式 ***bold italic*** 折叠时无残留标记

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `"Text ***bold italic***\n\nend"`
- 插件配置: 无（默认）
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  // import 路径: createEditor → @floatboat/nexus-core（packages/core/src/index.ts:1）
  // ⚠️ 陷阱: 嵌套格式由 mdast 生成父子两个 range：外层 strong [5,21)、内层 emphasis [7,19)，
  //          均被 collectLivePreviewRanges 收集（live-preview-ranges.ts:142-150 递归 child）；
  //          parentSpans 拦截仅针对 heading/table 子级（live-preview.ts:1067-1068/1212-1214），
  //          行内嵌套不会跳过 → 两套 mark 叠加（font-weight:bold + font-style:italic）
  // ⚠️ 陷阱: 折叠时外层 strong 的 `***` 前 2 个字符与内层 emphasis 的 `*` 各自被 replace，
  //          无残留（openLen=2/closeLen=2 与 openLen=1/closeLen=1 精确覆盖 6 个 marker 字符）
  import { afterEach, expect, it } from "vitest";
  import { createEditor } from "@floatboat/nexus-core";

  afterEach(() => {
    editor.destroy();
    container.remove();
  });

  const container = document.createElement("div");
  document.body.appendChild(container);
  const editor = createEditor({
    container,
    initialValue: "Text ***bold italic***\n\nend",
    livePreview: true,
  });
  // 光标在末尾行，与嵌套结构不同行 → 折叠
  editor.setSelection(editor.getDocument().length);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言内容保留：`container.textContent` | [DOM] 包含 "bold italic"（内容区间 mark 保留，`live-preview.ts:1240-1242`） | import: @floatboat/nexus-core; API: container.textContent; 框架: vitest; 等待: 无 |
| 2 | 断言无残留标记：`container.textContent` | [DOM] 不含 "***"、不含 "**"（strong 与 emphasis 的 markers 全部 replace 隐藏，`live-preview.ts:1231-1238`） | import: @floatboat/nexus-core; API: container.textContent; 框架: vitest; 等待: 无 |
| 3 | 断言复合样式：`container.querySelector('[style*="font-weight"]')` 与 `[style*="font-style"]` | [DOM] 加粗与斜体 mark 同时存在（嵌套格式折叠后样式叠加保留：strong mark `font-weight:bold` + emphasis mark `font-style:italic`） | import: @floatboat/nexus-core; API: container.querySelector('[style*="font-weight"]'); 框架: vitest; 等待: 无 |

**断言汇总**:
- [DOM] textContent 含 "bold italic"
- [DOM] textContent 不含 "***"、不含 "**"
- [DOM] `[style*="font-weight"]` 与 `[style*="font-style"]` 均存在

---

## 增强信息来源
- 装饰生成: packages/core/src/live-preview.ts（buildDecorations:1039 / buildHeadingDecorations:432 / buildListDecorations:475 / buildCodeBlockDecorations:857 / getInlineMarkerStyle:982 / MermaidWidget:220 / createWidget:99）
- 渲染器: packages/core/src/live-preview-renderers.ts（renderLivePreviewNode:213）
- 区间收集: packages/core/src/live-preview-ranges.ts（selectionIntersects:34 / selectionOnSameLine:53 / collectLivePreviewRanges:159 / collectImageRanges:70）
- 测试参考: packages/core/test/live-preview.test.ts、packages/core/test/live-preview-regressions.test.ts、packages/core/test/mermaid.test.ts
- 陷阱提示: AGENTS.md（Table Widget Development Rules）

---

## FP-04-02-N01 [P1] [正常] strong 光标移入所在行时展开为源码 **bold**

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `"Text **bold**\n\nend"`
- 插件配置: 无（默认）
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  // import 路径: createEditor → @floatboat/nexus-core（packages/core/src/index.ts:1）
  // ⚠️ 陷阱: strong 展开判定 = selectionOnSameLine（行级，live-preview-ranges.ts:53），非范围检测——
  //          光标进入 strong 所在行任意位置即展开（setSelection(8) 落在 strong 内容行）
  // ⚠️ 陷阱: 行级检测含行尾（cursor <= lineEnd），光标停在行尾也展开；展开仅是停止 replace marker，
  //          mark 样式仍保留（live-preview.ts:1224-1242）
  import { afterEach, expect, it } from "vitest";
  import { createEditor } from "@floatboat/nexus-core";

  afterEach(() => {
    editor.destroy();
    container.remove();
  });

  const container = document.createElement("div");
  document.body.appendChild(container);
  const source = "Text **bold**\n\nend";
  const editor = createEditor({
    container,
    initialValue: source,
    livePreview: true,
  });
  // 初始光标在末尾行（折叠态）
  editor.setSelection(source.length);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言初始折叠态：`container.textContent` | [DOM] 不含 "**"（标记隐藏，`live-preview.ts:1233-1236` replace open/close） | import: @floatboat/nexus-core; API: container.textContent; 框架: vitest; 等待: 无 |
| 2 | 光标移入 bold 所在行：`editor.setSelection(8)`（`**bold**` 范围内） | [STATE] selection anchor === 8，处于 strong 结构行内；selection-only 事务 → `build(..., reuseCache=true)` 复用缓存 AST 重建（`live-preview.ts:1374-1377`） | import: @floatboat/nexus-core; API: editor.setSelection(8); 框架: vitest; 等待: 无 |
| 3 | 断言展开源码：`container.textContent` | [DOM] 包含 "**bold**"（markers 恢复可见，可直接编辑；`selectionOnSameLine` 返回 true 后不再 replace，`live-preview.ts:1231`） | import: @floatboat/nexus-core; API: container.textContent; 框架: vitest; 等待: 无 |
| 4 | 断言 `editor.getDocument()` | [API] 仍为 "Text **bold**\n\nend"（展开不改文档） | import: @floatboat/nexus-core; API: editor.getDocument(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [DOM] 移入前 textContent 不含 "**"；移入后含 "**bold**"
- [STATE] `editor.getSelection().anchor` === 8
- [API] `editor.getDocument()` === source

---

## FP-04-02-N02 [P1] [正常] link 光标移入范围时展开为源码 [text](url) 且 Widget 消失

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `"Click [here](https://example.com) now\n\nend"`
- 插件配置: 无（默认）
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  // import 路径: createEditor → @floatboat/nexus-core（packages/core/src/index.ts:1）
  // ⚠️ 陷阱: link 展开判定 cursorOnLink = selectionIntersects(from, to, selection, true)（live-preview.ts:1149，
  //          含右边界）——光标在 [6,33] 内 → continue 跳过 replace widget，源码原样可见
  // ⚠️ 陷阱: setSelection(source.indexOf("here") + 1) = 7，落在 link 文本 "here" 内
  import { afterEach, expect, it } from "vitest";
  import { createEditor } from "@floatboat/nexus-core";

  afterEach(() => {
    editor.destroy();
    container.remove();
  });

  const container = document.createElement("div");
  document.body.appendChild(container);
  const source = "Click [here](https://example.com) now\n\nend";
  const editor = createEditor({
    container,
    initialValue: source,
    livePreview: true,
  });
  // 初始光标在末尾（折叠态）
  editor.setSelection(source.length);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言初始折叠态：`container.querySelector("[data-link-url]")` | [DOM] 非空（折叠 widget 已挂载，`live-preview.ts:1156-1169`） | import: @floatboat/nexus-core; API: container.querySelector("[data-link-url]"); 框架: vitest; 等待: 无 |
| 2 | 光标移入 link 范围：`editor.setSelection(source.indexOf("here") + 1)`（即 7） | [STATE] anchor === 7，处于 `[here](https://example.com)` 范围 [6,33) 内；selection-only → reuseCache=true 重建 | import: @floatboat/nexus-core; API: editor.setSelection(7); 框架: vitest; 等待: 无 |
| 3 | 断言 Widget 消失：`container.querySelector("[data-link-url]")` | [DOM] 为 null（cursorOnLink=true → `continue` 跳过 replace widget，`live-preview.ts:1154`） | import: @floatboat/nexus-core; API: container.querySelector("[data-link-url]"); 框架: vitest; 等待: 无 |
| 4 | 断言源码展开：`container.textContent` | [DOM] 包含 "[here](https://example.com)"（link 原始 markdown 可见） | import: @floatboat/nexus-core; API: container.textContent; 框架: vitest; 等待: 无 |

**断言汇总**:
- [DOM] 移入前 `[data-link-url]` 存在；移入后为 null
- [DOM] 移入后 textContent 含 "[here](https://example.com)"
- [STATE] `editor.getSelection().anchor` === 7

---

## FP-04-02-N03 [P2] [正常] heading 光标移入时展开 `# ` 前缀源码

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `"# Heading\n\nEnd"`
- 插件配置: 无（默认）
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  // import 路径: createEditor → @floatboat/nexus-core（packages/core/src/index.ts:1）
  // ⚠️ 陷阱: heading 展开判定 cursorOnHeading = selectionIntersects(from, to, selection)（非 inclusiveEnd，
  //          live-preview.ts:447）——光标在 [0,9) 内 → 前缀 [0,2) 用 mark（font-weight:bold;font-size:1.6em;
  //          color:var(--nexus-text-muted)）而非 replace（:449-457）
  // ⚠️ 陷阱: 与 link 不同，光标恰好落在 range.to=9（行首 "End" 前）时不展开（见 FP-04-02-B02）
  import { afterEach, expect, it } from "vitest";
  import { createEditor } from "@floatboat/nexus-core";

  afterEach(() => {
    editor.destroy();
    container.remove();
  });

  const container = document.createElement("div");
  document.body.appendChild(container);
  const source = "# Heading\n\nEnd";
  const editor = createEditor({
    container,
    initialValue: source,
    livePreview: true,
  });
  // 初始光标在末尾（折叠态）
  editor.setSelection(source.length);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言初始折叠态：`container.textContent` | [DOM] 不含 "# Heading"（`# ` 前缀 `[0,2)` 被 replace 隐藏，`live-preview.ts:456`），但 `[data-heading-level="1"]` 存在（内容 mark `[2,9)` 保留） | import: @floatboat/nexus-core; API: container.textContent; 框架: vitest; 等待: 无 |
| 2 | 光标移入 heading 内容：`editor.setSelection(3)`（"Heading" 文本内，范围 [0,9) 内） | [STATE] anchor === 3；selection-only → reuseCache=true 重建 | import: @floatboat/nexus-core; API: editor.setSelection(3); 框架: vitest; 等待: 无 |
| 3 | 断言源码展开：`container.textContent` | [DOM] 包含 "# Heading"（`# ` 前缀恢复可见，`live-preview.ts:449-454` mark 而非 replace） | import: @floatboat/nexus-core; API: container.textContent; 框架: vitest; 等待: 无 |
| 4 | 断言样式保留：`container.querySelector("[data-heading-level='1']")` | [DOM] 展开后标题文本仍带加粗 mark 装饰（`data-heading-level`/`role:heading`/`aria-level:1` 始终在内容 mark 上，`live-preview.ts:459-468`） | import: @floatboat/nexus-core; API: container.querySelector("[data-heading-level='1']"); 框架: vitest; 等待: 无 |

**断言汇总**:
- [DOM] 移入前不含 "# Heading"；移入后含 "# Heading"
- [STATE] `editor.getSelection().anchor` === 3
- [DOM] `[data-heading-level="1"]` 移入前后均存在

---

## FP-04-02-N04 [P2] [正常] code 块光标移入时 fence 恢复可见

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `"before\n\n\`\`\`js\nconst a = 1;\n\`\`\`\n\nafter"`
- 插件配置: 无（默认）
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  // import 路径: createEditor → @floatboat/nexus-core（packages/core/src/index.ts:1）
  // ⚠️ 陷阱: code 光标判定 cursorOnCode = selectionIntersects(range.from, range.to, selection, true)
  //          （live-preview.ts:866，含右边界）；光标落在 to=32 处也展开（与 heading 非 inclusiveEnd 形成对照）
  // ⚠️ 陷阱: 光标在内时 fence mark 变 color:var(--nexus-text-faint,#bbb)（:923-924），不再 transparent；
  //          首行 Decoration.line 的 role/aria-label 始终存在（不随光标变化）
  import { afterEach, expect, it } from "vitest";
  import { createEditor } from "@floatboat/nexus-core";

  afterEach(() => {
    editor.destroy();
    container.remove();
  });

  const container = document.createElement("div");
  document.body.appendChild(container);
  const source = "before\n\n```js\nconst a = 1;\n```\n\nafter";
  const editor = createEditor({
    container,
    initialValue: source,
    livePreview: true,
  });
  // 初始光标在末尾（折叠态：fence 透明）
  editor.setSelection(source.length);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言初始折叠态：`container.querySelector('[style*="transparent"]')` | [DOM] 非空（fence 行 `color:transparent;cursor:text`，`live-preview.ts:925`） | import: @floatboat/nexus-core; API: container.querySelector('[style*="transparent"]'); 框架: vitest; 等待: 无 |
| 2 | 光标移入 code 块：`editor.setSelection(10)`（"```js" 的 fence 内，范围 [7,32) 内） | [STATE] anchor === 10；selection-only → reuseCache=true 重建 | import: @floatboat/nexus-core; API: editor.setSelection(10); 框架: vitest; 等待: 无 |
| 3 | 断言 fence 恢复可见：`container.querySelector('[style*="transparent"]')` | [DOM] 为 null（光标在内时 fence mark 用 `color:var(--nexus-text-faint,#bbb)`，不再 transparent，`live-preview.ts:923-925`） | import: @floatboat/nexus-core; API: container.querySelector('[style*="transparent"]'); 框架: vitest; 等待: 无 |
| 4 | 断言源码可见：`container.textContent` | [DOM] 包含 "```js" 与 "const a = 1;"（fence 与代码源码均可见可编辑） | import: @floatboat/nexus-core; API: container.textContent; 框架: vitest; 等待: 无 |

**断言汇总**:
- [DOM] 移入前存在 `[style*="transparent"]`；移入后为 null
- [DOM] 移入后 textContent 含 "```js" 与 "const a = 1;"
- [STATE] `editor.getSelection().anchor` === 10

---

## FP-04-02-N05 [P3] [正常] image 光标移入时源码可见且预览 Widget 保留

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `"Before\n\n![alt](https://img.png)\n\nAfter"`
- 插件配置: 无（默认）
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  // import 路径: createEditor → @floatboat/nexus-core（packages/core/src/index.ts:1）
  // ⚠️ 陷阱: image 展开分支 cursorOnImage=selectionIntersects(..., true)（live-preview.ts:1121，含右边界）；
  //          光标在内时：源码原样可见 + Decoration.widget({widget, block:true, side:1}).range(range.to)
  //          追加预览在 end=26 之后（:1135-1144），与折叠态"replace 整段"不同
  // ⚠️ 陷阱: 同一 imgKey=`image:8:26:in:${source}`（:1126）保证折叠/展开切换时 widget DOM 可复用
  import { afterEach, expect, it } from "vitest";
  import { createEditor } from "@floatboat/nexus-core";

  afterEach(() => {
    editor.destroy();
    container.remove();
  });

  const container = document.createElement("div");
  document.body.appendChild(container);
  const source = "Before\n\n![alt](https://img.png)\n\nAfter";
  const editor = createEditor({
    container,
    initialValue: source,
    livePreview: true,
  });
  // 初始光标在末尾（折叠态：仅预览 Widget）
  editor.setSelection(source.length);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言初始折叠态：`container.textContent` | [DOM] 不含 "!["，`[data-live-preview-image]` 存在（折叠 replace widget，`live-preview.ts:1129-1134`） | import: @floatboat/nexus-core; API: container.textContent; 框架: vitest; 等待: 无 |
| 2 | 光标移入 image 范围：`editor.setSelection(10)`（image 范围 [8,26) 内） | [STATE] anchor === 10；selection-only → reuseCache=true 重建 | import: @floatboat/nexus-core; API: editor.setSelection(10); 框架: vitest; 等待: 无 |
| 3 | 断言源码展开：`container.textContent` | [DOM] 包含 "![alt](https://img.png)"（源码可见可编辑） | import: @floatboat/nexus-core; API: container.textContent; 框架: vitest; 等待: 无 |
| 4 | 断言预览保留：`container.querySelector("[data-live-preview-image]")` | [DOM] 仍非空（光标在内时源码 + 预览 Widget 共存，预览以 `Decoration.widget({block:true, side:1})` 追加在 end 之后，`live-preview.ts:1137-1143`） | import: @floatboat/nexus-core; API: container.querySelector("[data-live-preview-image]"); 框架: vitest; 等待: 无 |

**断言汇总**:
- [DOM] 移入前不含 "!["；移入后含 "![alt](https://img.png)"
- [DOM] `[data-live-preview-image]` 移入前后均存在
- [STATE] `editor.getSelection().anchor` === 10

---

## FP-04-02-N06 [P3] [正常] 展开↔折叠往返多次切换稳定且文档无副作用

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `"Text **bold**\n\nend"`
- 插件配置: 无（默认）
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  // import 路径: createEditor → @floatboat/nexus-core（packages/core/src/index.ts:1）
  // ⚠️ 陷阱: 往返切换全是 selection-only 事务 → StateField 走 selection 分支（live-preview.ts:1374-1377），
  //          以 reuseCache=true 复用 lastBuilt 缓存（:1324-1326），不重跑 Lezer 解析与 hljs 高亮；
  //          因此切换零文档副作用，且 cursorOnLine 判定每次同步重算
  // ⚠️ 陷阱: strong 行级检测（selectionOnSameLine）下，setSelection(8) 与 setSelection(source.length)
  //          分别落在/离开 strong 行 → replace marker 与否即时切换，无残留 DOM
  import { afterEach, expect, it } from "vitest";
  import { createEditor } from "@floatboat/nexus-core";

  afterEach(() => {
    editor.destroy();
    container.remove();
  });

  const container = document.createElement("div");
  document.body.appendChild(container);
  const source = "Text **bold**\n\nend";
  const editor = createEditor({
    container,
    initialValue: source,
    livePreview: true,
  });
  // 初始光标在末尾（折叠态）
  editor.setSelection(source.length);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 第一轮：光标在末尾（`setSelection(source.length)`）→ 断言折叠；光标移入（`setSelection(8)`）→ 断言展开 | [DOM] 折叠态不含 "**"，展开态含 "**bold**"（selectionOnSameLine 切换，`live-preview.ts:1227-1238`） | import: @floatboat/nexus-core; API: editor.setSelection(source.length) / editor.setSelection(8) + container.textContent; 框架: vitest; 等待: 无 |
| 2 | 第二轮：光标移出（`setSelection(source.length)`）→ 断言再次折叠 | [DOM] 重新折叠，textContent 不含 "**" | import: @floatboat/nexus-core; API: editor.setSelection(source.length); 框架: vitest; 等待: 无 |
| 3 | 第三轮：光标移入（`setSelection(8)`）→ 断言再次展开 | [DOM] 含 "**bold**"，且 textContent 无重复/残留（如 "**bold****bold**"；widget/DOM 复用靠 eqKey 一致性，无重复挂载） | import: @floatboat/nexus-core; API: editor.setSelection(8); 框架: vitest; 等待: 无 |
| 4 | 断言文档零副作用：`editor.getDocument()` | [API] 始终为 "Text **bold**\n\nend"，往返切换不产生任何文档变更（selection-only 事务不改 doc） | import: @floatboat/nexus-core; API: editor.getDocument(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [DOM] 三轮往返折叠/展开状态正确，无残留重复文本
- [API] `editor.getDocument()` 全程 === source（切换零副作用）
- [STATE] 光标位置每轮均为预期值（8 / source.length）

---

## FP-04-02-B01 [P4] [边界] link inclusiveEnd：光标落在 range.to 处展开、to+1 处折叠

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `"Click [here](https://example.com) now\n\nend"`
- 插件配置: 无（默认）
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  // import 路径: createEditor → @floatboat/nexus-core（packages/core/src/index.ts:1）
  // ⚠️ 陷阱: selectionIntersects(from, to, selection, inclusiveEnd=true)（live-preview-ranges.ts:44-45）：
  //          空选区判定 range.anchor >= from && range.anchor <= to——右边界 to 本身算"在内"→ 展开；
  //          to+1 时 anchor > to → 折叠。link/image/code 均走 inclusiveEnd=true 分支
  // ⚠️ 陷阱: link 范围 [6,33)：source.indexOf(")")+1 = 33；source 尾部 " now\n\nend" 从 34 开始
  import { afterEach, expect, it } from "vitest";
  import { createEditor } from "@floatboat/nexus-core";

  afterEach(() => {
    editor.destroy();
    container.remove();
  });

  const container = document.createElement("div");
  document.body.appendChild(container);
  const source = "Click [here](https://example.com) now\n\nend";
  const editor = createEditor({
    container,
    initialValue: source,
    livePreview: true,
  });
  // link 范围: from=6, to=33（`[here](https://example.com)` 共 27 字符）
  const linkTo = source.indexOf(")") + 1; // 33
  // 初始光标停在 link 右边界处
  editor.setSelection(linkTo);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言右边界展开：`container.textContent` | [DOM] 光标在 to=33（inclusiveEnd=true）时含 "[here](https://example.com)"，且 `[data-link-url]` 为 null（cursorOnLink=true → continue，`live-preview.ts:1149-1154`） | import: @floatboat/nexus-core; API: container.textContent + container.querySelector("[data-link-url]"); 框架: vitest; 等待: 无 |
| 2 | 光标移到 to+1：`editor.setSelection(linkTo + 1)`（即 34，link 范围外） | [STATE] anchor === 34；selection-only → reuseCache=true 重建 | import: @floatboat/nexus-core; API: editor.setSelection(34); 框架: vitest; 等待: 无 |
| 3 | 断言范围外折叠：`container.querySelector("[data-link-url]")` | [DOM] 非空（重新折叠为 widget），textContent 不含 "[here]("（anchor=34 > to=33 → cursorOnLink=false → replace widget，`live-preview.ts:1156-1169`） | import: @floatboat/nexus-core; API: container.querySelector("[data-link-url]"); 框架: vitest; 等待: 无 |

**断言汇总**:
- [DOM] anchor=33 时 textContent 含 "[here](https://example.com)" 且 `[data-link-url]` 为 null
- [DOM] anchor=34 时 `[data-link-url]` 存在
- [STATE] 光标位置为 33 与 34 时状态不同（右边界 inclusiveEnd 语义验证）

---

## FP-04-02-B02 [P3] [异常] heading 非 inclusiveEnd：光标在 range.to 处仍折叠

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `"# Heading\n\nEnd"`
- 插件配置: 无（默认）
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  // import 路径: createEditor → @floatboat/nexus-core（packages/core/src/index.ts:1）
  // ⚠️ 陷阱: heading 走 selectionIntersects 默认 inclusiveEnd=false（live-preview.ts:447）：
  //          空选区判定 range.anchor >= from && range.anchor < to——右边界 to 本身不算"在内"→ 折叠；
  //          与 FP-04-02-B01 的 link inclusiveEnd=true 形成语义对照
  // ⚠️ 陷阱: heading 范围 [0,9)：setSelection(9) 落在行首 "End" 前（range.to 处）→ 仍折叠；
  //          setSelection(8) 在内容内 → 展开
  import { afterEach, expect, it } from "vitest";
  import { createEditor } from "@floatboat/nexus-core";

  afterEach(() => {
    editor.destroy();
    container.remove();
  });

  const container = document.createElement("div");
  document.body.appendChild(container);
  const source = "# Heading\n\nEnd";
  const editor = createEditor({
    container,
    initialValue: source,
    livePreview: true,
  });
  // heading 范围: from=0, to=9（"# Heading" 9 字符）
  // 光标停在 heading 右边界 to=9（selectionIntersects 非 inclusiveEnd）
  editor.setSelection(9);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言 to 处折叠：`container.textContent` | [DOM] 光标在 to=9 时不含 "# Heading"（heading 右边界不展开，与 link 的 inclusiveEnd 语义不同；cursorOnHeading=false → 前缀 `[0,2)` replace，`live-preview.ts:447-456`） | import: @floatboat/nexus-core; API: container.textContent; 框架: vitest; 等待: 无 |
| 2 | 光标移到 to-1：`editor.setSelection(8)`（heading 内容范围内） | [STATE] anchor === 8；selection-only → reuseCache=true 重建 | import: @floatboat/nexus-core; API: editor.setSelection(8); 框架: vitest; 等待: 无 |
| 3 | 断言展开：`container.textContent` | [DOM] 含 "# Heading"（`# ` 前缀恢复，`live-preview.ts:449-454` mark 而非 replace） | import: @floatboat/nexus-core; API: container.textContent; 框架: vitest; 等待: 无 |
| 4 | 断言 `editor.getDocument()` | [API] 全程为 "# Heading\n\nEnd"，边界光标切换零副作用 | import: @floatboat/nexus-core; API: editor.getDocument(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [DOM] anchor=9 时 textContent 不含 "# Heading"；anchor=8 时含 "# Heading"
- [STATE] heading 右边界（to）不触发展开（与 link inclusiveEnd 形成对照）
- [API] `editor.getDocument()` 全程 === source

---

## FP-04-02-B03 [P3] [异常] 多选区混合：一个结构展开、另一个结构折叠共存

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `"# One\n\n# Two"`
- 插件配置: 无（默认），`multiCursor: true`（多选区必需）
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  // import 路径: createEditor → @floatboat/nexus-core（packages/core/src/index.ts:1）
  // ⚠️ 陷阱: multiCursor: true 才启用多选区渲染与 editor.setSelections（EditorConfig.multiCursor，
  //          packages/core/src/types.ts:106；测试模式见 live-preview-regressions.test.ts:66-88）
  // ⚠️ 陷阱: selectionIntersects / selectionOnSameLine 内部用 selection.some() 遍历全部 ranges
  //          （live-preview-ranges.ts:40/64）——任一光标命中即展开该结构；
  //          光标1(anchor=1) 在 heading1 [0,5) 内 → 展开；光标2(anchor=13) 在 heading2 [7,12) 外 → 折叠
  // ⚠️ 陷阱: editor.setSelections(ranges, mainIndex?) 第二个参数指定主选区索引（此处 0）
  import { afterEach, expect, it } from "vitest";
  import { createEditor } from "@floatboat/nexus-core";

  afterEach(() => {
    editor.destroy();
    container.remove();
  });

  const container = document.createElement("div");
  document.body.appendChild(container);
  const source = "# One\n\n# Two";
  const editor = createEditor({
    container,
    initialValue: source,
    livePreview: true,
    multiCursor: true,
  });
  // heading1 范围 [0,5)，heading2 范围 [7,12)，文档长度 13
  // 光标1 落在 heading1 内（展开），光标2 落在文档末尾 13（heading2 范围外 → 折叠）
  editor.setSelections([{ anchor: 1 }, { anchor: source.length }], 0);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言双光标生效：`editor.getSelections()` | [STATE] ranges.length === 2，且包含 anchor 1 与 13 两个 range | import: @floatboat/nexus-core; API: editor.getSelections(); 框架: vitest; 等待: 无 |
| 2 | 断言 heading1 展开：`container.textContent` | [DOM] 含 "# One"（光标 1 在 [0,5) 内 → cursorOnHeading=true → 前缀 mark 可见，`live-preview.ts:449-454`） | import: @floatboat/nexus-core; API: container.textContent; 框架: vitest; 等待: 无 |
| 3 | 断言 heading2 折叠：`container.textContent` | [DOM] 不含 "# Two"（光标 2 在 [7,12) 外 → 前缀 replace 隐藏，`live-preview.ts:456`） | import: @floatboat/nexus-core; API: container.textContent; 框架: vitest; 等待: 无 |
| 4 | 断言标题 mark：`container.querySelectorAll("[data-heading-level='1']")` | [DOM] 两个 heading 的 mark 均存在（折叠仅隐藏 `# ` 前缀，标题文本仍在，`live-preview.ts:459-468`） | import: @floatboat/nexus-core; API: container.querySelectorAll("[data-heading-level='1']").length; 框架: vitest; 等待: 无 |

**断言汇总**:
- [STATE] `editor.getSelections().ranges.length` === 2
- [DOM] textContent 含 "# One" 且不含 "# Two"（展开/折叠共存）
- [DOM] `querySelectorAll("[data-heading-level='1']").length` === 2

---

## 增强信息来源
- 装饰生成: packages/core/src/live-preview.ts（buildDecorations:1039 / buildHeadingDecorations:432 / buildCodeBlockDecorations:857 / getInlineMarkerStyle:982 / createWidget:99 / createLivePreviewExtension:1300）
- 渲染器: packages/core/src/live-preview-renderers.ts（renderLivePreviewNode:213）
- 区间收集: packages/core/src/live-preview-ranges.ts（selectionIntersects:34 / selectionOnSameLine:53 / collectLivePreviewRanges:159）
- 测试参考: packages/core/test/live-preview.test.ts、packages/core/test/live-preview-regressions.test.ts（multi-cursor:66）
- 陷阱提示: AGENTS.md（Table Widget Development Rules）

---

## FP-04-03-N01 [P1] [正常] 自定义 renderer + createPortal 挂载 React 组件到 Widget DOM

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `"Text **bold**\n\nend"`
- 插件配置: 无（默认），`livePreview.renderers.strong` 自定义 React 渲染桥接
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  // import 路径: createEditor → @floatboat/nexus-core；React → react；createPortal → react-dom
  // ⚠️ 陷阱: livePreview 支持对象形态 LivePreviewConfig（types.ts:73-77），renderers 为
  //          Partial<Record<LivePreviewNodeType, LivePreviewRenderer>>；自定义 renderer 注册后
  //          该节点类型走"始终 widget 折叠"分支（live-preview.ts:1070 的 !config.renderers.strong 判断），
  //          光标移入不展开源码
  // ⚠️ 陷阱: renderer 签名 (context: LivePreviewRenderContext) => HTMLElement（types.ts:62），
  //          返回值是 widget 宿主 DOM；React 组件经 createPortal 挂到 host 上，
  //          宿主最终挂载于 CM6 .cm-content 下的 widget 位置（WidgetType.toDOM 产物）
  import { afterEach, expect, it } from "vitest";
  import * as React from "react";
  import { createPortal } from "react-dom";
  import { createEditor } from "@floatboat/nexus-core";

  afterEach(() => {
    editor.destroy();
    container.remove();
  });

  const container = document.createElement("div");
  document.body.appendChild(container);
  const source = "Text **bold**\n\nend";
  // livePreview 支持对象形态：renderers 注册自定义渲染器（React createPortal 桥接）
  const editor = createEditor({
    container,
    initialValue: source,
    livePreview: {
      renderers: {
        strong: (ctx) => {
          const host = document.createElement("span");
          createPortal(
            React.createElement("b", { "data-testid": "react-bold" }, ctx.text),
            host
          );
          return host;
        },
      },
    },
  });
  // 光标在末尾（strong 结构外 → 折叠为自定义 renderer 渲染的 Widget）
  editor.setSelection(source.length);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言 React 组件挂载：`container.querySelector('[data-testid="react-bold"]')` | [DOM] 非空，textContent 为 "bold"（React 组件经 createPortal 渲染进 Widget DOM，ctx.text === "bold"） | import: @floatboat/nexus-core; API: container.querySelector('[data-testid="react-bold"]'); 框架: vitest; 等待: 无（React 同步渲染） |
| 2 | 断言挂载层级：挂载节点 `host.closest(".cm-content")` | [DOM] 非空（宿主 React 组件挂载在 CM6 生成的 Widget DOM 节点下，位于 .cm-content 内；container 即 CM6 挂载节点） | import: @floatboat/nexus-core; API: container.querySelector('[data-testid="react-bold"]').closest(".cm-content"); 框架: vitest; 等待: 无 |
| 3 | 断言折叠源码隐藏：`container.textContent` | [DOM] 不含 "**"（自定义 renderer 折叠了整段结构，`Decoration.replace({widget}).range(5,13)`，`live-preview.ts:1255-1266` blockKey 分支） | import: @floatboat/nexus-core; API: container.textContent; 框架: vitest; 等待: 无 |
| 4 | 断言 `editor.getDocument()` | [API] 仍为 "Text **bold**\n\nend"（桥接纯为视图层，不改文档） | import: @floatboat/nexus-core; API: editor.getDocument(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [DOM] `[data-testid="react-bold"]` 存在，textContent === "bold"
- [DOM] React 组件容器位于 `.cm-content` 内
- [DOM] textContent 不含 "**"
- [API] `editor.getDocument()` === source

---

## FP-04-03-N02 [P2] [正常] React 组件接收完整渲染上下文（text/nodeType/from/to）

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `"Text **bold**\n\nend"`
- 插件配置: 无（默认），自定义 renderer 捕获 `LivePreviewRenderContext`
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  // import 路径: createEditor + type LivePreviewRenderContext → @floatboat/nexus-core（types.ts:51-60 导出）
  // ⚠️ 陷阱: LivePreviewRenderContext 字段 = { node, nodeType, source, text, from, to }（types.ts:51-60）；
  //          from/to 为文档绝对偏移：source "Text **bold**\n\nend" 中 strong [5,13)，
  //          故 ctx.from=5、ctx.to=13；ctx.text="bold"（marker 去除后内容）
  // ⚠️ 陷阱: 自定义 renderer 注册后走 blockKey 分支（live-preview.ts:1255），
  //          渲染上下文由 renderLivePreviewNode(node, source, renderers, from, to) 透传（live-preview-renderers.ts:213-219）
  import { afterEach, expect, it } from "vitest";
  import * as React from "react";
  import { createPortal } from "react-dom";
  import { createEditor, type LivePreviewRenderContext } from "@floatboat/nexus-core";

  afterEach(() => {
    editor.destroy();
    container.remove();
  });

  const container = document.createElement("div");
  document.body.appendChild(container);
  const source = "Text **bold**\n\nend";
  const captured: LivePreviewRenderContext[] = [];
  const editor = createEditor({
    container,
    initialValue: source,
    livePreview: {
      renderers: {
        strong: (ctx) => {
          captured.push(ctx);
          const host = document.createElement("span");
          host.dataset.nodeType = ctx.nodeType;
          host.dataset.from = String(ctx.from);
          host.dataset.to = String(ctx.to);
          createPortal(React.createElement("b", null, ctx.text), host);
          return host;
        },
      },
    },
  });
  editor.setSelection(source.length);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言渲染上下文：`captured[0]` | [AST] `captured[0].nodeType` === "strong"；`captured[0].text` === "bold"（node 为 mdast Strong 节点，`live-preview-ranges.ts:28` isLivePreviewNode 收录） | import: @floatboat/nexus-core; API: captured[0].nodeType / captured[0].text; 框架: vitest; 等待: 无 |
| 2 | 断言位置数据：`captured[0].from` / `.to` | [STATE] from === 5，to === 13（`**bold**` 的绝对偏移，即 strong range [5,13)） | import: @floatboat/nexus-core; API: captured[0].from / captured[0].to; 框架: vitest; 等待: 无 |
| 3 | 断言透传到 DOM：`container.querySelector('[data-node-type]')` | [DOM] `data-node-type` === "strong"，`data-from` === "5"，`data-to` === "13"（host.dataset 由 ctx 写入） | import: @floatboat/nexus-core; API: container.querySelector('[data-node-type]').dataset; 框架: vitest; 等待: 无 |

**断言汇总**:
- [AST] `captured[0]`：nodeType === "strong"、text === "bold"
- [STATE] `captured[0].from` === 5、`captured[0].to` === 13
- [DOM] host 的 `data-from` / `data-to` 与上下文一致

---

## FP-04-03-N03 [P4] [边界] 多个折叠节点各自独立挂载 React 组件

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `"**one** and **two**\n\nend"`
- 插件配置: 无（默认），自定义 renderer 为每个节点独立创建 portal 容器
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  // import 路径: createEditor + type LivePreviewRenderContext → @floatboat/nexus-core；React → react；createPortal → react-dom
  // ⚠️ 陷阱: 两个 strong 节点 range 分别为 [0,7) 与 [11,18)，collectLivePreviewRanges 各收集一条，
  //          每个节点调用一次 renderer → 两个独立 host + 两个独立 portal 容器（互不串扰）
  // ⚠️ 陷阱: 自定义 renderer 无光标判断 → 两处均折叠为 widget
  import { afterEach, expect, it } from "vitest";
  import * as React from "react";
  import { createPortal } from "react-dom";
  import { createEditor, type LivePreviewRenderContext } from "@floatboat/nexus-core";

  afterEach(() => {
    editor.destroy();
    container.remove();
  });

  const container = document.createElement("div");
  document.body.appendChild(container);
  const source = "**one** and **two**\n\nend";
  const editor = createEditor({
    container,
    initialValue: source,
    livePreview: {
      renderers: {
        strong: (ctx: LivePreviewRenderContext) => {
          const host = document.createElement("span");
          host.dataset.which = ctx.text;
          createPortal(
            React.createElement("span", { "data-testid": "react-widget" }, ctx.text),
            host
          );
          return host;
        },
      },
    },
  });
  editor.setSelection(source.length);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言组件数量：`container.querySelectorAll('[data-testid="react-widget"]')` | [DOM] length === 2（两个折叠节点各自挂载独立的 React 组件） | import: @floatboat/nexus-core; API: container.querySelectorAll('[data-testid="react-widget"]').length; 框架: vitest; 等待: 无 |
| 2 | 断言内容独立：逐个检查两个组件文本 | [DOM] 分别包含 "one" 与 "two"，且各自 host 的 `data-which` 与之对应（互不串扰） | import: @floatboat/nexus-core; API: Array.from(container.querySelectorAll('[data-which]')).map(el => el.dataset.which); 框架: vitest; 等待: 无 |
| 3 | 断言 `editor.getDocument()` | [API] 仍为 "**one** and **two**\n\nend" | import: @floatboat/nexus-core; API: editor.getDocument(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [DOM] `querySelectorAll('[data-testid="react-widget"]').length` === 2
- [DOM] 两个组件文本分别为 "one"、"two"，host 数据互不串扰
- [API] `editor.getDocument()` === source

---

## FP-04-03-E01 [P4] [异常] eqKey 相同 → selection-only 更新时复用既有 DOM（不重建）

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `"**bold** text here\n\nend"`
- 插件配置: 无（默认），自定义 renderer 在 host 上写入挂载计数 `data-mounts`
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  // import 路径: createEditor + type LivePreviewRenderContext → @floatboat/nexus-core；React → react；createPortal → react-dom
  // ⚠️ 陷阱: createWidget(source, swallowEvents, heightHint?, eqKey?)（live-preview.ts:99）；
  //          自定义 renderer 走 blockKey 分支（:1255-1266），blockKey 含 `${from}:${to}:${source}` 前缀
  //          （key 形如 `blockKey:5:13:**bold**`），来源不变则 eqKey 稳定
  // ⚠️ 陷阱: selection-only 更新（setSelection）→ StateField 走 selection 分支（live-preview.ts:1374-1377）
  //          以 reuseCache=true 重建，widget 经 eqKey 比较相等 → CM6 复用旧 DOM，
  //          toDOM 不再执行 → data-mounts 不增长（证明 DOM 复用而非重建）
  // ⚠️ 陷阱: 若断言 data-mounts 增长，说明 eqKey 机制被破坏（每次光标移动都重建 DOM）
  import { afterEach, expect, it } from "vitest";
  import * as React from "react";
  import { createPortal } from "react-dom";
  import { createEditor, type LivePreviewRenderContext } from "@floatboat/nexus-core";

  afterEach(() => {
    editor.destroy();
    container.remove();
  });

  const container = document.createElement("div");
  document.body.appendChild(container);
  const source = "**bold** text here\n\nend";
  let mountCount = 0;
  const editor = createEditor({
    container,
    initialValue: source,
    livePreview: {
      renderers: {
        strong: (ctx: LivePreviewRenderContext) => {
          const host = document.createElement("span");
          host.dataset.mounts = String(++mountCount);
          createPortal(
            React.createElement("b", { "data-testid": "reuse-probe" }, ctx.text),
            host
          );
          return host;
        },
      },
    },
  });
  // 初始折叠（自定义 renderer 始终折叠）
  editor.setSelection(source.length);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言初始挂载：`container.querySelector('[data-testid="reuse-probe"]')` | [DOM] 非空，textContent === "bold"，`data-mounts` === "1"（首帧 toDOM 执行一次） | import: @floatboat/nexus-core; API: container.querySelector('[data-testid="reuse-probe"]'); 框架: vitest; 等待: 无 |
| 2 | selection-only 更新：`editor.setSelection(0)`（光标移到文档开头，strong 范围 [0,7) 内） | [STATE] anchor === 0；StateField selection 分支 reuseCache=true 重建装饰（`live-preview.ts:1374-1377`） | import: @floatboat/nexus-core; API: editor.setSelection(0); 框架: vitest; 等待: 无 |
| 3 | 断言 DOM 复用：再次查询 `[data-testid="reuse-probe"]` 的 `data-mounts` | [DOM] 仍 === "1"（eqKey 相同 → CM6 复用既有 widget DOM，toDOM 未再次执行；若 >1 说明 eqKey/复用机制失效） | import: @floatboat/nexus-core; API: container.querySelector('[data-testid="reuse-probe"]').dataset.mounts; 框架: vitest; 等待: 无 |
| 4 | 断言 `editor.getDocument()` | [API] 仍为 "**bold** text here\n\nend"（复用不影响文档） | import: @floatboat/nexus-core; API: editor.getDocument(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [DOM] `[data-testid="reuse-probe"]` 存在且 `data-mounts` === "1"
- [STATE] selection-only 更新后 `data-mounts` 不增长（eqKey 复用验证）
- [API] `editor.getDocument()` === source

---

## FP-04-03-B01 [P3] [边界] setDocument 内容变化时 React 组件随新上下文重新挂载

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `"**old**\n\nend"`
- 插件配置: 无（默认），自定义 renderer 在 host 上写入 `data-text`
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  // import 路径: createEditor + type LivePreviewRenderContext → @floatboat/nexus-core；React → react；createPortal → react-dom
  // ⚠️ 陷阱: setDocument 触发 docChanged 事务 → StateField 走 docChanged 分支 build(..., reuseCache=false)
  //          （live-preview.ts:1368-1372）→ 强制重建全部装饰；blockKey 含 source（`blockKey:0:6:**old**`），
  //          新 source "**new**" 生成不同 key → 旧 widget 被替换、新 widget 挂载
  // ⚠️ 陷阱: 自定义 renderer 无光标判断 → 新旧内容均折叠为 widget；断言对象必须重新查询（旧节点已移除）
  import { afterEach, expect, it } from "vitest";
  import * as React from "react";
  import { createPortal } from "react-dom";
  import { createEditor, type LivePreviewRenderContext } from "@floatboat/nexus-core";

  afterEach(() => {
    editor.destroy();
    container.remove();
  });

  const container = document.createElement("div");
  document.body.appendChild(container);
  const editor = createEditor({
    container,
    initialValue: "**old**\n\nend",
    livePreview: {
      renderers: {
        strong: (ctx: LivePreviewRenderContext) => {
          const host = document.createElement("span");
          host.dataset.text = ctx.text;
          createPortal(React.createElement("b", null, ctx.text), host);
          return host;
        },
      },
    },
  });
  editor.setSelection(editor.getDocument().length);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言初始组件：`container.querySelector('[data-text]')` | [DOM] 存在，`data-text` === "old"（初始文档折叠渲染） | import: @floatboat/nexus-core; API: container.querySelector('[data-text]').dataset.text; 框架: vitest; 等待: 无 |
| 2 | 更新文档：`editor.setDocument("**new**\n\nend")` | [STATE] docChanged 事务触发 → build(..., reuseCache=false) 强制重建（`live-preview.ts:1368-1372`） | import: @floatboat/nexus-core; API: editor.setDocument("**new**\n\nend"); 框架: vitest; 等待: 无 |
| 3 | 断言组件更新：重新查询 `container.querySelector('[data-text]')` | [DOM] 存在且 `data-text` === "new"（新 blockKey → 旧 widget 替换，新 renderer 执行，上下文 text 为新内容） | import: @floatboat/nexus-core; API: container.querySelector('[data-text]').dataset.text; 框架: vitest; 等待: 无 |
| 4 | 断言 `editor.getDocument()` | [API] === "**new**\n\nend"（文档已更新，与渲染一致） | import: @floatboat/nexus-core; API: editor.getDocument(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [DOM] 初始 `data-text` === "old"；setDocument 后 === "new"
- [STATE] setDocument 触发 docChanged 分支强制重建（reuseCache=false）
- [API] `editor.getDocument()` === "**new**\n\nend"

---

## FP-04-03-D01 [P4] [设计约束] Widget 挂载层级：React 组件位于 CM6 生成的 Widget DOM 下

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `"**bold** and *italic*\n\nend"`
- 插件配置: 无（默认），自定义 renderer 注册 strong（React 桥接），emphasis 用内置渲染
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  // import 路径: createEditor → @floatboat/nexus-core；React → react；createPortal → react-dom
  // ⚠️ 陷阱: Widget 层级 = .cm-content > .cm-line > .cm-widgetBuffer(.cm-inline-widget) > host > React 组件
  //          （NexusWidget.toDOM 产物由 CM6 挂载，React 组件经 createPortal 挂到 host 内）
  // ⚠️ 陷阱: strong 范围 [0,8) 在文档首行 → host.closest(".cm-line") 命中首行；
  //          断言 React 节点存在且位于 .cm-content 之内即可（.cm-line/.cm-widgetBuffer 均为 CM6 生成）
  import { afterEach, expect, it } from "vitest";
  import * as React from "react";
  import { createPortal } from "react-dom";
  import { createEditor } from "@floatboat/nexus-core";

  afterEach(() => {
    editor.destroy();
    container.remove();
  });

  const container = document.createElement("div");
  document.body.appendChild(container);
  const source = "**bold** and *italic*\n\nend";
  const editor = createEditor({
    container,
    initialValue: source,
    livePreview: {
      renderers: {
        strong: (ctx) => {
          const host = document.createElement("span");
          createPortal(React.createElement("b", { "data-testid": "portal-node" }, ctx.text), host);
          return host;
        },
      },
    },
  });
  editor.setSelection(source.length);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言 React 节点存在：`container.querySelector('[data-testid="portal-node"]')` | [DOM] 非空，textContent === "bold"（createPortal 已把 React 组件挂进 widget 宿主） | import: @floatboat/nexus-core; API: container.querySelector('[data-testid="portal-node"]'); 框架: vitest; 等待: 无 |
| 2 | 断言层级：`node.closest(".cm-content")` 与 `.cm-line` | [DOM] `closest(".cm-content")` 非空且 `closest(".cm-line")` 非空（React 组件在 CM6 行内 widget 挂载点之下，未逃逸出编辑器 DOM） | import: @floatboat/nexus-core; API: container.querySelector('[data-testid="portal-node"]').closest(".cm-line"); 框架: vitest; 等待: 无 |
| 3 | 断言折叠隐藏：`container.textContent` | [DOM] 不含 "**bold**"（自定义 renderer 折叠整段，`live-preview.ts:1255-1266`）；"italic" 文本仍可见（emphasis 内置渲染保留内容） | import: @floatboat/nexus-core; API: container.textContent; 框架: vitest; 等待: 无 |
| 4 | 断言 `editor.getDocument()` | [API] 仍为 "**bold** and *italic*\n\nend" | import: @floatboat/nexus-core; API: editor.getDocument(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [DOM] `[data-testid="portal-node"]` 存在且 textContent === "bold"
- [DOM] React 节点 `closest(".cm-content")` / `closest(".cm-line")` 均非空（挂载层级正确）
- [DOM] textContent 不含 "**bold**"，含 "italic"
- [API] `editor.getDocument()` === source

---

## 增强信息来源
- 装饰生成: packages/core/src/live-preview.ts（buildDecorations:1039 / createWidget:99 / blockKey 分支:1255 / createLivePreviewExtension:1300）
- 渲染桥接: packages/core/src/live-preview-renderers.ts（renderLivePreviewNode:213 透传 context）
- 类型契约: packages/core/src/types.ts（LivePreviewRenderContext:51 / LivePreviewRenderer:62 / LivePreviewConfig:73 / EditorConfig.livePreview:84）
- 区间收集: packages/core/src/live-preview-ranges.ts（collectLivePreviewRanges:159）
- 测试参考: packages/core/test/live-preview.test.ts（setup 模式）、packages/core/test/widgets.test.ts（Widget 渲染断言模式）
- 陷阱提示: AGENTS.md（Table Widget Development Rules）

---
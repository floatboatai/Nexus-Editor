# CASE-安全与零信任-测试用例（FP-05）

> 一级功能点: 安全与零信任（PRD §4.2）
> 全局批次序号: 05
> 生成时间: 2026-08-10
> 测试框架: Vitest / jsdom（`vitest.config.ts` 已配置 `environment: "jsdom"` + `@floatboat/nexus-core` 别名 → `packages/core/src/index.ts`）
>
> 涉及二级功能点:
> - FP-05-01 rehype-sanitize 强制清洗（[安全]）
> - FP-05-02 外部链接默认 rel="noopener noreferrer"（[安全]）
> - FP-05-03 执行型代码块隔离运行环境（[安全][边界异常]）

> ⚠️ 实现差异提示（影响前置条件，全部基于 `packages/core/src` 实际源码，已增强为精确行号）:
> - **FP-05-01**：PRD 描述为"rehype-sanitize 强制清洗"，实际实现是 `defaultSanitizeHtml` 正则清洗（`live-preview.ts:597-608`，4 条规则：① 整体移除 `<script>/<iframe>/<object>/<embed>/<style>` 元素体（含大小写混淆，`gi` 标志）；② 移除孤儿自闭合危险标签；③ 剥离 `on[a-z]+` 事件属性；④ 将 `href|src|xlink:href` 中的 `javascript:` URL 中和为 `"#"`，正则 `$1=$2#$2`）。它只作用于 live-preview 的 HTML 块渲染路径（`inner.innerHTML = defaultSanitizeHtml(raw)`，`live-preview.ts:658`）。`dangerouslyAllowHtml` 选项**不存在**；`LivePreviewConfig.htmlSanitizer` 仅存在于注释中（`live-preview.ts:596`），宿主强清洗通过 `renderers.html` 自定义渲染器实现（`live-preview.ts:625-640`，try/catch 抛错自动回退默认路径）。HTML 注释块（`<!-- -->`）经 `isHtmlComment` 整块正则匹配（`live-preview.ts:585-587`）后以 `textContent` 渲染为 `.nexus-html-comment`（`live-preview.ts:643-653`），**不注入 innerHTML**。HTML 块 wrapper 类名 `.nexus-html-block`（`live-preview.ts:673`），inner 类名 `.nexus-html-block-content`（`live-preview.ts:656`）。
> - **FP-05-02**：行内链接默认**不是 `<a>` 元素**，而是渲染为带 `data-link-url` 属性的 `<span>`（`Decoration.mark`，`live-preview.ts:999-1025, 1241`），点击由 editor 级 `linkHandler`（`EditorView.domEventHandlers({ mousedown })`，`live-preview.ts:1430-1470`）处理：`event.preventDefault()` 后，`#` 开头走标题内部导航（slug 规范化匹配 `live-preview.ts:1441-1464`），其余一律 `window.open(url, "_blank", "noopener")`（`live-preview.ts:1467`）。**无 ctrlKey/metaKey 判断**——普通 mousedown 即触发 window.open。表格单元格内链接才是原生 `<a target="_blank" rel="noopener noreferrer">`（`live-preview-table.ts:433-451`，且 `mousedown` 上 `stopPropagation` 阻止 editor 级 linkHandler 接管，`live-preview-table.ts:443`）。宿主自定义 `renderers.link` 时链接走 `renderLivePreviewNode` 分发（`live-preview.ts:1225,1259` → `live-preview-renderers.ts:213-230`），`rel` 由宿主渲染器负责。
> - **FP-05-03**：普通代码块（含 js/html 等任意语言）在 live-preview 中**从不经 innerHTML 注入**，仅通过 `Decoration.line`/`Decoration.mark` 纯文本装饰渲染（`live-preview.ts:857-970`），源码文本原样保留于文档，天然无执行环境；fence 行块外 `color:transparent` 隐藏（`live-preview.ts:921-927`）；复制按钮 `aria-label="Copy code"`（`live-preview.ts:155-156`，CodeCopyWidget `live-preview.ts:134-193`）；代码块首行 line 携带 `role="code"` 与 `aria-label="Code block: ${lang}"`（`live-preview.ts:913-916`）。唯一注入 HTML 的路径是 mermaid 图：`m.initialize({ startOnLoad: false, theme: "default", securityLevel: "strict" })`（`live-preview.ts:210`）后 `diagramHost.innerHTML = svg`（`live-preview.ts:406`），其安全性依赖 mermaid 的 `securityLevel: "strict"`；解析/渲染失败走 `showError`，以 `textContent` 渲染 "Mermaid error" 标题 + 真实错误信息（`live-preview.ts:327-371`）。mermaid 经 `import("mermaid")` 动态懒加载（`live-preview.ts:205-214`）→ jsdom 下必须 `vi.mock("mermaid")` + `vi.hoisted` 定义 mock（与 `packages/core/test/mermaid.test.ts:7-17` 一致），断言 initialize/render 需 `await vi.waitFor(...)`。
> - 光标位置约定：HTML 块 / 代码块 / 行内链接在光标位于范围内时不渲染预览（`selectionIntersects`，`live-preview.ts:620-621`）。所有"渲染态"断言前统一 `editor.setSelection(editor.getDocument().length)` 把光标移到文档末尾；断言后一律 `editor.destroy()`（editor.ts:924）。
> - import 路径约定：`createEditor` 等 API 从 `@floatboat/nexus-core` 导入（vitest.config.ts:7 别名）；测试工具从 `vitest` 导入；`Root` 类型从 `mdast` 导入。

---

## FP-05-01-N01 [P1] [正常] HTML 块中的 script 标签被整体移除且其余内容保留

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `Intro\n\n<script>window.evil=true;</script>safe content\n\nend`（含 `<script>` 注入向量）
- 插件配置: 无（HTML 块清洗由核心 live-preview 内置处理）
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  // import 路径: createEditor 来自 @floatboat/nexus-core（vitest.config.ts:7 别名 → packages/core/src/index.ts）
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor } from "@floatboat/nexus-core";

  const container = document.createElement("div");
  document.body.appendChild(container);

  // 恶意输入构造: <script> 元素体（清洗规则①: /<\s*(script|iframe|object|embed|style)\b[\s\S]*?<\/\s*\1\s*>/gi）
  const editor = createEditor({
    container,
    initialValue: "Intro\n\n<script>window.evil=true;</script>safe content\n\nend",
    livePreview: true, // 布尔值等价于 LivePreviewConfig{ enabled: true }（types.ts:73-77）
  });

  afterEach(() => {
    editor.destroy(); // editor.ts:924，须在 container.remove() 之前
    container.remove();
  });
  ```

> ⚠️ 陷阱提示:
> - 清洗是**正则黑名单**（live-preview.ts:597-608）而非白名单 sanitizer，只保证移除危险元素/属性，不做 HTML 合法性校验。
> - `dangerouslyAllowHtml` 不存在；HTML 块**默认** innerHTML 注入（清洗后），无开关。
> - 光标在 HTML 块内时不渲染（live-preview.ts:620-621），本用例步骤 1 必须先 `setSelection(doc.length)` 移出块。
> - 点击 `.nexus-html-block` 非交互区域会进入编辑模式（live-preview.ts:662-671），本用例只断言不点击。
> - CM6 dispatch 同步刷新 DOM，`setSelection` 后无需 `vi.waitFor`（同 live-preview.test.ts:2168 模式）。

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | `editor.setSelection(editor.getDocument().length)`（光标移出 HTML 块） | [DOM] 触发 HTML 块渲染，wrapper `.nexus-html-block`（live-preview.ts:673）出现，inner 为 `.nexus-html-block-content` | import: @floatboat/nexus-core; API: editor.setSelection(editor.getDocument().length); 框架: vitest; 等待: 无（同步渲染，同 live-preview.test.ts:2168） |
| 2 | 断言 `container.querySelector("script")` | [DOM] 为 null（script 标签及元素体被整体移除，正则①） | import: @floatboat/nexus-core; API: container.querySelector("script"); 框架: vitest; 等待: 无 |
| 3 | 断言 `(window as { evil?: boolean }).evil` | [DOM] 为 undefined（恶意脚本未执行） | import: @floatboat/nexus-core; API: (window as { evil?: boolean }).evil; 框架: vitest; 等待: 无 |
| 4 | 断言 `container.textContent` | [DOM] 包含 "safe content"（清洗只移除危险元素，不误删正常内容） | import: @floatboat/nexus-core; API: container.textContent; 框架: vitest; 等待: 无 |

**断言汇总**:
- [DOM] `container.querySelector("script") === null`
- [DOM] `(window as { evil?: boolean }).evil === undefined`
- [DOM] `container.textContent` 包含 "safe content"
- 参考实现: live-preview.test.ts:2157-2178（strips \<script\> and inline event handlers）

---

## FP-05-01-N02 [P1] [正常] HTML 块中的内联事件属性 onclick/onerror 被剥离而元素保留

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `Intro\n\n<div class="hostile" onclick="alert(1)" onerror="evil()">ok</div>\n\nend`
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor } from "@floatboat/nexus-core";

  const container = document.createElement("div");
  document.body.appendChild(container);

  // 恶意输入构造: onclick/onerror 事件属性（清洗规则③: /\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi）
  const editor = createEditor({
    container,
    initialValue: 'Intro\n\n<div class="hostile" onclick="alert(1)" onerror="evil()">ok</div>\n\nend',
    livePreview: true,
  });

  afterEach(() => {
    editor.destroy();
    container.remove();
  });
  ```

> ⚠️ 陷阱提示:
> - 事件属性正则大小写不敏感（`i` 标志，live-preview.ts:604），`ONCLICK` 同样被剥离（见 FP-05-01-E03）。
> - 属性剥离只作用于**渲染层 innerHTML 的字符串**，不修改文档（`editor.getDocument()` 始终保留原始 markdown）。
> - `.hostile` 元素保留因为 div 不在危险元素黑名单（live-preview.ts:593-595 注释：`<details>/<summary>/<div style>` 等结构标签被允许）。

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | `editor.setSelection(editor.getDocument().length)` | [DOM] `.hostile` 元素被渲染（清洗后仍为 div） | import: @floatboat/nexus-core; API: editor.setSelection(editor.getDocument().length); 框架: vitest; 等待: 无 |
| 2 | 断言 `container.querySelector(".hostile")` | [DOM] 非 null（合法结构元素保留） | import: @floatboat/nexus-core; API: container.querySelector(".hostile"); 框架: vitest; 等待: 无 |
| 3 | 断言 `.hostile.hasAttribute("onclick")` | [DOM] 为 false（onclick 属性被剥离） | import: @floatboat/nexus-core; API: element.hasAttribute("onclick"); 框架: vitest; 等待: 无 |
| 4 | 断言 `.hostile.hasAttribute("onerror")` | [DOM] 为 false（onerror 属性被剥离） | import: @floatboat/nexus-core; API: element.hasAttribute("onerror"); 框架: vitest; 等待: 无 |
| 5 | 断言 `.hostile.textContent` | [DOM] 包含 "ok"（元素文本不受影响） | import: @floatboat/nexus-core; API: element.textContent; 框架: vitest; 等待: 无 |

**断言汇总**:
- [DOM] `container.querySelector(".hostile") !== null`
- [DOM] `.hostile.hasAttribute("onclick") === false`
- [DOM] `.hostile.hasAttribute("onerror") === false`
- [DOM] `.hostile.textContent` 包含 "ok"
- 参考实现: live-preview.test.ts:2172（`expect(block?.hasAttribute("onclick")).toBe(false)`）

---

## FP-05-01-E02 [P1] [异常] HTML 块中 javascript: URL 被中和为无害锚点

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `Intro\n\n<a href="javascript:alert(1)">click</a>\n\nend`（javascript: URL 注入向量）
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor } from "@floatboat/nexus-core";

  const container = document.createElement("div");
  document.body.appendChild(container);

  // 恶意输入构造: javascript: 伪协议 URL（清洗规则④: /(href|src|xlink:href)\s*=\s*(['"])\s*javascript:[^'"]*\2/gi → '$1=$2#$2'）
  const editor = createEditor({
    container,
    initialValue: 'Intro\n\n<a href="javascript:alert(1)">click</a>\n\nend',
    livePreview: true,
  });

  afterEach(() => {
    editor.destroy();
    container.remove();
  });
  ```

> ⚠️ 陷阱提示:
> - 中和结果精确为 `href="#"`（正则替换串 `$1=$2#$2`，live-preview.ts:606），断言值必须是 `"#"` 而非 `""`。
> - 仅中和 `href|src|xlink:href` 三种属性；`data-href="javascript:..."` 等自定义属性不在清洗范围。
> - 该清洗只发生在 HTML 块路径；行内链接 `[x](javascript:...)` 是另一条路径（见 FP-05-02-E02，不走此正则）。

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | `editor.setSelection(editor.getDocument().length)` | [DOM] 链接渲染为 `.nexus-html-block` 内元素（`<a>` 保留） | import: @floatboat/nexus-core; API: editor.setSelection(editor.getDocument().length); 框架: vitest; 等待: 无 |
| 2 | 断言 `container.querySelector("a")` | [DOM] 非 null（链接元素保留） | import: @floatboat/nexus-core; API: container.querySelector("a"); 框架: vitest; 等待: 无 |
| 3 | 断言 `a.getAttribute("href")` | [DOM] 为 "#"（javascript: URL 被中和为无害锚点，不再指向可执行代码） | import: @floatboat/nexus-core; API: element.getAttribute("href"); 框架: vitest; 等待: 无 |
| 4 | 断言 `container.textContent` | [DOM] 包含 "click"（链接文本保留） | import: @floatboat/nexus-core; API: container.textContent; 框架: vitest; 等待: 无 |

**断言汇总**:
- [DOM] `container.querySelector("a") !== null`
- [DOM] `a.getAttribute("href") === "#"`（不包含 "javascript:"）
- [DOM] `container.textContent` 包含 "click"

---

## FP-05-01-F01 [P2] [流程] 宿主自定义 renderers.html 优先于默认清洗渲染 HTML 块

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `Intro\n\n<div class="hostile"><script>window.evil=true;</script>safe</div>\n\nend`
- 插件配置: 无（通过 `livePreview.renderers.html` 自定义渲染器插桩，验证清洗钩子可替换；`renderers` 类型为 `Partial<Record<LivePreviewNodeType, LivePreviewRenderer>>`，types.ts:75）
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor } from "@floatboat/nexus-core";

  const container = document.createElement("div");
  document.body.appendChild(container);

  // 恶意输入构造: <script> 元素体（验证自定义渲染器接管后不再走默认清洗路径）
  const editor = createEditor({
    container,
    initialValue: "Intro\n\n<div class=\"hostile\"><script>window.evil=true;</script>safe</div>\n\nend",
    livePreview: {
      renderers: {
        html: (ctx) => { // LivePreviewRenderContext{ node, nodeType, source, text, from, to }（types.ts:50-58）
          const div = document.createElement("div");
          div.className = "custom-html-block";
          div.textContent = "custom-sanitized"; // 宿主自定义清洗：纯文本渲染
          return div;
        },
      },
    },
  });

  afterEach(() => {
    editor.destroy();
    container.remove();
  });
  ```

> ⚠️ 陷阱提示:
> - 自定义 renderers.html 优先于默认路径（live-preview.ts:625-640：`if (customRenderer) { try { inner = customRenderer(...) } catch { inner = null } }`）。
> - 渲染器返回值直接作为 `inner`，**宿主负责清洗**——返回的内容不再过 `defaultSanitizeHtml`。
> - 自定义渲染器返回值若为 null/undefined 或抛错，自动回退默认清洗路径（见 FP-05-01-E05）。
> - 该钩子即 PRD"宿主可插拔强清洗"的真实入口（`htmlSanitizer` 只是注释里的概念，live-preview.ts:596）。

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | `editor.setSelection(editor.getDocument().length)` | [DOM] 触发 HTML 块渲染（走自定义渲染器） | import: @floatboat/nexus-core; API: editor.setSelection(editor.getDocument().length); 框架: vitest; 等待: 无 |
| 2 | 断言 `container.querySelector(".custom-html-block")` | [DOM] 非 null（自定义渲染器被调用并接管渲染） | import: @floatboat/nexus-core; API: container.querySelector(".custom-html-block"); 框架: vitest; 等待: 无 |
| 3 | 断言 `container.querySelector("script")` | [DOM] 为 null（自定义渲染器路径同样不产生 script 元素，本用例因宿主用 textContent 渲染天然无 script） | import: @floatboat/nexus-core; API: container.querySelector("script"); 框架: vitest; 等待: 无 |
| 4 | 断言 `container.textContent` | [DOM] 包含 "custom-sanitized"（渲染结果来自自定义清洗） | import: @floatboat/nexus-core; API: container.textContent; 框架: vitest; 等待: 无 |

**断言汇总**:
- [DOM] `container.querySelector(".custom-html-block") !== null`
- [DOM] `container.querySelector("script") === null`
- [DOM] `container.textContent` 包含 "custom-sanitized"

---

## FP-05-01-E01 [P3] [异常] iframe/object/embed/style 危险元素被整体移除

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `Intro\n\n<iframe src="evil.com"></iframe><object data="evil"></object><embed src="evil.swf"><style>body{display:none}</style>ok\n\nend`（多向量）
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor } from "@floatboat/nexus-core";

  const container = document.createElement("div");
  document.body.appendChild(container);

  // 恶意输入构造: iframe/object/embed/style 四种危险元素（清洗规则①的完整黑名单）
  const editor = createEditor({
    container,
    initialValue:
      "Intro\n\n<iframe src=\"evil.com\"></iframe><object data=\"evil\"></object>" +
      "<embed src=\"evil.swf\"><style>body{display:none}</style>ok\n\nend",
    livePreview: true,
  });

  afterEach(() => {
    editor.destroy();
    container.remove();
  });
  ```

> ⚠️ 陷阱提示:
> - 黑名单精确为 `script|iframe|object|embed|style`（live-preview.ts:600），`<style>` 也在其中（可破坏布局/窃取点击），`<link rel="stylesheet">` 不在正则覆盖范围。
> - 规则①要求闭合标签 `<tag>...</tag>`；无闭合的孤儿标签由规则②兜底（live-preview.ts:602）。
> - `<svg>` 不在黑名单，但 svg 内 `onload` 事件属性会被规则③剥离。

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | `editor.setSelection(editor.getDocument().length)` | [DOM] HTML 块渲染 | import: @floatboat/nexus-core; API: editor.setSelection(editor.getDocument().length); 框架: vitest; 等待: 无 |
| 2 | 断言 `container.querySelector("iframe")` | [DOM] 为 null（黑名单①整体移除） | import: @floatboat/nexus-core; API: container.querySelector("iframe"); 框架: vitest; 等待: 无 |
| 3 | 断言 `container.querySelector("object")` | [DOM] 为 null | import: @floatboat/nexus-core; API: container.querySelector("object"); 框架: vitest; 等待: 无 |
| 4 | 断言 `container.querySelector("embed")` | [DOM] 为 null | import: @floatboat/nexus-core; API: container.querySelector("embed"); 框架: vitest; 等待: 无 |
| 5 | 断言 `container.querySelector("style")` | [DOM] 为 null | import: @floatboat/nexus-core; API: container.querySelector("style"); 框架: vitest; 等待: 无 |
| 6 | 断言 `container.textContent` | [DOM] 包含 "ok"（普通文本保留） | import: @floatboat/nexus-core; API: container.textContent; 框架: vitest; 等待: 无 |

**断言汇总**:
- [DOM] `container.querySelector("iframe") === null`
- [DOM] `container.querySelector("object") === null`
- [DOM] `container.querySelector("embed") === null`
- [DOM] `container.querySelector("style") === null`
- [DOM] `container.textContent` 包含 "ok"

---

## FP-05-01-E03 [P3] [异常] 大小写混淆的 script/img 变体仍被强制清洗

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `Intro\n\n<ScRiPt>window.evil=true;</ScRiPt><IMG SRC=x ONERROR=evil()>ok\n\nend`（大小写混淆注入向量）
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor } from "@floatboat/nexus-core";

  const container = document.createElement("div");
  document.body.appendChild(container);

  // 恶意输入构造: <ScRiPt> 大小写混淆 + <IMG ONERROR> 大写事件属性
  // 清洗规则①③均带 i 标志（live-preview.ts:600,604）→ 大小写不敏感
  const editor = createEditor({
    container,
    initialValue: "Intro\n\n<ScRiPt>window.evil=true;</ScRiPt><IMG SRC=x ONERROR=evil()>ok\n\nend",
    livePreview: true,
  });

  afterEach(() => {
    editor.destroy();
    container.remove();
  });
  ```

> ⚠️ 陷阱提示:
> - 规则①的 `gi` 标志保证 `<ScRiPt>` 被移除（live-preview.ts:600）；规则③的 `gi` 标志保证 `ONERROR=` 被剥离（live-preview.ts:604）。
> - `<IMG>` 本身不在黑名单，清洗后保留为无 onerror 的 `<img>` 元素——断言 `container.querySelector("[onerror]")` 为 null 而非断言 img 为 null。
> - jsdom 中 `<img>` 无 onerror 属性不会加载失败触发事件，安全。

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | `editor.setSelection(editor.getDocument().length)` | [DOM] HTML 块渲染 | import: @floatboat/nexus-core; API: editor.setSelection(editor.getDocument().length); 框架: vitest; 等待: 无 |
| 2 | 断言 `container.querySelector("script")` | [DOM] 为 null（`<ScRiPt>` 变体同样被移除，正则忽略大小写） | import: @floatboat/nexus-core; API: container.querySelector("script"); 框架: vitest; 等待: 无 |
| 3 | 断言 `(window as { evil?: boolean }).evil` | [DOM] 为 undefined（混淆脚本未执行） | import: @floatboat/nexus-core; API: (window as { evil?: boolean }).evil; 框架: vitest; 等待: 无 |
| 4 | 断言 `container.querySelector("[onerror]")` | [DOM] 为 null（`ONERROR` 属性被剥离，属性选择器对大小写不敏感同样匹配不到） | import: @floatboat/nexus-core; API: container.querySelector("[onerror]"); 框架: vitest; 等待: 无 |
| 5 | 断言 `container.textContent` | [DOM] 不包含 "window.evil=true" 且包含 "ok" | import: @floatboat/nexus-core; API: container.textContent; 框架: vitest; 等待: 无 |

**断言汇总**:
- [DOM] `container.querySelector("script") === null`
- [DOM] `(window as { evil?: boolean }).evil === undefined`
- [DOM] `container.querySelector("[onerror]") === null`
- [DOM] `container.textContent` 包含 "ok" 且不包含 "window.evil=true"

---

## FP-05-01-E04 [P3] [异常] 复合 XSS 载荷（img onerror + script + javascript: href）全部中和

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `Intro\n\n<img src=x onerror=alert(1)><script>alert(2)</script><a href="javascript:alert(3)">x</a>\n\nend`（复合载荷）
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor } from "@floatboat/nexus-core";

  const container = document.createElement("div");
  document.body.appendChild(container);

  // 恶意输入构造: 三种向量叠加（规则③剥离 onerror、规则①移除 script、规则④中和 javascript: href）
  const alertSpy = vi.fn();
  vi.stubGlobal("alert", alertSpy); // 全局 alert 插桩，验证任何向量都未触执行

  const editor = createEditor({
    container,
    initialValue:
      'Intro\n\n<img src=x onerror=alert(1)><script>alert(2)</script>' +
      '<a href="javascript:alert(3)">x</a>\n\nend',
    livePreview: true,
  });

  afterEach(() => {
    editor.destroy();
    container.remove();
    vi.unstubAllGlobals();
  });
  ```

> ⚠️ 陷阱提示:
> - `vi.stubGlobal("alert", alertSpy)` 需配合 `vi.unstubAllGlobals()` 清理（afterEach 中，先 destroy 再 unstub）。
> - 断言顺序：先 DOM 后 EVENT，alert 断言放在最后（渲染过程若触发 alert 会立即被 spy 捕获）。
> - `javascript:` 中和只作用于 href/src/xlink:href（规则④），本用例 `a[href]` 精确断言 `"#"`。

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | `editor.setSelection(editor.getDocument().length)` | [DOM] HTML 块渲染 | import: @floatboat/nexus-core; API: editor.setSelection(editor.getDocument().length); 框架: vitest; 等待: 无 |
| 2 | 断言 `container.querySelector("img")` | [DOM] 非 null 但 `img.hasAttribute("onerror")` 为 false（onerror 被剥离） | import: @floatboat/nexus-core; API: container.querySelector("img"); 框架: vitest; 等待: 无 |
| 3 | 断言 `container.querySelector("script")` | [DOM] 为 null（script 整体移除） | import: @floatboat/nexus-core; API: container.querySelector("script"); 框架: vitest; 等待: 无 |
| 4 | 断言 `container.querySelector("a").getAttribute("href")` | [DOM] 为 "#"（javascript: URL 中和） | import: @floatboat/nexus-core; API: element.getAttribute("href"); 框架: vitest; 等待: 无 |
| 5 | 断言 `alertSpy` | [EVENT] 从未被调用（任何注入向量都未触执行） | import: vitest; API: expect(alertSpy).not.toHaveBeenCalled(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [DOM] `img` 存在但 `img.hasAttribute("onerror") === false`
- [DOM] `container.querySelector("script") === null`
- [DOM] `a.getAttribute("href") === "#"`
- [EVENT] `alertSpy` 未调用

---

## FP-05-01-B01 [P4] [边界] HTML 注释块以 textContent 渲染、不注入 innerHTML

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `Intro\n\n<!-- 这是注释 -->\n\nend`
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor } from "@floatboat/nexus-core";

  const container = document.createElement("div");
  document.body.appendChild(container);

  // 注释块构造: 整块匹配 isHtmlComment 正则 /^\s*<!--[\s\S]*-->\s*$/（live-preview.ts:585-587）
  const editor = createEditor({
    container,
    initialValue: "Intro\n\n<!-- 这是注释 -->\n\nend",
    livePreview: true,
  });

  afterEach(() => {
    editor.destroy();
    container.remove();
  });
  ```

> ⚠️ 陷阱提示:
> - 注释经 `textContent` 渲染为 `.nexus-html-comment`（live-preview.ts:649-653），**不产生不可见的 DOM 注释节点**——若走 innerHTML，注释节点不可见会导致整块"消失"（live-preview.ts:643-648 注释）。
> - 只有**整块**都是注释才走该分支（`isHtmlComment` 要求全匹配）；注释夹杂其他内容时按普通 HTML 清洗。
> - 修复步骤 4 笔误：断言应为 `container.textContent` **包含** "Intro"（与断言汇总一致）。

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | `editor.setSelection(editor.getDocument().length)` | [DOM] 注释块渲染 | import: @floatboat/nexus-core; API: editor.setSelection(editor.getDocument().length); 框架: vitest; 等待: 无 |
| 2 | 断言 `container.querySelector(".nexus-html-comment")` | [DOM] 非 null（注释走专门的可读文本渲染路径） | import: @floatboat/nexus-core; API: container.querySelector(".nexus-html-comment"); 框架: vitest; 等待: 无 |
| 3 | 断言 `.nexus-html-comment.textContent` | [DOM] 包含 "<!-- 这是注释 -->"（原文按文本展示，未经 innerHTML 注入为不可见注释节点） | import: @floatboat/nexus-core; API: element.textContent; 框架: vitest; 等待: 无 |
| 4 | 断言 `container.textContent` | [DOM] 包含 "Intro"（正常正文不受影响，注：修正原基础用例"不含"笔误） | import: @floatboat/nexus-core; API: container.textContent; 框架: vitest; 等待: 无 |

**断言汇总**:
- [DOM] `container.querySelector(".nexus-html-comment") !== null`
- [DOM] `.nexus-html-comment.textContent` 包含 "<!-- 这是注释 -->"
- [DOM] `container.textContent` 包含 "Intro"

---

## FP-05-01-B02 [P4] [边界] 光标位于 HTML 块内时显示源码、不进入清洗渲染路径

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `Intro\n\n<script>alert(1)</script>\n\nend`
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor } from "@floatboat/nexus-core";

  const container = document.createElement("div");
  document.body.appendChild(container);

  // ⚠️ md 变量必须预定义——步骤 2 的 md.indexOf("alert(1)") 依赖它（原基础用例缺失，本增强补上）
  const md = "Intro\n\n<script>alert(1)</script>\n\nend";
  const editor = createEditor({
    container,
    initialValue: md,
    livePreview: true,
  });

  afterEach(() => {
    editor.destroy();
    container.remove();
  });
  ```

> ⚠️ 陷阱提示:
> - 光标是否在块内由 `selectionIntersects(range.from, range.to, selection, true)` 判断（live-preview.ts:620-621，`inclusiveEnd: true`），光标停在被折叠块的偏移处仍算"块内"。
> - 块内时 `buildHtmlDecorations` 直接 return（不渲染任何 HTML 元素）→ `.nexus-html-block` 为 null，源码以 CM6 原生文本显示。
> - `md.indexOf("alert(1)") + 2` 落在 `<script>` 内：`"<script>"` 中 `alert` 起始偏移 +2 保证位于块范围内。
> - 步骤 4 断言 `container.textContent` 包含源码原文，但**不要**断言 `.nexus-html-block` 内包含——块内时该元素不存在。

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 光标位于文档开头（块外）时断言 `.nexus-html-block` | [DOM] 非 null（块外渲染清洗后的 HTML） | import: @floatboat/nexus-core; API: container.querySelector(".nexus-html-block"); 框架: vitest; 等待: 无 |
| 2 | `editor.setSelection(md.indexOf("alert(1)") + 2)` 把光标移入块内 | [DOM] 光标进入 HTML 块（selectionIntersects 命中） | import: @floatboat/nexus-core; API: editor.setSelection(number); 框架: vitest; 等待: 无 |
| 3 | 断言 `container.querySelector(".nexus-html-block")` | [DOM] 为 null（块内切换为源码展示） | import: @floatboat/nexus-core; API: container.querySelector(".nexus-html-block"); 框架: vitest; 等待: 无 |
| 4 | 断言 `container.textContent` | [DOM] 包含 "<script>alert(1)</script>" 原始源码（编辑态可见，光标退出后才走清洗渲染） | import: @floatboat/nexus-core; API: container.textContent; 框架: vitest; 等待: 无 |

**断言汇总**:
- [DOM] 光标在块外时 `.nexus-html-block` 非 null
- [DOM] 光标在块内时 `.nexus-html-block` 为 null
- [DOM] 块内 `container.textContent` 包含 "<script>alert(1)</script>"

---

## FP-05-01-E05 [P5] [异常] 自定义 html 渲染器抛错时回退默认清洗路径

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `Intro\n\n<div><script>window.evil=true;</script>safe</div>\n\nend`
- 插件配置: 无（自定义 renderers.html 故意抛错，验证 try/catch 回退）
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor } from "@floatboat/nexus-core";

  const container = document.createElement("div");
  document.body.appendChild(container);

  // 恶意输入构造: <script> 元素体（回退路径必须仍执行 defaultSanitizeHtml）
  const editor = createEditor({
    container,
    initialValue: "Intro\n\n<div><script>window.evil=true;</script>safe</div>\n\nend",
    livePreview: {
      renderers: {
        html: () => {
          throw new Error("custom renderer crashed"); // 故意抛错，触发 catch 回退（live-preview.ts:637-639）
        },
      },
    },
  });

  afterEach(() => {
    editor.destroy();
    container.remove();
  });
  ```

> ⚠️ 陷阱提示:
> - 回退逻辑在 `buildHtmlDecorations` 的 try/catch（live-preview.ts:627-640）：渲染器抛错 → `inner = null` → 走 `defaultSanitizeHtml` 默认路径。
> - 回退后 inner 类名为 `.nexus-html-block-content`，wrapper 仍为 `.nexus-html-block`。
> - 回退路径**仍执行清洗**：`innerHTML = defaultSanitizeHtml(raw)`（live-preview.ts:658），所以 script 依旧被移除、evil 依旧 undefined。

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | `editor.setSelection(editor.getDocument().length)` | [DOM] 触发 HTML 块渲染（自定义渲染器抛错被吞掉） | import: @floatboat/nexus-core; API: editor.setSelection(editor.getDocument().length); 框架: vitest; 等待: 无 |
| 2 | 断言 `container.querySelector(".nexus-html-block")` | [DOM] 非 null（自定义渲染器抛错后回退默认渲染路径） | import: @floatboat/nexus-core; API: container.querySelector(".nexus-html-block"); 框架: vitest; 等待: 无 |
| 3 | 断言 `container.querySelector("script")` | [DOM] 为 null（回退路径仍执行默认清洗） | import: @floatboat/nexus-core; API: container.querySelector("script"); 框架: vitest; 等待: 无 |
| 4 | 断言 `(window as { evil?: boolean }).evil` | [DOM] 为 undefined | import: @floatboat/nexus-core; API: (window as { evil?: boolean }).evil; 框架: vitest; 等待: 无 |
| 5 | 断言 `container.textContent` | [DOM] 包含 "safe"（默认清洗保留合法内容） | import: @floatboat/nexus-core; API: container.textContent; 框架: vitest; 等待: 无 |

**断言汇总**:
- [DOM] `.nexus-html-block` 非 null（回退成功）
- [DOM] `container.querySelector("script") === null`
- [DOM] `(window as { evil?: boolean }).evil === undefined`
- [DOM] `container.textContent` 包含 "safe"

## 增强信息来源（FP-05-01）
- 清洗逻辑: `packages/core/src/live-preview.ts`（defaultSanitizeHtml，597-608；HTML 块渲染 610-680；注释渲染 585-587, 643-653）
- 自定义渲染器/回退: `packages/core/src/live-preview.ts`（625-640）；`LivePreviewConfig` 定义 `packages/core/src/types.ts`（73-77）
- 测试参考: `packages/core/test/live-preview.test.ts`（2157-2178 sanitize 测试模式）
- 陷阱提示: `AGENTS.md`（Testing Conventions：断言行为而非偶发内容；live-preview-table.ts 交互守卫规则）

---

## FP-05-02-N01 [P1] [正常] 表格内链接渲染为 a[target="_blank"] 且 rel="noopener noreferrer"

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `| 列1 | 列2 |\n| --- | --- |\n| [外部](https://example.com) | 文本 |`
- 插件配置: 无（表格由 lezer 默认 GFM 扩展解析，`lezer-markdown.ts` 内置 `...GFM`）
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor } from "@floatboat/nexus-core";

  const container = document.createElement("div");
  document.body.appendChild(container);

  const editor = createEditor({
    container,
    initialValue: "| 列1 | 列2 |\n| --- | --- |\n| [外部](https://example.com) | 文本 |",
    livePreview: true,
  });

  afterEach(() => {
    editor.destroy();
    container.remove();
  });
  ```

> ⚠️ 陷阱提示:
> - 表格渲染为 `EditableTableWidget`（block replace widget，`live-preview-table.ts`），表格内链接由 `renderInlineMdast` 的 `case "link"` 渲染（`live-preview-table.ts:433-451`）：`a.href = node.url`、`a.target = "_blank"`、`a.rel = "noopener noreferrer"`。
> - 表格链接的 `mousedown` 被 `stopPropagation`（`live-preview-table.ts:443`），editor 级 linkHandler 不接管——点击行为是浏览器原生（可 ⌘-click 新标签）。
> - 表格整块被折叠为 widget，光标不能逐字进入（`tableAtomicRanges`，live-preview.ts:1472-1474）；断言前光标放文档末尾即可。

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | `editor.setSelection(editor.getDocument().length)` | [DOM] 表格 widget 渲染（`EditableTableWidget`） | import: @floatboat/nexus-core; API: editor.setSelection(editor.getDocument().length); 框架: vitest; 等待: 无 |
| 2 | 断言 `container.querySelector('a[href="https://example.com"]')` | [DOM] 非 null（表格内链接以原生 `<a>` 渲染） | import: @floatboat/nexus-core; API: container.querySelector('a[href="https://example.com"]'); 框架: vitest; 等待: 无 |
| 3 | 断言 `a.getAttribute("rel")` | [DOM] 为 "noopener noreferrer"（外部链接默认 rel 保护） | import: @floatboat/nexus-core; API: element.getAttribute("rel"); 框架: vitest; 等待: 无 |
| 4 | 断言 `a.getAttribute("target")` | [DOM] 为 "_blank"（新标签打开） | import: @floatboat/nexus-core; API: element.getAttribute("target"); 框架: vitest; 等待: 无 |
| 5 | 断言 `a.textContent` | [DOM] 为 "外部"（链接文本正确） | import: @floatboat/nexus-core; API: element.textContent; 框架: vitest; 等待: 无 |

**断言汇总**:
- [DOM] `container.querySelector('a[href="https://example.com"]') !== null`
- [DOM] `a.getAttribute("rel") === "noopener noreferrer"`
- [DOM] `a.getAttribute("target") === "_blank"`
- [DOM] `a.textContent === "外部"`

---

## FP-05-02-N02 [P1] [正常] 行内链接渲染为 data-link-url 标记、URL 不注入 href

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `正文 [外部](https://example.com) 继续\n\nend`
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor } from "@floatboat/nexus-core";

  const container = document.createElement("div");
  document.body.appendChild(container);

  const editor = createEditor({
    container,
    initialValue: "正文 [外部](https://example.com) 继续\n\nend",
    livePreview: true,
  });

  afterEach(() => {
    editor.destroy();
    container.remove();
  });
  ```

> ⚠️ 陷阱提示:
> - 行内链接默认**不是 `<a>`**：`getInlineMarkerStyle` 的 `case "link"`（live-preview.ts:999-1010）对 `[text](url)` 隐藏 `[` 与 `](url)`，内容区间加 `Decoration.mark` + `attrs: { "data-link-url": url }`（live-preview.ts:1008,1241）→ 渲染为 `span[data-link-url]`。
> - 链接样式为 `color:var(--nexus-accent);text-decoration:underline;cursor:pointer`（live-preview.ts:1007）。
> - URL 只存于属性，**不产生 href**——`container.querySelector('a[href]')` 必须为 null。
> - 光标进入链接所在行时显示原始 markdown（`selectionOnSameLine`，live-preview.ts:1227），渲染态断言前光标必须移出。
> - 测试参考: live-preview.test.ts:212-261（data-link-url 断言模式）。

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | `editor.setSelection(editor.getDocument().length)`（光标不在链接行） | [DOM] 链接语法 `[外部](url)` 被替换为预览标记（`[` 与 `](url)` 被 Decoration.replace 隐藏） | import: @floatboat/nexus-core; API: editor.setSelection(editor.getDocument().length); 框架: vitest; 等待: 无 |
| 2 | 断言 `container.querySelector('[data-link-url="https://example.com"]')` | [DOM] 非 null（URL 存于 data-link-url 属性） | import: @floatboat/nexus-core; API: container.querySelector('[data-link-url="https://example.com"]'); 框架: vitest; 等待: 无 |
| 3 | 断言 该元素 `tagName` | [DOM] 为 "SPAN"（非 `<a>`，无原生 href 跟随风险） | import: @floatboat/nexus-core; API: element.tagName; 框架: vitest; 等待: 无 |
| 4 | 断言 `container.querySelector('a[href]')` | [DOM] 为 null（外部 URL 未被注入为 href 属性） | import: @floatboat/nexus-core; API: container.querySelector('a[href]'); 框架: vitest; 等待: 无 |
| 5 | 断言 该元素 `textContent` | [DOM] 为 "外部"（仅展示链接文本） | import: @floatboat/nexus-core; API: element.textContent; 框架: vitest; 等待: 无 |

**断言汇总**:
- [DOM] `container.querySelector('[data-link-url="https://example.com"]') !== null`
- [DOM] 该元素 `tagName === "SPAN"`
- [DOM] `container.querySelector('a[href]') === null`
- [DOM] 该元素 `textContent === "外部"`

---

## FP-05-02-N03 [P2] [正常] 自定义 link renderer 渲染链接且 rel 携带 noopener noreferrer

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `正文 [外部](https://example.com) 继续\n\nend`
- 插件配置: 无（通过 `livePreview.renderers.link` 自定义渲染器，验证渲染桥契约）
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor } from "@floatboat/nexus-core";

  const container = document.createElement("div");
  document.body.appendChild(container);

  const editor = createEditor({
    container,
    initialValue: "正文 [外部](https://example.com) 继续\n\nend",
    livePreview: {
      renderers: {
        link: (ctx) => { // ctx: LivePreviewRenderContext{ node, nodeType, source, text, from, to }（types.ts:50-58）
          const a = document.createElement("a");
          a.href = ctx.node.url ?? "#"; // Link 节点 url 字段（mdast.Link）
          a.target = "_blank";
          a.rel = "noopener noreferrer"; // rel 保护由宿主渲染器负责（默认路径不产生 <a>）
          a.textContent = ctx.text;
          return a;
        },
      },
    },
  });

  afterEach(() => {
    editor.destroy();
    container.remove();
  });
  ```

> ⚠️ 陷阱提示:
> - 有 `config.renderers.link` 时 link 节点**不走**默认 mark 装饰（`!config.renderers.link` 条件，live-preview.ts:1145），改走 `renderLivePreviewNode` replace widget（live-preview.ts:1225,1259）→ `renderers["link"](context) ?? createDefaultRenderer(context)`（live-preview-renderers.ts:229）。
> - 默认 `createDefaultRenderer` 的 link case（live-preview-renderers.ts:61-75）会生成 `<a href rel="noopener noreferrer">` 且 **Ctrl+Click 才 window.open**——与本用例的宿主实现不同，断言以宿主返回 DOM 为准。
> - 渲染器返回 `HTMLElement`，replace widget 会**折叠整个链接区间**（源码隐藏），断言后需 destroy。
> - `ctx.node.url` 为 null 时需 `?? "#"` 兜底（类型上 url 可为 null）。

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | `editor.setSelection(editor.getDocument().length)` | [DOM] 自定义 link renderer 被调用并渲染（renderLivePreviewNode 分发） | import: @floatboat/nexus-core; API: editor.setSelection(editor.getDocument().length); 框架: vitest; 等待: 无 |
| 2 | 断言 `container.querySelector('a[href="https://example.com"]')` | [DOM] 非 null（宿主渲染器接管链接渲染） | import: @floatboat/nexus-core; API: container.querySelector('a[href="https://example.com"]'); 框架: vitest; 等待: 无 |
| 3 | 断言 `a.getAttribute("rel")` | [DOM] 为 "noopener noreferrer"（宿主渲染器正确实现 rel 保护契约） | import: @floatboat/nexus-core; API: element.getAttribute("rel"); 框架: vitest; 等待: 无 |
| 4 | 断言 `a.textContent` | [DOM] 为 "外部" | import: @floatboat/nexus-core; API: element.textContent; 框架: vitest; 等待: 无 |

**断言汇总**:
- [DOM] `container.querySelector('a[href="https://example.com"]') !== null`
- [DOM] `a.getAttribute("rel") === "noopener noreferrer"`
- [DOM] `a.textContent === "外部"`

---

## FP-05-02-F01 [P2] [流程] 点击行内外部链接触发 window.open 且携带 noopener 特性

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `正文 [外部](https://example.com) 继续\n\nend`
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor } from "@floatboat/nexus-core";

  const container = document.createElement("div");
  document.body.appendChild(container);

  // window.open 插桩：jsdom 无真实窗口，mock 返回 null（window.open 调用点 live-preview.ts:1467）
  const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

  const editor = createEditor({
    container,
    initialValue: "正文 [外部](https://example.com) 继续\n\nend",
    livePreview: true,
  });

  afterEach(() => {
    editor.destroy();
    container.remove();
    openSpy.mockRestore();
  });
  ```

> ⚠️ 陷阱提示:
> - **linkHandler 监听的是 `mousedown` 而非 click**（live-preview.ts:1431）——dispatchEvent 必须用 `MouseEvent("mousedown", ...)`。
> - dispatch 参数必须 `{ bubbles: true, cancelable: true }`：bubbles 让事件从 span 冒泡到 editor contentDOM（domEventHandlers 挂载处）；cancelable 允许 `event.preventDefault()`（live-preview.ts:1438）。
> - 无 ctrlKey/metaKey 判断——普通 mousedown 即触发 `window.open(url, "_blank", "noopener")`。
> - 断言参数精确为 `["https://example.com", "_blank", "noopener"]`（第三参是窗口特性串 "noopener"，与 `rel` 属性无直接关系）。

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | `editor.setSelection(editor.getDocument().length)` | [DOM] 链接预览标记渲染（`span[data-link-url]`） | import: @floatboat/nexus-core; API: editor.setSelection(editor.getDocument().length); 框架: vitest; 等待: 无 |
| 2 | `container.querySelector('[data-link-url]')!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }))` | [EVENT] editor 级 linkHandler 捕获点击（closest("[data-link-url]") 命中 → preventDefault → window.open） | import: @floatboat/nexus-core; API: element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })); 框架: vitest; 等待: 无 |
| 3 | 断言 `openSpy` | [EVENT] 被调用 1 次 | import: vitest; API: expect(openSpy).toHaveBeenCalledTimes(1); 框架: vitest; 等待: 无 |
| 4 | 断言 `openSpy.mock.calls[0]` | [EVENT] 参数为 `["https://example.com", "_blank", "noopener"]`（新标签 + noopener 窗口特性） | import: vitest; API: expect(openSpy.mock.calls[0]).toEqual(["https://example.com", "_blank", "noopener"]); 框架: vitest; 等待: 无 |

**断言汇总**:
- [EVENT] `openSpy` 被调用 1 次
- [EVENT] `openSpy.mock.calls[0]` 等于 `["https://example.com", "_blank", "noopener"]`

---

## FP-05-02-E01 [P3] [异常] 点击行内链接不产生任何文档编辑副作用

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `正文 [外部](https://example.com) 继续\n\nend`
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor } from "@floatboat/nexus-core";

  const container = document.createElement("div");
  document.body.appendChild(container);

  const editor = createEditor({
    container,
    initialValue: "正文 [外部](https://example.com) 继续\n\nend",
    livePreview: true,
  });

  afterEach(() => {
    editor.destroy();
    container.remove();
  });
  ```

> ⚠️ 陷阱提示:
> - linkHandler 只 `preventDefault()` + `window.open`（live-preview.ts:1438,1467），**不 dispatch 任何 selection/doc 变更**——`editor.getDocument()` 与选区都保持不变。
> - jsdom 中未 mock window.open 会报 "Not implemented"——本用例不 mock 时请用 `vi.spyOn(window, "open").mockImplementation(() => null)` 包一层（或复用 FP-05-02-F01 的 setup）。
> - `editor.getDocument()` 返回字符串（editor.ts:732），用 `===` 与快照比较。

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 记录 `editor.getDocument()` 为 before | [API] 获取点击前文档快照 | import: @floatboat/nexus-core; API: editor.getDocument(); 框架: vitest; 等待: 无 |
| 2 | `editor.setSelection(editor.getDocument().length)` 后点击 `[data-link-url]` 元素（mousedown） | [EVENT] 点击被 linkHandler 消费（preventDefault，无 dispatch） | import: @floatboat/nexus-core; API: element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })); 框架: vitest; 等待: 无 |
| 3 | 断言 `editor.getDocument()` | [API] 仍等于 before（点击不修改 markdown 文档） | import: @floatboat/nexus-core; API: editor.getDocument(); 框架: vitest; 等待: 无 |
| 4 | 断言 `editor.getSelection()` | [API] 光标位置未被点击改变（无编辑副作用） | import: @floatboat/nexus-core; API: editor.getSelection(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [API] 点击后 `editor.getDocument() === before`
- [API] 点击后选区位置不变

---

## FP-05-02-E02 [P3] [异常] javascript: URL 行内链接点击不执行脚本

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `正文 [危险](javascript:window.evil=true) 继续\n\nend`（javascript: 注入向量）
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor } from "@floatboat/nexus-core";

  const container = document.createElement("div");
  document.body.appendChild(container);

  // 恶意输入构造: javascript: 伪协议行内链接（此路径不经 defaultSanitizeHtml——那是 HTML 块专属）
  const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

  const editor = createEditor({
    container,
    initialValue: "正文 [危险](javascript:window.evil=true) 继续\n\nend",
    livePreview: true,
  });

  afterEach(() => {
    editor.destroy();
    container.remove();
    openSpy.mockRestore();
  });
  ```

> ⚠️ 陷阱提示:
> - 行内链接路径**没有** javascript: 清洗（defaultSanitizeHtml 仅用于 HTML 块，live-preview.ts:658）——URL 原样进 `data-link-url` 属性。
> - 安全依赖 `window.open(url, "_blank", "noopener")`（live-preview.ts:1467）不执行 javascript: 伪协议；mock 的 open 实现不会执行该 URL，`evil` 保持 undefined。
> - linkHandler 对任何非 `#` 前缀 URL 一视同仁，`javascript:` 也按外部链接处理——第三参仍为 "noopener"。
> - 若在真实浏览器环境，window.open 的 javascript: URL 行为因浏览器而异；jsdom 断言以 mock 为准。

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | `editor.setSelection(editor.getDocument().length)` | [DOM] 链接预览标记渲染 | import: @floatboat/nexus-core; API: editor.setSelection(editor.getDocument().length); 框架: vitest; 等待: 无 |
| 2 | 断言 `[data-link-url]` 元素 | [DOM] 存在且属性值为 "javascript:window.evil=true"（URL 仅存于属性、不注入 href） | import: @floatboat/nexus-core; API: element.getAttribute("data-link-url"); 框架: vitest; 等待: 无 |
| 3 | 点击该元素（mousedown） | [EVENT] linkHandler 处理点击（非 # 前缀 → window.open 分支） | import: @floatboat/nexus-core; API: element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })); 框架: vitest; 等待: 无 |
| 4 | 断言 `openSpy.mock.calls[0][2]` | [EVENT] 为 "noopener"（即便 javascript: URL 也按外部链接处理，但 window.open 不执行脚本） | import: vitest; API: expect(openSpy.mock.calls[0][2]).toBe("noopener"); 框架: vitest; 等待: 无 |
| 5 | 断言 `(window as { evil?: boolean }).evil` | [EVENT] 为 undefined（javascript: 代码未被执行） | import: @floatboat/nexus-core; API: (window as { evil?: boolean }).evil; 框架: vitest; 等待: 无 |

**断言汇总**:
- [DOM] `[data-link-url]` 元素存在，`getAttribute("data-link-url") === "javascript:window.evil=true"`
- [EVENT] `openSpy` 被调用且第三个参数为 "noopener"
- [EVENT] `(window as { evil?: boolean }).evil === undefined`

---

## FP-05-02-B01 [P4] [边界] 自动链接 <https://...> 受控渲染为 data-link-url 标记

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `访问 <https://example.com> 吧\n\nend`（GFM autolink）
- 插件配置: 无（GFM autolink 由 lezer 默认 GFM 扩展解析）
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor } from "@floatboat/nexus-core";

  const container = document.createElement("div");
  document.body.appendChild(container);

  const editor = createEditor({
    container,
    initialValue: "访问 <https://example.com> 吧\n\nend",
    livePreview: true,
  });

  afterEach(() => {
    editor.destroy();
    container.remove();
  });
  ```

> ⚠️ 陷阱提示:
> - autolink 走 `getInlineMarkerStyle` link case 的第二分支（live-preview.ts:1012-1017）：`<URL>` → 隐藏尖括号、`data-link-url = source.slice(1, -1)`。
> - 渲染元素同样是 `span[data-link-url]`，不产生 `<a>`。
> - 若文本中同时存在裸 URL（GFM 裸链接分支，live-preview.ts:1019-1024）行为一致（data-link-url = source 本身，无标记可隐藏）。

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | `editor.setSelection(editor.getDocument().length)` | [DOM] autolink 渲染为预览标记（`<` `>` 被隐藏） | import: @floatboat/nexus-core; API: editor.setSelection(editor.getDocument().length); 框架: vitest; 等待: 无 |
| 2 | 断言 `container.querySelector('[data-link-url="https://example.com"]')` | [DOM] 非 null（自动链接同样受控渲染，URL 入属性） | import: @floatboat/nexus-core; API: container.querySelector('[data-link-url="https://example.com"]'); 框架: vitest; 等待: 无 |
| 3 | 断言 `container.querySelector('a[href]')` | [DOM] 为 null（不产生原生 `<a>`） | import: @floatboat/nexus-core; API: container.querySelector('a[href]'); 框架: vitest; 等待: 无 |
| 4 | 断言 该元素 `textContent` | [DOM] 为 "https://example.com"（链接文本展示 URL 本身） | import: @floatboat/nexus-core; API: element.textContent; 框架: vitest; 等待: 无 |

**断言汇总**:
- [DOM] `container.querySelector('[data-link-url="https://example.com"]') !== null`
- [DOM] `container.querySelector('a[href]') === null`
- [DOM] 元素 `textContent === "https://example.com"`

---

## FP-05-02-B02 [P4] [边界] 锚点 # 链接走标题内部导航、不触发 window.open

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `# 标题\n\n正文\n\n[返回](#标题)\n\nend`
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor } from "@floatboat/nexus-core";

  const container = document.createElement("div");
  document.body.appendChild(container);

  // 锚点向量: [返回](#标题) → data-link-url="#标题"（内部导航路径）
  const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

  const editor = createEditor({
    container,
    initialValue: "# 标题\n\n正文\n\n[返回](#标题)\n\nend",
    livePreview: true,
  });

  afterEach(() => {
    editor.destroy();
    container.remove();
    openSpy.mockRestore();
  });
  ```

> ⚠️ 陷阱提示:
> - 内部导航判定：`url.startsWith("#")`（live-preview.ts:1441），随后 slug 规范化：`url.slice(1).replace(/^-+/, "")` → 与正文标题行 `^(#{1,6})\s+(.+)$` 的 slug（小写化、去符号、空格转 `-`）比对（live-preview.ts:1442-1454）。
> - 匹配成功后 `view.dispatch({ selection: { anchor: m.index } })`（live-preview.ts:1455-1458）——`m.index` 是标题行首偏移，本用例 `# 标题` 在文档 0 偏移 → `anchor === 0`。
> - 锚点链接同样渲染为 `span[data-link-url="#标题"]`（mark 装饰），URL 值为带 `#` 前缀的字符串。
> - 若标题 slug 不匹配，仍返回 true（事件被消费）但不 dispatch——断言 anchor 前确保标题 slug 匹配。

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | `editor.setSelection(editor.getDocument().length)` | [DOM] 锚点链接渲染为 `[data-link-url="#标题"]`（mark 装饰路径） | import: @floatboat/nexus-core; API: editor.setSelection(editor.getDocument().length); 框架: vitest; 等待: 无 |
| 2 | 点击该元素（mousedown） | [EVENT] linkHandler 识别 `#` 前缀走内部导航（slug 匹配 → dispatch selection） | import: @floatboat/nexus-core; API: element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })); 框架: vitest; 等待: 无 |
| 3 | 断言 `openSpy` | [EVENT] 未被调用（内部锚点不弹新窗口） | import: vitest; API: expect(openSpy).not.toHaveBeenCalled(); 框架: vitest; 等待: 无 |
| 4 | 断言 `editor.getSelection().anchor` | [API] 等于 0（光标跳转到 `# 标题` 行首） | import: @floatboat/nexus-core; API: editor.getSelection().anchor; 框架: vitest; 等待: 无 |

**断言汇总**:
- [EVENT] `openSpy` 未被调用
- [API] `editor.getSelection().anchor === 0`（标题行偏移）

## 增强信息来源（FP-05-02）
- 链接渲染: `packages/core/src/live-preview.ts`（getInlineMarkerStyle link case 999-1025；mark 装饰 1224-1242；linkHandler 1430-1470；内部导航 1441-1464）
- 表格链接: `packages/core/src/live-preview-table.ts`（renderInlineMdast link case 433-451）
- 渲染桥: `packages/core/src/live-preview-renderers.ts`（renderLivePreviewNode 213-230；默认 link case 61-75）
- 测试参考: `packages/core/test/live-preview.test.ts`（212-261 data-link-url 断言模式）
- 陷阱提示: `AGENTS.md`（交互守卫规则；链接/表格渲染路径差异）

---

## FP-05-03-N01 [P1] [正常] js 代码块以纯文本渲染、绝不执行

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: ```` ```js\nwindow.evil = true;\nconst x = 1;\n```\n\nend ````
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor } from "@floatboat/nexus-core";

  const container = document.createElement("div");
  document.body.appendChild(container);

  // 恶意输入构造: js 代码块内含赋值语句（代码块纯文本渲染路径，永不 innerHTML）
  const editor = createEditor({
    container,
    initialValue: "```js\nwindow.evil = true;\nconst x = 1;\n```\n\nend",
    livePreview: true,
  });

  afterEach(() => {
    editor.destroy();
    container.remove();
  });
  ```

> ⚠️ 陷阱提示:
> - 代码块渲染 = `Decoration.line`（背景/圆角）+ `Decoration.mark`（monospace），**从不 innerHTML 注入**（live-preview.ts:857-970）——源码以 CM6 原生文本存在于文档。
> - fence 行块外 `color:transparent` 隐藏（live-preview.ts:921-927），但**内容行始终可见**（monospace mark）。
> - 代码块首行 line 携带 `role="code"` 与 `aria-label="Code block: js"`（live-preview.ts:913-916）。
> - 高亮由 worker 预计算 `codeTokens`（live-preview.ts:950-969），无 token 时纯色渲染，不影响断言。

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | `editor.setSelection(editor.getDocument().length)`（光标移出代码块） | [DOM] 代码块渲染为行装饰 + 等宽字体文本（fence 行透明隐藏、内容行可见） | import: @floatboat/nexus-core; API: editor.setSelection(editor.getDocument().length); 框架: vitest; 等待: 无 |
| 2 | 断言 `container.textContent` | [DOM] 包含 "window.evil = true;"（代码以纯文本可见） | import: @floatboat/nexus-core; API: container.textContent; 框架: vitest; 等待: 无 |
| 3 | 断言 `(window as { evil?: boolean }).evil` | [DOM] 为 undefined（代码块内容未作为脚本执行） | import: @floatboat/nexus-core; API: (window as { evil?: boolean }).evil; 框架: vitest; 等待: 无 |
| 4 | 断言 `container.querySelector("script")` | [DOM] 为 null（未生成任何可执行元素） | import: @floatboat/nexus-core; API: container.querySelector("script"); 框架: vitest; 等待: 无 |

**断言汇总**:
- [DOM] `container.textContent` 包含 "window.evil = true;"
- [DOM] `(window as { evil?: boolean }).evil === undefined`
- [DOM] `container.querySelector("script") === null`

---

## FP-05-03-N02 [P1] [正常] 代码块内含 HTML 标签时按纯文本显示、不产生元素

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: ```` ```html\n<script>window.evil=true;</script>\n<img src=x onerror=alert(1)>\n```\n\nend ````
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor } from "@floatboat/nexus-core";

  const container = document.createElement("div");
  document.body.appendChild(container);

  // 恶意输入构造: html 代码块内嵌 script/img+onerror（代码块纯文本路径，标签按文本显示）
  const editor = createEditor({
    container,
    initialValue:
      "```html\n<script>window.evil=true;</script>\n<img src=x onerror=alert(1)>\n```\n\nend",
    livePreview: true,
  });

  afterEach(() => {
    editor.destroy();
    container.remove();
  });
  ```

> ⚠️ 陷阱提示:
> - 与 HTML 块不同，代码块内的 `<script>` **不会被清洗删除，而是原样以文本显示**——断言 `container.textContent` 包含原文（与 FP-05-01-N01 的清洗行为区分开）。
> - 代码块内容行是 Decoration.mark（live-preview.ts:931-935），内容是文档文本节点，**不可能解析为元素**。
> - 若误用 `container.querySelector("script")` 断言"无 script"——正确（无元素），但 textContent 里能看到 `<script>` 原文。

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | `editor.setSelection(editor.getDocument().length)` | [DOM] 代码块渲染（html 语言块同样走纯文本装饰） | import: @floatboat/nexus-core; API: editor.setSelection(editor.getDocument().length); 框架: vitest; 等待: 无 |
| 2 | 断言 `container.querySelector("script")` | [DOM] 为 null（代码块内容未被当作 HTML 注入） | import: @floatboat/nexus-core; API: container.querySelector("script"); 框架: vitest; 等待: 无 |
| 3 | 断言 `container.querySelector("img")` | [DOM] 为 null（代码块内容未生成 img 元素） | import: @floatboat/nexus-core; API: container.querySelector("img"); 框架: vitest; 等待: 无 |
| 4 | 断言 `container.querySelector("[onerror]")` | [DOM] 为 null（无事件属性元素） | import: @floatboat/nexus-core; API: container.querySelector("[onerror]"); 框架: vitest; 等待: 无 |
| 5 | 断言 `container.textContent` | [DOM] 包含 "<script>window.evil=true;</script>" 原文 | import: @floatboat/nexus-core; API: container.textContent; 框架: vitest; 等待: 无 |

**断言汇总**:
- [DOM] `container.querySelector("script") === null`
- [DOM] `container.querySelector("img") === null`
- [DOM] `container.querySelector("[onerror]") === null`
- [DOM] `container.textContent` 包含 "<script>window.evil=true;</script>"

---

## FP-05-03-N03 [P2] [正常] 多行代码内容原样完整保留

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: ```` ```ts\nfunction add(a: number, b: number): number {\n  return a + b;\n}\n```\n\nend ````
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor } from "@floatboat/nexus-core";

  const container = document.createElement("div");
  document.body.appendChild(container);

  const CODE = "function add(a: number, b: number): number {\n  return a + b;\n}";
  const editor = createEditor({
    container,
    initialValue: "```ts\n" + CODE + "\n```\n\nend",
    livePreview: true,
  });

  afterEach(() => {
    editor.destroy();
    container.remove();
  });
  ```

> ⚠️ 陷阱提示:
> - 代码块渲染不修改文档（纯装饰），`editor.getDocument()` 与 initialValue 完全一致。
> - textContent 断言注意换行符：代码行间有 `\n`，`toContain` 按子串匹配即可。
> - 行序断言可用 `textContent.indexOf("add") < textContent.indexOf("return")` 验证（装饰不重排行）。

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | `editor.setSelection(editor.getDocument().length)` | [DOM] 代码块渲染（ts 语言块） | import: @floatboat/nexus-core; API: editor.setSelection(editor.getDocument().length); 框架: vitest; 等待: 无 |
| 2 | 断言 `container.textContent` | [DOM] 包含 "function add(a: number, b: number): number {" | import: @floatboat/nexus-core; API: container.textContent; 框架: vitest; 等待: 无 |
| 3 | 断言 `container.textContent` | [DOM] 包含 "return a + b;" | import: @floatboat/nexus-core; API: container.textContent; 框架: vitest; 等待: 无 |
| 4 | 断言 代码各行顺序 | [DOM] "add" 出现在 "return" 之前（行序未被打乱） | import: @floatboat/nexus-core; API: container.textContent.indexOf(string); 框架: vitest; 等待: 无 |
| 5 | 断言 `editor.getDocument()` | [API] 仍包含完整代码原文（渲染不修改文档） | import: @floatboat/nexus-core; API: editor.getDocument(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [DOM] `container.textContent` 包含所有代码行
- [API] `editor.getDocument()` 含完整代码原文

---

## FP-05-03-F01 [P2] [流程] 光标进出代码块在"渲染态"与"源码可编辑态"间切换

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: ```` ```js\nconst x = 1;\n```\n\nend ````
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor } from "@floatboat/nexus-core";

  const container = document.createElement("div");
  document.body.appendChild(container);

  // ⚠️ md 变量必须预定义——步骤 4 的 md.indexOf("const x = 1") 依赖它（原基础用例缺失，本增强补上）
  const md = "```js\nconst x = 1;\n```\n\nend";
  const editor = createEditor({
    container,
    initialValue: md,
    livePreview: true,
  });

  afterEach(() => {
    editor.destroy();
    container.remove();
  });
  ```

> ⚠️ 陷阱提示:
> - fence 行块外 `color:transparent`（隐藏）、块内 `color:var(--nexus-text-faint,#bbb)`（live-preview.ts:921-927）——`[style*="transparent"]` 选择器命中块外 fence。
> - 复制按钮 `CodeCopyWidget`（live-preview.ts:134-193）：`aria-label="Copy code"`、按钮文本为 `lang || "Copy"`（本用例为 "js"），始终存在（`isFenced && isFirstLine && codeValue`，live-preview.ts:938）。
> - 渲染态/源码态切换不修改文档——`editor.getDocument()` 全程不变。
> - `md.indexOf("const x = 1") + 2` 落在代码内容行，位于块范围内（`selectionIntersects(..., true)`，live-preview.ts:866）。

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | `editor.setSelection(editor.getDocument().length)`（光标在块外） | [DOM] 渲染态：fence 行 `\`\`\`js` 透明隐藏、复制按钮出现 | import: @floatboat/nexus-core; API: editor.setSelection(editor.getDocument().length); 框架: vitest; 等待: 无 |
| 2 | 断言 `container.querySelector('button[aria-label="Copy code"]')` | [DOM] 非 null（渲染态提供复制按钮） | import: @floatboat/nexus-core; API: container.querySelector('button[aria-label="Copy code"]'); 框架: vitest; 等待: 无 |
| 3 | 断言 `container.querySelector('[style*="transparent"]')` | [DOM] 非 null（fence 源码被透明隐藏） | import: @floatboat/nexus-core; API: container.querySelector('[style*="transparent"]'); 框架: vitest; 等待: 无 |
| 4 | `editor.setSelection(md.indexOf("const x = 1") + 2)` 移入块内 | [DOM] 进入源码态（fence 恢复可见） | import: @floatboat/nexus-core; API: editor.setSelection(number); 框架: vitest; 等待: 无 |
| 5 | 断言 `container.querySelector('[style*="transparent"]')` | [DOM] 为 null（fence 恢复可见，进入可编辑态） | import: @floatboat/nexus-core; API: container.querySelector('[style*="transparent"]'); 框架: vitest; 等待: 无 |
| 6 | 断言 `editor.getDocument()` | [API] 未变化（切换渲染态不触碰文档） | import: @floatboat/nexus-core; API: editor.getDocument(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [DOM] 块外：`button[aria-label="Copy code"]` 非 null
- [DOM] 块外：`[style*="transparent"]` 非 null（fence 隐藏）
- [DOM] 块内：`[style*="transparent"]` 为 null（fence 可见）
- [API] 整个流程 `editor.getDocument()` 不变

---

## FP-05-03-E01 [P3] [异常] mermaid 初始化强制 securityLevel: "strict"

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: ```` ```mermaid\ngraph TD\n  A --> B\n```\n\nend ````
- 插件配置: 无（mermaid 库通过 vi.mock 模拟，与 `packages/core/test/mermaid.test.ts:7-17` 一致）
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor } from "@floatboat/nexus-core";

  // ⚠️ vi.hoisted 必须先于 vi.mock 声明 mock 对象（hoisted 提升机制），
  // ⚠️ mock 签名必须匹配源码用法：initialize(config)、parse(text)、render(id, text)
  const { mermaidMock } = vi.hoisted(() => ({
    mermaidMock: {
      initialize: vi.fn(),
      parse: vi.fn(async () => true),
      render: vi.fn(async (_id: string, _text: string) => ({ svg: "<svg></svg>" })),
    },
  }));
  // 源码经 import("mermaid") 动态加载（live-preview.ts:208），mock 必须提供 default 导出
  vi.mock("mermaid", () => ({ default: mermaidMock }));

  const container = document.createElement("div");
  document.body.appendChild(container);

  const editor = createEditor({
    container,
    initialValue: "```mermaid\ngraph TD\n  A --> B\n```\n\nend",
    livePreview: true,
  });

  afterEach(() => {
    editor.destroy();
    container.remove();
  });
  ```

> ⚠️ 陷阱提示:
> - mermaid 是**唯一**的 HTML 注入路径：`loadMermaid()`（live-preview.ts:205-214）→ `m.initialize({ startOnLoad: false, theme: "default", securityLevel: "strict" })`（210 行）→ `diagramHost.innerHTML = svg`（406 行）。
> - `import("mermaid")` 是异步动态 import → 断言 initialize/render 必须 `await vi.waitFor(...)`；但 `.nexus-mermaid` 容器在 widget 同步 toDOM 时已创建（live-preview.ts:242，mermaid.test.ts:48 同步断言 host 非 null）。
> - jsdom 无 SVG 布局 API，mermaid 必须 mock（mermaid.test.ts:5-6 注释）。
> - `securityLevel: "strict"` 由核心强制传入，宿主不可覆盖（initialize 在 live-preview.ts 内部调用）。

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | `editor.setSelection(editor.getDocument().length)` | [DOM] mermaid widget（`.nexus-mermaid`，live-preview.ts:242）渲染 | import: @floatboat/nexus-core; API: editor.setSelection(editor.getDocument().length); 框架: vitest; 等待: 无（widget 同步创建） |
| 2 | `await vi.waitFor(() => expect(mermaidMock.initialize).toHaveBeenCalled())` | [EVENT] mermaid 初始化被调用 | import: vitest + mermaid(mock); API: vi.waitFor(() => expect(mermaidMock.initialize).toHaveBeenCalled()); 框架: vitest; 等待: initialize 被调用（动态 import 异步加载，live-preview.ts:205-214） |
| 3 | 断言 `mermaidMock.initialize` 调用参数 | [EVENT] 包含 `securityLevel: "strict"`（SVG 注入前强制严格安全级别） | import: vitest + mermaid(mock); API: expect(mermaidMock.initialize).toHaveBeenCalledWith(expect.objectContaining({ securityLevel: "strict" })); 框架: vitest; 等待: 无 |
| 4 | 断言 `mermaidMock.initialize` 调用参数 | [EVENT] 包含 `startOnLoad: false`（不自动执行文档中的图） | import: vitest + mermaid(mock); API: expect(mermaidMock.initialize).toHaveBeenCalledWith(expect.objectContaining({ startOnLoad: false })); 框架: vitest; 等待: 无 |

**断言汇总**:
- [EVENT] `mermaidMock.initialize` 被调用
- [EVENT] `mermaidMock.initialize` 以 `expect.objectContaining({ securityLevel: "strict", startOnLoad: false })` 参数调用

---

## FP-05-03-E02 [P3] [异常] mermaid 解析失败时显示错误信息、不注入任何可执行内容

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: ```` ```mermaid\ngraph TD\n  A --> B\n```\n\nend ````
- 插件配置: 无（mock parse 抛错模拟解析失败）
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor } from "@floatboat/nexus-core";

  const { mermaidMock } = vi.hoisted(() => ({
    mermaidMock: {
      initialize: vi.fn(),
      parse: vi.fn(async () => { throw new Error("syntax error in diagram"); }), // parse 抛错 → showError 路径（live-preview.ts:388-394）
      render: vi.fn(async () => ({ svg: "<svg><script>window.evil=true</script></svg>" })), // 恶意 svg：parse 失败时 render 不会被调用
    },
  }));
  vi.mock("mermaid", () => ({ default: mermaidMock }));

  const container = document.createElement("div");
  document.body.appendChild(container);

  const editor = createEditor({
    container,
    initialValue: "```mermaid\ngraph TD\n  A --> B\n```\n\nend",
    livePreview: true,
  });

  afterEach(() => {
    editor.destroy();
    container.remove();
  });
  ```

> ⚠️ 陷阱提示:
> - 错误展示走 `showError`（live-preview.ts:327-371）：`diagramHost.textContent = ""` 清空后追加 `header.textContent = "Mermaid error"` + `body.textContent = message`——**全部 textContent，不注入 HTML**。
> - 流程：`parse()` 抛错（live-preview.ts:388-394）→ `showError(err.message)` + `return`——**render 不会被调用**（mock 的恶意 svg 永远不会注入）。
> - 错误文本断言：`container.querySelector(".nexus-mermaid")!.textContent` 包含 "Mermaid error" 与 "syntax error in diagram"。
> - 错误区带 "→ Edit source" 链接（`a[href="#"]`，live-preview.ts:349-352）——断言 svg null 时注意该 `<a>` 元素存在。
> - 由于动态 import 异步，错误文本断言也需 `await vi.waitFor(...)`。

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | `editor.setSelection(editor.getDocument().length)` | [DOM] mermaid widget 渲染（`.nexus-mermaid`） | import: @floatboat/nexus-core; API: editor.setSelection(editor.getDocument().length); 框架: vitest; 等待: 无（widget 同步创建） |
| 2 | `await vi.waitFor(...)` 断言 `.nexus-mermaid` 文本 | [DOM] 包含 "Mermaid error"（解析失败走错误展示路径，header.textContent，live-preview.ts:339-341） | import: vitest; API: vi.waitFor(() => expect(container.querySelector(".nexus-mermaid")?.textContent).toContain("Mermaid error")); 框架: vitest; 等待: showError 渲染完成（parse 异步抛错） |
| 3 | 断言 错误文本 | [DOM] 包含 "syntax error in diagram"（暴露真实错误信息，未吞掉；body.textContent = message，live-preview.ts:343-345） | import: @floatboat/nexus-core; API: element.textContent; 框架: vitest; 等待: 无 |
| 4 | 断言 `.nexus-mermaid` 内 `svg` 元素 | [DOM] 为 null（失败的图不注入任何 SVG 内容，parse 失败提前 return，render 不被调用） | import: @floatboat/nexus-core; API: container.querySelector(".nexus-mermaid svg"); 框架: vitest; 等待: 无 |
| 5 | 断言 `(window as { evil?: boolean }).evil` | [DOM] 为 undefined（mock 的恶意 svg 未被注入执行） | import: @floatboat/nexus-core; API: (window as { evil?: boolean }).evil; 框架: vitest; 等待: 无 |

**断言汇总**:
- [DOM] `.nexus-mermaid` 文本包含 "Mermaid error"
- [DOM] `.nexus-mermaid` 文本包含 "syntax error in diagram"
- [DOM] `.nexus-mermaid` 内无 `svg` 元素
- [DOM] `(window as { evil?: boolean }).evil === undefined`

---

## FP-05-03-E03 [P3] [异常] 代码块中事件属性字符串仅按文本渲染、不产生事件绑定

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: ```` ```html\n<div onclick="alert(1)" onload="window.evil=true">x</div>\n```\n\nend ````
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor } from "@floatboat/nexus-core";

  const container = document.createElement("div");
  document.body.appendChild(container);

  // 恶意输入构造: 代码块内事件属性字符串（代码块纯文本路径，onclick/onload 按文本显示）
  const editor = createEditor({
    container,
    initialValue: '```html\n<div onclick="alert(1)" onload="window.evil=true">x</div>\n```\n\nend',
    livePreview: true,
  });

  afterEach(() => {
    editor.destroy();
    container.remove();
  });
  ```

> ⚠️ 陷阱提示:
> - 代码块内容行是纯文本 Decoration.mark（live-preview.ts:931-935）——`<div onclick=...>` 只是文本，不会创建元素、不产生事件绑定。
> - 与 FP-05-01-N02（HTML 块清洗剥离 on* 属性）的区别：代码块**保留原文**，`container.textContent` 包含 `onclick="alert(1)"` 原文。
> - `container.querySelector("[onclick]")` 为 null 是安全关键断言（无元素带事件属性）。
> - 若测试意外触发了 alert（例如误把代码块当 HTML 块），需检查 initialValue 的 fence 是否成对。

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | `editor.setSelection(editor.getDocument().length)` | [DOM] 代码块渲染 | import: @floatboat/nexus-core; API: editor.setSelection(editor.getDocument().length); 框架: vitest; 等待: 无 |
| 2 | 断言 `container.querySelector("div")` | [DOM] 为 null（内容未解析为 div 元素） | import: @floatboat/nexus-core; API: container.querySelector("div"); 框架: vitest; 等待: 无 |
| 3 | 断言 `container.querySelector("[onclick]")` 与 `container.querySelector("[onload]")` | [DOM] 均为 null（无事件属性元素） | import: @floatboat/nexus-core; API: container.querySelector("[onclick]"); 框架: vitest; 等待: 无 |
| 4 | 断言 `(window as { evil?: boolean }).evil` | [DOM] 为 undefined（onload 代码未执行） | import: @floatboat/nexus-core; API: (window as { evil?: boolean }).evil; 框架: vitest; 等待: 无 |
| 5 | 断言 `container.textContent` | [DOM] 包含 'onclick="alert(1)"' 原文（仅作为文本展示） | import: @floatboat/nexus-core; API: container.textContent; 框架: vitest; 等待: 无 |

**断言汇总**:
- [DOM] `container.querySelector("div") === null`
- [DOM] `container.querySelector("[onclick]") === null` 且 `[onload] === null`
- [DOM] `(window as { evil?: boolean }).evil === undefined`
- [DOM] `container.textContent` 包含 'onclick="alert(1)"'

---

## FP-05-03-B01 [P4] [边界] 无语言代码块与空代码块安全渲染

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: ```` 无语言：\n```\nplain text\n```\n\n空块：\n```\n```\n\nend ````
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor } from "@floatboat/nexus-core";

  const container = document.createElement("div");
  document.body.appendChild(container);

  const editor = createEditor({
    container,
    initialValue: "无语言：\n```\nplain text\n```\n\n空块：\n```\n```\n\nend",
    livePreview: true,
  });

  afterEach(() => {
    editor.destroy();
    container.remove();
  });
  ```

> ⚠️ 陷阱提示:
> - 无语言块（`lang` 为 null）：fence 行同样透明隐藏、内容行 monospace 渲染；复制按钮文本为 `lang || "Copy"`（live-preview.ts:153）→ 无语言时按钮显示 "Copy" 而非语言名。
> - 空代码块：`codeValue` 为空 → **不创建复制按钮**（`isFenced && isFirstLine && codeValue`，live-preview.ts:938）——本用例勿断言空块有按钮。
> - fence 行 line 的 `aria-label` 仅在 `lang` 存在时设置（live-preview.ts:914-916）——无语言块没有 `aria-label="Code block: ..."`。
> - 空块 `\`\`\`\n\`\`\`` 需两行 fence 正确闭合，否则会被 lezer 解析为普通段落。

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | `editor.setSelection(editor.getDocument().length)` | [DOM] 两个代码块均渲染（无语言块 + 空块） | import: @floatboat/nexus-core; API: editor.setSelection(editor.getDocument().length); 框架: vitest; 等待: 无 |
| 2 | 断言 `container.textContent` | [DOM] 包含 "plain text"（无语言块正常显示内容） | import: @floatboat/nexus-core; API: container.textContent; 框架: vitest; 等待: 无 |
| 3 | 断言 渲染过程 | [EVENT] 无异常抛出（空代码块不崩溃） | import: vitest; API: expect(() => editor.setSelection(editor.getDocument().length)).not.toThrow(); 框架: vitest; 等待: 无 |
| 4 | 断言 `container.querySelector("script")` | [DOM] 为 null（空块/无语言块同样零注入） | import: @floatboat/nexus-core; API: container.querySelector("script"); 框架: vitest; 等待: 无 |

**断言汇总**:
- [DOM] `container.textContent` 包含 "plain text"
- [EVENT] 渲染过程不抛异常
- [DOM] `container.querySelector("script") === null`

---

## FP-05-03-B02 [P4] [边界] 代码块含反引号与特殊字符时原样显示

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: ```` ```text\n`inline` ~tilde~ <b>bold?</b> a;b&c\n```\n\nend ````
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor } from "@floatboat/nexus-core";

  const container = document.createElement("div");
  document.body.appendChild(container);

  const editor = createEditor({
    container,
    initialValue: "```text\n`inline` ~tilde~ <b>bold?</b> a;b&c\n```\n\nend",
    livePreview: true,
  });

  afterEach(() => {
    editor.destroy();
    container.remove();
  });
  ```

> ⚠️ 陷阱提示:
> - 代码块内容为文档文本节点 + mark 装饰（live-preview.ts:931-935），反引号/`<b>`/`&` 等**全部按字面显示**，不会被 markdown/HTML 解析。
> - `<b>` 不会生成元素（`container.querySelector("b")` 为 null），但 textContent 保留原文。
> - 内容行 mark 只加 `font-family:monospace`（live-preview.ts:932-934），不影响文本内容。
> - 反引号在 fence 内部不受影响（只有 3 连反引号且成对才算 fence 结束）。

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | `editor.setSelection(editor.getDocument().length)` | [DOM] 代码块渲染（text 语言块） | import: @floatboat/nexus-core; API: editor.setSelection(editor.getDocument().length); 框架: vitest; 等待: 无 |
| 2 | 断言 `container.textContent` | [DOM] 包含 "`inline`"（反引号原样保留） | import: @floatboat/nexus-core; API: container.textContent; 框架: vitest; 等待: 无 |
| 3 | 断言 `container.textContent` | [DOM] 包含 "<b>bold?</b>" 原文（标签按文本显示） | import: @floatboat/nexus-core; API: container.textContent; 框架: vitest; 等待: 无 |
| 4 | 断言 `container.querySelector("b")` | [DOM] 为 null（未解析为加粗元素） | import: @floatboat/nexus-core; API: container.querySelector("b"); 框架: vitest; 等待: 无 |
| 5 | 断言 `container.textContent` | [DOM] 包含 "a;b&c"（特殊字符原样） | import: @floatboat/nexus-core; API: container.textContent; 框架: vitest; 等待: 无 |

**断言汇总**:
- [DOM] `container.textContent` 包含 "`inline`"、"<b>bold?</b>"、"a;b&c"
- [DOM] `container.querySelector("b") === null`

---

## FP-05-03-D01 [P4] [数据] AST 数据层完整：getAst() 的 code 节点保留原始 lang 与 value

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: ```` ```js\n<script>window.evil=true;</script>\n```\n\nend ````
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor } from "@floatboat/nexus-core";
  // Root 类型来自 mdast（@floatboat/nexus-core 的类型依赖）
  import type { Root } from "mdast";

  const container = document.createElement("div");
  document.body.appendChild(container);

  const editor = createEditor({
    container,
    initialValue: "```js\n<script>window.evil=true;</script>\n```\n\nend",
    livePreview: true,
  });

  // findCodeNode 遍历 ast.children 查找首个 type === "code" 的节点
  function findCodeNode(ast: Root): { lang?: string | null; value?: string } | null {
    for (const child of ast.children) {
      if (child.type === "code") return child;
    }
    return null;
  }

  afterEach(() => {
    editor.destroy();
    container.remove();
  });
  ```

> ⚠️ 陷阱提示:
> - `editor.getAst()` 返回 mdast Root（editor.ts:735），由 lezer AST 快照转换而来；数据层**不经任何清洗**——清洗只作用于渲染层 HTML 注入路径（live-preview.ts:658）。
> - code 节点的 `value` 保留原文 `<script>window.evil=true;</script>`（数据层不丢失）；渲染层以纯文本安全展示（live-preview.ts:857-970）——数据层与渲染层双路径一致。
> - `lang` 为 `"js"`（fence 语言标识），清洗不会篡改元数据。
> - 渲染层断言 `container.textContent` 包含同一段源码时，需先 `setSelection(doc.length)` 移出块（块内源码同样可见，但渲染态断言更稳定）。

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言 `editor.getAst()` | [API] 返回 mdast Root | import: @floatboat/nexus-core; API: editor.getAst(); 框架: vitest; 等待: 无 |
| 2 | 断言 findCodeNode(ast) | [API] 非 null（code 节点存在于 AST） | import: @floatboat/nexus-core; API: findCodeNode(ast); 框架: vitest; 等待: 无 |
| 3 | 断言 code 节点 `lang` | [API] 为 "js"（语言元数据未被清洗篡改） | import: @floatboat/nexus-core; API: codeNode.lang; 框架: vitest; 等待: 无 |
| 4 | 断言 code 节点 `value` | [API] 为 "<script>window.evil=true;</script>"（源码数据原样保留） | import: @floatboat/nexus-core; API: codeNode.value; 框架: vitest; 等待: 无 |
| 5 | 断言渲染层 `container.textContent` | [DOM] 包含同一段源码（渲染层安全展示、数据层不丢失，双路径一致） | import: @floatboat/nexus-core; API: container.textContent; 框架: vitest; 等待: 无 |

**断言汇总**:
- [API] `editor.getAst()` 中 code 节点 `lang === "js"`
- [API] code 节点 `value === "<script>window.evil=true;</script>"`
- [DOM] 渲染层与数据层内容一致（安全清洗只作用于渲染层 HTML 注入路径）

## 增强信息来源（FP-05-03）
- 代码块渲染: `packages/core/src/live-preview.ts`（buildCodeBlockDecorations 857-970；fence 透明 921-927；CodeCopyWidget 134-193；复制按钮 aria-label 155-156）
- mermaid: `packages/core/src/live-preview.ts`（loadMermaid + initialize 205-214；MermaidWidget 240-418；securityLevel: "strict" 210；innerHTML 注入 406；showError 327-371；parse 失败流程 383-394）
- 测试参考: `packages/core/test/mermaid.test.ts`（7-17 vi.mock 模式；48 同步 host 断言）
- 陷阱提示: `AGENTS.md`（Testing Conventions；rAF/交互守卫规则）
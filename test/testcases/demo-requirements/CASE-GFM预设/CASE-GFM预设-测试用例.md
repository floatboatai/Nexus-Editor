# CASE-GFM预设-测试用例（FP-13）

> 一级功能点: GFM 预设（demo-requirements.md §4）
> 全局批次序号: 13
> 生成时间: 2026-08-11
> 测试框架: Playwright（Electron demo e2e）
> 覆盖二级功能点: FP-13-01 ~ FP-13-05（共 5 个）
> 用例总数: 36
>
> 涉及二级功能点:
> - FP-13-01 tables 表格语法解析（[AST解析][插件能力]）
> - FP-13-02 strikethrough 删除线语法解析（[AST解析][插件能力]）
> - FP-13-03 task lists 任务列表语法解析（[AST解析][插件能力]）
> - FP-13-04 autolink literals 自动链接（[AST解析][插件能力]）
> - FP-13-05 footnotes GFM 风格脚注（[AST解析][插件能力]）
>
> ⚠️ 实现说明（依据 `packages/preset-gfm/src/index.ts` + `packages/core/src/live-preview.ts` 实际代码）:
> - **createGfmPreset**（`packages/preset-gfm/src/index.ts:5-10`）：纯 Tier2 插件，仅注入 `remark-gfm` 到 `remarkPlugins` 数组。无参数、无 cmExtensions、无 shortcuts/slashCommands/widgets。启用 mdast 扩展: autolink literals、footnotes（GFM 风格）、strikethrough、task lists、tables。
> - **demo 默认挂载**（`apps/electron-demo/src/renderer/editor-shell.ts:插件加载顺序第 1 项`）：`createGfmPreset()` 是 demo 加载的第一个插件。
> - **Live Preview 对 GFM 节点的渲染**（`packages/core/src/live-preview.ts` + `live-preview-table.ts`）:
>   - **tables**（`live-preview.ts:1078-1086`）：当 `range.node.type === "table"` 时，使用 `Decoration.replace` + `EditableTableWidget`（block widget）替换整个表格源码。`EditableTableWidget.toDOM()`（`live-preview-table.ts:931-933`）创建 `<div class="nexus-table-wrapper">` 包裹 `<table role="grid">`，单元格为 `<td class="nexus-cell">`。光标在表格行内时仍渲染 widget（block 替换），但内部单元格可点击编辑。
>   - **strikethrough**（mdast type `"delete"`，`live-preview.ts:988-989`）：`getInlineMarkerStyle("delete", source)` 返回 `{ openLen: 2, closeLen: 2, style: "text-decoration:line-through" }`。Live Preview 隐藏 `~~` 开闭标记（各 2 字符），文本内容应用 `line-through` 样式。光标进入 delete 节点范围时标记展开显示。
>   - **task lists**（`live-preview.ts:534-576`）：list 节点处理中，`CHECKBOX_RE` 匹配 `[ ]`/`[x]`/`[X]`，创建 `<input type="checkbox">` widget（`Decoration.replace`）。勾选项（`[x]`）的后续文本额外加 `text-decoration: line-through; color: var(--nexus-text-muted)` mark 装饰。
>   - **autolink literals**（`live-preview.ts:1019-1024`）：裸 URL 被 remark-gfm 解析为 `link` 节点（source 为完整 URL），`getInlineMarkerStyle("link", source)` 走 GFM autolink literal 分支: `openLen: 0, closeLen: 0`（无标记隐藏），直接应用 `color:var(--nexus-accent);text-decoration:underline;cursor:pointer` 样式，并设 `data-link-url` 属性。
>   - **footnotes**（`live-preview.ts:1180-1210`）：`footnoteReference` 节点 → `<sup>` 上标 widget（accent 色，`Decoration.replace`）；`footnoteDefinition` 节点 → `<div>` 块级 widget（muted 色 + 上边框 + `<sup>` 标记），`Decoration.replace` + `Decoration.line`。
> - **e2e 验证策略**: demo 未将 editor 暴露到 `window`，所有验证通过 `.cm-content` 的 textContent / innerHTML / DOM 结构间接进行。GFM 语法解析的正确性通过 Live Preview widget 渲染后的 DOM 类名、标签、样式属性来断言。光标移入/移出区间触发折叠/展开切换，通过 textContent 差异断言。
> - 全局 setup 使用 `launchDemo()` 启动 Electron demo。

---

## e2e 全局前置条件

- 依赖环境: Electron demo（Vite dev server localhost:5173 + 已构建的 `apps/electron-demo/dist-electron/main.js`）
- 初始文档: demo 启动后默认状态（可能恢复上次 vault 文档或空文档）
- 插件配置: demo 默认挂载 —— createGfmPreset（第 1 个）+ createHistoryPlugin + createToolbarPlugin + createSearchPlugin + createWikilinksPlugin + createWordCountPlugin
- livePreview 配置: demo 默认 `settings.livePreview = true`
- 核心扩展: `editor.ts` 默认挂载 markdownKeymap() + markdownFoldService() + markdownAutoPair()
- 角色权限: 无需登录（本地桌面应用）
- 未达成时的创建过程:
  1. 启动 Vite dev server（终端: `pnpm dev:renderer`; 等待: http://localhost:5173 可访问）
  2. 构建 Electron 主进程（终端: `pnpm build:electron-demo`; 产物: `apps/electron-demo/dist-electron/main.js`）
  3. 测试代码调用 `launchDemo()` 启动 Electron 实例（内部: `electron.launch({ args: [mainJs], env: { VITE_DEV_SERVER_URL: "http://localhost:5173" } })`，等待 `.cm-content` 可见）

setup 代码模板（所有用例通用）:
```typescript
import { _electron as electron, test, expect, type ElectronApplication, type Page } from "@playwright/test";
import { launchDemo } from "./helpers/electron-launcher";

let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  const launched = await launchDemo();
  app = launched.app;
  page = launched.page;
});

test.afterAll(async () => {
  await app.close();
});

// 辅助：清空编辑器
async function clearEditor(page: Page) {
  await page.click(".cm-content");
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
}

// 辅助：键盘输入
async function typeInEditor(page: Page, text: string) {
  await page.click(".cm-content");
  await page.keyboard.type(text);
}

// 辅助：通过 execCommand 插入文本（含换行的多行文本兼容性更好）
async function insertText(page: Page, text: string) {
  await page.click(".cm-content");
  await page.evaluate((t) => document.execCommand("insertText", false, t), text);
}

// 辅助：获取编辑器纯文本内容
async function getEditorText(page: Page): Promise<string> {
  return (await page.locator(".cm-content").textContent()) ?? "";
}

// 辅助：获取编辑器 innerHTML（用于检查装饰/标记 DOM 结构）
async function getEditorHTML(page: Page): Promise<string> {
  return (await page.locator(".cm-content").innerHTML()) ?? "";
}

// 辅助：移光标到文档末尾
async function moveToEnd(page: Page) {
  await page.keyboard.press("ControlOrMeta+End");
}

// 辅助：移光标到文档开头
async function moveToStart(page: Page) {
  await page.keyboard.press("ControlOrMeta+Home");
}
```

---

## FP-13-01: tables 表格语法解析

> remark-gfm 将 GFM 表格语法（`| A | B |` + 分隔行 `|---|---|` + 数据行）解析为 mdast `table` 节点。Live Preview（`live-preview.ts:1078-1086`）将 `table` 节点用 `EditableTableWidget`（block widget）替换渲染为 `<div class="nexus-table-wrapper">` 包裹的 `<table role="grid">`（`live-preview-table.ts:931-946`）。单元格为 `<td class="nexus-cell">`（`live-preview-table.ts:1773`）。表格源码（含 `|`、`---`）在 widget 渲染后被 `Decoration.replace` 隐藏。

### FP-13-01-E01 [P0] [正向] 标准 2 列表格 → 渲染为 nexus-table-widget

- **优先级**: P0
- **类型**: 正向
- **前置条件**: demo 已启动，编辑器可见，livePreview 开启
- **测试步骤**:
  1. 清空编辑器后插入表格语法: `| A | B |\n|---|---|\n| 1 | 2 |`
  2. 按 Enter + ArrowDown 将光标移出表格行
  3. 断言 `.nexus-table-wrapper` 存在（`count() >= 1`）
  4. 断言 `.nexus-table-wrapper table` 存在且 `role="grid"`
- **预期结果**:
  1. 选择器 `.nexus-table-wrapper` count >= 1
  2. 选择器 `.nexus-table-wrapper table[role='grid']` 存在
- **自动化信息**: 选择器: .nexus-table-wrapper; 操作: insertText + count(); 控件: editor; 等待: 500ms

---

### FP-13-01-E02 [P0] [正向] 表格单元格内容正确渲染

- **优先级**: P0
- **类型**: 正向
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后插入: `| Name | Age |\n|------|-----|\n| Alice | 30 |`
  2. 光标移出表格行（Enter 两次）
  3. 断言 `.nexus-table-wrapper` 的 textContent 含 "Name"、"Age"、"Alice"、"30"
  4. 断言 `.nexus-cell` 数量 >= 4（2 行 × 2 列）
- **预期结果**:
  1. `.nexus-table-wrapper` textContent 含全部 4 个单元格文本
  2. `.nexus-cell` count >= 4
- **自动化信息**: 选择器: .nexus-table-wrapper; 操作: textContent(); 控件: editor; 等待: 500ms

---

### FP-13-01-E03 [P1] [正向] 3 列多行表格正确渲染

- **优先级**: P1
- **类型**: 正向变体
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后插入 3 列 3 行表格: `| H1 | H2 | H3 |\n|----|----|----|\n| a1 | a2 | a3 |\n| b1 | b2 | b3 |`
  2. 光标移出表格
  3. 断言 `.nexus-cell` 数量 >= 9（3 行 × 3 列）
  4. 断言 textContent 含 "H1"、"H2"、"H3"、"a1"~"b3"
- **预期结果**:
  1. `.nexus-cell` count >= 9
  2. textContent 含所有 9 个单元格值
- **自动化信息**: 选择器: .nexus-cell; 操作: count(); 控件: editor; 等待: 500ms

---

### FP-13-01-E04 [P1] [正向] 表格内含 GFM 行内语法（删除线/加粗）

- **优先级**: P1
- **类型**: 正向混合
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后插入: `| Col |\n|-----|\n| ~~strike~~ |`
  2. 光标移出表格
  3. 断言 `.nexus-table-wrapper` 存在
  4. 断言表格内含 `text-decoration: line-through` 样式的元素（删除线渲染于单元格内）
  5. 断言 textContent 含 "strike"（不含 `~~`）
- **预期结果**:
  1. `.nexus-table-wrapper` 存在
  2. 表格 innerHTML 含 `line-through` 样式
  3. textContent 含 "strike" 不含 "~~"
- **自动化信息**: 选择器: .nexus-table-wrapper; 操作: innerHTML(); 控件: editor; 等待: 500ms

---

### FP-13-01-I01 [P1] [交互] 光标在表格行内 → 表格 widget 仍渲染

- **优先级**: P1
- **类型**: 交互
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后插入: `| A | B |\n|---|---|\n| 1 | 2 |\n\ntext`（表格后跟空行和文本）
  2. 光标移到 "text" 行（表格在折叠渲染态）
  3. 按 ArrowUp 将光标移回表格行范围内
  4. 断言 `.nexus-table-wrapper` 仍然存在（block widget 不因光标进入而消失）
  5. 断言单元格可点击聚焦（`.nexus-cell` contentEditable 可激活）
- **预期结果**:
  1. 光标在表格行内时 `.nexus-table-wrapper` count >= 1
  2. 单元格 `.nexus-cell` 仍可见
- **自动化信息**: 选择器: .nexus-table-wrapper; 操作: count(); 控件: editor; 等待: 500ms

---

### FP-13-01-N01 [P1] [边界] 缺少分隔行的管道符文本 → 不渲染为表格

- **优先级**: P1
- **类型**: 负向/边界
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后插入无分隔行的管道文本: `| A | B |\n| 1 | 2 |`（缺少 `|---|---|` 分隔行）
  2. 光标移出
  3. 断言 `.nexus-table-wrapper` 不存在（count === 0）
  4. 断言 textContent 含原始管道文本（未被解析为表格）
- **预期结果**:
  1. `.nexus-table-wrapper` count === 0
  2. textContent 含 `| A | B |` 原文
- **自动化信息**: 选择器: .nexus-table-wrapper; 操作: count(); 控件: editor; 等待: 500ms

---

### FP-13-01-N02 [P2] [边界] 单列表格正确渲染

- **优先级**: P2
- **类型**: 边界
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后插入单列表格: `| Only |\n|------|\n| val |`
  2. 光标移出
  3. 断言 `.nexus-table-wrapper` 存在
  4. 断言 textContent 含 "Only"、"val"
- **预期结果**:
  1. `.nexus-table-wrapper` count >= 1
  2. textContent 含 "Only" 和 "val"
- **自动化信息**: 选择器: .nexus-table-wrapper; 操作: count(); 控件: editor; 等待: 500ms

---

### FP-13-01-N03 [P2] [边界] 空单元格表格正确渲染

- **优先级**: P2
- **类型**: 边界
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后插入含空单元格表格: `| A | B |\n|---|---|\n|  |  |`
  2. 光标移出
  3. 断言 `.nexus-table-wrapper` 存在
  4. 断言 `.nexus-cell` count >= 4（含空单元格）
- **预期结果**:
  1. `.nexus-table-wrapper` count >= 1
  2. `.nexus-cell` count >= 4
- **自动化信息**: 选择器: .nexus-cell; 操作: count(); 控件: editor; 等待: 500ms

---

## FP-13-02: strikethrough 删除线语法解析

> remark-gfm 将 `~~text~~` 语法解析为 mdast `delete` 节点。Live Preview（`live-preview.ts:988-989`）的 `getInlineMarkerStyle("delete")` 返回 `{ openLen: 2, closeLen: 2, style: "text-decoration:line-through" }`。光标不在 delete 节点范围时，`~~` 开闭标记被折叠隐藏（`Decoration.replace`），文本应用 `line-through` 样式（`Decoration.mark`）。光标进入范围时标记展开显示。

### FP-13-02-E01 [P0] [正向] 标准删除线 ~~text~~ → line-through 渲染且标记隐藏

- **优先级**: P0
- **类型**: 正向
- **前置条件**: demo 已启动，编辑器可见，livePreview 开启
- **测试步骤**:
  1. 清空编辑器后输入 `~~deleted~~` 后按 Enter 两次（光标移到下一空行）
  2. 断言 `.cm-content` textContent 含 "deleted" 但不含 `~~`
  3. 断言 `.cm-content` innerHTML 含 `text-decoration:line-through` 样式
- **预期结果**:
  1. textContent 含 "deleted" 不含 "~~"
  2. innerHTML 含 `line-through`
- **自动化信息**: 选择器: .cm-content; 操作: textContent() + innerHTML(); 控件: editor; 等待: 300ms

---

### FP-13-02-E02 [P0] [正向] 删除线内文本正确保留

- **优先级**: P0
- **类型**: 正向
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后输入 `before ~~strike text~~ after` 后按 Enter 两次
  2. 断言 textContent 含 "before"、"strike text"、"after"
  3. 断言 textContent 不含 `~~`
  4. 断言 innerHTML 中 "strike text" 部分含 `line-through` 样式
- **预期结果**:
  1. textContent 含 "before strike text after"
  2. textContent 不含 "~~"
  3. innerHTML 含 `line-through`
- **自动化信息**: 选择器: .cm-content; 操作: textContent() + innerHTML(); 控件: editor; 等待: 300ms

---

### FP-13-02-E03 [P1] [正向] 单波浪号 ~text~ 不触发删除线

- **优先级**: P1
- **类型**: 正向变体
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后输入 `~single~` 后按 Enter 两次
  2. 断言 innerHTML 不含 `line-through`（单 `~` 不是 GFM 删除线语法）
  3. 断言 textContent 含 `~single~`（原文保留）
- **预期结果**:
  1. innerHTML 不含 `line-through`
  2. textContent 含 "~single~"
- **自动化信息**: 选择器: .cm-content; 操作: innerHTML(); 控件: editor; 等待: 300ms

---

### FP-13-02-E04 [P1] [正向] 删除线与加粗嵌套 ~~**bold strike**~~

- **优先级**: P1
- **类型**: 正向混合
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后输入 `~~**bold strike**~~` 后按 Enter 两次
  2. 断言 textContent 含 "bold strike" 不含 `~~` 和 `**`
  3. 断言 innerHTML 同时含 `line-through` 和 `font-weight:bold` 样式
- **预期结果**:
  1. textContent 含 "bold strike"，不含 "~~" 和 "**"
  2. innerHTML 含 `line-through` 和 `bold`
- **自动化信息**: 选择器: .cm-content; 操作: innerHTML(); 控件: editor; 等待: 300ms

---

### FP-13-02-I01 [P1] [交互] 光标移入删除线区间 → ~~ 标记展开

- **优先级**: P1
- **类型**: 交互
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后输入 `~~stricken~~` 后按 Enter 两次（折叠态，`~~` 隐藏）
  2. 断言 textContent 不含 `~~`（确认折叠态）
  3. 按 ArrowUp 将光标移回删除线行
  4. 断言 textContent 含 `~~stricken~~`（标记展开）
- **预期结果**:
  1. 移出态 textContent 不含 "~~"
  2. 移入态 textContent 含 "~~stricken~~"
- **自动化信息**: 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 300ms

---

### FP-13-02-I02 [P1] [交互] 光标移出删除线区间 → ~~ 标记重新折叠

- **优先级**: P1
- **类型**: 交互
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后输入 `~~move~~` 后按 Enter 两次
  2. 按 ArrowUp 移入删除线行（展开态）
  3. 断言 textContent 含 `~~`
  4. 按 ArrowDown 移出（重新折叠）
  5. 断言 textContent 不含 `~~`
- **预期结果**:
  1. 展开态含 "~~"
  2. 折叠态不含 "~~"
- **自动化信息**: 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 300ms

---

### FP-13-02-N01 [P2] [边界] 不闭合的 ~~ → 不渲染删除线

- **优先级**: P2
- **类型**: 负向/边界
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后输入 `~~unclosed text` 后按 Enter 两次
  2. 断言 innerHTML 不含 `line-through`（缺少闭合 `~~`）
  3. 断言 textContent 含 `~~unclosed text`（原文保留）
- **预期结果**:
  1. innerHTML 不含 `line-through`
  2. textContent 含 "~~unclosed text"
- **自动化信息**: 选择器: .cm-content; 操作: innerHTML() + textContent(); 控件: editor; 等待: 300ms

---

### FP-13-02-N02 [P2] [边界] 空删除线 ~~~~ → 渲染为空 line-through

- **优先级**: P2
- **类型**: 边界
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后输入 `a~~~~b` 后按 Enter 两次
  2. 断言 textContent 含 "ab"（删除线标记被隐藏，内容为空）
  3. 断言 `.cm-content` 正常渲染不崩溃
- **预期结果**:
  1. textContent 含 "ab"
  2. 编辑器不崩溃
- **自动化信息**: 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 300ms

---

## FP-13-03: task lists 任务列表语法解析

> remark-gfm 将 `- [ ] text` / `- [x] text` 解析为 mdast `list > listItem`（`checked: false/true`）。Live Preview（`live-preview.ts:534-576`）在处理 list 节点时，`CHECKBOX_RE = /^\[([ xX])\] /` 匹配列表项标记后的复选框语法，创建 `<input type="checkbox">` widget（`Decoration.replace`，`live-preview.ts:540-565`）。勾选项（`[x]`/`[X]`）的后续文本额外加 `text-decoration: line-through; color: var(--nexus-text-muted)` mark 装饰（`live-preview.ts:569-575`）。

### FP-13-03-E01 [P0] [正向] 未勾选任务项 - [ ] text → 渲染为 checkbox

- **优先级**: P0
- **类型**: 正向
- **前置条件**: demo 已启动，编辑器可见，livePreview 开启
- **测试步骤**:
  1. 清空编辑器后输入 `- [ ] todo item` 后按 Enter 两次
  2. 断言 `.cm-content` innerHTML 含 `<input` 且 `type="checkbox"`
  3. 断言 checkbox 的 `checked` 属性为 false
  4. 断言 textContent 含 "todo item"
- **预期结果**:
  1. innerHTML 含 `input` 和 `checkbox`
  2. checkbox 未勾选
  3. textContent 含 "todo item"
- **自动化信息**: 选择器: .cm-content input[type='checkbox']; 操作: count() + isChecked(); 控件: editor; 等待: 300ms

---

### FP-13-03-E02 [P0] [正向] 已勾选任务项 - [x] text → checkbox 勾选 + 文本删除线

- **优先级**: P0
- **类型**: 正向
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后输入 `- [x] done task` 后按 Enter 两次
  2. 断言 innerHTML 含 `<input type="checkbox"` 且 `checked` 属性存在
  3. 断言 "done task" 部分含 `line-through` 样式（`live-preview.ts:569-574`）
  4. 断言 textContent 含 "done task"
- **预期结果**:
  1. checkbox 已勾选
  2. innerHTML 含 `line-through`（勾选项文本删除线）
  3. textContent 含 "done task"
- **自动化信息**: 选择器: .cm-content input[type='checkbox']; 操作: isChecked(); 控件: editor; 等待: 300ms

---

### FP-13-03-E03 [P1] [正向] 大写 X 标记 - [X] text → 等同于勾选

- **优先级**: P1
- **类型**: 正向变体
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后输入 `- [X] uppercase done` 后按 Enter 两次
  2. 断言 checkbox `checked` 为 true（`CHECKBOX_RE` 匹配 `[xX]`，`live-preview.ts:538`）
  3. 断言文本含 `line-through` 样式
- **预期结果**:
  1. checkbox 已勾选
  2. innerHTML 含 `line-through`
- **自动化信息**: 选择器: .cm-content input[type='checkbox']; 操作: isChecked(); 控件: editor; 等待: 300ms

---

### FP-13-03-E04 [P1] [正向] 多个任务列表项混合勾选状态

- **优先级**: P1
- **类型**: 正向变体
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后插入多行: `- [ ] task one\n- [x] task two\n- [ ] task three`
  2. 按 Enter 后光标移出列表
  3. 断言 `input[type='checkbox']` count === 3
  4. 断言第 1 个 checkbox 未勾选，第 2 个已勾选，第 3 个未勾选
- **预期结果**:
  1. checkbox count === 3
  2. 第 2 个 checked === true，其余 false
- **自动化信息**: 选择器: .cm-content input[type='checkbox']; 操作: nth() + isChecked(); 控件: editor; 等待: 300ms

---

### FP-13-03-I01 [P1] [交互] 点击未勾选 checkbox → 切换为已勾选

- **优先级**: P1
- **类型**: 交互
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后输入 `- [ ] clickable` 后按 Enter 两次
  2. 断言初始 checkbox 未勾选
  3. 点击 checkbox（`.cm-content input[type='checkbox']`）
  4. 断言 checkbox 变为已勾选（`live-preview.ts:551-557` click 事件 dispatch 修改 ` ` → `x`）
  5. 断言文本 "clickable" 获得 `line-through` 样式
- **预期结果**:
  1. 点击后 checkbox checked === true
  2. innerHTML 含 `line-through`
- **自动化信息**: 选择器: .cm-content input[type='checkbox']; 操作: click() + isChecked(); 控件: editor; 等待: 500ms

---

### FP-13-03-N01 [P1] [边界] 无序列表项不含 checkbox 语法 → 不渲染复选框

- **优先级**: P1
- **类型**: 负向/边界
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后输入 `- plain list item` 后按 Enter 两次
  2. 断言 `input[type='checkbox']` count === 0（`CHECKBOX_RE` 不匹配）
  3. 断言 textContent 含 "plain list item"
- **预期结果**:
  1. checkbox count === 0
  2. textContent 含 "plain list item"
- **自动化信息**: 选择器: .cm-content input[type='checkbox']; 操作: count(); 控件: editor; 等待: 300ms

---

### FP-13-03-N02 [P2] [边界] checkbox 语法不在列表项中 → 不渲染

- **优先级**: P2
- **类型**: 负向/边界
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后输入 `plain text [ ] not a task` 后按 Enter 两次
  2. 断言 `input[type='checkbox']` count === 0（checkbox 仅在 list item 内渲染）
  3. 断言 textContent 含 "[ ] not a task"
- **预期结果**:
  1. checkbox count === 0
  2. textContent 含 "[ ] not a task"
- **自动化信息**: 选择器: .cm-content input[type='checkbox']; 操作: count(); 控件: editor; 等待: 300ms

---

### FP-13-03-N03 [P2] [边界] 空任务项 - [ ] （无内容）→ 仍渲染 checkbox

- **优先级**: P2
- **类型**: 边界
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后输入 `- [ ]` 后按 Enter 两次
  2. 断言 `input[type='checkbox']` count >= 1（空内容仍渲染 checkbox）
  3. 断言编辑器不崩溃
- **预期结果**:
  1. checkbox count >= 1
  2. 编辑器正常
- **自动化信息**: 选择器: .cm-content input[type='checkbox']; 操作: count(); 控件: editor; 等待: 300ms

---

## FP-13-04: autolink literals 自动链接

> remark-gfm 的 autolink literals 功能将文档中的裸 URL（如 `https://example.com`）解析为 mdast `link` 节点。Live Preview（`live-preview.ts:1019-1024`）的 `getInlineMarkerStyle("link", source)` 对裸 URL 走 GFM autolink literal 分支: `openLen: 0, closeLen: 0`（无标记需隐藏），直接应用 `color:var(--nexus-accent);text-decoration:underline;cursor:pointer` 样式并设 `data-link-url` 属性。渲染为 `<span>` widget（`Decoration.replace`，`live-preview.ts:1155-1169`）。

### FP-13-04-E01 [P0] [正向] 裸 URL https://example.com → 渲染为链接样式

- **优先级**: P0
- **类型**: 正向
- **前置条件**: demo 已启动，编辑器可见，livePreview 开启
- **测试步骤**:
  1. 清空编辑器后输入 `Visit https://example.com now` 后按 Enter 两次
  2. 断言 innerHTML 含 `data-link-url="https://example.com"` 属性
  3. 断言 innerHTML 含 `underline` 和 `nexus-accent` 样式（`live-preview.ts:1022`）
  4. 断言 textContent 含 "https://example.com"
- **预期结果**:
  1. innerHTML 含 `data-link-url="https://example.com"`
  2. innerHTML 含 `underline` 样式
  3. textContent 含完整 URL
- **自动化信息**: 选择器: .cm-content; 操作: innerHTML() + textContent(); 控件: editor; 等待: 300ms

---

### FP-13-04-E02 [P0] [正向] 裸 http URL → 渲染为链接

- **优先级**: P0
- **类型**: 正向变体
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后输入 `http://test.org is here` 后按 Enter 两次
  2. 断言 innerHTML 含 `data-link-url="http://test.org"`
  3. 断言 textContent 含 "http://test.org"
- **预期结果**:
  1. innerHTML 含 `data-link-url="http://test.org"`
  2. textContent 含 URL
- **自动化信息**: 选择器: .cm-content; 操作: innerHTML(); 控件: editor; 等待: 300ms

---

### FP-13-04-E03 [P1] [正向] 裸 URL 含路径和查询参数

- **优先级**: P1
- **类型**: 正向变体
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后输入 `See https://example.com/path?q=1&b=2 end` 后按 Enter 两次
  2. 断言 innerHTML 含 `data-link-url="https://example.com/path?q=1&b=2"` 或部分 URL
  3. 断言 textContent 含 URL
- **预期结果**:
  1. innerHTML 含 `data-link-url` 属性
  2. textContent 含 URL
- **自动化信息**: 选择器: .cm-content; 操作: innerHTML(); 控件: editor; 等待: 300ms

---

### FP-13-04-E04 [P1] [正向] www.example.com 形式 URL → 渲染为链接

- **优先级**: P1
- **类型**: 正向变体
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后输入 `Go to www.example.org page` 后按 Enter 两次
  2. 断言 innerHTML 含 `data-link-url` 属性（remark-gfm autolink literals 支持 `www.` 前缀）
  3. 断言 textContent 含 "www.example.org"
- **预期结果**:
  1. innerHTML 含 `data-link-url` 属性
  2. textContent 含 "www.example.org"
- **自动化信息**: 选择器: .cm-content; 操作: innerHTML(); 控件: editor; 等待: 300ms

---

### FP-13-04-E05 [P1] [正向] 行内裸 URL 前后有文本 → 仅 URL 部分为链接

- **优先级**: P1
- **类型**: 正向混合
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后输入 `prefix https://link.com suffix` 后按 Enter 两次
  2. 断言 innerHTML 中 `data-link-url` 属性的值为 "https://link.com"（不含 "prefix"/"suffix"）
  3. 断言 textContent 含 "prefix"、"https://link.com"、"suffix"
- **预期结果**:
  1. `data-link-url` 值为 "https://link.com"
  2. textContent 含前后文本和 URL
- **自动化信息**: 选择器: .cm-content [data-link-url]; 操作: getAttribute(); 控件: editor; 等待: 300ms

---

### FP-13-04-I01 [P1] [交互] 光标移入 autolink 区间 → 展开为源码

- **优先级**: P1
- **类型**: 交互
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后输入 `https://cursor.com` 后按 Enter 两次（折叠态）
  2. 断言 innerHTML 含 `data-link-url`（widget 渲染态）
  3. 按 ArrowUp 将光标移回 URL 所在行
  4. 断言 textContent 含 "https://cursor.com"（源码展开，光标在范围内时跳过 widget 渲染，`live-preview.ts:1154 cursorOnLink → continue`）
- **预期结果**:
  1. 折叠态 innerHTML 含 `data-link-url`
  2. 展开态 textContent 含完整 URL 文本
- **自动化信息**: 选择器: .cm-content; 操作: innerHTML() + textContent(); 控件: editor; 等待: 300ms

---

### FP-13-04-N01 [P1] [边界] 纯文本不含 URL → 不渲染链接

- **优先级**: P1
- **类型**: 负向/边界
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后输入 `just some text no url here` 后按 Enter 两次
  2. 断言 innerHTML 不含 `data-link-url` 属性
- **预期结果**:
  1. innerHTML 不含 `data-link-url`
- **自动化信息**: 选择器: .cm-content; 操作: innerHTML(); 控件: editor; 等待: 300ms

---

### FP-13-04-N02 [P2] [边界] 不完整协议 ftp:// → 不被 autolink literals 匹配

- **优先级**: P2
- **类型**: 边界
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后输入 `ftp://files.example.com` 后按 Enter 两次
  2. 断言 innerHTML 不含 `data-link-url="ftp://files.example.com"`（remark-gfm autolink literals 仅匹配 http/https/www）
  3. 断言 textContent 含 "ftp://files.example.com"（原文保留）
- **预期结果**:
  1. innerHTML 不含 `data-link-url` 对应 ftp URL
  2. textContent 含原文
- **自动化信息**: 选择器: .cm-content; 操作: innerHTML() + textContent(); 控件: editor; 等待: 300ms

---

## FP-13-05: footnotes GFM 风格脚注

> remark-gfm 将 GFM 风格脚注 `[^1]` 解析为 mdast `footnoteReference` 节点，`[^1]: note text` 解析为 `footnoteDefinition` 节点。Live Preview（`live-preview.ts:1180-1210`）对这两类节点分别渲染:
> - `footnoteReference`（`live-preview.ts:1180-1190`）：创建 `<sup>` 上标元素，内容为脚注标识符（如 "1"），样式 `color:var(--nexus-accent);cursor:pointer`，通过 `Decoration.replace` widget 替换 `[^1]` 源码。
> - `footnoteDefinition`（`live-preview.ts:1191-1210`）：创建 `<div>` 块级元素（muted 色 + 上边框），内含 `<sup>` 标记 + 定义文本，通过 `Decoration.replace` widget 替换 `[^1]: note` 源码。

### FP-13-05-E01 [P0] [正向] 脚注引用 [^1] → 渲染为 sup 上标

- **优先级**: P0
- **类型**: 正向
- **前置条件**: demo 已启动，编辑器可见，livePreview 开启
- **测试步骤**:
  1. 清空编辑器后输入 `Text with note[^1].` 后按 Enter 两次
  2. 断言 innerHTML 含 `<sup` 标签且 textContent 含 "1"（`live-preview.ts:1182-1184`）
  3. 断言 `<sup>` 含 `nexus-accent` 样式
  4. 断言 textContent 不含 `[^1]`（源码被 widget 替换隐藏）
- **预期结果**:
  1. innerHTML 含 `<sup`
  2. sup textContent 为 "1"
  3. textContent 不含 "[^1]"
- **自动化信息**: 选择器: .cm-content sup; 操作: textContent(); 控件: editor; 等待: 300ms

---

### FP-13-05-E02 [P0] [正向] 脚注定义 [^1]: note → 渲染为定义块

- **优先级**: P0
- **类型**: 正向
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后插入: `Text[^1].\n\n[^1]: This is the note`
  2. 按 Enter 将光标移出脚注定义行
  3. 断言 innerHTML 含 "This is the note"（定义文本渲染）
  4. 断言 innerHTML 含脚注定义相关样式（`nexus-text-muted` 或上边框 `border-top`，`live-preview.ts:1195`）
  5. 断言 innerHTML 含 `<sup` 标记（定义块内的标识符上标，`live-preview.ts:1197-1198`）
- **预期结果**:
  1. innerHTML 含 "This is the note"
  2. innerHTML 含 `nexus-text-muted` 或 `border-top`
  3. innerHTML 含 `<sup`
- **自动化信息**: 选择器: .cm-content; 操作: innerHTML(); 控件: editor; 等待: 300ms

---

### FP-13-05-E03 [P1] [正向] 多个脚注引用和定义

- **优先级**: P1
- **类型**: 正向变体
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后插入: `First[^a] and second[^b].\n\n[^a]: Note A\n[^b]: Note B`
  2. 光标移出
  3. 断言 `.cm-content sup` count >= 2（两个引用上标，可能含定义块内上标）
  4. 断言 innerHTML 含 "Note A" 和 "Note B"
- **预期结果**:
  1. sup count >= 2
  2. innerHTML 含 "Note A" 和 "Note B"
- **自动化信息**: 选择器: .cm-content sup; 操作: count(); 控件: editor; 等待: 300ms

---

### FP-13-05-E04 [P1] [正向] 脚注引用 sup 内容为标识符

- **优先级**: P1
- **类型**: 正向
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后输入 `Content[^mylabel] here.` 后按 Enter 两次
  2. 断言 `.cm-content sup` 的 textContent 含 "mylabel"（`ref.identifier` 作为 sup 内容，`live-preview.ts:1183`）
  3. 断言 textContent 不含 `[^mylabel]`
- **预期结果**:
  1. sup textContent 含 "mylabel"
  2. textContent 不含 "[^mylabel]"
- **自动化信息**: 选择器: .cm-content sup; 操作: textContent(); 控件: editor; 等待: 300ms

---

### FP-13-05-I01 [P1] [交互] 脚注引用渲染后源码 [^1] 被隐藏

- **优先级**: P1
- **类型**: 交互
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后输入 `Reference[^1] end.` 后按 Enter 两次
  2. 断言 textContent 含 "Reference"、"end." 但不含 `[^1]`
  3. 断言 innerHTML 含 `<sup` 标签（widget 替换了 `[^1]` 源码）
- **预期结果**:
  1. textContent 不含 "[^1]"
  2. innerHTML 含 `<sup`
- **自动化信息**: 选择器: .cm-content; 操作: textContent() + innerHTML(); 控件: editor; 等待: 300ms

---

### FP-13-05-N01 [P1] [边界] 无对应定义的孤立脚注引用 → 仍渲染 sup

- **优先级**: P1
- **类型**: 边界
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后输入 `Orphan[^x] reference.` 后按 Enter 两次（无 `[^x]:` 定义）
  2. 断言 innerHTML 含 `<sup` 标签（remark-gfm 仍将 `[^x]` 解析为 footnoteReference）
  3. 断言 sup textContent 含 "x"
  4. 断言无脚注定义块渲染
- **预期结果**:
  1. innerHTML 含 `<sup`
  2. sup textContent 含 "x"
- **自动化信息**: 选择器: .cm-content sup; 操作: textContent(); 控件: editor; 等待: 300ms

---

### FP-13-05-N02 [P2] [边界] 脚注定义为空内容 [^1]: → 渲染空定义块

- **优先级**: P2
- **类型**: 边界
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后插入: `Text[^1].\n\n[^1]:`
  2. 光标移出
  3. 断言 `.cm-content` 正常渲染不崩溃
  4. 断言 innerHTML 含 `<sup` 标签
- **预期结果**:
  1. 编辑器不崩溃
  2. innerHTML 含 `<sup`
- **自动化信息**: 选择器: .cm-content sup; 操作: count(); 控件: editor; 等待: 300ms

---

### FP-13-05-N03 [P2] [边界] 脚注定义中含 GFM 行内语法

- **优先级**: P2
- **类型**: 混合
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后插入: `Text[^1].\n\n[^1]: Note with ~~strike~~ and **bold**`
  2. 光标移出
  3. 断言 innerHTML 含 "Note with" 文本
  4. 断言编辑器不崩溃（脚注定义内含 GFM 行内语法正常处理）
- **预期结果**:
  1. innerHTML 含 "Note with"
  2. 编辑器正常
- **自动化信息**: 选择器: .cm-content; 操作: innerHTML(); 控件: editor; 等待: 300ms

---

## 用例合计

| 二级功能点 | 用例数 | P0 | P1 | P2 |
|-----------|-------|----|----|-----|
| FP-13-01 tables | 8 | 2 | 4 | 2 |
| FP-13-02 strikethrough | 8 | 2 | 4 | 2 |
| FP-13-03 task lists | 8 | 2 | 4 | 2 |
| FP-13-04 autolink literals | 8 | 2 | 5 | 1 |
| FP-13-05 footnotes | 8 | 2 | 4 | 2 |
| **合计** | **40** | **10** | **21** | **9** |

# CASE-工具栏插件-测试用例（FP-16）

> 一级功能点: 工具栏插件（demo-requirements.md §7）
> 全局批次序号: 16
> 生成时间: 2026-08-11
> 测试框架: Playwright（Electron demo e2e）
> 覆盖二级功能点: FP-16-01 ~ FP-16-10（共 10 个）
> 用例总数: 48
>
> 涉及二级功能点:
> - FP-16-01 8 条快捷键（Mod-b/i/Shift-s/e/k/1/2/3）
> - FP-16-02 14 条斜杠命令（h1-h3/bold/italic/strikethrough/inline-code/code-block/blockquote/ulist/olist/link/image/hr）
> - FP-16-03 8 组工具栏按钮 UI
> - FP-16-04 heading-menu 下拉（1-6 级 + Normal text）
> - FP-16-05 text-color 调色板（40 色）/ highlight 调色板（20 色）
> - FP-16-06 colorDecorationExtension（span/mark 标签隐藏+颜色装饰）
> - FP-16-07 行内格式化函数
> - FP-16-08 块级格式化函数
> - FP-16-09 颜色格式化函数
> - FP-16-10 UI 交互细节（tooltip/fullscreen 感知/焦点归还）
>
> ⚠️ 实现说明（依据 `packages/plugin-toolbar/src/index.ts` + `toolbar-ui.ts` + `formatting.ts` + `color-decoration.ts` + `apps/electron-demo/src/renderer/editor-shell.ts:335`）:
> - **Demo 中工具栏由 `editor-shell.ts:335` 的 `createToolbarUI(editor)` 创建**（无自定义 options，使用 defaultGroups），插入为 editor 容器第一个子元素。`createToolbarPlugin()` 在 `editor-shell.ts:139-146` 的 plugins 数组中注册，提供 8 条快捷键 + 14 条斜杠命令 + colorDecorationExtension。
> - **DOM 选择器**（依据 `toolbar-ui.ts:448-561`）:
>   - 工具栏容器: `.nexus-toolbar`（`toolbar-ui.ts:449`），role="toolbar"
>   - 工具栏按钮: `.nexus-toolbar-btn`（`toolbar-ui.ts:487`），有 `data-toolbar-action` 属性 = 按钮 id（`toolbar-ui.ts:488`），有 `data-toolbar-tooltip` 和 `aria-label` = title（`toolbar-ui.ts:489-490`），tabIndex=-1（`toolbar-ui.ts:492`）
>   - 分隔符: `.nexus-toolbar-separator`（`toolbar-ui.ts:480`）
>   - tooltip: `.nexus-toolbar-tooltip`（`toolbar-ui.ts:89`），role="tooltip"，data-state="open"/"closed"（`toolbar-ui.ts:98,103`）
>   - 下拉菜单/调色板: `.nexus-toolbar-dropdown`（`toolbar-ui.ts:262,376`），position:fixed
> - **按钮 id 列表**（依据 `toolbar-ui.ts:136-188` defaultGroups）: undo, redo, link, h2, h3, heading-menu, bold, italic, strikethrough, underline, inline-code, blockquote, code-block, ordered-list, unordered-list, text-color, highlight, image, fullscreen（共 19 个按钮，分 8 组）
> - **DROPDOWN_IDS**（依据 `toolbar-ui.ts:444`）: heading-menu, text-color, highlight —— 这三个按钮点击后展开下拉/调色板，不直接执行 action
> - **快捷键映射**（依据 `index.ts:222-231`）: Mod-b→toggleBold, Mod-i→toggleItalic, Mod-Shift-s→toggleStrikethrough, Mod-e→toggleInlineCode, Mod-k→insertLink, Mod-1→toggleHeading(1), Mod-2→toggleHeading(2), Mod-3→toggleHeading(3)
> - **格式化函数行为**:
>   - toggleBold/toggleItalic/toggleStrikethrough/toggleInlineCode: 基于 toggleWrap（`index.ts:17-44`），选区两侧加/移除标记（`**`/`*`/`~~`/`` ` ``），无选区时插入空标记对
>   - insertLink: 插入 `[selected||"link text"](url)`，选中 url 部分等待替换（`index.ts:62-78`）
>   - toggleHeading: 行首加/换/移除 `# `~`###### ` 前缀（`index.ts:80-107`）
>   - toggleBlockquote: 行首加/移除 `> `（`formatting.ts:78-80`）
>   - toggleOrderedList/toggleUnorderedList: 行首加 `1. `/`- ` 或移除（`formatting.ts:82-121`），支持多行
>   - insertCodeBlock: 插入 ``` fence，光标放语言行（`formatting.ts:123-145`）
>   - insertImage: 插入 `![alt](url)`，选中 url（`formatting.ts:147-163`）
>   - insertHorizontalRule: 插入 `---\n`（`formatting.ts:199-210`）
>   - applyTextColor: 选区包 `<span style="color:X">...</span>`（`formatting.ts:165-180`），空选区 return false
>   - applyHighlight: 选区包 `<mark style="background:X">...</mark>`（`formatting.ts:182-197`），空选区 return false
> - **颜色装饰**（依据 `color-decoration.ts`）:
>   - 正则匹配 `<span style="color:...">...</span>` 和 `<mark style="background:...">...</mark>`（`color-decoration.ts:21-24`）
>   - 光标在范围外: 开闭标签用 HiddenTagWidget（display:none）替换隐藏，内部文本应用颜色 style（`color-decoration.ts:107-119`）
>   - 光标在范围内: 跳过装饰，显示原始 HTML 文本便于编辑（`color-decoration.ts:104-105`）
>   - composition 期间仅 map 不重建（`color-decoration.ts:133-137`）
> - **调色板**（依据 `toolbar-ui.ts:340-356`）:
>   - COLOR_PALETTE: 40 色（4 行 × 10 列），cols=10
>   - HIGHLIGHT_PALETTE: 20 色（4 行 × 5 列），cols=5
>   - 每个色块为 `<button>`，title=color 值，style.background=color
> - **heading 下拉**（依据 `toolbar-ui.ts:256-338`）: 7 项（Heading 1-6 + Normal text），点击后 toggleHeading(level) 或移除 heading 前缀（Normal text）
> - **UI 交互细节**（依据 `toolbar-ui.ts:81-133` + `540-546`）:
>   - tooltip: mouseenter/focus 显示，mouseleave/blur/click/Escape 关闭，scroll/resize 跟随重新定位（`toolbar-ui.ts:113-120`）
>   - pickOverlayMount: 感知 fullscreenElement，全屏时挂载到全屏元素内（`toolbar-ui.ts:73-79`）
>   - 单击按钮后 editor.focus() 归还焦点（`toolbar-ui.ts:545`）
> - **已知陷阱**:
>   - macOS 环境 ControlOrMeta 映射为 Meta（Cmd）
>   - demo 未暴露 editor 实例到 window，所有验证走 `.cm-content` textContent/innerHTML + 工具栏 DOM 副作用
>   - 工具栏按钮 tabIndex=-1，不可 Tab 聚焦，只能鼠标点击或 JS focus
>   - toggleBold 无选区时在光标处插入 `****`（标记对），光标在中间
>   - applyTextColor/applyHighlight 空选区时 return false 不做任何修改
>   - insertLink 无选区时插入 `[link text](url)` 并选中 url 部分

---

## e2e 全局前置条件

- 依赖环境: Electron demo（Vite dev server localhost:5173 + 已构建的 `apps/electron-demo/dist-electron/main.js`）
- 初始文档: demo 启动后默认打开的 sample-vault 文档（或 index.md）
- 插件配置: demo 默认挂载 —— createGfmPreset + createHistoryPlugin + createToolbarPlugin + createSearchPlugin + createWikilinksPlugin + createWordCountPlugin
- 工具栏: `editor-shell.ts:335` 调用 `createToolbarUI(editor)` 创建（无自定义 options，使用 defaultGroups）
- 快捷键来源: `createToolbarPlugin()` 的 `shortcuts`（8 条）
- 斜杠命令来源: `createToolbarPlugin()` 的 `toolbarSlashCommands`（14 条）
- 颜色装饰: `createToolbarPlugin()` 的 `cmExtensions: [colorDecorationExtension()]`
- 角色权限: 无需登录（本地桌面应用）
- 未达成时的创建过程:
  1. 启动 Vite dev server（终端: `pnpm dev:renderer`; 等待: http://localhost:5173 可访问）
  2. 构建 Electron 主进程（终端: `pnpm build:electron-demo`; 产物: `apps/electron-demo/dist-electron/main.js`）
  3. 测试代码调用 `launchDemo()` 启动 Electron 实例（内部: `electron.launch({ args: [mainJs], env: { VITE_DEV_SERVER_URL: "http://localhost:5173" } })`，等待 `.cm-content` 可见）

setup 代码模板（所有用例通用，测试文件顶部）:
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

async function clearEditor(page: Page) {
  await page.click(".cm-content");
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
}

async function typeInEditor(page: Page, text: string) {
  await page.click(".cm-content");
  await page.keyboard.type(text);
}

async function getEditorText(page: Page): Promise<string> {
  return page.evaluate(() => document.querySelector('.cm-content')?.textContent ?? '');
}

async function getEditorHTML(page: Page): Promise<string> {
  return page.evaluate(() => document.querySelector('.cm-content')?.innerHTML ?? '');
}

// 点击工具栏按钮（按 data-toolbar-action）
async function clickToolbarButton(page: Page, action: string) {
  await page.click(`.nexus-toolbar-btn[data-toolbar-action="${action}"]`);
}

// 等待下拉菜单可见
async function waitForDropdown(page: Page, timeout = 1000) {
  await page.waitForSelector(".nexus-toolbar-dropdown", { timeout });
}

// 检查下拉菜单是否可见
async function isDropdownVisible(page: Page): Promise<boolean> {
  return page.evaluate(() => !!document.querySelector(".nexus-toolbar-dropdown"));
}

// 关闭所有下拉菜单（点击工具栏外部）
async function closeDropdowns(page: Page) {
  await page.click(".cm-content", { position: { x: 5, y: 5 } });
  await page.waitForTimeout(200);
}
```

---

## FP-16-01: 8 条快捷键（Mod-b/i/Shift-s/e/k/1/2/3）（5 例，[插件能力][编辑交互]）

> 间接验证路径: `createToolbarPlugin()`（`index.ts:219-235`）返回 `shortcuts` 数组（8 条），由 `editor.ts` 注册到 CM6 keymap。e2e 层通过"按下快捷键后编辑器出现对应 Markdown 语法"间接验证快捷键绑定。macOS 环境 ControlOrMeta 映射为 Meta（Cmd）。

### FP-16-01-N01 [P1] [正常] Mod-b 对选中文本加粗 → 出现 `**text**`

**前置条件**（⚠️ 4要素）:
- 依赖环境: Electron demo 已启动（Vite dev server + Electron main）
- 初始文档: 含文本 "hello"（全选后触发加粗）
- 插件配置: demo 默认（createToolbarPlugin 注册 Mod-b → toggleBold）
- 角色权限: 无需登录
- 未达成时的创建过程:
  1. `launchDemo()` 启动 Electron demo
  2. 清空编辑器并输入 "hello"

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page); typeInEditor(page, "hello") | [DOM] `.cm-content` textContent === "hello" | 选择器: .cm-content; 操作: clear+type(hello); 控件: editor; 等待: 200ms |
| 2 | page.keyboard.press("ControlOrMeta+a")（全选） | [DOM] 选区覆盖 "hello" | 选择器: .cm-content; 操作: press(SelectAll); 控件: keymap; 等待: 100ms |
| 3 | page.keyboard.press("ControlOrMeta+b") | [DOM] toggleBold 执行（`index.ts:46-48`），选区两侧加 `**`，文档变为 `**hello**` | 选择器: .cm-content; 操作: press(Mod+b); 控件: keymap; 等待: 200ms |
| 4 | getEditorText(page) | [DOM] textContent === "**hello**" | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] Mod-b 对选中文本生成 `**hello**`（toggleBold 快捷键绑定正确）

---

### FP-16-01-N02 [P1] [正常] Mod-i 对选中文本斜体 → 出现 `*text*`

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 含文本 "world"
- 插件配置: demo 默认（Mod-i → toggleItalic）
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. 清空编辑器并输入 "world"

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page); typeInEditor(page, "world") | [DOM] textContent === "world" | 选择器: .cm-content; 操作: clear+type(world); 控件: editor; 等待: 200ms |
| 2 | page.keyboard.press("ControlOrMeta+a") | [DOM] 全选 "world" | 选择器: .cm-content; 操作: press(SelectAll); 控件: keymap; 等待: 100ms |
| 3 | page.keyboard.press("ControlOrMeta+i") | [DOM] toggleItalic 执行（`index.ts:50-52`），文档变为 `*world*` | 选择器: .cm-content; 操作: press(Mod+i); 控件: keymap; 等待: 200ms |
| 4 | getEditorText(page) | [DOM] textContent === "*world*" | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] Mod-i 生成 `*world*`（toggleItalic 快捷键绑定正确）

---

### FP-16-01-N03 [P1] [正常] Mod-1 对当前行加 H1 前缀 → 行首出现 `# `

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 含文本 "title"
- 插件配置: demo 默认（Mod-1 → toggleHeading(editor,1)）
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. 清空编辑器并输入 "title"

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page); typeInEditor(page, "title") | [DOM] textContent === "title" | 选择器: .cm-content; 操作: clear+type(title); 控件: editor; 等待: 200ms |
| 2 | page.keyboard.press("ControlOrMeta+1") | [DOM] toggleHeading(editor,1) 执行（`index.ts:228`），行首加 "# "，文档变为 "# title" | 选择器: .cm-content; 操作: press(Mod+1); 控件: keymap; 等待: 200ms |
| 3 | getEditorText(page) | [DOM] textContent === "# title" | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] Mod-1 生成 "# title"（toggleHeading level=1 快捷键绑定正确）

---

### FP-16-01-N04 [P1] [正常] Mod-k 无选区 → 插入 `[link text](url)` 并选中 url

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 空文档
- 插件配置: demo 默认（Mod-k → insertLink）
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page) | [DOM] 编辑器清空 | 选择器: .cm-content; 操作: clear; 控件: editor; 等待: 200ms |
| 2 | page.keyboard.press("ControlOrMeta+k") | [DOM] insertLink 执行（`index.ts:62-78`），无选区时 linkText="link text"，插入 `[link text](url)`，选中 "url" 部分 | 选择器: .cm-content; 操作: press(Mod+k); 控件: keymap; 等待: 200ms |
| 3 | getEditorText(page) | [DOM] textContent === "[link text](url)" | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |
| 4 | page.keyboard.type("https://example.com")（替换选中的 "url"） | [DOM] "url" 被替换为实际链接 | 选择器: .cm-content; 操作: type(https://example.com); 控件: keymap; 等待: 300ms |
| 5 | getEditorText(page) | [DOM] textContent === "[link text](https://example.com)" | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] Mod-k 插入 `[link text](url)` 且 url 被选中（insertLink 快捷键绑定 + 选区定位正确）

---

### FP-16-01-N05 [P2] [正常] Mod-Shift-s 对选中文本删除线 → 出现 `~~text~~`

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 含文本 "strike"
- 插件配置: demo 默认（Mod-Shift-s → toggleStrikethrough）
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. 清空编辑器并输入 "strike"

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page); typeInEditor(page, "strike") | [DOM] textContent === "strike" | 选择器: .cm-content; 操作: clear+type(strike); 控件: editor; 等待: 200ms |
| 2 | page.keyboard.press("ControlOrMeta+a") | [DOM] 全选 | 选择器: .cm-content; 操作: press(SelectAll); 控件: keymap; 等待: 100ms |
| 3 | page.keyboard.press("ControlOrMeta+Shift+s") | [DOM] toggleStrikethrough 执行（`index.ts:54-56`），文档变为 `~~strike~~` | 选择器: .cm-content; 操作: press(Mod+Shift+s); 控件: keymap; 等待: 200ms |
| 4 | getEditorText(page) | [DOM] textContent === "~~strike~~" | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] Mod-Shift-s 生成 `~~strike~~`（toggleStrikethrough 快捷键绑定正确）

---

## FP-16-02: 14 条斜杠命令（h1-h3/bold/italic/strikethrough/inline-code/code-block/blockquote/ulist/olist/link/image/hr）（5 例，[插件能力][编辑交互]）

> 间接验证路径: `createToolbarPlugin()` 返回 `slashCommands: toolbarSlashCommands`（`index.ts:232`），共 14 条（`index.ts:118-217`）。斜杠菜单由 `editor-shell.ts:341` 的 `createSlashMenuUI(editor)` 驱动。e2e 层通过"输入 `/command` + Enter → 编辑器出现对应 Markdown"间接验证 slashCommand.run 执行。详细菜单交互测试见 CASE-斜杠命令插件（FP-15），此处仅验证工具栏插件提供的 14 条命令的 run 函数产出正确。

### FP-16-02-N01 [P1] [正常] `/bold` 斜杠命令 → 对当前行加 `****`（空选区 toggleWrap）

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 空文档
- 插件配置: demo 默认（toolbarSlashCommands 含 bold 命令，run: toggleBold）
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page) | [DOM] 编辑器清空 | 选择器: .cm-content; 操作: clear; 控件: editor; 等待: 200ms |
| 2 | typeInEditor(page, "/bold") | [DOM] 斜杠菜单出现，过滤到 Bold 项 | 选择器: .nexus-slash-menu; 操作: type(/bold); 控件: menu; 等待: 300ms |
| 3 | page.keyboard.press("Enter") | [DOM] 确认 Bold 命令，删除 `/bold` 后 toggleBold 在空选区执行（`index.ts:46-48`），插入 `****` | 选择器: .nexus-slash-menu; 操作: press(Enter); 控件: keymap; 等待: 300ms |
| 4 | getEditorText(page) | [DOM] textContent 含 "**\*\***"（即 `****`，空标记对） | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] `/bold` 命令执行后文档含 `****`（bold 斜杠命令的 run=toggleBold 正确绑定）

---

### FP-16-02-N02 [P1] [正常] `/code-block` 斜杠命令 → 插入 ``` fence 围栏

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 空文档
- 插件配置: demo 默认（code-block 命令，run: insertCodeBlock）
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page) | [DOM] 编辑器清空 | 选择器: .cm-content; 操作: clear; 控件: editor; 等待: 200ms |
| 2 | typeInEditor(page, "/code-block") | [DOM] 菜单出现过滤到 Code block 项 | 选择器: .nexus-slash-menu; 操作: type(/code-block); 控件: menu; 等待: 300ms |
| 3 | page.keyboard.press("Enter") | [DOM] 确认命令，insertCodeBlock 执行（`formatting.ts:123-145`），插入 ``` \n ``` 围栏 | 选择器: .nexus-slash-menu; 操作: press(Enter); 控件: keymap; 等待: 300ms |
| 4 | getEditorText(page) | [DOM] textContent 含 "```" （至少 2 处围栏标记） | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] `/code-block` 命令插入 ``` fence（code-block 斜杠命令 run=insertCodeBlock 正确）

---

### FP-16-02-N03 [P1] [正常] `/hr` 斜杠命令 → 插入 `---` 水平分割线

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 空文档
- 插件配置: demo 默认（hr 命令 title="Divider"，run: insertHorizontalRule）
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page) | [DOM] 编辑器清空 | 选择器: .cm-content; 操作: clear; 控件: editor; 等待: 200ms |
| 2 | typeInEditor(page, "/hr") | [DOM] 菜单出现过滤到 Divider 项（hr 的 title 为 "Divider"，keywords 含 "hr"） | 选择器: .nexus-slash-menu; 操作: type(/hr); 控件: menu; 等待: 300ms |
| 3 | page.keyboard.press("Enter") | [DOM] 确认命令，insertHorizontalRule 执行（`formatting.ts:199-210`），插入 "---\n" | 选择器: .nexus-slash-menu; 操作: press(Enter); 控件: keymap; 等待: 300ms |
| 4 | getEditorText(page) | [DOM] textContent 含 "---"（水平分割线标记） | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] `/hr` 命令插入 "---"（hr 斜杠命令 run=insertHorizontalRule 正确）

---

### FP-16-02-N04 [P1] [正常] `/blockquote` 斜杠命令 → 行首加 `> `

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 含文本 "quote me"
- 插件配置: demo 默认（blockquote 命令，run: toggleBlockquote）
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. 清空编辑器并输入 "quote me"

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page); typeInEditor(page, "quote me") | [DOM] textContent === "quote me" | 选择器: .cm-content; 操作: clear+type(quote me); 控件: editor; 等待: 200ms |
| 2 | typeInEditor(page, "/blockquote")（注意: 需先换行到新行再触发斜杠，或直接在行尾追加触发） | [DOM] 文档变为 "quote me/blockquote"，斜杠菜单可能出现（如行首为 q 则不触发，需要换行） | 选择器: .nexus-slash-menu; 操作: type(/blockquote); 控件: menu; 等待: 300ms |
| 3 | 替代方案: clearEditor; typeInEditor(page, "text"); press(Enter); typeInEditor(page, "/blockquote"); press(Enter) | [DOM] 新行行首触发斜杠，确认后 toggleBlockquote 在空行加 "> " | 选择器: .cm-content; 操作: clear+type+Enter+type(/blockquote)+Enter; 控件: editor+menu; 等待: 500ms |
| 4 | getEditorText(page) | [DOM] textContent 含 "> "（blockquote 前缀） | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] `/blockquote` 命令加 "> " 前缀（blockquote 斜杠命令 run=toggleBlockquote 正确）

---

### FP-16-02-N05 [P2] [正常] `/image` 斜杠命令 → 插入 `![alt text](url)` 并选中 url

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 空文档
- 插件配置: demo 默认（image 命令，run: insertImage）
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page) | [DOM] 编辑器清空 | 选择器: .cm-content; 操作: clear; 控件: editor; 等待: 200ms |
| 2 | typeInEditor(page, "/image"); page.keyboard.press("Enter") | [DOM] 确认 image 命令，insertImage 执行（`formatting.ts:147-163`），无选区时 alt="alt text"，插入 `![alt text](url)`，选中 "url" | 选择器: .nexus-slash-menu; 操作: type(/image)+Enter; 控件: menu; 等待: 400ms |
| 3 | getEditorText(page) | [DOM] textContent === "![alt text](url)" | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |
| 4 | page.keyboard.type("img.png")（替换选中的 url） | [DOM] url 被替换 | 选择器: .cm-content; 操作: type(img.png); 控件: keymap; 等待: 200ms |
| 5 | getEditorText(page) | [DOM] textContent === "![alt text](img.png)" | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] `/image` 命令插入 `![alt text](url)` 并选中 url 部分（image 斜杠命令 run=insertImage 正确）

---

## FP-16-03: 8 组工具栏按钮 UI（5 例，[插件能力][编辑交互]）

> 间接验证路径: `createToolbarUI(editor)`（`toolbar-ui.ts:446-571`）构建 `.nexus-toolbar` 容器，8 组按钮由 `defaultGroups()`（`toolbar-ui.ts:135-189`）定义。e2e 层通过"工具栏 DOM 结构 + 按钮点击触发格式化"间接验证 UI 渲染和 action 绑定。

### FP-16-03-N01 [P1] [正常] 工具栏容器 `.nexus-toolbar` 存在且有 role="toolbar"

**前置条件**（⚠️ 4要素）:
- 依赖环境: Electron demo 已启动
- 初始文档: 任意（demo 默认文档）
- 插件配置: demo 默认（createToolbarUI 挂载）
- 角色权限: 无需登录
- 未达成时的创建过程:
  1. `launchDemo()` 启动

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | page.waitForSelector(".nexus-toolbar") | [DOM] `.nexus-toolbar` 元素存在且可见 | 选择器: .nexus-toolbar; 操作: waitFor; 控件: toolbar; 等待: 2000ms |
| 2 | page.getAttribute(".nexus-toolbar", "role") | [DOM] role === "toolbar"（`toolbar-ui.ts:450`） | 选择器: .nexus-toolbar; 操作: getAttribute(role); 控件: toolbar; 等待: 无 |

**断言汇总**:
- [DOM] 工具栏容器存在且有正确的 ARIA role（createToolbarUI 基础结构渲染）

---

### FP-16-03-N02 [P1] [正常] 工具栏含 19 个按钮（8 组 defaultGroups 的全部按钮）

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 任意
- 插件配置: demo 默认
- 未达成时的创建过程:
  1. `launchDemo()` 启动

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | page.locator(".nexus-toolbar-btn").count() | [DOM] 按钮数量 === 19（undo/redo/link/h2/h3/heading-menu/bold/italic/strikethrough/underline/inline-code/blockquote/code-block/ordered-list/unordered-list/text-color/highlight/image/fullscreen） | 选择器: .nexus-toolbar-btn; 操作: count(); 控件: toolbar-btn; 等待: 无 |
| 2 | page.locator(".nexus-toolbar-separator").count() | [DOM] 分隔符数量 === 7（8 组之间 7 个分隔符，`toolbar-ui.ts:478-483`） | 选择器: .nexus-toolbar-separator; 操作: count(); 控件: toolbar-sep; 等待: 无 |

**断言汇总**:
- [DOM] 工具栏渲染 19 个按钮 + 7 个分隔符（defaultGroups 8 组完整渲染）

---

### FP-16-03-N03 [P1] [正常] Bold 按钮点击 → 选中文本加 `**` 包裹

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 含文本 "bold test"，选中 "bold"
- 插件配置: demo 默认（bold 按钮 action: toggleBold）
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. 清空编辑器并输入 "bold test"

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page); typeInEditor(page, "bold test") | [DOM] textContent === "bold test" | 选择器: .cm-content; 操作: clear+type(bold test); 控件: editor; 等待: 200ms |
| 2 | 选中 "bold" 部分: page.keyboard.press("Home"); 连续 4 次 ArrowRight + Shift | [DOM] 选区覆盖 "bold"（前 4 个字符） | 选择器: .cm-content; 操作: press(Home)+Shift+ArrowRight*4; 控件: keymap; 等待: 300ms |
| 3 | clickToolbarButton(page, "bold") | [DOM] bold 按钮 click → toggleBold 执行（`toolbar-ui.ts:540-546`），选中文本加 `**` | 选择器: .nexus-toolbar-btn[data-toolbar-action="bold"]; 操作: click(); 控件: toolbar-btn; 等待: 200ms |
| 4 | getEditorText(page) | [DOM] textContent === "**bold** test" | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 点击 Bold 按钮对选中文本加粗（toolbar button action 绑定正确）

---

### FP-16-03-N04 [P1] [正常] H2 按钮点击 → 当前行加 `## ` 前缀

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 含文本 "section"
- 插件配置: demo 默认（h2 按钮 action: toggleHeading(e,2)）
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. 清空编辑器并输入 "section"

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page); typeInEditor(page, "section") | [DOM] textContent === "section" | 选择器: .cm-content; 操作: clear+type(section); 控件: editor; 等待: 200ms |
| 2 | clickToolbarButton(page, "h2") | [DOM] h2 按钮 click → toggleHeading(editor,2)（`toolbar-ui.ts:150`），行首加 "## " | 选择器: .nexus-toolbar-btn[data-toolbar-action="h2"]; 操作: click(); 控件: toolbar-btn; 等待: 200ms |
| 3 | getEditorText(page) | [DOM] textContent === "## section" | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 点击 H2 按钮加 "## " 前缀（h2 按钮 action 绑定正确）

---

### FP-16-03-N05 [P2] [正常] Undo/Redo 按钮点击 → 撤销/重做编辑操作

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 空文档
- 插件配置: demo 默认（undo 按钮 action: e.undo()，redo 按钮 action: e.redo()）
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page); typeInEditor(page, "abc") | [DOM] textContent === "abc" | 选择器: .cm-content; 操作: clear+type(abc); 控件: editor; 等待: 200ms |
| 2 | clickToolbarButton(page, "undo") | [DOM] undo 按钮 click → editor.undo()（`toolbar-ui.ts:139`），"abc" 被撤销 | 选择器: .nexus-toolbar-btn[data-toolbar-action="undo"]; 操作: click(); 控件: toolbar-btn; 等待: 200ms |
| 3 | getEditorText(page) | [DOM] textContent === ""（撤销后为空）或 textContent 不含 "abc" | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |
| 4 | clickToolbarButton(page, "redo") | [DOM] redo 按钮 click → editor.redo()（`toolbar-ui.ts:140`），"abc" 恢复 | 选择器: .nexus-toolbar-btn[data-toolbar-action="redo"]; 操作: click(); 控件: toolbar-btn; 等待: 200ms |
| 5 | getEditorText(page) | [DOM] textContent === "abc"（重做恢复） | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] Undo 撤销输入 + Redo 恢复输入（undo/redo 按钮 action 绑定正确）

---

## FP-16-04: heading-menu 下拉（1-6 级 + Normal text）（5 例，[编辑交互]）

> 间接验证路径: heading-menu 按钮 id ∈ DROPDOWN_IDS（`toolbar-ui.ts:444`），点击后展开 `showHeadingDropdown()`（`toolbar-ui.ts:256-338`），渲染 7 项（Heading 1-6 + Normal text）。点击某项后调用 toggleHeading(editor,level) 或移除 heading 前缀（Normal text），然后 editor.focus() + closeDropdown()。

### FP-16-04-N01 [P1] [正常] 点击 heading-menu 按钮 → 出现含 7 项的下拉菜单

**前置条件**（⚠️ 4要素）:
- 依赖环境: Electron demo 已启动
- 初始文档: 任意
- 插件配置: demo 默认（heading-menu ∈ DROPDOWN_IDS）
- 角色权限: 无需登录
- 未达成时的创建过程:
  1. `launchDemo()` 启动

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clickToolbarButton(page, "heading-menu") | [DOM] heading-menu 按钮 click，`showHeadingDropdown()` 执行（`toolbar-ui.ts:507-508`），`.nexus-toolbar-dropdown` 出现 | 选择器: .nexus-toolbar-btn[data-toolbar-action="heading-menu"]; 操作: click(); 控件: toolbar-btn; 等待: 300ms |
| 2 | waitForDropdown(page); page.locator(".nexus-toolbar-dropdown button").count() | [DOM] 下拉菜单含 7 个按钮项（Heading 1-6 + Normal text，`toolbar-ui.ts:270-278`） | 选择器: .nexus-toolbar-dropdown button; 操作: count(); 控件: dropdown; 等待: 无 |
| 3 | page.locator(".nexus-toolbar-dropdown button").first().textContent() | [DOM] 第一项 textContent === "Heading 1" | 选择器: .nexus-toolbar-dropdown button:first-child; 操作: textContent(); 控件: dropdown-item; 等待: 无 |
| 4 | page.locator(".nexus-toolbar-dropdown button").last().textContent() | [DOM] 最后一项 textContent === "Normal text" | 选择器: .nexus-toolbar-dropdown button:last-child; 操作: textContent(); 控件: dropdown-item; 等待: 无 |
| 5 | closeDropdowns(page) | [DOM] 下拉关闭 | 选择器: .cm-content; 操作: click; 控件: editor; 等待: 200ms |

**断言汇总**:
- [DOM] heading-menu 下拉含 7 项（Heading 1-6 + Normal text，showHeadingDropdown 渲染正确）

---

### FP-16-04-N02 [P1] [正常] 下拉点击 "Heading 1" → 当前行加 `# ` 前缀

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 含文本 "my title"
- 插件配置: demo 默认
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. 清空编辑器并输入 "my title"

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page); typeInEditor(page, "my title") | [DOM] textContent === "my title" | 选择器: .cm-content; 操作: clear+type(my title); 控件: editor; 等待: 200ms |
| 2 | clickToolbarButton(page, "heading-menu") | [DOM] 下拉出现 | 选择器: .nexus-toolbar-btn[data-toolbar-action="heading-menu"]; 操作: click(); 控件: toolbar-btn; 等待: 300ms |
| 3 | waitForDropdown(page); page.click(".nexus-toolbar-dropdown button:first-child")（Heading 1） | [DOM] 点击 Heading 1 → toggleHeading(editor,1)（`toolbar-ui.ts:293-294`），行首加 "# "，然后 closeDropdown | 选择器: .nexus-toolbar-dropdown button:first-child; 操作: click(); 控件: dropdown-item; 等待: 300ms |
| 4 | getEditorText(page) | [DOM] textContent === "# my title" | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |
| 5 | isDropdownVisible(page) | [DOM] 下拉已关闭（false） | 选择器: .nexus-toolbar-dropdown; 操作: evaluate; 控件: dropdown; 等待: 无 |

**断言汇总**:
- [DOM] Heading 1 下拉项触发 toggleHeading(level=1)（showHeadingDropdown 的 handleClick 绑定正确）

---

### FP-16-04-N03 [P1] [正常] 下拉点击 "Heading 4" → 当前行加 `#### ` 前缀

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 含文本 "deep"
- 插件配置: demo 默认
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. 清空编辑器并输入 "deep"

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page); typeInEditor(page, "deep") | [DOM] textContent === "deep" | 选择器: .cm-content; 操作: clear+type(deep); 控件: editor; 等待: 200ms |
| 2 | clickToolbarButton(page, "heading-menu"); waitForDropdown(page) | [DOM] 下拉出现 | 选择器: .nexus-toolbar-btn[data-toolbar-action="heading-menu"]; 操作: click(); 控件: toolbar-btn; 等待: 300ms |
| 3 | page.click(".nexus-toolbar-dropdown button:nth-child(4)")（Heading 4，第 4 项） | [DOM] 点击 Heading 4 → toggleHeading(editor,4)（`toolbar-ui.ts:293-294`），行首加 "#### " | 选择器: .nexus-toolbar-dropdown button:nth-child(4); 操作: click(); 控件: dropdown-item; 等待: 300ms |
| 4 | getEditorText(page) | [DOM] textContent === "#### deep" | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] Heading 4 下拉项触发 toggleHeading(level=4)（level 参数正确传递）

---

### FP-16-04-N04 [P1] [正常] 下拉点击 "Normal text" → 移除已有 heading 前缀

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 含文本 "### old heading"（已有 H3 前缀）
- 插件配置: demo 默认
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. 清空编辑器并输入 "### old heading"

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page); typeInEditor(page, "### old heading") | [DOM] textContent === "### old heading" | 选择器: .cm-content; 操作: clear+type(### old heading); 控件: editor; 等待: 200ms |
| 2 | clickToolbarButton(page, "heading-menu"); waitForDropdown(page) | [DOM] 下拉出现 | 选择器: .nexus-toolbar-btn[data-toolbar-action="heading-menu"]; 操作: click(); 控件: toolbar-btn; 等待: 300ms |
| 3 | page.click(".nexus-toolbar-dropdown button:last-child")（Normal text，第 7 项） | [DOM] 点击 Normal text → level=0 分支（`toolbar-ui.ts:295-309`），匹配 `^#{1,6}\s` 移除前缀，文档变为 "old heading" | 选择器: .nexus-toolbar-dropdown button:last-child; 操作: click(); 控件: dropdown-item; 等待: 300ms |
| 4 | getEditorText(page) | [DOM] textContent === "old heading"（"### " 前缀已移除） | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] Normal text 下拉项移除 heading 前缀（showHeadingDropdown level=0 分支的正则移除逻辑）

---

### FP-16-04-N05 [P2] [正常] 再次点击 heading-menu 按钮 → 切换关闭已打开的下拉（toggle 行为）

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 任意
- 插件配置: demo 默认
- 未达成时的创建过程:
  1. `launchDemo()` 启动

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clickToolbarButton(page, "heading-menu") | [DOM] 下拉出现（activeDropdown 非 null） | 选择器: .nexus-toolbar-btn[data-toolbar-action="heading-menu"]; 操作: click(); 控件: toolbar-btn; 等待: 300ms |
| 2 | waitForDropdown(page); isDropdownVisible(page) | [DOM] 返回 true（下拉可见） | 选择器: .nexus-toolbar-dropdown; 操作: evaluate; 控件: dropdown; 等待: 无 |
| 3 | clickToolbarButton(page, "heading-menu")（再次点击同一按钮） | [DOM] handleClick 检测 activeDropdown 已存在 → closeDropdown()（`toolbar-ui.ts:505`），下拉关闭 | 选择器: .nexus-toolbar-btn[data-toolbar-action="heading-menu"]; 操作: click(); 控件: toolbar-btn; 等待: 300ms |
| 4 | isDropdownVisible(page) | [DOM] 返回 false（下拉已关闭） | 选择器: .nexus-toolbar-dropdown; 操作: evaluate; 控件: dropdown; 等待: 无 |

**断言汇总**:
- [DOM] 再次点击 heading-menu 切换关闭下拉（toggle 行为，`toolbar-ui.ts:505` 的 activeDropdown 守卫）

---

## FP-16-05: text-color 调色板（40 色）/ highlight 调色板（20 色）（5 例，[编辑交互]）

> 间接验证路径: text-color 和 highlight 按钮 ∈ DROPDOWN_IDS（`toolbar-ui.ts:444`），点击后展开 `showColorPicker()`（`toolbar-ui.ts:368-441`）。COLOR_PALETTE 40 色（`toolbar-ui.ts:340-349`），HIGHLIGHT_PALETTE 20 色（`toolbar-ui.ts:351-356`）。每个色块为 `<button>` title=color，点击后 apply(editor,color)。

### FP-16-05-N01 [P1] [正常] 点击 text-color 按钮 → 出现含 40 色块的调色板

**前置条件**（⚠️ 4要素）:
- 依赖环境: Electron demo 已启动
- 初始文档: 任意
- 插件配置: demo 默认（text-color ∈ DROPDOWN_IDS，COLOR_PALETTE 40 色）
- 角色权限: 无需登录
- 未达成时的创建过程:
  1. `launchDemo()` 启动

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clickToolbarButton(page, "text-color") | [DOM] text-color 按钮 click → showColorPicker(editor, button, COLOR_PALETTE, applyTextColor, closeDropdown)（`toolbar-ui.ts:510`），`.nexus-toolbar-dropdown` 出现 | 选择器: .nexus-toolbar-btn[data-toolbar-action="text-color"]; 操作: click(); 控件: toolbar-btn; 等待: 300ms |
| 2 | waitForDropdown(page); page.locator(".nexus-toolbar-dropdown button").count() | [DOM] 调色板含 40 个色块按钮（COLOR_PALETTE.length=40，`toolbar-ui.ts:340-349`） | 选择器: .nexus-toolbar-dropdown button; 操作: count(); 控件: dropdown; 等待: 无 |
| 3 | page.locator(".nexus-toolbar-dropdown button").first().getAttribute("title") | [DOM] 第一个色块 title === "#000000"（COLOR_PALETTE[0]） | 选择器: .nexus-toolbar-dropdown button:first-child; 操作: getAttribute(title); 控件: dropdown-item; 等待: 无 |
| 4 | closeDropdowns(page) | [DOM] 调色板关闭 | 选择器: .cm-content; 操作: click; 控件: editor; 等待: 200ms |

**断言汇总**:
- [DOM] text-color 调色板含 40 个色块（COLOR_PALETTE 完整渲染，showColorPicker 工作）

---

### FP-16-05-N02 [P1] [正常] 点击 highlight 按钮 → 出现含 20 色块的调色板

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 任意
- 插件配置: demo 默认（highlight ∈ DROPDOWN_IDS，HIGHLIGHT_PALETTE 20 色）
- 未达成时的创建过程:
  1. `launchDemo()` 启动

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clickToolbarButton(page, "highlight") | [DOM] highlight 按钮 click → showColorPicker(editor, button, HIGHLIGHT_PALETTE, applyHighlight, closeDropdown)（`toolbar-ui.ts:512`），调色板出现 | 选择器: .nexus-toolbar-btn[data-toolbar-action="highlight"]; 操作: click(); 控件: toolbar-btn; 等待: 300ms |
| 2 | waitForDropdown(page); page.locator(".nexus-toolbar-dropdown button").count() | [DOM] 调色板含 20 个色块按钮（HIGHLIGHT_PALETTE.length=20，`toolbar-ui.ts:351-356`） | 选择器: .nexus-toolbar-dropdown button; 操作: count(); 控件: dropdown; 等待: 无 |
| 3 | page.locator(".nexus-toolbar-dropdown button").first().getAttribute("title") | [DOM] 第一个色块 title === "#ffff00"（HIGHLIGHT_PALETTE[0]） | 选择器: .nexus-toolbar-dropdown button:first-child; 操作: getAttribute(title); 控件: dropdown-item; 等待: 无 |
| 4 | closeDropdowns(page) | [DOM] 调色板关闭 | 选择器: .cm-content; 操作: click; 控件: editor; 等待: 200ms |

**断言汇总**:
- [DOM] highlight 调色板含 20 个色块（HIGHLIGHT_PALETTE 完整渲染）

---

### FP-16-05-N03 [P1] [正常] text-color 调色板点击红色 → 选中文本包 `<span style="color:#ff0000">`

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 含文本 "colored"，选中全部
- 插件配置: demo 默认
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. 清空编辑器并输入 "colored"

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page); typeInEditor(page, "colored"); page.keyboard.press("ControlOrMeta+a") | [DOM] textContent === "colored"，全选 | 选择器: .cm-content; 操作: clear+type(colored)+SelectAll; 控件: editor; 等待: 300ms |
| 2 | clickToolbarButton(page, "text-color"); waitForDropdown(page) | [DOM] 调色板出现 | 选择器: .nexus-toolbar-btn[data-toolbar-action="text-color"]; 操作: click(); 控件: toolbar-btn; 等待: 300ms |
| 3 | page.click('.nexus-toolbar-dropdown button[title="#ff0000"]')（红色色块，COLOR_PALETTE[10]） | [DOM] 点击红色 → applyTextColor(editor, "#ff0000")（`toolbar-ui.ts:405-406`），选区包 `<span style="color:#ff0000">colored</span>` | 选择器: .nexus-toolbar-dropdown button[title="#ff0000"]; 操作: click(); 控件: dropdown-item; 等待: 300ms |
| 4 | getEditorText(page) | [DOM] textContent 含 "<span style=\"color:#ff0000\">colored</span>" | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 红色色块点击后选中文本包 span color 标签（applyTextColor 通过调色板正确调用）

---

### FP-16-05-N04 [P1] [正常] highlight 调色板点击黄色 → 选中文本包 `<mark style="background:#ffff00">`

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 含文本 "marked"，选中全部
- 插件配置: demo 默认
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. 清空编辑器并输入 "marked"

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page); typeInEditor(page, "marked"); page.keyboard.press("ControlOrMeta+a") | [DOM] textContent === "marked"，全选 | 选择器: .cm-content; 操作: clear+type(marked)+SelectAll; 控件: editor; 等待: 300ms |
| 2 | clickToolbarButton(page, "highlight"); waitForDropdown(page) | [DOM] 调色板出现 | 选择器: .nexus-toolbar-btn[data-toolbar-action="highlight"]; 操作: click(); 控件: toolbar-btn; 等待: 300ms |
| 3 | page.click('.nexus-toolbar-dropdown button[title="#ffff00"]')（黄色色块，HIGHLIGHT_PALETTE[0]） | [DOM] 点击黄色 → applyHighlight(editor, "#ffff00")（`toolbar-ui.ts:405-406`），选区包 `<mark style="background:#ffff00">marked</mark>` | 选择器: .nexus-toolbar-dropdown button[title="#ffff00"]; 操作: click(); 控件: dropdown-item; 等待: 300ms |
| 4 | getEditorText(page) | [DOM] textContent 含 "<mark style=\"background:#ffff00\">marked</mark>" | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 黄色色块点击后选中文本包 mark background 标签（applyHighlight 通过调色板正确调用）

---

### FP-16-05-N05 [P2] [正常] 调色板色块 hover → 缩放放大+蓝色外框（视觉反馈）

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 任意
- 插件配置: demo 默认
- 未达成时的创建过程:
  1. `launchDemo()` 启动

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clickToolbarButton(page, "text-color"); waitForDropdown(page) | [DOM] 调色板出现 | 选择器: .nexus-toolbar-btn[data-toolbar-action="text-color"]; 操作: click(); 控件: toolbar-btn; 等待: 300ms |
| 2 | page.hover(".nexus-toolbar-dropdown button:first-child")（hover 第一个色块） | [DOM] mouseenter 触发 handleEnter（`toolbar-ui.ts:410-413`），transform=scale(1.2)，boxShadow 蓝色外框 | 选择器: .nexus-toolbar-dropdown button:first-child; 操作: hover(); 控件: dropdown-item; 等待: 200ms |
| 3 | page.evaluate(() => { const el = document.querySelector(".nexus-toolbar-dropdown button:first-child") as HTMLElement; return el.style.transform; }) | [DOM] transform === "scale(1.2)" | 选择器: .nexus-toolbar-dropdown button:first-child; 操作: evaluate(style.transform); 控件: dropdown-item; 等待: 无 |
| 4 | closeDropdowns(page) | [DOM] 调色板关闭 | 选择器: .cm-content; 操作: click; 控件: editor; 等待: 200ms |

**断言汇总**:
- [DOM] 色块 hover 后 scale(1.2) + 蓝色外框（showColorPicker 的 handleEnter 视觉反馈）

---

## FP-16-06: colorDecorationExtension（span/mark 标签隐藏+颜色装饰）（5 例，[插件能力][Live Preview]）

> 间接验证路径: `colorDecorationExtension()`（`color-decoration.ts:147-149`）返回 CM6 ViewPlugin。通过 `createToolbarPlugin()` 的 `cmExtensions` 注册（`index.ts:233`）。装饰逻辑: 光标在颜色范围外 → 开闭标签 HiddenTagWidget 隐藏 + 内部文本 style 着色（`color-decoration.ts:107-119`）；光标在范围内 → 跳过装饰显示原始 HTML（`color-decoration.ts:104-105`）。e2e 层通过 `.cm-content` innerHTML 验证装饰效果。

### FP-16-06-N01 [P1] [正常] 输入 `<span style="color:red">text</span>` 光标在外 → 标签隐藏+文本红色

**前置条件**（⚠️ 4要素）:
- 依赖环境: Electron demo 已启动
- 初始文档: 空文档
- 插件配置: demo 默认（colorDecorationExtension 已注册）
- 角色权限: 无需登录
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page); typeInEditor(page, '<span style="color:red">text</span>') | [DOM] 文档含 span color 标签，光标在行尾（标签范围外） | 选择器: .cm-content; 操作: clear+type(span tag); 控件: editor; 等待: 300ms |
| 2 | page.keyboard.press("Home")（光标移到行首，确保在标签范围外） | [DOM] 光标在文档开头，cursorPos=0 < range.from | 选择器: .cm-content; 操作: press(Home); 控件: keymap; 等待: 200ms |
| 3 | getEditorHTML(page) | [DOM] innerHTML 含 `color:red` 的 style 装饰（Decoration.mark，`color-decoration.ts:111-114`），开闭标签被 HiddenTagWidget 替换（display:none 的 span） | 选择器: .cm-content; 操作: innerHTML(); 控件: editor; 等待: 无 |
| 4 | page.evaluate(() => { const content = document.querySelector('.cm-content'); return content?.querySelector('[style*="color:red"]') !== null; }) | [DOM] 存在 style 含 "color:red" 的元素（颜色装饰生效） | 选择器: .cm-content; 操作: evaluate; 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 光标在外时 span 标签隐藏 + 内部文本应用红色 style（colorDecorationExtension 的装饰路径）

---

### FP-16-06-N02 [P1] [正常] 输入 `<mark style="background:yellow">text</mark>` 光标在外 → 标签隐藏+背景黄色

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 空文档
- 插件配置: demo 默认
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page); typeInEditor(page, '<mark style="background:yellow">text</mark>') | [DOM] 文档含 mark background 标签 | 选择器: .cm-content; 操作: clear+type(mark tag); 控件: editor; 等待: 300ms |
| 2 | page.keyboard.press("Home") | [DOM] 光标移到行首（范围外） | 选择器: .cm-content; 操作: press(Home); 控件: keymap; 等待: 200ms |
| 3 | page.evaluate(() => { const content = document.querySelector('.cm-content'); return content?.querySelector('[style*="background:yellow"]') !== null; }) | [DOM] 存在 style 含 "background:yellow" 的元素（Decoration.mark for background kind，`color-decoration.ts:113-114`） | 选择器: .cm-content; 操作: evaluate; 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] mark 标签隐藏 + 内部文本应用黄色背景（colorDecorationExtension 的 background 装饰路径）

---

### FP-16-06-N03 [P1] [正常] 光标移入 span 范围内 → 显示原始 HTML 标签（装饰跳过）

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 含 `<span style="color:red">text</span>`
- 插件配置: demo 默认
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. 清空编辑器并输入 span 标签

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page); typeInEditor(page, '<span style="color:red">text</span>'); page.keyboard.press("Home") | [DOM] 光标在行首，装饰生效 | 选择器: .cm-content; 操作: clear+type+Home; 控件: editor; 等待: 300ms |
| 2 | 连续按 ArrowRight 将光标移到标签内部（如 `<` 和 `s` 之间，约 5 次右移进入 span 范围） | [DOM] 光标进入 range.from ~ range.to 范围，cursorPos >= r.from && cursorPos <= r.to（`color-decoration.ts:105`），装饰跳过 | 选择器: .cm-content; 操作: press(ArrowRight)*5; 控件: keymap; 等待: 300ms |
| 3 | getEditorText(page) | [DOM] textContent 含原始 "<span style=\"color:red\">text</span>"（标签可见，未被隐藏） | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 光标在范围内时原始 HTML 标签可见（colorDecorationExtension 的 cursor-in-range 跳过逻辑）

---

### FP-16-06-N04 [P2] [正常] 多个颜色标签共存 → 各自独立装饰

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 空文档
- 插件配置: demo 默认
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page); typeInEditor(page, '<span style="color:red">A</span><span style="color:blue">B</span>') | [DOM] 文档含两个不同颜色的 span 标签 | 选择器: .cm-content; 操作: clear+type(2 spans); 控件: editor; 等待: 300ms |
| 2 | page.keyboard.press("Home") | [DOM] 光标在行首（两个标签范围外） | 选择器: .cm-content; 操作: press(Home); 控件: keymap; 等待: 200ms |
| 3 | page.evaluate(() => { const content = document.querySelector('.cm-content'); const redEls = content?.querySelectorAll('[style*="color:red"]'); const blueEls = content?.querySelectorAll('[style*="color:blue"]'); return { red: redEls?.length ?? 0, blue: blueEls?.length ?? 0 }; }) | [DOM] red >= 1 且 blue >= 1（两个颜色装饰各自独立应用，`color-decoration.ts:53-90` findColorRanges 返回多个 range） | 选择器: .cm-content; 操作: evaluate; 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 两个不同颜色 span 各自独立装饰（findColorRanges 多匹配 + buildDecorations 多范围处理）

---

### FP-16-06-E01 [P3] [异常] 格式错误的 span 标签（无闭合）→ 不触发装饰（正则不匹配）

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 空文档
- 插件配置: demo 默认
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page); typeInEditor(page, '<span style="color:red">unclosed') | [DOM] 文档含未闭合的 span 标签 | 选择器: .cm-content; 操作: clear+type(unclosed span); 控件: editor; 等待: 300ms |
| 2 | page.keyboard.press("Home") | [DOM] 光标移到行首 | 选择器: .cm-content; 操作: press(Home); 控件: keymap; 等待: 200ms |
| 3 | page.evaluate(() => { const content = document.querySelector('.cm-content'); return content?.querySelector('[style*="color:red"]') !== null; }) | [DOM] 返回 false（COLOR_RE 要求完整 `</span>` 闭合，`color-decoration.ts:21-22`，未闭合不匹配 → 无装饰） | 选择器: .cm-content; 操作: evaluate; 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 未闭合 span 不触发颜色装饰（COLOR_RE 正则要求完整开闭标签对）

---

## FP-16-07: 行内格式化函数（5 例，[编辑交互]）

> 间接验证路径: 行内格式化函数（toggleBold/toggleItalic/toggleStrikethrough/toggleInlineCode/insertLink/toggleWrap）定义在 `index.ts:17-78`。通过工具栏按钮点击或快捷键触发。e2e 层通过"触发后编辑器文档变化"间接验证函数逻辑。toggleWrap 是通用包裹函数，`**`/`*`/`~~`/`` ` `` 均基于它。

### FP-16-07-N01 [P1] [正常] toggleBold 选中 "abc" → `**abc**`，再次执行 → 移除标记恢复 "abc"

**前置条件**（⚠️ 4要素）:
- 依赖环境: Electron demo 已启动
- 初始文档: 含 `**abc**`（已加粗文本）
- 插件配置: demo 默认
- 角色权限: 无需登录
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. 清空编辑器并输入 `**abc**`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page); typeInEditor(page, "**abc**") | [DOM] textContent === "**abc**" | 选择器: .cm-content; 操作: clear+type(**abc**); 控件: editor; 等待: 200ms |
| 2 | page.keyboard.press("ControlOrMeta+a") | [DOM] 全选 `**abc**` | 选择器: .cm-content; 操作: press(SelectAll); 控件: keymap; 等待: 100ms |
| 3 | page.keyboard.press("ControlOrMeta+b") | [DOM] toggleBold 检测选区前后已有 `**`（`index.ts:27`），移除标记，文档变为 "abc" | 选择器: .cm-content; 操作: press(Mod+b); 控件: keymap; 等待: 200ms |
| 4 | getEditorText(page) | [DOM] textContent === "abc"（标记已移除，toggleWrap 的移除路径） | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] toggleBold 再次执行移除 `**` 标记（toggleWrap 的 "已包裹→移除" 分支，`index.ts:27-36`）

---

### FP-16-07-N02 [P1] [正常] toggleInlineCode 选中 "code" → `` `code` ``

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 含文本 "code"
- 插件配置: demo 默认
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. 清空编辑器并输入 "code"

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page); typeInEditor(page, "code"); page.keyboard.press("ControlOrMeta+a") | [DOM] 全选 "code" | 选择器: .cm-content; 操作: clear+type(code)+SelectAll; 控件: editor; 等待: 300ms |
| 2 | page.keyboard.press("ControlOrMeta+e") | [DOM] toggleInlineCode 执行（`index.ts:58-60`），选区加 `` ` `` 包裹，文档变为 `` `code` `` | 选择器: .cm-content; 操作: press(Mod+e); 控件: keymap; 等待: 200ms |
| 3 | getEditorText(page) | [DOM] textContent === "`code`" | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] toggleInlineCode 生成 `` `code` ``（toggleWrap marker="`" 正确）

---

### FP-16-07-N03 [P1] [正常] insertLink 选中 "click" → `[click](url)` 并选中 url

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 含文本 "click"，选中
- 插件配置: demo 默认
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. 清空编辑器并输入 "click"

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page); typeInEditor(page, "click"); page.keyboard.press("ControlOrMeta+a") | [DOM] 全选 "click" | 选择器: .cm-content; 操作: clear+type(click)+SelectAll; 控件: editor; 等待: 300ms |
| 2 | page.keyboard.press("ControlOrMeta+k") | [DOM] insertLink 执行（`index.ts:62-78`），selected="click"，插入 `[click](url)`，选中 "url"（urlStart = 5+3+3 = from+11... 实际计算 from + click.length + 3） | 选择器: .cm-content; 操作: press(Mod+k); 控件: keymap; 等待: 200ms |
| 3 | getEditorText(page) | [DOM] textContent === "[click](url)" | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |
| 4 | page.keyboard.type("https://x.io")（替换选中的 url） | [DOM] url 被替换 | 选择器: .cm-content; 操作: type(https://x.io); 控件: keymap; 等待: 200ms |
| 5 | getEditorText(page) | [DOM] textContent === "[click](https://x.io)" | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] insertLink 对选中文本生成 `[click](url)` 并自动选中 url 部分（insertLink 的 urlStart 计算正确）

---

### FP-16-07-N04 [P2] [正常] toggleWrap 自定义标记 `<u>` → 选中 "under" 包裹 `<u>under</u>`

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 含文本 "under"，选中
- 插件配置: demo 默认（underline 按钮 action: toggleWrap(e, "<u>")，`toolbar-ui.ts:160`）
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. 清空编辑器并输入 "under"

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page); typeInEditor(page, "under"); page.keyboard.press("ControlOrMeta+a") | [DOM] 全选 "under" | 选择器: .cm-content; 操作: clear+type(under)+SelectAll; 控件: editor; 等待: 300ms |
| 2 | clickToolbarButton(page, "underline") | [DOM] underline 按钮 click → toggleWrap(editor, "<u>")（`toolbar-ui.ts:160`），选区包裹 `<u>under</u>` | 选择器: .nexus-toolbar-btn[data-toolbar-action="underline"]; 操作: click(); 控件: toolbar-btn; 等待: 200ms |
| 3 | getEditorText(page) | [DOM] textContent === "<u>under</u>" | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] toggleWrap("<u>") 生成 `<u>under</u>`（自定义 marker 的通用包裹逻辑）

---

### FP-16-07-N05 [P2] [正常] toggleBold 无选区 → 插入空标记 `****`，光标在中间

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 空文档
- 插件配置: demo 默认
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page) | [DOM] 编辑器清空 | 选择器: .cm-content; 操作: clear; 控件: editor; 等待: 200ms |
| 2 | page.keyboard.press("ControlOrMeta+b") | [DOM] toggleBold 空选区（from===to），selected="" → 插入 `****`，选区在两个 `**` 之间（`index.ts:39-43`） | 选择器: .cm-content; 操作: press(Mod+b); 控件: keymap; 等待: 200ms |
| 3 | getEditorText(page) | [DOM] textContent === "****" | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |
| 4 | page.keyboard.type("X") | [DOM] X 插入到 `**` 和 `**` 之间 | 选择器: .cm-content; 操作: type(X); 控件: keymap; 等待: 200ms |
| 5 | getEditorText(page) | [DOM] textContent === "**X**"（光标在标记中间） | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 无选区 toggleBold 插入 `****` 且光标在中间（toggleWrap 空选区路径 + setSelection 定位）

---

## FP-16-08: 块级格式化函数（5 例，[编辑交互]）

> 间接验证路径: 块级格式化函数（toggleHeading/toggleBlockquote/toggleOrderedList/toggleUnorderedList/insertCodeBlock/insertImage/insertHorizontalRule）定义在 `index.ts:80-107` + `formatting.ts:78-210`。通过工具栏按钮、斜杠命令或快捷键触发。e2e 层通过"触发后编辑器文档出现块级 Markdown"间接验证。

### FP-16-08-N01 [P1] [正常] toggleHeading H3 → 行首加 `### `，再次 toggleHeading H2 → 替换为 `## `

**前置条件**（⚠️ 4要素）:
- 依赖环境: Electron demo 已启动
- 初始文档: 含文本 "title"
- 插件配置: demo 默认
- 角色权限: 无需登录
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. 清空编辑器并输入 "title"

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page); typeInEditor(page, "title") | [DOM] textContent === "title" | 选择器: .cm-content; 操作: clear+type(title); 控件: editor; 等待: 200ms |
| 2 | page.keyboard.press("ControlOrMeta+3") | [DOM] toggleHeading(editor,3)，行首加 "### "（`index.ts:88-101` 无 heading 分支），文档变为 "### title" | 选择器: .cm-content; 操作: press(Mod+3); 控件: keymap; 等待: 200ms |
| 3 | getEditorText(page) | [DOM] textContent === "### title" | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |
| 4 | page.keyboard.press("ControlOrMeta+2") | [DOM] toggleHeading(editor,2)，检测已有 `### `（headingMatch），替换为 `## `（`index.ts:95-97` 不同 level 替换分支），文档变为 "## title" | 选择器: .cm-content; 操作: press(Mod+2); 控件: keymap; 等待: 200ms |
| 5 | getEditorText(page) | [DOM] textContent === "## title"（H3 被替换为 H2） | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] toggleHeading 先加 H3 再换 H2（toggleHeading 的 "不同 level 替换" 分支，`index.ts:95-97`）

---

### FP-16-08-N02 [P1] [正常] toggleBlockquote → 行首加 `> `，再次执行移除

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 含文本 "quote"
- 插件配置: demo 默认
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. 清空编辑器并输入 "quote"

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page); typeInEditor(page, "quote") | [DOM] textContent === "quote" | 选择器: .cm-content; 操作: clear+type(quote); 控件: editor; 等待: 200ms |
| 2 | clickToolbarButton(page, "blockquote") | [DOM] toggleBlockquote（`formatting.ts:78-80`），行首加 "> "（toggleLinePrefix 无前缀分支），文档变为 "> quote" | 选择器: .nexus-toolbar-btn[data-toolbar-action="blockquote"]; 操作: click(); 控件: toolbar-btn; 等待: 200ms |
| 3 | getEditorText(page) | [DOM] textContent === "> quote" | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |
| 4 | clickToolbarButton(page, "blockquote")（再次点击） | [DOM] toggleBlockquote 检测已有 "> "（`formatting.ts:71`），移除前缀，文档变为 "quote" | 选择器: .nexus-toolbar-btn[data-toolbar-action="blockquote"]; 操作: click(); 控件: toolbar-btn; 等待: 200ms |
| 5 | getEditorText(page) | [DOM] textContent === "quote"（前缀已移除） | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] toggleBlockquote 切换加/移除 "> "（toggleLinePrefix 的 startsWith 分支）

---

### FP-16-08-N03 [P1] [正常] toggleUnorderedList → 行首加 `- `

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 含文本 "item"
- 插件配置: demo 默认
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. 清空编辑器并输入 "item"

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page); typeInEditor(page, "item") | [DOM] textContent === "item" | 选择器: .cm-content; 操作: clear+type(item); 控件: editor; 等待: 200ms |
| 2 | clickToolbarButton(page, "unordered-list") | [DOM] toggleUnorderedList（`formatting.ts:103-121`），行首加 "- "（allMarked=false 分支），文档变为 "- item" | 选择器: .nexus-toolbar-btn[data-toolbar-action="unordered-list"]; 操作: click(); 控件: toolbar-btn; 等待: 200ms |
| 3 | getEditorText(page) | [DOM] textContent === "- item" | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] toggleUnorderedList 加 "- "（无序列表前缀）

---

### FP-16-08-N04 [P1] [正常] insertCodeBlock → 插入 ``` 围栏，光标在语言行

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 空文档
- 插件配置: demo 默认
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page) | [DOM] 编辑器清空 | 选择器: .cm-content; 操作: clear; 控件: editor; 等待: 200ms |
| 2 | clickToolbarButton(page, "code-block") | [DOM] insertCodeBlock（`formatting.ts:123-145`），空文档插入 "```\n\n```"，光标在 langPos（第一个 ``` 后） | 选择器: .nexus-toolbar-btn[data-toolbar-action="code-block"]; 操作: click(); 控件: toolbar-btn; 等待: 200ms |
| 3 | getEditorText(page) | [DOM] textContent 含 "```"（至少 2 处） | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |
| 4 | page.keyboard.type("js")（在语言行输入语言标记） | [DOM] "js" 插入到第一行 ``` 之后 | 选择器: .cm-content; 操作: type(js); 控件: keymap; 等待: 200ms |
| 5 | getEditorText(page) | [DOM] textContent 含 "```js"（语言标记正确位置） | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] insertCodeBlock 插入 ``` 围栏且光标在语言行（langPos 计算 + setSelection 正确）

---

### FP-16-08-N05 [P2] [正常] insertHorizontalRule → 插入 `---`

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 含文本 "before"
- 插件配置: demo 默认（hr 斜杠命令 run: insertHorizontalRule）
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. 清空编辑器并输入 "before"

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page); typeInEditor(page, "before"); page.keyboard.press("Enter") | [DOM] 文档 "before\n"，光标在第二行行首 | 选择器: .cm-content; 操作: clear+type(before)+Enter; 控件: editor; 等待: 200ms |
| 2 | typeInEditor(page, "/hr"); page.keyboard.press("Enter") | [DOM] hr 命令执行，insertHorizontalRule（`formatting.ts:199-210`），needsLeadingNewline=false（前一个字符是 \n），插入 "---\n" | 选择器: .nexus-slash-menu; 操作: type(/hr)+Enter; 控件: menu; 等待: 400ms |
| 3 | getEditorText(page) | [DOM] textContent 含 "before" 和 "---"（水平线插入正确） | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] insertHorizontalRule 插入 "---"（needsLeadingNewline 逻辑 + 格式正确）

---

## FP-16-09: 颜色格式化函数（4 例，[编辑交互]）

> 间接验证路径: applyTextColor/applyHighlight 定义在 `formatting.ts:165-197`。通过调色板点击触发。两者均要求非空选区（from !== to），空选区 return false 不做修改。

### FP-16-09-N01 [P1] [正常] applyTextColor 对选中 "hi" 包 `<span style="color:#ff0000">hi</span>`

**前置条件**（⚠️ 4要素）:
- 依赖环境: Electron demo 已启动
- 初始文档: 含文本 "hi"，选中
- 插件配置: demo 默认
- 角色权限: 无需登录
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. 清空编辑器并输入 "hi"

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page); typeInEditor(page, "hi"); page.keyboard.press("ControlOrMeta+a") | [DOM] 全选 "hi" | 选择器: .cm-content; 操作: clear+type(hi)+SelectAll; 控件: editor; 等待: 300ms |
| 2 | clickToolbarButton(page, "text-color"); waitForDropdown(page) | [DOM] 调色板出现 | 选择器: .nexus-toolbar-btn[data-toolbar-action="text-color"]; 操作: click(); 控件: toolbar-btn; 等待: 300ms |
| 3 | page.click('.nexus-toolbar-dropdown button[title="#ff0000"]') | [DOM] applyTextColor(editor,"#ff0000")（`formatting.ts:165-180`），选区包裹 `<span style="color:#ff0000">hi</span>`，选区选中内部 "hi" | 选择器: .nexus-toolbar-dropdown button[title="#ff0000"]; 操作: click(); 控件: dropdown-item; 等待: 300ms |
| 4 | getEditorText(page) | [DOM] textContent === `<span style="color:#ff0000">hi</span>` | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] applyTextColor 生成正确的 span color 标签（formatting.ts:174 的 wrapped 模板）

---

### FP-16-09-N02 [P1] [正常] applyHighlight 对选中 "hi" 包 `<mark style="background:#ffff00">hi</mark>`

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 含文本 "hi"，选中
- 插件配置: demo 默认
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. 清空编辑器并输入 "hi"

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page); typeInEditor(page, "hi"); page.keyboard.press("ControlOrMeta+a") | [DOM] 全选 "hi" | 选择器: .cm-content; 操作: clear+type(hi)+SelectAll; 控件: editor; 等待: 300ms |
| 2 | clickToolbarButton(page, "highlight"); waitForDropdown(page) | [DOM] 调色板出现 | 选择器: .nexus-toolbar-btn[data-toolbar-action="highlight"]; 操作: click(); 控件: toolbar-btn; 等待: 300ms |
| 3 | page.click('.nexus-toolbar-dropdown button[title="#ffff00"]') | [DOM] applyHighlight(editor,"#ffff00")（`formatting.ts:182-197`），选区包裹 `<mark style="background:#ffff00">hi</mark>` | 选择器: .nexus-toolbar-dropdown button[title="#ffff00"]; 操作: click(); 控件: dropdown-item; 等待: 300ms |
| 4 | getEditorText(page) | [DOM] textContent === `<mark style="background:#ffff00">hi</mark>` | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] applyHighlight 生成正确的 mark background 标签（formatting.ts:191 的 wrapped 模板）

---

### FP-16-09-N03 [P1] [正常] applyTextColor 后选区选中内部文本（innerStart 计算）

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 含文本 "sel"，选中
- 插件配置: demo 默认
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. 清空编辑器并输入 "sel"

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page); typeInEditor(page, "sel"); page.keyboard.press("ControlOrMeta+a") | [DOM] 全选 "sel" | 选择器: .cm-content; 操作: clear+type(sel)+SelectAll; 控件: editor; 等待: 300ms |
| 2 | clickToolbarButton(page, "text-color"); waitForDropdown(page); page.click('.nexus-toolbar-dropdown button[title="#00ff00"]') | [DOM] applyTextColor(editor,"#00ff00")，包裹后 setSelection(innerStart, innerStart+3) 选中 "sel"（`formatting.ts:177-178`） | 选择器: .nexus-toolbar-dropdown button[title="#00ff00"]; 操作: click(); 控件: dropdown-item; 等待: 300ms |
| 3 | page.keyboard.type("REPLACED")（替换选中的 "sel"） | [DOM] "sel" 被替换为 "REPLACED" | 选择器: .cm-content; 操作: type(REPLACED); 控件: keymap; 等待: 300ms |
| 4 | getEditorText(page) | [DOM] textContent === `<span style="color:#00ff00">REPLACED</span>`（内部文本被替换，标签保留） | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] applyTextColor 后内部文本可被直接替换（innerStart/innerEnd 选区计算正确）

---

### FP-16-09-E01 [P3] [异常] applyTextColor 空选区 → return false，文档不变

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 含文本 "text"（光标在末尾，无选区）
- 插件配置: demo 默认
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. 清空编辑器并输入 "text"

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page); typeInEditor(page, "text")（不按 SelectAll，保持光标在末尾） | [DOM] textContent === "text"，选区为空（from===to） | 选择器: .cm-content; 操作: clear+type(text); 控件: editor; 等待: 200ms |
| 2 | clickToolbarButton(page, "text-color"); waitForDropdown(page); page.click('.nexus-toolbar-dropdown button[title="#ff0000"]') | [DOM] applyTextColor 检测 from===to（`formatting.ts:172`），return false，文档不变 | 选择器: .nexus-toolbar-dropdown button[title="#ff0000"]; 操作: click(); 控件: dropdown-item; 等待: 300ms |
| 3 | getEditorText(page) | [DOM] textContent === "text"（无 span 标签插入，空选区保护生效） | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 空选区时 applyTextColor 不修改文档（from===to 的 return false 守卫）

---

## FP-16-10: UI 交互细节（tooltip/fullscreen 感知/焦点归还）（4 例，[编辑交互][无障碍]）

> 间接验证路径: tooltip 由 `installToolbarTooltip()`（`toolbar-ui.ts:87-133`）安装；fullscreen 感知由 `pickOverlayMount()`（`toolbar-ui.ts:73-79`）处理；焦点归还由按钮 click 的 `editor.focus()`（`toolbar-ui.ts:545`）实现。

### FP-16-10-N01 [P1] [正常] hover 工具栏按钮 → tooltip 出现显示 title

**前置条件**（⚠️ 4要素）:
- 依赖环境: Electron demo 已启动
- 初始文档: 任意
- 插件配置: demo 默认（installToolbarTooltip 已安装到所有按钮）
- 角色权限: 无需登录
- 未达成时的创建过程:
  1. `launchDemo()` 启动

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | page.hover('.nexus-toolbar-btn[data-toolbar-action="bold"]') | [DOM] mouseenter 触发 show()（`toolbar-ui.ts:113`），tooltip 挂载到 body，data-state="open"，textContent = "Bold" | 选择器: .nexus-toolbar-btn[data-toolbar-action="bold"]; 操作: hover(); 控件: toolbar-btn; 等待: 300ms |
| 2 | page.waitForSelector(".nexus-toolbar-tooltip[data-state='open']") | [DOM] tooltip 可见 | 选择器: .nexus-toolbar-tooltip[data-state='open']; 操作: waitFor; 控件: tooltip; 等待: 1000ms |
| 3 | page.locator(".nexus-toolbar-tooltip").textContent() | [DOM] textContent === "Bold"（取自 dataset.toolbarTooltip，`toolbar-ui.ts:95`） | 选择器: .nexus-toolbar-tooltip; 操作: textContent(); 控件: tooltip; 等待: 无 |

**断言汇总**:
- [DOM] hover 按钮后 tooltip 显示 title 文本（installToolbarTooltip 的 show 路径）

---

### FP-16-10-N02 [P1] [正常] 鼠标离开按钮 → tooltip 消失

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 任意
- 插件配置: demo 默认
- 未达成时的创建过程:
  1. `launchDemo()` 启动

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | page.hover('.nexus-toolbar-btn[data-toolbar-action="italic"]') | [DOM] tooltip 出现 | 选择器: .nexus-toolbar-btn[data-toolbar-action="italic"]; 操作: hover(); 控件: toolbar-btn; 等待: 300ms |
| 2 | page.waitForSelector(".nexus-toolbar-tooltip[data-state='open']") | [DOM] tooltip 可见 | 选择器: .nexus-toolbar-tooltip; 操作: waitFor; 控件: tooltip; 等待: 500ms |
| 3 | page.hover(".cm-content")（鼠标移到编辑器区域，离开按钮） | [DOM] mouseleave 触发 hide()（`toolbar-ui.ts:115`），tooltip.remove()，data-state="closed" | 选择器: .cm-content; 操作: hover(); 控件: editor; 等待: 300ms |
| 4 | page.locator(".nexus-toolbar-tooltip[data-state='open']").count() | [DOM] count === 0（tooltip 已移除） | 选择器: .nexus-toolbar-tooltip[data-state='open']; 操作: count(); 控件: tooltip; 等待: 无 |

**断言汇总**:
- [DOM] mouseleave 后 tooltip 消失（installToolbarTooltip 的 hide 路径）

---

### FP-16-10-N03 [P1] [正常] 点击工具栏按钮后焦点归还编辑器（editor.focus）

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 空文档
- 插件配置: demo 默认（按钮 click 后 editor.focus()，`toolbar-ui.ts:545`）
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page) | [DOM] 编辑器清空 | 选择器: .cm-content; 操作: clear; 控件: editor; 等待: 200ms |
| 2 | clickToolbarButton(page, "bold") | [DOM] bold 按钮 click → action 执行后 editor.focus()（`toolbar-ui.ts:545`），焦点回到 .cm-content | 选择器: .nexus-toolbar-btn[data-toolbar-action="bold"]; 操作: click(); 控件: toolbar-btn; 等待: 200ms |
| 3 | page.keyboard.type("typed")（不需先点击编辑器，直接输入） | [DOM] 文本直接输入到编辑器（焦点已在编辑器内） | 选择器: .cm-content; 操作: type(typed); 控件: keymap; 等待: 200ms |
| 4 | getEditorText(page) | [DOM] textContent 含 "typed"（焦点归还后键盘输入直接进编辑器） | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 点击按钮后焦点回到编辑器，键盘输入直接进入编辑器（editor.focus() 焦点归还）

---

### FP-16-10-N04 [P2] [正常] tooltip role="tooltip" + 按钮 aria-describedby 无障碍属性

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 任意
- 插件配置: demo 默认
- 未达成时的创建过程:
  1. `launchDemo()` 启动

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | page.hover('.nexus-toolbar-btn[data-toolbar-action="bold"]') | [DOM] tooltip 出现 | 选择器: .nexus-toolbar-btn[data-toolbar-action="bold"]; 操作: hover(); 控件: toolbar-btn; 等待: 300ms |
| 2 | page.waitForSelector(".nexus-toolbar-tooltip[data-state='open']") | [DOM] tooltip 可见 | 选择器: .nexus-toolbar-tooltip; 操作: waitFor; 控件: tooltip; 等待: 500ms |
| 3 | page.getAttribute(".nexus-toolbar-tooltip", "role") | [DOM] role === "tooltip"（`toolbar-ui.ts:91`） | 选择器: .nexus-toolbar-tooltip; 操作: getAttribute(role); 控件: tooltip; 等待: 无 |
| 4 | page.getAttribute('.nexus-toolbar-btn[data-toolbar-action="bold"]', "aria-describedby") | [DOM] aria-describedby 非空（指向 tooltip id，`toolbar-ui.ts:92`） | 选择器: .nexus-toolbar-btn[data-toolbar-action="bold"]; 操作: getAttribute(aria-describedby); 控件: toolbar-btn; 等待: 无 |

**断言汇总**:
- [DOM] tooltip 有 role="tooltip"，按钮有 aria-describedby 关联（installToolbarTooltip 的无障碍属性设置）

---

## 用例合计

| 二级功能点 | 用例数 | P1 | P2 | P3 | 正常(N) | 异常(E) |
|-----------|--------|----|----|----|---------|---------|
| FP-16-01 8 条快捷键 | 5 | 4 | 1 | 0 | 5 | 0 |
| FP-16-02 14 条斜杠命令 | 5 | 4 | 1 | 0 | 5 | 0 |
| FP-16-03 8 组工具栏按钮 UI | 5 | 4 | 1 | 0 | 5 | 0 |
| FP-16-04 heading-menu 下拉 | 5 | 4 | 1 | 0 | 5 | 0 |
| FP-16-05 text-color/highlight 调色板 | 5 | 4 | 1 | 0 | 5 | 0 |
| FP-16-06 colorDecorationExtension | 5 | 3 | 1 | 1 | 4 | 1 |
| FP-16-07 行内格式化函数 | 5 | 3 | 2 | 0 | 5 | 0 |
| FP-16-08 块级格式化函数 | 5 | 4 | 1 | 0 | 5 | 0 |
| FP-16-09 颜色格式化函数 | 4 | 3 | 0 | 1 | 3 | 1 |
| FP-16-10 UI 交互细节 | 4 | 3 | 1 | 0 | 4 | 0 |
| **合计** | **48** | **36** | **10** | **2** | **46** | **2** |

### 类型分布

| 类型 | 数量 | 占比 |
|------|------|------|
| 正常(N) | 46 | 95.8% |
| 异常(E) | 2 | 4.2% |

### 优先级分布

| 优先级 | 数量 | 占比 |
|--------|------|------|
| P1 | 36 | 75.0% |
| P2 | 10 | 20.8% |
| P3 | 2 | 4.2% |

### FP-16 编号分配表

| 二级功能点编号 | 二级功能点描述 | 用例数 | 用例编号范围 |
|---------------|---------------|--------|-------------|
| FP-16-01 | 8 条快捷键 | 5 | FP-16-01-N01~N05 |
| FP-16-02 | 14 条斜杠命令 | 5 | FP-16-02-N01~N05 |
| FP-16-03 | 8 组工具栏按钮 UI | 5 | FP-16-03-N01~N05 |
| FP-16-04 | heading-menu 下拉 | 5 | FP-16-04-N01~N05 |
| FP-16-05 | text-color/highlight 调色板 | 5 | FP-16-05-N01~N05 |
| FP-16-06 | colorDecorationExtension | 5 | FP-16-06-N01~N04, E01 |
| FP-16-07 | 行内格式化函数 | 5 | FP-16-07-N01~N05 |
| FP-16-08 | 块级格式化函数 | 5 | FP-16-08-N01~N05 |
| FP-16-09 | 颜色格式化函数 | 4 | FP-16-09-N01~N03, E01 |
| FP-16-10 | UI 交互细节 | 4 | FP-16-10-N01~N04 |

### 未覆盖功能点

无。所有 10 个二级功能点均已覆盖。

### 关键陷阱提示

| # | 陷阱内容 | 来源 | 涉及用例 |
|---|---------|------|---------|
| 1 | macOS 环境 ControlOrMeta 映射为 Meta（Cmd），不是 Ctrl | Playwright ControlOrMeta 语义 | FP-16-01-*, FP-16-07-*, FP-16-08-* |
| 2 | demo 未暴露 editor 实例到 window，所有验证走 `.cm-content` textContent/innerHTML + 工具栏 DOM 副作用 | editor-shell.ts 无 window 挂载 | 所有用例 |
| 3 | 工具栏按钮 tabIndex=-1，不可 Tab 聚焦，只能鼠标点击或 JS focus | `toolbar-ui.ts:492` | FP-16-10-* |
| 4 | toggleBold 无选区时插入 `****`（空标记对），光标在中间 | `index.ts:39-43` toggleWrap 空选区路径 | FP-16-02-N01, FP-16-07-N05 |
| 5 | applyTextColor/applyHighlight 空选区时 return false 不做任何修改 | `formatting.ts:172,189` | FP-16-09-E01 |
| 6 | insertLink 无选区时插入 `[link text](url)` 并选中 url 部分（urlStart 计算） | `index.ts:69-77` | FP-16-01-N04, FP-16-07-N03 |
| 7 | DROPDOWN_IDS（heading-menu/text-color/highlight）点击后展开下拉，不直接执行 action | `toolbar-ui.ts:444,500-538` | FP-16-04-*, FP-16-05-* |
| 8 | 再次点击已打开的 dropdown 按钮会 toggle 关闭（activeDropdown 守卫） | `toolbar-ui.ts:505` | FP-16-04-N05 |
| 9 | colorDecorationExtension 光标在颜色范围内时跳过装饰（显示原始 HTML），光标在外时隐藏标签+着色 | `color-decoration.ts:104-105` | FP-16-06-N03 |
| 10 | COLOR_RE/HIGHLIGHT_RE 正则要求完整开闭标签对，未闭合不匹配 | `color-decoration.ts:21-24` | FP-16-06-E01 |
| 11 | heading-menu 下拉 Normal text 项移除 `#{1,6}\s` heading 前缀（level=0 分支） | `toolbar-ui.ts:295-309` | FP-16-04-N04 |
| 12 | COLOR_PALETTE 40 色（10 列），HIGHLIGHT_PALETTE 20 色（5 列） | `toolbar-ui.ts:340-356,383` | FP-16-05-N01~N02 |
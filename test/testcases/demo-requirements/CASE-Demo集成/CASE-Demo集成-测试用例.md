# CASE-Demo集成-测试用例（FP-19）

> 一级功能点: Demo Renderer 集成（demo-requirements.md §10）
> 全局批次序号: 19
> 生成时间: 2026-08-11
> 测试框架: Playwright（Electron demo e2e）
> 覆盖二级功能点: FP-19-01 ~ FP-19-07（共 7 个）
> 用例总数: 37
>
> 涉及二级功能点:
> - FP-19-01 EditorShell 创建（createEditorShell 工厂）（[一致性][API契约]）
> - FP-19-02 插件加载顺序（gfm→history→toolbar→search→wikilinks→wordcount）（[一致性][插件能力]）
> - FP-19-03 图片 Live Preview 渲染器（尺寸解析/路径重写/resize/错误占位）（[一致性][Live Preview][数据IO]）
> - FP-19-04 主题映射 settingsToTheme（字体/字号/模式/行高/CSS 变量）（[一致性]）
> - FP-19-05 设置项（livePreview/tabSize/direction/indentGuides/theme）（[一致性][编辑交互]）
> - FP-19-06 Vault UI 文件树面板（新建/打开/dirty 标记/外部变更刷新）（[一致性][数据IO]）
> - FP-19-07 loadDocument silent 加载（setDocument silent:true + dirty 重置）（[一致性][编辑交互]）
>
> ⚠️ 实现说明（依据 `apps/electron-demo/src/renderer/editor-shell.ts` + `app.ts` + `settings.ts` + `vault-panel.ts` + `search-bar.ts` 实际代码）:
> - **createEditorShell**（`editor-shell.ts:93-382`）：工厂函数，接收 `{ container, state, settings, onStateChange, onWikilinkNavigate, resolveWikilink, suggestWikilinks }`。内部调用 `createEditor()`（container + plugins + livePreview + theme + tabSize + direction + indentGuides + onChange），然后 `createToolbarUI(editor)` 将工具栏插入 container 首部，`createSlashMenuUI(editor)` 挂载到 document.body，`attachWordCountPlugin(wordcount, editor)` 绑定字数统计。返回 `{ editor, toolbar, slashMenu, wordcount, applySettings, loadDocument, destroy }`。
> - **插件加载顺序**（`editor-shell.ts:139-146`）：`plugins` 数组顺序: `[createGfmPreset(), createHistoryPlugin(), createToolbarPlugin(), createSearchPlugin(), wikilinksPlugin, wordcount]`。其中 `wikilinksPlugin` 在 `createEditor` 调用前通过 `createWikilinksPlugin()` 构建（`editor-shell.ts:108-112`）；`wordcount` 通过 `createWordCountPlugin({ statusBar: { container, classPrefix: "nexus-wordcount" } })` 构建（`editor-shell.ts:118-120`）。
> - **图片渲染器**（`editor-shell.ts:151-313`）：`livePreview.enabled=true` 时注册 `image` 渲染器。wrapper 为 `<span class="nexus-image" data-live-preview-image="{url}">`（`editor-shell.ts:162-167`），内含 `<img>`（`editor-shell.ts:169-179`）、`</>` 源码跳转按钮（`title="View source"`，`editor-shell.ts:182-205`）、右下角 resize 手柄（`<span title="Drag to resize">`，`editor-shell.ts:220-234`）。`parseImageSize`（`editor-shell.ts:23-35`）解析 `alt|width` 或 `alt|widthxheight`。`resolveImageSrc`（`editor-shell.ts:39-66`）将相对路径重写为 `nexus-vault://vault/<encoded-rel>`。mouseenter/leave 切换 chrome 显隐（`editor-shell.ts:281-293`）。img error 事件替换为 `⚠ image not found: {url}` 占位（`editor-shell.ts:300-307`）。
> - **settingsToTheme**（`settings.ts:48-57`）：根据 `colorScheme` 选择 `lightTheme`/`darkTheme`，覆盖 `fontSize`/`fontFamily`/`fontFamilyMono`/`contentMaxWidth`。主题通过 `editor.setTheme()` → `themeCompartment.reconfigure()` 应用（`editor.ts:744-747`）。CSS 变量映射（`theme.ts:80-100, 120-127`）: `bg→--nexus-bg`、`text→--nexus-text`、`accent→--nexus-accent` 等，fontSize/fontFamily 直接设置在 `&`（`.cm-editor`）上。
> - **设置面板**（`settings.ts:244-306`）：模态对话框，Color scheme `<select>`（"light"/"dark"，`settings.ts:271`）、Font size `<input type="range" min=10 max=28>`（`settings.ts:280`）、Live preview toggle（`settings.ts:273`）、Tab size range（`settings.ts:286`）、Text direction select（`settings.ts:276`）、Indent guides toggle（`settings.ts:274`）。`applySettings` 仅调用 `editor.setTheme()`（`editor-shell.ts:354-356`）——⚠️ 注意 livePreview/tabSize/direction/indentGuides 在初始化后不会通过 applySettings 重新应用，仅保存到 localStorage 供下次启动。
> - **Vault 面板**（`vault-panel.ts:185-584`）：`.nexus-vault-panel`（`vault-panel.ts:187`）。Header 含 📁 打开（`title="Open vault…"`）、`+` 新建文件（`title="New file at root"`）、📂 新建文件夹（`title="New folder at root"`）。无 vault 时新建按钮 disabled（`vault-panel.ts:208-209, 222-230`）。文件项为 `div[data-path][data-kind]`（`vault-panel.ts:252-256`），点击文件触发 `onOpenFile` 回调（`vault-panel.ts:284-292`）。
> - **状态行**（`app.ts:95-115`）：`#status-line` 元素，显示路径 + `[modified]`（dirty 时）+ 字数行数 + Vault 名。dirty 标记格式: ` [modified]`（`app.ts:107`）。
> - **loadDocument**（`editor-shell.ts:357-374`）：调用 `editor.setDocument(content, { silent: true })`，然后设置 `state.content = content; state.dirty = false`（`editor-shell.ts:365-366`）。silent 模式跳过 onChange pipeline（`editor.ts:602-604`），不会将文档加载计为用户编辑。
> - **e2e 验证策略**: demo 未将 editor 实例暴露到 `window`，所有验证通过 UI 副作用（DOM 结构、样式变化、状态行文本）间接进行。

---

## e2e 全局前置条件

- 依赖环境: Electron demo（Vite dev server localhost:5173 + 已构建的 `apps/electron-demo/dist-electron/main.js`）
- 初始文档: demo 启动后默认状态（可能恢复上次 vault 文档或空文档）
- 插件配置: demo 默认挂载 —— createGfmPreset（第 1 个）+ createHistoryPlugin + createToolbarPlugin + createSearchPlugin + createWikilinksPlugin + createWordCountPlugin
- livePreview 配置: demo 默认 `settings.livePreview = true`
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

// 辅助：获取编辑器 innerHTML
async function getEditorHTML(page: Page): Promise<string> {
  return (await page.locator(".cm-content").innerHTML()) ?? "";
}

// 辅助：等待字数统计防抖（150ms）
async function waitForWordcount(page: Page) {
  await page.waitForTimeout(250);
}

// 辅助：打开设置面板
async function openSettings(page: Page) {
  await page.click('button[title="Settings"]');
  await page.waitForSelector('div[style*="position: fixed"][style*="inset: 0"]', { timeout: 2000 });
}

// 辅助：关闭设置面板
async function closeSettings(page: Page) {
  await page.keyboard.press("Escape");
}

// 辅助：获取状态行文本
async function getStatusText(page: Page): Promise<string> {
  return (await page.locator("#status-line").textContent()) ?? "";
}
```

---

## FP-19-01: EditorShell 创建（createEditorShell 工厂）

> `createEditorShell(options)`（`editor-shell.ts:93-382`）是 demo 的核心工厂函数，在 `app.ts:boot()` 中被调用（`app.ts:362`）。它创建编辑器实例、工具栏 UI、斜杠菜单、字数统计插件，并将它们组装到 `.editor-container` 容器中。返回的 `EditorShell` 接口包含 `editor`、`toolbar`、`slashMenu`、`wordcount`、`applySettings`、`loadDocument`、`destroy` 七个成员。由于 demo 不暴露 `shell` 到 `window`，通过验证各组件的 DOM 产出间接确认工厂函数成功执行。

### FP-19-01-E01 [P0] [正向] demo 启动后 CodeMirror 编辑器容器挂载

- **优先级**: P0
- **类型**: 正向
- **前置条件**: Vite dev server 已运行，Electron 主进程已构建
- **测试步骤**:
  1. 调用 `launchDemo()` 启动 Electron 实例
  2. 断言 `.cm-content` 元素存在且可见（count >= 1）
  3. 断言 `.cm-editor` 父容器存在（CodeMirror 6 根元素）
  4. 断言 `.editor-container` 容器存在（`app.ts:358`）
- **预期结果**:
  1. `.cm-content` count >= 1（`launchDemo` 等待此选择器）
  2. `.cm-editor` count >= 1
  3. `.editor-container` count >= 1
- **自动化信息**: 选择器: .cm-content, .cm-editor, .editor-container; 操作: count() + isVisible(); 控件: editor; 等待: launchDemo 内置 15s

---

### FP-19-01-E02 [P0] [正向] 工具栏（ToolbarUI）插入到 editor-container 首部

- **优先级**: P0
- **类型**: 正向
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 断言 `.nexus-toolbar` 元素存在（`toolbar-ui.ts:449`，由 `editor-shell.ts:336` 插入）
  2. 断言 `.nexus-toolbar` 是 `.editor-container` 的第一个子元素（`editor-shell.ts:336` `container.insertBefore(toolbar.element, container.firstChild)`）
  3. 断言 `.nexus-toolbar` 含 `role="toolbar"` 属性（`toolbar-ui.ts:450`）
  4. 断言 `.nexus-toolbar-btn` 数量 >= 1（工具栏按钮）
- **预期结果**:
  1. `.nexus-toolbar` count >= 1
  2. `.editor-container` 的第一个子元素 className 含 "nexus-toolbar"
  3. `.nexus-toolbar` 的 `role` 属性值为 "toolbar"
  4. `.nexus-toolbar-btn` count >= 1
- **自动化信息**: 选择器: .nexus-toolbar, .nexus-toolbar-btn; 操作: count() + evaluate() firstChild + getAttribute("role"); 控件: toolbar; 等待: 500ms

---

### FP-19-01-E03 [P0] [正向] 字数统计状态栏挂载到 editor-container

- **优先级**: P0
- **类型**: 正向
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 等待 500ms（wordcount 首次发射在下一 microtask，`editor-shell.ts:343-347`）
  2. 断言 `[data-testid="nexus-wordcount-bar"]` 存在（`status-bar.ts:89`）
  3. 断言元素具有 `role="status"` 和 `aria-live="polite"`（`status-bar.ts:90-91`）
  4. 断言元素位于 `.editor-container` 内部（statusBar container = editorContainer，`editor-shell.ts:119`）
- **预期结果**:
  1. `[data-testid="nexus-wordcount-bar"]` count >= 1
  2. 元素同时具有 `role="status"` 和 `aria-live="polite"`
  3. 元素的最近祖先 `.editor-container` 存在
- **自动化信息**: 选择器: [data-testid="nexus-wordcount-bar"]; 操作: count() + getAttribute(); 控件: wordcount; 等待: 500ms

---

### FP-19-01-I01 [P1] [交互] 斜杠菜单 DOM 挂载到 document.body（非 editor-container）

- **优先级**: P1
- **类型**: 交互
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 点击 `.cm-content` 聚焦编辑器
  2. 输入 `/` 触发斜杠菜单
  3. 等待 300ms（菜单弹出动画）
  4. 断言斜杠菜单 DOM 存在于 `document.body`（SlashMenuUI 挂载于 document.body，`editor-shell.ts:341`）
  5. 断言菜单不在 `.editor-container` 内部（独立挂载以避免 overflow 裁剪）
- **预期结果**:
  1. 输入 `/` 后有菜单容器出现在 `document.body`（class 或属性标识斜杠菜单）
  2. 菜单容器不是 `.editor-container` 的后代
- **自动化信息**: 选择器: .cm-content; 操作: click() + type("/"); 控件: editor + slashMenu; 等待: 300ms

---

### FP-19-01-N01 [P1] [边界] editor-container 为空时 createEditorShell 仍正常初始化

- **优先级**: P1
- **类型**: 边界
- **前置条件**: demo 已启动，初始文档为空
- **测试步骤**:
  1. 清空编辑器（`clearEditor`）
  2. 断言 `.cm-content` 的 textContent 为空或仅含空白
  3. 断言 `[data-testid="nexus-wordcount-bar"]` 仍存在（空文档下 wordcount 正常初始化）
  4. 断言 `.nexus-toolbar` 仍存在
  5. 断言状态行 `#status-line` 显示 "Untitled"（无文件路径时的默认值，`app.ts:106`）
- **预期结果**:
  1. 编辑器内容为空
  2. 工具栏、字数统计、状态行均正常渲染
  3. 状态行含 "Untitled"
- **自动化信息**: 选择器: .cm-content, [data-testid="nexus-wordcount-bar"], .nexus-toolbar, #status-line; 操作: textContent() + count(); 控件: editor; 等待: 500ms

---

## FP-19-02: 插件加载顺序（gfm→history→toolbar→search→wikilinks→wordcount）

> demo 在 `createEditor` 的 `plugins` 数组中按固定顺序加载 6 个插件（`editor-shell.ts:139-146`）。由于无法直接检查 plugins 数组，通过每个插件产生的 UI 副作用间接验证其加载: GFM → 表格渲染；history → Mod-z 撤销；toolbar → 工具栏按钮；search → 搜索面板；wikilinks → 链接装饰；wordcount → 状态栏。

### FP-19-02-E01 [P0] [正向] GFM 插件加载 —— 表格语法渲染为 nexus-table-wrapper

- **优先级**: P0
- **类型**: 正向
- **前置条件**: demo 已启动，编辑器可见，livePreview 开启
- **测试步骤**:
  1. 清空编辑器后插入表格语法: `| A | B |\n|---|---|\n| 1 | 2 |`
  2. 按 ArrowDown 将光标移出表格行
  3. 断言 `.nexus-table-wrapper` 存在（GFM 表格 → Live Preview block widget）
  4. 断言 `.nexus-table-wrapper table[role="grid"]` 存在
- **预期结果**:
  1. `.nexus-table-wrapper` count >= 1
  2. 表格元素 `role="grid"` 存在
- **自动化信息**: 选择器: .nexus-table-wrapper; 操作: insertText() + count(); 控件: editor; 等待: 500ms

---

### FP-19-02-E02 [P0] [正向] History 插件加载 —— Mod-z 撤销操作

- **优先级**: P0
- **类型**: 正向
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器
  2. 输入文本 `hello world`
  3. 断言 `getEditorText()` 含 "hello world"
  4. 按 ControlOrMeta+z 撤销
  5. 断言 `getEditorText()` 不含 "hello world"（撤销生效）
  6. 按 ControlOrMeta+Shift+z 重做（或 ControlOrMeta+y）
  7. 断言 `getEditorText()` 再次含 "hello world"
- **预期结果**:
  1. 撤销后文本恢复为撤销前状态
  2. 重做后文本恢复
- **自动化信息**: 选择器: .cm-content; 操作: typeInEditor() + press("ControlOrMeta+z"); 控件: editor; 等待: 300ms

---

### FP-19-02-E03 [P0] [正向] Toolbar 插件加载 —— 工具栏按钮可交互

- **优先级**: P0
- **类型**: 正向
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 断言 `.nexus-toolbar` 存在
  2. 断言 `.nexus-toolbar-btn` 数量 >= 5（粗体/斜体/标题/删除线/链接等按钮）
  3. 断言至少一个按钮含 `data-toolbar-action` 属性（`toolbar-ui.ts:488`）
  4. 清空编辑器后输入 `test`
  5. 选中文本（ControlOrMeta+a）
  6. 点击一个格式化按钮（如 `[data-toolbar-action="bold"]` 或第一个 `.nexus-toolbar-btn`）
  7. 断言编辑器内容发生变化（添加了格式标记）
- **预期结果**:
  1. 工具栏含多个可操作按钮
  2. 点击按钮后编辑器内容反映格式化操作
- **自动化信息**: 选择器: .nexus-toolbar-btn, [data-toolbar-action]; 操作: count() + click(); 控件: toolbar; 等待: 300ms

---

### FP-19-02-E04 [P0] [正向] Search 插件加载 —— 搜索面板可打开

- **优先级**: P0
- **类型**: 正向
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后输入 `hello world hello`
  2. 按 ControlOrMeta+f 打开搜索面板（`app.ts:418-423` 或搜索按钮 🔍）
  3. 断言 `.nexus-search-bar` 的 `display` 不为 "none"（可见，`search-bar.ts:202-203`）
  4. 在搜索输入框中输入 `hello`
  5. 断言搜索结果显示匹配数（count label 非空）
- **预期结果**:
  1. 搜索面板可见（display != none）
  2. 输入查询后 count label 显示匹配数
- **自动化信息**: 选择器: .nexus-search-bar; 操作: press("ControlOrMeta+f") + evaluate(style.display); 控件: searchBar; 等待: 300ms

---

### FP-19-02-E05 [P0] [正向] Wikilinks 插件加载 —— 双链渲染为 data-wikilink-target

- **优先级**: P0
- **类型**: 正向
- **前置条件**: demo 已启动，编辑器可见，livePreview 开启
- **测试步骤**:
  1. 清空编辑器后输入 `[[\n` 后继续输入 `Note1]]`（确保 `[[Note1]]` 在独立行/光标移出后渲染）
  2. 将光标移到文档下一行（ArrowDown 或 Enter）使 wikilink 行无光标
  3. 断言 `[data-wikilink-target]` 元素存在（`wikilinks.ts:155`）
  4. 断言 target 属性值为 "Note1"
- **预期结果**:
  1. `[data-wikilink-target]` count >= 1
  2. target 属性含 "Note1"
- **自动化信息**: 选择器: [data-wikilink-target]; 操作: typeInEditor() + getAttribute(); 控件: editor; 等待: 500ms

---

### FP-19-02-E06 [P0] [正向] WordCount 插件加载 —— 状态栏显示字数

- **优先级**: P0
- **类型**: 正向
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 等待字数统计栏挂载（`[data-testid="nexus-wordcount-bar"]` 可见）
  2. 清空编辑器后输入 `one two three`
  3. 等待 250ms（防抖 150ms）
  4. 断言 `[data-testid="nexus-wordcount-words"]` 的 textContent 匹配 `/^3\s*words$/`（3 个词）
- **预期结果**:
  1. words span 文本为 "3 words"（或含数字 3 + "words"）
- **自动化信息**: 选择器: [data-testid="nexus-wordcount-words"]; 操作: textContent(); 控件: wordcount; 等待: 250ms

---

## FP-19-03: 图片 Live Preview 渲染器（尺寸解析/路径重写/resize/错误占位）

> 图片渲染器在 `livePreview.enabled=true` 时注册（`editor-shell.ts:147-315`）。`parseImageSize`（`editor-shell.ts:23-35`）解析 Obsidian 风格 `alt|width` 或 `alt|widthxheight`。wrapper 为 `<span class="nexus-image" data-live-preview-image="{url}">`，内含 `<img>` + `</>` 源码跳转按钮 + resize 手柄。mouseenter/leave 切换 chrome 显隐。img error 替换为 `⚠ image not found` 占位。

### FP-19-03-E01 [P0] [正向] 图片语法渲染为 nexus-image wrapper + img 元素

- **优先级**: P0
- **类型**: 正向
- **前置条件**: demo 已启动，编辑器可见，livePreview 开启
- **测试步骤**:
  1. 清空编辑器后插入: `![alt text](https://example.com/image.png)`
  2. 按 ArrowDown 将光标移出图片行
  3. 断言 `span.nexus-image` 存在（`editor-shell.ts:162-163`）
  4. 断言 `.nexus-image img` 存在（`editor-shell.ts:169`）
  5. 断言 `.nexus-image` 含 `data-live-preview-image` 属性值为 "https://example.com/image.png"（`editor-shell.ts:167`）
  6. 断言 img 的 `src` 为 "https://example.com/image.png"（绝对 URL 直通，`editor-shell.ts:44`）
- **预期结果**:
  1. `span.nexus-image` count >= 1
  2. `.nexus-image img` 存在
  3. `data-live-preview-image` = 原始 URL
  4. img `src` 为绝对 URL（直通）
- **自动化信息**: 选择器: span.nexus-image, .nexus-image img; 操作: insertText() + count() + getAttribute(); 控件: editor; 等待: 500ms

---

### FP-19-03-E02 [P0] [正向] parseImageSize —— alt|width 格式解析后设置 img 宽度

- **优先级**: P0
- **类型**: 正向
- **前置条件**: demo 已启动，编辑器可见，livePreview 开启
- **测试步骤**:
  1. 清空编辑器后插入: `![my image|100](https://example.com/pic.png)`
  2. 按 ArrowDown 将光标移出
  3. 断言 `.nexus-image img` 存在
  4. 断言 img 的 `style.width` 含 "100px"（`editor-shell.ts:178`）
  5. 断言 img 的 `alt` 属性为 "my image"（管道后尺寸被剥离，`editor-shell.ts:31`）
- **预期结果**:
  1. img width 样式为 "100px"
  2. img alt 为 "my image"（不含 "|100"）
- **自动化信息**: 选择器: .nexus-image img; 操作: evaluate(style.width) + getAttribute("alt"); 控件: editor; 等待: 500ms

---

### FP-19-03-E03 [P1] [正向] parseImageSize —— alt|widthxheight 格式解析后设置宽高

- **优先级**: P1
- **类型**: 正向变体
- **前置条件**: demo 已启动，编辑器可见，livePreview 开启
- **测试步骤**:
  1. 清空编辑器后插入: `![photo|200x150](https://example.com/img.png)`
  2. 按 ArrowDown 将光标移出
  3. 断言 img 的 `style.width` 含 "200px"（`editor-shell.ts:178`）
  4. 断言 img 的 `style.height` 含 "150px"（`editor-shell.ts:179`）
  5. 断言 img 的 `alt` 属性为 "photo"
- **预期结果**:
  1. img width = "200px"
  2. img height = "150px"
  3. img alt = "photo"（不含尺寸后缀）
- **自动化信息**: 选择器: .nexus-image img; 操作: evaluate(style.width, style.height) + getAttribute("alt"); 控件: editor; 等待: 500ms

---

### FP-19-03-E04 [P0] [正向] </> 源码跳转按钮存在且具有正确属性

- **优先级**: P0
- **类型**: 正向
- **前置条件**: demo 已启动，编辑器可见，livePreview 开启
- **测试步骤**:
  1. 清空编辑器后插入: `![test](https://example.com/x.png)`
  2. 按 ArrowDown 将光标移出
  3. 断言 `.nexus-image button` 存在（`</>` 按钮，`editor-shell.ts:182`）
  4. 断言按钮 `title` 为 "View source"（`editor-shell.ts:183`）
  5. 断言按钮 textContent 为 `</>`（`editor-shell.ts:184`）
  6. 断言 `.nexus-image span[title="Drag to resize"]` 存在（resize 手柄，`editor-shell.ts:221`）
- **预期结果**:
  1. `</>` 按钮存在，title="View source"，text=`</>`
  2. resize 手柄 span 存在，title="Drag to resize"
- **自动化信息**: 选择器: .nexus-image button, .nexus-image span[title="Drag to resize"]; 操作: count() + getAttribute() + textContent(); 控件: editor; 等待: 500ms

---

### FP-19-03-I01 [P1] [交互] mouseenter/leave 切换 chrome（源码按钮 + resize 手柄）显隐

- **优先级**: P1
- **类型**: 交互
- **前置条件**: demo 已启动，编辑器可见，livePreview 开启
- **测试步骤**:
  1. 清空编辑器后插入: `![hover test](https://example.com/h.png)`
  2. 按 ArrowDown 将光标移出
  3. 断言 `</>` 按钮初始 opacity 为 "0"（隐藏态，`editor-shell.ts:199`）
  4. hover `.nexus-image` wrapper（`page.hover(".nexus-image")`）
  5. 断言 `</>` 按钮 opacity 为 "1"（显示态，`editor-shell.ts:283`）
  6. 断言 resize 手柄 opacity 为 "1"（显示态，`editor-shell.ts:284`）
  7. 移出 hover（`page.hover("body")`）
  8. 断言 `</>` 按钮 opacity 恢复为 "0"（`editor-shell.ts:289`）
- **预期结果**:
  1. 初始 chrome 隐藏（opacity=0）
  2. hover 后 chrome 显示（opacity=1）
  3. 移出后 chrome 恢复隐藏
- **自动化信息**: 选择器: .nexus-image; 操作: hover() + evaluate(style.opacity); 控件: editor; 等待: 200ms 每次 hover 后

---

### FP-19-03-N01 [P1] [边界] 图片加载失败时显示错误占位提示

- **优先级**: P1
- **类型**: 边界
- **前置条件**: demo 已启动，编辑器可见，livePreview 开启
- **测试步骤**:
  1. 清空编辑器后插入一个不存在的图片路径: `![broken](https://invalid.invalid/nonexistent.png)`
  2. 按 ArrowDown 将光标移出
  3. 等待 img error 事件触发（最多 3000ms）
  4. 断言 `.nexus-image` 内出现 `span` 元素含 "⚠ image not found"（`editor-shell.ts:302`）
  5. 断言原始 `<img>` 元素已被替换（`editor-shell.ts:306` `img.replaceWith(err)`）
- **预期结果**:
  1. 错误占位 span 出现，textContent 含 "⚠ image not found" 和原始 URL
  2. `.nexus-image img` 不再存在
- **自动化信息**: 选择器: .nexus-image span; 操作: waitFor() + textContent(); 控件: editor; 等待: 3000ms（img error 事件）

---

## FP-19-04: 主题映射 settingsToTheme（字体/字号/模式/行高/CSS 变量）

> `settingsToTheme(settings)`（`settings.ts:48-57`）将 `EditorSettings` 映射为 `NexusTheme`，根据 `colorScheme` 选择 lightTheme/darkTheme 并覆盖 fontSize/fontFamily/fontFamilyMono/contentMaxWidth。主题通过 `editor.setTheme()` → `themeCompartment.reconfigure()` 应用（`editor.ts:744-747`），CSS 变量映射在 `theme.ts:80-100, 120-127`。设置面板通过 `createSettingsPanel(settings, onChange)` 弹出（`settings.ts:244-306`），onChange 回调调用 `shell.applySettings(settings)` 触发 `editor.setTheme()`（`editor-shell.ts:354-356`、`app.ts:177-182`）。

### FP-19-04-E01 [P0] [正向] 默认亮色主题 —— CSS 变量 --nexus-bg 为白色

- **优先级**: P0
- **类型**: 正向
- **前置条件**: demo 已启动，编辑器可见，默认 colorScheme="light"
- **测试步骤**:
  1. 断言 `.cm-editor` 的计算样式 `background-color` 为白色或接近白色（lightTheme.bg = "#ffffff"，`theme.ts:36`）
  2. 断言 `.cm-editor` 的计算样式 `color` 为深色文本（lightTheme.text = "#24292e"，`theme.ts:39`）
  3. 断言 `--nexus-accent` CSS 变量值为 "#0969da"（lightTheme.accent，`theme.ts:44`）
- **预期结果**:
  1. 背景色为白色系
  2. 文本色为深色系
  3. accent 为 "#0969da"
- **自动化信息**: 选择器: .cm-editor; 操作: evaluate(getComputedStyle) + getPropertyValue("--nexus-accent"); 控件: editor; 等待: 500ms

---

### FP-19-04-E02 [P0] [正向] 设置面板切换暗色模式 —— CSS 变量 --nexus-bg 变为深色

- **优先级**: P0
- **类型**: 正向
- **前置条件**: demo 已启动，编辑器可见，当前为亮色模式
- **测试步骤**:
  1. 打开设置面板（点击 `button[title="Settings"]`，即 ⚙ 按钮）
  2. 找到 Color scheme 行的 `<select>` 元素（settings 面板中含 "Color scheme" 文本的行）
  3. 将 select 值改为 "dark"（`settings.ts:271`）
  4. 等待 300ms（setTheme dispatch + CM6 reconfigure）
  5. 断言 `.cm-editor` 的 `--nexus-bg` CSS 变量变为 "#1e1e1e"（darkTheme.bg，`theme.ts:58`）
  6. 断言 `--nexus-text` 变为 "#d4d4d4"（darkTheme.text，`theme.ts:61`）
  7. 断言 `--nexus-accent` 变为 "#4fc1ff"（darkTheme.accent，`theme.ts:66`）
- **预期结果**:
  1. 切换后 --nexus-bg = "#1e1e1e"
  2. --nexus-text = "#d4d4d4"
  3. --nexus-accent = "#4fc1ff"
- **自动化信息**: 选择器: button[title="Settings"], select; 操作: click() + selectOption("dark"); 控件: settings panel; 等待: 300ms

---

### FP-19-04-E03 [P0] [正向] 修改字号 —— .cm-editor fontSize 变化

- **优先级**: P0
- **类型**: 正向
- **前置条件**: demo 已启动，编辑器可见，默认 fontSize=15
- **测试步骤**:
  1. 断言 `.cm-editor` 计算样式 `font-size` 为 "15px"（默认值，`settings.ts:22`）
  2. 打开设置面板
  3. 找到 Font size 行的 `<input type="range">`（`settings.ts:280`）
  4. 将 range 值改为 "20"（`settings.ts:191` `input.value`）
  5. 等待 300ms
  6. 断言 `.cm-editor` 计算样式 `font-size` 变为 "20px"（`theme.ts:108` `(theme.fontSize ?? 15) + "px"`）
- **预期结果**:
  1. 初始 fontSize = "15px"
  2. 修改后 fontSize = "20px"
- **自动化信息**: 选择器: .cm-editor, input[type="range"]; 操作: evaluate(getComputedStyle.fontSize) + fill(); 控件: settings panel; 等待: 300ms

---

### FP-19-04-E04 [P1] [正向] 修改正文字体族 —— .cm-editor fontFamily 变化

- **优先级**: P1
- **类型**: 正向
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 记录初始 `.cm-editor` 计算样式 `font-family` 值
  2. 打开设置面板
  3. 找到 Body font 行的 `<input type="text">`（`settings.ts:281`）
  4. 输入新字体族如 `Georgia, serif`
  5. 触发 change 事件（按 Tab 或 Enter）
  6. 等待 300ms
  7. 断言 `.cm-editor` 计算样式 `font-family` 含 "Georgia"（`theme.ts:109` `theme.fontFamily`）
- **预期结果**:
  1. 修改后 font-family 含 "Georgia"
- **自动化信息**: 选择器: .cm-editor, input[type="text"]; 操作: evaluate(getComputedStyle.fontFamily) + fill() + press("Tab"); 控件: settings panel; 等待: 300ms

---

### FP-19-04-N01 [P1] [边界] 切换亮暗模式后再切回 —— CSS 变量恢复正确

- **优先级**: P1
- **类型**: 边界
- **前置条件**: demo 已启动，当前为亮色模式
- **测试步骤**:
  1. 记录亮色模式下 `--nexus-bg` = "#ffffff"
  2. 打开设置面板，切换为 dark
  3. 等待 300ms，断言 `--nexus-bg` = "#1e1e1e"
  4. 再切换回 light
  5. 等待 300ms，断言 `--nexus-bg` 恢复为 "#ffffff"
  6. 断言 `--nexus-text` 恢复为 "#24292e"
- **预期结果**:
  1. dark → light 往返后 CSS 变量正确恢复
- **自动化信息**: 选择器: select; 操作: selectOption("dark") + selectOption("light"); 控件: settings panel; 等待: 300ms 每次

---

## FP-19-05: 设置项（livePreview/tabSize/direction/indentGuides/theme）

> 默认设置（`settings.ts:19-32`）: livePreview=true、tabSize=4、direction="ltr"、indentGuides=false、lineNumbers=true、colorScheme="light"、fontSize=15。设置面板（`settings.ts:244-306`）含 Live preview toggle、Tab size range、Text direction select、Indent guides toggle。⚠️ 注意: `applySettings` 仅调用 `editor.setTheme()`（`editor-shell.ts:354-356`），livePreview/tabSize/direction/indentGuides 在初始化后不会通过 applySettings 重新应用——它们仅保存到 localStorage 供下次启动生效。

### FP-19-05-E01 [P0] [正向] 默认 livePreview=true —— 编辑器渲染 Live Preview 装饰

- **优先级**: P0
- **类型**: 正向
- **前置条件**: demo 已启动，默认设置
- **测试步骤**:
  1. 清空编辑器后插入 markdown 标题: `# Heading`
  2. 按 ArrowDown 将光标移出标题行
  3. 断言 `.cm-content` 内有 Live Preview 装饰（`#` 标记被隐藏或样式化，而非纯文本显示）
  4. 清空后插入代码块: `` ```js\ncode\n``` ``
  5. 移出光标
  6. 断言代码块被 Live Preview 渲染（非纯文本 ` ``` `）
- **预期结果**:
  1. 标题 `#` 标记被 Live Preview 处理
  2. 代码块被 Live Preview 渲染
- **自动化信息**: 选择器: .cm-content; 操作: insertText() + innerHTML(); 控件: editor; 等待: 500ms

---

### FP-19-05-E02 [P0] [正向] 默认 tabSize=4 —— Tab 键插入 4 个空格

- **优先级**: P0
- **类型**: 正向
- **前置条件**: demo 已启动，默认设置
- **测试步骤**:
  1. 清空编辑器
  2. 输入 `line1`，按 Enter
  3. 按 Tab 键
  4. 输入 `indented`
  5. 断言编辑器内容中 "indented" 前有 4 个空格的缩进
  6. 通过 `getEditorText()` 检查文本含 `\n    indented`（4 个空格）
- **预期结果**:
  1. Tab 产生 4 个空格缩进
- **自动化信息**: 选择器: .cm-content; 操作: typeInEditor() + press("Tab") + textContent(); 控件: editor; 等待: 200ms

---

### FP-19-05-E03 [P1] [正向] 设置面板含 livePreview toggle 和 indentGuides toggle

- **优先级**: P1
- **类型**: 正向
- **前置条件**: demo 已启动
- **测试步骤**:
  1. 打开设置面板
  2. 断言面板内含 "Live preview" 文本行（`settings.ts:273`）
  3. 断言面板内含 "Indent guides" 文本行（`settings.ts:274`）
  4. 断言面板内含 "Tab size" 文本行（`settings.ts:286`）
  5. 断言面板内含 "Text direction" 文本行（`settings.ts:276`）
  6. 断言 Tab size 行有 `<input type="range">`，min="1" max="8"
  7. 断言 Text direction 行有 `<select>`，含 "ltr" 和 "rtl" 选项
- **预期结果**:
  1. 设置面板含全部 4 个设置项控件
  2. Tab size range 范围 1-8
  3. Text direction select 含 ltr/rtl
- **自动化信息**: 选择器: button[title="Settings"]; 操作: click() + evaluate(textContent); 控件: settings panel; 等待: 500ms

---

### FP-19-05-E04 [P1] [正向] 修改 Tab size 后保存到 localStorage

- **优先级**: P1
- **类型**: 正向
- **前置条件**: demo 已启动
- **测试步骤**:
  1. 打开设置面板
  2. 找到 Tab size range input，将值改为 "2"
  3. 关闭设置面板（Escape）
  4. 断言 `localStorage.getItem("nexus-editor-settings")` 返回的 JSON 含 `tabSize: 2`（`settings.ts:42-45` `saveSettings`）
- **预期结果**:
  1. localStorage 中 tabSize = 2
- **自动化信息**: 选择器: input[type="range"]; 操作: fill("2") + evaluate(localStorage); 控件: settings panel; 等待: 300ms

---

### FP-19-05-N01 [P1] [边界] indentGuides 默认 false —— 编辑器无缩进引导线

- **优先级**: P1
- **类型**: 边界
- **前置条件**: demo 已启动，默认设置
- **测试步骤**:
  1. 清空编辑器后输入多级缩进内容: `line1\n    line2\n        line3`（4 空格 + 8 空格）
  2. 断言 `.cm-content` 内不含缩进引导线相关 class（indentGuides 默认 false，`settings.ts:26`）
  3. 检查 `.cm-indent` 或缩进 guide 线元素不存在
- **预期结果**:
  1. 默认 indentGuides=false 时无引导线 DOM
- **自动化信息**: 选择器: .cm-content; 操作: insertText() + evaluate(querySelector indent guide); 控件: editor; 等待: 300ms

---

## FP-19-06: Vault UI 文件树面板（新建/打开/dirty 标记/外部变更刷新）

> Vault 面板（`vault-panel.ts:185-584`）: `.nexus-vault-panel` 容器。Header 含 📁 打开、`+` 新建文件、📂 新建文件夹按钮。无 vault 时新建按钮 disabled。文件项为 `div[data-path][data-kind]`，点击文件触发 `onOpenFile` → `handleVaultFileOpen`（`app.ts:205-234`）。dirty 状态通过 `#status-line` 的 `[modified]` 标记显示（`app.ts:107`）。外部变更通过 `window.nexusDemo.vault.onChanged()` → `refresh()` 刷新文件树（`vault-panel.ts:539-541`）。

### FP-19-06-E01 [P0] [正向] Vault 面板存在且含操作按钮

- **优先级**: P0
- **类型**: 正向
- **前置条件**: demo 已启动
- **测试步骤**:
  1. 断言 `.nexus-vault-panel` 存在（`vault-panel.ts:187`）
  2. 断言面板内含 `button[title="Open vault…"]`（📁 按钮，`vault-panel.ts:200-201`）
  3. 断言面板内含 `button[title="New file at root"]`（`+` 按钮，`vault-panel.ts:206-207`）
  4. 断言面板内含 `button[title="New folder at root"]`（📂 按钮，`vault-panel.ts:213-214`）
- **预期结果**:
  1. Vault 面板及 3 个操作按钮均存在
- **自动化信息**: 选择器: .nexus-vault-panel, button[title]; 操作: count(); 控件: vaultPanel; 等待: 500ms

---

### FP-19-06-E02 [P0] [正向] 无 vault 时新建文件/文件夹按钮 disabled

- **优先级**: P0
- **类型**: 正向
- **前置条件**: demo 已启动，未打开任何 vault（需清除 localStorage 中的 lastVault）
- **测试步骤**:
  1. 等待 demo 启动和 vault 恢复尝试完成（`app.ts:431-437` 的 `tryRestoreLastVault`）
  2. 断言 `button[title="New file at root"]` 的 `disabled` 属性为 true（`vault-panel.ts:208`）
  3. 断言 `button[title="New folder at root"]` 的 `disabled` 属性为 true（`vault-panel.ts:215`）
  4. 断言这两个按钮的 opacity 样式为 "0.4"（`vault-panel.ts:226`）
- **预期结果**:
  1. 无 vault 时新建按钮 disabled + opacity 0.4
- **自动化信息**: 选择器: button[title="New file at root"], button[title="New folder at root"]; 操作: getAttribute("disabled") + evaluate(style.opacity); 控件: vaultPanel; 等待: 1000ms（等 vault 恢复尝试完成）

---

### FP-19-06-E03 [P1] [正向] Vault 打开后文件树渲染文件项

- **优先级**: P1
- **类型**: 正向
- **前置条件**: demo 已启动，已打开一个包含文件的 vault（可能通过 tryRestoreLastVault 自动恢复）
- **测试步骤**:
  1. 等待 vault 恢复或手动打开一个测试 vault
  2. 检查 `.nexus-vault-panel` 内是否有 `[data-path]` 文件项
  3. 如果有文件项: 断言 `[data-kind="file"]` 至少 1 个（文件项，`vault-panel.ts:256`）
  4. 断言新建文件按钮不再 disabled（`vault-panel.ts:223-224`）
  5. 断言面板标题（header 内文本）非 "Vault"（显示 vault 名称，`vault-panel.ts:533`）
- **预期结果**:
  1. 打开 vault 后文件树渲染文件项
  2. 新建按钮启用
- **自动化信息**: 选择器: [data-path], [data-kind="file"]; 操作: count() + getAttribute("disabled"); 控件: vaultPanel; 等待: 1000ms

---

### FP-19-06-I01 [P1] [交互] 点击文件项 → loadDocument → 编辑器内容更新

- **优先级**: P1
- **类型**: 交互
- **前置条件**: demo 已启动，已打开含至少 1 个 .md 文件的 vault
- **测试步骤**:
  1. 记录当前编辑器内容
  2. 点击第一个 `[data-kind="file"]` 文件项（`vault-panel.ts:284-292` click → onOpenFile）
  3. 等待 500ms（IPC 读取 + loadDocument + 渲染）
  4. 断言编辑器内容已更新（`getEditorText()` 与步骤 1 不同，或含文件内容）
  5. 断言状态行 `#status-line` 显示文件名（非 "Untitled"）
  6. 断言状态行不含 `[modified]`（loadDocument 重置 dirty=false，`editor-shell.ts:366`）
- **预期结果**:
  1. 编辑器内容更新为打开文件的内容
  2. 状态行显示文件路径
  3. 无 [modified] 标记
- **自动化信息**: 选择器: [data-kind="file"]; 操作: click() + textContent(); 控件: vaultPanel + editor; 等待: 500ms

---

### FP-19-06-N01 [P0] [正向] 编辑后状态行显示 [modified] dirty 标记

- **优先级**: P0
- **类型**: 正向
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器
  2. 断言状态行 `#status-line` 不含 "[modified]"（初始 dirty=false）
  3. 输入文本 `edited content`
  4. 等待 200ms（onChange → state.dirty=true → renderStatus，`editor-shell.ts:323` + `app.ts:107`）
  5. 断言状态行含 "[modified]"（dirty 标记，`app.ts:107` `dirtyMark = " [modified]"`）
- **预期结果**:
  1. 编辑前状态行无 [modified]
  2. 编辑后状态行含 [modified]
- **自动化信息**: 选择器: #status-line; 操作: textContent() + typeInEditor(); 控件: editor + statusLine; 等待: 200ms

---

## FP-19-07: loadDocument silent 加载（setDocument silent:true + dirty 重置）

> `shell.loadDocument(content)`（`editor-shell.ts:357-374`）调用 `editor.setDocument(content, { silent: true })`（`editor-shell.ts:363`），然后设置 `state.content = content; state.dirty = false`（`editor-shell.ts:365-366`）。silent 模式跳过 onChange pipeline（`editor.ts:602-604`），不触发 state.dirty=true。这意味着文件加载不会将文档内容变更计为用户编辑。

### FP-19-07-E01 [P0] [正向] loadDocument 后编辑器内容正确更新

- **优先级**: P0
- **类型**: 正向
- **前置条件**: demo 已启动，已打开含至少 1 个 .md 文件的 vault
- **测试步骤**:
  1. 清空编辑器
  2. 点击一个文件项触发 loadDocument（`vault-panel.ts:284` → `handleVaultFileOpen` → `shell.loadDocument`，`app.ts:219`）
  3. 等待 500ms
  4. 断言 `getEditorText()` 非空（文件内容已加载）
  5. 断言编辑器内容与文件内容一致
- **预期结果**:
  1. loadDocument 后编辑器内容为文件内容
- **自动化信息**: 选择器: [data-kind="file"], .cm-content; 操作: click() + textContent(); 控件: vaultPanel + editor; 等待: 500ms

---

### FP-19-07-E02 [P0] [正向] loadDocument silent 模式 —— 状态行不显示 [modified]

- **优先级**: P0
- **类型**: 正向
- **前置条件**: demo 已启动，已打开含至少 1 个 .md 文件的 vault
- **测试步骤**:
  1. 先在编辑器中输入内容（使 dirty=true），状态行显示 [modified]
  2. 点击另一个文件项触发 loadDocument（需要先处理 dirty 确认对话框 `confirmDiscardIfDirty`，`app.ts:209`）
  3. 处理确认对话框（如果有 `window.confirm` 弹窗: 通过 `page.on("dialog")` accept）
  4. 等待 500ms
  5. 断言状态行 `#status-line` 不含 "[modified]"（loadDocument 重置 dirty=false，`editor-shell.ts:366`）
- **预期结果**:
  1. loadDocument 后 dirty 被重置为 false
  2. 状态行不显示 [modified]
- **自动化信息**: 选择器: [data-kind="file"], #status-line; 操作: click() + textContent(); 控件: vaultPanel + statusLine; 等待: 500ms

---

### FP-19-07-E03 [P0] [正向] loadDocument silent 模式 —— 不触发 onChange（字数统计基于新文档）

- **优先级**: P0
- **类型**: 正向
- **前置条件**: demo 已启动，已打开含多词内容的 .md 文件 vault
- **测试步骤**:
  1. 清空编辑器，等待 wordcount 显示 0 words
  2. 点击一个含多词内容的文件项触发 loadDocument
  3. 处理确认对话框（如有）
  4. 等待 500ms（silent 加载不触发 onChange pipeline，但 wordcount 会随文档更新重算）
  5. 断言 `[data-testid="nexus-wordcount-words"]` 显示非零字数（新文档内容被统计）
- **预期结果**:
  1. loadDocument 后字数统计反映新文档内容（非 0）
- **自动化信息**: 选择器: [data-kind="file"], [data-testid="nexus-wordcount-words"]; 操作: click() + textContent(); 控件: vaultPanel + wordcount; 等待: 500ms

---

### FP-19-07-I01 [P1] [交互] loadDocument 后继续编辑 → dirty 恢复为 true

- **优先级**: P1
- **类型**: 交互
- **前置条件**: demo 已启动，已打开含文件的 vault
- **测试步骤**:
  1. 点击文件项触发 loadDocument
  2. 等待 500ms
  3. 断言状态行不含 "[modified]"（刚加载，dirty=false）
  4. 在编辑器中输入额外字符（如空格 + 字母）
  5. 等待 200ms（onChange → dirty=true）
  6. 断言状态行含 "[modified]"（编辑后 dirty 恢复）
- **预期结果**:
  1. loadDocument 后 dirty=false
  2. 后续编辑触发 dirty=true
- **自动化信息**: 选择器: [data-kind="file"], #status-line, .cm-content; 操作: click() + typeInEditor() + textContent(); 控件: vaultPanel + editor + statusLine; 等待: 500ms + 200ms

---

### FP-19-07-N01 [P1] [边界] 连续 loadDocument 两个文件 —— 最后一个内容生效

- **优先级**: P1
- **类型**: 边界
- **前置条件**: demo 已启动，已打开含至少 2 个 .md 文件的 vault
- **测试步骤**:
  1. 点击第一个文件项 → loadDocument
  2. 等待 300ms，记录编辑器内容 text1
  3. 点击第二个文件项 → loadDocument（处理确认对话框如有）
  4. 等待 300ms
  5. 断言编辑器内容与 text1 不同（已切换到第二个文件）
  6. 断言状态行不含 "[modified]"（每次 loadDocument 重置 dirty）
  7. 断言状态行显示第二个文件名
- **预期结果**:
  1. 连续加载后编辑器显示最后一个文件内容
  2. dirty 保持 false
- **自动化信息**: 选择器: [data-kind="file"], #status-line, .cm-content; 操作: click() + textContent(); 控件: vaultPanel + editor; 等待: 300ms 每次

---

## 附录

### 用例统计

| 二级功能点 | 用例数 | P0 | P1 |
|-----------|--------|----|----|
| FP-19-01 EditorShell 创建 | 5 | 3 | 2 |
| FP-19-02 插件加载顺序 | 6 | 6 | 0 |
| FP-19-03 图片 Live Preview 渲染器 | 6 | 4 | 2 |
| FP-19-04 主题映射 settingsToTheme | 5 | 3 | 2 |
| FP-19-05 设置项 | 5 | 2 | 3 |
| FP-19-06 Vault UI 文件树面板 | 5 | 2 | 3 |
| FP-19-07 loadDocument silent 加载 | 5 | 3 | 2 |
| **合计** | **37** | **23** | **14** |

### 用例编号索引

| 编号 | 类型 | 优先级 | 标题摘要 |
|------|------|--------|---------|
| FP-19-01-E01 | 正向 | P0 | demo 启动后 CodeMirror 编辑器容器挂载 |
| FP-19-01-E02 | 正向 | P0 | 工具栏插入到 editor-container 首部 |
| FP-19-01-E03 | 正向 | P0 | 字数统计状态栏挂载到 editor-container |
| FP-19-01-I01 | 交互 | P1 | 斜杠菜单 DOM 挂载到 document.body |
| FP-19-01-N01 | 边界 | P1 | 空容器时 createEditorShell 正常初始化 |
| FP-19-02-E01 | 正向 | P0 | GFM 插件 —— 表格渲染 |
| FP-19-02-E02 | 正向 | P0 | History 插件 —— Mod-z 撤销 |
| FP-19-02-E03 | 正向 | P0 | Toolbar 插件 —— 工具栏按钮交互 |
| FP-19-02-E04 | 正向 | P0 | Search 插件 —— 搜索面板可打开 |
| FP-19-02-E05 | 正向 | P0 | Wikilinks 插件 —— 双链渲染 |
| FP-19-02-E06 | 正向 | P0 | WordCount 插件 —— 状态栏显示字数 |
| FP-19-03-E01 | 正向 | P0 | 图片渲染为 nexus-image wrapper + img |
| FP-19-03-E02 | 正向 | P0 | alt\|width 格式解析设置 img 宽度 |
| FP-19-03-E03 | 正向 | P1 | alt\|widthxheight 格式解析设置宽高 |
| FP-19-03-E04 | 正向 | P0 | </> 源码跳转按钮 + resize 手柄存在 |
| FP-19-03-I01 | 交互 | P1 | mouseenter/leave 切换 chrome 显隐 |
| FP-19-03-N01 | 边界 | P1 | 图片加载失败显示错误占位提示 |
| FP-19-04-E01 | 正向 | P0 | 默认亮色主题 CSS 变量 |
| FP-19-04-E02 | 正向 | P0 | 设置面板切换暗色模式 |
| FP-19-04-E03 | 正向 | P0 | 修改字号 .cm-editor fontSize 变化 |
| FP-19-04-E04 | 正向 | P1 | 修改正文字体族 fontFamily 变化 |
| FP-19-04-N01 | 边界 | P1 | 亮暗模式往返后 CSS 变量恢复 |
| FP-19-05-E01 | 正向 | P0 | 默认 livePreview=true 渲染装饰 |
| FP-19-05-E02 | 正向 | P0 | 默认 tabSize=4 Tab 键插入 4 空格 |
| FP-19-05-E03 | 正向 | P1 | 设置面板含 livePreview/indentGuides toggle |
| FP-19-05-E04 | 正向 | P1 | 修改 Tab size 保存到 localStorage |
| FP-19-05-N01 | 边界 | P1 | indentGuides 默认 false 无引导线 |
| FP-19-06-E01 | 正向 | P0 | Vault 面板存在且含操作按钮 |
| FP-19-06-E02 | 正向 | P0 | 无 vault 时新建按钮 disabled |
| FP-19-06-E03 | 正向 | P1 | Vault 打开后文件树渲染文件项 |
| FP-19-06-I01 | 交互 | P1 | 点击文件项 loadDocument 更新编辑器 |
| FP-19-06-N01 | 正向 | P0 | 编辑后状态行显示 [modified] |
| FP-19-07-E01 | 正向 | P0 | loadDocument 后编辑器内容更新 |
| FP-19-07-E02 | 正向 | P0 | loadDocument silent 不显示 [modified] |
| FP-19-07-E03 | 正向 | P0 | loadDocument silent 字数统计基于新文档 |
| FP-19-07-I01 | 交互 | P1 | loadDocument 后编辑 dirty 恢复 true |
| FP-19-07-N01 | 边界 | P1 | 连续 loadDocument 两文件最后一个生效 |
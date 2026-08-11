# CASE-createEditor配置-测试用例（FP-02）

> 一级功能点: createEditor 配置（demo-requirements.md §3.1）
> 全局批次序号: 02
> 生成时间: 2026-08-11
> 测试框架: Playwright（Electron demo e2e）
> 覆盖二级功能点: FP-02-01 ~ FP-02-10（共 10 个）
> 用例总数: 63
>
> 涉及二级功能点:
> - FP-02-01 container 必填挂载节点（[API契约]）
> - FP-02-02 initialValue 初始 Markdown 文档（[API契约]）
> - FP-02-03 plugins 插件列表注入（[API契约][插件能力]）
> - FP-02-04 livePreview 开关与自定义配置（[API契约][Live Preview]）
> - FP-02-05 theme 主题设置（[API契约]）
> - FP-02-06 tabSize / direction / indentGuides（[API契约][编辑交互]）
> - FP-02-07 readOnly 只读模式（[API契约][编辑交互]）
> - FP-02-08 multiCursor 多光标开关（[API契约][编辑交互]）
> - FP-02-09 slashMenuLimit 斜杠菜单最大显示数（[API契约]）
> - FP-02-10 onChange/onFocus/onBlur/onAssetUpload 回调（[API契约][数据IO]）
>
> ⚠️ 实现说明:
> - createEditor 配置在 demo 中已固化（`apps/electron-demo/src/renderer/editor-shell.ts:128-331`），e2e 测试通过 demo UI 间接验证各配置项的运行时效果。
> - demo 固化配置: `multiCursor: true`、`parseDelayMs: 150`、6 个插件按顺序加载（gfm→history→toolbar→search→wikilinks→wordcount）、`livePreview` 受 settings.livePreview 控制（默认 true）。
> - demo Settings 面板（⚙ 按钮）可切换: `livePreview`、`tabSize`、`direction`、`indentGuides`、`colorScheme`（主题）、`fontSize`、`fontFamily` 等。设置变更通过 `shell.applySettings()` 调用 `editor.setTheme(settingsToTheme(next))`（app.ts:177-182、editor-shell.ts:354-356）。
> - **注意**: demo 固化配置不含 `readOnly`（默认 false）、`slashMenuLimit`（默认 8）、`onFocus/onBlur/onAssetUpload` 回调。这些用例标注"待确认"或通过间接行为验证。
> - 全局 setup 使用 `launchDemo()` 启动 Electron demo。

---

## e2e 全局前置条件

- 依赖环境: Electron demo（Vite dev server localhost:5173 + 已构建的 `apps/electron-demo/dist-electron/main.js`）
- 初始文档: demo 启动后默认状态（可能恢复上次 vault 的文档或空文档）
- 插件配置: demo 默认挂载 —— createGfmPreset + createHistoryPlugin + createToolbarPlugin + createSearchPlugin + createWikilinksPlugin + createWordCountPlugin
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

// 辅助：清空编辑器内容（建立干净初始状态）
async function clearEditor(page: Page) {
  await page.click(".cm-content");
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
}

// 辅助：键盘输入文本
async function typeInEditor(page: Page, text: string) {
  await page.click(".cm-content");
  await page.keyboard.type(text);
}

// 辅助：通过 execCommand 插入文本（部分场景兼容性更好）
async function insertText(page: Page, text: string) {
  await page.click(".cm-content");
  await page.evaluate((t) => document.execCommand("insertText", false, t), text);
}

// 辅助：打开 Settings 面板
async function openSettings(page: Page) {
  await page.click('button[title="Settings"]');
  await page.waitForSelector('div[style*="position: fixed"][style*="inset: 0"]');
}

// 辅助：关闭 Settings 面板
async function closeSettings(page: Page) {
  await page.keyboard.press("Escape");
}

// 辅助：获取编辑器纯文本内容
async function getEditorText(page: Page): Promise<string> {
  return (await page.locator(".cm-content").textContent()) ?? "";
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

# FP-02-01 container 必填挂载节点（[API契约]）

> demo 已固化挂载到 `editorContainer`（app.ts:357-358），e2e 无法直接传不同 container。通过验证 demo 启动后编辑器挂载位置正确来间接验证。

## FP-02-01-N01 [P1] [正常] demo 启动后编辑器挂载到 editor-container 内

**测试框架**: Playwright

**前置条件**（⚠️ 4要素缺一不可）:
- 依赖数据: demo 应用实例（通过 launchDemo 启动）
- 系统状态: Electron 窗口已打开，Vite dev server 已运行
- 角色权限: 本地桌面应用，无需登录
- 未达成时的创建过程:
  1. 启动 Vite dev server（终端: `pnpm dev:renderer`; 等待: localhost:5173 可访问）
  2. 构建 Electron 主进程（终端: `pnpm build:electron-demo`; 产物: `apps/electron-demo/dist-electron/main.js`）
  3. test.beforeAll 中调用 `launchDemo()` 启动 Electron（页面入口: 自动打开首个窗口; 无需输入）

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 等待 `.cm-content` 可见（launchDemo 内置） | [DOM] `.cm-content` 元素存在且可见（CM6 EditorView 已挂载） | 选择器: .cm-content; 操作: waitForSelector({ timeout: 15000 }); 控件: editor; 等待: 15s |
| 2 | 查找 `.cm-editor` 的祖先 `.editor-container` | [DOM] `.cm-editor` 位于 `.editor-container` 内部（createEditor 挂载到 container 参数指定的节点，app.ts:357-358 创建 editorContainer，editor-shell.ts:128 传入 container） | 选择器: .editor-container .cm-editor; 操作: count(); 控件: container; 等待: 无 |
| 3 | 断言 `.editor-container` 是 `.editor-column` 的子节点 | [DOM] 层级结构正确（app.ts:355 `.editor-column`，359 `editorColumn.append(editorContainer)`） | 选择器: .editor-column > .editor-container; 操作: count(); 控件: layout; 等待: 无 |

**断言汇总**:
- [DOM] `.cm-content` 可见
- [DOM] `.editor-container .cm-editor` 存在
- [DOM] `.editor-column > .editor-container` 存在

---

## FP-02-01-N02 [P2] [正常] 编辑器挂载后工具栏插入到容器顶部

**测试框架**: Playwright

**前置条件**: 全局 setup（demo 已启动）

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 查找工具栏 `.nexus-toolbar` | [DOM] 工具栏存在（editor-shell.ts:335-336 `createToolbarUI(editor)` 后 `container.insertBefore(toolbar.element, container.firstChild)`，工具栏作为 container 第一个子节点） | 选择器: .editor-container > .nexus-toolbar; 操作: count(); 控件: toolbar; 等待: 无 |
| 2 | 断言工具栏在 `.cm-editor` 之前 | [DOM] 工具栏 DOM 顺序先于 `.cm-editor`（insertBefore 将 toolbar 放在 container.firstChild 即 cm-editor 之前） | 选择器: .editor-container; 操作: evaluate(el => el.children[0].className); 控件: layout; 等待: 无 |

**断言汇总**:
- [DOM] `.editor-container > .nexus-toolbar` 存在
- [DOM] `.editor-container` 第一个子节点是工具栏

---

## FP-02-01-N03 [P2] [正常] 编辑器挂载点包含字数统计状态栏

**测试框架**: Playwright

**前置条件**: 全局 setup（demo 已启动）

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 查找字数统计状态栏 | [DOM] `.nexus-wordcount` 容器存在（editor-shell.ts:118-120 `createWordCountPlugin({ statusBar: { container, classPrefix: "nexus-wordcount" } })`，状态栏挂载到 container） | 选择器: .nexus-wordcount; 操作: count(); 控件: wordcount; 等待: 无 |
| 2 | 断言状态栏 role 属性 | [DOM] 状态栏带 `role="status"` 和 `aria-live="polite"`（无障碍属性，wordcount 插件规范） | 选择器: [role="status"][aria-live="polite"]; 操作: count(); 控件: wordcount; 等待: 无 |

**断言汇总**:
- [DOM] `.nexus-wordcount` 存在
- [DOM] `[role="status"][aria-live="polite"]` 存在

---

## FP-02-01-E01 [P3] [异常] demo 启动时 #app 元素不存在应抛错（防御性验证）

**测试框架**: Playwright

**前置条件**: 全局 setup（demo 已启动，验证 boot 函数的防御逻辑）

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 检查 `#app` 元素存在（app.ts:345-346 `const root = document.getElementById("app"); if (!root) throw new Error("Missing #app element")`） | [DOM] `#app` 元素存在（demo 正常启动证明此条件满足，反面情况会导致 boot 抛错无 UI） | 选择器: #app; 操作: count(); 控件: root; 等待: 无 |
| 2 | 断言 `#app` 包含工具栏、主区域、状态栏（app.ts:360 `root.append(appToolbar, mainArea, statusLine)`） | [DOM] `#app` 下有 `.toolbar`、`.main-area`、`#status-line` 三个子节点 | 选择器: #app > .toolbar, #app > .main-area, #app > #status-line; 操作: count(); 控件: layout; 等待: 无 |

**断言汇总**:
- [DOM] `#app` 存在
- [DOM] `#app` 包含 `.toolbar`、`.main-area`、`#status-line`

---

## FP-02-01-B01 [P4] [边界] 编辑器挂载后容器不被清空（保留子节点结构）

**测试框架**: Playwright

**前置条件**: 全局 setup（demo 已启动）

| 步骤 操作 | 预期结果 | 自动化信息 |
|------|---------|-----------|
| 1 | 查找 `.editor-container` 的所有子节点 | [DOM] 容器内同时存在工具栏 `.nexus-toolbar` 和 `.cm-editor`（CM6 以 `parent` 追加挂载，不清空 container 现有内容） | 选择器: .editor-container; 操作: evaluate(el => el.children.length); 控件: container; 等待: 无 |
| 2 | 断言子节点数量 ≥ 2（工具栏 + cm-editor） | [DOM] children.length >= 2 | 选择器: .editor-container; 操作: evaluate(el => el.children.length); 控件: container; 等待: 无 |

**断言汇总**:
- [DOM] `.editor-container` 同时含工具栏与 cm-editor

---

# FP-02-02 initialValue 初始 Markdown 文档（[API契约]）

> demo 的 initialValue 来自 `state.content`（editor-shell.ts:130 `initialValue: state.content`），state 初始为空字符串（state.ts）。demo 启动时若恢复上次 vault，loadDocument 以 silent 模式加载文件内容。

## FP-02-02-N01 [P1] [正常] demo 启动后编辑器初始内容可读

**测试框架**: Playwright

**前置条件**: 全局 setup（demo 已启动）

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 读取 `.cm-content` 的 textContent | [DOM] 编辑器有内容（无论空或恢复的文档），`editor.getDocument()` 可读 | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |
| 2 | 断言编辑器不抛错，内容为字符串 | [STATE] getDocument 返回合法字符串（initialValue 经 editor.ts:546 `doc: config.initialValue ?? ""` 处理） | 选择器: .cm-content; 操作: evaluate(() => window.__editor?.getDocument()); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] `.cm-content` textContent 为字符串
- [STATE] 文档内容可读

---

## FP-02-02-N02 [P1] [正常] 输入文本后状态栏 dirty 标记出现

**测试框架**: Playwright

**前置条件**: 全局 setup + 编辑器已清空

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器（`clearEditor`） | [STATE] 编辑器为空 | 选择器: .cm-content; 操作: click() + ControlOrMeta+a + Backspace; 控件: editor; 等待: 无 |
| 2 | 输入 "TEST_INITIAL_VALUE" | [DOM] `.cm-content` 包含 "TEST_INITIAL_VALUE" | 选择器: .cm-content; 操作: keyboard.type(); 控件: editor; 等待: 无 |
| 3 | 断言状态栏 `#status-line` 含 "[modified]" | [DOM] 状态栏显示 `[modified]`（onChange 回调 editor-shell.ts:321-330 设置 `state.dirty = true`，renderStatus app.ts:107 `dirtyMark = state.dirty ? " [modified]" : ""`） | 选择器: #status-line; 操作: textContent(); 控件: status; 等待: 200ms（parseDelayMs 150 防抖） |

**断言汇总**:
- [DOM] `.cm-content` 含输入文本
- [DOM] `#status-line` 含 "[modified]"

---

## FP-02-02-N03 [P2] [正常] loadDocument silent 模式不触发 onChange dirty

**测试框架**: Playwright

**前置条件**: 全局 setup + 已通过 Vault 打开一个文件

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 在编辑器中输入文本产生 dirty 状态 | [DOM] 状态栏显示 "[modified]" | 选择器: .cm-content; 操作: keyboard.type("temp"); 控件: editor; 等待: 200ms |
| 2 | 通过 Vault 面板打开另一个文件（或重新打开当前文件） | [STATE] loadDocument 以 `setDocument(content, { silent: true })` 加载，跳过 onChange（editor-shell.ts:362-363） | 选择器: .vault-panel-file; 操作: click(); 控件: vault; 等待: 500ms |
| 3 | 断言状态栏不再显示 "[modified]" | [DOM] `#status-line` 不含 "[modified]"（loadDocument 重置 `state.dirty = false`，editor-shell.ts:366） | 选择器: #status-line; 操作: textContent(); 控件: status; 等待: 200ms |

**断言汇总**:
- [STATE] 重新加载文件后 dirty 标记消失

---

## FP-02-02-B01 [P4] [边界] initialValue 为空时编辑器正常工作

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器所有内容 | [STATE] 编辑器内容为空字符串 | 选择器: .cm-content; 操作: click() + ControlOrMeta+a + Backspace; 控件: editor; 等待: 无 |
| 2 | 断言字数统计 | [DOM] wordcount 显示 "0 words"（空文档统计为 0） | 选择器: .nexus-wordcount; 操作: textContent(); 控件: wordcount; 等待: 200ms |
| 3 | 输入单字符后断言字数更新 | [DOM] wordcount 显示 "1" 相关统计 | 选择器: .cm-content; 操作: keyboard.type("a"); 控件: editor; 等待: 200ms |

**断言汇总**:
- [DOM] 空文档时 wordcount 为 0
- [DOM] 输入后 wordcount 更新

---

## FP-02-02-E01 [P3] [异常] 编辑器内容变更后 getDocument 一致性

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入多行 Markdown `# Title\n\nParagraph`（用 Enter 分行） | [DOM] `.cm-content` textContent 含 "Title" 和 "Paragraph" | 选择器: .cm-content; 操作: keyboard.type(); 控件: editor; 等待: 200ms |
| 2 | 断言编辑器内容包含输入的文本 | [DOM] textContent 含 "Title" 与 "Paragraph" | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 编辑器内容与输入一致

---

# FP-02-03 plugins 插件列表注入（[API契约][插件能力]）

> demo 固化加载 6 个插件（editor-shell.ts:139-146）。通过各插件的功能行为间接验证插件已注入。

## FP-02-03-N01 [P1] [正常] GFM 插件注入 —— 表格语法渲染

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器并输入 GFM 表格语法 `| A | B |\n|---|---|\n| 1 | 2 |` | [DOM] 表格被渲染（GFM 预设注入 remark-gfm，editor-shell.ts:140） | 选择器: .cm-content; 操作: keyboard.type(); 控件: editor; 等待: 300ms |
| 2 | 移光标到表格行之外（ArrowDown 到空行），触发 Live Preview | [DOM] 表格折叠为 `.nexus-table-wrapper` widget（live-preview-table.ts:933） | 选择器: .cm-content; 操作: keyboard.press(ArrowDown); 控件: editor; 等待: 200ms |
| 3 | 断言表格 widget 存在 | [DOM] `.nexus-table-wrapper` 或 `table` 元素存在 | 选择器: .nexus-table-wrapper, table.nexus-table; 操作: count(); 控件: table-widget; 等待: 无 |

**断言汇总**:
- [DOM] 表格语法被渲染为表格 widget

---

## FP-02-03-N02 [P1] [正常] History 插件注入 —— 撤销功能可用

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入 "before" | [DOM] `.cm-content` 含 "before" | 选择器: .cm-content; 操作: keyboard.type("before"); 控件: editor; 等待: 无 |
| 2 | 输入 "after" | [DOM] `.cm-content` 含 "beforeafter" | 选择器: .cm-content; 操作: keyboard.type("after"); 控件: editor; 等待: 无 |
| 3 | 按 ControlOrMeta+z 撤销 | [DOM] `.cm-content` 仅含 "before"（history 插件 editor-shell.ts:141 封装 @codemirror/commands history()） | 选择器: .cm-content; 操作: keyboard.press(ControlOrMeta+z); 控件: editor; 等待: 100ms |

**断言汇总**:
- [DOM] 撤销后内容恢复为 "before"

---

## FP-02-03-N03 [P1] [正常] Toolbar 插件注入 —— 工具栏按钮可见

**测试框架**: Playwright

**前置条件**: 全局 setup（demo 已启动）

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 查找工具栏按钮 | [DOM] `.nexus-toolbar` 内含多个按钮（editor-shell.ts:142 createToolbarPlugin，335-336 createToolbarUI 挂载） | 选择器: .nexus-toolbar button; 操作: count(); 控件: toolbar; 等待: 无 |
| 2 | 断言工具栏按钮数量 ≥ 8（8 组按钮: undo/redo/link/heading/inline/block/list/color/image） | [DOM] button 数量 >= 8 | 选择器: .nexus-toolbar button; 操作: count(); 控件: toolbar; 等待: 无 |

**断言汇总**:
- [DOM] 工具栏含多个功能按钮

---

## FP-02-03-N04 [P2] [正常] Search 插件注入 —— 搜索面板可打开

**测试框架**: Playwright

**前置条件**: 全局 setup + 编辑器有内容

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 按 ControlOrMeta+f 打开搜索面板 | [DOM] 搜索面板可见（app.ts:418-422 Ctrl+F 监听调 searchBar.open()，search 插件 editor-shell.ts:143） | 选择器: .cm-content; 操作: keyboard.press(ControlOrMeta+f); 控件: editor; 等待: 200ms |
| 2 | 断言搜索面板存在 | [DOM] 搜索输入框可见（NexusSearchPanel 渲染查找框） | 选择器: [placeholder*="Find" i], input[type="text"]; 操作: count(); 控件: search; 等待: 无 |
| 3 | 按 Escape 关闭搜索面板 | [STATE] 搜索面板隐藏 | 选择器: .cm-content; 操作: keyboard.press(Escape); 控件: editor; 等待: 200ms |

**断言汇总**:
- [DOM] Ctrl+F 后搜索面板出现

---

## FP-02-03-N05 [P2] [正常] Wikilinks 插件注入 —— 双链语法高亮

**测试框架**: Playwright

**前置条件**: 全局 setup + 已打开 Vault + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入 `[[TestNote]]` | [DOM] 编辑器含 wikilink 语法（wikilinks 插件 editor-shell.ts:108-112,144） | 选择器: .cm-content; 操作: keyboard.type("[[TestNote]]"); 控件: editor; 等待: 300ms |
| 2 | 移光标到下一行触发折叠 | [DOM] wikilink 装饰生效（未解析链接为虚线下划线 deletion 色，已解析为实线 accent 色，demo-requirements §3.5） | 选择器: .cm-content; 操作: keyboard.press(ArrowDown); 控件: editor; 等待: 200ms |
| 3 | 断言 wikilink 渲染（虚线或实线下划线装饰） | [DOM] 含 wikilink 相关装饰元素或标记 | 选择器: .cm-content; 操作: evaluate(el => el.innerHTML); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] wikilink 语法触发装饰渲染

---

## FP-02-03-N06 [P2] [正常] WordCount 插件注入 —— 字数统计实时更新

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器 | [STATE] 编辑器为空 | 选择器: .cm-content; 操作: click() + ControlOrMeta+a + Backspace; 控件: editor; 等待: 无 |
| 2 | 断言初始 wordcount | [DOM] wordcount 显示 0 words | 选择器: .nexus-wordcount; 操作: textContent(); 控件: wordcount; 等待: 200ms |
| 3 | 输入 "hello world" | [DOM] `.cm-content` 含 "hello world" | 选择器: .cm-content; 操作: keyboard.type("hello world"); 控件: editor; 等待: 300ms |
| 4 | 断言 wordcount 更新为 2 words | [DOM] wordcount 含 "2" | 选择器: .nexus-wordcount; 操作: textContent(); 控件: wordcount; 等待: 300ms（parseDelayMs 150 防抖） |

**断言汇总**:
- [DOM] 字数统计随输入实时更新

---

## FP-02-03-D01 [P2] [数据] 插件加载顺序验证 —— GFM 在 History 之前

**测试框架**: Playwright

**前置条件**: 全局 setup（demo 已启动）

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 输入表格语法 + 编辑后撤销 | [STATE] 表格先渲染（GFM），撤销功能可用（history），两者不冲突（editor-shell.ts:139-146 加载顺序 gfm→history→toolbar→search→wikilinks→wordcount） | 选择器: .cm-content; 操作: keyboard.type("| a |\n|---|\n| 1 |"); 控件: editor; 等待: 300ms |
| 2 | 按 ControlOrMeta+z 撤销 | [DOM] 撤销操作生效，内容回退 | 选择器: .cm-content; 操作: keyboard.press(ControlOrMeta+z); 控件: editor; 等待: 200ms |
| 3 | 断言表格与撤销功能共存 | [STATE] 表格渲染和撤销栈互不干扰 | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [STATE] GFM 表格与 History 撤销功能共存无冲突

---

## FP-02-03-E01 [P3] [异常] 插件功能独立性 —— 搜索插件不影响编辑

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 输入文本 "independent test" | [DOM] `.cm-content` 含输入文本 | 选择器: .cm-content; 操作: keyboard.type("independent test"); 控件: editor; 等待: 200ms |
| 2 | 打开搜索面板（Ctrl+F）再关闭（Escape） | [STATE] 搜索面板开关不影响编辑器内容 | 选择器: .cm-content; 操作: keyboard.press(ControlOrMeta+f) + keyboard.press(Escape); 控件: editor; 等待: 300ms |
| 3 | 断言编辑器内容不变 | [DOM] `.cm-content` 仍含 "independent test" | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 搜索面板操作不影响编辑器内容

---

# FP-02-04 livePreview 开关与自定义配置（[API契约][Live Preview]）

> demo 的 livePreview 受 settings.livePreview 控制（editor-shell.ts:147-316），默认 true。Settings 面板可切换。自定义配置为 image renderer（editor-shell.ts:150-313）。

## FP-02-04-N01 [P1] [正常] livePreview 默认开启 —— heading 折叠显示

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器 + 确保 settings.livePreview 为 true

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入 `# My Heading` | [DOM] `.cm-content` 含 heading 文本 | 选择器: .cm-content; 操作: keyboard.type("# My Heading"); 控件: editor; 等待: 300ms |
| 2 | 按 ArrowDown 移光标到下一空行（离开 heading 行） | [DOM] heading 折叠为 widget，`# ` 前缀隐藏（livePreview:true 时 editor-shell.ts:147-149 传 `{ enabled: true, renderers: {...} }`） | 选择器: .cm-content; 操作: keyboard.press(Enter) + keyboard.press(ArrowDown); 控件: editor; 等待: 200ms |
| 3 | 断言 heading 折叠 —— textContent 不含 "# " 但含 "My Heading" | [DOM] textContent 含 "My Heading" 且不含 "# My Heading"（`# ` 被 Decoration.replace 隐藏） | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |
| 4 | 断言 heading widget 属性 | [DOM] `[data-heading-level='1']` 存在 | 选择器: [data-heading-level='1']; 操作: count(); 控件: heading-widget; 等待: 无 |

**断言汇总**:
- [DOM] heading 折叠，`# ` 隐藏
- [DOM] `[data-heading-level='1']` widget 存在

---

## FP-02-04-N02 [P1] [正常] Settings 切换 livePreview 关闭 —— heading 源码可见

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器 + settings.livePreview 为 true（默认）

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入 `# Test Heading` | [DOM] `.cm-content` 含 heading | 选择器: .cm-content; 操作: keyboard.type("# Test Heading"); 控件: editor; 等待: 300ms |
| 2 | 打开 Settings 面板（⚙ 按钮） | [DOM] 设置面板可见 | 选择器: button[title="Settings"]; 操作: click(); 控件: settings-btn; 等待: 500ms |
| 3 | 找到 "Live preview" 开关并点击关闭 | [STATE] settings.livePreview = false，触发 shell.applySettings → editor.setTheme（settings.ts:273 toggle，app.ts:178-181） | 选择器: div[style*="position: fixed"] button; 操作: evaluate 查找含 "Live preview" 的行并 click toggle; 控件: toggle; 等待: 500ms |
| 4 | 关闭 Settings（Escape），移光标到 heading 行外 | [DOM] heading 不再折叠，`# ` 源码可见（livePreview:false 时 editor-shell.ts:316 传 `livePreview: false`，CM6 不应用 live-preview 装饰） | 选择器: .cm-content; 操作: keyboard.press(Escape) + keyboard.press(ArrowDown); 控件: editor; 等待: 500ms |
| 5 | 断言 `.cm-content` textContent 含 "# Test Heading" 或 "# " 前缀 | [DOM] 源码可见（`# ` 不被隐藏） | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |
| 6 | 恢复 livePreview 为 true（重新打开 Settings 切换） | [STATE] 恢复默认设置 | 选择器: button[title="Settings"]; 操作: click() + toggle + Escape; 控件: settings; 等待: 500ms |

**断言汇总**:
- [DOM] livePreview 关闭后 heading 源码 `# ` 可见

---

## FP-02-04-N03 [P1] [正常] livePreview 开启时行内格式（bold）折叠

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器 + livePreview 为 true

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入 `This is **bold** text` | [DOM] `.cm-content` 含输入文本 | 选择器: .cm-content; 操作: keyboard.type("This is **bold** text"); 控件: editor; 等待: 300ms |
| 2 | 移光标到行末之外（ArrowDown 到空行） | [DOM] bold 折叠，`**` 标记隐藏（行级光标检测，光标离开所在行即折叠） | 选择器: .cm-content; 操作: keyboard.press(ArrowDown); 控件: editor; 等待: 200ms |
| 3 | 断言 textContent 含 "bold" 但不含 "**" | [DOM] `**` 被 Decoration.replace 隐藏，仅 "bold" 加粗显示 | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] `**` 标记隐藏，bold 文本可见

---

## FP-02-04-N04 [P2] [正常] 自定义 image renderer —— 图片语法渲染为 widget

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器 + livePreview 为 true

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入图片语法 `![alt text](https://example.com/img.png)` | [DOM] `.cm-content` 含图片语法 | 选择器: .cm-content; 操作: keyboard.type("![alt text](https://example.com/img.png)"); 控件: editor; 等待: 500ms |
| 2 | 移光标到行外触发折叠 | [DOM] 图片渲染为 `.nexus-image` wrapper（editor-shell.ts:163 wrapper.className = "nexus-image"，自定义 renderer 走"始终 widget 折叠"分支） | 选择器: .cm-content; 操作: keyboard.press(ArrowDown); 控件: editor; 等待: 300ms |
| 3 | 断言 `.nexus-image` wrapper 存在 | [DOM] `[data-live-preview-image]` 或 `.nexus-image` 存在 | 选择器: .nexus-image, [data-live-preview-image]; 操作: count(); 控件: image-widget; 等待: 无 |
| 4 | 断言 wrapper 内含 img 元素（可能因网络错误显示占位） | [DOM] `.nexus-image img` 或 `.nexus-image span`（error 占位）存在 | 选择器: .nexus-image img, .nexus-image span; 操作: count(); 控件: image-widget; 等待: 无 |

**断言汇总**:
- [DOM] `.nexus-image` wrapper 存在
- [DOM] wrapper 内含 img 或 error 占位

---

## FP-02-04-N05 [P2] [正常] 自定义 image renderer —— 图片尺寸解析（alt|width）

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器 + livePreview 为 true

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入 `![pic|300](https://example.com/img.png)` | [DOM] `.cm-content` 含图片语法（parseImageSize 解析 `|300` 为 width=300，editor-shell.ts:23-35） | 选择器: .cm-content; 操作: keyboard.type("![pic|300](https://example.com/img.png)"); 控件: editor; 等待: 500ms |
| 2 | 移光标到行外触发折叠 | [DOM] 图片 widget 渲染，img.style.width = "300px"（editor-shell.ts:178 `img.style.width = width + "px"`） | 选择器: .cm-content; 操作: keyboard.press(ArrowDown); 控件: editor; 等待: 300ms |
| 3 | 断言 img 的 width 样式 | [DOM] `.nexus-image img` 的 style 含 "width: 300px" 或 "300px" | 选择器: .nexus-image img; 操作: evaluate(el => el.style.width); 控件: image-widget; 等待: 无 |

**断言汇总**:
- [DOM] img 宽度样式为 300px

---

## FP-02-04-B01 [P4] [边界] livePreview 切换后恢复 —— 重新开启折叠正常

**测试框架**: Playwright

**前置条件**: 全局 setup + livePreview 已被关闭再重新开启

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 输入 `# Recheck`，确保之前已切换 livePreview off→on | [DOM] `.cm-content` 含 heading | 选择器: .cm-content; 操作: keyboard.type("# Recheck"); 控件: editor; 等待: 300ms |
| 2 | 移光标到行外 | [DOM] heading 折叠（livePreview 重新开启后装饰恢复） | 选择器: .cm-content; 操作: keyboard.press(ArrowDown); 控件: editor; 等待: 300ms |
| 3 | 断言 `[data-heading-level='1']` 存在 | [DOM] heading widget 恢复折叠渲染 | 选择器: [data-heading-level='1']; 操作: count(); 控件: heading-widget; 等待: 无 |

**断言汇总**:
- [DOM] livePreview 恢复后 heading 折叠正常

---

## FP-02-04-E01 [P3] [异常] livePreview 关闭时表格不折叠为 widget

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器 + livePreview 已关闭

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 关闭 livePreview（Settings 切换），输入表格 `| a | b |\n|---|---|\n| 1 | 2 |` | [DOM] `.cm-content` 含表格源码 | 选择器: .cm-content; 操作: keyboard.type(); 控件: editor; 等待: 500ms |
| 2 | 移光标到表格之外 | [DOM] 表格源码可见，`|` 字符不被隐藏（livePreview:false 时 `livePreview: false` 传给 createEditor，无装饰） | 选择器: .cm-content; 操作: keyboard.press(ArrowDown); 控件: editor; 等待: 300ms |
| 3 | 断言 textContent 含 "| a | b |" 源码 | [DOM] 表格源码完整可见 | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |
| 4 | 断言 `.nexus-table-wrapper` 不存在 | [DOM] 无表格 widget | 选择器: .nexus-table-wrapper; 操作: count(); 控件: table-widget; 等待: 无 |
| 5 | 恢复 livePreview 为 true | [STATE] 恢复默认 | 选择器: button[title="Settings"]; 操作: click() + toggle + Escape; 控件: settings; 等待: 500ms |

**断言汇总**:
- [DOM] livePreview 关闭时表格源码可见，无 widget

---

# FP-02-05 theme 主题设置（[API契约]）

> demo 通过 settingsToTheme(settings) 映射主题（settings.ts:48-57），Settings 面板可切换 colorScheme（light/dark）、fontSize、fontFamily。shell.applySettings 调用 editor.setTheme。

## FP-02-05-N01 [P1] [正常] 默认 light 主题 —— CSS 变量应用

**测试框架**: Playwright

**前置条件**: 全局 setup（demo 已启动，默认 colorScheme: "light"）

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 查找 `.cm-editor` 或 `.editor-container` 的计算样式 | [DOM] 背景色为 light 主题值（settings.ts:49 `settings.colorScheme === "dark" ? darkTheme : lightTheme`，默认 light） | 选择器: .cm-editor; 操作: evaluate(el => getComputedStyle(el)); 控件: editor; 等待: 无 |
| 2 | 断言 `--nexus-bg` CSS 变量为浅色值 | [DOM] `--nexus-bg` 为白色或浅色（lightTheme 定义） | 选择器: .cm-editor; 操作: evaluate(el => getComputedStyle(el).getPropertyValue('--nexus-bg')); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] light 主题 CSS 变量生效

---

## FP-02-05-N02 [P1] [正常] Settings 切换 dark 主题 —— 背景变暗

**测试框架**: Playwright

**前置条件**: 全局 setup + 当前为 light 主题

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 记录切换前 `.cm-editor` 的背景色 | [DOM] 当前为浅色背景 | 选择器: .cm-editor; 操作: evaluate(el => getComputedStyle(el).backgroundColor); 控件: editor; 等待: 无 |
| 2 | 打开 Settings，将 Color scheme 切换为 "dark" | [STATE] settings.colorScheme = "dark"，shell.applySettings → editor.setTheme(darkTheme)（settings.ts:271 select 控件） | 选择器: button[title="Settings"]; 操作: click(); 控件: settings-btn; 等待: 500ms |
| 3 | 在 Settings 面板找到 Color scheme 的 select，选择 "dark" | [DOM] select 值变为 "dark" | 选择器: div[style*="position: fixed"] select; 操作: selectOption("dark"); 控件: select; 等待: 500ms |
| 4 | 关闭 Settings（Escape） | [STATE] 主题已应用 | 选择器: .cm-content; 操作: keyboard.press(Escape); 控件: editor; 等待: 500ms |
| 5 | 断言 `.cm-editor` 背景色变为暗色 | [DOM] 背景色为 dark 主题值（darkTheme 定义） | 选择器: .cm-editor; 操作: evaluate(el => getComputedStyle(el).backgroundColor); 控件: editor; 等待: 无 |
| 6 | 恢复为 light 主题 | [STATE] 恢复默认 | 选择器: button[title="Settings"]; 操作: click() + selectOption("light") + Escape; 控件: settings; 等待: 500ms |

**断言汇总**:
- [DOM] dark 主题背景色与 light 不同

---

## FP-02-05-N03 [P2] [正常] fontSize 设置变更 —— 字号更新

**测试框架**: Playwright

**前置条件**: 全局 setup + 默认 fontSize: 15

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 记录切换前 `.cm-content` 的 font-size | [DOM] 默认 15px（settings.ts:26 defaultSettings fontSize: 15） | 选择器: .cm-content; 操作: evaluate(el => getComputedStyle(el).fontSize); 控件: editor; 等待: 无 |
| 2 | 打开 Settings，拖动 Font size 滑块到 20 | [STATE] settings.fontSize = 20（settings.ts:280 createNumberInput，range input） | 选择器: button[title="Settings"]; 操作: click(); 控件: settings-btn; 等待: 500ms |
| 3 | 找到 Font size range input，设置为 20 | [DOM] range 值变为 20 | 选择器: div[style*="position: fixed"] input[type="range"]; 操作: evaluate 设置 value=20 并 dispatch change; 控件: range; 等待: 500ms |
| 4 | 关闭 Settings，断言 `.cm-content` font-size 变为 20px | [DOM] font-size 为 "20px"（settingsToTheme 传入 fontSize，editor.setTheme 应用） | 选择器: .cm-content; 操作: evaluate(el => getComputedStyle(el).fontSize); 控件: editor; 等待: 500ms |
| 5 | 恢复 fontSize 为 15 | [STATE] 恢复默认 | 选择器: button[title="Settings"]; 操作: click() + range=15 + Escape; 控件: settings; 等待: 500ms |

**断言汇总**:
- [DOM] font-size 随设置变更更新

---

## FP-02-05-N04 [P2] [正常] fontFamily 设置变更 —— 字体族更新

**测试框架**: Playwright

**前置条件**: 全局 setup + 默认字体

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 记录切换前 `.cm-content` 的 font-family | [DOM] 默认字体族 | 选择器: .cm-content; 操作: evaluate(el => getComputedStyle(el).fontFamily); 控件: editor; 等待: 无 |
| 2 | 打开 Settings，修改 Body font 为 "Georgia, serif" | [STATE] settings.fontFamily 变更（settings.ts:281 textInput） | 选择器: button[title="Settings"]; 操作: click(); 控件: settings-btn; 等待: 500ms |
| 3 | 找到 Body font text input，输入 "Georgia, serif" 并触发 change | [DOM] input 值更新 | 选择器: div[style*="position: fixed"] input[type="text"]; 操作: fill() + dispatch change; 控件: text-input; 等待: 500ms |
| 4 | 关闭 Settings，断言 `.cm-content` font-family 含 "Georgia" | [DOM] font-family 更新（settingsToTheme 传入 fontFamily） | 选择器: .cm-content; 操作: evaluate(el => getComputedStyle(el).fontFamily); 控件: editor; 等待: 500ms |

**断言汇总**:
- [DOM] font-family 随设置变更更新

---

## FP-02-05-D01 [P3] [数据] 主题切换后编辑器内容不变

**测试框架**: Playwright

**前置条件**: 全局 setup + 编辑器有内容

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 输入 "# Theme Persistence" | [DOM] `.cm-content` 含文本 | 选择器: .cm-content; 操作: keyboard.type("# Theme Persistence"); 控件: editor; 等待: 300ms |
| 2 | 切换 dark 主题再切回 light | [STATE] 主题切换两次 | 选择器: button[title="Settings"]; 操作: click() + selectOption("dark") + selectOption("light") + Escape; 控件: settings; 等待: 1s |
| 3 | 断言编辑器内容不变 | [DOM] `.cm-content` 仍含 "Theme Persistence" | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 主题切换不影响编辑器文档内容

---

## FP-02-05-B01 [P4] [边界] 主题持久化 —— 重启后保留（localStorage）

**测试框架**: Playwright

**前置条件**: 全局 setup + 已将主题设为 dark

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 确认 localStorage 中 settings 含 colorScheme: "dark" | [STATE] localStorage "nexus-editor-settings" 含 dark（settings.ts:42 saveSettings 写入 STORAGE_KEY） | 选择器: body; 操作: evaluate(() => localStorage.getItem("nexus-editor-settings")); 控件: storage; 等待: 无 |
| 2 | 断言存储值含 "dark" | [STATE] JSON 含 `"colorScheme":"dark"` | 选择器: body; 操作: evaluate(() => localStorage.getItem("nexus-editor-settings")); 控件: storage; 等待: 无 |

**断言汇总**:
- [STATE] 设置持久化到 localStorage

---

# FP-02-06 tabSize / direction / indentGuides（[API契约][编辑交互]）

> demo 通过 settings 传入 createEditor（editor-shell.ts:318-320）。Settings 面板可调整 tabSize（1-8）和 direction（ltr/rtl），indentGuides 可切换。

## FP-02-06-N01 [P1] [正常] 默认 tabSize 4 —— Tab 键插入 4 空格

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器 + 默认 tabSize: 4

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后按 Tab 键 | [DOM] `.cm-content` 插入缩进（editor-shell.ts:318 `tabSize: settings.tabSize`，默认 4，settings.ts:26） | 选择器: .cm-content; 操作: click() + keyboard.press(Tab); 控件: editor; 等待: 100ms |
| 2 | 断言插入了空格缩进 | [DOM] `.cm-line` 含 4 个空格的缩进（CM6 tabSize 配置将 Tab 转为指定空格数） | 选择器: .cm-content .cm-line; 操作: evaluate(el => el.textContent); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] Tab 键插入缩进空格

---

## FP-02-06-N02 [P1] [正常] Settings 切换 tabSize 为 2 —— Tab 键插入 2 空格

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器 + 默认 tabSize: 4

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 打开 Settings，将 Tab size 设置为 2 | [STATE] settings.tabSize = 2（settings.ts:286 createNumberInput） | 选择器: button[title="Settings"]; 操作: click(); 控件: settings-btn; 等待: 500ms |
| 2 | 找到 Tab size range input，设置为 2 | [DOM] range 值为 2 | 选择器: div[style*="position: fixed"] input[type="range"]; 操作: evaluate 设置 value=2 并 dispatch; 控件: range; 等待: 500ms |
| 3 | 关闭 Settings，清空编辑器，按 Tab | [DOM] 插入缩进 | 选择器: .cm-content; 操作: keyboard.press(Escape) + click() + ControlOrMeta+a + Backspace + keyboard.press(Tab); 控件: editor; 等待: 500ms |
| 4 | 断言缩进为 2 空格 | [DOM] `.cm-line` 缩进空格数减少（对比 tabSize=4） | 选择器: .cm-content .cm-line; 操作: evaluate(el => el.textContent.length); 控件: editor; 等待: 无 |
| 5 | 恢复 tabSize 为 4 | [STATE] 恢复默认 | 选择器: button[title="Settings"]; 操作: click() + range=4 + Escape; 控件: settings; 等待: 500ms |

**断言汇总**:
- [DOM] tabSize=2 时缩进空格数少于 tabSize=4

---

## FP-02-06-N03 [P2] [正常] 默认 direction ltr —— 文本左到右

**测试框架**: Playwright

**前置条件**: 全局 setup + 默认 direction: "ltr"

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言 `.cm-content` 的 direction 样式 | [DOM] direction 为 "ltr" 或默认（editor-shell.ts:319 `direction: settings.direction`，默认 "ltr"，settings.ts:26） | 选择器: .cm-content; 操作: evaluate(el => getComputedStyle(el).direction); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 默认文本方向为 ltr

---

## FP-02-06-N04 [P2] [正常] Settings 切换 direction 为 rtl —— 文本右到左

**测试框架**: Playwright

**前置条件**: 全局 setup + 默认 direction: "ltr"

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 打开 Settings，将 Text direction 切换为 "rtl" | [STATE] settings.direction = "rtl"（settings.ts:276 select） | 选择器: button[title="Settings"]; 操作: click(); 控件: settings-btn; 等待: 500ms |
| 2 | 找到 Text direction select，选择 "rtl" | [DOM] select 值为 "rtl" | 选择器: div[style*="position: fixed"] select; 操作: evaluate 找到 direction select 并 selectOption("rtl"); 控件: select; 等待: 500ms |
| 3 | 关闭 Settings，断言 `.cm-content` direction 为 "rtl" | [DOM] direction 样式为 "rtl" | 选择器: .cm-content; 操作: evaluate(el => getComputedStyle(el).direction); 控件: editor; 等待: 500ms |
| 4 | 恢复 direction 为 "ltr" | [STATE] 恢复默认 | 选择器: button[title="Settings"]; 操作: click() + selectOption("ltr") + Escape; 控件: settings; 等待: 500ms |

**断言汇总**:
- [DOM] direction 切换为 rtl 后样式生效

---

## FP-02-06-N05 [P2] [正常] 默认 indentGuides 关闭 —— 无缩进引导线

**测试框架**: Playwright

**前置条件**: 全局 setup + 默认 indentGuides: false

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 输入带缩进的多行文本（Tab + text + Enter + Tab Tab + text） | [DOM] `.cm-content` 含缩进内容 | 选择器: .cm-content; 操作: keyboard.type + Tab; 控件: editor; 等待: 300ms |
| 2 | 断言无缩进引导线元素 | [DOM] 无 `.cm-indent` 或 indent-guide 相关 class（editor-shell.ts:320 `indentGuides: settings.indentGuides`，默认 false） | 选择器: .cm-indent; 操作: count(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 默认无缩进引导线

---

## FP-02-06-N06 [P2] [正常] Settings 开启 indentGuides —— 缩进引导线出现

**测试框架**: Playwright

**前置条件**: 全局 setup + 默认 indentGuides: false

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 打开 Settings，开启 Indent guides | [STATE] settings.indentGuides = true（settings.ts:274 toggle） | 选择器: button[title="Settings"]; 操作: click(); 控件: settings-btn; 等待: 500ms |
| 2 | 找到 Indent guides toggle 并点击开启 | [DOM] toggle 状态变更 | 选择器: div[style*="position: fixed"] button; 操作: evaluate 找到 Indent guides toggle 并 click; 控件: toggle; 等待: 500ms |
| 3 | 关闭 Settings，输入带缩进的文本（Tab + text） | [DOM] `.cm-content` 含缩进 | 选择器: .cm-content; 操作: keyboard.press(Escape) + click() + keyboard.press(Tab) + keyboard.type("indented"); 控件: editor; 等待: 500ms |
| 4 | 断言缩进引导线元素出现 | [DOM] `.cm-indent` 或 indent-guide 元素存在 | 选择器: .cm-indent; 操作: count(); 控件: editor; 等待: 无 |
| 5 | 恢复 indentGuides 为 false | [STATE] 恢复默认 | 选择器: button[title="Settings"]; 操作: click() + toggle + Escape; 控件: settings; 等待: 500ms |

**断言汇总**:
- [DOM] indentGuides 开启后引导线出现

---

## FP-02-06-B01 [P4] [边界] tabSize 边界值 1 和 8

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 打开 Settings，设置 Tab size 为 1（最小值） | [STATE] settings.tabSize = 1（settings.ts:286 range min=1） | 选择器: button[title="Settings"]; 操作: click() + range=1 + Escape; 控件: settings; 等待: 500ms |
| 2 | 清空编辑器，按 Tab | [DOM] 插入 1 空格缩进 | 选择器: .cm-content; 操作: click() + ControlOrMeta+a + Backspace + keyboard.press(Tab); 控件: editor; 等待: 500ms |
| 3 | 打开 Settings，设置 Tab size 为 8（最大值） | [STATE] settings.tabSize = 8（range max=8） | 选择器: button[title="Settings"]; 操作: click() + range=8 + Escape; 控件: settings; 等待: 500ms |
| 4 | 清空编辑器，按 Tab | [DOM] 插入 8 空格缩进 | 选择器: .cm-content; 操作: click() + ControlOrMeta+a + Backspace + keyboard.press(Tab); 控件: editor; 等待: 500ms |
| 5 | 恢复 tabSize 为 4 | [STATE] 恢复默认 | 选择器: button[title="Settings"]; 操作: click() + range=4 + Escape; 控件: settings; 等待: 500ms |

**断言汇总**:
- [DOM] tabSize=1 和 tabSize=8 均能正常工作

---

# FP-02-07 readOnly 只读模式（[API契约][编辑交互]）

> ⚠️ demo 固化配置未设 readOnly（默认 false），demo UI 无 readOnly 切换入口。此组用例标注"待确认"——需确认 demo 是否有隐藏的 readOnly 入口或通过 evaluate 修改。以下用例通过验证默认可编辑状态来间接覆盖。

## FP-02-07-N01 [P1] [正常] demo 默认可编辑 —— 键盘输入生效

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入 "editable check" | [DOM] `.cm-content` 含 "editable check"（demo 未设 readOnly，默认 false，editor.ts:546） | 选择器: .cm-content; 操作: keyboard.type("editable check"); 控件: editor; 等待: 200ms |
| 2 | 断言 `.cm-content` 的 contentEditable 属性 | [DOM] `.cm-content` contentEditable 为 "true" 或 CM6 可编辑状态 | 选择器: .cm-content; 操作: evaluate(el => el.contentEditable); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 编辑器可编辑（默认非 readOnly）

---

## FP-02-07-N02 [P2] [正常] 编辑器接受 Backspace 删除

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器 + 已输入文本

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入 "delete me" | [DOM] `.cm-content` 含 "delete me" | 选择器: .cm-content; 操作: keyboard.type("delete me"); 控件: editor; 等待: 200ms |
| 2 | 按 Backspace 3 次 | [DOM] 删除 3 个字符，剩余 "delete" | 选择器: .cm-content; 操作: keyboard.press(Backspace) x3; 控件: editor; 等待: 200ms |
| 3 | 断言 `.cm-content` textContent 含 "delete" 且不含 "delete me" | [DOM] 内容被删除 | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] Backspace 删除生效

---

## FP-02-07-N03 [P2] [正常] 编辑器接受粘贴操作

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器，模拟粘贴 "pasted content" | [DOM] `.cm-content` 含 "pasted content"（非 readOnly 模式接受粘贴） | 选择器: .cm-content; 操作: click() + evaluate(() => document.execCommand("insertText", false, "pasted content")); 控件: editor; 等待: 200ms |
| 2 | 断言内容存在 | [DOM] textContent 含 "pasted content" | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 粘贴操作生效

---

## FP-02-07-E01 [P3] [异常] 【待确认】readOnly 模式下键盘输入无效

**测试框架**: Playwright

**前置条件**: ⚠️ 待确认 —— demo 无 readOnly 切换入口，需通过 evaluate 修改 CM6 EditorState 或确认是否有隐藏配置

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 【待确认】通过 evaluate 将编辑器设为 readOnly（如 `editor.dispatch({ effects: StateEffect.reconfigure.of(EditorState.readOnly.of(true)) })`） | [STATE] 编辑器进入只读模式 | 选择器: .cm-content; 操作: evaluate(); 控件: editor; 等待: 无 |
| 2 | 尝试键盘输入 "should not appear" | [DOM] 输入被拒绝（readOnly 模式 CM6 拦截编辑事务） | 选择器: .cm-content; 操作: keyboard.type(); 控件: editor; 等待: 200ms |
| 3 | 断言 `.cm-content` 不含 "should not appear" | [DOM] 内容未改变 | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 【待确认】readOnly 模式下输入无效

---

## FP-02-07-B01 [P4] [边界] 【待确认】readOnly 切换后恢复可编辑

**测试框架**: Playwright

**前置条件**: ⚠️ 待确认 —— 需能切换 readOnly 状态

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 【待确认】设为 readOnly 再切回可编辑 | [STATE] 编辑器恢复可编辑 | 选择器: .cm-content; 操作: evaluate(); 控件: editor; 等待: 无 |
| 2 | 输入 "recovered" | [DOM] 输入生效 | 选择器: .cm-content; 操作: keyboard.type("recovered"); 控件: editor; 等待: 200ms |
| 3 | 断言内容含 "recovered" | [DOM] 恢复可编辑后输入正常 | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 【待确认】readOnly 切换后恢复可编辑

---

# FP-02-08 multiCursor 多光标开关（[API契约][编辑交互]）

> demo 固化配置 `multiCursor: true`（editor-shell.ts:138）。通过 Mod-d（selectNextOccurrence）和 Alt-click 验证。

## FP-02-08-N01 [P1] [正常] multiCursor 开启 —— Mod-d 选中下一个匹配

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器 + demo 固化 multiCursor: true（editor-shell.ts:138）

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入 "foo bar foo baz foo" | [DOM] `.cm-content` 含三个 "foo" | 选择器: .cm-content; 操作: keyboard.type("foo bar foo baz foo"); 控件: editor; 等待: 300ms |
| 2 | 移光标到第一个 "foo" 并双击选中 | [DOM] 第一个 "foo" 被选中 | 选择器: .cm-content; 操作: dbclick(); 控件: editor; 等待: 100ms |
| 3 | 按 ControlOrMeta+d（selectNextOccurrence） | [DOM] 第二个 "foo" 也被选中，产生两个选区（demo-requirements §3.6 Mod-d，multiCursor:true 启用） | 选择器: .cm-content; 操作: keyboard.press(ControlOrMeta+d); 控件: editor; 等待: 200ms |
| 4 | 断言存在多个选区（通过 CM6 selection 数量验证） | [STATE] 选区数量 >= 2 | 选择器: .cm-content; 操作: evaluate 查询选区数; 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] Mod-d 选中多个匹配文本

---

## FP-02-08-N02 [P2] [正常] multiCursor 开启 —— Mod-Esc 收缩为单选区

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器 + 已通过 Mod-d 产生多选区

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 输入 "foo foo"，选中第一个 "foo" 后按 Mod+d 两次产生多选区 | [STATE] 存在多个选区 | 选择器: .cm-content; 操作: keyboard.type + dbclick + ControlOrMeta+d; 控件: editor; 等待: 300ms |
| 2 | 按 ControlOrMeta+Escape（collapseToMainSelection） | [STATE] 选区收缩为主选区，仅 1 个光标（demo-requirements §3.6 Mod-Esc） | 选择器: .cm-content; 操作: keyboard.press(ControlOrMeta+Escape); 控件: editor; 等待: 200ms |
| 3 | 断言选区数量为 1 | [STATE] selection.rangeCount === 1 | 选择器: .cm-content; 操作: evaluate 查询选区数; 控件: editor; 等待: 无 |

**断言汇总**:
- [STATE] Mod-Esc 后收缩为单选区

---

## FP-02-08-N03 [P2] [正常] Alt-click 添加光标

**测试框架**: Playwright

**前置条件**: 全局 setup + 编辑器有多行内容

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 输入 "line1\nline2\nline3"（用 Enter 分行） | [DOM] `.cm-content` 含三行 | 选择器: .cm-content; 操作: keyboard.type; 控件: editor; 等待: 300ms |
| 2 | Alt-click 第二行某位置 | [DOM] 第二行添加光标，存在多个光标（demo-requirements §3.6 Alt-click，multiCursor:true 启用） | 选择器: .cm-content; 操作: click({ modifiers: ["Alt"] }); 控件: editor; 等待: 200ms |
| 3 | 断言选区数量 >= 2 | [STATE] selection.rangeCount >= 2 | 选择器: .cm-content; 操作: evaluate 查询选区数; 控件: editor; 等待: 无 |

**断言汇总**:
- [STATE] Alt-click 后存在多个光标

---

## FP-02-08-B01 [P4] [边界] Mod-Alt-ArrowDown 向下添加光标

**测试框架**: Playwright

**前置条件**: 全局 setup + 编辑器有多行内容

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 输入两行文本 "first\nsecond" | [DOM] `.cm-content` 含两行 | 选择器: .cm-content; 操作: keyboard.type; 控件: editor; 等待: 300ms |
| 2 | 光标在第一行，按 ControlOrMeta+Alt+ArrowDown（addCursorBelow） | [STATE] 下一行添加光标，选区数量增加（demo-requirements §3.6 Mod-Alt-Arrow） | 选择器: .cm-content; 操作: keyboard.press(ControlOrMeta+Alt+ArrowDown); 控件: editor; 等待: 200ms |
| 3 | 断言选区数量 >= 2 | [STATE] 存在多个光标 | 选择器: .cm-content; 操作: evaluate 查询选区数; 控件: editor; 等待: 无 |

**断言汇总**:
- [STATE] Mod-Alt-ArrowDown 向下添加光标

---

## FP-02-08-E01 [P3] [异常] 多光标同时输入 —— 各位置同步编辑

**测试框架**: Playwright

**前置条件**: 全局 setup + 已有多光标（通过 Mod-d 或 Alt-click）

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 输入 "x x"，选中第一个 "x"，Mod+d 产生 2 个光标 | [STATE] 2 个选区 | 选择器: .cm-content; 操作: keyboard.type + dbclick + ControlOrMeta+d; 控件: editor; 等待: 300ms |
| 2 | 输入 "Y" | [DOM] 两个位置同时变为 "Y"（多光标同步编辑） | 选择器: .cm-content; 操作: keyboard.type("Y"); 控件: editor; 等待: 200ms |
| 3 | 断言 `.cm-content` 含两个 "Y" | [DOM] textContent 含 "Y" 且原 "x" 被替换 | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 多光标同步输入生效

---

# FP-02-09 slashMenuLimit 斜杠菜单最大显示数（[API契约]）

> ⚠️ demo 固化配置未设 slashMenuLimit（默认 8）。demo 的工具栏插件提供 14 条斜杠命令。通过输入 `/` 触发菜单并计数验证。

## FP-02-09-N01 [P1] [正常] 输入 `/` 触发斜杠菜单 —— 默认显示最多 8 条

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入 `/` | [DOM] 斜杠菜单出现（createSlashPlugin + createSlashMenuUI，editor-shell.ts:341） | 选择器: .cm-content; 操作: keyboard.type("/"); 控件: editor; 等待: 500ms |
| 2 | 断言斜杠菜单可见 | [DOM] 菜单容器存在（浮动定位到 document.body） | 选择器: body div[role="listbox"], .nexus-slash-menu; 操作: count(); 控件: slash-menu; 等待: 无 |
| 3 | 断言菜单项数量 <= 8（默认 slashMenuLimit: 8） | [DOM] 可见菜单项 <= 8 条（demo-requirements §3.1 slashMenuLimit 默认 8） | 选择器: [role="option"], .nexus-slash-item; 操作: count(); 控件: slash-menu; 等待: 无 |

**断言汇总**:
- [DOM] 斜杠菜单出现
- [DOM] 菜单项 <= 8

---

## FP-02-09-N02 [P1] [正常] 斜杠菜单输入过滤 —— "h" 过滤后显示 heading 命令

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入 `/h` | [DOM] 斜杠菜单过滤为 heading 相关命令（h1/h2/h3 标题命令，demo-requirements §7.3） | 选择器: .cm-content; 操作: keyboard.type("/h"); 控件: editor; 等待: 500ms |
| 2 | 断言菜单项含 heading 相关 | [DOM] 菜单项文本含 "Heading" 或 "h1"/"h2"/"h3" | 选择器: [role="option"], .nexus-slash-item; 操作: allTextContents(); 控件: slash-menu; 等待: 无 |
| 3 | 按 Escape 关闭菜单 | [STATE] 菜单消失 | 选择器: .cm-content; 操作: keyboard.press(Escape); 控件: editor; 等待: 200ms |

**断言汇总**:
- [DOM] `/h` 过滤显示 heading 命令

---

## FP-02-09-N03 [P2] [正常] 斜杠菜单 ArrowDown/ArrowUp 高亮切换

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器 + 已触发斜杠菜单

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入 `/` 触发菜单 | [DOM] 菜单出现，默认第一项高亮 | 选择器: .cm-content; 操作: keyboard.type("/"); 控件: editor; 等待: 500ms |
| 2 | 按 ArrowDown | [DOM] 高亮项移动到第二项（demo-requirements §6.4 ArrowUp/Down 翻转高亮） | 选择器: .cm-content; 操作: keyboard.press(ArrowDown); 控件: editor; 等待: 200ms |
| 3 | 按 ArrowUp | [DOM] 高亮项回到第一项 | 选择器: .cm-content; 操作: keyboard.press(ArrowUp); 控件: editor; 等待: 200ms |
| 4 | 按 Escape 关闭 | [STATE] 菜单消失 | 选择器: .cm-content; 操作: keyboard.press(Escape); 控件: editor; 等待: 200ms |

**断言汇总**:
- [DOM] ArrowDown/Up 切换高亮项

---

## FP-02-09-N04 [P2] [正常] 斜杠菜单 Enter 确认 —— 执行命令

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器 + 已触发斜杠菜单

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入 `/bold` | [DOM] 菜单过滤为 "Bold" 命令 | 选择器: .cm-content; 操作: keyboard.type("/bold"); 控件: editor; 等待: 500ms |
| 2 | 按 Enter 确认 | [STATE] `/bold` 文本被删除，toggleBold 命令执行（demo-requirements §6.4 Enter 确认，§7.3 bold 命令） | 选择器: .cm-content; 操作: keyboard.press(Enter); 控件: editor; 等待: 300ms |
| 3 | 断言编辑器内容变化（bold 标记插入或菜单文本消失） | [DOM] `.cm-content` 不含 "/bold" | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] Enter 确认后命令执行

---

## FP-02-09-B01 [P4] [边界] 斜杠菜单项精确为 8 条上限（空查询时）

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入 `/`（空查询，显示全部） | [DOM] 菜单出现 | 选择器: .cm-content; 操作: keyboard.type("/"); 控件: editor; 等待: 500ms |
| 2 | 断言菜单项数量 === 8（工具栏插件 14 条命令，但 slashMenuLimit 默认 8 截断） | [DOM] 菜单项 count === 8 | 选择器: [role="option"], .nexus-slash-item; 操作: count(); 控件: slash-menu; 等待: 无 |
| 3 | 按 Escape 关闭 | [STATE] 菜单消失 | 选择器: .cm-content; 操作: keyboard.press(Escape); 控件: editor; 等待: 200ms |

**断言汇总**:
- [DOM] 空查询时菜单项恰好 8 条

---

## FP-02-09-E01 [P3] [异常] 斜杠菜单无匹配项时 —— 不显示或空菜单

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入 `/zzzznonexistent` | [DOM] 无匹配命令，菜单不出现或为空（filterSlashCommands 过滤无结果） | 选择器: .cm-content; 操作: keyboard.type("/zzzznonexistent"); 控件: editor; 等待: 500ms |
| 2 | 断言菜单不存在或无可见项 | [DOM] 斜杠菜单 count === 0 或菜单项 count === 0 | 选择器: .nexus-slash-menu, [role="option"]; 操作: count(); 控件: slash-menu; 等待: 无 |
| 3 | 按 Escape | [STATE] 恢复 | 选择器: .cm-content; 操作: keyboard.press(Escape); 控件: editor; 等待: 200ms |

**断言汇总**:
- [DOM] 无匹配时菜单为空

---

# FP-02-10 onChange/onFocus/onBlur/onAssetUpload 回调（[API契约][数据IO]）

> demo 已配置 onChange 回调（editor-shell.ts:321-330），onFocus/onBlur/onAssetUpload 未在 demo 中配置。
> - onChange: 验证 state.content 更新、dirty 标记、linkIndex 同步。
> - onFocus/onBlur/onAssetUpload: 标注"待确认"。

## FP-02-10-N01 [P1] [正常] onChange 回调 —— 输入后 state.content 更新

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入 "onChange test" | [DOM] `.cm-content` 含 "onChange test" | 选择器: .cm-content; 操作: keyboard.type("onChange test"); 控件: editor; 等待: 300ms |
| 2 | 断言状态栏显示 "[modified]"（onChange 触发 state.dirty = true） | [DOM] `#status-line` 含 "[modified]"（editor-shell.ts:321-325 onChange 设 state.content + state.dirty=true） | 选择器: #status-line; 操作: textContent(); 控件: status; 等待: 300ms（parseDelayMs 150 防抖） |
| 3 | 断言状态栏字数统计更新 | [DOM] `#status-line` 含 words 统计（onChange 后 onStateChange → renderStatus） | 选择器: #status-line; 操作: textContent(); 控件: status; 等待: 无 |

**断言汇总**:
- [DOM] onChange 触发后 dirty 标记出现
- [DOM] 状态栏统计更新

---

## FP-02-10-N02 [P1] [正常] onChange 回调 —— linkIndex 同步更新

**测试框架**: Playwright

**前置条件**: 全局 setup + 已打开 Vault + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入 `[[NewNote]]` | [DOM] `.cm-content` 含 wikilink | 选择器: .cm-content; 操作: keyboard.type("[[NewNote]]"); 控件: editor; 等待: 300ms |
| 2 | 断言 onChange 触发 linkIndex.updateFile（editor-shell.ts:326-328） | [STATE] linkIndex 已更新（反链面板能检测到该链接） | 选择器: .cm-content; 操作: evaluate 验证; 控件: editor; 等待: 300ms |
| 3 | 打开 Backlinks 面板（🔗 按钮），检查是否含 NewNote 的引用 | [DOM] 反链面板可能显示当前文件对 NewNote 的引用 | 选择器: button[title="Toggle backlinks panel"]; 操作: click(); 控件: backlinks-btn; 等待: 500ms |

**断言汇总**:
- [STATE] onChange 后 linkIndex 同步

---

## FP-02-10-N03 [P2] [正常] onChange 防抖 —— 快速连续输入只触发一次

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后快速输入 "a"、"b"、"c"（间隔 < 150ms） | [DOM] `.cm-content` 含 "abc" | 选择器: .cm-content; 操作: keyboard.type("abc"); 控件: editor; 等待: 500ms（parseDelayMs 150 防抖） |
| 2 | 断言状态栏最终统计正确（防抖后单次更新） | [DOM] `#status-line` 显示正确字数 | 选择器: #status-line; 操作: textContent(); 控件: status; 等待: 500ms |

**断言汇总**:
- [DOM] 防抖后状态正确

---

## FP-02-10-N04 [P2] [正常] onChange 回调 —— state.content 与编辑器内容一致

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入 "consistency check" | [DOM] `.cm-content` 含 "consistency check" | 选择器: .cm-content; 操作: keyboard.type("consistency check"); 控件: editor; 等待: 300ms |
| 2 | 通过 Save 保存后重新打开同一文件，验证内容一致 | [STATE] state.content 与磁盘文件一致（onChange 实时同步 state.content，Save 写入磁盘） | 选择器: button:has-text("Save"); 操作: click(); 控件: save-btn; 等待: 500ms |

**断言汇总**:
- [STATE] state.content 与保存内容一致

---

## FP-02-10-D01 [P3] [数据] onChange 不修改文档本身（纯通知）

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 输入 "original" | [DOM] `.cm-content` 含 "original" | 选择器: .cm-content; 操作: keyboard.type("original"); 控件: editor; 等待: 300ms |
| 2 | 追加输入 " text" | [DOM] `.cm-content` 含 "original text"（onChange 是通知回调，不修改文档） | 选择器: .cm-content; 操作: keyboard.type(" text"); 控件: editor; 等待: 200ms |
| 3 | 断言内容为 "original text"（onChange 回调未篡改内容） | [DOM] textContent 含 "original text" | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] onChange 回调不修改文档内容

---

## FP-02-10-E01 [P3] [异常] 【待确认】onFocus 回调 —— 编辑器获焦行为

**测试框架**: Playwright

**前置条件**: ⚠️ 待确认 —— demo 未配置 onFocus 回调（editor-shell.ts createEditor 调用无 onFocus 参数）

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 【待确认】点击编辑器使其获焦 | [STATE] 编辑器获焦（CM6 focus 事件触发，但 demo 无 onFocus 回调，无外部副作用可验证） | 选择器: .cm-content; 操作: click(); 控件: editor; 等待: 200ms |
| 2 | 断言编辑器获焦（`.cm-editor` 有 cm-focused class） | [DOM] `.cm-editor.cm-focused` 或 `.cm-content` 处于聚焦态 | 选择器: .cm-focused, .cm-content:focus; 操作: count(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 【待确认】编辑器获焦状态可验证，但无 onFocus 回调副作用

---

## FP-02-10-E02 [P3] [异常] 【待确认】onBlur 回调 —— 编辑器失焦行为

**测试框架**: Playwright

**前置条件**: ⚠️ 待确认 —— demo 未配置 onBlur 回调

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 点击编辑器获焦，再点击编辑器外部（如工具栏按钮） | [STATE] 编辑器失焦（CM6 blur 事件触发，demo 无 onBlur 回调） | 选择器: .toolbar button; 操作: click(); 控件: toolbar; 等待: 200ms |
| 2 | 断言 `.cm-content` 不再处于聚焦态 | [DOM] `.cm-focused` 消失或 `.cm-content:focus` 不存在 | 选择器: .cm-focused; 操作: count(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 【待确认】编辑器失焦状态可验证，但无 onBlur 回调副作用

---

## FP-02-10-E03 [P3] [异常] 【待确认】onAssetUpload 回调 —— 文件拖拽上传

**测试框架**: Playwright

**前置条件**: ⚠️ 待确认 —— demo 未配置 onAssetUpload 回调（editor-shell.ts createEditor 调用无 onAssetUpload 参数），uploadAsset 会返回 null

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 【待确认】构造 DataTransfer 模拟图片拖拽到编辑器 | [DOM] drop 事件触发（demo 无 onAssetUpload，uploadAsset 返回 null，不插入图片 markdown） | 选择器: .cm-content; 操作: evaluate 模拟 drop 事件; 控件: editor; 等待: 300ms |
| 2 | 断言编辑器无图片 markdown 插入（因无 onAssetUpload 回调） | [DOM] `.cm-content` 不含 `![](...)` 新增内容 | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 【待确认】无 onAssetUpload 时拖拽不上传

---

## FP-02-10-B01 [P4] [边界] onChange 在空文档时不触发 dirty（loadDocument silent）

**测试框架**: Playwright

**前置条件**: 全局 setup + 已通过 Vault 打开文件（loadDocument silent 模式）

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 通过 Vault 面板打开一个文件 | [STATE] loadDocument 以 silent 模式加载，不触发 onChange（editor-shell.ts:362-363） | 选择器: .vault-panel-file; 操作: click(); 控件: vault; 等待: 500ms |
| 2 | 断言状态栏不显示 "[modified]" | [DOM] `#status-line` 不含 "[modified]"（silent 模式跳过 onChange，state.dirty = false） | 选择器: #status-line; 操作: textContent(); 控件: status; 等待: 300ms |

**断言汇总**:
- [DOM] silent 加载不触发 dirty 标记

---

## 统计汇总

### 类型分布

| 类型 | 数量 | 占比 |
|------|------|------|
| 正常(N) | 41 | 65.1% |
| 异常(E) | 10 | 15.9% |
| 边界(B) | 9 | 14.3% |
| 流程(F) | 0 | 0% |
| 数据(D) | 3 | 4.8% |

### 优先级分布

| 优先级 | 数量 | 占比 |
|--------|------|------|
| P1 | 19 | 30.2% |
| P2 | 23 | 36.5% |
| P3 | 12 | 19.0% |
| P4 | 9 | 14.3% |
| P5 | 0 | 0% |

### 各二级功能点用例数

| 二级功能点 | 用例数 | 编号范围 |
|-----------|--------|---------|
| FP-02-01 container | 5 | N01-N03, E01, B01 |
| FP-02-02 initialValue | 5 | N01-N03, B01, E01 |
| FP-02-03 plugins | 8 | N01-N06, D01, E01 |
| FP-02-04 livePreview | 7 | N01-N05, B01, E01 |
| FP-02-05 theme | 6 | N01-N04, D01, B01 |
| FP-02-06 tabSize/direction/indentGuides | 7 | N01-N06, B01 |
| FP-02-07 readOnly | 5 | N01-N03, E01, B01 |
| FP-02-08 multiCursor | 5 | N01-N03, B01, E01 |
| FP-02-09 slashMenuLimit | 6 | N01-N04, B01, E01 |
| FP-02-10 回调 | 9 | N01-N04, D01, E01-E03, B01 |
| **合计** | **63** | |
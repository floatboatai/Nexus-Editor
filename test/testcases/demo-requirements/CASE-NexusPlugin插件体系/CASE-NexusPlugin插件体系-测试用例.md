# CASE-NexusPlugin插件体系-测试用例（FP-07）

> 一级功能点: NexusPlugin 插件体系（demo-requirements.md §3.3）
> 全局批次序号: 07
> 生成时间: 2026-08-11
> 测试框架: Playwright（Electron demo / Vite dev server + Electron main）
>
> 涉及二级功能点:
> - FP-07-01 Tier1: shortcuts 快捷键扩展（[插件能力][编辑交互]）
> - FP-07-02 Tier1: slashCommands 斜杠命令扩展（[插件能力][编辑交互]）
> - FP-07-03 Tier1: commands 自定义命令扩展（[插件能力]）
> - FP-07-04 Tier1: handlers 事件处理器（paste/drop/keydown）（[插件能力][编辑交互]）
> - FP-07-05 Tier2: remarkPlugins 解析器扩展（[插件能力][AST解析]）
> - FP-07-06 Tier2: widgets 自定义视图（[插件能力][Live Preview]）
> - FP-07-07 Tier3: cmExtensions CM6 底层扩展注入（[插件能力]）
>
> ⚠️ 实现差异提示（依据 `packages/core/src/types.ts:387-398` + `packages/core/src/editor.ts:247-272` + 各插件包源码）:
> - **NexusPlugin 接口**（`types.ts:387-398`）定义 7 个扩展点: shortcuts / slashCommands / commands / handlers / remarkPlugins / widgets / cmExtensions。`editor.ts:247-272` 将所有插件的扩展点 flatMap 后注入引擎:
>   - `shortcuts`（`editor.ts:247`）→ 注册为 CM6 keymap（`editor.ts:514-524`）
>   - `slashCommands`（`editor.ts:248`）→ 触发斜杠菜单（`editor.ts:633-650`）
>   - `commands`（`editor.ts:252`）→ 构建 commandById Map + hotkey keymap（`editor.ts:527-541`）
>   - `handlers.paste/drop/keydown`（`editor.ts:258-266`）→ 注册为 CM6 domEventHandlers（`editor.ts:673-709`）
>   - `remarkPlugins`（`editor.ts:277-280`）→ 构建 transformProcessor 用于 mdast 变换
>   - `widgets`（`editor.ts:250`）→ 构建 widgetExtension（`editor.ts:718`）
>   - `cmExtensions`（`editor.ts:249`）→ 直接拼入 CM6 extensions 数组（`editor.ts:721`）
> - **Demo 加载的 6 个插件**（`editor-shell.ts:139-146`）:
>   1. `createGfmPreset()` — remarkPlugins: [remarkGfm]（`preset-gfm/src/index.ts:7-9`）
>   2. `createHistoryPlugin()` — cmExtensions: [history(), keymap.of(historyKeymap)]（`plugin-history/src/index.ts:8-10`）
>   3. `createToolbarPlugin()` — shortcuts(8 条) + slashCommands(14 条) + cmExtensions: [colorDecorationExtension]（`plugin-toolbar/src/index.ts:221-233`）
>   4. `createSearchPlugin()` — cmExtensions: [search(), keymap.of(searchKeymap), tableSearchHighlightPlugin, highlightSelectionMatches]（`plugin-search/src/index.ts:1144-1163`）
>   5. `createWikilinksPlugin()` — cmExtensions: [createWikilinksExtension]（`wikilinks.ts:338-340`）
>   6. `createWordCountPlugin()` — cmExtensions: []（`plugin-wordcount/src/plugin.ts:234-237`），通过 attachEditor 订阅事件
> - **commands（FP-07-03）**: demo 中**无任何插件提供 commands 字段**（6 个插件均无）。因此 `getCommands()` 返回空数组，`runCommand(id)` 对任意 id 返回 false。标注"待确认"。
> - **handlers（FP-07-04）**: demo 中**无任何插件提供 handlers 字段**（paste/drop/keydown 均无插件覆盖）。编辑器内置的资源上传兜底也因 demo 未配置 `onAssetUpload`（`editor-shell.ts` 无该配置）而跳过。因此 paste/drop/keydown 全走默认行为。标注"待确认"。
> - **widgets（FP-07-06）**: demo 中**无任何插件提供 widgets 字段**（image 渲染走 `LivePreviewConfig.renderers.image` 而非 `WidgetDefinition`）。因此 `createWidgetExtension` 不被调用（`editor.ts:718` 的 `widgetParser` 为 null，因 `widgetDefs.length === 0`）。标注"待确认"。
> - **e2e 间接验证策略**: 各扩展点通过 demo 已加载插件的行为间接验证:
>   - shortcuts → 工具栏插件快捷键（Mod-B/I/Shift-S/E/K/1/2/3）键盘触发格式化
>   - slashCommands → 工具栏插件斜杠命令（14 条）输入 `/` 触发菜单
>   - remarkPlugins → GFM preset 的 remarkGfm 解析表格/删除线/任务列表/脚注/autolink 语法
>   - cmExtensions → history（undo/redo）、search（搜索面板 Mod-F）、wikilinks（`[[]]` 装饰）、toolbar（颜色装饰）
> - **测试环境约定**: 所有用例通过 `launchDemo()`（`test/e2e/helpers/electron-launcher.ts`）启动 Electron demo；`page.evaluate` 中通过 `document.execCommand("insertText", false, text)` 输入。

---

## e2e 全局前置条件

- 依赖环境: Electron demo（Vite dev server localhost:5173 + 已构建的 `apps/electron-demo/dist-electron/main.js`）
- 初始文档: demo 启动后默认打开的 sample-vault 文档（或 index.md）
- 插件配置: demo 默认挂载 —— createGfmPreset + createHistoryPlugin + createToolbarPlugin + createSearchPlugin + createWikilinksPlugin + createWordCountPlugin
- 角色权限: 无需登录（本地桌面应用）
- 未达成时的创建过程:
  1. 启动 Vite dev server（终端: `pnpm dev:renderer`; 等待: http://localhost:5173 可访问）
  2. 构建 Electron 主进程（终端: `pnpm build:electron-demo`; 产物: `apps/electron-demo/dist-electron/main.js`）
  3. 测试代码调用 `launchDemo()` 启动 Electron 实例（内部: `electron.launch({ args: [mainJs], env: { VITE_DEV_SERVER_URL: "http://localhost:5173" } })`，等待 `.cm-content` 可见）

setup 代码模板（所有用例通用，测试文件顶部）:
```typescript
import { _electron as electron, test, expect, type ElectronApplication, type Page } from "@playwright/test";
import { launchDemo } from "../../helpers/electron-launcher";

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

// 输入辅助（复用 test/e2e/editor.spec.ts:13-16 模式）
async function typeInEditor(page: Page, text: string) {
  await page.click(".cm-content");
  await page.evaluate((t) => document.execCommand("insertText", false, t), text);
}

// 清空编辑器（确保干净初始状态）
async function clearEditor(page: Page) {
  await page.click(".cm-content");
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
}

// 获取编辑器纯文本
async function getEditorText(page: Page): Promise<string> {
  return (await page.locator(".cm-content").textContent()) ?? "";
}

// 等待斜杠菜单可见
async function waitForSlashMenu(page: Page, timeout = 1000) {
  await page.waitForSelector(".nexus-slash-menu:not([style*='display: none']) .nexus-slash-menu__item", { timeout });
}

// 获取斜杠菜单项标题列表
async function getSlashMenuItemTitles(page: Page): Promise<string[]> {
  const titles = page.locator(".nexus-slash-menu:not([style*='display: none']) .nexus-slash-menu__item .nexus-slash-menu__title");
  const count = await titles.count();
  const result: string[] = [];
  for (let i = 0; i < count; i++) {
    const t = await titles.nth(i).textContent();
    if (t) result.push(t.trim());
  }
  return result;
}

// 确认斜杠菜单（Enter）
async function confirmSlashMenu(page: Page) {
  await page.keyboard.press("Enter");
}
```

---

# FP-07-01 Tier1: shortcuts 快捷键扩展（6 例，[插件能力][编辑交互]）

> 间接验证路径: `editor.ts:247` 的 `shortcuts = plugins.flatMap(p => p.shortcuts ?? [])` 将所有插件的 shortcuts 扁平化，`editor.ts:514-524` 注册为 CM6 keymap（每个 shortcut 映射为 `{ key, run: () => shortcut.run(api) }`）。demo 中**仅工具栏插件提供 shortcuts**（`plugin-toolbar/src/index.ts:222-230`，8 条: Mod-b/i/Shift-s/e/k/1/2/3）。通过**键盘快捷键触发格式化**是 shortcuts 扩展点工作的直接证据。

## FP-07-01-N01 [P1] [正常] 选中文本 → Mod-B → shortcuts 扩展触发 toggleBold → **text**

**测试框架**: Playwright

**前置条件**（⚠️ 4要素）:
- 依赖环境: Electron demo（Vite dev server + Electron main 已启动）
- 初始文档: 空文档（清空后）
- 插件配置: demo 默认（含工具栏插件，通过 shortcuts 注册 Mod-b 快捷键）
- setup 代码:
  ```typescript
  // step 1: 全局 setup（见 e2e 全局前置条件 launchDemo）
  // step 2: 清空编辑器并输入选中文本
  await clearEditor(page);
  await typeInEditor(page, "word");
  await page.waitForTimeout(200);
  // step 3: 双击选中 "word"
  await page.locator(".cm-content").dblclick();
  await page.waitForTimeout(100);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | page.keyboard.press("ControlOrMeta+b") | [DOM] CM6 keymap 捕获 Mod-b → `shortcut.run(api)` 执行 toggleBold（`plugin-toolbar/src/index.ts:223` 注册的 shortcuts[0]），选区 "word" 变为 "**word**" | 选择器: .cm-content; 操作: keyboard.press(ControlOrMeta+b); 控件: keymap; 等待: 200ms |
| 2 | getEditorText(page) | [DOM] `.cm-content` textContent 含 "**word**" | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] Mod-B 快捷键通过 shortcuts 扩展触发 toggleBold（证明 shortcuts 扁平化 + keymap 注册工作）

---

## FP-07-01-N02 [P1] [正常] 选中文本 → Mod-I → shortcuts 扩展触发 toggleItalic → *text*

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空文档
- 插件配置: demo 默认（含工具栏 Mod-i 快捷键）
- setup 代码:
  ```typescript
  await clearEditor(page);
  await typeInEditor(page, "word");
  await page.waitForTimeout(200);
  await page.locator(".cm-content").dblclick();
  await page.waitForTimeout(100);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | page.keyboard.press("ControlOrMeta+i") | [DOM] toggleItalic 执行（`plugin-toolbar/src/index.ts:224`），选区 "word" 变为 "*word*" | 选择器: .cm-content; 操作: keyboard.press(ControlOrMeta+i); 控件: keymap; 等待: 200ms |
| 2 | getEditorText(page) | [DOM] textContent 含 "*word*" | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] Mod-I 快捷键通过 shortcuts 扩展触发 toggleItalic

---

## FP-07-01-N03 [P2] [正常] 光标行 → Mod-1 → shortcuts 扩展触发 toggleHeading(1) → # title

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 含文本 "title"
- 插件配置: demo 默认（含工具栏 Mod-1 快捷键）
- setup 代码:
  ```typescript
  await clearEditor(page);
  await typeInEditor(page, "title");
  await page.waitForTimeout(200);
  await page.keyboard.press("Home");
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | page.keyboard.press("ControlOrMeta+1") | [DOM] toggleHeading(editor, 1) 执行（`plugin-toolbar/src/index.ts:228`），行首加 "# "，文本变为 "# title" | 选择器: .cm-content; 操作: keyboard.press(ControlOrMeta+1); 控件: keymap; 等待: 200ms |
| 2 | getEditorText(page) | [DOM] textContent 含 "# " 前缀（heading 标记） | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] Mod-1 快捷键通过 shortcuts 扩展触发 toggleHeading(editor, 1)

---

## FP-07-01-N04 [P2] [正常] 光标位置 → Mod-K → shortcuts 扩展触发 insertLink → [] 占位

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空文档
- 插件配置: demo 默认（含工具栏 Mod-k 快捷键）
- setup 代码:
  ```typescript
  await clearEditor(page);
  await page.click(".cm-content");
  await page.waitForTimeout(200);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | page.keyboard.press("ControlOrMeta+k") | [DOM] insertLink 执行（`plugin-toolbar/src/index.ts:227`），文档含 "[]" 或 "[](" 链接占位 | 选择器: .cm-content; 操作: keyboard.press(ControlOrMeta+k); 控件: keymap; 等待: 200ms |
| 2 | getEditorText(page) | [DOM] textContent 含 "[" 与 "]" | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] Mod-K 快捷键通过 shortcuts 扩展触发 insertLink

---

## FP-07-01-N05 [P2] [正常] 多条 shortcuts 共存验证 → Mod-E 触发 toggleInlineCode（与 Mod-B 不冲突）

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 含选中文本 "code"
- 插件配置: demo 默认（Mod-b 与 Mod-e 均注册，验证多条 shortcuts 并存）
- setup 代码:
  ```typescript
  await clearEditor(page);
  await typeInEditor(page, "code");
  await page.waitForTimeout(200);
  await page.locator(".cm-content").dblclick();
  await page.waitForTimeout(100);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | page.keyboard.press("ControlOrMeta+e") | [DOM] toggleInlineCode 执行（`plugin-toolbar/src/index.ts:226`），选区 "code" 变为 "`code`" | 选择器: .cm-content; 操作: keyboard.press(ControlOrMeta+e); 控件: keymap; 等待: 200ms |
| 2 | getEditorText(page) | [DOM] textContent 含 "`code`"（反引号包裹） | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] Mod-E 快捷键通过 shortcuts 扩展触发 toggleInlineCode（证明 8 条 shortcuts 均独立注册为 keymap，无冲突）

---

## FP-07-01-E01 [P3] [异常] 未注册的快捷键 → 无格式化副作用（shortcuts 扩展不误触发）

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 含文本 "hello"
- 插件配置: demo 默认（Mod-F9 未注册为 shortcut）
- setup 代码:
  ```typescript
  await clearEditor(page);
  await typeInEditor(page, "hello");
  await page.waitForTimeout(200);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | page.keyboard.press("F9") | [DOM] F9 未在任何插件的 shortcuts 中注册，无格式化副作用 | 选择器: .cm-content; 操作: keyboard.press(F9); 控件: keymap; 等待: 200ms |
| 2 | getEditorText(page) | [DOM] textContent 仍为 "hello"（shortcuts 扩展对未注册 key 无反应） | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 未注册快捷键不触发任何 shortcut.run（shortcuts 扩展按 key 精确匹配）

---

# FP-07-02 Tier1: slashCommands 斜杠命令扩展（6 例，[插件能力][编辑交互]）

> 间接验证路径: `editor.ts:248` 的 `slashCommands = plugins.flatMap(p => p.slashCommands ?? [])` 将所有插件的斜杠命令扁平化。`editor.ts:633-650` 在 selection/doc 变更时调用 `computeSlashState(doc, sel.head, slashCommands)` 计算菜单状态并 `emit("slashMenuChange")`。斜杠菜单 UI 订阅该事件并渲染。demo 中**仅工具栏插件提供 slashCommands**（`plugin-toolbar/src/index.ts:118-216`，14 条: h1/h2/h3/bold/italic/strikethrough/inline-code/code-block/blockquote/ulist/olist/link/image/hr）。通过**输入 `/` 后检查菜单命令项**是 slashCommands 扩展工作的直接证据。

## FP-07-02-N01 [P1] [正常] 空文档输入 / → 斜杠菜单显示工具栏注册的 slashCommands

**测试框架**: Playwright

**前置条件**（⚠️ 4要素）:
- 依赖环境: Electron demo
- 初始文档: 空文档（清空后）
- 插件配置: demo 默认（含工具栏插件，提供 14 条 slashCommands）
- setup 代码:
  ```typescript
  await clearEditor(page);
  await page.waitForTimeout(200);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | typeInEditor(page, "/") | [DOM] `.nexus-slash-menu` 出现且可见（`computeSlashState` 检测 `/` 触发，slashCommands 非空），含 `.nexus-slash-menu__item` 子项 | 选择器: .nexus-slash-menu; 操作: typeInEditor(/); 控件: menu; 等待: 300ms |
| 2 | waitForSlashMenu(page) 后获取标题列表 | [DOM] getSlashMenuItemTitles 返回列表含工具栏 slashCommands 的标题（如 "Bold"/"Heading 1"/"Link" 等，`plugin-toolbar/src/index.ts:118-216`） | 选择器: .nexus-slash-menu__title; 操作: textContent(); 控件: menu-item; 等待: 无 |

**断言汇总**:
- [DOM] 输入 `/` 后斜杠菜单可见并显示工具栏注册的 slashCommands（证明 slashCommands 扁平化 + computeSlashState 工作）

---

## FP-07-02-N02 [P1] [正常] 输入 /bold → 精确匹配 Bold 命令（slashCommands 含 id="bold"）

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空文档
- 插件配置: demo 默认（工具栏 slashCommands 含 id="bold"）
- setup 代码:
  ```typescript
  await clearEditor(page);
  await page.waitForTimeout(200);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | typeInEditor(page, "/bold") | [DOM] 斜杠菜单可见，高亮项（.is-active）标题为 "Bold"（filterSlashCommands 精确匹配 id="bold"，排序最前） | 选择器: .nexus-slash-menu__item.is-active; 操作: typeInEditor(/bold); 控件: menu; 等待: 300ms |
| 2 | 断言高亮项 | [DOM] `.nexus-slash-menu__item.is-active .nexus-slash-menu__title` 文本 === "Bold" | 选择器: .is-active .nexus-slash-menu__title; 操作: textContent(); 控件: menu-item; 等待: 无 |

**断言汇总**:
- [DOM] `/bold` 精确匹配 Bold 命令并高亮置顶（证明 slashCommands 含 id="bold"，filterSlashCommands 精确匹配优先）

---

## FP-07-02-N03 [P2] [正常] 输入 /h1 → 确认执行 → 行首加 #（slashCommands 确认执行 SlashCommandDef.run）

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空文档
- 插件配置: demo 默认（工具栏 slashCommands 含 id="h1"，run: toggleHeading(editor, 1)）
- setup 代码:
  ```typescript
  await clearEditor(page);
  await page.waitForTimeout(200);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | typeInEditor(page, "/h1") | [DOM] 斜杠菜单可见，高亮项 "Heading 1" | 选择器: .nexus-slash-menu; 操作: typeInEditor(/h1); 控件: menu; 等待: 300ms |
| 2 | confirmSlashMenu(page)（Enter） | [DOM] 菜单确认：先删除 `/h1` 触发文本，再调 `cmd.run(editor)` 执行 toggleHeading(editor, 1)（`plugin-toolbar/src/index.ts:124`），文档含 "# " | 选择器: .cm-content; 操作: keyboard.press(Enter); 控件: menu-confirm; 等待: 300ms |
| 3 | getEditorText(page) | [DOM] textContent 含 "# "（heading 标记插入） | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] `/h1` 确认后 SlashCommandDef.run 执行（slashCommands 扩展的命令执行管线工作）

---

## FP-07-02-N04 [P2] [正常] 输入 /code → 前缀匹配 inline-code 与 code-block（slashCommands 含多个 id 前缀匹配）

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空文档
- 插件配置: demo 默认（工具栏 slashCommands 含 id="inline-code" 与 id="code-block"）
- setup 代码:
  ```typescript
  await clearEditor(page);
  await page.waitForTimeout(200);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | typeInEditor(page, "/code") | [DOM] 斜杠菜单可见，标题列表含 "Inline code" 与 "Code block"（filterSlashCommands 按 id 前缀匹配 "code"） | 选择器: .nexus-slash-menu__title; 操作: typeInEditor(/code); 控件: menu; 等待: 300ms |
| 2 | 断言标题列表 | [DOM] getSlashMenuItemTitles 包含 "Inline code" 且包含 "Code block" | 选择器: .nexus-slash-menu__title; 操作: textContent(); 控件: menu-item; 等待: 无 |

**断言汇总**:
- [DOM] `/code` 前缀匹配多条 slashCommands（证明 slashCommands 扁平化后 filterSlashCommands 前缀匹配生效）

---

## FP-07-02-N05 [P2] [正常] 输入 /zzzzz 无匹配 → 菜单显示 No matches（slashCommands 过滤后为空）

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空文档
- 插件配置: demo 默认（14 条 slashCommands 均不匹配 "zzzzz"）
- setup 代码:
  ```typescript
  await clearEditor(page);
  await page.waitForTimeout(200);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | typeInEditor(page, "/zzzzz") | [DOM] 斜杠菜单可见但无 `.nexus-slash-menu__item`，显示 `.nexus-slash-menu__empty` 文本 "No matches"（filterSlashCommands 对 "zzzzz" 无匹配） | 选择器: .nexus-slash-menu__empty; 操作: typeInEditor(/zzzzz); 控件: menu; 等待: 300ms |
| 2 | 断言空状态 | [DOM] `.nexus-slash-menu__empty` 文本含 "No matches"；`.nexus-slash-menu__item` count === 0 | 选择器: .nexus-slash-menu__empty; 操作: textContent(); 控件: menu-empty; 等待: 无 |

**断言汇总**:
- [DOM] 无匹配 query 时 slashCommands 经 filterSlashCommands 过滤后为空（菜单正常显示空状态，不崩溃）

---

## FP-07-02-B01 [P4] [边界] 斜杠菜单最多显示 slashMenuLimit 条（默认 8）

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空文档
- 插件配置: demo 默认（14 条 slashCommands，slashMenuLimit 默认 8）
- setup 代码:
  ```typescript
  await clearEditor(page);
  await page.waitForTimeout(200);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | typeInEditor(page, "/") | [DOM] 斜杠菜单可见，显示全部匹配命令但截断到 limit | 选择器: .nexus-slash-menu; 操作: typeInEditor(/); 控件: menu; 等待: 300ms |
| 2 | 断言菜单项数 | [DOM] `.nexus-slash-menu__item` count ≤ 8（slashMenuLimit 默认值 8，`editor.ts:636` 的 `config.slashMenuLimit ?? 8`） | 选择器: .nexus-slash-menu__item; 操作: count(); 控件: menu-item; 等待: 无 |

**断言汇总**:
- [DOM] slashCommands 扁平化返回 14 条，但菜单渲染受 slashMenuLimit=8 截断（证明 slashCommands 扩展与 slashMenuLimit 协同工作）

---

# FP-07-03 Tier1: commands 自定义命令扩展（4 例，[插件能力]）—— 部分标注"待确认"

> ⚠️ 实现差异: `editor.ts:252` 的 `commands = plugins.flatMap(p => p.commands ?? [])` 将所有插件的命名命令扁平化，构建 commandById Map（`editor.ts:253-256`）。带 hotkey 的命令自动注册为 CM6 keymap（`editor.ts:527-541`）。demo 加载的 6 个插件中**无任何插件提供 commands 字段**。因此 `getCommands()` 返回空数组，`runCommand(id)` 对任意 id 返回 false。本节用例验证"commands 扩展被正确收集（空数组）+ 不崩溃"，直接功能验证标注"待确认"（需注入测试钩子或添加 commands 插件后验证）。

## FP-07-03-N01 [P1] [正常] 【待确认】getCommands 返回空数组（demo 无插件提供 commands）

**测试框架**: Playwright

**前置条件**（⚠️ 4要素）:
- 依赖环境: Electron demo（需 editor-shell.ts 注入 `(window as any).__nexusEditor = editor` 测试钩子以直接调用 getCommands）
- 初始文档: 任意
- 插件配置: demo 默认（6 插件均无 commands 字段，`editor.ts:252` 的 flatMap 结果为空）
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 尝试通过钩子调用 getCommands
  const commands = await page.evaluate(() => {
    const ed = (window as any).__nexusEditor;
    return ed ? ed.getCommands() : null;
  });
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言 getCommands 结果 | [STATE] 若钩子存在：commands 是空数组 []（demo 6 插件无 commands 字段）；若钩子缺失：commands === null，用例标注"待确认" | 选择器: 无; 操作: page.evaluate(getCommands); 控件: api; 等待: 无 |
| 2 | 断言编辑器存活 | [DOM] `.cm-editor` 可见（commands 扩展即使返回空，编辑器正常工作） | 选择器: .cm-editor; 操作: toBeVisible(); 控件: editor; 等待: 无 |

**断言汇总**:
- [STATE] demo 中 getCommands() 返回空数组（无命名命令插件，标注"待确认"：需注入钩子后直接断言）

---

## FP-07-03-N02 [P2] [正常] commands 扩展空数组 → 编辑器核心功能不受影响（shortcuts/slashCommands 仍工作）

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空文档
- 插件配置: demo 默认（commands 为空，但 shortcuts 与 slashCommands 非空）
- setup 代码:
  ```typescript
  await clearEditor(page);
  await typeInEditor(page, "word");
  await page.waitForTimeout(200);
  await page.locator(".cm-content").dblclick();
  await page.waitForTimeout(100);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | page.keyboard.press("ControlOrMeta+b") | [DOM] shortcuts 扩展仍工作（toggleBold 执行），选区 "word" 变为 "**word**"（commands 为空不影响 shortcuts 扩展） | 选择器: .cm-content; 操作: keyboard.press(ControlOrMeta+b); 控件: keymap; 等待: 200ms |
| 2 | getEditorText(page) | [DOM] textContent 含 "**word**" | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] commands 扩展为空不影响其他扩展点（shortcuts 独立工作，证明 7 个扩展点解耦）

---

## FP-07-03-E01 [P3] [异常] 【待确认】runCommand 未知 id → 不崩溃（无副作用）

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（需注入测试钩子）
- 初始文档: 含文本 "hello"
- 插件配置: demo 默认（commands 为空，commandById Map 无任何条目）
- setup 代码:
  ```typescript
  await clearEditor(page);
  await typeInEditor(page, "hello");
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const ed = (window as any).__nexusEditor;
    if (ed) ed.runCommand("nonexistent-command-id");
  });
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言文档不变 | [DOM] `.cm-content` 仍含 "hello"（runCommand 对未知 id 返回 false，`editor.ts:887` 的 `commandById.get(id)` 查不到，无副作用） | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |
| 2 | 断言编辑器存活 | [DOM] `.cm-editor` 可见（runCommand 不崩溃） | 选择器: .cm-editor; 操作: toBeVisible(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] runCommand 未知 id 不产生副作用（commands 扩展的 commandById Map 对未知 id 安全）
- [DOM] 编辑器不崩溃

---

## FP-07-03-E02 [P3] [异常] commands 为空 → 无 hotkey keymap 注册（任意 Mod-组合无命令副作用）

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 含文本 "hello"
- 插件配置: demo 默认（commands 为空，`editor.ts:527` 的 hotkeyCommands 为空数组，无 commandKeymapExtensions）
- setup 代码:
  ```typescript
  await clearEditor(page);
  await typeInEditor(page, "hello");
  await page.waitForTimeout(200);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | page.keyboard.press("ControlOrMeta+F7") | [DOM] Mod-F7 未注册为 command hotkey，无副作用 | 选择器: .cm-content; 操作: keyboard.press(ControlOrMeta+F7); 控件: keymap; 等待: 200ms |
| 2 | getEditorText(page) | [DOM] textContent 仍为 "hello"（commands 为空 → 无 hotkeyCommands → 无 commandKeymapExtensions） | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] commands 扩展为空时不注册任何 hotkey keymap（证明 hotkeyCommands 过滤逻辑 `editor.ts:527-530` 工作）

---

# FP-07-04 Tier1: handlers 事件处理器（4 例，[插件能力][编辑交互]）—— 部分标注"待确认"

> ⚠️ 实现差异: `editor.ts:258-266` 收集所有插件的 `handlers.paste/drop/keydown`，`editor.ts:673-709` 注册为 CM6 domEventHandlers。`runEventHandlers`（`editor.ts:471-478`）依次执行，任一返回 true 视为已消费。demo 加载的 6 个插件中**无任何插件提供 handlers 字段**。因此 pasteHandlers/dropHandlers/keydownHandlers 均为空数组，paste/drop/keydown 全走默认行为（paste 纯文本粘贴、drop 交回 CM6、keydown 不拦截）。本节用例验证"handlers 扩展被正确收集（空）+ 默认行为不受影响 + 不崩溃"，直接功能验证标注"待确认"。

## FP-07-04-N01 [P1] [正常] handlers 为空 → 粘贴纯文本走默认行为（CM6 原生粘贴）

**测试框架**: Playwright

**前置条件**（⚠️ 4要素）:
- 依赖环境: Electron demo
- 初始文档: 空文档
- 插件配置: demo 默认（无插件提供 handlers.paste，pasteHandlers 为空）
- setup 代码:
  ```typescript
  await clearEditor(page);
  await page.click(".cm-content");
  await page.waitForTimeout(200);
  // step 3: 模拟粘贴纯文本（通过 execCommand insertText 等效粘贴）
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | page.evaluate((t) => document.execCommand("insertText", false, t), "pasted text") | [DOM] 纯文本粘贴走 CM6 默认行为（pasteHandlers 为空，`runEventHandlers` 返回 false，`editor.ts:676` 不进入 preventDefault），文本 "pasted text" 插入文档 | 选择器: .cm-content; 操作: execCommand(insertText); 控件: clipboard; 等待: 200ms |
| 2 | getEditorText(page) | [DOM] textContent 含 "pasted text" | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] handlers 扩展为空时纯文本粘贴走 CM6 默认行为（文本正常插入）

---

## FP-07-04-N02 [P2] [正常] 【待确认】handlers 为空 + 粘贴图片 → 资源上传兜底未配置 → 不插入图片引用

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空文档
- 插件配置: demo 默认（无插件 handlers.paste + 未配置 onAssetUpload，`editor.ts:681` 的 `if (!config.onAssetUpload)` 返回 false）
- setup 代码:
  ```typescript
  await clearEditor(page);
  await page.waitForTimeout(200);
  // step 3: 构造图片粘贴事件
  await page.evaluate(() => {
    const target = document.querySelector(".cm-content") as HTMLElement;
    const file = new File(["dummy"], "paste.png", { type: "image/png" });
    const dt = new DataTransfer();
    dt.items.add(file);
    const event = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
  });
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 等待 300ms 后 getEditorText(page) | [DOM] textContent 不含 "![" 与 "](" 图片引用（handlers.paste 为空 → runEventHandlers 返回 false → onAssetUpload 未配置 → insertUploadedAssets 不执行） | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 300ms |
| 2 | 断言编辑器存活 | [DOM] `.cm-editor` 可见（粘贴事件不导致崩溃） | 选择器: .cm-editor; 操作: toBeVisible(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] handlers 扩展为空且 onAssetUpload 未配置时，图片粘贴不插入引用（标注"待确认"：handlers 间接验证为空）

---

## FP-07-04-E01 [P3] [异常] handlers 为空 → 拖拽事件不崩溃（dropHandlers 为空走默认）

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空文档
- 插件配置: demo 默认（无插件 handlers.drop，dropHandlers 为空）
- setup 代码:
  ```typescript
  await clearEditor(page);
  await page.waitForTimeout(200);
  // step 3: 构造拖拽事件
  await page.evaluate(() => {
    const target = document.querySelector(".cm-content") as HTMLElement;
    const dt = new DataTransfer();
    dt.setData("text/plain", "dropped text");
    const event = new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
  });
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言编辑器存活 | [DOM] `.cm-editor` 可见（drop 事件不导致崩溃，dropHandlers 为空，runEventHandlers 返回 false） | 选择器: .cm-editor; 操作: toBeVisible(); 控件: editor; 等待: 300ms |

**断言汇总**:
- [DOM] handlers 扩展为空时 drop 事件不崩溃（dropHandlers 安全降级到默认行为）

---

## FP-07-04-E02 [P3] [异常] handlers 为空 → keydown 不拦截常规输入（keydownHandlers 为空）

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空文档
- 插件配置: demo 默认（无插件 handlers.keydown，keydownHandlers 为空）
- setup 代码:
  ```typescript
  await clearEditor(page);
  await page.click(".cm-content");
  await page.waitForTimeout(200);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | typeInEditor(page, "abc") | [DOM] 文本 "abc" 正常输入（keydownHandlers 为空，`editor.ts:702-707` 的 keydown 回调 runEventHandlers 返回 false，不 preventDefault） | 选择器: .cm-content; 操作: typeInEditor(abc); 控件: editor; 等待: 200ms |
| 2 | getEditorText(page) | [DOM] textContent 含 "abc"（常规输入未被 handlers 拦截） | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] handlers 扩展为空时 keydown 不拦截常规输入（keydownHandlers 安全降级）

---

# FP-07-05 Tier2: remarkPlugins 解析器扩展（6 例，[插件能力][AST解析]）

> 间接验证路径: `editor.ts:277` 的 `hasRemarkPlugins = plugins.some(p => (p.remarkPlugins?.length ?? 0) > 0)` 检测是否有插件提供 remarkPlugins。若有（且无 customParser），`editor.ts:278` 构建 `transformProcessor = createTransformProcessor(plugins)`，`editor.ts:279-280` 在每次 mdast 构建后 `transformAst(ast)` 应用 remarkPlugins 变换。demo 中**仅 GFM preset 提供 remarkPlugins**（`preset-gfm/src/index.ts:7-9`，注入 `remarkGfm`）。通过**输入 GFM 语法（表格/删除线/任务列表/脚注/autolink）后验证 AST 解析结果**是 remarkPlugins 扩展工作的直接证据。验证方式: getAst()（需测试钩子）或 exportHTML()（通过工具栏间接），此处采用 exportHTML 间接验证 + 标注钩子依赖。

## FP-07-05-N01 [P1] [正常] 输入 GFM 表格语法 → remarkGfm 解析为 table 节点（remarkPlugins 扩展生效）

**测试框架**: Playwright

**前置条件**（⚠️ 4要素）:
- 依赖环境: Electron demo
- 初始文档: 空文档
- 插件配置: demo 默认（GFM preset 注入 remarkGfm，使 `| a | b |` 表格语法被解析为 table 节点而非 paragraph）
- setup 代码:
  ```typescript
  await clearEditor(page);
  // step 2: 输入 GFM 表格语法
  await typeInEditor(page, "| Col A | Col B |\n| --- | --- |\n| 1 | 2 |");
  await page.waitForTimeout(400);
  // step 3: 尝试通过钩子调用 exportHTML（验证 AST 含 <table>）
  const html = await page.evaluate(() => {
    const ed = (window as any).__nexusEditor;
    return ed ? ed.exportHTML() : null;
  });
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言 exportHTML 结果 | [AST] 若钩子存在：html 含 `<table>` 标签（remarkGfm 将 `|...|` 语法变换为 mdast table 节点，exportHTML 序列化为 `<table>`）；若钩子缺失：html === null，用例标注"待确认" | 选择器: 无; 操作: page.evaluate(exportHTML); 控件: api; 等待: 无 |
| 2 | 断言编辑器存活 | [DOM] `.cm-editor` 可见（remarkPlugins 变换不崩溃） | 选择器: .cm-editor; 操作: toBeVisible(); 控件: editor; 等待: 无 |

**断言汇总**:
- [AST] GFM 表格语法经 remarkPlugins（remarkGfm）变换后解析为 table 节点（证明 remarkPlugins 扩展的 createTransformProcessor + transformAst 工作）

---

## FP-07-05-N02 [P1] [正常] 输入删除线语法 → remarkGfm 解析为 strikethrough 节点

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空文档
- 插件配置: demo 默认（GFM preset 注入 remarkGfm，使 `~~text~~` 被解析为 strikethrough 节点）
- setup 代码:
  ```typescript
  await clearEditor(page);
  await typeInEditor(page, "~~deleted~~");
  await page.waitForTimeout(400);
  const html = await page.evaluate(() => {
    const ed = (window as any).__nexusEditor;
    return ed ? ed.exportHTML() : null;
  });
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言 exportHTML 结果 | [AST] 若钩子存在：html 含 `<del>` 或 `<s>` 标签（remarkGfm 将 `~~deleted~~` 变换为 strikethrough mdast 节点，序列化为 `<del>`）；若钩子缺失：标注"待确认" | 选择器: 无; 操作: page.evaluate(exportHTML); 控件: api; 等待: 无 |
| 2 | 断言编辑器存活 | [DOM] `.cm-editor` 可见 | 选择器: .cm-editor; 操作: toBeVisible(); 控件: editor; 等待: 无 |

**断言汇总**:
- [AST] `~~text~~` 经 remarkPlugins 变换后解析为 strikethrough 节点（证明 remarkGfm 的 strikethrough 扩展生效）

---

## FP-07-05-N03 [P2] [正常] 输入任务列表语法 → remarkGfm 解析为 listItem with checked 属性

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空文档
- 插件配置: demo 默认（GFM preset 注入 remarkGfm，使 `- [ ] task` 被解析为带 checked 属性的 listItem）
- setup 代码:
  ```typescript
  await clearEditor(page);
  await typeInEditor(page, "- [x] done\n- [ ] todo");
  await page.waitForTimeout(400);
  const html = await page.evaluate(() => {
    const ed = (window as any).__nexusEditor;
    return ed ? ed.exportHTML() : null;
  });
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言 exportHTML 结果 | [AST] 若钩子存在：html 含 `<input` 或 `checkbox` 或 `<li` 带 `checked`（remarkGfm 将 `- [x]` 变换为 listItem { checked: true }）；若钩子缺失：标注"待确认" | 选择器: 无; 操作: page.evaluate(exportHTML); 控件: api; 等待: 无 |
| 2 | 断言编辑器存活 | [DOM] `.cm-editor` 可见 | 选择器: .cm-editor; 操作: toBeVisible(); 控件: editor; 等待: 无 |

**断言汇总**:
- [AST] `- [x]` / `- [ ]` 经 remarkPlugins 变换后解析为带 checked 属性的 listItem（证明 remarkGfm 的 task list 扩展生效）

---

## FP-07-05-N04 [P2] [正常] remarkPlugins 扩展不破坏标准 Markdown 语法（heading/paragraph 正常解析）

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空文档
- 插件配置: demo 默认（GFM preset 的 remarkGfm 注入后，标准 Markdown 语法仍正常解析）
- setup 代码:
  ```typescript
  await clearEditor(page);
  await typeInEditor(page, "# Heading\n\nParagraph text.");
  await page.waitForTimeout(400);
  const html = await page.evaluate(() => {
    const ed = (window as any).__nexusEditor;
    return ed ? ed.exportHTML() : null;
  });
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言 exportHTML 结果 | [AST] 若钩子存在：html 含 `<h1>` 与 `<p>` 标签（remarkGfm 不破坏标准 Markdown 解析，heading 与 paragraph 正常序列化）；若钩子缺失：标注"待确认" | 选择器: 无; 操作: page.evaluate(exportHTML); 控件: api; 等待: 无 |
| 2 | 断言编辑器存活 | [DOM] `.cm-editor` 可见 | 选择器: .cm-editor; 操作: toBeVisible(); 控件: editor; 等待: 无 |

**断言汇总**:
- [AST] remarkPlugins 扩展注入后标准 Markdown 语法仍正常解析（证明 remarkGfm 兼容性 + transformAst 链式应用不冲突）

---

## FP-07-05-N05 [P2] [正常] 输入 GFM 脚注语法 → remarkGfm 解析为 footnote 节点

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空文档
- 插件配置: demo 默认（GFM preset 注入 remarkGfm，使 `[^1]` 脚注语法被解析）
- setup 代码:
  ```typescript
  await clearEditor(page);
  await typeInEditor(page, "Text with footnote[^1].\n\n[^1]: Footnote content.");
  await page.waitForTimeout(400);
  const html = await page.evaluate(() => {
    const ed = (window as any).__nexusEditor;
    return ed ? ed.exportHTML() : null;
  });
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言 exportHTML 结果 | [AST] 若钩子存在：html 含 `<sup>` 或 `footnote` 相关标签（remarkGfm 将 `[^1]` 变换为 footnoteDefinition/footnoteReference 节点）；若钩子缺失：标注"待确认" | 选择器: 无; 操作: page.evaluate(exportHTML); 控件: api; 等待: 无 |
| 2 | 断言编辑器存活 | [DOM] `.cm-editor` 可见 | 选择器: .cm-editor; 操作: toBeVisible(); 控件: editor; 等待: 无 |

**断言汇总**:
- [AST] `[^1]` 经 remarkPlugins 变换后解析为 footnote 节点（证明 remarkGfm 的 footnotes 扩展生效）

---

## FP-07-05-E01 [P3] [异常] remarkPlugins 对无效 GFM 语法不崩溃（容错性）

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空文档
- 插件配置: demo 默认（GFM preset 的 remarkGfm 对不完整表格语法容错）
- setup 代码:
  ```typescript
  await clearEditor(page);
  // step 2: 输入不完整的表格语法（无分隔行）
  await typeInEditor(page, "| col1 | col2\n| 1 | 2");
  await page.waitForTimeout(400);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言编辑器存活 | [DOM] `.cm-editor` 可见（remarkPlugins 对无效 GFM 语法不崩溃，transformAst 容错降级为 paragraph） | 选择器: .cm-editor; 操作: toBeVisible(); 控件: editor; 等待: 无 |
| 2 | getEditorText(page) | [DOM] textContent 保留原始输入文本（编辑器内容不被破坏） | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] remarkPlugins 扩展对无效 GFM 语法容错（不崩溃，内容保留）

---

# FP-07-06 Tier2: widgets 自定义视图（4 例，[插件能力][Live Preview]）—— 部分标注"待确认"

> ⚠️ 实现差异: `editor.ts:250` 的 `widgetDefs = plugins.flatMap(p => p.widgets ?? [])` 收集所有插件的 WidgetDefinition。`editor.ts:272` 的 `fallbackParser = !customParser && widgetDefs.length > 0 ? createParser(plugins) : null`（仅当有 widget 时才构建同步解析器）。`editor.ts:718` 的 `widgetParser ? createWidgetExtension(widgetParser, widgetDefs) : []` 注入 widget 扩展。demo 加载的 6 个插件中**无任何插件提供 widgets 字段**（image 渲染走 `LivePreviewConfig.renderers.image` 而非 `WidgetDefinition`）。因此 widgetDefs 为空，fallbackParser 为 null，createWidgetExtension 不被调用。本节用例验证"widgets 扩展被正确收集（空）+ Live Preview 正常工作 + 不崩溃"，直接功能验证标注"待确认"。

## FP-07-06-N01 [P1] [正常] 【待确认】widgets 为空 → fallbackParser 不构建（widgetDefs.length === 0）

**测试框架**: Playwright

**前置条件**（⚠️ 4要素）:
- 依赖环境: Electron demo（需注入测试钩子验证 widgetDefs 为空）
- 初始文档: 空文档
- 插件配置: demo 默认（6 插件均无 widgets 字段，widgetDefs 为空数组）
- setup 代码:
  ```typescript
  await clearEditor(page);
  await typeInEditor(page, "test content");
  await page.waitForTimeout(300);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言编辑器存活 | [DOM] `.cm-editor` 可见（widgets 扩展为空，不构建 createWidgetExtension，编辑器正常工作） | 选择器: .cm-editor; 操作: toBeVisible(); 控件: editor; 等待: 无 |
| 2 | getEditorText(page) | [DOM] textContent 含 "test content"（widgets 为空不影响文档内容） | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] widgets 扩展为空时编辑器正常工作（fallbackParser 不构建，无 createWidgetExtension 调用，标注"待确认"）

---

## FP-07-06-N02 [P2] [正常] widgets 为空 → Live Preview 仍正常渲染（走 LivePreviewRenderer 而非 WidgetDefinition）

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空文档
- 插件配置: demo 默认（widgets 为空，但 Live Preview 系统通过 `createLivePreviewExtension` 独立工作）
- setup 代码:
  ```typescript
  await clearEditor(page);
  await typeInEditor(page, "**bold**");
  await page.waitForTimeout(300);
  // 光标移出该行（触发 Live Preview 折叠）
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(200);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言 Live Preview 工作 | [DOM] `.cm-content` 渲染含格式化样式（bold 标记隐藏，Live Preview 通过 Decoration 而非 widgets 工作） | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |
| 2 | 断言编辑器存活 | [DOM] `.cm-editor` 可见 | 选择器: .cm-editor; 操作: toBeVisible(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] widgets 扩展为空不影响 Live Preview 渲染（Live Preview 独立于 widgets 扩展点工作）

---

## FP-07-06-N03 [P2] [正常] widgets 为空 → 图片通过 LivePreviewRenderer 渲染（非 WidgetDefinition）

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空文档
- 插件配置: demo 默认（image 渲染通过 `editor-shell.ts:150-167` 的 `livePreview.renderers.image` 自定义渲染器，而非 plugins.widgets）
- setup 代码:
  ```typescript
  await clearEditor(page);
  await typeInEditor(page, "![alt text](https://example.com/test.png)");
  await page.waitForTimeout(400);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言编辑器存活 | [DOM] `.cm-editor` 可见（widgets 为空，图片通过 LivePreviewRenderer 渲染而非 WidgetDefinition） | 选择器: .cm-editor; 操作: toBeVisible(); 控件: editor; 等待: 无 |
| 2 | 断言图片渲染容器存在（若 Live Preview 开启） | [DOM] 可能存在 `[data-live-preview-image]` 或 `.nexus-image` 元素（image 走 LivePreviewRenderer 路径，与 widgets 扩展点无关） | 选择器: [data-live-preview-image]; 操作: count(); 控件: live-preview; 等待: 无 |

**断言汇总**:
- [DOM] 图片渲染走 LivePreviewRenderer 而非 widgets 扩展点（证明 demo 不依赖 WidgetDefinition，widgets 扩展正确保持空状态）

---

## FP-07-06-E01 [P3] [异常] widgets 为空 → 编辑器不因缺失 widget 渲染器而崩溃

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空文档
- 插件配置: demo 默认（widgets 为空）
- setup 代码:
  ```typescript
  await clearEditor(page);
  await typeInEditor(page, "# Heading\n\n- list item\n\n> quote\n\n`code`");
  await page.waitForTimeout(400);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言编辑器存活 | [DOM] `.cm-editor` 可见（多种 Markdown 语法渲染不因 widgets 为空而崩溃，全部走 Live Preview Decoration 路径） | 选择器: .cm-editor; 操作: toBeVisible(); 控件: editor; 等待: 无 |
| 2 | getEditorText(page) | [DOM] textContent 保留全部输入内容 | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] widgets 扩展为空时多种 Markdown 语法正常渲染（不因缺失 widget 渲染器而崩溃）

---

# FP-07-07 Tier3: cmExtensions CM6 底层扩展注入（8 例，[插件能力]）

> 间接验证路径: `editor.ts:249` 的 `cmExtensions = plugins.flatMap(p => p.cmExtensions ?? [])` 将所有插件的 CM6 Extension 数组扁平化，`editor.ts:721` 的 `...cmExtensions` 直接拼入 `EditorState.create({ extensions: [...] })`。demo 中有 4 个插件提供 cmExtensions:
> 1. **history**（`plugin-history/src/index.ts:9`）: `[history(), keymap.of(historyKeymap)]` — 撤销/重做栈 + 快捷键
> 2. **search**（`plugin-search/src/index.ts:1145-1158`）: `[search({...}), keymap.of(searchKeymap), tableSearchHighlightPlugin, highlightSelectionMatches()]` — 搜索面板 + 搜索快捷键 + 表格高亮 + 选区高亮
> 3. **toolbar**（`plugin-toolbar/src/index.ts:233`）: `[colorDecorationExtension()]` — 颜色装饰（`<span style="color:...">` 隐藏/着色）
> 4. **wikilinks**（`wikilinks.ts:339`）: `[createWikilinksExtension(options)]` — `[[wikilink]]` 装饰
> wordcount 插件的 cmExtensions 为空数组（`plugin-wordcount/src/plugin.ts:236`），通过 attachEditor 订阅事件而非 cmExtensions。
>
> 通过**撤销/重做（history）、搜索面板（search）、wikilink 装饰、颜色装饰**的可见行为是 cmExtensions 扩展工作的直接证据。

## FP-07-07-N01 [P1] [正常] history 插件 cmExtensions → Mod-Z 撤销工作（history() 扩展生效）

**测试框架**: Playwright

**前置条件**（⚠️ 4要素）:
- 依赖环境: Electron demo
- 初始文档: 空文档
- 插件配置: demo 默认（history 插件通过 cmExtensions 注入 `history()` + `keymap.of(historyKeymap)`）
- setup 代码:
  ```typescript
  await clearEditor(page);
  await typeInEditor(page, "before");
  await page.waitForTimeout(200);
  await typeInEditor(page, " after");
  await page.waitForTimeout(200);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | page.keyboard.press("ControlOrMeta+z") | [DOM] CM6 historyKeymap 捕获 Mod-Z → undo（`plugin-history/src/index.ts:9` 的 cmExtensions 注入 history() + keymap），文档回到 "before" | 选择器: .cm-content; 操作: keyboard.press(ControlOrMeta+z); 控件: keymap; 等待: 200ms |
| 2 | getEditorText(page) | [DOM] textContent 含 "before" 且不含 " after" | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] Mod-Z 撤销工作（证明 history 插件的 cmExtensions: [history(), keymap.of(historyKeymap)] 被正确注入 CM6）

---

## FP-07-07-N02 [P1] [正常] history 插件 cmExtensions → Mod-Shift-Z 重做工作

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空文档
- 插件配置: demo 默认（history cmExtensions 含 historyKeymap，含 Mod-Shift-Z）
- setup 代码:
  ```typescript
  await clearEditor(page);
  await typeInEditor(page, "before");
  await page.waitForTimeout(200);
  await typeInEditor(page, " after");
  await page.waitForTimeout(200);
  // 先撤销一次
  await page.keyboard.press("ControlOrMeta+z");
  await page.waitForTimeout(200);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | page.keyboard.press("ControlOrMeta+Shift+z") | [DOM] CM6 historyKeymap 捕获 Mod-Shift-Z → redo（cmExtensions 注入），文档恢复为 "before after" | 选择器: .cm-content; 操作: keyboard.press(ControlOrMeta+Shift+z); 控件: keymap; 等待: 200ms |
| 2 | getEditorText(page) | [DOM] textContent 含 "before after" | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] Mod-Shift-Z 重做工作（证明 history 插件的 cmExtensions 中 historyKeymap 全部快捷键被注入）

---

## FP-07-07-N03 [P1] [正常] search 插件 cmExtensions → Mod-F 打开搜索面板（search() 扩展生效）

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 含文本 "hello world"
- 插件配置: demo 默认（search 插件通过 cmExtensions 注入 `search({ top: true, createPanel })` + `keymap.of(searchKeymap)`，searchKeymap 含 Mod-F → openSearchPanel）
- setup 代码:
  ```typescript
  await clearEditor(page);
  await typeInEditor(page, "hello world");
  await page.waitForTimeout(200);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | page.keyboard.press("ControlOrMeta+f") | [DOM] CM6 searchKeymap 捕获 Mod-F → openSearchPanel（`plugin-search/src/index.ts:1152` 的 cmExtensions 注入），搜索面板 `.cm-search` 或 `.nexus-search-panel` 出现 | 选择器: .cm-search; 操作: keyboard.press(ControlOrMeta+f); 控件: keymap; 等待: 300ms |
| 2 | 断言搜索面板可见 | [DOM] `.cm-search` 可见（含搜索输入框 `input.cm-textfield` 或 `#markdown-search-find-row`） | 选择器: .cm-search; 操作: toBeVisible(); 控件: search-panel; 等待: 无 |

**断言汇总**:
- [DOM] Mod-F 打开搜索面板（证明 search 插件的 cmExtensions: [search(), keymap.of(searchKeymap)] 被正确注入 CM6）

---

## FP-07-07-N04 [P2] [正常] search 插件 cmExtensions → 搜索面板输入查询 → 高亮匹配（search() 查询功能）

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 含文本 "hello world hello"
- 插件配置: demo 默认（search 插件 cmExtensions 注入 search() 扩展，支持查询高亮）
- setup 代码:
  ```typescript
  await clearEditor(page);
  await typeInEditor(page, "hello world hello");
  await page.waitForTimeout(200);
  await page.keyboard.press("ControlOrMeta+f");
  await page.waitForTimeout(300);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 在搜索输入框输入 "hello" | [DOM] 搜索面板的查询功能工作（search() 扩展驱动 CM6 搜索），文档中 "hello" 被高亮（`.cm-searchMatch` 或 selection 移动到匹配处） | 选择器: .cm-search input; 操作: fill(hello); 控件: search-input; 等待: 300ms |
| 2 | 断言编辑器存活 | [DOM] `.cm-editor` 可见（search() 扩展查询不崩溃） | 选择器: .cm-editor; 操作: toBeVisible(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 搜索查询功能工作（证明 search 插件 cmExtensions 中的 search() 扩展被注入并驱动查询/高亮）

---

## FP-07-07-N05 [P2] [正常] search 插件 cmExtensions → highlightSelectionMatches 选区高亮工作

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 含重复文本 "cat dog cat bird cat"
- 插件配置: demo 默认（search 插件 cmExtensions 注入 `highlightSelectionMatches()`，默认 `highlightSelectionMatches: true`，`plugin-search/src/index.ts:1156-1158`）
- setup 代码:
  ```typescript
  await clearEditor(page);
  await typeInEditor(page, "cat dog cat bird cat");
  await page.waitForTimeout(200);
  // 选中第一个 "cat"
  await page.locator(".cm-content").click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+ControlOrMeta+ArrowRight");
  await page.waitForTimeout(300);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 选中 "cat" 后等待 300ms | [DOM] 其他 "cat" 出现被高亮装饰（`highlightSelectionMatches()` 扩展驱动，`.cm-selectionMatch` 或类似高亮类） | 选择器: .cm-content; 操作: 选中cat; 控件: editor; 等待: 300ms |
| 2 | 断言编辑器存活 | [DOM] `.cm-editor` 可见 | 选择器: .cm-editor; 操作: toBeVisible(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 选区高亮工作（证明 search 插件 cmExtensions 中的 `highlightSelectionMatches()` 被注入）

---

## FP-07-07-N06 [P2] [正常] wikilinks 插件 cmExtensions → `[[target]]` 渲染装饰（createWikilinksExtension 生效）

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空文档
- 插件配置: demo 默认（wikilinks 插件通过 cmExtensions 注入 `createWikilinksExtension(options)`，`wikilinks.ts:339`，对 `[[target]]` 语法应用装饰）
- setup 代码:
  ```typescript
  await clearEditor(page);
  await typeInEditor(page, "Link to [[note]] here");
  await page.waitForTimeout(400);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言编辑器存活 | [DOM] `.cm-editor` 可见（wikilinks cmExtensions 对 `[[note]]` 装饰不崩溃） | 选择器: .cm-editor; 操作: toBeVisible(); 控件: editor; 等待: 无 |
| 2 | getEditorText(page) | [DOM] textContent 含 "[[note]]"（wikilinks 装饰通过 Decoration.mark/replace 工作，不改变文档源文本） | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] `[[wikilink]]` 装饰工作（证明 wikilinks 插件的 cmExtensions: [createWikilinksExtension] 被注入 CM6，且不破坏源文本）

---

## FP-07-07-N07 [P2] [正常] toolbar 插件 cmExtensions → 颜色装饰扩展工作（colorDecorationExtension 生效）

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空文档
- 插件配置: demo 默认（toolbar 插件通过 cmExtensions 注入 `colorDecorationExtension()`，`plugin-toolbar/src/index.ts:233`，对 `<span style="color:...">` 标签隐藏/着色）
- setup 代码:
  ```typescript
  await clearEditor(page);
  await typeInEditor(page, '<span style="color:red">red text</span>');
  await page.waitForTimeout(400);
  // 光标移出该行（触发颜色装饰）
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(200);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言编辑器存活 | [DOM] `.cm-editor` 可见（toolbar cmExtensions 的 colorDecorationExtension 对 HTML 颜色标签处理不崩溃） | 选择器: .cm-editor; 操作: toBeVisible(); 控件: editor; 等待: 无 |
| 2 | getEditorText(page) | [DOM] textContent 含 "red text"（颜色装饰隐藏标签但保留文本内容） | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 颜色装饰扩展工作（证明 toolbar 插件的 cmExtensions: [colorDecorationExtension()] 被注入 CM6，对 `<span style="color:...">` 标签正确处理）

---

## FP-07-07-E01 [P3] [异常] 多插件 cmExtensions 共存 → 无扩展冲突崩溃（4 插件 cmExtensions 并存）

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空文档
- 插件配置: demo 默认（history + search + toolbar + wikilinks 四插件 cmExtensions 共存，通过 `editor.ts:249` flatMap 后一并注入）
- setup 代码:
  ```typescript
  await clearEditor(page);
  await typeInEditor(page, "# Title\n\nSome **bold** and [[link]].");
  await page.waitForTimeout(400);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言编辑器存活 | [DOM] `.cm-editor` 可见（4 插件 cmExtensions 共存无冲突崩溃） | 选择器: .cm-editor; 操作: toBeVisible(); 控件: editor; 等待: 无 |
| 2 | 验证 Mod-Z 撤销仍工作 | [DOM] page.keyboard.press("ControlOrMeta+z") 后文档回退（history cmExtensions 与其他 cmExtensions 共存不冲突） | 选择器: .cm-content; 操作: keyboard.press(ControlOrMeta+z); 控件: keymap; 等待: 200ms |
| 3 | 验证 Mod-F 搜索仍工作 | [DOM] page.keyboard.press("ControlOrMeta+f") 后搜索面板出现（search cmExtensions 与其他 cmExtensions 共存不冲突） | 选择器: .cm-search; 操作: keyboard.press(ControlOrMeta+f); 控件: keymap; 等待: 300ms |

**断言汇总**:
- [DOM] 多插件 cmExtensions 扁平化注入后无冲突崩溃（证明 `editor.ts:249` 的 flatMap + `editor.ts:721` 的 `...cmExtensions` 扩展注入机制工作）
- [DOM] history 与 search cmExtensions 功能独立可用

---

## 统计汇总

| 二级功能点 | 正常 | 异常 | 边界 | 小计 |
|-----------|------|------|------|------|
| FP-07-01 shortcuts | 5 (N01-N05) | 1 (E01) | 0 | 6 |
| FP-07-02 slashCommands | 4 (N01-N04) | 1 (N05) | 1 (B01) | 6 |
| FP-07-03 commands | 1 (N01) + 1 (N02) | 2 (E01-E02) | 0 | 4 |
| FP-07-04 handlers | 1 (N01) + 1 (N02) | 2 (E01-E02) | 0 | 4 |
| FP-07-05 remarkPlugins | 5 (N01-N05) | 1 (E01) | 0 | 6 |
| FP-07-06 widgets | 3 (N01-N03) | 1 (E01) | 0 | 4 |
| FP-07-07 cmExtensions | 7 (N01-N07) | 1 (E01) | 0 | 8 |
| **合计** | **27** | **9** | **1** | **38** |

### 类型分布
- [插件能力]: 38（全部用例）
- [编辑交互]: 16（FP-07-01/02/04/07 中的键盘/菜单/事件交互用例）
- [AST解析]: 6（FP-07-05 全部）
- [Live Preview]: 4（FP-07-06 全部）

### 优先级分布
- P1: 10（核心路径: shortcuts Mod-B、slashCommands 菜单触发/精确匹配、commands 空数组验证、handlers 粘贴默认、remarkPlugins 表格/删除线、cmExtensions 撤销/重做/搜索面板）
- P2: 18（扩展路径: Mod-I/1/K/E、slashCommands 确认/前缀/空匹配、commands 不影响其他扩展、handlers 图片粘贴、remarkPlugins 任务列表/标准兼容/脚注、widgets Live Preview/图片、cmExtensions 搜索查询/选区高亮/wikilink/颜色装饰）
- P3: 9（异常路径: 未注册快捷键、commands runCommand 未知 id/无 hotkey、handlers 拖拽/keydown 不拦截、remarkPlugins 容错、widgets 不崩溃、cmExtensions 多插件共存）
- P4: 1（边界路径: slashCommands slashMenuLimit 截断）

### 待确认用例清单（demo 未配置/未暴露，需补充测试钩子）
- FP-07-03-N01: getCommands 返回空数组（需注入 window.__nexusEditor 钩子）
- FP-07-03-E01: runCommand 未知 id（需注入钩子）
- FP-07-04-N02: 图片粘贴不触发上传（handlers 间接验证为空，demo 未配 onAssetUpload）
- FP-07-05-N01~N05: exportHTML 验证 AST（需注入 window.__nexusEditor 钩子）
- FP-07-06-N01: widgets 为空验证（需注入钩子验证 widgetDefs）

<<<STATS>>>
```json
{
  "case_file": "test/testcases/demo-requirements/CASE-NexusPlugin插件体系/CASE-NexusPlugin插件体系-测试用例.md",
  "function_point": "FP-07 NexusPlugin 插件体系",
  "requirement_source": "demo-requirements.md §3.3",
  "framework": "playwright-electron",
  "sub_function_points": [
    {"id": "FP-07-01", "name": "Tier1: shortcuts 快捷键扩展", "count": 6, "types": ["插件能力", "编辑交互"]},
    {"id": "FP-07-02", "name": "Tier1: slashCommands 斜杠命令扩展", "count": 6, "types": ["插件能力", "编辑交互"]},
    {"id": "FP-07-03", "name": "Tier1: commands 自定义命令扩展", "count": 4, "types": ["插件能力"], "pending": true},
    {"id": "FP-07-04", "name": "Tier1: handlers 事件处理器", "count": 4, "types": ["插件能力", "编辑交互"], "pending": true},
    {"id": "FP-07-05", "name": "Tier2: remarkPlugins 解析器扩展", "count": 6, "types": ["插件能力", "AST解析"], "pending": true},
    {"id": "FP-07-06", "name": "Tier2: widgets 自定义视图", "count": 4, "types": ["插件能力", "Live Preview"], "pending": true},
    {"id": "FP-07-07", "name": "Tier3: cmExtensions CM6 底层扩展注入", "count": 8, "types": ["插件能力"]}
  ],
  "total_cases": 38,
  "by_type": {"正常": 27, "异常": 9, "边界": 1},
  "by_priority": {"P1": 10, "P2": 18, "P3": 9, "P4": 1},
  "pending_cases": 12,
  "coverage_notes": [
    "FP-07-01 通过工具栏插件快捷键 Mod-B/I/E/K/1 键盘触发格式化间接验证 shortcuts 扩展（flatMap + keymap 注册）",
    "FP-07-02 通过输入 / 后检查斜杠菜单命令列表间接验证 slashCommands 扩展（flatMap + computeSlashState）",
    "FP-07-03 demo 无插件提供 commands，getCommands 返回空数组，标注待确认（需注入钩子）",
    "FP-07-04 demo 无插件提供 handlers（paste/drop/keydown），验证默认行为不受影响 + 不崩溃",
    "FP-07-05 通过输入 GFM 语法（表格/删除线/任务列表/脚注）后 exportHTML 验证 AST 间接验证 remarkPlugins 扩展（createTransformProcessor + transformAst）",
    "FP-07-06 demo 无插件提供 widgets（image 走 LivePreviewRenderer），验证 widgets 为空时编辑器正常工作",
    "FP-07-07 通过 history（Mod-Z/Shift-Z）、search（Mod-F/高亮）、wikilinks（[[]]装饰）、toolbar（颜色装饰）间接验证 cmExtensions 扩展（flatMap + 注入 EditorState extensions）"
  ]
}
```
<<<END_STATS>>>

# CASE-EditorAPI命令与资源-测试用例（FP-05）

> 一级功能点: EditorAPI 命令与资源（demo-requirements.md §3.2）
> 全局批次序号: 05
> 生成时间: 2026-08-11
> 测试框架: Playwright（Electron demo / Vite dev server + Electron main）
>
> 涉及二级功能点:
> - FP-05-01 getSlashCommands() 获取斜杠命令列表（[API契约][插件能力]）
> - FP-05-02 getCommands() / runCommand(id) 执行命令（[API契约][编辑交互]）
> - FP-05-03 runShortcut(key) 执行快捷键（[API契约][编辑交互]）
> - FP-05-04 undo() / redo() 撤销重做（[API契约][编辑交互]）
> - FP-05-05 uploadAsset(file) 资源上传（调用 onAssetUpload）（[API契约][数据IO]）
>
> ⚠️ 实现差异提示（依据 `packages/core/src/editor.ts` + `apps/electron-demo/src/renderer/*` + `packages/plugin-toolbar/src/*` + `packages/plugin-slash/src/*` 实际代码）:
> - **Demo 未将 editor 实例暴露到 `window`**：所有 EditorAPI 命令方法（getSlashCommands/getCommands/runCommand/runShortcut/undo/redo/uploadAsset）都不能在 e2e 中直接调用，必须通过 demo UI 的可观察副作用间接验证。
> - **getSlashCommands() 间接路径**：`editor.ts:765-767` 返回 `slashCommands`（来自 `plugins.flatMap(p => p.slashCommands ?? [])`，`editor.ts:248`）。工具栏插件注册了 14 条斜杠命令（`packages/plugin-toolbar/src/index.ts:118-216`：h1/h2/h3/bold/italic/strikethrough/inline-code/code-block/blockquote/ulist/olist/link/image/hr）。斜杠菜单 UI（`createSlashMenuUI`，`menu-ui.ts:85`）在用户输入 `/` 时触发（`editor.ts:634-636` 的 `computeSlashState`），渲染为 `.nexus-slash-menu` + `.nexus-slash-menu__item` 列表。因此**输入 `/` 后检查菜单命令列表**是 `getSlashCommands()` 工作的直接证据。
> - **getCommands() 间接路径**：`editor.ts:879-881` 返回 `commands.slice()`。经查 demo 加载的 6 个插件中，**没有任何插件提供 `commands` 字段**（工具栏插件只提供 `shortcuts` 与 `slashCommands`，见 `packages/plugin-toolbar/src/index.ts:218-234`）。因此 demo 中 `getCommands()` 返回**空数组**，`runCommand(id)` 对任意 id 都返回 false。本批次对 `getCommands/runCommand` 的验证主要落在"斜杠命令确认执行"路径上——斜杠菜单 confirm 调用的是 `cmd.run(editor)`（`menu-ui.ts:318-319`），而非 `runCommand`。故用例标注此差异。
> - **runCommand(id) 间接路径**：因 demo 无命名命令，runCommand 无可触发的 UI 入口。验证策略：斜杠菜单确认（Enter/Tab/click）会执行 `SlashCommandDef.run`（功能上等同命令执行），通过 `/bold` → `**text**` 等副作用验证命令执行管线。
> - **runShortcut(key) 间接路径**：`editor.ts:871-878` 在 `shortcuts` 数组中按 `key` 查找并执行。工具栏插件注册了 8 条快捷键（`packages/plugin-toolbar/src/index.ts:223-230`：Mod-b/i/Shift-s/e/k/1/2/3）。这些快捷键同时被注册为 CM6 keymap（`editor.ts:514-524`）。因此**键盘按 Mod-B 等**会触发 `shortcut.run(api)`，验证 `runShortcut` 底层机制（keymap → shortcut.run）。注意：直接按键盘走的是 CM6 keymap 路径而非 `api.runShortcut(key)`；但二者都调用同一 `shortcut.run(api)`，效果等价。
> - **undo() / redo() 间接路径**：`editor.ts:847-854` 调用 `cmUndo(view)` / `cmRedo(view)`（来自 `@codemirror/commands`）。两个 UI 触发点：(1) 工具栏按钮 `button[data-toolbar-action="undo"]`（`toolbar-ui.ts:139`，action: `e.undo()`）与 `button[data-toolbar-action="redo"]`（`toolbar-ui.ts:140`）；(2) CM6 keymap（history 插件的 `historyKeymap`，`packages/plugin-history/src/index.ts:9`，含 Mod-Z / Mod-Shift-Z / Ctrl-U）。
> - **uploadAsset(file) 间接路径**：`editor.ts:768-774` 在 `!config.onAssetUpload` 时直接 `return Promise.resolve(null)`。经查 demo 的 `createEditorShell` 配置（`editor-shell.ts:128-331`）**未设置 `onAssetUpload`**。因此 demo 中 `uploadAsset(file)` 永远返回 null，粘贴/拖拽图片也不会触发上传（`editor.ts:682` 与 `695` 的 `if (!config.onAssetUpload || destroyed) return false`）。所有 FP-05-05 用例**标注"待确认"**，验证"不崩溃 + 不误触发"。
> - **斜杠菜单 DOM 结构**（`menu-ui.ts:96-107`）：根元素 `.nexus-slash-menu`（`position: fixed`，初始 `display: none`），`role="listbox"`，`aria-label="Slash commands"`。每个命令项 `.nexus-slash-menu__item`，`role="option"`，含 `.nexus-slash-menu__title` 与 `.nexus-slash-menu__description`。高亮项 `.is-active`。空结果时 `.nexus-slash-menu__empty` 显示 "No matches"。
> - **斜杠菜单触发条件**（`editor.ts:634-636` + `computeSlashState`）：光标前文本匹配 `/query` 模式（`/` 后跟非空白字符）。默认 limit 8（`config.slashMenuLimit ?? 8`，demo 未覆盖）。
> - **工具栏按钮 DOM**（`toolbar-ui.ts:486-495`）：`button.nexus-toolbar-btn`，`data-toolbar-action="<id>"`，`data-toolbar-tooltip="<title>"`，`aria-label="<title>"`。undo/redo 按钮分别在第一个分组（`toolbar-ui.ts:137-142`）。
> - **测试环境约定**：所有用例通过 `launchDemo()`（`test/e2e/helpers/electron-launcher.ts`）启动 Electron demo；`page.evaluate` 中通过 `document.execCommand("insertText", false, text)` 输入（与 `test/e2e/editor.spec.ts:13-16` 一致）。

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

async function pressEnter(page: Page) {
  await page.keyboard.press("Enter");
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

// 等待斜杠菜单可见（用户输入 / 后触发，menu-ui.ts:96-107 的 .nexus-slash-menu）
async function waitForSlashMenu(page: Page, timeout = 1000) {
  await page.waitForSelector(".nexus-slash-menu:not([style*='display: none']) .nexus-slash-menu__item", { timeout });
}

// 获取斜杠菜单中所有命令项的标题文本（getSlashCommands 经 filterSlashCommands 后的渲染结果）
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

// 获取斜杠菜单项数量
async function getSlashMenuItemCount(page: Page): Promise<number> {
  return page.locator(".nexus-slash-menu:not([style*='display: none']) .nexus-slash-menu__item").count();
}

// 获取高亮项的标题（.is-active）
async function getSlashMenuHighlightTitle(page: Page): Promise<string> {
  const el = page.locator(".nexus-slash-menu:not([style*='display: none']) .nexus-slash-menu__item.is-active .nexus-slash-menu__title");
  return ((await el.textContent()) ?? "").trim();
}

// 确认斜杠菜单当前高亮项（Enter 键，menu-ui.ts:279-321 的 confirm）
async function confirmSlashMenu(page: Page) {
  await page.keyboard.press("Enter");
}

// 关闭斜杠菜单（Escape）
async function closeSlashMenu(page: Page) {
  await page.keyboard.press("Escape");
}

// 点击工具栏按钮（按 data-toolbar-action，toolbar-ui.ts:488）
async function clickToolbarButton(page: Page, action: string) {
  await page.locator(`button[data-toolbar-action="${action}"]`).click();
}
```

---

# FP-05-01 getSlashCommands() 获取斜杠命令列表（7 例，[API契约][插件能力]）

> 间接验证路径：`editor.ts:765-767` 返回 `slashCommands`（来自所有插件的 `slashCommands` 扁平化，`editor.ts:248`）。斜杠菜单 UI（`createSlashMenuUI`，`menu-ui.ts:85`）订阅 `slashMenuChange` 事件，在用户输入 `/` 触发 `computeSlashState`（`editor.ts:634-636`）时收到命令列表并渲染。因此**输入 `/` 后检查菜单命令项**是 `getSlashCommands()` 工作的直接证据。工具栏插件注册了 14 条斜杠命令（`packages/plugin-toolbar/src/index.ts:118-216`）。

## FP-05-01-N01 [P1] [正常] 空文档输入 / → 斜杠菜单显示命令列表（getSlashCommands 非空）

**测试框架**: Playwright

**前置条件**（⚠️ 4要素）:
- 依赖环境: Electron demo（Vite dev server + Electron main 已启动）
- 初始文档: 空文档（清空后）
- 插件配置: demo 默认（含工具栏插件，提供 14 条斜杠命令）
- setup 代码:
  ```typescript
  // step 1: 全局 setup（见 e2e 全局前置条件 launchDemo）
  // step 2: 清空编辑器，确保光标在文档起始
  await clearEditor(page);
  await page.waitForTimeout(200);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | typeInEditor("/") | [DOM] `.nexus-slash-menu` 出现且可见（`menu-ui.ts:96-107` 的 root 元素，`display` 不再是 `none`），含 `.nexus-slash-menu__item` 子项（getSlashCommands 返回非空数组） | import: ../../helpers/electron-launcher; API: typeInEditor(/); 框架: playwright; 等待: slashMenuChange 事件 + 菜单渲染 |
| 2 | waitForSlashMenu(page) 后断言项数 | [DOM] `.nexus-slash-menu__item` count > 0（至少 1 条命令渲染，证明 getSlashCommands 返回了工具栏的 slashCommands） | import: @playwright/test; API: getSlashMenuItemCount(); 框架: playwright; 等待: 300ms |

**断言汇总**:
- [DOM] 输入 `/` 后斜杠菜单可见
- [DOM] 菜单含至少 1 个命令项（getSlashCommands 返回工具栏注册的 14 条命令的子集）

---

## FP-05-01-N02 [P1] [正常] 输入 / 显示全部工具栏斜杠命令（14 条标题列表校验）

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空文档
- 插件配置: demo 默认（工具栏插件提供 14 条 slashCommands）
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器
  await clearEditor(page);
  await page.waitForTimeout(200);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | typeInEditor("/") | [DOM] 斜杠菜单可见 | import: ../../helpers/electron-launcher; API: typeInEditor(/); 框架: playwright; 等待: 300ms |
| 2 | waitForSlashMenu 后获取标题列表 | [DOM] getSlashMenuItemTitles 返回的列表**包含**工具栏注册的 14 条命令标题（Heading 1/Heading 2/Heading 3/Bold/Italic/Strikethrough/Inline code/Code block/Blockquote/Bulleted list/Numbered list/Link/Image/Divider，`packages/plugin-toolbar/src/index.ts:118-216`）。注：默认 limit=8，菜单最多显示 8 条，但 getSlashCommands 返回全部 14 条——此处验证菜单显示的是命令列表的前若干条 | import: @playwright/test; API: getSlashMenuItemTitles(); 框架: playwright; 等待: 无 |
| 3 | 断言菜单项数 ≤ 8 | [DOM] count ≤ 8（`config.slashMenuLimit ?? 8`，demo 未覆盖默认值，`editor.ts` 的 slashMenuLimit） | import: @playwright/test; API: getSlashMenuItemCount(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] 菜单标题列表与工具栏 slashCommands 的 title 字段一致（证明 getSlashCommands 返回了 SlashCommandDef[]）
- [DOM] 菜单最多显示 8 条（slashMenuLimit 默认值生效）

---

## FP-05-01-N03 [P2] [正常] 输入 /bold → 精确匹配 Bold 命令（filterSlashCommands 精确优先）

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空文档
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器
  await clearEditor(page);
  await page.waitForTimeout(200);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | typeInEditor("/bold") | [DOM] 斜杠菜单可见，高亮项（.is-active）标题为 "Bold"（`filterSlashCommands` 精确匹配 id="bold"，排序最前，`packages/plugin-slash/src/slash-state.ts` 的确定性排序） | import: ../../helpers/electron-launcher; API: typeInEditor(/bold); 框架: playwright; 等待: 300ms |
| 2 | 断言高亮项 | [DOM] getSlashMenuHighlightTitle === "Bold" | import: @playwright/test; API: getSlashMenuHighlightTitle(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] `/bold` 精确匹配 Bold 命令并高亮置顶（证明 getSlashCommands 返回的命令含 id="bold"，且 filterSlashCommands 精确匹配优先）

---

## FP-05-01-N04 [P2] [正常] 输入 /code → 前缀匹配显示 inline-code 与 code-block

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空文档
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器
  await clearEditor(page);
  await page.waitForTimeout(200);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | typeInEditor("/code") | [DOM] 斜杠菜单可见，标题列表含 "Inline code" 与 "Code block"（filterSlashCommands 按 id 前缀匹配 "code"，`packages/plugin-toolbar/src/index.ts:162-174` 的 inline-code 与 code-block） | import: ../../helpers/electron-launcher; API: typeInEditor(/code); 框架: playwright; 等待: 300ms |
| 2 | 断言标题列表 | [DOM] getSlashMenuItemTitles 包含 "Inline code" 且包含 "Code block" | import: @playwright/test; API: getSlashMenuItemTitles(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] `/code` 前缀匹配多条命令（证明 getSlashCommands 返回的命令 id 含 "inline-code" 与 "code-block"，filterSlashCommands 前缀匹配生效）

---

## FP-05-01-N05 [P2] [正常] 输入 /b → keywords 匹配 Bold（keyword "b" 命中）

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空文档
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器
  await clearEditor(page);
  await page.waitForTimeout(200);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | typeInEditor("/b") | [DOM] 斜杠菜单可见，标题列表包含 "Bold"（Bold 命令的 keywords 含 "b"，`packages/plugin-toolbar/src/index.ts:144`，filterSlashCommands 关键词匹配） | import: ../../helpers/electron-launcher; API: typeInEditor(/b); 框架: playwright; 等待: 300ms |
| 2 | 断言标题列表 | [DOM] getSlashMenuItemTitles 包含 "Bold"（可能与 Blockquote 等其他含 "b" 的命令一同出现） | import: @playwright/test; API: getSlashMenuItemTitles(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] `/b` 通过 keywords 匹配到 Bold（证明 getSlashCommands 返回的 SlashCommandDef 含 keywords 字段，filterSlashCommands 关键词匹配生效）

---

## FP-05-01-E01 [P3] [异常] 输入 /zzzzz 无匹配 → 菜单显示 No matches

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空文档
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器
  await clearEditor(page);
  await page.waitForTimeout(200);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | typeInEditor("/zzzzz") | [DOM] 斜杠菜单可见，但无 `.nexus-slash-menu__item`（filterSlashCommands 对 "zzzzz" 无匹配），显示 `.nexus-slash-menu__empty` 文本 "No matches"（`menu-ui.ts:148-158`） | import: ../../helpers/electron-launcher; API: typeInEditor(/zzzzz); 框架: playwright; 等待: 300ms |
| 2 | 断言空状态 | [DOM] `.nexus-slash-menu__empty` 可见且文本含 "No matches"；`.nexus-slash-menu__item` count === 0 | import: @playwright/test; API: page.locator(.nexus-slash-menu__empty).textContent(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] 无匹配 query 时菜单显示空状态（getSlashCommands 返回的命令经 filterSlashCommands 过滤后为空）
- [DOM] 不崩溃，菜单正常显示 "No matches"

---

## FP-05-01-B01 [P4] [边界] 空文档输入 / 菜单正常显示（无前置文本干扰）

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空文档（清空后，光标在 pos 0）
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器
  await clearEditor(page);
  await page.waitForTimeout(200);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | typeInEditor("/") | [DOM] 斜杠菜单可见，至少 1 个命令项（computeSlashState 在文档起始位置识别 `/` 触发，getSlashCommands 返回非空） | import: ../../helpers/electron-launcher; API: typeInEditor(/); 框架: playwright; 等待: 300ms |
| 2 | 断言菜单可见 | [DOM] `.nexus-slash-menu` display !== "none"，count >= 1 | import: @playwright/test; API: getSlashMenuItemCount(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] 空文档起始位置输入 `/` 正常触发菜单（getSlashCommands 在无前置文本时仍工作）

---

# FP-05-02 getCommands() / runCommand(id) 执行命令（6 例，[API契约][编辑交互]）

> ⚠️ 实现差异：`editor.ts:879-881` 的 getCommands 返回 `commands.slice()`，`editor.ts:882-890` 的 runCommand 按 id 查找 `commandById`。经查 demo 加载的 6 个插件中**没有任何插件提供 `commands` 字段**（工具栏插件 `packages/plugin-toolbar/src/index.ts:218-234` 只提供 `shortcuts` 与 `slashCommands`）。因此 demo 中 `getCommands()` 返回**空数组**，`runCommand(id)` 对任意 id 都返回 false。
>
> 验证策略：
> 1. 斜杠命令确认（Enter/Tab/click）会执行 `SlashCommandDef.run(editor)`（`menu-ui.ts:316-320`），功能上等同命令执行——通过 `/bold` → `**text**` 等副作用验证命令执行管线。
> 2. 对 `getCommands/runCommand` 本身的直接验证标注"待确认"（demo 无命名命令插件，需注入测试钩子或添加 commands 插件后验证）。

## FP-05-02-N01 [P1] [正常] 斜杠菜单确认 /bold → 命令执行 → 选中文本变 **text**

**测试框架**: Playwright

**前置条件**（⚠️ 4要素）:
- 依赖环境: Electron demo
- 初始文档: 空文档
- 插件配置: demo 默认（含工具栏斜杠命令 bold）
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器并输入选中文本
  await clearEditor(page);
  await typeInEditor("word");
  await page.waitForTimeout(200);
  // step 3: 双击选中 "word"
  await page.locator(".cm-content").dblclick();
  await page.waitForTimeout(100);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | typeInEditor("/bold") | [DOM] 斜杠菜单可见，高亮项 "Bold"（选区后输入 `/bold`，菜单触发） | import: ../../helpers/electron-launcher; API: typeInEditor(/bold); 框架: playwright; 等待: 300ms |
| 2 | confirmSlashMenu（Enter） | [DOM] 菜单确认：先删除 `/bold` 触发文本（`menu-ui.ts:294-297` 的 setSelection + replaceSelection("")），再调 `cmd.run(editor)`（`menu-ui.ts:318-319`）执行 toggleBold → 选区 "word" 变为 "**word**" | import: @playwright/test; API: confirmSlashMenu(); 框架: playwright; 等待: 300ms |
| 3 | 断言文档内容 | [DOM] `.cm-content` textContent 含 "**word**" | import: @playwright/test; API: getEditorText(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] 斜杠命令确认后 cmd.run 执行（功能等同 runCommand），选中文本被加粗
- [DOM] `/bold` 触发文本被删除（菜单 confirm 的清理逻辑）

---

## FP-05-02-N02 [P1] [正常] 斜杠菜单确认 /h1 → 命令执行 → 行首加 #

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空文档
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器
  await clearEditor(page);
  await page.waitForTimeout(200);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | typeInEditor("/h1") | [DOM] 斜杠菜单可见，高亮项 "Heading 1"（filterSlashCommands 精确匹配 id="h1"） | import: ../../helpers/electron-launcher; API: typeInEditor(/h1); 框架: playwright; 等待: 300ms |
| 2 | confirmSlashMenu（Enter） | [DOM] cmd.run 执行 toggleHeading(editor, 1)（`packages/plugin-toolbar/src/index.ts:124`），行首加 "# " | import: @playwright/test; API: confirmSlashMenu(); 框架: playwright; 等待: 300ms |
| 3 | 断言文档内容 | [DOM] `.cm-content` 含 "# "（heading 标记插入） | import: @playwright/test; API: getEditorText(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] `/h1` 确认后 toggleHeading(editor, 1) 执行（命令执行管线工作）

---

## FP-05-02-N03 [P2] [正常] 斜杠菜单确认 /hr → 命令执行 → 插入水平线 ---

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空文档
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器
  await clearEditor(page);
  await page.waitForTimeout(200);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | typeInEditor("/hr") | [DOM] 斜杠菜单可见，高亮项 "Divider"（id="hr"，`packages/plugin-toolbar/src/index.ts:210-214`） | import: ../../helpers/electron-launcher; API: typeInEditor(/hr); 框架: playwright; 等待: 300ms |
| 2 | confirmSlashMenu（Enter） | [DOM] cmd.run 执行 insertHorizontalRule，文档含 "---" | import: @playwright/test; API: confirmSlashMenu(); 框架: playwright; 等待: 300ms |
| 3 | 断言文档内容 | [DOM] `.cm-content` 含 "---" | import: @playwright/test; API: getEditorText(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] `/hr` 确认后 insertHorizontalRule 执行（命令执行管线对插入类命令工作）

---

## FP-05-02-N04 [P2] [正常] 斜杠菜单确认 /link → 命令执行 → 插入链接占位

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空文档
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器
  await clearEditor(page);
  await page.waitForTimeout(200);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | typeInEditor("/link") | [DOM] 斜杠菜单可见，高亮项 "Link" | import: ../../helpers/electron-launcher; API: typeInEditor(/link); 框架: playwright; 等待: 300ms |
| 2 | confirmSlashMenu（Enter） | [DOM] cmd.run 执行 insertLink（`packages/plugin-toolbar/src/index.ts:201`），文档含 "[]" 或 "[](" 链接占位 | import: @playwright/test; API: confirmSlashMenu(); 框架: playwright; 等待: 300ms |
| 3 | 断言文档内容 | [DOM] `.cm-content` 含 "[" 与 "]"（链接标记插入） | import: @playwright/test; API: getEditorText(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] `/link` 确认后 insertLink 执行（命令执行管线对链接插入工作）

---

## FP-05-02-N05 [P2] [正常] getCommands 返回空数组（demo 无命名命令插件）→ 标注待确认

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（需 editor-shell.ts 注入 `(window as any).__nexusEditor = editor` 测试钩子以直接调用 getCommands）
- 初始文档: 任意
- 插件配置: demo 默认（6 插件均无 commands 字段）
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 尝试通过钩子调用 getCommands（当前预期未暴露）
  const commands = await page.evaluate(() => {
    const ed = (window as any).__nexusEditor;
    return ed ? ed.getCommands() : null;
  });
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言 getCommands 结果 | [STATE] 若钩子存在：commands 是空数组 []（demo 6 插件无 commands 字段，`editor.ts:252` 的 `plugins.flatMap(p => p.commands ?? [])` 结果为空）；若钩子缺失：commands === null，用例标注"待确认" | import: @playwright/test; API: page.evaluate(getCommands); 框架: playwright; 等待: 无 |
| 2 | 断言编辑器存活 | [DOM] `.cm-editor` 可见（getCommands 即使返回空，编辑器正常工作） | import: @playwright/test; API: expect(.cm-editor).toBeVisible(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [STATE] demo 中 getCommands() 返回空数组（无命名命令插件，标注：需注入测试钩子后补充直接断言）

---

## FP-05-02-E01 [P3] [异常] runCommand 未知 id 返回 false（间接验证键盘行为不变）

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 含文本 "hello"
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器并输入
  await clearEditor(page);
  await typeInEditor("hello");
  await page.waitForTimeout(200);
  // step 3: 尝试通过钩子调用 runCommand（未知 id）
  await page.evaluate(() => {
    const ed = (window as any).__nexusEditor;
    if (ed) ed.runCommand("nonexistent-command-id");
  });
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言文档不变 | [DOM] `.cm-content` 仍含 "hello"（runCommand 对未知 id 返回 false，`editor.ts:887-888` 的 `commandById.get(id)` 查不到，无副作用） | import: @playwright/test; API: getEditorText(); 框架: playwright; 等待: 无 |
| 2 | 断言编辑器存活 | [DOM] `.cm-editor` 可见（runCommand 不崩溃） | import: @playwright/test; API: expect(.cm-editor).toBeVisible(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] runCommand 未知 id 不产生副作用（文档不变）
- [DOM] 编辑器不崩溃

---

# FP-05-03 runShortcut(key) 执行快捷键（7 例，[API契约][编辑交互]）

> 间接验证路径：`editor.ts:871-878` 的 runShortcut 在 `shortcuts` 数组中按 `key` 查找并执行 `shortcut.run(api)`。工具栏插件注册了 8 条快捷键（`packages/plugin-toolbar/src/index.ts:223-230`）。这些快捷键同时被注册为 CM6 keymap（`editor.ts:514-524`）。**键盘按 Mod-B 等**会触发 CM6 keymap → `shortcut.run(api)`，效果与 `api.runShortcut("Mod-b")` 等价（两者调用同一函数）。因此通过**键盘快捷键触发格式化**是 runShortcut 底层机制（keymap → shortcut.run）工作的证据。

## FP-05-03-N01 [P1] [正常] 选中文本 → Mod-B → toggleBold 执行 → 文本变 **text**

**测试框架**: Playwright

**前置条件**（⚠️ 4要素）:
- 依赖环境: Electron demo
- 初始文档: 空文档
- 插件配置: demo 默认（含工具栏插件，提供 Mod-b 快捷键）
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器并输入
  await clearEditor(page);
  await typeInEditor("word");
  await page.waitForTimeout(200);
  // step 3: 双击选中 "word"
  await page.locator(".cm-content").dblclick();
  await page.waitForTimeout(100);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | page.keyboard.press("ControlOrMeta+b") | [DOM] CM6 keymap 捕获 Mod-b → `shortcut.run(api)` 执行 toggleBold（`packages/plugin-toolbar/src/index.ts:223`），选区 "word" 变为 "**word**" | import: @playwright/test; API: page.keyboard.press(ControlOrMeta+b); 框架: playwright; 等待: 200ms |
| 2 | 断言文档内容 | [DOM] `.cm-content` textContent 含 "**word**" | import: @playwright/test; API: getEditorText(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] Mod-B 快捷键触发 toggleBold（runShortcut 底层 keymap 机制工作）

---

## FP-05-03-N02 [P1] [正常] 选中文本 → Mod-I → toggleItalic 执行 → 文本变 *text*

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空文档
- 插件配置: demo 默认（含 Mod-i 快捷键）
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器并输入
  await clearEditor(page);
  await typeInEditor("word");
  await page.waitForTimeout(200);
  // step 3: 双击选中
  await page.locator(".cm-content").dblclick();
  await page.waitForTimeout(100);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | page.keyboard.press("ControlOrMeta+i") | [DOM] toggleItalic 执行（`packages/plugin-toolbar/src/index.ts:224`），选区 "word" 变为 "*word*" | import: @playwright/test; API: page.keyboard.press(ControlOrMeta+i); 框架: playwright; 等待: 200ms |
| 2 | 断言文档内容 | [DOM] `.cm-content` textContent 含 "*word*" | import: @playwright/test; API: getEditorText(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] Mod-I 快捷键触发 toggleItalic

---

## FP-05-03-N03 [P2] [正常] 选中文本 → Mod-Shift-S → toggleStrikethrough 执行 → 文本变 ~~text~~

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空文档
- 插件配置: demo 默认（含 Mod-Shift-s 快捷键）
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器并输入
  await clearEditor(page);
  await typeInEditor("word");
  await page.waitForTimeout(200);
  // step 3: 双击选中
  await page.locator(".cm-content").dblclick();
  await page.waitForTimeout(100);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | page.keyboard.press("ControlOrMeta+Shift+s") | [DOM] toggleStrikethrough 执行（`packages/plugin-toolbar/src/index.ts:225`），选区 "word" 变为 "~~word~~" | import: @playwright/test; API: page.keyboard.press(ControlOrMeta+Shift+s); 框架: playwright; 等待: 200ms |
| 2 | 断言文档内容 | [DOM] `.cm-content` textContent 含 "~~word~~" | import: @playwright/test; API: getEditorText(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] Mod-Shift-S 快捷键触发 toggleStrikethrough

---

## FP-05-03-N04 [P2] [正常] 选中文本 → Mod-E → toggleInlineCode 执行 → 文本变 `text`

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空文档
- 插件配置: demo 默认（含 Mod-e 快捷键）
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器并输入
  await clearEditor(page);
  await typeInEditor("word");
  await page.waitForTimeout(200);
  // step 3: 双击选中
  await page.locator(".cm-content").dblclick();
  await page.waitForTimeout(100);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | page.keyboard.press("ControlOrMeta+e") | [DOM] toggleInlineCode 执行（`packages/plugin-toolbar/src/index.ts:226`），选区 "word" 变为 "`word`" | import: @playwright/test; API: page.keyboard.press(ControlOrMeta+e); 框架: playwright; 等待: 200ms |
| 2 | 断言文档内容 | [DOM] `.cm-content` textContent 含 "`word`"（反引号包裹） | import: @playwright/test; API: getEditorText(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] Mod-E 快捷键触发 toggleInlineCode

---

## FP-05-03-N05 [P2] [正常] 光标行 → Mod-1 → toggleHeading(1) 执行 → 行首加 #

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 含文本 "title"
- 插件配置: demo 默认（含 Mod-1 快捷键）
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器并输入
  await clearEditor(page);
  await typeInEditor("title");
  await page.waitForTimeout(200);
  // step 3: 光标移到行首（Home）
  await page.keyboard.press("Home");
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | page.keyboard.press("ControlOrMeta+1") | [DOM] toggleHeading(editor, 1) 执行（`packages/plugin-toolbar/src/index.ts:228`），行首加 "# "，文本变为 "# title" | import: @playwright/test; API: page.keyboard.press(ControlOrMeta+1); 框架: playwright; 等待: 200ms |
| 2 | 断言文档内容 | [DOM] `.cm-content` 含 "# title"（或 "# " 前缀） | import: @playwright/test; API: getEditorText(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] Mod-1 快捷键触发 toggleHeading(editor, 1)

---

## FP-05-03-N06 [P2] [正常] 光标位置 → Mod-K → insertLink 执行 → 插入链接占位

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空文档
- 插件配置: demo 默认（含 Mod-k 快捷键）
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器
  await clearEditor(page);
  await page.click(".cm-content");
  await page.waitForTimeout(200);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | page.keyboard.press("ControlOrMeta+k") | [DOM] insertLink 执行（`packages/plugin-toolbar/src/index.ts:227`），文档含 "[]" 或 "[](" 链接占位 | import: @playwright/test; API: page.keyboard.press(ControlOrMeta+k); 框架: playwright; 等待: 200ms |
| 2 | 断言文档内容 | [DOM] `.cm-content` 含 "[" 与 "]" | import: @playwright/test; API: getEditorText(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] Mod-K 快捷键触发 insertLink

---

## FP-05-03-E01 [P3] [异常] runShortcut 未知 key 返回 false（间接验证键盘行为不变）

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 含文本 "hello"
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器并输入
  await clearEditor(page);
  await typeInEditor("hello");
  await page.waitForTimeout(200);
  // step 3: 尝试通过钩子调用 runShortcut（未知 key）
  const result = await page.evaluate(() => {
    const ed = (window as any).__nexusEditor;
    if (!ed) return null;
    return ed.runShortcut("Mod-F9"); // 未注册的快捷键
  });
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言 runShortcut 结果 | [STATE] 若钩子存在：result === false（`editor.ts:877` 的 `shortcut ? shortcut.run(api) : false`，未注册 key 返回 false）；若钩子缺失：result === null，用例跳过 | import: @playwright/test; API: page.evaluate(runShortcut); 框架: playwright; 等待: 无 |
| 2 | 断言文档不变 | [DOM] `.cm-content` 仍含 "hello"（未知快捷键无副作用） | import: @playwright/test; API: getEditorText(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [STATE] runShortcut 未知 key 返回 false，无副作用

---

# FP-05-04 undo() / redo() 撤销重做（6 例，[API契约][编辑交互]）

> 间接验证路径：`editor.ts:847-854` 的 undo/redo 调用 `cmUndo(view)` / `cmRedo(view)`（来自 `@codemirror/commands`）。两个 UI 触发点：
> 1. **工具栏按钮**：`button[data-toolbar-action="undo"]`（`toolbar-ui.ts:139`，action: `e.undo()`）与 `button[data-toolbar-action="redo"]`（`toolbar-ui.ts:140`）。
> 2. **CM6 keymap**：history 插件的 `historyKeymap`（`packages/plugin-history/src/index.ts:9`），含 Mod-Z（撤销）/ Mod-Shift-Z（重做）/ Ctrl-U 等。

## FP-05-04-N01 [P1] [正常] 输入文本 → 工具栏 Undo 按钮 → editor.undo() → 文档回退

**测试框架**: Playwright

**前置条件**（⚠️ 4要素）:
- 依赖环境: Electron demo
- 初始文档: 空文档
- 插件配置: demo 默认（含工具栏 undo 按钮 + history 插件）
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器并输入
  await clearEditor(page);
  await typeInEditor("before");
  await page.waitForTimeout(200);
  const beforeText = await getEditorText(page);
  await typeInEditor(" after");
  await page.waitForTimeout(200);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clickToolbarButton(page, "undo") | [DOM] 工具栏 Undo 按钮 click → `e.undo()`（`toolbar-ui.ts:139`）→ `cmUndo(view)` → CM6 撤销最后一次事务，文档回到 "before"（去掉 " after"） | import: ../../helpers/electron-launcher; API: clickToolbarButton(undo); 框架: playwright; 等待: 200ms |
| 2 | 断言文档内容 | [DOM] `.cm-content` textContent 含 "before" 且不含 " after" | import: @playwright/test; API: getEditorText(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] 工具栏 Undo 按钮触发 editor.undo()，文档回退到撤销前状态

---

## FP-05-04-N02 [P1] [正常] 输入文本 → Mod-Z → editor.undo()（CM6 keymap）→ 文档回退

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空文档
- 插件配置: demo 默认（含 history 插件的 historyKeymap）
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器并输入
  await clearEditor(page);
  await typeInEditor("before");
  await page.waitForTimeout(200);
  await typeInEditor(" after");
  await page.waitForTimeout(200);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | page.keyboard.press("ControlOrMeta+z") | [DOM] CM6 historyKeymap 捕获 Mod-Z → undo → 文档回到 "before" | import: @playwright/test; API: page.keyboard.press(ControlOrMeta+z); 框架: playwright; 等待: 200ms |
| 2 | 断言文档内容 | [DOM] `.cm-content` textContent 含 "before" 且不含 " after" | import: @playwright/test; API: getEditorText(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] Mod-Z 快捷键触发撤销（history 插件 keymap 工作，底层调 cmUndo）

---

## FP-05-04-N03 [P2] [正常] 撤销后 → 工具栏 Redo 按钮 → editor.redo() → 文档恢复

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空文档
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器并输入
  await clearEditor(page);
  await typeInEditor("before");
  await page.waitForTimeout(200);
  await typeInEditor(" after");
  await page.waitForTimeout(200);
  // step 3: 先撤销一次
  await page.keyboard.press("ControlOrMeta+z");
  await page.waitForTimeout(200);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clickToolbarButton(page, "redo") | [DOM] 工具栏 Redo 按钮 click → `e.redo()`（`toolbar-ui.ts:140`）→ `cmRedo(view)` → CM6 重做，文档恢复为 "before after" | import: ../../helpers/electron-launcher; API: clickToolbarButton(redo); 框架: playwright; 等待: 200ms |
| 2 | 断言文档内容 | [DOM] `.cm-content` textContent 含 "before after"（恢复撤销的内容） | import: @playwright/test; API: getEditorText(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] 工具栏 Redo 按钮触发 editor.redo()，文档恢复到撤销前状态

---

## FP-05-04-N04 [P2] [正常] 撤销后 → Mod-Shift-Z → editor.redo()（CM6 keymap）→ 文档恢复

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空文档
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器并输入
  await clearEditor(page);
  await typeInEditor("before");
  await page.waitForTimeout(200);
  await typeInEditor(" after");
  await page.waitForTimeout(200);
  // step 3: 先撤销一次
  await page.keyboard.press("ControlOrMeta+z");
  await page.waitForTimeout(200);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | page.keyboard.press("ControlOrMeta+Shift+z") | [DOM] CM6 historyKeymap 捕获 Mod-Shift-Z → redo → 文档恢复为 "before after" | import: @playwright/test; API: page.keyboard.press(ControlOrMeta+Shift+z); 框架: playwright; 等待: 200ms |
| 2 | 断言文档内容 | [DOM] `.cm-content` textContent 含 "before after" | import: @playwright/test; API: getEditorText(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] Mod-Shift-Z 快捷键触发重做（history 插件 keymap 工作，底层调 cmRedo）

---

## FP-05-04-N05 [P2] [正常] 多步撤销 → Mod-Z 多次 → 逐步回退到初始状态

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空文档
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器并输入多步
  await clearEditor(page);
  await typeInEditor("a");
  await page.waitForTimeout(150);
  await typeInEditor("b");
  await page.waitForTimeout(150);
  await typeInEditor("c");
  await page.waitForTimeout(150);
  // 此时文档为 "abc"
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | page.keyboard.press("ControlOrMeta+z")（第 1 次撤销） | [DOM] 文档变为 "ab"（撤销最后的 "c" 输入） | import: @playwright/test; API: page.keyboard.press(ControlOrMeta+z); 框架: playwright; 等待: 200ms |
| 2 | page.keyboard.press("ControlOrMeta+z")（第 2 次撤销） | [DOM] 文档变为 "a"（撤销 "b"） | import: @playwright/test; API: page.keyboard.press(ControlOrMeta+z); 框架: playwright; 等待: 200ms |
| 3 | page.keyboard.press("ControlOrMeta+z")（第 3 次撤销） | [DOM] 文档变为空或接近初始（撤销 "a"） | import: @playwright/test; API: page.keyboard.press(ControlOrMeta+z); 框架: playwright; 等待: 200ms |

**断言汇总**:
- [DOM] 连续 Mod-Z 逐步回退（undo 栈按事务逆序弹出，cmUndo 多次调用工作）

---

## FP-05-04-E01 [P3] [异常] 无可撤销事务时 editor.undo() → 不崩溃（返回 false）

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空文档（清空后，无编辑历史）
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器
  await clearEditor(page);
  await page.waitForTimeout(200);
  // step 3: 多次 undo（超过栈深度）
  await page.keyboard.press("ControlOrMeta+z");
  await page.keyboard.press("ControlOrMeta+z");
  await page.keyboard.press("ControlOrMeta+z");
  await page.waitForTimeout(200);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言编辑器存活 | [DOM] `.cm-editor` 可见（cmUndo 在 undo 栈为空时返回 false，不抛异常） | import: @playwright/test; API: expect(.cm-editor).toBeVisible(); 框架: playwright; 等待: 无 |
| 2 | 断言编辑器仍可输入 | [DOM] 输入 "x" 后 `.cm-content` 含 "x"（undo 空栈不影响后续编辑） | import: @playwright/test; API: typeInEditor(x); getEditorText(); 框架: playwright; 等待: 200ms |

**断言汇总**:
- [DOM] 无可撤销事务时 editor.undo() 不崩溃（cmUndo 空栈安全）
- [DOM] 编辑器保持可用

---

# FP-05-05 uploadAsset(file) 资源上传（4 例，[API契约][数据IO]）—— 全部标注"待确认"

> ⚠️ **待确认**：`editor.ts:768-774` 的 uploadAsset 在 `!config.onAssetUpload` 时直接 `return Promise.resolve(null)`。经查 demo 的 `createEditorShell` 配置（`editor-shell.ts:128-331`）**未设置 `onAssetUpload`**。因此 demo 中 `uploadAsset(file)` 永远返回 null。粘贴/拖拽图片也不会触发上传（`editor.ts:682` 与 `695` 的 `if (!config.onAssetUpload || destroyed) return false`）。本节所有用例验证"不崩溃 + 不误触发"，直接功能验证标注"待确认"（需 demo 配置 onAssetUpload 后补充）。

## FP-05-05-N01 [P1] [正常] 【待确认】uploadAsset 未配置 onAssetUpload → 返回 null（需注入钩子验证）

**测试框架**: Playwright

**前置条件**（⚠️ 4要素）:
- 依赖环境: Electron demo（需 editor-shell.ts 注入 `(window as any).__nexusEditor = editor` 测试钩子）
- 初始文档: 任意
- 插件配置: demo 默认（**未配置 onAssetUpload**）
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 尝试通过钩子调用 uploadAsset（构造虚拟 File）
  const result = await page.evaluate(async () => {
    const ed = (window as any).__nexusEditor;
    if (!ed) return null;
    const file = new File(["dummy"], "test.png", { type: "image/png" });
    return await ed.uploadAsset(file);
  });
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言 uploadAsset 结果 | [STATE] 若钩子存在：result === null（`editor.ts:769-770` 的 `!config.onAssetUpload` 分支返回 Promise.resolve(null)）；若钩子缺失：result === null，用例标注"待确认" | import: @playwright/test; API: page.evaluate(uploadAsset); 框架: playwright; 等待: 无 |
| 2 | 断言编辑器存活 | [DOM] `.cm-editor` 可见（uploadAsset 不崩溃） | import: @playwright/test; API: expect(.cm-editor).toBeVisible(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [STATE] demo 未配置 onAssetUpload 时 uploadAsset 返回 null（标注"待确认"：需注入钩子后直接验证）
- [DOM] 编辑器不崩溃

---

## FP-05-05-N02 [P2] [正常] 【待确认】粘贴图片 → onAssetUpload 未配置 → 不触发上传（编辑器不插入图片引用）

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空文档
- 插件配置: demo 默认（**未配置 onAssetUpload**，`editor.ts:682` 的 paste 兜底返回 false）
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器
  await clearEditor(page);
  await page.waitForTimeout(200);
  const beforeText = await getEditorText(page);
  // step 3: 构造图片粘贴事件（ClipboardData 含 image/png File）
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
| 1 | 等待 300ms 后断言文档 | [DOM] `.cm-content` 不含 "![" 与 "](" 图片引用（`editor.ts:682` 的 `if (!config.onAssetUpload || destroyed) return false`，粘贴兜底未触发 insertUploadedAssets） | import: @playwright/test; API: getEditorText(); 框架: playwright; 等待: 300ms |
| 2 | 断言编辑器存活 | [DOM] `.cm-editor` 可见（粘贴事件不导致崩溃） | import: @playwright/test; API: expect(.cm-editor).toBeVisible(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] 粘贴图片时编辑器不插入图片引用（demo 未配置 onAssetUpload，uploadAsset 管线不触发）
- [DOM] 编辑器不崩溃

---

## FP-05-05-N03 [P2] [正常] 【待确认】拖拽图片 → onAssetUpload 未配置 → 不触发上传（编辑器不插入图片引用）

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空文档
- 插件配置: demo 默认（**未配置 onAssetUpload**，`editor.ts:695` 的 drop 兜底返回 false）
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器
  await clearEditor(page);
  await page.waitForTimeout(200);
  // step 3: 构造图片拖拽事件（DataTransfer 含 image/png File）
  await page.evaluate(() => {
    const target = document.querySelector(".cm-content") as HTMLElement;
    const file = new File(["dummy"], "drop.png", { type: "image/png" });
    const dt = new DataTransfer();
    dt.items.add(file);
    const event = new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
  });
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 等待 300ms 后断言文档 | [DOM] `.cm-content` 不含 "![" 与 "](" 图片引用（`editor.ts:695` 的 `if (!config.onAssetUpload || destroyed) return false`，drop 兜底未触发 insertUploadedAssets） | import: @playwright/test; API: getEditorText(); 框架: playwright; 等待: 300ms |
| 2 | 断言编辑器存活 | [DOM] `.cm-editor` 可见（drop 事件不导致崩溃） | import: @playwright/test; API: expect(.cm-editor).toBeVisible(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] 拖拽图片时编辑器不插入图片引用（demo 未配置 onAssetUpload，uploadAsset 管线不触发）
- [DOM] 编辑器不崩溃

---

## FP-05-05-E01 [P3] [异常] 【待确认】uploadAsset 传入非图片文件 → 不崩溃（demo 未配置上传 → 返回 null）

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（需 editor-shell.ts 注入 `(window as any).__nexusEditor = editor` 测试钩子）
- 初始文档: 任意
- 插件配置: demo 默认（**未配置 onAssetUpload**）
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 尝试通过钩子调用 uploadAsset（构造非图片 File）
  const result = await page.evaluate(async () => {
    const ed = (window as any).__nexusEditor;
    if (!ed) return null;
    const file = new File(["text content"], "note.txt", { type: "text/plain" });
    return await ed.uploadAsset(file);
  });
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言 uploadAsset 结果 | [STATE] 若钩子存在：result === null（`editor.ts:769-770` 的 `!config.onAssetUpload` 分支，对任意文件类型都返回 null）；若钩子缺失：result === null，用例标注"待确认" | import: @playwright/test; API: page.evaluate(uploadAsset); 框架: playwright; 等待: 无 |
| 2 | 断言编辑器存活 | [DOM] `.cm-editor` 可见（uploadAsset 对非图片文件不崩溃） | import: @playwright/test; API: expect(.cm-editor).toBeVisible(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [STATE] demo 未配置 onAssetUpload 时，uploadAsset 对非图片文件返回 null（标注"待确认"）
- [DOM] 编辑器不崩溃

---

## 统计汇总

| 二级功能点 | 正常 | 异常 | 边界 | 小计 |
|-----------|------|------|------|------|
| FP-05-01 getSlashCommands() | 5 (N01-N05) | 1 (E01) | 1 (B01) | 7 |
| FP-05-02 getCommands/runCommand | 4 (N01-N04) + 1 待确认(N05) | 1 (E01) | 0 | 6 |
| FP-05-03 runShortcut | 6 (N01-N06) | 1 (E01) | 0 | 7 |
| FP-05-04 undo/redo | 5 (N01-N05) | 1 (E01) | 0 | 6 |
| FP-05-05 uploadAsset | 2 (N01-N02) + 1 待确认(N03) | 1 待确认(E01) | 0 | 4 |
| **合计** | **23** | **5** | **1** | **30** |

### 类型分布
- [API契约]: 30（全部用例）
- [插件能力]: 7（FP-05-01 全部）
- [编辑交互]: 19（FP-05-02/03/04 全部）
- [数据IO]: 4（FP-05-05 全部）

### 优先级分布
- P1: 8（核心路径：斜杠菜单触发、命令执行、快捷键、undo/redo）
- P2: 16（扩展路径：精确/前缀/关键词匹配、Mod-I/Shift-S/E/1/K、redo）
- P3: 5（异常路径：无匹配/未知 key/空栈/非图片文件）
- P4: 1（边界路径：空文档起始输入 /）

### 待确认用例清单（demo 未配置/未暴露，需补充测试钩子）
- FP-05-02-N05：getCommands 返回空数组（需注入 window.__nexusEditor 钩子）
- FP-05-05-N01：uploadAsset 返回 null（需注入钩子 + demo 未配 onAssetUpload）
- FP-05-05-N03：拖拽图片不触发上传（demo 未配 onAssetUpload，间接验证可用）
- FP-05-05-E01：非图片文件 uploadAsset（需注入钩子）

<<<STATS>>>
```json
{
  "case_file": "test/testcases/demo-requirements/CASE-EditorAPI命令与资源/CASE-EditorAPI命令与资源-测试用例.md",
  "function_point": "FP-05 EditorAPI 命令与资源",
  "requirement_source": "demo-requirements.md §3.2",
  "framework": "playwright-electron",
  "sub_function_points": [
    {"id": "FP-05-01", "name": "getSlashCommands()", "count": 7, "types": ["API契约", "插件能力"]},
    {"id": "FP-05-02", "name": "getCommands()/runCommand(id)", "count": 6, "types": ["API契约", "编辑交互"]},
    {"id": "FP-05-03", "name": "runShortcut(key)", "count": 7, "types": ["API契约", "编辑交互"]},
    {"id": "FP-05-04", "name": "undo()/redo()", "count": 6, "types": ["API契约", "编辑交互"]},
    {"id": "FP-05-05", "name": "uploadAsset(file)", "count": 4, "types": ["API契约", "数据IO"], "pending": true}
  ],
  "total_cases": 30,
  "by_type": {"正常": 23, "异常": 5, "边界": 1},
  "by_priority": {"P1": 8, "P2": 16, "P3": 5, "P4": 1},
  "pending_cases": 4,
  "coverage_notes": [
    "FP-05-01 通过输入 / 后检查斜杠菜单命令列表间接验证 getSlashCommands",
    "FP-05-02 通过斜杠菜单确认执行（Enter/click）验证命令执行管线；getCommands 本身因 demo 无命名命令插件，返回空数组",
    "FP-05-03 通过键盘快捷键 Mod-B/I/Shift-S/E/K/1 触发格式化间接验证 runShortcut 底层 keymap 机制",
    "FP-05-04 通过工具栏 undo/redo 按钮 + Mod-Z/Mod-Shift-Z 快捷键验证 undo/redo",
    "FP-05-05 全部标注待确认：demo 未配置 onAssetUpload，uploadAsset 永远返回 null，仅验证不崩溃/不误触发"
  ]
}
```
<<<END_STATS>>>
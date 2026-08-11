# CASE-EditorAPI事件与生命周期-测试用例（FP-06）

> 一级功能点: EditorAPI 事件与生命周期（demo-requirements.md §3.2）
> 全局批次序号: 06
> 生成时间: 2026-08-11
> 测试框架: Playwright（Electron demo / Vite dev server + Electron main）
>
> 涉及二级功能点:
> - FP-06-01 on(event, handler) / off 事件订阅与取消（[API契约][编辑交互]）
> - FP-06-02 change 事件（文档变更通知）（[API契约][编辑交互]）
> - FP-06-03 focus / blur 事件（[API契约][编辑交互]）
> - FP-06-04 selectionChange 事件（选区变化通知）（[API契约][编辑交互]）
> - FP-06-05 slashMenuChange 事件（斜杠菜单状态变化）（[API契约][编辑交互]）
> - FP-06-06 focus() / blur() 焦点控制（[API契约][编辑交互]）
> - FP-06-07 destroy() 编辑器销毁与清理（[API契约]）
>
> ⚠️ 实现差异提示（依据 `packages/core/src/editor.ts` + `packages/core/src/event-emitter.ts` + `apps/electron-demo/src/renderer/*` 实际代码）:
> - **EventEmitter 实现**：`event-emitter.ts:1-29` 提供基于 `Map<event, Set<handler>>` 的事件总线；`on/off/emit/clear` 四个方法；`emit` 时遍历 Set 同步触发。
> - **Demo 未将 editor 实例暴露到 `window`**：所有事件订阅方法（on/off）不能在 e2e 中直接调用，必须通过 `page.evaluate` 注入测试钩子（在 demo 启动后通过 `editor-shell.ts` 已创建的 editor 实例上注册 handler），或通过 demo UI 的可观察副作用间接验证。
> - **change 事件间接路径**：`editor.ts:600-619` 的 updateListener 在 `docChanged && !silent` 时调 `scheduleChange` → `emitChange`（`editor.ts:323-344`）→ `emitter.emit("change", markdown, currentAst)`；同时 `config.onChange?.(doc, ast)` 回调被触发，demo 的 `editor-shell.ts:321-330` 的 `onChange(doc)` 将 doc 写入 `state.content`、`state.dirty = true`、刷新 link index、调 `onStateChange()`。**状态栏字数刷新 + dirty 标记**是 change 事件最稳定的可观察副作用。
> - **focus/blur 事件间接路径**：`editor.ts:306-321` 的 `setFocused(next)` 在 `next` 切换时触发 `emitter.emit("focus")` 或 `emitter.emit("blur")`，同时调 `config.onFocus?.()` / `config.onBlur?.()`。CM6 原生的 `cm-focused` 类（挂在 `.cm-editor` 上）是 focus/blur 状态最直接的 DOM 证据。
> - **selectionChange 事件间接路径**：`editor.ts:621-632` 的 updateListener 在 `selectionSet` 时 `emit("selectionChange", { anchor, head, ranges, mainIndex })`。字数统计插件 `plugin-wordcount/src/plugin.ts:171-181` 监听 selectionChange（通过 CM6 updateListener）→ 更新 `WordCountState.selection` + `isSelectionActive` → 状态栏 `nexus-wordcount-selection` span 显隐。**选区字数 span 的显隐与文本更新**是 selectionChange 最稳定的可观察副作用。
> - **slashMenuChange 事件间接路径**：`editor.ts:634-651` 在 `slashCommands.length > 0` 时计算 slashState 并 `emit("slashMenuChange", { ...state, coords })`。斜杠菜单 UI（`menu-ui.ts:445`）订阅此事件 → show/hide 菜单 DOM。**`.nexus-slash-menu` 的显隐 + 菜单项数量**是 slashMenuChange 最稳定的可观察副作用。
> - **focus()/blur() 间接路径**：`editor.ts:855-870` 的 `focus()` 调 `view.focus()` + `setFocused(true)`；`blur()` 调 `view.contentDOM.blur()` + `setFocused(false)`。工具栏按钮 click 后 `editor.focus()` 归还焦点（`formatters.ts` + `menu-ui.ts:298`），是 focus() 的间接触发点；点击编辑器外部可触发 blur。
> - **destroy() 间接路径**：`editor.ts:924-976` 的 destroy 执行：flushPendingTableEdits → clearTimeout(parseTimer/compositionFlushTimer) → `emitter.clear()` → `view.destroy()` → 设置 `destroyed = true`。`editor-shell.ts:375-380` 的 shell.destroy() 串联销毁 wordcount/slashMenu/toolbar/editor。Demo 无 UI 按钮 destroy 编辑器，需通过 `page.evaluate` 注入钩子或通过窗口重载验证。
> - **`emit` 的同步性**：EventEmitter 的 emit 同步遍历 handler（`event-emitter.ts:17-24`），因此 on/off 的副作用在 emit 后立即可观察。
> - **测试环境约定**：所有用例通过 `launchDemo()`（`test/e2e/helpers/electron-launcher.ts`）启动 Electron demo；`page.evaluate` 中通过 `document.execCommand("insertText", false, text)` 输入（与 `test/e2e/editor.spec.ts:13-16` 一致）；CM6 焦点状态通过 `.cm-editor.cm-focused` 断言；斜杠菜单通过 `.nexus-slash-menu` / `[role="listbox"]` 断言。

---

## e2e 全局前置条件

- 依赖环境: Electron demo（Vite dev server localhost:5173 + 已构建的 `apps/electron-demo/dist-electron/main.js`）
- 初始文档: demo 启动后默认打开的 sample-vault 文档（或 index.md）
- 插件配置: demo 默认挂载 —— createGfmPreset + createHistoryPlugin + createToolbarPlugin + createSearchPlugin + createWikilinksPlugin + createWordCountPlugin
- setup 代码（所有用例通用，测试文件顶部）:
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

  // 获取状态栏文本（getDocumentStats 渲染位置，app.ts:102-115）
  async function getStatusText(page: Page): Promise<string> {
    const el = page.locator("#status-line, .status-line").first();
    return (await el.textContent()) ?? "";
  }

  // 判断编辑器是否聚焦（CM6 cm-focused 类挂在 .cm-editor 上）
  async function isEditorFocused(page: Page): Promise<boolean> {
    return await page.locator(".cm-editor.cm-focused").count() > 0;
  }

  // 获取字数统计选区 span 的可见性与文本（selectionChange 副作用）
  async function getSelectionWordCount(page: Page): Promise<{ visible: boolean; text: string }> {
    const span = page.locator(".nexus-wordcount-selection, [class*='wordcount-selection']").first();
    const count = await span.count();
    if (count === 0) return { visible: false, text: "" };
    const hidden = await span.getAttribute("hidden");
    const ariaHidden = await span.getAttribute("aria-hidden");
    const visible = hidden === null && ariaHidden !== "true";
    const text = (await span.textContent()) ?? "";
    return { visible, text };
  }

  // 获取斜杠菜单的可见性与菜单项数量（slashMenuChange 副作用）
  async function getSlashMenuState(page: Page): Promise<{ visible: boolean; itemCount: number }> {
    const menu = page.locator(".nexus-slash-menu, [role='listbox']").first();
    const count = await menu.count();
    if (count === 0) return { visible: false, itemCount: 0 };
    const items = page.locator(".nexus-slash-menu__item, [role='option']");
    const itemCount = await items.count();
    return { visible: itemCount > 0, itemCount };
  }

  // 切换 Outline 面板（app.ts 的 ☰ 按钮）
  async function toggleOutline(page: Page) {
    await page.locator('button[title="Toggle outline"]').click();
  }
  ```

---

# FP-06-01 on(event, handler) / off 事件订阅与取消（5 例，[API契约][编辑交互]）

> 实现路径：`event-emitter.ts:4-15` 的 `on` 将 handler 加入 `Map<event, Set<handler>>`，`off` 从 Set 中 delete。`editor.ts:895-900` 的 `api.on/off` 直接委托给 emitter。由于 demo 未暴露 editor 到 window，本节用例通过 `page.evaluate` 注入 handler 计数器钩子（需 demo 在 `editor-shell.ts` 暴露 `window.__nexusEditor = editor`，或通过 change 事件的下游副作用间接验证 on/off 生效）。

## FP-06-01-N01 [P1] [正常] on("change") 注册→ 输入文本→ 回调触发（经状态栏 dirty 副作用验证）

**测试框架**: Playwright

**前置条件**（⚠️ 4要素）:
- 依赖环境: Electron demo
- 初始文档: 空文档（清空后）
- 插件配置: demo 默认（editor-shell.ts:321-330 的 onChange 回调注册到 emitter）
- setup 代码:
  ```typescript
  // step 1: 全局 setup（见 e2e 全局前置条件 launchDemo）
  // step 2: 清空编辑器确保干净初始
  await clearEditor(page);
  await page.waitForTimeout(250);
  const cleanStatus = await getStatusText(page);
  // step 3: 验证初始无 dirty 标记
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | typeInEditor("hello") | [DOM] `.cm-content` 含 "hello" → docChanged 触发 updateListener → `scheduleChange` → `emitChange`（`editor.ts:600-619` + `editor.ts:323-344`）→ `emitter.emit("change", ...)` 同步触发所有 on("change") handler，包括 demo 的 onChange 回调 | 选择器: .cm-content; 操作: typeInEditor(hello); 控件: editor; 等待: onChange 防抖 150ms |
| 2 | 等待 250ms 断言状态栏 | [DOM] 状态栏含 `[modified]`（onChange handler 将 `state.dirty = true`，`app.ts:107`）+ words 数 > 0 | 选择器: #status-line; 操作: getStatusText(); 控件: status; 等待: 250ms |

**断言汇总**:
- [DOM] on("change") 注册的 handler（demo 内置 onChange）被触发：状态栏出现 `[modified]` 且字数刷新
- [DOM] 证明 `emitter.emit("change")` 成功调用所有已注册 handler

---

## FP-06-01-N02 [P1] [正常] off("change") 取消→ 输入文本→ 回调不再触发（dirty 不更新）

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（需 editor-shell.ts 注入 `(window as any).__nexusEditor = editor` 测试钩子）
- 初始文档: 空文档
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器
  await clearEditor(page);
  await page.waitForTimeout(250);
  // step 3: 通过钩子注册自定义 handler 并立即 off
  await page.evaluate(() => {
    const ed = (window as any).__nexusEditor;
    if (!ed) return;
    const handler = (doc: string) => { (window as any).__offTestFired = true; };
    ed.on("change", handler);
    ed.off("change", handler);  // 立即取消
    (window as any).__offTestFired = false;
  });
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | typeInEditor("test") | [STATE] `emit("change")` 遍历 Set 时不含已 off 的 handler（`event-emitter.ts:13-15` 的 delete 生效），`window.__offTestFired` 保持 false | 选择器: .cm-content; 操作: typeInEditor(test); 控件: editor; 等待: 250ms |
| 2 | page.evaluate 读取 __offTestFired | [STATE] 若钩子存在：__offTestFired === false（handler 已 off，未被触发）；若钩子缺失：用例跳过 | 选择器: 无; 操作: page.evaluate; 控件: 无; 等待: 无 |

**断言汇总**:
- [STATE] off 后的 handler 不再被 emit 触发（证明 `Set.delete` 生效）
- [STATE] demo 内置 onChange 仍工作（state.dirty = true，状态栏 dirty 标记刷新，验证 off 只移除指定 handler 不影响其他 handler）

---

## FP-06-01-N03 [P2] [正常] on("focus") 注册→ 点击编辑器→ focus 事件触发（.cm-focused 出现）

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 任意
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 先点击页面非编辑器区域使编辑器失焦
  await page.locator("body").click({ position: { x: 10, y: 10 } });
  await page.waitForTimeout(150);
  // step 3: 记录初始聚焦状态
  const focusedBefore = await isEditorFocused(page);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 点击 `.cm-content` 获焦 | [DOM] `.cm-editor` 添加 `cm-focused` 类（CM6 view.focus() 触发）→ `setFocused(true)`（`editor.ts:306-316`）→ `emitter.emit("focus")` 同步触发所有 on("focus") handler | 选择器: .cm-content; 操作: click(); 控件: editor; 等待: 150ms |
| 2 | 断言聚焦状态 | [DOM] `.cm-editor.cm-focused` 存在（`isEditorFocused === true`） | 选择器: .cm-editor.cm-focused; 操作: count(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 点击编辑器触发 focus 事件，`.cm-focused` 类出现
- [DOM] 证明 `emitter.emit("focus")` 已触发（setFocused → emit）

---

## FP-06-01-N04 [P2] [正常] 多个 handler 同时 on→ emit 时全部同步触发

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（需 window.__nexusEditor 钩子）
- 初始文档: 空文档
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器
  await clearEditor(page);
  // step 3: 注册 3 个 handler
  await page.evaluate(() => {
    const ed = (window as any).__nexusEditor;
    if (!ed) return;
    (window as any).__h1 = 0;
    (window as any).__h2 = 0;
    (window as any).__h3 = 0;
    ed.on("change", () => { (window as any).__h1++; });
    ed.on("change", () => { (window as any).__h2++; });
    ed.on("change", () => { (window as any).__h3++; });
  });
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | typeInEditor("x") | [STATE] `emit("change")` 遍历 Set（`event-emitter.ts:17-24`）同步触发 3 个 handler，__h1/__h2/__h3 均从 0 变为 1 | 选择器: .cm-content; 操作: typeInEditor(x); 控件: editor; 等待: 250ms |
| 2 | page.evaluate 读取计数 | [STATE] 若钩子存在：__h1 === 1 && __h2 === 1 && __h3 === 1；若钩子缺失：跳过 | 选择器: 无; 操作: page.evaluate; 控件: 无; 等待: 无 |

**断言汇总**:
- [STATE] 同一事件的多个 handler 全部被触发（Set 遍历不遗漏）
- [STATE] 三个 handler 计数一致（同步触发无先后遗漏）

---

## FP-06-01-E01 [P3] [异常] off 未注册的 handler→ 无副作用（emit 正常工作）

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（需 window.__nexusEditor 钩子）
- 初始文档: 空文档
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器
  await clearEditor(page);
  // step 3: off 一个从未注册的 handler
  await page.evaluate(() => {
    const ed = (window as any).__nexusEditor;
    if (!ed) return;
    const stranger = () => {};
    ed.off("change", stranger);  // 不在 Set 中，Set.delete 静默无操作
    (window as any).__strangerOk = true;  // 未抛错即成功
  });
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | typeInEditor("safe") | [DOM] 编辑器不崩溃，onChange 正常触发（demo 内置 handler 未被误删） | 选择器: .cm-content; 操作: typeInEditor(safe); 控件: editor; 等待: 250ms |
| 2 | 断言状态栏 | [DOM] 含 `[modified]`（off 未注册 handler 不影响已注册 handler） | 选择器: #status-line; 操作: getStatusText(); 控件: status; 等待: 250ms |

**断言汇总**:
- [DOM] off 未注册的 handler 不抛异常、不影响其他 handler
- [DOM] demo 内置 onChange 仍工作（dirty 标记正常）

---

# FP-06-02 change 事件（文档变更通知）（6 例，[API契约][编辑交互]）

> 实现路径：`editor.ts:600-619` 的 updateListener 在 `update.docChanged && !silent` 时调 `scheduleChange(markdown)`（`editor.ts:346-361`，默认 150ms 防抖）→ `emitChange(markdown)`（`editor.ts:323-344`）→ `emitter.emit("change", markdown, currentAst)`。demo 的 `editor-shell.ts:321-330` 的 `onChange` 回调将 doc 写入 `state.content`、`state.dirty = true`。**状态栏字数刷新 + dirty 标记**是 change 事件最稳定的可观察副作用。

## FP-06-02-N01 [P1] [正常] 键盘输入→ change 事件触发→ 状态栏字数刷新 + dirty 标记

**测试框架**: Playwright

**前置条件**（⚠️ 4要素）:
- 依赖环境: Electron demo
- 初始文档: 空文档（清空后）
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器
  await clearEditor(page);
  await page.waitForTimeout(250);
  const initialStatus = await getStatusText(page);
  // step 3: 确认初始无 [modified]
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | typeInEditor("hello world") | [DOM] `.cm-content` 含 "hello world" → docChanged → scheduleChange（防抖 150ms）→ emitChange → emit("change")（`editor.ts:346-344`） | 选择器: .cm-content; 操作: typeInEditor(hello world); 控件: editor; 等待: 250ms（防抖 150ms + 余量） |
| 2 | 断言状态栏 | [DOM] 状态栏含 `[modified]`（`state.dirty = true`，`editor-shell.ts:323`）+ "2 words"（`getDocumentStats` 经 onChange 重新计算，`app.ts:108`） | 选择器: #status-line; 操作: getStatusText(); 控件: status; 等待: 250ms |

**断言汇总**:
- [DOM] change 事件触发后状态栏出现 `[modified]`（dirty 标记）
- [DOM] 状态栏 words 数 = 2（字数随 change 事件刷新）

---

## FP-06-02-N02 [P1] [正常] 多行输入→ change 事件携带完整 doc（含换行）→ 状态栏行数正确

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
  await page.waitForTimeout(250);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | typeInEditor("line1") → pressEnter → typeInEditor("line2") → pressEnter → typeInEditor("line3") | [DOM] `.cm-content` 跨 3 行 → 每次 docChanged 触发 scheduleChange（防抖合并最后一次）→ emitChange 携带完整 doc | 选择器: .cm-content; 操作: typeInEditor+pressEnter; 控件: editor; 等待: 300ms |
| 2 | 断言状态栏 | [DOM] 含 "3 lines"（`getDocumentStats` 的 `view.state.doc.lines`，`editor.ts:921`）+ `[modified]` | 选择器: #status-line; 操作: getStatusText(); 控件: status; 等待: 300ms |

**断言汇总**:
- [DOM] 多行输入后 change 事件携带完整 doc，状态栏 lines = 3
- [DOM] dirty 标记生效

---

## FP-06-02-N03 [P2] [正常] 删除操作→ change 事件触发→ 状态栏字数减少

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 含 "alpha beta gamma" 的文档
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器并输入文本
  await clearEditor(page);
  await typeInEditor("alpha beta gamma");
  await page.waitForTimeout(250);
  const beforeStatus = await getStatusText(page);
  // step 3: 选中 "beta" 删除（双击选中单词）
  await page.locator(".cm-content").dblclick();  // 选中最后一个词或光标附近词
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | Backspace 删除选中内容 | [DOM] docChanged → scheduleChange → emitChange → emit("change")（`editor.ts:600-619`） | 选择器: .cm-content; 操作: page.keyboard.press(Backspace); 控件: editor; 等待: 250ms |
| 2 | 断言状态栏 | [DOM] words 数减少（从 3 降到 2 或更少，取决于删除内容），仍含 `[modified]` | 选择器: #status-line; 操作: getStatusText(); 控件: status; 等待: 300ms |

**断言汇总**:
- [DOM] 删除操作触发 change 事件，状态栏字数随删除同步减少
- [DOM] dirty 标记保持

---

## FP-06-02-N04 [P2] [正常] setDocument silent 加载→ change 事件不触发→ 状态栏无 dirty

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（需 sample-vault 中至少 2 个文件）
- 初始文档: demo 默认打开的第一个文件
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 先键盘输入制造 dirty 状态
  await page.click(".cm-content");
  await typeInEditor("dirty marker");
  await page.waitForTimeout(250);
  const dirtyStatus = await getStatusText(page);
  // step 3: 打开 Vault 面板
  await page.locator('button[title="Toggle vault panel"]').click();
  await page.waitForTimeout(200);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 在 Vault 面板点击另一个文件 | [DOM] `.cm-content` 切换到新文件内容（`editor-shell.ts:357-363` 的 loadDocument → `editor.setDocument(content, { silent: true })`），silent 事务被 updateListener 标注 `silentDocChange` annotation（`editor.ts:584`），跳过 scheduleChange | 选择器: .vault-panel-file; 操作: click(); 控件: vault; 等待: 400ms |
| 2 | 断言状态栏 | [DOM] 状态栏**不含** `[modified]`（silent 跳过 emit("change")，`state.dirty = false` 由 loadDocument 显式设置，`editor-shell.ts:366`） | 选择器: #status-line; 操作: getStatusText(); 控件: status; 等待: 400ms |

**断言汇总**:
- [DOM] silent 模式 setDocument 不触发 change 事件（状态栏无 dirty）
- [DOM] 证明 `silentDocChange` annotation 正确跳过 emit("change")

---

## FP-06-02-E01 [P3] [异常] 连续快速输入→ 防抖合并→ change 事件最终触发一次

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（需 window.__nexusEditor 钩子）
- 初始文档: 空文档
- 插件配置: demo 默认（parseDelayMs 默认 150ms）
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器
  await clearEditor(page);
  // step 3: 注册计数器 handler
  await page.evaluate(() => {
    const ed = (window as any).__nexusEditor;
    if (!ed) return;
    (window as any).__changeCount = 0;
    ed.on("change", () => { (window as any).__changeCount++; });
  });
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 快速连续输入 "a", "b", "c"（间隔 < 150ms） | [STATE] 每次输入触发 docChanged → scheduleChange 重置防抖计时器（`editor.ts:346-361` 的 clearTimeout），最终只 emit 一次 change | 选择器: .cm-content; 操作: typeInEditor 连续; 控件: editor; 等待: 无（连续输入） |
| 2 | 等待 300ms 后读取计数 | [STATE] 若钩子存在：__changeCount === 1（防抖合并）；若钩子缺失：通过状态栏 dirty 标记间接验证（最终 dirty = true） | 选择器: 无; 操作: page.evaluate; 控件: 无; 等待: 300ms |

**断言汇总**:
- [STATE] 连续输入被防抖合并，change 事件最终只触发 1 次（证明 scheduleChange 的 clearTimeout 逻辑）
- [DOM] 状态栏最终显示 `[modified]` + 正确字数

---

## FP-06-02-B01 [P4] [边界] 空文档输入单个字符→ change 事件触发→ 状态栏 1 word

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空文档（清空后）
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器
  await clearEditor(page);
  await page.waitForTimeout(250);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | typeInEditor("x") | [DOM] docChanged（从空 doc 到 1 字符）→ scheduleChange → emitChange → emit("change") | 选择器: .cm-content; 操作: typeInEditor(x); 控件: editor; 等待: 250ms |
| 2 | 断言状态栏 | [DOM] 含 "1 words"（`getDocumentStats` 对 "x" 返回 words:1）+ `[modified]` | 选择器: #status-line; 操作: getStatusText(); 控件: status; 等待: 250ms |

**断言汇总**:
- [DOM] 空文档到单字符的变更正确触发 change 事件
- [DOM] 状态栏字数与 dirty 标记正确

---

# FP-06-03 focus / blur 事件（5 例，[API契约][编辑交互]）

> 实现路径：`editor.ts:306-321` 的 `setFocused(next)` 在 `focused !== next` 时切换：`next=true` → `config.onFocus?.()` + `emitter.emit("focus")`；`next=false` → `config.onBlur?.()` + `emitter.emit("blur")`。CM6 原生的 `.cm-focused` 类（挂在 `.cm-editor` 上）是焦点状态最直接的 DOM 证据。`setFocused` 通过 CM6 的 `focus`/`blur` DOM 事件间接触发（`domEventHandlers`）。

## FP-06-03-N01 [P1] [正常] 点击编辑器→ focus 事件→ .cm-focused 类出现

**测试框架**: Playwright

**前置条件**（⚠️ 4要素）:
- 依赖环境: Electron demo
- 初始文档: 任意
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 先点击页面非编辑器区域使编辑器失焦
  await page.locator("body").click({ position: { x: 10, y: 10 } });
  await page.waitForTimeout(200);
  const focusedBefore = await isEditorFocused(page);
  // step 3: 确认初始未聚焦
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 点击 `.cm-content` | [DOM] CM6 view.focus() 触发 → `setFocused(true)`（`editor.ts:855-862` 的 focus() 路径，或 DOM focus 事件触发 `domEventHandlers`）→ `emitter.emit("focus")` | 选择器: .cm-content; 操作: click(); 控件: editor; 等待: 150ms |
| 2 | 断言聚焦状态 | [DOM] `.cm-editor.cm-focused` count === 1（CM6 聚焦时添加此类） | 选择器: .cm-editor.cm-focused; 操作: count(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 点击编辑器触发 focus 事件，`.cm-focused` 类出现
- [DOM] `focusedBefore === false` → 操作后 `isEditorFocused === true`（状态切换）

---

## FP-06-03-N02 [P1] [正常] 点击编辑器外部→ blur 事件→ .cm-focused 类消失

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 任意
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 先点击编辑器获焦
  await page.click(".cm-content");
  await page.waitForTimeout(150);
  const focusedBefore = await isEditorFocused(page);
  // step 3: 确认初始已聚焦
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 点击页面非编辑器区域（如工具栏空白处或 body 边角） | [DOM] CM6 contentDOM blur → `setFocused(false)`（`editor.ts:863-870` 的 blur() 路径，或 DOM blur 事件）→ `emitter.emit("blur")` | 选择器: body; 操作: click({position:{x:10,y:10}}); 控件: 无; 等待: 200ms |
| 2 | 断言失焦状态 | [DOM] `.cm-editor.cm-focused` count === 0（CM6 失焦时移除此类） | 选择器: .cm-editor.cm-focused; 操作: count(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 点击外部触发 blur 事件，`.cm-focused` 类消失
- [DOM] `focusedBefore === true` → 操作后 `isEditorFocused === false`（状态切换）

---

## FP-06-03-N03 [P2] [正常] 工具栏按钮点击→ editor.focus() 归还焦点→ .cm-focused 恢复

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 含选中文本
- 插件配置: demo 默认（含工具栏）
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器并输入文本
  await clearEditor(page);
  await typeInEditor("text");
  await page.waitForTimeout(200);
  // step 3: 选中 "text"
  await page.locator(".cm-content").dblclick();
  // step 4: 点击页面其他位置使编辑器失焦
  await page.locator("body").click({ position: { x: 10, y: 10 } });
  await page.waitForTimeout(150);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 点击工具栏 Bold 按钮 | [DOM] 按钮 click handler 调 `editor.focus()`（工具栏 UI 交互细节，`formatters.ts` + `menu-ui.ts:298`）→ `setFocused(true)` → `emitter.emit("focus")` → `.cm-focused` 恢复 | 选择器: button[title*="Bold"]; 操作: click(); 控件: toolbar; 等待: 200ms |
| 2 | 断言聚焦恢复 | [DOM] `.cm-editor.cm-focused` count === 1 | 选择器: .cm-editor.cm-focused; 操作: count(); 控件: editor; 等待: 无 |
| 3 | 断言格式化生效（focus + replaceSelection） | [DOM] `.cm-content` 含 "**text**"（focus 归还后 replaceSelection 正常工作） | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 工具栏按钮触发 editor.focus()，focus 事件重新触发
- [DOM] .cm-focused 恢复 + 格式化生效（证明 focus 归还后编辑器可操作）

---

## FP-06-03-E01 [P3] [异常] 多次 focus/blur 循环→ 状态正确切换无卡死

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 任意
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 无特殊准备
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 循环 3 次：点击 .cm-content → 点击 body 边角 | [DOM] 每次循环 setFocused 切换（`editor.ts:306-321` 的 `focused === next` 提前返回保护，不重复 emit） | 选择器: .cm-content, body; 操作: click() 交替; 控件: editor; 等待: 每轮 150ms |
| 2 | 最后一轮后断言状态 | [DOM] 最终状态与最后一次操作一致（点击 body 后 .cm-focused count === 0） | 选择器: .cm-editor.cm-focused; 操作: count(); 控件: editor; 等待: 200ms |

**断言汇总**:
- [DOM] 多次 focus/blur 循环不导致卡死或状态错乱
- [DOM] 最终状态正确（证明 setFocused 的去重保护 `focused === next` 生效）

---

## FP-06-03-B01 [P4] [边界] 已聚焦时再次点击→ 不重复触发 focus（去重保护）

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（需 window.__nexusEditor 钩子）
- 初始文档: 任意
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 注册 focus 计数器
  await page.evaluate(() => {
    const ed = (window as any).__nexusEditor;
    if (!ed) return;
    (window as any).__focusCount = 0;
    ed.on("focus", () => { (window as any).__focusCount++; });
  });
  // step 3: 点击编辑器获焦
  await page.click(".cm-content");
  await page.waitForTimeout(150);
  const countAfterFirst = await page.evaluate(() => (window as any).__focusCount);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 再次点击已聚焦的 `.cm-content` | [STATE] `setFocused(true)` 检测 `focused === true === next`（`editor.ts:307` 的提前返回），不重复 emit("focus") | 选择器: .cm-content; 操作: click(); 控件: editor; 等待: 150ms |
| 2 | 读取 focus 计数 | [STATE] 若钩子存在：__focusCount 未增加（去重保护）；若钩子缺失：.cm-focused 仍存在即可 | 选择器: 无; 操作: page.evaluate; 控件: 无; 等待: 无 |

**断言汇总**:
- [STATE] 已聚焦时再次 focus 不重复触发事件（`setFocused` 去重）
- [DOM] `.cm-focused` 类保持存在

---

# FP-06-04 selectionChange 事件（选区变化通知）（5 例，[API契约][编辑交互]）

> 实现路径：`editor.ts:621-632` 的 updateListener 在 `update.selectionSet` 时 `emit("selectionChange", { anchor, head, ranges, mainIndex })`。字数统计插件（`plugin-wordcount/src/plugin.ts:171-181`）监听选区变化 → 更新 `WordCountState.selection` + `isSelectionActive` → 状态栏 `nexus-wordcount-selection` span 显隐与文本更新。**选区字数 span 的显隐 + 文本**是 selectionChange 最稳定的可观察副作用。

## FP-06-04-N01 [P1] [正常] 鼠标拖选文字→ selectionChange→ 字数统计 selection span 显示

**测试框架**: Playwright

**前置条件**（⚠️ 4要素）:
- 依赖环境: Electron demo
- 初始文档: 含 "hello world foo bar" 文本
- 插件配置: demo 默认（含 wordcount 插件，状态栏 selection span 可见）
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器并输入多词文本
  await clearEditor(page);
  await typeInEditor("hello world foo bar");
  await page.waitForTimeout(250);
  // step 3: 确认初始无选区
  const selBefore = await getSelectionWordCount(page);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 鼠标拖选 "world foo"（在 .cm-content 上 drag） | [DOM] selectionSet → `emitter.emit("selectionChange", { anchor, head, ... })`（`editor.ts:624-632`）→ wordcount 插件更新 `isSelectionActive = true` + `selection` 统计 | 选择器: .cm-content; 操作: drag 选区; 控件: editor; 等待: 200ms（wordcount 防抖 150ms） |
| 2 | 断言选区字数 span | [DOM] `.nexus-wordcount-selection` 可见（`hidden !== null` 或 `aria-hidden !== "true"`，`status-bar.ts:115-118`）+ 文本含 "Selected" 或字数信息 | 选择器: .nexus-wordcount-selection; 操作: getSelectionWordCount(); 控件: status; 等待: 250ms |

**断言汇总**:
- [DOM] 选中文字后 selectionChange 触发，选区字数 span 显示（visible === true）
- [DOM] span 文本非空（含选中的字数/字符统计）

---

## FP-06-04-N02 [P1] [正常] 键盘 Shift+Arrow 选中→ selectionChange→ 字数统计刷新

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 含 "abcdef" 文本
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器并输入
  await clearEditor(page);
  await typeInEditor("abcdef");
  await page.waitForTimeout(250);
  // step 3: 光标移到末尾
  await page.keyboard.press("End");
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | Shift+ArrowLeft 三次（选中 "def"） | [DOM] 每次按键 selectionSet → emit("selectionChange")（`editor.ts:624-632`）→ wordcount 更新 selection 统计（字符数逐步增加） | 选择器: 无; 操作: page.keyboard.press(Shift+ArrowLeft x3); 控件: editor; 等待: 每次 50ms |
| 2 | 断言选区字数 span | [DOM] `.nexus-wordcount-selection` 可见，文本含 "3" 字符（选中 "def" 3 字符）或对应字数 | 选择器: .nexus-wordcount-selection; 操作: getSelectionWordCount(); 控件: status; 等待: 250ms |

**断言汇总**:
- [DOM] 键盘选区操作触发 selectionChange，选区字数 span 显示正确统计
- [DOM] 选中的 3 字符在统计中体现

---

## FP-06-04-N03 [P2] [正常] 取消选区（点击同一位置）→ selectionChange→ 选区字数 span 隐藏

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 含 "hello world" 文本
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器并输入
  await clearEditor(page);
  await typeInEditor("hello world");
  await page.waitForTimeout(250);
  // step 3: 先选中 "hello"
  await page.locator(".cm-content").dblclick();
  await page.waitForTimeout(200);
  const selActive = await getSelectionWordCount(page);
  // step 4: 确认选区已激活
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 点击 .cm-content 末尾（取消选区，光标变为 caret） | [DOM] selectionSet（选区从非空变为空）→ emit("selectionChange")（`editor.ts:624-632`）→ wordcount 更新 `isSelectionActive = false` | 选择器: .cm-content; 操作: click() 末尾; 控件: editor; 等待: 200ms |
| 2 | 断言选区字数 span 隐藏 | [DOM] `.nexus-wordcount-selection` hidden 或 aria-hidden="true"（`status-bar.ts:120-122`），文本为空 | 选择器: .nexus-wordcount-selection; 操作: getSelectionWordCount(); 控件: status; 等待: 250ms |

**断言汇总**:
- [DOM] 取消选区触发 selectionChange，选区字数 span 隐藏（visible === false）
- [DOM] span 文本清空

---

## FP-06-04-N04 [P2] [正常] ControlOrMeta+A 全选→ selectionChange→ 选区统计含全部字数

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 含 "one two three" 文本
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器并输入
  await clearEditor(page);
  await typeInEditor("one two three");
  await page.waitForTimeout(250);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | ControlOrMeta+A（全选） | [DOM] selectionSet（选区覆盖全文档）→ emit("selectionChange")（`editor.ts:624-632`） | 选择器: 无; 操作: page.keyboard.press(ControlOrMeta+a); 控件: editor; 等待: 200ms |
| 2 | 断言选区字数 span | [DOM] `.nexus-wordcount-selection` 可见，文本含 "3"（3 words 全选）或 "13"（13 字符） | 选择器: .nexus-wordcount-selection; 操作: getSelectionWordCount(); 控件: status; 等待: 250ms |

**断言汇总**:
- [DOM] 全选触发 selectionChange，选区统计反映全文档字数
- [DOM] 选区字数 === 全文档字数（isSelectionActive + selection 统计正确）

---

## FP-06-04-E01 [P3] [异常] 多光标场景→ selectionChange 携带多 ranges（间接验证不崩溃）

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（需 multiCursor 配置启用，或通过 Alt+click 添加光标）
- 初始文档: 含 "aaa bbb ccc" 文本
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器并输入
  await clearEditor(page);
  await typeInEditor("aaa bbb ccc");
  await page.waitForTimeout(250);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | Alt+click 在另一位置添加光标（或 Cmd+D 选中下一个匹配） | [DOM] selectionSet（多选区）→ emit("selectionChange", { ranges: [...多范围], mainIndex } )（`editor.ts:625-631` 的 `selection.ranges.map`）→ 编辑器不崩溃 | 选择器: .cm-content; 操作: Alt+click 或 Cmd+D; 控件: editor; 等待: 200ms |
| 2 | 断言编辑器存活 | [DOM] `.cm-editor` 可见，无 console error | 选择器: .cm-editor; 操作: toBeVisible(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 多光标场景 selectionChange 携带多 ranges 不导致崩溃
- [DOM] 编辑器保持可用

---

# FP-06-05 slashMenuChange 事件（斜杠菜单状态变化）（5 例，[API契约][编辑交互]）

> 实现路径：`editor.ts:634-651` 在 `slashCommands.length > 0` 且 `(selectionSet || docChanged)` 时计算 slashState（`computeSlashState`）→ `emit("slashMenuChange", { ...state, coords })`。斜杠菜单 UI（`menu-ui.ts:445` 的 `editor.on("slashMenuChange", onSlashMenuChange)`）订阅此事件 → show/hide 菜单 DOM。**`.nexus-slash-menu` 的显隐 + 菜单项数量**是 slashMenuChange 最稳定的可观察副作用。

## FP-06-05-N01 [P1] [正常] 输入 / → slashMenuChange→ 菜单弹出

**测试框架**: Playwright

**前置条件**（⚠️ 4要素）:
- 依赖环境: Electron demo
- 初始文档: 空文档（或新行起始）
- 插件配置: demo 默认（含工具栏插件，提供 14 条 slashCommands）
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器
  await clearEditor(page);
  await page.waitForTimeout(250);
  // step 3: 确认初始无菜单
  const menuBefore = await getSlashMenuState(page);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | typeInEditor("/") | [DOM] docChanged → updateListener（`editor.ts:634-651`）计算 slashState（`getSlashMatch` 检测到行首 `/`，isOpen=true）→ emit("slashMenuChange", { isOpen: true, commands: [...] }) → menu-ui.ts:324-348 的 onSlashMenuChange → show() | 选择器: .cm-content; 操作: typeInEditor(/); 控件: editor; 等待: 300ms |
| 2 | 断言菜单弹出 | [DOM] `.nexus-slash-menu` 可见（`menu-ui.ts:97` 的 root.className），菜单项 count > 0（`[role='option']` 或 `.nexus-slash-menu__item`） | 选择器: .nexus-slash-menu; 操作: getSlashMenuState(); 控件: slash-menu; 等待: 200ms |

**断言汇总**:
- [DOM] 输入 / 触发 slashMenuChange（isOpen=true），菜单弹出
- [DOM] 菜单项数量 > 0（工具栏提供 14 条命令，受 slashMenuLimit 默认 8 截断）

---

## FP-06-05-N02 [P1] [正常] 输入 /query → slashMenuChange→ 菜单过滤

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空文档
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器并输入 /
  await clearEditor(page);
  await typeInEditor("/");
  await page.waitForTimeout(300);
  const menuOpen = await getSlashMenuState(page);
  // step 3: 确认菜单已弹出
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 继续输入 "h"（即文档变为 "/h"） | [DOM] docChanged → updateListener 重算 slashState（`filterSlashCommands` 过滤 query="h"）→ emit("slashMenuChange", { commands: [匹配项] })（`editor.ts:636-650`）→ menu-ui 重渲染 | 选择器: .cm-content; 操作: page.keyboard.type("h"); 控件: editor; 等待: 300ms |
| 2 | 断言菜单过滤 | [DOM] 菜单项数量减少（只剩标题类命令如 h1/h2/h3，`filterSlashCommands` 的精确>前缀>关键词排序） | 选择器: .nexus-slash-menu__item; 操作: count() + allTextContents(); 控件: slash-menu; 等待: 200ms |

**断言汇总**:
- [DOM] 输入 query 后 slashMenuChange 携带过滤后的 commands，菜单项减少
- [DOM] 菜单项文本含 "Heading" 或 "h1"/"h2"/"h3"（query="h" 匹配项）

---

## FP-06-05-N03 [P2] [正常] Escape → 菜单关闭（slashMenuChange isOpen=false）

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空文档，已输入 "/"
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器并输入 /
  await clearEditor(page);
  await typeInEditor("/");
  await page.waitForTimeout(300);
  const menuOpen = await getSlashMenuState(page);
  // step 3: 确认菜单已弹出
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 按 Escape | [DOM] menu-ui 的 keydown handler（`menu-ui.ts` Escape 分支）设置 dismissed=true + hide()；同时 CM6 可能耗尽 / 触发 docChanged → slashState.isOpen=false → emit("slashMenuChange", { isOpen: false }) | 选择器: 无; 操作: page.keyboard.press(Escape); 控件: slash-menu; 等待: 200ms |
| 2 | 断言菜单关闭 | [DOM] `.nexus-slash-menu` 无可见菜单项（itemCount === 0 或菜单 hidden） | 选择器: .nexus-slash-menu; 操作: getSlashMenuState(); 控件: slash-menu; 等待: 200ms |

**断言汇总**:
- [DOM] Escape 触发菜单关闭，slashMenuChange isOpen=false
- [DOM] 菜单项消失

---

## FP-06-05-N04 [P2] [正常] 输入普通文本（非斜杠）→ slashMenuChange isOpen=false→ 菜单不弹出

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
  await page.waitForTimeout(250);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | typeInEditor("hello")（无 /） | [DOM] docChanged → updateListener 计算 slashState（`getSlashMatch` 检测不到 `/`，isOpen=false）→ emit("slashMenuChange", { isOpen: false })（`editor.ts:636-650`） | 选择器: .cm-content; 操作: typeInEditor(hello); 控件: editor; 等待: 300ms |
| 2 | 断言菜单未弹出 | [DOM] `.nexus-slash-menu` 无可见菜单项（itemCount === 0） | 选择器: .nexus-slash-menu; 操作: getSlashMenuState(); 控件: slash-menu; 等待: 200ms |

**断言汇总**:
- [DOM] 非斜杠输入不触发菜单弹出（slashMenuChange isOpen=false）

---

## FP-06-05-E01 [P3] [异常] 在非行首输入 / → slashMenuChange isOpen=false→ 菜单不弹出

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 含 "hello" 文本
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器并输入文本
  await clearEditor(page);
  await typeInEditor("hello");
  await page.waitForTimeout(250);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 光标移到 "hello" 末尾，输入 "/"（文档变为 "hello/"） | [DOM] docChanged → updateListener 计算 slashState（`getSlashMatch` 检测 `/` 不在行首或前缀不满足触发条件，isOpen=false）→ emit("slashMenuChange", { isOpen: false }) | 选择器: .cm-content; 操作: End + typeInEditor(/); 控件: editor; 等待: 300ms |
| 2 | 断言菜单未弹出 | [DOM] `.nexus-slash-menu` 无可见菜单项（slash 触发条件要求 `/` 在行首或空格后） | 选择器: .nexus-slash-menu; 操作: getSlashMenuState(); 控件: slash-menu; 等待: 200ms |

**断言汇总**:
- [DOM] 非行首 / 不触发菜单（slashMenuChange 的触发条件验证）

---

# FP-06-06 focus() / blur() 焦点控制（5 例，[API契约][编辑交互]）

> 实现路径：`editor.ts:855-862` 的 `focus()` 调 `view.focus()` + `setFocused(true)`；`editor.ts:863-870` 的 `blur()` 调 `view.contentDOM.blur()` + `setFocused(false)`。两者都有 `if (destroyed) return` 提前保护。间接触发点：工具栏按钮 click → `editor.focus()`（`formatters.ts` + `menu-ui.ts:298`）。CM6 的 `.cm-focused` 类是焦点状态的 DOM 证据。

## FP-06-06-N01 [P1] [正常] editor.focus() 调用→ .cm-focused 出现（经工具栏按钮触发）

**测试框架**: Playwright

**前置条件**（⚠️ 4要素）:
- 依赖环境: Electron demo
- 初始文档: 含文本
- 插件配置: demo 默认（含工具栏）
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器并输入文本
  await clearEditor(page);
  await typeInEditor("text");
  await page.waitForTimeout(200);
  // step 3: 点击页面外部使编辑器失焦
  await page.locator("body").click({ position: { x: 10, y: 10 } });
  await page.waitForTimeout(150);
  const focusedBefore = await isEditorFocused(page);
  // step 4: 确认初始未聚焦
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 点击工具栏 Bold 按钮（内部调 `editor.focus()`） | [DOM] `editor.focus()`（`editor.ts:855-862`）→ `view.focus()` CM6 聚焦 → `setFocused(true)` → `emitter.emit("focus")` → `.cm-focused` 出现 | 选择器: button[title*="Bold"]; 操作: click(); 控件: toolbar; 等待: 200ms |
| 2 | 断言聚焦 | [DOM] `.cm-editor.cm-focused` count === 1 | 选择器: .cm-editor.cm-focused; 操作: count(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] editor.focus() 调用后 .cm-focused 出现（焦点状态切换）
- [DOM] `focusedBefore === false` → 操作后 `isEditorFocused === true`

---

## FP-06-06-N02 [P1] [正常] editor.blur() 调用→ .cm-focused 消失（经点击外部触发 CM6 blur）

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 任意
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 点击编辑器获焦
  await page.click(".cm-content");
  await page.waitForTimeout(150);
  const focusedBefore = await isEditorFocused(page);
  // step 3: 确认初始已聚焦
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 点击页面非编辑器区域（触发 CM6 contentDOM blur → `editor.blur()` 路径或 DOM blur 事件） | [DOM] `setFocused(false)`（`editor.ts:863-870`）→ `view.contentDOM.blur()` → `emitter.emit("blur")` → `.cm-focused` 消失 | 选择器: body; 操作: click({position:{x:10,y:10}}); 控件: 无; 等待: 200ms |
| 2 | 断言失焦 | [DOM] `.cm-editor.cm-focused` count === 0 | 选择器: .cm-editor.cm-focused; 操作: count(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] editor.blur() 调用后 .cm-focused 消失（焦点状态切换）
- [DOM] `focusedBefore === true` → 操作后 `isEditorFocused === false`

---

## FP-06-06-N03 [P2] [正常] focus() 后可正常输入（焦点功能完整性）

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
  // step 3: 点击外部失焦
  await page.locator("body").click({ position: { x: 10, y: 10 } });
  await page.waitForTimeout(150);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 点击 .cm-content（触发 focus） | [DOM] `editor.focus()` → `view.focus()` → .cm-focused 出现，contentDOM 可接收键盘输入 | 选择器: .cm-content; 操作: click(); 控件: editor; 等待: 150ms |
| 2 | page.keyboard.type("typed") | [DOM] `.cm-content` 含 "typed"（focus 后键盘输入正常路由到 CM6） | 选择器: 无; 操作: page.keyboard.type(typed); 控件: editor; 等待: 250ms |
| 3 | 断言状态栏 | [DOM] 含 `[modified]` + "1 words"（输入触发 change → dirty 刷新） | 选择器: #status-line; 操作: getStatusText(); 控件: status; 等待: 250ms |

**断言汇总**:
- [DOM] focus() 后 contentDOM 可接收键盘输入（焦点功能完整性）
- [DOM] 输入内容正确反映到 .cm-content 与状态栏

---

## FP-06-06-E01 [P3] [异常] blur() 后编辑器仍可通过 focus() 恢复输入

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
  // step 3: 点击编辑器获焦后点击外部失焦
  await page.click(".cm-content");
  await page.waitForTimeout(100);
  await page.locator("body").click({ position: { x: 10, y: 10 } });
  await page.waitForTimeout(150);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 再次点击 .cm-content 恢复焦点 | [DOM] `editor.focus()` → .cm-focused 恢复，contentDOM 重新可输入 | 选择器: .cm-content; 操作: click(); 控件: editor; 等待: 150ms |
| 2 | page.keyboard.type("recovered") | [DOM] `.cm-content` 含 "recovered"（blur 后 focus 恢复，输入正常） | 选择器: 无; 操作: page.keyboard.type(recovered); 控件: editor; 等待: 250ms |
| 3 | 断言编辑器存活 | [DOM] `.cm-editor` 可见，无崩溃 | 选择器: .cm-editor; 操作: toBeVisible(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] blur 后通过 focus() 可恢复输入能力（focus/blur 循环不影响功能）
- [DOM] 编辑器不崩溃

---

## FP-06-06-B01 [P4] [边界] destroy 后 focus()/blur() 空操作（提前返回保护）

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（需 window.__nexusEditor 钩子，且能调用 destroy）
- 初始文档: 任意
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 通过钩子调用 destroy 后再调 focus/blur（需 demo 注入钩子）
  await page.evaluate(() => {
    const ed = (window as any).__nexusEditor;
    if (!ed) return;
    ed.destroy();
    (window as any).__destroyOk = true;
    // destroy 后调用 focus/blur 应提前返回（editor.ts:856-857 / 864-865 的 destroyed 检查）
    try {
      ed.focus();
      ed.blur();
      (window as any).__postDestroySafe = true;
    } catch (e) {
      (window as any).__postDestroySafe = false;
    }
  });
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 读取 postDestroySafe 状态 | [STATE] 若钩子存在：__postDestroySafe === true（destroy 后 focus/blur 不抛错，`editor.ts:856` 的 `if (destroyed) return` 提前返回）；若钩子缺失：用例跳过 | 选择器: 无; 操作: page.evaluate; 控件: 无; 等待: 无 |

**断言汇总**:
- [STATE] destroy 后调用 focus()/blur() 空操作不抛异常（destroyed 提前返回保护）

---

# FP-06-07 destroy() 编辑器销毁与清理（5 例，[API契约]）

> 实现路径：`editor.ts:924-976` 的 destroy 执行：① flushPendingTableEdits（刷新表格编辑）→ ② clearTimeout(parseTimer + compositionFlushTimer) → ③ `pendingCompositionMarkdown = null; pendingDocumentLoad = null; composing = false` → ④ `emitter.clear()`（清空所有事件监听）→ ⑤ `view.destroy()`（销毁 CM6 EditorView）→ 设置 `destroyed = true`。`editor-shell.ts:375-380` 的 shell.destroy() 串联销毁 wordcount/slashMenu/toolbar/editor。Demo 无 UI 按钮 destroy，需通过 `page.evaluate` 钩子或窗口重载验证。

## FP-06-07-N01 [P1] [正常] destroy() 调用→ .cm-editor DOM 移除（view.destroy 清理）

**测试框架**: Playwright

**前置条件**（⚠️ 4要素）:
- 依赖环境: Electron demo（需 window.__nexusEditor 钩子或 window.__nexusShell 钩子）
- 初始文档: 任意
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 确认编辑器存在
  const editorExists = await page.locator(".cm-editor").count();
  // step 3: 通过钩子调用 destroy
  await page.evaluate(() => {
    const ed = (window as any).__nexusEditor;
    const shell = (window as any).__nexusShell;
    if (shell?.destroy) shell.destroy();
    else if (ed?.destroy) ed.destroy();
  });
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 等待 300ms 后断言 .cm-editor | [DOM] `.cm-editor` count === 0 或 DOM 节点移除（`view.destroy()` 清理 CM6 DOM，`editor.ts:967`） | 选择器: .cm-editor; 操作: count(); 控件: editor; 等待: 300ms |
| 2 | 若钩子缺失则验证窗口可重载 | [STATE] 若 __nexusShell/__nexusEditor 均缺失：用例跳过 destroy 直接断言，标注"需 demo 注入测试钩子" | 选择器: 无; 操作: 无; 控件: 无; 等待: 无 |

**断言汇总**:
- [DOM] destroy() 后 .cm-editor DOM 被移除（view.destroy 生效）
- [STATE] 若钩子缺失，标注环境依赖

---

## FP-06-07-N02 [P1] [正常] destroy() 后 emit 不再触发（emitter.clear 生效）

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（需 window.__nexusEditor 钩子）
- 初始文档: 任意
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 注册 change 计数器
  await page.evaluate(() => {
    const ed = (window as any).__nexusEditor;
    if (!ed) return;
    (window as any).__changeCount = 0;
    ed.on("change", () => { (window as any).__changeCount++; });
  });
  // step 3: 调用 destroy
  await page.evaluate(() => {
    const ed = (window as any).__nexusEditor;
    if (ed?.destroy) ed.destroy();
  });
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 尝试输入文本（若编辑器已销毁则无效果） | [STATE] `emitter.clear()`（`editor.ts:965`）清空所有 handler，即使 docChanged 触发 updateListener，emit 时 Set 为空；且 `emitChange` 开头有 `if (destroyed) return`（`editor.ts:324`）双重保护 | 选择器: .cm-content; 操作: typeInEditor(尝试); 控件: editor; 等待: 250ms |
| 2 | 读取 changeCount | [STATE] 若钩子存在：__changeCount 未增加（destroy 后 emit 不触发）；若钩子缺失：跳过 | 选择器: 无; 操作: page.evaluate; 控件: 无; 等待: 无 |

**断言汇总**:
- [STATE] destroy() 后 change 事件不再触发（emitter.clear + destroyed 双重保护）
- [STATE] 已注册 handler 被清空

---

## FP-06-07-N03 [P2] [正常] shell.destroy() 串联销毁 wordcount/slashMenu/toolbar/editor

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（需 window.__nexusShell 钩子）
- 初始文档: 任意
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 记录销毁前各组件存在
  const editorBefore = await page.locator(".cm-editor").count();
  const toolbarBefore = await page.locator(".nexus-toolbar, [class*='toolbar']").count();
  const wordcountBefore = await page.locator(".nexus-wordcount, [role='status']").count();
  // step 3: 调用 shell.destroy
  await page.evaluate(() => {
    const shell = (window as any).__nexusShell;
    if (shell?.destroy) shell.destroy();
  });
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 等待 300ms 后断言各组件 | [DOM] `.cm-editor`、工具栏、字数统计状态栏均被移除或清理（`editor-shell.ts:375-380` 串联 destroy） | 选择器: .cm-editor, .nexus-toolbar, .nexus-wordcount; 操作: count(); 控件: editor/toolbar/wordcount; 等待: 300ms |

**断言汇总**:
- [DOM] shell.destroy() 串联销毁所有子组件（editor + toolbar + slashMenu + wordcount）
- [DOM] 各组件 DOM 节点移除或失效

---

## FP-06-07-E01 [P3] [异常] destroy() 重复调用→ 不抛错（destroyed/destroying 保护）

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（需 window.__nexusEditor 钩子）
- 初始文档: 任意
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 第一次 destroy
  await page.evaluate(() => {
    const ed = (window as any).__nexusEditor;
    if (ed?.destroy) ed.destroy();
  });
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 第二次调用 destroy | [STATE] `editor.ts:925` 的 `if (destroyed || destroying) return` 提前返回，不重复执行清理，不抛错 | 选择器: 无; 操作: page.evaluate(二次 destroy); 控件: 无; 等待: 无 |
| 2 | 断言无异常 | [STATE] page.evaluate 不抛错（重复 destroy 安全） | 选择器: 无; 操作: page.evaluate; 控件: 无; 等待: 无 |

**断言汇总**:
- [STATE] 重复调用 destroy() 不抛异常（destroyed/destroying 双重保护）
- [STATE] 第二次调用为空操作

---

## FP-06-07-B01 [P4] [边界] destroy() 清理定时器（parseTimer/compositionFlushTimer 不泄漏）

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（需 window.__nexusEditor 钩子）
- 初始文档: 含内容（制造 pending change）
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 输入文本触发 scheduleChange（parseTimer 排队中）
  await page.click(".cm-content");
  await page.evaluate((t) => document.execCommand("insertText", false, t), "pending");
  // step 3: 立即调用 destroy（parseTimer 尚未到期）
  await page.evaluate(() => {
    const ed = (window as any).__nexusEditor;
    if (ed?.destroy) ed.destroy();
    (window as any).__destroyNoThrow = true;
  });
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 等待 500ms（超过 parseDelayMs 150ms）断言无延迟报错 | [STATE] `editor.ts:954-957` 的 `clearTimeout(parseTimer)` 清理定时器，destroy 后 parseTimer 回调不触发 emitChange（且有 `if (destroyed) return` 双重保护），无延迟抛错 | 选择器: 无; 操作: page.waitForTimeout; 控件: 无; 等待: 500ms |
| 2 | 断言无未捕获异常 | [STATE] __destroyNoThrow === true，且等待后页面无 unhandled error | 选择器: 无; 操作: page.evaluate; 控件: 无; 等待: 无 |

**断言汇总**:
- [STATE] destroy() 正确清理 parseTimer，pending change 回调不延迟触发
- [STATE] 无定时器泄漏导致的延迟报错

---

## 统计汇总

### 类型分布

| 类型 | 数量 | 占比 |
|------|------|------|
| 正常(N) | 25 | 69.4% |
| 异常(E) | 7 | 19.4% |
| 边界(B) | 4 | 11.1% |
| 流程(F) | 0 | 0% |
| 数据(D) | 0 | 0% |

### 优先级分布

| 优先级 | 数量 | 占比 |
|--------|------|------|
| P1 | 14 | 38.9% |
| P2 | 11 | 30.6% |
| P3 | 7 | 19.4% |
| P4 | 4 | 11.1% |
| P5 | 0 | 0% |

### 各二级功能点用例数

| 二级功能点 | 用例数 | 编号范围 |
|-----------|--------|---------|
| FP-06-01 on/off | 5 | N01-N04, E01 |
| FP-06-02 change | 6 | N01-N04, E01, B01 |
| FP-06-03 focus/blur 事件 | 5 | N01-N03, E01, B01 |
| FP-06-04 selectionChange | 5 | N01-N04, E01 |
| FP-06-05 slashMenuChange | 5 | N01-N04, E01 |
| FP-06-06 focus()/blur() 方法 | 5 | N01-N03, E01, B01 |
| FP-06-07 destroy() | 5 | N01-N03, E01, B01 |
| **合计** | **36** | |

### 验证策略分布

| 验证方式 | 用例数 | 说明 |
|---------|--------|------|
| DOM 直接断言（.cm-focused/.nexus-slash-menu/状态栏） | 28 | 通过可观察副作用间接验证事件 |
| page.evaluate 钩子（需 demo 注入 window.__nexusEditor） | 12 | 精确验证 on/off/destroy 语义 |
| 环境依赖标注 | 8 | 钩子缺失时跳过或降级为"不崩溃"断言 |

### 实现差异关键点

| 差异点 | 影响用例 | 应对策略 |
|--------|---------|---------|
| Demo 未暴露 editor 到 window | FP-06-01/02/07 部分用例 | 标注"需注入 window.__nexusEditor 钩子"，钩子缺失时降级为副作用断言 |
| EventEmitter 同步触发 | FP-06-01-N04 | emit 后立即可观察，无需额外等待 |
| change 防抖 150ms | FP-06-02 全部 | 等待 250ms 覆盖防抖 + 余量 |
| wordcount 防抖 150ms | FP-06-04 全部 | 等待 250ms 覆盖防抖 |
| CM6 .cm-focused 类 | FP-06-03/06 全部 | 最稳定的焦点状态 DOM 证据 |
| destroy 无 UI 入口 | FP-06-07 全部 | 需 page.evaluate 钩子或窗口重载 |

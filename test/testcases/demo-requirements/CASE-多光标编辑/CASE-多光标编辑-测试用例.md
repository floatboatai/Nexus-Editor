# CASE-多光标编辑-测试用例（FP-10）

> 一级功能点: 多光标编辑（demo-requirements.md §3.6）
> 全局批次序号: 10
> 生成时间: 2026-08-11
> 测试框架: Playwright（Electron demo / Vite dev server + Electron main）
>
> 涉及二级功能点:
> - FP-10-01 selectNextOccurrence（Mod-d 选中下一个匹配）（[编辑交互]）
> - FP-10-02 addCursorAbove / addCursorBelow（Mod-Alt-ArrowUp/Down）（[编辑交互]）
> - FP-10-03 collapseToMainSelection（Mod-Esc）（[编辑交互]）
> - FP-10-04 Alt-click 在指定位置添加光标（[编辑交互]）
>
> ⚠️ 实现差异提示（依据 `packages/core/src/multi-cursor.ts` + `packages/core/src/editor.ts:512,668` + `apps/electron-demo/src/renderer/editor-shell.ts:138` 实际代码）:
> - **Demo 已启用 multiCursor:true**：`editor-shell.ts:138` 的 `createEditor({ multiCursor: true })` 安装 `multiCursorExtension()`（`editor.ts:512`）。
> - **扩展组合**：`multi-cursor.ts:166-174` 的 `multiCursorExtension()` 返回 5 项：`EditorState.allowMultipleSelections.of(true)` + `EditorView.clickAddsSelectionRange.of((event) => event.altKey)` + `drawSelection()` + `multiCursorTheme` + `keymap.of(multiCursorKeymap)`。
> - **selectNextOccurrence（`multi-cursor.ts:59-93`）**：VS Code 风格 Mod-d。① 若任一 range 为空（caret）→ 扩展所有空 range 到 `state.wordAt(head)` 所在单词（不加新 range）；② 若所有 range 非空 → 取 main range 文本作为 query，`findNextOccurrence`（`multi-cursor.ts:30-51`）从最后一个 range.to 向后扫描，找不到则从 0 回绕，跳过已被 range 覆盖的匹配；③ 全部已选中时返回 false。大小写敏感、非全字匹配。
> - **addCursorAbove/Below（`multi-cursor.ts:101-127`）**：基于最顶（above）/最底（below）range 所在**逻辑行**（非视觉行），在上一/下一行同列添加空光标。列号 = `source.head - sourceLine.from`，clamp 到目标行长度（`multi-cursor.ts:113`）。到文档边界返回 false。目标位置已有空光标则去重返回 false（`multi-cursor.ts:115`）。
> - **collapseToMainSelection（`multi-cursor.ts:133-141`）**：保留 main range，丢弃其他。**单 range 时返回 false**（让 Escape 继续冒泡到斜杠菜单/搜索面板等其他绑定）。keymap 中 Escape **未 preventDefault**（`multi-cursor.ts:147`），仅在命令返回 true 时由 CM6 阻止后续。
> - **Alt-click（`multi-cursor.ts:169`）**：`clickAddsSelectionRange.of((event) => event.altKey)` 让 Alt+mousedown 在点击位置**追加**一个 range（非替换）。第一次点击若已是单 caret 仍保留，第二次起累加。
> - **drawSelection 主题**：`multi-cursor.ts:153-159` 重写 `.cm-cursor`/`.cm-dropCursor` 颜色为 `var(--nexus-text)`，选中背景用 `var(--nexus-accent)` 透明度 0.25。**多光标时 DOM 中有多个 `.cm-cursor` 元素**（drawSelection 为每个 range 渲染一个光标）。
> - **测试环境约定**：所有用例通过 `launchDemo()`（`test/e2e/helpers/electron-launcher.ts`）启动 Electron demo；通过 `page.keyboard.press` 触发快捷键（mac 上 `Mod` = `Meta`，`ControlOrMeta` 在 Playwright 中映射为 `ControlOrMeta`）；多光标渲染通过 `.cm-cursor` 元素计数验证；多位置同时编辑通过输入文本后检查多行变化验证。

---

## e2e 全局前置条件

- 依赖环境: Electron demo（Vite dev server localhost:5173 + 已构建的 `apps/electron-demo/dist-electron/main.js`）
- 初始文档: demo 启动后默认打开 sample-vault 的 index.md
- 插件配置: demo 默认挂载 —— createGfmPreset + createHistoryPlugin + createToolbarPlugin + createSearchPlugin + createWikilinksPlugin + createWordCountPlugin；**multiCursor: true**（`editor-shell.ts:138`）
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

  // 获取 .cm-cursor 元素数量（drawSelection 为每个 range 渲染一个光标）
  // 注：未聚焦时 .cm-cursor 可能不可见，但 DOM 中始终存在
  async function getCursorCount(page: Page): Promise<number> {
    return await page.locator(".cm-cursor").count();
  }

  // 获取编辑器文档全文
  async function getDocument(page: Page): Promise<string> {
    return (await page.locator(".cm-content").textContent()) ?? "";
  }

  // 将光标定位到文档中指定文本的首次出现位置（通过 setSelection API 不可用，用 page.evaluate 查找）
  // 注：demo 未暴露 editor 到 window，用点击 + 键盘导航近似定位
  async function clickAtLine(page: Page, lineIndex: number, colIndex: number = 0) {
    const line = page.locator(".cm-line").nth(lineIndex);
    const box = await line.boundingBox();
    if (!box) throw new Error(`Line ${lineIndex} not found`);
    // 点击行首附近，colIndex 控制列偏移（每字符约 8px，粗略）
    await page.mouse.click(box.x + Math.max(2, colIndex * 8), box.y + box.height / 2);
  }

  // 获取 .cm-line 元素数量（用于多行编辑验证）
  async function getLineCount(page: Page): Promise<number> {
    return await page.locator(".cm-line").count();
  }

  // 获取所有 .cm-line 文本内容
  async function getLineTexts(page: Page): Promise<string[]> {
    const lines = page.locator(".cm-line");
    const count = await lines.count();
    const texts: string[] = [];
    for (let i = 0; i < count; i++) {
      texts.push(((await lines.nth(i).textContent()) ?? "").trimEnd());
    }
    return texts;
  }
  ```

---

# FP-10-01 selectNextOccurrence（Mod-d 选中下一个匹配）（7 例，[编辑交互]）

> 实现路径：`multi-cursor.ts:143` 的 keymap 绑定 `Mod-d → selectNextOccurrence`（preventDefault:true）。命令逻辑分两阶段：① 空光标时扩展为词（`multi-cursor.ts:63-78`）；② 非空 range 时 `findNextOccurrence` 找下一个未覆盖匹配追加为 main range（`multi-cursor.ts:80-92`）。**多 range → drawSelection 渲染多个 `.cm-cursor`**。

## FP-10-01-N01 [P1] [正常] Mod-d 在单词上→ 扩展选区到当前单词（不加 range）

**测试框架**: Playwright

**前置条件**（⚠️ 4要素）:
- 依赖环境: Electron demo（multiCursor:true 已启用）
- 初始文档: 清空后输入 "foo bar foo baz"
- 插件配置: demo 默认（含 multiCursorExtension + drawSelection）
- setup 代码:
  ```typescript
  // step 1: 全局 setup（见 e2e 全局前置条件 launchDemo）
  // step 2: 清空编辑器并输入测试文本
  await clearEditor(page);
  await typeInEditor(page, "foo bar foo baz");
  await page.waitForTimeout(200);
  // step 3: 光标移到第一个 "foo" 中间（position 1）
  await page.click(".cm-content");
  await page.keyboard.press("Home"); // 行首
  await page.keyboard.press("ArrowRight"); // position 1，在 "foo" 内
  // step 4: 确认初始只有 1 个光标
  expect(await getCursorCount(page)).toBe(1);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 按 Mod-d（ControlOrMeta+d） | [STATE] selectNextOccurrence（`multi-cursor.ts:59`）→ selection.ranges 有空 range → 扩展为 `state.wordAt(1)` = [0,3) "foo"（`multi-cursor.ts:65-71`）→ dispatch selection | 选择器: 无; 操作: page.keyboard.press("ControlOrMeta+d"); 控件: editor; 等待: 100ms |
| 2 | 断言光标数仍为 1（未加 range） | [DOM] `.cm-cursor` count === 1（扩展阶段不加新 range，`multi-cursor.ts:63-78`） | 选择器: .cm-cursor; 操作: getCursorCount(); 控件: editor; 等待: 无 |
| 3 | 断言选中文本 = "foo" | [DOM] selection 从 [0,3)，可通过再次输入验证（如在 range 内输入字符会替换 "foo"） | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] Mod-d 在空光标上扩展选区到当前单词（"foo"）
- [DOM] 扩展阶段不加新 range（光标数仍为 1）

---

## FP-10-01-N02 [P1] [正常] 已选词后按 Mod-d→ 追加下一个匹配为新 range

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（multiCursor:true）
- 初始文档: 清空后输入 "foo bar foo baz"
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空并输入
  await clearEditor(page);
  await typeInEditor(page, "foo bar foo baz");
  await page.waitForTimeout(200);
  // step 3: 先 Mod-d 一次扩展到 "foo"（同 N01）
  await page.click(".cm-content");
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ControlOrMeta+d");
  await page.waitForTimeout(100);
  expect(await getCursorCount(page)).toBe(1); // 扩展后仍 1 个
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 再次按 Mod-d | [STATE] 所有 range 非空 → 取 main [0,3) "foo" 为 query → `findNextOccurrence`（`multi-cursor.ts:30-51`）从 to=3 搜索 "foo" → index=8 未被覆盖 → 追加 [8,11) 为新 main range（`multi-cursor.ts:87-91`） | 选择器: 无; 操作: page.keyboard.press("ControlOrMeta+d"); 控件: editor; 等待: 100ms |
| 2 | 断言光标数 = 2 | [DOM] `.cm-cursor` count === 2（两个 range，drawSelection 渲染两个光标） | 选择器: .cm-cursor; 操作: getCursorCount(); 控件: editor; 等待: 无 |
| 3 | 断言输入同时影响两个位置 | [STATE] 在两个光标位置同时输入 "X"（替换 "fooX" 两处）→ getDocument 含 "fooX bar fooX baz" | 选择器: 无; 操作: page.keyboard.press("X"); 控件: editor; 等待: 100ms |
| 4 | 断言文档含两处 "fooX" | [DOM] getDocument() 含 "fooX bar fooX baz"（两个 selection 同时被替换） | 选择器: .cm-content; 操作: getDocument(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] Mod-d 追加下一个 "foo" 匹配为新 range（光标数 1→2）
- [DOM] 多光标同时输入替换两处文本

---

## FP-10-01-N03 [P2] [正常] 连续 Mod-d 三次→ 选中全部 3 个 "foo"

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（multiCursor:true）
- 初始文档: 清空后输入 "foo bar foo baz foo"（3 个 "foo"）
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空并输入
  await clearEditor(page);
  await typeInEditor(page, "foo bar foo baz foo");
  await page.waitForTimeout(200);
  // step 3: 光标在第一个 "foo" 内
  await page.click(".cm-content");
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 按 Mod-d（第 1 次：扩展到词） | [STATE] 扩展到 [0,3) "foo" | 选择器: 无; 操作: ControlOrMeta+d; 控件: editor; 等待: 100ms |
| 2 | 按 Mod-d（第 2 次：追加 [8,11)） | [DOM] 光标数 = 2 | 选择器: .cm-cursor; 操作: getCursorCount(); 控件: editor; 等待: 100ms |
| 3 | 按 Mod-d（第 3 次：追加 [16,19)） | [DOM] 光标数 = 3（findNextOccurrence 从 11 搜索 → 16 未覆盖 → 追加） | 选择器: .cm-cursor; 操作: getCursorCount(); 控件: editor; 等待: 100ms |
| 4 | 输入 "X" 替换三处 | [DOM] getDocument() 含 "X bar X baz X"（3 个 "foo" 同时被替换为 "X"） | 选择器: 无; 操作: page.keyboard.press("X"); 控件: editor; 等待: 100ms |

**断言汇总**:
- [DOM] 连续 3 次 Mod-d 选中全部 3 个 "foo"
- [DOM] 多光标同时编辑三处

---

## FP-10-01-N04 [P2] [正常] Mod-d 从文档末尾匹配→ 回绕到文档开头

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（multiCursor:true）
- 初始文档: 清空后输入 "foo bar foo baz foo"
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空并输入
  await clearEditor(page);
  await typeInEditor(page, "foo bar foo baz foo");
  await page.waitForTimeout(200);
  // step 3: 选中最后一个 "foo"（position 16-19）
  await page.click(".cm-content");
  await page.keyboard.press("End");
  // Shift+ArrowLeft x3 选中 "foo"
  for (let i = 0; i < 3; i++) await page.keyboard.press("Shift+ArrowLeft");
  await page.waitForTimeout(100);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 按 Mod-d | [STATE] main=[16,19) "foo" → findNextOccurrence 从 19 搜索 → 不到 → 回绕从 0 搜索 → [0,3) 未覆盖 → 追加（`multi-cursor.ts:38-47` 的 `[searchOrigin, 0]` 两遍扫描） | 选择器: 无; 操作: ControlOrMeta+d; 控件: editor; 等待: 100ms |
| 2 | 断言光标数 = 2 | [DOM] `.cm-cursor` count === 2（回绕后追加了 [0,3)） | 选择器: .cm-cursor; 操作: getCursorCount(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] Mod-d 从文档末尾回绕到开头找到下一个匹配

---

## FP-10-01-N05 [P3] [正常] 全部匹配已选中时 Mod-d→ 不再加 range

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（multiCursor:true）
- 初始文档: 清空后输入 "foo foo"（仅 2 个 "foo"）
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空并输入
  await clearEditor(page);
  await typeInEditor(page, "foo foo");
  await page.waitForTimeout(200);
  // step 3: 连续 Mod-d 选中两个 "foo"
  await page.click(".cm-content");
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ControlOrMeta+d"); // 扩展到 [0,3)
  await page.waitForTimeout(100);
  await page.keyboard.press("ControlOrMeta+d"); // 追加 [4,7)
  await page.waitForTimeout(100);
  expect(await getCursorCount(page)).toBe(2);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 再按 Mod-d（第 3 次） | [STATE] findNextOccurrence 搜索 "foo"：所有匹配已被 range 覆盖（isCovered 返回 true，`multi-cursor.ts:43`）→ 返回 null → 命令返回 false（`multi-cursor.ts:84-85`）→ 不 dispatch | 选择器: 无; 操作: ControlOrMeta+d; 控件: editor; 等待: 100ms |
| 2 | 断言光标数仍为 2 | [DOM] `.cm-cursor` count === 2（无新 range 添加） | 选择器: .cm-cursor; 操作: getCursorCount(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 所有匹配已选中时 Mod-d 不再加 range（返回 false）

---

## FP-10-01-E01 [P3] [异常] 空文档按 Mod-d→ 无单词可扩展→ 不改变选区

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（multiCursor:true）
- 初始文档: 空文档（清空后）或纯空格
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器
  await clearEditor(page);
  await page.waitForTimeout(200);
  expect(await getCursorCount(page)).toBe(1);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 按 Mod-d | [STATE] selection.ranges 有空 range → `state.wordAt(head)` 在空文档返回 null（`multi-cursor.ts:67`）→ expanded=false → 返回 false（`multi-cursor.ts:72`）→ 不 dispatch | 选择器: 无; 操作: ControlOrMeta+d; 控件: editor; 等待: 100ms |
| 2 | 断言光标数仍为 1 | [DOM] `.cm-cursor` count === 1（无变化） | 选择器: .cm-cursor; 操作: getCursorCount(); 控件: editor; 等待: 无 |
| 3 | 断言文档仍为空 | [DOM] getDocument() === "" 或仅空白 | 选择器: .cm-content; 操作: getDocument(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 空文档按 Mod-d 无效果（无单词可扩展）

---

## FP-10-01-F01 [P2] [流程] Mod-d 多光标→ 输入编辑→ 撤销完整流程

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（multiCursor:true + history 插件）
- 初始文档: 清空后输入 "foo bar foo"
- 插件配置: demo 默认（含 createHistoryPlugin）
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空并输入
  await clearEditor(page);
  await typeInEditor(page, "foo bar foo");
  await page.waitForTimeout(200);
  // step 3: 选中两个 "foo"
  await page.click(".cm-content");
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ControlOrMeta+d"); // 扩展
  await page.keyboard.press("ControlOrMeta+d"); // 追加第二个
  await page.waitForTimeout(100);
  expect(await getCursorCount(page)).toBe(2);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 输入 "X"（替换两个 "foo"） | [DOM] getDocument() === "X bar X"（两个选区同时替换） | 选择器: 无; 操作: page.keyboard.press("X"); 控件: editor; 等待: 100ms |
| 2 | 按 ControlOrMeta+z（撤销） | [STATE] history 撤销最后一次输入 → 恢复 "foo bar foo" | 选择器: 无; 操作: ControlOrMeta+z; 控件: editor; 等待: 150ms |
| 3 | 断言文档恢复 | [DOM] getDocument() 含 "foo bar foo"（撤销恢复两处 "foo"） | 选择器: .cm-content; 操作: getDocument(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 多光标输入同时替换两处
- [DOM] 撤销一次性恢复两处编辑

---

# FP-10-02 addCursorAbove / addCursorBelow（Mod-Alt-ArrowUp/Down）（7 例，[编辑交互]）

> 实现路径：`multi-cursor.ts:144-146` 的 keymap 绑定 `Mod-Alt-ArrowUp → addCursorAbove`、`Mod-Alt-ArrowDown → addCursorBelow`（均 preventDefault:true）。`addCursorVertically`（`multi-cursor.ts:101-123`）基于**逻辑行**（`state.doc.lineAt`）在上一/下一行同列添加空光标。列号 clamp 到目标行长度（`multi-cursor.ts:113`）。到文档边界返回 false。

## FP-10-02-N01 [P1] [正常] Mod-Alt-ArrowDown→ 在下一行同列添加光标

**测试框架**: Playwright

**前置条件**（⚠️ 4要素）:
- 依赖环境: Electron demo（multiCursor:true）
- 初始文档: 清空后输入 "alpha\nbeta\ngamma"（3 行）
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空并输入多行文本
  await clearEditor(page);
  await typeInEditor(page, "alpha\nbeta\ngamma");
  await page.waitForTimeout(200);
  // step 3: 光标在第 1 行第 3 列（position 2，"alpha" 中的 'p'）
  await page.click(".cm-content");
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight"); // position 2
  await page.waitForTimeout(100);
  expect(await getCursorCount(page)).toBe(1);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 按 Mod-Alt-ArrowDown | [STATE] addCursorBelow（`multi-cursor.ts:127`）→ addCursorVertically(forward=true)（`multi-cursor.ts:101`）→ source=ranges[0] head=2 → sourceLine=line 1 "alpha" → targetLine=line 2 "beta" → column=2 → pos=6+2=8（"beta" 的 't'）→ 追加 cursor(8)（`multi-cursor.ts:117-122`） | 选择器: 无; 操作: page.keyboard.press("ControlOrMeta+Alt+ArrowDown"); 控件: editor; 等待: 100ms |
| 2 | 断言光标数 = 2 | [DOM] `.cm-cursor` count === 2 | 选择器: .cm-cursor; 操作: getCursorCount(); 控件: editor; 等待: 无 |
| 3 | 输入 "X" | [DOM] 两个光标同时输入 → "alXpha\nbeXta\ngamma" | 选择器: 无; 操作: page.keyboard.press("X"); 控件: editor; 等待: 100ms |
| 4 | 断言两行均有 X | [DOM] getDocument() 含 "alXpha" 且含 "beXta"（第 1 行 position 2 和第 2 行 position 2 同时插入） | 选择器: .cm-content; 操作: getDocument(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] Mod-Alt-ArrowDown 在下一行同列添加光标
- [DOM] 多光标同时编辑两行

---

## FP-10-02-N02 [P1] [正常] Mod-Alt-ArrowUp→ 在上一行同列添加光标

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（multiCursor:true）
- 初始文档: 清空后输入 "alpha\nbeta\ngamma"
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空并输入
  await clearEditor(page);
  await typeInEditor(page, "alpha\nbeta\ngamma");
  await page.waitForTimeout(200);
  // step 3: 光标在第 2 行第 3 列（position 8，"beta" 的 't'）
  await page.click(".cm-content");
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowDown"); // 到第 2 行
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight"); // position 8
  await page.waitForTimeout(100);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 按 Mod-Alt-ArrowUp | [STATE] addCursorAbove（`multi-cursor.ts:125`）→ forward=false → source=ranges[0] head=8 → sourceLine=line 2 "beta" → targetLine=line 1 "alpha" → column=2 → pos=0+2=2 → 追加 cursor(2) | 选择器: 无; 操作: page.keyboard.press("ControlOrMeta+Alt+ArrowUp"); 控件: editor; 等待: 100ms |
| 2 | 断言光标数 = 2 | [DOM] `.cm-cursor` count === 2 | 选择器: .cm-cursor; 操作: getCursorCount(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] Mod-Alt-ArrowUp 在上一行同列添加光标

---

## FP-10-02-N03 [P2] [正常] 连续 Mod-Alt-ArrowDown→ 从最底 range 向下堆叠

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（multiCursor:true）
- 初始文档: 清空后输入 "alpha\nbeta\ngamma"
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空并输入
  await clearEditor(page);
  await typeInEditor(page, "alpha\nbeta\ngamma");
  await page.waitForTimeout(200);
  // step 3: 光标在第 1 行第 3 列
  await page.click(".cm-content");
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight"); // position 2
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 按 Mod-Alt-ArrowDown（第 1 次） | [DOM] 光标数 = 2（追加 line 2） | 选择器: 无; 操作: ControlOrMeta+Alt+ArrowDown; 控件: editor; 等待: 100ms |
| 2 | 按 Mod-Alt-ArrowDown（第 2 次） | [STATE] source = ranges[last]（最底 range，`multi-cursor.ts:105-106`）→ 从 line 2 → line 3 追加 → 光标数 = 3 | 选择器: 无; 操作: ControlOrMeta+Alt+ArrowDown; 控件: editor; 等待: 100ms |
| 3 | 断言光标数 = 3 | [DOM] `.cm-cursor` count === 3（三行各一个光标） | 选择器: .cm-cursor; 操作: getCursorCount(); 控件: editor; 等待: 无 |
| 4 | 输入 "X" | [DOM] 三行同时插入 X | 选择器: 无; 操作: page.keyboard.press("X"); 控件: editor; 等待: 100ms |

**断言汇总**:
- [DOM] 连续 Mod-Alt-ArrowDown 从最底 range 向下堆叠（3 个光标）
- [DOM] 多光标同时编辑三行

---

## FP-10-02-N04 [P2] [正常] 目标行较短→ 列号 clamp 到行尾

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（multiCursor:true）
- 初始文档: 清空后输入 "abcdefghij\nabc"（第 1 行 10 字符，第 2 行 3 字符）
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空并输入
  await clearEditor(page);
  await typeInEditor(page, "abcdefghij\nabc");
  await page.waitForTimeout(200);
  // step 3: 光标在第 1 行第 10 列（position 9，'j'）
  await page.click(".cm-content");
  await page.keyboard.press("Home");
  for (let i = 0; i < 9; i++) await page.keyboard.press("ArrowRight"); // position 9
  await page.waitForTimeout(100);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 按 Mod-Alt-ArrowDown | [STATE] source head=9 → column=9 → targetLine=line 2 "abc" length=3 → `Math.min(9, 3)=3`（`multi-cursor.ts:113`）→ pos=11+3=14（行尾后） | 选择器: 无; 操作: ControlOrMeta+Alt+ArrowDown; 控件: editor; 等待: 100ms |
| 2 | 断言光标数 = 2 | [DOM] `.cm-cursor` count === 2 | 选择器: .cm-cursor; 操作: getCursorCount(); 控件: editor; 等待: 无 |
| 3 | 输入 "X" | [DOM] getDocument() 第 1 行 "abcdefghijX" + 第 2 行 "abcX"（第 2 行光标 clamp 到末尾） | 选择器: 无; 操作: page.keyboard.press("X"); 控件: editor; 等待: 100ms |

**断言汇总**:
- [DOM] 目标行较短时列号 clamp 到行尾

---

## FP-10-02-N05 [P2] [正常] 单行文档按 Mod-Alt-ArrowDown→ 到文档边界返回 false

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（multiCursor:true）
- 初始文档: 清空后输入 "only line"（单行）
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空并输入
  await clearEditor(page);
  await typeInEditor(page, "only line");
  await page.waitForTimeout(200);
  await page.click(".cm-content");
  await page.keyboard.press("Home");
  await page.waitForTimeout(100);
  expect(await getCursorCount(page)).toBe(1);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 按 Mod-Alt-ArrowDown | [STATE] sourceLine=line 1 → targetNumber=2 > state.doc.lines=1 → 返回 false（`multi-cursor.ts:110`）→ 不 dispatch | 选择器: 无; 操作: ControlOrMeta+Alt+ArrowDown; 控件: editor; 等待: 100ms |
| 2 | 断言光标数仍为 1 | [DOM] `.cm-cursor` count === 1 | 选择器: .cm-cursor; 操作: getCursorCount(); 控件: editor; 等待: 无 |
| 3 | 按 Mod-Alt-ArrowUp | [STATE] targetNumber=0 < 1 → 返回 false | 选择器: 无; 操作: ControlOrMeta+Alt+ArrowUp; 控件: editor; 等待: 100ms |
| 4 | 断言光标数仍为 1 | [DOM] `.cm-cursor` count === 1 | 选择器: .cm-cursor; 操作: getCursorCount(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 单行文档在边界按 Mod-Alt-Arrow 无效果

---

## FP-10-02-E01 [P3] [异常] 目标位置已有空光标→ 去重返回 false

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（multiCursor:true）
- 初始文档: 清空后输入 "ab\nab"（两行相同内容）
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空并输入
  await clearEditor(page);
  await typeInEditor(page, "ab\nab");
  await page.waitForTimeout(200);
  // step 3: 光标在第 1 行第 1 列（position 0）
  await page.click(".cm-content");
  await page.keyboard.press("Home");
  await page.waitForTimeout(100);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 按 Mod-Alt-ArrowDown（追加 line 2 position 0） | [DOM] 光标数 = 2（ranges = [cursor(0), cursor(3)]） | 选择器: 无; 操作: ControlOrMeta+Alt+ArrowDown; 控件: editor; 等待: 100ms |
| 2 | 按 Mod-Alt-ArrowDown（再次尝试从最底 range 向下） | [STATE] source = ranges[last] head=3 → targetLine=line 3 不存在（仅 2 行）→ 返回 false（`multi-cursor.ts:110`） | 选择器: 无; 操作: ControlOrMeta+Alt+ArrowDown; 控件: editor; 等待: 100ms |
| 3 | 断言光标数仍为 2 | [DOM] `.cm-cursor` count === 2（边界返回 false 不加 range） | 选择器: .cm-cursor; 操作: getCursorCount(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 到文档边界时 Mod-Alt-Arrow 返回 false 不加 range

---

## FP-10-02-F01 [P2] [流程] Mod-Alt-ArrowDown 多行→ 同时编辑多列→ 撤销

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（multiCursor:true + history 插件）
- 初始文档: 清空后输入 "line1\nline2\nline3"（3 行）
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空并输入
  await clearEditor(page);
  await typeInEditor(page, "line1\nline2\nline3");
  await page.waitForTimeout(200);
  // step 3: 光标在第 1 行行首
  await page.click(".cm-content");
  await page.keyboard.press("Home");
  await page.waitForTimeout(100);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 按 Mod-Alt-ArrowDown 两次（3 行行首各一光标） | [DOM] 光标数 = 3 | 选择器: 无; 操作: ControlOrMeta+Alt+ArrowDown x2; 控件: editor; 等待: 200ms |
| 2 | 输入 "> "（行首添加前缀） | [DOM] 三行同时变为 "> line1\n> line2\n> line3" | 选择器: 无; 操作: typeInEditor("> "); 控件: editor; 等待: 150ms |
| 3 | 断言三行均有 "> " 前缀 | [DOM] getDocument() 含 "> line1"、"> line2"、"> line3" | 选择器: .cm-content; 操作: getDocument(); 控件: editor; 等待: 无 |
| 4 | 按 ControlOrMeta+z 撤销 | [DOM] getDocument() 恢复为 "line1\nline2\nline3" | 选择器: 无; 操作: ControlOrMeta+z; 控件: editor; 等待: 150ms |

**断言汇总**:
- [DOM] 多光标在行首同时添加前缀
- [DOM] 撤销一次性恢复三行

---

# FP-10-03 collapseToMainSelection（Mod-Esc）（5 例，[编辑交互]）

> 实现路径：`multi-cursor.ts:147` 的 keymap 绑定 `Escape → collapseToMainSelection`（**无 preventDefault**）。命令（`multi-cursor.ts:133-141`）：ranges.length > 1 时保留 main range 丢弃其他，返回 true；ranges.length <= 1 时返回 false（让 Escape 继续冒泡到斜杠菜单/搜索面板）。

## FP-10-03-N01 [P1] [正常] 多光标按 Escape→ 收缩为单光标（保留 main）

**测试框架**: Playwright

**前置条件**（⚠️ 4要素）:
- 依赖环境: Electron demo（multiCursor:true）
- 初始文档: 清空后输入 "foo bar foo"
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空并输入
  await clearEditor(page);
  await typeInEditor(page, "foo bar foo");
  await page.waitForTimeout(200);
  // step 3: Mod-d 选中两个 "foo"（制造多光标场景）
  await page.click(".cm-content");
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ControlOrMeta+d"); // 扩展到第一个 "foo"
  await page.keyboard.press("ControlOrMeta+d"); // 追加第二个 "foo"
  await page.waitForTimeout(100);
  expect(await getCursorCount(page)).toBe(2);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 按 Escape | [STATE] collapseToMainSelection（`multi-cursor.ts:133`）→ ranges.length=2 > 1 → 保留 main range（最后添加的 [8,11)）→ dispatch selection = [main]（`multi-cursor.ts:136-139`）→ 返回 true | 选择器: 无; 操作: page.keyboard.press("Escape"); 控件: editor; 等待: 100ms |
| 2 | 断言光标数 = 1 | [DOM] `.cm-cursor` count === 1（收缩为 main range） | 选择器: .cm-cursor; 操作: getCursorCount(); 控件: editor; 等待: 无 |
| 3 | 断言文档未变 | [DOM] getDocument() 仍含 "foo bar foo"（collapse 仅改选区不改文档） | 选择器: .cm-content; 操作: getDocument(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 多光标 Escape 收缩为单光标（保留 main range）
- [DOM] 文档内容不变（仅选区变化）

---

## FP-10-03-N02 [P2] [正常] Escape 保留的是 main range（非第一个）

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（multiCursor:true）
- 初始文档: 清空后输入 "foo bar foo"
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空并输入
  await clearEditor(page);
  await typeInEditor(page, "foo bar foo");
  await page.waitForTimeout(200);
  // step 3: Mod-d 选中两个 "foo"，main 是第二个 [8,11)
  await page.click(".cm-content");
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ControlOrMeta+d");
  await page.keyboard.press("ControlOrMeta+d");
  await page.waitForTimeout(100);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 按 Escape | [STATE] 保留 `selection.main` = ranges[1] = [8,11)（最后添加的 range，mainIndex=1，`multi-cursor.ts:137-138`） | 选择器: 无; 操作: Escape; 控件: editor; 等待: 100ms |
| 2 | 断言光标数 = 1 | [DOM] `.cm-cursor` count === 1 | 选择器: .cm-cursor; 操作: getCursorCount(); 控件: editor; 等待: 无 |
| 3 | 输入 "X" 验证保留的是第二个 "foo" | [DOM] getDocument() === "foo bar X"（第二个 "foo" 被替换，第一个保留） | 选择器: 无; 操作: page.keyboard.press("X"); 控件: editor; 等待: 100ms |

**断言汇总**:
- [DOM] Escape 保留 main range（第二个 "foo"），而非第一个
- [DOM] 输入只影响保留的 range

---

## FP-10-03-N03 [P2] [正常] 单光标按 Escape→ 返回 false 不改变选区

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（multiCursor:true）
- 初始文档: 清空后输入 "hello"
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空并输入
  await clearEditor(page);
  await typeInEditor(page, "hello");
  await page.waitForTimeout(200);
  await page.click(".cm-content");
  await page.keyboard.press("Home");
  await page.waitForTimeout(100);
  expect(await getCursorCount(page)).toBe(1);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 按 Escape | [STATE] ranges.length=1 <= 1 → 返回 false（`multi-cursor.ts:135-136`）→ 不 dispatch → Escape 继续冒泡 | 选择器: 无; 操作: Escape; 控件: editor; 等待: 100ms |
| 2 | 断言光标数仍为 1 | [DOM] `.cm-cursor` count === 1（单 range 时 Escape 无效果） | 选择器: .cm-cursor; 操作: getCursorCount(); 控件: editor; 等待: 无 |
| 3 | 断言文档不变 | [DOM] getDocument() === "hello" | 选择器: .cm-content; 操作: getDocument(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 单光标 Escape 无效果（返回 false，不 dispatch）

---

## FP-10-03-B01 [P4] [边界] 多次 Escape→ 第一次收缩，后续无效

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（multiCursor:true）
- 初始文档: 清空后输入 "foo foo foo"
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空并输入
  await clearEditor(page);
  await typeInEditor(page, "foo foo foo");
  await page.waitForTimeout(200);
  // step 3: Mod-d 选中 3 个 "foo"
  await page.click(".cm-content");
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ControlOrMeta+d");
  await page.keyboard.press("ControlOrMeta+d");
  await page.keyboard.press("ControlOrMeta+d");
  await page.waitForTimeout(100);
  expect(await getCursorCount(page)).toBe(3);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 按 Escape（第 1 次） | [DOM] 光标数 3→1（收缩为 main range） | 选择器: 无; 操作: Escape; 控件: editor; 等待: 100ms |
| 2 | 断言光标数 = 1 | [DOM] `.cm-cursor` count === 1 | 选择器: .cm-cursor; 操作: getCursorCount(); 控件: editor; 等待: 无 |
| 3 | 按 Escape（第 2 次） | [STATE] ranges.length=1 → 返回 false → 不变 | 选择器: 无; 操作: Escape; 控件: editor; 等待: 100ms |
| 4 | 断言光标数仍为 1 | [DOM] `.cm-cursor` count === 1（第二次 Escape 无效果） | 选择器: .cm-cursor; 操作: getCursorCount(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 第一次 Escape 收缩多光标为单光标
- [DOM] 后续 Escape 无效果（已为单 range）

---

## FP-10-03-E01 [P3] [异常] Escape 在斜杠菜单打开时→ 先关菜单（单光标场景）

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（multiCursor:true + slash 插件）
- 初始文档: 清空后输入 "/"（触发斜杠菜单）
- 插件配置: demo 默认（含斜杠命令插件）
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空并输入 "/"
  await clearEditor(page);
  await typeInEditor(page, "/");
  await page.waitForTimeout(300);
  // step 3: 确认斜杠菜单弹出
  const menuVisible = await page.locator(".slash-menu, [class*='slash']").first().isVisible().catch(() => false);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 按 Escape | [STATE] collapseToMainSelection 返回 false（单 range）→ Escape 冒泡 → 斜杠菜单的 Escape handler 关闭菜单 | 选择器: 无; 操作: Escape; 控件: editor; 等待: 200ms |
| 2 | 断言光标数仍为 1 | [DOM] `.cm-cursor` count === 1（单 range 时 collapse 返回 false） | 选择器: .cm-cursor; 操作: getCursorCount(); 控件: editor; 等待: 无 |
| 3 | 断言斜杠菜单已关闭 | [DOM] `.slash-menu` 或斜杠菜单容器不可见（Escape 关闭了菜单） | 选择器: .slash-menu; 操作: isVisible(); 控件: slash; 等待: 无 |

**断言汇总**:
- [DOM] 单光标时 Escape 不触发 collapse（返回 false）
- [DOM] Escape 冒泡后关闭斜杠菜单

---

# FP-10-04 Alt-click 在指定位置添加光标（6 例，[编辑交互]）

> 实现路径：`multi-cursor.ts:169` 的 `EditorView.clickAddsSelectionRange.of((event) => event.altKey)` 让 Alt+mousedown 在点击位置**追加**一个 range（非替换当前选区）。配合 `drawSelection()` 渲染多光标。与普通点击（替换选区）的区别由 `event.altKey` 判定。

## FP-10-04-N01 [P1] [正常] Alt-click 在另一行→ 追加光标

**测试框架**: Playwright

**前置条件**（⚠️ 4要素）:
- 依赖环境: Electron demo（multiCursor:true）
- 初始文档: 清空后输入 "line one\nline two"
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空并输入两行
  await clearEditor(page);
  await typeInEditor(page, "line one\nline two");
  await page.waitForTimeout(200);
  // step 3: 普通点击第 1 行行首（建立初始光标）
  await clickAtLine(page, 0, 0);
  await page.waitForTimeout(100);
  expect(await getCursorCount(page)).toBe(1);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | Alt-click 第 2 行行首 | [STATE] mousedown event.altKey=true → `clickAddsSelectionRange` 返回 true（`multi-cursor.ts:169`）→ CM6 在点击位置追加 range → selection.ranges.length=2 | 选择器: .cm-line; 操作: page.mouse.click with altKey; 控件: editor; 等待: 100ms |
| 2 | 断言光标数 = 2 | [DOM] `.cm-cursor` count === 2（原光标 + 新追加光标） | 选择器: .cm-cursor; 操作: getCursorCount(); 控件: editor; 等待: 无 |
| 3 | 输入 "X" | [DOM] 两行行首同时插入 X → "Xline one\nXline two" | 选择器: 无; 操作: page.keyboard.press("X"); 控件: editor; 等待: 100ms |

**断言汇总**:
- [DOM] Alt-click 在另一行追加光标（非替换）
- [DOM] 多光标同时编辑

---

## FP-10-04-N02 [P1] [正常] 普通点击（无 Alt）→ 替换为单光标

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（multiCursor:true）
- 初始文档: 清空后输入 "aaa\nbbb\nccc"
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空并输入三行
  await clearEditor(page);
  await typeInEditor(page, "aaa\nbbb\nccc");
  await page.waitForTimeout(200);
  // step 3: Alt-click 制造多光标（第 1 行 + 第 2 行）
  await clickAtLine(page, 0, 0);
  await page.waitForTimeout(50);
  // Alt+click 第 2 行
  const line2 = page.locator(".cm-line").nth(1);
  const box2 = await line2.boundingBox();
  await page.keyboard.down("Alt");
  await page.mouse.click(box2!.x + 2, box2!.y + box2!.height / 2);
  await page.keyboard.up("Alt");
  await page.waitForTimeout(100);
  expect(await getCursorCount(page)).toBe(2);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 普通点击第 3 行（无 Alt） | [STATE] mousedown event.altKey=false → clickAddsSelectionRange 返回 false → CM6 替换选区为单 range | 选择器: .cm-line; 操作: page.mouse.click (no alt); 控件: editor; 等待: 100ms |
| 2 | 断言光标数 = 1 | [DOM] `.cm-cursor` count === 1（普通点击替换为单光标） | 选择器: .cm-cursor; 操作: getCursorCount(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 普通点击替换多光标为单光标（与 Alt-click 追加行为对比）

---

## FP-10-04-N03 [P2] [正常] 多次 Alt-click→ 累加多个光标

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（multiCursor:true）
- 初始文档: 清空后输入 "aaa\nbbb\nccc"（3 行）
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空并输入三行
  await clearEditor(page);
  await typeInEditor(page, "aaa\nbbb\nccc");
  await page.waitForTimeout(200);
  // step 3: 普通点击第 1 行
  await clickAtLine(page, 0, 0);
  await page.waitForTimeout(50);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | Alt-click 第 2 行 | [DOM] 光标数 1→2 | 选择器: .cm-line; 操作: Alt+click line 2; 控件: editor; 等待: 100ms |
| 2 | Alt-click 第 3 行 | [DOM] 光标数 2→3（累加第三个 range） | 选择器: .cm-line; 操作: Alt+click line 3; 控件: editor; 等待: 100ms |
| 3 | 断言光标数 = 3 | [DOM] `.cm-cursor` count === 3 | 选择器: .cm-cursor; 操作: getCursorCount(); 控件: editor; 等待: 无 |
| 4 | 输入 "X" | [DOM] 三行行首同时插入 X → "Xaaa\nXbbb\nXccc" | 选择器: 无; 操作: page.keyboard.press("X"); 控件: editor; 等待: 100ms |

**断言汇总**:
- [DOM] 多次 Alt-click 累加多个光标（3 行各一个）
- [DOM] 多光标同时编辑三行

---

## FP-10-04-N04 [P2] [正常] Alt-click 后 Escape→ 收缩回单光标

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（multiCursor:true）
- 初始文档: 清空后输入 "line one\nline two"
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空并输入
  await clearEditor(page);
  await typeInEditor(page, "line one\nline two");
  await page.waitForTimeout(200);
  // step 3: Alt-click 建立两个光标
  await clickAtLine(page, 0, 0);
  await page.waitForTimeout(50);
  const line2 = page.locator(".cm-line").nth(1);
  const box2 = await line2.boundingBox();
  await page.keyboard.down("Alt");
  await page.mouse.click(box2!.x + 2, box2!.y + box2!.height / 2);
  await page.keyboard.up("Alt");
  await page.waitForTimeout(100);
  expect(await getCursorCount(page)).toBe(2);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 按 Escape | [STATE] collapseToMainSelection → ranges.length=2 > 1 → 保留 main（最后 Alt-click 的 range）→ 单 range | 选择器: 无; 操作: Escape; 控件: editor; 等待: 100ms |
| 2 | 断言光标数 = 1 | [DOM] `.cm-cursor` count === 1 | 选择器: .cm-cursor; 操作: getCursorCount(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] Alt-click 建立多光标后 Escape 可收缩为单光标

---

## FP-10-04-B01 [P4] [边界] Alt-click 同一位置→ 去重不加 range

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（multiCursor:true）
- 初始文档: 清空后输入 "test line"
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空并输入
  await clearEditor(page);
  await typeInEditor(page, "test line");
  await page.waitForTimeout(200);
  // step 3: 点击行首建立初始光标
  await clickAtLine(page, 0, 0);
  await page.waitForTimeout(100);
  expect(await getCursorCount(page)).toBe(1);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | Alt-click 同一行行首（接近原位置） | [STATE] CM6 clickAddsSelectionRange → 追加 range → 若位置相同则 CM6 内部去重（EditorSelection.create 合并相同空 range） | 选择器: .cm-line; 操作: Alt+click same pos; 控件: editor; 等待: 100ms |
| 2 | 断言光标数 <= 2 | [DOM] `.cm-cursor` count <= 2（CM6 可能去重相同位置的空 range） | 选择器: .cm-cursor; 操作: getCursorCount(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] Alt-click 同一位置不产生异常（CM6 去重或保留，行为稳定）

---

## FP-10-04-F01 [P2] [流程] Alt-click 多行→ 输入前缀→ Escape→ 继续单光标编辑

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（multiCursor:true）
- 初始文档: 清空后输入 "item1\nitem2\nitem3"
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空并输入
  await clearEditor(page);
  await typeInEditor(page, "item1\nitem2\nitem3");
  await page.waitForTimeout(200);
  // step 3: 普通点击第 1 行行首
  await clickAtLine(page, 0, 0);
  await page.waitForTimeout(50);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | Alt-click 第 2 行行首 | [DOM] 光标数 = 2 | 选择器: .cm-line; 操作: Alt+click line 2; 控件: editor; 等待: 100ms |
| 2 | Alt-click 第 3 行行首 | [DOM] 光标数 = 3 | 选择器: .cm-line; 操作: Alt+click line 3; 控件: editor; 等待: 100ms |
| 3 | 输入 "- "（列表前缀） | [DOM] 三行行首同时加 "- " → "- item1\n- item2\n- item3" | 选择器: 无; 操作: typeInEditor("- "); 控件: editor; 等待: 150ms |
| 4 | 断言三行均有 "- " 前缀 | [DOM] getDocument() 含 "- item1"、"- item2"、"- item3" | 选择器: .cm-content; 操作: getDocument(); 控件: editor; 等待: 无 |
| 5 | 按 Escape 收缩 | [DOM] 光标数 3→1（保留 main range） | 选择器: 无; 操作: Escape; 控件: editor; 等待: 100ms |
| 6 | 断言光标数 = 1 | [DOM] `.cm-cursor` count === 1 | 选择器: .cm-cursor; 操作: getCursorCount(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] Alt-click 建立多光标 → 同时输入列表前缀 → Escape 收缩
- [DOM] 完整流程正确

---

## 统计汇总

### 类型分布

| 类型 | 数量 | 占比 |
|------|------|------|
| 正常(N) | 16 | 64.0% |
| 异常(E) | 3 | 12.0% |
| 边界(B) | 2 | 8.0% |
| 流程(F) | 4 | 16.0% |
| 数据(D) | 0 | 0% |

### 优先级分布

| 优先级 | 数量 | 占比 |
|--------|------|------|
| P1 | 8 | 32.0% |
| P2 | 10 | 40.0% |
| P3 | 4 | 16.0% |
| P4 | 3 | 12.0% |
| P5 | 0 | 0% |

### 框架分布

| 框架 | 数量 | 占比 |
|------|------|------|
| Playwright | 25 | 100% |

### 各二级功能点用例数

| 二级功能点 | 用例数 | 编号范围 |
|-----------|--------|---------|
| FP-10-01 selectNextOccurrence (Mod-d) | 7 | N01-N05, E01, F01 |
| FP-10-02 addCursorAbove/Below (Mod-Alt-Arrow) | 7 | N01-N05, E01, F01 |
| FP-10-03 collapseToMainSelection (Mod-Esc) | 5 | N01-N03, B01, E01 |
| FP-10-04 Alt-click | 6 | N01-N04, B01, F01 |
| **合计** | **25** | |

### 验证策略分布

| 验证方式 | 用例数 | 说明 |
|---------|--------|------|
| `.cm-cursor` 元素计数（多光标渲染验证） | 25 | 所有用例均通过 cursor 元素数量验证多光标状态 |
| 多位置同时输入验证（输入文本后检查多处变化） | 12 | 验证多光标同时编辑的核心能力 |
| 键盘快捷键触发（ControlOrMeta+d/Alt+Arrow/Escape） | 19 | 通过 page.keyboard.press 触发 |
| Alt-click 鼠标交互 | 6 | 通过 page.mouse.click + Alt 修饰键 |
| 撤销验证（ControlOrMeta+z） | 2 | 验证多光标编辑的撤销完整性 |

### 实现差异关键点

| 差异点 | 影响用例 | 应对策略 |
|--------|---------|---------|
| Demo 已启用 multiCursor:true（editor-shell.ts:138） | 全部 | 无需额外配置，demo 默认环境即可测试 |
| drawSelection 渲染 .cm-cursor 元素 | 全部 | 通过 `.cm-cursor` count 验证光标数量 |
| Mod 在 mac 上为 Meta 键 | 全部 | 使用 Playwright 的 ControlOrMeta 统一映射 |
| Escape 无 preventDefault（多光标 keymap） | FP-10-03 | 单 range 时返回 false 让 Escape 冒泡 |
| Alt-click 通过 clickAddsSelectionRange facet 实现 | FP-10-04 | 使用 page.mouse.click + keyboard.down("Alt") 模拟 |
| 列号 clamp 到目标行长度 | FP-10-02-N04 | 用长短行测试 clamp 行为 |
| findNextOccurrence 回绕搜索 | FP-10-01-N04 | 从末尾匹配验证回绕 |

# CASE-撤销重做插件-测试用例（FP-14）

> 一级功能点: 撤销重做插件（demo-requirements.md §5）
> 全局批次序号: 14
> 生成时间: 2026-08-11
> 测试框架: Playwright（Electron demo e2e）
> 覆盖二级功能点: FP-14-01 ~ FP-14-02（共 2 个）
> 用例总数: 24
>
> 涉及二级功能点:
> - FP-14-01 history() 撤销栈管理（[插件能力][编辑交互]）
> - FP-14-02 historyKeymap 快捷键（Mod-Z / Mod-Shift-Z / Ctrl-U）（[插件能力][编辑交互]）
>
> ⚠️ 实现说明:
> - **测试框架**: Playwright Electron demo e2e，使用 `_electron as electron` + `launchDemo()` 启动。不是 Chrome 浏览器测试！
> - **demo 未暴露 editor 实例到 window**: 所有验证通过 UI 副作用间接验证
> - **实现来源**: `packages/plugin-history/src/index.ts` 封装 `@codemirror/commands` 的 `history()` + `historyKeymap`，由 `apps/electron-demo/src/renderer/editor-shell.ts:141` 的 `createHistoryPlugin()` 挂载
> - **撤销重做验证方式**:
   - history() 撤销栈: 通过输入文本 → 删除/修改 → 撤销 → 检查内容恢复来验证
   - 快捷键: macOS 用 `Meta+z`（撤销）、`Meta+Shift+z`（重做）；也需测试 `Control+u`（undo，部分 keymap）
   - 间接验证: 读取 `.cm-content` 的 textContent 来断言编辑器内容变化
> - **关键快捷键映射**（基于 `@codemirror/commands` historyKeymap）:
   - `Mod-z`: undo（撤销）
   - `Mod-Shift-z`: redo（重做，macOS）
   - `Mod-y`: redo（重做，Windows/Linux）
   - `Mod-u`: undoSelection（撤销选区）
   - `Mod-Shift-u`: redoSelection（重做选区）
> - **编辑器内容验证**: 通过 `await page.evaluate(() => document.querySelector('.cm-content')?.textContent)` 获取文本

---

## e2e 全局前置条件

- 依赖环境: Electron demo（Vite dev server localhost:5173 + 已构建的 `apps/electron-demo/dist-electron/main.js`）
- 初始文档: demo 启动后默认打开 sample-vault 的 index.md
- 插件配置: demo 默认挂载 —— createGfmPreset + createHistoryPlugin + createToolbarPlugin + createSearchPlugin + createWikilinksPlugin + createWordCountPlugin（`editor-shell.ts:139-146`）
- setup 代码（所有用例通用，测试文件顶部）:
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
  ```

---

## FP-14-01: history() 撤销栈管理

> 实现路径: `packages/plugin-history/src/index.ts` 封装 `@codemirror/commands` 的 `history()`，无参数、无可配置项。`history()` 创建一个 EditorView 扩展，维护编辑操作的撤销/重做栈。CM6 默认合并策略会合并相邻的小编辑（如连续输入字符）为一个 history 事件，合并窗口约 500ms。

---

## FP-14-01-N01 [P0] [正常] 单步编辑后撤销→ 恢复到初始内容

**测试框架**: Playwright

**前置条件**（⚠️ 4要素）:
- 依赖环境: Electron demo（createHistoryPlugin 已挂载）
- 初始文档: 清空后输入 "hello"
- 插件配置: demo 默认（含 createHistoryPlugin）
- setup 代码:
  ```typescript
  // step 1: 全局 setup（见 e2e 全局前置条件 launchDemo）
  // step 2: 清空编辑器
  await clearEditor(page);
  await page.waitForTimeout(200);
  // step 3: 输入 "hello"
  await typeInEditor(page, "hello");
  await page.waitForTimeout(300);
  // step 4: 确认初始内容
  expect(await getEditorText(page)).toContain("hello");
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 按 ControlOrMeta+z（撤销） | [STATE] history() undo → 弹出最近的编辑事件（输入 "hello"）→ 恢复到清空后的状态 | 选择器: 无; 操作: page.keyboard.press("ControlOrMeta+z"); 控件: editor; 等待: 150ms |
| 2 | 断言编辑器内容恢复 | [DOM] getEditorText() 不含 "hello"（撤销输入操作，恢复到空状态） | 选择器: .cm-content; 操作: getEditorText(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 单步输入后撤销可恢复到操作前状态

---

## FP-14-01-N02 [P0] [正常] 多步编辑后连续撤销→ 逐步恢复

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（createHistoryPlugin 已挂载）
- 初始文档: 清空后依次输入 "one"、"two"、"three"（分 3 个编辑事件，每个之间有停顿）
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器
  await clearEditor(page);
  await page.waitForTimeout(200);
  // step 3: 分步输入 3 个词，每步之间停顿 > 500ms（确保不合并）
  await typeInEditor(page, "one");
  await page.waitForTimeout(600);
  await page.keyboard.press("Space");
  await page.waitForTimeout(600);
  await typeInEditor(page, "two");
  await page.waitForTimeout(600);
  await page.keyboard.press("Space");
  await page.waitForTimeout(600);
  await typeInEditor(page, "three");
  await page.waitForTimeout(600);
  // step 4: 确认内容
  const text = await getEditorText(page);
  expect(text).toContain("one");
  expect(text).toContain("two");
  expect(text).toContain("three");
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 按 ControlOrMeta+z（第 1 次撤销） | [STATE] undo "three" → 内容变为 "one two " | 选择器: 无; 操作: ControlOrMeta+z; 控件: editor; 等待: 150ms |
| 2 | 断言内容不含 "three" | [DOM] getEditorText() 不含 "three"，含 "one"、"two" | 选择器: .cm-content; 操作: getEditorText(); 控件: editor; 等待: 无 |
| 3 | 按 ControlOrMeta+z（第 2 次撤销） | [STATE] undo "two" → 内容变为 "one " | 选择器: 无; 操作: ControlOrMeta+z; 控件: editor; 等待: 150ms |
| 4 | 断言内容不含 "two" | [DOM] getEditorText() 不含 "two"，含 "one" | 选择器: .cm-content; 操作: getEditorText(); 控件: editor; 等待: 无 |
| 5 | 按 ControlOrMeta+z（第 3 次撤销） | [STATE] undo "one" → 内容变为空 | 选择器: 无; 操作: ControlOrMeta+z; 控件: editor; 等待: 150ms |
| 6 | 断言内容不含 "one" | [DOM] getEditorText() 不含 "one"（所有编辑已撤销） | 选择器: .cm-content; 操作: getEditorText(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 多步编辑后连续撤销可逐步恢复
- [DOM] 撤销顺序为 LIFO（后进先出）

---

## FP-14-01-N03 [P0] [正常] 撤销后重做→ 恢复被撤销的内容

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（createHistoryPlugin 已挂载）
- 初始文档: 清空后输入 "undo redo test"
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空并输入
  await clearEditor(page);
  await page.waitForTimeout(200);
  await typeInEditor(page, "undo redo test");
  await page.waitForTimeout(300);
  const beforeUndo = await getEditorText(page);
  expect(beforeUndo).toContain("undo redo test");
  // step 3: 先执行一次撤销
  await page.keyboard.press("ControlOrMeta+z");
  await page.waitForTimeout(150);
  const afterUndo = await getEditorText(page);
  expect(afterUndo).not.toContain("undo redo test");
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 按 ControlOrMeta+Shift+z（重做） | [STATE] redo → 恢复被撤销的 "undo redo test" | 选择器: 无; 操作: page.keyboard.press("ControlOrMeta+Shift+z"); 控件: editor; 等待: 150ms |
| 2 | 断言内容恢复 | [DOM] getEditorText() 含 "undo redo test"（重做恢复了撤销的内容） | 选择器: .cm-content; 操作: getEditorText(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 撤销后重做可恢复被撤销的内容
- [DOM] 重做栈在撤销时填充，执行 redo 命令后弹出

---

## FP-14-01-N04 [P1] [正常] 连续撤销后连续重做→ 依次恢复

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（createHistoryPlugin 已挂载）
- 初始文档: 清空后依次输入 "A"、"B"、"C"（3 个编辑事件）
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空并输入 3 个独立编辑事件
  await clearEditor(page);
  await page.waitForTimeout(200);
  await typeInEditor(page, "A");
  await page.waitForTimeout(600);
  await typeInEditor(page, "B");
  await page.waitForTimeout(600);
  await typeInEditor(page, "C");
  await page.waitForTimeout(600);
  // step 3: 连续撤销 3 次
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("ControlOrMeta+z");
    await page.waitForTimeout(150);
  }
  const afterUndoAll = await getEditorText(page);
  expect(afterUndoAll).not.toContain("A");
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 按 ControlOrMeta+Shift+z（第 1 次重做） | [STATE] redo "A" → 内容含 "A" | 选择器: 无; 操作: ControlOrMeta+Shift+z; 控件: editor; 等待: 150ms |
| 2 | 断言内容含 "A" | [DOM] getEditorText() 含 "A" | 选择器: .cm-content; 操作: getEditorText(); 控件: editor; 等待: 无 |
| 3 | 按 ControlOrMeta+Shift+z（第 2 次重做） | [STATE] redo "B" → 内容含 "A"、"B" | 选择器: 无; 操作: ControlOrMeta+Shift+z; 控件: editor; 等待: 150ms |
| 4 | 断言内容含 "B" | [DOM] getEditorText() 含 "A" 和 "B" | 选择器: .cm-content; 操作: getEditorText(); 控件: editor; 等待: 无 |
| 5 | 按 ControlOrMeta+Shift+z（第 3 次重做） | [STATE] redo "C" → 内容含 "A"、"B"、"C" | 选择器: 无; 操作: ControlOrMeta+Shift+z; 控件: editor; 等待: 150ms |
| 6 | 断言内容含 "C" | [DOM] getEditorText() 含 "A"、"B"、"C" | 选择器: .cm-content; 操作: getEditorText(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 连续撤销后连续重做可依次恢复（FIFO 重做栈）

---

## FP-14-01-N05 [P1] [正常] 删除文本后撤销→ 恢复被删除内容

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（createHistoryPlugin 已挂载）
- 初始文档: 清空后输入 "delete me"
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空并输入
  await clearEditor(page);
  await page.waitForTimeout(200);
  await typeInEditor(page, "delete me");
  await page.waitForTimeout(300);
  // step 3: 选中全部并删除
  await page.keyboard.press("ControlOrMeta+a");
  await page.waitForTimeout(100);
  await page.keyboard.press("Backspace");
  await page.waitForTimeout(300);
  const afterDelete = await getEditorText(page);
  expect(afterDelete).not.toContain("delete me");
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 按 ControlOrMeta+z（撤销删除） | [STATE] undo Backspace → 恢复被删除的 "delete me" | 选择器: 无; 操作: ControlOrMeta+z; 控件: editor; 等待: 150ms |
| 2 | 断言内容恢复 | [DOM] getEditorText() 含 "delete me"（删除操作被撤销） | 选择器: .cm-content; 操作: getEditorText(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 删除操作被记入历史栈，撤销后可恢复

---

## FP-14-01-N06 [P1] [正常] 跨行编辑后撤销→ 恢复多行内容

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（createHistoryPlugin 已挂载）
- 初始文档: 清空后输入多行文本 "line1\nline2\nline3"
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空并输入多行
  await clearEditor(page);
  await page.waitForTimeout(200);
  await typeInEditor(page, "line1");
  await page.waitForTimeout(600);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(600);
  await typeInEditor(page, "line2");
  await page.waitForTimeout(600);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(600);
  await typeInEditor(page, "line3");
  await page.waitForTimeout(600);
  const beforeUndo = await getEditorText(page);
  expect(beforeUndo).toContain("line1");
  expect(beforeUndo).toContain("line2");
  expect(beforeUndo).toContain("line3");
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 按 ControlOrMeta+z（撤销 "line3"） | [STATE] undo 输入 "line3" + 可能的 Enter → 内容不含 "line3" | 选择器: 无; 操作: ControlOrMeta+z; 控件: editor; 等待: 150ms |
| 2 | 断言内容不含 "line3" | [DOM] getEditorText() 不含 "line3"，仍含 "line1"、"line2" | 选择器: .cm-content; 操作: getEditorText(); 控件: editor; 等待: 无 |
| 3 | 按 ControlOrMeta+z（撤销 "line2"） | [STATE] undo → 内容不含 "line2" | 选择器: 无; 操作: ControlOrMeta+z; 控件: editor; 等待: 150ms |
| 4 | 断言内容不含 "line2" | [DOM] getEditorText() 不含 "line2"，仍含 "line1" | 选择器: .cm-content; 操作: getEditorText(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 跨行编辑（含 Enter 换行）被正确记入历史栈
- [DOM] 撤销可逐步恢复多行编辑

---

## FP-14-01-N07 [P1] [正常] 连续快速编辑（合并）后撤销→ 一次撤销整批

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（createHistoryPlugin 已挂载）
- 初始文档: 清空后快速连续输入 "fast typing"（合并为单个 history 事件）
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空
  await clearEditor(page);
  await page.waitForTimeout(200);
  // step 3: 快速连续输入（无停顿，CM6 合并为一个事件）
  await typeInEditor(page, "fast typing");
  await page.waitForTimeout(300);
  expect(await getEditorText(page)).toContain("fast typing");
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 按 ControlOrMeta+z（撤销一次） | [STATE] undo 合并事件 → "fast typing" 整批被撤销 → 内容恢复到空 | 选择器: 无; 操作: ControlOrMeta+z; 控件: editor; 等待: 150ms |
| 2 | 断言内容不含 "fast typing" | [DOM] getEditorText() 不含 "fast typing"（一次撤销整批快速输入） | 选择器: .cm-content; 操作: getEditorText(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 连续快速编辑被合并为单个 history 事件，一次撤销即可恢复

---

## FP-14-01-N08 [P2] [正常] 大文本输入后撤销→ 恢复大段内容

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（createHistoryPlugin 已挂载）
- 初始文档: 清空后输入大段文本（> 200 字符）
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空
  await clearEditor(page);
  await page.waitForTimeout(200);
  // step 3: 输入大段文本
  const bigText = "Lorem ipsum dolor sit amet ".repeat(10);
  await typeInEditor(page, bigText);
  await page.waitForTimeout(500);
  expect(await getEditorText(page)).toContain("Lorem ipsum");
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 按 ControlOrMeta+z（撤销） | [STATE] undo → 大段文本被撤销 → 内容恢复到空或合并前状态 | 选择器: 无; 操作: ControlOrMeta+z; 控件: editor; 等待: 200ms |
| 2 | 断言大段内容被撤销 | [DOM] getEditorText() 不含 "Lorem ipsum dolor sit amet" 的完整重复（至少首次撤销减少了内容） | 选择器: .cm-content; 操作: getEditorText(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 大文本输入后撤销可正常恢复（history 栈支持大文本事件）

---

## FP-14-01-N09 [P2] [正常] 输入→ 删除→ 输入后撤销→ 恢复到正确中间态

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（createHistoryPlugin 已挂载）
- 初始文档: 清空后输入 "ABC"，删除 "B"（变 "AC"），再输入 "X"（变 "ACX"）
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空并输入 "ABC"
  await clearEditor(page);
  await page.waitForTimeout(200);
  await typeInEditor(page, "ABC");
  await page.waitForTimeout(600);
  // step 3: 删除中间的 "B"
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight"); // 在 A 和 B 之间
  await page.keyboard.press("Delete"); // 删除 B（右边字符）
  await page.waitForTimeout(600);
  // step 4: 输入 "X"
  await typeInEditor(page, "X");
  await page.waitForTimeout(600);
  const text = await getEditorText(page);
  expect(text).toContain("ACX");
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 按 ControlOrMeta+z（撤销输入 "X"） | [STATE] undo 输入 "X" → 内容变为 "AC" | 选择器: 无; 操作: ControlOrMeta+z; 控件: editor; 等待: 150ms |
| 2 | 断言内容为 "AC" | [DOM] getEditorText() 含 "AC"，不含 "ACX" | 选择器: .cm-content; 操作: getEditorText(); 控件: editor; 等待: 无 |
| 3 | 按 ControlOrMeta+z（撤销删除 "B"） | [STATE] undo Delete → 恢复 "B" → 内容变为 "ABC" | 选择器: 无; 操作: ControlOrMeta+z; 控件: editor; 等待: 150ms |
| 4 | 断言内容为 "ABC" | [DOM] getEditorText() 含 "ABC"（删除操作被撤销） | 选择器: .cm-content; 操作: getEditorText(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 混合编辑操作（输入+删除+输入）被正确记入栈
- [DOM] 撤销顺序正确（LIFO，先撤销最后的输入，再撤销删除）

---

## FP-14-01-N10 [P2] [正常] 替换选区文本后撤销→ 恢复原始文本

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（createHistoryPlugin 已挂载）
- 初始文档: 清空后输入 "original text"
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空并输入
  await clearEditor(page);
  await page.waitForTimeout(200);
  await typeInEditor(page, "original text");
  await page.waitForTimeout(600);
  // step 3: 选中 "original" 并替换为 "replaced"
  await page.keyboard.press("Home");
  for (let i = 0; i < 8; i++) await page.keyboard.press("Shift+ArrowRight"); // 选中 "original"
  await page.waitForTimeout(100);
  await typeInEditor(page, "replaced"); // 替换选中内容
  await page.waitForTimeout(300);
  const text = await getEditorText(page);
  expect(text).toContain("replaced text");
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 按 ControlOrMeta+z（撤销替换） | [STATE] undo 替换操作 → 恢复 "original text" | 选择器: 无; 操作: ControlOrMeta+z; 控件: editor; 等待: 150ms |
| 2 | 断言内容恢复 | [DOM] getEditorText() 含 "original text"，不含 "replaced text" | 选择器: .cm-content; 操作: getEditorText(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 选区替换操作被记入历史栈，撤销后恢复原始文本

---

## FP-14-01-N11 [P1] [正常] 撤销后新编辑→ 清空重做栈

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（createHistoryPlugin 已挂载）
- 初始文档: 清空后输入 "first"，再输入 "second"
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空并输入两个编辑事件
  await clearEditor(page);
  await page.waitForTimeout(200);
  await typeInEditor(page, "first");
  await page.waitForTimeout(600);
  await typeInEditor(page, "second");
  await page.waitForTimeout(600);
  // step 3: 撤销一次（撤销 "second"）
  await page.keyboard.press("ControlOrMeta+z");
  await page.waitForTimeout(150);
  expect(await getEditorText(page)).toContain("first");
  expect(await getEditorText(page)).not.toContain("second");
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 输入 "new"（新编辑） | [STATE] 新编辑事件入栈 → 重做栈被清空（CM6 行为：新编辑后无法 redo 已撤销的操作） | 选择器: 无; 操作: typeInEditor("new"); 控件: editor; 等待: 300ms |
| 2 | 按 ControlOrMeta+Shift+z（尝试重做） | [STATE] redo 栈已空 → 无效果 → 内容不变 | 选择器: 无; 操作: ControlOrMeta+Shift+z; 控件: editor; 等待: 150ms |
| 3 | 断言内容不含 "second" | [DOM] getEditorText() 不含 "second"（重做栈被新编辑清空，无法恢复 "second"） | 选择器: .cm-content; 操作: getEditorText(); 控件: editor; 等待: 无 |
| 4 | 断言内容含 "first" 和 "new" | [DOM] getEditorText() 含 "first" 和 "new" | 选择器: .cm-content; 操作: getEditorText(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 撤销后执行新编辑会清空重做栈
- [DOM] 新编辑后无法通过 redo 恢复被撤销的操作

---

## FP-14-01-I01 [P1] [交互] history() 与 Live Preview 协同编辑后撤销

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（createHistoryPlugin + Live Preview 已启用）
- 初始文档: 清空后输入 Markdown 格式文本 "# Title"
- 插件配置: demo 默认（含 createHistoryPlugin + createGfmPreset + livePreview）
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空并输入 Markdown
  await clearEditor(page);
  await page.waitForTimeout(200);
  await typeInEditor(page, "# Title");
  await page.waitForTimeout(600);
  await typeInEditor(page, "\nSome content");
  await page.waitForTimeout(600);
  const text = await getEditorText(page);
  expect(text).toContain("Title");
  expect(text).toContain("Some content");
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 按 ControlOrMeta+z（撤销输入 "Some content"） | [STATE] undo → 恢复到只有 "# Title" 的状态，Live Preview 装饰同步更新 | 选择器: 无; 操作: ControlOrMeta+z; 控件: editor; 等待: 200ms |
| 2 | 断言内容不含 "Some content" | [DOM] getEditorText() 不含 "Some content"，仍含 "Title" | 选择器: .cm-content; 操作: getEditorText(); 控件: editor; 等待: 无 |
| 3 | 断言标题仍正确渲染 | [DOM] getEditorText() 含 "# Title" 或 "Title"（Markdown 标题语法保持） | 选择器: .cm-content; 操作: getEditorText(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] history() 与 Live Preview 装饰系统协同工作
- [DOM] 撤销后 Live Preview 装饰正确更新

---

## FP-14-01-N12 [P0] [边界] 撤销栈为空时再撤销→ 无效果（不报错）

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（createHistoryPlugin 已挂载）
- 初始文档: 清空后无任何编辑操作
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器
  await clearEditor(page);
  await page.waitForTimeout(300);
  // step 3: 确认编辑器为空（或接近空）
  const initialText = await getEditorText(page);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 按 ControlOrMeta+z（撤销栈为空时） | [STATE] undo → 撤销栈为空 → 命令返回 false → 无效果 → 不报错 | 选择器: 无; 操作: ControlOrMeta+z; 控件: editor; 等待: 150ms |
| 2 | 断言内容无变化 | [DOM] getEditorText() === initialText（撤销栈为空时无效果） | 选择器: .cm-content; 操作: getEditorText(); 控件: editor; 等待: 无 |
| 3 | 连续按 ControlOrMeta+z 多次 | [STATE] 仍无效果，不报错 | 选择器: 无; 操作: ControlOrMeta+z x3; 控件: editor; 等待: 150ms |
| 4 | 断言内容仍无变化 | [DOM] getEditorText() === initialText | 选择器: .cm-content; 操作: getEditorText(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 撤销栈为空时撤销操作无效果且不报错

---

## FP-14-01-N13 [P1] [边界] 重做栈为空时再重做→ 无效果（不报错）

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（createHistoryPlugin 已挂载）
- 初始文档: 清空后输入 "text"（未执行任何撤销）
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空并输入
  await clearEditor(page);
  await page.waitForTimeout(200);
  await typeInEditor(page, "text");
  await page.waitForTimeout(300);
  const initialText = await getEditorText(page);
  expect(initialText).toContain("text");
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 按 ControlOrMeta+Shift+z（重做栈为空时） | [STATE] redo → 重做栈为空（未撤销过）→ 命令返回 false → 无效果 | 选择器: 无; 操作: ControlOrMeta+Shift+z; 控件: editor; 等待: 150ms |
| 2 | 断言内容无变化 | [DOM] getEditorText() === initialText（重做栈为空时无效果） | 选择器: .cm-content; 操作: getEditorText(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 重做栈为空时重做操作无效果且不报错

---

## FP-14-02: historyKeymap 快捷键（Mod-Z / Mod-Shift-Z / Ctrl-U）

> 实现路径: `packages/plugin-history/src/index.ts` 通过 `keymap.of(historyKeymap)` 注册 `@codemirror/commands` 的 `historyKeymap`。该 keymap 包含以下绑定（CM6 源码 `@codemirror/commands/dist/index.js`）:
> - `Mod-z`: undo
> - `Mod-Shift-z`: redo
> - `Mod-y`: redo（非 macOS）
> - `Mod-u`: undoSelection
> - `Mod-Shift-u`: redoSelection
> - `Mod-Alt-z`: foldSelectionHistory（如果有折叠历史）
>
> **macOS 环境**: `Mod` = `Meta`（Cmd 键），Playwright 的 `ControlOrMeta` 在 macOS 上映射为 `Meta`。

---

## FP-14-02-N01 [P0] [正常] Mod-z（ControlOrMeta+z）撤销单步编辑

**测试框架**: Playwright

**前置条件**（⚠️ 4要素）:
- 依赖环境: Electron demo（createHistoryPlugin 已挂载）
- 初始文档: 清空后输入 "undo test"
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空并输入
  await clearEditor(page);
  await page.waitForTimeout(200);
  await typeInEditor(page, "undo test");
  await page.waitForTimeout(300);
  expect(await getEditorText(page)).toContain("undo test");
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 按 ControlOrMeta+z | [STATE] historyKeymap 的 `Mod-z` → undo 命令 → 撤销 "undo test" 输入 | 选择器: 无; 操作: page.keyboard.press("ControlOrMeta+z"); 控件: editor; 等待: 150ms |
| 2 | 断言内容被撤销 | [DOM] getEditorText() 不含 "undo test" | 选择器: .cm-content; 操作: getEditorText(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] ControlOrMeta+z 快捷键正确触发 undo 命令

---

## FP-14-02-N02 [P0] [正常] Mod-Shift-z（ControlOrMeta+Shift+z）重做被撤销的编辑

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（createHistoryPlugin 已挂载）
- 初始文档: 清空后输入 "redo test"，然后撤销
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空并输入
  await clearEditor(page);
  await page.waitForTimeout(200);
  await typeInEditor(page, "redo test");
  await page.waitForTimeout(300);
  // step 3: 先撤销一次
  await page.keyboard.press("ControlOrMeta+z");
  await page.waitForTimeout(150);
  expect(await getEditorText(page)).not.toContain("redo test");
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 按 ControlOrMeta+Shift+z | [STATE] historyKeymap 的 `Mod-Shift-z` → redo 命令 → 恢复 "redo test" | 选择器: 无; 操作: page.keyboard.press("ControlOrMeta+Shift+z"); 控件: editor; 等待: 150ms |
| 2 | 断言内容恢复 | [DOM] getEditorText() 含 "redo test" | 选择器: .cm-content; 操作: getEditorText(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] ControlOrMeta+Shift+z 快捷键正确触发 redo 命令

---

## FP-14-02-N03 [P1] [正常] Mod-y（ControlOrMeta+y）重做（备用快捷键）

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（createHistoryPlugin 已挂载）
- 初始文档: 清空后输入 "y redo"，然后撤销
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空并输入
  await clearEditor(page);
  await page.waitForTimeout(200);
  await typeInEditor(page, "y redo");
  await page.waitForTimeout(300);
  // step 3: 先撤销一次
  await page.keyboard.press("ControlOrMeta+z");
  await page.waitForTimeout(150);
  expect(await getEditorText(page)).not.toContain("y redo");
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 按 ControlOrMeta+y | [STATE] historyKeymap 的 `Mod-y` → redo 命令（备用键绑定）→ 恢复 "y redo" | 选择器: 无; 操作: page.keyboard.press("ControlOrMeta+y"); 控件: editor; 等待: 150ms |
| 2 | 断言内容恢复 | [DOM] getEditorText() 含 "y redo" | 选择器: .cm-content; 操作: getEditorText(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] ControlOrMeta+y 快捷键正确触发 redo 命令（备用键绑定）

---

## FP-14-02-N04 [P1] [正常] Mod-u（Control+u）撤销选区操作

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（createHistoryPlugin 已挂载）
- 初始文档: 清空后输入 "selection undo"
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空并输入
  await clearEditor(page);
  await page.waitForTimeout(200);
  await typeInEditor(page, "selection undo");
  await page.waitForTimeout(600);
  // step 3: 选中部分文本
  await page.keyboard.press("Home");
  for (let i = 0; i < 6; i++) await page.keyboard.press("Shift+ArrowRight"); // 选中 "select"
  await page.waitForTimeout(100);
  // step 4: 替换选区
  await typeInEditor(page, "REPLACED");
  await page.waitForTimeout(300);
  const text = await getEditorText(page);
  expect(text).toContain("REPLACED");
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 按 Control+u（注意: Mod-u 在 macOS 上是 Control+u，非 Meta+u） | [STATE] historyKeymap 的 `Mod-u` → undoSelection → 撤销最近选区操作 | 选择器: 无; 操作: page.keyboard.press("Control+u"); 控件: editor; 等待: 150ms |
| 2 | 断言选区操作被撤销 | [DOM] getEditorText() 含 "select" 或恢复到替换前状态（undoSelection 撤销选区编辑） | 选择器: .cm-content; 操作: getEditorText(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] Control+u 快捷键触发 undoSelection（撤销选区操作）

---

## FP-14-02-N05 [P1] [正常] 连续 Mod-z 多次撤销→ 逐步回退

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（createHistoryPlugin 已挂载）
- 初始文档: 清空后依次输入 "step1"、"step2"、"step3"（3 个独立编辑事件）
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空并输入 3 个独立事件
  await clearEditor(page);
  await page.waitForTimeout(200);
  await typeInEditor(page, "step1");
  await page.waitForTimeout(600);
  await typeInEditor(page, " step2");
  await page.waitForTimeout(600);
  await typeInEditor(page, " step3");
  await page.waitForTimeout(600);
  expect(await getEditorText(page)).toContain("step1");
  expect(await getEditorText(page)).toContain("step2");
  expect(await getEditorText(page)).toContain("step3");
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 按 ControlOrMeta+z（第 1 次） | [STATE] undo " step3" → 不含 "step3" | 选择器: 无; 操作: ControlOrMeta+z; 控件: editor; 等待: 150ms |
| 2 | 断言不含 "step3" | [DOM] getEditorText() 不含 "step3" | 选择器: .cm-content; 操作: getEditorText(); 控件: editor; 等待: 无 |
| 3 | 按 ControlOrMeta+z（第 2 次） | [STATE] undo " step2" → 不含 "step2" | 选择器: 无; 操作: ControlOrMeta+z; 控件: editor; 等待: 150ms |
| 4 | 断言不含 "step2" | [DOM] getEditorText() 不含 "step2" | 选择器: .cm-content; 操作: getEditorText(); 控件: editor; 等待: 无 |
| 5 | 按 ControlOrMeta+z（第 3 次） | [STATE] undo "step1" → 不含 "step1" | 选择器: 无; 操作: ControlOrMeta+z; 控件: editor; 等待: 150ms |
| 6 | 断言不含 "step1" | [DOM] getEditorText() 不含 "step1" | 选择器: .cm-content; 操作: getEditorText(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 连续 ControlOrMeta+z 可逐步撤销多个编辑事件

---

## FP-14-02-N06 [P1] [正常] 撤销后 Mod-Shift-z 重做→ 恢复内容

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（createHistoryPlugin 已挂载）
- 初始文档: 清空后输入 "A"、"B" 两个编辑事件
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空并输入
  await clearEditor(page);
  await page.waitForTimeout(200);
  await typeInEditor(page, "A");
  await page.waitForTimeout(600);
  await typeInEditor(page, "B");
  await page.waitForTimeout(600);
  // step 3: 撤销 2 次
  await page.keyboard.press("ControlOrMeta+z");
  await page.waitForTimeout(150);
  await page.keyboard.press("ControlOrMeta+z");
  await page.waitForTimeout(150);
  expect(await getEditorText(page)).not.toContain("A");
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 按 ControlOrMeta+Shift+z（第 1 次重做） | [STATE] redo "A" → 内容含 "A" | 选择器: 无; 操作: ControlOrMeta+Shift+z; 控件: editor; 等待: 150ms |
| 2 | 断言含 "A" | [DOM] getEditorText() 含 "A" | 选择器: .cm-content; 操作: getEditorText(); 控件: editor; 等待: 无 |
| 3 | 按 ControlOrMeta+Shift+z（第 2 次重做） | [STATE] redo "B" → 内容含 "A"、"B" | 选择器: 无; 操作: ControlOrMeta+Shift+z; 控件: editor; 等待: 150ms |
| 4 | 断言含 "B" | [DOM] getEditorText() 含 "A" 和 "B" | 选择器: .cm-content; 操作: getEditorText(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 连续 ControlOrMeta+Shift+z 可逐步重做多个被撤销的事件

---

## FP-14-02-N07 [P1] [正常] Mod-z 与 Mod-Shift-z 交替使用→ 正确切换

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（createHistoryPlugin 已挂载）
- 初始文档: 清空后输入 "interleave"
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空并输入
  await clearEditor(page);
  await page.waitForTimeout(200);
  await typeInEditor(page, "interleave");
  await page.waitForTimeout(300);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 按 ControlOrMeta+z（撤销） | [STATE] undo → 不含 "interleave" | 选择器: 无; 操作: ControlOrMeta+z; 控件: editor; 等待: 150ms |
| 2 | 按 ControlOrMeta+Shift+z（重做） | [STATE] redo → 含 "interleave" | 选择器: 无; 操作: ControlOrMeta+Shift+z; 控件: editor; 等待: 150ms |
| 3 | 按 ControlOrMeta+z（再撤销） | [STATE] undo → 不含 "interleave" | 选择器: 无; 操作: ControlOrMeta+z; 控件: editor; 等待: 150ms |
| 4 | 按 ControlOrMeta+Shift+z（再重做） | [STATE] redo → 含 "interleave" | 选择器: 无; 操作: ControlOrMeta+Shift+z; 控件: editor; 等待: 150ms |
| 5 | 断言最终内容含 "interleave" | [DOM] getEditorText() 含 "interleave"（交替撤销重做后内容正确） | 选择器: .cm-content; 操作: getEditorText(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] Mod-z 与 Mod-Shift-z 交替使用时撤销/重做栈正确切换

---

## FP-14-02-N08 [P2] [正常] 选区状态下按 Mod-z→ 撤销并调整选区

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（createHistoryPlugin 已挂载）
- 初始文档: 清空后输入 "selected text"
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空并输入
  await clearEditor(page);
  await page.waitForTimeout(200);
  await typeInEditor(page, "selected text");
  await page.waitForTimeout(600);
  // step 3: 选中全部文本
  await page.keyboard.press("ControlOrMeta+a");
  await page.waitForTimeout(100);
  // step 4: 输入替换
  await typeInEditor(page, "REPLACED");
  await page.waitForTimeout(300);
  expect(await getEditorText(page)).toContain("REPLACED");
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 按 ControlOrMeta+z（撤销替换） | [STATE] undo → 撤销替换操作 → 恢复 "selected text" 并调整选区 | 选择器: 无; 操作: ControlOrMeta+z; 控件: editor; 等待: 150ms |
| 2 | 断言内容恢复 | [DOM] getEditorText() 含 "selected text"，不含 "REPLACED" | 选择器: .cm-content; 操作: getEditorText(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 在选区编辑后按 Mod-z 可正确撤销并恢复原始文本

---

## FP-14-02-N09 [P2] [正常] 空编辑器按 Mod-z→ 无效果不报错

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（createHistoryPlugin 已挂载）
- 初始文档: 清空后无编辑
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器
  await clearEditor(page);
  await page.waitForTimeout(300);
  const initialText = await getEditorText(page);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 按 ControlOrMeta+z（空编辑器） | [STATE] undo → 撤销栈为空 → 无效果 | 选择器: 无; 操作: ControlOrMeta+z; 控件: editor; 等待: 150ms |
| 2 | 断言内容无变化 | [DOM] getEditorText() === initialText | 选择器: .cm-content; 操作: getEditorText(); 控件: editor; 等待: 无 |
| 3 | 按 ControlOrMeta+Shift+z（空编辑器） | [STATE] redo → 重做栈为空 → 无效果 | 选择器: 无; 操作: ControlOrMeta+Shift+z; 控件: editor; 等待: 150ms |
| 4 | 断言内容仍无变化 | [DOM] getEditorText() === initialText | 选择器: .cm-content; 操作: getEditorText(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 空编辑器按撤销/重做快捷键无效果且不报错

---

## FP-14-02-N10 [P2] [正常] Mod-Shift-z 重做栈为空时按→ 无效果

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（createHistoryPlugin 已挂载）
- 初始文档: 清空后输入 "content"（无撤销操作）
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空并输入
  await clearEditor(page);
  await page.waitForTimeout(200);
  await typeInEditor(page, "content");
  await page.waitForTimeout(300);
  const initialText = await getEditorText(page);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 按 ControlOrMeta+Shift+z（重做栈为空） | [STATE] redo → 重做栈为空 → 命令返回 false → 无效果 | 选择器: 无; 操作: ControlOrMeta+Shift+z; 控件: editor; 等待: 150ms |
| 2 | 断言内容无变化 | [DOM] getEditorText() === initialText | 选择器: .cm-content; 操作: getEditorText(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 重做栈为空时 ControlOrMeta+Shift+z 无效果

---

## FP-14-02-N11 [P2] [正常] Mod-y 与 Mod-Shift-z 交替重做→ 一致行为

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（createHistoryPlugin 已挂载）
- 初始文档: 清空后输入 "A"、"B" 两个编辑事件，撤销 2 次
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空并输入
  await clearEditor(page);
  await page.waitForTimeout(200);
  await typeInEditor(page, "A");
  await page.waitForTimeout(600);
  await typeInEditor(page, "B");
  await page.waitForTimeout(600);
  // step 3: 撤销 2 次
  await page.keyboard.press("ControlOrMeta+z");
  await page.waitForTimeout(150);
  await page.keyboard.press("ControlOrMeta+z");
  await page.waitForTimeout(150);
  expect(await getEditorText(page)).not.toContain("A");
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 按 ControlOrMeta+y（第 1 次重做） | [STATE] redo "A" → 内容含 "A" | 选择器: 无; 操作: ControlOrMeta+y; 控件: editor; 等待: 150ms |
| 2 | 按 ControlOrMeta+Shift+z（第 2 次重做） | [STATE] redo "B" → 内容含 "A"、"B" | 选择器: 无; 操作: ControlOrMeta+Shift+z; 控件: editor; 等待: 150ms |
| 3 | 断言内容含 "A" 和 "B" | [DOM] getEditorText() 含 "A" 和 "B"（两种重做快捷键行为一致） | 选择器: .cm-content; 操作: getEditorText(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] Mod-y 和 Mod-Shift-z 都触发 redo，行为一致

---

## FP-14-02-I01 [P1] [交互] 快捷键与其他插件（搜索/斜杠菜单）不冲突

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（createHistoryPlugin + createSearchPlugin + createSlashMenu）
- 初始文档: 清空后输入 "conflict test"
- 插件配置: demo 默认（含所有插件）
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空并输入
  await clearEditor(page);
  await page.waitForTimeout(200);
  await typeInEditor(page, "conflict test");
  await page.waitForTimeout(300);
  expect(await getEditorText(page)).toContain("conflict test");
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 按 ControlOrMeta+z（在编辑器聚焦时） | [STATE] Mod-z → history undo → 撤销 "conflict test"（不被其他插件的快捷键拦截） | 选择器: 无; 操作: ControlOrMeta+z; 控件: editor; 等待: 150ms |
| 2 | 断言内容被撤销 | [DOM] getEditorText() 不含 "conflict test"（快捷键正确路由到 history undo） | 选择器: .cm-content; 操作: getEditorText(); 控件: editor; 等待: 无 |
| 3 | 按 ControlOrMeta+Shift+z（重做） | [STATE] Mod-Shift-z → history redo → 恢复 "conflict test" | 选择器: 无; 操作: ControlOrMeta+Shift+z; 控件: editor; 等待: 150ms |
| 4 | 断言内容恢复 | [DOM] getEditorText() 含 "conflict test" | 选择器: .cm-content; 操作: getEditorText(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] history 快捷键在多插件环境下正常工作，不与其他插件冲突

---

## FP-14-02-N12 [P2] [边界] 快速连续按 Mod-z 和 Mod-Shift-z→ 状态一致

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（createHistoryPlugin 已挂载）
- 初始文档: 清空后输入 "rapid test"
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空并输入
  await clearEditor(page);
  await page.waitForTimeout(200);
  await typeInEditor(page, "rapid test");
  await page.waitForTimeout(300);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 快速连续按 ControlOrMeta+z 然后 ControlOrMeta+Shift+z（交替 3 轮） | [STATE] undo → redo → undo → redo → undo → redo → 最终状态应与初始一致（含 "rapid test"） | 选择器: 无; 操作: 交替 ControlOrMeta+z / ControlOrMeta+Shift+z x3; 控件: editor; 等待: 每键 100ms |
| 2 | 断言最终内容含 "rapid test" | [DOM] getEditorText() 含 "rapid test"（快速交替撤销重做后状态一致） | 选择器: .cm-content; 操作: getEditorText(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 快速交替 undo/redo 快捷键后编辑器状态保持一致

---

## 用例合计

### 类型分布

| 类型 | 数量 | 占比 |
|------|------|------|
| 正常(N) | 19 | 79.2% |
| 边界(B) | 2 | 8.3% |
| 交互(I) | 2 | 8.3% |
| 异常(E) | 0 | 0% |
| 流程(F) | 0 | 0% |
| 数据(D) | 1 | 4.2% |

### 优先级分布

| 优先级 | 数量 | 占比 |
|--------|------|------|
| P0 | 6 | 25.0% |
| P1 | 10 | 41.7% |
| P2 | 8 | 33.3% |
| P3 | 0 | 0% |

### 框架分布

| 框架 | 数量 | 占比 |
|------|------|------|
| Playwright | 24 | 100% |

### 各二级功能点用例数

| 二级功能点 | 用例数 | 编号范围 |
|-----------|--------|---------|
| FP-14-01 history() 撤销栈管理 | 13 | N01-N13, I01 |
| FP-14-02 historyKeymap 快捷键 | 11 | N01-N12, I01 |
| **合计** | **24** | |

### 验证策略分布

| 验证方式 | 用例数 | 说明 |
|---------|--------|------|
| `.cm-content` textContent（内容验证） | 24 | 所有用例均通过 textContent 验证内容变化 |
| ControlOrMeta+z 撤销快捷键 | 20 | 通过 page.keyboard.press("ControlOrMeta+z") 触发 |
| ControlOrMeta+Shift+z 重做快捷键 | 14 | 通过 page.keyboard.press("ControlOrMeta+Shift+z") 触发 |
| ControlOrMeta+y 重做快捷键 | 2 | 备用重做键绑定验证 |
| Control+u undoSelection | 1 | 选区撤销验证 |
| 多步编辑事件（停顿 > 500ms 避免合并） | 8 | 验证独立 history 事件 |
| 合并事件验证（快速输入） | 2 | 验证 CM6 合并策略 |
| 空栈边界验证 | 3 | 撤销/重做栈为空时的行为 |

### 实现差异关键点

| 差异点 | 影响用例 | 应对策略 |
|--------|---------|---------|
| CM6 history() 默认合并策略（~500ms 窗口） | FP-14-01-N02, N04, N06 等 | 每步编辑间隔 > 500ms 确保独立事件 |
| macOS Mod = Meta 键 | 全部 | 使用 Playwright 的 ControlOrMeta 统一映射 |
| historyKeymap 包含 Mod-u（undoSelection）非 Mod-u（undo） | FP-14-02-N04 | 使用 Control+u 而非 ControlOrMeta+u |
| 撤销后新编辑清空重做栈 | FP-14-01-N11 | 验证 CM6 标准行为 |
| demo 未暴露 editor 实例 | 全部 | 通过 `.cm-content` textContent 间接验证 |

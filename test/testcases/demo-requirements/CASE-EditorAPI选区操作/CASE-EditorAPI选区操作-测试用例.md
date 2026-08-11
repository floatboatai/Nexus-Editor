# CASE-EditorAPI选区操作-测试用例（FP-04）

> 一级功能点: EditorAPI 选区操作（demo-requirements.md §3.2）
> 全局批次序号: 04
> 生成时间: 2026-08-11
> 测试框架: Playwright（Electron demo / Vite dev server + Electron main）
>
> 涉及二级功能点:
> - FP-04-01 getSelection() 获取主选区（[API契约][编辑交互]）
> - FP-04-02 getSelections() 获取所有选区（[API契约][编辑交互]）
> - FP-04-03 getSelectedText() 获取选中文本（[API契约][编辑交互]）
> - FP-04-04 setSelection(anchor, head) 设置选区（[API契约][编辑交互]）
> - FP-04-05 setSelections(ranges, mainIndex) 设置多选区（[API契约][编辑交互]）
>
> ⚠️ 实现差异提示（依据 `packages/core/src/editor.ts:748-804` + `packages/plugin-wordcount/src/*` + `apps/electron-demo/src/renderer/*` 实际代码）:
> - **Demo 未将 editor 实例暴露到 `window`**：5 个选区 API 都不能在 e2e 中直接调用，必须通过 demo UI 的可观察副作用间接验证。
> - **核心间接验证通道 — WordCount 插件的 selection span**：`packages/plugin-wordcount/src/plugin.ts:150-165` 的 `computeSelection()` 调用 `editor.getSelection()` 拿到 `{anchor, head}`，再 `editor.getDocument().slice(from, to)` 喂给 `countMarkdown`，结果通过 `packages/plugin-wordcount/src/status-bar.ts:101-107` 的 `.nexus-wordcount__selection` span 渲染。该 span 默认 `hidden=true`（`status-bar.ts:105-106`），仅当 `state.isSelectionActive===true` 时显示（`status-bar.ts:115-118`），文本格式为 `"Selected: N words · N chars"`（`status-bar.ts:166`，labels.selection="Selected"）。这覆盖 FP-04-01（getSelection 触发 selectionChange → recomputeSelection → UI 更新）与 FP-04-03（getSelectedText 的 slice 等价路径）。
> - **状态栏选择器**：根 `.nexus-wordcount__bar`（`data-test-id="nexus-wordcount-bar"`，`role="status"`，`status-bar.ts:87-91`），选区子 span `.nexus-wordcount__selection`（`data-test-id="nexus-wordcount-selection"`，`status-bar.ts:101-103`）。
> - **FP-04-02 多选区间接路径**：demo 启用 `multiCursor: true`（`editor-shell.ts:138`）。`getSelections()`（`editor.ts:752-757`）返回 `{ranges, mainIndex}`，wordcount 插件的 `computeSelection()` 仅读 `getSelection()` 主选区。多光标场景下可通过工具栏格式化按钮（对全部选区生效）或多个光标输入验证，但无法直接断言 `ranges.length`；必要时通过 `page.evaluate` 注入 `window.__nexusEditor` 钩子。
> - **FP-04-04 setSelection 直接 UI 路径**：`outline-panel.ts:104-107` 的标题条目点击 → `editor.setSelection(entry.from)`；`app.ts:285,296` 的 backlinks 跳转 → `shell.editor.setSelection(pos)`。这是 setSelection 在 demo 中的原生触发点，光标跳转可断言。
> - **FP-04-05 setSelections 间接路径**：demo UI 无直接多选区设置入口（多光标通过 Mod-d / Alt-click 走 CM6 原生）。验证策略：通过 Mod-d 触发 selectNextOccurrence（内部 dispatch EditorSelection.create → 等价 setSelections 路径），观察多光标渲染；或通过 `page.evaluate` 注入钩子。
> - **selectionChange 事件管线**：`editor.ts:621-632` 的 updateListener 在 `selectionSet` 时 emit `selectionChange` 事件，wordcount 插件订阅（`plugin.ts:199,242`）触发 `recomputeSelection()`（同步，无防抖，`plugin.ts:175-183`）。
> - **测试环境约定**：所有用例通过 `launchDemo()`（`test/e2e/helpers/electron-launcher.ts`）启动 Electron demo；`page.evaluate` 中通过 `document.execCommand("insertText", false, text)` 输入（与 `test/e2e/editor.spec.ts:13-16` 一致）；选区操作通过 `page.keyboard`（Shift+Arrow/ControlOrMeta+A/双击选词）；选区统计断言通过 `.nexus-wordcount__selection` span。

---

## e2e 全局前置条件

- 依赖环境: Electron demo（Vite dev server localhost:5173 + 已构建的 `apps/electron-demo/dist-electron/main.js`）
- 初始文档: demo 启动后默认打开的 sample-vault 文档（或 index.md）
- 插件配置: demo 默认挂载 —— createGfmPreset + createHistoryPlugin + createToolbarPlugin + createSearchPlugin + createWikilinksPlugin + createWordCountPlugin（multiCursor: true）
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

  // 取消选区（点击同一位置使光标塌缩为 caret，触发 selectionChange → recomputeSelection）
  async function collapseSelection(page: Page) {
    await page.keyboard.press("ArrowRight");
  }

  // 获取 wordcount 选区 span 的文本（FP-04 核心 UI 通道）
  // 默认 hidden=true，仅当 isSelectionActive 时显示 "Selected: N words · N chars"
  async function getSelectionStatus(page: Page): Promise<{ visible: boolean; text: string }> {
    const span = page.locator('[data-test-id="nexus-wordcount-selection"]');
    const visible = await span.isVisible().catch(() => false);
    const text = visible ? ((await span.textContent()) ?? "") : "";
    return { visible, text };
  }

  // 获取 wordcount 根状态栏文本（含 doc 与 selection 两部分）
  async function getWordcountBarText(page: Page): Promise<string> {
    return (await page.locator('[data-test-id="nexus-wordcount-bar"]').first().textContent()) ?? "";
  }

  // 获取 app.ts 渲染的 #status-line 文本（文档级统计，非选区）
  async function getStatusLineText(page: Page): Promise<string> {
    return (await page.locator("#status-line").first().textContent()) ?? "";
  }

  // 切换 Outline 面板可见性（app.ts:56-60 的 ☰ 按钮）
  async function toggleOutline(page: Page) {
    await page.locator('button[title="Toggle outline"]').click();
  }

  // 切换 Backlinks 面板可见性（app.ts: 🔗 按钮）
  async function toggleBacklinks(page: Page) {
    await page.locator('button[title="Toggle backlinks panel"]').click();
  }

  // 获取 Outline 面板中所有标题按钮（getTableOfContents 渲染位置 + setSelection 跳转入口）
  async function getOutlineEntries(page: Page): Promise<string[]> {
    const buttons = page.locator(".nexus-outline-panel button");
    const count = await buttons.count();
    const texts: string[] = [];
    for (let i = 0; i < count; i++) {
      const t = await buttons.nth(i).textContent();
      if (t) texts.push(t.trim());
    }
    return texts;
  }
  ```

---

# FP-04-01 getSelection() 获取主选区（6 例，[API契约][编辑交互]）

> 间接验证路径：`plugin.ts:150-165` 的 `computeSelection()` 调用 `editor.getSelection()` 拿 `{anchor, head}`。若 anchor === head（caret），返回 `{isActive:false}` → selection span 隐藏；若 anchor !== head（真选区），返回 `{isActive:true}` → selection span 显示并渲染 `"Selected: N words · N chars"`。这是 getSelection 工作与否的最直接 UI 副作用。

## FP-04-01-N01 [P1] [正常] 双击选词→ getSelection 返回非空范围→ wordcount selection span 显示

**测试框架**: Playwright

**前置条件**（⚠️ 4要素）:
- 依赖环境: Electron demo
- 初始文档: 含 "hello world" 文本
- 插件配置: demo 默认（含 wordcount 插件，statusBar.showSelection 默认 true）
- setup 代码:
  ```typescript
  // step 1: 全局 setup（见 e2e 全局前置条件 launchDemo）
  // step 2: 清空编辑器并输入文本
  await clearEditor(page);
  await typeInEditor(page, "hello world");
  await page.waitForTimeout(250);
  // step 3: 确认初始 selection span 隐藏（getSelection 返回 anchor===head）
  const initial = await getSelectionStatus(page);
  expect(initial.visible).toBe(false);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 双击 "hello" 单词 | [DOM] CM6 选中 "hello"（5 字符范围），`selectionChange` 事件触发（`editor.ts:624-632`），`plugin.ts:199` 的 onSelectionChange → `recomputeSelection()` 同步执行 | import: @playwright/test; API: page.locator(".cm-content").dblclick(); 框架: playwright; 等待: 100ms |
| 2 | 断言 wordcount selection span | [DOM] `.nexus-wordcount__selection` 可见，文本含 "Selected: 1 words"（computeSelection → getSelection 返回 {anchor:0, head:5} → slice → countMarkdown） | import: @playwright/test; API: getSelectionStatus(); 框架: playwright; 等待: 100ms |

**断言汇总**:
- [DOM] 初始 selection span 隐藏（getSelection 返回 caret）
- [DOM] 双击选词后 selection span 显示，且 words 计数反映选中内容（证明 getSelection 正确返回范围）

---

## FP-04-01-N02 [P1] [正常] Shift+Arrow 扩展选区→ getSelection 范围变化→ selection span 计数实时更新

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
  await typeInEditor(page, "abcdef");
  await page.waitForTimeout(250);
  // step 3: 光标移到行首，准备扩展选区
  await page.keyboard.press("Home");
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | Shift+ArrowRight 两次（选中 "ab"） | [DOM] selection span 显示 "Selected: ... 2 chars"（getSelection 返回 [0,2)） | import: @playwright/test; API: page.keyboard.press("Shift+ArrowRight"); 框架: playwright; 等待: 50ms |
| 2 | 再 Shift+ArrowRight 三次（扩展到 "abcde"） | [DOM] selection span 文本变为 "5 chars"（getSelection 返回 [0,5)，selectionChange 再次触发 → recomputeSelection） | import: @playwright/test; API: page.keyboard.press("Shift+ArrowRight" x3); 框架: playwright; 等待: 100ms |

**断言汇总**:
- [DOM] 选区扩展时 chars 数从 2 → 5（证明 getSelection 实时返回最新范围）

---

## FP-04-01-N03 [P2] [正常] ControlOrMeta+A 全选→ getSelection 覆盖整个文档→ selection span 反映全文档计数

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
  await typeInEditor(page, "one two three");
  await page.waitForTimeout(250);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | ControlOrMeta+A（全选） | [DOM] CM6 选中整个文档，selection span 显示 "Selected: 3 words · 13 chars"（getSelection 返回 [0, doc.length)） | import: @playwright/test; API: page.keyboard.press("ControlOrMeta+a"); 框架: playwright; 等待: 100ms |

**断言汇总**:
- [DOM] 全选后 selection span 的 words=3 chars=13，与全文档计数一致（证明 getSelection 在全选时正确覆盖整个文档）

---

## FP-04-01-N04 [P2] [正常] 取消选区（Arrow 键塌缩）→ getSelection 返回 caret→ selection span 隐藏

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 含 "sample text" 文本
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器并输入
  await clearEditor(page);
  await typeInEditor(page, "sample text");
  await page.waitForTimeout(250);
  // step 3: 双击选词制造选区
  await page.locator(".cm-content").dblclick();
  await page.waitForTimeout(100);
  const activeSel = await getSelectionStatus(page);
  expect(activeSel.visible).toBe(true);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | ArrowRight（塌缩选区为 caret） | [DOM] selectionChange 触发，computeSelection 检测 `from===to` → isActive:false（`plugin.ts:155-157`） | import: @playwright/test; API: page.keyboard.press("ArrowRight"); 框架: playwright; 等待: 100ms |
| 2 | 断言 selection span | [DOM] `.nexus-wordcount__selection` hidden=true，textContent === ""（`status-bar.ts:119-123`） | import: @playwright/test; API: getSelectionStatus(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] 取消选区后 selection span 隐藏并清空文本（证明 getSelection 在 caret 状态返回 anchor===head）

---

## FP-04-01-E01 [P3] [异常] 空文档选区操作→ getSelection 返回 [0,0]→ selection span 保持隐藏

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
| 1 | ControlOrMeta+A（对空文档全选） | [DOM] selection span 仍隐藏（getSelection 返回 [0,0]，computeSelection `from===to===0` → isActive:false） | import: @playwright/test; API: page.keyboard.press("ControlOrMeta+a"); 框架: playwright; 等待: 100ms |
| 2 | 断言 selection span | [DOM] `.nexus-wordcount__selection` hidden=true | import: @playwright/test; API: getSelectionStatus(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] 空文档选区操作不激活 selection span（getSelection 对空 doc 仍返回 anchor===head）

---

## FP-04-01-B01 [P4] [边界] 反向选区（head < anchor）→ getSelection 返回颠倒范围→ slice 仍正确

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
  await typeInEditor(page, "abcdef");
  await page.waitForTimeout(250);
  // step 3: 光标移到末尾
  await page.keyboard.press("End");
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | Shift+ArrowLeft 四次（反向选 "cdef"，head < anchor） | [DOM] CM6 选中 "cdef"，selection span 显示 "4 chars"（computeSelection 用 `Math.min/max(anchor,head)` 归一化，`plugin.ts:152-153`，getSelection 原样返回 {anchor:6, head:2}） | import: @playwright/test; API: page.keyboard.press("Shift+ArrowLeft" x4); 框架: playwright; 等待: 100ms |

**断言汇总**:
- [DOM] 反向选区仍正确计数（证明 getSelection 保留原始 anchor/head 顺序，下游用 min/max 归一化）

---

# FP-04-02 getSelections() 获取所有选区（6 例，[API契约][编辑交互]）

> 间接验证路径：`editor.ts:752-757` 的 getSelections 返回 `{ranges, mainIndex}`，在多光标场景下 ranges.length > 1。wordcount 插件仅读主选区，无法直接断言 ranges 数量。验证策略：(1) 多光标场景下输入文本同时在多个位置生效；(2) 工具栏格式化对所有选区生效；(3) 必要时通过 `page.evaluate` 注入 `window.__nexusEditor` 钩子直接调用。demo 启用 `multiCursor: true`（`editor-shell.ts:138`），支持 Mod-d / Alt-click / Mod-Alt-Arrow 触发多光标。

## FP-04-02-N01 [P1] [正常] 单光标→ getSelections 返回 ranges.length===1→ 等价 getSelection

**测试框架**: Playwright

**前置条件**（⚠️ 4要素）:
- 依赖环境: Electron demo
- 初始文档: 含 "single cursor" 文本
- 插件配置: demo 默认（multiCursor: true）
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器并输入
  await clearEditor(page);
  await typeInEditor(page, "single cursor");
  await page.waitForTimeout(250);
  // step 3: 点击使光标在单位置（无选区）
  await page.click(".cm-content");
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 通过 page.evaluate 注入钩子读取 getSelections（若 demo 暴露） | [STATE] 若 `window.__nexusEditor` 可用：`getSelections().ranges.length === 1`，`mainIndex === 0`；若未暴露：标注需注入钩子 | import: @playwright/test; API: page.evaluate; 框架: playwright; 等待: 无 |
| 2 | 断言 selection span 隐藏 | [DOM] wordcount selection span hidden=true（单 caret，getSelections 的 ranges[0] 即主选区，与 getSelection 一致） | import: @playwright/test; API: getSelectionStatus(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [STATE] 单光标场景 getSelections 返回 1 个 range（等价 getSelection 的主选区）
- [DOM] wordcount selection span 隐藏（证明主选区是 caret）

---

## FP-04-02-N02 [P1] [正常] Mod-d 选中下一个匹配→ getSelections 返回 ranges.length===2→ 双光标输入

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 含 "foo bar foo" 文本
- 插件配置: demo 默认（multiCursor: true）
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器并输入重复单词
  await clearEditor(page);
  await typeInEditor(page, "foo bar foo");
  await page.waitForTimeout(250);
  // step 3: 双击选中第一个 "foo"
  await page.locator(".cm-content").dblclick();
  await page.waitForTimeout(100);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | ControlOrMeta+d（selectNextOccurrence） | [DOM] CM6 添加第二个选区选中第二个 "foo"，getSelections().ranges.length === 2（FP-10-01 的 Mod-d 实现，内部 dispatch EditorSelection.create 即 setSelections 路径） | import: @playwright/test; API: page.keyboard.press("ControlOrMeta+d"); 框架: playwright; 等待: 150ms |
| 2 | 输入 "X"（多光标同时输入） | [DOM] 两个 "foo" 同时变为 "X"，文档变为 "X bar X"（证明 getSelections 的 2 个 range 都参与事务） | import: @playwright/test; API: page.keyboard.type("X"); 框架: playwright; 等待: 200ms |

**断言汇总**:
- [DOM] Mod-d 后输入同时作用于两个选区（证明 getSelections 返回多个 range 且都生效）

---

## FP-04-02-N03 [P2] [正常] Mod-Alt-ArrowDown 添加下方光标→ getSelections 多光标→ 多行同步输入

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 多行文本（2 行）
- 插件配置: demo 默认（multiCursor: true）
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器并输入 2 行
  await clearEditor(page);
  await typeInEditor(page, "line1");
  await pressEnter(page);
  await typeInEditor(page, "line2");
  await page.waitForTimeout(250);
  // step 3: 光标移到 line1 行首
  await page.keyboard.press("ControlOrMeta+Home");
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | ControlOrMeta+Alt+ArrowDown（addCursorBelow） | [DOM] CM6 在 line2 行首添加第二个光标，getSelections().ranges.length === 2（FP-10-02 实现） | import: @playwright/test; API: page.keyboard.press("ControlOrMeta+Alt+ArrowDown"); 框架: playwright; 等待: 150ms |
| 2 | 输入 "- "（两个光标同时输入） | [DOM] 两行行首同时出现 "- "，文档变为 "- line1\n- line2" | import: @playwright/test; API: page.keyboard.type("- "); 框架: playwright; 等待: 200ms |

**断言汇总**:
- [DOM] addCursorBelow 后输入在两行同步生效（证明 getSelections 多 range 场景）

---

## FP-04-02-N04 [P2] [正常] Mod-Esc 折叠多光标→ getSelections 回到单 range→ 仅主光标

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 含 "foo foo" 文本
- 插件配置: demo 默认（multiCursor: true）
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器并输入
  await clearEditor(page);
  await typeInEditor(page, "foo foo");
  await page.waitForTimeout(250);
  // step 3: 制造 2 个光标（双击 + Mod-d）
  await page.locator(".cm-content").dblclick();
  await page.keyboard.press("ControlOrMeta+d");
  await page.waitForTimeout(150);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | ControlOrMeta+Escape（collapseToMainSelection） | [DOM] CM6 折叠到主选区，getSelections().ranges.length 回到 1（FP-10-03 实现） | import: @playwright/test; API: page.keyboard.press("ControlOrMeta+Escape"); 框架: playwright; 等待: 150ms |
| 2 | 输入 "Y" | [DOM] 仅 1 处变为 "Y"（多光标已塌缩） | import: @playwright/test; API: page.keyboard.type("Y"); 框架: playwright; 等待: 200ms |

**断言汇总**:
- [DOM] Mod-Esc 后输入仅作用于 1 处（证明 getSelections 回到单 range）

---

## FP-04-02-E01 [P3] [异常] Alt-click 同位置→ getSelections 不重复添加→ ranges 数不异常增长

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 含 "text" 文本
- 插件配置: demo 默认（multiCursor: true）
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器并输入
  await clearEditor(page);
  await typeInEditor(page, "text");
  await page.waitForTimeout(250);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | Alt+click 同一位置多次 | [DOM] CM6 不会在同一位置叠加重复光标（FP-10-04 的 Alt-click 去重逻辑），getSelections().ranges 数量合理（不无限增长） | import: @playwright/test; API: page.keyboard.down("Alt") + page.click x3 + page.keyboard.up("Alt"); 框架: playwright; 等待: 150ms |
| 2 | 输入字符 | [DOM] 编辑器不崩溃，仅在合理光标位置插入字符 | import: @playwright/test; API: page.keyboard.type("Z"); 框架: playwright; 等待: 200ms |

**断言汇总**:
- [DOM] 同位置 Alt-click 不导致光标数异常（getSelections 健壮性）

---

## FP-04-02-B01 [P4] [边界] 多光标选中后 Mod-d 无更多匹配→ getSelections 数量不变

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 含 "unique" 文本（无重复）
- 插件配置: demo 默认（multiCursor: true）
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器并输入
  await clearEditor(page);
  await typeInEditor(page, "unique");
  await page.waitForTimeout(250);
  // step 3: 双击选中 "unique"
  await page.locator(".cm-content").dblclick();
  await page.waitForTimeout(100);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | ControlOrMeta+d（无更多匹配） | [DOM] CM6 不添加新选区（无下一个 occurrence），getSelections().ranges.length 仍为 1，可能短暂闪烁提示（selectNextOccurrence 边界） | import: @playwright/test; API: page.keyboard.press("ControlOrMeta+d"); 框架: playwright; 等待: 150ms |
| 2 | 断言编辑器存活 | [DOM] `.cm-editor` 可见，输入仍仅作用于 1 处 | import: @playwright/test; API: expect(.cm-editor).toBeVisible(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] 无更多匹配时 Mod-d 不破坏当前选区状态（getSelections 边界稳健）

---

# FP-04-03 getSelectedText() 获取选中文本（6 例，[API契约][编辑交互]）

> 间接验证路径：`editor.ts:759-763` 的 getSelectedText 调用 `view.state.doc.sliceString(from, to)`，与 wordcount `computeSelection` 的 `editor.getDocument().slice(from, to)`（`plugin.ts:159`）等价。因此 wordcount selection span 的计数是 getSelectedText 返回内容的统计投影。工具栏格式化函数（如 toggleBold）内部也读取选中文本决定插入内容，是另一条间接验证通道。

## FP-04-03-N01 [P1] [正常] 选中单词→ getSelectedText 返回该词→ selection span words 计数匹配

**测试框架**: Playwright

**前置条件**（⚠️ 4要素）:
- 依赖环境: Electron demo
- 初始文档: 含 "hello world" 文本
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器并输入
  await clearEditor(page);
  await typeInEditor(page, "hello world");
  await page.waitForTimeout(250);
  // step 3: 双击选中 "hello"
  await page.locator(".cm-content").dblclick();
  await page.waitForTimeout(100);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言 selection span | [DOM] 显示 "Selected: 1 words · 5 chars"（getSelectedText 等价 slice 返回 "hello"，countMarkdown 统计为 1 词 5 字符） | import: @playwright/test; API: getSelectionStatus(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] selection span 计数精确反映选中单词（证明 getSelectedText 返回 "hello"）

---

## FP-04-03-N02 [P1] [正常] 选中多词→ getSelectedText 返回完整片段→ Bold 按钮包裹整个选区

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 含 "hello world" 文本
- 插件配置: demo 默认（含工具栏插件）
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器并输入
  await clearEditor(page);
  await typeInEditor(page, "hello world");
  await page.waitForTimeout(250);
  // step 3: ControlOrMeta+A 全选
  await page.keyboard.press("ControlOrMeta+a");
  await page.waitForTimeout(100);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 点击工具栏 Bold 按钮 | [DOM] `.cm-content` 含 "**hello world**"（toggleBold 内部读取 getSelectedText → 整个选区 "hello world" 被 replaceSelection 包裹为 `**...**`，`formatters.ts`） | import: @playwright/test; API: page.locator('button[data-toolbar-action="bold"]').click(); 框架: playwright; 等待: 200ms |

**断言汇总**:
- [DOM] Bold 包裹整个多词选区（证明 getSelectedText 返回完整片段而非截断）

---

## FP-04-03-N03 [P2] [正常] 选中含空格文本→ getSelectedText 保留空格→ selection span words 按空格分割

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 含 "a b c" 文本
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器并输入
  await clearEditor(page);
  await typeInEditor(page, "a b c");
  await page.waitForTimeout(250);
  // step 3: 全选
  await page.keyboard.press("ControlOrMeta+a");
  await page.waitForTimeout(100);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言 selection span | [DOM] 显示 "Selected: 3 words · 5 chars"（getSelectedText 返回 "a b c" 含空格，countMarkdown 按 \s+ 分割得 3 词，字符数含空格为 5） | import: @playwright/test; API: getSelectionStatus(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] selection span 反映空格（证明 getSelectedText 不裁剪空白）

---

## FP-04-03-N04 [P2] [正常] 选中 CJK 文本→ getSelectedText 保留多字节字符→ selection span 正确计数

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 含 "你好世界" 文本
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器并输入 CJK
  await clearEditor(page);
  await typeInEditor(page, "你好世界");
  await page.waitForTimeout(250);
  // step 3: 全选
  await page.keyboard.press("ControlOrMeta+a");
  await page.waitForTimeout(100);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言 selection span | [DOM] 显示 "Selected: ... 4 chars"（getSelectedText 返回 "你好世界"，按 code point 计 4 字符，CJK 不损坏） | import: @playwright/test; API: getSelectionStatus(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] CJK 选中文本字符数正确（证明 getSelectedText 保留多字节字符）

---

## FP-04-03-E01 [P3] [异常] 空选区（caret）→ getSelectedText 返回空串→ Bold 插入空标记 ****

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 含 "word" 文本（光标无选区）
- 插件配置: demo 默认（含工具栏）
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器并输入
  await clearEditor(page);
  await typeInEditor(page, "word");
  await page.waitForTimeout(250);
  // step 3: 点击使光标塌缩（无选区）
  await page.click(".cm-content");
  await page.waitForTimeout(100);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言 selection span 隐藏 | [DOM] selection span hidden=true（getSelectedText 返回 ""） | import: @playwright/test; API: getSelectionStatus(); 框架: playwright; 等待: 无 |
| 2 | 点击工具栏 Bold | [DOM] `.cm-content` 含 "****"（toggleBold 对空选区插入 `**...**`，内部 getSelectedText === ""） | import: @playwright/test; API: page.locator('button[data-toolbar-action="bold"]').click(); 框架: playwright; 等待: 200ms |

**断言汇总**:
- [DOM] 空选区时 getSelectedText 返回 ""，Bold 插入空标记对

---

## FP-04-03-B01 [P4] [边界] 跨行选区→ getSelectedText 含换行符→ selection span 反映多行

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 多行文本
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器并输入 2 行
  await clearEditor(page);
  await typeInEditor(page, "line1");
  await pressEnter(page);
  await typeInEditor(page, "line2");
  await page.waitForTimeout(250);
  // step 3: 全选（跨行）
  await page.keyboard.press("ControlOrMeta+a");
  await page.waitForTimeout(100);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言 selection span | [DOM] 显示 "Selected: 2 words · 11 chars"（getSelectedText 返回 "line1\nline2" 含 \n，countMarkdown 计 2 词；字符数 5+1+5=11 含换行符） | import: @playwright/test; API: getSelectionStatus(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] 跨行选区 selection span 计数含换行符（证明 getSelectedText 保留 \n）

---

# FP-04-04 setSelection(anchor, head) 设置选区（6 例，[API契约][编辑交互]）

> 直接 UI 路径：`outline-panel.ts:104-107` 的标题条目点击 → `editor.setSelection(entry.from)`（单参数，head 默认 = anchor，即 caret 跳转）；`app.ts:285,296` 的 backlinks 跳转 → `shell.editor.setSelection(pos)`。`editor.ts:775-791` 的 setSelection 实现 dispatch `{selection:{anchor,head}, scrollIntoView:true}`。

## FP-04-04-N01 [P1] [正常] 点击 Outline 标题→ setSelection(from) 跳转→ 光标移至标题行

**测试框架**: Playwright

**前置条件**（⚠️ 4要素）:
- 依赖环境: Electron demo
- 初始文档: 含多级标题（至少 2 个）
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器并输入多段+标题
  await clearEditor(page);
  await toggleOutline(page);
  await typeInEditor(page, "# Top");
  await pressEnter(page);
  await pressEnter(page);
  await typeInEditor(page, "Some content here");
  await pressEnter(page);
  await pressEnter(page);
  await typeInEditor(page, "# Bottom");
  await page.waitForTimeout(400);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 点击 Outline 中 "Bottom" 条目 | [DOM] 光标跳转到 "Bottom" 标题行（`outline-panel.ts:105` 的 `editor.setSelection(entry.from)`，setSelection dispatch selection） | import: @playwright/test; API: page.locator('.nexus-outline-panel button:has-text("Bottom")').click(); 框架: playwright; 等待: 150ms |
| 2 | 断言光标位置 | [DOM] `.cm-activeLine` 含 "Bottom" 文本（CM6 将光标移至 entry.from） | import: @playwright/test; API: page.locator(".cm-activeLine").textContent(); 框架: playwright; 等待: 100ms |

**断言汇总**:
- [DOM] 点击 Outline 触发 setSelection，光标跳转至标题位置（证明 setSelection(from) caret 模式生效）

---

## FP-04-04-N02 [P1] [正常] 点击 Backlinks 条目→ setSelection(pos) 跳转→ 光标移至引用位置

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（需 sample-vault 含 wiki-link 引用关系）
- 初始文档: 当前文档被另一文档引用
- 插件配置: demo 默认（含 wikilinks + backlinks 面板）
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 打开 Backlinks 面板
  await toggleBacklinks(page);
  await page.waitForTimeout(300);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 点击 Backlinks 面板中的某条引用条目（若存在） | [DOM] 光标跳转到引用所在位置（`app.ts:285` 的 `shell.editor.setSelection(pos)`），编辑器滚动使该位置可见（setSelection 的 scrollIntoView:true，`editor.ts:789`） | import: @playwright/test; API: page.locator('.nexus-backlinks-panel button').first().click(); 框架: playwright; 等待: 200ms |
| 2 | 断言编辑器存活 | [DOM] `.cm-editor` 可见，光标在引用所在文档位置 | import: @playwright/test; API: expect(.cm-editor).toBeVisible(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] Backlinks 点击触发 setSelection 跳转（证明 setSelection 经 backlinks 路径生效）
- 备注: 若 sample-vault 无 backlinks 数据，本用例降级为"打开面板不崩溃"

---

## FP-04-04-N03 [P2] [正常] setSelection 单参数→ head 默认=anchor→ 光标为 caret（无选区）

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 含标题的文档
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 制造选区状态
  await clearEditor(page);
  await toggleOutline(page);
  await typeInEditor(page, "# Heading");
  await pressEnter(page);
  await pressEnter(page);
  await typeInEditor(page, "some text");
  await page.waitForTimeout(400);
  // step 3: 全选制造选区
  await page.keyboard.press("ControlOrMeta+a");
  await page.waitForTimeout(100);
  const beforeSel = await getSelectionStatus(page);
  expect(beforeSel.visible).toBe(true);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 点击 Outline "Heading" 条目 | [DOM] setSelection(entry.from) 单参数调用（`editor.ts:775` 的 `head = anchor` 默认），光标塌缩为 caret | import: @playwright/test; API: page.locator('.nexus-outline-panel button:has-text("Heading")').click(); 框架: playwright; 等待: 150ms |
| 2 | 断言 selection span 隐藏 | [DOM] selection span hidden=true（setSelection(from) 后 anchor===head，computeSelection 的 from===to 分支） | import: @playwright/test; API: getSelectionStatus(); 框架: playwright; 等待: 100ms |

**断言汇总**:
- [DOM] setSelection 单参数调用产生 caret（无选区），selection span 隐藏

---

## FP-04-04-N04 [P2] [正常] 通过 page.evaluate 钩子调用 setSelection(anchor, head)→ 产生真选区→ selection span 显示

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（需 editor-shell.ts 注入 `(window as any).__nexusEditor = editor` 测试钩子）
- 初始文档: 含 "hello world" 文本
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器并输入
  await clearEditor(page);
  await typeInEditor(page, "hello world");
  await page.waitForTimeout(250);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 通过钩子调用 setSelection(0, 5)（选中 "hello"） | [STATE] 若钩子存在：`window.__nexusEditor.setSelection(0, 5)` dispatch selection [0,5) → selectionChange → recomputeSelection → selection span 显示 "Selected: 1 words · 5 chars"；若钩子缺失：用例跳过 | import: @playwright/test; API: page.evaluate(setSelection(0,5)); 框架: playwright; 等待: 150ms |
| 2 | 断言 selection span | [DOM] selection span 可见且计数匹配 "hello"（证明 setSelection(anchor, head) 双参数产生真选区） | import: @playwright/test; API: getSelectionStatus(); 框架: playwright; 等待: 100ms |

**断言汇总**:
- [DOM] setSelection(0, 5) 产生 [0,5) 选区（依赖 demo 注入测试钩子）

---

## FP-04-04-E01 [P3] [异常] setSelection 越界位置→ CM6 静默夹紧→ 编辑器不崩溃

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（需测试钩子）
- 初始文档: 含 "hi" 文本
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器并输入
  await clearEditor(page);
  await typeInEditor(page, "hi");
  await page.waitForTimeout(250);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 通过钩子调用 setSelection(9999, 99999)（远超 doc.length=2） | [DOM] CM6 静默夹紧到 doc.length（`editor.ts:787-790` 的 dispatch，CM6 对越界 selection 自动 clamp），编辑器不崩溃 | import: @playwright/test; API: page.evaluate(setSelection(9999,99999)); 框架: playwright; 等待: 150ms |
| 2 | 断言编辑器存活 | [DOM] `.cm-editor` 可见，可继续输入 | import: @playwright/test; API: expect(.cm-editor).toBeVisible(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] 越界 setSelection 不崩溃（CM6 静默夹紧）

---

## FP-04-04-B01 [P4] [边界] setSelection(anchor===head)→ 等价 caret→ 无选区激活

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（需测试钩子）
- 初始文档: 含 "abcdef" 文本
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器并输入
  await clearEditor(page);
  await typeInEditor(page, "abcdef");
  await page.waitForTimeout(250);
  // step 3: 全选制造选区
  await page.keyboard.press("ControlOrMeta+a");
  await page.waitForTimeout(100);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 通过钩子调用 setSelection(3, 3)（anchor===head） | [DOM] 等价 caret，selectionChange 触发但 computeSelection 的 from===to 分支 → isActive:false | import: @playwright/test; API: page.evaluate(setSelection(3,3)); 框架: playwright; 等待: 150ms |
| 2 | 断言 selection span 隐藏 | [DOM] selection span hidden=true | import: @playwright/test; API: getSelectionStatus(); 框架: playwright; 等待: 100ms |

**断言汇总**:
- [DOM] setSelection(anchor===head) 产生 caret，selection span 隐藏（边界：双参数但同位置）

---

# FP-04-05 setSelections(ranges, mainIndex) 设置多选区（5 例，[API契约][编辑交互]）

> 间接验证路径：`editor.ts:792-803` 的 setSelections 用 `EditorSelection.create(ranges, mainIndex)` dispatch。demo UI 无直接多选区设置入口，验证策略：(1) Mod-d 等 CM6 原生多光标走等价的 EditorSelection.create 路径；(2) 工具栏格式化对多选区同时生效；(3) `page.evaluate` 注入钩子直接调用。注意 `ranges.length === 0` 时 setSelections 直接 return（`editor.ts:793-795`）。

## FP-04-05-N01 [P1] [正常] setSelections 单 range→ 等价 setSelection→ 光标定位

**测试框架**: Playwright

**前置条件**（⚠️ 4要素）:
- 依赖环境: Electron demo（需测试钩子）
- 初始文档: 含 "hello" 文本
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器并输入
  await clearEditor(page);
  await typeInEditor(page, "hello");
  await page.waitForTimeout(250);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 通过钩子调用 setSelections([{anchor:0, head:5}], 0) | [STATE] 若钩子存在：setSelections dispatch 单 range [0,5)，selectionChange 触发，selection span 显示 "Selected: 1 words · 5 chars"（与 setSelection(0,5) 等价） | import: @playwright/test; API: page.evaluate(setSelections); 框架: playwright; 等待: 150ms |
| 2 | 断言 selection span | [DOM] selection span 可见，计数匹配 "hello" | import: @playwright/test; API: getSelectionStatus(); 框架: playwright; 等待: 100ms |

**断言汇总**:
- [DOM] setSelections 单 range 等价 setSelection（依赖测试钩子）

---

## FP-04-05-N02 [P1] [正常] setSelections 多 range→ 多光标→ 输入同时作用于多处

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（需测试钩子）
- 初始文档: 含 "a b c" 文本
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器并输入
  await clearEditor(page);
  await typeInEditor(page, "a b c");
  await page.waitForTimeout(250);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 通过钩子调用 setSelections([{anchor:0,head:1},{anchor:2,head:3},{anchor:4,head:5}], 0) | [STATE] setSelections dispatch 3 个 range（选中 "a"/"b"/"c"），`editor.ts:797-802` 的 EditorSelection.create | import: @playwright/test; API: page.evaluate(setSelections 3 ranges); 框架: playwright; 等待: 150ms |
| 2 | 点击工具栏 Bold | [DOM] `.cm-content` 含 "**a** b **b** c **c**"（toggleBold 对所有选区生效，证明 3 个 range 都被 setSelections 建立） | import: @playwright/test; API: page.locator('button[data-toolbar-action="bold"]').click(); 框架: playwright; 等待: 200ms |

**断言汇总**:
- [DOM] setSelections 多 range 后 Bold 同时作用于 3 处（证明 ranges 数组完整应用）

---

## FP-04-05-N03 [P2] [正常] setSelections 指定 mainIndex→ 主选区为指定索引→ wordcount 读主选区

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（需测试钩子）
- 初始文档: 含 "foo bar" 文本
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器并输入
  await clearEditor(page);
  await typeInEditor(page, "foo bar");
  await page.waitForTimeout(250);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 通过钩子调用 setSelections([{anchor:0,head:3},{anchor:4,head:7}], 1)（mainIndex=1） | [STATE] setSelections 建立两个 range，mainIndex=1 指向 [4,7) 即 "bar"（`editor.ts:798-801` 的 mainIndex ?? ranges.length-1） | import: @playwright/test; API: page.evaluate(setSelections mainIndex=1); 框架: playwright; 等待: 150ms |
| 2 | 断言 wordcount selection span | [DOM] selection span 显示 "Selected: 1 words · 3 chars"（wordcount 的 computeSelection 读 getSelection 即 main range，此时为 "bar"，3 字符） | import: @playwright/test; API: getSelectionStatus(); 框架: playwright; 等待: 100ms |

**断言汇总**:
- [DOM] mainIndex 控制主选区（wordcount 反映 mainIndex 指向的 range，证明 setSelections 的 mainIndex 参数生效）

---

## FP-04-05-N04 [P2] [正常] setSelections 不传 mainIndex→ 默认最后一个 range 为主选区

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（需测试钩子）
- 初始文档: 含 "foo bar" 文本
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器并输入
  await clearEditor(page);
  await typeInEditor(page, "foo bar");
  await page.waitForTimeout(250);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 通过钩子调用 setSelections([{anchor:0,head:3},{anchor:4,head:7}])（省略 mainIndex） | [STATE] setSelections 默认 mainIndex = ranges.length-1 = 1（`editor.ts:801`），即主选区指向 [4,7) "bar" | import: @playwright/test; API: page.evaluate(setSelections no mainIndex); 框架: playwright; 等待: 150ms |
| 2 | 断言 selection span | [DOM] selection span 反映 "bar"（3 chars，与 N03 等价，证明默认 mainIndex 是最后一个） | import: @playwright/test; API: getSelectionStatus(); 框架: playwright; 等待: 100ms |

**断言汇总**:
- [DOM] 省略 mainIndex 时默认最后一个 range 为主选区

---

## FP-04-05-E01 [P3] [异常] setSelections 空数组→ 直接 return→ 不改变当前选区

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（需测试钩子）
- 初始文档: 含 "hello" 文本，已存在选区
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器并输入
  await clearEditor(page);
  await typeInEditor(page, "hello");
  await page.waitForTimeout(250);
  // step 3: 全选制造选区
  await page.keyboard.press("ControlOrMeta+a");
  await page.waitForTimeout(100);
  const beforeSel = await getSelectionStatus(page);
  expect(beforeSel.visible).toBe(true);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 通过钩子调用 setSelections([])（空数组） | [STATE] `editor.ts:793-795` 的 `ranges.length === 0` 早返回，不 dispatch，当前选区不变 | import: @playwright/test; API: page.evaluate(setSelections([])); 框架: playwright; 等待: 150ms |
| 2 | 断言 selection span 仍可见 | [DOM] selection span 文本与步骤 1 之前一致（证明空数组未清除选区） | import: @playwright/test; API: getSelectionStatus(); 框架: playwright; 等待: 100ms |

**断言汇总**:
- [DOM] setSelections([]) 空数组早返回，不改变现有选区（边界异常防护）

---

# 统计汇总

| 二级功能点 | 用例数 | P1 | P2 | P3 | P4 | 正常 | 异常 | 边界 |
|-----------|-------|----|----|----|----|------|------|------|
| FP-04-01 getSelection | 6 | 2 | 2 | 1 | 1 | 4 | 1 | 1 |
| FP-04-02 getSelections | 6 | 2 | 2 | 1 | 1 | 4 | 1 | 1 |
| FP-04-03 getSelectedText | 6 | 2 | 2 | 1 | 1 | 4 | 1 | 1 |
| FP-04-04 setSelection | 6 | 2 | 2 | 1 | 1 | 4 | 1 | 1 |
| FP-04-05 setSelections | 5 | 2 | 2 | 1 | 0 | 4 | 1 | 0 |
| **合计** | **29** | **10** | **10** | **5** | **4** | **20** | **5** | **4** |

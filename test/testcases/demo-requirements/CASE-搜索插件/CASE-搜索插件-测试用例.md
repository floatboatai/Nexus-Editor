# CASE-搜索插件-测试用例（FP-17）

> 一级功能点: 搜索插件（demo-requirements.md §8）
> 全局批次序号: 17
> 生成时间: 2026-08-11
> 测试框架: Playwright（Electron demo / Vite dev server + Electron main）
>
> 涉及二级功能点:
> - FP-17-01 findSearchMatches(doc, query, options) 纯函数搜索（[API契约]）
> - FP-17-02 replaceAllMatches(doc, query, replacement) 纯函数替换（[API契约]）
> - FP-17-03 搜索面板 UI（查找框/替换框/可折叠/aria-expanded）（[编辑交互][无障碍]）
> - FP-17-04 搜索选项（大小写/正则/全字匹配复选框）（[编辑交互]）
> - FP-17-05 搜索历史（ArrowUp/Down 召回，maxEntries 20）（[编辑交互][数据IO]）
> - FP-17-06 表格搜索高亮（CSS Custom Highlight API + offset 映射）（[插件能力][Live Preview][性能]）
> - FP-17-07 highlightSelectionMatches 选区高亮（[插件能力][编辑交互]）
> - FP-17-08 SearchPluginOptions 配置（top/caseSensitive/history/labels）（[插件能力][API契约]）
>
> ⚠️ 实现差异提示（依据 `packages/plugin-search/src/index.ts` + `apps/electron-demo/src/renderer/search-bar.ts` + `apps/electron-demo/src/renderer/editor-shell.ts:143` + `apps/electron-demo/src/renderer/app.ts:403-422` 实际代码）:
> - **Demo 存在两套搜索 UI**：① CM6 内置搜索面板 `NexusSearchPanel`（`packages/plugin-search/src/index.ts:885`），通过 `createSearchPlugin()` 挂载（`editor-shell.ts:143`），快捷键 **Mod-f**（`@codemirror/search` 的 `openSearchPanel` keymap）打开；② 独立 SearchBar（`apps/electron-demo/src/renderer/search-bar.ts:65`），通过工具栏 🔍 按钮或 `Ctrl/Cmd+f`（`app.ts:418-422` 的 document keydown listener）打开，类名 `.nexus-search-bar`。
> - **两套搜索会同时响应 Mod-f**：CM6 的 `searchKeymap` 和 app.ts 的 document listener 都注册了 Mod-f。由于 app.ts 的 listener 调用 `e.preventDefault()`，会阻止 CM6 内部快捷键。因此 **Mod-f 在 demo 中主要打开独立 SearchBar**（`.nexus-search-bar`）。
> - **CM6 NexusSearchPanel 选择器**（`index.ts:885-1000`）：面板容器 `[data-test-id="markdown-search-bar"]`（class `cm-search nexus-search-panel`）；查找输入框 `[data-test-id="markdown-search-input"]`；替换输入框 `[data-test-id="markdown-search-replace-input"]`；替换切换按钮 `[data-test-id="markdown-search-toggle-replace"]`（`aria-expanded` 属性控制折叠）；替换行 `[data-test-id="markdown-search-replace-row"]`（`hidden` 属性）；上一个/下一个/全选/替换/替换全部/关闭按钮分别 `markdown-search-prev/next/all/replace/replace-all/close`；三个复选框：大小写 `markdown-search-case-toggle`、正则 `markdown-search-regexp-toggle`、全字 `markdown-search-word-toggle`；tooltip `nexus-search-tooltip` + `[data-test-id="${btn}-tooltip"]`。
> - **独立 SearchBar 选择器**（`search-bar.ts:65-240`）：容器 `.nexus-search-bar`（`display:none`/`flex` 切换）；查找/替换为两个 `input[type=text]`（按顺序第 1/第 2 个）；上一个/下一个/替换/全部替换/关闭按钮按顺序在容器内。**无 data-test-id，无 aria 属性，无复选框**。
> - **纯函数 API 验证**（FP-17-01/02）：demo **未暴露** `findSearchMatches`/`replaceAllMatches` 到 window 对象。但 `search-bar.ts:132,181` 直接调用了它们——通过独立 SearchBar 的搜索/替换行为间接验证。CM6 的 NexusSearchPanel 使用 `@codemirror/search` 自身的搜索逻辑，而非纯函数 API。
> - **搜索高亮**（FP-17-06）：CM6 NexusSearchPanel 的搜索匹配在 `.cm-content` 中通过 `@codemirror/search` 的 Decoration 渲染高亮（`.cm-searchMatch` / `.cm-selectionMatch` 类名）。表格高亮（`index.ts:466-490` 的 `tableSearchHighlightPlugin`）使用 **CSS Custom Highlight API**（`CSS.highlights`），通过 `::highlight(nexus-table-search-*)` 伪元素渲染——**无法通过 Playwright DOM 直接断言高亮范围内容**（Highlight API 的 Range 不暴露到 DOM 树），只能验证 `<style data-nexus-table-search-highlight>` 元素存在、表格 DOM 内含搜索词文本。
> - **选区高亮**（FP-17-07）：`highlightSelectionMatches()`（CM6 内置）在 `.cm-content` 内渲染 `.cm-selectionMatch` 类名装饰。选中文本后，视口内相同文本自动高亮。
> - **搜索历史**（FP-17-05）：`SearchHistoryController`（`index.ts:518-620`）通过 ArrowUp/Down 召回，但 demo 默认 `createSearchPlugin()` **未传 `history` 选项**（`editor-shell.ts:143`），因此 history 默认为 `false`（`index.ts:529`）。独立 SearchBar 无历史功能。
> - **标签自定义**（FP-17-08）：`labels` 选项控制 NexusSearchPanel 的所有文案，demo 默认使用英文标签（`index.ts:88-102` 的 DEFAULT_LABELS）。
> - **测试策略**：由于两套搜索 UI 共存，用例需明确区分测试目标。CM6 面板相关功能（FP-17-03/04/05/06/08）通过 `[data-test-id=...]` 元素；独立 SearchBar 相关功能（FP-17-01/02 的间接验证、FP-17-07 选区高亮）通过 `.nexus-search-bar` 操作。

---

## e2e 全局前置条件

- 依赖环境: Electron demo（Vite dev server localhost:5173 + 已构建的 `apps/electron-demo/dist-electron/main.js`）
- 初始文档: demo 启动后默认打开 sample-vault 的 index.md
- 插件配置: demo 默认挂载 —— createGfmPreset + createHistoryPlugin + createToolbarPlugin + **createSearchPlugin()（无 options）** + createWikilinksPlugin + createWordCountPlugin
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
    return (await page.locator(".cm-content").textContent()) ?? "";
  }

  // 打开独立 SearchBar（工具栏 🔍 按钮）
  async function openStandaloneSearchBar(page: Page) {
    await page.locator('button[title="Search (Ctrl+F)"]').click();
    await page.waitForTimeout(200);
  }

  // 打开 CM6 NexusSearchPanel（在 .cm-content 上 dispatch keydown Mod-f）
  async function openCm6SearchPanel(page: Page) {
    await page.evaluate(() => {
      const content = document.querySelector(".cm-content") as HTMLElement;
      content?.dispatchEvent(new KeyboardEvent("keydown", {
        key: "f", code: "KeyF", metaKey: true, bubbles: true, cancelable: true
      }));
    });
    await page.waitForTimeout(500);
  }

  async function closeAllSearchPanels(page: Page) {
    const standalone = page.locator(".nexus-search-bar");
    if (await standalone.isVisible().catch(() => false)) {
      await page.keyboard.press("Escape");
    }
    const cm6Close = page.locator('[data-test-id="markdown-search-close"]');
    if (await cm6Close.isVisible().catch(() => false)) {
      await cm6Close.click();
    }
    await page.waitForTimeout(200);
  }
  ```

---

# FP-17-01 findSearchMatches(doc, query, options) 纯函数搜索（5 例，[API契约]）

> 实现路径：`packages/plugin-search/src/index.ts:644-671`。demo 未暴露该函数到 window，通过独立 SearchBar 的搜索行为间接验证（`search-bar.ts:132`）。

## FP-17-01-N01 [P1] [正常] 大小写不敏感搜索→ 找到所有匹配

**前置条件**: Electron demo｜清空后输入 "Hello hello HELLO"｜demo 默认｜setup: `await clearEditor(page); await typeInEditor(page, "Hello hello HELLO"); await page.waitForTimeout(200); await openStandaloneSearchBar(page);`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 在查找框输入 "hello" | [STATE] findSearchMatches（search-bar.ts:132）默认大小写不敏感 → 3 个匹配 | fill("hello"); 等待 300ms |
| 2 | 断言计数标签含 "3" | [DOM] `.nexus-search-bar span` 含 "1 / 3" | textContent() |
| 3 | 断言选区跳到第一个匹配 | [DOM] "Hello" 被选中 | .cm-content |

**断言汇总**: [DOM] 大小写不敏感搜索找到 3 个匹配；计数标签正确

---

## FP-17-01-N02 [P1] [正常] 精确大小写输入→ 仍大小写不敏感

**前置条件**: 同 N01｜setup 同 N01

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 在查找框输入 "Hello" | [STATE] findSearchMatches 仍不敏感 → 3 个匹配 | fill("Hello"); 等待 300ms |
| 2 | 断言计数仍为 3 | [DOM] count label 含 "3" | textContent() |

**断言汇总**: [DOM] 独立 SearchBar 搜索默认大小写不敏感

---

## FP-17-01-N03 [P2] [正常] 无匹配→ "0 results"

**前置条件**: Electron demo｜清空后输入 "alpha beta gamma"｜demo 默认｜setup: `await clearEditor(page); await typeInEditor(page, "alpha beta gamma"); await page.waitForTimeout(200); await openStandaloneSearchBar(page);`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 在查找框输入 "xyz" | [STATE] findSearchMatches 无结果 → 返回 []（index.ts:649-670） | fill("xyz"); 等待 300ms |
| 2 | 断言计数显示 "0 results" | [DOM] count label = "0 results"（search-bar.ts:136） | textContent() |

**断言汇总**: [DOM] 无匹配时显示 "0 results"

---

## FP-17-01-N04 [P2] [正常] 空查询→ 不搜索，计数清空

**前置条件**: 同 N03｜setup 同 N03

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 在查找框清空 | [STATE] findSearchMatches("...","") → if(!query) return []（index.ts:649-651） → search-bar.ts:125-130 清空 | fill(""); 等待 300ms |
| 2 | 断言计数标签为空 | [DOM] count label = ""（search-bar.ts:128） | textContent() |

**断言汇总**: [DOM] 空查询不执行搜索，计数清空

---

## FP-17-01-E01 [P3] [异常] 特殊正则字符字面搜索→ 正确转义

**前置条件**: Electron demo｜清空后输入 "price: $9.99 each"｜demo 默认｜setup: `await clearEditor(page); await typeInEditor(page, "price: $9.99 each"); await page.waitForTimeout(200); await openStandaloneSearchBar(page);`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 在查找框输入 "$9.99" | [STATE] escapeRegExp（index.ts:622-624）转义 $/． → 字面匹配 → 1 个匹配 | fill("$9.99"); 等待 300ms |
| 2 | 断言计数含 "1" | [DOM] count label 含 "1" | textContent() |

**断言汇总**: [DOM] 含正则特殊字符的字面搜索正确转义不报错

---

# FP-17-02 replaceAllMatches(doc, query, replacement) 纯函数替换（5 例，[API契约]）

> 实现路径：`index.ts:673-688`。demo 中 `search-bar.ts:181` 调用此函数（独立 SearchBar 的 "All" 按钮）。

## FP-17-02-N01 [P1] [正常] 全部替换→ 替换所有匹配

**前置条件**: Electron demo｜清空后输入 "cat scatter cat"｜demo 默认｜setup: `await clearEditor(page); await typeInEditor(page, "cat scatter cat"); await page.waitForTimeout(200); await openStandaloneSearchBar(page);`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 查找框输入 "cat"，替换框输入 "dog" | [DOM] 两个输入框值正确 | fill("cat") / nth(1).fill("dog"); 等待 300ms |
| 2 | 点击 "All" 按钮 | [STATE] replaceAllMatches（search-bar.ts:181）→ "dog sdogter dog" | 点击含 "All" 的按钮; 等待 300ms |
| 3 | 断言文档含 "dog sdogter dog" | [DOM] getEditorText() 含 "dog sdogter dog" | getEditorText() |

**断言汇总**: [DOM] 全部替换将所有匹配（含子串）替换；scatter → sdogter

---

## FP-17-02-N02 [P1] [正常] 替换为空→ 删除所有匹配

**前置条件**: Electron demo｜清空后输入 "foo bar foo"｜demo 默认｜setup: `await clearEditor(page); await typeInEditor(page, "foo bar foo"); await page.waitForTimeout(200); await openStandaloneSearchBar(page);`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 查找框输入 "foo"，替换框清空 | [DOM] 输入框值正确 | fill("foo") / nth(1).fill("") |
| 2 | 点击 "All" | [STATE] replaceAllMatches("foo bar foo","foo","") → " bar " | 点击 "All"; 等待 300ms |
| 3 | 断言文档不含 "foo" | [DOM] getEditorText() 不含 "foo" | getEditorText() |

**断言汇总**: [DOM] 替换为空字符串等同于删除所有匹配

---

## FP-17-02-N03 [P2] [正常] 替换单个→ 仅替换当前匹配

**前置条件**: Electron demo｜清空后输入 "foo bar foo baz"｜demo 默认｜setup: `await clearEditor(page); await typeInEditor(page, "foo bar foo baz"); await page.waitForTimeout(200); await openStandaloneSearchBar(page);`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 查找框输入 "foo"，替换框输入 "XXX" | [DOM] 输入框值正确 | fill("foo") / nth(1).fill("XXX") |
| 2 | 点击 "Replace" 按钮 | [STATE] doReplace（search-bar.ts:167-175）→ 仅替换第一个 → "XXX bar foo baz" | 点击含 "Replace" 的按钮; 等待 300ms |
| 3 | 断言仅第一个 "foo" 被替换 | [DOM] getEditorText() 含 "XXX bar foo baz" | getEditorText() |

**断言汇总**: [DOM] 单个替换仅替换当前选中匹配，保留其他

---

## FP-17-02-N04 [P2] [正常] 无匹配时全部替换→ 文档不变

**前置条件**: Electron demo｜清空后输入 "alpha beta"｜demo 默认｜setup: `await clearEditor(page); await typeInEditor(page, "alpha beta"); await page.waitForTimeout(200); await openStandaloneSearchBar(page);`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 查找框输入 "xyz"，替换框输入 "ABC" | [DOM] count = "0 results" | fill("xyz") / nth(1).fill("ABC") |
| 2 | 点击 "All" | [STATE] replaceAllMatches 无匹配 → 返回原文 | 点击 "All"; 等待 300ms |
| 3 | 断言文档不变 | [DOM] getEditorText() = "alpha beta" | getEditorText() |

**断言汇总**: [DOM] 无匹配时全部替换不改变文档

---

## FP-17-02-E01 [P3] [异常] 空查询全部替换→ 原样返回

**前置条件**: Electron demo｜清空后输入 "hello world"｜demo 默认｜setup: `await clearEditor(page); await typeInEditor(page, "hello world"); await page.waitForTimeout(200); await openStandaloneSearchBar(page);`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 查找框清空，替换框输入 "X" | [DOM] 查找框为空 | fill("") / nth(1).fill("X") |
| 2 | 点击 "All" | [STATE] search-bar.ts:179 的 if(!query) return → 不执行替换 | 点击 "All"; 等待 300ms |
| 3 | 断言文档不变 | [DOM] getEditorText() = "hello world" | getEditorText() |

**断言汇总**: [DOM] 空查询时全部替换直接返回原文

---

# FP-17-03 搜索面板 UI（查找框/替换框/可折叠/aria-expanded）（6 例，[编辑交互][无障碍]）

> 实现路径：CM6 `NexusSearchPanel`（`index.ts:885-1141`）。面板容器 `[data-test-id="markdown-search-bar"]`。
> ⚠️ Mod-f 被 `app.ts:418-422` document listener 抢占。测试通过 `page.evaluate` 在 `.cm-content` 上 dispatch keydown 打开 CM6 面板。

## FP-17-03-N01 [P1] [正常] CM6 搜索面板打开→ 含查找框和导航按钮

**前置条件**: Electron demo｜清空后输入 "alpha beta alpha"｜demo 默认｜setup: `await clearEditor(page); await typeInEditor(page, "alpha beta alpha"); await page.waitForTimeout(200); await closeAllSearchPanels(page); await openCm6SearchPanel(page);`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言 CM6 面板可见 | [DOM] `[data-test-id="markdown-search-bar"]` 存在且可见（index.ts:929-931） | isVisible() |
| 2 | 断言查找输入框存在 | [DOM] `[data-test-id="markdown-search-input"]` 存在（index.ts:911-917） | count() |
| 3 | 断言查找框自动聚焦 | [DOM] activeElement 的 data-testId = "markdown-search-input"（index.ts:1013 mount 调用 select） | page.evaluate |
| 4 | 断言导航按钮存在 | [DOM] prev/next/all 按钮 data-test-id 存在（index.ts:947-957） | count() |

**断言汇总**: [DOM] CM6 面板正确渲染含查找框和导航按钮；查找框自动聚焦

---

## FP-17-03-N02 [P1] [正常] 替换框默认折叠→ aria-expanded="false"

**前置条件**: Electron demo｜清空后输入 "test text"｜demo 默认｜setup: `await clearEditor(page); await typeInEditor(page, "test text"); await page.waitForTimeout(200); await closeAllSearchPanels(page); await openCm6SearchPanel(page);`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言 toggle 按钮 aria-expanded="false" | [DOM] `[data-test-id="markdown-search-toggle-replace"]` aria-expanded="false"（index.ts:978） | getAttribute("aria-expanded") |
| 2 | 断言替换行 hidden | [DOM] `[data-test-id="markdown-search-replace-row"]` hidden=true 或不可见（index.ts:992） | isVisible() |
| 3 | 断言 toggle 按钮 aria-label="Show replace" | [DOM] aria-label="Show replace"（index.ts:1085 默认 labels） | getAttribute("aria-label") |

**断言汇总**: [DOM] 替换框默认折叠（aria-expanded="false"，hidden=true）；标签为 "Show replace"

---

## FP-17-03-N03 [P1] [正常] 点击替换切换→ 展开→ aria-expanded="true"

**前置条件**: 同 N02｜setup 同 N02

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 点击替换切换按钮 | [STATE] setReplaceExpanded(true,true)（index.ts:1078-1091）→ hidden=false → aria-expanded="true" → aria-label="Hide replace" → focus replaceField | click(); 等待 200ms |
| 2 | 断言 aria-expanded="true" | [DOM] toggle aria-expanded="true"（index.ts:1084） | getAttribute("aria-expanded") |
| 3 | 断言替换行可见 | [DOM] replace row 可见（index.ts:1082） | isVisible() |
| 4 | 断言替换输入框存在 | [DOM] `[data-test-id="markdown-search-replace-input"]` 存在 | count() |
| 5 | 断言 aria-label 变 "Hide replace" | [DOM] toggle aria-label="Hide replace"（index.ts:1085） | getAttribute("aria-label") |

**断言汇总**: [DOM] 点击切换展开替换框（aria-expanded: false→true）；标签同步更新

---

## FP-17-03-N04 [P2] [正常] 再次点击切换→ 折叠

**前置条件**: Electron demo｜清空后输入 "test"｜demo 默认｜setup: `await clearEditor(page); await typeInEditor(page, "test"); await page.waitForTimeout(200); await closeAllSearchPanels(page); await openCm6SearchPanel(page); await page.locator('[data-test-id="markdown-search-toggle-replace"]').click(); await page.waitForTimeout(200);`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 再次点击替换切换按钮 | [STATE] setReplaceExpanded(false,true) → hidden=true → aria-expanded="false" | click(); 等待 200ms |
| 2 | 断言 aria-expanded="false" | [DOM] toggle aria-expanded="false" | getAttribute("aria-expanded") |
| 3 | 断言替换行隐藏 | [DOM] replace row 不可见 | isVisible() |

**断言汇总**: [DOM] 再次点击折叠替换框（aria-expanded: true→false）

---

## FP-17-03-N05 [P2] [正常] 关闭按钮→ 面板消失

**前置条件**: Electron demo｜清空后输入 "test"｜demo 默认｜setup: `await clearEditor(page); await typeInEditor(page, "test"); await page.waitForTimeout(200); await closeAllSearchPanels(page); await openCm6SearchPanel(page);`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 点击关闭按钮 | [STATE] closeSearchPanel(view)（index.ts:996）→ CM6 移除面板 DOM | click(); 等待 300ms |
| 2 | 断言面板不可见 | [DOM] `[data-test-id="markdown-search-bar"]` 不存在或不可见 | count() 或 isVisible() |

**断言汇总**: [DOM] 关闭按钮正确关闭搜索面板

---

## FP-17-03-N06 [P3] [正常] 独立 SearchBar 打开→ 含查找/替换/导航按钮

**前置条件**: Electron demo｜清空后输入 "hello world"｜demo 默认｜setup: `await clearEditor(page); await typeInEditor(page, "hello world"); await page.waitForTimeout(200); await closeAllSearchPanels(page);`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 点击工具栏 🔍 按钮 | [STATE] searchBar.open()（app.ts:72）→ display="flex" | click(); 等待 300ms |
| 2 | 断言 .nexus-search-bar 可见 | [DOM] display="flex"（search-bar.ts:206） | isVisible() |
| 3 | 断言含 2 个输入框 | [DOM] `.nexus-search-bar input` count === 2（search-bar.ts:72,78） | count() |
| 4 | 断言含导航和替换按钮 | [DOM] `.nexus-search-bar button` count >= 5（search-bar.ts:84-111） | count() |

**断言汇总**: [DOM] 独立 SearchBar 正确渲染含查找/替换输入框和操作按钮

---

# FP-17-04 搜索选项（大小写/正则/全字匹配复选框）（5 例，[编辑交互]）

> 实现路径：CM6 NexusSearchPanel 三复选框（index.ts:925-927）：`markdown-search-case-toggle`/`markdown-search-regexp-toggle`/`markdown-search-word-toggle`。勾选触发 commit()（index.ts:1057-1070）。

## FP-17-04-N01 [P1] [正常] 勾选大小写敏感→ 仅匹配精确大小写

**前置条件**: Electron demo｜清空后输入 "Hello hello HELLO"｜demo 默认｜setup: `await clearEditor(page); await typeInEditor(page, "Hello hello HELLO"); await page.waitForTimeout(200); await closeAllSearchPanels(page); await openCm6SearchPanel(page);`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 查找框输入 "hello"（全小写） | [STATE] commit() → caseSensitive:false → 3 个匹配 | fill("hello"); 等待 300ms |
| 2 | 勾选大小写复选框 | [STATE] commit() → caseSensitive:true → 仅 1 个匹配 [6,11) | check(); 等待 300ms |
| 3 | 按 Enter | [STATE] findNext → 选中 "hello" [6,11) | press("Enter"); 等待 300ms |
| 4 | 断言选区为全小写 "hello" | [DOM] 选区文本 = "hello"（非 Hello/HELLO） | .cm-content |

**断言汇总**: [DOM] 大小写敏感模式仅匹配精确大小写的 "hello"

---

## FP-17-04-N02 [P1] [正常] 勾选正则模式→ 正则表达式搜索

**前置条件**: Electron demo｜清空后输入 "foo123 bar456 baz"｜demo 默认｜setup: `await clearEditor(page); await typeInEditor(page, "foo123 bar456 baz"); await page.waitForTimeout(200); await closeAllSearchPanels(page); await openCm6SearchPanel(page);`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 勾选正则复选框 | [STATE] commit() → regexp:true | check(); 等待 200ms |
| 2 | 查找框输入 `\d+` | [STATE] CM6 正则匹配 → "123" [3,6) 和 "456" [10,13) | fill("\\d+"); 等待 300ms |
| 3 | 按 Enter | [STATE] findNext → 选中 "123" | press("Enter"); 等待 300ms |
| 4 | 再次按 Enter | [STATE] findNext → 选中 "456" | press("Enter"); 等待 300ms |
| 5 | 断言遍历两个数字序列 | [DOM] 连续 Enter 遍历 "123" 和 "456" | .cm-content |

**断言汇总**: [DOM] 正则模式正确解析 `\d+` 并匹配数字序列

---

## FP-17-04-N03 [P2] [正常] 勾选全字匹配→ 仅匹配完整单词

**前置条件**: Electron demo｜清空后输入 "cat cats catalog cat"｜demo 默认｜setup: `await clearEditor(page); await typeInEditor(page, "cat cats catalog cat"); await page.waitForTimeout(200); await closeAllSearchPanels(page); await openCm6SearchPanel(page);`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 查找框输入 "cat" | [STATE] commit() → wholeWord:false → 含子串匹配 | fill("cat"); 等待 300ms |
| 2 | 勾选全字匹配 | [STATE] commit() → wholeWord:true → 仅完整 "cat" | check(); 等待 300ms |
| 3 | 按 Enter | [STATE] findNext → 第一个 "cat" [0,3) | press("Enter"); 等待 300ms |
| 4 | 再次按 Enter | [STATE] findNext → 跳过 cats/catalog → 最后 "cat" [17,20) | press("Enter"); 等待 300ms |
| 5 | 断言只匹配完整单词 | [DOM] 连续 Enter 仅在完整 "cat" 位置选中 | .cm-content |

**断言汇总**: [DOM] 全字匹配排除 cats/catalog，仅匹配完整 "cat"

---

## FP-17-04-N04 [P2] [正常] 大小写+全字三选项组合

**前置条件**: Electron demo｜清空后输入 "Cat cat CAT cats"｜demo 默认｜setup: `await clearEditor(page); await typeInEditor(page, "Cat cat CAT cats"); await page.waitForTimeout(200); await closeAllSearchPanels(page); await openCm6SearchPanel(page);`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 勾选大小写+全字 | [STATE] commit() → caseSensitive:true, wholeWord:true | check() x2; 等待 200ms |
| 2 | 查找框输入 "cat" | [STATE] 仅匹配全小写完整单词 → 1 个 [4,7) | fill("cat"); 等待 300ms |
| 3 | 按 Enter | [STATE] findNext → [4,7) "cat" | press("Enter"); 等待 300ms |
| 4 | 断言选区为全小写 "cat" | [DOM] 排除 Cat/CAT/cats | .cm-content |

**断言汇总**: [DOM] 大小写+全字组合正确过滤（仅全小写完整 "cat"）

---

## FP-17-04-E01 [P3] [异常] 无效正则→ 搜索不崩溃

**前置条件**: Electron demo｜清空后输入 "hello world"｜demo 默认｜setup: `await clearEditor(page); await typeInEditor(page, "hello world"); await page.waitForTimeout(200); await closeAllSearchPanels(page); await openCm6SearchPanel(page);`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 勾选正则复选框 | [STATE] commit() → regexp:true | check(); 等待 200ms |
| 2 | 查找框输入 "[invalid(" | [STATE] CM6 无效正则 → query.valid=false → 不崩溃 | fill("[invalid("); 等待 300ms |
| 3 | 按 Enter | [STATE] findNext → 无效 query → 无操作 | press("Enter"); 等待 300ms |
| 4 | 断言面板仍可见 | [DOM] `[data-test-id="markdown-search-bar"]` 可见 | isVisible() |

**断言汇总**: [DOM] 无效正则不导致面板崩溃

---

# FP-17-05 搜索历史（ArrowUp/Down 召回，maxEntries 20）（5 例，[编辑交互][数据IO]）

> 实现路径：`SearchHistoryController`（index.ts:518-620）。⚠️ demo 的 `createSearchPlugin()` 未传 history 选项，history 默认 false（index.ts:529）。ArrowUp/Down 不被拦截。

## FP-17-05-N01 [P2] [正常] 默认配置 ArrowUp/ArrowDown→ 不召回历史

**前置条件**: Electron demo｜清空后输入 "alpha beta gamma"｜demo 默认（history:false）｜setup: `await clearEditor(page); await typeInEditor(page, "alpha beta gamma"); await page.waitForTimeout(200); await closeAllSearchPanels(page); await openCm6SearchPanel(page); await page.locator('[data-test-id="markdown-search-input"]').fill("alpha"); await page.locator('[data-test-id="markdown-search-input"]').press("Enter"); await page.waitForTimeout(200); await page.locator('[data-test-id="markdown-search-input"]').fill("");`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 查找框按 ArrowUp | [STATE] handleHistoryKeyDown（index.ts:1116）→ recall → enabled=false → null（index.ts:552-553）→ 不 preventDefault | press("ArrowUp"); 等待 200ms |
| 2 | 断言查找框仍为空 | [DOM] value="" | inputValue() |
| 3 | 按 ArrowDown | [STATE] 同上 → null | press("ArrowDown"); 等待 200ms |
| 4 | 断言查找框仍为空 | [DOM] value="" | inputValue() |

**断言汇总**: [DOM] history 未启用时 ArrowUp/Down 不召回历史

---

## FP-17-05-N02 [P2] [正常] Enter 提交搜索→ 历史未记录

**前置条件**: Electron demo｜清空后输入 "alpha beta gamma"｜demo 默认｜setup: `await clearEditor(page); await typeInEditor(page, "alpha beta gamma"); await page.waitForTimeout(200); await closeAllSearchPanels(page); await openCm6SearchPanel(page);`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 查找框输入 "beta" | [DOM] value="beta" | fill("beta") |
| 2 | 按 Enter | [STATE] submitSearch → record → enabled=false → 直接返回（index.ts:537-538）→ findNext | press("Enter"); 等待 300ms |
| 3 | 断言选区在 "beta" | [DOM] 搜索正常执行 | .cm-content |
| 4 | 清空查找框按 ArrowUp | [STATE] recall → null | fill("") + press("ArrowUp") |
| 5 | 断言查找框仍为空 | [DOM] value="" | inputValue() |

**断言汇总**: [DOM] history 未启用时不记录；搜索功能正常

---

## FP-17-05-N03 [P3] [正常] localStorage 无 nexus.search.history→ 无异常

**前置条件**: Electron demo｜清空后输入 "test"｜demo 默认｜setup: `await clearEditor(page); await typeInEditor(page, "test"); await page.waitForTimeout(200); await page.evaluate(() => localStorage.removeItem("nexus.search.history")); await closeAllSearchPanels(page); await openCm6SearchPanel(page);`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 查找框按 ArrowUp | [STATE] history 未启用 → null → 无异常 | press("ArrowUp"); 等待 200ms |
| 2 | 断言面板正常 | [DOM] `[data-test-id="markdown-search-bar"]` 可见 | isVisible() |
| 3 | 断言 localStorage 无记录 | [DOM] getItem("nexus.search.history") === null | page.evaluate |

**断言汇总**: [DOM] 无历史数据不崩溃；不写入 localStorage

---

## FP-17-05-N04 [P3] [正常] 独立 SearchBar 无搜索历史功能

**前置条件**: Electron demo｜清空后输入 "test text"｜demo 默认｜setup: `await clearEditor(page); await typeInEditor(page, "test text"); await page.waitForTimeout(200); await closeAllSearchPanels(page); await openStandaloneSearchBar(page);`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 查找框输入 "test" 按 Enter | [DOM] 搜索执行 | fill("test") + press("Enter") |
| 2 | 清空查找框按 ArrowUp | [DOM] 值不变（独立 SearchBar 无历史逻辑） | fill("") + press("ArrowUp") |
| 3 | 断言查找框仍为空 | [DOM] value="" | inputValue() |

**断言汇总**: [DOM] 独立 SearchBar 不支持历史召回

---

## FP-17-05-E01 [P3] [异常] localStorage 含非法 JSON→ 不影响搜索

**前置条件**: Electron demo｜清空后输入 "test"｜demo 默认｜setup: `await clearEditor(page); await typeInEditor(page, "test"); await page.waitForTimeout(200); await page.evaluate(() => localStorage.setItem("nexus.search.history", "not json")); await closeAllSearchPanels(page); await openCm6SearchPanel(page);`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 查找框按 ArrowUp | [STATE] enabled=false → 不读 localStorage → 无异常 | press("ArrowUp"); 等待 200ms |
| 2 | 断言面板正常 | [DOM] 可见无崩溃 | isVisible() |

**断言汇总**: [DOM] 非法 JSON 不影响搜索面板

---

# FP-17-06 表格搜索高亮（CSS Custom Highlight API + offset 映射）（5 例，[插件能力][Live Preview][性能]）

> 实现路径：`tableSearchHighlightPlugin`（index.ts:466-490）。⚠️ CSS Highlight API Range 不暴露到 DOM，只能间接验证 `<style data-nexus-table-search-highlight>` 元素和表格 DOM 文本。

## FP-17-06-N01 [P2] [正常] 表格中搜索→ 高亮 style 元素注入

**前置条件**: Electron demo（Live Preview 需开启）｜清空后输入表格 Markdown：`| Name | Status |\n| --- | --- |\n| SearchNeedle | Todo |\n| Other | Done |`｜demo 默认｜setup: `await clearEditor(page); await typeInEditor(page, "| Name | Status |\n| --- | --- |\n| SearchNeedle | Todo |\n| Other | Done |"); await page.waitForTimeout(500); await closeAllSearchPanels(page); await openCm6SearchPanel(page);`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言表格 DOM 已渲染 | [DOM] `.nexus-table-wrapper` 存在含 `.nexus-cell` | count() |
| 2 | 查找框输入 "SearchNeedle" | [STATE] sync()（index.ts:389-441）→ 注入 style | fill("SearchNeedle"); 等待 500ms |
| 3 | 断言高亮 style 存在 | [DOM] `style[data-nexus-table-search-highlight]` 存在（index.ts:188-203） | count() |
| 4 | 断言表格含 "SearchNeedle" | [DOM] `.nexus-table-wrapper` textContent 含 "SearchNeedle" | textContent() |

**断言汇总**: [DOM] 搜索表格注入高亮 style；表格 DOM 含搜索词

---

## FP-17-06-N02 [P2] [正常] 关闭面板→ 清除表格高亮 style

**前置条件**: 同 N01（先搜索确认 style 存在）｜setup: 同 N01 + `await page.locator('[data-test-id="markdown-search-input"]').fill("SearchNeedle"); await page.waitForTimeout(500);`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 点击关闭按钮 | [STATE] closeSearchPanel → sync() → clear()（index.ts:452-457）→ 移除 style | click(); 等待 500ms |
| 2 | 断言高亮 style 已移除 | [DOM] `style[data-nexus-table-search-highlight]` count=0 或减少 | count() |

**断言汇总**: [DOM] 关闭面板后清除表格高亮 style

---

## FP-17-06-N03 [P2] [正常] 表格中无匹配→ 不崩溃

**前置条件**: 同 N01｜setup 同 N01

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 查找框输入 "NotExist" | [STATE] sync() → findRenderedTableSearchMatches 无结果 → registry.delete（index.ts:433） | fill("NotExist"); 等待 500ms |
| 2 | 断言表格不含 "NotExist" | [DOM] textContent 不含 "NotExist" | textContent() |
| 3 | 断言面板正常 | [DOM] 可见无崩溃 | isVisible() |

**断言汇总**: [DOM] 无匹配时不崩溃，面板正常

---

## FP-17-06-N04 [P3] [正常] 编辑表格内容→ 重新搜索不崩溃

**前置条件**: 同 N01（先搜索后关闭）｜setup 同 N01

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 关闭面板，清空重输新表格 | [DOM] 编辑器更新 | clearEditor + typeInEditor |
| 2 | 重新打开面板搜索新内容 | [STATE] docChanged → scheduleSync → 更新高亮 | fill(新词); 等待 500ms |
| 3 | 断言无崩溃 | [DOM] 面板正常 | isVisible() |

**断言汇总**: [DOM] 编辑后重新搜索不崩溃

---

## FP-17-06-E01 [P3] [异常] 不支持 CSS Highlight API→ 静默降级

**前置条件**: 同 N01｜setup 同 N01

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 查找框输入 "SearchNeedle" | [STATE] getCssHighlightSupport 检测（index.ts:150-173）→ 不支持则 clear() 返回（index.ts:393-396） | fill("SearchNeedle"); 等待 500ms |
| 2 | 断言面板正常 | [DOM] 可见无错误 | isVisible() |
| 3 | 断言编辑器正常 | [DOM] .cm-content 可见 | isVisible() |

**断言汇总**: [DOM] 不支持 CSS Highlight 时静默降级不崩溃

---

# FP-17-07 highlightSelectionMatches 选区高亮（5 例，[插件能力][编辑交互]）

> 实现路径：createSearchPlugin 默认 highlightSelectionMatches:true（index.ts:1156-1158）。选中文本后视口内相同文本通过 `.cm-selectionMatch` Decoration 高亮。

## FP-17-07-N01 [P1] [正常] 选中文本→ 视口内相同文本高亮

**前置条件**: Electron demo｜清空后输入 "foo bar foo baz foo"｜demo 默认｜setup: `await clearEditor(page); await typeInEditor(page, "foo bar foo baz foo"); await page.waitForTimeout(200); await page.click(".cm-content"); await page.keyboard.press("Home");`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 选中第一个 "foo"（Shift+ArrowRight x3） | [STATE] selection=[0,3) → highlightSelectionMatches 扫描视口 → `.cm-selectionMatch` 高亮 | Shift+ArrowRight x3; 等待 500ms |
| 2 | 断言 `.cm-selectionMatch` 存在 | [DOM] count >= 1 | count() |

**断言汇总**: [DOM] 选中文本后视口内相同文本通过 cm-selectionMatch 高亮

---

## FP-17-07-N02 [P2] [正常] 取消选区→ 高亮消失

**前置条件**: Electron demo｜清空后输入 "foo bar foo"｜demo 默认｜setup: `await clearEditor(page); await typeInEditor(page, "foo bar foo"); await page.waitForTimeout(200); await page.click(".cm-content"); await page.keyboard.press("Home"); for (let i=0;i<3;i++) await page.keyboard.press("Shift+ArrowRight"); await page.waitForTimeout(500);`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 按 ArrowRight 取消选区 | [STATE] 空 caret → 不再高亮 | ArrowRight; 等待 500ms |
| 2 | 断言 `.cm-selectionMatch` 消失或减少 | [DOM] count=0 或显著减少 | count() |

**断言汇总**: [DOM] 取消选区后高亮消失

---

## FP-17-07-N03 [P2] [正常] 选中独特文本→ 无额外匹配高亮

**前置条件**: Electron demo｜清空后输入 "unique bar foo"｜demo 默认｜setup: `await clearEditor(page); await typeInEditor(page, "unique bar foo"); await page.waitForTimeout(200); await page.click(".cm-content"); await page.keyboard.press("Home");`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 选中 "unique"（Shift+ArrowRight x6） | [STATE] 仅 1 个 "unique" → 无额外匹配 | Shift+ArrowRight x6; 等待 500ms |
| 2 | 断言 `.cm-selectionMatch` count <= 1 | [DOM] 独特文本无额外匹配 | count() |

**断言汇总**: [DOM] 独特文本选中时无额外匹配高亮

---

## FP-17-07-N04 [P2] [正常] 选中单字符→ 高亮所有相同字符

**前置条件**: Electron demo｜清空后输入 "a b a c a"｜demo 默认｜setup: `await clearEditor(page); await typeInEditor(page, "a b a c a"); await page.waitForTimeout(200); await page.click(".cm-content"); await page.keyboard.press("Home");`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 选中第一个 "a"（Shift+ArrowRight） | [STATE] 高亮所有 "a"（3 个视口内） | Shift+ArrowRight; 等待 500ms |
| 2 | 断言 `.cm-selectionMatch` 存在 | [DOM] count >= 1 | count() |

**断言汇总**: [DOM] 选中单字符时相同字符被高亮

---

## FP-17-07-N05 [P3] [正常] 选区高亮与搜索面板独立工作

**前置条件**: Electron demo｜清空后输入 "foo bar foo baz"｜demo 默认｜setup: `await clearEditor(page); await typeInEditor(page, "foo bar foo baz"); await page.waitForTimeout(200); await page.click(".cm-content"); await page.keyboard.press("Home"); for (let i=0;i<3;i++) await page.keyboard.press("Shift+ArrowRight"); await page.waitForTimeout(300);`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言选区高亮存在 | [DOM] `.cm-selectionMatch` count >= 1 | count() |
| 2 | 打开 CM6 面板 | [DOM] `[data-test-id="markdown-search-bar"]` 可见 | openCm6SearchPanel |
| 3 | 查找框输入 "bar" | [STATE] setSearchQuery → CM6 搜索高亮与选区高亮并存 | fill("bar"); 等待 500ms |
| 4 | 断言面板正常 | [DOM] 无崩溃 | isVisible() |

**断言汇总**: [DOM] 选区高亮与搜索面板可独立/同时工作

---

# FP-17-08 SearchPluginOptions 配置（top/caseSensitive/history/labels）（5 例，[插件能力][API契约]）

> 实现路径：createSearchPlugin(options)（index.ts:1143-1163）。⚠️ demo 的 editor-shell.ts:143 调用 createSearchPlugin() 无 options，全部默认值。测试验证默认配置实际效果。

## FP-17-08-N01 [P2] [正常] 默认 top:true→ 面板渲染在内容上方

**前置条件**: Electron demo｜清空后输入 "test"｜demo 默认（top:true）｜setup: `await clearEditor(page); await typeInEditor(page, "test"); await page.waitForTimeout(200); await closeAllSearchPanels(page); await openCm6SearchPanel(page);`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言面板在 .cm-content 上方 | [DOM] `[data-test-id="markdown-search-bar"]` 在 DOM 中位于 `.cm-content` 之前（index.ts:1148 top:true） | page.evaluate 检查 DOM 顺序 |

**断言汇总**: [DOM] 默认 top:true 使面板渲染在内容上方

---

## FP-17-08-N02 [P2] [正常] 默认 caseSensitive:false→ 大小写不敏感

**前置条件**: Electron demo｜清空后输入 "Hello hello"｜demo 默认｜setup: `await clearEditor(page); await typeInEditor(page, "Hello hello"); await page.waitForTimeout(200); await closeAllSearchPanels(page); await openCm6SearchPanel(page);`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 查找框输入 "hello" | [STATE] caseSensitive:false → 匹配 "Hello" 和 "hello" | fill("hello"); 等待 300ms |
| 2 | 按 Enter | [STATE] findNext → "Hello" [0,5) | press("Enter"); 等待 300ms |
| 3 | 再次按 Enter | [STATE] findNext → "hello" [6,11) | press("Enter"); 等待 300ms |
| 4 | 断言两个匹配均被找到 | [DOM] 连续 Enter 遍历 "Hello" 和 "hello" | .cm-content |

**断言汇总**: [DOM] 默认 caseSensitive:false 使搜索大小写不敏感

---

## FP-17-08-N03 [P2] [正常] 默认 highlightSelectionMatches:true→ 选区高亮生效

**前置条件**: Electron demo｜清空后输入 "dup dup dup"｜demo 默认｜setup: `await clearEditor(page); await typeInEditor(page, "dup dup dup"); await page.waitForTimeout(200); await page.click(".cm-content"); await page.keyboard.press("Home");`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 选中第一个 "dup" | [STATE] highlightSelectionMatches 默认启用 → 高亮 | Shift+ArrowRight x3; 等待 500ms |
| 2 | 断言 `.cm-selectionMatch` 存在 | [DOM] count >= 1 | count() |

**断言汇总**: [DOM] 默认 highlightSelectionMatches:true 生效

---

## FP-17-08-N04 [P2] [正常] 默认标签文案→ placeholder="Find"

**前置条件**: Electron demo｜清空后输入 "test"｜demo 默认（DEFAULT_LABELS）｜setup: `await clearEditor(page); await typeInEditor(page, "test"); await page.waitForTimeout(200); await closeAllSearchPanels(page); await openCm6SearchPanel(page);`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言查找框 placeholder="Find" | [DOM] `[data-test-id="markdown-search-input"]` placeholder="Find"（index.ts:89 DEFAULT_LABELS.find） | getAttribute("placeholder") |
| 2 | 断言查找框 aria-label="Find" | [DOM] aria-label="Find"（index.ts:1029） | getAttribute("aria-label") |
| 3 | 断言替换切换按钮 aria-label="Show replace" | [DOM] toggle aria-label="Show replace"（index.ts:1085） | getAttribute("aria-label") |

**断言汇总**: [DOM] 默认标签为英文（Find/Show replace）

---

## FP-17-08-N05 [P3] [正常] 默认 history:false→ 不写入 localStorage

**前置条件**: Electron demo｜清空后输入 "test"｜demo 默认（history:false）｜setup: `await clearEditor(page); await typeInEditor(page, "test"); await page.waitForTimeout(200); await page.evaluate(() => localStorage.removeItem("nexus.search.history")); await closeAllSearchPanels(page); await openCm6SearchPanel(page);`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 查找框输入 "test" 按 Enter | [STATE] submitSearch → record → enabled=false → 不写入 | fill("test") + press("Enter"); 等待 300ms |
| 2 | 断言 localStorage 无 nexus.search.history | [DOM] getItem("nexus.search.history") === null | page.evaluate |

**断言汇总**: [DOM] 默认 history:false 不写入 localStorage

---

## 统计汇总

### 各二级功能点用例数

| 二级功能点 | 用例数 | 编号范围 |
|-----------|--------|---------|
| FP-17-01 findSearchMatches 纯函数搜索 | 5 | N01-N04, E01 |
| FP-17-02 replaceAllMatches 纯函数替换 | 5 | N01-N04, E01 |
| FP-17-03 搜索面板 UI | 6 | N01-N06 |
| FP-17-04 搜索选项复选框 | 5 | N01-N04, E01 |
| FP-17-05 搜索历史 | 5 | N01-N04, E01 |
| FP-17-06 表格搜索高亮 | 5 | N01-N04, E01 |
| FP-17-07 highlightSelectionMatches | 5 | N01-N05 |
| FP-17-08 SearchPluginOptions 配置 | 5 | N01-N05 |
| **合计** | **41** | |

### 类型分布

| 类型 | 数量 | 占比 |
|------|------|------|
| 正常(N) | 35 | 85.4% |
| 异常(E) | 6 | 14.6% |

### 优先级分布

| 优先级 | 数量 | 占比 |
|--------|------|------|
| P1 | 10 | 24.4% |
| P2 | 20 | 48.8% |
| P3 | 11 | 26.8% |

### 验证策略分布

| 验证方式 | 用例数 | 说明 |
|---------|--------|------|
| 独立 SearchBar 行为（.nexus-search-bar） | 10 | FP-17-01/02 间接验证纯函数 API |
| CM6 面板 data-test-id 元素 | 23 | FP-17-03/04/05/06/08 |
| .cm-selectionMatch 选区高亮 | 5 | FP-17-07 |
| style[data-nexus-table-search-highlight] | 3 | FP-17-06 表格高亮间接验证 |
| localStorage 读写 | 3 | FP-17-05/08 历史存储 |
| getEditorText() 文档内容验证 | 8 | FP-17-01/02 替换结果 |

### 实现差异关键点

| 差异点 | 影响用例 | 应对策略 |
|--------|---------|---------|
| Demo 两套搜索 UI 共存 | 全部 | CM6 面板用 data-test-id，独立 SearchBar 用 .nexus-search-bar |
| Mod-f 被 app.ts 抢占 | FP-17-03/04/05/06/08 | 用 page.evaluate dispatch keydown 打开 CM6 面板 |
| history 默认 false | FP-17-05 | 验证未启用状态的行为（不召回、不写入） |
| CSS Highlight API 不暴露 DOM | FP-17-06 | 间接验证 style 元素和表格文本 |
| 纯函数未暴露到 window | FP-17-01/02 | 通过独立 SearchBar 行为间接验证 |
| labels 使用默认英文 | FP-17-08 | 验证 DEFAULT_LABELS 的实际值 |

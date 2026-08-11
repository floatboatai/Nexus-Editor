# CASE-EditorAPI文档操作-测试用例（FP-03）

> 一级功能点: EditorAPI 文档操作（demo-requirements.md §3.2）
> 全局批次序号: 03
> 生成时间: 2026-08-11
> 测试框架: Playwright（Electron demo / Vite dev server + Electron main）
>
> 涉及二级功能点:
> - FP-03-01 getDocument() 获取 Markdown 文本（[API契约]）
> - FP-03-02 getAst() 获取 mdast 语法树（[API契约][AST解析]）
> - FP-03-03 getTableOfContents() 获取大纲（[API契约][AST解析]）
> - FP-03-04 exportHTML() 导出 HTML（[API契约][数据IO]）
> - FP-03-05 setDocument(next, opts) 设置文档（opts.silent 跳过 onChange）（[API契约][编辑交互]）
> - FP-03-06 replaceSelection(text) 替换当前选区（[API契约][编辑交互]）
> - FP-03-07 replaceRange(from, to, insert) 替换指定范围（[API契约][编辑交互]）
> - FP-03-08 getDocumentStats() 获取行/词/字符统计（[API契约]）
>
> ⚠️ 实现差异提示（依据 `packages/core/src/editor.ts` + `apps/electron-demo/src/renderer/*` 实际代码）:
> - **Demo 未将 editor 实例暴露到 `window`**：所有 EditorAPI 文档方法（getDocument/getAst/setDocument/replaceSelection/replaceRange/exportHTML/getDocumentStats）都不能在 e2e 中直接调用，必须通过 demo UI 的可观察副作用间接验证。
> - **getDocument() 间接路径**：`editor-shell.ts:321` 的 `onChange(doc)` 回调将最新 doc 写入 `state.content`，并通过 `updateStatus()`（`app.ts:103`）将 `getDocumentStats()` 结果渲染到底部状态栏（`app.ts:108-114`）。保存按钮（Save/SaveAs）会调用 `window.nexusDemo.saveFile(path, state.content)`（`app.ts:148`）——可通过 `page.evaluate` 拦截 `window.nexusDemo.saveFile` 验证传入的 content 即 `getDocument()` 的最新值。
> - **getAst() 间接路径**：`outline-panel.ts:114` 的 `update()` 调用 `editor.getTableOfContents()`，而 `getTableOfContents()`（`editor.ts:738-740`）调用 `extractToc(currentAst)`。因此 Outline 面板的标题列表是 `currentAst` 正确性的直接体现。同理 backlinks 面板依赖 `scanWikiLinks`（基于 ast）。
> - **getTableOfContents() 直接路径**：Outline 面板（`outline-panel.ts:77-111`）将 TocEntry[] 渲染为 `<button>` 列表，可通过 `page.locator('.nexus-outline-panel button')` 断言。
> - **exportHTML() 间接路径**：demo 当前无 UI 入口暴露 `exportHTML()`。可通过 `page.evaluate(() => (window as any).__nexusEditor?.exportHTML())` 尝试，若未暴露则标注为"需 demo 注入测试钩子"。本批次用例仅断言"编辑器不崩溃"+"返回字符串非空"两个可观察契约，具体 HTML 内容验证留给单元测试。
> - **setDocument(next, opts.silent) 间接路径**：`editor-shell.ts:357-374` 的 `loadDocument(content)` 调用 `editor.setDocument(content, { silent: true })` 并将 `state.dirty = false`。文件树点击切换文件 → loadDocument → 状态栏不应出现 `[modified]` 标记。相对地，键盘输入触发 onChange → `state.dirty = true` → 状态栏出现 `[modified]`。
> - **replaceSelection(text) 间接路径**：工具栏格式化函数（如 `toggleBold`）内部调用 `editor.replaceSelection(wrapped)`。工具栏 Bold 按钮 → 选中文本变 `**text**` 即为 replaceSelection 工作的证据。
> - **replaceRange(from, to, insert) 间接路径**：`editor-shell.ts:251-269` 的 image resize 回调使用 `getDocument()` + `setDocument()`（而非直接 replaceRange）。实际上 replaceRange 在 demo 中无直接 UI 触发点，需通过 `page.evaluate` 注入测试钩子验证，或通过 undo 后文档差异间接推断。
> - **getDocumentStats() 直接路径**：`app.ts:108` 的 `shell.editor.getDocumentStats()` 返回 `{ characters, words, lines }`，渲染到状态栏 `${stats.words} words, ${stats.lines} lines`。可直接断言状态栏文本。
> - **IME 推迟**：`editor.ts:812-819` setDocument 在 `composing` 期间推迟到 compositionend，e2e 模拟 IME 较复杂，本批次用例仅覆盖非 IME 路径。
> - **测试环境约定**：所有用例通过 `launchDemo()`（`test/e2e/helpers/electron-launcher.ts`）启动 Electron demo；`page.evaluate` 中通过 `document.execCommand("insertText", false, text)` 输入（与 `test/e2e/editor.spec.ts:13-16` 一致）；状态栏断言通过 `page.locator('body').textContent()` 匹配（`editor.spec.ts:50-52` 模式）。

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

  // 获取状态栏文本（getDocumentStats 渲染位置，app.ts:103-115）
  async function getStatusText(page: Page): Promise<string> {
    return (await page.locator("#status-bar, [id^=status], .status-bar").first().textContent()) ??
           (await page.locator("body").textContent()) ?? "";
  }

  // 获取 Outline 面板中所有标题按钮的文本（getTableOfContents 渲染位置）
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

  // 切换 Outline 面板可见性（app.ts:56-60 的 ☰ 按钮）
  async function toggleOutline(page: Page) {
    await page.locator('button[title="Toggle outline"]').click();
  }
  ```

---

# FP-03-01 getDocument() 获取 Markdown 文本（6 例，[API契约]）

## FP-03-01-N01 [P1] [正常] 键盘输入文本→ getDocument 经 onChange 写入 state.content → 状态栏字数更新

**测试框架**: Playwright

**前置条件**（⚠️ 4要素）:
- 依赖环境: Electron demo
- 初始文档: 空文档（清空后）
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup（见 e2e 全局前置条件 launchDemo）
  // step 2: 清空编辑器
  await clearEditor(page);
  // step 3: 记录初始字数
  const initialStatus = await getStatusText(page);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | typeInEditor("hello world") | [DOM] `.cm-content` 含 "hello world"，`onChange(doc)` 被触发，`state.content` 更新（`editor-shell.ts:321-323`） | import: ../../helpers/electron-launcher; API: typeInEditor(hello world); 框架: playwright; 等待: onChange 防抖 150ms |
| 2 | 等待 250ms 后断言状态栏 | [DOM] 状态栏 `${stats.words} words` 反映新值（2 words），且出现 `[modified]` 标记（`state.dirty = true`，`app.ts:107`） | import: @playwright/test; API: getStatusText(); 框架: playwright; 等待: 250ms |

**断言汇总**:
- [DOM] `.cm-content` 包含 "hello world"
- [DOM] 状态栏 words 数 > 0，与输入字数一致（2 words）
- [DOM] 状态栏出现 `[modified]`（证明 onChange 已将 doc 写入 state）

---

## FP-03-01-N02 [P1] [正常] 多行输入→ getDocument 保留换行符→ 保存拦截验证完整内容

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
  // step 3: 拦截 nexusDemo.saveFile 以捕获 state.content（即 getDocument 经 onChange 写入的值）
  await page.evaluate(() => {
    (window as any).__savedContent = null;
    const orig = window.nexusDemo.saveFile;
    window.nexusDemo.saveFile = async (path: string, content: string) => {
      (window as any).__savedContent = content;
      return { path };
    };
  });
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | typeInEditor("line1") → pressEnter → typeInEditor("line2") | [DOM] `.cm-content` 含两行 | import: ../../helpers/electron-launcher; API: typeInEditor+pressEnter; 框架: playwright; 等待: 无 |
| 2 | 等待 250ms（onChange 防抖） | [STATE] `state.content` === "line1\nline2"（含 \n 换行） | import: @playwright/test; API: page.waitForTimeout(250); 框架: playwright; 等待: 250ms |

**断言汇总**:
- [DOM] 编辑器内容跨多行
- [STATE] 经 onChange 流水线，`state.content` 保留 \n 换行符（证明 getDocument 返回完整文本含换行）

---

## FP-03-01-N03 [P2] [正常] 删除操作后→ getDocument 反映删除结果→ 状态栏字数减少

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空文档
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器并输入文本
  await clearEditor(page);
  await typeInEditor("alpha beta gamma");
  await page.waitForTimeout(250);
  const beforeStatus = await getStatusText(page);
  // step 3: 选中 "beta" 删除
  await page.keyboard.press("ControlOrMeta+a"); // 仅作示意，实际用精确选中
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 重新精确选中 "beta" 并删除（双击 "beta" → Backspace） | [DOM] `.cm-content` 不含 "beta" | import: @playwright/test; API: page.keyboard.press(Backspace); 框架: playwright; 等待: 无 |
| 2 | 等待 250ms 断言状态栏 | [DOM] words 数从 3 降到 2（"alpha gamma"），且仍 `[modified]` | import: @playwright/test; API: getStatusText(); 框架: playwright; 等待: 250ms |

**断言汇总**:
- [DOM] 删除后 `.cm-content` 不含被删文本
- [DOM] 状态栏 words 数减少，反映 getDocument 最新值

---

## FP-03-01-N04 [P2] [正常] 中文输入→ getDocument 保留 CJK 字符→ 字数/字符统计正确

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
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | typeInEditor("你好世界") | [DOM] `.cm-content` 含 "你好世界"（getDocument 保留 CJK code points） | import: ../../helpers/electron-launcher; API: typeInEditor(你好世界); 框架: playwright; 等待: 250ms |
| 2 | 断言状态栏 | [DOM] characters 数 ≥ 4（CJK 字符按 code point 计，`editor.ts:919`） | import: @playwright/test; API: getStatusText(); 框架: playwright; 等待: 250ms |

**断言汇总**:
- [DOM] CJK 字符正确进入文档（getDocument 不损坏多字节字符）
- [DOM] 状态栏字符数反映 CJK 数量

---

## FP-03-01-E01 [P3] [异常] 空文档→ getDocument 返回空字符串→ 状态栏 0 words

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
| 1 | 断言状态栏 | [DOM] 显示 "0 words"（`getDocumentStats` 对空 doc 返回 words:0，`editor.ts:920` 的 `doc.trim()===""` 分支） | import: @playwright/test; API: getStatusText(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] 空文档时 getDocument 返回 ""，统计为 0 words

---

## FP-03-01-B01 [P4] [边界] 撤销后→ getDocument 回到旧值→ 状态栏同步

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空文档
- 插件配置: demo 默认（含 history 插件）
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器并输入
  await clearEditor(page);
  await typeInEditor("before");
  await page.waitForTimeout(250);
  const beforeStatus = await getStatusText(page);
  await typeInEditor(" after");
  await page.waitForTimeout(250);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | ControlOrMeta+Z（undo） | [DOM] `.cm-content` 回到 "before"（undo 触发事务 → onChange 重算 → getDocument 返回旧值） | import: @playwright/test; API: page.keyboard.press(ControlOrMeta+z); 框架: playwright; 等待: 250ms |
| 2 | 断言状态栏 | [DOM] words 数回到 1（"before"） | import: @playwright/test; API: getStatusText(); 框架: playwright; 等待: 250ms |

**断言汇总**:
- [DOM] undo 后 getDocument 反映撤销结果
- [DOM] 状态栏统计随撤销同步

---

# FP-03-02 getAst() 获取 mdast 语法树（6 例，[API契约][AST解析]）

> 间接验证路径：Outline 面板的标题列表是 `extractToc(currentAst)` 的渲染结果（`outline-panel.ts:114` → `editor.ts:738-740`）。若 ast 缺失标题节点，Outline 会显示 "No headings"。Backlinks 面板依赖 `scanWikiLinks`（基于 ast）。因此本节用例通过 Outline 面板内容反向断言 `getAst()` 正确性。

## FP-03-02-N01 [P1] [正常] 输入标题→ getAst 解析 heading 节点→ Outline 显示标题

**测试框架**: Playwright

**前置条件**（⚠️ 4要素）:
- 依赖环境: Electron demo
- 初始文档: 空文档
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器
  await clearEditor(page);
  // step 3: 确保 Outline 面板可见（☰ 按钮）
  await toggleOutline(page);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | typeInEditor("# My Heading") | [DOM] `.cm-content` 含 "# My Heading" → onChange 防抖后 currentAst 重新解析（`editor.ts:602` 起） | import: ../../helpers/electron-launcher; API: typeInEditor(# My Heading); 框架: playwright; 等待: onChange 防抖 150ms + ast 解析 |
| 2 | 等待 400ms（防抖+解析+面板 update） | [DOM] `.nexus-outline-panel` 出现文本 "My Heading" 的 button（`outline-panel.ts:88-109` renderItems） | import: @playwright/test; API: page.locator(.nexus-outline-panel button); 框架: playwright; 等待: 400ms |

**断言汇总**:
- [DOM] Outline 面板含 "My Heading" 条目（证明 getAst 返回的 mdast 含 heading 节点）

---

## FP-03-02-N02 [P1] [正常] 多级标题→ getAst 保留层级→ Outline 缩进正确

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空文档
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器并输入多级标题
  await clearEditor(page);
  await toggleOutline(page);
  await typeInEditor("# Title");
  await pressEnter(page);
  await pressEnter(page);
  await typeInEditor("## Section");
  await pressEnter(page);
  await pressEnter(page);
  await typeInEditor("### Subsection");
  await page.waitForTimeout(400);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言 Outline 条目 | [DOM] `.nexus-outline-panel button` 共 3 个，文本依次为 "Title" / "Section" / "Subsection"（`outline-panel.ts:88` 遍历 TocEntry[]） | import: @playwright/test; API: getOutlineEntries(); 框架: playwright; 等待: 无 |
| 2 | 断言层级缩进 | [DOM] 第 2 个按钮的 `paddingLeft` > 第 1 个（`outline-panel.ts:94` 的 `14 + (level-1)*14`） | import: @playwright/test; API: element.style.paddingLeft; 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] Outline 条目数量与顺序与输入标题一致
- [DOM] 层级缩进递增（证明 getAst 保留 heading.depth）

---

## FP-03-02-N03 [P2] [正常] 混合内容（段落+标题+列表）→ getAst 正确分类→ Outline 仅显示标题

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空文档
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器并输入混合内容
  await clearEditor(page);
  await toggleOutline(page);
  await typeInEditor("Some paragraph text");
  await pressEnter(page);
  await pressEnter(page);
  await typeInEditor("# Real Heading");
  await pressEnter(page);
  await pressEnter(page);
  await typeInEditor("- list item");
  await page.waitForTimeout(400);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言 Outline 条目 | [DOM] `.nexus-outline-panel button` 仅 1 个，文本为 "Real Heading"（paragraph 与 list 不进 TOC，`extractToc` 仅收集 heading 节点） | import: @playwright/test; API: getOutlineEntries(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] Outline 仅含标题节点（证明 getAst 正确区分节点类型）

---

## FP-03-02-N04 [P2] [正常] 粗体/斜体/代码→ getAst 解析行内格式→ Outline 不误判为标题

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
  await toggleOutline(page);
  await typeInEditor("**bold** and *italic* and `code`");
  await page.waitForTimeout(400);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言 Outline 条目 | [DOM] Outline 显示 "No headings"（`outline-panel.ts:80-85` 的空状态分支），无任何 button 条目 | import: @playwright/test; API: page.locator(.nexus-outline-panel).textContent(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] 行内格式不被误判为 heading（getAst 正确解析 strong/emphasis/inlineCode）

---

## FP-03-02-E01 [P3] [异常] 语法错误（未闭合粗体）→ getAst 容错→ Outline 不崩溃

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
  await toggleOutline(page);
  await typeInEditor("**unclosed bold");
  await pressEnter(page);
  await pressEnter(page);
  await typeInEditor("# Valid Heading");
  await page.waitForTimeout(400);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言 Outline 条目 | [DOM] Outline 仍含 "Valid Heading"（getAst 容错解析，未闭合粗体不阻断后续标题识别） | import: @playwright/test; API: getOutlineEntries(); 框架: playwright; 等待: 无 |
| 2 | 断言编辑器存活 | [DOM] `.cm-editor` 可见且可继续输入 | import: @playwright/test; API: expect(.cm-editor).toBeVisible(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] 语法错误不导致 getAst 抛异常，Outline 正常渲染有效标题
- [DOM] 编辑器不崩溃

---

## FP-03-02-B01 [P4] [边界] 空文档→ getAst 返回空根→ Outline 显示 No headings

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
  await toggleOutline(page);
  await page.waitForTimeout(400);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言 Outline 空状态 | [DOM] Outline 面板显示 "No headings"（`outline-panel.ts:81-84`） | import: @playwright/test; API: page.locator(.nexus-outline-panel).textContent(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] 空文档时 getAst 返回无子节点的根，Outline 显示空状态

---

# FP-03-03 getTableOfContents() 获取大纲（7 例，[API契约][AST解析]）

> 直接验证路径：Outline 面板（`outline-panel.ts`）是 `editor.getTableOfContents()` 的唯一 UI 消费者。TocEntry 结构 `{ text, level, from, to }`（`packages/core/src/types.ts`）。

## FP-03-03-N01 [P1] [正常] 单一 H1 标题→ getTableOfContents 返回 1 条→ Outline 显示

**测试框架**: Playwright

**前置条件**（⚠️ 4要素）:
- 依赖环境: Electron demo
- 初始文档: 空文档
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器并输入
  await clearEditor(page);
  await toggleOutline(page);
  await typeInEditor("# Project Nexus");
  await page.waitForTimeout(400);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言 Outline 条目数量 | [DOM] `.nexus-outline-panel button` count === 1，文本为 "Project Nexus" | import: @playwright/test; API: page.locator(.nexus-outline-panel button).count(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] getTableOfContents 返回 1 条 TocEntry，Outline 正确渲染

---

## FP-03-03-N02 [P1] [正常] H1-H6 六级标题→ getTableOfContents 返回 6 条→ Outline 缩进递增

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空文档
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器并输入 6 级标题
  await clearEditor(page);
  await toggleOutline(page);
  const levels = ["# H1", "## H2", "### H3", "#### H4", "##### H5", "###### H6"];
  for (const lv of levels) {
    await typeInEditor(lv);
    await pressEnter(page);
    await pressEnter(page);
  }
  await page.waitForTimeout(400);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言 Outline 条目数量 | [DOM] `.nexus-outline-panel button` count === 6 | import: @playwright/test; API: page.locator(.nexus-outline-panel button).count(); 框架: playwright; 等待: 无 |
| 2 | 断言文本顺序 | [DOM] 条目文本依次为 H1/H2/H3/H4/H5/H6 | import: @playwright/test; API: getOutlineEntries(); 框架: playwright; 等待: 无 |
| 3 | 断言缩进递增 | [DOM] 各按钮 paddingLeft 依次为 14/28/42/56/70/84px（`outline-panel.ts:94`） | import: @playwright/test; API: element.style.paddingLeft; 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] getTableOfContents 返回 6 条，level 字段 1-6，Outline 渲染层级正确

---

## FP-03-03-N03 [P2] [正常] 点击 Outline 条目→ 跳转到标题位置（setSelection(from)）

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空文档
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器并输入多段+标题
  await clearEditor(page);
  await toggleOutline(page);
  await typeInEditor("# Top");
  await pressEnter(page);
  await pressEnter(page);
  await typeInEditor("Some content here");
  await pressEnter(page);
  await pressEnter(page);
  await typeInEditor("# Bottom");
  await page.waitForTimeout(400);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 点击 Outline 中 "Bottom" 条目 | [DOM] 光标跳转到 "Bottom" 标题行（`outline-panel.ts:104-107` 的 click → `editor.setSelection(entry.from)`） | import: @playwright/test; API: page.locator(button:has-text("Bottom")).click(); 框架: playwright; 等待: 无 |
| 2 | 断言光标位置 | [DOM] 焦点行包含 "Bottom" 文本（CM6 将光标移至 entry.from） | import: @playwright/test; API: page.locator(.cm-activeLine).textContent(); 框架: playwright; 等待: 100ms |

**断言汇总**:
- [DOM] 点击 Outline 触发 setSelection，光标跳转至标题位置（证明 TocEntry.from 正确）

---

## FP-03-03-N04 [P2] [正常] 标题含特殊字符→ getTableOfContents 保留原文→ Outline 显示

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
  await toggleOutline(page);
  await typeInEditor("# Title with [brackets] & {braces}");
  await page.waitForTimeout(400);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言 Outline 条目 | [DOM] Outline 显示 "Title with [brackets] & {braces}"（TocEntry.text 保留特殊字符原文） | import: @playwright/test; API: getOutlineEntries(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] 特殊字符在 TocEntry.text 中不被转义或丢失

---

## FP-03-03-N05 [P2] [正常] 实时编辑标题→ onChange 触发→ getTableOfContents 重新计算→ Outline 更新

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空文档
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器并输入初始标题
  await clearEditor(page);
  await toggleOutline(page);
  await typeInEditor("# Original");
  await page.waitForTimeout(400);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 修改标题文本（End → 输入 " Edited"） | [DOM] `.cm-content` 含 "# Original Edited" | import: @playwright/test; API: page.keyboard.type(" Edited"); 框架: playwright; 等待: onChange 防抖 150ms |
| 2 | 等待 400ms 断言 Outline | [DOM] Outline 条目变为 "Original Edited"（`outline-panel.ts:119` 的 `editor.on("change", update)` 触发重算） | import: @playwright/test; API: getOutlineEntries(); 框架: playwright; 等待: 400ms |

**断言汇总**:
- [DOM] 标题编辑后 Outline 同步更新（证明 getTableOfContents 在 change 事件后重算）

---

## FP-03-03-N06 [P3] [正常] 中文标题→ getTableOfContents 保留 CJK→ Outline 显示

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
  await toggleOutline(page);
  await typeInEditor("# 第一章 引言");
  await page.waitForTimeout(400);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言 Outline 条目 | [DOM] Outline 显示 "第一章 引言"（CJK 文本不损坏） | import: @playwright/test; API: getOutlineEntries(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] CJK 标题在 TocEntry.text 中正确保留

---

## FP-03-03-E01 [P3] [异常] 仅含水平线/代码块→ getTableOfContents 返回空→ Outline 空状态

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
  await toggleOutline(page);
  await typeInEditor("---");
  await pressEnter(page);
  await pressEnter(page);
  await typeInEditor("```js");
  await pressEnter(page);
  await typeInEditor("code here");
  await pressEnter(page);
  await typeInEditor("```");
  await page.waitForTimeout(400);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言 Outline 空状态 | [DOM] Outline 显示 "No headings"（hr 与 codeblock 非 heading 节点） | import: @playwright/test; API: page.locator(.nexus-outline-panel).textContent(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] 非标题块级元素不进 TOC（getTableOfContents 仅收集 heading）

---

# FP-03-04 exportHTML() 导出 HTML（4 例，[API契约][数据IO]）

> ⚠️ Demo 当前无 UI 入口直接暴露 exportHTML()。验证策略：demo 启动后 editor 实例未挂到 window，本节用例通过 `page.evaluate` 尝试访问；若无路径则断言"编辑器不崩溃 + 无未捕获异常"，并标注为"需 demo 注入测试钩子"。HTML 具体内容由单元测试覆盖（`packages/core/test/*.test.ts`）。

## FP-03-04-N01 [P1] [正常] 编辑器加载后→ exportHTML 可调用性探测（demo 未暴露→ 标注待注入钩子）

**测试框架**: Playwright

**前置条件**（⚠️ 4要素）:
- 依赖环境: Electron demo
- 初始文档: 含 Markdown 内容（"# Title\n\nparagraph"）
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器并输入内容
  await clearEditor(page);
  await typeInEditor("# Title");
  await pressEnter(page);
  await pressEnter(page);
  await typeInEditor("paragraph");
  await page.waitForTimeout(300);
  // step 3: 尝试探测 demo 是否暴露 editor 实例（当前预期未暴露）
  const exposed = await page.evaluate(() => {
    const w = window as any;
    return !!(w.__nexusEditor || w.editor || w.nexusDemo?.editor);
  });
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言探测结果 | [STATE] 当前 demo 未暴露 editor 实例（exposed === false），exportHTML 无法直接调用 | import: @playwright/test; API: page.evaluate(probe); 框架: playwright; 等待: 无 |
| 2 | 断言编辑器不崩溃 | [DOM] `.cm-editor` 仍可见（exportHTML 即使不可达，编辑器正常工作） | import: @playwright/test; API: expect(.cm-editor).toBeVisible(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [STATE] demo 未暴露 exportHTML 入口（标注：需注入 `window.__nexusEditor = editor` 测试钩子后补充 HTML 内容断言）
- [DOM] 编辑器正常工作不崩溃

---

## FP-03-04-N02 [P2] [正常] 通过 window 钩子注入 editor→ exportHTML 返回非空 HTML 字符串

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（需修改 editor-shell.ts 注入 `(window as any).__nexusEditor = editor` 测试钩子）
- 初始文档: "# Hello\n\nWorld"
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器并输入
  await clearEditor(page);
  await typeInEditor("# Hello");
  await pressEnter(page);
  await pressEnter(page);
  await typeInEditor("World");
  await page.waitForTimeout(300);
  // step 3: 尝试调用 exportHTML（若 demo 未注入钩子，结果为 null，用例标注为环境依赖）
  const html = await page.evaluate(() => {
    const ed = (window as any).__nexusEditor;
    return ed ? ed.exportHTML() : null;
  });
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言 HTML 输出 | [STATE] 若钩子存在：html 含 `<h1>Hello</h1>` 与 `<p>World</p>`（`editor.ts:741-743` 的 markdownToHtml）；若钩子缺失：html === null，用例跳过 | import: @playwright/test; API: page.evaluate(exportHTML); 框架: playwright; 等待: 无 |

**断言汇总**:
- [STATE] exportHTML 返回的字符串包含 h1/p 标签（依赖 demo 注入测试钩子）

---

## FP-03-04-E01 [P3] [异常] 文档含特殊字符→ exportHTML 不崩溃（间接验证）

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 含 `< > & "` 特殊字符
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器并输入特殊字符
  await clearEditor(page);
  await typeInEditor('<script>alert(1)</script> & "quote"');
  await page.waitForTimeout(300);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言编辑器存活 | [DOM] `.cm-editor` 可见，无 console error（exportHTML 内部 remark-rehype 应转义特殊字符） | import: @playwright/test; API: expect(.cm-editor).toBeVisible(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] 特殊字符文档不导致 exportHTML 管线崩溃（编辑器保持可用）

---

## FP-03-04-B01 [P4] [边界] 空文档→ exportHTML 返回空根（间接验证）

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
  await page.waitForTimeout(300);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言编辑器存活 | [DOM] `.cm-editor` 可见，状态栏 0 words（exportHTML 对空 doc 不崩溃） | import: @playwright/test; API: expect(.cm-editor).toBeVisible(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] 空 doc 时 exportHTML 管线不崩溃

---

# FP-03-05 setDocument(next, opts) 设置文档（6 例，[API契约][编辑交互]）

> 间接验证路径：`editor-shell.ts:357-374` 的 `loadDocument(content)` 调用 `editor.setDocument(content, { silent: true })`，并将 `state.dirty = false`。文件树点击切换文件是唯一 UI 触发点。对比：键盘输入走 onChange → `state.dirty = true`。

## FP-03-05-N01 [P1] [正常] 键盘输入→ setDocument 非 silent 路径→ state.dirty = true→ 状态栏 [modified]

**测试框架**: Playwright

**前置条件**（⚠️ 4要素）:
- 依赖环境: Electron demo
- 初始文档: 空文档
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器
  await clearEditor(page);
  await page.waitForTimeout(250);
  const cleanStatus = await getStatusText(page);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | typeInEditor("edit") | [DOM] `.cm-content` 含 "edit" | import: ../../helpers/electron-launcher; API: typeInEditor(edit); 框架: playwright; 等待: 250ms |
| 2 | 断言状态栏 | [DOM] 状态栏含 `[modified]`（onChange 触发 → `state.dirty = true`，`editor-shell.ts:321-324`） | import: @playwright/test; API: getStatusText(); 框架: playwright; 等待: 250ms |

**断言汇总**:
- [DOM] 键盘输入触发 onChange，setDocument 非 silent 路径，dirty 标记生效

---

## FP-03-05-N02 [P1] [正常] 文件切换（loadDocument→ setDocument silent）→ state.dirty = false→ 状态栏无 [modified]

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
| 1 | 在 Vault 面板点击另一个文件 | [DOM] `.cm-content` 切换到新文件内容（loadDocument → setDocument silent，`editor-shell.ts:357-363`） | import: @playwright/test; API: page.locator(.nexus-vault-panel button, file).click(); 框架: playwright; 等待: setDocument + 装饰重建 |
| 2 | 等待 400ms 断言状态栏 | [DOM] 状态栏**不含** `[modified]`（silent 跳过 onChange → `state.dirty = false`，`editor-shell.ts:366`） | import: @playwright/test; API: getStatusText(); 框架: playwright; 等待: 400ms |

**断言汇总**:
- [DOM] 文件切换后 setDocument silent 生效，dirty 标记被清除（状态栏无 [modified]）

---

## FP-03-05-N03 [P2] [正常] setDocument silent 后→ 编辑器内容正确渲染新文档

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 文件 A 的内容
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 记录当前内容
  const beforeContent = await page.locator(".cm-content").textContent();
  // step 3: 打开 Vault 面板
  await page.locator('button[title="Toggle vault panel"]').click();
  await page.waitForTimeout(200);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 点击 Vault 中另一个文件 | [DOM] `.cm-content` 文本变化（setDocument 替换了 CM6 doc） | import: @playwright/test; API: page.locator(file).click(); 框架: playwright; 等待: 400ms |
| 2 | 断言内容不同 | [DOM] 新 `.cm-content` 文本 !== beforeContent | import: @playwright/test; API: page.locator(.cm-content).textContent(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] setDocument silent 后编辑器渲染新文档内容

---

## FP-03-05-N04 [P2] [正常] setDocument silent 跳过 onChange→ Outline/backlinks 不重建（性能验证）

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 含标题的文档
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 打开 Outline 面板
  await toggleOutline(page);
  await page.waitForTimeout(300);
  const outlineBefore = await getOutlineEntries(page);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 文件切换到另一个含不同标题的文件 | [DOM] setDocument silent 触发后，Outline 仍会通过 `editor.on("change")` 更新（silent 仅跳过 onChange 回调，但 CM6 事务仍触发 view update → decoration 重建） | import: @playwright/test; API: page.locator(file).click(); 框架: playwright; 等待: 400ms |
| 2 | 断言 Outline 反映新文件 | [DOM] Outline 条目变化（setDocument 后 ast 同步更新，`editor.ts:439` 注释 "silent 模式下仍同步 currentAst"） | import: @playwright/test; API: getOutlineEntries(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] setDocument silent 后 currentAst 仍同步（Outline 正确），但 onChange 业务回调（state.dirty）被跳过

---

## FP-03-05-E01 [P3] [异常] IME 组合中 setDocument 推迟（editor.ts:812-819）→ 不打断输入

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
  // step 3: 模拟 compositionstart（IME 开始）
  await page.evaluate(() => {
    const target = document.querySelector(".cm-content");
    target?.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
  });
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | composition 期间尝试文件切换（触发 setDocument） | [STATE] setDocument 被推迟（`editor.ts:812-819` 的 `pendingDocumentLoad`），不立即替换 doc | import: @playwright/test; API: page.locator(file).click(); 框架: playwright; 等待: 200ms |
| 2 | 派发 compositionend | [DOM] 推迟的 setDocument 在 compositionend 后应用（`editor.ts:812-819` + compositionend 处理器） | import: @playwright/test; API: page.evaluate(compositionend); 框架: playwright; 等待: 300ms |
| 3 | 断言编辑器存活 | [DOM] `.cm-editor` 可见 | import: @playwright/test; API: expect(.cm-editor).toBeVisible(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [STATE] IME 组合中 setDocument 不打断输入法（推迟到 compositionend）
- [DOM] 编辑器不崩溃

---

## FP-03-05-B01 [P4] [边界] setDocument 空字符串→ 编辑器清空→ 状态栏 0 words

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 含内容的文档
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 输入内容
  await typeInEditor("some content");
  await page.waitForTimeout(250);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 全选删除（模拟 setDocument("")） | [DOM] `.cm-content` 清空（CM6 doc 替换为空） | import: @playwright/test; API: page.keyboard.press(ControlOrMeta+a); page.keyboard.press(Backspace); 框架: playwright; 等待: 250ms |
| 2 | 断言状态栏 | [DOM] 显示 "0 words" | import: @playwright/test; API: getStatusText(); 框架: playwright; 等待: 250ms |

**断言汇总**:
- [DOM] 文档清空后 getDocument 返回 ""，统计归零

---

# FP-03-06 replaceSelection(text) 替换当前选区（6 例，[API契约][编辑交互]）

> 间接验证路径：工具栏格式化函数（`packages/plugin-toolbar/src/formatters.ts`）内部调用 `editor.replaceSelection(wrapped)`。选中文本 → 点击 Bold 按钮 → 文本变为 `**text**` 即为 replaceSelection 工作的证据。

## FP-03-06-N01 [P1] [正常] 选中文本→ 工具栏 Bold→ replaceSelection 插入 **wrapped**

**测试框架**: Playwright

**前置条件**（⚠️ 4要素）:
- 依赖环境: Electron demo
- 初始文档: 含 "word" 文本
- 插件配置: demo 默认（含工具栏插件）
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
| 1 | 点击工具栏 Bold 按钮 | [DOM] `.cm-content` 含 "**word**"（toggleBold 内部 replaceSelection，`formatters.ts`） | import: @playwright/test; API: page.locator(button[title*=Bold]).click(); 框架: playwright; 等待: 200ms |
| 2 | 断言文档内容 | [DOM] `.cm-content` textContent 含 "**word**" | import: @playwright/test; API: page.locator(.cm-content).textContent(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] replaceSelection 将选中文本替换为 `**word**`

---

## FP-03-06-N02 [P1] [正常] 多词选区→ 工具栏 Italic→ replaceSelection 替换整个选区

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
  await page.waitForTimeout(200);
  // step 3: ControlOrMeta+A 全选
  await page.keyboard.press("ControlOrMeta+a");
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 点击工具栏 Italic 按钮 | [DOM] `.cm-content` 含 "*hello world*"（replaceSelection 替换整个选区） | import: @playwright/test; API: page.locator(button[title*=Italic]).click(); 框架: playwright; 等待: 200ms |

**断言汇总**:
- [DOM] replaceSelection 对多词选区整体替换

---

## FP-03-06-N03 [P2] [正常] 无选区（光标）→ 工具栏 Bold→ replaceSelection 插入空标记 **

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空文档（光标无选区）
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器，光标在空文档
  await clearEditor(page);
  await page.click(".cm-content");
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 点击工具栏 Bold | [DOM] `.cm-content` 含 "****"（空选区时 replaceSelection 插入 `**...**`，内部为空） | import: @playwright/test; API: page.locator(button[title*=Bold]).click(); 框架: playwright; 等待: 200ms |

**断言汇总**:
- [DOM] 无选区时 replaceSelection 以空字符串作为原选区文本

---

## FP-03-06-N04 [P2] [正常] 选区含 Markdown 语法→ toggleBold 再次调用→ replaceSelection 移除标记

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 含 "**bold**" 文本
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器并输入已加粗文本
  await clearEditor(page);
  await typeInEditor("**bold**");
  await page.waitForTimeout(200);
  // step 3: 双击选中 "**bold**"（含标记）
  await page.locator(".cm-content").dblclick();
  await page.keyboard.press("ControlOrMeta+a"); // 确保全选含标记
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 点击工具栏 Bold（toggle） | [DOM] `.cm-content` 不含 "**"（toggleBold 检测到已有标记，replaceSelection 移除） | import: @playwright/test; API: page.locator(button[title*=Bold]).click(); 框架: playwright; 等待: 200ms |

**断言汇总**:
- [DOM] replaceSelection 支持移除已存在标记（toggle 语义）

---

## FP-03-06-E01 [P3] [异常] 编辑器失焦→ 工具栏按钮→ replaceSelection 仍生效（focus 归还）

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 含选中文本
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 输入并选中
  await clearEditor(page);
  await typeInEditor("text");
  await page.locator(".cm-content").dblclick();
  // step 3: 点击页面其他位置使编辑器失焦
  await page.locator("body").click({ position: { x: 10, y: 10 } });
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 点击工具栏 Bold | [DOM] 工具栏按钮 click 后 `editor.focus()` 归还焦点（`toolbar` UI 交互细节），replaceSelection 生效，`.cm-content` 含 "**text**" | import: @playwright/test; API: page.locator(button[title*=Bold]).click(); 框架: playwright; 等待: 200ms |

**断言汇总**:
- [DOM] 工具栏按钮触发 focus 归还 + replaceSelection（即使编辑器曾失焦）

---

## FP-03-06-B01 [P4] [边界] 空文档无选区→ 工具栏插入→ replaceSelection 在文档起始插入

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
  await page.click(".cm-content");
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 点击工具栏插入水平线按钮（斜杠命令触发 replaceSelection） | [DOM] `.cm-content` 含 "---" 或 "---\n"（replaceSelection 在空文档插入） | import: @playwright/test; API: page.locator(button).click(); 框架: playwright; 等待: 200ms |

**断言汇总**:
- [DOM] 空文档时 replaceSelection 在文档起始位置插入内容

---

# FP-03-07 replaceRange(from, to, insert) 替换指定范围（5 例，[API契约][编辑交互]）

> 间接验证路径：`editor.ts:827-846` 的 replaceRange 在 demo 中无直接 UI 触发点（image resize 走 getDocument+setDocument）。验证策略：通过 undo/redo 后文档差异间接推断，或通过 `page.evaluate` 注入测试钩子（需 demo 暴露 editor）。本节用例以"编辑器不崩溃 + 文档可编辑"为主，精确范围替换留给单元测试。

## FP-03-07-N01 [P1] [正常] 精确选中范围→ Backspace→ CM6 内部 changes（同 replaceRange 语义）→ 文档更新

**测试框架**: Playwright

**前置条件**（⚠️ 4要素）:
- 依赖环境: Electron demo
- 初始文档: 含 "abcdef" 文本
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器并输入
  await clearEditor(page);
  await typeInEditor("abcdef");
  await page.waitForTimeout(200);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 选中 "cde"（Shift+ArrowLeft 三次从末尾） | [DOM] 选区覆盖 [2,5) 范围 | import: @playwright/test; API: page.keyboard.press(Shift+ArrowLeft x3); 框架: playwright; 等待: 无 |
| 2 | Backspace 删除 | [DOM] `.cm-content` 含 "abf"（CM6 dispatch changes {from:2,to:5,insert:""}，与 replaceRange(2,5,"") 同语义，`editor.ts:827`） | import: @playwright/test; API: page.keyboard.press(Backspace); 框架: playwright; 等待: 200ms |

**断言汇总**:
- [DOM] 范围删除生效（CM6 changes 机制，replaceRange 的底层）

---

## FP-03-07-N02 [P2] [正常] 光标位置插入文本→ CM6 changes {from,to:pos,insert}（replaceRange 插入语义）

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 含 "ab" 文本
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器并输入
  await clearEditor(page);
  await typeInEditor("ab");
  await page.waitForTimeout(200);
  // step 3: 移动光标到 a 和 b 之间
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight"); // 光标在 pos 1
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 输入 "X" | [DOM] `.cm-content` 含 "aXb"（CM6 changes {from:1,to:1,insert:"X"}，与 replaceRange(1,1,"X") 同语义） | import: @playwright/test; API: page.keyboard.type("X"); 框架: playwright; 等待: 200ms |

**断言汇总**:
- [DOM] 插入语义（from===to）正确生效

---

## FP-03-07-N03 [P2] [正常] 通过 page.evaluate 钩子调用 replaceRange（需 demo 注入 editor）

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（需 editor-shell.ts 注入 `(window as any).__nexusEditor = editor`）
- 初始文档: "hello"
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器并输入
  await clearEditor(page);
  await typeInEditor("hello");
  await page.waitForTimeout(200);
  // step 3: 尝试通过钩子调用 replaceRange
  const result = await page.evaluate(() => {
    const ed = (window as any).__nexusEditor;
    if (!ed) return null;
    ed.replaceRange(0, 5, "world");
    return ed.getDocument();
  });
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言 replaceRange 结果 | [STATE] 若钩子存在：result === "world"（replaceRange(0,5,"world") 替换 [0,5)）；若钩子缺失：result === null，用例跳过 | import: @playwright/test; API: page.evaluate(replaceRange); 框架: playwright; 等待: 无 |

**断言汇总**:
- [STATE] replaceRange 精确替换指定范围（依赖 demo 注入测试钩子）

---

## FP-03-07-E01 [P3] [异常] replaceRange 越界位置→ CM6 静默夹紧（间接验证编辑器不崩溃）

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 短文本 "hi"
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器并输入
  await clearEditor(page);
  await typeInEditor("hi");
  await page.waitForTimeout(200);
  // step 3: 尝试越界 replaceRange（若钩子可用）
  await page.evaluate(() => {
    const ed = (window as any).__nexusEditor;
    if (ed) ed.replaceRange(0, 9999, "replaced"); // to 超过 doc.length
  });
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言编辑器存活 | [DOM] `.cm-editor` 可见（CM6 对越界 to 静默夹紧到 doc.length，不抛异常） | import: @playwright/test; API: expect(.cm-editor).toBeVisible(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] 越界 replaceRange 不导致崩溃（CM6 静默夹紧）

---

## FP-03-07-B01 [P4] [边界] replaceRange from>to→ CM6 静默处理（间接验证不崩溃）

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: "abc"
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器并输入
  await clearEditor(page);
  await typeInEditor("abc");
  await page.waitForTimeout(200);
  // step 3: 尝试 from>to 的 replaceRange（若钩子可用）
  await page.evaluate(() => {
    const ed = (window as any).__nexusEditor;
    if (ed) ed.replaceRange(3, 0, "X"); // from>to 反向
  });
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言编辑器存活 | [DOM] `.cm-editor` 可见（CM6 对反向范围静默处理或交换） | import: @playwright/test; API: expect(.cm-editor).toBeVisible(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] 反向范围 replaceRange 不崩溃

---

# FP-03-08 getDocumentStats() 获取行/词/字符统计（6 例，[API契约]）

> 直接验证路径：`app.ts:108-109` 的 `shell.editor.getDocumentStats()` 返回 `{ characters, words, lines }`，渲染到状态栏 `${stats.words} words, ${stats.lines} lines`。实现见 `editor.ts:917-923`：`characters = doc.length`、`words = doc.trim()==="" ? 0 : doc.trim().split(/\s+/).length`、`lines = view.state.doc.lines`。

## FP-03-08-N01 [P1] [正常] 单行文本→ getDocumentStats 返回 lines:1 words:N→ 状态栏显示

**测试框架**: Playwright

**前置条件**（⚠️ 4要素）:
- 依赖环境: Electron demo
- 初始文档: 空文档
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
| 1 | 断言状态栏 | [DOM] 含 "3 words"（`editor.ts:920` 的 split(/\s+/).length）与 "1 lines"（`editor.ts:921` 的 doc.lines） | import: @playwright/test; API: getStatusText(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] 单行 3 词文档：状态栏显示 3 words, 1 lines

---

## FP-03-08-N02 [P1] [正常] 多行文本→ getDocumentStats 返回 lines:N→ 状态栏行数正确

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空文档
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器并输入 3 行
  await clearEditor(page);
  await typeInEditor("line1");
  await pressEnter(page);
  await typeInEditor("line2");
  await pressEnter(page);
  await typeInEditor("line3");
  await page.waitForTimeout(250);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言状态栏 | [DOM] 含 "3 lines" 与 "3 words" | import: @playwright/test; API: getStatusText(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] 3 行文档：状态栏显示 3 lines（CM6 doc.lines 计算）

---

## FP-03-08-N03 [P2] [正常] 字符数统计→ getDocumentStats 返回 characters:N→ 与输入长度一致

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空文档
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器并输入已知长度文本
  await clearEditor(page);
  await typeInEditor("abc"); // 3 字符
  await page.waitForTimeout(250);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言状态栏 | [DOM] 含 "3 characters"（`editor.ts:919` 的 doc.length） | import: @playwright/test; API: getStatusText(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] characters 等于 doc.length（3 字符）

---

## FP-03-08-N04 [P2] [正常] CJK 文本→ getDocumentStats words 按 \s+ 分割→ CJK 整体计为 1 词

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空文档
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器并输入 CJK
  await clearEditor(page);
  await typeInEditor("你好世界"); // 无空格
  await page.waitForTimeout(250);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言状态栏 | [DOM] words 显示 "1"（`editor.ts:920` 的 split(/\s+/) 对无空格 CJK 计为 1 词）；characters 显示 "4" | import: @playwright/test; API: getStatusText(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] CJK 无空格文本：getDocumentStats 的 words=1, characters=4（注：wordcount 插件的 cjkCharacters 是另一套统计，此处验证的是 editor.getDocumentStats 的简单实现）

---

## FP-03-08-E01 [P3] [异常] 空文档→ getDocumentStats 返回全 0→ 状态栏 0 words 1 lines

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
| 1 | 断言状态栏 | [DOM] 含 "0 words"（`editor.ts:920` 的 `doc.trim()==="" ? 0` 分支）与 "1 lines"（CM6 空 doc 仍有 1 行） | import: @playwright/test; API: getStatusText(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] 空文档：words=0（trim 后为空字符串的特判），lines=1（CM6 最小行数）

---

## FP-03-08-B01 [P4] [边界] 仅空格/换行文档→ getDocumentStats words 归零（trim 生效）

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空文档
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器并输入仅空白
  await clearEditor(page);
  await typeInEditor("   "); // 3 空格
  await pressEnter(page);
  await typeInEditor("   "); // 又 3 空格
  await page.waitForTimeout(250);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言状态栏 | [DOM] words 显示 "0"（`editor.ts:920` 的 `doc.trim()===""` 为 true，因为首尾 trim 后中间空格被 split 但整体 trim 判定） | import: @playwright/test; API: getStatusText(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] 仅空白文档：words 归零（trim 判定优先于 split）

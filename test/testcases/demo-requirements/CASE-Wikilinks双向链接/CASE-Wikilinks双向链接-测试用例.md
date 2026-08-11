# CASE-Wikilinks双向链接-测试用例（FP-09）

> 一级功能点: Wikilinks 双向链接（demo-requirements.md §3.5）
> 全局批次序号: 09
> 生成时间: 2026-08-11
> 测试框架: Playwright（Electron demo / Vite dev server + Electron main）
>
> 涉及二级功能点:
> - FP-09-01 [[target]] / [[target|alias]] 语法解析（[AST解析][Live Preview]）
> - FP-09-02 已解析链接实线下划线 / 未解析虚线下划线装饰（[Live Preview]）
> - FP-09-03 光标感知：本行显示源码 / 离开隐藏 [[]] 仅留 display（[Live Preview][编辑交互]）
> - FP-09-04 单击触发 onNavigate 导航（[编辑交互]）
> - FP-09-05 [[后触发 autocompletion（最多 50 候选）（[编辑交互][插件能力]）
> - FP-09-06 scanWikiLinks(doc) 纯函数返回所有匹配（[AST解析]）
> - FP-09-07 IME compositionend 后延迟 60ms 重建装饰（[编辑交互][边界异常]）
>
> ⚠️ 实现差异提示（依据 `packages/core/src/wikilinks.ts` + `apps/electron-demo/src/renderer/link-index.ts` + `apps/electron-demo/src/renderer/backlinks-panel.ts` + `apps/electron-demo/src/renderer/app.ts` 实际代码）:
> - **语法解析**：`wikilinks.ts:72` 的 `WIKILINK_RE = /(?<!\\)\[\[([^\[\]\n|]+?)(?:\|([^\[\]\n]+?))?\]\]/g` 匹配 `[[target]]` 和 `[[target|alias]]`；负向后行断言 `(?<!\\)` 跳过转义的 `\[[`；target 不允许 `[`/`]`/`|`/换行。
> - **scanWikiLinks 纯函数**：`wikilinks.ts:78-111` 的 `scanWikiLinks(doc: string): WikiLinkMatch[]` 返回 `{ from, to, target, alias?, display, displayFrom, displayTo }`，按 `from` 升序。Demo 的 `link-index.ts:458` 在 `indexFileInto` 中调 `scanWikiLinks(content)` 构建前向/反向索引。
> - **装饰策略**：`wikilinks.ts:139-186` 的 `buildWikiLinkDecorations` 使用 `Decoration.mark`（样式）+ 零宽 `Decoration.replace`（隐藏 `[[]]`），不用 widget。已解析用 `RESOLVED_STYLE`（accent 色实线下划线），未解析用 `UNRESOLVED_STYLE`（deletion 色虚线下划线）。DOM 元素携带 `data-wikilink-target`、`data-wikilink-unresolved`、`data-wikilink-alias` 属性。
> - **光标感知**：`wikilinks.ts:119-132` 的 `selectionOnLine` 检查是否有 selection head 在 wikilink 所在行。光标在本行 → 仅 `Decoration.mark` 全 span（显示原始 `[[...]]`）；光标离开 → `Decoration.replace` 隐藏 `[[`/`]]`/`target|`，仅 mark display 文本。
> - **onNavigate 点击导航**：`wikilinks.ts:302-316` 的 `clickHandler` 监听 `mousedown`，通过 `event.target.closest("[data-wikilink-target]")` 找到链接元素，读取 `data-wikilink-target` + `data-wikilink-unresolved`，调 `onNavigate(target, { unresolved })`。Demo 的 `app.ts:273-325` 的 `handleWikilinkNavigate` 执行：已解析 → `linkIndex.resolve` → `handleVaultFileOpen`；未解析 → `vault.createFile` 创建文件后打开。
> - **autocompletion**：`wikilinks.ts:210-251` 的 `createAutocompleteSource` 在 `[[` 后触发，`findWikiContext` 回溯找未闭合的 `[[`，`suggest(query)` 返回候选，包含式过滤（`toLowerCase().includes`），`slice(0, 50)` 截断。Demo 的 `app.ts:368-373` 的 `suggestWikilinks` 从 `linkIndex.getAllNoteNames()` 取候选。选中时 `apply` 插入 `${name}]]`（若后面无 `]]`）。
> - **IME 处理**：`wikilinks.ts:288-300` 的 `compositionHandler` 监听 `compositionend`，`setTimeout(60ms)` 后检查 `view.compositionStarted` 为 false 才 dispatch `rebuildAfterComposition` effect → StateField 重建装饰。`wikilinks.ts:274-276` 的 update 分支在 `input.type.compose` 事件期间只做 `decos.map(tr.changes)` 不重建，避免 IME 中间态闪烁。
> - **Backlinks 面板**：`backlinks-panel.ts:128-271` 的 `createBacklinksPanel` 订阅 `linkIndex`，`refresh()` 调 `index.getBacklinks(active)` 渲染 "Linked mentions"，异步调 `index.getUnlinkedMentions(active)` 渲染 "Unlinked mentions"。面板根元素 `.backlinks-panel`，header 文本 `Backlinks · N linked · M mentions`。
> - **resolve 规则**：`link-index.ts:331-386` 的 `resolve(name, fromPath)` 四级匹配：① 精确路径 ② 相对源目录 ③ 同目录 basename ④ 全局唯一 basename。未打开 Vault 时 `linkIndex` 为空，所有链接标记为未解析。
> - **测试环境约定**：所有用例通过 `launchDemo()`（`test/e2e/helpers/electron-launcher.ts`）启动 Electron demo；sample-vault 含 17 个 .md 文件，含丰富的 wikilinks 场景（已解析/未解析/别名/转义/同目录歧义）。demo 默认打开 sample-vault（`app.ts:327-340` 的 `tryRestoreLastVault`）。

---

## e2e 全局前置条件

- 依赖环境: Electron demo（Vite dev server localhost:5173 + 已构建的 `apps/electron-demo/dist-electron/main.js`）
- 初始文档: demo 启动后默认打开 sample-vault 的 index.md（含丰富 wikilinks）
- 插件配置: demo 默认挂载 —— createGfmPreset + createHistoryPlugin + createToolbarPlugin + createSearchPlugin + createWikilinksPlugin（含 resolve/onNavigate/suggest）+ createWordCountPlugin
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

  // 获取 wikilink 装饰元素（data-wikilink-target 属性）
  async function getWikiLinks(page: Page): Promise<{
    count: number;
    targets: string[];
    unresolvedCount: number;
    aliases: string[];
  }> {
    const els = page.locator("[data-wikilink-target]");
    const count = await els.count();
    const targets: string[] = [];
    const aliases: string[] = [];
    let unresolvedCount = 0;
    for (let i = 0; i < count; i++) {
      const el = els.nth(i);
      targets.push((await el.getAttribute("data-wikilink-target")) ?? "");
      aliases.push((await el.getAttribute("data-wikilink-alias")) ?? "");
      if ((await el.getAttribute("data-wikilink-unresolved")) === "true") unresolvedCount++;
    }
    return { count, targets, unresolvedCount, aliases };
  }

  // 获取自动补全 tooltip 状态
  async function getAutocompleteState(page: Page): Promise<{ visible: boolean; itemCount: number }> {
    const tooltip = page.locator(".cm-tooltip-autocomplete").first();
    const count = await tooltip.count();
    if (count === 0) return { visible: false, itemCount: 0 };
    const items = tooltip.locator(".cm-completionListOption, [role='option']");
    const itemCount = await items.count();
    return { visible: itemCount > 0, itemCount };
  }

  // 获取 Backlinks 面板状态
  async function getBacklinksState(page: Page): Promise<{
    header: string;
    linkedCount: number;
    unlinkedCount: number;
  }> {
    const panel = page.locator(".backlinks-panel").first();
    const header = (await panel.locator(":scope > div").first().textContent()) ?? "";
    // Linked mentions 计数从 header 文本提取
    const linkedMatch = header.match(/(\d+)\s*linked/);
    const unlinkedMatch = header.match(/(\d+)\s*mention/);
    return {
      header,
      linkedCount: linkedMatch ? parseInt(linkedMatch[1], 10) : -1,
      unlinkedCount: unlinkedMatch ? parseInt(unlinkedMatch[1], 10) : -1,
    };
  }

  // 在 Vault 面板中打开指定文件（通过文件名匹配）
  async function openVaultFile(page: Page, namePart: string) {
    await page.locator('button[title="Toggle vault panel"]').click();
    await page.waitForTimeout(200);
    const fileItem = page.locator(".vault-panel-file, [class*='vault-file']").filter({ hasText: namePart }).first();
    await fileItem.click();
    await page.waitForTimeout(400);
  }

  // 获取状态栏文本
  async function getStatusText(page: Page): Promise<string> {
    const el = page.locator("#status-line, .status-line").first();
    return (await el.textContent()) ?? "";
  }
  ```

---

# FP-09-01 [[target]] / [[target|alias]] 语法解析（6 例，[AST解析][Live Preview]）

> 实现路径：`wikilinks.ts:72` 的 `WIKILINK_RE` 正则匹配 `[[target]]` 和 `[[target|alias]]`；`scanWikiLinks`（`wikilinks.ts:78-111`）返回 WikiLinkMatch 数组。装饰由 `buildWikiLinkDecorations`（`wikilinks.ts:139-186`）生成。Demo 的 sample-vault/index.md 含 `[[Projects/Nexus-Editor]]`、`[[Projects/Ideas|random ideas]]`、`[[AI]]`、`[[Testing|how we test]]` 等丰富用例。**`[data-wikilink-target]` 属性是语法解析成功的 DOM 证据**。

## FP-09-01-N01 [P1] [正常] [[target]] 基础语法解析→ 装饰元素含 target 属性

**测试框架**: Playwright

**前置条件**（⚠️ 4要素）:
- 依赖环境: Electron demo（默认打开 sample-vault/index.md）
- 初始文档: index.md 含 `[[Projects/Nexus-Editor]]`（第 9 行）
- 插件配置: demo 默认（含 createWikilinksPlugin，resolve 从 linkIndex 解析）
- setup 代码:
  ```typescript
  // step 1: 全局 setup（见 e2e 全局前置条件 launchDemo）
  // step 2: 等待 demo 加载完成 + linkIndex 建索引
  await page.waitForSelector(".cm-editor", { timeout: 10000 });
  await page.waitForTimeout(1500); // linkIndex rebuildAsync 建索引
  // step 3: 确认当前文档是 index.md（含 wikilinks）
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言 .cm-content 含 wikilink 装饰 | [DOM] `[data-wikilink-target]` count >= 5（index.md 含多个 `[[...]]` 链接，`wikilinks.ts:153-158` 的 `data-wikilink-target` 属性生成） | 选择器: [data-wikilink-target]; 操作: count(); 控件: editor; 等待: 无 |
| 2 | 断言 targets 含 "Projects/Nexus-Editor" | [DOM] `getWikiLinks().targets` 包含 "Projects/Nexus-Editor"（`[[Projects/Nexus-Editor]]` 被正则匹配，target = "Projects/Nexus-Editor"，`wikilinks.ts:86` 的 `match[1].trim()`） | 选择器: [data-wikilink-target]; 操作: getWikiLinks(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] `[[target]]` 语法被正确解析，生成带 `data-wikilink-target` 的装饰元素
- [DOM] target 属性值 = "Projects/Nexus-Editor"（路径式 target 正确提取）

---

## FP-09-01-N02 [P1] [正常] [[target|alias]] 别名语法解析→ target 与 alias 属性分别正确

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（默认打开 sample-vault/index.md）
- 初始文档: index.md 含 `[[Projects/Ideas|random ideas]]`（第 10 行）
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 等待加载 + 建索引
  await page.waitForSelector(".cm-editor", { timeout: 10000 });
  await page.waitForTimeout(1500);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言含 alias 属性的 wikilink | [DOM] `getWikiLinks().targets` 含 "Projects/Ideas"（target 部分）+ `getWikiLinks().aliases` 含 "random ideas"（alias 部分，`wikilinks.ts:158` 的 `data-wikilink-alias` 属性） | 选择器: [data-wikilink-alias]; 操作: getWikiLinks(); 控件: editor; 等待: 无 |
| 2 | 断言 display 文本为 alias | [DOM] 光标离开该行时，装饰元素可见文本为 "random ideas"（`wikilinks.ts:90` 的 `display = alias || target`） | 选择器: [data-wikilink-target]; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] `[[target|alias]]` 语法被正确解析，target="Projects/Ideas"、alias="random ideas"
- [DOM] display 文本 = alias（"random ideas"）

---

## FP-09-01-N03 [P2] [正常] 嵌套路径 [[Folder/Sub]] 解析→ target 含路径分隔符

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（默认打开 index.md）
- 初始文档: index.md 含 `[[Projects/Nexus-Editor]]`、`[[People/Alice]]`、`[[Daily/2026-04-20]]`
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 等待加载 + 建索引
  await page.waitForSelector(".cm-editor", { timeout: 10000 });
  await page.waitForTimeout(1500);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言 targets 含嵌套路径 | [DOM] `getWikiLinks().targets` 同时包含 "Projects/Nexus-Editor"、"People/Alice"、"Daily/2026-04-20"（正则 `[^\[\]\n|]+?` 允许 `/` 在 target 中） | 选择器: [data-wikilink-target]; 操作: getWikiLinks(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 嵌套路径 `[[Folder/Sub]]` 的 target 正确含 `/` 分隔符

---

## FP-09-01-E01 [P3] [异常] 转义 \\[[NotALink]] 不被解析→ 无装饰元素

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（需打开 ghost-demo.md）
- 初始文档: ghost-demo.md 含 `\[[NotALink]]`（第 15 行）
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 打开 ghost-demo.md
  await openVaultFile(page, "ghost-demo");
  await page.waitForTimeout(500);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言 .cm-content 含 "NotALink" 文本 | [DOM] `.cm-content` 含 "\\[[NotALink]]" 原始文本（转义反斜杠保留） | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |
| 2 | 断言无 target="NotALink" 的装饰 | [DOM] `getWikiLinks().targets` 不含 "NotALink"（正则 `(?<!\\)` 负向后行断言跳过转义，`wikilinks.ts:72`） | 选择器: [data-wikilink-target]; 操作: getWikiLinks(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] `\[[NotALink]]` 不被解析为 wikilink（转义保护生效）
- [DOM] 原始文本保留（含反斜杠）

---

## FP-09-01-B01 [P4] [边界] 空文档无 wikilinks→ 装饰元素 count === 0

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
  await page.waitForTimeout(300);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言无 wikilink 装饰 | [DOM] `[data-wikilink-target]` count === 0（`scanWikiLinks` 对空串返回空数组，`wikilinks.ts:78-111`） | 选择器: [data-wikilink-target]; 操作: count(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 空文档不产生任何 wikilink 装饰

---

## FP-09-01-D01 [P2] [数据] 输入 [[target]] 后实时解析→ 装饰立即出现

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
  await page.waitForTimeout(300);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | typeInEditor("[[index]]") | [DOM] docChanged → StateField update（`wikilinks.ts:277-280`）→ `buildWikiLinkDecorations` 重新扫描 → `scanWikiLinks` 匹配 `[[index]]` → 生成装饰 | 选择器: .cm-content; 操作: typeInEditor([[index]]); 控件: editor; 等待: 300ms |
| 2 | 断言装饰出现 | [DOM] `[data-wikilink-target="index"]` count >= 1（target = "index"，"index.md" 在 sample-vault 中存在，resolve 返回非 null → 已解析装饰） | 选择器: [data-wikilink-target="index"]; 操作: count(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 输入 `[[index]]` 后实时解析为 wikilink，装饰立即出现
- [DOM] target 属性 = "index"

---

# FP-09-02 已解析链接实线下划线 / 未解析虚线下划线装饰（5 例，[Live Preview]）

> 实现路径：`wikilinks.ts:134-137` 定义 `RESOLVED_STYLE`（`text-decoration:underline`，accent 色）和 `UNRESOLVED_STYLE`（`text-decoration:underline dashed`，deletion 色）。`buildWikiLinkDecorations`（`wikilinks.ts:151-157`）调 `resolve(target)` 判断：返回非 null → RESOLVED + 无 `data-wikilink-unresolved`；返回 null → UNRESOLVED + `data-wikilink-unresolved="true"`。sample-vault 中 `[[Ghost Note]]`（ghost-demo.md）是未解析链接，`[[index]]` 是已解析链接。

## FP-09-02-N01 [P1] [正常] 已解析链接→ 实线下划线 + 无 unresolved 属性

**测试框架**: Playwright

**前置条件**（⚠️ 4要素）:
- 依赖环境: Electron demo（默认打开 index.md，linkIndex 已建索引）
- 初始文档: index.md 含 `[[Projects/Nexus-Editor]]`（已解析，因 Projects/Nexus-Editor.md 存在）
- 插件配置: demo 默认（resolve 从 linkIndex 查找）
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 等待加载 + 建索引
  await page.waitForSelector(".cm-editor", { timeout: 10000 });
  await page.waitForTimeout(1500);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言已解析链接装饰 | [DOM] `[data-wikilink-target="Projects/Nexus-Editor"]` 存在，且 `data-wikilink-unresolved` 属性**不存在**（`resolve` 返回非 null，`wikilinks.ts:151-157` 不设置 unresolved 属性） | 选择器: [data-wikilink-target="Projects/Nexus-Editor"]; 操作: getAttribute(data-wikilink-unresolved); 控件: editor; 等待: 无 |
| 2 | 断言样式含 underline（非 dashed） | [DOM] 装饰元素 style 含 `text-decoration:underline` 且**不含** `dashed`（RESOLVED_STYLE，`wikilinks.ts:134-135`） | 选择器: [data-wikilink-target="Projects/Nexus-Editor"]; 操作: getAttribute(style); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 已解析链接无 `data-wikilink-unresolved` 属性
- [DOM] 样式为实线下划线（不含 `dashed`）

---

## FP-09-02-N02 [P1] [正常] 未解析链接→ 虚线下划线 + unresolved 属性

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（需打开 ghost-demo.md）
- 初始文档: ghost-demo.md 含 `[[Ghost Note]]`（未解析，因 Ghost Note.md 不存在）
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 打开 ghost-demo.md
  await openVaultFile(page, "ghost-demo");
  await page.waitForTimeout(500);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言未解析链接装饰 | [DOM] `[data-wikilink-target="Ghost Note"]` 存在，且 `data-wikilink-unresolved="true"`（`resolve` 返回 null，`wikilinks.ts:157` 设置 unresolved 属性） | 选择器: [data-wikilink-target="Ghost Note"]; 操作: getAttribute(data-wikilink-unresolved); 控件: editor; 等待: 无 |
| 2 | 断言样式含 underline dashed | [DOM] 装饰元素 style 含 `text-decoration:underline dashed`（UNRESOLVED_STYLE，`wikilinks.ts:136-137`） | 选择器: [data-wikilink-target="Ghost Note"]; 操作: getAttribute(style); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 未解析链接有 `data-wikilink-unresolved="true"` 属性
- [DOM] 样式为虚线下划线（含 `dashed`）

---

## FP-09-02-N03 [P2] [正常] 别名未解析链接→ dashed 样式 + alias 属性

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（需打开 ghost-demo.md）
- 初始文档: ghost-demo.md 含 `[[NonExistent|phantom]]`（第 11 行，未解析别名链接）
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 打开 ghost-demo.md
  await openVaultFile(page, "ghost-demo");
  await page.waitForTimeout(500);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言别名未解析装饰 | [DOM] `[data-wikilink-target="NonExistent"]` 存在 + `data-wikilink-unresolved="true"` + `data-wikilink-alias="phantom"`（`wikilinks.ts:157-158` 同时设置 unresolved 和 alias 属性） | 选择器: [data-wikilink-target="NonExistent"]; 操作: getAttribute; 控件: editor; 等待: 无 |
| 2 | 断言样式 | [DOM] style 含 `underline dashed` | 选择器: [data-wikilink-target="NonExistent"]; 操作: getAttribute(style); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 未解析别名链接同时携带 unresolved + alias 属性
- [DOM] 样式为虚线下划线

---

## FP-09-02-B01 [P4] [边界] 同一行多个 wikilinks 各自独立装饰

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（默认打开 index.md）
- 初始文档: index.md 第 14-15 行含 `[[People/Alice]]` 和 `[[People/Bob]]`（相邻行多个链接）
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 等待加载 + 建索引
  await page.waitForSelector(".cm-editor", { timeout: 10000 });
  await page.waitForTimeout(1500);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言多个独立装饰 | [DOM] `getWikiLinks().targets` 同时含 "People/Alice" 和 "People/Bob"，各自独立的 `[data-wikilink-target]` 元素（`scanWikiLinks` 全局匹配返回数组，每个 match 生成独立装饰） | 选择器: [data-wikilink-target]; 操作: getWikiLinks(); 控件: editor; 等待: 无 |
| 2 | 断言均为已解析 | [DOM] 这两个链接均无 `data-wikilink-unresolved` 属性（People/Alice.md 和 People/Bob.md 存在于 sample-vault） | 选择器: [data-wikilink-target]; 操作: getWikiLinks().unresolvedCount; 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 同一区域多个 wikilinks 各自独立解析和装饰
- [DOM] 多个已解析链接不互相干扰

---

## FP-09-02-E01 [P3] [异常] 转义链接无任何装饰样式

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（需打开 ghost-demo.md）
- 初始文档: ghost-demo.md 含 `\[[NotALink]]`
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 打开 ghost-demo.md
  await openVaultFile(page, "ghost-demo");
  await page.waitForTimeout(500);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言无装饰 | [DOM] `[data-wikilink-target="NotALink"]` count === 0（正则 `(?<!\\)` 跳过转义，不生成任何装饰） | 选择器: [data-wikilink-target="NotALink"]; 操作: count(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 转义链接不产生任何装饰（无 target 属性、无样式）

---

# FP-09-03 光标感知：本行显示源码 / 离开隐藏 [[]] 仅留 display（6 例，[Live Preview][编辑交互]）

> 实现路径：`wikilinks.ts:119-132` 的 `selectionOnLine` 检查 selection head 是否在 wikilink 所在行。`buildWikiLinkDecorations`（`wikilinks.ts:160-180`）：光标在本行 → 仅 `Decoration.mark` 全 span（显示原始 `[[...]]`，不隐藏）；光标离开 → `Decoration.replace` 隐藏 `[[` + `]]` + `target|`，仅 `Decoration.mark` display 文本。这是与 strong/emphasis/link 相同的光标策略。

## FP-09-03-N01 [P1] [正常] 光标在本行→ 显示原始 [[...]] 源码

**测试框架**: Playwright

**前置条件**（⚠️ 4要素）:
- 依赖环境: Electron demo（默认打开 index.md）
- 初始文档: index.md 含 `[[Projects/Nexus-Editor]]`
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 等待加载 + 建索引
  await page.waitForSelector(".cm-editor", { timeout: 10000 });
  await page.waitForTimeout(1500);
  // step 3: 点击 wikilink 所在行，使光标进入该行
  const wikiEl = page.locator("[data-wikilink-target='Projects/Nexus-Editor']").first();
  await wikiEl.click({ position: { x: 5, y: 2 } }); // 点击行首附近使光标进入该行
  await page.waitForTimeout(200);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言 .cm-content 含 [[ 和 ]] | [DOM] `.cm-content` 文本含 "[["（光标在本行 → `selectionOnLine` 返回 true → 不隐藏 `[[]]`，`wikilinks.ts:162-167`） | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |
| 2 | 断言显示原始 target | [DOM] `.cm-content` 文本含 "Projects/Nexus-Editor" 完整路径（不隐藏 target| 前缀，因为无 alias） | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 光标在本行时显示原始 `[[Projects/Nexus-Editor]]` 源码（`[[]]` 可见）

---

## FP-09-03-N02 [P1] [正常] 光标离开→ 隐藏 [[]] 仅留 display 文本

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（默认打开 index.md）
- 初始文档: index.md 含 `[[Projects/Nexus-Editor]]`（第 9 行）
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 等待加载 + 建索引
  await page.waitForSelector(".cm-editor", { timeout: 10000 });
  await page.waitForTimeout(1500);
  // step 3: 光标移到文档末尾（远离 wikilink 行）
  await page.keyboard.press("ControlOrMeta+End");
  await page.waitForTimeout(200);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言 .cm-content 不含 [[ | [DOM] 光标离开 wikilink 行 → `selectionOnLine` 返回 false → `Decoration.replace` 隐藏 `[[` 和 `]]`（`wikilinks.ts:172-177`），`.cm-content` 可见文本不含 "[[" | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |
| 2 | 断言 display 文本保留 | [DOM] `.cm-content` 仍含 "Projects/Nexus-Editor"（display 文本未被隐藏，`wikilinks.ts:178-180` 的 mark display 范围） | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 光标离开后 `[[` 和 `]]` 被隐藏（Decoration.replace 生效）
- [DOM] display 文本 "Projects/Nexus-Editor" 保留可见

---

## FP-09-03-N03 [P2] [正常] 别名场景光标离开→ 仅显示 alias 文本

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（默认打开 index.md）
- 初始文档: index.md 含 `[[Projects/Ideas|random ideas]]`（第 10 行）
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 等待加载
  await page.waitForSelector(".cm-editor", { timeout: 10000 });
  await page.waitForTimeout(1500);
  // step 3: 光标移到文档末尾
  await page.keyboard.press("ControlOrMeta+End");
  await page.waitForTimeout(200);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言 .cm-content 不含 [[ 和 target| | [DOM] 光标离开 → 隐藏 `[[` + `Projects/Ideas|` + `]]`（`wikilinks.ts:172-177` 的 replace from→displayFrom + displayTo→to），可见文本不含 "[["、不含 "Projects/Ideas|" | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |
| 2 | 断言仅显示 alias | [DOM] `.cm-content` 含 "random ideas"（display = alias，`wikilinks.ts:90`），不含 "Projects/Ideas" | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 别名场景光标离开后隐藏 `[[` + `target|` + `]]`
- [DOM] 仅显示 alias 文本 "random ideas"

---

## FP-09-03-B01 [P4] [边界] 光标在相邻行→ 当前行的 wikilink 折叠

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（默认打开 index.md）
- 初始文档: index.md 第 9 行 `[[Projects/Nexus-Editor]]`，第 14 行 `[[People/Alice]]`
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 等待加载
  await page.waitForSelector(".cm-editor", { timeout: 10000 });
  await page.waitForTimeout(1500);
  // step 3: 点击第 14 行附近使光标在该行（第 9 行的 wikilink 应折叠）
  const wikiEl = page.locator("[data-wikilink-target='People/Alice']").first();
  await wikiEl.click({ position: { x: 5, y: 2 } });
  await page.waitForTimeout(200);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言第 9 行 wikilink 折叠 | [DOM] 光标在第 14 行 → 第 9 行的 `[[Projects/Nexus-Editor]]` 的 `selectionOnLine` 返回 false → 折叠（`[[]]` 隐藏） | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |
| 2 | 断言第 14 行 wikilink 展开 | [DOM] 光标在第 14 行 → `[[People/Alice]]` 的 `selectionOnLine` 返回 true → 展开（`[[]]` 可见，`.cm-content` 含 "[["） | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 光标行感知是按行独立判断的（非全局）
- [DOM] 相邻行的 wikilink 折叠状态独立

---

## FP-09-03-E01 [P3] [异常] 快速 ArrowUp/Down 移动光标→ 装饰正确刷新无残留

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（默认打开 index.md）
- 初始文档: index.md 含多行 wikilinks
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 等待加载
  await page.waitForSelector(".cm-editor", { timeout: 10000 });
  await page.waitForTimeout(1500);
  // step 3: 点击第一个 wikilink 行
  await page.locator("[data-wikilink-target]").first().click();
  await page.waitForTimeout(200);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 快速按 ArrowDown 3 次再 ArrowUp 3 次 | [STATE] 每次按键 selectionSet → StateField update（`wikilinks.ts:277-280`）→ `buildWikiLinkDecorations` 重新计算 → 装饰随光标行切换刷新 | 选择器: 无; 操作: page.keyboard.press x6; 控件: editor; 等待: 每次 50ms |
| 2 | 断言无残留/无崩溃 | [DOM] `.cm-editor` 可见，`.cm-content` 文本一致（快速切换不导致装饰残留或 DOM 错乱） | 选择器: .cm-editor; 操作: toBeVisible(); 控件: editor; 等待: 200ms |

**断言汇总**:
- [DOM] 快速光标移动后装饰正确刷新，无残留
- [DOM] 编辑器不崩溃

---

## FP-09-03-F01 [P2] [流程] 光标进入→ 离开→ 再进入的完整折叠/展开循环

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（默认打开 index.md）
- 初始文档: index.md 含 `[[Projects/Nexus-Editor]]`（第 9 行）
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 等待加载
  await page.waitForSelector(".cm-editor", { timeout: 10000 });
  await page.waitForTimeout(1500);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 光标移到文档末尾（离开 wikilink 行） | [DOM] `[[]]` 隐藏（折叠态） | 选择器: 无; 操作: ControlOrMeta+End; 控件: editor; 等待: 200ms |
| 2 | 点击 wikilink 行（进入） | [DOM] `[[]]` 可见（展开态，`selectionOnLine` → true） | 选择器: [data-wikilink-target]; 操作: click(); 控件: editor; 等待: 200ms |
| 3 | 再次光标移到末尾（离开） | [DOM] `[[]]` 再次隐藏（折叠态恢复） | 选择器: 无; 操作: ControlOrMeta+End; 控件: editor; 等待: 200ms |
| 4 | 断言文档不变 | [DOM] `editor.getDocument()` 一致（折叠/展开不改变文档内容，仅 Decoration 变化） | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 折叠→展开→折叠完整循环正确
- [DOM] 文档内容在整个循环中不变（Decoration 仅影响显示）

---

# FP-09-04 单击触发 onNavigate 导航（5 例，[编辑交互]）

> 实现路径：`wikilinks.ts:302-316` 的 `clickHandler`（mousedown 事件）通过 `event.target.closest("[data-wikilink-target]")` 定位链接，读取 target + unresolved，调 `onNavigate(target, { unresolved })`。Demo 的 `app.ts:274-376` 的 `handleWikilinkNavigate`：已解析 → `linkIndex.resolve` → `handleVaultFileOpen`（切换文件）；未解析 → `vault.createFile` 创建后打开。导航后 `state.activeFile` 改变，编辑器内容切换。

## FP-09-04-N01 [P1] [正常] 点击已解析链接→ 导航到目标文件→ 编辑器内容切换

**测试框架**: Playwright

**前置条件**（⚠️ 4要素）:
- 依赖环境: Electron demo（默认打开 index.md，linkIndex 已建索引）
- 初始文档: index.md 含 `[[Projects/Nexus-Editor]]`（已解析）
- 插件配置: demo 默认（onNavigate = handleWikilinkNavigate）
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 等待加载 + 建索引
  await page.waitForSelector(".cm-editor", { timeout: 10000 });
  await page.waitForTimeout(1500);
  // step 3: 光标移到末尾（确保 wikilink 可点击，不在编辑态）
  await page.keyboard.press("ControlOrMeta+End");
  await page.waitForTimeout(200);
  // step 4: 记录导航前文档内容特征
  const contentBefore = await page.locator(".cm-content").textContent();
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 点击 `[data-wikilink-target="Projects/Nexus-Editor"]` | [STATE] mousedown → `clickHandler`（`wikilinks.ts:302-316`）→ `closest("[data-wikilink-target]")` → target="Projects/Nexus-Editor" + unresolved=false → `onNavigate("Projects/Nexus-Editor", { unresolved: false })` → `handleWikilinkNavigate`（`app.ts:274`）→ `linkIndex.resolve` 返回路径 → `handleVaultFileOpen`（`app.ts:293`）| 选择器: [data-wikilink-target="Projects/Nexus-Editor"]; 操作: click(); 控件: editor; 等待: 600ms（文件加载） |
| 2 | 断言编辑器内容切换 | [DOM] `.cm-content` 文本含 Nexus-Editor.md 的特征内容（如 "CodeMirror-powered markdown editor"），与导航前不同（`handleVaultFileOpen` → `editor.setDocument` 切换内容） | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [STATE] 点击已解析链接触发 onNavigate → 导航到目标文件
- [DOM] 编辑器内容切换为目标文件内容

---

## FP-09-04-N02 [P1] [正常] 点击未解析链接→ 创建文件并导航→ 编辑器切换到新文件

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（需打开 ghost-demo.md，且 sample-vault 已打开）
- 初始文档: ghost-demo.md 含 `[[Ghost Note]]`（未解析）
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 打开 ghost-demo.md
  await openVaultFile(page, "ghost-demo");
  await page.waitForTimeout(500);
  // step 3: 光标移到末尾
  await page.keyboard.press("ControlOrMeta+End");
  await page.waitForTimeout(200);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 点击 `[data-wikilink-target="Ghost Note"]` | [STATE] mousedown → `clickHandler` → target="Ghost Note" + `data-wikilink-unresolved="true"` → `onNavigate("Ghost Note", { unresolved: true })` → `handleWikilinkNavigate`（`app.ts:301-320`）→ `vault.createFile` 创建 "Ghost Note.md" → `handleVaultFileOpen` | 选择器: [data-wikilink-target="Ghost Note"]; 操作: click(); 控件: editor; 等待: 800ms（创建+加载） |
| 2 | 断言编辑器切换到新空文件 | [DOM] `.cm-content` 文本为空或接近空（新建的 Ghost Note.md 初始无内容） | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |
| 3 | 断言状态栏无 error | [DOM] `getStatusText()` 不含 "error"（创建成功） | 选择器: #status-line; 操作: getStatusText(); 控件: status; 等待: 无 |

**断言汇总**:
- [STATE] 点击未解析链接触发 onNavigate(unresolved=true) → 创建文件并导航
- [DOM] 编辑器切换到新建文件
- [DOM] 无错误

---

## FP-09-04-N03 [P2] [正常] 点击别名链接→ 导航到 target 对应文件

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（默认打开 index.md）
- 初始文档: index.md 含 `[[Projects/Ideas|random ideas]]`（别名，已解析）
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 等待加载
  await page.waitForSelector(".cm-editor", { timeout: 10000 });
  await page.waitForTimeout(1500);
  // step 3: 光标移到末尾
  await page.keyboard.press("ControlOrMeta+End");
  await page.waitForTimeout(200);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 点击别名链接 display 区域 | [STATE] mousedown → `closest("[data-wikilink-target]")` → target="Projects/Ideas"（target 属性，非 alias）→ `onNavigate("Projects/Ideas", ...)` → 导航到 Projects/Ideas.md（`wikilinks.ts:307` 读取 data-wikilink-target 而非 alias） | 选择器: [data-wikilink-target="Projects/Ideas"]; 操作: click(); 控件: editor; 等待: 600ms |
| 2 | 断言导航到 Ideas.md | [DOM] `.cm-content` 含 Ideas.md 特征内容（如 "parking lot"） | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [STATE] 点击别名链接导航到 target（非 alias）对应文件
- [DOM] 编辑器内容为 Ideas.md 内容

---

## FP-09-04-E01 [P3] [异常] 未打开 Vault 时点击未解析链接→ 报错提示

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（⚠️ 降级场景：未打开 Vault，linkIndex 为空）
- 初始文档: 空文档，输入 `[[NonExistentTarget]]`
- 插件配置: demo 默认（但 linkIndex 为空，resolve 返回 null）
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器并输入未解析链接
  await clearEditor(page);
  await typeInEditor("[[NonExistentTarget]]");
  await page.waitForTimeout(300);
  // step 3: 光标移到末尾
  await page.keyboard.press("ControlOrMeta+End");
  await page.waitForTimeout(200);
  // 注：若 demo 默认已打开 sample-vault，此用例验证的是 target 不在 vault 中的场景
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 点击 `[data-wikilink-target="NonExistentTarget"]` | [STATE] mousedown → unresolved=true → `onNavigate("NonExistentTarget", { unresolved: true })` → `handleWikilinkNavigate`（`app.ts:301-304`）→ 若 `!state.vaultPath` → `state.error = "Open a vault..."` → `renderStatus()` | 选择器: [data-wikilink-target="NonExistentTarget"]; 操作: click(); 控件: editor; 等待: 500ms |
| 2 | 断言状态栏含错误提示（未开 Vault 时） | [DOM] 若 Vault 未打开：`getStatusText()` 含 "vault" 或 "error"；若 Vault 已打开：文件被创建（降级为 N02 场景） | 选择器: #status-line; 操作: getStatusText(); 控件: status; 等待: 无 |

**断言汇总**:
- [STATE] 未开 Vault 时点击未解析链接报错（降级标注：若 Vault 已开则验证创建行为）

---

## FP-09-04-B01 [P4] [边界] 点击 wikilink 装饰元素的非链接区域→ 不触发导航

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（默认打开 index.md）
- 初始文档: index.md
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 等待加载
  await page.waitForSelector(".cm-editor", { timeout: 10000 });
  await page.waitForTimeout(1500);
  // step 3: 记录导航前内容
  const contentBefore = await page.locator(".cm-content").textContent();
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 点击 .cm-content 非 wikilink 区域（如标题行） | [STATE] mousedown → `closest("[data-wikilink-target]")` 返回 null（`wikilinks.ts:305`）→ clickHandler 返回 false → 不调 onNavigate | 选择器: .cm-line (非 wikilink); 操作: click(); 控件: editor; 等待: 300ms |
| 2 | 断言内容未变 | [DOM] `.cm-content` 文本 === contentBefore（未导航） | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [STATE] 点击非 wikilink 区域不触发 onNavigate
- [DOM] 编辑器内容不变

---

# FP-09-05 [[后触发 autocompletion（最多 50 候选）（6 例，[编辑交互][插件能力]）

> 实现路径：`wikilinks.ts:210-251` 的 `createAutocompleteSource` 使用 CM6 `autocompletion`。`findWikiContext`（`wikilinks.ts:188-208`）回溯当前行找未闭合的 `[[`。`suggest(query)` 返回候选，`toLowerCase().includes(queryLower)` 包含式过滤，`slice(0, 50)` 截断。选中时 `apply`（`wikilinks.ts:229-240`）插入 `${name}]]`。Demo 的 `app.ts:368-373` 从 `linkIndex.getAllNoteNames()` 取候选。**`.cm-tooltip-autocomplete` 是自动补全 tooltip 的 DOM 选择器**。

## FP-09-05-N01 [P1] [正常] 输入 [[→ autocompletion 弹出候选列表

**测试框架**: Playwright

**前置条件**（⚠️ 4要素）:
- 依赖环境: Electron demo（默认打开 sample-vault，linkIndex 已建索引，含 17 个 note names）
- 初始文档: 空文档（清空后）
- 插件配置: demo 默认（含 createWikilinksPlugin + suggest）
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器
  await clearEditor(page);
  await page.waitForTimeout(300);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | typeInEditor("[[") | [DOM] docChanged → CM6 autocompletion 触发 → `createAutocompleteSource`（`wikilinks.ts:213`）→ `findWikiContext` 找到 `[[` → `suggest("")` 返回全部 note names → tooltip 弹出 | 选择器: .cm-content; 操作: typeInEditor([[); 控件: editor; 等待: 500ms（autocompletion 激活延迟） |
| 2 | 断言补全 tooltip 可见 | [DOM] `.cm-tooltip-autocomplete` 可见，`getAutocompleteState().visible === true`，itemCount > 0（sample-vault 含 17 个文件，getAllNoteNames 返回候选） | 选择器: .cm-tooltip-autocomplete; 操作: getAutocompleteState(); 控件: autocomplete; 等待: 200ms |

**断言汇总**:
- [DOM] 输入 `[[` 后 autocompletion 弹出
- [DOM] 候选列表非空（含 sample-vault 中的 note names）

---

## FP-09-05-N02 [P1] [正常] 输入 [[query→ 包含式过滤候选

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（sample-vault 已索引）
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
| 1 | typeInEditor("[[me") | [DOM] `findWikiContext` query="me" → `suggest("me")` → `filter(n => n.toLowerCase().includes("me"))`（`wikilinks.ts:221-223`）→ 候选含 "Meeting"（work/Meeting、personal/Meeting basename） | 选择器: .cm-content; 操作: typeInEditor([[me); 控件: editor; 等待: 500ms |
| 2 | 断言候选过滤 | [DOM] `getAutocompleteState().visible === true`，itemCount > 0，且候选项文本含 "Meeting" 或 "me"（包含式匹配） | 选择器: .cm-tooltip-autocomplete; 操作: getAutocompleteState() + allTextContents(); 控件: autocomplete; 等待: 200ms |

**断言汇总**:
- [DOM] 输入 query 后候选被包含式过滤
- [DOM] 过滤后的候选项均含 query 子串（大小写不敏感）

---

## FP-09-05-N03 [P2] [正常] 选中候选项→ 插入 [[target]]

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（sample-vault 已索引）
- 初始文档: 空文档
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器并输入 [[ 触发补全
  await clearEditor(page);
  await typeInEditor("[[");
  await page.waitForTimeout(500);
  // step 3: 确认补全弹出
  const ac = await getAutocompleteState(page);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 按 ArrowDown 选中第一个候选，按 Enter | [STATE] Enter → `apply(view, completion, from, to)`（`wikilinks.ts:229-240`）→ 检测后面无 `]]` → `insert = ${name}]]` → dispatch changes 插入 `name]]` + 光标移到末尾 | 选择器: 无; 操作: ArrowDown + Enter; 控件: autocomplete; 等待: 300ms |
| 2 | 断言插入完成 | [DOM] `.cm-content` 含 `[[name]]`（name 为选中的 note name，自动补全 `]]`） | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |
| 3 | 断言补全 tooltip 关闭 | [DOM] `getAutocompleteState().visible === false` | 选择器: .cm-tooltip-autocomplete; 操作: getAutocompleteState(); 控件: autocomplete; 等待: 无 |

**断言汇总**:
- [DOM] 选中候选后插入 `[[name]]`（自动补全 `]]`）
- [DOM] 补全 tooltip 关闭

---

## FP-09-05-E01 [P3] [异常] 输入 [[无匹配候选→ 补全不弹出

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（sample-vault 已索引）
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
| 1 | typeInEditor("[[zzzznonexistent") | [DOM] `findWikiContext` query="zzzznonexistent" → `suggest` 返回候选 → `filter` 无匹配 → `filtered.length === 0` → 返回 null（`wikilinks.ts:224`）→ tooltip 不弹出 | 选择器: .cm-content; 操作: typeInEditor([[zzzznonexistent); 控件: editor; 等待: 500ms |
| 2 | 断言无补全 | [DOM] `getAutocompleteState().visible === false`（无匹配候选时不显示 tooltip） | 选择器: .cm-tooltip-autocomplete; 操作: getAutocompleteState(); 控件: autocomplete; 等待: 200ms |

**断言汇总**:
- [DOM] 无匹配候选时 autocompletion 不弹出

---

## FP-09-05-B01 [P4] [边界] 候选最多 50 个（slice(0, 50) 截断）

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（sample-vault 有 17 个文件，不足 50；此用例验证截断逻辑的边界）
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
| 1 | typeInEditor("[[") | [DOM] `suggest("")` → `slice(0, 50)`（`wikilinks.ts:226`）→ 候选数 = min(实际 note names 数, 50) | 选择器: .cm-content; 操作: typeInEditor([[); 控件: editor; 等待: 500ms |
| 2 | 断言候选数 <= 50 | [DOM] `getAutocompleteState().itemCount <= 50`（sample-vault 17 个文件，候选 <= 17 < 50；验证截断逻辑存在且不超限） | 选择器: .cm-tooltip-autocomplete; 操作: getAutocompleteState(); 控件: autocomplete; 等待: 200ms |

**断言汇总**:
- [DOM] 候选数 <= 50（slice 截断逻辑生效）
- [DOM] sample-vault 场景下候选数 = 实际 note names 数（17 > 50 不成立，验证上限不误伤）

---

## FP-09-05-F01 [P2] [流程] 输入 [[→ 过滤→ 选中→ 导航完整流程

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（sample-vault 已索引）
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
| 1 | typeInEditor("[[ind") | [DOM] 补全弹出，候选含 "index"（`filter("ind")` 匹配 "index"） | 选择器: .cm-content; 操作: typeInEditor([[ind); 控件: editor; 等待: 500ms |
| 2 | 按 Enter 选中第一个候选（index） | [STATE] `apply` 插入 `index]]` → `.cm-content` 含 `[[index]]` | 选择器: 无; 操作: Enter; 控件: autocomplete; 等待: 300ms |
| 3 | 光标移到末尾后点击 `[[index]]` 链接 | [STATE] mousedown → `onNavigate("index", ...)` → 导航到 index.md | 选择器: [data-wikilink-target="index"]; 操作: click(); 控件: editor; 等待: 600ms |
| 4 | 断言导航成功 | [DOM] `.cm-content` 含 index.md 特征内容（如 "Nexus Editor Demo Vault"） | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 完整流程：补全弹出 → 过滤 → 选中插入 → 点击导航
- [DOM] 最终导航到 index.md

---

# FP-09-06 scanWikiLinks(doc) 纯函数返回所有匹配（5 例，[AST解析]）

> 实现路径：`wikilinks.ts:78-111` 的 `scanWikiLinks(doc: string): WikiLinkMatch[]` 是纯函数，无副作用。正则全局匹配，返回 `{ from, to, target, alias?, display, displayFrom, displayTo }` 按 from 升序。Demo 的 `link-index.ts:458` 在 `indexFileInto` 中调用它构建前向索引。e2e 中通过 `page.evaluate` 调用 demo 已导入的 `scanWikiLinks`（需 demo 暴露到 window），或通过 Backlinks 面板间接验证（backlinks-panel 调 `index.getBacklinks` 依赖 scanWikiLinks 结果）。未暴露时标注降级。

## FP-09-06-N01 [P1] [正常] scanWikiLinks 解析多行文档→ 返回所有匹配

**测试框架**: Playwright

**前置条件**（⚠️ 4要素）:
- 依赖环境: Electron demo（需 window.__nexusScanWikiLinks 钩子或间接验证）
- 初始文档: 空文档，通过 page.evaluate 注入测试字符串
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 通过 page.evaluate 调用 scanWikiLinks（需 demo 暴露）
  // 注：若 demo 未暴露 scanWikiLinks，改用 Backlinks 面板间接验证
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | page.evaluate 调 scanWikiLinks | [STATE] 注入 doc = "Link [[A]] and [[B|alias]] end"，调 `scanWikiLinks(doc)`（`wikilinks.ts:78`），返回 2 个匹配 | 选择器: 无; 操作: page.evaluate; 控件: 无; 等待: 无 |
| 2 | 断言匹配结构 | [STATE] match[0].target === "A" && match[0].display === "A"；match[1].target === "B" && match[1].alias === "alias" && match[1].display === "alias"（`wikilinks.ts:86-90`） | 选择器: 无; 操作: page.evaluate; 控件: 无; 等待: 无 |

**断言汇总**:
- [STATE] scanWikiLinks 正确解析多链接文档（降级标注：钩子缺失时通过 Backlinks 面板间接验证）

---

## FP-09-06-N02 [P1] [正常] scanWikiLinks 解析别名→ alias/display/displayFrom/displayTo 正确

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（需钩子或间接验证）
- 初始文档: 通过 page.evaluate 注入
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 准备测试字符串
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | page.evaluate 注入 "[[Target|My Alias]]" | [STATE] `scanWikiLinks` 返回 1 个匹配，target="Target"、alias="My Alias"、display="My Alias"（`wikilinks.ts:90`） | 选择器: 无; 操作: page.evaluate; 控件: 无; 等待: 无 |
| 2 | 断言 displayFrom/displayTo 偏移 | [STATE] displayFrom 指向 "My Alias" 起始偏移，displayTo = displayFrom + 8（"My Alias" 长度）（`wikilinks.ts:97-101` 的 aliasStart 计算） | 选择器: 无; 操作: page.evaluate; 控件: 无; 等待: 无 |

**断言汇总**:
- [STATE] 别名场景的 display/displayFrom/displayTo 偏移正确

---

## FP-09-06-D01 [P2] [数据] scanWikiLinks 按从升序返回

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（需钩子或间接验证）
- 初始文档: 通过 page.evaluate 注入
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | page.evaluate 注入 "[[Z]] mid [[A]] end" | [STATE] `scanWikiLinks` 返回 2 个匹配，match[0].from < match[1].from（正则全局匹配按位置升序，`wikilinks.ts:82` 的 while 循环） | 选择器: 无; 操作: page.evaluate; 控件: 无; 等待: 无 |
| 2 | 断言顺序 | [STATE] match[0].target === "Z"（from=0）、match[1].target === "A"（from > 0）（按文档位置升序，非字母序） | 选择器: 无; 操作: page.evaluate; 控件: 无; 等待: 无 |

**断言汇总**:
- [STATE] 返回结果按 from 升序（文档位置顺序）

---

## FP-09-06-E01 [P3] [异常] scanWikiLinks 对空串返回空数组

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（需钩子）
- 初始文档: 无（直接测试函数）
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | page.evaluate 调 scanWikiLinks("") | [STATE] 返回空数组 []（正则无匹配，`wikilinks.ts:82` while 不进入） | 选择器: 无; 操作: page.evaluate; 控件: 无; 等待: 无 |

**断言汇总**:
- [STATE] 空串返回空数组

---

## FP-09-06-B01 [P4] [边界] Backlinks 面板间接验证 scanWikiLinks→ 打开有反向链接的文件

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（默认打开 sample-vault，linkIndex 已通过 scanWikiLinks 建索引）
- 初始文档: index.md（被多个文件引用，如 Topics/AI.md 含 `[[index]]`）
- 插件配置: demo 默认（含 Backlinks 面板）
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 等待加载 + 建索引
  await page.waitForSelector(".cm-editor", { timeout: 10000 });
  await page.waitForTimeout(1500);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言 Backlinks 面板有 Linked mentions | [DOM] `getBacklinksState().linkedCount > 0`（index.md 被多个文件通过 `[[index]]` 引用，linkIndex 通过 `scanWikiLinks` 解析出这些链接，backlinks-panel 渲染 Linked mentions） | 选择器: .backlinks-panel; 操作: getBacklinksState(); 控件: backlinks; 等待: 无 |

**断言汇总**:
- [DOM] Backlinks 面板显示 Linked mentions > 0（间接证明 scanWikiLinks 正确解析了 vault 中的 wikilinks）

---

# FP-09-07 IME compositionend 后延迟 60ms 重建装饰（4 例，[编辑交互][边界异常]）

> 实现路径：`wikilinks.ts:12` 的 `COMPOSITION_REDECORATE_DELAY_MS = 60`。`wikilinks.ts:288-300` 的 `compositionHandler` 监听 `compositionend`，`setTimeout(60ms)` 后检查 `!view.compositionStarted` → dispatch `rebuildAfterComposition` effect → StateField update（`wikilinks.ts:270-273`）重建装饰。`wikilinks.ts:274-276` 的 update 分支在 `input.type.compose` 期间只做 `decos.map` 不重建，避免 IME 中间态闪烁。

## FP-09-07-N01 [P1] [正常] IME compositionend 后→ 装饰正确重建

**测试框架**: Playwright

**前置条件**（⚠️ 4要素）:
- 依赖环境: Electron demo（支持 IME composition 事件）
- 初始文档: 空文档，输入 `[[` 后用 IME 输入中文 target
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器并输入 [[
  await clearEditor(page);
  await typeInEditor("[[");
  await page.waitForTimeout(300);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 模拟 IME 输入：page.evaluate 触发 compositionstart + compositionend | [STATE] compositionend → `compositionHandler`（`wikilinks.ts:289`）→ `setTimeout(60ms)` → 检查 `!view.compositionStarted` → dispatch `rebuildAfterComposition.of(null)`（`wikilinks.ts:293`）→ StateField update 重建装饰 | 选择器: .cm-content; 操作: 模拟 composition; 控件: editor; 等待: 200ms（含 60ms 延迟） |
| 2 | 断言装饰重建 | [DOM] 若输入了有效的 wikilink target（如输入后形成 `[[index]]`），`[data-wikilink-target]` 存在（60ms 后重建装饰） | 选择器: [data-wikilink-target]; 操作: count(); 控件: editor; 等待: 200ms |

**断言汇总**:
- [STATE] IME compositionend 后 60ms 延迟重建装饰生效
- [DOM] 装饰正确出现

---

## FP-09-07-N02 [P2] [正常] IME 输入中间态→ 装饰不闪烁（仅 map 不重建）

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 含已有 wikilink `[[index]]`
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  // step 2: 清空编辑器并输入已有 wikilink
  await clearEditor(page);
  await typeInEditor("[[index]]");
  await page.waitForTimeout(300);
  const wikiCountBefore = await page.locator("[data-wikilink-target]").count();
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 模拟 compositionstart（IME 开始输入） | [STATE] `input.type.compose` 事件 → StateField update 分支 `tr.isUserEvent("input.type.compose")`（`wikilinks.ts:274`）→ 仅 `decos.map(tr.changes)` 不重建 → 装饰保持稳定 | 选择器: .cm-content; 操作: 模拟 compositionstart; 控件: editor; 等待: 100ms |
| 2 | 断言装饰不闪烁 | [DOM] `[data-wikilink-target]` count 保持稳定（不因 IME 中间态消失重现） | 选择器: [data-wikilink-target]; 操作: count(); 控件: editor; 等待: 无 |

**断言汇总**:
- [STATE] IME 中间态装饰不重建（仅 map），避免闪烁
- [DOM] 装饰 count 稳定

---

## FP-09-07-E01 [P3] [异常] compositionend 后编辑器已销毁→ dispatch 不抛错（try-catch 保护）

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 任意
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: 全局 setup
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 模拟 compositionend 后立即重载页面（模拟编辑器消失） | [STATE] setTimeout 60ms 回调中 `view.dispatch` 可能因 view 已销毁抛错，`wikilinks.ts:294` 的 `try { ... } catch {}` 静默捕获 → 不崩溃 | 选择器: 无; 操作: 模拟 compositionend + 重载; 控件: 无; 等待: 200ms |
| 2 | 断言无未捕获异常 | [STATE] 页面无 unhandled error（try-catch 保护生效） | 选择器: 无; 操作: page.evaluate; 控件: 无; 等待: 无 |

**断言汇总**:
- [STATE] compositionend 回调中编辑器已销毁时 try-catch 保护不抛错

---

## FP-09-07-B01 [P4] [边界] 快速连续 compositionend→ 多个 setTimeout 不冲突

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
| 1 | 快速模拟 3 次 compositionstart/compositionend（间隔 < 60ms） | [STATE] 每次 compositionend 排队 setTimeout 60ms → 多个 effect dispatch → StateField 多次重建（幂等，最终态一致） | 选择器: .cm-content; 操作: 连续模拟 composition; 控件: editor; 等待: 300ms |
| 2 | 断言最终态正确 | [DOM] `.cm-editor` 可见，装饰最终态正确（多次重建幂等无残留） | 选择器: .cm-editor; 操作: toBeVisible(); 控件: editor; 等待: 无 |

**断言汇总**:
- [STATE] 快速连续 compositionend 的多个 setTimeout 不冲突
- [DOM] 最终装饰态正确

---

## 统计汇总

### 类型分布

| 类型 | 数量 | 占比 |
|------|------|------|
| 正常(N) | 24 | 66.7% |
| 异常(E) | 5 | 13.9% |
| 边界(B) | 4 | 11.1% |
| 流程(F) | 2 | 5.6% |
| 数据(D) | 1 | 2.8% |

### 优先级分布

| 优先级 | 数量 | 占比 |
|--------|------|------|
| P1 | 12 | 33.3% |
| P2 | 10 | 27.8% |
| P3 | 7 | 19.4% |
| P4 | 7 | 19.4% |
| P5 | 0 | 0% |

### 框架分布

| 框架 | 数量 | 占比 |
|------|------|------|
| Playwright | 36 | 100% |

### 各二级功能点用例数

| 二级功能点 | 用例数 | 编号范围 |
|-----------|--------|---------|
| FP-09-01 语法解析 | 6 | N01-N03, E01, B01, D01 |
| FP-09-02 装饰（实线/虚线） | 5 | N01-N03, B01, E01 |
| FP-09-03 光标感知 | 6 | N01-N03, B01, E01, F01 |
| FP-09-04 onNavigate 导航 | 5 | N01-N03, E01, B01 |
| FP-09-05 autocompletion | 6 | N01-N03, E01, B01, F01 |
| FP-09-06 scanWikiLinks | 5 | N01-N02, D01, E01, B01 |
| FP-09-07 IME 处理 | 4 | N01-N02, E01, B01 |
| **合计** | **37** | |

### 验证策略分布

| 验证方式 | 用例数 | 说明 |
|---------|--------|------|
| DOM 直接断言（[data-wikilink-target]/.cm-tooltip-autocomplete/.backlinks-panel） | 28 | 通过装饰元素属性和面板内容直接验证 |
| page.evaluate 钩子（scanWikiLinks 纯函数验证） | 5 | 需 demo 暴露 scanWikiLinks 或间接验证 |
| 间接验证（Backlinks 面板验证 scanWikiLinks） | 2 | 钩子缺失时降级 |
| IME 事件模拟 | 4 | compositionstart/compositionend 模拟 |

### 实现差异关键点

| 差异点 | 影响用例 | 应对策略 |
|--------|---------|---------|
| Demo 可能未暴露 scanWikiLinks 到 window | FP-09-06 全部 | 标注"需钩子"，缺失时通过 Backlinks 面板间接验证 |
| Vault 需打开才能 resolve/suggest | FP-09-02/04/05 | demo 默认打开 sample-vault（17 个文件），提供完整测试环境 |
| IME composition 事件模拟 | FP-09-07 全部 | 通过 page.evaluate 模拟 composition 事件 |
| CM6 autocompletion tooltip 选择器 | FP-09-05 全部 | `.cm-tooltip-autocomplete` + `.cm-completionListOption` |
| 光标感知按行判断 | FP-09-03 全部 | 需精确控制光标位置（ControlOrMeta+End/click 行内） |
| sample-vault 含丰富 wikilinks 场景 | 全部 | 已解析/未解析/别名/转义/同目录歧义均已覆盖 |
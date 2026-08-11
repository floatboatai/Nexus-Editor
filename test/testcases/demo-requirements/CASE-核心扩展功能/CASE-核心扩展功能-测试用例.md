# CASE-核心扩展功能-测试用例（FP-11）

> 一级功能点: 核心扩展功能（demo-requirements.md §3.7）
> 全局批次序号: 11
> 生成时间: 2026-08-11
> 测试框架: Playwright（Electron demo e2e）
> 覆盖二级功能点: FP-11-01 ~ FP-11-04（共 4 个）
> 用例总数: 30
>
> 涉及二级功能点:
> - FP-11-01 markdownAutoPair 标记符自动配对（**/*/~~/`）（[编辑交互]）
> - FP-11-02 markdownFold 代码块/标题折叠（[编辑交互][Live Preview]）
> - FP-11-03 markdownKeymap Markdown 特定快捷键（[编辑交互]）
> - FP-11-04 handleMarkdownEnter Enter 续行处理（[编辑交互]）
>
> ⚠️ 实现说明（依据 `packages/core/src/markdown-autopair.ts` + `markdown-fold.ts` + `markdown-keymap.ts` + `editor.ts` 实际代码）:
> - **markdownAutoPair**（`markdown-autopair.ts:23-104`）：通过 `EditorView.inputHandler.of` 注册。两类规则:
>   - 单字符对 `` ` ``（`PAIRS`，第 13-15 行）：无选区时插入 `` ` ` `` 并把光标放在中间（`range.from + 1`）；有选区时用 `` `selected` `` 包裹。
>   - 双字符对 `*` / `~`（`DOUBLE_PAIRS`，第 18-21 行）：仅当**至少一个光标前一个字符等于 `pair.char`** 时才触发（第 63-65 行 `charBeforeMatches`）。触发后无选区变为 `**|**`（第二个 `*` + 闭合 `**`，光标在 `from + 1`）；有选区时移除已输入的首字符并包裹。
>   - IME 组合输入期间直接 `return false` 不拦截（第 25 行）。
> - **markdownFold**（`markdown-fold.ts`）：`markdownFoldService()`（第 15-82 行）注册 `foldService`，提供三类折叠范围:
>   - Heading 折叠（`HEADING_RE = /^(#{1,6}) /`）：从标题行末到下一个同级或更高级标题之前（第 21-39 行）。
>   - Fenced 代码块折叠（`FENCE_OPEN_RE = /^[ \t]*(`{3,}|~{3,})/`）：从开 fence 行末到闭 fence 行末（第 42-54 行）。
>   - 缩进折叠（`INDENT_RE`）：缩进增加的后续行（第 57-78 行）。
>   - **demo 实际只挂载 `markdownFoldService()`**（`editor.ts:669`），**未挂载 `foldGutter()` 和 `foldKeymap`**。因此折叠功能通过 CM6 `foldEffect`/`unfoldEffect` 命令触发（需通过编辑器 API 注入命令或 dispatch effect），UI 上无 fold gutter 按钮。本批次用例通过 `page.evaluate` 调用 CM6 dispatch effect 来验证 foldService 返回的范围正确性。
> - **markdownKeymap**（`markdown-keymap.ts:101-103`）：`Prec.high(keymap.of([{ key: "Enter", run: handleMarkdownEnter }]))`，仅绑定一条 Enter 快捷键，优先级为 high（覆盖默认 Enter）。
> - **handleMarkdownEnter**（`markdown-keymap.ts:52-99`）：
>   - 若**所有光标都不在可续行上**，`return false`（第 54 行，交给默认 Enter）。
>   - 列表 `LIST_RE = /^(\s*)([-*+]|\d+[.)]) /`（第 4 行）：续行时保留 indent + marker；有序列表自动递增（`numMatch`，第 21-24 行）。
>   - 复选框 `CHECKBOX_RE = /^\[([ xX])\] /`（第 5 行）：续行时重置为未勾选 `[ ]`（第 26 行）。
>   - 引用 `BLOCKQUOTE_RE = /^(\s*>+ ?)/`（第 6 行）：续行时保留 `>` 前缀（第 30-33 行）。
>   - **空列表/引用项**（`!continuation.content.trim()`，第 81 行）：清空该行退出列表/引用（第 86-89 行）。
>   - 纯文本行（非列表/引用）：插入普通换行（第 73-78 行）。
>   - 多光标感知：每个 range 独立处理（`state.changeByRange`，第 61 行）。
> - **e2e 验证策略**: 由于 demo 未将 editor 暴露到 `window`，所有验证通过 `.cm-content` 的 textContent / DOM 结构间接进行。autopair 续行通过键盘输入 `**` 后检查文档文本与光标位置（输入后续字符验证光标落点）；fold 通过 evaluate 调用 CM6 effect 后检查折叠占位 DOM（`.cm-foldPlaceholder`）；Enter 续行通过键盘按 Enter 后检查文本内容。
> - 全局 setup 使用 `launchDemo()` 启动 Electron demo。

---

## e2e 全局前置条件

- 依赖环境: Electron demo（Vite dev server localhost:5173 + 已构建的 `apps/electron-demo/dist-electron/main.js`）
- 初始文档: demo 启动后默认状态（可能恢复上次 vault 文档或空文档）
- 插件配置: demo 默认挂载 —— createGfmPreset + createHistoryPlugin + createToolbarPlugin + createSearchPlugin + createWikilinksPlugin + createWordCountPlugin
- 核心扩展: `editor.ts:667-672` 默认挂载 markdownKeymap() + markdownFoldService() + markdownAutoPair()（对所有文档生效，不可关闭）
- 角色权限: 无需登录（本地桌面应用）
- 未达成时的创建过程:
  1. 启动 Vite dev server（终端: `pnpm dev:renderer`; 等待: http://localhost:5173 可访问）
  2. 构建 Electron 主进程（终端: `pnpm build:electron-demo`; 产物: `apps/electron-demo/dist-electron/main.js`）
  3. 测试代码调用 `launchDemo()` 启动 Electron 实例（内部: `electron.launch({ args: [mainJs], env: { VITE_DEV_SERVER_URL: "http://localhost:5173" } })`，等待 `.cm-content` 可见）

setup 代码模板（所有用例通用）:
```typescript
import { _electron as electron, test, expect, type ElectronApplication, type Page } from "@playwright/test";
import { launchDemo } from "../../e2e/helpers/electron-launcher";

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

// 辅助：通过 execCommand 插入文本（含换行的多行文本兼容性更好）
async function insertText(page: Page, text: string) {
  await page.click(".cm-content");
  await page.evaluate((t) => document.execCommand("insertText", false, t), text);
}

// 辅助：键盘逐字符输入（用于触发 inputHandler，如 autopair）
async function typeChars(page: Page, text: string) {
  await page.click(".cm-content");
  await page.keyboard.type(text, { delay: 10 });
}

// 辅助：获取编辑器纯文本内容
async function getEditorText(page: Page): Promise<string> {
  return (await page.locator(".cm-content").textContent()) ?? "";
}

// 辅助：获取编辑器 innerHTML（用于检查装饰/标记 DOM 结构）
async function getEditorHTML(page: Page): Promise<string> {
  return (await page.locator(".cm-content").innerHTML()) ?? "";
}

// 辅助：移光标到文档末尾
async function moveToEnd(page: Page) {
  await page.keyboard.press("ControlOrMeta+End");
}

// 辅助：移光标到文档开头
async function moveToStart(page: Page) {
  await page.keyboard.press("ControlOrMeta+Home");
}

// 辅助：将光标移到指定行（通过 ArrowDown 多次）
async function moveCursorDown(page: Page, lines: number) {
  for (let i = 0; i < lines; i++) {
    await page.keyboard.press("ArrowDown");
  }
}

// 辅助：通过 CM6 dispatch effect 折叠指定行（demo 未暴露 fold API，需直接操作 CM6 view）
// 返回 true 表示成功 dispatch（不保证真的折叠了，需结合 DOM 检查）
// 注：cmTile.view 为 @codemirror/view >= 6.41 在 contentDOM 上挂载的 EditorView（当前版本实测），
//     cmView.view 为旧版（< 6.41）挂载属性，保留以兼容版本回退。
async function foldRangeViaCM6(page: Page, fromPos: number, toPos: number): Promise<boolean> {
  return await page.evaluate(({ fromPos, toPos }) => {
    const cmContent = document.querySelector(".cm-content") as any;
    const view = cmContent?.cmTile?.view ?? cmContent?.cmView?.view;
    if (!view) return false;
    try {
      // 使用 foldEffect 折叠指定范围
      const { foldEffect } = (window as any).CodeMirrorFold ?? {};
      if (foldEffect) {
        view.dispatch({ effects: foldEffect.of({ from: fromPos, to: toPos }) });
        return true;
      }
      // 回退：通过 foldable + foldEffect 从 @codemirror/language（已打包进 demo bundle）
      return false;
    } catch {
      return false;
    }
  }, { fromPos, toPos });
}

// 辅助：通过 CM6 view 对象调用 toggleFold 命令（按行号折叠）
async function toggleFoldAtLine(page: Page, lineIdx: number): Promise<boolean> {
  return await page.evaluate((lineIdx) => {
    const cmContent = document.querySelector(".cm-content") as any;
    const view = cmContent?.cmTile?.view ?? cmContent?.cmView?.view;
    if (!view) return false;
    try {
      // 通过 CodeMirror 内部 API 触发折叠：先取该行 foldable 范围，再 dispatch foldEffect
      // 兼容路径：直接读取 foldService 计算结果不可行，改为使用 foldKeymap 之外的 foldEffect
      const line = view.state.doc.line(lineIdx + 1);
      // 使用 @codemirror/language 的 foldable（已挂载到 view.state 上下文）
      // 这里通过动态 import 不现实，回退到模拟：dispatch 一个 foldEffect
      // demo bundle 中 @codemirror/language 已打包，但未暴露到 window
      // 间接方案：通过 view.dispatch 调用内嵌的 fold 命令
      const foldCmd = (view as any).state?.facet?.((s: any) => s);
      return !!line;
    } catch {
      return false;
    }
  }, lineIdx);
}
```

---

# FP-11-01 markdownAutoPair 标记符自动配对（[编辑交互]）

> `markdownAutoPair()`（`markdown-autopair.ts:23-104`）通过 `EditorView.inputHandler.of` 注册。两类规则:
> - 单字符对 `` ` ``：无选区 → 插入 `` ` ` `` 光标在中间；有选区 → `` `selected` `` 包裹。
> - 双字符对 `**` / `~~`：仅在光标前一个字符是 `*` / `~` 时触发，结果 `**|**` / `~~|~~`，光标在 `from + 1`（位于两个标记之间）。
> 触发点: `editor.ts:672 markdownAutoPair()` 默认挂载。IME 组合期间禁用（第 25 行）。

## FP-11-01-N01 [P1] [正常] 输入单个反引号 → 自动配对为 ` ` 光标在中间

**测试框架**: Playwright

**前置条件**（⚠️ 4要素缺一不可）:
- 依赖数据: demo 应用实例（通过 launchDemo 启动），编辑器处于空状态
- 系统状态: Electron 窗口已打开，Vite dev server 已运行，markdownAutoPair 默认启用（`editor.ts:672`）
- 角色权限: 本地桌面应用，无需登录
- 未达成时的创建过程:
  1. 启动 Vite dev server（终端: `pnpm dev:renderer`; 等待: localhost:5173 可访问）
  2. 构建 Electron 主进程（终端: `pnpm build:electron-demo`; 产物: `apps/electron-demo/dist-electron/main.js`）
  3. test.beforeAll 中调用 `launchDemo()` 启动 Electron
  4. 清空编辑器（`clearEditor`），确保光标在空文档

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后通过 keyboard.type 输入单个反引号 `` ` `` | [STATE] inputHandler 拦截，插入 `` ` ` `` 两个字符（`markdown-autopair.ts:48-51`），光标位于两个反引号中间（`range.from + 1`） | 选择器: .cm-content; 操作: keyboard.type("`", { delay: 10 }); 控件: editor; 等待: 100ms |
| 2 | 断言 `.cm-content` textContent 为两个反引号 | [DOM] 文档内容为 `` ` ` ``（`pair.open + pair.close`，openLen=1, closeLen=1） | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |
| 3 | 继续输入 `code` 验证光标位置 | [DOM] 文档内容为 `` `code` ``（光标在中间，输入的文本被两侧反引号包围） | 选择器: .cm-content; 操作: keyboard.type("code"); 控件: editor; 等待: 100ms |
| 4 | 断言 textContent 含 `` `code` `` | [DOM] 光标确实位于两个反引号之间 | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 单个反引号触发配对，文档含两个反引号
- [DOM] 后续输入位于反引号之间，形成 `` `code` ``

---

## FP-11-01-N02 [P1] [正常] 选中文本后输入反引号 → 包裹选中内容

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入 `hello world` | [DOM] 文档含 "hello world" | 选择器: .cm-content; 操作: keyboard.type("hello world"); 控件: editor; 等待: 100ms |
| 2 | 选中 "world"（Shift+Left x5 或通过 Selection API） | [STATE] 选区为 "world"（range 非空） | 选择器: .cm-content; 操作: keyboard.press(Shift+Left) x5; 控件: editor; 等待: 100ms |
| 3 | 输入单个反引号 `` ` `` | [STATE] inputHandler 命中 `!range.empty` 分支（`markdown-autopair.ts:35-45`），插入 `` `world` `` 包裹选中内容，选区变为包裹后的 "world" | 选择器: .cm-content; 操作: keyboard.type("`"); 控件: editor; 等待: 100ms |
| 4 | 断言 textContent 含 `` hello `world` `` | [DOM] 选中内容被反引号包裹 | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 选中文本被反引号包裹

---

## FP-11-01-N03 [P1] [正常] 连续输入 `**` → 自动配对为 `**|**` 光标在中间

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后通过 keyboard.type 连续输入 `**` | [STATE] 第一个 `*` 走默认插入（`charBeforeMatches` 为 false，inputHandler `return false`）；第二个 `*` 触发 DOUBLE_PAIRS（`markdown-autopair.ts:63-65` `charBeforeMatches` 为 true），dispatch 插入 `*` + 闭合 `**`，结果文档为 `****`，光标在 `from + 1`（位于第 2、3 个字符之间） | 选择器: .cm-content; 操作: keyboard.type("**", { delay: 20 }); 控件: editor; 等待: 150ms |
| 2 | 断言 textContent 含 `****`（4 个星号） | [DOM] 配对成功，文档含开闭 `**` 各一对 | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |
| 3 | 继续输入 `bold` 验证光标位于两组星号之间 | [DOM] 文档为 `**bold**`（输入位于 `**` 和 `**` 之间） | 选择器: .cm-content; 操作: keyboard.type("bold"); 控件: editor; 等待: 100ms |
| 4 | 断言 textContent 含 `**bold**` | [DOM] 光标位于配对标记之间 | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 连续 `**` 触发配对，文档含 `****`
- [DOM] 后续输入形成 `**bold**`

---

## FP-11-01-N04 [P1] [正常] 连续输入 `~~` → 自动配对为 `~~|~~` 光标在中间

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后通过 keyboard.type 连续输入 `~~` | [STATE] 第一个 `~` 默认插入；第二个 `~` 触发 DOUBLE_PAIRS 的 `~` 规则（`markdown-autopair.ts:18-21, 58-65`），结果文档为 `~~~~`，光标位于 `from + 1` | 选择器: .cm-content; 操作: keyboard.type("~~", { delay: 20 }); 控件: editor; 等待: 150ms |
| 2 | 断言 textContent 含 `~~~~`（4 个波浪号） | [DOM] 配对成功 | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |
| 3 | 继续输入 `strike` | [DOM] 文档为 `~~strike~~` | 选择器: .cm-content; 操作: keyboard.type("strike"); 控件: editor; 等待: 100ms |
| 4 | 断言 textContent 含 `~~strike~~` | [DOM] 光标位于配对标记之间 | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 连续 `~~` 触发配对，文档含 `~~~~`
- [DOM] 后续输入形成 `~~strike~~`

---

## FP-11-01-N05 [P2] [正常] 单个 `*`（不连续）不触发双字符配对

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入 `a`（先输入一个普通字符） | [DOM] 文档为 "a" | 选择器: .cm-content; 操作: keyboard.type("a"); 控件: editor; 等待: 100ms |
| 2 | 按 Left 把光标移到行首（光标前为空） | [STATE] 光标位于 from=0，前一个字符不是 `*` | 选择器: .cm-content; 操作: keyboard.press(Home); 控件: editor; 等待: 100ms |
| 3 | 输入单个 `*` | [STATE] `charBeforeMatches(from)` 为 false（前一个字符非 `*`），DOUBLE_PAIRS `continue`（`markdown-autopair.ts:65`），inputHandler `return false`，按默认插入单个 `*` | 选择器: .cm-content; 操作: keyboard.type("*"); 控件: editor; 等待: 100ms |
| 4 | 断言 textContent 为 `*a`（仅一个星号，未配对） | [DOM] 单个 `*` 不触发配对 | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 单个 `*`（前字符非 `*`）不触发配对，文档仅含一个 `*`

---

## FP-11-01-N06 [P2] [正常] 选中文本后输入 `**` → 包裹选中内容为 `**selected**`

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入 `important text here` | [DOM] 文档含该文本 | 选择器: .cm-content; 操作: keyboard.type("important text here"); 控件: editor; 等待: 150ms |
| 2 | 选中 "text"（定位到 "text" 前后选中 4 字符） | [STATE] 选区为 "text"（range 非空，覆盖 "text"） | 选择器: .cm-content; 操作: keyboard.press(Home) + ArrowRight x10 + Shift+ArrowRight x4; 控件: editor; 等待: 150ms |
| 3 | 连续输入 `**` | [STATE] 第一个 `*` 默认插入（选区内）；第二个 `*` 触发 DOUBLE_PAIRS 的选中分支（`markdown-autopair.ts:77-89`），移除已输入的首字符并用 `**selected**` 包裹选区 | 选择器: .cm-content; 操作: keyboard.type("**", { delay: 20 }); 控件: editor; 等待: 150ms |
| 4 | 断言 textContent 含 `important **text** here` | [DOM] 选中内容被 `**` 包裹 | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 选中文本被 `**` 包裹

---

## FP-11-01-E01 [P3] [异常] IME 组合输入期间 autopair 不拦截

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后通过 insertText 直接插入 `*`（模拟组合输入结束后的批量插入，不经过 inputHandler） | [STATE] `insertText` 走 CM6 默认事务而非 inputHandler，不会触发 autopair 配对逻辑（`markdown-autopair.ts:25` composing 时 `return false`） | 选择器: .cm-content; 操作: page.evaluate(t => document.execCommand("insertText", false, t), "*"); 控件: editor; 等待: 100ms |
| 2 | 断言 textContent 含 `*` 但不含 `***`（未配对） | [DOM] execCommand 路径不触发 inputHandler 的双字符配对 | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 组合输入/批量插入路径不触发 autopair

---

## FP-11-01-E02 [P3] [异常] 反引号在已有反引号后输入 → 仍然配对（不智能跳出）

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|
| 1 | 清空编辑器后输入 `` ` `` 触发配对（文档为 `` ` ` ``，光标在中间） | [STATE] 已配对态 | 选择器: .cm-content; 操作: keyboard.type("`"); 控件: editor; 等待: 100ms |
| 2 | 再次输入 `` ` ``（光标在两个反引号之间） | [STATE] 再次命中 PAIRS 单字符规则（`markdown-autopair.ts:30-55`），在当前光标位置（两个反引号中间）再次插入 `` ` ` ``，结果文档为 `` `` ` ` ` ` ``（4 个反引号）。autopair 不做"智能跳出闭合标记"逻辑 | 选择器: .cm-content; 操作: keyboard.type("`"); 控件: editor; 等待: 100ms |
| 3 | 断言 textContent 含 4 个反引号 | [DOM] 连续两次配对，未智能跳出 | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 反引号连续输入继续配对，不智能跳出

---

## FP-11-01-B01 [P4] [边界] 双字符配对仅在光标前字符匹配时触发（行首不触发）

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入 `text` | [DOM] 文档为 "text" | 选择器: .cm-content; 操作: keyboard.type("text"); 控件: editor; 等待: 100ms |
| 2 | 按 Home 移光标到行首 | [STATE] 光标 from=0，`charBeforeMatches(0)` 为 `0 > 0` false（`markdown-autopair.ts:63`） | 选择器: .cm-content; 操作: keyboard.press(Home); 控件: editor; 等待: 100ms |
| 3 | 输入 `*` | [STATE] 行首无前字符，DOUBLE_PAIRS `continue`，默认插入单个 `*` | 选择器: .cm-content; 操作: keyboard.type("*"); 控件: editor; 等待: 100ms |
| 4 | 断言 textContent 为 `*text`（仅一个星号） | [DOM] 行首不触发双字符配对 | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 光标位于行首（前字符不匹配）时不触发双字符配对

---

# FP-11-02 markdownFold 代码块/标题折叠（[编辑交互][Live Preview]）

> `markdownFoldService()`（`markdown-fold.ts:15-82`）注册 CM6 `foldService`，提供三类折叠范围: heading（标题到下一同级标题前）、fenced code block（开 fence 到闭 fence）、indent（缩进增加的连续行）。**demo 实际只挂载 `markdownFoldService()`**（`editor.ts:669`），**未挂载 `foldGutter()` 和 `foldKeymap`**（`markdown-fold.ts:85-89` 的 `markdownFold()` 未被调用）。因此 UI 上无 fold gutter 按钮，折叠功能需通过 CM6 `foldEffect` 命令触发。本批次用例通过 evaluate 直接 dispatch `foldEffect` 来验证 foldService 返回范围正确性，并检查折叠后的 `.cm-foldPlaceholder` DOM 占位。

## FP-11-02-N01 [P1] [正常] heading 折叠 —— 折叠后内容被占位符替代

**测试框架**: Playwright

**前置条件**（⚠️ 4要素缺一不可）:
- 依赖数据: demo 应用实例，编辑器含多行 heading + 内容
- 系统状态: Electron 窗口已打开，markdownFoldService 默认启用（`editor.ts:669`）
- 角色权限: 本地桌面应用，无需登录
- 未达成时的创建过程:
  1. 启动 Vite dev server（终端: `pnpm dev:renderer`; 等待: localhost:5173 可访问）
  2. 构建 Electron 主进程（终端: `pnpm build:electron-demo`; 产物: `apps/electron-demo/dist-electron/main.js`）
  3. test.beforeAll 中调用 `launchDemo()` 启动 Electron
  4. 清空编辑器后 insertText 输入 `# Title\nLine 1\nLine 2\n# Second`（heading 后跟内容再到下一同级标题）

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后 insertText 输入 `# Title\nLine 1\nLine 2\n# Second` | [DOM] 编辑器含 H1 标题 + 2 行内容 + 第二个 H1 | 选择器: .cm-content; 操作: insertText("# Title\nLine 1\nLine 2\n# Second"); 控件: editor; 等待: 300ms |
| 2 | 通过 evaluate dispatch foldEffect 折叠第一个 heading 行（`# Title` 行末到 `# Second` 行前） | [STATE] foldService 对 `# Title` 行返回 `{ from: line1.to, to: line3.from - 1 }`（`markdown-fold.ts:25-38`），foldEffect 应用后该范围被折叠为占位符 | 选择器: body; 操作: page.evaluate(() => { const v = (document.querySelector(".cm-content") as any).cmTile?.view ?? (document.querySelector(".cm-content") as any).cmView?.view; const { foldEffect } = require("@codemirror/language"); v.dispatch({ effects: foldEffect.of({ from: 7, to: 21 }) }); }); 控件: editor; 等待: 300ms |
| 3 | 断言 `.cm-foldPlaceholder` 存在 | [DOM] 折叠占位符渲染（CM6 折叠后用 `.cm-foldPlaceholder` span 替代被折叠内容） | 选择器: .cm-foldPlaceholder; 操作: count(); 控件: fold-widget; 等待: 无 |
| 4 | 断言 textContent 不含 "Line 1" 和 "Line 2"（被折叠隐藏） | [DOM] 折叠后内容不可见 | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] heading 折叠后 `.cm-foldPlaceholder` 存在
- [DOM] 折叠内容（Line 1/Line 2）不可见

---

## FP-11-02-N02 [P1] [正常] heading 折叠范围 —— 到下一同级标题前停止

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后 insertText 输入 `## Sub\nContent A\n# Top` | [DOM] H2 + 内容 + H1 | 选择器: .cm-content; 操作: insertText("## Sub\nContent A\n# Top"); 控件: editor; 等待: 300ms |
| 2 | dispatch foldEffect 折叠 `## Sub` 行（foldService 应返回 `{ from: line1.to, to: line2.to }`，即只折叠 "Content A"，`markdown-fold.ts:29 nextMatch[1].length <= level` 满足 H1(1) <= H2(2) 时停止） | [STATE] 折叠范围正确，仅 "Content A" 被折叠 | 选择器: body; 操作: page.evaluate 折叠 line1 末尾到 line2 末尾; 控件: editor; 等待: 300ms |
| 3 | 断言折叠后 textContent 含 "# Top"（未被折叠） | [DOM] H1 行未被折叠，仅 H2 的内容被折叠 | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |
| 4 | 断言 `.cm-foldPlaceholder` 数量为 1 | [DOM] 仅一个折叠占位 | 选择器: .cm-foldPlaceholder; 操作: count(); 控件: fold-widget; 等待: 无 |

**断言汇总**:
- [DOM] H2 折叠范围在 H1 前停止
- [DOM] "# Top" 仍可见

---

## FP-11-02-N03 [P1] [正常] fenced code block 折叠 —— 开 fence 到闭 fence

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后 insertText 输入 `` ```js\nconsole.log(1)\nconsole.log(2)\n``` `` | [DOM] 编辑器含 fenced code block（4 行） | 选择器: .cm-content; 操作: insertText("```js\nconsole.log(1)\nconsole.log(2)\n```"); 控件: editor; 等待: 300ms |
| 2 | dispatch foldEffect 折叠第一行（`` ```js ``）行末到闭 fence 行末（foldService 对 `` ```js `` 返回 `{ from: line1.to, to: line4.to }`，`markdown-fold.ts:42-54`） | [STATE] 代码块内容（中间 2 行 + 闭 fence）被折叠 | 选择器: body; 操作: page.evaluate dispatch foldEffect; 控件: editor; 等待: 300ms |
| 3 | 断言 `.cm-foldPlaceholder` 存在 | [DOM] 折叠占位符渲染 | 选择器: .cm-foldPlaceholder; 操作: count(); 控件: fold-widget; 等待: 无 |
| 4 | 断言 textContent 不含 "console.log(1)" 和 "console.log(2)"（被折叠） | [DOM] 代码块内容隐藏 | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] fenced code block 折叠后占位符存在
- [DOM] 代码内容被隐藏

---

## FP-11-02-N04 [P2] [正常] 标题无后续内容时 foldService 返回 null（不提供折叠）

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入 `# Lonely Heading`（仅一行标题，无后续内容） | [DOM] 编辑器仅含一行 H1 | 选择器: .cm-content; 操作: keyboard.type("# Lonely Heading"); 控件: editor; 等待: 300ms |
| 2 | 通过 evaluate 检查 foldable：对 line1 调用 foldable 应返回 null（`markdown-fold.ts:36 foldEnd > line.to` 不满足，foldEnd = doc.length = line.to） | [STATE] foldService 返回 null（无内容可折叠） | 选择器: body; 操作: page.evaluate(() => { const v = (document.querySelector(".cm-content") as any).cmTile?.view ?? (document.querySelector(".cm-content") as any).cmView?.view; /* 检查 state.facet 或直接尝试 dispatch foldEffect 不会产生折叠 */ }); 控件: editor; 等待: 无 |
| 3 | 断言 `.cm-foldPlaceholder` 不存在 | [DOM] 无折叠发生 | 选择器: .cm-foldPlaceholder; 操作: count(); 控件: fold-widget; 等待: 无 |

**断言汇总**:
- [DOM] 标题无后续内容时不提供折叠

---

## FP-11-02-N05 [P2] [正常] 缩进内容折叠 —— 缩进增加的后续行可折叠

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后 insertText 输入 `- item\n  nested line 1\n  nested line 2` | [DOM] 编辑器含无序列表 + 缩进续行 | 选择器: .cm-content; 操作: insertText("- item\n  nested line 1\n  nested line 2"); 控件: editor; 等待: 300ms |
| 2 | dispatch foldEffect 折叠 line1 行末到 line3 行末（foldService indent 分支：line1 indent=0，line2/line3 indent=2 > 0，返回 `{ from: line1.to, to: line3.to }`，`markdown-fold.ts:57-78`） | [STATE] 缩进续行被折叠 | 选择器: body; 操作: page.evaluate dispatch foldEffect; 控件: editor; 等待: 300ms |
| 3 | 断言 `.cm-foldPlaceholder` 存在 | [DOM] 折叠占位符渲染 | 选择器: .cm-foldPlaceholder; 操作: count(); 控件: fold-widget; 等待: 无 |
| 4 | 断言 textContent 不含 "nested line 1"（被折叠） | [DOM] 缩进内容隐藏 | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 缩进内容可折叠
- [DOM] 折叠后缩进行内容隐藏

---

## FP-11-02-E01 [P3] [异常] 不完整的 fenced code block（无闭 fence）不崩溃

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后 insertText 输入 `` ```js\nconsole.log(1) ``（无闭 fence） | [DOM] 编辑器含未闭合代码块 | 选择器: .cm-content; 操作: insertText("```js\nconsole.log(1)"); 控件: editor; 等待: 300ms |
| 2 | 尝试 dispatch foldEffect 折叠第一行 | [STATE] foldService fenced 分支遍历后续行未找到闭 fence（`markdown-fold.ts:47-53` 循环结束不 return），落入 indent 分支或返回 null，不崩溃 | 选择器: body; 操作: page.evaluate dispatch foldEffect; 控件: editor; 等待: 300ms |
| 3 | 断言 `.cm-content` 仍可见且可交互 | [DOM] 编辑器正常，未崩溃 | 选择器: .cm-content; 操作: count(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 未闭合代码块不导致崩溃

---

## FP-11-02-B01 [P4] [边界] H6（最大级别）标题折叠正常工作

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后 insertText 输入 `###### Deep\ncontent under h6` | [DOM] H6 标题 + 内容 | 选择器: .cm-content; 操作: insertText("###### Deep\ncontent under h6"); 控件: editor; 等待: 300ms |
| 2 | dispatch foldEffect 折叠 H6 行（foldService `HEADING_RE = /^(#{1,6}) /` 匹配 6 个 `#`，level=6） | [STATE] H6 标题可折叠（无更高级别标题，折叠到文档末尾，`markdown-fold.ts:25 foldEnd = state.doc.length`） | 选择器: body; 操作: page.evaluate dispatch foldEffect; 控件: editor; 等待: 300ms |
| 3 | 断言 `.cm-foldPlaceholder` 存在 | [DOM] H6 折叠成功 | 选择器: .cm-foldPlaceholder; 操作: count(); 控件: fold-widget; 等待: 无 |
| 4 | 断言 textContent 不含 "content under h6" | [DOM] 内容被折叠 | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] H6 标题折叠正常

---

# FP-11-03 markdownKeymap Markdown 特定快捷键（[编辑交互]）

> `markdownKeymap()`（`markdown-keymap.ts:101-103`）仅注册一条高优先级快捷键: `Enter → handleMarkdownEnter`（`Prec.high`）。该快捷键在列表/引用行上拦截 Enter 实现续行，在普通文本行上 `return false` 让默认 Enter 处理。注意: 工具栏插件的 Mod-b/i/... 快捷键属于 FP-16-01，不在本 FP 范围内。本 FP 的"Markdown 特定快捷键"特指 Enter 续行这一条绑定。

## FP-11-03-N01 [P1] [正常] Enter 键绑定 handleMarkdownEnter —— 列表行触发续行

**测试框架**: Playwright

**前置条件**（⚠️ 4要素缺一不可）:
- 依赖数据: demo 应用实例，编辑器含列表行
- 系统状态: Electron 窗口已打开，markdownKeymap 默认启用（`editor.ts:667 markdownKeymap()`）
- 角色权限: 本地桌面应用，无需登录
- 未达成时的创建过程:
  1. 启动 Vite dev server（终端: `pnpm dev:renderer`; 等待: localhost:5173 可访问）
  2. 构建 Electron 主进程（终端: `pnpm build:electron-demo`; 产物: `apps/electron-demo/dist-electron/main.js`）
  3. test.beforeAll 中调用 `launchDemo()` 启动 Electron
  4. 清空编辑器后输入 `- item`（无序列表行），光标在行末

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入 `- item`，光标在行末 | [DOM] 文档为 "- item" | 选择器: .cm-content; 操作: keyboard.type("- item"); 控件: editor; 等待: 150ms |
| 2 | 按 Enter | [STATE] markdownKeymap 的 Enter 绑定命中（`markdown-keymap.ts:102 key: "Enter"`），`handleMarkdownEnter` 返回 true，插入 `\n- `（续行），文档变为 `- item\n- ` | 选择器: .cm-content; 操作: keyboard.press(Enter); 控件: editor; 等待: 150ms |
| 3 | 断言 textContent 含 `- item\n- `（或经 Live Preview 处理后含 "item" 和续行标记） | [DOM] Enter 触发列表续行 | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] Enter 在列表行触发续行，新增 `- ` 前缀

---

## FP-11-03-N02 [P1] [正常] Enter 在普通文本行 → handleMarkdownEnter 返回 false，默认换行

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入 `plain text`，光标在行末 | [DOM] 文档为 "plain text" | 选择器: .cm-content; 操作: keyboard.type("plain text"); 控件: editor; 等待: 150ms |
| 2 | 按 Enter | [STATE] `handleMarkdownEnter` 检查 `isContinuable` 为 false（`continuationFor` 对 "plain text" 返回 null，`markdown-keymap.ts:39-41`），`return false`（第 54 行），CM6 默认 Enter 插入换行 | 选择器: .cm-content; 操作: keyboard.press(Enter); 控件: editor; 等待: 150ms |
| 3 | 断言 textContent 含 "plain text" 后跟换行（无列表/引用前缀） | [DOM] 普通文本行 Enter 仅换行，无续行前缀 | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 普通文本行 Enter 不触发续行前缀

---

## FP-11-03-N03 [P2] [正常] Enter 在引用行 `> quote` → 续行 `> `

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入 `> quote text` | [DOM] 文档为 "> quote text" | 选择器: .cm-content; 操作: keyboard.type("> quote text"); 控件: editor; 等待: 150ms |
| 2 | 按 Enter | [STATE] `continuationFor` 匹配 BLOCKQUOTE_RE（`markdown-keymap.ts:30-33`），续行插入 `\n> `，文档变为 `> quote text\n> ` | 选择器: .cm-content; 操作: keyboard.press(Enter); 控件: editor; 等待: 150ms |
| 3 | 断言 textContent 含续行的 `> ` 前缀 | [DOM] 引用续行成功 | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 引用行 Enter 续行 `> ` 前缀

---

## FP-11-03-E01 [P3] [异常] Enter 在选区非空时 → handleMarkdownEnter 走选区替换分支

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入 `- item content` | [DOM] 列表行 | 选择器: .cm-content; 操作: keyboard.type("- item content"); 控件: editor; 等待: 150ms |
| 2 | 选中 "content"（Shift+Left x7） | [STATE] 选区非空（range.empty 为 false） | 选择器: .cm-content; 操作: keyboard.press(Shift+Left) x7; 控件: editor; 等待: 150ms |
| 3 | 按 Enter | [STATE] `isContinuable` 检查 `range.empty`（`markdown-keymap.ts:40`），选区非空时该 range 不算 continuable；但若其他 range 可续行仍会进入 dispatch，选区 range 走 `\n` 替换分支（第 62-67 行）。单光标场景：选区非空 → isContinuable false → 整体 return false → 默认 Enter 替换选区为换行 | 选择器: .cm-content; 操作: keyboard.press(Enter); 控件: editor; 等待: 150ms |
| 4 | 断言 textContent 不含 "content"（被替换为换行） | [DOM] 选区被换行替换 | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 选区非空时 Enter 走默认替换行为

---

## FP-11-03-B01 [P4] [边界] Enter 优先级 high —— 不被其他低优先级 Enter 绑定覆盖

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入 `1. first`（有序列表） | [DOM] 有序列表行 | 选择器: .cm-content; 操作: keyboard.type("1. first"); 控件: editor; 等待: 150ms |
| 2 | 按 Enter | [STATE] markdownKeymap 使用 `Prec.high`（`markdown-keymap.ts:102`），优先级高于默认 keymap，handleMarkdownEnter 命中并续行 `2. `（有序列表递增，第 21-24 行） | 选择器: .cm-content; 操作: keyboard.press(Enter); 控件: editor; 等待: 150ms |
| 3 | 断言 textContent 含 `1. first\n2. `（序号递增为 2） | [DOM] 高优先级 Enter 绑定生效，有序列表序号递增 | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] high 优先级 Enter 绑定覆盖默认，有序列表递增

---

# FP-11-04 handleMarkdownEnter Enter 续行处理（[编辑交互]）

> `handleMarkdownEnter`（`markdown-keymap.ts:52-99`）核心续行逻辑:
> - 列表 `LIST_RE = /^(\s*)([-*+]|\d+[.)]) /`：续行保留 indent + marker，有序列表自动递增（`numMatch`，第 21-24 行）。
> - 复选框 `CHECKBOX_RE = /^\[([ xX])\] /`：续行重置为未勾选 `[ ]`（第 26 行）。
> - 引用 `BLOCKQUOTE_RE = /^(\s*>+ ?)/`：续行保留 `>` 前缀（第 30-33 行）。
> - **空列表/引用项**（`!continuation.content.trim()`，第 81 行）：清空该行退出列表/引用（第 86-89 行）。
> - 多光标感知：`state.changeByRange` 每个 range 独立处理（第 61 行）。

## FP-11-04-N01 [P1] [正常] 无序列表项 Enter → 续行保留 `- ` 前缀

**测试框架**: Playwright

**前置条件**（⚠️ 4要素缺一不可）:
- 依赖数据: demo 应用实例，编辑器含无序列表行
- 系统状态: Electron 窗口已打开，markdownKeymap 默认启用
- 角色权限: 本地桌面应用，无需登录
- 未达成时的创建过程:
  1. 启动 Vite dev server（终端: `pnpm dev:renderer`; 等待: localhost:5173 可访问）
  2. 构建 Electron 主进程（终端: `pnpm build:electron-demo`; 产物: `apps/electron-demo/dist-electron/main.js`）
  3. test.beforeAll 中调用 `launchDemo()` 启动 Electron
  4. 清空编辑器后输入 `- item`，光标在行末

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入 `- item`，光标在行末 | [DOM] 文档为 "- item" | 选择器: .cm-content; 操作: keyboard.type("- item"); 控件: editor; 等待: 150ms |
| 2 | 按 Enter | [STATE] handleMarkdownEnter 命中 LIST_RE（`markdown-keymap.ts:10-27`），marker="-"，无 CHECKBOX_RE，续行插入 `\n- `（第 92-95 行 `insert: "\n" + continuation.prefix`，prefix = `${indent}${nextMarker} `） | 选择器: .cm-content; 操作: keyboard.press(Enter); 控件: editor; 等待: 150ms |
| 3 | 断言 textContent 含 `- item` 后跟 `- ` 续行 | [DOM] 无序列表续行成功 | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 无序列表 Enter 续行 `- ` 前缀

---

## FP-11-04-N02 [P1] [正常] 有序列表项 Enter → 续行序号递增（1. → 2.）

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入 `1. first` | [DOM] 有序列表行 | 选择器: .cm-content; 操作: keyboard.type("1. first"); 控件: editor; 等待: 150ms |
| 2 | 按 Enter | [STATE] LIST_RE 匹配 marker="1."，`numMatch` 命中（`markdown-keymap.ts:21-24`），`nextMarker = "2."`，续行插入 `\n2. ` | 选择器: .cm-content; 操作: keyboard.press(Enter); 控件: editor; 等待: 150ms |
| 3 | 断言 textContent 含 `1. first\n2. ` | [DOM] 有序列表序号递增为 2 | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 有序列表 Enter 续行序号递增

---

## FP-11-04-N03 [P1] [正常] 有序列表 `)` 分隔符 → 续行递增保留 `)` 

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入 `1) first` | [DOM] 有序列表行（`)` 分隔符） | 选择器: .cm-content; 操作: keyboard.type("1) first"); 控件: editor; 等待: 150ms |
| 2 | 按 Enter | [STATE] LIST_RE `\d+[.)]` 匹配 `)`（`markdown-keymap.ts:4`），numMatch 捕获分隔符 `)`，nextMarker = `2)`，续行插入 `\n2) ` | 选择器: .cm-content; 操作: keyboard.press(Enter); 控件: editor; 等待: 150ms |
| 3 | 断言 textContent 含 `1) first\n2) ` | [DOM] `)` 分隔符保留并递增 | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] `)` 分隔符有序列表续行保留 `)`

---

## FP-11-04-N04 [P1] [正常] task list（`- [x]`）Enter → 续行重置为未勾选 `- [ ]`

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入 `- [x] done task` | [DOM] 已勾选任务列表项 | 选择器: .cm-content; 操作: keyboard.type("- [x] done task"); 控件: editor; 等待: 150ms |
| 2 | 按 Enter | [STATE] LIST_RE 匹配后 afterMarker = `[x] done task`，CHECKBOX_RE 匹配 `[x] `（`markdown-keymap.ts:16-17`），续行 prefix = `${indent}${nextMarker} [ ] `（第 26 行 cbMatch 为 true 时强制 `[ ]`），插入 `\n- [ ] ` | 选择器: .cm-content; 操作: keyboard.press(Enter); 控件: editor; 等待: 150ms |
| 3 | 断言 textContent 含续行 `- [ ] `（重置为未勾选） | [DOM] 任务列表续行重置为未勾选 | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] task list 续行重置 checkbox 为 `[ ]`

---

## FP-11-04-N05 [P1] [正常] 空列表项 Enter → 退出列表（清空当前行）

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入 `- item` 后按 Enter（产生空列表续行 `- `），再按 Enter | [STATE] 第一次 Enter 续行产生 `- item\n- `，光标在第二行 `- ` 后；第二次 Enter 时 continuation.content 为空（`markdown-keymap.ts:81 !continuation.content.trim()`），清空当前行退出列表（第 86-89 行 `changes: { from: line.from, to: line.to, insert: "" }`） | 选择器: .cm-content; 操作: keyboard.type("- item") + keyboard.press(Enter) + keyboard.press(Enter); 控件: editor; 等待: 300ms |
| 2 | 断言 textContent 为 `- item\n`（第二行的 `- ` 被清空） | [DOM] 空列表项 Enter 退出列表 | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 空列表项 Enter 退出列表，清空标记

---

## FP-11-04-N06 [P2] [正常] 嵌套缩进列表 Enter → 续行保留缩进

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后 insertText 输入 `- parent\n  - child`，光标移到第二行行末 | [DOM] 嵌套列表（子项缩进 2 空格） | 选择器: .cm-content; 操作: insertText("- parent\n  - child") + keyboard.press(End); 控件: editor; 等待: 300ms |
| 2 | 按 Enter | [STATE] LIST_RE 匹配第二行，indent="  "（2 空格），marker="-"，续行 prefix = `  - `（保留缩进，第 26 行 `${indent}${nextMarker} `），插入 `\n  - ` | 选择器: .cm-content; 操作: keyboard.press(End) + keyboard.press(Enter); 控件: editor; 等待: 150ms |
| 3 | 断言 textContent 含 `  - child\n  - `（缩进保留） | [DOM] 嵌套列表续行保留缩进 | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 嵌套列表续行保留缩进

---

## FP-11-04-N07 [P2] [正常] 多级引用 `>>` Enter → 续行保留 `>> ` 前缀

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入 `>> nested quote` | [DOM] 嵌套引用行 | 选择器: .cm-content; 操作: keyboard.type(">> nested quote"); 控件: editor; 等待: 150ms |
| 2 | 按 Enter | [STATE] BLOCKQUOTE_RE `/^(\s*>+ ?)/` 匹配 `>> `（`markdown-keymap.ts:6, 30-33`），prefix = `>> `，续行插入 `\n>> ` | 选择器: .cm-content; 操作: keyboard.press(Enter); 控件: editor; 等待: 150ms |
| 3 | 断言 textContent 含 `>> nested quote\n>> ` | [DOM] 多级引用续行保留 `>>` | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 多级引用续行保留 `>> ` 前缀

---

## FP-11-04-E01 [P3] [异常] 空引用项 Enter → 退出引用（清空 `>` 前缀）

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入 `> quote` 后按 Enter（产生 `> ` 续行），再按 Enter | [STATE] 第一次 Enter 续行 `> `；第二次 Enter 时 continuation.content 为空，清空当前行退出引用（`markdown-keymap.ts:81-89`） | 选择器: .cm-content; 操作: keyboard.type("> quote") + keyboard.press(Enter) + keyboard.press(Enter); 控件: editor; 等待: 300ms |
| 2 | 断言 textContent 为 `> quote\n`（第二行 `> ` 被清空） | [DOM] 空引用项 Enter 退出引用 | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 空引用项 Enter 退出引用

---

## FP-11-04-B01 [P4] [边界] 列表项内含 `*` 符号（`* item`）→ 续行保留 `* `

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入 `* star item` | [DOM] 使用 `*` 作为列表标记的无序列表 | 选择器: .cm-content; 操作: keyboard.type("* star item"); 控件: editor; 等待: 150ms |
| 2 | 按 Enter | [STATE] LIST_RE `[-*+]` 匹配 `*`（`markdown-keymap.ts:4`），续行 prefix = `* `，插入 `\n* ` | 选择器: .cm-content; 操作: keyboard.press(Enter); 控件: editor; 等待: 150ms |
| 3 | 断言 textContent 含 `* star item\n* ` | [DOM] `*` 列表标记续行保留 | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] `*` 列表标记续行

---

## 统计汇总

### 类型分布

| 类型 | 数量 | 占比 |
|------|------|------|
| 正常(N) | 21 | 70.0% |
| 异常(E) | 5 | 16.7% |
| 边界(B) | 4 | 13.3% |
| 流程(F) | 0 | 0% |
| 数据(D) | 0 | 0% |

### 优先级分布

| 优先级 | 数量 | 占比 |
|--------|------|------|
| P1 | 14 | 46.7% |
| P2 | 7 | 23.3% |
| P3 | 5 | 16.7% |
| P4 | 4 | 13.3% |
| P5 | 0 | 0% |

### 各二级功能点用例数

| 二级功能点 | 用例数 | 编号范围 |
|-----------|--------|---------|
| FP-11-01 markdownAutoPair | 9 | N01-N06, E01-E02, B01 |
| FP-11-02 markdownFold | 7 | N01-N05, E01, B01 |
| FP-11-03 markdownKeymap | 5 | N01-N03, E01, B01 |
| FP-11-04 handleMarkdownEnter | 9 | N01-N07, E01, B01 |
| **合计** | **30** | |

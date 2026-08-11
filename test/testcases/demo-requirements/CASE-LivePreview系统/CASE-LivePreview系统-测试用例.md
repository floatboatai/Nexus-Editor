# CASE-LivePreview系统-测试用例（FP-08）

> 一级功能点: Live Preview 系统（demo-requirements.md §3.4）
> 全局批次序号: 08
> 生成时间: 2026-08-11
> 测试框架: Playwright（Electron demo e2e）
> 覆盖二级功能点: FP-08-01 ~ FP-08-06（共 6 个）
> 用例总数: 38
>
> 涉及二级功能点:
> - FP-08-01 光标感知折叠/展开（光标不在=折叠Widget，移入=展开源码）（[Live Preview][编辑交互]）
> - FP-08-02 heading 标题节点渲染（# 折叠）（[Live Preview]）
> - FP-08-03 行内格式渲染（bold/italic/strikethrough/code 标记隐藏）（[Live Preview]）
> - FP-08-04 link/image 节点渲染（[Live Preview]）
> - FP-08-05 块级渲染（list/blockquote/table/hr/codeblock）（[Live Preview]）
> - FP-08-06 LivePreviewRenderer 自定义渲染器接口（[插件能力][Live Preview]）
>
> ⚠️ 实现说明:
> - Live Preview 系统在 `packages/core/src/live-preview.ts` 中实现，核心机制: `buildDecorations()` 遍历 mdast 节点，根据 `selectionIntersects()` 判断光标是否在节点范围内，决定折叠（Decoration.replace 隐藏标记）或展开（显示源码）。
> - demo 通过 `editor-shell.ts:147-316` 配置 livePreview: `{ enabled: true, renderers: { image: ... } }`，自定义了 image 渲染器（含尺寸解析、路径重写、resize 手柄）。
> - 支持节点类型: heading, bold(strong), italic(emphasis), strikethrough(delete), code(inlineCode), link, image, list, blockquote, table, hr(thematicBreak), codeblock(code)。
> - 光标感知的核心判断函数: `selectionIntersects(from, to, selection, inclusiveEnd?)`，当光标落在节点范围内时展开源码，否则折叠标记。
> - e2e 验证策略: 输入 Markdown 语法 → 光标移出 → 检查标记隐藏（折叠）；光标移入 → 检查标记显示（展开）。通过 `.cm-content` 文本内容和 DOM 结构断言。
> - 全局 setup 使用 `launchDemo()` 启动 Electron demo。

---

## e2e 全局前置条件

- 依赖环境: Electron demo（Vite dev server localhost:5173 + 已构建的 `apps/electron-demo/dist-electron/main.js`）
- 初始文档: demo 启动后默认状态（可能恢复上次 vault 的文档或空文档）
- 插件配置: demo 默认挂载 —— createGfmPreset + createHistoryPlugin + createToolbarPlugin + createSearchPlugin + createWikilinksPlugin + createWordCountPlugin
- livePreview 配置: demo 默认 `settings.livePreview = true`（editor-shell.ts:147-149），image 渲染器已自定义
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

// 辅助：键盘输入文本
async function typeInEditor(page: Page, text: string) {
  await page.click(".cm-content");
  await page.keyboard.type(text);
}

// 辅助：通过 execCommand 插入文本（含换行的多行文本兼容性更好）
async function insertText(page: Page, text: string) {
  await page.click(".cm-content");
  await page.evaluate((t) => document.execCommand("insertText", false, t), text);
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

// 辅助：确保 livePreview 开启（默认开启，若不确定可检查）
async function ensureLivePreviewOn(page: Page) {
  // 默认 settings.livePreview = true，无需操作
  // 若需要验证: 可通过 Settings 面板确认
}
```

---

# FP-08-01 光标感知折叠/展开（[Live Preview][编辑交互]）

> 核心: `selectionIntersects(from, to, selection, inclusiveEnd?)` 判断光标是否在节点范围内。光标不在 → 折叠（Decoration.replace 隐藏标记）；光标移入 → 展开源码（显示原始 Markdown 标记）。live-preview.ts:448-458（heading 示例）, 1149-1154（link 示例）。

## FP-08-01-N01 [P1] [正常] 光标移出 heading 行 → # 标记折叠隐藏

**测试框架**: Playwright

**前置条件**（⚠️ 4要素缺一不可）:
- 依赖数据: demo 应用实例（通过 launchDemo 启动），编辑器中有 heading 语法文本
- 系统状态: Electron 窗口已打开，Vite dev server 已运行，livePreview 默认开启
- 角色权限: 本地桌面应用，无需登录
- 未达成时的创建过程:
  1. 启动 Vite dev server（终端: `pnpm dev:renderer`; 等待: localhost:5173 可访问）
  2. 构建 Electron 主进程（终端: `pnpm build:electron-demo`; 产物: `apps/electron-demo/dist-electron/main.js`）
  3. test.beforeAll 中调用 `launchDemo()` 启动 Electron（页面入口: 自动打开首个窗口; 无需输入）
  4. 清空编辑器（`clearEditor`），输入 `# Heading One` + Enter + Enter（创建 heading 行并留出空行）

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入 `# Heading One` | [DOM] `.cm-content` 含 heading 文本 | 选择器: .cm-content; 操作: keyboard.type("# Heading One"); 控件: editor; 等待: 300ms |
| 2 | 按 Enter 再按 Enter（移光标到 heading 行之外的空行） | [DOM] 光标离开 heading 行范围，触发折叠（live-preview.ts:448 `cursorOnHeading = selectionIntersects`，光标不在范围时 `Decoration.replace` 隐藏 `# ` 前缀） | 选择器: .cm-content; 操作: keyboard.press(Enter) x2; 控件: editor; 等待: 300ms |
| 3 | 断言 `.cm-content` textContent 含 "Heading One" 但不含 "# " 前缀 | [DOM] `# ` 被 Decoration.replace 隐藏，仅 "Heading One" 可读 | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |
| 4 | 断言 heading 装饰属性存在 | [DOM] `[data-heading-level='1']` 存在（live-preview.ts:464 `"data-heading-level": String(range.node.depth)`） | 选择器: [data-heading-level='1']; 操作: count(); 控件: heading-widget; 等待: 无 |

**断言汇总**:
- [DOM] textContent 含 "Heading One" 且不含 "# "
- [DOM] `[data-heading-level='1']` 存在

---

## FP-08-01-N02 [P1] [正常] 光标移入 heading 行 → # 标记展开显示

**测试框架**: Playwright

**前置条件**: 全局 setup + 编辑器中已有 heading 语法文本且当前处于折叠态

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入 `# Heading Two` + Enter + Enter，确保光标在空行（折叠态） | [DOM] heading 折叠，`# ` 不可见 | 选择器: .cm-content; 操作: keyboard.type + Enter x2; 控件: editor; 等待: 300ms |
| 2 | 按 ArrowUp 将光标移回 heading 行 | [DOM] 光标进入 heading 范围，触发展开（live-preview.ts:448-450 `cursorOnHeading` 为 true 时，改用 `Decoration.mark` 而非 replace，`# ` 标记可见） | 选择器: .cm-content; 操作: keyboard.press(ArrowUp); 控件: editor; 等待: 300ms |
| 3 | 断言 `.cm-content` textContent 含 "# Heading Two" | [DOM] `# ` 标记展开显示，源码可见 | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 光标移入后 textContent 含 "# "

---

## FP-08-01-N03 [P1] [正常] 光标移入再移出 → 折叠/展开状态正确切换

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入 `**bold**` + Enter + Enter | [DOM] 编辑器含 bold 语法，光标在空行（折叠态） | 选择器: .cm-content; 操作: keyboard.type("**bold**") + Enter x2; 控件: editor; 等待: 300ms |
| 2 | 断言折叠态 —— textContent 不含 `**` | [DOM] `**` 被隐藏 | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |
| 3 | 按 ArrowUp 移光标到 bold 行 | [DOM] 光标进入 bold 范围，`**` 展开 | 选择器: .cm-content; 操作: keyboard.press(ArrowUp); 控件: editor; 等待: 300ms |
| 4 | 断言展开态 —— textContent 含 `**bold**` | [DOM] `**` 标记可见 | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |
| 5 | 按 ArrowDown 移光标回空行 | [DOM] 光标离开，重新折叠 | 选择器: .cm-content; 操作: keyboard.press(ArrowDown); 控件: editor; 等待: 300ms |
| 6 | 断言重新折叠 —— textContent 不含 `**` | [DOM] `**` 再次被隐藏 | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 移出 → 折叠（不含 `**`）
- [DOM] 移入 → 展开（含 `**`）
- [DOM] 再移出 → 重新折叠（不含 `**`）

---

## FP-08-01-N04 [P2] [正常] 光标在行末（End 键）时视为在行内 → 保持展开

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入 `# H3` + Enter + Enter | [DOM] heading 折叠态 | 选择器: .cm-content; 操作: keyboard.type("# H3") + Enter x2; 控件: editor; 等待: 300ms |
| 2 | 按 ArrowUp 移到 heading 行，再按 End 移到行末 | [DOM] 光标在行末（inclusiveEnd:true 判定为在行内，live-preview.ts:448 `selectionIntersects` 传 `inclusiveEnd` 参数） | 选择器: .cm-content; 操作: keyboard.press(ArrowUp) + keyboard.press(End); 控件: editor; 等待: 300ms |
| 3 | 断言展开态 —— textContent 含 "# H3" | [DOM] 行末位置仍算行内，`# ` 可见 | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 光标在行末时保持展开

---

## FP-08-01-E01 [P3] [异常] 光标在不同行的多个节点 → 各自独立折叠/展开

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入两行: `**first**` + Enter + `**second**` + Enter | [DOM] 编辑器含两行 bold 语法 | 选择器: .cm-content; 操作: keyboard.type("**first**") + Enter + keyboard.type("**second**") + Enter; 控件: editor; 等待: 300ms |
| 2 | 按 ArrowUp 移光标到 second 行（第一个 bold 仍折叠，第二个展开） | [DOM] first 行的 `**` 隐藏，second 行的 `**` 可见（各节点独立判断光标范围） | 选择器: .cm-content; 操作: keyboard.press(ArrowUp); 控件: editor; 等待: 300ms |
| 3 | 断言 innerHTML 含 second 的 `**` 但 first 的 `**` 被隐藏 | [DOM] 两行折叠状态不同 | 选择器: .cm-content; 操作: innerHTML(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 不同行的节点独立折叠/展开

---

## FP-08-01-B01 [P4] [边界] 光标恰好落在标记开头边界 → 展开行为

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入 `**edge**` + Enter + Enter | [DOM] bold 语法折叠态 | 选择器: .cm-content; 操作: keyboard.type("**edge**") + Enter x2; 控件: editor; 等待: 300ms |
| 2 | 按 ArrowUp 移到 bold 行，按 Home 移到行首 | [DOM] 光标在行首，恰好落在 `**` 开头位置 | 选择器: .cm-content; 操作: keyboard.press(ArrowUp) + keyboard.press(Home); 控件: editor; 等待: 300ms |
| 3 | 断言展开态 —— textContent 含 `**edge**` | [DOM] 光标在节点范围边界时展开 | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 光标在标记开头边界时展开

---

## FP-08-01-D01 [P3] [数据] 折叠/展开切换不改变文档底层内容（getDocument 一致）

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入 `# Title` + Enter + `**bold**` | [DOM] 编辑器含 heading 和 bold 语法 | 选择器: .cm-content; 操作: keyboard.type("# Title") + Enter + keyboard.type("**bold**"); 控件: editor; 等待: 300ms |
| 2 | 通过 evaluate 获取 `window.__editor.getDocument()` | [STATE] 文档内容为 "# Title\n**bold**"（Live Preview 是纯装饰层，不修改文档） | 选择器: body; 操作: evaluate(() => window.__editor?.getDocument()); 控件: editor; 等待: 无 |
| 3 | 移光标到 heading 行（ArrowUp x2），触发展开 | [DOM] heading 展开 | 选择器: .cm-content; 操作: keyboard.press(ArrowUp) x2; 控件: editor; 等待: 300ms |
| 4 | 再次获取 getDocument | [STATE] 文档内容仍为 "# Title\n**bold**"（展开不改变文档） | 选择器: body; 操作: evaluate(() => window.__editor?.getDocument()); 控件: editor; 等待: 无 |

**断言汇总**:
- [STATE] 折叠和展开状态下 getDocument 一致

---

# FP-08-02 heading 标题节点渲染（[Live Preview]）

> heading 节点: `buildHeadingDecorations()`（live-preview.ts:435-470），折叠时 `Decoration.replace` 隐藏 `# ` 前缀，`Decoration.mark` 对标题文本加粗+字号+`data-heading-level`+`role="heading"`+`aria-level`。`HEADING_FONT_SIZE` 数组定义各级字号。

## FP-08-02-N01 [P1] [正常] H1 标题折叠 —— # 前缀隐藏 + data-heading-level='1'

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器 + livePreview 开启

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入 `# Level One` + Enter + Enter | [DOM] heading 折叠态 | 选择器: .cm-content; 操作: keyboard.type("# Level One") + Enter x2; 控件: editor; 等待: 300ms |
| 2 | 断言 textContent 含 "Level One" 不含 "# " | [DOM] `# ` 被 Decoration.replace 隐藏（live-preview.ts:457 `decos.push(Decoration.replace({}).range(range.from, textStart))`） | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |
| 3 | 断言 `[data-heading-level='1']` 存在 | [DOM] heading mark 装饰包含 level 属性（live-preview.ts:464） | 选择器: [data-heading-level='1']; 操作: count(); 控件: heading-widget; 等待: 无 |
| 4 | 断言 heading 元素含 `role="heading"` 和 `aria-level="1"` | [DOM] 无障碍属性正确（live-preview.ts:465-466） | 选择器: [role="heading"][aria-level="1"]; 操作: count(); 控件: heading-widget; 等待: 无 |

**断言汇总**:
- [DOM] H1 `# ` 隐藏
- [DOM] `[data-heading-level='1']` 存在
- [DOM] `role="heading"` + `aria-level="1"` 存在

---

## FP-08-02-N02 [P1] [正常] H2 标题折叠 —— ## 前缀隐藏

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入 `## Level Two` + Enter + Enter | [DOM] H2 heading 折叠态 | 选择器: .cm-content; 操作: keyboard.type("## Level Two") + Enter x2; 控件: editor; 等待: 300ms |
| 2 | 断言 textContent 含 "Level Two" 不含 "## " | [DOM] `## ` 前缀隐藏 | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |
| 3 | 断言 `[data-heading-level='2']` 存在 | [DOM] level=2 属性 | 选择器: [data-heading-level='2']; 操作: count(); 控件: heading-widget; 等待: 无 |

**断言汇总**:
- [DOM] H2 `## ` 隐藏
- [DOM] `[data-heading-level='2']` 存在

---

## FP-08-02-N03 [P2] [正常] H3-H6 各级标题折叠验证

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入多行: `### H3` + Enter + `#### H4` + Enter + `##### H5` + Enter + `###### H6` + Enter | [DOM] 编辑器含 4 级标题 | 选择器: .cm-content; 操作: keyboard.type; 控件: editor; 等待: 500ms |
| 2 | 按 ArrowDown 移光标到最后一行空行，触发全部折叠 | [DOM] 所有 heading 折叠 | 选择器: .cm-content; 操作: keyboard.press(ArrowDown); 控件: editor; 等待: 300ms |
| 3 | 断言 textContent 含 "H3"、"H4"、"H5"、"H6" 但不含 "#" 前缀 | [DOM] 各级 `#` 前缀全部隐藏 | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |
| 4 | 断言各级 data-heading-level 存在 | [DOM] `[data-heading-level='3']` ~ `[data-heading-level='6']` 各存在 | 选择器: [data-heading-level='3'], [data-heading-level='4'], [data-heading-level='5'], [data-heading-level='6']; 操作: count(); 控件: heading-widget; 等待: 无 |

**断言汇总**:
- [DOM] H3-H6 的 `#` 前缀全部隐藏
- [DOM] 各级 data-heading-level 属性存在

---

## FP-08-02-N04 [P2] [正常] heading 折叠时字号大于正文（HEADING_FONT_SIZE）

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入 `normal text` + Enter + `# Big Heading` + Enter + Enter | [DOM] 编辑器含正文和 H1 标题 | 选择器: .cm-content; 操作: keyboard.type; 控件: editor; 等待: 300ms |
| 2 | 断言 heading 元素 font-size 大于正文 font-size | [DOM] `[data-heading-level='1']` 的 style 含 `font-size`，值大于正文（live-preview.ts:447 `HEADING_FONT_SIZE[range.node.depth]`，H1 为最大字号） | 选择器: [data-heading-level='1']; 操作: evaluate(el => el.style.fontSize); 控件: heading-widget; 等待: 无 |

**断言汇总**:
- [DOM] H1 字号大于正文

---

## FP-08-02-E01 [P3] [异常] 空标题 `# ` （无文本）不崩溃

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入 `# ` + Enter + Enter（# 后无文本） | [DOM] 编辑器不崩溃，heading 装饰正常处理（live-preview.ts:443 `textStart > range.from` 判断保护） | 选择器: .cm-content; 操作: keyboard.type("# ") + Enter x2; 控件: editor; 等待: 300ms |
| 2 | 断言 `.cm-content` 仍可见且可交互 | [DOM] 编辑器正常 | 选择器: .cm-content; 操作: count(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 空标题不导致崩溃

---

## FP-08-02-B01 [P4] [边界] 连续多个 heading 行折叠渲染

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入 `# A` + Enter + `# B` + Enter + `# C` + Enter | [DOM] 编辑器含 3 个 H1 标题 | 选择器: .cm-content; 操作: keyboard.type; 控件: editor; 等待: 300ms |
| 2 | 按 ArrowDown 移到空行，触发全部折叠 | [DOM] 3 个 heading 同时折叠 | 选择器: .cm-content; 操作: keyboard.press(ArrowDown); 控件: editor; 等待: 300ms |
| 3 | 断言 `[data-heading-level='1']` 数量为 3 | [DOM] 3 个独立的 heading 装饰 | 选择器: [data-heading-level='1']; 操作: count(); 控件: heading-widget; 等待: 无 |

**断言汇总**:
- [DOM] 连续 3 个 H1 全部折叠渲染

---

# FP-08-03 行内格式渲染（[Live Preview]）

> 行内格式: bold(strong)、italic(emphasis)、strikethrough(delete)、inlineCode。`getInlineMarkerStyle()`（live-preview.ts:982-1029）返回各类型的 openLen/closeLen/style。光标不在行内时 `Decoration.replace` 隐藏开闭标记，`Decoration.mark` 应用样式（live-preview.ts:1216-1242）。

## FP-08-03-N01 [P1] [正常] bold（**text**）标记折叠 —— ** 隐藏

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器 + livePreview 开启

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入 `This is **bold** text` + Enter + Enter | [DOM] bold 折叠态 | 选择器: .cm-content; 操作: keyboard.type("This is **bold** text") + Enter x2; 控件: editor; 等待: 300ms |
| 2 | 断言 textContent 含 "bold" 但不含 `**` | [DOM] 开闭 `**` 被隐藏（openLen=2, closeLen=2，live-preview.ts:984-985） | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |
| 3 | 断言 innerHTML 含 `font-weight:bold` 样式 | [DOM] bold 文本被 mark 装饰应用加粗样式（live-preview.ts:985 `style: "font-weight:bold"`） | 选择器: .cm-content; 操作: innerHTML(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] `**` 标记隐藏
- [DOM] bold 文本含 `font-weight:bold`

---

## FP-08-03-N02 [P1] [正常] italic（*text*）标记折叠 —— * 隐藏

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入 `This is *italic* text` + Enter + Enter | [DOM] italic 折叠态 | 选择器: .cm-content; 操作: keyboard.type("This is *italic* text") + Enter x2; 控件: editor; 等待: 300ms |
| 2 | 断言 textContent 含 "italic" 但不含单独的 `*`（需排除 `**` 情况） | [DOM] 开闭 `*` 被隐藏（openLen=1, closeLen=1，live-preview.ts:986-987） | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |
| 3 | 断言 innerHTML 含 `font-style:italic` 样式 | [DOM] italic 文本被应用斜体样式 | 选择器: .cm-content; 操作: innerHTML(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] `*` 标记隐藏
- [DOM] italic 文本含 `font-style:italic`

---

## FP-08-03-N03 [P1] [正常] strikethrough（~~text~~）标记折叠 —— ~~ 隐藏

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入 `This is ~~strike~~ text` + Enter + Enter | [DOM] strikethrough 折叠态 | 选择器: .cm-content; 操作: keyboard.type("This is ~~strike~~ text") + Enter x2; 控件: editor; 等待: 300ms |
| 2 | 断言 textContent 含 "strike" 但不含 `~~` | [DOM] 开闭 `~~` 被隐藏（openLen=2, closeLen=2，live-preview.ts:988-989） | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |
| 3 | 断言 innerHTML 含 `text-decoration:line-through` 样式 | [DOM] strikethrough 文本被应用删除线样式 | 选择器: .cm-content; 操作: innerHTML(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] `~~` 标记隐藏
- [DOM] strikethrough 文本含 `text-decoration:line-through`

---

## FP-08-03-N04 [P1] [正常] inline code（`code`）标记折叠 —— 反引号隐藏

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入 `Use ` + 反引号 + `inline` + 反引号 + ` here` + Enter + Enter | [DOM] inline code 折叠态 | 选择器: .cm-content; 操作: keyboard.type("Use `inline` here") + Enter x2; 控件: editor; 等待: 300ms |
| 2 | 断言 textContent 含 "inline" 但不含反引号 | [DOM] 反引号被隐藏（openLen=1, closeLen=1，live-preview.ts:990-998 检测 ` 数量） | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |
| 3 | 断言 innerHTML 含 `font-family:monospace` 或 background 样式 | [DOM] inline code 被应用等宽字体+背景样式（live-preview.ts:996） | 选择器: .cm-content; 操作: innerHTML(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 反引号标记隐藏
- [DOM] inline code 含 `font-family:monospace`

---

## FP-08-03-N05 [P2] [正常] 嵌套行内格式（**bold *italic***）折叠渲染

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入 `**bold *and italic***` + Enter + Enter | [DOM] 嵌套格式折叠态 | 选择器: .cm-content; 操作: keyboard.type("**bold *and italic***") + Enter x2; 控件: editor; 等待: 300ms |
| 2 | 断言 textContent 含 "bold *and italic*" 但外层 `**` 隐藏 | [DOM] 嵌套标记正确处理 | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |
| 3 | 断言 innerHTML 含 bold 和 italic 样式 | [DOM] 嵌套样式同时应用 | 选择器: .cm-content; 操作: innerHTML(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 嵌套行内格式折叠渲染

---

## FP-08-03-N06 [P2] [正常] 同行多种格式混合（bold + italic + code）

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入 `**bold** and *italic* and ` + 反引号 + `code` + 反引号 + Enter + Enter | [DOM] 同行 3 种格式折叠态 | 选择器: .cm-content; 操作: keyboard.type; 控件: editor; 等待: 300ms |
| 2 | 断言 textContent 含 "bold"、"italic"、"code" 但不含 `**`、`*`、反引号 | [DOM] 所有标记被隐藏 | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 同行多格式标记全部隐藏

---

## FP-08-03-E01 [P3] [异常] 光标在行内时样式仍应用但标记可见

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入 `**visible**` + Enter + Enter | [DOM] bold 折叠态 | 选择器: .cm-content; 操作: keyboard.type("**visible**") + Enter x2; 控件: editor; 等待: 300ms |
| 2 | 按 ArrowUp 移光标回 bold 行 | [DOM] 光标在行内，标记展开但样式仍应用（live-preview.ts:1218-1223 内层 mark 装饰无论光标位置都应用样式） | 选择器: .cm-content; 操作: keyboard.press(ArrowUp); 控件: editor; 等待: 300ms |
| 3 | 断言 textContent 含 `**visible**`（标记可见） | [DOM] 光标在行内时标记展开 | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |
| 4 | 断言 innerHTML 仍含 `font-weight:bold` | [DOM] 标记可见时样式仍然应用 | 选择器: .cm-content; 操作: innerHTML(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 光标在行内: 标记可见 + 样式仍应用

---

# FP-08-04 link/image 节点渲染（[Live Preview]）

> link: 光标不在范围内时 `Decoration.replace` 将 `[text](url)` 替换为仅显示 text 的 widget span（含 `data-link-url` 属性），live-preview.ts:1145-1170。image: 自定义渲染器（editor-shell.ts:151-313），光标不在 → widget 折叠；光标在 → 源码可见 + 预览并排，live-preview.ts:1112-1144。

## FP-08-04-N01 [P1] [正常] link 折叠 —— [ ](url) 标记隐藏，仅显示链接文本

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器 + livePreview 开启

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入 `[Click here](https://example.com)` + Enter + Enter | [DOM] link 折叠态 | 选择器: .cm-content; 操作: keyboard.type("[Click here](https://example.com)") + Enter x2; 控件: editor; 等待: 300ms |
| 2 | 断言 textContent 含 "Click here" 但不含 "[Click here](https://example.com)" | [DOM] `[` 和 `](url)` 被隐藏，仅 "Click here" 可见（live-preview.ts:1000-1009 openLen=1, closeLen=含 ](url)） | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |
| 3 | 断言 innerHTML 不含 "https://example.com" 的原始 markdown | [DOM] URL 被折叠到 widget 内 | 选择器: .cm-content; 操作: innerHTML(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] link 标记和 URL 隐藏，仅显示链接文本

---

## FP-08-04-N02 [P1] [正常] link 折叠时显示 data-link-url 属性

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入 `[Nexus](https://nexus.dev)` + Enter + Enter | [DOM] link 折叠态 | 选择器: .cm-content; 操作: keyboard.type("[Nexus](https://nexus.dev)") + Enter x2; 控件: editor; 等待: 300ms |
| 2 | 断言 innerHTML 含 `data-link-url` 属性且值为 "https://nexus.dev" | [DOM] link widget span 含 data-link-url 属性（live-preview.ts:1008 `attrs: { "data-link-url": url }`） | 选择器: .cm-content; 操作: innerHTML(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] `[data-link-url]` 属性存在且 URL 正确

---

## FP-08-04-N03 [P1] [正常] image 折叠 —— 自定义渲染器渲染 .nexus-image wrapper

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入 `![alt text](https://example.com/img.png)` + Enter + Enter | [DOM] image 折叠态 | 选择器: .cm-content; 操作: keyboard.type("![alt text](https://example.com/img.png)") + Enter x2; 控件: editor; 等待: 500ms |
| 2 | 断言 `.nexus-image` wrapper 存在 | [DOM] 自定义 image 渲染器生成 wrapper（editor-shell.ts:163 `wrapper.className = "nexus-image"`） | 选择器: .nexus-image; 操作: count(); 控件: image-widget; 等待: 无 |
| 3 | 断言 wrapper 含 `data-live-preview-image` 属性 | [DOM] 属性存在（editor-shell.ts:167） | 选择器: [data-live-preview-image]; 操作: count(); 控件: image-widget; 等待: 无 |
| 4 | 断言 wrapper 内含 img 元素 | [DOM] `.nexus-image img` 存在（可能因网络错误显示占位） | 选择器: .nexus-image img; 操作: count(); 控件: image-widget; 等待: 无 |

**断言汇总**:
- [DOM] `.nexus-image` wrapper 存在
- [DOM] `[data-live-preview-image]` 属性存在
- [DOM] img 元素存在

---

## FP-08-04-N04 [P2] [正常] image 尺寸解析 —— alt|width 语法设置 img 宽度

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入 `![pic|300](https://example.com/img.png)` + Enter + Enter | [DOM] image 渲染，尺寸解析生效 | 选择器: .cm-content; 操作: keyboard.type("![pic|300](https://example.com/img.png)") + Enter x2; 控件: editor; 等待: 500ms |
| 2 | 断言 `.nexus-image img` 的 style.width 为 "300px" | [DOM] `parseImageSize("pic|300")` 解析 width=300，editor-shell.ts:178 `img.style.width = width + "px"` | 选择器: .nexus-image img; 操作: evaluate(el => el.style.width); 控件: image-widget; 等待: 无 |

**断言汇总**:
- [DOM] img 宽度为 300px

---

## FP-08-04-N05 [P2] [正常] image 光标移入 → 源码可见 + 预览并排

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入 `![demo](https://example.com/x.png)` + Enter + Enter | [DOM] image 折叠态（widget 模式） | 选择器: .cm-content; 操作: keyboard.type("![demo](https://example.com/x.png)") + Enter x2; 控件: editor; 等待: 500ms |
| 2 | 按 ArrowUp 移光标回 image 行 | [DOM] 光标进入 image 范围，切换为编辑模式（live-preview.ts:1135-1143 cursorOnImage=true 时源码可见 + block widget 预览追加在 to 之后） | 选择器: .cm-content; 操作: keyboard.press(ArrowUp); 控件: editor; 等待: 500ms |
| 3 | 断言 textContent 含 `![demo](https://example.com/x.png)` 源码 | [DOM] 源码可见 | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |
| 4 | 断言 `.nexus-image` widget 仍存在（预览并排） | [DOM] block widget 预览渲染在源码下方 | 选择器: .nexus-image; 操作: count(); 控件: image-widget; 等待: 无 |

**断言汇总**:
- [DOM] 光标在 image 范围: 源码可见 + 预览并排

---

## FP-08-04-E01 [P3] [异常] image 加载失败 → 显示占位错误提示

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入 `![broken](https://nonexistent.invalid/bad.png)` + Enter + Enter | [DOM] image 渲染，但加载失败 | 选择器: .cm-content; 操作: keyboard.type("![broken](https://nonexistent.invalid/bad.png)") + Enter x2; 控件: editor; 等待: 2s（等待 image error 事件） |
| 2 | 断言 `.nexus-image` 内含错误占位（span 或 error 提示文本） | [DOM] img error 事件触发后替换为占位提示（editor-shell.ts image renderer error 事件处理） | 选择器: .nexus-image; 操作: evaluate(el => el.textContent); 控件: image-widget; 等待: 无 |

**断言汇总**:
- [DOM] 图片加载失败显示占位提示

---

# FP-08-05 块级渲染（list/blockquote/table/hr/codeblock）（[Live Preview]）

> 块级节点: list（`buildListDecorations` live-preview.ts:476-577，标记替换为 bullet/序号 widget + checkbox）、blockquote（`buildBlockquoteDecorations` live-preview.ts:771-850，`>` 标记隐藏 + 边框样式 + GFM Alert badge）、table（`EditableTableWidget` live-preview-table.ts）、hr/thematicBreak（block widget live-preview.ts:1244-1266）、codeblock（`buildCodeBlockDecorations` live-preview.ts:857+，fenced 代码块渲染 + 语法高亮 + 语言标签）。

## FP-08-05-N01 [P1] [正常] 无序列表折叠 —— -/* 标记隐藏，显示圆点

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器 + livePreview 开启

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入 `- item one` + Enter + `- item two` + Enter + Enter | [DOM] 无序列表折叠态 | 选择器: .cm-content; 操作: keyboard.type("- item one") + Enter + keyboard.type("- item two") + Enter + Enter; 控件: editor; 等待: 300ms |
| 2 | 断言 textContent 含 "item one" 和 "item two" 但不含 "- " 前缀 | [DOM] `- ` 被替换为圆点 widget（live-preview.ts:523-525 `bullet.textContent = "• "`，Decoration.replace 隐藏原始 marker） | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |
| 3 | 断言 innerHTML 含 `•` 或 bullet widget DOM | [DOM] 圆点 widget 渲染 | 选择器: .cm-content; 操作: innerHTML(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] `- ` 标记隐藏，圆点 widget 渲染

---

## FP-08-05-N02 [P1] [正常] 有序列表折叠 —— 1. 标记隐藏，显示序号

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入 `1. first` + Enter + `2. second` + Enter + Enter | [DOM] 有序列表折叠态 | 选择器: .cm-content; 操作: keyboard.type("1. first") + Enter + keyboard.type("2. second") + Enter + Enter; 控件: editor; 等待: 300ms |
| 2 | 断言 textContent 含 "first" 和 "second" 但不含 "1. " / "2. " 原始标记 | [DOM] 序号 marker 被替换为 widget（live-preview.ts:519 `bullet.textContent = "${ordinal}. "`） | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 有序列表标记隐藏

---

## FP-08-05-N03 [P1] [正常] task list 复选框折叠 —— [ ]/[x] 渲染为 checkbox

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入 `- [ ] todo` + Enter + `- [x] done` + Enter + Enter | [DOM] task list 折叠态 | 选择器: .cm-content; 操作: keyboard.type("- [ ] todo") + Enter + keyboard.type("- [x] done") + Enter + Enter; 控件: editor; 等待: 300ms |
| 2 | 断言 innerHTML 含 `<input` checkbox 元素 | [DOM] `[ ]`/`[x]` 被替换为 checkbox widget（live-preview.ts:540-558） | 选择器: .cm-content; 操作: innerHTML(); 控件: editor; 等待: 无 |
| 3 | 断言 checkbox checked 状态正确 | [DOM] 第一个 checkbox 未选中，第二个已选中 | 选择器: .cm-content input[type="checkbox"]; 操作: evaluateAll(els => els.map(el => el.checked)); 控件: checkbox-widget; 等待: 无 |

**断言汇总**:
- [DOM] task list checkbox widget 渲染
- [DOM] checked 状态正确

---

## FP-08-05-N04 [P1] [正常] blockquote 折叠 —— > 标记隐藏 + 边框样式

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入 `> quoted text` + Enter + Enter | [DOM] blockquote 折叠态 | 选择器: .cm-content; 操作: keyboard.type("> quoted text") + Enter + Enter; 控件: editor; 等待: 300ms |
| 2 | 断言 textContent 含 "quoted text" 但不含 "> " 前缀 | [DOM] `> ` 被隐藏（live-preview.ts:813-816 `cursorInBlockquote` 为 false 且 markerMatch 时 Decoration.replace） | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |
| 3 | 断言 innerHTML 含 `border-left` 样式 | [DOM] blockquote 行装饰应用左边框（live-preview.ts:796-800 `"border-left:3px solid var(--nexus-border)"`） | 选择器: .cm-content; 操作: innerHTML(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] `> ` 标记隐藏
- [DOM] blockquote 含 `border-left` 样式

---

## FP-08-05-N05 [P1] [正常] 表格折叠 —— 渲染为 EditableTableWidget

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入表格语法（使用 insertText 支持多行）: `| A | B |\n|---|---|\n| 1 | 2 |` + Enter | [DOM] 表格渲染为 widget | 选择器: .cm-content; 操作: insertText("| A | B |\n|---|---|\n| 1 | 2 |\n"); 控件: editor; 等待: 500ms |
| 2 | 按 ArrowDown 移光标到表格之外 | [DOM] 光标离开表格范围，触发折叠 | 选择器: .cm-content; 操作: keyboard.press(ArrowDown); 控件: editor; 等待: 300ms |
| 3 | 断言 `.nexus-table-wrapper` 或 `table` 元素存在 | [DOM] 表格折叠为 EditableTableWidget（live-preview.ts:1078-1086 `new EditableTableWidget`） | 选择器: .nexus-table-wrapper, table.nexus-table; 操作: count(); 控件: table-widget; 等待: 无 |
| 4 | 断言 textContent 含 "A"、"B"、"1"、"2" | [DOM] 表格内容可读 | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 表格 widget 存在
- [DOM] 表格内容可读

---

## FP-08-05-N06 [P1] [正常] hr 水平分割线折叠 —— --- 渲染为 hr widget

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入 `before` + Enter + `---` + Enter + `after` | [DOM] hr 渲染为 widget | 选择器: .cm-content; 操作: keyboard.type("before") + Enter + keyboard.type("---") + Enter + keyboard.type("after"); 控件: editor; 等待: 500ms |
| 2 | 按 ArrowDown 移光标到末尾 | [DOM] 光标离开 hr 行 | 选择器: .cm-content; 操作: keyboard.press(ArrowDown); 控件: editor; 等待: 300ms |
| 3 | 断言 innerHTML 含 `<hr` 元素 | [DOM] `---` 被替换为 hr block widget（live-preview.ts:1244-1266 BLOCK_NODE_TYPES 含 thematicBreak，始终渲染为 widget） | 选择器: .cm-content; 操作: innerHTML(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] `---` 渲染为 `<hr>` widget

---

## FP-08-05-N07 [P1] [正常] codeblock 折叠 —— 代码块渲染 + 语言标签

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入代码块（使用 insertText）: `` ```js\nconst x = 1;\n``` `` + Enter | [DOM] codeblock 渲染 | 选择器: .cm-content; 操作: insertText("```js\nconst x = 1;\n```\n"); 控件: editor; 等待: 500ms |
| 2 | 按 ArrowDown 移光标到代码块之外 | [DOM] 光标离开 codeblock 范围，触发折叠渲染 | 选择器: .cm-content; 操作: keyboard.press(ArrowDown); 控件: editor; 等待: 300ms |
| 3 | 断言 innerHTML 含 `<pre` 和 `<code` 元素 | [DOM] codeblock 渲染为 pre/code 结构（live-preview-renderers.ts:108-159 默认 code 渲染器） | 选择器: .cm-content; 操作: innerHTML(); 控件: editor; 等待: 无 |
| 4 | 断言 innerHTML 含语言标签 "js" | [DOM] 语言标签显示（live-preview-renderers.ts:152-156 langLabel） | 选择器: .cm-content; 操作: innerHTML(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] codeblock 渲染为 pre/code
- [DOM] 语言标签显示

---

# FP-08-06 LivePreviewRenderer 自定义渲染器接口（[插件能力][Live Preview]）

> `LivePreviewRenderer` 接口（types.ts:62）: `(context: LivePreviewRenderContext) => HTMLElement`。demo 通过 `editor-shell.ts:150-313` 自定义了 image 渲染器。当 `config.renderers[nodeType]` 存在时，走自定义渲染分支（live-preview.ts:1070 `!config.renderers.heading` 判断、1112 image 分支始终走 renderLivePreviewNode）。`renderLivePreviewNode` 在 live-preview-renderers.ts 中根据是否有自定义渲染器决定使用自定义或默认渲染。

## FP-08-06-N01 [P1] [正常] demo 自定义 image 渲染器 —— wrapper .nexus-image 存在

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器 + livePreview 开启

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入 `![test](https://example.com/img.png)` + Enter + Enter | [DOM] image 通过自定义渲染器渲染 | 选择器: .cm-content; 操作: keyboard.type("![test](https://example.com/img.png)") + Enter x2; 控件: editor; 等待: 500ms |
| 2 | 断言 `.nexus-image` wrapper 存在 | [DOM] 自定义渲染器生效（editor-shell.ts:163 `wrapper.className = "nexus-image"`，非默认渲染器） | 选择器: .nexus-image; 操作: count(); 控件: image-widget; 等待: 无 |
| 3 | 断言 wrapper 含 View source 按钮 `</>` | [DOM] 自定义渲染器特有元素（editor-shell.ts:186 `srcBtn.textContent = "</>"`） | 选择器: .nexus-image button[title="View source"]; 操作: count(); 控件: image-widget; 等待: 无 |

**断言汇总**:
- [DOM] `.nexus-image` wrapper 存在（自定义渲染器）
- [DOM] View source 按钮存在

---

## FP-08-06-N02 [P2] [正常] 自定义渲染器 View source 按钮 —— 点击跳转到源码

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入 `![src](https://example.com/x.png)` + Enter + Enter | [DOM] image 折叠态 | 选择器: .cm-content; 操作: keyboard.type("![src](https://example.com/x.png)") + Enter x2; 控件: editor; 等待: 500ms |
| 2 | 点击 `.nexus-image button[title="View source"]` 按钮 | [STATE] 光标移动到 image 源码范围（editor-shell.ts srcBtn click handler dispatch setSelection(range.from)） | 选择器: .nexus-image button[title="View source"]; 操作: click(); 控件: button; 等待: 300ms |
| 3 | 断言 textContent 含 `![src](https://example.com/x.png)` 源码 | [DOM] 光标进入 image 范围，源码展开显示 | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 点击 View source 后源码展开

---

## FP-08-06-N03 [P2] [正常] 默认渲染器（无自定义 heading renderer）—— heading 使用内置渲染

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入 `# Built-in Heading` + Enter + Enter | [DOM] heading 渲染 | 选择器: .cm-content; 操作: keyboard.type("# Built-in Heading") + Enter x2; 控件: editor; 等待: 300ms |
| 2 | 断言 heading 使用内置渲染（live-preview.ts:1070 `!config.renderers.heading` 为 true → 走 `buildHeadingDecorations` 内置逻辑） | [DOM] `[data-heading-level='1']` 存在（内置 heading 装饰） | 选择器: [data-heading-level='1']; 操作: count(); 控件: heading-widget; 等待: 无 |
| 3 | 断言 `# ` 前缀被隐藏（内置渲染生效） | [DOM] textContent 不含 "# " | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 无自定义 heading 渲染器时使用内置渲染

---

## FP-08-06-N04 [P2] [正常] 自定义 image 渲染器 —— 相对路径重写为 nexus-vault://

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器 + 已打开 Vault（有 activeFile 和 vaultPath）

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入 `![local](images/photo.png)` + Enter + Enter | [DOM] image 渲染，相对路径被重写 | 选择器: .cm-content; 操作: keyboard.type("![local](images/photo.png)") + Enter x2; 控件: editor; 等待: 500ms |
| 2 | 断言 `.nexus-image img` 的 src 含 `nexus-vault://` | [DOM] 相对路径经 `resolveImageSrc(url, activeFile, vaultPath)` 重写为 `nexus-vault://vault/<encoded-rel>`（editor-shell.ts:170, demo-requirements §10.3） | 选择器: .nexus-image img; 操作: evaluate(el => el.src); 控件: image-widget; 等待: 无 |

**断言汇总**:
- [DOM] 相对路径重写为 nexus-vault:// 协议

---

## FP-08-06-E01 [P3] [异常] 自定义渲染器不影响文档内容 —— getDocument 返回原始 markdown

**测试框架**: Playwright

**前置条件**: 全局 setup + 清空编辑器

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器后输入 `![check](https://example.com/a.png)` + Enter + `# Heading` | [DOM] 编辑器含 image 和 heading | 选择器: .cm-content; 操作: keyboard.type("![check](https://example.com/a.png)") + Enter + keyboard.type("# Heading"); 控件: editor; 等待: 500ms |
| 2 | 通过 evaluate 获取 getDocument | [STATE] 文档内容含原始 markdown `![check](https://example.com/a.png)` 和 `# Heading`（自定义渲染器是纯装饰，不修改文档） | 选择器: body; 操作: evaluate(() => window.__editor?.getDocument()); 控件: editor; 等待: 无 |

**断言汇总**:
- [STATE] 自定义渲染器不修改文档内容

---

## 统计汇总

### 类型分布

| 类型 | 数量 | 占比 |
|------|------|------|
| 正常(N) | 30 | 78.9% |
| 异常(E) | 5 | 13.2% |
| 边界(B) | 2 | 5.3% |
| 流程(F) | 0 | 0% |
| 数据(D) | 1 | 2.6% |

### 优先级分布

| 优先级 | 数量 | 占比 |
|--------|------|------|
| P1 | 20 | 52.6% |
| P2 | 10 | 26.3% |
| P3 | 6 | 15.8% |
| P4 | 2 | 5.3% |
| P5 | 0 | 0% |

### 各二级功能点用例数

| 二级功能点 | 用例数 | 编号范围 |
|-----------|--------|---------|
| FP-08-01 光标感知折叠/展开 | 7 | N01-N04, E01, B01, D01 |
| FP-08-02 heading 标题节点 | 6 | N01-N04, E01, B01 |
| FP-08-03 行内格式 | 7 | N01-N06, E01 |
| FP-08-04 link/image | 6 | N01-N05, E01 |
| FP-08-05 块级渲染 | 7 | N01-N07 |
| FP-08-06 自定义渲染器 | 5 | N01-N04, E01 |
| **合计** | **38** | |

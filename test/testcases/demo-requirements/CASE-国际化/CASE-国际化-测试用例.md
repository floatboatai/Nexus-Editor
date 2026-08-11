# CASE-国际化-测试用例（FP-12）

> 一级功能点: 国际化（demo-requirements.md §3.8）
> 全局批次序号: 12
> 生成时间: 2026-08-11
> 测试框架: Playwright（Electron demo e2e）
> 覆盖二级功能点: FP-12-01 ~ FP-12-02（共 2 个）
> 用例总数: 14
>
> 涉及二级功能点:
> - FP-12-01 enLocale / zhLocale 内置 locale（[国际化]）
> - FP-12-02 resolveLocale(custom?) 合并自定义与默认（[国际化][API契约]）
>
> ⚠️ 实现说明:
> - 国际化由 `@floatboat/nexus-core` 的 `packages/core/src/locale.ts` 提供，导出 `enLocale`、`zhLocale`、`resolveLocale(custom?)` 三个 API。
> - `NexusLocale` 接口包含 17 个 key（addColumn/addRow/deleteColumn/deleteRow/insertColumnBefore/insertColumnAfter/insertRowAbove/insertRowBelow/alignLeft/alignCenter/alignRight/foldCode/unfoldCode/foldHeading/unfoldHeading/openLink/codeBlockLabel）。
> - `resolveLocale(locale?)`: 无参数或 undefined 时直接返回 `enLocale`；有参数时返回 `{ ...enLocale, ...locale }`（浅合并，用户自定义覆盖英文默认，未覆盖项回退英文）。
> - locale 文案在编辑器中的使用位置: 表格 Live Preview widget 的按钮 `title` 属性（addColumn/addRow/deleteColumn/deleteRow/insertColumnAfter/insertRowBelow）、折叠按钮 tooltip（foldCode/unfoldCode/foldHeading/unfoldHeading）、链接打开按钮（openLink）、代码块标签（codeBlockLabel）。见 `packages/core/src/editor.ts:281,711-718`。
> - **关键约束**: demo（`apps/electron-demo/src/renderer/editor-shell.ts:128-331`）的 `createEditor` 调用未传入 `locale` 配置项，因此 demo 运行时使用默认 `enLocale`。demo UI 无语言切换入口。
> - **enLocale 验证**: 可通过输入表格语法触发 Live Preview widget，检查按钮 `title` 属性文案为英文（如 "Add column"）来间接验证。
> - **zhLocale 验证**: demo 未配置 zhLocale，无法通过 UI 直接观察中文文案。相关用例标注"待确认"，建议通过 `page.evaluate` 动态 `import` locale 模块或在单元测试中覆盖。
> - **resolveLocale 合并验证**: demo 无法直接传入 partial locale。通过验证默认 enLocale 文案生效来间接验证 `resolveLocale(undefined)` 路径；partial 覆盖路径标注"待确认"。
> - 全局 setup 使用 `launchDemo()` 启动 Electron demo。

---

## e2e 全局前置条件

- 依赖环境: Electron demo（Vite dev server localhost:5173 + 已构建的 `apps/electron-demo/dist-electron/main.js`）
- 初始文档: demo 启动后默认状态（可能恢复上次 vault 的文档或空文档）
- 插件配置: demo 默认挂载 —— createGfmPreset + createHistoryPlugin + createToolbarPlugin + createSearchPlugin + createWikilinksPlugin + createWordCountPlugin
- 角色权限: 无需登录（本地桌面应用）
- 未达成时的创建过程:
  1. 启动 Vite dev server（终端: `pnpm dev:renderer`; 等待: http://localhost:5173 可访问）
  2. 构建 Electron 主进程（终端: `pnpm build:electron-demo`; 产物: `apps/electron-demo/dist-electron/main.js`）
  3. 测试代码调用 `launchDemo()` 启动 Electron 实例（内部: `electron.launch({ args: [mainJs], env: { VITE_DEV_SERVER_URL: "http://localhost:5173" } })`，等待 `.cm-content` 可见）

setup 代码模板（所有用例通用）:
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

// 辅助：通过 execCommand 插入文本（部分场景兼容性更好）
async function insertText(page: Page, text: string) {
  await page.click(".cm-content");
  await page.evaluate((t) => document.execCommand("insertText", false, t), text);
}

// 辅助：输入表格语法并移光标到表格外触发 Live Preview widget
async function inputTableAndCollapse(page: Page) {
  await clearEditor(page);
  await typeInEditor(page, "| A | B |");
  await page.keyboard.press("Enter");
  await typeInEditor(page, "|---|---|");
  await page.keyboard.press("Enter");
  await typeInEditor(page, "| 1 | 2 |");
  await page.keyboard.press("Enter");
  // 移光标到空行，触发表格折叠为 widget
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(300);
}

// 辅助：获取编辑器纯文本内容
async function getEditorText(page: Page): Promise<string> {
  return (await page.locator(".cm-content").textContent()) ?? "";
}
```

---

# FP-12-01 enLocale / zhLocale 内置 locale（[国际化]）

> locale 文案在表格 Live Preview widget 按钮 `title` 属性中使用（editor.ts:711-718 传入 locale.* 到 createLivePreviewExtension）。demo 未配置 locale，默认使用 enLocale。enLocale 可通过表格按钮 title 验证；zhLocale 需标注"待确认"。

## FP-12-01-N01 [P1] [正常] demo 默认使用 enLocale —— 表格 add column 按钮 title 为英文

**测试框架**: Playwright

**前置条件**（⚠️ 4要素缺一不可）:
- 依赖数据: demo 应用实例（通过 launchDemo 启动），GFM 预设已加载（支持表格语法）
- 系统状态: Electron 窗口已打开，Vite dev server 已运行，编辑器可编辑
- 角色权限: 本地桌面应用，无需登录
- 未达成时的创建过程:
  1. 启动 Vite dev server（终端: `pnpm dev:renderer`; 等待: localhost:5173 可访问）
  2. 构建 Electron 主进程（终端: `pnpm build:electron-demo`; 产物: `apps/electron-demo/dist-electron/main.js`）
  3. test.beforeAll 中调用 `launchDemo()` 启动 Electron（页面入口: 自动打开首个窗口; 无需输入）

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 调用 `inputTableAndCollapse` 输入表格并触发 widget | [DOM] 表格折叠为 `.nexus-table-wrapper` widget（live-preview-table.ts，locale.addColumn 传入 labels） | 选择器: .cm-content; 操作: keyboard.type + ArrowDown; 控件: editor; 等待: 300ms |
| 2 | 断言表格 widget 存在 | [DOM] `.nexus-table-wrapper` 或 `table.nexus-table` 存在 | 选择器: .nexus-table-wrapper, table.nexus-table; 操作: count(); 控件: table-widget; 等待: 无 |
| 3 | 查找表格 widget 内 `title="Add column"` 的按钮 | [DOM] add column 按钮 title 为 "Add column"（enLocale.addColumn = "Add column"，locale.ts:30，demo 默认 enLocale） | 选择器: .nexus-table-wrapper button[title="Add column"], table.nexus-table button[title="Add column"]; 操作: count(); 控件: table-widget; 等待: 无 |

**断言汇总**:
- [DOM] 表格 widget 存在
- [DOM] `button[title="Add column"]` 存在（enLocale 默认生效）

---

## FP-12-01-N02 [P1] [正常] enLocale 表格 add row 按钮 title 为 "Add row"

**测试框架**: Playwright

**前置条件**: 全局 setup（demo 已启动）+ 表格 widget 已触发

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 调用 `inputTableAndCollapse` 输入表格并触发 widget | [DOM] 表格 widget 渲染 | 选择器: .cm-content; 操作: keyboard.type + ArrowDown; 控件: editor; 等待: 300ms |
| 2 | 查找 `title="Add row"` 的按钮 | [DOM] add row 按钮 title 为 "Add row"（enLocale.addRow = "Add row"，locale.ts:31） | 选择器: .nexus-table-wrapper button[title="Add row"], table.nexus-table button[title="Add row"]; 操作: count(); 控件: table-widget; 等待: 无 |

**断言汇总**:
- [DOM] `button[title="Add row"]` 存在

---

## FP-12-01-N03 [P1] [正常] enLocale 表格 delete column 按钮 title 为 "Delete column"

**测试框架**: Playwright

**前置条件**: 全局 setup（demo 已启动）+ 表格 widget 已触发

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 调用 `inputTableAndCollapse` 输入表格并触发 widget | [DOM] 表格 widget 渲染 | 选择器: .cm-content; 操作: keyboard.type + ArrowDown; 控件: editor; 等待: 300ms |
| 2 | 查找 `title="Delete column"` 的按钮 | [DOM] delete column 按钮 title 为 "Delete column"（enLocale.deleteColumn = "Delete column"，locale.ts:32） | 选择器: .nexus-table-wrapper button[title="Delete column"], table.nexus-table button[title="Delete column"]; 操作: count(); 控件: table-widget; 等待: 无 |

**断言汇总**:
- [DOM] `button[title="Delete column"]` 存在

---

## FP-12-01-N04 [P1] [正常] enLocale 表格 delete row 按钮 title 为 "Delete row"

**测试框架**: Playwright

**前置条件**: 全局 setup（demo 已启动）+ 表格 widget 已触发

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 调用 `inputTableAndCollapse` 输入表格并触发 widget | [DOM] 表格 widget 渲染 | 选择器: .cm-content; 操作: keyboard.type + ArrowDown; 控件: editor; 等待: 300ms |
| 2 | 查找 `title="Delete row"` 的按钮 | [DOM] delete row 按钮 title 为 "Delete row"（enLocale.deleteRow = "Delete row"，locale.ts:33） | 选择器: .nexus-table-wrapper button[title="Delete row"], table.nexus-table button[title="Delete row"]; 操作: count(); 控件: table-widget; 等待: 无 |

**断言汇总**:
- [DOM] `button[title="Delete row"]` 存在

---

## FP-12-01-N05 [P2] [正常] enLocale 表格 insert column/row 按钮 title 为英文

**测试框架**: Playwright

**前置条件**: 全局 setup（demo 已启动）+ 表格 widget 已触发

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 调用 `inputTableAndCollapse` 输入表格并触发 widget | [DOM] 表格 widget 渲染 | 选择器: .cm-content; 操作: keyboard.type + ArrowDown; 控件: editor; 等待: 300ms |
| 2 | 查找 `title="Insert column after"` 的按钮 | [DOM] insert column after 按钮 title 为 "Insert column after"（enLocale.insertColumnAfter = "Insert column after"，locale.ts:35） | 选择器: .nexus-table-wrapper button[title="Insert column after"], table.nexus-table button[title="Insert column after"]; 操作: count(); 控件: table-widget; 等待: 无 |
| 3 | 查找 `title="Insert row below"` 的按钮 | [DOM] insert row below 按钮 title 为 "Insert row below"（enLocale.insertRowBelow = "Insert row below"，locale.ts:37） | 选择器: .nexus-table-wrapper button[title="Insert row below"], table.nexus-table button[title="Insert row below"]; 操作: count(); 控件: table-widget; 等待: 无 |

**断言汇总**:
- [DOM] `button[title="Insert column after"]` 存在
- [DOM] `button[title="Insert row below"]` 存在

---

## FP-12-01-N06 [P2] [正常] enLocale 所有表格按钮 title 均为英文非空

**测试框架**: Playwright

**前置条件**: 全局 setup（demo 已启动）+ 表格 widget 已触发

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 调用 `inputTableAndCollapse` 输入表格并触发 widget | [DOM] 表格 widget 渲染 | 选择器: .cm-content; 操作: keyboard.type + ArrowDown; 控件: editor; 等待: 300ms |
| 2 | 收集表格 widget 内所有带 title 属性的按钮 | [DOM] 所有按钮 title 非空且为英文（enLocale 各 key 均有值，locale.ts:29-47） | 选择器: .nexus-table-wrapper button[title], table.nexus-table button[title]; 操作: evaluateAll(els => els.map(el => el.getAttribute("title"))); 控件: table-widget; 等待: 无 |
| 3 | 断言所有 title 值均为非空字符串且至少包含一个英文字母 | [DOM] 每个 title 匹配 `/[a-zA-Z]/`（enLocale 全英文文案） | 选择器: .nexus-table-wrapper button[title]; 操作: evaluateAll; 控件: table-widget; 等待: 无 |

**断言汇总**:
- [DOM] 表格 widget 所有按钮 title 非空且为英文

---

## FP-12-01-N07 [P3] [正常] 【待确认】zhLocale 中文文案 —— 表格按钮 title 为中文

**测试框架**: Playwright

**前置条件**: ⚠️ 待确认 —— demo 未配置 zhLocale（editor-shell.ts createEditor 无 locale 参数），默认使用 enLocale。需通过 `page.evaluate` 动态切换或确认 demo 是否有隐藏配置

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 【待确认】通过 `page.evaluate` 动态 import `@floatboat/nexus-core` 的 `zhLocale`，验证对象值 | [STATE] `zhLocale.addColumn === "添加列"`（locale.ts:50） | 选择器: body; 操作: evaluate(async () => { const m = await import("@floatboat/nexus-core"); return m.zhLocale.addColumn; }); 控件: runtime; 等待: 无 |
| 2 | 【待确认】验证 zhLocale.addRow | [STATE] `zhLocale.addRow === "添加行"`（locale.ts:51） | 选择器: body; 操作: evaluate(async () => { const m = await import("@floatboat/nexus-core"); return m.zhLocale.addRow; }); 控件: runtime; 等待: 无 |
| 3 | 【待确认】验证 zhLocale.deleteColumn | [STATE] `zhLocale.deleteColumn === "删除列"`（locale.ts:52） | 选择器: body; 操作: evaluate(async () => { const m = await import("@floatboat/nexus-core"); return m.zhLocale.deleteColumn; }); 控件: runtime; 等待: 无 |

**断言汇总**:
- [STATE] 【待确认】zhLocale 中文文案可通过 runtime import 验证

---

## FP-12-01-N08 [P3] [正常] 【待确认】zhLocale 完整性 —— 17 个 key 均有中文值

**测试框架**: Playwright

**前置条件**: ⚠️ 待确认 —— demo 未配置 zhLocale，通过 runtime import 验证对象完整性

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 【待确认】通过 `page.evaluate` 动态 import zhLocale，遍历所有 key | [STATE] 17 个 key（addColumn/addRow/deleteColumn/deleteRow/insertColumnBefore/insertColumnAfter/insertRowAbove/insertRowBelow/alignLeft/alignCenter/alignRight/foldCode/unfoldCode/foldHeading/unfoldHeading/openLink/codeBlockLabel）均有非空中文值（locale.ts:49-67） | 选择器: body; 操作: evaluate(async () => { const m = await import("@floatboat/nexus-core"); const z = m.zhLocale; return Object.keys(z).map(k => ({k, v: z[k]})); }); 控件: runtime; 等待: 无 |
| 2 | 断言每个值包含 CJK 字符（匹配 `[\u4e00-\u9fff]`） | [STATE] 所有值含中文字符 | 选择器: body; 操作: evaluate; 控件: runtime; 等待: 无 |

**断言汇总**:
- [STATE] 【待确认】zhLocale 17 个 key 均有中文值

---

## FP-12-01-E01 [P3] [异常] enLocale 表格按钮无空 title 或 undefined

**测试框架**: Playwright

**前置条件**: 全局 setup（demo 已启动）+ 表格 widget 已触发

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 调用 `inputTableAndCollapse` 输入表格并触发 widget | [DOM] 表格 widget 渲染 | 选择器: .cm-content; 操作: keyboard.type + ArrowDown; 控件: editor; 等待: 300ms |
| 2 | 收集表格 widget 内所有按钮的 title 属性 | [DOM] 无按钮 title 为空字符串、null 或 undefined（enLocale 所有 key 均有非空 string 值，resolveLocale 返回完整对象） | 选择器: .nexus-table-wrapper button, table.nexus-table button; 操作: evaluateAll(els => els.map(el => el.getAttribute("title"))); 控件: table-widget; 等待: 无 |
| 3 | 断言不存在空 title | [DOM] 所有 title 非空非 null | 选择器: .nexus-table-wrapper button; 操作: evaluateAll; 控件: table-widget; 等待: 无 |

**断言汇总**:
- [DOM] 表格按钮无空 title

---

## FP-12-01-B01 [P4] [边界] enLocale 与 zhLocale key 集合一致

**测试框架**: Playwright

**前置条件**: ⚠️ 待确认 —— 通过 runtime import 同时获取 enLocale 和 zhLocale 进行 key 对比

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 【待确认】通过 `page.evaluate` 动态 import enLocale 和 zhLocale | [STATE] 获取两个 locale 对象 | 选择器: body; 操作: evaluate(async () => { const m = await import("@floatboat/nexus-core"); return { enKeys: Object.keys(m.enLocale).sort(), zhKeys: Object.keys(m.zhLocale).sort() }; }); 控件: runtime; 等待: 无 |
| 2 | 断言 enKeys 与 zhKeys 深度相等 | [STATE] 两个 locale 的 key 集合完全一致（17 个 key，locale.ts 对称定义） | 选择器: body; 操作: evaluate; 控件: runtime; 等待: 无 |

**断言汇总**:
- [STATE] enLocale 与 zhLocale key 集合一致

---

# FP-12-02 resolveLocale(custom?) 合并自定义与默认（[国际化][API契约]）

> `resolveLocale(locale?)`: 无参数返回 enLocale；有参数返回 `{ ...enLocale, ...locale }`。demo 未传入 locale 配置，因此走 `resolveLocale(undefined)` 路径返回 enLocale。partial 覆盖路径通过 runtime import 验证。

## FP-12-02-N01 [P1] [正常] demo 默认 resolveLocale(undefined) 返回 enLocale

**测试框架**: Playwright

**前置条件**（⚠️ 4要素缺一不可）:
- 依赖数据: demo 应用实例（通过 launchDemo 启动），demo 未配置 locale 参数
- 系统状态: Electron 窗口已打开，Vite dev server 已运行
- 角色权限: 本地桌面应用，无需登录
- 未达成时的创建过程:
  1. 启动 Vite dev server（终端: `pnpm dev:renderer`; 等待: localhost:5173 可访问）
  2. 构建 Electron 主进程（终端: `pnpm build:electron-demo`; 产物: `apps/electron-demo/dist-electron/main.js`）
  3. test.beforeAll 中调用 `launchDemo()` 启动 Electron

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 调用 `inputTableAndCollapse` 输入表格并触发 widget | [DOM] 表格 widget 渲染（editor.ts:281 `resolveLocale(config.locale)`，config.locale 为 undefined → 返回 enLocale） | 选择器: .cm-content; 操作: keyboard.type + ArrowDown; 控件: editor; 等待: 300ms |
| 2 | 断言 add column 按钮 title 为 "Add column" | [DOM] `button[title="Add column"]` 存在（resolveLocale(undefined) → enLocale，addColumn="Add column"） | 选择器: button[title="Add column"]; 操作: count(); 控件: table-widget; 等待: 无 |
| 3 | 断言 add row 按钮 title 为 "Add row" | [DOM] `button[title="Add row"]` 存在 | 选择器: button[title="Add row"]; 操作: count(); 控件: table-widget; 等待: 无 |

**断言汇总**:
- [DOM] demo 默认使用 enLocale（resolveLocale(undefined) 路径生效）

---

## FP-12-02-N02 [P1] [正常] resolveLocale() 无参数返回完整 enLocale 对象

**测试框架**: Playwright

**前置条件**: 全局 setup（demo 已启动）

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 通过 `page.evaluate` 调用 `resolveLocale()` 无参数 | [STATE] 返回对象与 enLocale 引用相同或值相等（locale.ts:71 `if (!locale) return enLocale`） | 选择器: body; 操作: evaluate(async () => { const m = await import("@floatboat/nexus-core"); const r = m.resolveLocale(); return { addColumn: r.addColumn, addRow: r.addRow, codeBlockLabel: r.codeBlockLabel }; }); 控件: runtime; 等待: 无 |
| 2 | 断言返回值 addColumn 为 "Add column" | [STATE] resolveLocale().addColumn === "Add column" | 选择器: body; 操作: evaluate; 控件: runtime; 等待: 无 |
| 3 | 断言返回值 codeBlockLabel 为 "Code" | [STATE] resolveLocale().codeBlockLabel === "Code"（enLocale.codeBlockLabel） | 选择器: body; 操作: evaluate; 控件: runtime; 等待: 无 |

**断言汇总**:
- [STATE] resolveLocale() 无参数返回 enLocale 值

---

## FP-12-02-N03 [P1] [正常] resolveLocale 合并 partial 覆盖 —— 自定义覆盖英文默认

**测试框架**: Playwright

**前置条件**: 全局 setup（demo 已启动）

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 通过 `page.evaluate` 调用 `resolveLocale({ addColumn: "Custom Col" })` | [STATE] 返回对象 addColumn 为 "Custom Col"（覆盖），addRow 仍为 "Add row"（回退 enLocale，locale.ts:72 `{ ...enLocale, ...locale }`） | 选择器: body; 操作: evaluate(async () => { const m = await import("@floatboat/nexus-core"); return m.resolveLocale({ addColumn: "Custom Col" }); }); 控件: runtime; 等待: 无 |
| 2 | 断言 addColumn 被覆盖 | [STATE] result.addColumn === "Custom Col" | 选择器: body; 操作: evaluate; 控件: runtime; 等待: 无 |
| 3 | 断言 addRow 回退英文默认 | [STATE] result.addRow === "Add row"（未覆盖项回退） | 选择器: body; 操作: evaluate; 控件: runtime; 等待: 无 |

**断言汇总**:
- [STATE] partial 覆盖生效，未覆盖项回退 enLocale

---

## FP-12-02-N04 [P2] [正常] resolveLocale 合并 zhLocale —— 完整中文覆盖

**测试框架**: Playwright

**前置条件**: 全局 setup（demo 已启动）

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 通过 `page.evaluate` 调用 `resolveLocale(zhLocale)` 传入完整 zhLocale | [STATE] 返回对象与 zhLocale 值相等（完整覆盖，所有 key 取中文值） | 选择器: body; 操作: evaluate(async () => { const m = await import("@floatboat/nexus-core"); return m.resolveLocale(m.zhLocale); }); 控件: runtime; 等待: 无 |
| 2 | 断言 addColumn 为 "添加列" | [STATE] result.addColumn === "添加列" | 选择器: body; 操作: evaluate; 控件: runtime; 等待: 无 |
| 3 | 断言 openLink 为 "打开链接" | [STATE] result.openLink === "打开链接" | 选择器: body; 操作: evaluate; 控件: runtime; 等待: 无 |

**断言汇总**:
- [STATE] resolveLocale(zhLocale) 返回完整中文 locale

---

## FP-12-02-E01 [P3] [异常] resolveLocale 空对象 —— 全部回退 enLocale

**测试框架**: Playwright

**前置条件**: 全局 setup（demo 已启动）

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 通过 `page.evaluate` 调用 `resolveLocale({})` 传入空对象 | [STATE] 返回对象与 enLocale 值相等（`{ ...enLocale, ...{} }` === enLocale 值，locale.ts:72） | 选择器: body; 操作: evaluate(async () => { const m = await import("@floatboat/nexus-core"); return m.resolveLocale({}); }); 控件: runtime; 等待: 无 |
| 2 | 断言 addColumn 为 "Add column" | [STATE] result.addColumn === "Add column"（空对象不覆盖任何 key） | 选择器: body; 操作: evaluate; 控件: runtime; 等待: 无 |
| 3 | 断言所有 17 个 key 均为 enLocale 值 | [STATE] 与 enLocale 深度相等 | 选择器: body; 操作: evaluate(async () => { const m = await import("@floatboat/nexus-core"); const r = m.resolveLocale({}); const e = m.enLocale; return JSON.stringify(r) === JSON.stringify(e); }); 控件: runtime; 等待: 无 |

**断言汇总**:
- [STATE] 空对象参数全部回退 enLocale

---

## FP-12-02-B01 [P4] [边界] resolveLocale 传入 zhLocale 部分 key —— 混合中英文

**测试框架**: Playwright

**前置条件**: 全局 setup（demo 已启动）

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 通过 `page.evaluate` 调用 `resolveLocale({ addColumn: "添加列", openLink: "打开链接" })` 传入部分中文 | [STATE] addColumn 为 "添加列"，openLink 为 "打开链接"（覆盖），addRow 为 "Add row"（回退英文） | 选择器: body; 操作: evaluate(async () => { const m = await import("@floatboat/nexus-core"); return m.resolveLocale({ addColumn: "添加列", openLink: "打开链接" }); }); 控件: runtime; 等待: 无 |
| 2 | 断言覆盖项为中文 | [STATE] result.addColumn === "添加列" 且 result.openLink === "打开链接" | 选择器: body; 操作: evaluate; 控件: runtime; 等待: 无 |
| 3 | 断言未覆盖项为英文 | [STATE] result.addRow === "Add row" 且 result.foldCode === "Fold code block" | 选择器: body; 操作: evaluate; 控件: runtime; 等待: 无 |

**断言汇总**:
- [STATE] 部分覆盖产生中英文混合 locale

---

## 统计汇总

### 类型分布

| 类型 | 数量 | 占比 |
|------|------|------|
| 正常(N) | 12 | 75.0% |
| 异常(E) | 2 | 12.5% |
| 边界(B) | 2 | 12.5% |
| 流程(F) | 0 | 0% |
| 数据(D) | 0 | 0% |

> 注: FP-12-01 含 N01-N08（8正常）+ E01（1异常）+ B01（1边界）；FP-12-02 含 N01-N04（4正常）+ E01（1异常）+ B01（1边界）。异常用例: FP-12-01-E01（表格无空 title）、FP-12-02-E01（空对象回退）。边界用例: FP-12-01-B01（en/zh key 集合一致性）、FP-12-02-B01（中英文混合 locale）。

### 优先级分布

| 优先级 | 数量 | 占比 |
|--------|------|------|
| P1 | 7 | 43.8% |
| P2 | 3 | 18.8% |
| P3 | 4 | 25.0% |
| P4 | 2 | 12.5% |
| P5 | 0 | 0% |

### 各二级功能点用例数

| 二级功能点 | 用例数 | 编号范围 |
|-----------|--------|---------|
| FP-12-01 enLocale / zhLocale | 10 | N01-N08, E01, B01 |
| FP-12-02 resolveLocale | 6 | N01-N04, E01, B01 |
| **合计** | **16** | |

### 待确认用例统计

| 标注 | 数量 | 说明 |
|------|------|------|
| 待确认 | 3 | FP-12-01-N07, FP-12-01-N08, FP-12-01-B01（zhLocale 需 runtime import 验证，demo 未配置中文 locale） |
| 可直接 e2e | 13 | 通过表格 widget title 属性验证 enLocale（FP-12-01-N01~N06, E01）+ runtime import 验证 resolveLocale（FP-12-02 全部） |

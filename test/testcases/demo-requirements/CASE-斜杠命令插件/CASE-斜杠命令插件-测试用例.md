# CASE-斜杠命令插件-测试用例（FP-15）

> 一级功能点: 斜杠命令插件（demo-requirements.md §6）
> 全局批次序号: 15
> 生成时间: 2026-08-11
> 测试框架: Playwright（Electron demo e2e）
> 覆盖二级功能点: FP-15-01 ~ FP-15-08（共 8 个）
> 用例总数: 47
>
> 涉及二级功能点:
> - FP-15-01 createSlashPlugin(commands) 工厂与 SlashCommandDef 定义
> - FP-15-02 getSlashState 状态计算（触发检测+查询提取）
> - FP-15-03 filterSlashCommands 过滤+确定性排序（精确>前缀>关键词>其他）
> - FP-15-04 菜单 UI 键盘交互（ArrowUp/Down/Home/End/Enter/Tab/Escape）
> - FP-15-05 菜单 UI 鼠标交互（hover/click/外部关闭）
> - FP-15-06 IME composition 期间禁用键盘拦截
> - FP-15-07 视口边界处理（底部翻转/右侧夹紧）
> - FP-15-08 命令历史（createSlashCommandHistory reorder/record）
>
> ⚠️ 实现说明（依据 `packages/plugin-slash/src/index.ts` + `menu-ui.ts` + `command-history.ts` + `packages/core/src/slash-state.ts` + `apps/electron-demo/src/renderer/editor-shell.ts:341`）:
> - **Demo 中斜杠菜单由 `editor-shell.ts:341` 的 `createSlashMenuUI(editor)` 创建**，**未传入 `history` 选项**（`editor-shell.ts:341`），因此 demo 默认 **命令历史（FP-15-08）未启用**。FP-15-08 相关用例标注为"仅通过 createSlashCommandHistory 单元行为间接验证"，e2e 层验证 demo 中历史未启用 → 命令项顺序不随使用频次改变。
> - **Demo 中斜杠命令来源**: `createToolbarPlugin()` 返回的 `slashCommands: toolbarSlashCommands`（`plugin-toolbar/src/index.ts:232`），共 **14 条**（h1/h2/h3/bold/italic/strikethrough/inline-code/code-block/blockquote/ulist/olist/link/image/hr），其中 hr 的 title 为 "Divider"。`editor-shell.ts:139-146` 的 `plugins` 数组包含 `createToolbarPlugin()`。
> - **DOM 选择器**（依据 `menu-ui.ts:97` + `style.css:109-162`）: 菜单容器 `.nexus-slash-menu`（`menu-ui.ts:97`）；菜单项 `.nexus-slash-menu__item`（`menu-ui.ts:163`）；高亮项 `.nexus-slash-menu__item.is-active`（`menu-ui.ts:138`，注意是 **`is-active`** 不是 `active`/`selected`）；标题 `.nexus-slash-menu__title`；空态 `.nexus-slash-menu__empty`（文本 "No matches"）；每项的 `data-slash-command-id` 属性 = 命令 id（`menu-ui.ts:209`）。
> - **可见性判定**: 菜单根元素初始 `display:none`（`menu-ui.ts:103`），`reposition()`（`menu-ui.ts:231`）将其改为 `display:block`。测试用 `:not([style*='display: none'])` 过滤或直接查 `.is-active` 判断。
> - **触发条件**（依据 `slash-state.ts:40-63` `getSlashMatch`）: `/` 必须在**行首**或前面是**空白字符**；`/` 后到光标之间的查询文本**不允许包含任何空白字符**（`/\s/.test(query)` 为真则返回 null）。
> - **排序分层**（依据 `slash-state.ts:32-38` + `72-116` + `138-148`）: 标题精确(6000) > 标题前缀(5000) > 关键词精确(4000) > 标题子串(3000) > 关键词前缀(2000) > 关键词子串(1000)；同层用 tiebreaker（更短标题/更靠前偏移优先），最后按 title 字母序 + 原注册顺序稳定排序。
> - **limit 默认 8**（`slash-state.ts:26`），`limit<0` 表示无上限（`slash-state.ts:169`）。Demo 调用链不覆盖 options，因此菜单最多显示 **8** 条。
> - **确认行为**（依据 `menu-ui.ts:279-321`）: 先 `editor.setSelection(from,to)` + `editor.replaceSelection("")` 删除 `/query` 触发文本（`menu-ui.ts:294-297`），再 `editor.focus()`，再 `cmd.run(editor)`（`menu-ui.ts:319`）。因此确认后文档中 `/query` 消失，仅保留命令副作用。
> - **已知陷阱**:
>   - 斜杠菜单 dismissed 后有**锁存 latch**（`menu-ui.ts:123 dismissed`），直到下一次 closed→open 转换才重置（`menu-ui.ts:330-333`）。用例间用 Escape 关闭后再重新输入 `/` 才能再次打开。
>   - demo 未把 editor/menu 暴露到 window，所有验证走 `.cm-content` 文本 + 菜单 DOM 副作用。
>   - IME 合成通过 `compositionstart`/`compositionend` 事件切换 `isComposing` 标志（`menu-ui.ts:432-437`），键盘处理在 `isComposing` 时直接 return（`menu-ui.ts:362`）。

---

## e2e 全局前置条件

- 依赖环境: Electron demo（Vite dev server localhost:5173 + 已构建的 `apps/electron-demo/dist-electron/main.js`）
- 初始文档: demo 启动后默认打开的 sample-vault 文档（或 index.md）
- 插件配置: demo 默认挂载 —— createGfmPreset + createHistoryPlugin + createToolbarPlugin + createSearchPlugin + createWikilinksPlugin + createWordCountPlugin
- 斜杠菜单: `editor-shell.ts:341` 调用 `createSlashMenuUI(editor)` 创建（**未启用 history**）
- 斜杠命令来源: `createToolbarPlugin()` 的 `toolbarSlashCommands`（14 条）
- 角色权限: 无需登录（本地桌面应用）
- 未达成时的创建过程:
  1. 启动 Vite dev server（终端: `pnpm dev:renderer`; 等待: http://localhost:5173 可访问）
  2. 构建 Electron 主进程（终端: `pnpm build:electron-demo`; 产物: `apps/electron-demo/dist-electron/main.js`）
  3. 测试代码调用 `launchDemo()` 启动 Electron 实例（内部: `electron.launch({ args: [mainJs], env: { VITE_DEV_SERVER_URL: "http://localhost:5173" } })`，等待 `.cm-content` 可见）

setup 代码模板（所有用例通用，测试文件顶部）:
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

// 辅助：确保斜杠菜单关闭（防止上一个用例残留 dismissed latch）
async function dismissSlashMenu(page: Page) {
  await page.keyboard.press("Escape");
}

// 等待斜杠菜单可见（含至少一个菜单项）
async function waitForSlashMenu(page: Page, timeout = 1000) {
  await page.waitForSelector(
    ".nexus-slash-menu:not([style*='display: none']) .nexus-slash-menu__item",
    { timeout }
  );
}

// 等待斜杠菜单根元素可见（即使为空态也满足）
async function waitForSlashMenuRoot(page: Page, timeout = 1000) {
  await page.waitForSelector(
    ".nexus-slash-menu:not([style*='display: none'])",
    { timeout }
  );
}

// 等待斜杠菜单隐藏
async function waitForSlashMenuHidden(page: Page, timeout = 1000) {
  await page.waitForSelector(
    ".nexus-slash-menu[style*='display: none'], .nexus-slash-menu:not(:visible)",
    { timeout, state: "attached" }
  );
}

// 获取当前可见菜单项的命令 id 列表（按显示顺序）
async function getVisibleMenuItemIds(page: Page): Promise<string[]> {
  const ids = await page.evaluate(() => {
    const items = Array.from(
      document.querySelectorAll<HTMLElement>(
        ".nexus-slash-menu:not([style*='display: none']) .nexus-slash-menu__item"
      )
    );
    return items.map((it) => it.dataset.slashCommandId ?? "");
  });
  return ids;
}

// 获取当前可见菜单项的标题列表
async function getVisibleMenuItemTitles(page: Page): Promise<string[]> {
  const titles = await page.evaluate(() => {
    const items = Array.from(
      document.querySelectorAll<HTMLElement>(
        ".nexus-slash-menu:not([style*='display: none']) .nexus-slash-menu__title"
      )
    );
    return items.map((it) => it.textContent ?? "").map((s) => s.trim());
  });
  return titles;
}

// 获取当前高亮项的命令 id（无高亮返回 null）
async function getActiveItemId(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const el = document.querySelector<HTMLElement>(
      ".nexus-slash-menu:not([style*='display: none']) .nexus-slash-menu__item.is-active"
    );
    return el ? (el.dataset.slashCommandId ?? null) : null;
  });
}
```

---

## FP-15-01: createSlashPlugin(commands) 工厂与 SlashCommandDef 定义（6 例，[插件能力][API契约]）

> 间接验证路径: `createSlashPlugin(commands)`（`packages/plugin-slash/src/index.ts:33-38`）返回 `{ name: "plugin-slash", slashCommands: commands }`。demo 不直接调用 `createSlashPlugin`，而是通过 `createToolbarPlugin()`（`plugin-toolbar/src/index.ts:219-235`）返回的 NexusPlugin 的 `slashCommands` 字段（14 条 SlashCommandDef）提供命令。`editor.ts` flatMap 所有插件的 slashCommands 后驱动菜单。因此 **e2e 层通过"输入 `/` 后菜单出现 14 条工具栏命令"间接验证工厂和 SlashCommandDef 字段的可用性**。

### FP-15-01-N01 [P1] [正常] 空文档行首输入 `/` → 斜杠菜单出现且含工具栏注册的命令

**前置条件**（⚠️ 4要素）:
- 依赖环境: Electron demo 已启动（Vite dev server + Electron main）
- 初始文档: 空文档（清空后）
- 插件配置: demo 默认（createToolbarPlugin 提供 14 条 slashCommands）
- 角色权限: 无需登录
- 未达成时的创建过程:
  1. `launchDemo()` 启动 Electron demo（入口: `test/e2e/helpers/electron-launcher.ts:launchDemo()`，参数: 无）
  2. 清空编辑器: `clearEditor(page)`（操作: 点击 `.cm-content` → ControlOrMeta+a → Backspace）

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page) | [DOM] `.cm-content` 为空 | 选择器: .cm-content; 操作: click+selectAll+backspace; 控件: editor; 等待: 200ms |
| 2 | typeInEditor(page, "/") | [DOM] `.nexus-slash-menu` 出现且 display 不为 none，含 `.nexus-slash-menu__item` 子项 | 选择器: .nexus-slash-menu; 操作: keyboard.type(/); 控件: menu; 等待: 300ms |
| 3 | waitForSlashMenu(page) 然后 getVisibleMenuItemTitles(page) | [DOM] 返回标题列表长度 >= 1，且包含工具栏命令标题（如 "Heading 1"/"Bold"/"Link" 等） | 选择器: .nexus-slash-menu__title; 操作: textContent(); 控件: menu-item; 等待: 无 |
| 4 | dismissSlashMenu(page)（Escape 清理 latch） | [DOM] 菜单 display 恢复 none | 选择器: .nexus-slash-menu; 操作: keyboard.press(Escape); 控件: menu; 等待: 100ms |

**断言汇总**:
- [DOM] 输入 `/` 后 `.nexus-slash-menu` 可见并显示工具栏注册的 slashCommands（证明 createSlashPlugin/SlashCommandDef 工厂链路工作）

---

### FP-15-01-N02 [P1] [正常] 斜杠菜单项数量 = 工具栏注册的 14 条 SlashCommandDef

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 空文档
- 插件配置: demo 默认（createToolbarPlugin 的 toolbarSlashCommands 14 条）
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. `clearEditor(page)`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page) | [DOM] 编辑器清空 | 选择器: .cm-content; 操作: clear; 控件: editor; 等待: 200ms |
| 2 | typeInEditor(page, "/") | [DOM] 菜单出现 | 选择器: .nexus-slash-menu; 操作: type(/); 控件: menu; 等待: 300ms |
| 3 | waitForSlashMenu(page); getVisibleMenuItemIds(page) | [DOM] 由于 demo 默认 limit=8（`slash-state.ts:26`），返回长度 === 8（14 条命令被截断到 8） | 选择器: .nexus-slash-menu__item; 操作: dataset.slashCommandId; 控件: menu-item; 等待: 无 |
| 4 | dismissSlashMenu(page) | [DOM] 菜单关闭 | 选择器: .nexus-slash-menu; 操作: Escape; 控件: menu; 等待: 100ms |

**断言汇总**:
- [DOM] 菜单项数量 = 8（14 条命令经默认 limit=8 截断，证明 SlashCommandDef 数组被正确传入并参与状态计算）

---

### FP-15-01-N03 [P1] [正常] SlashCommandDef.id 字段反映到菜单项 data-slash-command-id 属性

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 空文档
- 插件配置: demo 默认
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. `clearEditor(page)`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page) | [DOM] 编辑器清空 | 选择器: .cm-content; 操作: clear; 控件: editor; 等待: 200ms |
| 2 | typeInEditor(page, "/") | [DOM] 菜单出现 | 选择器: .nexus-slash-menu; 操作: type(/); 控件: menu; 等待: 300ms |
| 3 | waitForSlashMenu(page); getVisibleMenuItemIds(page) | [DOM] 返回的 id 列表每一项均为工具栏 14 条命令的 id 之一（h1/h2/h3/bold/italic/strikethrough/inline-code/code-block/blockquote/ulist/olist/link/image/hr） | 选择器: .nexus-slash-menu__item; 操作: dataset.slashCommandId; 控件: menu-item; 等待: 无 |
| 4 | dismissSlashMenu(page) | [DOM] 菜单关闭 | 选择器: .nexus-slash-menu; 操作: Escape; 控件: menu; 等待: 100ms |

**断言汇总**:
- [DOM] 每个 `.nexus-slash-menu__item` 的 `data-slash-command-id` 属性 = SlashCommandDef.id（`menu-ui.ts:209`）

---

### FP-15-01-N04 [P2] [正常] SlashCommandDef.title 与 description 渲染到菜单项

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 空文档
- 插件配置: demo 默认
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. `clearEditor(page)`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page) | [DOM] 编辑器清空 | 选择器: .cm-content; 操作: clear; 控件: editor; 等待: 200ms |
| 2 | typeInEditor(page, "/") | [DOM] 菜单出现 | 选择器: .nexus-slash-menu; 操作: type(/); 控件: menu; 等待: 300ms |
| 3 | waitForSlashMenu(page); 获取第一项的 title 和 description | [DOM] 第一项 `.nexus-slash-menu__title` textContent 非空，`.nexus-slash-menu__description` textContent 非空（工具栏命令均提供 description） | 选择器: .nexus-slash-menu__title/.nexus-slash-menu__description; 操作: textContent(); 控件: menu-item; 等待: 无 |
| 4 | dismissSlashMenu(page) | [DOM] 菜单关闭 | 选择器: .nexus-slash-menu; 操作: Escape; 控件: menu; 等待: 100ms |

**断言汇总**:
- [DOM] 菜单项 title + description 正确渲染（证明 SlashCommandDef.title 和可选 description 字段被消费，`menu-ui.ts:211-218`）

---

### FP-15-01-N05 [P2] [正常] SlashCommandDef.run 执行 → 编辑器出现对应 Markdown 语法

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 空文档
- 插件配置: demo 默认（Heading 1 命令 run: toggleHeading(editor,1)）
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. `clearEditor(page)`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page) | [DOM] 编辑器清空 | 选择器: .cm-content; 操作: clear; 控件: editor; 等待: 200ms |
| 2 | typeInEditor(page, "/") | [DOM] 菜单出现 | 选择器: .nexus-slash-menu; 操作: type(/); 控件: menu; 等待: 300ms |
| 3 | waitForSlashMenu(page); typeInEditor(page, "h1") | [DOM] 菜单过滤到含 "Heading 1" 项 | 选择器: .nexus-slash-menu; 操作: type(h1); 控件: menu; 等待: 200ms |
| 4 | page.keyboard.press("Enter") | [DOM] 确认执行，`/h1` 被删除（`menu-ui.ts:294-297`），toggleHeading(editor,1) 在当前行加 "# " 前缀 | 选择器: .nexus-slash-menu; 操作: press(Enter); 控件: menu; 等待: 300ms |
| 5 | getEditorText(page) | [DOM] textContent 含 "# "（Heading 1 标记），且不含 "/h1" 残留 | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] 确认命令后 `/query` 被删除 + cmd.run 副作用生效（证明 SlashCommandDef.run 被调用，`menu-ui.ts:319`）

---

### FP-15-01-E01 [P3] [异常] 行首输入 `/` 后再按 Backspace 删除 → 菜单关闭（SlashCommandDef 数组仍存在但无触发）

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 空文档
- 插件配置: demo 默认
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. `clearEditor(page)`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page) | [DOM] 编辑器清空 | 选择器: .cm-content; 操作: clear; 控件: editor; 等待: 200ms |
| 2 | typeInEditor(page, "/") | [DOM] 菜单出现 | 选择器: .nexus-slash-menu; 操作: type(/); 控件: menu; 等待: 300ms |
| 3 | waitForSlashMenu(page); page.keyboard.press("Backspace") | [DOM] `/` 被删除，getSlashMatch 返回 null（`slash-state.ts:46`），slashMenuChange emit isOpen=false，菜单 display 恢复 none | 选择器: .nexus-slash-menu; 操作: press(Backspace); 控件: menu; 等待: 300ms |
| 4 | 等待 200ms; 检查 `.nexus-slash-menu` 是否可见 | [DOM] 菜单 display === none 或无可见 `.nexus-slash-menu__item` | 选择器: .nexus-slash-menu; 操作: getAttribute(style); 控件: menu; 等待: 200ms |

**断言汇总**:
- [DOM] 删除 `/` 后菜单关闭（触发条件失效，证明 SlashCommandDef 数组仅在有效 `/` 触发时被使用）

---

## FP-15-02: getSlashState 状态计算（6 例，[插件能力][编辑交互]）

> 间接验证路径: `editor.ts` 在 selection/doc 变更时调用 `computeSlashState(doc, sel.head, slashCommands)`（内部即 `getSlashState`，`packages/plugin-slash/src/index.ts:20-27` 转发到 `computeSlashState`，`packages/core/src/slash-state.ts:153-178`）。结果通过 `emit("slashMenuChange", state)` 推给菜单 UI。e2e 层通过"不同输入下菜单的开关状态"间接验证 `getSlashState` 的触发检测和查询提取逻辑。

### FP-15-02-N01 [P1] [正常] 行首 `/` 触发菜单（isOpen=true）

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 空文档
- 插件配置: demo 默认
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. `clearEditor(page)`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page) | [DOM] 编辑器清空 | 选择器: .cm-content; 操作: clear; 控件: editor; 等待: 200ms |
| 2 | typeInEditor(page, "/") | [DOM] getSlashMatch 检测行首 `/`（`slash-state.ts:44-46`），slashStateResult.isOpen=true，菜单 display=block | 选择器: .nexus-slash-menu; 操作: type(/); 控件: menu; 等待: 300ms |
| 3 | waitForSlashMenu(page) | [DOM] `.nexus-slash-menu__item` 至少 1 个可见 | 选择器: .nexus-slash-menu__item; 操作: waitFor; 控件: menu-item; 等待: 1000ms |
| 4 | dismissSlashMenu(page) | [DOM] 菜单关闭 | 选择器: .nexus-slash-menu; 操作: Escape; 控件: menu; 等待: 100ms |

**断言汇总**:
- [DOM] 行首 `/` 触发菜单开启（getSlashState 的 isOpen=true 路径）

---

### FP-15-02-N02 [P1] [正常] `/bold` → query 提取为 "bold" → 菜单仅显示 Bold 相关命令

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 空文档
- 插件配置: demo 默认
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. `clearEditor(page)`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page) | [DOM] 编辑器清空 | 选择器: .cm-content; 操作: clear; 控件: editor; 等待: 200ms |
| 2 | typeInEditor(page, "/bold") | [DOM] getSlashMatch 返回 query="bold"（`slash-state.ts:53`），filterSlashCommands 过滤后菜单仅含匹配项 | 选择器: .nexus-slash-menu; 操作: type(/bold); 控件: menu; 等待: 300ms |
| 3 | waitForSlashMenu(page); getVisibleMenuItemIds(page) | [DOM] 返回列表包含 "bold"，且数量显著少于 8（精确匹配+前缀匹配后只剩 Bold） | 选择器: .nexus-slash-menu__item; 操作: dataset.slashCommandId; 控件: menu-item; 等待: 无 |
| 4 | dismissSlashMenu(page) | [DOM] 菜单关闭 | 选择器: .nexus-slash-menu; 操作: Escape; 控件: menu; 等待: 100ms |

**断言汇总**:
- [DOM] `/bold` 后 query 正确提取为 "bold"，菜单过滤到 Bold 命令（getSlashState 的查询提取 + filterSlashCommands 工作）

---

### FP-15-02-E01 [P3] [异常] 非行首 `/`（如 `text/`）→ 不触发菜单（getSlashMatch 返回 null）

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 含文本 "text" 后输入 `/`
- 插件配置: demo 默认
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. `clearEditor(page)`
  3. `typeInEditor(page, "text")`（先输入非空文本）

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page); typeInEditor(page, "text") | [DOM] 编辑器含 "text" | 选择器: .cm-content; 操作: clear+type(text); 控件: editor; 等待: 200ms |
| 2 | typeInEditor(page, "/")（此时文档为 "text/"） | [DOM] getSlashMatch 检测 `/` 前字符为 "t"（非空白，`slash-state.ts:50-51`），返回 null，slashStateResult.isOpen=false，菜单不出现 | 选择器: .nexus-slash-menu; 操作: type(/); 控件: menu; 等待: 400ms |
| 3 | 检查 `.nexus-slash-menu` 是否可见 | [DOM] 菜单 display === none（未触发） | 选择器: .nexus-slash-menu; 操作: getAttribute(style); 控件: menu; 等待: 无 |

**断言汇总**:
- [DOM] 非行首 `/` 不触发菜单（getSlashState.getSlashMatch 的 "前导字符必须空白" 规则）

---

### FP-15-02-E02 [P3] [异常] `/` 后输入空格 → 菜单关闭（query 含空白 → getSlashMatch 返回 null）

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 空文档
- 插件配置: demo 默认
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. `clearEditor(page)`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page) | [DOM] 编辑器清空 | 选择器: .cm-content; 操作: clear; 控件: editor; 等待: 200ms |
| 2 | typeInEditor(page, "/") | [DOM] 菜单出现（query=""） | 选择器: .nexus-slash-menu; 操作: type(/); 控件: menu; 等待: 300ms |
| 3 | waitForSlashMenu(page); page.keyboard.press("Space") | [DOM] query 变为 " "（含空白），getSlashMatch 返回 null（`slash-state.ts:56`），菜单关闭 | 选择器: .nexus-slash-menu; 操作: press(Space); 控件: menu; 等待: 400ms |
| 4 | 检查 `.nexus-slash-menu` 是否可见 | [DOM] 菜单 display === none | 选择器: .nexus-slash-menu; 操作: getAttribute(style); 控件: menu; 等待: 无 |

**断言汇总**:
- [DOM] `/` 后输入空格菜单关闭（getSlashMatch 的 "query 不允许空白" 规则，`slash-state.ts:56`）

---

### FP-15-02-N03 [P2] [正常] 第二行行首 `/` 触发菜单（多行文档场景）

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 含两行文本
- 插件配置: demo 默认
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. `clearEditor(page)`
  3. `typeInEditor(page, "first line")` + Enter + 光标到第二行行首

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page); typeInEditor(page, "first line"); page.keyboard.press("Enter") | [DOM] 编辑器含 "first line" + 换行，光标在第二行行首 | 选择器: .cm-content; 操作: clear+type+Enter; 控件: editor; 等待: 200ms |
| 2 | typeInEditor(page, "/") | [DOM] getSlashMatch 检测第二行行首 `/`（`slash-state.ts:42-43` lastIndexOf("\n")+1 为行首），菜单出现 | 选择器: .nexus-slash-menu; 操作: type(/); 控件: menu; 等待: 300ms |
| 3 | waitForSlashMenu(page) | [DOM] 菜单可见含菜单项 | 选择器: .nexus-slash-menu__item; 操作: waitFor; 控件: menu-item; 等待: 1000ms |
| 4 | dismissSlashMenu(page) | [DOM] 菜单关闭 | 选择器: .nexus-slash-menu; 操作: Escape; 控件: menu; 等待: 100ms |

**断言汇总**:
- [DOM] 第二行行首 `/` 触发菜单（getSlashState 正确处理多行文档的行首判定）

---

### FP-15-02-N04 [P2] [正常] 光标移回 `/` 之前 → 菜单关闭（getSlashState 基于光标位置计算）

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 空文档
- 插件配置: demo 默认
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. `clearEditor(page)`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page) | [DOM] 编辑器清空 | 选择器: .cm-content; 操作: clear; 控件: editor; 等待: 200ms |
| 2 | typeInEditor(page, "/bold") | [DOM] 菜单出现（query="bold"） | 选择器: .nexus-slash-menu; 操作: type(/bold); 控件: menu; 等待: 300ms |
| 3 | waitForSlashMenu(page); 连续按 5 次 ArrowLeft（光标移到 `/` 之前，文档最前面） | [DOM] getSlashMatch 以新光标位置计算（`slash-state.ts:41` before=slice(0,0)=""），line 中无 `/`（`slash-state.ts:44-46`），返回 null，菜单关闭 | 选择器: .nexus-slash-menu; 操作: press(ArrowLeft)*5; 控件: menu; 等待: 400ms |
| 4 | 检查 `.nexus-slash-menu` 是否可见 | [DOM] 菜单 display === none | 选择器: .nexus-slash-menu; 操作: getAttribute(style); 控件: menu; 等待: 无 |

**断言汇总**:
- [DOM] 光标移出 `/query` 范围后菜单关闭（getSlashState 依赖 cursor 参数动态计算）

---

## FP-15-03: filterSlashCommands 过滤+确定性排序（6 例，[插件能力]）

> 间接验证路径: `filterSlashCommands`（`packages/core/src/slash-state.ts:118-151`）对命令按 scoreCommand 打分排序。e2e 层通过"不同 query 下菜单项的显示顺序"验证排序分层: 精确 > 前缀 > 关键词。工具栏 14 条命令提供了丰富的 title/keywords 组合用于触发各层。

### FP-15-03-N01 [P1] [正常] 精确匹配优先: `/bold` → Bold（title 精确匹配）排第一

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 空文档
- 插件配置: demo 默认（bold 的 title="Bold"，keywords=["bold","strong","b"]）
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. `clearEditor(page)`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page) | [DOM] 编辑器清空 | 选择器: .cm-content; 操作: clear; 控件: editor; 等待: 200ms |
| 2 | typeInEditor(page, "/bold") | [DOM] 菜单出现 | 选择器: .nexus-slash-menu; 操作: type(/bold); 控件: menu; 等待: 300ms |
| 3 | waitForSlashMenu(page); getVisibleMenuItemIds(page) | [DOM] 返回列表第一个元素 === "bold"（title "Bold" 精确匹配 query "bold"，score=6000，`slash-state.ts:79-81`） | 选择器: .nexus-slash-menu__item; 操作: dataset.slashCommandId; 控件: menu-item; 等待: 无 |
| 4 | dismissSlashMenu(page) | [DOM] 菜单关闭 | 选择器: .nexus-slash-menu; 操作: Escape; 控件: menu; 等待: 100ms |

**断言汇总**:
- [DOM] `/bold` 后 Bold 命令排第一（精确匹配 SCORE_TITLE_EXACT=6000 优先）

---

### FP-15-03-N02 [P1] [正常] 前缀匹配排序: `/head` → Heading 1/2/3（title 前缀匹配）排在前面

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 空文档
- 插件配置: demo 默认（h1/h2/h3 的 title 分别 "Heading 1"/"Heading 2"/"Heading 3"，均以 "Heading" 开头即前缀匹配 "head"，score=5000）
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. `clearEditor(page)`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page) | [DOM] 编辑器清空 | 选择器: .cm-content; 操作: clear; 控件: editor; 等待: 200ms |
| 2 | typeInEditor(page, "/head") | [DOM] 菜单出现 | 选择器: .nexus-slash-menu; 操作: type(/head); 控件: menu; 等待: 300ms |
| 3 | waitForSlashMenu(page); getVisibleMenuItemIds(page) | [DOM] 返回列表前 3 项为 "h1"/"h2"/"h3"（顺序: 按 tiebreaker=title.length 升序，"Heading 1"<"Heading 2"<"Heading 3" 长度相同则按 title 字母序，`slash-state.ts:84-85` + `145-147`），均前缀匹配 score=5000 | 选择器: .nexus-slash-menu__item; 操作: dataset.slashCommandId; 控件: menu-item; 等待: 无 |
| 4 | dismissSlashMenu(page) | [DOM] 菜单关闭 | 选择器: .nexus-slash-menu; 操作: Escape; 控件: menu; 等待: 100ms |

**断言汇总**:
- [DOM] `/head` 后 Heading 1/2/3 排前 3（前缀匹配 SCORE_TITLE_PREFIX=5000，tiebreaker 为 title.length）

---

### FP-15-03-N03 [P2] [正常] 关键词匹配: `/strong` → Bold（keywords 含 "strong"）出现在结果中

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 空文档
- 插件配置: demo 默认（bold 的 keywords=["bold","strong","b"]，query "strong" 命中关键词精确匹配 score=4000）
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. `clearEditor(page)`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page) | [DOM] 编辑器清空 | 选择器: .cm-content; 操作: clear; 控件: editor; 等待: 200ms |
| 2 | typeInEditor(page, "/strong") | [DOM] 菜单出现 | 选择器: .nexus-slash-menu; 操作: type(/strong); 控件: menu; 等待: 300ms |
| 3 | waitForSlashMenu(page); getVisibleMenuItemIds(page) | [DOM] 返回列表包含 "bold"（keywords 含 "strong" 精确匹配，score=4000，`slash-state.ts:88-92`） | 选择器: .nexus-slash-menu__item; 操作: dataset.slashCommandId; 控件: menu-item; 等待: 无 |
| 4 | dismissSlashMenu(page) | [DOM] 菜单关闭 | 选择器: .nexus-slash-menu; 操作: Escape; 控件: menu; 等待: 100ms |

**断言汇总**:
- [DOM] `/strong` 后 Bold 出现（关键词精确匹配 SCORE_KEYWORD_EXACT=4000）

---

### FP-15-03-N04 [P2] [正常] 多结果 limit 截断: 空 query 显示前 8 条（默认 limit=8）

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 空文档
- 插件配置: demo 默认（14 条命令，limit=8）
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. `clearEditor(page)`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page) | [DOM] 编辑器清空 | 选择器: .cm-content; 操作: clear; 控件: editor; 等待: 200ms |
| 2 | typeInEditor(page, "/") | [DOM] 菜单出现 | 选择器: .nexus-slash-menu; 操作: type(/); 控件: menu; 等待: 300ms |
| 3 | waitForSlashMenu(page); getVisibleMenuItemIds(page) | [DOM] 返回列表长度 === 8（14 条命令经 `slash-state.ts:169` filtered.slice(0,8) 截断） | 选择器: .nexus-slash-menu__item; 操作: dataset.slashCommandId; 控件: menu-item; 等待: 无 |
| 4 | dismissSlashMenu(page) | [DOM] 菜单关闭 | 选择器: .nexus-slash-menu; 操作: Escape; 控件: menu; 等待: 100ms |

**断言汇总**:
- [DOM] 空 query 时菜单显示 8 条（默认 limit=8 截断，`slash-state.ts:26` + `169`）

---

### FP-15-03-N05 [P2] [正常] 空 query 保持注册顺序（不排序）

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 空文档
- 插件配置: demo 默认（toolbarSlashCommands 注册顺序: h1,h2,h3,bold,...）
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. `clearEditor(page)`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page) | [DOM] 编辑器清空 | 选择器: .cm-content; 操作: clear; 控件: editor; 等待: 200ms |
| 2 | typeInEditor(page, "/") | [DOM] 菜单出现 | 选择器: .nexus-slash-menu; 操作: type(/); 控件: menu; 等待: 300ms |
| 3 | waitForSlashMenu(page); getVisibleMenuItemIds(page) | [DOM] 返回列表前 3 项依次为 "h1"/"h2"/"h3"（空 query 时 `slash-state.ts:122-128` 直接返回 commands.slice() 保持注册顺序，不按字母排序） | 选择器: .nexus-slash-menu__item; 操作: dataset.slashCommandId; 控件: menu-item; 等待: 无 |
| 4 | dismissSlashMenu(page) | [DOM] 菜单关闭 | 选择器: .nexus-slash-menu; 操作: Escape; 控件: menu; 等待: 100ms |

**断言汇总**:
- [DOM] 空 query 时菜单项顺序 = toolbarSlashCommands 注册顺序（filterSlashCommands 空 query 分支保持原序）

---

### FP-15-03-E01 [P3] [异常] 无匹配 query: `/zzzzz` → 菜单显示空态 "No matches"

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 空文档
- 插件配置: demo 默认
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. `clearEditor(page)`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page) | [DOM] 编辑器清空 | 选择器: .cm-content; 操作: clear; 控件: editor; 等待: 200ms |
| 2 | typeInEditor(page, "/zzzzz") | [DOM] 菜单出现，getSlashMatch query="zzzzz" 但 filterSlashCommands 所有命令 scoreCommand 返回 null（`slash-state.ts:115`），结果为空 | 选择器: .nexus-slash-menu; 操作: type(/zzzzz); 控件: menu; 等待: 300ms |
| 3 | waitForSlashMenuRoot(page); 检查 `.nexus-slash-menu__empty` | [DOM] `.nexus-slash-menu__empty` 可见且 textContent === "No matches"（`menu-ui.ts:152-155`） | 选择器: .nexus-slash-menu__empty; 操作: textContent(); 控件: menu; 等待: 无 |
| 4 | dismissSlashMenu(page) | [DOM] 菜单关闭 | 选择器: .nexus-slash-menu; 操作: Escape; 控件: menu; 等待: 100ms |

**断言汇总**:
- [DOM] 无匹配 query 显示 "No matches" 空态（filterSlashCommands 返回空数组 + renderItems 空态分支）

---

## FP-15-04: 菜单 UI 键盘交互（7 例，[编辑交互][无障碍]）

> 间接验证路径: `menu-ui.ts:359-417` 的 `onKeyDown` 在 capture 阶段拦截键盘事件。高亮项通过 `applyHighlight()`（`menu-ui.ts:134-146`）切换 `.is-active` 类和 `aria-selected` 属性。

### FP-15-04-N01 [P1] [正常] ArrowDown 高亮从第一项移动到第二项

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 空文档
- 插件配置: demo 默认
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. `clearEditor(page)`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page) | [DOM] 编辑器清空 | 选择器: .cm-content; 操作: clear; 控件: editor; 等待: 200ms |
| 2 | typeInEditor(page, "/") | [DOM] 菜单出现，默认 highlight=0（第一项 is-active，`menu-ui.ts:332`） | 选择器: .nexus-slash-menu; 操作: type(/); 控件: menu; 等待: 300ms |
| 3 | waitForSlashMenu(page); getActiveItemId(page) | [DOM] 高亮项 = 菜单第一项（如 "h1"） | 选择器: .nexus-slash-menu__item.is-active; 操作: dataset.slashCommandId; 控件: menu-item; 等待: 无 |
| 4 | page.keyboard.press("ArrowDown") | [DOM] highlight 从 0 → 1（`menu-ui.ts:370-371`），第二项变为 is-active | 选择器: .nexus-slash-menu__item; 操作: press(ArrowDown); 控件: keymap; 等待: 200ms |
| 5 | getActiveItemId(page) | [DOM] 高亮项 = 菜单第二项（如 "h2"） | 选择器: .nexus-slash-menu__item.is-active; 操作: dataset.slashCommandId; 控件: menu-item; 等待: 无 |
| 6 | dismissSlashMenu(page) | [DOM] 菜单关闭 | 选择器: .nexus-slash-menu; 操作: Escape; 控件: menu; 等待: 100ms |

**断言汇总**:
- [DOM] ArrowDown 高亮从第一项移到第二项（onKeyDown ArrowDown 分支 + applyHighlight）

---

### FP-15-04-N02 [P1] [正常] ArrowUp 高亮从第一项循环到最后一项（环绕）

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 空文档
- 插件配置: demo 默认
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. `clearEditor(page)`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page) | [DOM] 编辑器清空 | 选择器: .cm-content; 操作: clear; 控件: editor; 等待: 200ms |
| 2 | typeInEditor(page, "/bold") | [DOM] 菜单出现（仅含少量匹配项便于验证环绕） | 选择器: .nexus-slash-menu; 操作: type(/bold); 控件: menu; 等待: 300ms |
| 3 | waitForSlashMenu(page); 记录第一项 id 和最后一项 id | [DOM] 获取菜单项列表 | 选择器: .nexus-slash-menu__item; 操作: dataset.slashCommandId; 控件: menu-item; 等待: 无 |
| 4 | page.keyboard.press("ArrowUp") | [DOM] highlight=0 时 ArrowUp 计算 (0-1+len)%len = len-1（`menu-ui.ts:379-380`），跳到最后一项 | 选择器: .nexus-slash-menu__item; 操作: press(ArrowUp); 控件: keymap; 等待: 200ms |
| 5 | getActiveItemId(page) | [DOM] 高亮项 = 菜单最后一项 | 选择器: .nexus-slash-menu__item.is-active; 操作: dataset.slashCommandId; 控件: menu-item; 等待: 无 |
| 6 | dismissSlashMenu(page) | [DOM] 菜单关闭 | 选择器: .nexus-slash-menu; 操作: Escape; 控件: menu; 等待: 100ms |

**断言汇总**:
- [DOM] ArrowUp 在第一项时环绕到最后一项（onKeyDown ArrowUp 环绕公式）

---

### FP-15-04-N03 [P1] [正常] Home 键高亮跳到第一项

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 空文档
- 插件配置: demo 默认
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. `clearEditor(page)`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page) | [DOM] 编辑器清空 | 选择器: .cm-content; 操作: clear; 控件: editor; 等待: 200ms |
| 2 | typeInEditor(page, "/") | [DOM] 菜单出现 | 选择器: .nexus-slash-menu; 操作: type(/); 控件: menu; 等待: 300ms |
| 3 | waitForSlashMenu(page); page.keyboard.press("ArrowDown"); page.keyboard.press("ArrowDown") | [DOM] highlight 移到第三项（index=2） | 选择器: .nexus-slash-menu__item; 操作: press(ArrowDown)*2; 控件: keymap; 等待: 300ms |
| 4 | page.keyboard.press("Home") | [DOM] highlight 重置为 0（`menu-ui.ts:386-388`） | 选择器: .nexus-slash-menu__item; 操作: press(Home); 控件: keymap; 等待: 200ms |
| 5 | getActiveItemId(page) | [DOM] 高亮项 = 菜单第一项 | 选择器: .nexus-slash-menu__item.is-active; 操作: dataset.slashCommandId; 控件: menu-item; 等待: 无 |
| 6 | dismissSlashMenu(page) | [DOM] 菜单关闭 | 选择器: .nexus-slash-menu; 操作: Escape; 控件: menu; 等待: 100ms |

**断言汇总**:
- [DOM] Home 键高亮跳到第一项（onKeyDown Home 分支，`menu-ui.ts:383-390`）

---

### FP-15-04-N04 [P1] [正常] End 键高亮跳到最后一项

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 空文档
- 插件配置: demo 默认
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. `clearEditor(page)`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page) | [DOM] 编辑器清空 | 选择器: .cm-content; 操作: clear; 控件: editor; 等待: 200ms |
| 2 | typeInEditor(page, "/") | [DOM] 菜单出现（8 项，index 0-7） | 选择器: .nexus-slash-menu; 操作: type(/); 控件: menu; 等待: 300ms |
| 3 | waitForSlashMenu(page); page.keyboard.press("End") | [DOM] highlight 设为 len-1=7（`menu-ui.ts:394-396`） | 选择器: .nexus-slash-menu__item; 操作: press(End); 控件: keymap; 等待: 200ms |
| 4 | getActiveItemId(page) | [DOM] 高亮项 = 菜单最后一项（第 8 项） | 选择器: .nexus-slash-menu__item.is-active; 操作: dataset.slashCommandId; 控件: menu-item; 等待: 无 |
| 5 | dismissSlashMenu(page) | [DOM] 菜单关闭 | 选择器: .nexus-slash-menu; 操作: Escape; 控件: menu; 等待: 100ms |

**断言汇总**:
- [DOM] End 键高亮跳到最后一项（onKeyDown End 分支，`menu-ui.ts:391-398`）

---

### FP-15-04-N05 [P1] [正常] Enter 键确认当前高亮命令 → 执行并关闭菜单

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 空文档
- 插件配置: demo 默认
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. `clearEditor(page)`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page) | [DOM] 编辑器清空 | 选择器: .cm-content; 操作: clear; 控件: editor; 等待: 200ms |
| 2 | typeInEditor(page, "/") | [DOM] 菜单出现，默认高亮第一项 | 选择器: .nexus-slash-menu; 操作: type(/); 控件: menu; 等待: 300ms |
| 3 | waitForSlashMenu(page); page.keyboard.press("Enter") | [DOM] confirm() 执行（`menu-ui.ts:399-409`），删除 `/` + 调用第一项命令的 run | 选择器: .nexus-slash-menu; 操作: press(Enter); 控件: keymap; 等待: 300ms |
| 4 | getEditorText(page) | [DOM] textContent 不含 "/"（触发文本已删除），含第一项命令的 Markdown 副作用（如 "# " 来自 Heading 1） | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |
| 5 | 检查 `.nexus-slash-menu` 是否可见 | [DOM] 菜单 display === none（confirm 后 hide()） | 选择器: .nexus-slash-menu; 操作: getAttribute(style); 控件: menu; 等待: 无 |

**断言汇总**:
- [DOM] Enter 确认后命令执行（cmd.run 副作用）+ 菜单关闭 + `/query` 删除

---

### FP-15-04-N06 [P1] [正常] Tab 键确认当前高亮命令（与 Enter 等效）

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 空文档
- 插件配置: demo 默认
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. `clearEditor(page)`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page) | [DOM] 编辑器清空 | 选择器: .cm-content; 操作: clear; 控件: editor; 等待: 200ms |
| 2 | typeInEditor(page, "/") | [DOM] 菜单出现，默认高亮第一项 | 选择器: .nexus-slash-menu; 操作: type(/); 控件: menu; 等待: 300ms |
| 3 | waitForSlashMenu(page); page.keyboard.press("Tab") | [DOM] Tab 与 Enter 走同一分支（`menu-ui.ts:399-400` case "Enter": case "Tab":），confirm() 执行 | 选择器: .nexus-slash-menu; 操作: press(Tab); 控件: keymap; 等待: 300ms |
| 4 | getEditorText(page) | [DOM] textContent 含第一项命令的 Markdown 副作用，不含 "/" | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |
| 5 | 检查 `.nexus-slash-menu` 是否可见 | [DOM] 菜单 display === none | 选择器: .nexus-slash-menu; 操作: getAttribute(style); 控件: menu; 等待: 无 |

**断言汇总**:
- [DOM] Tab 确认与 Enter 等效（onKeyDown Tab 分支复用 confirm 路径）

---

### FP-15-04-N07 [P1] [正常] Escape 键关闭菜单（不执行命令）

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 空文档
- 插件配置: demo 默认
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. `clearEditor(page)`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page) | [DOM] 编辑器清空 | 选择器: .cm-content; 操作: clear; 控件: editor; 等待: 200ms |
| 2 | typeInEditor(page, "/") | [DOM] 菜单出现 | 选择器: .nexus-slash-menu; 操作: type(/); 控件: menu; 等待: 300ms |
| 3 | waitForSlashMenu(page); page.keyboard.press("Escape") | [DOM] dismiss() 执行（`menu-ui.ts:411-415`），dismissed=true，hide() | 选择器: .nexus-slash-menu; 操作: press(Escape); 控件: keymap; 等待: 200ms |
| 4 | 检查 `.nexus-slash-menu` 是否可见 | [DOM] 菜单 display === none | 选择器: .nexus-slash-menu; 操作: getAttribute(style); 控件: menu; 等待: 无 |
| 5 | getEditorText(page) | [DOM] textContent 仍含 "/"（未执行命令，未删除触发文本） | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |

**断言汇总**:
- [DOM] Escape 关闭菜单但不执行命令（dismiss 路径不调 cmd.run，不删 `/query`）

---

### FP-15-04-E01 [P3] [异常] 空菜单时 Enter 键不插入换行（preventDefault 生效）

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 空文档
- 插件配置: demo 默认
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. `clearEditor(page)`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page) | [DOM] 编辑器清空 | 选择器: .cm-content; 操作: clear; 控件: editor; 等待: 200ms |
| 2 | typeInEditor(page, "/zzzzz") | [DOM] 菜单出现但为空态（No matches） | 选择器: .nexus-slash-menu; 操作: type(/zzzzz); 控件: menu; 等待: 300ms |
| 3 | waitForSlashMenuRoot(page); page.keyboard.press("Enter") | [DOM] len===0 分支执行 dismiss()（`menu-ui.ts:405-408`），且 preventDefault 阻止 CM6 插入换行 | 选择器: .nexus-slash-menu; 操作: press(Enter); 控件: keymap; 等待: 300ms |
| 4 | getEditorText(page) | [DOM] textContent === "/zzzzz"（无换行符 \n，Enter 被吞） | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |
| 5 | 检查 `.nexus-slash-menu` 是否可见 | [DOM] 菜单 display === none（dismiss 关闭） | 选择器: .nexus-slash-menu; 操作: getAttribute(style); 控件: menu; 等待: 无 |

**断言汇总**:
- [DOM] 空菜单 Enter 不插入换行且关闭菜单（onKeyDown 空结果分支 preventDefault + dismiss）

---

## FP-15-05: 菜单 UI 鼠标交互（5 例，[编辑交互]）

> 间接验证路径: `menu-ui.ts:175-189` 注册 mouseenter（同步高亮）和 click（确认）事件；`menu-ui.ts:419-430` 的 `onDocumentPointerDown` 处理外部点击关闭。

### FP-15-05-N01 [P1] [正常] 鼠标 hover 菜单项 → 高亮同步到该项

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 空文档
- 插件配置: demo 默认
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. `clearEditor(page)`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page) | [DOM] 编辑器清空 | 选择器: .cm-content; 操作: clear; 控件: editor; 等待: 200ms |
| 2 | typeInEditor(page, "/") | [DOM] 菜单出现，默认高亮第一项 | 选择器: .nexus-slash-menu; 操作: type(/); 控件: menu; 等待: 300ms |
| 3 | waitForSlashMenu(page); 获取第二项元素并 hover | [DOM] mouseenter 触发（`menu-ui.ts:175-179`），highlight=index(1)，applyHighlight 切换 is-active | 选择器: .nexus-slash-menu__item:nth-child(2); 操作: hover(); 控件: menu-item; 等待: 200ms |
| 4 | getActiveItemId(page) | [DOM] 高亮项 = 第二项 | 选择器: .nexus-slash-menu__item.is-active; 操作: dataset.slashCommandId; 控件: menu-item; 等待: 无 |
| 5 | dismissSlashMenu(page) | [DOM] 菜单关闭 | 选择器: .nexus-slash-menu; 操作: Escape; 控件: menu; 等待: 100ms |

**断言汇总**:
- [DOM] hover 菜单项后高亮同步（mouseenter → highlight=index → applyHighlight）

---

### FP-15-05-N02 [P1] [正常] 鼠标 click 菜单项 → 确认执行该命令

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 空文档
- 插件配置: demo 默认
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. `clearEditor(page)`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page) | [DOM] 编辑器清空 | 选择器: .cm-content; 操作: clear; 控件: editor; 等待: 200ms |
| 2 | typeInEditor(page, "/bold") | [DOM] 菜单出现含 Bold 项 | 选择器: .nexus-slash-menu; 操作: type(/bold); 控件: menu; 等待: 300ms |
| 3 | waitForSlashMenu(page); 定位 data-slash-command-id="bold" 的项并 click | [DOM] click 触发 confirm()（`menu-ui.ts:185-189`），删除 `/bold` + 调 toggleBold | 选择器: [data-slash-command-id="bold"]; 操作: click(); 控件: menu-item; 等待: 300ms |
| 4 | getEditorText(page) | [DOM] textContent 不含 "/bold"，含 Bold 命令副作用（注意: 空选区下 toggleBold 可能插入 `****` 占位或无变化，验证 "/" 消失即可） | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |
| 5 | 检查 `.nexus-slash-menu` 是否可见 | [DOM] 菜单 display === none | 选择器: .nexus-slash-menu; 操作: getAttribute(style); 控件: menu; 等待: 无 |

**断言汇总**:
- [DOM] click 菜单项确认执行（click → confirm → cmd.run + 删除触发文本）

---

### FP-15-05-N03 [P1] [正常] 点击菜单外部（编辑器区域）→ 菜单关闭

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 空文档
- 插件配置: demo 默认
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. `clearEditor(page)`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page) | [DOM] 编辑器清空 | 选择器: .cm-content; 操作: clear; 控件: editor; 等待: 200ms |
| 2 | typeInEditor(page, "/") | [DOM] 菜单出现 | 选择器: .nexus-slash-menu; 操作: type(/); 控件: menu; 等待: 300ms |
| 3 | waitForSlashMenu(page); 点击编辑器顶部空白区域（非菜单内） | [DOM] mousedown 在菜单外触发 onDocumentPointerDown（`menu-ui.ts:419-429`），root.contains(target)=false，dismiss() | 选择器: .cm-editor; 操作: click({position:{x:5,y:5}}); 控件: editor; 等待: 300ms |
| 4 | 检查 `.nexus-slash-menu` 是否可见 | [DOM] 菜单 display === none | 选择器: .nexus-slash-menu; 操作: getAttribute(style); 控件: menu; 等待: 无 |

**断言汇总**:
- [DOM] 点击菜单外部关闭菜单（onDocumentPointerDown 外部点击 dismiss）

---

### FP-15-05-N04 [P2] [正常] 鼠标 hover 第二项后再 hover 第一项 → 高亮回移

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 空文档
- 插件配置: demo 默认
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. `clearEditor(page)`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page) | [DOM] 编辑器清空 | 选择器: .cm-content; 操作: clear; 控件: editor; 等待: 200ms |
| 2 | typeInEditor(page, "/") | [DOM] 菜单出现 | 选择器: .nexus-slash-menu; 操作: type(/); 控件: menu; 等待: 300ms |
| 3 | waitForSlashMenu(page); hover 第二项; 然后 hover 第一项 | [DOM] mouseenter 两次触发，highlight 先变 1 再变 0（`menu-ui.ts:175-179`），applyHighlight 每次切换 | 选择器: .nexus-slash-menu__item; 操作: hover()*2; 控件: menu-item; 等待: 300ms |
| 4 | getActiveItemId(page) | [DOM] 高亮项 = 第一项 | 选择器: .nexus-slash-menu__item.is-active; 操作: dataset.slashCommandId; 控件: menu-item; 等待: 无 |
| 5 | dismissSlashMenu(page) | [DOM] 菜单关闭 | 选择器: .nexus-slash-menu; 操作: Escape; 控件: menu; 等待: 100ms |

**断言汇总**:
- [DOM] hover 可双向切换高亮（mouseenter 每次重设 highlight）

---

### FP-15-05-E01 [P3] [异常] 菜单 dismissed 后 hover 菜单项不再高亮（isMenuOpen 守卫）

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 空文档
- 插件配置: demo 默认
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. `clearEditor(page)`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page) | [DOM] 编辑器清空 | 选择器: .cm-content; 操作: clear; 控件: editor; 等待: 200ms |
| 2 | typeInEditor(page, "/") | [DOM] 菜单出现 | 选择器: .nexus-slash-menu; 操作: type(/); 控件: menu; 等待: 300ms |
| 3 | waitForSlashMenu(page); page.keyboard.press("Escape") | [DOM] dismiss() 设置 dismissed=true（`menu-ui.ts:274-277`） | 选择器: .nexus-slash-menu; 操作: press(Escape); 控件: keymap; 等待: 200ms |
| 4 | hover 菜单项（此时菜单已隐藏） | [DOM] mouseenter 回调中 isMenuOpen()=false（`menu-ui.ts:176`），不执行高亮切换 | 选择器: .nexus-slash-menu__item; 操作: hover(); 控件: menu-item; 等待: 200ms |
| 5 | getActiveItemId(page) | [DOM] 无高亮项（菜单已隐藏，is-active 不变化） | 选择器: .nexus-slash-menu__item.is-active; 操作: dataset.slashCommandId; 控件: menu-item; 等待: 无 |

**断言汇总**:
- [DOM] 菜单 dismissed 后 hover 不再生效（mouseenter 的 isMenuOpen 守卫，`menu-ui.ts:176`）

---

## FP-15-06: IME composition 期间禁用键盘拦截（5 例，[编辑交互][边界异常]）

> 间接验证路径: `menu-ui.ts:432-437` 的 `onCompositionStart`/`onCompositionEnd` 切换 `isComposing` 标志；`menu-ui.ts:362` 的 `onKeyDown` 在 `isComposing` 为 true 时直接 return（不拦截键盘）。

### FP-15-06-N01 [P1] [正常] compositionstart 期间 ArrowDown 不拦截 → CM6 正常移动光标（菜单高亮不变）

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 空文档
- 插件配置: demo 默认
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. `clearEditor(page)`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page) | [DOM] 编辑器清空 | 选择器: .cm-content; 操作: clear; 控件: editor; 等待: 200ms |
| 2 | typeInEditor(page, "/") | [DOM] 菜单出现，默认高亮第一项 | 选择器: .nexus-slash-menu; 操作: type(/); 控件: menu; 等待: 300ms |
| 3 | waitForSlashMenu(page); page.evaluate(() => document.dispatchEvent(new CompositionEvent("compositionstart", {bubbles:true}))) | [DOM] isComposing=true（`menu-ui.ts:432-433`） | 选择器: document; 操作: dispatchEvent(compositionstart); 控件: dom-event; 等待: 100ms |
| 4 | 记录当前高亮项; page.keyboard.press("ArrowDown") | [DOM] onKeyDown 因 isComposing=true 直接 return（`menu-ui.ts:362`），ArrowDown 不被拦截，高亮不变 | 选择器: .nexus-slash-menu__item; 操作: press(ArrowDown); 控件: keymap; 等待: 200ms |
| 5 | getActiveItemId(page) | [DOM] 高亮项 === 步骤 4 记录的值（未变化，证明 ArrowDown 未被拦截） | 选择器: .nexus-slash-menu__item.is-active; 操作: dataset.slashCommandId; 控件: menu-item; 等待: 无 |
| 6 | page.evaluate(() => document.dispatchEvent(new CompositionEvent("compositionend", {bubbles:true}))) | [DOM] isComposing 恢复 false（清理状态） | 选择器: document; 操作: dispatchEvent(compositionend); 控件: dom-event; 等待: 100ms |
| 7 | dismissSlashMenu(page) | [DOM] 菜单关闭 | 选择器: .nexus-slash-menu; 操作: Escape; 控件: menu; 等待: 100ms |

**断言汇总**:
- [DOM] compositionstart 后 ArrowDown 不拦截菜单导航（isComposing 守卫，`menu-ui.ts:362`）

---

### FP-15-06-N02 [P1] [正常] compositionend 后 ArrowDown 恢复拦截 → 高亮正常移动

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 空文档
- 插件配置: demo 默认
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. `clearEditor(page)`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page) | [DOM] 编辑器清空 | 选择器: .cm-content; 操作: clear; 控件: editor; 等待: 200ms |
| 2 | typeInEditor(page, "/") | [DOM] 菜单出现 | 选择器: .nexus-slash-menu; 操作: type(/); 控件: menu; 等待: 300ms |
| 3 | waitForSlashMenu(page); page.evaluate(() => document.dispatchEvent(new CompositionEvent("compositionstart", {bubbles:true}))); page.evaluate(() => document.dispatchEvent(new CompositionEvent("compositionend", {bubbles:true}))) | [DOM] isComposing 先 true 后 false（`menu-ui.ts:432-437`） | 选择器: document; 操作: dispatchEvent(start+end); 控件: dom-event; 等待: 200ms |
| 4 | 记录当前高亮项; page.keyboard.press("ArrowDown") | [DOM] isComposing=false，onKeyDown 正常处理 ArrowDown（`menu-ui.ts:367-374`），highlight+1 | 选择器: .nexus-slash-menu__item; 操作: press(ArrowDown); 控件: keymap; 等待: 200ms |
| 5 | getActiveItemId(page) | [DOM] 高亮项 !== 步骤 4 记录值（已移动到第二项） | 选择器: .nexus-slash-menu__item.is-active; 操作: dataset.slashCommandId; 控件: menu-item; 等待: 无 |
| 6 | dismissSlashMenu(page) | [DOM] 菜单关闭 | 选择器: .nexus-slash-menu; 操作: Escape; 控件: menu; 等待: 100ms |

**断言汇总**:
- [DOM] compositionend 后键盘拦截恢复（isComposing 重置为 false）

---

### FP-15-06-N03 [P2] [正常] compositionstart 期间 Escape 不拦截 → 菜单不关闭

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 空文档
- 插件配置: demo 默认
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. `clearEditor(page)`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page) | [DOM] 编辑器清空 | 选择器: .cm-content; 操作: clear; 控件: editor; 等待: 200ms |
| 2 | typeInEditor(page, "/") | [DOM] 菜单出现 | 选择器: .nexus-slash-menu; 操作: type(/); 控件: menu; 等待: 300ms |
| 3 | waitForSlashMenu(page); page.evaluate(() => document.dispatchEvent(new CompositionEvent("compositionstart", {bubbles:true}))) | [DOM] isComposing=true | 选择器: document; 操作: dispatchEvent(compositionstart); 控件: dom-event; 等待: 100ms |
| 4 | page.keyboard.press("Escape") | [DOM] onKeyDown 因 isComposing 直接 return（`menu-ui.ts:362`），Escape 未触发 dismiss | 选择器: .nexus-slash-menu; 操作: press(Escape); 控件: keymap; 等待: 200ms |
| 5 | 检查 `.nexus-slash-menu` 是否可见 | [DOM] 菜单仍 display !== none（未关闭） | 选择器: .nexus-slash-menu; 操作: getAttribute(style); 控件: menu; 等待: 无 |
| 6 | page.evaluate(() => document.dispatchEvent(new CompositionEvent("compositionend", {bubbles:true}))); page.keyboard.press("Escape") | [DOM] compositionend 后 Escape 正常触发 dismiss | 选择器: .nexus-slash-menu; 操作: dispatchEvent(end)+press(Escape); 控件: dom-event+keymap; 等待: 200ms |

**断言汇总**:
- [DOM] compositionstart 期间 Escape 不关闭菜单（isComposing 守卫覆盖所有按键包括 Escape）

---

### FP-15-06-N04 [P2] [正常] compositionstart 期间 Enter 不拦截 → 不确认命令

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 空文档
- 插件配置: demo 默认
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. `clearEditor(page)`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page) | [DOM] 编辑器清空 | 选择器: .cm-content; 操作: clear; 控件: editor; 等待: 200ms |
| 2 | typeInEditor(page, "/") | [DOM] 菜单出现 | 选择器: .nexus-slash-menu; 操作: type(/); 控件: menu; 等待: 300ms |
| 3 | waitForSlashMenu(page); page.evaluate(() => document.dispatchEvent(new CompositionEvent("compositionstart", {bubbles:true}))) | [DOM] isComposing=true | 选择器: document; 操作: dispatchEvent(compositionstart); 控件: dom-event; 等待: 100ms |
| 4 | page.keyboard.press("Enter") | [DOM] onKeyDown 因 isComposing 直接 return，confirm 未执行 | 选择器: .nexus-slash-menu; 操作: press(Enter); 控件: keymap; 等待: 200ms |
| 5 | getEditorText(page) | [DOM] textContent 仍含 "/"（命令未执行，触发文本未删除） | 选择器: .cm-content; 操作: textContent(); 控件: editor; 等待: 无 |
| 6 | page.evaluate(() => document.dispatchEvent(new CompositionEvent("compositionend", {bubbles:true}))); dismissSlashMenu(page) | [DOM] 清理状态 | 选择器: document; 操作: dispatchEvent(end)+Escape; 控件: dom-event; 等待: 200ms |

**断言汇总**:
- [DOM] compositionstart 期间 Enter 不确认命令（isComposing 守卫覆盖 Enter/Tab）

---

### FP-15-06-E01 [P3] [异常] 未触发 compositionstart 直接 compositionend → isComposing 保持 false（幂等）

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 空文档
- 插件配置: demo 默认
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. `clearEditor(page)`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page) | [DOM] 编辑器清空 | 选择器: .cm-content; 操作: clear; 控件: editor; 等待: 200ms |
| 2 | typeInEditor(page, "/") | [DOM] 菜单出现 | 选择器: .nexus-slash-menu; 操作: type(/); 控件: menu; 等待: 300ms |
| 3 | waitForSlashMenu(page); 直接 dispatch compositionend（无前置 compositionstart） | [DOM] isComposing 本就 false，compositionend 设 false（`menu-ui.ts:435-437`），无副作用 | 选择器: document; 操作: dispatchEvent(compositionend); 控件: dom-event; 等待: 100ms |
| 4 | page.keyboard.press("ArrowDown") | [DOM] isComposing=false，ArrowDown 正常拦截，highlight 移动 | 选择器: .nexus-slash-menu__item; 操作: press(ArrowDown); 控件: keymap; 等待: 200ms |
| 5 | getActiveItemId(page) | [DOM] 高亮项已移动（证明键盘拦截正常工作） | 选择器: .nexus-slash-menu__item.is-active; 操作: dataset.slashCommandId; 控件: menu-item; 等待: 无 |
| 6 | dismissSlashMenu(page) | [DOM] 菜单关闭 | 选择器: .nexus-slash-menu; 操作: Escape; 控件: menu; 等待: 100ms |

**断言汇总**:
- [DOM] 多余的 compositionend 不破坏键盘拦截（isComposing 幂等重置为 false）

---

## FP-15-07: 视口边界处理（5 例，[编辑交互]）

> 间接验证路径: `menu-ui.ts:222-258` 的 `reposition()` 处理底部翻转（`menu-ui.ts:243-251`）和右侧夹紧（`menu-ui.ts:254-257`）。菜单 `position:fixed`（`menu-ui.ts:101`），通过 `getBoundingClientRect()` 计算实际位置。

### FP-15-07-N01 [P1] [正常] 菜单在视口内正常定位（left/top 为合理像素值）

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 空文档
- 插件配置: demo 默认
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. `clearEditor(page)`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page) | [DOM] 编辑器清空 | 选择器: .cm-content; 操作: clear; 控件: editor; 等待: 200ms |
| 2 | typeInEditor(page, "/") | [DOM] 菜单出现，reposition 计算 left/top（`menu-ui.ts:232-234`） | 选择器: .nexus-slash-menu; 操作: type(/); 控件: menu; 等待: 300ms |
| 3 | waitForSlashMenu(page); 获取 `.nexus-slash-menu` 的 style.left 和 style.top | [DOM] left 和 top 均为有效像素值（如 "10px"），display=block | 选择器: .nexus-slash-menu; 操作: getAttribute(style); 控件: menu; 等待: 无 |
| 4 | dismissSlashMenu(page) | [DOM] 菜单关闭 | 选择器: .nexus-slash-menu; 操作: Escape; 控件: menu; 等待: 100ms |

**断言汇总**:
- [DOM] 菜单定位为有效像素值（reposition 基础定位工作）

---

### FP-15-07-N02 [P2] [正常] 菜单 position=fixed（浮动定位到 document.body）

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 空文档
- 插件配置: demo 默认
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. `clearEditor(page)`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page) | [DOM] 编辑器清空 | 选择器: .cm-content; 操作: clear; 控件: editor; 等待: 200ms |
| 2 | typeInEditor(page, "/") | [DOM] 菜单出现 | 选择器: .nexus-slash-menu; 操作: type(/); 控件: menu; 等待: 300ms |
| 3 | waitForSlashMenu(page); 获取 `.nexus-slash-menu` 的 computedStyle.position | [DOM] position === "fixed"（`menu-ui.ts:101`），且 parentNode === document.body（`menu-ui.ts:107`） | 选择器: .nexus-slash-menu; 操作: getComputedStyle + parentNode; 控件: menu; 等待: 无 |
| 4 | dismissSlashMenu(page) | [DOM] 菜单关闭 | 选择器: .nexus-slash-menu; 操作: Escape; 控件: menu; 等待: 100ms |

**断言汇总**:
- [DOM] 菜单 position=fixed 且挂载在 document.body（避免 overflow 截断）

---

### FP-15-07-N03 [P2] [正常] 窗口 resize 时菜单重新定位（onWindowResize → reposition）

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 空文档
- 插件配置: demo 默认
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. `clearEditor(page)`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page) | [DOM] 编辑器清空 | 选择器: .cm-content; 操作: clear; 控件: editor; 等待: 200ms |
| 2 | typeInEditor(page, "/") | [DOM] 菜单出现 | 选择器: .nexus-slash-menu; 操作: type(/); 控件: menu; 等待: 300ms |
| 3 | waitForSlashMenu(page); 记录菜单 top 值; page.evaluate(() => window.dispatchEvent(new Event("resize"))) | [DOM] onWindowResize 触发 reposition（`menu-ui.ts:439-442`） | 选择器: window; 操作: dispatchEvent(resize); 控件: dom-event; 等待: 300ms |
| 4 | 获取 `.nexus-slash-menu` 的 style.top | [DOM] top 值仍为有效像素（reposition 重新计算，菜单未消失） | 选择器: .nexus-slash-menu; 操作: getAttribute(style); 控件: menu; 等待: 无 |
| 5 | dismissSlashMenu(page) | [DOM] 菜单关闭 | 选择器: .nexus-slash-menu; 操作: Escape; 控件: menu; 等待: 100ms |

**断言汇总**:
- [DOM] 窗口 resize 后菜单重新定位（onWindowResize → reposition 路径）

---

### FP-15-07-N04 [P2] [正常] 菜单 max-width=320px 限制（CSS 约束）

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 空文档
- 插件配置: demo 默认（style.css:118 max-width:320px）
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. `clearEditor(page)`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page) | [DOM] 编辑器清空 | 选择器: .cm-content; 操作: clear; 控件: editor; 等待: 200ms |
| 2 | typeInEditor(page, "/") | [DOM] 菜单出现 | 选择器: .nexus-slash-menu; 操作: type(/); 控件: menu; 等待: 300ms |
| 3 | waitForSlashMenu(page); 获取 `.nexus-slash-menu` 的 getBoundingClientRect().width | [DOM] width <= 320（CSS max-width 约束，`style.css:118`） | 选择器: .nexus-slash-menu; 操作: getBoundingClientRect; 控件: menu; 等待: 无 |
| 4 | dismissSlashMenu(page) | [DOM] 菜单关闭 | 选择器: .nexus-slash-menu; 操作: Escape; 控件: menu; 等待: 100ms |

**断言汇总**:
- [DOM] 菜单宽度受 max-width:320px 约束（与右侧夹紧逻辑配合防止溢出）

---

### FP-15-07-E01 [P3] [异常] 菜单隐藏时 reposition 不执行（isMenuOpen 守卫）

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 空文档
- 插件配置: demo 默认
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. `clearEditor(page)`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page) | [DOM] 编辑器清空 | 选择器: .cm-content; 操作: clear; 控件: editor; 等待: 200ms |
| 2 | typeInEditor(page, "/") | [DOM] 菜单出现 | 选择器: .nexus-slash-menu; 操作: type(/); 控件: menu; 等待: 300ms |
| 3 | waitForSlashMenu(page); dismissSlashMenu(page) | [DOM] 菜单 dismissed | 选择器: .nexus-slash-menu; 操作: Escape; 控件: menu; 等待: 200ms |
| 4 | 记录当前 style.left; page.evaluate(() => window.dispatchEvent(new Event("resize"))) | [DOM] onWindowResize 因 isMenuOpen()=false 直接 return（`menu-ui.ts:440`），reposition 不执行 | 选择器: window; 操作: dispatchEvent(resize); 控件: dom-event; 等待: 200ms |
| 5 | 获取 `.nexus-slash-menu` 的 style.left | [DOM] left 值未变化（reposition 未重计算） | 选择器: .nexus-slash-menu; 操作: getAttribute(style); 控件: menu; 等待: 无 |

**断言汇总**:
- [DOM] 菜单隐藏时 resize 不触发 reposition（onWindowResize 的 isMenuOpen 守卫）

---

## FP-15-08: 命令历史 createSlashCommandHistory reorder/record（6 例，[插件能力][数据IO]）

> ⚠️ **Demo 未启用 history**: `editor-shell.ts:341` 调用 `createSlashMenuUI(editor)` 未传 `history` 选项，因此 demo 中 `createSlashCommandHistory(undefined)` 返回 null（`command-history.ts:48-49`），reorder/record 均不生效。
> - FP-15-08-N01/N02: 验证 demo 中历史未启用 → 命令顺序不随使用频次改变（通过 e2e）
> - FP-15-08-N03/N04/N05/N06/E01: 标注"仅通过 createSlashCommandHistory 单元行为间接验证"，e2e 层无法直接触发（需修改 demo 传入 history 配置）

### FP-15-08-N01 [P1] [正常] Demo 默认未启用历史 → 多次使用 Bold 后空 query 菜单顺序不变

**前置条件**:
- 依赖环境: Electron demo 已启动（createSlashMenuUI 未传 history）
- 初始文档: 空文档
- 插件配置: demo 默认（history 未启用）
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. `clearEditor(page)`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page) | [DOM] 编辑器清空 | 选择器: .cm-content; 操作: clear; 控件: editor; 等待: 200ms |
| 2 | typeInEditor(page, "/bold"); waitForSlashMenu(page); page.keyboard.press("Enter") | [DOM] 执行 Bold 命令一次（record 未启用，无副作用） | 选择器: .nexus-slash-menu; 操作: type(/bold)+Enter; 控件: menu; 等待: 400ms |
| 3 | clearEditor(page); typeInEditor(page, "/"); waitForSlashMenu(page); getVisibleMenuItemIds(page) 记录顺序 | [DOM] 获取当前菜单顺序（空 query） | 选择器: .nexus-slash-menu__item; 操作: dataset.slashCommandId; 控件: menu-item; 等待: 无 |
| 4 | dismissSlashMenu(page) | [DOM] 菜单关闭 | 选择器: .nexus-slash-menu; 操作: Escape; 控件: menu; 等待: 100ms |

**断言汇总**:
- [DOM] 多次使用 Bold 后，空 query 菜单顺序仍为注册顺序（h1,h2,h3,...），bold 未前置（证明 demo 未启用 history，reorder 未生效）

---

### FP-15-08-N02 [P1] [正常] Demo 默认未启用历史 → 重复使用 Heading 1 后顺序保持注册序

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 空文档
- 插件配置: demo 默认（history 未启用）
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. `clearEditor(page)`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page) | [DOM] 编辑器清空 | 选择器: .cm-content; 操作: clear; 控件: editor; 等待: 200ms |
| 2 | typeInEditor(page, "/h1"); waitForSlashMenu(page); page.keyboard.press("Enter") | [DOM] 执行 Heading 1 命令 | 选择器: .nexus-slash-menu; 操作: type(/h1)+Enter; 控件: menu; 等待: 400ms |
| 3 | clearEditor(page); typeInEditor(page, "/h1"); waitForSlashMenu(page); page.keyboard.press("Enter") | [DOM] 再次执行 Heading 1（模拟多次使用） | 选择器: .nexus-slash-menu; 操作: type(/h1)+Enter; 控件: menu; 等待: 400ms |
| 4 | clearEditor(page); typeInEditor(page, "/"); waitForSlashMenu(page); getVisibleMenuItemIds(page) | [DOM] 获取顺序，第一项仍为 "h1"（注册序首位），不是因为历史前置而是注册序本就首位 | 选择器: .nexus-slash-menu__item; 操作: dataset.slashCommandId; 控件: menu-item; 等待: 无 |
| 5 | dismissSlashMenu(page) | [DOM] 菜单关闭 | 选择器: .nexus-slash-menu; 操作: Escape; 控件: menu; 等待: 100ms |

**断言汇总**:
- [DOM] 多次使用 h1 后顺序不变（demo 未启用 history，无 reorder 行为）

---

### FP-15-08-N03 [P2] [正常] 【仅单元间接验证】reorder 空 query 时前置最近使用的命令

> ⚠️ 此用例验证 createSlashCommandHistory 的 reorder 逻辑（`command-history.ts:84-106`）。e2e 层 demo 未启用 history，无法直接触发。以下为理论预期，需在 demo 传入 `{history:true}` 配置后才能 e2e 验证。

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 空文档
- 插件配置: **假设 demo 传入 `{history:{storage:sessionStorage}}` 启用历史**（实际 demo 未启用，标注待确认）
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. `clearEditor(page)`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page) | [DOM] 编辑器清空 | 选择器: .cm-content; 操作: clear; 控件: editor; 等待: 200ms |
| 2 | typeInEditor(page, "/bold"); waitForSlashMenu(page); page.keyboard.press("Enter") | [DOM] 执行 Bold，record("bold") 写入历史（`command-history.ts:108-117`） | 选择器: .nexus-slash-menu; 操作: type(/bold)+Enter; 控件: menu; 等待: 400ms |
| 3 | clearEditor(page); typeInEditor(page, "/"); waitForSlashMenu(page); getVisibleMenuItemIds(page) | [DOM] 【若 history 启用】返回列表第一项 === "bold"（reorder 空 query 前置最近命令，`command-history.ts:96-105`）；【demo 实际】第一项仍为 "h1"（未启用） | 选择器: .nexus-slash-menu__item; 操作: dataset.slashCommandId; 控件: menu-item; 等待: 无 |
| 4 | dismissSlashMenu(page) | [DOM] 菜单关闭 | 选择器: .nexus-slash-menu; 操作: Escape; 控件: menu; 等待: 100ms |

**断言汇总**:
- [DOM] 【待确认】若 history 启用，bold 应前置到第一项（reorder 空 query 路径）
- 注: demo 默认未启用，此用例需修改 demo 配置才能验证

---

### FP-15-08-N04 [P2] [正常] 【仅单元间接验证】reorder 非空 query 时保持原顺序（不重排）

> ⚠️ 此用例验证 createSlashCommandHistory 的 reorder 逻辑（`command-history.ts:85` query !== "" 时直接返回 commands）。

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 空文档
- 插件配置: 假设 demo 启用 history
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. `clearEditor(page)`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page) | [DOM] 编辑器清空 | 选择器: .cm-content; 操作: clear; 控件: editor; 等待: 200ms |
| 2 | typeInEditor(page, "/bold"); waitForSlashMenu(page); page.keyboard.press("Enter") | [DOM] 执行 Bold，record 写入历史 | 选择器: .nexus-slash-menu; 操作: type(/bold)+Enter; 控件: menu; 等待: 400ms |
| 3 | clearEditor(page); typeInEditor(page, "/h"); waitForSlashMenu(page); getVisibleMenuItemIds(page) | [DOM] query="h" 非空，reorder 直接返回 commands（`command-history.ts:85`），顺序由 filterSlashCommands 决定（h1/h2/h3 前缀匹配），bold 不前置 | 选择器: .nexus-slash-menu__item; 操作: dataset.slashCommandId; 控件: menu-item; 等待: 无 |
| 4 | dismissSlashMenu(page) | [DOM] 菜单关闭 | 选择器: .nexus-slash-menu; 操作: Escape; 控件: menu; 等待: 100ms |

**断言汇总**:
- [DOM] 非空 query 时命令顺序由 filterSlashCommands 决定，历史不干预（reorder 的 query 守卫）

---

### FP-15-08-N05 [P2] [正常] 【仅单元间接验证】record 去重（同一命令多次使用只记一次）

> ⚠️ 此用例验证 createSlashCommandHistory 的 record 去重逻辑（`command-history.ts:112` filter 移除旧条目）。

**前置条件**:
- 依赖环境: Electron demo 已启动
- 初始文档: 空文档
- 插件配置: 假设 demo 启用 history
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. `clearEditor(page)`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page) | [DOM] 编辑器清空 | 选择器: .cm-content; 操作: clear; 控件: editor; 等待: 200ms |
| 2 | typeInEditor(page, "/bold"); waitForSlashMenu(page); page.keyboard.press("Enter") | [DOM] 第一次执行 Bold，record("bold") | 选择器: .nexus-slash-menu; 操作: type(/bold)+Enter; 控件: menu; 等待: 400ms |
| 3 | clearEditor(page); typeInEditor(page, "/italic"); waitForSlashMenu(page); page.keyboard.press("Enter") | [DOM] 执行 Italic，record("italic") | 选择器: .nexus-slash-menu; 操作: type(/italic)+Enter; 控件: menu; 等待: 400ms |
| 4 | clearEditor(page); typeInEditor(page, "/bold"); waitForSlashMenu(page); page.keyboard.press("Enter") | [DOM] 第二次执行 Bold，record("bold") 去重后 bold 移到首位（`command-history.ts:112`） | 选择器: .nexus-slash-menu; 操作: type(/bold)+Enter; 控件: menu; 等待: 400ms |
| 5 | clearEditor(page); typeInEditor(page, "/"); waitForSlashMenu(page); getVisibleMenuItemIds(page) | [DOM] 【若 history 启用】第一项 === "bold"，第二项 === "italic"（去重后顺序: bold 最近） | 选择器: .nexus-slash-menu__item; 操作: dataset.slashCommandId; 控件: menu-item; 等待: 无 |
| 6 | dismissSlashMenu(page) | [DOM] 菜单关闭 | 选择器: .nexus-slash-menu; 操作: Escape; 控件: menu; 等待: 100ms |

**断言汇总**:
- [DOM] 【待确认】同一命令多次使用后去重，最近使用的排最前（record 去重 + 前置）

---

### FP-15-08-E01 [P3] [异常] 【仅单元间接验证】createSlashCommandHistory(undefined) 返回 null（未启用时 reorder/record 为 no-op）

> ⚠️ 此用例验证 demo 默认行为: `createSlashMenuUI(editor)` 未传 history → `createSlashCommandHistory(undefined)` 返回 null（`command-history.ts:48-49`），menu-ui 中 `commandHistory?.reorder()` 和 `commandHistory?.record()` 均为 no-op（`menu-ui.ts:262-264` + `314`）。

**前置条件**:
- 依赖环境: Electron demo 已启动（history 未启用）
- 初始文档: 空文档
- 插件配置: demo 默认
- 未达成时的创建过程:
  1. `launchDemo()` 启动
  2. `clearEditor(page)`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | clearEditor(page) | [DOM] 编辑器清空 | 选择器: .cm-content; 操作: clear; 控件: editor; 等待: 200ms |
| 2 | typeInEditor(page, "/"); waitForSlashMenu(page); getVisibleMenuItemIds(page) 记录初始顺序 | [DOM] 获取空 query 菜单顺序（注册序: h1,h2,h3,...） | 选择器: .nexus-slash-menu__item; 操作: dataset.slashCommandId; 控件: menu-item; 等待: 无 |
| 3 | dismissSlashMenu(page); clearEditor(page); typeInEditor(page, "/bold"); waitForSlashMenu(page); page.keyboard.press("Enter") | [DOM] 执行 Bold（record 为 no-op，因 commandHistory=null） | 选择器: .nexus-slash-menu; 操作: type(/bold)+Enter; 控件: menu; 等待: 400ms |
| 4 | clearEditor(page); typeInEditor(page, "/"); waitForSlashMenu(page); getVisibleMenuItemIds(page) | [DOM] 顺序与步骤 2 完全相同（bold 未前置，证明 record 未写入） | 选择器: .nexus-slash-menu__item; 操作: dataset.slashCommandId; 控件: menu-item; 等待: 无 |
| 5 | dismissSlashMenu(page) | [DOM] 菜单关闭 | 选择器: .nexus-slash-menu; 操作: Escape; 控件: menu; 等待: 100ms |

**断言汇总**:
- [DOM] 使用命令前后菜单顺序一致（demo 未启用 history，createSlashCommandHistory 返回 null，record/reorder 为 no-op）

---

## 用例合计

| 二级功能点 | 用例数 | P1 | P2 | P3 | 正常(N) | 异常(E) |
|-----------|--------|----|----|----|---------|---------|
| FP-15-01 createSlashPlugin 工厂与 SlashCommandDef 定义 | 6 | 4 | 2 | 0 | 5 | 1 |
| FP-15-02 getSlashState 状态计算 | 6 | 2 | 2 | 2 | 4 | 2 |
| FP-15-03 filterSlashCommands 过滤+排序 | 6 | 2 | 3 | 1 | 5 | 1 |
| FP-15-04 菜单 UI 键盘交互 | 8 | 7 | 0 | 1 | 7 | 1 |
| FP-15-05 菜单 UI 鼠标交互 | 5 | 3 | 1 | 1 | 4 | 1 |
| FP-15-06 IME composition 禁用键盘拦截 | 5 | 2 | 2 | 1 | 4 | 1 |
| FP-15-07 视口边界处理 | 5 | 1 | 3 | 1 | 4 | 1 |
| FP-15-08 命令历史 reorder/record | 6 | 2 | 3 | 1 | 5 | 1 |
| **合计** | **47** | **23** | **16** | **8** | **38** | **9** |

### 类型分布

| 类型 | 数量 | 占比 |
|------|------|------|
| 正常(N) | 38 | 80.9% |
| 异常(E) | 9 | 19.1% |

### 优先级分布

| 优先级 | 数量 | 占比 |
|--------|------|------|
| P1 | 23 | 48.9% |
| P2 | 16 | 34.0% |
| P3 | 8 | 17.0% |

### FP-15 编号分配表

| 二级功能点编号 | 二级功能点描述 | 用例数 | 用例编号范围 |
|---------------|---------------|--------|-------------|
| FP-15-01 | createSlashPlugin 工厂与 SlashCommandDef 定义 | 6 | FP-15-01-N01~N05, E01 |
| FP-15-02 | getSlashState 状态计算 | 6 | FP-15-02-N01~N04, E01~E02 |
| FP-15-03 | filterSlashCommands 过滤+排序 | 6 | FP-15-03-N01~N05, E01 |
| FP-15-04 | 菜单 UI 键盘交互 | 8 | FP-15-04-N01~N07, E01 |
| FP-15-05 | 菜单 UI 鼠标交互 | 5 | FP-15-05-N01~N04, E01 |
| FP-15-06 | IME composition 禁用键盘拦截 | 5 | FP-15-06-N01~N04, E01 |
| FP-15-07 | 视口边界处理 | 5 | FP-15-07-N01~N04, E01 |
| FP-15-08 | 命令历史 reorder/record | 6 | FP-15-08-N01~N05, E01 |

### 未覆盖功能点

无。所有 8 个二级功能点均已覆盖。

### 关键陷阱提示

| # | 陷阱内容 | 来源 | 涉及用例 |
|---|---------|------|---------|
| 1 | demo 中斜杠菜单由 `createSlashMenuUI(editor)` 创建，**未传 history 选项**，因此 FP-15-08 命令历史在 demo 中不生效 | `editor-shell.ts:341` + `command-history.ts:48-49` | FP-15-08-N03~N05,E01 |
| 2 | 菜单高亮类名是 **`is-active`**（不是 `active`/`selected`） | `menu-ui.ts:138` | FP-15-04-*, FP-15-05-* |
| 3 | dismissed 锁存状态: Escape 后需重新输入 `/` 才能再次打开菜单（closed→open 转换才重置 latch） | `menu-ui.ts:123,330-333` | 所有用例间需 dismissSlashMenu |
| 4 | 非行首 `/`（如 `text/`）不触发菜单（`/` 前必须为空白或行首） | `slash-state.ts:50-51` | FP-15-02-E01 |
| 5 | `/` 后输入空格导致 query 含空白 → 菜单关闭 | `slash-state.ts:56` | FP-15-02-E02 |
| 6 | 确认命令时先删除 `/query` 触发文本（setSelection+replaceSelection("")），再调 cmd.run | `menu-ui.ts:294-297` | FP-15-01-N05, FP-15-04-N05~N06, FP-15-05-N02 |
| 7 | 默认 limit=8，14 条命令在空 query 时被截断到 8 条 | `slash-state.ts:26,169` | FP-15-01-N02, FP-15-03-N04 |
| 8 | demo 有 14 条斜杠命令（h1/h2/h3/bold/italic/strikethrough/inline-code/code-block/blockquote/ulist/olist/link/image/hr），hr 的 title 为 "Divider" | `plugin-toolbar/src/index.ts:118-217` | FP-15-01-*, FP-15-03-* |
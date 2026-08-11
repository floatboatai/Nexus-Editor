# CASE-DemoUI布局-测试用例（FP-20）

> 一级功能点: Demo UI 布局（demo-requirements.md §11）
> 全局批次序号: 20
> 生成时间: 2026-08-11
> 测试框架: Playwright（Electron demo e2e）
> 覆盖二级功能点: FP-20-01 ~ FP-20-05（共 5 个）
> 用例总数: 32
>
> 涉及二级功能点:
> - FP-20-01 顶部工具栏（Vault/Open/Save/SaveAs + 📑☰🔗🔍⚙ 面板切换）（[一致性][编辑交互]）
> - FP-20-02 Vault 面板（左侧文件树）（[一致性][数据IO]）
> - FP-20-03 Outline 大纲面板（自动提取标题）（[一致性][AST解析]）
> - FP-20-04 Backlinks 反向链接面板（依赖 LinkIndex）（[一致性][AST解析]）
> - FP-20-05 状态栏（字数统计 + 文件状态 modified 标记）（[一致性]）
>
> ⚠️ 实现说明（依据 `apps/electron-demo/src/renderer/` 实际代码）:
> - **顶部工具栏**（`app.ts:24-93`）: `createAppToolbar()` 创建 `.toolbar` div，按顺序 append 9 个 button:
>   - Vault（textContent="Vault"，title="Open a folder as a vault"，click → `vault.promptPickVault()`）
>   - Open（textContent="Open"，click → `handleOpen()`）
>   - Save（textContent="Save"，click → `handleSave()`）
>   - Save As（textContent="Save As"，click → `handleSaveAs()`）
>   - spacer div（`style.flex="1"`，将功能按钮与面板切换按钮分隔）
>   - 📑（textContent="\uD83D\uDCD1"，title="Toggle vault panel"，click → `toggleVault()`）
>   - ☰（textContent="\u2630"，title="Toggle outline"，click → `toggleOutline()`）
>   - 🔗（textContent="\uD83D\uDD17"，title="Toggle backlinks panel"，click → `toggleBacklinks()`）
>   - 🔍（textContent="\uD83D\uDD0D"，title="Search (Ctrl+F)"，click → `searchBar.open()`）
>   - ⚙（textContent="\u2699"，title="Settings"，click → `handleSettings()`）
>   - 定位策略: `.toolbar button` 按 textContent 过滤；图标按钮无 data 属性，依赖 textContent 或 title
> - **面板布局**（`app.ts:343-411`）: `boot()` 中 `mainArea`（`.main-area`）按顺序 append:
>   - `vault.element`（`.nexus-vault-panel`，width 240px）
>   - `editorColumn`（`.editor-column`，含 searchBar.element + editorContainer）
>   - `outline.element`（`.nexus-outline-panel`，width 220px）
>   - `backlinks.element`（`<aside class="backlinks-panel">`，width 280px）
> - **面板切换逻辑**（`app.ts:184-203`）: `togglePanel(panel, onShow)` — `display==="none"` 时设为 `""`（显示）并调用 onShow 回调；否则设为 `"none"`（隐藏）。
>   - Vault 面板初始可见（无 display:none 设置）
>   - Outline 面板初始可见，toggle 时调用 `outline.update()`
>   - Backlinks 面板初始可见，toggle 时调用 `backlinks.refresh()`
>   - Search bar 初始 `display:none`（`search-bar.ts:13`），🔍 按钮调用 `searchBar.open()` 设为 `display:"flex"`（不是 toggle）
> - **Vault 面板**（`vault-panel.ts`）:
>   - className: `nexus-vault-panel`
>   - header 含: title（textContent="Vault"，openVault 后改为 vault 目录名）、newFileBtn（textContent="+"，title="New file at root"）、newFolderBtn（textContent="\uD83D\uDCC2"，title="New folder at root"）、openBtn（textContent="\uD83D\uDCC1"，title="Open vault…"）
>   - 无 vault 时空状态: "No vault opened. Click 📁 to choose a folder."
>   - vault 为空时: "Vault is empty. Click + to create a note."
>   - 文件行: `div[data-path][data-kind]`，kind="file"|"directory"
>   - 目录图标: ▾（展开）/ ▸（折叠）；文件图标: ·（middle dot）
>   - 激活文件高亮: ACTIVE_STYLES（蓝色背景）
> - **Outline 面板**（`outline-panel.ts`）:
>   - className: `nexus-outline-panel`
>   - header textContent: "Outline"
>   - 空状态: "No headings"（italic，class 无特殊标识，通过 textContent 定位）
>   - 标题项: `<button type="button">`，textContent 为标题文本，title 同 textContent
>   - 缩进: `paddingLeft = 14 + (level-1)*14` px
>   - level≤2: fontWeight 600；level=1: fontSize 14px
>   - click → `editor.setSelection(entry.from)` + `editor.focus()`
>   - 监听 `editor.on("change", update)` 实时更新
> - **Backlinks 面板**（`backlinks-panel.ts`）:
>   - 根元素: `<aside class="backlinks-panel">`
>   - header textContent: "Backlinks" → refresh 后 "Backlinks · X linked · … mentions" → 异步完成后 "Backlinks · X linked · Y mention(s)"
>   - 无 active file: header="Backlinks"，列表区显示 "No active file"
>   - "Linked mentions" section: header 含 label + badge（计数），空时显示 "No linked mentions"
>   - "Unlinked mentions" section: 异步扫描（requestIdleCallback），初始 "Unlinked mentions — scanning…"，完成后显示计数
>   - 每个 hit 渲染为 `<button>`，含 title div（basename）+ snippet div
>   - click → `onOpenFile(hit.sourcePath)`
> - **状态栏**（`app.ts:95-115`）:
>   - `#status-line`（`.status-line`），textContent 格式: `{pathLabel}{dirtyMark}{statsText}{vaultLabel}{errorText}`
>   - pathLabel = `state.activeFile ?? state.filePath ?? "Untitled"`
>   - dirtyMark = `state.dirty ? " [modified]" : ""`
>   - statsText = ` | ${stats.words} words, ${stats.lines} lines`（来自 `shell.editor.getDocumentStats()`）
>   - vaultLabel = ` | Vault: ${vaultName}`（state.vaultPath 存在时）
>   - errorText = ` — Error: ${state.error}`（state.error 存在时）
> - **字数统计浮动栏**（`packages/plugin-wordcount/src/status-bar.ts`，挂载在 editorContainer 内）:
>   - `.nexus-wordcount__bar`（role="status"，aria-live="polite"，data-testid="nexus-wordcount-bar"）
>   - 子 span: `.nexus-wordcount__words`（"{N} words"）、`.nexus-wordcount__characters`（"{N} chars"）、`.nexus-wordcount__reading-time`、`.nexus-wordcount__selection`（默认 hidden）
>   - demo 中 classPrefix="nexus-wordcount"（`editor-shell.ts:119`）
> - **e2e 验证约束**: demo 未暴露 editor / vault / outline / backlinks 实例到 `window`，所有验证通过 UI DOM 副作用间接推断。面板显隐通过 `display` style 判断。
> - **防抖影响**: Outline 更新同步（editor.on("change")）；Backlinks 的 unlinked mentions 异步扫描（requestIdleCallback timeout 250ms）；字数统计文档更新有 150ms 防抖。
> - 全局 setup 使用 `launchDemo()` 启动 Electron demo。

---

## e2e 全局前置条件

- 依赖环境: Electron demo（Vite dev server localhost:5173 + 已构建的 `apps/electron-demo/dist-electron/main.js`）
- 初始文档: demo 启动后默认状态（可能恢复上次 vault 文档或空文档）
- 面板初始状态: Vault / Outline / Backlinks 面板默认可见（无 display:none）；Search bar 默认隐藏
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

// 辅助：清空编辑器
async function clearEditor(page: Page) {
  await page.click(".cm-content");
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
}

// 辅助：键盘输入
async function typeInEditor(page: Page, text: string) {
  await page.click(".cm-content");
  await page.keyboard.type(text);
}

// 辅助：通过 execCommand 插入文本（含换行的多行文本兼容性更好）
async function insertText(page: Page, text: string) {
  await page.click(".cm-content");
  await page.evaluate((t) => document.execCommand("insertText", false, t), text);
}

// 辅助：等待防抖
async function waitForDebounce(page: Page, ms = 250) {
  await page.waitForTimeout(ms);
}

// 辅助：通过 textContent 定位工具栏按钮
async function getToolbarButton(page: Page, text: string): Promise<string | null> {
  return page.evaluate((t) => {
    const btns = document.querySelectorAll(".toolbar button");
    for (const b of btns) {
      if (b.textContent === t) return "found";
    }
    return null;
  }, text);
}

// 辅助：获取面板 display 状态
async function getPanelDisplay(page: Page, selector: string): Promise<string> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement;
    return el ? el.style.display : "not-found";
  }, selector);
}

// 辅助：获取状态栏文本
async function getStatusText(page: Page): Promise<string> {
  return page.locator("#status-line").textContent() ?? "";
}
```

---

## FP-20-01 顶部工具栏（Vault/Open/Save/SaveAs + 📑☰🔗🔍⚙ 面板切换）

### FP-20-01-N01 [P1] [正常] 验证工具栏包含全部 9 个按钮

**前置条件**:
- 依赖数据: 无特殊数据依赖
- 系统状态: demo 已启动，`.cm-content` 可见
- 角色权限: 无需登录
- 未达成时的创建过程: 调用 `launchDemo()` 启动 demo

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 读取 `.toolbar` 下所有 button 的 textContent | [UI] 包含 "Vault"、"Open"、"Save"、"Save As" 四个文本按钮 | 选择器: `.toolbar button`; 操作: `evaluate` 读取 textContent; 控件: button; 等待: 无 |
| 2 | 读取 `.toolbar` 下所有 button 的 textContent，检查图标按钮 | [UI] 包含 "📑"(\uD83D\uDCD1)、"☰"(\u2630)、"🔗"(\uD83D\uDD17)、"🔍"(\uD83D\uDD0D)、"⚙"(\u2699) 五个图标按钮 | 选择器: `.toolbar button`; 操作: `evaluate` 读取 textContent; 控件: button; 等待: 无 |
| 3 | 统计 `.toolbar button` 总数 | [UI] 共 9 个 button 元素 | 选择器: `.toolbar button`; 操作: `count()`; 控件: button; 等待: 无 |

**断言汇总**:
- [UI] 工具栏包含 Vault/Open/Save/SaveAs 四个文本按钮
- [UI] 工具栏包含 📑/☰/🔗/🔍/⚙ 五个图标按钮
- [UI] 按钮总数为 9

---

### FP-20-01-N02 [P2] [正常] 点击 📑 按钮切换 Vault 面板显隐

**前置条件**:
- 依赖数据: 无特殊数据依赖
- 系统状态: demo 已启动，Vault 面板默认可见（display 非 "none"）
- 角色权限: 无需登录
- 未达成时的创建过程: 调用 `launchDemo()` 启动 demo

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 读取 `.nexus-vault-panel` 的 display 样式 | [UI] 初始 display 不为 "none"（面板可见） | 选择器: `.nexus-vault-panel`; 操作: `evaluate` 读取 style.display; 控件: div; 等待: 无 |
| 2 | 点击 textContent 为 "📑" 的按钮 | [UI] Vault 面板 display 变为 "none"（隐藏） | 选择器: `.toolbar button`; 操作: `evaluate` 过滤 textContent==="📑" 后 click; 控件: button; 等待: 100ms |
| 3 | 再次点击 textContent 为 "📑" 的按钮 | [UI] Vault 面板 display 恢复为非 "none"（显示） | 选择器: `.toolbar button`; 操作: 同上 click; 控件: button; 等待: 100ms |

**断言汇总**:
- [UI] 📑 按钮点击后 Vault 面板在显示/隐藏间切换
- [UI] 切换为 toggle 行为（奇数次隐藏，偶数次显示）

---

### FP-20-01-N03 [P2] [正常] 点击 ☰ 按钮切换 Outline 面板显隐

**前置条件**:
- 依赖数据: 无特殊数据依赖
- 系统状态: demo 已启动，Outline 面板默认可见
- 角色权限: 无需登录
- 未达成时的创建过程: 调用 `launchDemo()` 启动 demo

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 读取 `.nexus-outline-panel` 的 display 样式 | [UI] 初始 display 不为 "none" | 选择器: `.nexus-outline-panel`; 操作: `evaluate` 读取 style.display; 控件: div; 等待: 无 |
| 2 | 点击 textContent 为 "☰" 的按钮 | [UI] Outline 面板 display 变为 "none" | 选择器: `.toolbar button`; 操作: `evaluate` 过滤 textContent==="☰" 后 click; 控件: button; 等待: 100ms |
| 3 | 再次点击 textContent 为 "☰" 的按钮 | [UI] Outline 面板恢复显示（display 非 "none"） | 选择器: `.toolbar button`; 操作: 同上 click; 控件: button; 等待: 100ms |

**断言汇总**:
- [UI] ☰ 按钮切换 Outline 面板显隐
- [UI] 面板恢复显示时触发 `outline.update()` 回调（标题列表刷新）

---

### FP-20-01-N04 [P2] [正常] 点击 🔗 按钮切换 Backlinks 面板显隐

**前置条件**:
- 依赖数据: 无特殊数据依赖
- 系统状态: demo 已启动，Backlinks 面板默认可见
- 角色权限: 无需登录
- 未达成时的创建过程: 调用 `launchDemo()` 启动 demo

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 读取 `.backlinks-panel` 的 display 样式 | [UI] 初始 display 不为 "none" | 选择器: `.backlinks-panel`; 操作: `evaluate` 读取 style.display; 控件: aside; 等待: 无 |
| 2 | 点击 textContent 为 "🔗" 的按钮 | [UI] Backlinks 面板 display 变为 "none" | 选择器: `.toolbar button`; 操作: `evaluate` 过滤 textContent==="🔗" 后 click; 控件: button; 等待: 100ms |
| 3 | 再次点击 textContent 为 "🔗" 的按钮 | [UI] Backlinks 面板恢复显示（display 非 "none"），且触发 `backlinks.refresh()` | 选择器: `.toolbar button`; 操作: 同上 click; 控件: button; 等待: 100ms |

**断言汇总**:
- [UI] 🔗 按钮切换 Backlinks 面板显隐
- [UI] 面板恢复显示时刷新反链内容

---

### FP-20-01-N05 [P2] [正常] 点击 🔍 按钮打开搜索栏

**前置条件**:
- 依赖数据: 无特殊数据依赖
- 系统状态: demo 已启动，搜索栏默认隐藏（display:none）
- 角色权限: 无需登录
- 未达成时的创建过程: 调用 `launchDemo()` 启动 demo

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 读取 `.nexus-search-bar` 的 display 样式 | [UI] 初始 display 为 "none" | 选择器: `.nexus-search-bar`; 操作: `evaluate` 读取 style.display; 控件: div; 等待: 无 |
| 2 | 点击 textContent 为 "🔍" 的按钮 | [UI] 搜索栏 display 变为 "flex"（可见） | 选择器: `.toolbar button`; 操作: `evaluate` 过滤 textContent==="🔍" 后 click; 控件: button; 等待: 100ms |
| 3 | 检查搜索栏内 placeholder="Find..." 的 input 是否可见 | [UI] 搜索输入框可见且获得焦点 | 选择器: `.nexus-search-bar input[placeholder="Find..."]`; 操作: `isVisible()` + `evaluate` 检查 `document.activeElement`; 控件: input; 等待: 100ms |

**断言汇总**:
- [UI] 🔍 按钮调用 `searchBar.open()`，搜索栏从隐藏变为显示
- [UI] 搜索栏 display 从 "none" 变为 "flex"
- [UI] Find 输入框获得焦点

---

### FP-20-01-N06 [P2] [正常] 点击 ⚙ 按钮打开设置面板

**前置条件**:
- 依赖数据: 无特殊数据依赖
- 系统状态: demo 已启动
- 角色权限: 无需登录
- 未达成时的创建过程: 调用 `launchDemo()` 启动 demo

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 点击 textContent 为 "⚙" 的按钮 | [UI] 触发 `createSettingsPanel()`，设置面板 DOM 出现在页面中 | 选择器: `.toolbar button`; 操作: `evaluate` 过滤 textContent==="⚙" 后 click; 控件: button; 等待: 200ms |
| 2 | 检查设置面板相关元素是否出现在 DOM 中 | [UI] 页面中出现设置面板容器（可能为 overlay/modal 形式，含设置选项） | 选择器: `body`; 操作: `evaluate` 搜索设置相关 DOM; 控件: div; 等待: 200ms |

**断言汇总**:
- [UI] ⚙ 按钮点击后设置面板出现在 DOM 中

---

### FP-20-01-N07 [P1] [正常] 点击 Vault 按钮触发 vault 选择

**前置条件**:
- 依赖数据: 无特殊数据依赖
- 系统状态: demo 已启动
- 角色权限: 无需登录
- 未达成时的创建过程: 调用 `launchDemo()` 启动 demo

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 点击 textContent 为 "Vault" 的按钮 | [UI] 触发 `vault.promptPickVault()`，调用 IPC `window.nexusDemo.vault.pick()` | 选择器: `.toolbar button`; 操作: `evaluate` 过滤 textContent==="Vault" 后 click; 控件: button; 等待: 200ms |
| 2 | 验证 Vault 按钮的 title 属性 | [UI] title 为 "Open a folder as a vault" | 选择器: `.toolbar button`; 操作: `evaluate` 读取 title; 控件: button; 等待: 无 |

**断言汇总**:
- [UI] Vault 按钮触发 vault 选择流程
- [UI] Vault 按钮 title 为 "Open a folder as a vault"

---

### FP-20-01-I01 [P4] [一致性] 验证工具栏按钮布局顺序和 spacer 分隔

**前置条件**:
- 依赖数据: 无特殊数据依赖
- 系统状态: demo 已启动
- 角色权限: 无需登录
- 未达成时的创建过程: 调用 `launchDemo()` 启动 demo

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 读取 `.toolbar` 所有子元素，记录 button textContent 顺序 | [UI] 按钮顺序为: Vault → Open → Save → Save As → [spacer div] → 📑 → ☰ → 🔗 → 🔍 → ⚙ | 选择器: `.toolbar`; 操作: `evaluate` 读取 children 及 textContent; 控件: div; 等待: 无 |
| 2 | 验证 spacer 元素存在且 style.flex 为 "1" | [UI] Save As 和 📑 之间存在 spacer div，style.flex="1" | 选择器: `.toolbar > div[style*="flex"]`; 操作: `evaluate` 读取 style; 控件: div; 等待: 无 |

**断言汇总**:
- [UI] 功能按钮（Vault/Open/Save/SaveAs）在左侧，面板切换按钮（📑☰🔗🔍⚙）在右侧
- [UI] 两组之间由 flex:1 spacer 分隔

---

## FP-20-02 Vault 面板（左侧文件树）

### FP-20-02-N01 [P1] [正常] 验证 Vault 面板 DOM 结构（标题 + 工具按钮）

**前置条件**:
- 依赖数据: 无特殊数据依赖
- 系统状态: demo 已启动，Vault 面板默认可见
- 角色权限: 无需登录
- 未达成时的创建过程: 调用 `launchDemo()` 启动 demo

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 读取 `.nexus-vault-panel` header 区域 | [UI] 包含 title（textContent 初始为 "Vault"）、+ 按钮（title="New file at root"）、📂 按钮（title="New folder at root"）、📁 按钮（title="Open vault…"） | 选择器: `.nexus-vault-panel`; 操作: `evaluate` 读取子元素; 控件: div; 等待: 无 |
| 2 | 验证 📁 按钮 textContent | [UI] openBtn textContent 为 "📁"（\uD83D\uDCC1） | 选择器: `.nexus-vault-panel button[title="Open vault…"]`; 操作: `evaluate` 读取 textContent; 控件: button; 等待: 无 |
| 3 | 验证 + 按钮初始 disabled 状态 | [UI] 未打开 vault 时 newFileBtn.disabled 为 true，opacity 为 "0.4" | 选择器: `.nexus-vault-panel button[title="New file at root"]`; 操作: `evaluate` 读取 disabled 和 style.opacity; 控件: button; 等待: 无 |

**断言汇总**:
- [UI] Vault 面板包含标题、新建文件、新建文件夹、打开 vault 四个 header 元素
- [UI] 未打开 vault 时 + 和 📂 按钮 disabled

---

### FP-20-02-N02 [P2] [正常] 打开 vault 后文件树正确渲染

**前置条件**:
- 依赖数据: 已创建测试 vault 目录，含至少 1 个 .md 文件和 1 个子目录
- 系统状态: demo 已启动
- 角色权限: 无需登录
- 未达成时的创建过程:
  1. 创建临时 vault 目录（路径: `os.tmpdir() + "/nexus-test-vault-{timestamp}"`）
  2. 在 vault 根创建 `note1.md`（内容: "# Note 1"）
  3. 在 vault 创建子目录 `subdir/`，内含 `note2.md`（内容: "# Note 2"）

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 通过 IPC 模拟打开 vault（或直接 evaluate 调用 `window.nexusDemo.vault` 相关 API 设置 vaultPath） | [UI] Vault 面板 title 变为 vault 目录名 | 选择器: `.nexus-vault-panel`; 操作: `evaluate` 注入 vault 路径; 控件: div; 等待: 500ms |
| 2 | 读取文件树容器中所有 `[data-path]` 行 | [UI] 文件树显示 note1.md 和 subdir 目录节点 | 选择器: `.nexus-vault-panel [data-path]`; 操作: `evaluate` 读取 data-path 和 data-kind; 控件: div; 等待: 300ms |
| 3 | 验证目录节点 data-kind="directory"，文件节点 data-kind="file" | [UI] 目录节点图标为 ▾（展开默认），文件节点图标为 · | 选择器: `.nexus-vault-panel [data-kind]`; 操作: `evaluate` 读取 data-kind 和子元素 span textContent; 控件: div; 等待: 无 |

**断言汇总**:
- [UI] vault 打开后 title 更新为目录名
- [UI] 文件树渲染 vault 内的文件和目录
- [UI] 目录默认展开（图标 ▾），子文件可见

---

### FP-20-02-N03 [P2] [正常] 点击目录节点展开/折叠

**前置条件**:
- 依赖数据: 已打开 vault，含至少 1 个子目录（内有文件）
- 系统状态: vault 面板显示文件树，目录默认展开
- 角色权限: 无需登录
- 未达成时的创建过程:
  1. 创建临时 vault 目录
  2. 创建子目录 `subdir/`，内含 `child.md`
  3. 通过 IPC 打开 vault

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 点击 data-kind="directory" 的目录行 | [UI] 目录折叠，图标从 ▾ 变为 ▸，子节点消失 | 选择器: `.nexus-vault-panel [data-kind="directory"]`; 操作: `click()`; 控件: div; 等待: 200ms |
| 2 | 读取文件树，确认子文件不再可见 | [UI] 子目录内的文件节点不在 DOM 中 | 选择器: `.nexus-vault-panel [data-path]`; 操作: `evaluate` 检查子文件 data-path 是否存在; 控件: div; 等待: 无 |
| 3 | 再次点击该目录行 | [UI] 目录展开，图标恢复 ▾，子节点重新出现 | 选择器: `.nexus-vault-panel [data-kind="directory"]`; 操作: `click()`; 控件: div; 等待: 200ms |

**断言汇总**:
- [UI] 目录点击切换展开/折叠状态
- [UI] 折叠时子节点从 DOM 移除，展开时重新渲染

---

### FP-20-02-N04 [P1] [正常] 点击文件节点打开文件到编辑器

**前置条件**:
- 依赖数据: 已打开 vault，含至少 1 个 .md 文件
- 系统状态: vault 面板显示文件树
- 角色权限: 无需登录
- 未达成时的创建过程:
  1. 创建临时 vault 目录
  2. 创建 `test-open.md`（内容: "# Test Open File"）
  3. 通过 IPC 打开 vault

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 点击 data-kind="file" 的文件行（`test-open.md`） | [UI] 触发 `callbacks.onOpenFile(path)`，编辑器加载文件内容 | 选择器: `.nexus-vault-panel [data-path][data-kind="file"]`; 操作: `click()`; 控件: div; 等待: 500ms |
| 2 | 检查编辑器 `.cm-content` 是否包含文件内容 | [UI] 编辑器显示 "# Test Open File" 或其渲染结果 | 选择器: `.cm-content`; 操作: `evaluate` 读取 textContent; 控件: div; 等待: 300ms |
| 3 | 检查状态栏显示的文件名 | [UI] 状态栏（`#status-line`）包含 "test-open.md" | 选择器: `#status-line`; 操作: `evaluate` 读取 textContent; 控件: div; 等待: 200ms |

**断言汇总**:
- [UI] 点击文件节点加载文件到编辑器
- [UI] 状态栏更新为打开的文件名

---

### FP-20-02-N05 [P2] [正常] 当前激活文件在文件树中高亮显示

**前置条件**:
- 依赖数据: 已打开 vault，已通过文件树打开一个文件
- 系统状态: 编辑器中有激活文件
- 角色权限: 无需登录
- 未达成时的创建过程:
  1. 创建临时 vault 目录，含 `active.md` 和 `other.md`
  2. 通过 IPC 打开 vault
  3. 点击 `active.md` 打开

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 读取 `active.md` 对应的文件行样式 | [UI] 激活文件行有高亮背景（ACTIVE_STYLES: background 含 #e7f0ff 或 var(--nexus-bg-active)） | 选择器: `.nexus-vault-panel [data-path][data-kind="file"]`; 操作: `evaluate` 读取 style.background; 控件: div; 等待: 无 |
| 2 | 读取 `other.md` 对应的文件行样式 | [UI] 非激活文件行无高亮背景 | 选择器: `.nexus-vault-panel [data-path][data-kind="file"]`; 操作: `evaluate` 读取 style.background; 控件: div; 等待: 无 |

**断言汇总**:
- [UI] 当前打开的文件在文件树中以高亮背景标识
- [UI] 非当前文件无高亮

---

### FP-20-02-E01 [P3] [异常] 未打开 vault 时显示空状态提示

**前置条件**:
- 依赖数据: 无 vault 打开（需确保 demo 未恢复上次 vault，或清除 lastVault）
- 系统状态: demo 已启动，未打开任何 vault
- 角色权限: 无需登录
- 未达成时的创建过程:
  1. 启动 demo 前清除持久化的 lastVault（通过 evaluate 清除 localStorage 或 IPC `vault.setLast(null)`）
  2. 调用 `launchDemo()` 启动 demo

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 读取 Vault 面板文件树区域文本 | [UI] 显示 "No vault opened. Click 📁 to choose a folder." | 选择器: `.nexus-vault-panel`; 操作: `evaluate` 读取 textContent; 控件: div; 等待: 500ms（需等待 tryRestoreLastVault 异步完成） |
| 2 | 验证 title 仍为 "Vault" | [UI] header title textContent 为 "Vault"（未更新为目录名） | 选择器: `.nexus-vault-panel`; 操作: `evaluate` 读取第一个 div textContent; 控件: div; 等待: 无 |

**断言汇总**:
- [UI] 未打开 vault 时显示引导文案 "No vault opened. Click 📁 to choose a folder."
- [UI] header title 保持默认 "Vault"

---

## FP-20-03 Outline 大纲面板（自动提取标题）

### FP-20-03-N01 [P1] [正常] 验证 Outline 面板 DOM 结构（标题 "Outline"）

**前置条件**:
- 依赖数据: 无特殊数据依赖
- 系统状态: demo 已启动，Outline 面板默认可见
- 角色权限: 无需登录
- 未达成时的创建过程: 调用 `launchDemo()` 启动 demo

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 读取 `.nexus-outline-panel` 第一个子元素（header） | [UI] header textContent 为 "Outline" | 选择器: `.nexus-outline-panel > div:first-child`; 操作: `evaluate` 读取 textContent; 控件: div; 等待: 无 |
| 2 | 读取 Outline 面板宽度 | [UI] 面板宽度为 220px（PANEL_STYLES 中定义） | 选择器: `.nexus-outline-panel`; 操作: `evaluate` 读取 style.width; 控件: div; 等待: 无 |

**断言汇总**:
- [UI] Outline 面板 header 文本为 "Outline"
- [UI] 面板宽度为 220px

---

### FP-20-03-N02 [P1] [正常] 输入 Markdown 标题后大纲自动提取显示

**前置条件**:
- 依赖数据: 编辑器中有 Markdown 标题内容
- 系统状态: demo 已启动，编辑器可输入
- 角色权限: 无需登录
- 未达成时的创建过程: 调用 `launchDemo()` 启动 demo

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器 | [UI] 编辑器内容为空 | 选择器: `.cm-content`; 操作: click + ControlOrMeta+a + Backspace; 控件: div; 等待: 200ms |
| 2 | 输入 "# Main Title\n## Subtitle\n### Deep" | [UI] 编辑器包含三级标题 | 选择器: `.cm-content`; 操作: `insertText` 插入多行文本; 控件: div; 等待: 300ms |
| 3 | 读取 Outline 面板中所有 button 元素的 textContent | [UI] 大纲显示 "Main Title"、"Subtitle"、"Deep" 三个条目 | 选择器: `.nexus-outline-panel button`; 操作: `evaluate` 读取所有 button textContent; 控件: button; 等待: 300ms（editor.on("change") 同步触发） |

**断言汇总**:
- [UI] 输入 Markdown 标题后 Outline 面板自动提取并显示标题文本
- [UI] 大纲条目数量与标题数量一致

---

### FP-20-03-N03 [P2] [正常] 多级标题缩进和字体差异显示

**前置条件**:
- 依赖数据: 编辑器中有多级标题
- 系统状态: demo 已启动，编辑器可输入
- 角色权限: 无需登录
- 未达成时的创建过程: 调用 `launchDemo()` 启动 demo

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器并输入 "# H1\n## H2\n### H3" | [UI] 编辑器包含 H1/H2/H3 三级标题 | 选择器: `.cm-content`; 操作: clearEditor + insertText; 控件: div; 等待: 300ms |
| 2 | 读取第一个大纲项（H1）的 paddingLeft 和 fontSize | [UI] H1: paddingLeft=14px, fontSize=14px, fontWeight=600 | 选择器: `.nexus-outline-panel button:first-of-type`; 操作: `evaluate` 读取 style.paddingLeft 和 style.fontSize; 控件: button; 等待: 200ms |
| 3 | 读取第二个大纲项（H2）的 paddingLeft | [UI] H2: paddingLeft=28px（14 + (2-1)*14） | 选择器: `.nexus-outline-panel button:nth-of-type(2)`; 操作: `evaluate` 读取 style.paddingLeft; 控件: button; 等待: 无 |
| 4 | 读取第三个大纲项（H3）的 paddingLeft | [UI] H3: paddingLeft=42px（14 + (3-1)*14） | 选择器: `.nexus-outline-panel button:nth-of-type(3)`; 操作: `evaluate` 读取 style.paddingLeft; 控件: button; 等待: 无 |

**断言汇总**:
- [UI] H1 标题无缩进（paddingLeft=14px），fontSize=14px
- [UI] H2/H3 标题逐级缩进 14px
- [UI] level≤2 的标题 fontWeight=600

---

### FP-20-03-N04 [P2] [正常] 点击大纲项跳转到编辑器对应位置

**前置条件**:
- 依赖数据: 编辑器中有多段内容，含标题
- 系统状态: demo 已启动，Outline 面板可见
- 角色权限: 无需登录
- 未达成时的创建过程: 调用 `launchDemo()` 启动 demo

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器并输入 "# Title\n\nLong content line 1.\n\n## Second\n\nMore content." | [UI] 编辑器包含标题和内容 | 选择器: `.cm-content`; 操作: clearEditor + insertText; 控件: div; 等待: 300ms |
| 2 | 点击 Outline 面板中 textContent 为 "Second" 的 button | [UI] 编辑器光标跳转到 "## Second" 标题位置 | 选择器: `.nexus-outline-panel button`; 操作: `evaluate` 过滤 textContent==="Second" 后 click; 控件: button; 等待: 200ms |
| 3 | 检查编辑器滚动位置或选区变化 | [UI] 编辑器视口滚动到 "Second" 标题位置（通过 `editor.setSelection(entry.from)` 实现） | 选择器: `.cm-content`; 操作: `evaluate` 检查 scrollTop 或选区; 控件: div; 等待: 200ms |

**断言汇总**:
- [UI] 点击大纲项后编辑器光标定位到对应标题
- [UI] 编辑器获得焦点（`editor.focus()`）

---

### FP-20-03-E01 [P3] [异常] 无标题时显示 "No headings" 空状态

**前置条件**:
- 依赖数据: 编辑器中无 Markdown 标题内容
- 系统状态: demo 已启动
- 角色权限: 无需登录
- 未达成时的创建过程: 调用 `launchDemo()` 启动 demo

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器并输入纯文本（无 # 标题），如 "This is plain text without headings." | [UI] 编辑器无标题 | 选择器: `.cm-content`; 操作: clearEditor + insertText; 控件: div; 等待: 300ms |
| 2 | 读取 Outline 面板列表区域文本 | [UI] 显示 "No headings"（italic 样式空状态文案） | 选择器: `.nexus-outline-panel`; 操作: `evaluate` 读取 textContent; 控件: div; 等待: 200ms |
| 3 | 验证 Outline 面板中无 button 元素 | [UI] 列表区域不含 button（标题项） | 选择器: `.nexus-outline-panel button`; 操作: `count()`; 控件: button; 等待: 无 |

**断言汇总**:
- [UI] 无标题时 Outline 显示 "No headings"
- [UI] 无标题项 button 渲染

---

### FP-20-03-I01 [P4] [一致性] 编辑标题后大纲实时更新

**前置条件**:
- 依赖数据: 编辑器中已有标题
- 系统状态: demo 已启动，Outline 面板可见
- 角色权限: 无需登录
- 未达成时的创建过程: 调用 `launchDemo()` 启动 demo

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器并输入 "# Original Title" | [UI] 大纲显示 "Original Title" | 选择器: `.cm-content`; 操作: clearEditor + insertText; 控件: div; 等待: 300ms |
| 2 | 修改编辑器内容为 "# Updated Title"（选中 "Original" 替换为 "Updated"） | [UI] 编辑器标题变更 | 选择器: `.cm-content`; 操作: keyboard 选中替换; 控件: div; 等待: 300ms |
| 3 | 读取 Outline 面板 button textContent | [UI] 大纲实时更新为 "Updated Title"（通过 `editor.on("change", update)` 同步刷新） | 选择器: `.nexus-outline-panel button`; 操作: `evaluate` 读取 textContent; 控件: button; 等待: 300ms |

**断言汇总**:
- [UI] 编辑器标题变更后 Outline 面板同步更新
- [UI] 更新通过 `editor.on("change")` 事件实时触发

---

## FP-20-04 Backlinks 反向链接面板（依赖 LinkIndex）

### FP-20-04-N01 [P1] [正常] 验证 Backlinks 面板 DOM 结构（标题 "Backlinks"）

**前置条件**:
- 依赖数据: 无特殊数据依赖
- 系统状态: demo 已启动，Backlinks 面板默认可见
- 角色权限: 无需登录
- 未达成时的创建过程: 调用 `launchDemo()` 启动 demo

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 读取 `.backlinks-panel` 根元素标签名 | [UI] 根元素为 `<aside>` | 选择器: `.backlinks-panel`; 操作: `evaluate` 读取 tagName; 控件: aside; 等待: 无 |
| 2 | 读取 `.backlinks-panel` header 文本 | [UI] header textContent 包含 "Backlinks" | 选择器: `.backlinks-panel > div:first-child`; 操作: `evaluate` 读取 textContent; 控件: div; 等待: 无 |
| 3 | 验证面板宽度 | [UI] 面板宽度为 280px（PANEL_STYLES） | 选择器: `.backlinks-panel`; 操作: `evaluate` 读取 style.width; 控件: aside; 等待: 无 |

**断言汇总**:
- [UI] Backlinks 面板根元素为 `<aside class="backlinks-panel">`
- [UI] header 包含 "Backlinks" 文本
- [UI] 面板宽度为 280px

---

### FP-20-04-N02 [P2] [正常] 无激活文件时显示 "No active file"

**前置条件**:
- 依赖数据: 无激活文件（state.activeFile 为 null）
- 系统状态: demo 已启动，未打开任何文件
- 角色权限: 无需登录
- 未达成时的创建过程:
  1. 启动 demo 前确保无 lastVault 恢复（清除持久化数据）
  2. 调用 `launchDemo()` 启动 demo
  3. 等待 tryRestoreLastVault 异步完成确认无 vault 恢复

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 读取 `.backlinks-panel` 列表区域文本 | [UI] 显示 "No active file"（renderEmpty("No active file", list)） | 选择器: `.backlinks-panel`; 操作: `evaluate` 读取 textContent; 控件: aside; 等待: 500ms |
| 2 | 验证 header 文本 | [UI] header textContent 为 "Backlinks"（无计数后缀） | 选择器: `.backlinks-panel > div:first-child`; 操作: `evaluate` 读取 textContent; 控件: div; 等待: 无 |

**断言汇总**:
- [UI] 无激活文件时列表显示 "No active file"
- [UI] header 保持纯 "Backlinks" 无计数

---

### FP-20-04-N03 [P1] [正常] 创建 wiki link 后在 Target 文件反链面板显示

**前置条件**:
- 依赖数据: vault 中存在两个文件，Source 文件含 `[[Target]]` wiki link，Target 文件被打开
- 系统状态: vault 已打开，LinkIndex 已 seed
- 角色权限: 无需登录
- 未达成时的创建过程:
  1. 创建临时 vault 目录
  2. 创建 `Source.md`（内容: "Link to [[Target]] here"）
  3. 创建 `Target.md`（内容: "# Target Note"）
  4. 通过 IPC 打开 vault
  5. 等待 LinkIndex seed 完成（`await page.waitForTimeout(1000)`）
  6. 通过文件树打开 `Target.md`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 打开 Target.md 后读取 Backlinks 面板 | [UI] "Linked mentions" section header 显示，badge 计数 ≥1 | 选择器: `.backlinks-panel`; 操作: `evaluate` 读取 textContent; 控件: aside; 等待: 500ms |
| 2 | 读取 "Linked mentions" section 下的反链项 | [UI] 出现 Source.md 的反链项（button 内 title 为 "Source.md"，snippet 含 "Link to [[Target]] here"） | 选择器: `.backlinks-panel button`; 操作: `evaluate` 读取子 div textContent; 控件: button; 等待: 300ms |
| 3 | 验证 header 文本含 linked 计数 | [UI] header 文本格式为 "Backlinks · 1 linked · … mentions"（异步扫描未完成时为 …） | 选择器: `.backlinks-panel > div:first-child`; 操作: `evaluate` 读取 textContent; 控件: div; 等待: 无 |

**断言汇总**:
- [UI] Target 文件的 Backlinks 面板显示来自 Source.md 的 linked mention
- [UI] 反链项含源文件名和上下文 snippet
- [UI] header 显示 linked 计数

---

### FP-20-04-N04 [P2] [正常] 点击反链项跳转到源文件

**前置条件**:
- 依赖数据: vault 中 Target.md 有来自 Source.md 的反链，Target.md 当前打开
- 系统状态: Backlinks 面板显示反链项
- 角色权限: 无需登录
- 未达成时的创建过程:
  1. 同 FP-20-04-N03 创建 vault + Source.md + Target.md
  2. 打开 Target.md，等待反链渲染

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 点击 "Linked mentions" 下的反链 button（Source.md 项） | [UI] 触发 `onOpenFile(hit.sourcePath)`，编辑器加载 Source.md | 选择器: `.backlinks-panel button`; 操作: `click()` 第一个反链 button; 控件: button; 等待: 500ms |
| 2 | 检查状态栏文件名 | [UI] 状态栏显示 "Source.md" | 选择器: `#status-line`; 操作: `evaluate` 读取 textContent; 控件: div; 等待: 300ms |
| 3 | 检查编辑器内容 | [UI] 编辑器显示 Source.md 的内容（含 "Link to [[Target]]"） | 选择器: `.cm-content`; 操作: `evaluate` 读取 textContent; 控件: div; 等待: 300ms |

**断言汇总**:
- [UI] 点击反链项跳转到源文件
- [UI] 编辑器和状态栏更新为源文件

---

### FP-20-04-E01 [P3] [异常] 无反链时显示 "No linked mentions"

**前置条件**:
- 依赖数据: vault 中有文件但无任何 wiki link 指向当前打开的文件
- 系统状态: vault 已打开，打开了无反链的文件
- 角色权限: 无需登录
- 未达成时的创建过程:
  1. 创建临时 vault 目录
  2. 创建 `isolated.md`（内容: "# Isolated note, no links"），无其他文件引用它
  3. 通过 IPC 打开 vault，等待 seed
  4. 打开 `isolated.md`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 打开 isolated.md 后读取 Backlinks 面板 | [UI] "Linked mentions" section 下显示 "No linked mentions" | 选择器: `.backlinks-panel`; 操作: `evaluate` 读取 textContent; 控件: aside; 等待: 500ms |
| 2 | 验证 header 文本 | [UI] header 含 "0 linked" | 选择器: `.backlinks-panel > div:first-child`; 操作: `evaluate` 读取 textContent; 控件: div; 等待: 300ms |
| 3 | 验证无反链 button（在 Linked mentions 区域） | [UI] "No linked mentions" 文案下无反链项 button | 选择器: `.backlinks-panel button`; 操作: `count()` 验证; 控件: button; 等待: 无 |

**断言汇总**:
- [UI] 无反链时显示 "No linked mentions"
- [UI] header linked 计数为 0

---

### FP-20-04-I01 [P4] [一致性] Unlinked mentions 区域显示纯文本提及

**前置条件**:
- 依赖数据: vault 中有文件以纯文本（非 wiki link）提及当前文件名
- 系统状态: vault 已打开，LinkIndex 已 seed
- 角色权限: 无需登录
- 未达成时的创建过程:
  1. 创建临时 vault 目录
  2. 创建 `mention.md`（内容: "I reference Target in plain text"）
  3. 创建 `Target.md`（内容: "# Target"）
  4. 通过 IPC 打开 vault，等待 seed
  5. 打开 `Target.md`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 打开 Target.md 后等待异步扫描完成（requestIdleCallback timeout 250ms） | [UI] "Unlinked mentions" section 从 "scanning…" 更新为实际计数 | 选择器: `.backlinks-panel`; 操作: `waitForTimeout(500)`; 控件: aside; 等待: 500ms |
| 2 | 读取 "Unlinked mentions" section 内容 | [UI] 显示 mention.md 的纯文本提及项（若 "Target" 出现在 mention.md 正文中） | 选择器: `.backlinks-panel`; 操作: `evaluate` 读取 textContent; 控件: aside; 等待: 200ms |
| 3 | 验证 header 最终文本格式 | [UI] header 格式为 "Backlinks · 0 linked · 1 mention"（或 0 mentions 若无匹配） | 选择器: `.backlinks-panel > div:first-child`; 操作: `evaluate` 读取 textContent; 控件: div; 等待: 200ms |

**断言汇总**:
- [UI] Unlinked mentions 区域异步扫描后显示纯文本提及
- [UI] header 最终显示 linked 和 mentions 双计数
- [UI] 扫描期间显示 "scanning…" 占位

---

## FP-20-05 状态栏（字数统计 + 文件状态 modified 标记）

### FP-20-05-N01 [P1] [正常] 验证状态栏初始显示（Untitled 或文件名）

**前置条件**:
- 依赖数据: 无特殊数据依赖
- 系统状态: demo 已启动
- 角色权限: 无需登录
- 未达成时的创建过程: 调用 `launchDemo()` 启动 demo

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 读取 `#status-line` 的 textContent | [UI] 状态栏文本不为空，包含 pathLabel（文件名或 "Untitled"） | 选择器: `#status-line`; 操作: `evaluate` 读取 textContent; 控件: div; 等待: 无 |
| 2 | 验证状态栏包含字数统计 | [UI] 文本包含 "words" 和 "lines" 关键词（来自 `getDocumentStats()`） | 选择器: `#status-line`; 操作: `evaluate` 读取 textContent; 控件: div; 等待: 200ms |

**断言汇总**:
- [UI] 状态栏显示当前文件标识（文件名或 Untitled）
- [UI] 状态栏包含字数和行数统计

---

### FP-20-05-N02 [P1] [正常] 编辑文档后状态栏显示 [modified] 标记

**前置条件**:
- 依赖数据: 已打开文件（或有初始内容）
- 系统状态: demo 已启动，编辑器可编辑
- 角色权限: 无需登录
- 未达成时的创建过程: 调用 `launchDemo()` 启动 demo

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 记录当前状态栏文本 | [UI] 初始状态栏文本（无 [modified] 或已有，取决于 dirty 状态） | 选择器: `#status-line`; 操作: `evaluate` 读取 textContent; 控件: div; 等待: 无 |
| 2 | 在编辑器中输入文字（触发 onChange → state.dirty=true → renderStatus） | [UI] 编辑器内容变更 | 选择器: `.cm-content`; 操作: click + keyboard.type("test"); 控件: div; 等待: 300ms |
| 3 | 再次读取状态栏文本 | [UI] 状态栏文本包含 " [modified]"（dirtyMark） | 选择器: `#status-line`; 操作: `evaluate` 读取 textContent; 控件: div; 等待: 300ms |

**断言汇总**:
- [UI] 编辑文档后状态栏出现 "[modified]" 标记
- [UI] dirty 标记格式为 " [modified]"（前含空格）

---

### FP-20-05-N03 [P2] [正常] 状态栏显示字数统计（words + lines）

**前置条件**:
- 依赖数据: 编辑器中有内容
- 系统状态: demo 已启动
- 角色权限: 无需登录
- 未达成时的创建过程: 调用 `launchDemo()` 启动 demo

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器并输入 "hello world test" | [UI] 编辑器含 3 个词 | 选择器: `.cm-content`; 操作: clearEditor + typeInEditor("hello world test"); 控件: div; 等待: 300ms |
| 2 | 读取状态栏文本 | [UI] 文本包含 "3 words" 和 "1 lines"（格式: " | 3 words, 1 lines"） | 选择器: `#status-line`; 操作: `evaluate` 读取 textContent; 控件: div; 等待: 300ms |
| 3 | 追加换行和更多文字 "hello world test\nmore text here" | [UI] 编辑器变为 2 行 | 选择器: `.cm-content`; 操作: clearEditor + insertText("hello world test\nmore text here"); 控件: div; 等待: 300ms |
| 4 | 再次读取状态栏文本 | [UI] 文本包含 "5 words"（或按统计逻辑的词数）和 "2 lines" | 选择器: `#status-line`; 操作: `evaluate` 读取 textContent; 控件: div; 等待: 300ms |

**断言汇总**:
- [UI] 状态栏 words 和 lines 随内容动态更新
- [UI] 格式为 " | {N} words, {N} lines"

---

### FP-20-05-N04 [P2] [正常] 字数统计浮动栏显示 words/chars/reading-time

**前置条件**:
- 依赖数据: 编辑器中有内容
- 系统状态: demo 已启动，wordcount 插件已挂载
- 角色权限: 无需登录
- 未达成时的创建过程: 调用 `launchDemo()` 启动 demo

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器并输入 "hello world" | [UI] 编辑器有内容 | 选择器: `.cm-content`; 操作: clearEditor + typeInEditor("hello world"); 控件: div; 等待: 300ms（150ms 防抖 + 余量） |
| 2 | 读取 `.nexus-wordcount__words` 的 textContent | [UI] 文本为 "2 words"（data-testid="nexus-wordcount-words"） | 选择器: `[data-testid="nexus-wordcount-words"]`; 操作: `evaluate` 读取 textContent; 控件: span; 等待: 250ms |
| 3 | 读取 `.nexus-wordcount__characters` 的 textContent | [UI] 文本为 "11 chars"（data-testid="nexus-wordcount-characters"） | 选择器: `[data-testid="nexus-wordcount-characters"]`; 操作: `evaluate` 读取 textContent; 控件: span; 等待: 无 |
| 4 | 读取 `.nexus-wordcount__reading-time` 的 textContent | [UI] 文本为 "< 1 min read"（短文本，阅读时间 ≤60s） | 选择器: `[data-testid="nexus-wordcount-reading-time"]`; 操作: `evaluate` 读取 textContent; 控件: span; 等待: 无 |

**断言汇总**:
- [UI] 字数统计浮动栏显示 words/chars/reading-time
- [UI] 浮动栏根元素含 role="status" aria-live="polite"

---

### FP-20-05-N05 [P2] [正常] 选区统计在浮动栏显示（selection span）

**前置条件**:
- 依赖数据: 编辑器中有可选中内容
- 系统状态: demo 已启动，wordcount 插件已挂载
- 角色权限: 无需登录
- 未达成时的创建过程: 调用 `launchDemo()` 启动 demo

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 清空编辑器并输入 "hello world test content" | [UI] 编辑器有 4 个词 | 选择器: `.cm-content`; 操作: clearEditor + typeInEditor; 控件: div; 等待: 300ms |
| 2 | 选中 "hello world"（前两个词） | [UI] 编辑器有选区 | 选择器: `.cm-content`; 操作: keyboard 选中; 控件: div; 等待: 200ms |
| 3 | 读取 `.nexus-wordcount__selection` 的 hidden 属性和 textContent | [UI] selection span 可见（hidden=false），文本含 "Selected: 2 words · 11 chars" | 选择器: `[data-testid="nexus-wordcount-selection"]`; 操作: `evaluate` 读取 hidden 和 textContent; 控件: span; 等待: 200ms |
| 4 | 取消选区（点击编辑器其他位置） | [UI] 选区消失 | 选择器: `.cm-content`; 操作: click; 控件: div; 等待: 200ms |
| 5 | 再次读取 selection span | [UI] selection span hidden=true，textContent 为空 | 选择器: `[data-testid="nexus-wordcount-selection"]`; 操作: `evaluate` 读取 hidden; 控件: span; 等待: 200ms |

**断言汇总**:
- [UI] 有选区时 selection span 显示选区统计
- [UI] 无选区时 selection span 隐藏
- [UI] 选区统计格式: "Selected: {N} words · {N} chars"

---

### FP-20-05-N06 [P2] [正常] 打开 vault 后状态栏显示 Vault 名称

**前置条件**:
- 依赖数据: 已创建测试 vault 目录
- 系统状态: demo 已启动
- 角色权限: 无需登录
- 未达成时的创建过程:
  1. 创建临时 vault 目录（如 `nexus-test-vault-{timestamp}`）
  2. 通过 IPC 打开 vault

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 通过 IPC 打开 vault 目录 | [UI] state.vaultPath 更新 | 选择器: 无; 操作: `evaluate` 调用 vault API; 控件: 无; 等待: 500ms |
| 2 | 读取状态栏文本 | [UI] 文本包含 "Vault: {vault目录名}"（vaultLabel 格式: " | Vault: {name}"） | 选择器: `#status-line`; 操作: `evaluate` 读取 textContent; 控件: div; 等待: 300ms |

**断言汇总**:
- [UI] 打开 vault 后状态栏显示 Vault 标签
- [UI] vaultLabel 格式为 " | Vault: {目录名}"（仅 basename，非完整路径）

---

### FP-20-05-E01 [P3] [异常] 错误状态时状态栏显示 Error 信息

**前置条件**:
- 依赖数据: 触发一个错误条件（如打开不存在的文件路径）
- 系统状态: demo 已启动
- 角色权限: 无需登录
- 未达成时的创建过程: 调用 `launchDemo()` 启动 demo

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 通过 evaluate 触发一个错误（如调用 `window.nexusDemo.openFile()` 返回错误，或模拟 IPC 失败） | [UI] state.error 被设置 | 选择器: 无; 操作: `evaluate` 触发错误条件; 控件: 无; 等待: 300ms |
| 2 | 读取状态栏文本 | [UI] 文本包含 " — Error: {错误信息}"（errorText 格式） | 选择器: `#status-line`; 操作: `evaluate` 读取 textContent; 控件: div; 等待: 300ms |

**断言汇总**:
- [UI] 错误发生时状态栏追加 Error 信息
- [UI] errorText 格式为 " — Error: {message}"

---

### FP-20-05-I01 [P4] [一致性] 状态栏格式完整性验证（pathLabel + modified + stats + vault）

**前置条件**:
- 依赖数据: 已打开 vault 和文件，文件有修改
- 系统状态: demo 已启动，编辑器有内容且 dirty=true
- 角色权限: 无需登录
- 未达成时的创建过程:
  1. 创建临时 vault 目录
  2. 创建 `complete-test.md`（内容: "# Complete Test"）
  3. 通过 IPC 打开 vault
  4. 打开 `complete-test.md`
  5. 编辑内容（触发 dirty）

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 打开文件并编辑内容后读取完整状态栏文本 | [UI] 文本格式为: `{filename} [modified] | {words} words, {lines} lines | Vault: {vaultName}` | 选择器: `#status-line`; 操作: `evaluate` 读取 textContent; 控件: div; 等待: 300ms |
| 2 | 验证文本各组成部分 | [UI] 文本同时包含: 文件名、" [modified]"、" words"、" lines"、"Vault:" | 选择器: `#status-line`; 操作: `evaluate` 正则匹配各部分; 控件: div; 等待: 无 |

**断言汇总**:
- [UI] 状态栏完整渲染所有状态区域: 文件名 + modified 标记 + 字数行数 + Vault 名
- [UI] 各区域顺序: pathLabel → dirtyMark → statsText → vaultLabel
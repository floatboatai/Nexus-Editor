# e2e 测试用例 — Electron Demo 全功能探索（基于实际 demo 探索）

> 输入源: Playwright MCP 探索 demo（2026-08-11）
> 生成时间: 2026-08-11
> 测试框架: Playwright（Electron demo / Vite dev server）
> 探索依据: 通过 Playwright MCP 实际操作 demo，覆盖工具栏/Vault/编辑器/斜杠菜单/搜索/大纲/反链

## 覆盖范围

| 章节号 | 章节名称 | 用例数 | 覆盖功能 |
|--------|---------|--------|---------|
| 一 | 编辑器基础交互 | 6 | 键盘输入、换行、Live Preview、字数统计、删除 |
| 二 | Markdown 语法渲染 | 5 | 标题/粗体/斜体/代码/列表 |
| 三 | 斜杠命令菜单 | 4 | 触发/过滤/确认/取消 |
| 四 | 工具栏按钮 | 5 | Bold/Italic/Heading/Undo/Redo |
| 五 | 搜索功能 | 4 | 打开/查找/替换/关闭 |
| 六 | 面板切换 | 4 | Vault/Outline/Backlinks/全屏 |
| 七 | Vault 文件操作 | 4 | 打开/新建/切换/保存 |

## e2e 全局前置条件

- 依赖环境: Electron demo Vite dev server（http://localhost:5173）
- 初始文档: 空文档（每次测试前清空）
- 插件配置: demo 默认（GFM preset + history + toolbar + search + wikilinks + wordcount）
- setup 代码:
  ```typescript
  import { test, expect, type Page } from "@playwright/test";

  test.beforeEach(async ({ page }) => {
    await page.goto("http://localhost:5173");
    // 等待编辑器就绪
    await page.waitForSelector(".cm-content", { timeout: 10000 });
    // 清空编辑器（确保干净初始状态）
    await page.click(".cm-content");
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Backspace");
  });

  // 辅助：键盘输入文本（MCP 探索发现 execCommand 在 MCP 上下文不生效，但 Playwright API 正常）
  async function typeText(page: Page, text: string) {
    await page.click(".cm-content");
    await page.keyboard.type(text);
  }

  // 辅助：移出当前行（触发 Live Preview 折叠）
  async function moveOutOfLine(page: Page) {
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowUp");
  }

  // 辅助：获取字数统计
  async function getWordCount(page: Page): Promise<string> {
    return (await page.locator("[data-test-id=nexus-wordcount-words]").textContent()) ?? "";
  }
  ```

---

# 一、编辑器基础交互（6 例）

## EXP-01-01-N01 [P1] [正常] 键盘输入文本→编辑器渲染

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Vite dev server
- 初始文档: 空
- 插件配置: demo 默认
- setup: 见全局前置条件

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 键盘输入 "Hello Nexus" | [DOM] `.cm-content` 包含 "Hello Nexus" | import: @playwright/test; API: page.keyboard.type(); 框架: playwright; 等待: 无 |
| 2 | 断言字数统计 | [DOM] wordcount 显示 "2 words" | import: @playwright/test; API: page.locator([data-test-id=nexus-wordcount-words]); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] 编辑器内容包含输入文本
- [DOM] 字数统计实时更新

## EXP-01-02-N02 [P1] [正常] Enter 换行→多行文档

**测试框架**: Playwright

**前置条件**: 全局 setup + 已输入 "Line 1"

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 输入 "Line 1" → Enter → 输入 "Line 2" | [DOM] `.cm-content` 包含两行 | import: @playwright/test; API: page.keyboard.press(Enter); 框架: playwright; 等待: 无 |
| 2 | 断言行数 | [DOM] `.cm-line` 元素数量 ≥ 2 | import: @playwright/test; API: page.locator(.cm-line).count(); 框架: playwright; 等待: 无 |
| 3 | 断言状态栏 | [DOM] 底部状态栏显示 "2 lines" | import: @playwright/test; API: page.locator(body).textContent(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] 两行独立 `.cm-line` 元素
- [DOM] 状态栏行数统计为 2

## EXP-01-03-N03 [P2] [正常] 中文输入→字数统计正确

**测试框架**: Playwright

**前置条件**: 全局 setup

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 键盘输入 "你好世界" | [DOM] `.cm-content` 包含 "你好世界" | import: @playwright/test; API: page.keyboard.type(); 框架: playwright; 等待: 无 |
| 2 | 断言字数统计 | [CALC] wordcount 按 CJK 字符计数（至少 4 chars） | import: @playwright/test; API: page.locator([data-test-id=nexus-wordcount-characters]); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] 中文文本正确渲染
- [CALC] 字符统计正确反映 CJK 字符数

## EXP-01-04-N04 [P2] [正常] 全选删除→清空文档

**测试框架**: Playwright

**前置条件**: 全局 setup + 已输入 "Delete me"

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | ControlOrMeta+A → Backspace | [DOM] `.cm-content` 清空 | import: @playwright/test; API: page.keyboard.press(ControlOrMeta+a); 框架: playwright; 等待: 无 |
| 2 | 断言字数统计 | [DOM] wordcount 归零 "0 words" | import: @playwright/test; API: page.locator([data-test-id=nexus-wordcount-words]); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] 全选删除后编辑器为空

## EXP-01-05-E01 [P3] [异常] 极长单行输入→不崩溃

**测试框架**: Playwright

**前置条件**: 全局 setup

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 输入 5000 字符 "a" | [DOM] 编辑器不崩溃 | import: @playwright/test; API: page.keyboard.type(); 框架: playwright; 等待: 无 |
| 2 | 断言编辑器存活 | [DOM] `.cm-editor` 可见 | import: @playwright/test; API: expect(page.locator(.cm-editor)).toBeVisible(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] 大文本不导致编辑器崩溃

## EXP-01-06-B01 [P4] [边界] 空文档 Enter→空行

**测试框架**: Playwright

**前置条件**: 全局 setup（空文档）

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 在空文档按 Enter | [DOM] 新增空行，无异常 | import: @playwright/test; API: page.keyboard.press(Enter); 框架: playwright; 等待: 无 |
| 2 | 断言 | [DOM] `.cm-line` 至少 2 个 | import: @playwright/test; API: page.locator(.cm-line).count(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] 空文档换行正常

---

# 二、Markdown 语法渲染（5 例）

## EXP-02-01-N01 [P1] [正常] 标题语法 # → Live Preview 折叠

**测试框架**: Playwright

**前置条件**: 全局 setup

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 输入 "# Heading One" | [DOM] `.cm-content` 包含 "Heading One" | import: @playwright/test; API: page.keyboard.type(); 框架: playwright; 等待: 无 |
| 2 | 移出光标（ArrowDown+ArrowUp） | [DOM] `#` 标记隐藏（Live Preview 折叠） | import: @playwright/test; API: page.keyboard.press(ArrowDown); 框架: playwright; 等待: 300ms |
| 3 | 断言大纲面板 | [DOM] Outline 面板出现 "Heading One" | import: @playwright/test; API: page.locator(body).textContent(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] 标题语法折叠，`#` 隐藏
- [DOM] 大纲面板自动提取标题

## EXP-02-02-N02 [P2] [正常] 粗体 **text** → 渲染

**测试框架**: Playwright

**前置条件**: 全局 setup

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 输入 "This is **bold** text" | [DOM] `.cm-content` 包含 "bold" | import: @playwright/test; API: page.keyboard.type(); 框架: playwright; 等待: 无 |
| 2 | 移出光标 | [DOM] `**` 标记隐藏 | import: @playwright/test; API: page.keyboard.press(ArrowDown); 框架: playwright; 等待: 300ms |

**断言汇总**:
- [DOM] 粗体标记折叠

## EXP-02-03-N03 [P2] [正常] 斜体 *text* → 渲染

**测试框架**: Playwright

**前置条件**: 全局 setup

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 输入 "This is *italic* text" | [DOM] `.cm-content` 包含 "italic" | import: @playwright/test; API: page.keyboard.type(); 框架: playwright; 等待: 无 |
| 2 | 移出光标 | [DOM] `*` 标记隐藏 | import: @playwright/test; API: page.keyboard.press(ArrowDown); 框架: playwright; 等待: 300ms |

**断言汇总**:
- [DOM] 斜体标记折叠

## EXP-02-04-N04 [P2] [正常] 行内代码 `code` → 渲染

**测试框架**: Playwright

**前置条件**: 全局 setup

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 输入 "Use `npm` to install" | [DOM] `.cm-content` 包含 "npm" | import: @playwright/test; API: page.keyboard.type(); 框架: playwright; 等待: 无 |
| 2 | 移出光标 | [DOM] 反引号标记隐藏 | import: @playwright/test; API: page.keyboard.press(ArrowDown); 框架: playwright; 等待: 300ms |

**断言汇总**:
- [DOM] 行内代码标记折叠

## EXP-02-05-N05 [P2] [正常] 无序列表 - item → 渲染

**测试框架**: Playwright

**前置条件**: 全局 setup

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 输入 "- Item 1" → Enter → "- Item 2" | [DOM] `.cm-content` 包含两个列表项 | import: @playwright/test; API: page.keyboard.type(); 框架: playwright; 等待: 无 |
| 2 | 移出光标 | [DOM] `-` 标记隐藏（折叠为列表 Widget） | import: @playwright/test; API: page.keyboard.press(ArrowDown); 框架: playwright; 等待: 300ms |

**断言汇总**:
- [DOM] 列表语法折叠

---

# 三、斜杠命令菜单（4 例）

## EXP-03-01-N01 [P1] [正常] 输入 / → 菜单弹出

**测试框架**: Playwright

**前置条件**: 全局 setup + 空行

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 输入 "/" | [DOM] `.nexus-slash-menu` 可见 | import: @playwright/test; API: page.keyboard.type(/); 框架: playwright; 等待: .nexus-slash-menu 可见 |
| 2 | 断言菜单内容 | [DOM] 菜单含 "Heading 1"、"Bold"、"Italic" 等 | import: @playwright/test; API: page.locator(.nexus-slash-menu).textContent(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] 斜杠菜单弹出且包含预期命令

## EXP-03-02-N02 [P2] [正常] 输入 /bo → 过滤命令

**测试框架**: Playwright

**前置条件**: 全局 setup + 菜单已打开

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 在菜单打开状态下输入 "bo" | [DOM] 菜单过滤为 "Bold" 相关项 | import: @playwright/test; API: page.keyboard.type(bo); 框架: playwright; 等待: 300ms |
| 2 | 断言过滤结果 | [DOM] 菜单含 "Bold"，不含 "Heading" | import: @playwright/test; API: page.locator(.nexus-slash-menu).textContent(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] 查询过滤生效

## EXP-03-03-N03 [P2] [流程] ArrowDown → Enter → 执行命令

**测试框架**: Playwright

**前置条件**: 全局 setup + 菜单已打开

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | ArrowDown → Enter | [DOM] 菜单关闭，命令执行 | import: @playwright/test; API: page.keyboard.press(ArrowDown); 框架: playwright; 等待: .nexus-slash-menu 隐藏 |
| 2 | 断言文档变化 | [DOM] `.cm-content` 有命令插入的内容 | import: @playwright/test; API: page.locator(.cm-content).textContent(); 框架: playwright; 等待: 300ms |

**断言汇总**:
- [DOM] 命令真实执行并修改文档

## EXP-03-04-E01 [P3] [异常] Escape → 关闭菜单

**测试框架**: Playwright

**前置条件**: 全局 setup + 菜单已打开

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 按 Escape | [DOM] `.nexus-slash-menu` 隐藏 | import: @playwright/test; API: page.keyboard.press(Escape); 框架: playwright; 等待: .nexus-slash-menu 隐藏 |
| 2 | 断言文档无副作用 | [DOM] `/` 保留但无命令执行 | import: @playwright/test; API: page.locator(.cm-content).textContent(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] Escape 关闭菜单不执行命令

---

# 四、工具栏按钮（5 例）

## EXP-04-01-N01 [P1] [正常] 点击 Bold 按钮 → 插入粗体语法

**测试框架**: Playwright

**前置条件**: 全局 setup + 已输入 "bold text" 并全选

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 输入 "bold text" → 全选 | [STATE] 文本被选中 | import: @playwright/test; API: page.keyboard.press(ControlOrMeta+a); 框架: playwright; 等待: 无 |
| 2 | 点击 Bold 按钮 | [DOM] `.cm-content` 包含 `**bold text**` | import: @playwright/test; API: page.click([aria-label=Bold]); 框架: playwright; 等待: 300ms |
| 3 | 断言 | [DOM] 文本被 `**` 包裹 | import: @playwright/test; API: page.locator(.cm-content).textContent(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] 工具栏 Bold 按钮在选中文本上插入 `**` 包裹

## EXP-04-02-N02 [P2] [正常] 点击 H2 按钮 → 转换为标题

**测试框架**: Playwright

**前置条件**: 全局 setup + 已输入 "subtitle" 并全选

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 点击 H2 按钮 | [DOM] 行首插入 `## ` | import: @playwright/test; API: page.click([aria-label=Heading 2]); 框架: playwright; 等待: 300ms |
| 2 | 移出光标断言 | [DOM] 大纲面板显示 "subtitle" | import: @playwright/test; API: page.locator(body).textContent(); 框架: playwright; 等待: 300ms |

**断言汇总**:
- [DOM] H2 按钮在行首插入 `## `
- [DOM] 大纲自动更新

## EXP-04-03-N03 [P2] [正常] 点击 Italic 按钮 → 插入斜体

**测试框架**: Playwright

**前置条件**: 全局 setup + 已输入 "emph" 并全选

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 点击 Italic 按钮 | [DOM] `.cm-content` 包含 `*emph*` | import: @playwright/test; API: page.click([aria-label=Italic]); 框架: playwright; 等待: 300ms |

**断言汇总**:
- [DOM] Italic 按钮插入 `*` 包裹

## EXP-04-04-F01 [P2] [流程] Undo → 撤销格式操作

**测试框架**: Playwright

**前置条件**: 全局 setup + 已执行 EXP-04-01（Bold 操作后）

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 点击 Undo 按钮 | [DOM] `**` 包裹被撤销 | import: @playwright/test; API: page.click([aria-label=Undo]); 框架: playwright; 等待: 300ms |
| 2 | 断言 | [DOM] `.cm-content` 不含 `**` | import: @playwright/test; API: page.locator(.cm-content).textContent(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] Undo 撤销格式包裹

## EXP-04-05-F02 [P3] [流程] Redo → 重做格式操作

**测试框架**: Playwright

**前置条件**: 全局 setup + 已执行 Undo

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 点击 Redo 按钮 | [DOM] `**` 包裹恢复 | import: @playwright/test; API: page.click([aria-label=Redo]); 框架: playwright; 等待: 300ms |
| 2 | 断言 | [DOM] `.cm-content` 重新含 `**bold text**` | import: @playwright/test; API: page.locator(.cm-content).textContent(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] Redo 恢复格式包裹

---

# 五、搜索功能（4 例）

## EXP-05-01-N01 [P1] [正常] 点击搜索按钮 → 搜索栏展开

**测试框架**: Playwright

**前置条件**: 全局 setup + 已输入 "Hello World"

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 点击 🔍 按钮 | [DOM] `.nexus-search-bar` 可见 | import: @playwright/test; API: page.click([title=Search (Ctrl+F)]); 框架: playwright; 等待: .nexus-search-bar 可见 |
| 2 | 断言搜索栏结构 | [DOM] 含 Find input + Replace input + Previous/Next/All 按钮 | import: @playwright/test; API: page.locator(.nexus-search-bar).innerHTML(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] 搜索栏展开含完整 UI 结构

## EXP-05-02-N02 [P2] [正常] 输入关键词 → 高亮匹配

**测试框架**: Playwright

**前置条件**: 全局 setup + 已输入 "Hello World" + 搜索栏已展开

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 在 Find input 输入 "Hello" | [DOM] 搜索结果高亮 | import: @playwright/test; API: page.fill(.nexus-search-bar input[placeholder=Find...], Hello); 框架: playwright; 等待: 300ms |
| 2 | 断言匹配计数 | [DOM] 搜索栏显示匹配信息 | import: @playwright/test; API: page.locator(.nexus-search-bar).textContent(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] 搜索匹配高亮显示

## EXP-05-03-N03 [P2] [正常] 替换功能 → 文档更新

**测试框架**: Playwright

**前置条件**: 全局 setup + 已输入 "Hello World" + 搜索栏展开 + 已输入 Find:Hello

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 在 Replace input 输入 "Hi" | [STATE] 替换词已填入 | import: @playwright/test; API: page.fill(.nexus-search-bar input[placeholder=Replace...], Hi); 框架: playwright; 等待: 无 |
| 2 | 点击 Replace 按钮 | [DOM] 文档中 "Hello" 替换为 "Hi" | import: @playwright/test; API: page.click(.nexus-search-bar >> text=Replace); 框架: playwright; 等待: 300ms |
| 3 | 断言文档 | [DOM] `.cm-content` 包含 "Hi World" | import: @playwright/test; API: page.locator(.cm-content).textContent(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] 替换功能正确修改文档

## EXP-05-04-E01 [P3] [异常] 关闭搜索栏 → × 按钮或 Escape

**测试框架**: Playwright

**前置条件**: 全局 setup + 搜索栏已展开

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 点击 × 关闭按钮 | [DOM] `.nexus-search-bar` 隐藏 | import: @playwright/test; API: page.click(.nexus-search-bar >> text=×); 框架: playwright; 等待: .nexus-search-bar 隐藏 |
| 2 | 断言 | [DOM] 搜索栏 `display:none` 或不可见 | import: @playwright/test; API: expect(page.locator(.nexus-search-bar)).toBeHidden(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] 搜索栏正确关闭

---

# 六、面板切换（4 例）

## EXP-06-01-N01 [P2] [正常] 点击 📑 → Vault 面板切换

**测试框架**: Playwright

**前置条件**: 全局 setup

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 点击 📑 按钮 | [DOM] Vault 面板可见性切换 | import: @playwright/test; API: page.click([title=Toggle vault panel]); 框架: playwright; 等待: 300ms |
| 2 | 断言 | [DOM] `.nexus-vault-panel` 可见性变化 | import: @playwright/test; API: page.locator(.nexus-vault-panel).isVisible(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] Vault 面板切换

## EXP-06-02-N02 [P2] [正常] 点击 ☰ → Outline 面板切换

**测试框架**: Playwright

**前置条件**: 全局 setup + 已输入 "# My Heading"

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 点击 ☰ 按钮 | [DOM] Outline 面板可见性切换 | import: @playwright/test; API: page.click([title=Toggle outline]); 框架: playwright; 等待: 300ms |
| 2 | 断言大纲内容 | [DOM] 面板含 "My Heading" | import: @playwright/test; API: page.locator(body).textContent(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] Outline 面板切换且显示标题

## EXP-06-03-N03 [P2] [正常] 点击 🔗 → Backlinks 面板切换

**测试框架**: Playwright

**前置条件**: 全局 setup

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 点击 🔗 按钮 | [DOM] Backlinks 面板可见性切换 | import: @playwright/test; API: page.click([title=Toggle backlinks panel]); 框架: playwright; 等待: 300ms |
| 2 | 断言 | [DOM] Backlinks 区域可见 | import: @playwright/test; API: page.locator(body).textContent(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] Backlinks 面板切换

## EXP-06-04-N04 [P3] [正常] 点击全屏按钮 → 编辑器全屏

**测试框架**: Playwright

**前置条件**: 全局 setup

| 步骤| 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 点击全屏按钮 | [DOM] 编辑器区域扩展为全屏 | import: @playwright/test; API: page.click([aria-label=Fullscreen]); 框架: playwright; 等待: 300ms |
| 2 | 再次点击退出全屏 | [DOM] 编辑器恢复原尺寸 | import: @playwright/test; API: page.click([aria-label=Fullscreen]); 框架: playwright; 等待: 300ms |

**断言汇总**:
- [DOM] 全屏切换正常

---

# 七、Vault 文件操作（4 例）

## EXP-07-01-N01 [P1] [正常] 点击 Open Vault → 打开文件夹（模拟）

**测试框架**: Playwright

**前置条件**: 全局 setup

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 点击 Vault 按钮 | [DOM] 触发文件夹选择对话框或 vault 面板更新 | import: @playwright/test; API: page.click(button:has-text(Vault)); 框架: playwright; 等待: 300ms |
| 2 | 断言 | [DOM] vault 面板不再为空 或 文件选择对话框触发 | import: @playwright/test; API: page.locator(.nexus-vault-panel).textContent(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] Vault 打开操作有响应

⚠️ 注: Electron 原生对话框需要特殊处理（dialog 事件监听或 IPC mock），标注为待确认

## EXP-07-02-N02 [P2] [正常] 新建文件（需 Vault 已打开）

**测试框架**: Playwright

**前置条件**: Vault 已打开（sample-vault）

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 点击 + 按钮 | [DOM] vault 树新增文件节点 或 输入文件名 | import: @playwright/test; API: page.click(button[title=New file at root]); 框架: playwright; 等待: 300ms |
| 2 | 断言 | [DOM] 文件树含新文件 | import: @playwright/test; API: page.locator(.nexus-vault-panel).textContent(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] 新建文件在 vault 树中可见

## EXP-07-03-N03 [P2] [正常] 切换文件 → 编辑器内容更新

**测试框架**: Playwright

**前置条件**: Vault 已打开 + 至少 2 个文件

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 点击 vault 树中的另一个文件 | [DOM] `.cm-content` 内容更新为新文件内容 | import: @playwright/test; API: page.click(.nexus-vault-panel >> text=filename); 框架: playwright; 等待: 500ms |
| 2 | 断言编辑器更新 | [DOM] `.cm-content` 不含前一文件内容 | import: @playwright/test; API: page.locator(.cm-content).textContent(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] 切换文件后编辑器内容正确更新

## EXP-07-04-N04 [P2] [正常] Save 按钮 → 保存当前文件

**测试框架**: Playwright

**前置条件**: Vault 已打开 + 文件已修改（dirty 状态）

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 点击 Save 按钮 | [DOM] dirty 标记消失 | import: @playwright/test; API: page.click(button:has-text(Save)); 框架: playwright; 等待: 500ms |
| 2 | 断言 | [DOM] 状态栏不再显示 "[modified]" | import: @playwright/test; API: page.locator(body).textContent(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] 保存后文件不再标记为已修改

---

## 统计汇总

- 总用例数: 32
- 章节数: 7
- 类型分布: 正常(N) 28 / 异常(E) 1 / 边界(B) 1 / 流程(F) 2
- 优先级分布: P1 6 / P2 18 / P3 5 / P4 3

## 探索发现备注

1. **playwright_evaluate 的 execCommand 在 MCP 上下文不生效** — 原因可能是 MCP 的 evaluate 上下文与页面焦点不同步。解决: 用 `page.keyboard.type()` 替代 `execCommand("insertText")`
2. **斜杠菜单 dismissed 锁存** — 连续打开/关闭后可能无法立即再次打开，需先输入非 `/` 字符清除锁存
3. **Ctrl+F 快捷键未触发搜索栏** — 可能被 CM6 或 Electron 拦截，改用点击 🔍 按钮触发
4. **字数统计 CSS 选择器** — `[data-test-id=nexus-wordcount-words]` / `[data-test-id=nexus-wordcount-characters]` 为稳定断言点

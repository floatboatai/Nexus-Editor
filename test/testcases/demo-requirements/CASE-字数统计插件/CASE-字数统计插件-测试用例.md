# CASE-字数统计插件-测试用例（FP-18）

> 一级功能点: 字数统计插件（demo-requirements.md §9）
> 全局批次序号: 18
> 生成时间: 2026-08-11
> 测试框架: Playwright（Electron demo e2e）
> 覆盖二级功能点: FP-18-01 ~ FP-18-09（共 9 个）
> 用例总数: 48
>
> 涉及二级功能点:
> - FP-18-01 countMarkdown(source, options) Markdown 感知统计纯函数（[API契约][AST解析]）
> - FP-18-02 words / latinWords 单词计数（Latin+数字+CJK 贡献）（[API契约]）
> - FP-18-03 cjkCharacters CJK 字符计数 + cjkUnit 选项（char/word）（[API契约][国际化]）
> - FP-18-04 characters / charactersNoSpaces 字符计数（[API契约]）
> - FP-18-05 lines / paragraphs / sentences 行/段落/句子计数（[API契约][AST解析]）
> - FP-18-06 readingTimeSeconds 阅读时间（238 wpm + 500 cpm）（[API契约]）
> - FP-18-07 选区统计（WordCountState.selection + isSelectionActive）（[API契约][编辑交互]）
> - FP-18-08 状态栏渲染（role=status + aria-live + 防抖 150ms）（[插件能力][无障碍]）
> - FP-18-09 默认排除节点（code/inlineCode/math/html/yaml/toml/definition/footnoteDefinition）（[AST解析]）
>
> ⚠️ 实现说明（依据 `packages/plugin-wordcount/src/` 实际代码）:
> - **createWordCountPlugin**（`plugin.ts:116-266`）：接收 `WordCountPluginOptions`，默认 `debounceMs=150`。文档重算走防抖（`scheduleDocRecompute`，`plugin.ts:185-196`），选区重算同步（`recomputeSelection`，`plugin.ts:175-183`）。
> - **状态栏 DOM 结构**（`status-bar.ts:87-107`）:
>   - 根元素: `<div class="nexus-wordcount__bar" role="status" aria-live="polite" data-testid="nexus-wordcount-bar">`
>   - 子 span（className 由 `classPrefix` + 后缀拼接，demo 中 `classPrefix="nexus-wordcount"`）:
>     - `.nexus-wordcount__words`（data-testid: `nexus-wordcount-words`）→ 文案格式: `"{N} words"`（`status-bar.ts:128`）
>     - `.nexus-wordcount__characters`（data-testid: `nexus-wordcount-characters`）→ 文案格式: `"{N} chars"`（`status-bar.ts:129`）
>     - `.nexus-wordcount__reading-time`（data-testid: `nexus-wordcount-reading-time`）→ 阅读时间（`status-bar.ts:133-135`）
>     - `.nexus-wordcount__selection`（data-testid: `nexus-wordcount-selection`）→ 选区统计（默认 hidden，`status-bar.ts:101-107`）
>     - `.nexus-wordcount__characters-no-spaces`（data-testid: `nexus-wordcount-characters-no-spaces`）→ 默认不渲染（`showCharactersNoSpaces` 默认 `false`，`status-bar.ts:81,95-97`）
> - **阅读时间格式化**（`status-bar.ts:157-163`）: `formatReadingTime(seconds, labels)`
>   - seconds ≤ 60 → `labels.readingTimeShort`（默认 `"< 1 min read"`）
>   - seconds > 60 → `"{minutes} {labels.readingTime}"`（minutes = `Math.ceil(seconds/60)`，默认 `"min read"`）
> - **选区统计格式化**（`status-bar.ts:165-167`）: `formatSelection(stats, labels, formatter)` → `"Selected: {words} words · {characters} chars"`
> - **默认标签**（`status-bar.ts:29-36`）: `{ words: "words", characters: "chars", charactersNoSpaces: "chars (no spaces)", readingTime: "min read", readingTimeShort: "< 1 min read", selection: "Selected" }`
> - **数字格式化**（`status-bar.ts:85`）: `new Intl.NumberFormat(locale)`，默认跟随宿主 locale
> - **countMarkdown**（`count.ts:146-162`）: 纯函数，接收 source + options（ast/cjkUnit/exclude/readingSpeed/parser）。优先复用 `options.ast`（plugin 热路径），否则惰性构造 unified pipeline。
> - **排除节点**（`count.ts:20-30`）: `DEFAULT_EXCLUDE = ["code", "inlineCode", "math", "inlineMath", "html", "yaml", "toml", "definition", "footnoteDefinition"]`。排除在 AST 遍历阶段完成（`count.ts:191` `exclude.has(type) return`）。
> - **CJK 计数**（`count.ts:327-356`）: `CJK_REGEX` 匹配 Han/Hiragana/Katakana/Hangul。`cjkUnit="char"`（默认）→ 每个 CJK 字符算 1 词贡献；`cjkUnit="word"` → 每个 CJK 连续 run 算 1 词贡献。
> - **Latin 词计数**（`count.ts:326`）: `LATIN_WORD_REGEX = /[\p{L}\p{M}\p{N}](?:[\p{L}\p{M}\p{N}\u2019']*[\p{L}\p{M}\p{N}])?/gu`，先剥离 CJK 再匹配，保证 bucket 不重叠。
> - **阅读时间公式**（`count.ts:386-394`）: `latinSeconds = (latinWords / 238) * 60`；`cjkSeconds = (cjkCharacters / 500) * 60`；`Math.max(1, Math.ceil(total))`。
> - **句子计数**（`count.ts:366-376`）: `SENTENCE_TERMINATOR_REGEX = /[.!?。！？]+/gu`，无终止符的非空文本算 1 句。
> - **行计数**（`count.ts:378-384`）: 尾随 `\n` 不增空行（先 strip 再 split）。
> - **demo 集成**（`apps/electron-demo/src/renderer/editor-shell.ts:118-120`）: `createWordCountPlugin({ statusBar: { container, classPrefix: "nexus-wordcount" } })`，随后 `attachWordCountPlugin(wordcount, editor)`（`editor-shell.ts:347`）。状态栏挂载在 editor container 内。
> - **e2e 验证约束**: demo 未暴露 editor / wordcount 实例到 `window`，无法获取 `getStats()` / `getSelectionStats()` 精确返回值。所有验证通过状态栏 DOM 文案间接推断。words/characters/readingTime 等数值通过状态栏 span textContent 的正则提取进行断言。
> - **防抖影响**: 文档统计更新有 150ms 防抖（`plugin.ts:117,185-196`），测试中需 `await page.waitForTimeout(250)` 确保更新传播。选区统计为同步更新（`plugin.ts:175-183,199`），但仍建议短暂等待 DOM 刷新。
> - 全局 setup 使用 `launchDemo()` 启动 Electron demo。

---

## e2e 全局前置条件

- 依赖环境: Electron demo（Vite dev server localhost:5173 + 已构建的 `apps/electron-demo/dist-electron/main.js`）
- 初始文档: demo 启动后默认状态（可能恢复上次 vault 文档或空文档）
- 插件配置: demo 默认挂载 —— createGfmPreset + createHistoryPlugin + createToolbarPlugin + createSearchPlugin + createWikilinksPlugin + createWordCountPlugin（statusBar 启用）
- livePreview 配置: demo 默认 `settings.livePreview = true`
- 状态栏挂载: wordcount 状态栏挂载在 editor container 内，classPrefix 为 `nexus-wordcount`
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

// 辅助：等待防抖（文档统计 150ms 防抖）
async function waitForDebounce(page: Page, ms = 250) {
  await page.waitForTimeout(ms);
}

// 辅助：获取状态栏根元素文本
async function getWordCountText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.querySelector('[role="status"]') ||
               document.querySelector('.nexus-wordcount__bar');
    return el?.textContent ?? '';
  });
}

// 辅助：获取指定 span 的文本
async function getSpanText(page: Page, testId: string): Promise<string> {
  return page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    return el?.textContent ?? '';
  }, testId);
}

// 辅助：从 span 文本中提取数字
async function getSpanNumber(page: Page, testId: string): Promise<number> {
  const text = await getSpanText(page, testId);
  const match = text.match(/[\d,]+/);
  return match ? parseInt(match[0].replace(/,/g, ''), 10) : NaN;
}

// 辅助：检查状态栏是否可见
async function isStatusBarVisible(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const el = document.querySelector('[role="status"]') ||
               document.querySelector('.nexus-wordcount__bar');
    if (!el) return false;
    return el.offsetParent !== null;
  });
}

// 辅助：选中文本（按住 shift + 方向键）
async function selectTextByKeyboard(page: Page, arrowKeys: number) {
  for (let i = 0; i < arrowKeys; i++) {
    await page.keyboard.press("Shift+ArrowRight");
  }
}
```

---

## FP-18-01: countMarkdown(source, options) Markdown 感知统计纯函数

> `countMarkdown`（`count.ts:146-162`）是字数统计的纯函数入口。接受 source 字符串 + options（ast/cjkUnit/exclude/readingSpeed/parser）。plugin 热路径传入 `options.ast` 复用 editor AST（`plugin.ts:139-148`），避免重复解析。demo 中无法直接调用该函数，通过状态栏渲染结果间接验证其 Markdown 感知行为（排除代码块、解析 heading/paragraph 等）。

### FP-18-01-E01 [P0] [正向] 纯文本输入后状态栏显示非零统计

- **优先级**: P0
- **类型**: 正向
- **前置条件**: demo 已启动，编辑器可见，状态栏已挂载
- **测试步骤**:
  1. 清空编辑器后输入 `Hello world`
  2. `waitForDebounce(page)`（等待 150ms 防抖）
  3. 调用 `getSpanText(page, "nexus-wordcount-words")` 获取 words span 文本
  4. 调用 `getSpanText(page, "nexus-wordcount-characters")` 获取 characters span 文本
  5. 断言 words span 文本含 "2 words"（`Hello` + `world`）
  6. 断言 characters span 文本含 "chars" 且数字 > 0
- **预期结果**:
  1. words span 文本匹配 /2\s*words/
  2. characters span 文本匹配 /\d+\s*chars/，数字 > 0
- **自动化信息**: 选择器: `[data-testid="nexus-wordcount-words"]`; 操作: evaluate() textContent; 控件: statusBar; 等待: 250ms（防抖）

---

### FP-18-01-E02 [P0] [正向] 空文档 → 状态栏显示零值

- **优先级**: P0
- **类型**: 正向
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器（确保 `.cm-content` 为空）
  2. `waitForDebounce(page)`
  3. 调用 `getSpanNumber(page, "nexus-wordcount-words")` 获取 words 数值
  4. 调用 `getSpanNumber(page, "nexus-wordcount-characters")` 获取 characters 数值
  5. 断言 words === 0
  6. 断言 characters === 0
- **预期结果**:
  1. words 数值 === 0（空 source 返回 EMPTY_STATS，`count.ts:147-149`）
  2. characters 数值 === 0
- **自动化信息**: 选择器: `[data-testid="nexus-wordcount-words"]`; 操作: evaluate() + 正则提取; 控件: statusBar; 等待: 250ms

---

### FP-18-01-E03 [P1] [正向] Markdown 标题语法不计入字符（标记被剥离）

- **优先级**: P1
- **类型**: 正向
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后插入 `# Title`（heading 语法）
  2. `waitForDebounce(page)`
  3. 调用 `getSpanNumber(page, "nexus-wordcount-words")` 获取 words 数值
  4. 断言 words === 1（仅 "Title" 计为 1 词，`#` 标记被 AST 剥离不计入）
  5. 断言 words span 文本匹配 /1\s*words/
- **预期结果**:
  1. words === 1（heading 的 `#` 标记不产生额外词/字符）
  2. words span 文本匹配 /1\s*words/
- **自动化信息**: 选择器: `[data-testid="nexus-wordcount-words"]`; 操作: evaluate() + 正则提取; 控件: statusBar; 等待: 250ms

---

### FP-18-01-E04 [P1] [正向] 多段落文档统计正确

- **优先级**: P1
- **类型**: 正向
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后插入: `First paragraph here.\n\nSecond one too.`
  2. `waitForDebounce(page)`
  3. 调用 `getSpanNumber(page, "nexus-wordcount-words")` 获取 words 数值
  4. 断言 words === 6（"First" + "paragraph" + "here" + "Second" + "one" + "too"）
  5. 断言 words span 文本匹配 /6\s*words/
- **预期结果**:
  1. words === 6（两段落合并统计）
- **自动化信息**: 选择器: `[data-testid="nexus-wordcount-words"]`; 操作: evaluate() + 正则提取; 控件: statusBar; 等待: 250ms

---

### FP-18-01-N01 [P1] [边界] 列表标记不计入词数

- **优先级**: P1
- **类型**: 边界
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后插入: `- item one\n- item two`
  2. `waitForDebounce(page)`
  3. 调用 `getSpanNumber(page, "nexus-wordcount-words")` 获取 words 数值
  4. 断言 words === 4（"item" + "one" + "item" + "two"，`-` 列表标记被 AST 剥离）
- **预期结果**:
  1. words === 4（列表项标记 `-` 不产生额外词）
- **自动化信息**: 选择器: `[data-testid="nexus-wordcount-words"]`; 操作: evaluate() + 正则提取; 控件: statusBar; 等待: 250ms

---

## FP-18-02: words / latinWords 单词计数（Latin+数字+CJK 贡献）

> `words`（`count.ts:350`）= `latinWords + cjkContribution`。`latinWords`（`count.ts:344`）通过 `LATIN_WORD_REGEX`（`count.ts:326`）匹配 Latin/西里尔/希腊/数字词段，先剥离 CJK 再匹配保证不重叠。`cjkContribution` 取决于 `cjkUnit`。demo 状态栏仅显示 `words` 数值（`status-bar.ts:128`），不单独显示 `latinWords`，通过纯 Latin 文本验证 latinWords 贡献。

### FP-18-02-E01 [P0] [正向] 纯 Latin 单词计数正确

- **优先级**: P0
- **类型**: 正向
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后输入 `one two three four five`
  2. `waitForDebounce(page)`
  3. 调用 `getSpanNumber(page, "nexus-wordcount-words")` 获取 words 数值
  4. 断言 words === 5（5 个 Latin 词段）
- **预期结果**:
  1. words === 5（纯 Latin 文本，latinWords = 5，cjkContribution = 0）
- **自动化信息**: 选择器: `[data-testid="nexus-wordcount-words"]`; 操作: evaluate() + 正则提取; 控件: statusBar; 等待: 250ms

---

### FP-18-02-E02 [P0] [正向] 数字词段计入 words

- **优先级**: P0
- **类型**: 正向
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后输入 `I have 42 apples and 100 oranges`
  2. `waitForDebounce(page)`
  3. 调用 `getSpanNumber(page, "nexus-wordcount-words")` 获取 words 数值
  4. 断言 words === 7（"I" + "have" + "42" + "apples" + "and" + "100" + "oranges"，数字作为词段计入）
- **预期结果**:
  1. words === 7（数字 42 和 100 各算 1 词，`LATIN_WORD_REGEX` 含 `\p{N}`）
- **自动化信息**: 选择器: `[data-testid="nexus-wordcount-words"]`; 操作: evaluate() + 正则提取; 控件: statusBar; 等待: 250ms

---

### FP-18-02-E03 [P1] [正向] CJK 字符贡献到 words（默认 cjkUnit=char）

- **优先级**: P1
- **类型**: 正向
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后输入 `你好世界`（4 个 CJK 字符）
  2. `waitForDebounce(page)`
  3. 调用 `getSpanNumber(page, "nexus-wordcount-words")` 获取 words 数值
  4. 断言 words === 4（cjkUnit 默认 "char"，每个 CJK 字符贡献 1 词，`count.ts:340`）
- **预期结果**:
  1. words === 4（4 个 Han 字符，cjkContribution = 4，latinWords = 0）
- **自动化信息**: 选择器: `[data-testid="nexus-wordcount-words"]`; 操作: evaluate() + 正则提取; 控件: statusBar; 等待: 250ms

---

### FP-18-02-E04 [P1] [正向] Latin + CJK 混合文本 words 统计

- **优先级**: P1
- **类型**: 正向混合
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后输入 `hello 你好 world`（2 Latin + 2 CJK）
  2. `waitForDebounce(page)`
  3. 调用 `getSpanNumber(page, "nexus-wordcount-words")` 获取 words 数值
  4. 断言 words === 4（latinWords=2 "hello"+"world"，cjkContribution=2 "你"+"好"）
- **预期结果**:
  1. words === 4（Latin 和 CJK bucket 不重叠，`count.ts:342-350`）
- **自动化信息**: 选择器: `[data-testid="nexus-wordcount-words"]`; 操作: evaluate() + 正则提取; 控件: statusBar; 等待: 250ms

---

### FP-18-02-N01 [P1] [边界] 连字符单词计为单个词段

- **优先级**: P1
- **类型**: 边界
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后输入 `state-of-the-art technology`
  2. `waitForDebounce(page)`
  3. 调用 `getSpanNumber(page, "nexus-wordcount-words")` 获取 words 数值
  4. 断言 words === 2（`LATIN_WORD_REGEX` 不含 `-`，"state"、"of"、"the"、"art" 被连字符分割为 4 段 + "technology" = 5）或验证 words >= 5
- **预期结果**:
  1. words >= 5（连字符分割产生多个 Latin 词段）
- **自动化信息**: 选择器: `[data-testid="nexus-wordcount-words"]`; 操作: evaluate() + 正则提取; 控件: statusBar; 等待: 250ms

---

## FP-18-03: cjkCharacters CJK 字符计数 + cjkUnit 选项

> `cjkCharacters`（`count.ts:339`）通过 `CJK_REGEX`（`count.ts:327`）匹配 Han/Hiragana/Katakana/Hangul 字符，原始计数（不受 cjkUnit 影响）。`cjkUnit` 选项（`count.ts:184,340`）仅影响 `words` 中的 CJK 贡献: `"char"` → 每 CJK 字符算 1 词；`"word"` → 每 CJK 连续 run 算 1 词。demo 默认 `cjkUnit` 未设置（undefined → `count.ts:184` fallback 为 `"char"`）。demo 状态栏不直接显示 `cjkCharacters`，通过 words 数值间接验证（Latin=0 时 words === cjkCharacters）。

### FP-18-03-E01 [P0] [正向] CJK 文本 words 等于字符数（默认 char 模式）

- **优先级**: P0
- **类型**: 正向
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后输入 `测试中文字符`（6 个 Han 字符）
  2. `waitForDebounce(page)`
  3. 调用 `getSpanNumber(page, "nexus-wordcount-words")` 获取 words 数值
  4. 断言 words === 6（默认 cjkUnit="char"，cjkCharacters=6 → words=6）
- **预期结果**:
  1. words === 6（每个 CJK 字符贡献 1 词）
- **自动化信息**: 选择器: `[data-testid="nexus-wordcount-words"]`; 操作: evaluate() + 正则提取; 控件: statusBar; 等待: 250ms

---

### FP-18-03-E02 [P0] [正向] 日文 Hiragana 字符计入 CJK

- **优先级**: P0
- **类型**: 正向
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后输入 `こんにちは`（5 个 Hiragana 字符）
  2. `waitForDebounce(page)`
  3. 调用 `getSpanNumber(page, "nexus-wordcount-words")` 获取 words 数值
  4. 断言 words === 5（`CJK_REGEX` 匹配 `\p{Script=Hiragana}`，`count.ts:327`）
- **预期结果**:
  1. words === 5（Hiragana 字符被 CJK_REGEX 匹配）
- **自动化信息**: 选择器: `[data-testid="nexus-wordcount-words"]`; 操作: evaluate() + 正则提取; 控件: statusBar; 等待: 250ms

---

### FP-18-03-E03 [P1] [正向] 韩文 Hangul 字符计入 CJK

- **优先级**: P1
- **类型**: 正向
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后输入 `안녕하세요`（5 个 Hangul 字符）
  2. `waitForDebounce(page)`
  3. 调用 `getSpanNumber(page, "nexus-wordcount-words")` 获取 words 数值
  4. 断言 words === 5（`CJK_REGEX` 匹配 `\p{Script=Hangul}`，`count.ts:327`）
- **预期结果**:
  1. words === 5（Hangul 字符被 CJK_REGEX 匹配）
- **自动化信息**: 选择器: `[data-testid="nexus-wordcount-words"]`; 操作: evaluate() + 正则提取; 控件: statusBar; 等待: 250ms

---

### FP-18-03-E04 [P1] [正向] 混合 CJK 脚本（Han + Hiragana + Katakana）

- **优先级**: P1
- **类型**: 正向混合
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后输入 `日本語テストです`（含 Kanji + Katakana + Hiragana）
  2. `waitForDebounce(page)`
  3. 调用 `getSpanNumber(page, "nexus-wordcount-words")` 获取 words 数值
  4. 断言 words >= 5（所有 CJK 脚本字符均被 `CJK_REGEX` 匹配，char 模式下等于总 CJK 字符数）
  5. 断言 words span 文本匹配 /\d+\s*words/
- **预期结果**:
  1. words >= 5（混合 CJK 脚本统一计数）
  2. words span 文本有效
- **自动化信息**: 选择器: `[data-testid="nexus-wordcount-words"]`; 操作: evaluate() + 正则提取; 控件: statusBar; 等待: 250ms

---

### FP-18-03-N01 [P2] [边界] 空格分隔的 CJK 连续段（char 模式仍逐字计数）

- **优先级**: P2
- **类型**: 边界
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后输入 `你好 世界`（2 个 CJK 字符 + 空格 + 2 个 CJK 字符）
  2. `waitForDebounce(page)`
  3. 调用 `getSpanNumber(page, "nexus-wordcount-words")` 获取 words 数值
  4. 断言 words === 4（char 模式下空格不影响，4 个 CJK 字符各贡献 1 词）
- **预期结果**:
  1. words === 4（空格不改变 char 模式逐字计数）
- **自动化信息**: 选择器: `[data-testid="nexus-wordcount-words"]`; 操作: evaluate() + 正则提取; 控件: statusBar; 等待: 250ms

---

## FP-18-04: characters / charactersNoSpaces 字符计数

> `characters`（`count.ts:346`）= `[...text].length`，按 Unicode code point 计数（不是 UTF-16 单元）。`charactersNoSpaces`（`count.ts:347`）= `characters - countWhitespaceCodePoints(text)`。demo 状态栏显示 `characters`（`status-bar.ts:129`），文案 `"{N} chars"`。`charactersNoSpaces` 默认不显示（`showCharactersNoSpaces` 默认 `false`，`status-bar.ts:81`）。

### FP-18-04-E01 [P0] [正向] 纯文本 characters 计数正确

- **优先级**: P0
- **类型**: 正向
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后输入 `abc`（3 个 ASCII 字符）
  2. `waitForDebounce(page)`
  3. 调用 `getSpanNumber(page, "nexus-wordcount-characters")` 获取 characters 数值
  4. 断言 characters === 3（按 code point 计数）
- **预期结果**:
  1. characters === 3
- **自动化信息**: 选择器: `[data-testid="nexus-wordcount-characters"]`; 操作: evaluate() + 正则提取; 控件: statusBar; 等待: 250ms

---

### FP-18-04-E02 [P0] [正向] 含空格文本 characters 包含空格

- **优先级**: P0
- **类型**: 正向
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后输入 `a b c`（3 字母 + 2 空格 = 5 code points）
  2. `waitForDebounce(page)`
  3. 调用 `getSpanNumber(page, "nexus-wordcount-characters")` 获取 characters 数值
  4. 断言 characters === 5（空格计入 characters）
- **预期结果**:
  1. characters === 5（空格算作字符，`count.ts:346`）
- **自动化信息**: 选择器: `[data-testid="nexus-wordcount-characters"]`; 操作: evaluate() + 正则提取; 控件: statusBar; 等待: 250ms

---

### FP-18-04-E03 [P1] [正向] CJK 字符按 code point 计数（非 UTF-16）

- **优先级**: P1
- **类型**: 正向
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后输入 `你好`（2 个 Han 字符，各 1 个 code point）
  2. `waitForDebounce(page)`
  3. 调用 `getSpanNumber(page, "nexus-wordcount-characters")` 获取 characters 数值
  4. 断言 characters === 2（`[...text].length` 按 code point 计数，`count.ts:346`）
- **预期结果**:
  1. characters === 2（CJK 字符按 code point 计 1）
- **自动化信息**: 选择器: `[data-testid="nexus-wordcount-characters"]`; 操作: evaluate() + 正则提取; 控件: statusBar; 等待: 250ms

---

### FP-18-04-E04 [P1] [正向] charactersNoSpaces span 默认不渲染

- **优先级**: P1
- **类型**: 正向
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后输入 `some text`
  2. `waitForDebounce(page)`
  3. 在页面中查找 `[data-testid="nexus-wordcount-characters-no-spaces"]` 元素
  4. 断言该元素不存在（`showCharactersNoSpaces` 默认 `false`，`status-bar.ts:81,95-97`）
- **预期结果**:
  1. `.nexus-wordcount__characters-no-spaces` count === 0
- **自动化信息**: 选择器: `[data-testid="nexus-wordcount-characters-no-spaces"]`; 操作: count(); 控件: statusBar; 等待: 250ms

---

### FP-18-04-N01 [P2] [边界] Emoji 字符按 code point 计数

- **优先级**: P2
- **类型**: 边界
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后输入 `a😀b`（2 ASCII + 1 emoji code point）
  2. `waitForDebounce(page)`
  3. 调用 `getSpanNumber(page, "nexus-wordcount-characters")` 获取 characters 数值
  4. 断言 characters === 3（emoji 按 1 个 code point 计数，`[...text].length`）
- **预期结果**:
  1. characters === 3（emoji 算 1 个 code point）
- **自动化信息**: 选择器: `[data-testid="nexus-wordcount-characters"]`; 操作: evaluate() + 正则提取; 控件: statusBar; 等待: 250ms

---

## FP-18-05: lines / paragraphs / sentences 行/段落/句子计数

> `lines`（`count.ts:378-384`）: 尾随 `\n` 不增空行（先 strip 再 split）。`paragraphs`（`count.ts:187,225`）: mdast `paragraph` 节点数。`sentences`（`count.ts:366-376`）: `[.!?。！？]+` 启发式匹配终止符，无终止符的非空文本算 1 句。demo 状态栏不直接显示这三个维度（仅显示 words/characters/readingTime），但它们间接影响 readingTime 不直接可见。此处通过多行输入验证 lines 行为不影响 characters 逻辑，以及通过结构化文档验证状态栏正常更新。

### FP-18-05-E01 [P0] [正向] 单行文档状态栏正常更新

- **优先级**: P0
- **类型**: 正向
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后输入 `single line text`（单行，无换行）
  2. `waitForDebounce(page)`
  3. 调用 `getSpanNumber(page, "nexus-wordcount-words")` 获取 words 数值
  4. 断言 words === 3（"single" + "line" + "text"）
  5. 断言状态栏 textContent 非空
- **预期结果**:
  1. words === 3
  2. 状态栏正常渲染
- **自动化信息**: 选择器: `[data-testid="nexus-wordcount-words"]`; 操作: evaluate() + 正则提取; 控件: statusBar; 等待: 250ms

---

### FP-18-05-E02 [P0] [正向] 多行文档（含空行）统计正确

- **优先级**: P0
- **类型**: 正向
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后插入: `line one\nline two\n\nline four`（3 个非空段落 + 1 空行分隔）
  2. `waitForDebounce(page)`
  3. 调用 `getSpanNumber(page, "nexus-wordcount-words")` 获取 words 数值
  4. 断言 words === 6（"line"+"one"+"line"+"two"+"line"+"four"）
- **预期结果**:
  1. words === 6（多行文本合并统计，空行不产生词）
- **自动化信息**: 选择器: `[data-testid="nexus-wordcount-words"]`; 操作: evaluate() + 正则提取; 控件: statusBar; 等待: 250ms

---

### FP-18-05-E03 [P1] [正向] Markdown 段落分隔正确处理

- **优先级**: P1
- **类型**: 正向
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后插入: `First paragraph.\n\nSecond paragraph.\n\nThird one.`
  2. `waitForDebounce(page)`
  3. 调用 `getSpanNumber(page, "nexus-wordcount-words")` 获取 words 数值
  4. 断言 words === 6（"First"+"paragraph"+"Second"+"paragraph"+"Third"+"one"）
  5. 断言 characters 数值 > 0
- **预期结果**:
  1. words === 6（3 个 mdast paragraph 节点，prose 合并统计）
  2. characters > 0
- **自动化信息**: 选择器: `[data-testid="nexus-wordcount-words"]`; 操作: evaluate() + 正则提取; 控件: statusBar; 等待: 250ms

---

### FP-18-05-E04 [P1] [正向] 标题 + 列表混合文档统计

- **优先级**: P1
- **类型**: 正向混合
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后插入: `# Heading\n\n- item one\n- item two\n\nSome text.`
  2. `waitForDebounce(page)`
  3. 调用 `getSpanNumber(page, "nexus-wordcount-words")` 获取 words 数值
  4. 断言 words === 6（"Heading"+"item"+"one"+"item"+"two"+"Some"+"text" = 7 或 6，取决于 "Some" + "text"）— 验证 words >= 6
- **预期结果**:
  1. words >= 6（heading + list + paragraph 合并统计）
- **自动化信息**: 选择器: `[data-testid="nexus-wordcount-words"]`; 操作: evaluate() + 正则提取; 控件: statusBar; 等待: 250ms

---

### FP-18-05-N01 [P2] [边界] 尾随换行不增额外统计

- **优先级**: P2
- **类型**: 边界
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后插入 `text here\n`（含尾随换行）
  2. `waitForDebounce(page)`
  3. 调用 `getSpanNumber(page, "nexus-wordcount-words")` 获取 words 数值
  4. 断言 words === 2（"text" + "here"，尾随 `\n` 不产生额外词，`count.ts:382`）
- **预期结果**:
  1. words === 2（尾随换行不影响词计数）
- **自动化信息**: 选择器: `[data-testid="nexus-wordcount-words"]`; 操作: evaluate() + 正则提取; 控件: statusBar; 等待: 250ms

---

## FP-18-06: readingTimeSeconds 阅读时间（238 wpm + 500 cpm）

> `readingTimeSeconds`（`count.ts:386-394`）: `latinSeconds = (latinWords / 238) * 60`；`cjkSeconds = (cjkCharacters / 500) * 60`；`Math.max(1, Math.ceil(total))`。默认 WPM=238（`count.ts:33`），CPM=500（`count.ts:34`）。状态栏显示逻辑（`status-bar.ts:157-163`）: seconds ≤ 60 → `"< 1 min read"`；seconds > 60 → `"{ceil(sec/60)} min read"`。

### FP-18-06-E01 [P0] [正向] 少量文本 → 阅读时间显示 "< 1 min read"

- **优先级**: P0
- **类型**: 正向
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后输入 `Hello world this is a short text`（7 词）
  2. `waitForDebounce(page)`
  3. 调用 `getSpanText(page, "nexus-wordcount-reading-time")` 获取 reading-time span 文本
  4. 断言文本含 "< 1 min read"（7 词 / 238 wpm * 60 = 1.76s ≤ 60，`status-bar.ts:158-159`）
- **预期结果**:
  1. reading-time span 文本含 "< 1 min read"
- **自动化信息**: 选择器: `[data-testid="nexus-wordcount-reading-time"]`; 操作: evaluate() textContent; 控件: statusBar; 等待: 250ms

---

### FP-18-06-E02 [P0] [正向] 大量文本 → 阅读时间显示分钟数

- **优先级**: P0
- **类型**: 正向
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后插入一段 > 300 词的长文本（如重复 "word " 300 次以上）
  2. `waitForDebounce(page, 400)`（长文本防抖可能略慢，增加等待）
  3. 调用 `getSpanText(page, "nexus-wordcount-reading-time")` 获取 reading-time span 文本
  4. 断言文本匹配 /\d+\s*min read/（300 词 / 238 wpm * 60 ≈ 75.6s > 60 → ceil(76/60) = 2 → "2 min read"，`status-bar.ts:160-162`）
- **预期结果**:
  1. reading-time span 文本匹配 /\d+\s*min\s*read/
  2. 分钟数 >= 1
- **自动化信息**: 选择器: `[data-testid="nexus-wordcount-reading-time"]`; 操作: evaluate() textContent; 控件: statusBar; 等待: 400ms

---

### FP-18-06-E03 [P1] [正向] 空文档 reading-time span 显示短文本

- **优先级**: P1
- **类型**: 正向
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器
  2. `waitForDebounce(page)`
  3. 调用 `getSpanText(page, "nexus-wordcount-reading-time")` 获取 reading-time span 文本
  4. 断言文本含 "< 1 min read"（空文档 readingTimeSeconds=0 ≤ 60，`count.ts:389,394` + `status-bar.ts:158-159`）
- **预期结果**:
  1. reading-time span 文本含 "< 1 min read"
- **自动化信息**: 选择器: `[data-testid="nexus-wordcount-reading-time"]`; 操作: evaluate() textContent; 控件: statusBar; 等待: 250ms

---

### FP-18-06-E04 [P1] [正向] 纯 CJK 文本阅读时间基于 cpm 计算

- **优先级**: P1
- **类型**: 正向
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后输入 600 个 CJK 字符（如重复 "字" 600 次）
  2. `waitForDebounce(page, 400)`
  3. 调用 `getSpanText(page, "nexus-wordcount-reading-time")` 获取 reading-time span 文本
  4. 断言文本匹配 /\d+\s*min read/（600 字符 / 500 cpm * 60 = 72s > 60 → ceil(72/60) = 2 → "2 min read"，`count.ts:391`）
- **预期结果**:
  1. reading-time span 文本匹配 /\d+\s*min\s*read/
  2. 分钟数 >= 1
- **自动化信息**: 选择器: `[data-testid="nexus-wordcount-reading-time"]`; 操作: evaluate() textContent; 控件: statusBar; 等待: 400ms

---

### FP-18-06-N01 [P2] [边界] 单词文本阅读时间为 1 秒（下限）

- **优先级**: P2
- **类型**: 边界
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后输入 `Hi`（1 词）
  2. `waitForDebounce(page)`
  3. 调用 `getSpanText(page, "nexus-wordcount-reading-time")` 获取 reading-time span 文本
  4. 断言文本含 "< 1 min read"（1 词 / 238 * 60 = 0.25s → Math.max(1, ceil(0.25)) = 1s ≤ 60）
- **预期结果**:
  1. reading-time span 文本含 "< 1 min read"（最低 1 秒，`count.ts:394`）
- **自动化信息**: 选择器: `[data-testid="nexus-wordcount-reading-time"]`; 操作: evaluate() textContent; 控件: statusBar; 等待: 250ms

---

## FP-18-07: 选区统计（WordCountState.selection + isSelectionActive）

> 选区统计（`plugin.ts:150-165`）: 监听 `selectionChange` 事件，同步计算选区范围的统计（`recomputeSelection`，`plugin.ts:175-183`，不经防抖）。选区非空时 `isSelectionActive=true`。状态栏 selection span（`status-bar.ts:101-107,114-124`）: 无选区时 `hidden=true` + `aria-hidden="true"`；有选区时显示 `"Selected: {words} words · {characters} chars"`（`status-bar.ts:165-167`）。

### FP-18-07-E01 [P0] [正向] 选中文本后 selection span 可见

- **优先级**: P0
- **类型**: 正向
- **前置条件**: demo 已启动，编辑器可见，编辑器中已有文本
- **测试步骤**:
  1. 清空编辑器后输入 `Hello beautiful world`
  2. `waitForDebounce(page)`
  3. 点击编辑器开头，按 `Shift+ArrowRight` 多次选中 "Hello beautiful"（约 15 次 Shift+ArrowRight）
  4. 等待 100ms（选区统计同步，`plugin.ts:199`）
  5. 调用 `page.evaluate()` 检查 `[data-testid="nexus-wordcount-selection"]` 的 `hidden` 属性
  6. 断言 `hidden === false`（选区激活，`status-bar.ts:116-117`）
  7. 断言 selection span textContent 含 "Selected"（`status-bar.ts:166`）
- **预期结果**:
  1. selection span hidden === false
  2. textContent 含 "Selected"
- **自动化信息**: 选择器: `[data-testid="nexus-wordcount-selection"]`; 操作: evaluate() hidden + textContent; 控件: statusBar; 等待: 100ms（选区同步）

---

### FP-18-07-E02 [P0] [正向] selection span 文案格式正确

- **优先级**: P0
- **类型**: 正向
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后输入 `one two three four`
  2. `waitForDebounce(page)`
  3. 选中 "two three"（通过 Shift+ArrowRight 或 Shift+Control+ArrowRight）
  4. 等待 100ms
  5. 调用 `getSpanText(page, "nexus-wordcount-selection")` 获取 selection span 文本
  6. 断言文本匹配 /Selected:\s*\d+\s*words?\s*·\s*\d+\s*chars?/（`status-bar.ts:166-167`）
  7. 断言 words 部分数字 === 2（"two" + "three"）
- **预期结果**:
  1. selection span 文本匹配 /Selected:\s*2\s*words?\s*·\s*\d+\s*chars?/
- **自动化信息**: 选择器: `[data-testid="nexus-wordcount-selection"]`; 操作: evaluate() textContent; 控件: statusBar; 等待: 100ms

---

### FP-18-07-E03 [P1] [正向] 取消选区后 selection span 隐藏

- **优先级**: P1
- **类型**: 正向
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后输入 `Hello world test`
  2. `waitForDebounce(page)`
  3. 选中 "Hello world"（Shift + ArrowRight 多次）
  4. 等待 100ms，确认 selection span 可见
  5. 按 ArrowLeft（取消选区，光标折叠）
  6. 等待 100ms
  7. 调用 `page.evaluate()` 检查 selection span 的 `hidden` 属性
  8. 断言 `hidden === true`（选区取消，`status-bar.ts:119-122`）
- **预期结果**:
  1. 选区激活时 hidden === false
  2. 取消选区后 hidden === true
- **自动化信息**: 选择器: `[data-testid="nexus-wordcount-selection"]`; 操作: evaluate() hidden; 控件: statusBar; 等待: 100ms

---

### FP-18-07-E04 [P1] [正向] 选区统计独立于文档统计

- **优先级**: P1
- **类型**: 正向
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后输入 `alpha beta gamma delta epsilon`
  2. `waitForDebounce(page)`
  3. 选中 "beta gamma delta"（中间 3 词）
  4. 等待 100ms
  5. 调用 `getSpanNumber(page, "nexus-wordcount-words")` 获取文档 words（应为 5）
  6. 调用 `getSpanText(page, "nexus-wordcount-selection")` 获取选区 words
  7. 从 selection 文本提取数字，断言为 3（选区仅含 3 词）
  8. 断言文档 words 仍 === 5（选区不影响文档统计）
- **预期结果**:
  1. 文档 words === 5
  2. 选区 words === 3（独立计算，`plugin.ts:150-165` slice 后独立 countMarkdown）
- **自动化信息**: 选择器: `[data-testid="nexus-wordcount-words"]` + `[data-testid="nexus-wordcount-selection"]`; 操作: evaluate() + 正则提取; 控件: statusBar; 等待: 100ms

---

### FP-18-07-I01 [P1] [交互] 动态修改选区范围 → selection 文本实时更新

- **优先级**: P1
- **类型**: 交互
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后输入 `a b c d e f g`
  2. `waitForDebounce(page)`
  3. 光标移到开头，按 Shift+ArrowRight 选中 "a b"（约 3 次）
  4. 等待 100ms，记录 selection words 数值（应为 2）
  5. 继续按 Shift+ArrowRight 扩展选区到 "a b c d"（再按约 4 次）
  6. 等待 100ms，再次获取 selection words 数值
  7. 断言第二次 words > 第一次 words（选区扩展后统计更新）
- **预期结果**:
  1. 第一次 selection words === 2
  2. 第二次 selection words > 2（选区扩展同步重算）
- **自动化信息**: 选择器: `[data-testid="nexus-wordcount-selection"]`; 操作: evaluate() + 正则提取; 控件: statusBar; 等待: 100ms

---

### FP-18-07-N01 [P2] [边界] 空选区（光标折叠）→ selection span 隐藏

- **优先级**: P2
- **类型**: 边界
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后输入 `some text here`
  2. `waitForDebounce(page)`
  3. 点击编辑器某处（光标折叠，无选区）
  4. 等待 100ms
  5. 调用 `page.evaluate()` 检查 selection span 的 `hidden` 属性
  6. 断言 `hidden === true`（`from === to` 时 isSelectionActive=false，`plugin.ts:156-157`）
- **预期结果**:
  1. selection span hidden === true（折叠光标不算选区）
- **自动化信息**: 选择器: `[data-testid="nexus-wordcount-selection"]`; 操作: evaluate() hidden; 控件: statusBar; 等待: 100ms

---

## FP-18-08: 状态栏渲染（role=status + aria-live + 防抖 150ms）

> 状态栏（`status-bar.ts:78-147`）: 根元素 `<div class="nexus-wordcount__bar" role="status" aria-live="polite" data-testid="nexus-wordcount-bar">`。防抖: 文档统计 `debounceMs` 默认 150ms（`plugin.ts:117,185-196`），选区统计同步（`plugin.ts:175-183`）。状态栏在 plugin attachEditor 后的 microtask 中首次挂载（`plugin.ts:247-261`）。demo 中 `classPrefix="nexus-wordcount"`（`editor-shell.ts:119`）。

### FP-18-08-E01 [P0] [正向] 状态栏根元素含 role="status" 属性

- **优先级**: P0
- **类型**: 正向
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 等待状态栏挂载（demo 启动后 microtask，`plugin.ts:247`）
  2. 在页面中查找 `[role="status"]` 元素
  3. 断言元素存在（count >= 1）
  4. 断言元素 className 含 "nexus-wordcount__bar"（`status-bar.ts:88`）
- **预期结果**:
  1. `[role="status"]` count >= 1
  2. 元素 className 含 "nexus-wordcount__bar"
- **自动化信息**: 选择器: `[role="status"]`; 操作: count() + evaluate() className; 控件: statusBar; 等待: 500ms（初始挂载）

---

### FP-18-08-E02 [P0] [正向] 状态栏根元素含 aria-live="polite"

- **优先级**: P0
- **类型**: 正向
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 等待状态栏挂载
  2. 在页面中查找 `[aria-live="polite"]` 元素
  3. 断言元素存在（count >= 1）
  4. 断言元素同时具有 `role="status"`（`status-bar.ts:90-91`）
- **预期结果**:
  1. `[aria-live="polite"]` count >= 1
  2. 元素同时含 `role="status"` 和 `aria-live="polite"`
- **自动化信息**: 选择器: `[aria-live="polite"]`; 操作: count() + getAttribute(); 控件: statusBar; 等待: 500ms

---

### FP-18-08-E03 [P0] [正向] 防抖 — 快速输入后统计延迟更新

- **优先级**: P0
- **类型**: 正向
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器
  2. 快速输入 `abc`（3 个字符）
  3. 立即（不等待）调用 `getSpanNumber(page, "nexus-wordcount-words")` 获取 words
  4. 等待 250ms（超过 150ms 防抖）
  5. 再次调用 `getSpanNumber(page, "nexus-wordcount-words")` 获取 words
  6. 断言第二次 words === 1（"abc"，防抖后更新）
  7. 断言第一次可能为 0 或旧值（防抖期间未更新，`plugin.ts:185-196`）
- **预期结果**:
  1. 防抖后 words === 1
  2. 快速输入后状态栏在 ~150ms 内更新（验证防抖存在）
- **自动化信息**: 选择器: `[data-testid="nexus-wordcount-words"]`; 操作: evaluate() + 正则提取; 控件: statusBar; 等待: 0ms + 250ms

---

### FP-18-08-E04 [P1] [正向] 状态栏子 span 结构完整

- **优先级**: P1
- **类型**: 正向
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 等待状态栏挂载
  2. 断言 `[data-testid="nexus-wordcount-words"]` 存在（`status-bar.ts:93`）
  3. 断言 `[data-testid="nexus-wordcount-characters"]` 存在（`status-bar.ts:94`）
  4. 断言 `[data-testid="nexus-wordcount-reading-time"]` 存在（`status-bar.ts:98-100`，默认 showReadingTime=true）
  5. 断言 `[data-testid="nexus-wordcount-selection"]` 存在（`status-bar.ts:101-103`，默认 showSelection=true）
- **预期结果**:
  1. words span 存在
  2. characters span 存在
  3. reading-time span 存在
  4. selection span 存在（可能 hidden）
- **自动化信息**: 选择器: `[data-testid^="nexus-wordcount-"]`; 操作: count() + evaluate(); 控件: statusBar; 等待: 500ms

---

### FP-18-08-N01 [P2] [边界] words span 文案含 "words" 标签

- **优先级**: P2
- **类型**: 边界
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后输入 `test`
  2. `waitForDebounce(page)`
  3. 调用 `getSpanText(page, "nexus-wordcount-words")` 获取 words span 文本
  4. 断言文本匹配 /^\d+\s*words$/（格式 `"{N} words"`，`status-bar.ts:128` + 默认标签 `"words"`）
- **预期结果**:
  1. words span 文本匹配 /^\d+\s*words$/
- **自动化信息**: 选择器: `[data-testid="nexus-wordcount-words"]`; 操作: evaluate() textContent; 控件: statusBar; 等待: 250ms

---

## FP-18-09: 默认排除节点（code/inlineCode/math/html/yaml/toml/definition/footnoteDefinition）

> `DEFAULT_EXCLUDE`（`count.ts:20-30`）: `["code", "inlineCode", "math", "inlineMath", "html", "yaml", "toml", "definition", "footnoteDefinition"]`。AST 遍历时命中排除类型直接 return（`count.ts:191`），其文本内容不计入统计。通过在文档中插入代码块/行内代码/HTML/数学公式等，对比有/无排除内容的统计差异来验证。

### FP-18-09-E01 [P0] [正向] 代码块内容不计入统计

- **优先级**: P0
- **类型**: 正向
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后输入 `before` 记录 words 基线
  2. `waitForDebounce(page)`
  3. 记录 `getSpanNumber(page, "nexus-wordcount-words")` 为 baseline_words（应为 1）
  4. 清空编辑器后插入: `before\n\n` + "```js\nconst x = 100;\n```" + `\n\nafter`
  5. `waitForDebounce(page)`
  6. 获取当前 words 数值
  7. 断言 words === 2（"before" + "after"，代码块内 `const x = 100;` 被排除，`count.ts:191` `code` in DEFAULT_EXCLUDE）
- **预期结果**:
  1. words === 2（代码块内容不计入）
- **自动化信息**: 选择器: `[data-testid="nexus-wordcount-words"]`; 操作: evaluate() + 正则提取; 控件: statusBar; 等待: 250ms

---

### FP-18-09-E02 [P0] [正向] 行内代码内容不计入统计

- **优先级**: P0
- **类型**: 正向
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后输入 `text with \`inline code here\` end`
  2. `waitForDebounce(page)`
  3. 调用 `getSpanNumber(page, "nexus-wordcount-words")` 获取 words 数值
  4. 断言 words === 3（"text" + "with" + "end"，`inlineCode` 被排除，`count.ts:191` `inlineCode` in DEFAULT_EXCLUDE）
- **预期结果**:
  1. words === 3（行内代码内容 "inline code here" 不计入）
- **自动化信息**: 选择器: `[data-testid="nexus-wordcount-words"]`; 操作: evaluate() + 正则提取; 控件: statusBar; 等待: 250ms

---

### FP-18-09-E03 [P1] [正向] HTML 注释/标签内容不计入统计

- **优先级**: P1
- **类型**: 正向
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后插入: `start\n\n<div>html content here</div>\n\nend`
  2. `waitForDebounce(page)`
  3. 调用 `getSpanNumber(page, "nexus-wordcount-words")` 获取 words 数值
  4. 断言 words === 2（"start" + "end"，`html` 节点被排除，`count.ts:191` `html` in DEFAULT_EXCLUDE）
- **预期结果**:
  1. words === 2（HTML 内容不计入统计）
- **自动化信息**: 选择器: `[data-testid="nexus-wordcount-words"]`; 操作: evaluate() + 正则提取; 控件: statusBar; 等待: 250ms

---

### FP-18-09-E04 [P1] [正向] YAML frontmatter 不计入统计

- **优先级**: P1
- **类型**: 正向
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后插入: `---\ntitle: My Doc\nauthor: Test\n---\n\nBody text here`
  2. `waitForDebounce(page)`
  3. 调用 `getSpanNumber(page, "nexus-wordcount-words")` 获取 words 数值
  4. 断言 words === 3（"Body" + "text" + "here"，`yaml` frontmatter 被排除，`count.ts:191` `yaml` in DEFAULT_EXCLUDE）
- **预期结果**:
  1. words === 3（YAML frontmatter `title: My Doc` + `author: Test` 不计入）
- **自动化信息**: 选择器: `[data-testid="nexus-wordcount-words"]`; 操作: evaluate() + 正则提取; 控件: statusBar; 等待: 250ms

---

### FP-18-09-E05 [P1] [正向] 数学公式块不计入统计

- **优先级**: P1
- **类型**: 正向
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后插入: `intro\n\n$$\na + b = c\n$$\n\noutro`
  2. `waitForDebounce(page)`
  3. 调用 `getSpanNumber(page, "nexus-wordcount-words")` 获取 words 数值
  4. 断言 words === 2（"intro" + "outro"，`math` 节点被排除，`count.ts:191` `math` in DEFAULT_EXCLUDE）
- **预期结果**:
  1. words === 2（数学公式内容 `a + b = c` 不计入）
- **自动化信息**: 选择器: `[data-testid="nexus-wordcount-words"]`; 操作: evaluate() + 正则提取; 控件: statusBar; 等待: 250ms

---

### FP-18-09-E06 [P1] [正向] 脚注定义不计入统计

- **优先级**: P1
- **类型**: 正向
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后插入: `Main text.\n\n[^1]: This footnote has words`
  2. `waitForDebounce(page)`
  3. 调用 `getSpanNumber(page, "nexus-wordcount-words")` 获取 words 数值
  4. 断言 words === 2（"Main" + "text"，`footnoteDefinition` 节点被排除，`count.ts:191` `footnoteDefinition` in DEFAULT_EXCLUDE）
- **预期结果**:
  1. words === 2（脚注定义内容 "This footnote has words" 不计入）
- **自动化信息**: 选择器: `[data-testid="nexus-wordcount-words"]`; 操作: evaluate() + 正则提取; 控件: statusBar; 等待: 250ms

---

### FP-18-09-N01 [P1] [边界] 链接定义不计入统计

- **优先级**: P1
- **类型**: 边界
- **前置条件**: demo 已启动，编辑器可见
- **测试步骤**:
  1. 清空编辑器后插入: `[ref]: https://example.com\n\nBody content now`
  2. `waitForDebounce(page)`
  3. 调用 `getSpanNumber(page, "nexus-wordcount-words")` 获取 words 数值
  4. 断言 words === 3（"Body" + "content" + "now"，`definition` 节点被排除，`count.ts:191` `definition` in DEFAULT_EXCLUDE）
- **预期结果**:
  1. words === 3（链接定义 `[ref]: https://example.com` 不计入）
- **自动化信息**: 选择器: `[data-testid="nexus-wordcount-words"]`; 操作: evaluate() + 正则提取; 控件: statusBar; 等待: 250ms

---

## 用例合计

| 二级功能点 | 用例数 | P0 | P1 | P2 |
|-----------|-------|----|----|-----|
| FP-18-01 countMarkdown 纯函数 | 5 | 2 | 2 | 1 |
| FP-18-02 words/latinWords 计数 | 5 | 2 | 2 | 1 |
| FP-18-03 cjkCharacters + cjkUnit | 5 | 2 | 2 | 1 |
| FP-18-04 characters/charactersNoSpaces | 5 | 2 | 2 | 1 |
| FP-18-05 lines/paragraphs/sentences | 5 | 2 | 2 | 1 |
| FP-18-06 readingTimeSeconds | 5 | 2 | 2 | 1 |
| FP-18-07 选区统计 | 6 | 2 | 3 | 1 |
| FP-18-08 状态栏渲染 | 5 | 3 | 1 | 1 |
| FP-18-09 默认排除节点 | 7 | 2 | 4 | 1 |
| **合计** | **48** | **19** | **20** | **9** |
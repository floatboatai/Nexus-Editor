# Nexus_Editor 测试模式参考

> 本文件为 fp2tc 技能提供 Nexus_Editor 项目的测试模式参考。
> 阶段B增强时，子智能体可读取此文件获取通用的测试 setup 模式和断言模式。
> ⚠️ 运行时不自动加载完整文件，仅在需要时 Grep 搜索特定章节。

---

## 1. Vitest 单元测试模式

### 1.1 基础编辑器初始化

```typescript
import { describe, expect, it, afterEach, vi } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

afterEach(() => {
  vi.useRealTimers();
});

describe("feature name", () => {
  it("test case", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "# Hello" });

    // ... 测试逻辑 ...

    editor.destroy();
  });
});
```

### 1.2 获取内部 EditorView

```typescript
import type { EditorView } from "@codemirror/view";

function requireEditorView(view: EditorView | null): EditorView {
  if (!view) throw new Error("Expected CodeMirror view to be captured");
  return view;
}

// 通过 ViewPlugin 捕获 view
let capturedView: EditorView | null = null;
const editor = createEditor({
  container,
  initialValue: "text",
  cmExtensions: [
    ViewPlugin.fromClass(class {
      constructor(v: EditorView) { capturedView = v; }
    }),
  ],
});
const view = requireEditorView(capturedView);
```

### 1.3 带插件初始化

```typescript
import { createEditor } from "@floatboat/nexus-core";
import { createSlashPlugin } from "@floatboat/nexus-plugin-slash";
import { createGfmPreset } from "@floatboat/nexus-preset-gfm";

const editor = createEditor({
  container,
  initialValue: "# Hello",
  plugins: [
    createSlashPlugin([{ id: "heading", title: "Heading" }]),
    createGfmPreset(),
  ],
});
```

### 1.4 Live Preview 测试

```typescript
// Live Preview 需要 getClientRects polyfill（vitest.setup.ts 已配置）
// 测试光标感知: 光标在不同行触发不同 Decoration

const editor = createEditor({
  container,
  initialValue: "Line 1\n**bold**\nLine 3",
  livePreview: true,
});

// 移动光标到其他行，验证标记隐藏
editor.setSelection(0);
```

### 1.5 Table Widget 交互测试

```typescript
// ⚠️ 参考 AGENTS.md Table Widget Development Rules
// 1. mousedown/mouseup 模拟需包含 clientX/clientY
// 2. blur 事件需 mock document.activeElement

function activateTableCell(cell: HTMLElement, clientX = 80, clientY = 40): void {
  document.getSelection()?.removeAllRanges();
  cell.dispatchEvent(new MouseEvent("mousedown", {
    bubbles: true, cancelable: true, button: 0, clientX, clientY,
  }));
  document.dispatchEvent(new MouseEvent("mouseup", {
    bubbles: true, button: 0, clientX, clientY,
  }));
}

async function blurCellOutsideTable(cell: HTMLElement): Promise<void> {
  const spy = vi.spyOn(document, "activeElement", "get").mockReturnValue(document.body);
  cell.dispatchEvent(new Event("blur"));
  await Promise.resolve();
  spy.mockRestore();
}
```

### 1.6 AST 断言模式

```typescript
// 验证 markdown 解析为正确的 mdast 节点
const editor = createEditor({ container, initialValue: "# Hello" });
const ast = editor.getAst();

expect(ast.children[0]?.type).toBe("heading");
expect(ast.children[0]?.depth).toBe(1);

// round-trip 无损测试
const md1 = "# Hello\n\nWorld";
const editor1 = createEditor({ container, initialValue: md1 });
const ast1 = editor1.getAst();
// 重新序列化应保持一致
```

### 1.7 事件回调测试

```typescript
const events: string[] = [];
const docs: string[] = [];

const editor = createEditor({
  container,
  initialValue: "start",
  onChange(doc) { docs.push(doc); },
  onFocus() { events.push("focus"); },
  onBlur() { events.push("blur"); },
});

editor.focus();
editor.setDocument("next");
editor.blur();

expect(docs).toEqual(["next"]);
expect(events).toEqual(["focus", "blur"]);
```

### 1.8 无障碍测试

```typescript
// 查询 ARIA 属性
const editor = createEditor({
  container,
  initialValue: "# Title",
  livePreview: true,
});

const h1 = container.querySelector("[role='heading'][aria-level='1']");
expect(h1).not.toBeNull();
expect(h1?.textContent).toBe("Title");
```

---

## 2. Playwright e2e 测试模式

### 2.1 启动 Electron Demo

```typescript
import { test, expect, type Page } from "@playwright/test";
import { launchDemo } from "./helpers/electron-launcher";

let page: Page;

test.beforeAll(async () => {
  const { page: p } = await launchDemo();
  page = p;
});
```

### 2.2 编辑器交互

```typescript
// 点击编辑器并输入文本
async function typeInEditor(page: Page, text: string) {
  await page.click(".cm-content");
  await page.evaluate((t) => document.execCommand("insertText", false, t), text);
}

// 键盘按键
await page.keyboard.press("Enter");
await page.keyboard.press("Shift+Tab");
```

### 2.3 DOM 选择器参考

| 选择器 | 含义 |
|--------|------|
| `.cm-editor` | 编辑器根容器 |
| `.cm-content` | 可编辑内容区 |
| `.cm-line` | 每行 |
| `.cm-cursor` | 光标 |
| `.cm-selectionBackground` | 选区背景 |
| `.cm-widgetBuffer` | Widget 缓冲 |
| `table[role='grid']` | Live Preview 表格 |
| `[role='heading']` | Live Preview 标题 |
| `[role='code']` | Live Preview 代码块 |

---

## 3. 包导入路径映射

| 包名 | import 路径 | 主要导出 |
|------|-----------|---------|
| 核心引擎 | `@floatboat/nexus-core` | createEditor, EditorConfig, EditorAPI |
| React 绑定 | `@floatboat/nexus-react` | NexusEditor, useEditor |
| Vue 绑定 | `@floatboat/nexus-vue` | NexusEditor, useEditor |
| GFM 预设 | `@floatboat/nexus-preset-gfm` | createGfmPreset |
| 斜杠菜单 | `@floatboat/nexus-plugin-slash` | createSlashPlugin |
| 历史记录 | `@floatboat/nexus-plugin-history` | createHistoryPlugin |
| 搜索 | `@floatboat/nexus-plugin-search` | createSearchPlugin |
| 工具栏 | `@floatboat/nexus-plugin-toolbar` | createToolbarPlugin |
| 数学公式 | `@floatboat/nexus-plugin-math` | createMathPlugin |
| Vim 模式 | `@floatboat/nexus-plugin-vim` | createVimPlugin |
| 字数统计 | `@floatboat/nexus-plugin-wordcount` | createWordCountPlugin |

---

## 4. 已知陷阱（来自 AGENTS.md）

### Table Widget 12 条铁律摘要

1. 不要在同一流程中清除刚设置的状态
2. rAF 轮询必须检查所有交互状态标志
3. 禁止用 inline border 做拖拽指示器
4. contentEditable 默认关闭
5. 禁止 HTML5 Drag API 做 grip 拖拽
6. 列 grip pill 必须相对 header cell 定位
7. 每次改动需测试所有交互路径
8. 跨多帧的鼠标交互必须设置 editing=true
9. blur 处理必须检查活跃的 grip 拖拽
10. onDragEnd 必须在 dispatch move 前释放 editing 锁
11. rAF 轮询必须检查 rangeActive 标志
12. StateField 更新期间必须跳过所有重建

### Fixture 测试规则

- 测试应验证行为，而非偶然的文件内容
- 不要硬编码 fixture 文件名作为断言依赖
- 使用动态扫描 + 过滤来验证行为

---

## 5. 测试运行命令

```bash
# 运行所有 Vitest 测试
pnpm test

# 运行特定包的测试
pnpm --filter @floatboat/nexus-core test

# 运行 Playwright e2e（需先启动 dev server）
pnpm dev:renderer  # 终端1
pnpm test:e2e      # 终端2
```

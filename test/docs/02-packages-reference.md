# 02 — 包与 API 参考

> 对应源码：`packages/` | 原始文档：各包 `README.md`

---

## 包依赖关系

```
宿主应用
  └── @floatboat/nexus-react / @floatboat/nexus-vue（框架绑定）
        └── @floatboat/nexus-core（引擎）
              └── @floatboat/nexus-preset-gfm + 各 plugin-*（按需引入）
```

---

## 1. @floatboat/nexus-core — 编辑器引擎

### 入口 API

```typescript
import { createEditor } from "@floatboat/nexus-core";

const editor = createEditor({
  container: document.querySelector("#editor")!,
  initialValue: "# Hello",
  livePreview: true,      // Obsidian 风格实时预览
  multiCursor: false,     // 多光标（默认关闭）
  plugins: [...],         // 插件数组
  theme: lightTheme,      // 主题
  locale: zhLocale,       // 国际化
  readOnly: false,        // 只读模式
  tabSize: 2,             // Tab 缩进
  direction: "ltr",       // 文字方向
  indentGuides: true,     // 缩进指引线
  parseDelayMs: 100,      // AST 防抖延迟
  slashMenuLimit: 8,      // 斜杠菜单结果上限
  onChange: (doc, ast) => {},
  onFocus: () => {},
  onBlur: () => {},
  onAssetUpload: async (file) => url,
  onReady: (editor) => {},
});
```

### EditorAPI 方法清单

| 分类 | 方法 |
|---|---|
| 文档操作 | `getDocument()` `setDocument(text, opts?)` `replaceSelection(text)` `replaceRange(from, to, insert, sel?, opts?)` |
| AST | `getAst()` `getTableOfContents()` `exportHTML()` |
| 选区 | `getSelection()` `setSelection(anchor, head?)` `getSelectedText()` `getSelections()` `setSelections(ranges, mainIndex?)` |
| 命令 | `getCommands()` `runCommand(id)` `runShortcut(key)` `getSlashCommands()` |
| 事件 | `on(event, handler)` `off(event, handler)` |
| 坐标映射 | `getCoordsAtPos(pos)` `getPosAtDOM(node, offset)` |
| 生命周期 | `focus()` `blur()` `destroy()` `isComposing()` `setTheme(theme)` |

### 事件类型

| 事件 | 载荷 |
|---|---|
| `change` | `(doc: string, ast: Root)` |
| `selectionChange` | `({ anchor, head, ranges, mainIndex })` |
| `focus` | `()` |
| `blur` | `()` |
| `slashMenuChange` | `(SlashMenuState)` |
| `ready` | `(EditorAPI)` |

### 导出的独立模块

| 导出 | 用途 |
|---|---|
| `selectNextOccurrence` `addCursorAbove` `addCursorBelow` `collapseToMainSelection` | 多光标命令 |
| `multiCursorKeymap` `multiCursorExtension` | 多光标扩展 |
| `lightTheme` `darkTheme` | 预设主题 |
| `enLocale` `zhLocale` | 预设语言 |
| `filterSlashCommands` `computeSlashState` | 斜杠命令排序 |
| `createWikilinksPlugin` | 双链插件 |

### 源文件清单

| 文件 | 功能 | 行数级 |
|---|---|---|
| `editor.ts` | 编辑器入口，CM6 管理、AST、事件、IME | ~980 |
| `types.ts` | 全部 TypeScript 类型定义 | ~398 |
| `live-preview.ts` | Obsidian 风格实时预览（核心） | ~1500 |
| `live-preview-table.ts` | 可编辑表格 Widget | 高 |
| `live-preview-renderers.ts` | 各节点渲染器 | 中 |
| `live-preview-ranges.ts` | AST→装饰区间收集 | 中 |
| `live-preview-highlight.ts` | 代码块语法高亮（highlight.js + LRU 缓存） | 中 |
| `live-preview-diag.ts` | Live Preview 诊断 | 低 |
| `lezer-markdown.ts` | Lezer Markdown 语法支持 | 中 |
| `lezer-mdast-adapter.ts` | Lezer 树→mdast AST 适配器 | 高 |
| `lezer-helpers.ts` | Lezer 树遍历辅助 | 中 |
| `lezer-footnote-extension.ts` | 脚注语法扩展 | 低 |
| `wikilinks.ts` | `[[双链]]` 解析、自动补全、导航 | 高 |
| `slash-state.ts` | 斜杠命令状态计算 | 中 |
| `multi-cursor.ts` | 多光标扩展 | 中 |
| `markdown-keymap.ts` | Markdown 专用快捷键（Enter 续行等） | 中 |
| `markdown-fold.ts` | 代码折叠 | 低 |
| `markdown-autopair.ts` | 符号自动配对 | 中 |
| `widget-extension.ts` | Widget API | 中 |
| `theme.ts` | 主题系统 | 中 |
| `locale.ts` | 国际化 | 低 |
| `event-emitter.ts` | 事件发射器 | 低 |
| `index.ts` | 统一导出 | — |

### 测试文件（15 个）

`editor.test.ts` `events.test.ts` `live-preview.test.ts` `live-preview-ranges.test.ts` `live-preview-regressions.test.ts` `slash-state.test.ts` `multi-cursor.test.ts` `wikilinks.test.ts` `mermaid.test.ts` `markdown-keymap.test.ts` `markdown-fold.test.ts` `theme.test.ts` `locale.test.ts` `accessibility.test.ts` `widgets.test.ts`

---

## 2. @floatboat/nexus-react — React 绑定

### API

```tsx
import { Editor, useEditor } from "@floatboat/nexus-react";

// 组件方式
<Editor
  initialValue="# Hello"
  value={controlledValue}        // 受控模式
  onReady={(editor) => {}}
  onChange={(doc, ast) => {}}
  plugins={[...]}
/>

// Hook 方式
const { containerRef, editor } = useEditor({
  initialValue: "# Hello",
  onReady: (instance) => instance.focus(),
});
```

### 受控 vs 非受控

| 模式 | Prop | 行为 |
|---|---|---|
| 受控 | `value` | 父组件拥有 markdown，通过 `onChange` 同步 |
| 非受控 | `initialValue` | 编辑器拥有编辑，可通过 `EditorAPI` 操作 |

外部 `value` 变化通过 `setDocument(text, { silent: true })` 同步，避免反向 `onChange`。

### 源文件

| 文件 | 功能 |
|---|---|
| `use-editor.ts` | `useEditor` Hook — 创建/销毁/受控同步 |
| `editor.tsx` | `<Editor />` 组件 — props 透传 |
| `controlled-document.ts` | 受控文档同步逻辑 |
| `types.ts` | EditorProps 类型 |

---

## 3. @floatboat/nexus-vue — Vue 3 绑定

### API

```vue
<script setup lang="ts">
import { Editor, useEditor } from "@floatboat/nexus-vue";
</script>

<template>
  <Editor
    initial-value="# Hello"
    v-model="markdown"           <!-- 受控模式 -->
    :on-ready="handleReady"
    :plugins="plugins"
  />
</template>
```

### 源文件

| 文件 | 功能 |
|---|---|
| `use-editor.ts` | `useEditor` Composable |
| `editor.ts` | `<Editor />` 组件（defineComponent） |
| `controlled-document.ts` | 受控文档同步逻辑 |
| `types.ts` | EditorProps 类型 |

---

## 4. @floatboat/nexus-preset-gfm — GFM 预设

```typescript
import { createGfmPreset } from "@floatboat/nexus-preset-gfm";

// 注册 remarkGfm：表格、删除线、任务列表、自动链接
const plugin = createGfmPreset();
```

**复杂度**：简单（10 行，纯桥接 `remark-gfm`）

---

## 5. @floatboat/nexus-plugin-slash — 斜杠菜单

### API

```typescript
import { createSlashPlugin, createSlashMenuUI } from "@floatboat/nexus-plugin-slash";

const editor = createEditor({
  plugins: [
    createSlashPlugin([
      { id: "h1", title: "Heading 1", keywords: ["h1"], run: (e) => { e.replaceSelection("# "); return true; } },
    ]),
  ],
});

const menu = createSlashMenuUI(editor);
// menu.destroy()
```

### 排序算法（6 级优先级）

1. 精确标题匹配
2. 标题前缀（更短的标题优先）
3. 精确关键词匹配
4. 标题子串（更早的位置优先）
5. 关键词前缀
6. 关键词子串

同层内按标题字母序稳定排序。

### 源文件

| 文件 | 功能 | 行数级 |
|---|---|---|
| `index.ts` | `createSlashPlugin()` — 声明 slashCommands | 低 |
| `menu-ui.ts` | 浮动菜单 DOM、键盘/鼠标导航、视口翻转、IME、ARIA | ~500 |
| `command-history.ts` | 最近使用排序（可选） | 中 |

---

## 6. @floatboat/nexus-plugin-search — 搜索替换

```typescript
import { createSearchPlugin, findSearchMatches, replaceAllMatches } from "@floatboat/nexus-plugin-search";

const editor = createEditor({
  plugins: [createSearchPlugin({ history: { storage: myStorage } })],
});
```

### 功能

- 自建搜索/替换 Panel（大小写、正则、整词切换）
- 表格内 CSS Custom Highlight API 高亮（源码→渲染区间映射）
- 可选搜索历史（宿主注入存储，上下箭头回溯）
- Mod+F 打开，Enter/Shift+Enter 上一个/下一个

**复杂度**：高（~1164 行，单文件含 Panel + 历史控制器 + 表格高亮）

---

## 7. @floatboat/nexus-plugin-toolbar — 格式化工具栏

```typescript
import { createToolbarPlugin, createToolbarUI, toggleBold, toggleHeading } from "@floatboat/nexus-plugin-toolbar";

const editor = createEditor({ plugins: [createToolbarPlugin()] });
const toolbar = createToolbarUI(editor, { container: document.body });
```

### 注册的能力

| 能力 | 数量 | 内容 |
|---|---|---|
| shortcuts | 8 条 | Mod-b（加粗）、Mod-i（斜体）、Mod-Shift-s（删除线）、Mod-e（行内代码）、Mod-k（链接）、Mod-1/2/3（标题） |
| slashCommands | 14 条 | h1/h2/h3、bold/italic/strike/inline-code、code-block、blockquote、ulist/olist、link、image、hr |
| cmExtensions | 1 个 | `colorDecorationExtension`（文本颜色/高亮装饰） |

### 源文件

| 文件 | 功能 |
|---|---|
| `index.ts` | 插件入口 |
| `formatting.ts` | 格式化操作（加粗、斜体、标题、引用、列表、代码块、图片、颜色等） |
| `toolbar-ui.ts` | 工具栏 UI |
| `color-decoration.ts` | 文本颜色/高亮装饰 |
| `icons.ts` | SVG 图标 |

---

## 8. @floatboat/nexus-plugin-wordcount — 字数统计

```typescript
import { createWordCountPlugin, attachWordCountPlugin, countMarkdown } from "@floatboat/nexus-plugin-wordcount";

// 独立使用（纯函数）
const stats = countMarkdown("你好，世界。");
// { words: 4, cjkCharacters: 4, readingTimeSeconds: 1, ... }

// 编辑器插件
const wordcount = createWordCountPlugin({ statusBar: {} });
const editor = createEditor({ plugins: [wordcount] });
attachWordCountPlugin(wordcount, editor);
```

### 特性

- Markdown 感知：排除 code、math、html、yaml、frontmatter
- CJK 优先：中文/日文/韩文按字符计数（可配置 `"char"` 或 `"word"`）
- 零重复解析：编辑器内复用 `editor.getAst()`
- 状态栏：`role="status"` + `aria-live="polite"`

### 源文件

| 文件 | 功能 |
|---|---|
| `plugin.ts`（~281 行） | 插件主体（NexusPlugin + API + 状态机） |
| `count.ts` | Markdown 感知计数逻辑 |
| `status-bar.ts` | ARIA-live 状态栏 |

---

## 9. @floatboat/nexus-plugin-math — 数学公式

```typescript
import { createMathPlugin } from "@floatboat/nexus-plugin-math";

const editor = createEditor({ plugins: [createMathPlugin()] });
```

- 注册 `remarkMath` 解析 `$...$` 和 `$$...$$`
- 两个 Widget 渲染器：块级 math（KaTeX displayMode）+ 行内 inlineMath
- 块级公式 hover 显示编辑按钮

---

## 10. @floatboat/nexus-plugin-history — 撤销/重做

```typescript
import { createHistoryPlugin } from "@floatboat/nexus-plugin-history";

const editor = createEditor({ plugins: [createHistoryPlugin()] });
```

**复杂度**：简单（11 行，桥接 `@codemirror/commands`）

---

## 11. @floatboat/nexus-plugin-vim — Vim 键绑定

```typescript
import { createVimPlugin } from "@floatboat/nexus-plugin-vim";

const editor = createEditor({ plugins: [createVimPlugin()] });
```

**复杂度**：简单（9 行，桥接 `@replit/codemirror-vim`）

---

## 汇总表

| 包 | NexusPlugin 能力 | 复杂度 | Demo 是否加载 |
|---|---|---|---|
| core | — | 极高 | 是（引擎本身） |
| react | — | 中等 | 否（Demo 是原生 TS） |
| vue | — | 中等 | 否 |
| preset-gfm | remarkPlugins | 简单 | 是 |
| plugin-slash | slashCommands | 复杂 | 是（UI） |
| plugin-search | cmExtensions | 复杂 | 是 |
| plugin-toolbar | shortcuts + slashCommands + cmExtensions | 中等 | 是 |
| plugin-wordcount | (attachEditor 监听) | 中等 | 是 |
| plugin-math | remarkPlugins + widgets | 中等 | 否 |
| plugin-history | cmExtensions | 简单 | 是 |
| plugin-vim | cmExtensions | 简单 | 否 |

<div align="center">

# Nexus-Editor

**一款无头、AST 驱动的 Markdown 编辑器引擎 —— 为真正想用 Markdown 的开发者打造，而不是又一个 WYSIWYG。**

基于 [CodeMirror 6](https://codemirror.net/) + [unified](https://unifiedjs.com/) 生态。
框架无关核心 · 官方 React 与 Vue 绑定 · MIT 协议。

[English](./README.md) · [快速开始](#-快速开始) · [为什么选 Nexus？](#-为什么选-nexus-editor) · [路线图](#-路线图-tldr) · [参与贡献](#-参与贡献)

</div>

---

## 🗺️ 路线图 (TL;DR)

我们按优先级分层迭代 —— **P0 是当前正在做的事**。

| 优先级 | 主题 | 关键项 |
|---|---|---|
| **P0 — 当前** | 核心 API 完善 | `getSelectedText()`、斜杠命令排序、`<Editor />` `onReady`、TS 严格类型覆盖 |
| **P1 — 下一阶段** | 进阶功能 | 多光标、正则搜索、撤销/重做分组、Widget API 标准化、Electron 打包优化 |
| **P2 — 中期** | 体验与生态 | 高级工具栏（emoji / 表格 / 颜色）、模糊搜索、滚动同步预览、Web Component 包装 |
| **P3 — 长期** | 协作能力 | 实时 CRDT 协作、共享评论 / @提醒、插件热重载 |

👉 **完整路线图（含包归属、状态、OpenSpec 关联）：** [`docs/ROADMAP.zh.md`](./docs/ROADMAP.zh.md)

---

## 💡 为什么选 Nexus-Editor？

Markdown 编辑器赛道并不冷清 —— 但每一个现有方案都让我们在某些根本问题上妥协。我们做 Nexus，是因为我们需要一个**把 Markdown 文本本身当作真正的文档**、不绑架你 UI、且对扩展点诚实的编辑器。

### 横向对比

| | **Nexus** | **Tiptap** | **Lexical** | **Milkdown** | **MDXEditor** | **@uiw/react-md-editor** |
|---|---|---|---|---|---|---|
| **底层** | CodeMirror 6 + unified | ProseMirror | Meta 自研 | ProseMirror + Remark | Lexical | CodeMirror + Marked |
| **文档真值** | **Markdown 文本** | JSON 树 | JSON 树 | ProseMirror doc | Lexical state | Markdown 文本 |
| **来回转换无损** | ✅ 无损 | ⚠️ 格式可能漂移 | ⚠️ Markdown 仅作 import/export | ⚠️ 经 PM schema | ⚠️ 经 Lexical | ✅ |
| **UI 模式** | **Headless** | Headless | 偏 Headless | WYSIWYG（自带 UI） | WYSIWYG | 左右分栏 |
| **实时预览** | **Obsidian 风格内联** | 无（自行实现） | 无（自行实现） | 完全 WYSIWYG | 完全 WYSIWYG | 左右分栏预览 |
| **框架支持** | React · Vue · Vanilla | React · Vue · Svelte · Vanilla | React 优先 | React · Vue · Vanilla | 仅 React | 仅 React |
| **插件层级** | **3 层**（快捷键 / AST / CM6） | 1 层（Tiptap extension） | 1 层（node + transform） | 1 层（Milkdown plugin） | 1 层（Lexical plugin） | 无 |
| **核心包体积（约）** | 较小（CM6 约 110KB） | 中等（PM + ext.） | 核心约 22KB | 约 125KB / gz 约 40KB | gz 约 851KB | 中等 |
| **本地优先 / 文件 IO 钩子** | ✅ 一等公民 | ❌ | ❌ | ❌ | ❌ | ❌ |
| **许可证** | MIT | MIT（+ 付费云服务） | MIT | MIT | MIT | MIT |

> 数据来自各项目公开文档与近期第三方评测。包体积会随启用的插件浮动，仅作量级参考。

### 这些差异在实际场景中意味着什么

- **Tiptap / Lexical / Milkdown / MDXEditor** 都在内部维护一份 JSON 文档模型。Markdown 只是 import/export 的胶水 —— 一份 `.md` 文件经过它们来回转换，可能会悄悄漂移（软换行丢失、属性重排、表格被归一化）。如果你的产品**本身就是 Markdown 文件**（笔记应用、静态站点写作、LLM 写作工具等），这件事很重要。
- **@uiw/react-md-editor** 文档本身也是 Markdown，但只提供经典的左右分栏预览 —— 没有内联语法揭示，没有 Widget API，且只支持 React。
- **Obsidian** 的 UX 是我们的标杆，但它闭源 —— 你没法把它的引擎嵌进自己的产品。
- **Nexus** 保留 Markdown 作为真正的文档，**同时**给你 Obsidian 风格的实时预览、Widget API、三层插件体系，以及框架无关的绑定 —— 不绑架你走 WYSIWYG。

如果你在做 **笔记应用、文档 CMS、静态站点写作工具、Markdown 原生 PKM、或者 LLM 写作助手**，Nexus 想成为那个让你不用对抗的引擎。

---

## 🚀 快速开始

### 1. 安装

```bash
# pnpm（推荐）
pnpm add @floatboat/nexus-core @floatboat/nexus-preset-gfm

# 或 npm / yarn
npm install @floatboat/nexus-core @floatboat/nexus-preset-gfm
```

### 2. 选择你的框架

<details open>
<summary><b>React</b> —— 最快上手</summary>

```tsx
import { Editor } from "@floatboat/nexus-react";
import { createGfmPreset } from "@floatboat/nexus-preset-gfm";

export default function App() {
  return (
    <Editor
      initialValue="# 你好，Nexus 👋"
      plugins={[createGfmPreset()]}
      livePreview
      onChange={(doc, ast) => console.log(doc)}
    />
  );
}
```

> 💡 **不熟 CodeMirror？** 不需要懂。`<Editor />` 已经处理好生命周期，直接用就行。
</details>

<details>
<summary><b>Vue 3</b></summary>

```vue
<script setup>
import { Editor } from "@floatboat/nexus-vue";
import { createGfmPreset } from "@floatboat/nexus-preset-gfm";
</script>

<template>
  <Editor
    initial-value="# 你好"
    :plugins="[createGfmPreset()]"
    :live-preview="true"
    @change="(doc) => console.log(doc)"
  />
</template>
```
</details>

<details>
<summary><b>原生 / 纯 DOM</b></summary>

```ts
import { createEditor } from "@floatboat/nexus-core";
import { createGfmPreset } from "@floatboat/nexus-preset-gfm";
import { createHistoryPlugin } from "@floatboat/nexus-plugin-history";

const editor = createEditor({
  container: document.getElementById("editor")!,
  initialValue: "# 你好\n\n开始编辑...",
  plugins: [createGfmPreset(), createHistoryPlugin()],
  livePreview: true,
  onChange(doc, ast) {
    console.log("Markdown:", doc);
    console.log("AST:", ast);
  },
});
```
</details>

### 3. 新手必读

> **🐣 我们当初要是有人告诉就好了的几件事**
>
> - **你不需要懂 CodeMirror。** React / Vue 封装已经处理好生命周期。只有在写底层插件时才会碰到它。
> - **Headless = 没有主题。** 我们只提供逻辑，不提供外观。请预留几个小时做样式 —— Electron demo 是可以直接复制的起点。
> - **实时预览是 opt-in 的。** 如果你只想要一个纯 Markdown 编辑器，不开它就是干净的文本编辑体验。
> - **AST 是 `mdast`** —— 就是 `remark` 和整个 unified 生态用的那棵树。没接触过的话，[mdast 规范](https://github.com/syntax-tree/mdast)是一页就能看完的小抄。
> - **不要在每次按键时存盘。** `onChange` 会非常密集地触发 —— 写文件或发请求前一定要做防抖。
> - **页面空白？** 十有八九是容器没有高度。给它一个高度，编辑器就出来了。
> - **卡住了？** 直接开 issue，打上 `question` 标签 —— 我们宁愿同一个问题回答 20 次，也不希望你放弃。

### 4. 跑一下示例

```bash
git clone https://github.com/floatboatai/Nexus-Editor.git
cd Nexus-Editor
pnpm install
pnpm dev:electron-demo
```

一个完整的 Electron 应用，带文件 IO、实时预览、所有插件 —— 这是看清 Nexus 能做什么的最快路径。

---

## 📦 包列表

<details>
<summary><b>完整包列表（11 个包）</b> —— 点击展开</summary>

| 包名 | 说明 |
|---|---|
| `@floatboat/nexus-core` | 编辑器引擎 —— CM6 状态机、AST 管道、实时预览、事件系统、Widget API |
| `@floatboat/nexus-react` | React 绑定 —— `useEditor` Hook 与 `<Editor />` 组件 |
| `@floatboat/nexus-vue` | Vue 3 绑定 —— `useEditor` 组合式函数 |
| `@floatboat/nexus-preset-gfm` | GitHub Flavored Markdown 预设（表格、删除线、任务列表） |
| `@floatboat/nexus-plugin-history` | 撤销/重做，支持 `Ctrl+Z` / `Ctrl+Shift+Z` |
| `@floatboat/nexus-plugin-search` | 搜索替换辅助函数 |
| `@floatboat/nexus-plugin-slash` | 斜杠命令检测、排序与 vanilla DOM 浮层菜单 UI |
| `@floatboat/nexus-plugin-toolbar` | 工具栏基础组件与格式化命令 |
| `@floatboat/nexus-plugin-math` | 行内 / 块级数学公式渲染（KaTeX） |
| `@floatboat/nexus-plugin-vim` | Vim 键位（基于 `@replit/codemirror-vim`） |
| `@floatboat/nexus-plugin-wordcount` | Markdown 感知的字数 / 字符数 / 中日韩字符 / 阅读时长统计 + ARIA 状态栏 |

</details>

---

## ✨ 特性

- **Headless** —— 不内置任何 UI，可用任意框架或纯 DOM 渲染。
- **AST 驱动** —— 每次输入都实时把 Markdown 解析成 mdast。
- **实时预览** —— 类 Obsidian 内联渲染，光标聚焦时展开原始语法。
- **插件系统** —— 三层架构：快捷键与斜杠命令、remark 插件与 Widget、原生 CM6 扩展。
- **事件系统** —— 订阅 `change`、`focus`、`blur`、`selectionChange`、`slashMenuChange`。
- **Widget API** —— 为任意 AST 节点类型（代码块、表格、图表等）渲染自定义组件。
- **本地优先** —— 为 Electron / Tauri 设计，内置文件 IO 钩子与防抖解析。

---

## 📖 API 参考

<details>
<summary><b>编辑器 API</b> —— 方法与事件</summary>

`createEditor(config)` 返回 `EditorAPI`：

```ts
editor.getDocument()          // 当前 Markdown 文本
editor.getAst()               // 当前 mdast 语法树
editor.setDocument(md)        // 替换整个文档
editor.setDocument(md, { silent: true, preserveSelection: true })
editor.setDocument(md, { selection: { anchor: 0 } })
editor.setSelection(pos)      // 移动光标
editor.focus() / editor.blur()
editor.destroy()

// 事件系统
editor.on("change", (doc, ast) => { ... })
editor.on("selectionChange", ({ anchor, head }) => { ... })
editor.on("slashMenuChange", ({ isOpen, query, commands, coords }) => { ... })
editor.off("change", handler)

// 坐标（用于浮动 UI 定位）
editor.getCoordsAtPos(pos)     // { left, right, top, bottom } | null
```

</details>

<details>
<summary><b>插件编写</b> —— 三个层级，统一形态</summary>

```ts
const myPlugin: NexusPlugin = {
  name: "my-plugin",

  // 第一层：快捷键与斜杠命令
  shortcuts: [{ key: "Mod-b", run: (editor) => { /* 切换加粗 */ return true; } }],
  slashCommands: [{ id: "heading", title: "标题", keywords: ["h1"] }],

  // 第二层：AST 与 Widget
  remarkPlugins: [remarkMath],
  widgets: [{
    nodeType: "code",
    match: (node) => node.lang === "mermaid",
    render: (node, source) => renderMermaidChart(source),
    destroy: (el) => el.remove(),
  }],

  // 第三层：原生 CM6 扩展
  cmExtensions: [myCodeMirrorExtension],
};
```

</details>

---

## 🛠️ 开发

<details>
<summary><b>构建、测试、跑示例</b></summary>

```bash
pnpm install
pnpm build          # 构建所有包
pnpm test           # 运行所有测试

# Electron 演示应用
pnpm dev:electron-demo
```

</details>

---

## 🤝 参与贡献

非常欢迎你的参与 —— 不管是改个错别字、写个新插件、还是动核心架构。这是 **5 分钟版本**：

1. **Fork 本仓库** —— 点击页面顶部的 **Fork** 按钮。
2. **Clone 你 fork 的仓库** 到本地：
   ```bash
   git clone https://github.com/<你的用户名>/Nexus-Editor.git
   cd Nexus-Editor
   pnpm install
   ```
3. **创建分支**，遵循我们的命名规范（详见 `CONTRIBUTING.zh.md`）：
   ```bash
   git checkout -b feat/<scope>/<short-description>
   ```
4. **改你的代码** —— 写测试，跑 `pnpm test`，跑 `pnpm build`。
5. **提交**，使用 [Conventional Commits](https://www.conventionalcommits.org/)：
   ```bash
   git commit -m "feat(core): add getSelectedText() API"
   ```
6. **推送** 到你 fork 的仓库，然后 **向 `main` 分支发起 Pull Request**。

### 发 PR 之前，请先读

- [CONTRIBUTING.zh.md](./CONTRIBUTING.zh.md) —— 分支命名、Conventional Commits scope 白名单、何时需要走 OpenSpec、测试矩阵。
- [.github/PULL_REQUEST_TEMPLATE.md](./.github/PULL_REQUEST_TEMPLATE.md) —— PR 描述模板（双语）。
- [openspec/AGENTS.md](./openspec/AGENTS.md) —— 新 capability 或破坏性 API 变更必读。

> 🟢 **新手友好的 issue** 打了 [`good first issue`](https://github.com/floatboatai/Nexus-Editor/labels/good%20first%20issue) 标签 —— 不熟代码库的话，从这里开始。

---

## 📄 许可证

[MIT](./LICENSE) © floatboat

---

<div align="center">

## ⭐ 觉得不错？

**如果 Nexus-Editor 让你不必再从头写一个 Markdown 编辑器，最大的支持就是给我们点一个 ⭐** —— 这能帮助其他开发者发现这个项目，也会让我们这天过得开心。

### 帮忙传播

- 🐦 **发推 / 发微博** —— 带上我们，我们会转
- 📝 **写一篇你的集成博客** —— 提个 PR 把它列进 `SHOWCASE.md`
- 💬 **分享到团队的 Slack / Discord / 飞书 / 群** —— 90% 的开发者是这么发现工具的
- 🐛 **觉得哪里不对就开 issue** —— 哪怕是"这里看不懂"，对我们也很有价值

**Built with ❤️ —— 致仍然相信 Markdown 是对的那种格式的开发者们。**

</div>

**提交信息**：`docs: add code quality section to README`

---

### 文件13：`README.zh.md` 需要添加的内容
在中文 README 末尾添加：

```markdown
## 🔧 代码质量

Nexus-Editor 通过自动化工具链强制执行高质量的代码标准：

### 质量工具
- **ESLint**: 静态代码分析，支持 TypeScript
- **Prettier**: 统一的代码格式化
- **TypeScript**: 严格的类型检查
- **Husky**: Git hooks 用于预提交检查
- **lint-staged**: 仅对暂存文件运行检查

### 命令
```bash
# 运行所有质量检查
pnpm run check

# 格式化代码
pnpm run format

# 代码检查
pnpm run lint

# 自动修复检查问题
pnpm run lint:fix

# `Nexus-Editor` 核心架构与产品设计文档 (v1.0)

## 1. 产品概述 (Executive Summary)

### 1.1 产品定位

`Nexus-Editor` 是一个基于 CodeMirror 6 和 Unified 生态构建的 **Headless (无头) Markdown 编辑器引擎**。它以独立 npm 包（Monorepo 结构）的形式发布，旨在为现代 Web 应用和本地桌面端软件提供开箱即用、高度可扩展且框架无关的富文本/Markdown 混合编辑体验。

### 1.2 核心设计哲学

- **状态与视图解耦 (Headless)**：核心包绝对不包含强绑定的 UI 组件，将渲染权和样式控制权（特别契合 Tailwind CSS 等原子化方案）完全交还给宿主环境。
- **语法树驱动 (AST-Driven)**：底层不单纯把 Markdown 当作字符串，而是实时维护并映射为抽象语法树，使得高阶的数据提取和自定义语法渲染成为可能。
- **本地优先设计 (Local-First Friendly)**：为文件系统拖拽、本地图片加载和频繁的防抖 IO 保存提供稳定、安全的钩子，极度适应 Electron 或 Tauri 等桌面端场景的需求。

## 2. 系统架构设计 (Architecture)

### 2.1 Monorepo 包结构划分

项目采用 `pnpm workspaces` + `Turborepo` 进行管理，彻底贯彻模块化：

| 包名 (Package)        | 职责描述                                                                       | 依赖的核心库                 |
| :-------------------- | :----------------------------------------------------------------------------- | :--------------------------- |
| `@floatboat/nexus-core`         | **核心引擎层**。封装 CM6 实例、状态机、AST 解析管道以及核心的扩展/插件注册表。 | `codemirror`, `remark-parse` |
| `@floatboat/nexus-react`        | **React 绑定层**。提供 `useEditor` Hook 和无头 `<Editor />` 组件（容器属性透传、`onReady`）。             | `@floatboat/nexus-core`, `react`       |
| `@floatboat/nexus-vue`          | **Vue 3 绑定层**。提供 `useEditor` Composable 与 `<Editor />` 组件（容器属性透传、`onReady`）。 | `@floatboat/nexus-core`, `vue`         |
| `@floatboat/nexus-preset-gfm`   | **官方预设插件**。提供 GitHub Flavored Markdown 支持（表格、任务列表等）。     | `remark-gfm`                 |
| `@floatboat/nexus-plugin-slash` | **斜杠菜单逻辑**。提供输入 `/` 触发命令的底层位置计算和状态逻辑（不含 UI）。   | `@floatboat/nexus-core`                |

### 2.2 核心数据流转 (Data Flow)

编辑器内部的数据流是单向且极度确定的：

1.  **用户输入** -> CM6 触发 `Transaction` -> 更新 `EditorState`。
2.  **状态映射** -> 内部防抖调用 Unified 将当前文本当作输入生成 AST。
3.  **视图装饰 (Decorations)** -> 根据 AST 节点类型（如图片、自定义块），CM6 计算出 `Widget` 或 `Mark`，将原生 Markdown 语法替换为宿主框架的组件（实现 Live Preview）。
4.  **向外输出** -> 触发 `onChange(markdown, ast)`，宿主应用接管数据持久化。

## 3. 核心 API 与接口规范 (Technical Spec)

采用分层 API 设计，满足不同段位开发者的需求。

### 3.1 核心配置对象 (`EditorConfig`)

任何框架的入口，最终都会转化为对底层引擎的配置：

```typescript
export interface EditorConfig {
    /** 挂载的 DOM 节点 */
    container: HTMLElement;
    /** 初始 Markdown 字符串 */
    initialValue?: string;
    /** 插件系统入口 */
    plugins?: NexusPlugin[];
    /** 统一的主题变量前缀 (用于隔离样式) */
    themePrefix?: string; // 默认 'nx-'

    /** 生命周期与 IO 钩子 */
    onChange?: (doc: string) => void;
    onFocus?: () => void;
    onBlur?: () => void;
    /** 拦截并处理图片/文件拖拽上传，返回最终的资源 URL */
    onAssetUpload?: (file: File) => Promise<string>;
}
```

### 3.2 分层插件基座 (`NexusPlugin`)

这是编辑器扩展性的灵魂。插件可以按需接入三个不同的深度：

```typescript
export interface NexusPlugin {
    name: string;

    // --- Tier 1: 业务逻辑层 (易用) ---
    shortcuts?: Array<{ key: string; run: (editor: EditorAPI) => boolean }>;
    slashCommands?: Array<SlashCommandDef>;

    // --- Tier 2: 语法与渲染层 (核心) ---
    /** 扩展 remark 解析器以支持自定义 Markdown 语法 */
    remarkPlugins?: Array<import("unified").Plugin>;
    /** 将特定的 AST 节点渲染为自定义视图 (如把块级公式渲染为可交互卡片) */
    widgets?: Array<WidgetDefinition>;

    // --- Tier 3: CM6 底层 (硬核) ---
    /** 直接注入 CodeMirror 6 Extensions，实现极致定制 */
    cmExtensions?: Array<import("@codemirror/state").Extension>;
}
```

## 4. 关键功能模块设计 (Feature Specs)

### 4.1 实时预览 (Live Preview) 机制

弃用传统的双栏模式。

- **实现路径**：利用 CodeMirror 的 `ViewPlugin` 和 `Decoration.replace`。当光标**不在**某个特定的 Markdown 结构（如 `**加粗**` 或 `![图片](url)`）内部时，将其折叠并替换为一个 Widget；当光标移入时，展开为源码供编辑。
- **自定义渲染桥接**：对于使用 React 的宿主，提供一个内部渲染通道，允许开发者使用 `createPortal` 将 React 组件挂载到 CM6 内部生成的 Widget DOM 节点上。

### 4.2 安全与零信任机制 (Security)

Markdown 渲染天然带有 XSS 风险，尤其是面向未知来源的内容。

- 内部强制经过 `rehype-sanitize` 清洗。
- 所有的点击事件（例如外部链接）默认添加 `rel="noopener noreferrer"`。
- 对于执行型代码块，严格隔离运行环境，绝对不向内部暴露宿主（如 Electron 的 Node 环境）的高权限 API。

### 4.3 模块化 UI 委托 (UI Delegation)

既然是 Headless，诸如“悬浮工具栏 (Bubble Menu)”、“斜杠菜单 (Slash Menu)”该如何实现？

- `@floatboat/nexus-core` 只负责计算**坐标（BoundingClientRect）**和**选区状态**。
- 向外暴露一个状态订阅：`editor.on('slashMenuChange', ({ isOpen, x, y, query }) => {...})`。
- 宿主框架（如 React）接收到这些状态后，在最外层渲染自己的绝对定位组件，彻底摆脱编辑器内部 DOM 层级的束缚（完美解决弹窗被 `overflow: hidden` 截断的问题）。

## 5. 项目演进路线图 (Roadmap)

- **Phase 1: 核心引擎 (MVP)**
    - 完成 `@floatboat/nexus-core` 与基于 CM6 的底层状态机。
    - 打通 remark AST 解析与 Live Preview 基础装饰器。
    - 发布框架无关的 vanilla JS 版本。
- **Phase 2: 框架拥抱与易用性**
    - 发布 `@floatboat/nexus-react`，提供无缝体验。
    - 实现核心官方插件：Gfm、History (撤销/重做)、Search (搜索替换)。
    - 发布完善的类型定义（TypeScript Definition）。
- **Phase 3: 桌面端深度与高级能力**
    - 完善对于本地极速 IO 的防抖机制。
    - 开放 `Widget API`，让开发者可以轻松用 React/Vue 写出能在 Markdown 内部交互的图表、白板卡片。

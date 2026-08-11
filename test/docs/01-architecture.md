# 01 — 架构设计

> 对应源码：`packages/core/` | 原始文档：`prd.md`

---

## 1. 产品定位

Nexus-Editor 是一个 **Headless（无头）、AST 驱动的 Markdown 编辑器引擎**。

### 三大设计哲学

| 哲学 | 含义 |
|---|---|
| **状态与视图解耦 (Headless)** | 核心包不含 UI 组件，渲染权和样式控制权完全交给宿主 |
| **语法树驱动 (AST-Driven)** | 实时维护 Markdown → AST 映射，支持高阶数据提取和自定义渲染 |
| **本地优先 (Local-First)** | 为文件系统拖拽、本地图片加载、防抖 IO 保存提供安全钩子 |

---

## 2. 核心数据流

编辑器内部数据流是**单向且极度确定**的：

```
用户输入
  ↓
CM6 Transaction
  ↓
EditorState 更新
  ↓
Lezer 增量解析（同步，无 Worker）
  ↓
mdast AST
  ↓
remark 插件（可选 transform 层）
  ↓
Live Preview Decorations（StateField + ViewPlugin）
  ↓
onChange(markdown, ast) → 宿主持久化
```

### 关键技术决策

| 决策 | 原因 |
|---|---|
| Lezer 增量树解析（非 remark Worker） | 同步完成，无 IPC 往返，大幅提升性能 |
| remark 插件作为可选层 | 叠加在 Lezer AST 之上，不影响核心解析速度 |
| IME 组合输入专门处理 | `setDocument` 延迟到 composition 结束，避免打断输入法 |
| AST 缓存 + `reuseCache` | 光标移动时复用缓存，仅重建装饰切换 |

---

## 3. 三层插件体系

```typescript
interface NexusPlugin {
  name: string;

  // --- Tier 1: 业务逻辑层（易用）---
  shortcuts?: Array<{ key: string; run: (editor: EditorAPI) => boolean }>;
  slashCommands?: SlashCommandDef[];
  commands?: EditorCommand[];        // 带 id 的命名命令
  handlers?: EditorEventHandlers;    // paste/drop/keydown 钩子

  // --- Tier 2: 语法与渲染层（核心）---
  remarkPlugins?: Array<import("unified").Plugin>;
  widgets?: WidgetDefinition[];

  // --- Tier 3: CM6 底层（硬核）---
  cmExtensions?: Extension[];
}
```

### 各 Tier 的使用者

| Tier | 适合谁 | 示例插件 |
|---|---|---|
| Tier 1 | 业务开发者 | toolbar（快捷键 + 斜杠命令）、slash（命令声明） |
| Tier 2 | 渲染定制者 | math（remarkMath + KaTeX widget）、gfm（remarkGfm） |
| Tier 3 | CM6 硬核用户 | vim（vim() 扩展）、history（history() + keymap）、search（搜索面板） |

---

## 4. Live Preview 机制

弃用传统双栏模式，采用 **Obsidian 风格的行内实时预览**。

### 实现路径

1. 利用 CM6 的 `ViewPlugin` + `Decoration.replace`
2. 光标**不在**某 Markdown 结构内时 → 折叠语法标记为 Widget
3. 光标**移入**时 → 展开为源码供编辑

### 支持的节点类型（15+）

| 类别 | 节点 |
|---|---|
| 块级 | heading、code（含 Mermaid 懒加载）、table（可编辑 Widget）、blockquote（含 GFM Alert）、html（安全过滤）、footnote、hr |
| 列表 | list（标记 + 复选框）、listItem（拖拽排序） |
| 行内 | bold、italic、strikethrough、code、link、image、wikilink |
| 其他 | 嵌套格式（`***bold italic***`）、GFM autolinks、脚注引用（上标） |

### 性能优化

- AST + codeTokens 缓存，光标移动时复用（`reuseCache`）
- Mermaid ~500KB 懒加载 + 渲染结果缓存
- Widget DOM 节点复用（避免每次按键全量重建）
- 可编辑表格通过 `tableEditingCount` 防止 CM6 交互中重建 DOM

---

## 5. 安全策略

| 风险 | 防护措施 |
|---|---|
| XSS（HTML 注入） | `defaultSanitizeHtml` 过滤（移除 script/iframe/onclick/javascript:） |
| 链接安全 | 所有外部链接默认 `rel="noopener noreferrer"` |
| Mermaid 注入 | `securityLevel: "strict"` |
| 路径穿越 | Vault IPC handler 校验所有路径不逃逸出 vault 根目录 |
| 代码执行 | 执行型代码块严格隔离，不暴露 Electron Node API |

---

## 6. 主题系统

- 基于 **CSS 自定义属性**（`--nexus-*`），所有视觉值通过 CSS 变量设置
- 内置 `lightTheme` 和 `darkTheme` 预设
- 支持 `editor.setTheme(theme)` **运行时切换**，不重建实例
- 主题切换保留文档内容、光标位置、撤销历史

---

## 7. 国际化

- 所有用户可见字符串通过 `locale` 对象配置
- 内置 `en` 和 `zh` 两套语言
- 支持部分覆盖：指定字符串覆盖默认，未指定回退英文

---

## 8. 多光标系统

通过 `multiCursor: true` 开启（默认关闭）：

| 交互 | 效果 |
|---|---|
| `Alt+Click` | 在点击位置添加光标 |
| `Mod-D` | 选择下一个匹配项（VS Code 风格，支持环绕） |
| `Mod-Alt-↑/↓` | 在上/下行添加光标，保持列位置 |
| `Escape` | 折叠到主选区 |

Markdown 智能行为支持多光标：Enter 续行、自动配对、Live Preview 语法揭示均在**所有光标位置**同时生效。

---

## 9. Widget API

允许将特定 AST 节点渲染为自定义视图：

```typescript
interface WidgetDefinition {
  nodeType: string;          // mdast 节点类型
  block?: boolean;           // 块级 or 行内
  ignoreEvents?: boolean;    // 是否拦截鼠标事件
  render(node, ctx): HTMLElement;  // 自定义渲染
}
```

---

## 10. UI 委托模式

Headless 设计下，UI 组件（工具栏、斜杠菜单）的交互模式：

1. Core 只负责计算**坐标**（BoundingClientRect）和**状态**
2. 向外暴露事件订阅：`editor.on('slashMenuChange', ...)`
3. 宿主接收状态后渲染自己的定位组件
4. 彻底摆脱编辑器内部 DOM 层级约束（解决 `overflow: hidden` 截断问题）

也提供开箱即用的 vanilla DOM UI（如 `createSlashMenuUI`、`createToolbarUI`）。

# Nexus_Editor Demo 全功能需求文档

> 来源: 基于 demo 源码爬取（apps/electron-demo + packages/* 全部插件）
> 生成时间: 2026-08-11
> 爬取方法: 源码静态分析 + Playwright MCP 实际探索验证

## 一、产品概述

Nexus_Editor 是一个 Headless（无头）、AST 驱动的 Markdown 编辑器引擎，以 CodeMirror 6 为底层，通过三层插件体系（Tier1 业务逻辑/Tier2 语法渲染/Tier3 CM6 底层）提供可扩展的编辑能力。Electron Demo 应用是引擎的完整集成示例，挂载了所有官方插件，演示端到端笔记应用体验。

### 架构分层

```
┌─────────────────────────────────────────────────┐
│ Electron Demo App                               │
│ ┌──────────┐ ┌─────────────────┐ ┌───────────┐ │
│ │ Main 进程 │ │ Renderer(Vite)  │ │ Preload   │ │
│ │ IPC+FS   │→│ editor-shell.ts │→│ Bridge    │ │
│ └──────────┘ └─────────────────┘ └───────────┘ │
│                      ↓                          │
│ ┌────────────────────────────────────────────┐ │
│ │ @floatboat/nexus-core                      │ │
│ │ createEditor + Live Preview + Wikilinks    │ │
│ └────────────────────────────────────────────┘ │
│                      ↓                          │
│ ┌────────┐┌────────┐┌────────┐┌────────┐      │
│ │preset- ││plugin- ││plugin- ││plugin- │ ...  │
│ │gfm     ││slash   ││history ││toolbar │      │
│ └────────┘└────────┘└────────┘└────────┘      │
└─────────────────────────────────────────────────┘
```

---

## 二、Electron Main 进程能力

### 2.1 自定义协议 nexus-vault://

- 注册特权协议 `nexus-vault`（standard/secure/supportFetchAPI/stream/bypassCSP）
- 处理 `nexus-vault://vault/<rel>` → 校验路径不逃逸 vault → `net.fetch(pathToFileURL(abs))`
- 路径逃逸校验: `rel.startsWith("..") || path.isAbsolute(rel)` → 返回 403
- 支持扩展名: `.md`, `.markdown`, `.txt`
- 跳过目录: `node_modules`, `.git`, `.svn`, `.hg`, `.DS_Store`，以及所有 dotfiles/dotdirs

### 2.2 文件系统监视

- `fs.watch(vault, { recursive: true })`（Linux 回退非递归）
- 150ms 防抖后向 renderer 发 `vault:changed` 事件
- 载荷: `{ vault: vaultPath }`

### 2.3 单文件接口（向后兼容）

| 通道 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `demo:open-file` | 无 | `{ path, content } \| null` | 系统打开对话框，选 Markdown/txt |
| `demo:save-file` | `(filePath, content)` | `{ path }` | 写入指定路径 |
| `demo:save-file-as` | `(content)` | `{ path } \| null` | 另存为对话框 |

### 2.4 Vault 接口

| 通道 | 参数 | 返回 | 安全约束 |
|------|------|------|---------|
| `vault:pick` | 无 | `{ path } \| null` | 目录选择对话框 |
| `vault:list` | `(vaultPath)` | `VaultNode[]` | 设为 activeVault，启动 watcher，递归扫描（目录优先+名称排序） |
| `vault:read` | `(filePath)` | `{ path, content }` | `assertInsideVault` 路径逃逸校验 |
| `vault:read-all` | 无 | `Array<{ path, content }>` | 批量并发读取（CONCURRENCY=32） |
| `vault:write` | `(filePath, content)` | `{ path }` | 校验后写入 |
| `vault:create-file` | `(parentDir, name)` | `{ path }` | 自动补 `.md` 扩展名；重名加 `-1` 后缀；支持子路径创建 |
| `vault:create-folder` | `(parentDir, name)` | `{ path }` | 已存在则抛错 |
| `vault:rename` | `(oldPath, newName)` | `{ path }` | newName 不允许含路径分隔符；目标存在则抛错 |
| `vault:delete` | `(targetPath)` | `{ ok: true }` | `shell.trashItem`（移废纸篓，可恢复） |
| `vault:get-last` | 无 | `VaultState` | 从 `userData/vault.json` 读，自动清理不存在路径 |
| `vault:set-last` | `(vaultPath)` | `{ ok: true }` | 更新 lastVault + recents（去重截断到 10 条） |

### 2.5 安全约束

- `contextIsolation: true`, `nodeIntegration: false`
- 所有写入/读取路径经 `assertInsideVault(target)` 校验:
  - 无 activeVault → 抛 `"No active vault"`
  - `path.relative(activeVault, resolved)` 起头为 `..` 或绝对路径 → 抛 `"Path escapes vault"`
- 生产快捷键: Cmd/Ctrl+Shift+I 或 F12 切换 DevTools

---

## 三、核心引擎 API（@floatboat/nexus-core）

### 3.1 createEditor 配置

```typescript
interface EditorConfig {
  container: HTMLElement;              // 必填，挂载节点
  initialValue?: string;                // 初始 Markdown
  parser?: ParserLike;                  // 自定义解析器
  parseDelayMs?: number;                // AST 防抖延迟（默认 150）
  livePreview?: boolean | LivePreviewConfig;  // Live Preview
  plugins?: NexusPlugin[];              // 插件列表
  theme?: NexusTheme;                   // 主题
  locale?: Partial<NexusLocale>;        // 国际化
  tabSize?: number;                     // 默认 4
  direction?: "ltr" | "rtl";            // 文本方向
  indentGuides?: boolean;               // 缩进引导线（默认 false）
  readOnly?: boolean;                   // 只读模式（默认 false）
  multiCursor?: boolean;                // 多光标（默认 false）
  slashMenuLimit?: number;              // 斜杠菜单最大显示（默认 8）
  onChange?: (doc: string, ast: Root) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onAssetUpload?: (file: File) => Promise<string | null>;
}
```

### 3.2 EditorAPI 方法清单

**文档操作**:
- `getDocument()` → string
- `getAst()` → Root（mdast）
- `getTableOfContents()` → TocEntry[]
- `exportHTML()` → string
- `getDocumentStats()` → { lines, words, chars }
- `setDocument(next, opts?)` → void（opts.silent: 跳过 onChange）
- `replaceSelection(text)` → void
- `replaceRange(from, to, insert, selection?, opts?)` → void

**选区操作**:
- `getSelection()` → SelectionState
- `getSelections()` → SelectionRange[]
- `getSelectedText()` → string
- `setSelection(anchor, head?)` → void
- `setSelections(ranges, mainIndex?)` → void

**命令系统**:
- `getSlashCommands()` → SlashCommandDef[]
- `getCommands()` → EditorCommand[]
- `runCommand(id)` → void
- `runShortcut(key)` → void
- `undo()` / `redo()` → void

**资源上传**:
- `uploadAsset(file)` → Promise<string | null>（调用 onAssetUpload）

**焦点与 IME**:
- `focus()` / `blur()` → void
- `isComposing()` → boolean

**坐标映射**:
- `getCoordsAtPos(pos)` → { left, top, ... }
- `getPosAtDOM(node)` → number

**主题与事件**:
- `setTheme(theme)` → void
- `on(event, handler)` / `off(event, handler)` → void
- 事件: `change`, `focus`, `blur`, `selectionChange`, `slashMenuChange`

**生命周期**:
- `destroy()` → void

### 3.3 NexusPlugin 接口（三层扩展点）

```typescript
interface NexusPlugin {
  name: string;
  // Tier1: 业务逻辑层
  shortcuts?: Array<{ key: string; run: (editor: EditorAPI) => boolean }>;
  slashCommands?: SlashCommandDef[];
  commands?: EditorCommand[];
  handlers?: EditorEventHandlers;  // paste / drop / keydown
  // Tier2: 语法渲染层
  remarkPlugins?: Array<Plugin<[], Root, Root>>;
  widgets?: WidgetDefinition[];
  // Tier3: CM6 底层
  cmExtensions?: Extension[];
}
```

### 3.4 Live Preview 系统

- 光标感知折叠: 光标不在语法内时折叠为 Widget/Mark，移入时展开源码
- 支持节点类型: heading, bold, italic, strikethrough, code, link, image, list, blockquote, table, hr, codeblock
- 自定义渲染器: image（含尺寸解析、相对路径重写、拖拽 resize）
- `LivePreviewRenderer` 接口: 支持宿主自定义渲染逻辑

### 3.5 Wikilinks（内置）

- `[[target]]` 或 `[[target|alias]]` 语法
- 已解析链接: 实线下划线 accent 色
- 未解析链接: 虚线下划线 deletion 色
- 光标在本行: 显示原始 `[[...]]`
- 光标离开: 隐藏 `[[`/`]]`/`target|`，仅留 display 文本
- 单击触发 `onNavigate`
- `[[` 后触发 autocompletion（最多 50 候选，包含式过滤）
- `scanWikiLinks(doc)` 纯函数返回所有匹配
- IME compositionend 后延迟 60ms 重建装饰

### 3.6 多光标

- `selectNextOccurrence`: Mod-d（选中下一个匹配）
- `addCursorAbove` / `addCursorBelow`: Mod-Alt-ArrowUp/Down
- `collapseToMainSelection`: Mod-Esc
- Alt-click 在指定位置添加光标

### 3.7 核心扩展功能

- `markdownAutoPair`: Markdown 标记符自动配对（`**`/`*`/`~~`/`` ` `` 等）
- `markdownFold`: 代码块/标题折叠
- `markdownKeymap`: Markdown 特定快捷键（Enter 续行等）
- `handleMarkdownEnter`: Markdown Enter 处理

### 3.8 国际化

- `enLocale` / `zhLocale` 两种内置 locale
- `resolveLocale(custom?)` 合并用户自定义与默认

---

## 四、GFM 预设（@floatboat/nexus-preset-gfm）

```typescript
export function createGfmPreset(): NexusPlugin
```

- 注入 `remark-gfm` 到 unified pipeline
- 启用 mdast 扩展: autolink literals、footnotes（GFM 风格）、strikethrough、task lists、tables
- 无参数、无 cmExtensions、无 shortcuts/slashCommands/widgets
- 纯 Tier2（remarkPlugins）扩展

---

## 五、插件: 撤销重做（@floatboat/nexus-plugin-history）

```typescript
export function createHistoryPlugin(): NexusPlugin
```

- 封装 `@codemirror/commands` 的 `history()` + `historyKeymap`
- 快捷键: Ctrl/Cmd-Z（撤销）, Shift-Ctrl/Cmd-Z（重做）, Ctrl-U 等
- 无参数、无可配置项

---

## 六、插件: 斜杠命令（@floatboat/nexus-plugin-slash）

### 6.1 插件工厂

```typescript
createSlashPlugin(commands: SlashCommandDef[]): SlashPlugin
```

### 6.2 SlashCommandDef 定义

```typescript
interface SlashCommandDef {
  id: string;
  title: string;
  keywords?: string[];
  description?: string;
  run?: (editor: EditorAPI) => boolean | void;
}
```

### 6.3 斜杠状态计算

- `getSlashState(doc, cursor, commands, options?)` → SlashStateResult
- `filterSlashCommands(commands, query)` → 排序后的命令列表
- `getSlashMatch(doc, cursor)` → SlashMatch | null
- 默认 limit: 8 条
- 确定性排序: 精确匹配 > 标题前缀匹配 > 关键词包含 > 其他

### 6.4 菜单 UI（createSlashMenuUI）

- 浮动定位: 绝对定位到 `document.body`（避免 overflow 截断）
- 键盘: ArrowUp/Down 翻转高亮、Home/End 跳首尾、Enter/Tab 确认、Escape 关闭
- 鼠标: hover 同步高亮、click 确认、外部 mousedown/pointerdown 关闭
- IME: compositionstart/end 期间禁用键盘拦截
- 失焦自动 dismiss
- 视口边界处理: 底部翻转、右侧夹紧
- 确认时: 先删除 `/query` 触发文本，再调 `cmd.run(editor)`

### 6.5 命令历史（可选）

- `createSlashCommandHistory(config)`: 返回 `{ reorder, record } | null`
- `reorder(commands, query)`: 仅当 query 为空时按使用频次前置最近命令
- `record(commandId)`: 写入去重并截断
- 默认 storageKey: `nexus.slash.commandHistory`
- 默认 maxEntries: 20
- 存储 best-effort，失败不抛

---

## 七、插件: 工具栏（@floatboat/nexus-plugin-toolbar）

### 7.1 插件工厂

```typescript
createToolbarPlugin(): NexusPlugin
```

### 7.2 快捷键（8 条）

| 快捷键 | 操作 |
|--------|------|
| Mod-b | toggleBold |
| Mod-i | toggleItalic |
| Mod-Shift-s | toggleStrikethrough |
| Mod-e | toggleInlineCode |
| Mod-k | insertLink |
| Mod-1 | toggleHeading(editor, 1) |
| Mod-2 | toggleHeading(editor, 2) |
| Mod-3 | toggleHeading(editor, 3) |

### 7.3 斜杠命令（14 条）

| id | title | 说明 |
|----|-------|------|
| h1/h2/h3 | Heading 1/2/3 | 切换标题级别 |
| bold | Bold | 粗体 |
| italic | Italic | 斜体 |
| strikethrough | Strikethrough | 删除线 |
| inline-code | Inline code | 行内代码 |
| code-block | Code block | 代码块 |
| blockquote | Blockquote | 引用块 |
| ulist | Bulleted list | 无序列表 |
| olist | Numbered list | 有序列表 |
| link | Link | 链接 |
| image | Image | 图片 |
| hr | Divider | 水平分割线 |

### 7.4 工具栏 UI（8 组按钮）

1. **撤销重做**: undo / redo
2. **链接**: insertLink
3. **标题**: H2 / H3 / heading-menu（下拉，1-6 级 + Normal text）
4. **行内格式**: Bold / Italic / Strikethrough / Underline / Inline Code
5. **块级格式**: Blockquote / Code Block
6. **列表**: Ordered List / Unordered List
7. **颜色**: Text Color（40 色调色板）/ Highlight（20 色调色板）
8. **其他**: Image / Fullscreen

### 7.5 颜色装饰（colorDecorationExtension）

- 正则匹配 `<span style="color:...">...</span>` 与 `<mark style="background:...">...</mark>`
- 光标进入区间: 显示原始 HTML 标签
- 光标离开: 隐藏开/闭标签（零宽 HiddenTagWidget）+ 应用颜色样式
- composition 期间仅 map 不重建

### 7.6 格式化函数

- 行内: `toggleBold` / `toggleItalic` / `toggleStrikethrough` / `toggleInlineCode` / `insertLink` / `toggleWrap(editor, marker)`
- 块级: `toggleHeading(editor, level)` / `toggleBlockquote` / `toggleOrderedList` / `toggleUnorderedList` / `insertCodeBlock` / `insertImage` / `insertHorizontalRule`
- 颜色: `applyTextColor(editor, color)` / `applyHighlight(editor, color)`

### 7.7 UI 交互细节

- 每个按钮带 tooltip（hover/focus 显示，scroll/resize 跟随，Escape 关闭）
- 下拉菜单感知 Fullscreen API: `pickOverlayMount()` 在 fullscreen 元素内时挂到 fullscreen 元素
- 单击任意按钮后 `editor.focus()` 归还焦点

---

## 八、插件: 搜索（@floatboat/nexus-plugin-search）

### 8.1 插件工厂

```typescript
createSearchPlugin(options?: SearchPluginOptions): NexusPlugin
```

### 8.2 SearchPluginOptions

| 选项 | 默认 | 说明 |
|------|------|------|
| `top` | true | 面板渲染在内容上方 |
| `caseSensitive` | false | 大小写敏感 |
| `highlightSelectionMatches` | true | 选区高亮 |
| `history` | false | 搜索历史 |
| `labels` | - | 自定义文案 |

### 8.3 纯函数 API

- `findSearchMatches(doc, query, options?)` → SearchMatch[]
- `replaceAllMatches(doc, query, replacement, options?)` → string
- 选项: `caseSensitive`, `wholeWord`, `regexp`

### 8.4 搜索面板（NexusSearchPanel）

- 搜索框 / 替换框（可折叠，aria-expanded）
- 复选框: 大小写、正则、全字匹配
- 按钮: 上一个 / 下一个 / 全选 / 替换 / 替换全部 / 关闭
- 每个按钮带 tooltip
- 历史记录: ArrowUp/Down 召回（storageKey `nexus.search.history`, maxEntries 20）
- Enter: 搜索框=下一个(Shift=上一个)，替换框=替换下一个

### 8.5 表格搜索高亮

- `tableSearchHighlightPlugin`: CSS Custom Highlight API
- 在 live-preview 表格单元格内高亮搜索匹配
- 通过 `data-rendered-source-map` 将源码 offset 映射到渲染后 offset
- 浏览器不支持时静默降级

---

## 九、插件: 字数统计（@floatboat/nexus-plugin-wordcount）

### 9.1 插件工厂

```typescript
createWordCountPlugin(options?: WordCountPluginOptions): WordCountPlugin
```

### 9.2 统计维度（9 个）

| 维度 | 说明 |
|------|------|
| words | Latin + 数字 + CJK 贡献 |
| latinWords | Latin/西里尔/希腊/数字词段 |
| cjkCharacters | 原始 CJK 字符数 |
| characters | 按 code point 计 |
| charactersNoSpaces | 去空白 |
| lines | 尾随 \n 不增空行 |
| paragraphs | mdast paragraph 节点数 |
| sentences | [.!?。！？]+ 启发式 |
| readingTimeSeconds | 默认 238 wpm + 500 cpm |

### 9.3 WordCountState

```typescript
{
  doc: WordCountStats;       // 全文档统计
  selection: WordCountStats; // 选区统计
  isSelectionActive: boolean;
}
```

### 9.4 默认排除节点

`code, inlineCode, math, inlineMath, html, yaml, toml, definition, footnoteDefinition`

### 9.5 状态栏

- `role="status" aria-live="polite"`
- 子 span: words / characters / characters-no-spaces(可选) / reading-time(可选) / selection(可选)
- 阅读时间: ≤60s 显示 "< 1 min read"，否则分钟数
- 防抖: debounceMs 默认 150ms

### 9.6 CJK 支持

- `cjkUnit` 选项: "char"（默认）| "word"
- 中文/日文/韩文字符单独计数

---

## 十、Demo Renderer 集成（editor-shell.ts）

### 10.1 EditorShell 接口

```typescript
interface EditorShell {
  editor: EditorAPI;
  toolbar: ToolbarUI;
  slashMenu: SlashMenuUI;
  wordcount: WordCountPlugin;
  applySettings(settings: EditorSettings): void;
  loadDocument(content: string): void;
  destroy(): void;
}
```

### 10.2 插件加载顺序

1. `createGfmPreset()` — GFM 预设
2. `createHistoryPlugin()` — 撤销/重做
3. `createToolbarPlugin()` — 工具栏
4. `createSearchPlugin()` — 搜索/替换
5. `createWikilinksPlugin({ resolve, onNavigate, suggest })` — Wiki 链接
6. `createWordCountPlugin({ statusBar: { container, classPrefix } })` — 字数统计

### 10.3 图片 Live Preview 渲染器

- `parseImageSize(raw)`: 解析 `alt|width` 或 `alt|widthxheight`
- `resolveImageSrc(url, activeFile, vaultPath)`: 相对路径→`nexus-vault://vault/<encoded-rel>`，绝对 URL 直通
- wrapper + img + 右上角 `</>` 跳源码按钮 + 右下角拖拽 resize 手柄
- mouseenter/leave 切换 chrome 显隐
- error 事件替换为占位错误提示

### 10.4 主题映射

- `settingsToTheme(settings)`: EditorSettings → NexusTheme
- 支持: 字体族、字号、亮/暗模式、行高、字间距、等宽字体、自定义 CSS 变量

### 10.5 设置项

| 设置 | 类型 | 默认 | 说明 |
|------|------|------|------|
| livePreview | boolean | true | Live Preview 开关 |
| tabSize | number | 4 | Tab 宽度 |
| direction | "ltr"\|"rtl" | "ltr" | 文本方向 |
| indentGuides | boolean | false | 缩进引导线 |
| theme.* | various | - | 主题相关（字体/字号/模式等） |

### 10.6 Vault UI（Renderer 侧）

- 文件树面板（可折叠）
- 新建文件 `+` / 新建文件夹 `📂` / 打开 Vault `📁`
- 文件项点击 → `loadDocument(content)` → `setDocument(content, { silent: true })`
- dirty 状态标记: `[modified]`
- 外部变更（`vault:changed`）→ 自动刷新文件树 + 如当前文件变化则重载

---

## 十一、Demo UI 布局

### 11.1 顶部工具栏

| 按钮 | 功能 |
|------|------|
| Vault | 打开 Vault 目录 |
| Open | 打开单个文件 |
| Save | 保存当前文件 |
| Save As | 另存为 |
| 📑 | 切换 Vault 面板 |
| ☰ | 切换大纲面板 |
| 🔗 | 切换反链面板 |
| 🔍 | 切换搜索栏 |
| ⚙ | 设置面板 |

### 11.2 面板区域

| 面板 | 位置 | 功能 |
|------|------|------|
| Vault | 左侧 | 文件树 |
| Outline | 右侧 | 自动提取标题大纲 |
| Backlinks | 右侧 | 反向链接（依赖 LinkIndex） |

### 11.3 状态栏

| 区域 | 内容 |
|------|------|
| 字数统计 | words / chars / reading-time / selection |
| 文件状态 | 文件名 + [modified] + words + lines |

---

## 十二、统计汇总

| 维度 | 数量 |
|------|------|
| Electron IPC 通道 | 14 |
| Core EditorAPI 方法 | 30+ |
| NexusPlugin 扩展点 | 7（shortcuts/slashCommands/commands/handlers/remarkPlugins/widgets/cmExtensions）|
| 插件包 | 6（gfm + history + slash + toolbar + search + wordcount）|
| 工具栏按钮 | 19 |
| 工具栏斜杠命令 | 14 |
| 工具栏快捷键 | 8 |
| 字数统计维度 | 9 |
| EditorConfig 字段 | 18 |
| 事件类型 | 5（change/focus/blur/selectionChange/slashMenuChange）|

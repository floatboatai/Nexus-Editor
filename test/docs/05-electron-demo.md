# 05 — Electron Demo 分析

> 对应源码：`apps/electron-demo/`

---

## 定位

Electron Demo 是引擎能力的**展示窗口**，不是产品。[GOVERNANCE.md](file:///Users/mac/PycharmProjects/Nexus_Editor/GOVERNANCE.md) §4 明确声明：

> `apps/electron-demo` exists so people can see and try the engine. It is **not** a reference desktop product.

---

## 目录结构

```
apps/electron-demo/
├── electron/
│   ├── main.ts              ← 主进程（文件 IO、窗口管理、nexus-vault:// 协议）
│   └── preload.ts           ← 预加载（IPC bridge）
├── src/renderer/
│   ├── app.ts               ← 应用入口，组合所有 UI
│   ├── editor-shell.ts      ← 编辑器外壳，组装插件 + 自定义图片渲染
│   ├── state.ts             ← 应用状态（filePath、content、dirty）
│   ├── settings.ts          ← 设置（主题、Tab、缩进指引、方向）
│   ├── vault-panel.ts       ← 左侧文件树面板
│   ├── outline-panel.ts     ← 右侧大纲面板
│   ├── backlinks-panel.ts   ← 反向链接面板
│   ├── search-bar.ts        ← 搜索栏
│   ├── link-index.ts        ← 双链索引引擎
│   ├── path-utils.ts        ← 路径工具（跨平台）
│   ├── perf.ts              ← 性能监控
│   ├── bridge.d.ts          ← IPC bridge 类型声明
│   ├── index.html           ← HTML 入口
│   └── style.css            ← 全局样式
├── sample-vault/            ← 示例笔记库（12 个 md + 图片）
├── scripts/
│   └── dev-electron.mjs     ← 开发模式启动脚本
├── test/                    ← 6 个测试文件
├── package.json             ← Electron + electron-builder
├── tsconfig.json
└── vite.config.ts
```

---

## 插件加载

`editor-shell.ts` 中加载的插件（L139-L146）：

```typescript
plugins: [
  createGfmPreset(),       // GFM 预设（表格、删除线、任务列表）
  createHistoryPlugin(),   // 撤销/重做
  createToolbarPlugin(),   // 格式化工具栏
  createSearchPlugin(),    // 搜索替换
  wikilinksPlugin,         // 双链（来自 core）
  wordcount,               // 字数统计
]
```

额外 UI 组件：
- `createToolbarUI(editor)` — 工具栏 UI
- `createSlashMenuUI(editor)` — 斜杠菜单 UI

**未加载**：plugin-math（需 KaTeX）、plugin-vim（专业需求）

---

## 渲染进程功能

### 文件管理

| 功能 | 实现 |
|---|---|
| Vault 选择 | 用户选目录 → 文件树 |
| 文件列表 | 仅 .md/.markdown/.txt，排除 .git/node_modules |
| 文件切换 | dirty 保护（未保存→确认丢弃） |
| 新建文件 | 自动补 .md，重名加后缀 |
| 重命名/删除 | 磁盘操作 + 回收站 |
| 外部变更监听 | fs.watch → 300ms 内更新文件树 |

### 双链系统

| 功能 | 实现 |
|---|---|
| 双链索引 | `link-index.ts` — 正向/反向链接图 |
| 反向链接面板 | `backlinks-panel.ts` — 列出所有引用当前文件的条目 |
| 双链导航 | 点击 `[[Wikilink]]` 跳转目标文件 |
| 自动补全 | `[[` 后从 vault 笔记名中补全 |
| 未链接提及 | 扫描纯文本中的匹配词 |

### UI 面板

| 面板 | 位置 | 功能 |
|---|---|---|
| Vault Panel | 左侧 | 文件树浏览、新建/重命名/删除 |
| Editor | 中央 | Nexus 编辑器 + 工具栏 + 斜杠菜单 |
| Outline Panel | 右侧 | 标题导航（基于 `getTableOfContents()`） |
| Backlinks Panel | 右侧 | 反向链接列表 + 上下文片段 |
| Search Bar | 顶部 | Mod+F 搜索替换 |
| Status Bar | 底部 | 字数统计 + 阅读时间 |

---

## 主进程功能

| 功能 | 实现 |
|---|---|
| 文件 IO | 读/写/创建/重命名/删除（IPC） |
| 窗口管理 | BrowserWindow + 自定义协议 `nexus-vault://` |
| 路径安全 | 所有路径校验不逃逸出 vault 根 |
| Vault 持久化 | `vault.json` 存储上次路径 |
| 图片协议 | `nexus-vault://` 加载本地图片 |
| 自动恢复 | 启动时恢复上次 vault |

---

## 测试覆盖

| 测试文件 | 用例数 | 测试内容 |
|---|---|---|
| `state.test.ts` | 1 | 应用状态初始化（无文件、无内容、dirty=false） |
| `app-handlers.test.ts` | 5 | 文件打开成功/取消、保存到已知路径/另存为/取消 |
| `editor-shell.test.ts` | 3 | CM6 实例创建、内容变更标记 dirty、loadDocument 重置 dirty |
| `path-utils.test.ts` | 16 | `normalizeSlashes`（反斜杠/UNC）+ `joinPath`（多段拼接/空段） |
| `link-index.test.ts` | 20+ | 双链解析、反向链接、同目录优先、全局唯一 basename、锚点、增量更新/删除 |
| `sample-vault.test.ts` | 12 | 端到端 Vault 验证（hub 拓扑、别名、幽灵链接、锚点定位） |

测试重心在**双链索引系统**（link-index + sample-vault 占 60%+ 用例）。

---

## 打包配置

`package.json` 中的 `electron-builder` 配置支持：
- macOS（dmg）
- Windows（nsis）
- Linux（AppImage）

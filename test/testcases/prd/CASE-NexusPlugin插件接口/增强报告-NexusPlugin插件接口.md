# 增强报告 — NexusPlugin插件接口

- 用例文件: `test/testcases/prd/CASE-NexusPlugin插件接口/CASE-NexusPlugin插件接口-测试用例.md`（增强版，2078 行）
- 增强时间: 2026-08-11
- 源码范围: packages/core（editor.ts / types.ts / slash-state.ts / widget-extension.ts / index.ts）、packages/plugin-slash、packages/plugin-toolbar、packages/preset-gfm、packages/core/test、packages/plugin-slash/test、AGENTS.md

## 统计

- 总用例数: 38
- 总步骤数: 86
- 已增强步骤数: 86
- 增强覆盖率: 100%
- "待增强"残留: 0
- 前置条件增强: 38个用例中38个已补充完整setup代码（精确 import + 类型标注 + 陷阱注释）
- 新增陷阱提示: 21 条独立陷阱条目（用例内 `// 陷阱:` 注释共 32 处，含重复强调）

## 增强内容

- [API] 方法签名: 55 处
- [STATE] 状态字段: 44 处
- [EVENT] 事件参数: 8 处
- [DOM] 验证选择器: 25 处
- [AST] AST 断言: 13 处
- [数据] 数据断言: 5 处

## 关键发现（用例与源码不一致，已在用例中修正）

| # | 发现 | 涉及用例 | 修正说明 |
|---|------|---------|---------|
| 1 | 基础用例注释"光标默认在文档末尾"不成立：CM6 `EditorState.create` 未传 selection，初始光标在 offset 0（文档开头，editor.ts:545-546） | FP-02-02-N01 | `replaceSelection("triggered")` 在文档开头插入，断言值由 `"hello worldtriggered"` 修正为 `"triggeredhello world"` |
| 2 | CM6 `keymap.of` 的 run 回调第一个参数是 `EditorView` 而非 `EditorAPI`；原用例 `api.setDocument(...)` 中 `api` 实为 view，运行会抛 `TypeError`（view.setDocument 不存在） | FP-02-06-N03 | 修正为 `view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "bold-toogled" } })` |
| 3 | 补充说明：`getSlashCommands` 与 `runShortcut` 的聚合/查找都是 flatMap/find 语义，同名插件、同名 key 不冲突 | FP-02-01-E02、FP-02-02-B01 | 与基础用例预期一致，补充源码依据 |

## 陷阱提示明细

| # | 陷阱内容 | 来源 | 涉及用例 |
|---|---------|------|---------|
| 1 | 插件扩展（shortcuts/slashCommands/cmExtensions/widgets/commands）按 `plugins.flatMap(p => p.xxx ?? [])` 聚合，name 不参与去重、不校验 | editor.ts:247-252 | FP-02-01-N01/E01/E02/B01 |
| 2 | `runShortcut` 原样透传 run 回调返回值（`shortcut ? shortcut.run(api) : false`），未命中 key 返回 false（find 精确匹配，先注册者生效） | editor.ts:876-877 | FP-02-01-N01、FP-02-02-N01/N03/E01/B01 |
| 3 | destroy 后 `runShortcut` 首行 `if (destroyed) return false` 短路；destroy 有 `destroyed/destroying` 标志防重入 | editor.ts:872-874、924-952 | FP-02-01-F01 |
| 4 | CM6 初始光标在 offset 0（文档开头），`replaceSelection` 在此处插入 | editor.ts:545-546 | FP-02-02-N01、FP-02-03-F01 |
| 5 | 键盘事件必须带 `bubbles: true + cancelable: true` 才能被 CM6 keymap 捕获 | editor.test.ts:384-391 | FP-02-02-N02、FP-02-06-N03 |
| 6 | 快捷键 run 回调异常无 try/catch，直接向调用方冒泡 | editor.ts:877 | FP-02-02-E02 |
| 7 | `onChange` 签名固定 `(doc: string, ast: Root)`，非 silent 的 setDocument 同步触发 | types.ts:113 | FP-02-02-F01 |
| 8 | `slashMenuChange` 仅在 `slashCommands.length > 0` 且发生 selectionSet/docChanged 时触发 | editor.ts:621-651 | FP-02-03-N02 |
| 9 | 空查询时命令保持注册顺序（`commands.slice()`）；非空查询按标题前缀 startsWith 过滤 | slash-state.ts:82-84、122-127 | FP-02-03-N02/N03/D01 |
| 10 | 查询含空白（`/\s/.test(query)`）→ 菜单关闭（isOpen: false, commands: []） | slash-state.ts:53-56、161 | FP-02-03-B01 |
| 11 | `slashMenuLimit` 默认 8；limit=0 → 打开但空列表；limit<0 → 不设上限 | types.ts:112、slash-state.ts:165-169 | FP-02-03-E01 |
| 12 | 命令 run 钩子由宿主 UI 确认后调用，core 只计算菜单状态 | types.ts:289-300 | FP-02-03-F01 |
| 13 | 传自定义 `config.parser` 时 transformProcessor 不构建，remarkPlugins 不生效（测试禁止传 parser） | editor.ts:277-278 | FP-02-04-N01 |
| 14 | `getAst` 输出经 `transformAst` 同步转换；`exportHTML` 走独立 unified 管道（remarkParse→remarkPlugins→remarkRehype→rehypeStringify） | editor.ts:133-142、279-280 | FP-02-04-N01/N02/N03/D01 |
| 15 | 初始 AST 在 createEditor 期间同步转换，remark 插件异常直接外抛 | editor.ts:279-280 | FP-02-04-E01 |
| 16 | 多 remark 插件按 `processor.use` 注册顺序执行，前一输出是后一输入 | editor.ts:222-224 | FP-02-04-B01 |
| 17 | widget 渲染条件：nodeType 匹配 && `(!match || match(node))` && 选区不与 [from,to) 相交；渲染后自动带 `data-nexus-widget` 属性 | widget-extension.ts:71-76、136-137 | FP-02-05-N01/N02/N03 |
| 18 | `WidgetType.destroy` 委托 `definition.destroy?.(dom)`（选区进入范围触发 decoration 替换时调用）；render 的 source 为 `doc.slice(from,to)`（含围栏） | widget-extension.ts:80、140-142 | FP-02-05-E01/D01 |
| 19 | cmExtensions 按 flatMap 合并，同一 facet（如 editorAttributes）多值共存不覆盖；非法 extension 值 CM6 校验抛错 | editor.ts:249、545-546 | FP-02-06-N01/B01/B02/E01 |
| 20 | CM6 keymap run 回调参数是 `EditorView` 而非 `EditorAPI`；ViewPlugin 在编辑器创建时实例化 | @codemirror/view 契约、editor.test.ts:291-298 | FP-02-06-N02/N03 |
| 21 | AGENTS.md 通用原则：Fixture 断言应验证行为而非偶然文件内容；widget DOM 重建遵循 eq() 复用语义 | AGENTS.md Testing Conventions、Table Widget Rules | FP-02-05 组（通用） |

## import 路径映射

| API/类型 | import 来源 | 增强的用例 |
|---------|------------|-----------|
| createEditor | `@floatboat/nexus-core`（packages/core/src/index.ts） | 全部 38 个用例 |
| NexusPlugin / EditorAPI | `@floatboat/nexus-core`（packages/core/src/types.ts） | 全部 38 个用例 |
| SlashCommandDef | `@floatboat/nexus-core`（packages/core/src/types.ts） | FP-02-03-N01/D01/F01 |
| SlashMenuState | `@floatboat/nexus-core`（packages/core/src/types.ts） | FP-02-03-N02/N03/D01/E01/B01 |
| WidgetDefinition | `@floatboat/nexus-core`（packages/core/src/types.ts） | FP-02-05-N01 |
| EditorConfig | `@floatboat/nexus-core`（packages/core/src/types.ts） | 全局 import 约定 |
| Plugin（unified） | `unified`（npm，transformer 插件类型） | FP-02-04 全部 6 个用例 |
| Root（mdast） | `mdast`（npm，AST 根节点类型） | FP-02-04 全部 6 个用例 |
| EditorView / ViewPlugin / keymap | `@codemirror/view`（npm） | FP-02-06 全部 6 个用例 |
| describe / expect / it / vi | `vitest`（npm） | 全部 38 个用例 |
| createSlashPlugin（参考） | `@floatboat/nexus-plugin-slash`（packages/plugin-slash/src/index.ts） | FP-02-03 组（参考模式） |
| createToolbarPlugin（参考） | `@floatboat/nexus-plugin-toolbar`（packages/plugin-toolbar/src/index.ts） | FP-02-01/02 组（参考模式） |
| createGfmPreset（参考） | `@floatboat/nexus-preset-gfm`（packages/preset-gfm/src/index.ts） | FP-02-04 组（参考模式） |

## 未增强项

无（38/38 用例、86/86 步骤全部增强，无"待增强"残留）。

说明：本功能点为纯前端（Nexus_Editor 编辑器核心），无后端 API/数据库依赖，前置条件不涉及网络请求与数据创建，因此 setup 聚焦编辑器实例化与插件配置的精确类型。

## 备注

- 步骤中 `等待` 字段均为"无（同步断言）"：所有核心 API（runShortcut/setDocument/getAst/exportHTML/on 事件等）均在 CM6 updateListener 与 emitter 中同步执行，无需异步等待；键盘事件通过 `dispatchEvent` 同步派发。
- 增强报告中"新增陷阱提示 21 条"指独立陷阱条目数（见明细表）；用例文件内 `// 陷阱:` 注释共 32 处（含重复强调）。

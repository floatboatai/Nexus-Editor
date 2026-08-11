# 增强报告 — Roadmap 演进路线

> FP-07 Roadmap演进路线（Phase1 核心引擎 MVP / Phase2 框架拥抱 / Phase3 桌面端深度）
> 阶段: fp2tc 阶段B 源码增强（最后一个功能点）
> 增强日期: 2026-08-11

## 统计

- 总用例数: 32
- 总步骤数: 98
- 已增强步骤数: 98
- 增强覆盖率: 100%
- "待增强"残留: 0
- 前置条件增强: 32个用例中32个已补充完整setup代码（实现事实与陷阱提示块）
- 新增陷阱提示: 29条（`- 陷阱：`直接标注行）

## 增强内容

- [API] 方法签名: 13处
- [AST] 节点结构: 13处
- [DOM] 选择器: 34处
- [STATE] 状态字段: 31处
- [CALC] 计算公式: 2处
- [EVENT] 事件参数: 7处

> 注：以上为步骤表格"预期结果"列中的标记处数（合计 13+13+34+31+7+2 = 100，含 2 行双标记 [EVENT]+[CALC]，对应 98 步骤）。另有每个用例的"断言汇总"保留原标记。

## 关键发现（一致性修正）

| # | 发现 | 修正 |
|---|------|------|
| 1 | 用例头部原提示"Live Preview 链接渲染为带 `data-link-url` 属性的 `<a>` 元素（live-preview-renderers.ts:62）"与实际代码有出入：`live-preview-renderers.ts:62-67` 是块级 `<a>` 渲染路径（设置 `href`/`rel="noopener noreferrer"`/`title`），`data-link-url` 属性实际由 `live-preview.ts:1008` 的 mark 装饰器 `attrs: { "data-link-url": url }` 设置 | 头部提示已更新为准确来源；FP-07-01-N03 前置条件与预期结果按 live-preview.ts:1008 标注，既有测试 live-preview.test.ts:213-225 佐证 |

## 陷阱提示明细

| # | 陷阱内容 | 来源 | 涉及用例 |
|---|---------|------|---------|
| 1 | 挂载即同步渲染，`.cm-editor` 无需等待 | editor.ts:543-547 | FP-07-01-N01 |
| 2 | `change` 事件载荷顺序为 `(doc, ast)`；silent setDocument 跳过事件 | editor.ts:343,413,433 | FP-07-01-N02 |
| 3 | 光标所在行的链接不渲染装饰，必须先 `setSelection(doc.length)` 移出链接行 | live-preview.test.ts:213-225 | FP-07-01-N03 |
| 4 | mdast 文本需沿 blockquote → paragraph → text.value 取 | editor.ts:341 解析路径 | FP-07-01-N05 |
| 5 | 缺省/非法 container 走 `new EditorView({ parent })` 校验，必然抛错 | editor.ts:543-544 | FP-07-01-E01 |
| 6 | Lezer 容错解析不抛错，畸形段降级为文本/普通节点 | editor.ts:300 | FP-07-01-E02 |
| 7 | CM6 偏移按 UTF-16 code unit 计，等于 JS string length | editor.ts:748-751 | FP-07-01-B02 |
| 8 | destroy 幂等保护（destroyed/destroying 短路）；view.destroy 移除 DOM | editor.ts:925,967 | FP-07-01-F01 |
| 9 | `createGfmPreset()` 无参数；GFM 经 transformProcessor 应用 remark 插件 | preset-gfm/src/index.ts:5-8; editor.ts:277-280 | FP-07-02-N01 |
| 10 | CM6 `Mod` 在 jsdom（非 Mac UA）解析为 ctrlKey；keydown 需 bubbles/cancelable | plugin-history/src/index.ts:6-9 | FP-07-02-N02, FP-07-02-E02 |
| 11 | Search 面板 DOM 由插件挂载，容器需在 document.body；Mod-f 用 metaKey | plugin-search/src/index.ts:912,931,1143 | FP-07-02-N03, FP-07-02-E02 |
| 12 | React `Editor` 不接收 container prop（被 Omit）；onReady 只触发一次 | react/src/types.ts:7-16 | FP-07-02-N04 |
| 13 | useEditor 返回 editor 初始为 null，须在依赖 [editor] 的 effect 中守卫 | react/src/types.ts:26-29 | FP-07-02-N05 |
| 14 | Vue 挂载 DOM 异步渲染，断言前必须 await nextTick | vue/test/editor-vue.test.ts:8-23 | FP-07-02-N06 |
| 15 | 受控 value 外部更新经 silent setDocument 应用，切断 onChange 回环 | react/src/types.ts:11-16; editor.ts:413,433 | FP-07-02-F01 |
| 16 | WidgetDefinition 必填 nodeType + render；render 必须返回 HTMLElement | types.ts:322-341 | FP-07-02-D01 |
| 17 | `data-nexus-widget` 是框架自动附加的（= nodeType），render 里勿手动设置 | widget-extension.ts:137 | FP-07-03-N01, N02 |
| 18 | render 的 source 参数是源码范围切片 `doc.slice(from, to)` | widget-extension.ts:81 | FP-07-03-N01 |
| 19 | block 默认 true，inlineCode 必须显式 block: false 否则被提升独立行 | types.ts:327-333; widget-extension.ts:162 | FP-07-03-N02, B01 |
| 20 | ctx.setSelection 经 view.dispatch 并 clamp；光标进入范围 widget 让位 | widget-extension.ts:123-134,76 | FP-07-03-N03 |
| 21 | parseDelayMs 防抖：窗口内 clearTimeout 重置；`vi.useFakeTimers` 须在 createEditor 前 | editor.ts:282,346-361 | FP-07-03-N04 |
| 22 | 光标与源码范围相交（selectionIntersects）widget 回退原始 markdown | widget-extension.ts:28-35,76 | FP-07-03-E01 |
| 23 | nodeType 为精确字符串匹配，空串静默不渲染（不抛错） | widget-extension.ts:72-73 | FP-07-03-E02, E04 |
| 24 | match 谓词在 nodeType 命中后调用，参数为 AST 节点（node.lang 取语言） | widget-extension.ts:72-74; types.ts:324 | FP-07-03-E03 |
| 25 | ignoreEvents:true 只影响 CM6 事件解析，宿主自绑事件仍响应 | widget-extension.ts:145-147; types.ts:334-341 | FP-07-03-B02 |
| 26 | destroy 回调在 widget 被移除时经 definition.destroy?.(dom) 触发；断言调用次数 >= 1 | widget-extension.ts:141-143,213-217 | FP-07-03-F01 |

## import 路径映射

| API/类型 | import 来源 | 增强的用例 |
|---------|------------|-----------|
| createEditor / EditorAPI / EditorConfig / Root / TocEntry / WidgetDefinition / WidgetRenderContext | @floatboat/nexus-core | 全部 32 用例 |
| createGfmPreset | @floatboat/nexus-preset-gfm | FP-07-02-N01, FP-07-02-E02 |
| createHistoryPlugin | @floatboat/nexus-plugin-history | FP-07-02-N02, FP-07-02-E02 |
| createSearchPlugin / SearchPluginOptions | @floatboat/nexus-plugin-search | FP-07-02-N03, FP-07-02-E02, FP-07-02-D01 |
| Editor / useEditor / EditorProps | @floatboat/nexus-react | FP-07-02-N04, N05, F01, E01, D01 |
| Editor / useEditor / EditorProps | @floatboat/nexus-vue | FP-07-02-N06 |
| render / unmount | @testing-library/react | FP-07-02-N04, N05, F01, E01 |
| mount / nextTick | @vue/test-utils | FP-07-02-N06 |
| act / useState / useEffect | react | FP-07-02-F01, N05 |
| vi / useFakeTimers / advanceTimersByTime / useRealTimers | vitest | FP-07-03-N04 等全部 |

## 测试参考映射

| 用例组 | 测试参考文件 |
|--------|-------------|
| 核心创建/AST/Live Preview（FP-07-01） | packages/core/test/live-preview.test.ts |
| Widget 系列（FP-07-03） | packages/core/test/widgets.test.ts |
| React 绑定（FP-07-02-N04/N05/F01/E01） | packages/react/test/editor-react.test.tsx |
| Vue 绑定（FP-07-02-N06） | packages/vue/test/editor-vue.test.ts |

## 未增强项

无（32/32 用例、98/98 步骤全部完成增强；"待增强"残留 0）。

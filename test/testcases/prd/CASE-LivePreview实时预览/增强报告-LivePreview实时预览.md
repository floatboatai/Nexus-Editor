# 增强报告 — LivePreview实时预览

> FP-04 LivePreview 实时预览
> 增强日期: 2026-08-11
> 增强对象: `CASE-LivePreview实时预览-测试用例.md`（覆盖保存）
> 源码依据: `packages/core/src/live-preview.ts`、`live-preview-renderers.ts`、`live-preview-ranges.ts`、`live-preview-table.ts`、`widget-extension.ts`、`types.ts`、`packages/core/test/*.test.ts`、`AGENTS.md`

## 统计
- 总用例数: 24
- 总步骤数: 86
- 已增强步骤数: 86
- 增强覆盖率: 100%
- "待增强"残留: 0
- 前置条件增强: 24个用例中24个已补充完整setup代码
- 新增陷阱提示: 52条

## 增强内容
- [DOM] 选择器: 115处（`[data-heading-level]`、`[data-link-url]`、`[data-live-preview-image]`、`.nexus-mermaid`、`.nexus-table-wrapper`、`.nexus-cell`、`[role='code']`、`[aria-label='Code block: js']`、`input[type="checkbox"]`、`[style*="transparent"]`、`[style*="line-through"]`、`[style*="font-weight"]`、`[style*="font-style"]`、`[data-testid=...]`、`.cm-content`、`.cm-line` 等）
- [STATE] 状态字段: 25处（`setSelection` 光标偏移、`getSelections()` ranges 数、`data-mounts` 复用计数、`data-from/data-to` 绝对偏移、selection-only 事务分支等）
- [AST] 节点结构: 2处（`captured[0].nodeType === "strong"`、`ctx.text` 内容断言）

## 陷阱提示明细
| # | 陷阱内容 | 来源 | 涉及用例 |
|---|---------|------|---------|
| 1 | heading 光标检测 `selectionIntersects` 非 inclusiveEnd（空选区 `anchor >= from && anchor < to`），光标落在 `range.to` 处仍折叠 | live-preview.ts:447 / live-preview-ranges.ts:34 | FP-04-01-N01、FP-04-02-N03、FP-04-02-B02 |
| 2 | link/image/code 光标检测 `selectionIntersects(..., true)` 含右边界，光标落在 `range.to` 处展开（与 heading 语义相反） | live-preview.ts:866/1121/1149 / live-preview-ranges.ts:44-45 | FP-04-02-B01、FP-04-02-N02、FP-04-02-N04/N05 |
| 3 | 行内格式（strong/emphasis/delete/inlineCode）用**行级检测** `selectionOnSameLine` 而非范围检测，光标在同行任意位置（含行尾）即展开 | live-preview-ranges.ts:53 / live-preview.ts:1224-1242 | FP-04-01-N03、FP-04-02-N01、FP-04-01-B02 |
| 4 | `setSelection` 派发 selection-only 事务 → StateField 走 selection 分支以 `reuseCache=true` 同步重建，无需定时器；`afterEach` 需 `vi.useRealTimers()` 复位 | live-preview.ts:1374-1377 / live-preview.test.ts:7-24 | 全部用例（setup 约定） |
| 5 | mermaid 动态 `import("mermaid")` 懒加载 + `parse()` 先行 + `render()` 注入 svg（`MERMAID_CACHE` 缓存）；jsdom 无布局 API，必须 `vi.mock("mermaid")` 且 mock 必须导出 `default`；svg 为异步 Promise，须 `await vi.waitFor(...)` | live-preview.ts:206-215/239-407 / mermaid.test.ts:7 | FP-04-01-E01 |
| 6 | table 无论光标位置始终折叠为 `EditableTableWidget`（DOM 类名 `.nexus-table-wrapper`/`.nexus-cell`），光标移入进入单元格编辑而非展开源码 | live-preview.ts:1078-1086 / live-preview-table.ts:562/933/1773 | FP-04-01-B01 |
| 7 | table 编辑期 `isTableEditing()` 时 StateField 跳过全部 rebuild（docChanged 走 `decos.map`、selection 原样返回）；跨帧鼠标交互必须 `self.editing=true` + `tableEditingCount++`，cell blur 需检查 grip drag，onDragEnd 先释放 editing 再 dispatch | AGENTS.md Table Widget 规则 8/9/10/11/12 / live-preview.ts:1350-1352 | FP-04-01-B01 |
| 8 | 嵌套行内格式生成父子两个 range（外层 strong + 内层 emphasis），`parentSpans` 拦截仅针对 heading/table 子级，行内嵌套两套 mark 叠加（font-weight + font-style） | live-preview.ts:1067-1068/1212-1214 / live-preview-ranges.ts:142-150 | FP-04-01-B02 |
| 9 | 列表 marker 用 `LIST_MARKER_RE`/`CHECKBOX_RE` 正则；无序 bullet 替换为 `\u2022`，`[x]` 替换为 `input[type=checkbox][checked]`，已完成项加 `line-through` mark；光标在项首行 `[itemFrom, headLineEnd]` 时显示源码（inclusiveEnd=true） | live-preview.ts:472-473/509/522/538/569-575 | FP-04-01-N04 |
| 10 | image 折叠分支光标在内时"源码可见 + `Decoration.widget({block:true, side:1})` 预览追加在 end 之后"；`imgKey` 保证折叠/展开切换 widget DOM 可复用 | live-preview.ts:1121-1144 | FP-04-02-N05 |
| 11 | 多选区必须 `multiCursor: true` 才启用 `setSelections`；`selectionIntersects`/`selectionOnSameLine` 内部用 `selection.some()` 遍历全部 ranges，任一光标命中即展开 | types.ts:106 / live-preview-ranges.ts:40/64 / live-preview-regressions.test.ts:66-88 | FP-04-02-B03 |
| 12 | eqKey 复用机制：selection-only 更新（reuseCache=true）且 eqKey 相同 → CM6 复用旧 DOM（`data-mounts` 不增长）；`setDocument` 触发 docChanged → `reuseCache=false` 强制重建（eqKey 含 source 变化） | live-preview.ts:99/1368-1377 / widget-extension.ts NexusWidget.eq | FP-04-03-E01、FP-04-03-B01 |
| 13 | code fence 折叠靠 mark 变 `color:transparent`（光标在外）而非隐藏行；`Decoration.line` 只设 background/border-radius，不得设 font-family/font-size（高度图漂移）；首行 line attrs `role:code`/`aria-label` | live-preview.ts:883-925 | FP-04-01-N06、FP-04-02-N04 |
| 14 | 自定义 renderer 注册的节点类型走"始终 widget 折叠"分支（`!config.renderers.xxx` 判断），无光标判断，光标移入不展开源码 | live-preview.ts:1070/1255-1266 | FP-04-03-N01/N02/N03/E01/B01/D01 |

## import 路径映射
| API/类型 | import 来源 | 增强的用例 |
|---------|------------|-----------|
| `createEditor` | `@floatboat/nexus-core`（packages/core/src/index.ts:1 导出自 ./editor） | 全部 24 个用例 |
| `type LivePreviewRenderContext` | `@floatboat/nexus-core`（packages/core/src/types.ts:51-60 导出） | FP-04-03-N02/N03/E01/B01 |
| `vi` / `afterEach` / `expect` / `it` | `vitest` | 全部 24 个用例 |
| `vi.waitFor` | `vitest` | FP-04-01-E01（mermaid svg 异步等待） |
| `vi.mock("mermaid", ...)` | `mermaid`（模块 mock，mock 须导出 `default`，同 mermaid.test.ts:7） | FP-04-01-E01 |
| `React` | `react` | FP-04-03-N01/N02/N03/E01/B01/D01 |
| `createPortal` | `react-dom` | FP-04-03-N01/N02/N03/E01/B01/D01 |
| `LivePreviewConfig`（对象形态 renderers） | `@floatboat/nexus-core`（types.ts:73-77） | FP-04-03 全部 6 个用例 |

## 未增强项
{无 —— 24 个用例 86 步全部完成增强}

## 备注
- 用例文件结构: FP-04-01（9 用例）+ FP-04-02（9 用例）+ FP-04-03（6 用例），每个一级功能点用例区域末尾均附「增强信息来源」块（装饰生成 / 渲染器 / 区间收集 / 类型契约 / 测试参考 / 陷阱提示来源）。
- 折叠/展开的精确 DOM 选择器与光标偏移（`setSelection` 参数）均依据 `live-preview.ts` 中 `buildDecorations` 各分支（heading:432 / list:475 / code:857 / image:1121 / link:1145 / inline:1224）与 `live-preview-ranges.ts` 的 `selectionIntersects`/`selectionOnSameLine` 计算，可直接转为可执行 Vitest 断言。

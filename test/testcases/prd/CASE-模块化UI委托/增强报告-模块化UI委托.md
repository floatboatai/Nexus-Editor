# 增强报告 — 模块化UI委托

> 增强对象: `CASE-模块化UI委托-测试用例.md`（FP-06，共 28 个用例 / 95 个步骤）
> 增强方式: 逐用例逐步骤注入源码精确信息（import 路径、API 签名、事件载荷结构、状态字段、陷阱提示）

## 统计
- 总用例数: 28
- 总步骤数: 95
- 已增强步骤数: 95
- 增强覆盖率: 100%
- "待增强"残留: 0
- 前置条件增强: 28个用例中28个已补充完整setup代码（含 import 来源标注 + 陷阱提示注释）
- 新增陷阱提示: 35条

## 增强内容
- [EVENT] 事件参数: 29处（`slashMenuChange` 载荷 `SlashMenuState` 六字段结构、`selectionChange` 载荷 `{anchor,head,ranges,mainIndex}`、关闭态固定载荷）
- [STATE] 状态字段: 21处（`isOpen/from/to/query/commands/coords`、`display: block/none`、`position: fixed`、定位公式 `left=coords.left`/`top=coords.bottom+offset`）

## 陷阱提示明细
| # | 陷阱内容 | 来源 | 涉及用例 |
|---|---------|------|---------|
| 1 | `slashMenuChange` 仅在 `slashCommands.length > 0` 时 emit（editor.ts:634 门控），未注册 slash 命令时完全静默 | packages/core/src/editor.ts | FP-06-01-E01 |
| 2 | setDocument + setSelection 各产生一次 CM6 update → 各 emit 一次，断言必须取末次载荷（`mock.calls.at(-1)`） | packages/core/src/editor.ts:621 | FP-06-01-N01/N02/F01、FP-06-02-N01/F01 |
| 3 | jsdom 下 `coordsAtPos` 返回 null → `coords === null` 属合法降级，不影响状态推送 | packages/core/src/editor.ts:643-646 | FP-06-01-N02/D01、FP-06-03-E01 |
| 4 | EventEmitter 用 Set 存储 handler：同一 handler 重复 on 只回调一次（去重语义） | packages/core/src/event-emitter.ts:10 | FP-06-02-E02 |
| 5 | `off` 对未注册 handler 幂等安全（`set.delete` no-op），不抛错 | packages/core/src/event-emitter.ts:14 | FP-06-02-E01 |
| 6 | `destroy()` 执行 `emitter.clear()` + `!destroyed` 短路 → destroy 后不再 emit | packages/core/src/editor.ts:621,965 | FP-06-02-B02 |
| 7 | 关闭态载荷固定 `{isOpen:false, from:null, to:null, query:"", commands:[]}`，commands 恒为数组非 null | packages/core/src/slash-state.ts:161 | FP-06-01-E02/E03、FP-06-02-N04 |
| 8 | `slashMenuLimit` 默认 8（DEFAULT_LIMIT），limit=0 → isOpen 仍 true 且 commands=[]（无结果占位契约）；limit<0 不截断 | packages/core/src/slash-state.ts:26,165,169 | FP-06-02-E03/B01 |
| 9 | 空 query（"/"）返回全部命令且保持插件注册序（`commands.slice()`），不做排序 | packages/core/src/slash-state.ts:122-127 | FP-06-01-N01/B01、FP-06-02-D01 |
| 10 | 匹配分档：title 精确 6000 > title 前缀 5000 > keyword 精确 4000 > title 子串 3000 > keyword 前缀 2000 > keyword 子串 1000 | packages/core/src/slash-state.ts:32-38 | FP-06-02-N01/F01 |
| 11 | 斜杠前非空白字符（URL/路径）不触发；query 含空白关闭 | packages/core/src/slash-state.ts:50-56 | FP-06-01-E02/E03 |
| 12 | 菜单实际类名为 `nexus-slash-menu`（`${classPrefix}-menu`，默认 prefix "nexus-slash"）；`.nexus-slash` 恒不命中 | packages/plugin-slash/src/menu-ui.ts:89,97 | FP-06-01-N03、FP-06-03-N01 |
| 13 | 定位公式 `top = coords.bottom + offset`（offset 默认 4）；coords 为 null 时仅显示不移动（display 已置 block） | packages/plugin-slash/src/menu-ui.ts:76,230-234 | FP-06-03-N02/E01 |
| 14 | `createSlashMenuUI` 默认挂载 `document.body`（`position: fixed` 脱离容器 overflow 约束），支持 `{container: HTMLElement|ShadowRoot}` | packages/plugin-slash/src/menu-ui.ts:91,101 | FP-06-03-N01/B01 |
| 15 | `menu.destroy()` 顺序：editor.off(slashMenuChange) → editor.off(blur) → removeEventListener → removeChild（parentElement === null） | packages/plugin-slash/src/menu-ui.ts:465-477 | FP-06-03-E02 |
| 16 | 菜单项渲染为 `li[role="option"]`，容器 `role="listbox"`；选中态经 `aria-selected` 维护 | packages/plugin-slash/src/menu-ui.ts:105,280-310,322 | FP-06-03-N01/F01 |
| 17 | `getSlashCommands()` 返回内部数组，与空 query 载荷同源同序 | packages/core/src/editor.ts:765-767 | FP-06-02-D01 |
| 18 | `selectionChange` 载荷结构 `{anchor, head, ranges, mainIndex}`，slash 范围 `to` 与光标位置一致 | packages/core/src/editor.ts:626-631 | FP-06-01-N04 |

## import 路径映射
| API/类型 | import 来源 | 增强的用例 |
|---------|------------|-----------|
| `createEditor` / `EditorAPI`（on/off/destroy/setDocument/setSelection/getSlashCommands） | `@floatboat/nexus-core`（vitest.config.ts 别名 → packages/core/src/index.ts 重新导出，实现 editor.ts） | 全部 28 个用例 |
| `SlashMenuState`（类型：isOpen/from/to/query/commands/coords） | `@floatboat/nexus-core`（types.ts:123-130） | FP-06-01-N01/N02、FP-06-02-N01、FP-06-03-N02 |
| `SlashCommandDef`（类型：id/title 必填，keywords/description 可选） | `@floatboat/nexus-core`（types.ts:280-284） | 全部 28 个用例 |
| `createSlashMenuUI` / `SlashMenuUI`（element/destroy/show/setHighlight/run） | `@floatboat/nexus-plugin-slash`（index.ts re-export，实现 menu-ui.ts） | FP-06-03 全部 6 个用例 |
| `computeSlashState`（供理解状态计算契约，不需直接调用） | packages/core/src/slash-state.ts | FP-06-01/FP-06-02 状态类断言 |
| `vitest`（afterEach/expect/it/vi） | `vitest` 包（environment: jsdom） | 全部 28 个用例 |

## 未增强项
无（28/28 用例、95/95 步骤全部增强；"待增强"残留 0）。
说明: FP-06-03 用例的 setup 中保留了原有简化 spy 风格并补充了 `@floatboat/nexus-plugin-slash` import 与 `SlashMenuUI` 类型，未改动原有断言语义。

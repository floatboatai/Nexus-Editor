# 增强报告 — EditorConfig配置

> 功能点: FP-01 EditorConfig 配置对象
> 增强对象: `CASE-EditorConfig配置-测试用例.md`（47 个用例，7 个二级功能点）
> 源码来源: packages/core/src/{editor.ts, types.ts, theme.ts, index.ts}、packages/core/test/{editor.test.ts, events.test.ts}、AGENTS.md
> 增强日期: 2026-08-11

## 统计

- 总用例数: 47
- 总步骤数: 139
- 已增强步骤数: 139
- 增强覆盖率: 100%
- "待增强"残留: 0
- 前置条件增强: 47 个用例中 47 个已补充完整 setup 代码增强说明（import 路径 + API 签名 + EditorConfig 参数类型 + 陷阱提示）
- 新增陷阱提示: 16 条

## 增强内容

- [API] 方法签名: 86 处
- [DOM] 选择器: 37 处
- [STATE] 状态字段: 78 处
- [EVENT] 事件参数: 28 处

## 陷阱提示明细

| # | 陷阱内容 | 来源 | 涉及用例 |
|---|---------|------|---------|
| 1 | ⚠️ **`themePrefix` 配置项在真实实现中不存在**：`EditorConfig`（types.ts:79-121）无该字段，theme.ts `VAR_MAP` 硬编码 `--nexus-*` CSS 变量；测试须用 `as unknown as EditorConfig` 绕过 TS，断言改查 `--nexus-bg` | packages/core/src/types.ts + theme.ts | FP-01-04-N01/N02/E01/B01/B02/F01 |
| 2 | 无效 container（undefined/null）无源码层校验，由 CM6 `new EditorView({ parent })` 构造期抛 TypeError | packages/core/src/editor.ts:543 | FP-01-01-E01/E02 |
| 3 | CM6 以 `parent: config.container` **追加**挂载（不 innerHTML 清空），容器原子节点保留 | packages/core/src/editor.ts:543-544 | FP-01-01-F01 |
| 4 | `initialValue` 缺省回落空串 `config.initialValue ?? ""`，空文档 AST 为 root + 空 children | packages/core/src/editor.ts:546 | FP-01-02-B01 |
| 5 | 未闭合代码块等非法 Markdown 走 Lezer 容错解析，不崩溃且原文保留（参考测试 editor.test.ts:176-197） | packages/core/test/editor.test.ts | FP-01-02-E01 |
| 6 | jsdom 下快捷键测试推荐 `editor.runShortcut(key)` API 替代 DOM keydown 派发（keymap 扩展注入） | packages/core/src/editor.ts:720 + types.ts:257 | FP-01-03-N02 |
| 7 | `getCommands()` 含内置命令，空插件断言应为"无插件命令"而非空数组 | packages/core/test/editor.test.ts:38-47 | FP-01-03-B02 |
| 8 | `setDocument` 无节流，每次 dispatch 触发一次 onChange；`{ silent: true }` 只抑制回调、文档仍更新 | packages/core/src/editor.ts:586-606 | FP-01-05-E01/E02/B01 |
| 9 | IME 组合输入期间 `setDocument` 推迟到 compositionend 应用（jsdom 无 IME 场景） | packages/core/src/editor.ts:810-819 | FP-01-05-E01/E02、FP-01-02-B02 |
| 10 | 初始创建**不触发** onChange（初始 doc 不构成 update 事件），外部状态同步需注意避免重复写回 | packages/core/src/editor.ts:586-599 | FP-01-05-N01/D01 |
| 11 | `focus()/blur()` 有 destroyed 短路（destroy 后静默返回）；`setFocused` 中 `focused===next` 短路（重复 focus 只触发一次 onFocus，幂等） | packages/core/src/editor.ts:855-886 | FP-01-06-E01/B01 |
| 12 | 事件双通道并存：config 回调（onFocus/onBlur/onChange）与 emitter 事件（editor.on("focus")），可任选其一断言 | packages/core/test/events.test.ts | FP-01-06-N01 |
| 13 | 拖拽插入在**异步 IIFE** 中执行（drop 防抖 100ms 后 insertUploadedAssets），测试需 `await flushMicrotasks()`/`vi.waitFor` 等待 | packages/core/src/editor.ts:674-682、481-499 | FP-01-07-N02/E01/F01/B01 |
| 14 | 未配置 onAssetUpload 时：drop **不消费**（return false，defaultPrevented=false）、`uploadAsset` 返回 `Promise.resolve(null)` | packages/core/src/editor.ts:674-675、768-774 | FP-01-07-E02 |
| 15 | 异常传播路径差异：`uploadAsset` 直接调用异常向上传播；仅**拖拽路径**（insertUploadedAssets）内部 try/catch 跳过失败文件 | packages/core/src/editor.ts:487-489 | FP-01-07-E03 |
| 16 | 文件类型分支：`type.startsWith("image/")` → 图片语法 `![label](url)`；否则 → 链接语法 `[label](url)`（label=file.name） | packages/core/src/editor.ts:491-494 | FP-01-07-N02/F01/B01 |

## import 路径映射

| API/类型 | import 来源 | 增强的用例 |
|---------|------------|-----------|
| `createEditor` | `@floatboat/nexus-core`（index.ts:1） | 全部 47 个用例 |
| `lightTheme` / `darkTheme` / `type NexusTheme` | `@floatboat/nexus-core`（index.ts:22） | FP-01-04 全部 |
| `type EditorConfig` | `@floatboat/nexus-core`（index.ts:35） | FP-01-01-E01/E02、FP-01-04 全部 |
| `type EditorAPI` | `@floatboat/nexus-core`（index.ts:33） | 全部（API 签名标注） |
| `type EditorCommand` | `@floatboat/nexus-core`（index.ts:34） | FP-01-03-E01 |
| `type SlashCommandDef` | `@floatboat/nexus-core`（index.ts:52） | FP-01-03-N01/B01/B02 |
| `type SetDocumentOptions` | `@floatboat/nexus-core`（index.ts:54） | FP-01-05-E01/E02/B01 |
| `type EditorEventHandler` / `EditorEventContext` | `@floatboat/nexus-core`（index.ts:37-38） | FP-01-03-F01 |
| `EditorView` | `@codemirror/view`（测试参考 editor.test.ts:2 同款） | FP-01-03-N03 |
| `Root`（mdast） | `mdast` 类型包（测试参考 editor.test.ts:1） | FP-01-05-N02 |
| `vi.fn()` / `expect` | Vitest 内置（无需 import） | 全部断言步骤 |

## 关键发现（需求与实现不一致）

1. **`themePrefix` 配置项不存在**（FP-01-04 全部 6 个用例受影响）：`EditorConfig`（types.ts:79-121）中无 `themePrefix` 字段，theme.ts `VAR_MAP`（81-99 行）将颜色 token 硬编码为 `--nexus-*`。原用例预期 `--nx-`/`--my-`/`--df-` 等自定义前缀均为需求假设，真实实现中不会出现。用例已标注"⚠️ 实现差异"，断言修正为检查 `--nexus-bg`，setup 使用 `as unknown as EditorConfig` 绕过 TS。**建议向需求方确认是否需要在 EditorConfig 中补加该配置项。**
2. **`onChange` 初始加载不触发**（FP-01-05-D01）：源码初始 doc 在 EditorState 构造期写入，不经过 updateListener 的 docChanged 路径，与用例预期一致。
3. **`setDocument` silent 语义**（FP-01-05-E02）：`{ silent: true }` 仅抑制 onChange 回调，文档内容仍更新，用例断言已按此校准。

## 未增强项

无（47 个用例全部步骤已增强，覆盖率 100%）

## 测试参考模式（editor.test.ts / events.test.ts）

- setup 模式: `import { createEditor } from "../src/index"`（包内测试）/ `@floatboat/nexus-core`（外部消费者）；`document.createElement("div")` + `createEditor({ container, initialValue, onChange })`
- 断言模式: `expect(editor.getDocument()).toBe("next")`、`expect(docs).toEqual(["next"])`
- 事件模式: `editor.on("focus", handler)` + `expect(onFocus).toHaveBeenCalledOnce()`
- fixture 原则（AGENTS.md Testing Conventions）: 断言验证行为而非 incidental 文件内容——本用例集为纯 API/DOM 断言，不依赖具体 fixture 内容

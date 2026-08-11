# 增强报告 — e2e 补充（prd）

> 生成时间: 2026-08-11
> 用例文件: test/testcases/prd/CASE-e2e补充/CASE-e2e补充-测试用例.md
> 增强模式: 基础 + 增强一步完成（信息在生成前已通过源码查询注入）

## 统计

- 总用例数: 28
- 总步骤数: 56
- 已增强步骤数: 56
- 增强覆盖率: 100%
- "待增强"残留: 0
- 前置条件增强: 28个用例全部包含完整 setup 代码（含 import、launchDemo、输入/拖拽辅助函数）
- 新增陷阱提示: 3

## 增强内容

- [API] 方法签名: 0处（e2e 层不直接调用 EditorAPI，通过 DOM/宿主钩子断言）
- [AST] 节点结构: 0处
- [DOM] 选择器: 21处（.cm-content / .cm-editor / .cm-focused / .nexus-slash-menu / role=option / body）
- [STATE] 状态字段: 6处（onAssetUpload 存在性、silent 加载、防抖、焦点持有、dismissed 锁存）
- [CALC] 计算公式: 0处
- [EVENT] 事件参数: 8处（onAssetUpload 回调参数、paste/drop 事件、onChange 管线触发）

## 陷阱提示明细

| # | 陷阱内容 | 来源 | 涉及用例 |
|---|---------|------|---------|
| 1 | demo 未配置 onAssetUpload/onFocus/onBlur，回调触发断言需宿主启用测试钩子（标注"待确认"） | apps/electron-demo/src/renderer/editor-shell.ts L128-L331 | FP-01-07-N01~E02/B01、FP-01-06 全部 |
| 2 | 斜杠菜单可能因 dismissed 锁存未打开，过滤类用例需先输入文字清除锁存 | test/e2e/editor.spec.ts L158-L165 | FP-06-02-N02 |
| 3 | onAssetUpload 的 drop/paste handler 仅在 config.onAssetUpload 存在时接管文件事件，否则返回 false 交回 CM6 | packages/core/src/editor.ts L674-L702 | FP-01-07-B02 |

## import 路径映射

| API/类型 | import 来源 | 增强的用例 |
|---------|------------|-----------|
| launchDemo | ../helpers/electron-launcher（test/e2e/helpers/electron-launcher.ts） | 全部 28 例 |
| typeInEditor / pressEnter / dropFiles | 全局 setup 辅助函数（复用 test/e2e/editor.spec.ts 模式） | 全部 28 例 |
| ElectronApplication / Page | @playwright/test | 全部 28 例 |

## 源码引用

| 信息 | 位置 |
|------|------|
| paste/drop 文件事件处理器 | packages/core/src/editor.ts L674-L702 |
| uploadAsset API | packages/core/src/editor.ts L768-L774 |
| EditorConfig 回调签名（onChange/onFocus/onBlur/onAssetUpload） | packages/core/src/types.ts L113-L120 |
| demo createEditor 配置（onChange、multiCursor、plugins） | apps/electron-demo/src/renderer/editor-shell.ts L128-L331 |
| loadDocument silent 加载 | apps/electron-demo/src/renderer/editor-shell.ts L357-L374 |
| e2e 启动基础设施 | test/e2e/helpers/electron-launcher.ts |

## 未增强项

无（28/28 全部增强，覆盖率 100%）

## e2e 落地执行结果（2026-08-11）

落地文件: test/e2e/prd-e2e.spec.ts（Playwright / Electron demo，串行 workers=1）

| 结果 | 数量 | 说明 |
|------|------|------|
| ✅ passed | 22 | 全部可执行用例通过 |
| ⏭️ skipped | 6 | FP-01-07-N01/N02/N03/N04/E01/B01（依赖宿主 onAssetUpload 钩子，待确认） |
| ❌ failed | 0 | 无 |

### 执行中发现的问题与修复

| # | 问题 | 根因 | 修复 |
|---|------|------|------|
| 1 | FP-03-01-E01 断言失败 | `.cm-content` DOM textContent 被 CM6 渲染层截断为 2014（doc 实际 10240，wordcount 状态栏证明） | 改为断言状态栏 "10,240 chars" |
| 2 | FP-06-02-N02 clearEditor 超时 | 共享 page 下 N01 结束时斜杠菜单残留，拦截 `.cm-content` 点击 | N01 末尾 Escape 关闭菜单；N02 开头兜底 Escape |

### 新增测试经验（供后续 e2e 用例复用）

1. **大文本断言不要依赖 `.cm-content` textContent 长度**——CM6 渲染层可能截断 DOM 文本，应通过 wordcount 状态栏/CM6 doc 维度断言
2. **共享 page 的串行用例需自行清理浮动 UI**——斜杠菜单、弹出层等残留会拦截后续用例的指针操作，每个用例开头兜底 Escape/清理

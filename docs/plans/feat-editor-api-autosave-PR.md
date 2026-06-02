<!--
PR title must follow Conventional Commits:  <type>(<scope>): <subject>
  e.g.  feat(toolbar): list toggle for multi-line selection
Allowed scopes — see CONTRIBUTING.md §2
-->

## Summary / 摘要

为 `EditorAPI` 新增 `getCursorPosition()` 和 `getScrollInfo()` 两个查询 API；并创建 `plugin-autosave` 包，提供去抖自动保存、文档快照脏状态检测和 SPA 路由安全刷新能力。

## Motivation / 背景与动机

- Issue: N/A
- Roadmap (docs/ROADMAP.md): N/A（核心 API 补齐 + 新插件）
- OpenSpec change: N/A

**B 部分**：`EditorAPI` 已有 `getDocumentStats()`（字数统计）但缺少光标位置和滚动信息查询——状态栏、滚动联动等宿主常见场景当前无法在不直接操作 CM6 的前提下实现。

**C 部分**：每个笔记应用都需要自动保存。目前宿主开发者必须自己实现去抖、脏状态追踪和 SPA 路由离开保护。一个开箱即用的 autosave 插件能省掉每个宿主 ~200 行重复代码。

## Changes / 变更内容

- `packages/core`:
  - `types.ts` — EditorAPI 新增 `getCursorPosition()`、`getScrollInfo()`、`_nexusView`（@internal）
  - `editor.ts` — 实现新增 API；`_nexusView` 供插件访问 CM6 EditorView 实例

- `packages/plugin-autosave`（新建）:
  - `src/index.ts` — `createAutosavePlugin({ onSave, debounceMs })` 配置函数，返回 `NexusPlugin`；内部使用 `WeakMap<EditorView, AutosaveState>` 存储 Per-View 运行时状态（timer、文档快照）；`isDirty(editor)` 基于 `view.state.doc.eq(lastSavedDoc)` 的快照脏检测（非 boolean flag）；`forceSave(editor)` 立即刷新，不等待 Promise
  - `test/plugin-autosave.test.ts` — 11 个测试：去抖、脏追踪、保存成功/失败、forceSave、destroy 清理、debounceMs=0、插件未注册时的空值保护
  - `README.md` — 使用文档

## Design Decisions

### 为什么不用 boolean dirty flag

```
错误: dirty = true → onSave → dirty = false
问题: 如果 onSave 是异步的，保存期间用户继续打字 → dirty 被错误置为 false
正确: 保存时 capture 当时的文档快照 (CM6 Text)，对比 current.doc vs lastSavedDoc
```

### 为什么状态放在 WeakMap<EditorView, AutosaveState> 而不是插件实例上

```
错误: createAutosavePlugin() 返回带 isDirty() 方法的对象
问题: 分屏或 React 严格模式下，同一插件实例可能被多个 EditorView 共享 → 定时器串扰
正确: 运行时状态完全托管在 CM6 ViewPlugin 生命周期内，WeakMap 按 view 隔离。
isDirty(editor) / forceSave(editor) 是纯函数，通过 editor._nexusView 定位到对应 view 的状态。
```

### 为什么 await 之前要同步 capture 快照

```
错误: await onSave(doc) → this.lastSavedDoc = this.view.state.doc
问题: await 之后 this.view.state.doc 可能已被并发编辑修改 → 把未保存的新内容标记为 "已保存"
正确: const snapshot = this.view.state.doc (同步) → await onSave(snapshot.toString()) → this.lastSavedDoc = snapshot
```

## Testing / 测试

- [x] `pnpm test` passes / 全绿（29 files, 325 tests）
- [x] `pnpm typecheck` / 0 errors
- [x] Affected packages build — core 构建通过
- [x] New / updated vitest cases — 11 个新用例覆盖 autosave 全部路径

## Checklist / 自检清单

- [x] Title follows Conventional Commits
- [x] Public API changes update package README / types — `plugin-autosave` 已附 README；`types.ts` 新增方法已标注 JSDoc
- [x] Touched `live-preview-table.ts` — N/A
- [x] New capability / breaking change — 无破坏性变更；`_nexusView` 标记 `@internal`
- [x] No secrets / personal vault data committed

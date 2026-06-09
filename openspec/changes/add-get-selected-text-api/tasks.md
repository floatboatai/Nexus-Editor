# Tasks: 新增 getSelectedText() API

## 1. 实现

- [x] 1.1 在 `packages/core/src/types.ts` 的 `EditorAPI` 接口中新增 `getSelectedText(): string` 方法签名
- [x] 1.2 在 `packages/core/src/editor.ts` 的 `api` 对象中实现 `getSelectedText()` 方法
- [x] 1.3 处理正向选区（anchor < head）和反向选区（anchor > head）两种情况
- [x] 1.4 为测试补充 `__test_getView()` 辅助方法（不加入公开接口）

## 2. 测试

- [x] 2.1 新增测试：无选区（光标状态）时返回 `""`
- [x] 2.2 新增测试：正向选区 `dispatch({ anchor: 0, head: 5 })` 返回 `"Hello"`
- [x] 2.3 新增测试：正向选区含标点 `dispatch({ anchor: 5, head: 13 })` 返回 `", world!"`
- [x] 2.4 新增测试：反向选区 `dispatch({ anchor: 5, head: 0 })` 返回 `"Hello,"`
- [x] 2.5 运行 `pnpm test` 确认 `packages/core/test/editor.test.ts` 全部通过（29/29）

## 3. 文档

- [x] 3.1 为 `getSelectedText()` 方法添加 JSDoc 注释
- [x] 3.2 新增 `docs/getSelectedText-dev-notes.md` 开发笔记

## 4. 提交与推送

- [ ] 4.1 提交所有改动到 `feature/get-selected-text` 分支
- [ ] 4.2 推送到 `sesametian/Nexus-Editor` fork
- [ ] 4.3 创建 PR 到 `floatboatai/Nexus-Editor:main`

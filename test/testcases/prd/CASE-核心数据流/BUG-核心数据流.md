# BUG 记录 - 核心数据流

> 本文件记录执行过程中发现的源码缺陷。无 BUG 时保持此头部不变。

---

## BUG-001: CM6 history 合并相邻变更，混合 input+setDocument 无法逐步 undo/redo

- **状态**: 🐛 已复现
- **严重程度**: 中（影响 undo/redo 精确性）
- **关联用例**: FP-03-01-F02
- **测试框架**: Vitest
- **首次发现**: 2026-08-11
- **涉及源码**: packages/plugin-history/src/index.ts（createHistoryPlugin 返回标准 CM6 history()）；packages/core/src/editor.ts（undo/redo 调用 cmUndo/cmRedo）
- **复现步骤**:
  1. `createEditor({ initialValue: "", plugins: [createHistoryPlugin()] })`
  2. dispatch `{ changes: { from: 0, insert: "a" }, userEvent: "input.type" }` → doc = "a"
  3. `editor.setDocument("ab")` → doc = "ab"
  4. `editor.undo()` → **返回 true 但 doc 直接回到 ""**（用例预期 "a"，即先撤销 setDocument）
  5. `editor.undo()` → **返回 false**（用例预期 true，撤销输入 "a"）
  6. `editor.redo()` → doc = "ab"（用例预期 "a"）
- **根因分析**: CM6 history 默认将相邻变更合并为同一 undo 组。带 `userEvent: "input.type"` 的 dispatch 与后续无 userEvent 的 setDocument dispatch 被视为可合并组，一次 undo 撤销全部。若需逐步撤销，变更间必须用 `isolateHistory` 注解隔离或满足其他组分隔条件。
- **影响范围**: 通过 API 混合调用（dispatch + setDocument）时的 undo/redo 粒度与直觉不符；纯用户连续键盘输入不受影响（同 userEvent 合并为一次撤销是正常预期）。
- **建议修复**: 在 setDocument/performSetDocument 的 dispatch 中追加 `annotations: isolateHistory.of(true)`，使 API 级文档替换成为独立 undo 组；或文档明确 undo/redo 为"合并式"语义。
- **验证命令**: `npx vitest run test/testcases/prd/CASE-核心数据流/RUN-FP-03-01-F02.test.ts --reporter=json`

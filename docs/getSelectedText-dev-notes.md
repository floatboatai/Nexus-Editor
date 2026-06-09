# getSelectedText() 功能开发笔记

## 需求背景

Nexus-Editor 的 `EditorAPI` 已有 `getSelection()`（获取选区位置）和 `replaceSelection()`（替换选中内容），但缺少 `getSelectedText()`（直接获取选中文本）。这是项目 Roadmap P0 列出的功能。

---

## 实现方案

### 1. 类型声明（`packages/core/src/types.ts`）

在 `EditorAPI` 接口中新增方法签名：

```typescript
/** 返回当前选区中的纯文本。无选区（光标状态）时返回空字符串。 */
getSelectedText(): string;
```

### 2. 方法实现（`packages/core/src/editor.ts`）

```typescript
getSelectedText() {
  const { anchor, head } = view.state.selection.main;
  const from = Math.min(anchor, head);
  const to = Math.max(anchor, head);
  return view.state.sliceDoc(from, to);
},
```

**关键点：** `anchor` 和 `head` 的大小关系不确定（反向选区时 `head < anchor`），需要先用 `Math.min/max` 规范化后再调用 `sliceDoc`。

---

## 测试遇到的问题与解决

### 问题 1：`setSelection()` 在 jsdom 环境下无法正确创建选区

**现象：** 直接调用 `editor.setSelection(0, 5)` 后，`editor.getSelectedText()` 返回空字符串。

**原因：** jsdom 不实现 `Selection.addRange()` 的完整行为，导致通过 `editor.setSelection()` 设置的选区在 jsdom 中实际上是无效的（光标状态，而非选区状态）。

**解决：** 跳过 `setSelection()`，直接通过底层 `EditorView.dispatch()` 设置选区：

```typescript
// 在 editor.ts 中新增 __test_getView() 辅助方法（仅测试用）
__test_getView() {
  return view;
},

// 测试中直接 dispatch 选区事务
const view = (editor as any).__test_getView() as EditorView;
view.dispatch({ selection: { anchor: 0, head: 5 } });
expect(editor.getSelectedText()).toBe("Hello");
```

### 问题 2：反向选区测试期望值错误

**现象：** 测试 `anchor=5, head=0` 时期望得到 `"Hello,"`，实际得到 `"Hello"`。

**原因：** `anchor=5, head=0` 选中的是位置 0-5 的文本，即 `"Hello"`（不含逗号），测试期望值写错了。

**解决：** 修正测试期望值，或调整 dispatch 参数为 `{ anchor: 6, head: 0 }` 来选中 `"Hello,"`。

### 问题 3：最初实现没有处理反向选区

**最初的写法：**

```typescript
getSelectedText() {
  const { anchor, head } = view.state.selection.main;
  return view.state.sliceDoc(anchor, head); // ❌ 反向选区时 from > to，返回空字符串
}
```

**修复后：**

```typescript
getSelectedText() {
  const { anchor, head } = view.state.selection.main;
  const from = Math.min(anchor, head);
  const to = Math.max(anchor, head);
  return view.state.sliceDoc(from, to); // ✅ 正确处理正向/反向选区
}
```

---

## 最终测试用例

| 场景 | 操作 | 期望结果 |
|------|------|----------|
| 无选区（光标状态） | 不设置选区 | `""` |
| 正向选区 | `dispatch({ anchor: 0, head: 5 })` | `"Hello"` |
| 正向选区（含标点） | `dispatch({ anchor: 5, head: 13 })` | `", world!"` |
| 反向选区 | `dispatch({ anchor: 5, head: 0 })` | `"Hello"` |

---

## 提交信息模板

```
feat(core): add getSelectedText() API method

Implements the getSelectedText() API method listed as a P0 roadmap item.

Changes:
- Added getSelectedText(): string to EditorAPI interface in types.ts
- Implemented in editor.ts using view.state.sliceDoc(), with proper
  handling for both forward and reverse selections (anchor/head ordering)
- Added __test_getView() helper on the API (test-only, not in interface)
  to allow tests to directly dispatch selection transactions
- Added tests covering: empty selection, forward selection, reverse selection

Closes the P0 roadmap item for getSelectedText().
```

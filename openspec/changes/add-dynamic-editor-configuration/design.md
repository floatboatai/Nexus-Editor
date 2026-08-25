# Design: 基于 CodeMirror 6 Compartments 的动态配置重配与框架双向响应系统

## 架构概览

CodeMirror 6 提供了基于 `Compartment` 的精细化扩展动态重配（Dynamic Reconfiguration）机制。通过将可变配置切分为独立的 Compartment 槽位，重配时仅需调用 `compartment.reconfigure(extension)` 并作为 `StateEffect` 派发进单个 Transaction，即可实现：

1. **DOM 零重建**：不销毁不替换 EditorView，避免整个编辑器闪烁或重新聚焦。
2. **状态与选区无损**：历史记录（Undo/Redo 栈）、文档内容、多光标选区完全保持。
3. **单事务批量合并**：一次性更新多个配置项（如同时切换深色主题与只读状态），在一次渲染帧内生效。

```
                    Vue / React 宿主组件 Props 变化
                                 │
                                 ▼
            useEditor 响应式监听 (watch / useEffect)
                                 │
                                 ▼
                     editor.reconfigure({ ... })
                                 │
                                 ▼
                  Nexus-Core 统一原子 Transaction 派发
        ┌────────────────────────┼────────────────────────┐
        ▼                        ▼                        ▼
  readOnlyCompartment    tabSizeCompartment    indentGuidesCompartment ...
```

## 核心设计决策

### 1. CodeMirror 6 扩展槽位划分与构造

在 `packages/core/src/editor.ts` 中，为不同能力定义独立的 `Compartment` 实例：

- `readOnlyCompartment`:
  - 开启: `[EditorState.readOnly.of(true), EditorView.editable.of(false)]`
  - 关闭: `[]`
- `tabSizeCompartment`:
  - 指定值: `EditorState.tabSize.of(tabSize)`
  - 默认值: `[]` (CodeMirror 默认为 4)
- `directionCompartment`:
  - `rtl`: `EditorView.contentAttributes.of({ dir: "rtl" })`
  - `ltr`: `[]`
- `indentGuidesCompartment`:
  - 开启: `indentationMarkers()`
  - 关闭: `[]`
- `themeCompartment`: 复用已有的 `createThemeExtension`。

### 2. Core 统一重配接口定义 (`reconfigure`)

在 `packages/core/src/types.ts` 中定义 `DynamicEditorConfig`：

```ts
export interface DynamicEditorConfig {
  readOnly?: boolean;
  tabSize?: number;
  direction?: "ltr" | "rtl";
  indentGuides?: boolean;
  theme?: NexusTheme;
  locale?: Partial<NexusLocale>;
}
```

`reconfigure` 实现按需生成 `StateEffect` 列表，当且仅当存在有效变更时通过 `view.dispatch({ effects })` 派发，避免空事务开销。

### 3. Vue 3 响应式接入 (`packages/vue`)

在 `useEditor.ts` 中，利用 Vue 3 的 `watch` 监听配置解析函数的返回值：

```ts
watch(
  () => {
    const c = resolveConfig();
    return {
      readOnly: c.readOnly,
      tabSize: c.tabSize,
      direction: c.direction,
      indentGuides: c.indentGuides,
      theme: c.theme,
      locale: c.locale,
    };
  },
  (newConfig, oldConfig) => {
    const instance = editor.value;
    if (!instance) return;
    instance.reconfigure(newConfig);
  },
  { deep: true },
);
```

### 4. React 声明式依赖同步 (`packages/react`)

在 React `useEditor.ts` 中，通过 `useEffect` 挂载依赖并调用 `reconfigure`：

```ts
useEffect(() => {
  const instance = editorRef.current;
  if (!instance) return;
  instance.reconfigure({
    readOnly: config.readOnly,
    tabSize: config.tabSize,
    direction: config.direction,
    indentGuides: config.indentGuides,
    theme: config.theme,
    locale: config.locale,
  });
}, [
  config.readOnly,
  config.tabSize,
  config.direction,
  config.indentGuides,
  config.theme,
  config.locale,
]);
```

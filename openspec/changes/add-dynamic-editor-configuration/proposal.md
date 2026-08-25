# Change: 通过 CodeMirror 6 Compartments 实现编辑器动态配置响应与框架双向绑定

## Why

Nexus-Editor 在 `@floatboat/nexus-vue` 和 `@floatboat/nexus-react` 适配层中暴露了 `readOnly`、`theme`、`locale`、`tabSize`、`direction`、`indentGuides` 等常用 Props。然而在现行实现中：

1. **底层 Core 扩展缺乏动态更新机制**：在 `@floatboat/nexus-core` 中，仅 `theme` 封装了 CodeMirror 6 `Compartment`，其余配置（如 `readOnly`、`tabSize`、`direction`、`indentGuides`）均在 `createEditor` 时静态写死；且 `EditorAPI` 缺少统一的 `reconfigure` 派发接口与专用 Setter 方法。
2. **上层框架封装响应式断层**：在 `@floatboat/nexus-vue` 与 `@floatboat/nexus-react` 中，`useEditor` 仅针对 `modelValue` / `value` 做了 `watch` / `useEffect` 监听。当宿主组件在运行时动态切换主题（暗黑/明亮）、切换只读状态、改变缩进空格或文本方向时，编辑器内部完全不响应，导致前端组件化使用时功能严重受限。

本变更旨在利用 CodeMirror 6 的 `Compartment` 动态重配机制，打通 Core 层原子配置更新能力，并在 Vue 3 与 React 两套框架封装中建立完整的响应式监听与平滑重配管线，确保无 DOM 销毁重建、无选区丢失、无输入法打断。

## What Changes

- **新增 Core 动态重配接口与 Compartments 体系**：
  - 在 `@floatboat/nexus-core` 内部为 `readOnly`、`tabSize`、`direction`、`indentGuides` 等特性引入独立的 `Compartment` 实例。
  - 在 `EditorAPI` 上暴露统一的 `reconfigure(config: DynamicEditorConfig): void` 方法，支持单个或批量原子派发配置变更。
  - 在 `EditorAPI` 上暴露高频属性便捷 Setter 方法：`setReadOnly(readOnly: boolean)`、`setTabSize(tabSize: number)`、`setDirection(direction: 'ltr' | 'rtl')`、`setIndentGuides(enabled: boolean)`、`setLocale(locale: Partial<NexusLocale>)`。
- **Vue 3 响应式接入与平滑同步 (`packages/vue`)**：
  - `useEditor` 与 `NexusEditor` 组件增加对动态 Props（`readOnly`、`theme`、`locale`、`tabSize`、`direction`、`indentGuides`）的深度响应式监听 (`watch`)。
  - 当 Props 变更时，自动调用 `editor.reconfigure` 进行单事务原子重配，杜绝全量 Remount。
- **React 响应式接入与生命周期同步 (`packages/react`)**：
  - `useEditor` 与 `Editor` 组件通过 `useEffect` 监听动态配置依赖变化，自动同步至编辑器实例。
- **自动化测试矩阵**：
  - 在 Core、Vue、React 三个包中分别建立动态重配与响应式更新的单测用例，验证状态一致性与选区保持。

## Capabilities

### New Capabilities / Requirements

- `editor-core`: `reconfigure(config)` 统一事务派发与各特性 Compartment 动态重配能力；专用 Setter 接口。
- `editor-vue`: 动态配置 Props 的 Vue 3 响应式驱动与同步。
- `editor-react`: 动态配置 Props 的 React 声明式依赖同步。

## Impact

- 核心包：`packages/core/src/types.ts`、`packages/core/src/editor.ts`。
- 框架绑定包：`packages/vue/src/types.ts`、`packages/vue/src/use-editor.ts`、`packages/react/src/use-editor.ts`。
- 兼容性：100% 向后兼容，不破坏现有任何 API 签名和调用方式。

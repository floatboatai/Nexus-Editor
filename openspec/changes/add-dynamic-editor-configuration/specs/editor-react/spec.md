# Editor React Spec

## ADDED Requirements

### Requirement: reactive configuration props in NexusEditor React component and useEditor

`@floatboat/nexus-react` 中的 `Editor` 组件与 `useEditor` Hook 必须在 `useEffect` 中监听动态配置 Props（`readOnly`、`theme`、`locale`、`tabSize`、`direction`、`indentGuides`），在父组件重新渲染并传入新 Props 时自动调用 `editor.reconfigure` 完成同步。

#### Scenario: React 组件中动态切换只读模式

- **GIVEN** 一个使用 `<Editor readOnly={isReadOnly} />` 渲染的 React 组件
- **WHEN** 父组件触发重渲染并传入 `readOnly={true}`
- **THEN** 底层编辑器实例应平滑更新为只读状态，无闪烁和重置

#### Scenario: React 组件中动态切换主题

- **GIVEN** 一个使用 `<Editor theme={theme} />` 渲染的 React 组件
- **WHEN** 父组件切换 `theme` 属性并重渲染
- **THEN** 底层编辑器实例的主题 Compartment 应原子派发更新

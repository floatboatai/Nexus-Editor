# Editor Vue Spec

## ADDED Requirements

### Requirement: reactive configuration props in NexusEditor Vue component and useEditor

`@floatboat/nexus-vue` 中的 `NexusEditor` 组件与 `useEditor` 组合式函数必须支持动态配置 Props（`readOnly`、`theme`、`locale`、`tabSize`、`direction`、`indentGuides`）的响应式监听与自动重配，在 Props 变更时自动调用底层 `editor.reconfigure` 进行平滑同步。

#### Scenario: Vue 组件中动态切换只读状态

- **GIVEN** 一个挂载了 `:readOnly="isReadOnly"` 的 `NexusEditor` 组件，其中 `isReadOnly` 为 `ref(false)`
- **WHEN** 宿主组件执行 `isReadOnly.value = true`
- **THEN** 底层编辑器实例应实时变为只读，且 DOM 容器不发生 Remount

#### Scenario: Vue 组件中动态切换编辑器主题

- **GIVEN** 一个绑定了 `:theme="currentTheme"` 的 `NexusEditor` 组件
- **WHEN** `currentTheme.value` 在亮色与暗色主题间切换
- **THEN** 编辑器应无缝切换主题样式类与配色

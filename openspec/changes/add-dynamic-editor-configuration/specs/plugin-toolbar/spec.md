# Plugin Toolbar Spec

## ADDED Requirements

### Requirement: toggleTaskList formatting command

`@floatboat/nexus-plugin-toolbar` 必须导出 `toggleTaskList(editor: EditorAPI): boolean` 并在工具栏 UI 中提供 Checklist 按钮。

#### Scenario: 将普通文本转为任务列表

- **GIVEN** 选区包含多行普通文本
- **WHEN** 触发 `toggleTaskList`
- **THEN** 所有选中的行自动添加 `- [ ] ` 前缀，选区范围被正确包裹更新

#### Scenario: 任务列表项批量取消

- **GIVEN** 选区全部为已有的任务列表行（包含已勾选与未勾选）
- **WHEN** 触发 `toggleTaskList`
- **THEN** 任务前缀被安全移除，恢复为普通文本行

#### Scenario: 工具栏 Checklist 按钮激活高亮

- **GIVEN** 用户光标落在任务列表行内
- **WHEN** 工具栏更新激活状态
- **THEN** checklist 按钮处于 active 激活高亮状态

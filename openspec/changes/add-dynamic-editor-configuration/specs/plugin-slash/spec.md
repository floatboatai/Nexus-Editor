# Plugin Slash Spec

## ADDED Requirements

### Requirement: todo and task slash commands

`@floatboat/nexus-plugin-slash` 必须内置 `/todo` 和 `/task` 斜杠菜单选项。

#### Scenario: 触发 /todo 插入任务列表

- **GIVEN** 用户输入 `/todo` 并回车确认
- **WHEN** 斜杠命令执行
- **THEN** 当前行替换为 `- [ ] ` 且光标置于空格之后，方便用户立即输入待办事项文本

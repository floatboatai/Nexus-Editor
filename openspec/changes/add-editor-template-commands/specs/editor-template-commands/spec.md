## ADDED Requirements

### Requirement: 模板必须原子处理所有选区

表格、行内公式、块公式和 Mermaid 模板 MUST 使用明确编辑器，检查只读与交互，原子替换所有选区并设置占位位置。

#### Scenario: 多个选区插入模板

- **WHEN** 多个选区插入模板
- **THEN** 所有插入 MUST 成为单次可撤销操作，撤销不得包含此前无关输入。

### Requirement: 默认工具栏必须兼容

模板命令 MUST 由宿主显式启用；工具栏插件的现有按钮、命令和默认快捷键 MUST 保持不变。Electron 默认演示作为宿主接入这些命令，不改变插件本身的默认配置。

#### Scenario: 未启用模板插件

- **WHEN** 未启用模板插件
- **THEN** 默认工具栏 MUST 不新增按钮或命令。

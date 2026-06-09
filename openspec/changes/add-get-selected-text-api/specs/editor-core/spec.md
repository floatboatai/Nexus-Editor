## ADDED Requirements

### Requirement: Get Selected Text

编辑器 API 必须提供 `getSelectedText(): string` 方法，返回当前选区中的纯文本内容。

- 无选区（仅光标）时返回空字符串 `""`
- 正向选区（anchor < head）时返回从 anchor 到 head 的文本
- 反向选区（anchor > head）时同样正确返回选中文本

#### Scenario: 无选区（光标状态）

- **WHEN** 编辑器没有选区（只有光标）
- **THEN** `getSelectedText()` 必须返回 `""`

#### Scenario: 正向选区

- **WHEN** 用户选中了从位置 0 到位置 5 的文本（"Hello"）
- **THEN** `getSelectedText()` 必须返回 `"Hello"`

#### Scenario: 正向选区含标点

- **WHEN** 用户选中了从位置 5 到位置 13 的文本（", world!"）
- **THEN** `getSelectedText()` 必须返回 `", world!"`

#### Scenario: 反向选区

- **WHEN** 用户的选区 anchor 在位置 5、head 在位置 0（反向拖动选区）
- **THEN** `getSelectedText()` 必须返回 `"Hello,"`（正确处理 anchor/head 顺序）

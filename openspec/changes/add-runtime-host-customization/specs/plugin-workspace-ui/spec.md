## ADDED Requirements

### Requirement: 宿主可指定文件导航的 Markdown view type

可选 DOM 工作区实现 MUST 通过公开 `RuntimeWorkspaceOptions.markdownViewType` 接受宿主注册的 view type，默认 MUST 保持 `markdown`。该配置 MUST NOT 要求固定标签组或分屏布局。

#### Scenario: 自定义 Markdown 视图

- **WHEN** 宿主配置并注册自定义 Markdown view type 后导航到文件
- **THEN** 工作区 MUST 调用该 view factory，并保持原有导航上下文

#### Scenario: 使用默认配置

- **WHEN** 宿主未配置 Markdown view type
- **THEN** 文件导航 MUST 继续使用 `markdown`

### Requirement: 窗口恢复与迁移必须保持注册身份

基线 schema v1 快照恢复 MUST 保留没有 leaf 的窗口身份。跨窗口移动 MUST 只接受当前工作区注册的目标窗口对象，不能仅凭相同字符串 ID 接受其他对象。

#### Scenario: 恢复空窗口

- **WHEN** 快照包含没有 leaf 的窗口
- **THEN** 恢复后布局 MUST 仍包含该窗口

#### Scenario: 同 ID 的伪造目标

- **WHEN** 调用方提供与已注册窗口 ID 相同但对象不同的移动目标
- **THEN** 工作区 MUST 拒绝，且不得改变 leaf 的窗口归属

### Requirement: 可选工具栏图标不得绑定宿主外观

可选 DOM UI 实现 MUST 通过公开 `RuntimeUiHostOptions.renderIcon` 接受宿主装饰节点回调，仅用于 `editor-toolbar`。不配置、返回 null 或回调失败时 MUST 保持文字按钮。节点由 runtime 管理，按钮 MUST 保留可访问名称、禁用状态与来源动作上下文。

#### Scenario: 宿主提供图标

- **WHEN** 注册的工具栏动作包含图标且宿主提供渲染回调
- **THEN** 回调 MUST 接收目标 owner document，返回的装饰节点 MUST 不替代按钮语义
- **AND** 更新或卸载动作时 MUST 移除旧节点

#### Scenario: 图标不可用

- **WHEN** 未配置回调、图标未知或回调抛错
- **THEN** 动作 MUST 继续以可操作的文字按钮呈现，回调异常 MUST 被诊断

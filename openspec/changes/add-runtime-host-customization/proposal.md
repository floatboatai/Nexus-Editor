# 变更：保留最小宿主自定义接口

## Why

宿主需要使用自己的视图注册与图标实现，但编辑引擎不应规定桌面标签、固定分屏布局或工具栏外观。本变更仅保留可选适配点与独立正确性修复。

## What Changes

- 允许 `RuntimeWorkspaceOptions.markdownViewType` 选择文件导航使用的 view type，默认保持 `markdown`。
- 保留恢复空窗口与跨窗口移动时目标对象身份校验，不引入布局 v2。
- 允许 `RuntimeUiHostOptions.renderIcon` 为编辑器工具栏提供装饰节点，缺省保持文字按钮。
- 文档区分可选 DOM 实现与公开 `WorkspaceService`、`UiService`；自定义框架可实现并注册自己的 capability。
- 验证既有多编辑器注册不依赖桌面工作区 UI。

## Impact

- 受影响规范：`plugin-workspace-ui`。
- 受影响包：`plugin-runtime`；不修改基线的多编辑器注册契约，不添加依赖。
- 不提供固定图标集、搜索主题、桌面菜单、文档会话、全库搜索或导出 SDK。

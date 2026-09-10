# 宿主自定义边界

## 可选实现而非通用 UI 框架

`RuntimeWorkspace` 与 `RuntimeUiHost` 是既有的可选 DOM 宿主实现，不是无渲染状态容器。完全自定义 UI 时，宿主通过 capability 提供自己的 `WorkspaceService` 和 `UiService`。多编辑器使用既有 `EditorHostRegistry`，其 `leaf`、`view`、`window` 可为空，不需要 tab/split 模型。

## 最小保留项

文件导航使用可配置的 Markdown view type，缺省仍为 `markdown`。工作区快照保持基线 schema v1；恢复空窗口时读取原有布局中的窗口身份。跨窗移动必须验证目标是本实例注册的窗口对象，不仅比较字符串 ID。

`renderIcon(icon, ownerDocument)` 仅作用于 `editor-toolbar`，每次返回新的装饰性 HTMLElement 或 null。runtime 管理返回节点的替换与移除；回调不是框架组件挂载接口，不支持额外组件卸载协议。无回调、未知图标或回调失败时显示原文字，失败同时产生诊断。可访问名称、禁用状态与命令上下文不受图标影响。

## 非目标

不新增布局控制器、UI 状态仓库或框架专用 runtime。不修改基线搜索面板的替换限制；不为保留 demo 工作流扩充公共产品 SDK。

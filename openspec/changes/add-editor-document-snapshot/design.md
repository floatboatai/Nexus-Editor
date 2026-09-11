# 有效文档快照设计

## 边界

Markdown 仍是内容来源；快照不保存文件、不管理草稿，不依赖 Electron。编辑器通过自身 DOM 读取待提交的表格输入，这不限制宿主使用 React、Vue 或原生 DOM 构建外围 UI。

## 接口与生命周期

`captureDocumentSnapshot({ signal?, includeRenderAst? })` 返回 `Promise<EditorDocumentSnapshot>`。结果包含 `markdown`，仅在明确请求时包含 `renderAst`。等待正在进行的输入法组合输入与表格交互，取消或销毁时以 `AbortError` 拒绝并释放等待资源。等待无默认超时，由宿主传入取消信号控制。

快照把待提交表格源文本叠加到副本上，不派发编辑事务、不清空待提交状态。范围失配必须拒绝，不能生成部分或空白内容作为成功结果。

## AST 所有权

渲染 AST 使用 remark 插件与动态 Markdown 转换管线，不调用自定义 `config.parser`，也不是 `getAst()` 的副本。同步转换完成后通过 `structuredClone` 隔离结果，避免插件返回共享根或子节点时污染其他快照。AST 必须为可克隆数据；不能克隆时明确失败，不退回浅拷贝。取消不能抢占已经运行的同步解析。

## 框架接入

React/Vue 继续暴露同一个 `EditorAPI`；通过 hook/composable 或 `onReady` 调用。卸载调用 `destroy()`，取消未完成的快照。保存时捕获实际 editor，而不是假定受控属性已包含未提交的表格输入。

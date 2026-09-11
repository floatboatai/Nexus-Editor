## ADDED Requirements

### Requirement: 静态渲染必须独立于编辑器视口

渲染 MUST 接收快照或 Markdown，DOM 入口 MUST 使用显式 Document，既有快照 AST MUST 不被重复转换。

#### Scenario: 渲染长文档

- **WHEN** 渲染长文档
- **THEN** 输出 MUST 包含完整内容而非仅可见编辑器行。

### Requirement: 离线输出不得保留临时资源地址

HTML MUST 使用统一附件提供者，内嵌授权资源并净化内容；缺失资源 MUST 占位诊断或按严格模式失败。

#### Scenario: 导入结果导出离线 HTML

- **WHEN** 导入结果导出离线 HTML
- **THEN** 输出 MUST 不包含逻辑附件引用、内部协议或本地绝对路径。

### Requirement: 渲染清理必须可等待

渲染句柄 MUST 提供异步就绪与可等待清理；过期结果不得挂载到其他文档。

#### Scenario: 取消或销毁渲染

- **WHEN** 取消或销毁渲染
- **THEN** 本次创建的子资源 MUST 被回收，其他文档资源不得受影响。

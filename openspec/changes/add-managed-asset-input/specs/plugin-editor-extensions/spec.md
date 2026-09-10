## ADDED Requirements

### Requirement: 受管输入必须保持来源和位置

受管模式 MUST 在事件发生时捕获目标并映射正文位置；无法安全映射的表格或第三方 Widget MUST 拒绝，而非回退到主选区。

#### Scenario: 异步上传期间切换文档

- **WHEN** 异步上传期间切换文档
- **THEN** 旧任务 MUST 被取消且不得向新文档插入。

### Requirement: 资源必须有明确生命周期

宿主资源读取 MUST 受取消和大小限制约束；预览替换或销毁 MUST 释放本次创建的资源，不得删除其他文档的附件。

#### Scenario: 多图片部分失败

- **WHEN** 多图片部分失败
- **THEN** 成功项 MUST 按原顺序一次插入，失败项 MUST 返回独立诊断。

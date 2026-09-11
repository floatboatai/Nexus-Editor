## ADDED Requirements

### Requirement: 无副作用的有效文档快照

编辑器 MUST 通过公开 `EditorAPI.captureDocumentSnapshot` 返回包含表格待提交输入的 Markdown，且不改变编辑器状态、焦点、选区或撤销历史。参数与结果类型 MUST 从 core 包入口导出。

#### Scenario: 表格输入尚未失焦

- **WHEN** 宿主在表格连续编辑期间捕获快照
- **THEN** 快照 MUST 包含已经完成的输入，且不得消费待提交状态
- **AND** 后续失焦与撤销 MUST 保持原有编辑行为

#### Scenario: 表格源范围失配

- **WHEN** 待提交表格内容已不能安全映射到源文本
- **THEN** 快照 MUST 拒绝请求，不返回部分或空白内容作为成功结果

### Requirement: 可取消的输入等待

快照 MUST 等待输入法组合输入和活动表格交互完成。调用方取消或编辑器销毁时 MUST 以 `AbortError` 拒绝，并释放计时器与监听器。等待 MUST 不强制结束输入，且不设置隐含超时。

#### Scenario: 组合输入期间取消

- **WHEN** 输入法尚未结束而调用方取消信号
- **THEN** 快照 MUST 拒绝且不改变输入状态

#### Scenario: 框架卸载

- **WHEN** React/Vue 绑定在快照等待期间卸载编辑器
- **THEN** 通过其公开实例发起的快照 MUST 被取消，不得产生迟到的成功结果

### Requirement: 独立的可选渲染 AST

只有请求 `includeRenderAst` 时才 MUST 生成渲染 AST。AST MUST 使用 remark 渲染管线而非自定义 `config.parser`，且转换完成后 MUST 深拷贝隔离所有权。不可克隆的数据 MUST 导致明确失败，不得浅拷贝降级。

#### Scenario: 转换器返回共享节点

- **WHEN** remark 或动态转换器返回共享根节点或共享子节点
- **THEN** 修改快照 AST MUST NOT 修改转换器的共享数据、其他快照或编辑器缓存

#### Scenario: 仅捕获源码

- **WHEN** 调用方不请求渲染 AST
- **THEN** 快照 MUST 只返回 Markdown，不运行额外的渲染解析与转换

#### Scenario: 转换器读取原始文件内容

- **WHEN** remark 转换器通过文件参数读取 Markdown 源文本
- **THEN** 该参数 MUST 包含与快照一致的有效 Markdown，包括尚未失焦的表格输入

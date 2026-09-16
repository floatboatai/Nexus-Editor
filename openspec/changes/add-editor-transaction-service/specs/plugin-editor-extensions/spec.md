## ADDED Requirements

### Requirement: 运行时必须提供编辑器事务服务

运行时 MUST 为每个已挂载编辑器提供 `nexus.editor-transactions` 能力的实现，并使声明该能力的插件可解析；该实现 MUST 绑定到该编辑器，不得依赖「当前活动编辑器」。

事务钩子 MUST 收到与该编辑器其他上下文（命令/事件/扩展）一致的同一个 `EditorContext`。

过滤器内调用 `dispatch` MUST 返回确定性失败且 MUST NOT 影响外层事务的提交结果。

事务的 `operationId` MUST 在调用方提供时原样回显、缺失时由提供方生成；`annotations` MUST 原样透传，提供方 MUST NOT 合并、改写或解释其键。

编辑器 detach 或插件卸载后，该编辑器上的全部事务钩子 MUST 被释放，重复启停 MUST 不残留。

插件过滤器**故障**（抛错、返回非同步值、返回非法结果）MUST NOT 构成事务否决；运行时 MUST 以 `callback-failed` 诊断报告并旁路该过滤器，提交按其余过滤器继续。

#### Scenario: 过滤器内 dispatch 被确定性拒绝且外层提交成功

- **WHEN** 某个已注册过滤器在其回调内调用该服务的 `dispatch`
- **THEN** 该次嵌套调用 MUST 返回带 `unsupported-operation` 诊断的失败结果
- **AND** 外层事务 MUST 照常提交，文档 MUST 反映外层改动
- **AND** 运行时 MUST NOT 产生 `filter-error` 或向宿主抛出异常

#### Scenario: 重复 attach/detach 后无钩子残留

- **WHEN** 同一编辑器重复 attach/detach，每轮注册过滤器与更新监听器并随后释放
- **THEN** 每轮释放后该编辑器的提交 MUST NOT 再触发已释放的钩子
- **AND** 全部物理注册 MUST 处于已释放状态，不得随轮次累积

#### Scenario: 过滤器故障不阻断提交

- **WHEN** 某个插件过滤器抛错
- **THEN** 该次提交 MUST 仍然完成
- **AND** 调用方 MUST 收到 `callback-failed` 诊断
- **AND** 其他过滤器与监听器 MUST 正常运行

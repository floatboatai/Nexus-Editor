## MODIFIED Requirements

### Requirement: 事务过滤与更新监听必须分离

运行时 MUST 区分应用前的事务过滤器和提交后的只读更新监听器，并 MUST 将事务明确分类为 `proposal` 或 `authoritative`。标准事务上下文 MUST 包含变更集、前后选区、origin/user-event、authority、目标 `editorId` 以及可选文件/view 信息；已提交的 authoritative context 还 MUST 包含 source owner。Local Proposal 的过滤器 MUST 能放行、拒绝或同步变换事务；Authoritative Update MUST 绕过这些 reject/replace 过滤器。更新监听器 MUST 看到两类事务的最终已提交状态且不得修改已发生的更新。批量事务 MUST 作为一个原子提交通知，插件自身产生的 Local Proposal MUST 可通过稳定 origin 避免递归。低层 CM6 插件仍可接收原生 `Transaction`/`ViewUpdate`，但这是显式的 CM6 能力而不是稳定跨编辑器抽象。

#### Scenario: 插件变换输入事务

- **WHEN** 事务过滤器把一次 Local Proposal 变换为另一个 changeset
- **THEN** 编辑器 MUST 原子应用变换后的 changeset
- **AND** 更新监听器 MUST 只收到最终提交结果、`proposal` authority 及原始 origin 链
- **AND** 撤销历史 MUST 将该提交视为一个符合宿主策略的操作

#### Scenario: 更新监听器发起后续事务

- **WHEN** 更新监听器使用自己的稳定 origin 发起格式化事务
- **THEN** 后续事务 MUST 作为 Local Proposal 独立进入过滤与更新管线
- **AND** 插件 MUST 能根据 origin 忽略自己的后续通知
- **AND** 运行时 MUST 防止无界同步递归并给出诊断

#### Scenario: Authoritative Update 绕过过滤器但保持可观察

- **WHEN** 当前 authoritative source 提交一个已经由外部文档权威确认的 update
- **THEN** reject/replace 事务过滤器 MUST NOT 接收或改写该 update
- **AND** 更新监听器 MUST 在提交后收到 `authoritative` authority、source owner 和最终文档状态
- **AND** AST 与标准 change event MUST 与同一最终状态一致

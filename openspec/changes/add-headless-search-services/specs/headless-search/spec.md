## ADDED Requirements

### Requirement: 搜索必须使用有效版本与隔离执行器

搜索 MUST 通过注入数据源读取原子内容和版本；任意正则的硬取消 MUST 通过可终止 Worker 实现。

#### Scenario: 旧命中对应的文档已修改

- **WHEN** 旧命中对应的文档已修改
- **THEN** 导航或替换 MUST 拒绝旧范围并重新查询，不得用旧保存基准放行。

### Requirement: Headless 搜索不得创建默认 UI

控制器 MUST 绑定明确的 EditorAPI，公开状态、查询与替换动作；无效查询和快捷键 MUST NOT 创建默认搜索面板。

#### Scenario: 表格文本尚未提交

- **WHEN** 表格文本尚未提交
- **THEN** 控制器 MUST 返回 busy，待自然提交后重新查询，不得把有效快照范围应用到旧文档。

### Requirement: 排序必须为纯函数

候选排序 MUST 保留对象、稳定排序且不改变输入数组，不包含 DOM 或候选执行。

#### Scenario: 空查询

- **WHEN** 空查询
- **THEN** 结果 MUST 保留输入顺序。

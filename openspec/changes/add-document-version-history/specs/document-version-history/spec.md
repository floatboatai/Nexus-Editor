## ADDED Requirements

### Requirement: 历史必须独立于撤销栈与文件写入

版本存储 MUST 以宿主 documentKey 标识不可变内容；磁盘版本、缓冲区修订和历史 ID MUST 分离。

#### Scenario: 读取历史版本

- **WHEN** 读取历史版本
- **THEN** 读取 MUST 不改变编辑器或磁盘。

### Requirement: 恢复必须保护当前内容

恢复 MUST 检查期望修订、只读和生命周期，保留恢复前有效内容，并在历史支持存在时隔离为一次撤销。

#### Scenario: 恢复期间用户继续编辑

- **WHEN** 恢复期间用户继续编辑
- **THEN** 恢复 MUST 返回冲突，不得覆盖新的输入。

### Requirement: 差异必须明确精度与限额

差异 MUST 保留空白与 EOF 换行并返回 UTF-16 范围；超出预算 MUST 返回 limited 而非无差异。

#### Scenario: 比较超过配置限额

- **WHEN** 比较超过配置限额
- **THEN** 调用方 MUST 获得可诊断的限额结果。

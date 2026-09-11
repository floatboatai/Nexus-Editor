## ADDED Requirements

### Requirement: 编解码必须无隐式有损回退

服务 MUST 支持 UTF-8、UTF-16LE/BE、GBK、GB18030、Big5、Shift_JIS；非可靠 Unicode 识别 MUST 返回候选，编码损失 MUST 拒绝。

#### Scenario: 传统编码无法表示字符

- **WHEN** 传统编码无法表示字符
- **THEN** 写入 MUST 失败且原字节不得被覆盖。

### Requirement: 格式与版本必须保持一致

解码 MUST 返回编码、BOM、换行信息；混合换行修改后 MUST 要求显式选择，磁盘条件写入 MUST 使用原字节版本。

#### Scenario: 只改变文件编码

- **WHEN** 只改变文件编码
- **THEN** 内容镜像 MUST 识别版本变化，旧缓冲区不得用新版本绕过冲突。

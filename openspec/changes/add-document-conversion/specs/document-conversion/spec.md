## ADDED Requirements

### Requirement: 转换必须返回可独立消费的结果

转换 MUST 返回 Markdown、附件计划及诊断，不得覆盖输入或自动写文件。

#### Scenario: DOCX 含内嵌图片

- **WHEN** DOCX 含内嵌图片
- **THEN** 转换 MUST 保留图片字节并用稳定逻辑引用连接 Markdown。

### Requirement: 转换必须限制不可信输入

DOCX/PDF MUST 在可终止任务中处理；ZIP 展开、输入输出大小和运行时间 MUST 有配置限额。

#### Scenario: 恶意 HTML 或越界资源

- **WHEN** 恶意 HTML 或越界资源
- **THEN** 转换 MUST 净化活动内容并拒绝未授权读取。

### Requirement: 格式损失必须可诊断

文本 PDF MUST 按页提取，不承诺版式复刻；扫描页和密码需求 MUST 明确报告。

#### Scenario: 扫描页没有文本层

- **WHEN** 扫描页没有文本层
- **THEN** 转换 MUST 不把空内容伪装为完整成功。

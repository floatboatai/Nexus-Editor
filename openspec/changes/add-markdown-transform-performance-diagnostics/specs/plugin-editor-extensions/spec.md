## ADDED Requirements

### Requirement: Markdown transform 性能观测必须作为旁路且不改变语义

编辑器 MUST 在同步 Markdown transform 执行完成后产生可选的性能样本，且观测行为 MUST NOT 改变 transform 结果、文档、选区或编辑器状态。core MUST 只产生样本并交给宿主注册的 observer，不解释性能策略；observer 抛出的任何异常 MUST 被 core 隔离，不得中断 transform 管道或后续样本的生成。

#### Scenario: 配置 observer 后每次 transform 上报样本
- **WHEN** 宿主通过 `EditorConfig.markdownTransformObserver` 注册 observer，且编辑器执行一次同步 Markdown transform（native contribution snapshot 或 legacy unified remark pipeline）
- **THEN** core MUST 在 transform 完成后调用 observer，并传入包含 `registryId`、`version` 与 `durationMs` 的样本
- **AND** native contribution snapshot 样本 MUST 携带其真实 `registryId` 与 `version`，使宿主能够精确归因

#### Scenario: legacy unified remark pipeline 仅上报整体时长
- **WHEN** 编辑器通过 legacy unified remark pipeline（多个 `remarkPlugins` 注册进同一个 processor）执行 transform
- **THEN** core MUST 只上报整个 pipeline 的单一整体时长样本，使用保留的 `registryId`（`nexus.core.legacy-remark-pipeline`）与 `version: 0`
- **AND** core MUST NOT 伪造任何单个 legacy 插件的 per-plugin 归因

#### Scenario: observer 抛错不得影响编辑器
- **WHEN** 宿主注册的 observer 在收到样本时抛出异常
- **THEN** 该异常 MUST 被 core 捕获并隔离，不得传播到 transform 调用方
- **AND** 编辑器的文档内容、AST 与后续编辑操作 MUST 不受影响
- **AND** 后续 transform 完成后 MUST 仍继续尝试调用 observer

#### Scenario: 未配置 observer 时零开销
- **WHEN** 宿主未配置 `markdownTransformObserver`
- **THEN** core MUST NOT 产生样本、计时或任何额外行为
- **AND** transform 输出与无观测能力的编辑器行为 MUST 完全一致

### Requirement: 运行时 adapter 把慢 transform 样本翻译为诊断

插件运行时 MUST 提供把 core 性能样本桥接到诊断通道的 adapter：超过可配置阈值的样本以 `warning` 诊断发出，性能字段放入既有诊断的 `details` 通道；adapter MUST NOT 修改 `plugin-api` 的公共 API、`NexusDiagnostic` 结构或 `NexusErrorCode`。

#### Scenario: 超阈值样本产生 warning 诊断
- **WHEN** adapter 收到 `durationMs` 超过 `thresholdMs` 的样本
- **THEN** 运行时 MUST 通过 `DiagnosticBus` 发出 `severity: "warning"` 的诊断
- **AND** 诊断 MUST 在 `details` 中携带 `registryId`、`version`、`durationMs` 与 `thresholdMs`

#### Scenario: 未超阈值样本不产生诊断
- **WHEN** adapter 收到 `durationMs` 低于 `thresholdMs` 的样本
- **THEN** 运行时 MUST NOT 发出任何诊断

#### Scenario: 阈值与诊断码可配置
- **WHEN** 宿主以自定义 `thresholdMs` 与 `slowCode` 创建 adapter
- **THEN** adapter MUST 按自定义阈值判定慢样本，并使用指定的诊断码发出 warning

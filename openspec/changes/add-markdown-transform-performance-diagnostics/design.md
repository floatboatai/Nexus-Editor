## Context

同步 Markdown transform 位于编辑器 keystroke 热路径：输入 → Lezer 增量解析 → (legacy remark pipeline | native contribution snapshots) → decorations → 渲染。任何一个慢插件都会直接阻塞输入响应。当前 `DiagnosticBus` 已提供身份、阶段、严重级别与 `details` 扩展面，但没有任何性能样本来源。本项目依赖方向为 `core ← plugin-api ← plugin-runtime`，core 不得反向依赖 plugin-api/plugin-runtime。

## Goals / Non-Goals

- Goals:
  - Core 为每个同步 Markdown transform 产生可选计时样本，不改任何 transform 语义。
  - Native contribution snapshots 可精确归因到 `registryId + version`；legacy unified pipeline 只上报整体时长，不伪造 per-plugin 归因。
  - observer 抛错被 core 隔离，绝不中断 AST 管道。
  - 运行时通过 adapter 把超阈值样本翻译成 `DiagnosticBus` warning 诊断，复用已有 `details` 通道。
- Non-Goals:
  - 不做聚合统计（avg/p95/max）、仪表盘、慢插件自动停用或 Worker 隔离。
  - 不改 `plugin-api` 公共 API、`NexusDiagnostic` 结构或 `NexusErrorCode`。
  - 不引入新 capability token。

## Decisions

- Decision: core 只产生样本，不解释性能策略。`EditorConfig.markdownTransformObserver` 为函数类型 `(sample) => void`，由宿主决定阈值与告警方式。
- Decision: observer 调用点（core 内 `applyMarkdownTransformSnapshots` 与 `editor.ts` 的 legacy 上报处）统一 try/catch 隔离。理由：observer 是对任意 Host 开放的旁路通道，telemetry 失败不得影响编辑器语义。
- Decision: native snapshot 在 `applyMarkdownTransformSnapshots` 内逐条计时（每条样本含 `registryId/version/durationMs`）；legacy pipeline 在 `editor.ts` 的 `transformAst` 处整体计时，registryId 用保留值 `nexus.core.legacy-remark-pipeline`、version 0。
- Decision: 运行时侧 `createMarkdownTransformMonitor({ diagnostics, thresholdMs?, slowCode? })` 返回 `MarkdownTransformObserver`，超阈值样本以 `warning` + `phase: "runtime"` 发出，`durationMs/thresholdMs/registryId/version/kind` 全部放入 `details`。默认阈值 16ms 只是 practical default，文档明确它不是硬性 frame budget。
- Decision: 不修改 `plugin-api`。DiagnosticBus 已对 `details` 做 sanitize 并支持 JSON 值，这是既有扩展面的正确使用方式。
- Alternatives considered: 直接在 `NexusDiagnostic` 增加 `durationMs` 字段 —— 拒绝，扩大公共 API 并触发 API snapshot 更新，第一版收益不值得。
  Alternatives considered: 在 core 内嵌聚合/告警 —— 拒绝，违反"core 不解释性能策略"与依赖方向。

## Risks / Trade-offs

- observer 抛错影响热路径 → 所有调用点 try/catch 隔离 + 专项测试（throwing observer test）。
- `performance.now()` 调用开销（每条 snapshot 两次调用，微秒级）→ 相对 transform 本身可忽略；可观测性默认关闭（未配置 observer 时无任何开销）。
- legacy pipeline 只能整体计时 → 文档明确不伪造归因，避免误导使用者。

## Migration Plan

- 纯增量：`EditorConfig.markdownTransformObserver` 为可选字段，默认行为不变（无 observer 时零开销、零样本）。
- 回滚：移除字段与 adapter 即可，不涉及既有 API 破坏。

## Open Questions

- 是否在后续版本为 `MarkdownTransformObserver` 提供多 observer 注册（数组）？当前单一函数即可满足第一阶段。
- 聚合统计（avg/p95/max）是否值得进入第二阶段？取决于真实插件生态的慢插件发生率。

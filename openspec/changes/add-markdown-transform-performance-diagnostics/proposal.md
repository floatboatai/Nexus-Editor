# Change: Add Markdown Transform Performance Diagnostics

## Why

同步 Markdown transform（legacy unified remark pipeline 与 native contribution snapshots）运行在编辑器的 keystroke → AST → render 热路径上。目前没有任何可观测手段能定位"哪个插件把编辑输入阻塞了几十毫秒"。Roadmap 未覆盖插件性能可观测性，本变更提供第一阶段的发现能力：core 只产生可选计时样本，运行时适配层把超过阈值的样本翻译为结构化诊断。

## What Changes

- `@floatboat/nexus-core` 新增 `MarkdownTransformPerformanceSample` 类型（registryId / version / durationMs）与 `MarkdownTransformObserver`（函数类型）并导出；`EditorConfig` 新增可选 `markdownTransformObserver` 字段。
- core 的 `applyMarkdownTransformSnapshots()` 对每个 native contribution snapshot 单独计时并上报（registryId + version 精确归因）。
- core 对 legacy unified remark pipeline 仅做整体计时，使用保留 registryId `nexus.core.legacy-remark-pipeline`、version 0 上报——不伪造 per-plugin 归因。
- core 在所有 observer 调用处做异常隔离：observer 抛错不得中断 transform pipeline、文档语义或编辑器状态。
- `@floatboat/nexus-plugin-runtime` 新增 `createMarkdownTransformMonitor()`：把 core 样本桥接进已有 `DiagnosticBus`，超过可配置 `thresholdMs` 的样本以 `warning` 诊断发出，性能字段放入已有 `details` 通道，不改动 `NexusDiagnostic` 契约。

## Non-Goals

- 不做 p95 / max / avg 聚合器、仪表盘或可视化。
- 不做慢插件自动停用、隔离或 Worker 迁移（Observability ≠ Isolation）。
- 不改 `@floatboat/nexus-plugin-api` 的公共 API、`NexusErrorCode` 或 `NexusDiagnostic` 结构。
- 不新增 capability token。
- 不改 legacy `NexusPlugin` 行为与依赖方向（`core ← plugin-api ← plugin-runtime` 保持不变）。
- electron-demo 接线留作后续 PR。

## Impact

- Affected specs: `plugin-editor-extensions`（新增 Requirement）
- Affected code:
  - `packages/core/src/types.ts`（新类型 + `EditorConfig` 字段）
  - `packages/core/src/markdown-contributions.ts`（逐 snapshot 计时 + 异常隔离）
  - `packages/core/src/editor.ts`（legacy pipeline 整体计时 + observer 接线）
  - `packages/plugin-runtime/src/markdown-transform-monitor.ts`（新增 adapter）
  - `packages/core/test/markdown-transform-performance.test.ts`、`packages/plugin-runtime/test/markdown-transform-monitor.test.ts`（新增测试）
- Affected roadmap: 不属于现有 Roadmap 条目，作为插件可观测性基础设施的新增方向。

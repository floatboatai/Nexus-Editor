## 1. Core 观测接口

- [x] 1.1 在 `packages/core/src/types.ts` 新增 `MarkdownTransformPerformanceSample`（registryId / version / durationMs）与 `MarkdownTransformObserver`（函数类型），并在 `index.ts` 导出
- [x] 1.2 在 `EditorConfig` 增加可选 `markdownTransformObserver` 字段并补充文档说明
- [x] 1.3 在 `packages/core/src/markdown-contributions.ts` 的 `applyMarkdownTransformSnapshots()` 中对每个 native snapshot 单独计时并上报
- [x] 1.4 在 `packages/core/src/editor.ts` 对 legacy unified remark pipeline 整体计时（保留 registryId `nexus.core.legacy-remark-pipeline`、version 0），并把 observer 接入全部 5 处 transform 调用点

## 2. 异常隔离

- [x] 2.1 在 `applyMarkdownTransformSnapshots()` 与 `editor.ts` 的 `reportMarkdownTransformSample()` 中对 observer 调用 try/catch 隔离，保证 observer 抛错不中断 AST 管道

## 3. Runtime adapter

- [x] 3.1 新增 `packages/plugin-runtime/src/markdown-transform-monitor.ts`：`createMarkdownTransformMonitor({ diagnostics, thresholdMs?, slowCode? })` 返回 `MarkdownTransformObserver`
- [x] 3.2 超阈值样本以 `warning` 诊断发出，性能字段放入已有 `details` 通道；不改 `plugin-api` 公共 API
- [x] 3.3 默认阈值 `DEFAULT_MARKDOWN_TRANSFORM_THRESHOLD_MS = 16`，文档明确它是 practical default 而非硬性 frame budget
- [x] 3.4 在 `packages/plugin-runtime/src/index.ts` 导出 adapter

## 4. 测试

- [x] 4.1 `packages/core/test/markdown-transform-performance.test.ts`：native snapshot 逐条归因、legacy pipeline 整体样本、无 observer 行为不变、throwing observer 不中断管道
- [x] 4.2 `packages/plugin-runtime/test/markdown-transform-monitor.test.ts`：超阈值告警、未超阈值静默、自定义阈值/code、多次样本无状态残留

## 5. 验证

- [x] 5.1 运行两个新增测试文件全绿
- [x] 5.2 运行 core + plugin-runtime 全量测试套件无回归
- [x] 5.3 两包 `tsc --noEmit` 通过

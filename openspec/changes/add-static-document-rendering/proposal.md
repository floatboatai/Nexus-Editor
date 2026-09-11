# 变更：完整静态渲染与离线 HTML

## Why

完整文档预览与离线导出应复用公开快照和资源契约，不依赖视口、固定样式或桌面打印窗口。

## What Changes

- 在可选 document 包提供 DOM 渲染、序列化与离线 HTML。
- GFM、数学、Mermaid、runtime 后处理器按需适配。
- 输出大小按最终字节计算，清理可等待。

## Impact

- 受影响规范：`static-document-rendering`。
- 按用户已确认的 Headless 公共能力计划实施；不恢复桌面工作区，不自动提交或推送。

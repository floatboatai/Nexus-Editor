# 变更：可选文档转换服务

## Why

格式转换需要统一 Markdown、附件和诊断结果，而不应捆绑导入窗口、文件写入或外部程序。

## What Changes

- 提供 HTML、CSV、DOCX、文本 PDF 的独立转换入口。
- 附件采用结果内部逻辑引用和统一提供者。
- 隔离不可信转换，默认零自动网络请求，不做 OCR。

## Impact

- 受影响规范：`document-conversion`。
- 按用户已确认的 Headless 公共能力计划实施；不恢复桌面工作区，不自动提交或推送。

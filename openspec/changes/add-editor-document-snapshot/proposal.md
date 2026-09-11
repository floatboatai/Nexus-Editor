# 变更：提供可取消的有效文档快照

## Why

宿主保存、备份或导出时，需要读取包含表格待提交输入的 Markdown，且不能改变焦点、选区或撤销历史。该能力属于编辑引擎，不应依赖桌面工作区或某个 UI 框架。

## What Changes

- 在公开 `EditorAPI` 中提供 `captureDocumentSnapshot` 及参数、结果类型。
- 支持输入法等待、调用方取消和编辑器销毁取消；渲染 AST 按需生成并隔离所有权。
- 为 React/Vue 的现有实例接口补充示例与生命周期回归，不新增重复包装接口。
- 不提供文件写入、文档会话、导出界面或桌面工作区。

## Impact

- 受影响规范：`editor-document-snapshot`。
- 受影响包：`core`、`react`、`vue`；不引入运行时依赖。
- 保持既有 `getDocument()`、`getAst()` 和 `exportHTML()` 语义。

# 变更：原子模板插入命令

## Why

备份中的表格、公式和 Mermaid 插入是编辑原语，不应依赖桌面 Insert 菜单。

## What Changes

- 在工具栏插件公开纯编辑 helper 与可选命令插件。
- 所有选区一次事务处理并保留主选区，工具栏插件的默认按钮不变。

## Impact

- 受影响规范：`editor-template-commands`。
- 按用户已确认的 Headless 公共能力计划实施；不恢复桌面工作区，不自动提交或推送。

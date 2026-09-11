# 变更：可替换 UI 的搜索服务

## Why

跨文档扫描和候选排序可以复用，但默认搜索面板与 Worker 接线不能成为公共依赖。

## What Changes

- 提取纯候选排序与可取消分页的多文档搜索。
- 新增显式 headless 文内控制器，保留搜索插件的默认 UI；Electron 默认演示接入该控制器。
- 浏览器、Node 执行器分别发布，不默认启动 Worker。

## Impact

- 受影响规范：`headless-search`。
- 按用户已确认的 Headless 公共能力计划实施；不恢复桌面工作区，不自动提交或推送。

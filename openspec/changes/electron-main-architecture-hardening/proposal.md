# Change: Electron 主进程架构治理与启动性能基线

- **Author**: Wang Wei（王伟）
- **Status**: Proposed（OpenSpec Stage 1 — 待 maintainer 批准后进入实现）
- **Date**: 2026-08-31
- **Scope**: `apps/electron-demo` 内部工程治理，无公共 API / 插件平台变更

## Why

Electron 客户端（`apps/electron-demo`）是引擎能力的承载壳，但客户端工程成熟度落后于引擎能力，存在三类问题：

1. **主进程巨型单文件**：`electron/main.ts` 903 行、`electron/plugin-host-broker.ts` 1526 行，生命周期、窗口管理、IPC 路由、vault 服务、协议注册全部耦合在一个模块里。新增能力（如 autoUpdater）无处安放，任何一处改动都可能波及全局状态。
2. **多实例竞争风险**：未使用 `app.requestSingleInstanceLock()`，用户重复双击图标会打开多个实例，多个进程同时读写同一 vault 状态存在数据竞争。
3. **性能优化无基线**：渲染进程已有 `perf.ts` 工具，但**主进程从启动到窗口就绪的耗时是黑盒**，无法量化优化效果，`docs/ROADMAP.md` 中 #21（Electron packaging optimization）明确列出 Size / startup time / autoUpdater，但当前零实现。

本提案不做产品功能扩展（demo 非产品），而是做**客户端工程治理**：让主进程分层可维护、防多实例竞争、并建立可量化的启动性能基线——这些是"设计高效稳定的客户端架构 + 持续改进架构和性能"的底座。

## What Changes

- **单实例锁（`apps/electron-demo/electron/`）**：
  - 在 app ready 前调用 `app.requestSingleInstanceLock()`；拿锁失败则 `app.quit()`。
  - 监听 `second-instance`，把已存在的窗口聚焦 + 还原（`restore` + `focus`）。
  - 支持 `--allow-multiple-instances` 显式放行（供测试/调试用），保持向后兼容。
- **主进程模块化（`apps/electron-demo/electron/`）**：
  - `main.ts` → 保留为入口（组合根），业务逻辑拆分为有清晰职责的模块：
    - `app-bootstrap.ts`：生命周期编排（ready / window-all-closed / activate / before-quit / 退出 drain）。
    - `window-manager.ts`：基于现有 `SenderWindowRegistry` 的窗口创建、session 隔离、聚焦/还原。
    - `vault-service.ts`：vault 打开、watcher、文件读写、`nexus-vault://` 协议处理（从 main.ts 迁出）。
    - `security-policy.ts`：`MAIN_PLUGIN_PERMISSION_POLICIES`、外部导航策略、broker 权限边界（与 `plugin-host-broker.ts` 协同）。
    - `ipc-router.ts`：`ipcMain.handle` 通道的**唯一集中注册点**，收敛为类型化 IPC 契约（`通道名 → 请求类型 → 响应类型`，类型共享到 `src/shared/`，主/渲染两侧可类型检查）。
  - **纯重构，零行为变更**：依赖现有单测 + 新增主进程纯逻辑单测兜底。
- **启动性能基线（`apps/electron-demo/`）**：
  - 在主进程注入计时（复用渲染进程 `perf.ts` 同款标签风格，`[perf]` 前缀）：`app ready` → `createWindow` → `ready-to-show` → 渲染进程 `first paint`。
  - 新增 `scripts/measure-startup.mjs`：一键跑 N 次、输出平均/中位耗时表。
  - 在 `docs/` 新增简短测量说明（如何在 dev 与 packaged 两种形态下测量）。
- **文档**：`docs/ROADMAP.md` / `docs/ROADMAP.zh.md` 中 #21 状态 `planned` → `in-progress`，并链接本 change id。

## Impact

- Affected code：
  - `apps/electron-demo/electron/main.ts`（拆分、入口收敛）
  - `apps/electron-demo/electron/app-bootstrap.ts`（NEW）
  - `apps/electron-demo/electron/window-manager.ts`（NEW）
  - `apps/electron-demo/electron/vault-service.ts`（NEW）
  - `apps/electron-demo/electron/security-policy.ts`（NEW）
  - `apps/electron-demo/electron/ipc-router.ts`（NEW）
  - `apps/electron-demo/scripts/measure-startup.mjs`（NEW）
  - `apps/electron-demo/test/*`（新增单测）
  - `docs/ROADMAP.md`、`docs/ROADMAP.zh.md`（状态更新）
- Affected specs：无 —— 本提案不改变任何公开 capability / 插件平台 API，属 `apps/electron-demo` 内部工程治理。
- New dependencies：无。
- Non-goals（明确不做）：
  - autoUpdater 集成（roadmap #21 一部分，属产品化能力，留待后续独立 change）。
  - 打包体积瘦身的具体优化（本次只建立测量方法，不追求体积下降）。
  - 渲染进程 `app.ts` 大单体重构（量级大，独立成 change）。
  - 任何引擎/插件平台公共 API 变更。

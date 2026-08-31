# Implementation Tasks

> 本 change 为 OpenSpec **Stage 1 提案**（proposal + design），遵循"批准后再实现"的门禁。以下为批准后实施的清单。

## 1. 单实例锁（参照已验证模式）

- [ ] 1.1 在 `electron/main.ts` **模块顶层、app ready 之前**同步调用 `const gotLock = app.requestSingleInstanceLock()`；`!gotLock` → `app.quit()` 并跳过后续初始化（拿锁分支才进入 `app.whenReady()`）。
- [ ] 1.2 监听 `second-instance`，委托 `window-manager`：`isMinimized() ? restore() : focus()` 聚焦已有主窗口。
- [ ] 1.3 解析 `--allow-multiple-instances` 参数并显式放行；注释说明语义（限制进程数，不限制窗口数）。
- [ ] 1.4 新增 `test/single-instance.test.ts`：验证未拿锁分支直接退出、参数放行分支不调用锁、`second-instance` 触发聚焦。

## 2. 主进程模块化拆分

- [ ] 2.1 新建 `electron/security-policy.ts`：迁移 `MAIN_PLUGIN_PERMISSION_POLICIES` 及导航策略（纯搬移）。
- [ ] 2.2 新建 `electron/window-manager.ts`：迁移窗口创建 / session 隔离 / `createWindow` / 聚焦还原逻辑。
- [ ] 2.3 新建 `electron/vault-service.ts`：迁移 vault 打开 / watcher / 文件 IO / `nexus-vault://` 协议处理。
- [ ] 2.4 新建 `electron/ipc-router.ts`：集中 `ipcMain.handle` 通道注册。
- [ ] 2.5 新建 `electron/app-bootstrap.ts`：迁移 app 生命周期事件编排与退出 drain。
- [ ] 2.6 `electron/main.ts` 收敛为组合根（装配各模块，不写业务逻辑）。
- [ ] 2.7 拆分后 `pnpm --filter @floatboat/nexus-electron-demo build` 通过；现有 electron 单测全绿；手动启动 demo 行为与拆分前一致（回归验证）。

## 3. 启动性能基线

- [ ] 3.1 主进程注入计时（`[perf]` 前缀）：`app ready` → `createWindow` → `ready-to-show`；packaged 形态经 `--enable-perf-timing` 开启。
- [ ] 3.2 渲染进程首帧采集 `first-contentful-paint` 上报。
- [ ] 3.3 新增 `scripts/measure-startup.mjs`：spawn 应用 → 解析 `[perf]` 输出 → N 次均值/中位表。
- [ ] 3.4 在 dev 与 packaged 双形态各跑基线，把量化数字写进 PR 描述。

## 4. 文档

- [ ] 4.1 `docs/ROADMAP.md` / `docs/ROADMAP.zh.md`：#21 状态 `planned` → `in-progress`，Notes 链接本 change id。
- [ ] 4.2 在 `docs/` 补一段"如何测量启动性能"的简短说明。

## 5. 验证

- [ ] 5.1 `pnpm test` 全绿。
- [ ] 5.2 `pnpm build` 全绿。
- [ ] 5.3 `openspec validate electron-main-architecture-hardening --strict`（若环境装有 CLI）。
- [ ] 5.4 PR 描述披露 AI 协助情况（遵循 GOVERNANCE §6.2）。

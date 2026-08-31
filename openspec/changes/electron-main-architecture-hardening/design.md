# Design: Electron 主进程架构治理与启动性能基线

## 1. 现状（2026-08-31 基线）

```
electron/main.ts           903 行  生命周期 + 窗口 + IPC + vault + 协议注册耦合
electron/plugin-host-broker.ts  1526 行  IPC 权限代理（安全边界，独立保留不拆）
electron/preload.ts        241 行
electron/window-registry.ts     窗口注册表（已抽象，好）
renderer/perf.ts           渲染进程计时（已有，仅覆盖 renderer）
```

主进程缺失：单实例锁 / autoUpdater / 启动性能基线。

## 2. 目标

1. 主进程按职责分层，新能力（autoUpdater 等）有明确落点。
2. 防多实例数据竞争。
3. 建立可复现的启动性能基线（dev + packaged 双形态），并给出冷启动优化方向。
4. 收敛 IPC 通道为类型化契约，主/渲染通信可审计、可类型检查。

## 3. 目标架构（参照已验证的组合根模式）

```
electron/
├── main.ts                组合根（仅装配，不写业务）——参照成熟桌面壳的入口编排
├── app-bootstrap.ts       生命周期编排（ready/activate/before-quit/drain）
├── window-manager.ts      窗口创建 / session 隔离 / 聚焦还原
├── vault-service.ts       vault 打开 / watcher / 文件 IO / nexus-vault:// 协议
├── security-policy.ts     插件权限策略表 + 外部导航策略
├── ipc-router.ts          ipcMain.handle 通道集中注册
├── plugin-host-broker.ts  （保持不动，安全边界独立）
└── window-registry.ts     （保持不动）
```

> 该分层模式已在同技术栈的桌面壳产品中验证（入口只做装配、业务下沉到职责模块，升级/新增能力时入口基本不用改）。

## 4. 关键决策

### Decision 1：单实例锁语义（已验证模式）
- 在入口顶层同步调用 `const gotLock = app.requestSingleInstanceLock()`；`!gotLock` → `app.quit()` 并跳过后续初始化（**必须在 app ready 之前、模块顶层执行**，否则锁不生效）。
- 二次启动 → `second-instance` 事件 → `window-manager.focusMainWindow()`：`isMinimized() ? restore() : focus()`。
- 命令行 `--allow-multiple-instances` 显式放行（测试/调试），默认关闭。
- 影响面：与现有多窗口支持兼容——单实例锁限制的是"App 进程"数量，不是窗口数量；`createWindow()` 多窗口能力不变。
- 已踩坑提示：`second-instance` 里拿到的 `argv` 是二次启动的参数，可用于"双击打开文件 → 交给已有实例"的后续扩展，本次不做。

### Decision 2：拆分原则（纯重构铁律，参照组合根模式）
- 入口 `main.ts` 只做**装配**（创建模块实例 + 串联调用），业务逻辑全部下沉到职责模块——这样新增能力（autoUpdater 等）只动新模块 + 入口一行，不波及全局状态。
- 每个模块**只移动代码，不重写逻辑**；迁移后 diff 应尽量是"搬移 + 删减 import"。
- 拆分顺序：先 `security-policy`（无依赖）→ `window-manager` → `vault-service` → `ipc-router` → `app-bootstrap`。
- 验收：拆分后 `pnpm build` 通过 + 现有 electron 单测全绿 + 手动启动 demo 行为与拆分前一致。

### Decision 3：启动性能基线 + 冷启动优化方向
- 主进程用 `process.hrtime.bigint()` 打点（`[perf]` 前缀，与 renderer `perf.ts` 风格一致），packaged 形态经 `--enable-perf-timing` 开启（避免污染正常输出）。
- 渲染进程首帧用 `performance.getEntriesByType('paint')` 的 `first-contentful-paint`。
- `measure-startup.mjs`：`spawn` 应用 → 监听 stdout `[perf]` 行 → 汇总 N 次均值/中位/最大。
- **基线是前提，闭环在优化**（冷启动加速是客户端岗高频考察点）。基线出来后按收益排序执行：
  1. 主进程**按需 require**：把 `plugin-host-broker` 等重模块从入口顶层加载改为首次用到再加载。
  2. 渲染进程**懒加载非关键面板**（backlinks / outline）：首屏只挂编辑器 + 顶栏。
  3. **延迟初始化** vault watcher / 插件权限策略表到 `ready-to-show` 之后。
  4. 评估 **V8 code cache** 对渲染进程启动的收益（加分项，量级可观才做）。
- 纳入本 PR 的优化以基线数字为界：只做**收益明显且零行为变更**的项。

### Decision 4：类型化 IPC 契约（ipc-router 设计）
- `ipc-router.ts` 是**唯一**的 `ipcMain.handle` 注册点，杜绝通道名散落各模块。
- 通道清单收敛为一份类型化契约表：`通道名 → 请求类型 → 响应类型`，主/渲染共享同一组类型（放 `src/shared/`）。
- 收益：① 通道可审计（新通道必须登记）；② 两侧类型检查，改契约必须同步两侧；③ 为将来"三端同源 / Web 版复用 IPC 语义"留出抽象位——本次只打地基，不改行为。
- 纯类型层改动，现有通道行为不变。

### Decision 5：autoUpdater 不做
- 属产品化能力 + 需发布基础设施，独立 change，避免本 PR 膨胀。

### Decision 6：退出编排防循环（app-bootstrap，已验证模式）
- 退出流程从 `main.ts` 迁到 `app-bootstrap`：`before-quit → preventDefault → 异步清理（drain 窗口 + 停 watcher）→ 置位标志 → 再次 `app.quit()``。
- **防循环铁律**：必须用 `cleanedUp` / `finalizePromise` 标志位区分"首次退出需清理"与"清理完毕可放行"，否则 `app.quit()` 会无限触发 `before-quit` 死循环。
- 兜底：清理若超时，用 fallback timer 强制放行退出（防挂死）。
- Nexus 现有 `quitDrainPromise` / `finalizePromise` / `quitFallbackTimer`（多窗口 drain + 兜底定时器）**原样保留，只搬移不重写**。

## 5. 非目标

- 不追求包体积立即下降（只建测量）。
- 不重构 `renderer/app.ts`（量级大，独立 change）。
- 不引入任何运行时新依赖。
- 不做崩溃上报 / 稳定性监控（需第三方服务，独立 change）。
- 不做内存泄漏治理专项（长会话场景需长时间跑测，独立 change）。
- 不做托盘 / 悬浮窗 / 全局快捷键（demo 现为单窗口形态，超范围）。
- 不做 autoUpdater（产品化能力，独立 change）。

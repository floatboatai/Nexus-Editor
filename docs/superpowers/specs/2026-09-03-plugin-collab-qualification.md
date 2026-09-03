# `plugin-collab` 资格验证矩阵

**状态：** 本地真实 Electron 产品流程、renderer 恢复及可信 TLS evidence 已记录；`production-supported` qualification 仍未完成
**日期：** 2026-09-04（§12 保留 09-03 历史记录，最新增量见 §14）
**产品基线：** `docs/superpowers/specs/2026-09-03-plugin-collab-product-decisions.md`

**提交状态：** 本地验收后，用户已授权从改名后的 `feat/collab-product-completion` 创建唯一最终 PR。§12/§14 的分支、HEAD 和未提交状态是当时的原始验收记录，不是最终 PR 的当前 Git 状态；PR 不构成版本发布或生产支持声明。

本文定义什么证据足以支持 `experimental`、`contract-compatible` 和 `production-supported`。单元测试通过、两个 Editor 能互相更新或生成可播放 demo 都不能替代完整资格验证。

---

## 1. 证据规则

- 每项证据必须记录 commit、运行环境、adapter 名称与版本、测试命令、开始/结束时间和原始结果位置。
- 缺少真实 Provider、Store、Host 或所需平台时记为 `SKIP`，不能记为 `PASS`。
- 自动化检查与人工资格验证分开记录；人工结果必须说明操作者、步骤和观察值。
- flaky、超时、非确定失败或测试进程异常退出均为 `FAIL`，直到根因明确并重新运行。
- 只通过 contract fake 的实现最多为 `contract-compatible`。
- `production-supported` 要求 Q0–Q8 中适用于该支持声明的项目全部通过，且没有未处置的高严重度数据完整性或安全问题。

---

## 2. Gate 总览

| Gate | 证明对象 | 阻止的错误结论 |
|---|---|---|
| Q0 | Core 权威事务 | “远端变化能 dispatch，所以不会分叉” |
| Q1 | CRDT 收敛 | “双人顺序输入成功，所以并发一定收敛” |
| Q2 | Engine 与绑定生命周期 | “一个 Editor 成功，所以多 Editor/框架也安全” |
| Q3 | 本地持久化与崩溃恢复 | “已发送到 socket，所以数据已安全” |
| Q4 | Provider 与授权 | “WebSocket open，所以已经同步且有权限” |
| Q5 | 多窗口/多进程 | “单 renderer 成功，所以 Electron 多窗口安全” |
| Q6 | 文件投影与外部修改 | “CRDT 收敛，所以磁盘不会冲突” |
| Q7 | Presence | “能看到光标，所以 Presence 安全且会清理” |
| Q8 | 安全、性能与长期运行 | “功能测试通过，所以可以长期生产运行” |

---

## 3. Q0 — Core authoritative transaction

必须自动化覆盖：

- Local Proposal 被 accept 后，listener 只观察最终提交。
- Local Proposal 被 reject 后，Editor、AST 和外部模型均不改变。
- Local Proposal 被 replace 后，只提交 replacement 的最终 changes 和 origin chain。
- Authoritative Update 跳过 reject/replace filters，但仍更新 EditorState、AST、change event 和 update listener。
- 同一 Editor 同时只能注册一个 authoritative source；竞争注册原子失败。
- registration dispose、Editor destroy 和递归上限返回稳定结构化结果。
- authoritative batch 保持一个原子提交和确定 selection mapping。
- `EditorAPI.undo()`、`redo()`、键盘、`beforeinput(historyUndo/historyRedo)` 和 Host command 使用同一个 active history controller。
- active controller 无历史可操作时，History key 与 browser intent 不得回退到 CM history 改写投影。
- authoritative source 解绑后，history 恢复策略与 spec 一致，不跨文档模型撤销。
- IME composition 期间的 local/authoritative 顺序不丢失或重复字符。
- live-preview table 的编辑内容不长期只存在于 contentEditable DOM；远端更新、blur、Escape、删除和拖选路径均通过回归测试。

Q0 没有通过前，不得实现生产 Collaboration Engine binding。

---

## 4. Q1 — CRDT convergence

使用确定性调度器和属性/模型测试覆盖：

- 两个和多个 Replica 的并发 insert/delete/replace；
- 重复、乱序、延迟和分批 update；
- Unicode surrogate pair、emoji、组合字符、CJK 和 LF 规范化；
- 多 selection、跨段落替换和空文档；
- state vector 增量同步与 full-state recovery；
- create/join 竞争、重复 create 和 identity mismatch fail closed；
- schemaVersion 相同收敛，不支持的新版本拒绝写入；
- 每轮结束所有 Y.Text、绑定 Editor 和持久化恢复结果逐字节等价。

随机测试必须保存 seed，失败可重放。

---

## 5. Q2 — Engine、框架与生命周期

- 并发 `open(DocumentId)` 共享一个 Replica opening work，但返回独立可关闭 handle。
- `create` 是唯一播种路径；首次 join 无本地 Replica 时等待 initial sync readiness。
- `replace-editor` 与 `require-match` 行为、错误和竞态有 contract test。
- 一个 Replica 同时绑定多个 Editor，每个 Binding 拥有独立 local origin、selection 和 UndoManager。
- Vanilla、React `onReady`、Vue mounted 和 native lifecycle adapter 都调用同一 Engine interface。
- React/Vue unmount、Editor detach、DocumentHandle close、plugin unload 和 Engine close 均幂等。
- contextChanged 在旧 Binding 完整 quiesce 后才切换新 DocumentId，不把更新写入错误文档。
- 一个文档失败不会关闭其他文档；旧 handle 不会操作重建后的 Replica。
- 关闭后 listener、timer、rAF、observer、Awareness 和 Provider lease 回到基线。

---

## 6. Q3 — Persistence and crash recovery

至少使用一个真实 IndexedDB adapter 和一个 Electron 主进程 durable adapter：

- update append 成功后才能发布 `persisted=true`；
- append 进行中进程终止，重启后恢复到最后一个已确认 durable update；
- snapshot + journal compaction 在每个故障注入点都得到旧完整状态或新完整状态；
- 重复 append/replay 幂等；损坏 journal 不被当作空文档；
- store 满、权限拒绝、I/O error、schema mismatch 分别产生 diagnostic；
- 离线编辑、关闭、重启、继续编辑、联网后最终收敛；
- 多 renderer durable writes 通过 broker 串行化；不存在同时写同一数据库/文件；
- compaction 后仍能与只持有旧 state vector 的 peer 同步。

volatile store 只跑功能测试，不参与 production qualification。

---

## 7. Q4 — Provider, authentication and authorization

在真实 WebSocket reference server 和一个声明为生产候选的 Host adapter 上覆盖：

- token valid、expired、malformed、wrong room、wrong role；
- reader 能接收但不能提交文档 update；
- editor 可以提交，服务端按 DocumentId 隔离房间；
- 权限运行期撤销后停止 update、清理 Presence 并要求重新授权；
- 运行期撤销与所有已通过初检的 authenticated message 共享 credential operation gate，writer 再取得 document gate；确定性调度覆盖 revoke-first 拒绝旧 update、reader SyncStep1 不晚发快照、update-first 先完成再返回、失败释放不死锁、同房间新 credential 恢复写入、晚到 Awareness 不复活 Presence，以及其他房间继续推进；
- socket open、authenticated、authorized、initial sync、reconnecting 是不同状态；
- initial sync 中断、指数退避、抖动、重复连接和离线恢复；
- update 在认证完成前不得进入 Y.Doc；
- oversized/invalid frame、未知 protocol message，以及 authenticated/pre-authentication pending count/bytes backpressure 不导致无界内存；近 document cap 的 tiny-update burst 必须关闭责任连接，同时其他房间和 health probe 继续推进；
- Provider release 幂等且不销毁 Engine-owned Replica；
- server restart 和网络分区后使用 state vector 补齐且不重复用户操作。

reference server 结果不能替代生产 Host 对 token、数据保留、监控和备份的资格验证。

---

## 8. Q5 — Electron multi-window and browser integration

Electron：

- 构建后的 main process、sandboxed preload 与安全应用来源 renderer 在默认 runtime 和显式 legacy 模式下都能挂载产品 DOM，并且只暴露对应模式的最小 bridge surface；
- 两个及以上 renderer 打开同一 DocumentId，通过 broker 收敛；
- 一个 renderer 崩溃不破坏其他 Replica 或 durable store；
- 主窗口、子窗口先后关闭时，引用计数和 Presence 清理正确；
- file watcher echo 被去重，rename 保持 DocumentId；
- broker 重启或主进程退出时，没有虚假的 persisted/projected 状态。

Browser：

- Chromium 中 direct Core、React 和 Vue smoke 均通过；
- 两个 tab 经真实 Provider 收敛；
- IndexedDB reopen 和 storage failure 覆盖；
- 页面隐藏、恢复、offline/online 和 unload 不留下陈旧 Presence。

没有独立运行证据的平台只能标为 contract-compatible。单窗口 built-artifact startup smoke 只关闭 preload bundling 与空白启动回归，不能替代 packaged app、多个真实 renderer 的完整 workflow 或 renderer/utility crash 资格。

---

## 9. Q6 — File Projection

- CRDT → file 使用原子写入，只观察到旧完整内容或新完整内容；
- watcher 能识别自身写入回声，不把 projection 再导入 Yjs；
- disk == base、live == base、双方不同且不重叠、双方重叠四种三方场景；
- 无 Projection Base 时拒绝自动覆盖或导入；
- 冲突保留 base/live/disk 三份材料并停止自动 projection；
- rename/move 更新 projection location，不改变 DocumentId；
- 本地文件删除不删除远端 Collaborative Document；
- CRLF/LF、最终换行、Unicode 和大文档导出保持既定 policy；
- projection failure 不回滚已经收敛并持久化的 CRDT update。

冲突 UI 必须完成人工 smoke：保留 live、保留 disk、人工合并、另存为、关闭重开后状态保持。

---

## 10. Q7 — Presence

- selection 使用相对位置，在并发文本变化后仍落在预期语义位置；
- name、color、avatar、client metadata 的类型、长度和格式限制；
- HTML/CSS/URL 注入 payload 不进入危险 DOM sink；
- selection 高频变化经过节流，文档内容不受节流影响；
- blur、切文档、断网、权限撤销、tab unload 和 Engine close 的 tombstone/expiry；
- 陈旧 Presence 自动过期，不被解释为仍在线成员；
- Presence 丢失、重复或乱序不影响文档收敛和授权。

---

## 11. Q8 — Security, performance and soak

安全：

- threat model 覆盖恶意 peer、被窃 token、越权 room、资源耗尽、日志泄露和 Host adapter 越权；
- 依赖许可证、锁定版本、已知漏洞和供应链来源完成审查；
- diagnostic/log fixture 证明不包含 token、完整 Markdown 或原始不可信 Presence；
- update、Awareness、document size、peer count、重连和队列均有可执行上限。

性能：

- 在实现前记录当前 Core 输入、解析、live-preview 和大文档基线；
- 记录启用但空闲、单人本地输入、远端 churn、initial restore、large update 的 p50/p95/p99；
- 明确硬件、浏览器/Electron、文档 corpus、文档大小和 peer 数；
- 预算由基线和产品 SLO 批准，不在测试代码中随意发明。

长期运行：

- 至少 8 小时 attach/detach、在线/离线、Presence 和编辑 churn；
- journal/内存/observer/listener/connection 数量保持有界；
- 结束后资源回到允许误差内的基线；
- 每个异常都有原始日志和可重放 seed/步骤。

---

## 12. 2026-09-03 本地产品路径实测记录

**代码边界：** 2026-09-03 当前未提交 working tree，位于本地 `codex/feat-collab-product-completion`；OpenSpec change 保持 active，旧 PR #296 未更新，未新建 PR，未归档。
**环境：** Linux 6.18.42 x86-64、Intel Core i9-13900H、Node 26.4.0、pnpm 9.15.4、Vitest 2.1.9、Electron 35.7.5。
**原始结果：** 本地终端输出；下列计数来自 2026-09-03 的最终全量重跑。构建产物、`.electron-smoke/` 和本地 pnpm store 不进入提交范围。

| Gate | Assessment 结果 | 证据与边界 |
|---|---|---|
| Q0 | `PASS`（自动化） | Core transaction pipeline 16 tests；live preview/table 86 tests。覆盖 proposal accept/reject/replace、exclusive authority、batch + selection、history API/key/beforeinput、递归/异常、source dispose、table source fallback、grip cancel 与 IME 回归。人工 Electron walkthrough 因当前 Linux computer-use 无 WebView tree/截图权限记为 `SKIP`。 |
| Q1 | `PASS`（assessment） | `plugin-collab` deterministic convergence test 覆盖 3 Replica 分区、insert/delete/replace、重复/乱序 update、Unicode/CJK/emoji、LF normalization、state-vector delta 与 late join replay；不构成长期随机 fuzz 或真实网络资格。 |
| Q2 | `PASS`（assessment） | Engine/binding tests 覆盖并发 open dedupe、独立 handle、initial-sync interruption/Engine close、同 Editor attach race、同 Replica 多 Editor、direct/React/Vue attach/unmount、IME 和幂等释放。Native Host 使用相同 handle 的编排已文档化，没有新增第二套 adapter 状态机。 |
| Q3 | `PARTIAL`（真实本地 adapters）；production-supported `SKIP` | 原生 IndexedDB 与 `node:sqlite` Store 已覆盖 reopen、并发 append、checkpoint compaction、超限回滚和损坏日志 fail-closed；Electron MessagePort/broker/restart 组合测试通过。utility shutdown 使用同端口 FIFO drain barrier，先排空 preload 已接纳的 per-lease tail，再覆盖尚未到达 broker 的 MessagePort request；drain/cleanup ack 缺失显式失败，零码退出不再误报 durable success。本地 durable Engine 路径进一步覆盖独立 SQLite client 关闭重开、离线恢复和 server 重启后的联网收敛。尚未覆盖进程在每个事务故障点被强杀、真实磁盘满/权限故障和目标平台矩阵。 |
| Q4 | `PASS`（本地 reference deployment）；hosted production `SKIP` | 真实 Hocuspocus WebSocket reference server 覆盖 room-scoped reader/editor、malformed/expired/wrong-room credential、运行期 revoke/reauthenticate、idle expiry、trusted Presence identity、server persistence/restart、offline state-vector replay、oversized frame、累计 document cap 与 authenticated count/byte backpressure；auth runtime 还明确拒绝公开文档占位签名密钥，示例要求生成新的随机 secret。运行期 revoke 与所有 admitted authenticated message 通过同一 credential gate 线性化，writer 另取 document gate；确定性竞态证明 revoke 返回后旧 update 不再 apply、reader SyncStep1 不晚发权威快照、晚到 Awareness 不复活 Presence、失败不死锁、同房间可由新 credential 恢复且其他房间继续推进。默认单文档上限 8 MiB、硬上限 16 MiB；突发 tiny update 越界会以稳定原因关闭责任连接，同时 health 与其他房间继续推进。invitation strict join 从空 Replica 完成 authenticated initial sync，成功后才原子替换并 flush 本地缓存；reader/editor 都不能把陈旧 join cache 带入 SyncStep2，无效 credential 保留原缓存。reader 除服务端拒绝 update 外，Workflow 还把 membership 传入 Core Binding，因此离线 `local-only` 也不能本地改写正文，升级 editor 后可重新 attach 写入。没有 TLS、外部身份系统、密钥轮换、备份恢复、横向扩展、监控或服务 SLO 证据。 |
| Q5 | `PARTIAL`（Electron persistence components）；packaged product multi-renderer `SKIP` | Electron package 36 files / 435 tests、真实 Electron 三窗口 lifecycle smoke、当前 Linux 环境中构建后 `file://` renderer + sandboxed preload 的 runtime-default/explicit-legacy startup smoke，以及 renderer adapter → preload reconnect bridge → MessagePort → utility broker → sole SQLite writer 的自动化组合测试通过。startup smoke 等待 completed-boot marker，检查产品 DOM 和模式对应的最小 bridge，并通过 utility worker 完成一次 Store open/load/close，防止 preload workspace runtime dependency 再次导致空白窗口。main-process harness 证明 `render-process-gone` 会令崩溃 sender 的 join opening 失活但保留 exact owner/operation blocking fence，并保留 delete fence且不影响另一窗口；另一个 renderer 只有提供 durable original owner 才能精确 rebind。product-stack test 使用两个隔离的 Host/Vault、SQLite 文件和 Workspace，但仍在同一 Vitest 进程内；startup smoke 也仍是单窗口、未打包且未覆盖 macOS/Windows 的 built-artifact gate，二者都不能替代两个真实 BrowserWindow 运行完整产品 workflow、真实 renderer/utility crash 与 packaged end-to-end 资格。 |
| Q6 | `PARTIAL`（自动化本地产品路径）；production-supported `SKIP` | File Projection tests 覆盖持久 Enrollment、乐观原子写、confirmed self-write echo 抑制、base/live/disk 三方协调、Unicode/line-ending policy、无 base/重叠/stale-version 冲突、generation-checked keep-live/accept-disk/manual merge、rename/delete/I/O failure、并发 metadata 与重启恢复；确定性故障注入还证明 `writeAtomic` 成功、Projection Base save 失败后，文件已改变但 exact `base:null` identity 仍可枚举。Electron Enrollment v4 在 Projection 前保存 exact pending join，覆盖 Host precommit/commit、同 renderer invitation 失败重试、renderer close 后 inactive fence、Host restart 重建、Enrollment CAS、release retry 和受约束 abandon；abandon/pre-projection rollback 在 Host release 后若 durable abort 失败会重建 exact committed fence，Enrollment commit 后的 pending cleanup 失败则由 atomic active Enrollment 与 committed pending 继续阻断竞争 lifecycle。恢复只从 exact Enrollment/metadata 补齐且不改文件，无 metadata 时继续 fail-closed。面板显示 pending-evidence/blocked 状态、safe recovery、同 invitation retry；只有无 metadata 时显示警告式 abandon，overlapping rename/delete 均被阻止。Electron Vault adapter、冲突 panel 和 product-stack 的两个真实 Markdown 文件也有组合证据。尚未完成人工冲突/恢复 UI walkthrough、packaged watcher 行为、真实 renderer 强杀与真实外部编辑器端到端资格。 |
| Q7 | `PARTIAL`（本地 reference + contract）；production-supported `SKIP` | relative selection、rAF coalescing、字段/URL/CSS 清洗、本地 Awareness clientID 不进入 `peers`、远端 peer 可见、detach/Engine-close tombstone、server trusted identity 以及 revoke/expiry 清理均有自动化覆盖。tab hidden/unload、不可控断线的超时清理和长期 churn 尚无真实浏览器/产品资格。 |
| Q8 | `PARTIAL`; production `SKIP` | 浏览器安全入口/API 检查、精确依赖/许可证与 replacement-cost 审查、协议/凭证/存储 bounds 和 benchmark baseline 已建立；`pnpm audit --prod` 报告无已知漏洞。本次开发机基准中 idle 均值 0.0016 ms / p99 0.0027 ms，本地 proposal convergence 均值 0.9564 ms / p99 3.3898 ms，Core authoritative projection 均值 0.2579 ms / p99 0.6507 ms，而 64 KiB 全量替换均值 1,797.09 ms / p99 1,988.04 ms，仍需后续性能治理。这些单机数字受调度、温度和后台负载噪声影响，只是开发基线，不是 SLO 或 production qualification。服务端的 8-message/2-MiB authenticated pending budget、8-MiB 默认 document cap、16-MiB hard cap 和 event-loop yield 已通过定向压力回归；threat-model 演练、真实 browser trace 和 8 小时 soak 未执行。 |

执行命令与结果：

```text
pnpm typecheck                                                        PASS
pnpm check:api                                                        PASS
NODE_OPTIONS=--no-experimental-webstorage pnpm test                   PASS (root 97 files / 1305 tests; server 9 files / 55 tests)
NODE_OPTIONS=--no-experimental-webstorage pnpm --filter @floatboat/nexus-plugin-collab test
                                                                      PASS (8 files / 142 tests)
NODE_OPTIONS=--no-experimental-webstorage pnpm --filter @floatboat/nexus-electron-demo test
                                                                      PASS (36 files / 435 tests)
pnpm build                                                            PASS
pnpm qualify:collab-production-path                                   PASS (1 file / 1 test)
pnpm --filter @floatboat/nexus-collab-server exec vitest run --config vitest.config.ts test/electron-product-stack-qualification.test.ts
                                                                      PASS (1 file / 2 tests)
pnpm --filter @floatboat/nexus-collab-server test                     PASS (9 files / 55 tests)
pnpm --filter @floatboat/nexus-collab-server typecheck                PASS
pnpm --filter @floatboat/nexus-collab-server build                    PASS
pnpm build:electron-demo                                              PASS
pnpm --filter @floatboat/nexus-electron-demo smoke:startup            PASS (built file:// renderer + sandboxed preload; default runtime + explicit legacy)
pnpm --filter @floatboat/nexus-electron-demo smoke:multi-window       PASS (Electron 35.7.5, 3 distinct BrowserWindows)
pnpm --filter @floatboat/nexus-plugin-collab bench                    PASS (4 scenarios; 64 KiB replacement mean 1797.09 ms, p99 1988.04 ms; development-machine baseline)
pnpm audit --prod                                                     PASS (no known vulnerabilities)
OPENSPEC_TELEMETRY=0 pnpm dlx @fission-ai/openspec@1.11.0 validate add-plugin-collab --strict --no-interactive
                                                                      PASS
OPENSPEC_TELEMETRY=0 pnpm dlx @fission-ai/openspec@1.11.0 validate --all --strict --no-interactive
                                                                      PASS (16 items)
```

Node 26 默认暴露一个未配置的 experimental Web Storage accessor，使既有 Electron settings test 中的全局 `localStorage` 为 `undefined`；禁用该 Node 实验特性后，测试使用 jsdom 的浏览器 storage 并全量通过。仓库声明的 CI 基线是 Node 22，该参数不改变产品代码或测试语义。

`qualify:collab-production-path` 在开始场景前显式加载并检查 `node:sqlite.DatabaseSync`。能力缺失会使测试失败并报告 unsupported，不会记为 `SKIP` 或 `PASS`。该场景使用真实内置 SQLite、两个互不共享数据库文件的 Store/Engine client、loopback WebSocket 和可停止/同端口重启的真实 reference server。Client A 在线状态先与 Client B 收敛；server 停止后 A 完成离线编辑并达到 `persistence="clean"`，随后 A 的 Document、Engine 和 SQLite connection 全部关闭。使用同一 SQLite 文件重建 A 时，在 server 仍离线的情况下恢复完整 Markdown 和 `local-only` 状态；server 从原存储目录重启后 A/B 恢复 `online`/`synced`，最终 Markdown 相同且离线 marker 恰好出现一次。压缩阈值设为 2，因此该路径同时经过 snapshot + journal 恢复。

`electron-product-stack-qualification.test.ts` 另行组合真实 Workspace、Hocuspocus Provider、Electron Vault backend、两个隔离的 Vault/Host storage roots、两个 SQLite Store 和两份 Markdown 文件，覆盖 create → invite → join → Core edit convergence → 双文件 projection → server persistence → Client B 完整关闭重开 → server 离线时从 enrollment/SQLite 恢复为 `local-only`。夹具显式使用 1800 秒 delegator 与 300 秒 invitation，避免把同 TTL 的跨秒竞态误报成产品失败，同时保留并单独验证“delegated credential 不得晚于 delegator 到期”的服务端边界。它证明产品层编排连接了真实组件，不是 assessment fake。

Electron Host 聚焦资格另以两个 sender/两个 Vault session 验证同 Vault path-opening 与 delete fence：已准入 projection write 完成后才能 reserve；竞争 invitation opening、普通写、rename/create/delete 被阻断；opening token 绑定 exact owner，过期只撤销写权限而不开放竞争路径；renderer `render-process-gone` 会关闭 sender session、令 opening inactive 但继续保留 exact owner/operation blocking fence，同时保留 durable delete fence且不影响其他窗口。恢复 renderer 必须以 durable pending join 的 original owner 精确 rebind。Host restart 后，Enrollment v4 pending join 可重建 Host fence；exact Projection metadata（包括 file write 成功但 Base save 前失败留下的 `base:null`）只补 Enrollment、不改文件，无 metadata 则保留不确定状态。Delete 的 Host-first `precommit` 在 durable CAS 前后两个 crash point 都可枚举，durable read-back 会 promote，Host-only 状态由另一窗口显式恢复。

Electron startup smoke 直接运行构建后的 `dist-electron/main.js`、真实 sandboxed preload、utility worker 和 `dist/index.html`，使用独立临时 user-data 并在无 mode 环境变量时验证 runtime bridge，再以 `NEXUS_PLUGIN_PLATFORM=0` 验证 legacy bridge。两种模式都等待 renderer 明确进入 `ready`，要求挂载 toolbar、main area、Editor、status line 和 Collaborate action；runtime 还必须经真实 bridge 完成一次 Store open/load/close。它因此能发现“页面已加载但 preload 依赖无法解析，启动清理把 `#app` 清空”以及 utility worker 遗漏的白屏回归。它没有运行 electron-builder 产物，也没有驱动两个窗口完成 create/join/edit/recover，更没有强杀 renderer 或 utility process。

开发启动器另有定向证据：它只接受不含 credential、query 或 fragment 的 loopback HTTP renderer URL，重复探测 Vite，收到成功响应后才启动 Electron；超时会在窗口创建前以有界诊断失败。主进程会再次校验 `VITE_DEV_SERVER_URL`，即使绕过 launcher，也会在 navigation 前以 `renderer-url-invalid` 拒绝不可信值。renderer entry 使用 dynamic import，使应用模块加载/求值失败也进入 `renderer-startup-failed`；失败页在缺失 `#app` 时创建 fallback，并替换任何 partial UI。`did-finish-load` 后的 15 秒 watchdog 要求 renderer 明确发布 `ready` 或 `failed`，否则显示 `renderer-startup-timeout`。main-window 与 renderer failure tests 向 URL validation、navigation、`preload-error`、module load、boot rejection 和 watchdog 注入或覆盖 credential URL、token、私有路径与 Markdown，验证 Host 只显示稳定错误码及固定恢复提示，原始失败对象不会进入对话框、失败页或 Host 自有 renderer 日志。

上述本地组合与 Host harness 仍不是打包产品资格：client 虽然拥有独立 Engine、Provider、Host storage root、Vault 和 SQLite 文件，但 product-stack 场景运行在同一个 Vitest 进程，server 仅绑定 loopback；`render-process-gone` 也是 main-process harness 中的确定性故障注入。它们不证明打包 Electron utility process、两个真实 renderer 执行完整产品 workflow、真实 renderer/utility crash、跨机器网络、TLS、磁盘故障或长期运行。

综合判定：当前实现达到 `experimental` Collaboration Engine，并具备真实本地 Provider、Store 与恢复路径证据；仍不达到 `production-supported`，Roadmap #18 保持 `in-progress`。

---

## 13. 发布判定

| 发布声明 | 必需证据 |
|---|---|
| 单 PR 笔试交付完成 | `add-plugin-collab` 中承诺的本地功能 tasks 完成；Core/Engine、真实 Provider/Store、File Projection、Host Workflow/UI 和本地 product-stack 证据通过；未完成的生产资格项明确保留为 `PARTIAL` 或 `SKIP` |
| Core authoritative seam 可合并 | Q0 全部通过，现有 Core/Plugin API 回归通过，OpenSpec 已批准 |
| Collaboration Engine `experimental` | Q0–Q2 通过，Q3–Q8 可有明确未完成项 |
| Adapter `contract-compatible` | 对应 contract suite 通过，真实环境资格可能为 SKIP |
| 一个 Host `production-supported` | Q0–Q8 对该 Host 全部 PASS，真实 Provider/Store/冲突 UI 证据齐全 |
| Roadmap #18 `done` | 至少一个 Host production-supported；文档、支持矩阵和 OpenSpec archive 与证据一致 |

“笔试交付完成”只表示题目要求的本地产品路径实现完整，不等于生产资格。当前已有真实 Provider、durable Store 和 File Projection，但 packaged 多 renderer/crash、目标平台、外部 TLS/身份与运维、安全/performance trace 和长期运行证据仍不完整，所以项目必须保持 `experimental`，不得用本地组合或 assessment adapter 的 PASS 替代真实环境的 `SKIP`。

---

## 14. 2026-09-04 桌面联网与单次交付收口

**代码边界：** `codex/feat-collab-product-completion`，HEAD 仍为 `507d782`；本次代码、测试、部署模板和文档均在未提交 working tree。最终候选审查基线为本地 `main` / merge-base `af58999e9f7579428f464d7b22b76585c2ddac95`，包括 tracked 修改及全部新增文件。用户已关闭旧 PR #296 并删除远程分支；本轮没有 commit、push、PR 或 OpenSpec archive。

**环境：** Linux x64，Electron 35.7.5，pnpm 9.15.4；开发工作区 Node 26.4.0，独立干净候选目录使用 CI 基线 Node 22.23.2。原始证据为本次本地终端/测试输出；下面的永久入口可重跑对应场景，不依赖旧 PR 或隐藏产品钩子。

**记录窗口：** 2026-09-04 04:38–04:56（UTC+08:00）；最终 Node 22 干净目录 `smoke:collaboration` 的退出码为 0，完整结构化原始输出保存于 [Electron 验收结果](./2026-09-04-plugin-collab-electron-results.json)。报告中的 TLS scope 不得省略。取消加固另经 SIGTERM 实测：runner 退出 143、输出 `ok:false` 而非 PASS，本次记录的 4 个测试进程组均无存活后代，测试临时目录被删除。

### 修复及证据

| 范围 | 本次结果与边界 |
|---|---|
| 桌面网络 | 原构建在实际有效 loopback WS 上复现 `connect-src / enforce` 拒绝（RED）。改用 Host 启动配置、预加载前 CSP 和 `nexus-app://editor/` 后，legacy/runtime 真实窗口均允许已配置 WS，同时未配置 WSS 仍被 CSP 拒绝。另以真实 Vite dev 页面 + 同一产品 main/preload/fixture 复验 runtime ready、允许 WS、拒绝未配置 WSS。 |
| 邀请权限 | Main 固定操作 broker 验证 sender/top frame、精确 endpoint、请求和响应大小、身份/有效期、并发和时限；无 Cookie/Origin、标准 TLS、禁止重定向、窗口关闭取消。真实 HTTP 回归验证 302 不会跟随；单元测试验证原始错误/凭证不回显。 |
| 产品入口 | 审查发现 untrusted create 在拒绝前写了 pending Enrollment；真实 Workspace/Enrollment 回归先 RED 后修复为保存次数 0。实机发现 revoked reader 的重新授权误发 editor role；面板回归先 RED，修复后使用保留的 Enrollment membership，缺失时不猜测角色。 |
| 两个真实客户端 | 两个独立 Electron app、真实 BrowserWindow、独立 Vault/SQLite，经实际 DOM 表单和键盘驱动。只替代操作系统文件选择器，不直接调用内部 Workspace。8 个场景全部通过，见下文。 |
| TLS | 临时 CA 签发 loopback 证书，两个真实 Electron 客户端完成 WSS create/invite/join、双向编辑/独立撤销和 Presence，Main 经 HTTPS 签发邀请。Node 用进程级额外 CA；Chromium 测试 session 仅信任验证了签名、用途、名称和期限的测试链。无该 CA 的 Node 与 Chromium 均拒绝连接；未关闭证书校验、未全局安装 CA。仅证明本机 TLS 链路，不是公网 DNS/跨机器部署资格。 |
| 干净构建 | 不复制工作区 `node_modules` 或任何 `dist`，从 tracked + untracked 候选创建独立目录；Node 22 冻结锁文件安装、先 Electron startup、再 typecheck/API/test/build。发现并修复 reference-plugins 的 math/vim Vite 源码别名缺失，以及 server 测试跨包路径缺失。全量测试在开发目录和干净目录结果相同。 |
| 自托管 | systemd/Nginx/环境模板、受保护稳定签名凭证和运行手册已交付；凭证加载器 3 项实际 CLI 测试、systemd 语法验证通过。Nginx 未安装，实际 `nginx -t` 与真实服务器安装均为 `SKIP`，没有执行外部部署。 |

8 个产品场景：

1. 创建 → 生成邀请 → 另一客户端验证并加入。
2. 双向编辑收敛，Alice 撤销不删除 Bob 的操作。
3. 双向可见的远端 Presence。
4. 离线编辑达到本地 `clean` → 关闭进程 → 从同一 SQLite 重开 → 显式内容恢复 → 服务端重启后收敛。
5. 同样达到本地 `clean` 后，解析当前测试实例唯一 renderer PID 并实际 SIGKILL；Host 释放该窗口，重开本地 Replica，恢复连接后向另一客户端收敛。
6. Reader invitation 加入后，真实键盘输入不能修改共享正文。
7. Reader 的外部 Markdown 修改触发确定性 File Conflict；显式 Keep shared 恢复真实磁盘文件。不把 editor 可安全自动合并的改动误判为必须冲突。
8. 服务端 revoke → Reader 替换凭证恢复 → 短凭证真实到期 → 再授权 → 收到新的远端编辑。

### 永久验收入口

```text
pnpm install --frozen-lockfile
pnpm --filter @floatboat/nexus-electron-demo smoke:startup
pnpm typecheck
pnpm check:api
pnpm test
pnpm build
pnpm --filter @floatboat/nexus-collab-server test:deployment
pnpm --filter @floatboat/nexus-electron-demo smoke:multi-window
pnpm --filter @floatboat/nexus-electron-demo smoke:collaboration
pnpm audit --prod
OPENSPEC_TELEMETRY=0 pnpm dlx @fission-ai/openspec@1.11.0 validate --all --strict --no-interactive
```

也可用 `pnpm qualify:collab-electron` 一次完成全部 workspace/Electron 构建及新协作验收。需要 Node 22、OpenSSL 和图形会话；Linux 无 DISPLAY 时需要 `xvfb-run`。CI 已加入新协作与部署凭证检查。Node 26 开发机运行 Vitest 仍需 `NODE_OPTIONS=--no-experimental-webstorage`；Node 22 不需要此参数。

本次全量测试为 root **101 files / 1361 tests**、server **9 files / 55 tests**，另外 deployment **3 tests**；API、类型、全包构建、startup、multi-window、协作场景、OpenSpec 16 items 与生产依赖 audit 均通过。首次失败的 RED/干净环境问题已定位并修复后重跑，不作为通过结果隐藏。

### 审查与未覆盖项

Standards 轴未发现新的规范阻塞；Spec 轴发现 1 个准入顺序错误，已补回归修复并由独立审查复验关闭。实机验证另关闭 reader 重新授权缺陷。候选没有携带构建产物、数据库、真实 `.env` 或静态私钥；高风险凭证模式扫描无匹配，这不替代独立安全审计。

Q3/Q5 的 Linux renderer 恢复、Q4/Q7 的真实客户端授权/Presence、Q6 的实际 watcher/冲突 UI 比 §12 增加了真实产品证据；**不把整个 Q3–Q8 改成 PASS**。仍缺少 packaged Windows/macOS 矩阵、utility/数据库事务各故障点强杀、真实磁盘满与权限故障、完整人工交互矩阵、公网跨机器 DNS/TLS、外部身份/密钥轮换/备份恢复演练、生产监控与 SLO、安全审计、性能 trace 和八小时 soak。`tasks.md` 的 9.8、12.4 保留未完成，Roadmap #18 仍为 in-progress，支持级别仍是 `experimental`。

安全来源迁移不会移动/删除 Markdown、Enrollment 或 SQLite；旧 `file://` 来源的演示外观设置不自动迁移，可在 Settings 重新设置。旧来源数据未删除。

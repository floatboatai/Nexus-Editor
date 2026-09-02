# `plugin-collab` 资格验证矩阵

**状态：** assessment evidence recorded；production qualification deferred
**日期：** 2026-09-03
**产品基线：** `docs/superpowers/specs/2026-09-03-plugin-collab-product-decisions.md`

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
- socket open、authenticated、authorized、initial sync、reconnecting 是不同状态；
- initial sync 中断、指数退避、抖动、重复连接和离线恢复；
- update 在认证完成前不得进入 Y.Doc；
- oversized/invalid frame、未知 protocol message 和 backpressure 不导致无界内存；
- Provider release 幂等且不销毁不归它所有的 Y.Doc/Awareness；
- server restart 和网络分区后使用 state vector 补齐且不重复用户操作。

reference server 结果不能替代生产 Host 对 token、数据保留、监控和备份的资格验证。

---

## 8. Q5 — Electron multi-window and browser integration

Electron：

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

没有独立运行证据的平台只能标为 contract-compatible。

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

## 12. 2026-09-03 assessment 实测记录

**代码边界：** 本文件所在最终 PR head；base 为 `origin/main@af58999`。OpenSpec change 保持 active，未归档。
**环境：** Linux 6.18.42 x86-64、Intel Core i9-13900H、Node 26.4.0、pnpm 9.15.4、Vitest 2.1.9、Electron 35.7.5。
**原始结果：** 本地终端输出与最终 PR checks；构建产物、`.electron-smoke/` 和本地 pnpm store 不进入 PR。

| Gate | Assessment 结果 | 证据与边界 |
|---|---|---|
| Q0 | `PASS`（自动化） | Core transaction pipeline 15 tests；live preview/table 86 tests。覆盖 proposal accept/reject/replace、exclusive authority、batch + selection、history API/key/beforeinput、递归/异常、source dispose、table source fallback、grip cancel 与 IME 回归。人工 Electron walkthrough 因当前 Linux computer-use 无 WebView tree/截图权限记为 `SKIP`。 |
| Q1 | `PASS`（assessment） | `plugin-collab` deterministic convergence test 覆盖 3 Replica 分区、insert/delete/replace、重复/乱序 update、Unicode/CJK/emoji、LF normalization、state-vector delta 与 late join replay；不构成长期随机 fuzz 或真实网络资格。 |
| Q2 | `PASS`（assessment） | Engine/binding tests 覆盖并发 open dedupe、独立 handle、initial-sync interruption/Engine close、同 Editor attach race、同 Replica 多 Editor、direct/React/Vue attach/unmount、IME 和幂等释放。Native Host 使用相同 handle 的编排已文档化，没有新增第二套 adapter 状态机。 |
| Q3 | `PARTIAL`; production `SKIP` | assessment Memory Store 的 replay、append failure 与状态分离通过；没有 IndexedDB、SQLite、进程崩溃和 compaction 证据。 |
| Q4 | `PASS`（contract）; production `SKIP` | assessment Provider 的 initial sync、offline/reconnect、有界队列、state-vector recovery、release/resource baseline 通过；无真实服务、auth、authorization、TLS 或 backpressure 资格。 |
| Q5 | `PASS`（assessment demo）; distributed collab `SKIP` | Electron 双 Editor lab DOM test、Electron build 和既有真实多窗口 lifecycle smoke 通过；lab 仍在一个 renderer，未宣称多 renderer 通过 Provider broker 协作。 |
| Q6 | `SKIP` | 本 PR 明确不实现 File Projection、watcher echo 或三方冲突 UI。 |
| Q7 | `PASS`（assessment contract） | relative selection、rAF coalescing、字段/URL/CSS 清洗、detach 与 Engine-close tombstone 通过；真实断网/权限撤销的 expiry 由生产 Provider 资格验证。 |
| Q8 | `PARTIAL`; production `SKIP` | 浏览器安全 API 检查、精确依赖/许可证审查与四项 benchmark baseline 完成。`pnpm audit --prod` 仍报告既有依赖链 30 项（7 high、18 moderate、5 low；包为 `dompurify`、`js-yaml`、`mermaid`、`nanoid`、`postcss`、`uuid`），新引入的 `yjs` / `y-protocols` 不在 advisory 集合；threat-model 演练、真实 browser trace 和 8 小时 soak 未执行。 |

执行命令与结果：

```text
pnpm typecheck                                                        PASS
pnpm check:api                                                        PASS
NODE_OPTIONS=--no-experimental-webstorage pnpm test                   PASS (72 files, 932 tests)
pnpm build                                                            PASS
pnpm build:electron-demo                                              PASS
pnpm --filter @floatboat/nexus-electron-demo smoke:multi-window       PASS (Electron 35.7.5, Linux x64)
pnpm --filter @floatboat/nexus-plugin-collab bench                    PASS
pnpm audit --prod                                                    FAIL (30 existing workspace advisories; none for yjs/y-protocols)
OPENSPEC_TELEMETRY=0 pnpm dlx @fission-ai/openspec@1.11.0 validate add-plugin-collab --strict --no-interactive  PASS
OPENSPEC_TELEMETRY=0 pnpm dlx @fission-ai/openspec@1.11.0 validate --all --strict --no-interactive               PASS (16 items)
```

Node 26 默认暴露一个未配置的 experimental Web Storage accessor，使既有 Electron settings test 中的全局 `localStorage` 为 `undefined`；禁用该 Node 实验特性后，测试使用 jsdom 的浏览器 storage 并全量通过。仓库声明的 CI 基线是 Node 22，该参数不改变产品代码或测试语义。

综合判定：本 PR 达到 `experimental` Collaboration Engine 与 assessment adapter 的单 PR 笔试交付边界；不达到 `production-supported`，Roadmap #18 保持 `in-progress`。

---

## 13. 发布判定

| 发布声明 | 必需证据 |
|---|---|
| 单 PR 笔试交付完成 | `add-plugin-collab` 全部 tasks、Q0–Q2、Q4 contract、Q5 assessment demo、Q7 和相关 Q8 基线检查通过；Q3/Q6/生产 Q4–Q8 明确记为 deferred 或 SKIP |
| Core authoritative seam 可合并 | Q0 全部通过，现有 Core/Plugin API 回归通过，OpenSpec 已批准 |
| Collaboration Engine `experimental` | Q0–Q2 通过，Q3–Q8 可有明确未完成项 |
| Adapter `contract-compatible` | 对应 contract suite 通过，真实环境资格可能为 SKIP |
| 一个 Host `production-supported` | Q0–Q8 对该 Host 全部 PASS，真实 Provider/Store/冲突 UI 证据齐全 |
| Roadmap #18 `done` | 至少一个 Host production-supported；文档、支持矩阵和 OpenSpec archive 与证据一致 |

“笔试交付完成”只表示题目范围实现完整，不等于生产资格。没有真实 Provider、durable Store、File Projection、目标平台和长期运行证据的项目必须保持 `experimental`，不得用 assessment adapter 的 PASS 替代真实环境的 SKIP。

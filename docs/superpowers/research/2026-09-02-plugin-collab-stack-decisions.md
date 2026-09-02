# `plugin-collab` 开发前技术选型调研

**调研日期：** 2026-09-02
**用途：** 为 `plugin-collab` 的产品决策记录和后续 OpenSpec changes 提供一手证据
**范围：** Yjs v13 / `y-protocols`、生产 WebSocket Provider、Electron 本地 Replica Store、OpenSpec CLI、许可证
**证据原则：** 只采用官方文档、官方源码仓库、SQLite 官方文档和 npm registry；版本结论是本日快照，正式实现时必须重新核验。

本文刻意区分：

- **事实**：来源能够直接证明的行为或状态；
- **推断**：从事实推导出的产品含义，仍需用集成测试验证；
- **建议**：面向 Nexus Editor 当前架构的选择，不冒充上游保证。

---

## 1. 建议冻结的决策

| ID | 建议决策 | 状态 |
| --- | --- | --- |
| D-01 | 首版固定在 `yjs@13.6.32`、`y-protocols@1.0.7`；禁止把 Yjs 14 的 `@y/y`、`@y/protocols` 混入同一依赖图 | 可冻结 |
| D-02 | `CollaborationEngine` 只依赖 Nexus 自己的 `ProviderLease`；第三方 Provider 类型和 wire protocol 不进入 Engine 公共 API | 可冻结 |
| D-03 | 首个产品级 Provider 优先资格验证 Hocuspocus 4；Y-Sweet 作为第二个真实 adapter；`y-websocket` 小型 server 只用于协议测试 | 建议，仍需产品确认部署/认证边界 |
| D-04 | Electron Replica Store 使用“SQLite 内的 append-only update table + 原子 snapshot compaction”，由单个 utility-process broker 持有写连接；renderer 不直接打开数据库 | 可冻结架构，驱动仍需打包 spike |
| D-05 | SQLite 驱动优先验证 `better-sqlite3@13.0.3`；不要把当前 Electron 35 内的实验性 `node:sqlite` 直接作为生产承诺 | 可进入 spike |
| D-06 | 不自研裸文件 append journal；只有 SQLite 驱动在目标平台无法合格时，才单独提出并验证 framing、checksum、fsync、锁和 compaction 协议 | 可冻结 |
| D-07 | OpenSpec 使用精确版本 `@fission-ai/openspec@1.11.0`；仓库尚未加依赖前用精确版本 `pnpm dlx`，加入后统一用 `pnpm exec` | 可冻结 |

这些决策不等于已经批准实现。Provider 的最终选择仍依赖账号系统、部署拓扑、服务端持久化目标和“云端已保存”是否必须有耐久确认。

---

## 2. Yjs v13 与 `y-protocols`

### 2.1 当前版本边界

**事实**

- npm registry 当前 `latest` 为 [`yjs@13.6.32`](https://www.npmjs.com/package/yjs/v/13.6.32)，许可证 MIT。
- npm registry 当前 `latest` 为 [`y-protocols@1.0.7`](https://www.npmjs.com/package/y-protocols/v/1.0.7)，其 peer dependency 是 `yjs ^13.0.0`，许可证 MIT。
- npm registry 当前 `latest` 为 [`y-websocket@3.1.0`](https://www.npmjs.com/package/y-websocket/v/3.1.0)，许可证 MIT。
- `y-websocket` 官方 README 明确说当前稳定包面向 Yjs v13，而仓库 `main` 上的 `@y/websocket` 是面向 Yjs v14 的不稳定开发线；官方建议多数用户继续使用稳定 v13 包。[官方 README](https://github.com/yjs/y-websocket/blob/master/README.md)
- `y-protocols` 仓库当前 `main` 已展示 Yjs 14 的 `@y/protocols` / `@y/y` 包名，但 `v1.0.7` 发布物仍是 `y-protocols` + `yjs ^13`。因此不能直接照抄 `main` 的新包名到 v13 代码。

**推断**

- 不锁版本会产生真实的 major-line 混装风险。尤其是 `@y/websocket-server` 当前 latest 已切到 Yjs 14，不能与 Yjs 13 方案一起无约束安装。

**建议**

- 首个 OpenSpec 和实现把依赖基线写成 `yjs@13.6.32` 与 `y-protocols@1.0.7`，并由 workspace lockfile 固定实际解析结果。
- v13 代码使用 `y-protocols/sync`、`y-protocols/awareness`，不要使用 `@y/y` 或 `@y/protocols`。
- `yjs` 作为 peer dependency 时，也应在 `plugin-collab` 的开发依赖中固定同一 v13 版本，避免测试使用另一份实例或另一条 major line。

### 2.2 Document update 与 sync 的确切语义

**事实**

- Yjs document update 是二进制 `Uint8Array`，具有交换律、结合律和幂等性；只要收到完整 update 集合，不同应用顺序和重复应用仍会收敛。[Yjs Document Updates](https://docs.yjs.dev/api/document-updates)
- `Y.encodeStateVector()` 描述某个副本已知的 client clock；`Y.encodeStateAsUpdate(doc, stateVector)` 计算对方缺失的差量。[Yjs Document Updates](https://docs.yjs.dev/api/document-updates)
- `y-protocols` 的 client-server 握手由 client 发送 `SyncStep1(state vector)`，server 返回 `SyncStep2(missing update)`，随后 server 再发送自己的 `SyncStep1`；持续变更使用 `Update` 消息。[协议规范](https://github.com/yjs/y-protocols/blob/master/PROTOCOL.md#3-sync-protocol)
- `ydoc.on("update")` 给出的 update 可以发送给其他副本或存入数据库；`Y.applyUpdate` 支持 origin，用于识别 update 来源。[Yjs Document Updates](https://docs.yjs.dev/api/document-updates)
- `Y.mergeUpdates()` 可以去重并合并 binary updates，但不会垃圾回收已删除内容；要真正减少长期 deleted-content 占用，仍需载入 `Y.Doc` 后重新编码状态。[Yjs Document Updates](https://docs.yjs.dev/api/document-updates)
- Yjs v2 update 编码压缩更好，但官方说明并非所有 Provider 都支持，因此不能由 Engine 单方面切换。[Yjs README](https://github.com/yjs/yjs#document-updates)

**推断**

- state vector 证明的是“某副本已知哪些 CRDT clocks”，不是事务总序、用户身份、服务端授权或磁盘耐久确认。
- 基础 `SyncStep2` 到达只证明 client 获得了 server 当时可提供的状态，不能证明 client 的本地 update 已经被服务端持久化。
- `connected`、`initialRemoteSync`、`localUpdatesPending`、`serverAcknowledged` 与 `durablyStored` 是不同命题。单个布尔 `synced` 无法承载真实产品语义。

**建议**

- `ProviderState` 至少分别报告 transport、initial sync、local pending/ack、authorization/revocation 与 failure。
- Provider 证明不了服务端 durable commit 时，状态只能命名为“已同步到协作服务”，不能显示“已安全保存到云端”。
- Replica Store 保存 binary updates / snapshot；Markdown 和 JSON 只作为投影或诊断产物，不能重建为新的 Yjs history 后冒充原副本。
- update-v2 只能作为某个具体 Provider adapter 的协商能力，不能改变 Engine 的通用 binary-update contract。

### 2.3 Awareness / Presence

**事实**

- Awareness 是 `y-protocols` 中独立于 `Y.Doc` 的临时 state-based CRDT，不进入文档内容，也不需要跨 session 持久化。[Yjs Awareness](https://docs.yjs.dev/api/about-awareness)
- Awareness entry 由 client ID、递增 clock 和 JSON state 组成；状态为 `null` 表示离线。[协议规范](https://github.com/yjs/y-protocols/blob/master/PROTOCOL.md#4-awareness-protocol)
- 官方协议规定 30 秒未刷新应在本地移除该 client，并建议至少每 15 秒重新广播自己的状态；正常断开前应广播 `null`。[协议规范](https://github.com/yjs/y-protocols/blob/master/PROTOCOL.md#41-semantics)
- Awareness payload 自身不认证，恶意客户端可以声明任意 presence 数据；需要可信身份时，必须由更高层执行权威校验。[协议规范](https://github.com/yjs/y-protocols/blob/master/PROTOCOL.md#6-read-only-enforcement)

**推断**

- 客户端自报的 `userId`、display name、role 或 permissions 都不是可信授权事实。
- 将 Awareness 落入 Replica Store 会让离线用户、旧 cursor 或伪造身份在重启后复活，破坏 presence 语义。

**建议**

- Awareness 只承载 cursor、selection、临时显示属性和 activity；不承载房间成员资格、ACL 或 durable comments。
- Provider 服务端应根据已认证 connection context 覆盖或过滤身份字段；renderer 只渲染经过 adapter 标记为可信的 identity view。
- Replica 关闭时显式销毁 Awareness/Provider lease，并测试 30 秒 timeout 之外的主动下线路径。

### 2.4 本地持久化 readiness

**事实**

- 官方 `y-indexeddb` 会把 Yjs 状态持久化到浏览器 IndexedDB，下一次打开可恢复并与 network provider 组合使用。[Yjs Offline Support](https://docs.yjs.dev/getting-started/allowing-offline-editing)
- `y-indexeddb` 的 `synced` 事件表示数据库连接已建立且现有内容已加载；即使该 document name 下没有内容也会触发。[官方 README](https://github.com/yjs/y-indexeddb/blob/master/README.md)

**推断**

- “本地 store 加载完毕”和“远端已有文档完成 initial sync”必须是两个 readiness gate。
- 空本地 store 的 `synced` 不能证明远端不存在文档，也不能授权把当前 Editor 文本写入远端。

**建议**

- 保留设计中的显式 `create()` / `open()` 分离以及 creation marker。
- 首次 `open()` 且没有有效本地 Replica 时，等待 Provider 的远端 initial sync；不要根据空 Y.Text、空 SQLite 查询或空 IndexedDB 自动播种。

---

## 3. 生产 WebSocket Provider 选项

### 3.1 对 headless library seam 的共同要求

无论选择哪个服务端，`CollaborationEngine` 都不应暴露 `WebsocketProvider`、`HocuspocusProvider`、Y-Sweet client token 或某个 SDK 的事件类型。建议让 adapter 归一化为：

- `prepare()` 不联网；
- `start()` 之后独立报告 transport 与 initial sync；
- 明确 `create` / `join`；
- 报告 authorization/revocation；
- 只有上游确有语义时才报告 local acknowledgement 或 durable commit；
- `release()` 幂等且不销毁 Engine 传入的 `Y.Doc` / Awareness；
- 所有第三方对象留在 adapter 私有实现内。

这是 Nexus 的架构建议，不是上游协议事实。

### 3.2 自有 `y-protocols` / `y-websocket` compatible server

**事实**

- 官方 [`@y/websocket-server`](https://github.com/yjs/y-websocket-server/blob/main/README.md) 明确将自己定位为开发服务器或自建后端起点，而非 production-ready backend；默认文档只在内存中，进程重启即丢失。
- 它提供的 persistence seam 只有 `bindState` / `writeState`；官方还特别建议在 update 到达时增量持久化，而不是只等最后一个 client 离开时写出。[官方 README](https://github.com/yjs/y-websocket-server/blob/main/README.md#persistence)
- `@y/websocket-server@0.1.1` 依赖 `yjs ^13.5.6` 与 `y-protocols ^1.0.5`；当前 latest `0.1.5` 已依赖 `yjs ^14.0.0-7` 和 `@y/protocols`。[npm package](https://www.npmjs.com/package/@y/websocket-server)
- 基础 `y-protocols` 没有内建 read-only identity。协议规范允许 server 拒绝 write 消息，但明确指出 Awareness identity 仍需更高层认证。[协议规范](https://github.com/yjs/y-protocols/blob/master/PROTOCOL.md#6-read-only-enforcement)

**推断**

- 自建 server 需要自行承担 room routing、认证、权限撤销、binary durability、compaction、资源限制、背压、多节点广播、监控、备份与恢复；“能让两个客户端收敛”远未达到生产完成。
- 在 Yjs 13 测试中无约束安装 `@y/websocket-server` 会落到不兼容的 Yjs 14 依赖线。

**建议**

- 仅将 `y-websocket@3.1.0` + `@y/websocket-server@0.1.1` 精确版本组合用于 protocol contract test、本地开发和双 client 收敛测试。
- 不把该小型 server 作为生产服务承诺。
- 只有当协作服务端本身是产品竞争力、团队愿意长期维护上述能力时，才另立服务端 OpenSpec/仓库自研标准协议服务；它不应被隐藏在 `plugin-collab` package 的实现任务里。

### 3.3 Hocuspocus 4

**事实**

- npm 当前 [`@hocuspocus/server@4.6.0`](https://www.npmjs.com/package/@hocuspocus/server/v/4.6.0) 与 [`@hocuspocus/provider@4.6.0`](https://www.npmjs.com/package/@hocuspocus/provider/v/4.6.0)，许可证均为 MIT。
- server/provider 的 peer dependency 支持 `yjs ^13.6.8` 与 `y-protocols ^1.0.6`；server v4 要求 Node.js 22+。
- server 提供 authentication、message、Awareness、load/store document 等 lifecycle hooks；`beforeHandleMessage` 可以在应用 update 前拒绝消息，`beforeHandleAwareness` 可以校验或改写 Awareness identity。[Hocuspocus Hooks](https://tiptap.dev/docs/hocuspocus/server/hooks)
- v4 对认证前消息缓冲提供 byte、message 与 pending-document 限制，避免未认证连接无限占用内存。[Server configuration](https://tiptap.dev/docs/hocuspocus/server/configuration#pre-authentication-resource-limits)
- persistence 可以通过通用 Database、SQLite 或 S3 extension 实现。官方要求保存 Yjs binary，并警告不要把 `Y.Doc` 转成 JSON 后重建，否则会创建新 history 并导致重复内容。[Persistence guide](https://tiptap.dev/docs/hocuspocus/guides/persistence)
- Redis extension 用于多实例间传播 update 和 Awareness，但不持久化数据，必须另配 Database/persistence adapter。[Redis extension](https://tiptap.dev/docs/hocuspocus/server/extensions/redis)
- Hocuspocus 自 v2 起为支持一个 WebSocket 复用多个文档而不再兼容普通 y-provider server；必须使用自己的 `HocuspocusProvider`。[Provider overview](https://tiptap.dev/docs/hocuspocus/provider/overview)

**推断**

- Hocuspocus 具备首个真实产品后端所需的大部分 hook 与防护面，且和 Nexus/当前 Electron 的 TypeScript + Node 运维路径更接近。
- 它的协议不等于通用 `y-websocket`。如果把其类型或状态直接放进 Engine API，会形成错误的可替换性承诺。
- `onStoreDocument` 默认 debounced；服务端执行 store hook 也不自动等于客户端拿到了 durable-storage acknowledgement。

**建议**

- 把 Hocuspocus 4 作为 Nexus 首个生产 Provider 的优先资格验证对象，单独实现 `HocuspocusProviderAdapter`。
- adapter 只报告实际可证明的语义；未增加应用级回执协议前，不报告 cloud durable。
- 资格矩阵必须覆盖 token expiry/revocation、pre-auth resource limits、store failure、Redis 分区、重连和同一 connection 多 document 生命周期。

### 3.4 Y-Sweet

**事实**

- npm 当前 [`y-sweet@0.9.1`](https://www.npmjs.com/package/y-sweet/v/0.9.1)、[`@y-sweet/sdk@0.9.1`](https://www.npmjs.com/package/@y-sweet/sdk/v/0.9.1) 和 [`@y-sweet/client@0.9.1`](https://www.npmjs.com/package/@y-sweet/client/v/0.9.1)，均为 MIT。
- client peer dependency 是 `yjs ^13.0.0`，依赖 `y-protocols ^1.0.5`。
- Y-Sweet 是 Rust 编写的 Yjs document store，可写本地目录或 S3-compatible storage，并提供基于 session backend 的横向扩展与 document-level client token。[官方项目](https://github.com/jamsocket/y-sweet)
- `y-sweet serve` 默认不持久化；必须显式传入目录或 `s3://...` storage path。[Self-hosting](https://github.com/jamsocket/y-sweet/blob/main/docs/running.md)
- 服务端返回的 WebSocket URL 标注为兼容 `y-websocket` provider；官方 client 源码直接使用 `y-protocols/sync` 和 `y-protocols/awareness`，并增加 awareness query、sync status、token refresh、heartbeat 和本地未确认版本跟踪。[server API type](https://github.com/jamsocket/y-sweet/blob/main/crates/y-sweet-core/src/api_types.rs) / [client provider source](https://github.com/jamsocket/y-sweet/blob/main/js-pkg/client/src/provider.ts)
- client token 支持 `full` 与 `read-only` document authorization。[Y-Sweet auth source](https://github.com/jamsocket/y-sweet/blob/main/crates/y-sweet-core/src/auth.rs)

**推断**

- Y-Sweet 比基础 `y-websocket` 更接近“标准协议 + server acknowledgement”的产品需求，也更适合对象存储和单用途 Rust 服务部署。
- 它仍为 0.x；认证模型、状态扩展和 session-backend 运维不能只凭底层使用 `y-protocols` 就假设与其他 server 完全可换。

**建议**

- 将 Y-Sweet 作为第二个真实 `YSweetProviderAdapter` 资格验证对象。
- 如果产品最终更重视标准协议、对象存储、短期 document token 和 Rust 单用途服务，而不是 Node hooks 与内嵌集成，可以在同一 contract suite 通过后把 Y-Sweet 提升为首选。
- 即使它暴露 local acknowledgement，也要单独核实 acknowledgement 究竟表示 server memory、session backend 还是 object-store durable commit，再命名 UI 状态。

### 3.5 y/hub（观察项）

**事实**

- y/hub 实现标准 `y-websocket` 协议，使用 Redis streams 做多实例实时传播，并支持 S3 或 Postgres-compatible persistence 与外部 permission callback。[官方 README](https://github.com/yjs/yhub)
- 上游将其明确标记为 beta。
- 它采用 AGPL 或商业许可证双重许可，而不是 MIT。[官方 README](https://github.com/yjs/yhub#licensing)

**建议**

- 若未来必须同时获得标准 `y-websocket`、成熟多节点拓扑与更丰富的 attribution/history，可单独评估 y/hub。
- 当前不把它作为默认项：beta 成熟度和 AGPL/商业许可都需要产品与法务先接受。

### 3.6 Provider 比较结论

| 方案 | Yjs 13 | 通用 `y-websocket` | Auth / resource hooks | Persistence / scale | 许可证 | Nexus 建议 |
| --- | --- | --- | --- | --- | --- | --- |
| `@y/websocket-server@0.1.1` | 是 | 是 | 需自建 | 默认内存；需自建 | MIT | 只用于测试/开发 |
| 自有 `y-protocols` server | 可控制 | 可控制 | 全部自建 | 全部自建 | 自有代码 + 依赖许可 | 独立产品能力，不与插件首版绑在一起 |
| Hocuspocus 4.6 | 是 | 否，使用自有 Provider | 完整 hooks 与 pre-auth limits | DB/SQLite/S3 + Redis | MIT | 首个产品资格验证 |
| Y-Sweet 0.9.1 | 是 | 核心兼容并有扩展 | document token | filesystem/S3 + session backend | MIT | 第二个真实 adapter；标准协议优先时可晋升 |
| y/hub | 是/标准 wire | 是 | permission callback | Redis + S3/Postgres | AGPL 或商业 | 观察项 |

这里的“首个”不是把 Hocuspocus 写死进 Engine，而是要求至少有一个真实 server 通过生产资格矩阵。Provider adapter seam 仍必须允许 Y-Sweet 或自有实现替换。

---

## 4. Electron 本地 durable Replica Store

### 4.1 当前宿主约束

**事实**

- 当前 demo 声明 `electron ^35.0.0`，lockfile 解析到 35.7.5；该版本内嵌 Node.js 22.16.0，但 Electron 官方已经将 35.x 标记为 end-of-support。[Electron 35.7.5](https://releases.electronjs.org/release/v35.7.5)
- Electron 官方只支持最近三个 stable major；截至本次调研，受支持主线已经远高于 35。[Electron support policy](https://www.electronjs.org/docs/latest/tutorial/electron-timelines)
- Electron 每个 BrowserWindow 有独立 renderer；renderer 默认没有直接 Node.js 能力，受权本地操作应通过 preload 暴露的窄 IPC API 交给主进程或 utility process。[Electron process model](https://www.electronjs.org/docs/latest/tutorial/process-model)
- Electron 官方建议需要 fork Node child 时优先使用 `utilityProcess`，它可以通过 MessagePort 与 renderer 通信。[Electron utility process](https://www.electronjs.org/docs/latest/api/utility-process)
- Electron 明确警告不要阻塞 main process UI thread。[Electron performance](https://www.electronjs.org/docs/latest/tutorial/performance#3-blocking-the-main-process)

**推断**

- 当前 Electron 35 不能作为 production qualification 基线。协作存储引入前应先升级到受支持 Electron 并重新跑多窗口/打包 smoke。
- 同步 SQLite driver 放在 main process 虽然功能可行，但长事务、compaction 或 integrity check 会拖慢整个应用控制面；单独 utility process 更合理。

**建议**

- 先完成独立的 Electron supported-version upgrade change，再冻结 SQLite driver 的目标 runtime。
- 只由一个 `ReplicaStoreBroker` utility process 持有数据库写连接。renderer 通过类型化 MessagePort/IPC 调用，不接收任意 SQL 或文件路径。
- renderer 断开不关闭共享 store；broker 生命周期归主进程，应用退出时统一 drain、checkpoint/close。

### 4.2 为什么选择 SQLite 内的 append journal

**事实**

- SQLite 是 serverless、single-file、transactional database，交付代码属于 public domain。[SQLite overview](https://sqlite.org/about.html) / [copyright](https://www.sqlite.org/copyright.html)
- WAL 模式允许 reader 与 writer 并发，但同一时刻仍只有一个 writer；WAL 还引入 checkpoint 生命周期。[SQLite WAL](https://www.sqlite.org/wal.html)
- WAL 文件是数据库持久状态的一部分；复制或移动数据库时将主文件与 `-wal` 分离，可能丢失已提交事务或造成损坏。[SQLite WAL file](https://www.sqlite.org/wal.html#the_wal_file)
- SQLite 依赖文件系统锁。网络文件系统的 locking/sync 可靠性不一致，官方建议需要并发读写时让访问进程位于存储数据库的同一台机器。[SQLite over a network](https://www.sqlite.org/useovernet.html)
- WAL + `synchronous=NORMAL` 保证一致性但电源故障时可能丢失最近提交；`synchronous=FULL` 会在每次事务 commit 后额外同步 WAL，以获得 power-loss durability。[SQLite PRAGMA synchronous](https://www.sqlite.org/pragma.html#pragma_synchronous)

**推断**

- SQLite 自己的 `-wal` 不是产品级 Yjs update journal，应用不能读取、复制、清理或版本化它。
- 把 Yjs updates 建模为普通 SQLite append rows，可以同时获得事务、checksum/metadata、迁移和原子 compaction；比再实现一套裸文件崩溃协议风险更低。
- 即使 SQLite 能协调多连接，把所有 renderer 写操作收敛到一个 broker 仍能简化 per-document sequence、compaction 互斥、资源所有权和故障诊断。

**建议**

- 数据库必须放在本机 application-data 目录，不放在 vault、Dropbox/NFS 或其他同步/网络目录。
- 表结构至少区分：
  - immutable `replica_updates(document_id, generation, sequence, update_blob, checksum, created_at)`；
  - `replica_snapshots(document_id, generation, snapshot_blob, state_vector, through_sequence, checksum)`；
  - creation marker、schema version、projection base 与 clean-shutdown marker。
- `append(update)` 只在 SQLite transaction commit 后 resolve；这时才能报告 local `persisted`。
- compaction 在一个 transaction 内先写新 snapshot，再删除 `through_sequence` 及以前的 update；失败时旧 snapshot/journal 仍可恢复。
- 使用 WAL、non-zero busy timeout 和受控 checkpoint。若产品要求离线编辑在断电后也不丢，使用 `synchronous=FULL`；只有产品明确接受断电丢失最后事务时才允许 `NORMAL`。
- update 重复应用在 CRDT 层虽然幂等，store 仍应以 generation + sequence/event id/checksum 做重复检测，避免 journal 无界膨胀。
- 不直接复制打开中的 `.sqlite`；使用 SQLite backup API 或先由 broker 完整关闭，并把备份/恢复加入故障测试。

### 4.3 SQLite driver

**事实**

- [`better-sqlite3@13.0.3`](https://www.npmjs.com/package/better-sqlite3/v/13.0.3) 当前为 MIT，提供同步 API、事务、WAL 和 worker-thread support。[官方仓库](https://github.com/WiseLibs/better-sqlite3)
- `better-sqlite3` v13 已迁移到 N-API，官方 release note 说明其 prebuilt binary 因此可跨 Node/Electron 版本复用的范围更大；没有目标平台 binary 时仍会在安装时编译。[v13 release](https://github.com/WiseLibs/better-sqlite3/releases/tag/v13.0.0)
- Electron 支持 native Node modules，但官方仍要求核对目标平台/架构，必要时为 Electron rebuild；升级 Electron 后通常需要重新验证/rebuild native modules。[Electron native modules](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules/)
- 当前 Electron demo 配置了 `npmRebuild: false`，并在 packaged `extraMetadata` 中清空 dependencies；这与新增 native production dependency 存在直接打包冲突，必须先做 dist smoke。
- Electron 35.7.5 的 Node 22.16 已提供 `node:sqlite`，但该 Node 版本中它仍是 experimental；即使当前 Node 24 文档也只标记为 release candidate，而非 stable。[Node SQLite history](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html)

**推断**

- `better-sqlite3` 的同步 API 适合单写者 broker，但不应在 renderer 或 Electron main UI thread 执行大 compaction。
- N-API 降低但没有消除跨 OS/arch packaging 风险；真正的支持声明必须来自安装包内运行证据。
- `node:sqlite` 可以减少外部 native addon 的打包复杂度，但当前稳定性等级不足以直接成为真实产品的长期 API 承诺。

**建议**

- 第一选择是 `better-sqlite3@13.0.3` + utility-process broker，并在依赖合入前完成 Linux x64、Windows x64、macOS x64/arm64 的 build/install/open/write/crash/reopen smoke。
- spike 必须同时验证 electron-builder 能打包 native binary、ASAR 路径正确、跨架构产物不混用；验证通过后才修改 `npmRebuild` / `asarUnpack` 等正式配置。
- 将 SQLite calls 封装在 host-owned `ReplicaStore` adapter 后。未来 `node:sqlite` 稳定并通过数据迁移/性能测试时，可以替换驱动而不改 `CollaborationEngine`。

### 4.4 为什么不选裸 append file

裸文件方案必须由 Nexus 自己定义并长期维护：record framing、长度上限、checksum、torn-tail 识别、fsync 边界、跨进程锁、sequence 分配、snapshot generation、原子 rename、旧 generation 回收、损坏隔离与迁移。

这些不是 Yjs 自动提供的能力。对当前产品没有证据显示裸文件能换来 SQLite 无法提供的必要收益，因此建议拒绝；如果未来目标平台无法接受 native SQLite，重新开 change 做独立资格验证，而不是把 fallback 悄悄塞进同一 adapter。

---

## 5. OpenSpec CLI 的可复现调用

### 5.1 官方安装事实

**事实**

- 官方包名是 [`@fission-ai/openspec`](https://www.npmjs.com/package/@fission-ai/openspec)，不是 `openspec`。
- 官方文档要求 Node.js `>=20.19.0`，标准机器级安装命令是 `npm install -g @fission-ai/openspec@latest`，验证命令是 `openspec --version`。[OpenSpec installation](https://openspec.dev/docs/installation)
- npm registry 当前 latest 为 `@fission-ai/openspec@1.11.0`，MIT，binary 名为 `openspec`。
- 官方 CLI 支持 `validate [item] --strict --no-interactive`，也支持 `--all`、`--changes` 与 `--specs`。[OpenSpec CLI](https://openspec.dev/docs/cli)
- OpenSpec security policy 说明 validation 是本地操作；可通过 `OPENSPEC_TELEMETRY=0` 禁用 telemetry。[Security policy](https://github.com/Fission-AI/OpenSpec/blob/main/SECURITY.md)

本仓库现场检查：

- `node --version` 为 `v26.4.0`，满足官方最低版本；
- 全局/工作区目前没有 `openspec` binary，`pnpm exec openspec --version` 返回 command not found；
- `pnpm dlx @fission-ai/openspec@1.11.0 --version` 已实际返回 `1.11.0`；
- 同一精确版本的 `validate --help` 已确认 `--all --strict --no-interactive` 可用。

### 5.2 可复现方案

**推断**

- 官方 `@latest` 全局安装适合个人机器，但不会把团队和 CI 锁到同一 CLI，因此不能单独作为仓库的可复现验证方案。

**建议**

在允许修改依赖前，使用不改仓库 manifest 的精确版本命令：

```bash
OPENSPEC_TELEMETRY=0 pnpm dlx @fission-ai/openspec@1.11.0 \
  validate --all --strict --no-interactive
```

验证单个 change：

```bash
OPENSPEC_TELEMETRY=0 pnpm dlx @fission-ai/openspec@1.11.0 \
  validate add-editor-authoritative-source --strict --no-interactive
```

产品决策获批后，在独立治理 change 中将精确版本加入 root `devDependencies`，再把 CI/开发命令统一为：

```bash
OPENSPEC_TELEMETRY=0 pnpm exec openspec validate --all --strict --no-interactive
```

版本升级通过单独 PR/变更完成，重新校验所有 active 与 archived specs；不要让 `@latest` 在 CI 中静默改变 validator 行为。

---

## 6. 许可证快照

| 组件 | 本次核验版本/状态 | 许可证 | 一手来源 | 结论 |
| --- | --- | --- | --- | --- |
| Yjs | 13.6.32 | MIT | [Yjs repo](https://github.com/yjs/yjs#license-and-author) | 可用于商业产品，保留 notice |
| `y-protocols` | 1.0.7 | MIT | [repo](https://github.com/yjs/y-protocols) | 可用；锁定 v13 包名 |
| `y-websocket` | 3.1.0 | MIT | [repo](https://github.com/yjs/y-websocket) | 仅 client/test backend 路径 |
| `@y/websocket-server` | 0.1.1 用于 v13 测试 | MIT | [repo](https://github.com/yjs/y-websocket-server) | 不作 production 承诺 |
| Hocuspocus | 4.6.0 | MIT | [repo](https://github.com/ueberdosis/hocuspocus#license) | 首个 production qualification 候选 |
| Y-Sweet | 0.9.1 | MIT | [LICENSE](https://github.com/jamsocket/y-sweet/blob/main/LICENSE) | 第二 adapter 候选；关注 0.x 风险 |
| y/hub | beta | AGPL 或商业 | [license section](https://github.com/yjs/yhub#licensing) | 采用前需产品/法务决策 |
| SQLite | runtime-selected version | Public Domain | [SQLite copyright](https://www.sqlite.org/copyright.html) | 无常规开源许可证义务；特殊司法辖区可另评估 warranty of title |
| `better-sqlite3` | 13.0.3 | MIT | [LICENSE](https://github.com/WiseLibs/better-sqlite3/blob/master/LICENSE) | 需保留 notice，并验证 native distribution |
| OpenSpec | 1.11.0 | MIT | [repo](https://github.com/Fission-AI/OpenSpec) | 仅开发工具，不进入产品 runtime |

这不是法律意见。正式发布前仍需对 lockfile 的全部 runtime transitive dependencies 生成并复核 third-party notices，且商业托管服务条款必须与开源代码许可证分开评估。

---

## 7. 开发前仍需完成的验证任务

1. **Provider qualification spike**
   - 用完全相同的 `ProviderLease` contract suite 跑 Hocuspocus 4 与 Y-Sweet；
   - 验证 create/join、initial sync、离线队列、重连、token expiry/revocation、read-only、非法 Awareness identity、oversized update、server restart、store failure；
   - 记录每个状态究竟证明 connection、ack 还是 durable commit。

2. **Electron upgrade prerequisite**
   - 把 Electron 从已 EOL 的 35 升到受支持主线；
   - 先恢复现有 build、多窗口与打包 smoke，再引入 native store。

3. **SQLite packaging and crash spike**
   - 验证 `better-sqlite3@13.0.3` 在所有正式平台/架构的 packaged app 内可加载；
   - 单 utility-process writer + 两 renderer 并发 append；
   - 在 append、snapshot、delete-old-updates 各故障点杀进程后 reopen；
   - 校验 committed update 不丢、未提交尾部不冒充成功、旧 generation 可回滚诊断。

4. **OpenSpec baseline**
   - 先用固定 `1.11.0` 严格验证当前 specs/changes；
   - 修复或归档遗留 active changes；
   - 再创建 `add-editor-authoritative-source`，通过 `--strict --no-interactive` 并取得批准。

只有前三项给出可重复证据后，才应在产品定义中写下具体 Provider、Electron store 和“保存完成”的正式支持声明。

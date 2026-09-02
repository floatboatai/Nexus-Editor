# `plugin-collab` 产品与支持基线

**状态：** implemented assessment baseline；生产 Provider/Store/File Projection 仍待资格验证
**日期：** 2026-09-03
**关联设计：** `docs/superpowers/specs/2026-09-02-plugin-collab-design.md`
**关联路线图：** `docs/ROADMAP.md` #18

本文把架构设计中的产品问题收敛为一组可执行默认决策。它定义 Nexus 仓库能承诺什么、Host 必须提供什么，以及什么证据允许使用 `production-supported`。维护者批准前，这些决策不得被实现代码倒逼成既成事实。

---

## 1. 产品边界

Nexus 交付的是可嵌入的协作编辑能力，不交付协作 SaaS 产品。

Nexus 仓库负责：

- Headless Collaboration Engine 及其 Editor Binding；
- Yjs shared schema、Undo、Presence、状态和 diagnostics；
- Provider、Replica Store、File Projection 的稳定 interface 与 contract testkit；
- Vanilla、React、Vue 的同一 Engine 使用路径；
- Electron 多窗口和文件投影的集成证明；
- 一个协议兼容的 WebSocket reference adapter 和测试服务，仅用于契约与资格验证。

Host 负责：

- 账户、邀请、成员和产品 UI；
- DocumentId 的持久化关联与协作 Enrollment；
- 认证、授权、token 签发和权限撤销；
- 生产 Provider/server、Replica Store 和文件 adapter；
- 冲突解决、恢复和危险操作确认 UI；
- 监控、容量、备份、数据保留和合规策略。

`apps/electron-demo` 只证明集成能力，不被描述成生产协作产品。

---

## 2. 支持范围

### 2.1 第一批支持声明

- `@floatboat/nexus-plugin-collab` 的默认入口必须保持 browser-safe，并只依赖 Core 和明确批准的 CRDT/protocol 依赖。
- Vanilla、React 和 Vue 必须通过同一个 Collaboration Engine interface；framework binding 不拥有协作状态。
- Chromium browser 是 headless Engine、DOM/IME 和 framework contract 的首要自动化资格环境。
- Electron 是多 renderer、主进程 broker、文件 watcher 和关闭恢复的集成资格环境。
- Firefox、Safari、Tauri 和移动 WebView 在得到各自运行证据前只能称为 `contract-compatible`，不能称为 `production-supported`。

### 2.2 支持级别

| 级别 | 含义 |
|---|---|
| `experimental` | interface 或 schema 仍可能变化，仅允许受控试用 |
| `contract-compatible` | 类型和 contract suite 通过，但没有该环境的完整故障与长期运行证据 |
| `production-supported` | 对应资格矩阵全部通过，并有真实 Provider/Store adapter 的可追溯证据 |

路线图 #18 只有在至少一个 Host 集成达到 `production-supported` 后才能标记为 `done`。

---

## 3. 文档身份与 Enrollment

1. DocumentId 是随机、不可从路径推导的 128-bit opaque identifier；默认表示形式使用标准 UUID 文本。
2. DocumentId 与现有 FileId 分离。FileId 可以帮助一个 Host 追踪重命名，但不能自动满足跨设备身份。
3. 协作按单文档显式启用。Host 必须提供 `create collaboration` 与 `join collaboration` 两个不同操作。
4. `create` 是唯一可以播种初始 Markdown 的操作；`join` 不得根据空 Y.Text、本地文件或 Editor 初值自动创建远端内容。
5. Host 持久化 `Host document identity ↔ DocumentId` 关联。具体使用数据库、sidecar 或产品 metadata 由 Host 决定，不进入 Core interface。
6. 文件 rename/move 更新 DocumentRef 的 projection location，不改变 DocumentId。
7. 删除本地文件只移除或暂停 File Projection；删除远端 Collaborative Document 是独立的授权操作。

---

## 4. Provider、认证与授权

1. CRDT 基线固定为 `yjs@13.6.32` 与 `y-protocols@1.0.7`；禁止在同一依赖图混入 Yjs 14 的 `@y/*` 包。
2. 第一种协议资格路径使用 authenticated WebSocket，并承载 Yjs sync 与 Awareness 语义。
3. Collaboration Engine 只依赖 Nexus Provider interface，不依赖服务器产品或 SDK。WebRTC 和其他 Provider 可后续实现同一 contract，但不进入第一批支持声明。
4. Hocuspocus 4.6 是第一个 production qualification candidate；Y-Sweet 0.9.1 使用同一 contract suite 作为第二个真实 adapter。两者通过资格验证前都不能写成默认生产后端。
5. `y-websocket@3.1.0` 与精确兼容的测试 server 只用于协议和本地开发，不承担生产认证、持久化或容量承诺。
6. Host 向 Provider adapter 提供短生命周期凭证；Engine、Y.Doc 和 Awareness 不持久化 access token。
7. 服务器按 DocumentId、principal 和 role 授权。第一版 role 至少包含 `reader` 与 `editor`。
8. `reader` 可以接收文档和 Presence，但服务器必须拒绝其文档 update。
9. 权限撤销必须使连接进入明确的 `authorization-revoked` 状态、停止 update、发布本地 Presence tombstone，并要求重新授权后才能连接。
10. Awareness 中的 name、avatar、color 或 client id 不构成身份或权限证明。
11. Provider 必须区分 transport connected、initial sync、local acknowledgement、durable commit、authentication 和 authorization；上游不能证明的状态不得伪造。

生产 server 的部署、账户模型和 token 签发不属于 Nexus 仓库；reference server 不能被描述为默认生产后端。

---

## 5. Replica Store 与多进程

1. 持久化是正式支持的必需能力；只有显式 `mode: "volatile"` 才允许无持久化运行，并且该模式永远不是 `production-supported`。
2. Browser adapter 使用 IndexedDB 类持久化；Electron adapter 使用 SQLite 内的 append-only update rows 与原子 snapshot compaction。
3. Electron renderer 不得并发写同一个本地 store 文件或数据库。每个 renderer 可以拥有 Replica，但 durable append、snapshot 和 compaction 通过单个 Host-owned utility-process broker 串行化。
4. 本地 update 在 durable append 成功前不得报告 `persisted`；写入失败不伪装成网络失败。
5. Store 使用 append journal + periodic snapshot/compaction。压缩必须原子替换，且不能改变用户可见版本历史。
6. 本地 Replica 不按离线时长自动丢弃。只要本地存储仍有效，用户可以继续离线编辑；清理必须由显式产品策略触发。
7. 服务端若已压缩旧 update，必须仍能通过快照或完整 state-vector 同步恢复授权客户端，不能要求客户端拥有某个未公开的 update 序列。

当前 Electron 35 已结束官方支持，且 demo 打包配置禁用了 native dependency rebuild。Provider/Persistence change 开始前必须先升级到受支持 Electron，并完成 `better-sqlite3@13.0.3` 在目标平台 packaged app 中的加载、写入、崩溃和重开 spike。验证失败时重新选择 Host adapter，不改变 Core 或 Engine interface。

---

## 6. 文件投影与外部修改

1. CRDT → Markdown atomic projection 是正式支持的基本路径。
2. 正式的本地优先 Host 必须支持基于 Projection Base 的外部 Markdown 检测；是否自动导入由 Host policy 决定。
3. 当 disk 等于 base 时，可安全导出 live；当 live 等于 base 时，可安全导入 disk；双方均变化时只能使用经过资格验证的 three-way merge。
4. 无 base、identity collision、schema mismatch 或重叠 merge 失败必须进入 File Conflict，不能 last-writer-wins。
5. 冲突期间 CRDT collaboration 可以继续，但 File Projection 必须停止覆盖磁盘并向 Host 暴露冲突材料。
6. Host 必须提供保留 live、保留 disk、人工合并或另存为的产品界面；Engine 不提供通用 UI。

---

## 7. Presence 与 shared schema

1. Presence 是非持久、可过期、可丢失的数据；文档收敛不得依赖 Presence。
2. 远端显示字段必须经过类型、长度、URL 和颜色格式清洗后才能渲染。
3. 离开文档、失焦、断开、权限撤销和 Engine close 都必须有明确 Presence 清理语义。
4. shared schema 从第一版开始带 `schemaVersion`、DocumentId 校验和 creation marker。
5. 路线图 #20 comments/@mention 不与 #18 同时实现；第一版只保留独立 shared collection 的命名空间和 migration 机制，不冻结 comments 产品 schema。

---

## 8. 安全、加密与数据保留

1. 第一批支持要求传输加密、Host 管理的本地/服务端静态加密策略，以及最小权限 token。
2. 端到端加密不是 #18 的默认承诺。若产品需要 E2EE，必须另开会改变 Provider、搜索、审计、恢复和密钥生命周期的 OpenSpec change。
3. Provider 和 Store 必须设置单条 update、单文档、Awareness payload、重连速率和内存使用上限，并返回结构化 diagnostic。
4. 日志不得记录 access token、完整 Markdown、原始 Awareness payload 或可恢复的用户内容。
5. 服务端保留策略由生产 Host 声明；Nexus contract 要求任何清理都不能让一个已被告知 `persisted` 的本地 update 静默消失。

---

## 9. 单 PR 交付边界

笔试使用一个 `add-plugin-collab` OpenSpec change 和一个最终 PR，内部按以下依赖顺序实现：Core authoritative source → Headless Engine → Yjs Binding/Undo → assessment Provider/Store → Presence → direct/framework/native lifecycle integration → Electron demo → 全量验证。

这个 PR 必须提供真实可运行、可收敛、可清理的协作能力，但发布级别只能是 `experimental`。它不实现也不宣称：生产 Provider、durable IndexedDB/SQLite Store、服务器持久化确认、文件三方协调、E2EE 或 `production-supported`。这些仍属于同一最终产品架构，而不是用临时 public interface 替代的 MVP。

---

## 10. 一次性提交 Gate

本次笔试明确要求没有中间审批、只提交一个完整最终 PR。实现开始和最终提交必须满足：

- 只使用一个 `feat/collab-realtime-editing` 分支和一个 `add-plugin-collab` change；
- proposal、design、requirements、实现、测试、demo 和文档随最终 PR 一次提交，change 保持 active，由维护者在合并后决定归档；
- implementation 严格覆盖 `tasks.md`，表格改动遵守 `AGENTS.md` 的全部交互规则；
- assessment Provider/Store 放在明确的 testkit/assessment export，默认 package entry 保持 browser-safe；
- PR 只能声明 `experimental`，并明确列出未完成的生产资格项；
- 固定版本 OpenSpec strict、typecheck、API、测试、构建、Electron smoke 和 final diff audit 全部通过；人工表格路径必须尝试并按实际能力记录 `PASS`、`FAIL` 或 `SKIP`，不得用自动化结果冒充人工证据；
- 本笔试明确要求使用 AI，且评估方明确指示本次提交不适用仓库中“拒绝主要由 AI 生成的功能代码”的限制；PR 仍如实披露 AI 协作范围，且不修改仓库治理文件来制造一般性豁免。

Electron 升级、`better-sqlite3` packaged-app spike、真实 Provider 账户/部署和 Host 冲突 UI 不阻塞笔试 PR，但分别是后续 durable adapter、生产 Provider 和 File Reconciliation 的硬前置条件。最终 PR 是本次 proposal 与 implementation 的共同审查面；这项考试约束不等于修改仓库常规治理。

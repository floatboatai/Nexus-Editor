# `plugin-collab` 产品与支持基线

**状态：** 本地 product-completion 路径已实现并通过最终自动化验证；`production-supported` 资格仍未完成
**日期：** 2026-09-03
**关联设计：** `docs/superpowers/specs/2026-09-02-plugin-collab-design.md`
**关联路线图：** `docs/ROADMAP.md` #18

本文把架构设计中的产品问题收敛为一组可执行默认决策。它定义当前 working tree 已实现什么、Nexus 仓库能承诺什么、生产 Host 仍必须提供什么，以及什么证据允许使用 `production-supported`。实现存在不等于产品资格成立；支持声明仍以本文和资格矩阵为准。

---

## 1. 产品边界

Nexus 交付的是可嵌入的协作编辑能力，不交付协作 SaaS 产品。

Nexus 仓库负责：

- Headless Collaboration Engine 及其 Editor Binding；
- Yjs shared schema、Undo、Presence、状态和 diagnostics；
- Provider、Replica Store、File Projection 的 browser-safe interface 与 contract testkit；
- 显式 Hocuspocus Provider、原生 IndexedDB Store 和 Host Collaboration Workflow；
- Vanilla、React、Vue 的同一 Engine 使用路径；
- Electron reference Host 的 SQLite utility broker、文件三方协调、可恢复 Enrollment 和完整 create/join/resume/leave UI；
- 一个可运行、带认证和单节点持久化的 Hocuspocus reference server，用于本地集成与资格验证。

Host 负责：

- 生产账户、组织、成员管理和通用产品 UI；
- DocumentId 的持久化关联与协作 Enrollment；
- 外部身份接入、session 生命周期、签名密钥轮换和生产权限治理；
- 生产 Provider/server、适合自身部署环境的 Store 和文件 adapter；
- TLS、监控、容量、备份恢复、数据保留、迁移和合规策略。

`apps/electron-demo` 是实际可操作的 experimental reference Host，而不是伪造状态的 demo；它仍不被描述成已获生产支持的协作产品。其 assessment lab 只是面向开发者的独立工具，不是产品入口或后端。

---

## 2. 支持范围

### 2.1 第一批支持声明

- `@floatboat/nexus-plugin-collab` 的默认入口必须保持 browser-safe，并只依赖 Core 和明确批准的 CRDT/protocol 依赖。
- Vanilla、React 和 Vue 必须通过同一个 Collaboration Engine interface；framework binding 不拥有协作状态。
- Chromium browser 是 headless Engine、DOM/IME 和 framework contract 的首要自动化资格环境。
- Electron 是多 renderer、主进程 broker、文件 watcher 和关闭恢复的集成资格环境。
- `pnpm dev:electron-demo` 默认选择 runtime Host；只有显式设置 `NEXUS_PLUGIN_PLATFORM=0` 才进入 legacy 兼容 Host，其他配置值 fail closed。
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
4. `create` 是唯一可以播种初始 Markdown 的操作；durable create 只读取旧 Store checkpoint，以空 Replica 完成 Provider authentication/initial sync，不 apply 或上传旧 cache。确认同步后的 room 仍为空后，它先按 checkpoint reset cache，再写入 schema/creation marker/正文并 flush 本地 Store；认证失败或远端已存在时旧 cache 不变。`join` 不得根据暂时为空的 Y.Text、本地文件或 Editor 初值自动创建远端内容。
5. Host 持久化 `Host document identity ↔ DocumentId` 关联。具体使用数据库、sidecar 或产品 metadata 由 Host 决定，不进入 Core interface。
6. 文件 rename/move 更新 DocumentRef 的 projection location，不改变 DocumentId。
7. 删除本地文件只移除或暂停 File Projection；删除远端 Collaborative Document 是独立的授权操作。
8. Electron reference Host 的 Enrollment state 使用 version 4 envelope，分别保存 active enrollments、non-secret pending creation intents、exact-record identity deletion tombstones、path deletion reservations，以及精确绑定 VaultId/sender/session/operationId/path/FileId/DocumentId 的 non-secret pending invitation joins；旧 version 1/2/3 state 兼容读取，并在后续写入时自然规范化到 v4。
9. `create` 在任何远端副作用前先以 revision-checked CAS 持久化 pending intent。保存结果不明确时必须 read back，仅在同一幂等 mutation 已经可见时视为成功；active Enrollment 也以相同方式从 pending intent 提交。
10. 如果远端创建已经打开、但 active Enrollment 未提交，pending intent 不得丢失。进程内可复用仍持有的 session 重试；重启后必须重新提供 owner credential，以 `projectionMode="enroll"` 恢复已有远端文档，只有明确得到 `document-not-found` 才重新执行 create。
11. 用户可以显式 abandon pending creation recovery；该动作只在 best-effort 关闭本地 session/backend 后删除本地 intent，不代表或暗示远端 Collaborative Document 已删除。
12. Enrollment 的 `FileId` 与 path 在一个 Vault metadata scope 内唯一；远端身份按 `(canonical ServerUrl, DocumentId)` 唯一，而不是把不同服务器上的相同 DocumentId 错判为同一文档。

---

## 4. Provider、认证与授权

1. CRDT 基线固定为 `yjs@13.6.32` 与 `y-protocols@1.0.7`；禁止在同一依赖图混入 Yjs 14 的 `@y/*` 包。
2. 第一种协议资格路径使用 authenticated WebSocket，并承载 Yjs sync 与 Awareness 语义。
3. Collaboration Engine 只依赖 Nexus Provider interface，不依赖服务器产品或 SDK。WebRTC 和其他 Provider 可后续实现同一 contract，但不进入第一批支持声明。
4. 当前显式入口 `@floatboat/nexus-plugin-collab/hocuspocus` 已实现 Hocuspocus 4.6 adapter；`apps/collab-server` 提供匹配的 authenticated reference server。Y-Sweet、WebRTC 或其他实现只是未来可选 adapter，不属于当前支持声明。
5. 默认 `@floatboat/nexus-plugin-collab` 入口不导入 Hocuspocus、Node.js、Electron 或 server 代码；网络和存储 adapter 通过显式 browser-safe entry 选择。
6. Host 向 Provider adapter 提供短生命周期、DocumentId-scoped 凭证；Engine、Y.Doc、Awareness、Markdown、URL 和 renderer storage 都不持久化 access token。reference Host 只通过显式复制/粘贴接收或交付包含 token 的 invitation envelope；会话使用的 active credential 只保留在内存 capability 中。
7. 服务器按 DocumentId、principal 和 role 授权。第一版 role 至少包含 `reader` 与 `editor`。
8. `reader` 可以接收文档和 Presence，但服务器必须拒绝其文档 update；Workflow 还必须把 role 传给 Binding，使 Provider 离线或暂时 `local-only` 时，Core 权威事务同样拒绝 reader 的 Local Proposal。Undo/Redo 必须复用同一个 lifecycle、Binding role 和实时 Provider access 门禁，权限降级后不调用 Y.UndoManager、不产生 update。远端 Authoritative Update 不受该本地写门禁影响。
9. 认证拒绝、过期与主动撤销必须分别进入 `authentication="denied"`、`authentication="expired"` 与 `authentication="revoked"`，并使用稳定 diagnostics `authentication-denied`、`authentication-expired`、`authorization-revoked`。三者都停止 update、发布本地 Presence tombstone、令 access 变为 `none`，并要求重新授权；普通网络断开仍只是 transport 状态，不能伪造认证结论。
10. Awareness 中的 name、avatar、color 或 client id 不构成身份或权限证明。
11. Provider 必须区分 transport connected、initial sync、local acknowledgement、durable commit、authentication 和 authorization；上游不能证明的状态不得伪造。
12. 产品连接 URL 只接受任意 `wss:` 或 loopback `ws:`；URL credentials、query 和 fragment 一律拒绝，非 loopback 明文 WebSocket 不能通过产品配置进入 Provider。
13. trusted-host CLI 默认签发 3600 秒 session credential；Electron reference Host 默认请求 300 秒 invitation credential。服务端仍严格拒绝任何到期时间晚于 delegator 的子 credential；客户端只识别严格限长、精确 JSON 的公开错误码，并以不回显 token/响应正文的 reauthenticate 提示处理剩余时长不足。
14. 有效本地 Replica 只能为已知 Enrollment 的 `resume` 提供离线内容权威，不能为新 `join` 提供授权证明。`Workflow.join()` 的 strict open 只读取 Store checkpoint，不把旧 update 放入待同步 Replica；它以空 Replica 完成 authenticated initial sync，验证远端 schema 后用完整远端 snapshot 原子替换并 flush 旧 Store，才允许建立 File Projection、Enrollment 或 Editor Binding。这样 reader/editor invitation 都不能借 SyncStep2 上传旧缓存。无效、wrong-document、过期或撤销 invitation 不改写旧 Store；由 local-first 或 `create()` 建立的现存 Registry Replica 也不能原地升级，返回稳定的 `remote-authority-unavailable` 且不关闭其现有 owner。

reference server 提供本地资格需要的认证、reader/editor、撤销、持久化、health/readiness 和输入上限，但保持单节点边界。生产部署、TLS、外部账户模型、密钥轮换、数据库迁移、备份、监控、横向扩展和 SLO 不属于它的支持声明。

---

## 5. Replica Store 与多进程

1. 持久化是正式支持的必需能力；只有显式 `mode: "volatile"` 才允许无持久化运行，并且该模式永远不是 `production-supported`。
2. Browser adapter 已通过显式入口 `@floatboat/nexus-plugin-collab/indexeddb` 使用原生 IndexedDB；Electron adapter 已使用内置 `node:sqlite` 的 append-only update rows 与 checkpoint-bound 原子 snapshot compaction。
3. Electron renderer 不得并发写同一个本地 store 文件或数据库。每个 renderer 可以拥有 Replica，但 durable append、snapshot 和 compaction 通过单个 Host-owned utility-process broker 串行化。
4. 本地 update 在 durable append 成功前不得报告 `persisted`；写入失败不伪装成网络失败。
5. Store 使用 append journal + periodic snapshot/compaction。压缩必须原子替换，且不能改变用户可见版本历史。
6. 本地 Replica 不按离线时长自动丢弃。只要本地存储仍有效，用户可以继续离线编辑；清理必须由显式产品策略触发。
7. 服务端若已压缩旧 update，必须仍能通过快照或完整 state-vector 同步恢复授权客户端，不能要求客户端拥有某个未公开的 update 序列。
8. Electron Host 在共享 SQLite Store 上使用 `(canonical ServerUrl, DocumentId)` 的版本化 SHA-256 派生键。该键有界且不泄露 server/document 明文；不同服务器复用相同 DocumentId 时不能读到同一 journal。
9. 旧实现使用 bare DocumentId 的本地 Replica row 无法证明来自哪个服务器，因此默认 quarantine，不自动迁移到任意 ServerUrl。若未来 Host 掌握可信来源，只能通过显式迁移工具处理。
10. Store append 失败可能是未提交，也可能是已提交但应答丢失。用户触发 `retryPersistence` 后，Engine 等待旧队列、重新 load 并幂等应用持久更新，再用完整 live Replica snapshot 通过 Store checkpoint 原子替换和 flush；只有全部成功才从 `failed` 恢复为 `clean`。

Electron 持久化使用运行时内置 `node:sqlite`，并以 Node >=22.5/Electron 实际 capability check 为准；不引入需要 native rebuild 的 `better-sqlite3`。当前 utility-process/MessagePort broker、超时、重连和 graceful shutdown 已实现并有组件级证据；packaged app、真实并发 renderer、renderer/utility 强杀和目标平台恢复仍须完成资格验证。能力缺失时明确报告 unsupported/failed 并重新选择 Host adapter，不改变 Core 或 Engine interface。

---

## 6. 文件投影与外部修改

1. CRDT → Markdown atomic projection 是正式支持的基本路径。
2. 正式的本地优先 Host 必须支持基于 Projection Base 的外部 Markdown 检测；是否自动导入由 Host policy 决定。
3. 当 disk 等于 base 时，可安全导出 live；当 live 等于 base 时，可安全导入 disk；双方均变化时只能使用经过资格验证的 three-way merge。
4. 无 base、identity collision、schema mismatch 或重叠 merge 失败必须进入 File Conflict，不能 last-writer-wins。
5. 冲突期间 CRDT collaboration 可以继续，但 File Projection 必须停止覆盖磁盘并向 Host 暴露冲突材料。
6. Host 必须提供保留 live、保留 disk、人工合并或另存为的产品界面；Engine 不提供通用 UI。
7. Electron Host 使用一条共享的 document-context transaction，把协作 create/join/resume/pending recovery 与 open file、open Vault、Save、Save As、rename、delete 串行化；在持锁期间重新读取并校验 path、Editor identity、Markdown 与 generation，过期的 panel capture 必须 fail closed。Save 捕获的 path、内容或 generation 已经过期时，即使旧写入成功也不能清除当前 Editor 的 dirty。
8. matching pending creation 存在时 delete 被拒绝，用户必须先 recover 或 explicit abandon；不能删除唯一的本地恢复线索后继续假装 create 没发生。
9. rename 的文件系统动作与 collaboration path/Enrollment 更新作为一个可补偿流程处理。如果后置协作协调失败，Vault 先尝试把文件 rename 回原路径，再回调协调元数据；任何未完成的 rollback 都作为聚合错误暴露。
10. conflict resolution 同时校验用户看到的 live Collaborative Document revision 与 incoming disk version；任一侧已经变化都返回 `stale-conflict` 并刷新冲突材料，禁止陈旧 UI 选择覆盖新内容。
11. Projection metadata 使用跨窗口 revision CAS；冲突重载时重新验证 FileId、DocumentId 和 path。另一个窗口已经完成同一 rename 时可幂等接受，已移动到其他路径时 fail closed，不能被旧窗口回滚。
12. metadata envelope、canonical identity 和 Projection Base content hash 在读取时 fail closed；reference Host 最多接受 10,000 个 metadata identities，达到容量时拒绝新 identity 且不写坏现有 state。
13. watcher 将目录 rename/delete 映射到 descendant Markdown identity，并串行处理连续事件；attach/move 与 close 并发时不能留下 replacement watcher 或复活 closed projection。
14. `subscribeMarkdown()` 在订阅时立即回放 current snapshot；File Projection 必须先建立相同的 observed baseline，并去重 revision+Markdown 完全一致的首次回放，不能在启动时制造一次虚假 dirty 或额外 metadata CAS。
15. forget 与 pending-creation abandon 必须读取并验证 exact Projection Base identity/revision，再以 CAS 删除；删除失败时恢复刚删除的 Enrollment 或 pending-create intent，并保留可恢复状态。pending-join abandon 不删除 Projection metadata、更不改写 Markdown；只要该 FileId 下存在任何 Projection metadata 就必须拒绝 abandon，先恢复为 exact Enrollment，再走普通 forget。当前 Workspace 正在 active、opening 或 closing 时不接受 forget。
16. path deletion reservation 必须同时建立 main-process same-Vault mutation fence：reserve 等待已获 permit 的 projection write，随后跨 renderer/session 阻止所有重叠 Host 写、建目录、rename 和新 projection permit；trash 只有携带 exact operationId 才能通过。session close 不释放 fence，新的产品实例从 durable reservation 重建，显式 recovery 同时释放两层。
17. Electron projection write 的 Host permit 不能替代 durable authority。adapter 在 permit 持有期间重读 exact Projection Base 与 Enrollment/pending identity；reservation、tombstone、identity 缺失或 mismatch 均在 I/O 前 fail closed，所以 stale session 在 delete/release 或 main restart 后也不能复活路径。permit 有界超时只解除遗弃 lane，已经进入 filesystem call 的写入先完成。
18. Delete 使用 Host-first 两阶段 fence：先以预生成 operationId 安装可枚举 `precommit`，再写 durable reservation，exact read-back 后 promote 为 `committed`。两态都跨 renderer close 保持 fail closed；Host-only precommit 由面板显式 abort，durable reservation 则由新产品实例重建/promote。Invitation join 也采用 Host-first 协议：先建立 exact `precommit`，再写 v4 durable pending join，随后 promote 为 `committed`；只有 committed opening 才能授权 Projection。竞争 join、普通写和 delete 均被拒绝。capability 超时或 renderer/session crash 只撤销持有者，不删除 blocking fence；原 owner identity 保留供另一个 renderer 精确 rebind，Host restart 则从 durable pending join 重建。Enrollment CAS 与 pending phase=`enrollment-committed` 同一原子 mutation，之后必须成功 release Host fence 才能清 pending 并报告 active。
19. pending join 重启恢复只接受可证明证据：exact active Enrollment 可完成 release；exact Projection metadata（包括文件已写但 Base 尚未确认的 `base:null`）可在不改文件的前提下提交 Enrollment；identity mismatch 保持 blocked；没有 metadata 时不能推断“文件未写”，必须保留 pending/fence。当前 renderer 自己持有的 exact active opening 进入同一证据判断，不误报成其他活跃窗口。面板显示恢复结果，可重试安全恢复；无 metadata 时可重新粘贴同一 invitation 或在明确警告后 abandon，有 metadata 时禁止 abandon。abandon 或 pre-projection rollback 已 release Host、但 durable intent 删除失败时，返回失败前重建并 commit exact fence；Enrollment CAS 后若 release 成功而 pending cleanup 失败，则 atomic active Enrollment 与 committed pending 继续阻断竞争 lifecycle，后续 recovery 只补 cleanup、不重写文件。

当前 File Projection controller 和 Electron reference Host 已实现 enrollment、原子乐观写、self-write echo 抑制、三方协调、generation-checked 冲突解决、共享 document-context transaction、pending create/join delete guard、same-Vault Host fence、durable projection identity guard、pending-join crash recovery UI、rename compensation、delete/I/O failure 和重启恢复路径。这说明产品语义已落地，但不替代目标平台 watcher、真实 renderer 强杀与真实外部编辑器的 packaged-app 资格。

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
6. Binding detach、Document/Workflow/Workspace close、pending recovery cleanup 和 Electron product destroy 必须幂等并 best-effort 尝试全部 owned resources；多个 cleanup failure 使用 `AggregateError` 聚合，不能因第一个失败跳过后续释放。initialize/opening 失败时，顶层必须保留原稳定 Collaboration error code，cleanup failure 仅作为可检查的 aggregate cause，不能掩盖主失败。

---

## 9. 单 PR 交付边界

当前 working tree 已在同一个 `add-plugin-collab` OpenSpec change 中完成既有 Core/Engine 基线、authenticated Hocuspocus Provider/reference server、IndexedDB/Electron SQLite durability、File Projection/reconciliation 和 Host Collaboration Workspace/product UI。Electron 的 File 菜单提供 **New Collaboration Window**（`CmdOrCtrl+Shift+N`），会创建另一个 runtime BrowserWindow，因此第二个真实产品窗口不是只能由 smoke harness 构造的隐藏路径。

Electron startup smoke 会真实启动构建后的 main process、sandboxed preload 和安全来源 `nexus-app://editor/` renderer，并分别验证默认 runtime 与显式 legacy 的产品 DOM 和最小 bridge surface。它防止 preload bundling 回归重新造成空白客户端，但不能替代 packaged app、两个真实 renderer 的完整协作 workflow 或 renderer/utility 强杀资格。

本轮不再以 assessment demo 作为完成标准；本地组合测试使用真实联网、授权、重启恢复、SQLite 持久化和 Markdown 文件协调。剩余工作是 packaged 多 renderer/crash、目标平台、真实磁盘与 watcher 故障、外部 TLS/身份/运维、安全审查、性能 trace 和长期 soak 资格。reference deployment 的完成不等于已经取得外部托管服务 SLO、独立安全审计或多区域灾备证据。

---

## 10. 一次性提交 Gate

本次笔试明确要求没有中间审批、只提交一个完整最终 PR。实现开始和最终提交必须满足：

- 最终提交使用用户指定的 `feat/collab-product-completion` 分支和既有 `add-plugin-collab` change；旧 PR #296 已由用户关闭，远程分支已删除，不再作为最终交付；
- proposal、design、requirements、实现、测试、demo 和文档随最终 PR 一次提交，change 保持 active，由维护者在合并后决定归档；
- implementation 严格覆盖 `tasks.md`，表格改动遵守 `AGENTS.md` 的全部交互规则；
- assessment Provider/Store 放在明确的 testkit/assessment export，默认 package entry 保持 browser-safe；
- PR 只能声明 `experimental`，并明确列出未完成的生产资格项；
- 固定版本 OpenSpec strict、typecheck、API、测试、构建、Electron smoke 和 final diff audit 全部通过；人工表格路径必须尝试并按实际能力记录 `PASS`、`FAIL` 或 `SKIP`，不得用自动化结果冒充人工证据；
- 本笔试明确要求使用 AI，且评估方明确指示本次提交不适用仓库中“拒绝主要由 AI 生成的功能代码”的限制；PR 仍如实披露 AI 协作范围，且不修改仓库治理文件来制造一般性豁免。

旧 PR #296 已由用户关闭，远程分支已删除。封板前的本地验收阶段没有提交或推送；验收后用户已明确授权改名后的 `feat/collab-product-completion` 创建唯一最终 PR。这一授权不包含自动合并、发布版本或 OpenSpec 归档；历史验收记录保持原始状态，不倒填提交证据。

## 11. 2026-09-04 可信桌面网络边界

Host 在创建窗口前读取 `NEXUS_COLLAB_SERVERS`（逗号分隔，最多 16 个精确 WS/WSS endpoint）。默认只信任 `ws://127.0.0.1:1234`，远程地址必须使用 WSS；邀请和面板输入不能扩张 allowlist。相同 canonical policy 驱动 CSP、Provider admission 和 Main invitation broker。修改配置后必须重启。

构建后的页面使用标准安全 scheme `nexus-app://editor/`，受静态目录 realpath confinement 保护；开发模式保留已验证的 loopback HTTP 页面并注入相同 CSP。只允许配置的 WebSocket 来源，不打开任意 `connect-src *`，不关闭 webSecurity 或证书验证。Main 仅向已信任 endpoint 对应的固定 `/v1/invitations` 发送限时、限量、禁止重定向的鉴权请求，并验证返回的 document/user/role/expiry；它不向 renderer 暴露通用 fetch、签名密钥或 SQL。服务端不需要为 Electron 放行 `Origin: null`。

迁移安全 origin 不改变 Vault、Enrollment 或 SQLite 存放位置，也不删除旧数据。旧 `file://` 来源下的演示外观设置不会自动迁移，升级后可在 Settings 重新设置；开发模式来源未改变。

自托管参考部署以单节点 systemd + TLS reverse proxy 为边界，包含受限服务用户、稳定签名凭证、持久目录和运行手册。模板存在或本地 TLS fixture 通过，不等于公共域名、跨机器链路、生产备份恢复和 SLO 已验证。

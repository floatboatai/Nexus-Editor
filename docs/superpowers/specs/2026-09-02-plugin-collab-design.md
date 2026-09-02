# `plugin-collab` 真实需求架构设计

**文档状态：** implemented for experimental assessment；OpenSpec change 保持 active，生产资格未完成
**日期：** 2026-09-02；2026-09-03 按产品决策与技术调研更新
**目标能力：** `realtime-collab`
**路线图：** `docs/ROADMAP.md` #18
**影响范围：** `core`、新 `plugin-collab`、宿主适配层；复用现有 `plugin-api`/`plugin-runtime` 生命周期能力

> 本文不把“两天笔试 / 单个 PR”误写成临时 MVP 架构。长期目标仍是可在真实产品中运行的本地优先协作能力：多编辑器、多窗口、多设备、离线恢复、持久化、Presence、文件投影、外部文件修改、失败恢复和安全约束都有明确语义；笔试 PR 只对其实际完成的 `experimental` 资格负责。
>
> 本文是长期产品架构，不等于当前已经达到生产支持。仓库通常要求 OpenSpec 先审批再实现；本次笔试明确要求不进行中间审批、只提交一个最终 PR，因此该 PR 同时承载 proposal 和 implementation review。这个交付约束不改写仓库治理，也不能把 assessment adapter 描述成生产后端。

配套文档：

- 产品与支持基线：`docs/superpowers/specs/2026-09-03-plugin-collab-product-decisions.md`
- 资格验证矩阵：`docs/superpowers/specs/2026-09-03-plugin-collab-qualification.md`
- 技术选型证据：`docs/superpowers/research/2026-09-02-plugin-collab-stack-decisions.md`
- 单一笔试变更：`openspec/changes/add-plugin-collab/`

---

## 1. 执行结论

实时协作不应继续建模成 `NexusPlugin & CollabSession` 的一次性对象，也不应由一个自研 `send()/onMessage()` 传输接口承担 Provider 协议、重连和同步状态。

本设计采用以下核心决策：

1. **Engine-first。** `plugin-collab` 的主 seam 是宿主无关的 `CollaborationEngine`；Vanilla、React、Vue 和使用 plugin-runtime 的宿主共享同一实现。
2. **稳定文档身份。** 协作房间使用与路径无关的 `DocumentId`；文件路径只是当前 Markdown 投影位置。
3. **CRDT 是协作期权威状态。** `Y.Doc/Y.Text` 是 Collaborative Document 的权威状态；EditorState 和磁盘 Markdown 都是投影。
4. **Nexus 原生绑定。** 不把 `y-codemirror.next` 的完整同步插件当黑盒。`plugin-collab` 使用 Yjs 数据结构，并通过 Nexus 新增的 authoritative transaction seam 与编辑器事务管线集成。
5. **Provider、Replica Store、文件 I/O 是三个不同 seam。** 网络同步、CRDT 本地持久化、Markdown 文件投影分别由独立 adapter 提供，不能相互冒充。
6. **外部文件修改需要三方协调。** `base + live CRDT + incoming disk` 才能判断是否安全应用；公共前后缀 diff 不是通用合并算法。
7. **Presence 是非持久、非权威数据。** 它有单独协议、节流、过期和输入清洗规则，不能与文档同步状态混为一谈。
8. **Native plugin 是 adapter。** `CollaborationLifecyclePlugin` 只把 `EditorHostService` 的 attached/detached/contextChanged 生命周期适配到 Engine，不承载第二份协作逻辑。
9. **失败必须显式降级。** divergence、持久化失败、文件冲突和 provider 错误分别进入可观察状态；禁止继续以 `connected` 或 `synced` 掩盖不一致。

最终模块形状：

```text
CollaborationEngine（headless deep module）
├── DocumentRegistry
│   └── DocumentId → CollaborativeReplica
│       ├── Y.Doc / Y.Text
│       ├── ProviderLease
│       ├── ReplicaStore journal
│       ├── Awareness / PresenceManager
│       └── ProjectionBase
├── EditorBindingRegistry
│   └── EditorId → CollaborativeReplica
├── FileProjectionCoordinator
│   ├── CRDT → Markdown atomic projection
│   └── external Markdown → three-way reconciliation
├── Diagnostics / state publication
└── Optional lifecycle adapters
    ├── direct EditorAPI / React onReady / Vue mounted
    └── CollaborationLifecyclePlugin (EditorHostService)
```

---

## 2. 产品前提与范围

### 2.1 产品前提

本设计假定宿主是本地优先 Markdown 产品，并满足以下场景：

- 同一文档可能同时在多个 EditorView、窗口、renderer 进程或设备中打开；
- 网络可以中断，用户离线期间仍能编辑；
- 进程可能在本地更新尚未上传时崩溃；
- Markdown 文件仍是用户可访问、可被 Git、脚本或外部编辑器修改的资产；
- 宿主可能使用 WebSocket、WebRTC、Electron IPC 或自有同步后端；
- 身份、认证、房间授权和产品 UI 由宿主提供；
- Nexus 仓库继续保持 headless，不捆绑某个商业厂商 SDK 或账户系统。

如果某个宿主禁止外部文件写入，可以关闭 File Projection 的反向导入，但不能改变 Collaborative Document 的基本权威模型。

### 2.2 Goals

- 多客户端对同一 Markdown 文档的字符级并发编辑最终收敛；
- 同一 CollaborationEngine interface 可被 Vanilla、React、Vue 和 plugin-runtime 宿主使用；
- 离线编辑、重连、重复 update、乱序传输和进程重启后可恢复；
- 多个编辑器可以绑定同一 Collaborative Replica，且不会各自创建冲突的本地文档；
- 本地事务先经过 Nexus filters，最终接受的变更才进入 Yjs；
- 已进入 Yjs 的权威更新能够无损投影到所有 EditorBinding；
- 每个本地 EditorBinding 拥有只撤销自己操作的 Undo/Redo；
- Presence、同步、传输、持久化、文件投影和一致性状态分别可观察；
- Markdown 文件可以由 CRDT 安全导出；外部修改通过三方协调导入；
- 文件重命名不改变协作文档身份；
- 所有资源均有明确 owner、幂等释放顺序和故障诊断；
- 为后续 shared comments / @mention 保留稳定的相对位置和共享元数据空间。

### 2.3 Non-Goals

- 不在 Nexus 仓库提供账户、邀请、计费、分享对话框或协作成员管理 UI；
- 不捆绑某个商业同步厂商 SDK；
- 不宣称任意 `send(Uint8Array)` 实现自动成为 Yjs Provider；
- 不把 CRDT 持久化等同于用户可见的版本历史；路线图 #19 仍是独立能力；
- 不把 external Markdown conflict 描述成“CRDT 自动解决”；
- 不兼容未经宿主授权的任意远端内容；认证与 update 接入策略属于 Provider seam；
- 不要求使用协作能力的宿主必须安装完整 plugin-runtime；
- 不承诺在第一份实现变更中同时完成所有产品 UI，但完整需求的状态与错误必须可供 UI 消费。

---

## 3. 待批准的领域语言

这些词汇在设计批准后再写入项目 `CONTEXT.md`。在此之前，它们是设计中的规范候选词。

**Collaborative Document**
由稳定 `DocumentId` 标识、以 Yjs 共享类型表示的协作文档。它不等同于某个文件路径或 EditorView。
_Avoid_: room file、documentKey document

**DocumentId**
跨重命名、窗口和设备保持稳定的协作文档身份。它负责同步路由和持久化索引。
_Avoid_: path、Y.Text key、room name

**DocumentRef**
`DocumentId` 与当前宿主上下文的组合，可包含当前 `sourcePath`、vault identity 和显示信息。

**Collaboration Engine**
宿主无关的协作深模块。它管理 Replica、Editor Binding、Provider、Replica Store、Presence 和 File Projection 的编排，但不拥有产品账户、服务器或 UI。
_Avoid_: native plugin runtime、collaboration product

**Collaborative Replica**
一个运行时进程内对 Collaborative Document 的本地 CRDT 副本，包含 `Y.Doc`、共享类型、持久化和 Provider lease。

**Editor Binding**
一个 Editor 实例与一个 Collaborative Replica 之间的有状态关系。它拥有本地 origin、UndoManager、Presence selection 和 editor contributions。

**Lifecycle Adapter**
把某种宿主生命周期转换为 Collaboration Engine 调用的薄 adapter。原生插件、React `onReady` 和 Vue mounted binding 都属于此角色。

**Provider**
负责远端同步握手、update 交换、重连、认证集成和网络状态的 adapter。
_Avoid_: transport（过于宽泛，不能表达 sync lifecycle）

**Replica Store**
持久化 Yjs update/snapshot/state-vector 的本地 adapter，用于离线和崩溃恢复。
_Avoid_: version history、Markdown file

**File Projection**
Collaborative Document 在磁盘上的 Markdown 表示。它是投影，不是协作期的第二个无条件权威写入者。

**Projection Base**
最后一次被双方确认的 Markdown 内容及其关联 replica revision，用于判断外部文件修改是否能安全协调。

**Local Proposal**
来自键盘、命令、Widget 或本地宿主操作、尚可被 Nexus transaction filters 拒绝或替换的编辑事务。

**Authoritative Update**
已经进入 Collaborative Replica 的 CRDT 变更。Editor Binding 必须精确投影它，不能再次进行本地语义改写。

**Presence**
短生命周期的用户状态，例如身份展示、光标和选区。它不进入文档历史，也不表示访问权限。

**Quarantine**
检测到模型分叉或无法证明一致性后，停止继续写入并等待重新同步或人工恢复的状态。

---

## 4. 现有系统约束

### 4.1 Core 是单文档编辑引擎

`packages/core` 保持路径无关、网络无关和框架无关。它负责 EditorState、AST、live preview、Widget 和事务管线，不拥有 Vault、Provider 或文件系统。

协作需要修改 core 的原因不是把网络放进 core，而是为“外部权威文档模型”提供一个不会被普通 transaction filter 破坏的 editor seam。

### 4.2 原生插件运行时是可复用的生命周期 adapter

`EditorHostService` 提供：

- editor attached / detached / contextChanged 事件；
- `EditorId`、`NexusFile`、`sourcePath`、window/view/surface context；
- owner-scoped 动态 extension registration；
- 插件卸载时的资源回收和跨编辑器管理。

这些能力非常适合实现 `CollaborationLifecyclePlugin`，但 Nexus 的公开产品面同时包含 Vanilla、React 和 Vue。协作引擎不能要求所有宿主先采用完整 plugin-runtime。

因此 `CollaborationEngine` 持有全部协作语义；`NexusPluginBase` wrapper 只负责：

- 将 editor attached/detached/contextChanged 转成 `document.attach(editor)` / `binding.detach()`；
- 从 EditorContext 取得 file/sourcePath/window 信息并调用宿主 DocumentIdentityAdapter；
- 把 Engine snapshot 暴露为 plugin capability；
- 依靠 owner-scoped lifecycle 自动关闭 Binding；只有 adapter 自己创建 Engine 时才在卸载时关闭 Engine。

Direct core、React 和 Vue 宿主通过 `EditorAPI` 调用同一个 Engine，不复制内部实现。

### 4.3 当前 transaction pipeline 会改写第三方同步事务

现有 CoreEditorTransactionPipeline 可以 reject 或 replace CodeMirror transaction。Yjs 绑定若先修改 `Y.Text`，再通过普通 `view.dispatch()` 投影到编辑器，filter 就可能留下：

```text
Y.Text = remote result
EditorState.doc = rejected/replaced result
```

这不是可通过 diagnostic 消除的风险，必须改变 seam。

### 4.4 live-preview Widget 可能持有 EditorState 之外的临时文本

表格单元格当前可以在 DOM 中编辑，到 blur 才提交 Markdown。协作状态下，远端更新可能在本地 DOM 文本尚未进入 EditorState 时到达。

真实协作模式必须满足：

> 任何可改变文档的 editor surface 都不能长期持有只存在于 DOM、无法参与 CRDT 顺序的文本。

因此 core 需要 collaborative/external-model editing facet。表格单元格在该模式下必须事务化提交输入，或在远端更新前完成可证明安全的 flush。仅依赖 `isTableEditing()` 避免 Widget 重建不足以保证文本顺序正确。

### 4.5 Governance 约束

- 新插件、core 公共 interface、安全相关行为必须先走 OpenSpec；
- 不捆绑特定商业厂商 SDK；
- Provider 与存储使用宿主 adapter；
- 依赖必须说明许可证、版本、必要性和替代成本；
- headless 包不得引入产品账户或协作 UI。

---

## 5. 权威模型与不可破坏的不变量

### 5.1 权威顺序

协作激活时：

```text
Collaborative Replica (Y.Doc/Y.Text)  — authoritative
        ↓
EditorState.doc                      — live projection
        ↓
Markdown file                        — durable human-readable projection
```

本地键盘输入先在 Editor 中成为 Local Proposal；被 filters 接受后才写入 Collaborative Replica。远端 CRDT update 已经属于 authoritative 层，不能回到 proposal 层重新解释。

### 5.2 系统一致性不变量

1. 一个运行时内，同一 `DocumentId` 最多存在一个 active Collaborative Replica。
2. 一个 Editor 同时最多绑定一个 Collaborative Replica。
3. Binding 处于 `ready` 且无 pending authoritative update 时：

   ```text
   editor.getDocument() === replica.text.toString()
   ```

4. Local Proposal 被 reject 时不得写入 Yjs。
5. Local Proposal 被 replace 时，只能把 replacement 的最终 changes 写入 Yjs。
6. Authoritative Update 不得被本地 filter reject 或 replace。
7. `online` 不等于 `synced`，`synced` 不等于 `persisted`，`persisted` 不等于 `file-projected`。
8. `DocumentId` 不随文件重命名改变。
9. Join 现有文档不得自动播种 `initialValue`。
10. 文本进入 Y.Text 前统一规范为 LF；文件导出时由 host policy 决定行尾表现。
11. Replica Store、Provider、Editor Binding 和 File Projection 必须分别报告 failure。
12. 无法证明第 3 条时必须进入 Quarantine，不能继续接受普通编辑。

---

## 6. 总体架构

```text
Host Application
│
├── DocumentIdentityAdapter ── path/vault metadata → stable DocumentRef
├── Lifecycle Adapter ──────── host/editor events → Engine open/attach/detach
├── ProviderFactory ────────── network/auth → ProviderLease ─┐
├── ReplicaStore ───────────── local durable Yjs updates ────┼─ injected dependencies
├── FileProjectionAdapter ──── read/watch/writeAtomic ───────┘
└── CollaborationEngine (headless)
    │
    ├── DocumentRegistry
    │   └── CollaborativeReplica
    │       ├── Y.Doc
    │       ├── Y.Text("content")
    │       ├── Y.Map("nexus:meta")
    │       ├── Awareness
    │       ├── ProviderLease
    │       └── ProjectionBase
    │
    ├── EditorBindingRegistry
    │   ├── Editor A ── authoritative source registration
    │   └── Editor B ── authoritative source registration
    │
    ├── FileProjectionCoordinator
    └── Collaboration state / diagnostics

Lifecycle Adapter variants
├── direct EditorAPI
├── React/Vue onReady
└── CollaborationLifecyclePlugin
```

依赖方向：

```text
core
  ↑ public editor contracts
plugin-collab engine
  ↑ optional native adapter uses public contracts
plugin-api
  ↑ hosted by the existing generic lifecycle
plugin-runtime
  ↑ identity/network/storage/file adapters
host application
```

`plugin-collab` 的 Engine 不导入 Electron、Node 文件系统、React、Vue、plugin-api、plugin-runtime implementation 或商业网络 SDK。Native lifecycle adapter 通过独立 subpath 只依赖 `plugin-api` 的公共类型和 `NexusPluginBase`。

这条依赖方向保证：

- core-only 用户不为 plugin-runtime 付出依赖和 bundle 成本；
- React/Vue 继续只是 core 的薄绑定，不需要新增协作专用 wrapper；
- native plugin 用户获得自动多编辑器生命周期；
- 所有宿主共享同一份 Replica、Binding、Undo、Presence 和恢复逻辑。

---

## 7. 进程与多窗口模型

### 7.1 一个 JS realm 内

DocumentRegistry 复用同一 `DocumentId` 的 Y.Doc。多个 EditorBinding 可以连接到同一 Collaborative Replica，但各自拥有独立 selection、Presence cursor 和 UndoManager origin。

### 7.2 Electron 多 renderer

不同 renderer 不共享 JavaScript 对象，因此不能假设全应用只有一个 Y.Doc。每个 renderer/process 拥有自己的 Collaborative Replica，通过 Provider adapter 同步。

推荐的 Electron 产品实现：

```text
Renderer A replica ─┐
Renderer B replica ─┼─ Electron IPC / local broker / remote provider
Renderer C replica ─┘
                     ↓
               durable store / server
```

Electron 的正式资格路径固定为单个 Host-owned utility-process broker 串行化 SQLite durable writes。renderer 不得直接打开同一数据库。当前 Electron 35 与 native dependency 打包配置尚不满足该路径；必须先升级 Electron，并通过目标平台 packaged-app spike。

### 7.3 多设备

每个设备有独立 Y.Doc client identity 和本地 Replica Store。Provider 负责 state-vector handshake、缺失 update 补齐和重连；CollaborationEngine 只消费稳定的 Provider lifecycle，不自行猜测网络是否已经同步。

---

## 8. 模块设计

### 8.1 CollaborationEngine

职责：

- 接收 Provider、Replica Store、File Projection 和 Presence dependencies；
- 创建并管理 DocumentRegistry、EditorBindingRegistry 和 FileProjectionCoordinator；
- 为直接 EditorAPI 调用方和生命周期 adapter 提供同一个小 interface；
- 协调 restore → provider start → attach → sync → projection 的顺序与 readiness gate；
- 关闭时先 quiesce，再按 binding → provider → store → replica 的顺序释放；
- 收集局部失败，但不因一个文档故障关闭整个 Engine；
- 向宿主/UI 发布稳定、宿主无关的 collaboration state 和 diagnostics。

它是深模块的外部 seam。调用者不直接协调 Y.Doc observer、registration.ready、Provider connect、UndoManager 或文件 watcher。Engine 不知道 editor 来自 Vanilla、React、Vue 还是 plugin-runtime。

### 8.2 DocumentRegistry

键：`DocumentId`。值：引用计数或 lease 管理的 Collaborative Replica。

职责：

- 保证单运行时单副本；
- 合并并发 `open()` 调用，共享同一个 opening Promise；
- 维护 editor binding、file projection 和 UI handle 的引用；
- 最后一个引用释放后，按策略保持 warm/offline 或关闭；
- 防止关闭中的 Replica 被重新复用；
- 为旧 handle 提供 stale-handle 错误，而不是操作新实例。

### 8.3 CollaborativeReplica

拥有：

- `Y.Doc`；
- `Y.Text("content")`；
- `Y.Map("nexus:meta")`，至少包含 schema version 和 DocumentId 校验信息；
- `Awareness`；
- ProviderLease；
- Replica Store subscription；
- 当前 Projection Base；
- 多维状态与 diagnostics。

不拥有：

- Editor 生命周期；
- 文件路径身份；
- 账户凭证；
- 产品 UI。

### 8.4 EditorBinding

每个 Binding 拥有：

- editor authoritative-source registration；
- Nexus update listener；
- 唯一 local origin token；
- 只追踪该 origin 的 `Y.UndoManager`；
- 由 authoritative-source registration 一次性安装的 external-document mode 与 history controller；
- 本地 selection → Awareness 的转换；
- 远端 Presence decorations；
- divergence guard 和关闭状态。

EditorBinding 不拥有 Y.Doc、Provider 或 Replica Store。Editor detach 只销毁该 Binding；同文档的其他 Binding 和 Replica 继续运行。

### 8.5 Provider adapter

Provider 是 true-external seam，因为生产网络实现、Electron IPC 实现和测试 fake 确实不同。首个 production qualification candidate 是 Hocuspocus 4.6，第二个真实 adapter candidate 是 Y-Sweet 0.9.1；二者都只能通过 Nexus Provider interface 接入，不能把第三方 SDK 类型暴露到 Engine 公共 API。`y-websocket@3.1.0` 与精确兼容的测试 server 只用于协议和本地开发。

```ts
export interface CollaborationProviderFactory {
  prepare(context: ProviderContext): Promise<ProviderLease>;
}

export interface ProviderContext {
  readonly document: CollabDocumentRef;
  readonly intent: "create" | "join";
  readonly doc: Y.Doc;
  readonly awareness: Awareness;
  readonly signal: AbortSignal;
}

export interface ProviderLease {
  start(): Promise<void>;
  getState(): ProviderState;
  subscribe(listener: (state: ProviderState) => void): Unsubscribe;
  requestResync?(reason: string): Promise<void>;
  release(): Promise<void>;
}
```

契约：

- `prepare()` 只分配资源，不得连接网络或修改传入的 Y.Doc；
- `start()` 只能在 schema 校验、store observer 和 Replica state 已经就绪后调用；
- `start()` resolve 只表示连接流程启动，不表示 initial sync 完成；
- ProviderState 必须分开 transport 与 sync；
- `release()` 幂等，不销毁传入的 Y.Doc/Awareness；
- Provider 负责 create/join 语义、协议握手、state vector、重连、auth integration 和 awareness wire；
- Adapter 不得把 provider 的“socket open”映射成 `synced`。

### 8.6 Replica Store adapter

Replica Store 是 local-substitutable seam。正式资格路径中，浏览器使用 IndexedDB 类 adapter，Electron 使用 utility-process broker 持有的 SQLite append journal + atomic snapshot，测试使用内存实现。Electron 驱动优先验证 `better-sqlite3@13.0.3`，但打包 spike 通过前不得加入 runtime dependency；不再把自研裸文件 journal 当默认方案。

```ts
export interface ReplicaStore {
  open(documentId: DocumentId): Promise<ReplicaStoreLease>;
}

export interface ReplicaStoreLease {
  load(): Promise<StoredReplicaState | null>;
  append(update: Uint8Array): Promise<void>;
  compact(snapshot: Uint8Array, stateVector: Uint8Array): Promise<void>;
  loadProjectionBase(): Promise<ProjectionBase | null>;
  saveProjectionBase(base: ProjectionBase): Promise<void>;
  flush(): Promise<void>;
  release(): Promise<void>;
}
```

要求：

- update append 幂等或能安全处理重复；
- snapshot + journal replacement 原子化；
- store corruption 产生明确 diagnostic，不把空文档当恢复成功；
- `persisted` 只在所有已知本地 update 完成 flush 后成立；
- compaction 不改变用户可见版本历史；
- 多进程写必须通过 adapter 自己的锁或 broker 解决。

### 8.7 FileProjectionCoordinator

文件 adapter 只做 I/O：

```ts
export interface FileProjectionAdapter {
  read(ref: CollabDocumentRef): Promise<FileSnapshot | null>;
  writeAtomic(ref: CollabDocumentRef, markdown: string): Promise<FileWriteReceipt>;
  watch(
    ref: CollabDocumentRef,
    listener: (change: ExternalFileChange) => void,
  ): Promise<AsyncDisposable>;
}
```

三方协调、Projection Base 和冲突状态属于 plugin-collab implementation，不能分散到每个 host caller。

### 8.8 PresenceManager

职责：

- 将 host 提供的可信本地身份映射到 Awareness；
- 将 Editor selection 转成 Y.RelativePosition；
- 节流 selection 更新；
- 对远端 name/color/avatar metadata 做类型、长度和格式校验；
- 处理 blur、document switch、disconnect 和 unload 的 tombstone；
- 只渲染 main selection，除非未来 spec 明确全多光标协议；
- 将 peer identity 与权限分开：Presence 展示不是授权证明。

远端样式不得直接拼接任意 Awareness 字符串到 inline CSS。颜色只接受规范化后的 allowlist 格式，名称只能作为文本节点。

### 8.9 Lifecycle adapters

Lifecycle adapter 只翻译宿主事件，不重新实现协作状态机。

**Direct EditorAPI adapter**

- Vanilla 调用方显式执行 `document.attach(editor)`；
- React 通过现有 `onReady` 取得 EditorAPI 后 attach；
- Vue 在 editor ready/mounted 后 attach；
- framework unmount 时调用 `binding.detach()`。

React/Vue 包不增加 collaboration-specific state，也不直接依赖 Yjs。

**Native plugin adapter**

`CollaborationLifecyclePlugin extends NexusPluginBase`：

- 在 `onload()` 中取得 Editor Host、DocumentIdentityAdapter 和 Engine；
- 监听 attached/detached/contextChanged；
- 使用 DocumentIdentityAdapter 把 EditorContext 解析成 DocumentRef；
- 只自动 attach 已经登记为协作文档的 DocumentRef，不根据文件内容猜测 create/join；
- 调用 Engine open/attach/detach；
- 把 Engine 作为 collaboration capability 暴露给命令和 UI 插件；
- 在 `onunload()` 中关闭 subscriptions 和 Binding；只有通过 adapter factory 创建的 Engine 才由它关闭，注入的共享 Engine 仍归宿主所有。

该 adapter 应足够薄，测试重点是事件映射和资源释放。删除 adapter 后，协作 Engine 的行为测试不应改变。

---

## 9. 对外 interface 草案

最终公开面应尽量小。复杂的 dependency interface 位于 Engine 创建 seam；产品调用方、framework adapter 和 native plugin adapter 都消费同一个 CollaborationEngine。

```ts
export interface CollaborationEngineOptions {
  readonly providers: CollaborationProviderFactory;
  readonly store: ReplicaStore | { readonly mode: "volatile" };
  readonly files?: FileProjectionAdapter;
  readonly localPresence?: LocalPresenceProvider;
  readonly diagnostics?: CollaborationDiagnosticSink;
}

export interface CollaborationEngine {
  create(
    document: CollabDocumentRef,
    options: CreateCollaborativeDocumentOptions,
  ): Promise<CollaborativeDocumentHandle>;
  open(document: CollabDocumentRef): Promise<CollaborativeDocumentHandle>;
  getSnapshot(documentId: DocumentId): CollaborativeDocumentSnapshot | undefined;
  list(): readonly CollaborativeDocumentSnapshot[];
  subscribe(listener: CollaborationListener): Unsubscribe;
  close(): Promise<void>;
}

export interface CreateCollaborativeDocumentOptions {
  readonly initialMarkdown: string;
}

export interface CollaborativeDocumentHandle {
  readonly id: DocumentId;
  whenReady(): Promise<void>;
  getMarkdown(): string | undefined;
  getState(): CollaborativeDocumentSnapshot;
  subscribe(listener: (state: CollaborativeDocumentSnapshot) => void): Unsubscribe;
  attach(
    editor: EditorAPI,
    options: EditorBindingOptions,
  ): Promise<EditorBindingHandle>;
  close(): Promise<void>;
}

export interface EditorBindingHandle {
  readonly documentId: DocumentId;
  undo(): boolean;
  redo(): boolean;
  detach(): Promise<void>;
}

export interface EditorBindingOptions {
  /**
   * `replace-editor` 显式授权 Replica 覆盖尚未交给用户编辑的 Editor；
   * `require-match` 不覆盖 Editor，内容不同即拒绝 attach。
   */
  readonly content: "replace-editor" | "require-match";
}

export function createCollaborationEngine(
  options: CollaborationEngineOptions,
): CollaborationEngine;
```

规则：

- `create()` 是唯一可写入 `initialMarkdown` 的入口，并先持久化 creation marker；
- `open()` 始终表示 join，绝不根据空 Y.Text 或磁盘内容自动播种；
- `open()` 对相同 DocumentId 幂等并共享 opening work；
- 没有有效本地 Replica 的首次 join 必须等待 Provider initial sync，不能把暂时为空的 Y.Text 当正文；
- `document.whenReady()` 在已有有效本地 Replica，或首次 initial sync 建立内容权威后 resolve；
- `document.attach()` 等待同一个 readiness gate，再原子安装 Binding 并对齐内容；
- `replace-editor` 明确授权 Engine 用当前 Replica 覆盖 Editor，只适用于 attach 前内容可丢弃的 Editor；它不是自动播种 Y.Doc；
- `require-match` 不覆盖已有 Editor 内容；不一致时返回结构化错误；
- handle 关闭后不可复用；
- Engine `close()` 幂等并关闭所有 Document/Binding；
- `store: { mode: "volatile" }` 必须显式选择，避免宿主误以为已经具备崩溃恢复；
- 调用者看不到 `encodeState()`、`applyState()`、`documentKey` 或裸 Awareness wire；
- 文件导入不通过 `loadDocument(markdown)`；由 watcher/reconciliation 或显式 host command 进入。

典型 direct-core 用法：

```ts
const engine = createCollaborationEngine({
  providers,
  store,
  files,
});

const ref = await documentIdentity.resolve(editorContext);
const document = await engine.open(ref);
const editor = createEditor({
  container,
  initialValue: "",
});
const binding = await document.attach(editor, { content: "replace-editor" });
```

宿主应在 Binding ready 前显示 loading/read-only 状态，避免空 Editor 闪烁或被用户提前编辑。React/Vue 使用已有的 editor-ready hook 取得 EditorAPI 后执行同一 `attach()`；native plugin adapter 也调用同一个方法。

---

## 10. Core 必需的新 seam

### 10.1 Authoritative transaction source

Core 增加 owner-scoped、每个 editor 独占的 authoritative source registration：

```ts
export interface EditorAuthoritativeSourceRegistration
  extends EditorContributionRegistration {
  dispatch(
    transaction: CoreEditorTransaction,
  ): CoreEditorTransactionDispatchResult;
  dispatchTransactions(
    transactions: readonly CoreEditorTransaction[],
  ): CoreEditorTransactionDispatchResult;
}

export interface EditorHistoryController {
  undo(): boolean;
  redo(): boolean;
}

export interface EditorTransactionContributionSink {
  registerAuthoritativeSource(
    ownerId: string,
    history: EditorHistoryController,
  ): EditorAuthoritativeSourceRegistration;
}
```

同时在 transaction/update context 中增加：

```ts
type EditorTransactionAuthority = "proposal" | "authoritative";

interface CoreEditorTransactionContext {
  readonly authority: EditorTransactionAuthority;
  readonly sourceOwnerId?: string;
}
```

语义：

- 普通 `view.dispatch()` 与 `EditorAPI.dispatchTransaction()` 默认是 proposal；
- proposal 经过 filters，listeners 只看到最终 commit；
- authoritative registration 的 `dispatch()` 跳过 reject/replace filters；
- authoritative commit 仍更新 AST、change events 和 update listeners；
- 同一 editor 同时只能有一个 authoritative source；
- history controller 与 external-document mode 必须和 source 同步激活，不允许第二个可失败的安装步骤；
- registration `ready` 只在 dispatch、history routing 和 external-document mode 都物理生效后 resolve；
- source disposed/editor destroyed 后 dispatch 返回结构化 rejected；
- recursion limit 和原子批处理仍然适用；
- sourceOwnerId 进入 diagnostics，不能依赖不可见的 CM annotation。

### 10.2 Nexus-native Yjs binding

不使用 `yCollab()` 直接驱动 `view.dispatch()`：

```text
Local Proposal
→ Nexus filters
→ successful CoreEditorUpdateContext
→ Y.Text transaction(localOrigin)

Remote/provider Y.Text event
→ convert Y.Text delta to CoreEditorChange[]
→ authoritativeRegistration.dispatch()
→ EditorState / AST / listeners
```

Y.Text observer忽略 `localOrigin`，Editor update listener忽略自己发出的 authoritative source，避免反馈环。

选择自有 binding 的原因：

- 能直接得到 reject/replace 的最终结果；
- 不依赖 `y-codemirror.next` 0.x 的内部 transaction annotation；
- Presence 输入清洗和多编辑器生命周期可以按 Nexus 约束实现；
- transaction pipeline、table widget 和 diagnostics 的逻辑集中在一个 module；
- 为 future shared annotations 使用同一 Y.RelativePosition 工具。

Yjs 仍是 CRDT implementation；本设计不是自研 CRDT。

### 10.3 External-document mode

Core 可以用内部 facet/effect 表达 editor 行为，但它不是调用方需要单独管理的公共开关。authoritative source registration 在 `ready` 前自动启用，在幂等 dispose 内自动关闭：

```ts
externalDocumentModelActive: Facet<boolean>
```

当 facet 为 true：

- current live-preview table 禁止 contentEditable cell 持有可变草稿；激活单元格时必须定位并显示对应 Markdown source，由普通 Core transaction 完成文本编辑；
- 已经通过 Core transaction 实现的结构命令可以继续使用；
- Authoritative Update 应用前必须取消活动中的非文本 Widget pointer gesture，释放 interaction lock，且不得提交半完成 DOM 状态；
- interaction cleanup 仍遵守现有 table editing locks；
- authoritative changes 必须通过现有 change mapping 保持 selection/decorations；
- IME 与远端 update 的顺序必须有专项测试；
- 未来 Widget 若要保留直接编辑体验，必须先具备完整 transactional editing contract；在此之前不能用 blur-commit 冒充协作安全。

### 10.4 统一 History routing

`EditorAPI.undo()/redo()`、键盘快捷键、`beforeinput(historyUndo)` 和产品按钮必须指向同一个协作安全实现。

history controller 是 `registerAuthoritativeSource(ownerId, history)` 的必填参数，不是独立 contribution。Collaborative Binding 取得 source 时同步取得所有 Undo/Redo 入口；source 激活期间，即使 controller 返回“无可撤销内容”，键盘和 browser history intent 也必须被消费，不能落到 CM history 改写投影。source dispose 后才恢复现有 CM/plugin-history 路径，且不能把外部文档模型的历史暴露给默认 history。不能只安装高优先级 keymap，同时让工具栏继续调用旧的 `editor.undo()`。

---

## 11. Shared document schema

每个 Collaborative Replica 使用固定 shared-type names：

```text
Y.Text("content")
Y.Map("nexus:meta")
```

`nexus:meta` 至少保存：

- `schemaVersion`；
- `documentId` 的校验副本；
- creation marker；
- 可选的 projection metadata revision。

未来 comments/@mention 应使用单独的共享 collection，并用 Y.RelativePosition 锚定正文，不把批注序列化进 Markdown 文本。schema migration 必须在 Provider start 前完成，并且对不支持的新版本 fail closed。

`DocumentId` 的权威来源仍由 host identity adapter 决定；Y.Map 中的值用于交叉校验，不能允许远端 update 偷换当前 room identity。

---

## 12. 生命周期与时序

### 12.1 显式创建新 Collaborative Document

只有显式 `engine.create(ref, { initialMarkdown })` 流程可以播种正文：

```text
host allocates stable DocumentId
→ acquire Replica Store lease
→ verify no existing replica/creation marker
→ create Y.Doc schema
→ insert normalized initial Markdown once
→ persist creation update + Projection Base
→ prepare Provider
→ start Provider with create intent
→ publish document as openable
```

两个普通 join client 都不得根据 `Y.Text.length === 0` 推断自己是创建者。

### 12.2 打开已有文档

```text
resolve DocumentId
→ DocumentRegistry deduplicates open
→ open Replica Store
→ load snapshot + journal into Y.Doc（若存在）
→ validate schema/document identity
→ install store append observer
→ prepare Provider without network mutation
→ create Replica state
→ start Provider with join intent
→ establish content authority from valid local Replica or initial sync
→ allow Editor attach
→ reconcile File Projection
```

已有有效本地 Replica 时，restore 后即可离线编辑；首次加入且本地没有 Replica 时，必须等 initial sync 建立内容权威。`synced` 只有在 Provider 明确完成 initial sync 后成立。

### 12.3 Editor attach

```text
resolve EditorContext → DocumentId
→ open/reuse Collaborative Replica
→ wait for content-authority readiness
→ acquire per-editor attach lock
→ register authoritative source
→ enable collaborative editing facet
→ install update listener/history/presence extensions
→ apply explicit replace-editor or require-match policy
→ verify editor text === Y.Text
→ publish binding ready
```

初始化对齐期间不运行普通 file-load filter，也不把初始投影写回 Yjs。`replace-editor` 必须在 Binding 已能接收后续远端 update 的同一临界区内完成，避免读取 Replica 与安装 observer 之间的竞态。

### 12.4 本地编辑

```text
keyboard / command / Widget
→ Local Proposal
→ Nexus filters accept/reject/replace
→ commit final editor transaction
→ binding receives final update
→ Y.Doc.transact(final changes, localOrigin)
→ Replica Store append
→ Provider distributes update
→ File Projection becomes dirty
```

### 12.5 远端 update

```text
Provider applies authenticated Yjs update
→ Replica Store append
→ Y.Text observer receives delta
→ authoritative dispatch to each EditorBinding
→ verify all ready bindings match Y.Text
→ update sync/consistency state
→ File Projection becomes dirty
```

如果任一 Binding dispatch 失败，该 Binding 进入 Quarantine；Replica 和其他 Binding 是否继续由 failure policy 决定，但不得报告全局 healthy。

### 12.6 关闭

```text
mark handle/binding quiescing
→ reject new commands
→ publish local Presence tombstone
→ detach editor contributions
→ flush Replica Store
→ stop/release Provider
→ stop file watcher
→ release store lease
→ destroy Awareness/Y.Doc
```

所有 release 幂等，并共享同一个进行中的 Promise。

---

## 13. 文件投影与外部修改

### 13.1 CRDT → Markdown

- 导出文本来自 `Y.Text("content").toString()`；
- 使用宿主 `writeAtomic()`，不能直接覆盖半写文件；
- 写入成功后保存 Projection Base：base Markdown、content hash、关联 state vector/revision、write receipt；
- watcher 使用 receipt/hash ledger 抑制自身写入回声；
- export debounce 与 Replica Store durability 分开，文件未写不影响 CRDT 已持久化状态；
- 文件写失败进入 `projection.failed`，不能回滚已经协作成功的文本。

### 13.2 外部 Markdown → CRDT

检测到非自身写入后：

```text
base      = last confirmed Projection Base markdown
live      = current Y.Text markdown
incoming  = current disk markdown
```

协调结果：

1. `incoming === base`：磁盘无有效变化，忽略；
2. `live === base`：只有磁盘变化，可 clean apply；
3. `live === incoming`：已经一致，只更新 Projection Base；
4. 三方 merge 无冲突：将 merged result 作为一个明确的 external-file origin 写入 Yjs；
5. 有冲突：不覆盖磁盘、不修改 Yjs，进入 `projection.conflicted`，向 host 提供 base/live/incoming 和结构化 conflict hunks。

用户解决冲突后，resolved text 通过多 hunk diff 写入 Yjs。diff 只负责减少变更范围；安全性来自 base-aware resolution，不来自 diff 本身。

### 13.3 重命名与删除

- rename 更新 DocumentRef/sourcePath，不改变 DocumentId；
- watcher 必须区分 rename、delete 和 replace；
- 文件删除默认只让 projection 进入 `missing`，不自动删除 Collaborative Document；
- 删除远端协作文档需要独立、显式、受授权的 product command；
- path identity adapter 必须持久化 rename 映射，不能仅依赖当前路径重算 DocumentId。

---

## 14. Undo / Redo

- 每个 EditorBinding 创建独立 local origin；
- UndoManager 只追踪该 binding origin；
- remote updates、provider restore、file reconciliation 和 schema migration 默认不进入普通用户 undo；
- 同一文档在两个本地 editor 中打开时，各自只撤销自己发出的操作；
- Undo/Redo 自身产生的 Yjs changes 正常广播并持久化；
- selection 使用 Y.RelativePosition 保存和恢复；
- core history controller 确保键盘、beforeinput、`EditorAPI.undo()` 和产品命令语义一致；
- collaboration binding ready 前不得让 CM history 接受正文编辑；解绑后是否恢复旧 history 必须通过 spec 明确，默认清空以避免跨模型撤销。

---

## 15. Presence

Presence state 建议使用：

```ts
interface CollabPresence {
  user: {
    id: string;
    name: string;
    color: string;
    avatarUrl?: string;
  };
  cursor?: {
    anchor: Y.RelativePosition;
    head: Y.RelativePosition;
  };
  activeEditorId?: string;
}
```

规则：

- `user.id` 来自 host authentication context，不接受任意 UI 输入覆盖；
- name、URL、颜色和扩展字段有长度/格式上限；
- 远端文字使用 `textContent`，颜色经过 parser/allowlist 后设置；
- selection 更新节流且可合并；
- blur 与切换文档清除 cursor；
- disconnect/close 发布 tombstone；异常断线由 Awareness timeout 移除；
- Presence 丢失不影响正文同步；
- peers 列表去重依据 authenticated identity 与 client identity 的明确组合，而不是 display name。

---

## 16. 状态模型

禁止用单一枚举组合所有状态。对外 snapshot 使用正交维度：

```ts
interface CollaborativeDocumentSnapshot {
  lifecycle: "opening" | "open" | "closing" | "closed" | "failed";
  transport: "idle" | "connecting" | "online" | "offline" | "failed";
  sync: "restoring" | "syncing" | "synced" | "stale" | "failed";
  persistence: "loading" | "clean" | "pending" | "failed";
  consistency: "healthy" | "catching-up" | "conflicted" | "quarantined";
  projection: "detached" | "clean" | "dirty" | "missing" | "conflicted" | "failed";
  peers: readonly PeerSnapshot[];
  diagnostic?: CollaborationDiagnostic;
}
```

典型组合：

- 离线可编辑：`transport=offline, sync=stale, persistence=clean, consistency=healthy`；
- 网络在线但未完成 initial sync：`transport=online, sync=syncing`；
- CRDT 已同步但磁盘写失败：`sync=synced, projection=failed`；
- 外部文件冲突：`consistency=conflicted, projection=conflicted`，网络协作仍可继续；
- editor/Y.Text 分叉：`consistency=quarantined`，对应 Binding 停止普通编辑。

---

## 17. 错误处理与恢复

### 17.1 Provider failure

- 进入 offline/failed；
- 保持本地编辑和 Replica Store append；
- 使用 Provider adapter 的 backoff/reconnect；
- 重连后必须重新完成 sync handshake；
- 不因 socket reopen 直接标记 synced。

### 17.2 Replica Store failure

- 立即报告 persistence.failed；
- 保留有界内存 pending queue；
- 超过容量或 durability policy 不允许继续时，进入只读/degraded；
- 禁止把 store load failure 当作“没有历史的空文档”；
- 可从 Provider 重新拉取后写入新的 store generation，但必须保留原损坏数据用于恢复诊断。

### 17.3 Binding divergence

- 停止该 Binding 的 local proposals；
- 进入 Quarantine；
- 记录 documentId、editorId、state vector/hash 和 origin，不记录正文；
- 尝试从当前 Y.Text 做一次受控 authoritative rebuild；
- rebuild 后再次校验；仍失败则 detach Binding 并要求用户重新打开 editor；
- 不回滚 Y.Doc 迎合一个错误的 EditorState。

### 17.4 File conflict

- 停止自动覆盖该文件；
- 保持 CRDT 协作与本地持久化；
- 将结构化 conflict 交给 host UI；
- 解决动作必须显式记录选择：keep live、accept incoming 或 merged；
- 解决后产生新的 Projection Base。

### 17.5 Unsupported schema

- 在 Provider start 前 fail；
- 不自动降级或丢弃未知 shared types；
- diagnostic 提供 local/remote schema version；
- migration 必须是独立、可重放、可测试的步骤。

---

## 18. 安全与资源限制

- Provider adapter 必须在 update 进入 Y.Doc 前完成房间授权；
- WebSocket/WebRTC/IPC adapter 必须限制单条消息、单位时间 update 和 Awareness payload 大小；
- Yjs update decode/apply 异常进入 provider/consistency failure，不能崩溃整个 runtime；
- Presence 不被视为可信授权信息；
- diagnostics 不记录正文、token 或完整用户私有路径；
- DocumentId 和 room routing 不能从未验证的 Awareness 字段推导；
- avatar URL、display name、color 等远端字段必须清洗；
- Provider credentials 由 host secrets/network capability 管理，不存入 Y.Doc；
- 长时间离线、update journal 和 Awareness peers 必须有资源上限；
- compaction 与 GC 策略必须经过离线恢复测试，不能只以当前内存占用为依据；
- 插件卸载后 observer、timer、window listener、provider connection 和 store lease 必须为零。

---

## 19. 依赖决策

### 19.1 固定 Yjs 13 兼容线

首版固定 `yjs@13.6.32` 与 `y-protocols@1.0.7`。禁止在同一依赖图混入 Yjs 14 的 `@y/*` 包。理由：成熟的 update/state-vector/relative-position/UndoManager 语义、纯 JavaScript、MIT、适合文本 CRDT，并且该组合具有明确的 peer compatibility。

### 19.2 不把 `y-codemirror.next` 作为同步核心

真实需求需要 Nexus transaction authority、Widget transactional mode、结构化 diagnostics 和安全 Presence renderer。直接使用 `yCollab()` 会把远端 update 通过普通 CodeMirror dispatch 注入，无法兑现上述不变量。

因此决定：

- `yjs@13.6.32`：peer dependency + development dependency，确保 host/provider/runtime 使用同一实例；
- `y-protocols@1.0.7`：direct dependency，用于 Awareness 类型和协议 adapter；
- `y-codemirror.next`：不作为 production binding 依赖；可仅作为行为参考或 spike 对照，不复制其源码；
- diff/three-way merge 库：在 File Reconciliation OpenSpec 中单独评估许可证、维护状态和 Markdown 语义，不能先锁定。

Provider 与 Store 的候选、版本、许可和打包风险记录在配套技术调研中。所有版本、bundle、许可证和上游支持状态在对应 OpenSpec/PR 时重新核验；设计快照不替代实施时验证。

---

## 20. 包与代码归属

建议结构：

```text
packages/core/
  authoritative transaction source
  source-owned history routing
  internal external-document mode
  table/widget external-authority safety

packages/plugin-api/
  reuse NexusPluginBase, EditorHostService and defineCapabilityToken
  no collaboration state machine or Yjs types

packages/plugin-runtime/
  reuse existing capability registry and owner-scoped lifecycle
  no collaboration-specific orchestration or Yjs implementation

packages/plugin-collab/
  engine.ts
  document-registry.ts
  collaborative-replica.ts
  editor-binding.ts
  provider.ts
  replica-store.ts
  file-projection.ts
  reconciliation.ts
  presence.ts
  schema.ts
  state.ts
  diagnostics.ts
  testkit/
  native-plugin/
    lifecycle-plugin.ts
    capability.ts
    index.ts

host application / separate host adapter package
  DocumentIdentityAdapter
  collaboration enrollment policy
  production ProviderFactory
  ReplicaStore implementation
  FileProjectionAdapter
  auth and conflict UI
```

`plugin-collab` 默认入口只导出 headless Engine；native plugin adapter 通过独立 subpath 导出，避免 direct-core/React/Vue 调用方引入插件运行时依赖。除非实现时发现现有通用 lifecycle/capability contract 确有缺口，否则不修改 `plugin-api` 或 `plugin-runtime`。

`apps/electron-demo` 只能演示 headless capability，不承担账户、邀请或生产服务器。真实产品 adapter 可以在产品仓库实现；Nexus 仓库使用 contract testkit 验证其契约。

---

## 21. 测试与资格门槛

### 21.1 Core contract

- proposal reject 不写入 Yjs；
- proposal replace 只写最终 changes；
- authoritative dispatch 跳过 filters 但通知 listeners；
- source registration 独占、owner-scoped、可释放；
- recursive dispatch 达到上限时产生结构化失败；
- history controller 所有入口一致；
- collaborative table cell 不保留仅存在 DOM 的文本；
- IME、selection、multi-cursor 和 live-preview 在 authoritative changes 下保持正确。

### 21.2 CRDT convergence

- 2、3、N peer 并发插入/删除；
- update 重复、乱序、分批、延迟；
- 长时间离线后重连；
- provider 重连和完整 resync；
- local undo 不撤 remote；
- 两个本地 editor 绑定同一 Replica；
- 多 renderer 使用独立 Replica 后收敛；
- schema mismatch fail closed。

建议加入 property-based operation sequence，对最终 Y.Text 和所有 ready editor 做一致性断言。

### 21.3 Persistence and crash recovery

- snapshot + journal restore；
- append 中途崩溃；
- compaction 中途崩溃；
- 重复 update；
- store corruption；
- flush failure 与内存 pending 上限；
- 多进程 adapter contract。

### 21.4 File projection

- self-write echo；
- external-only edit；
- live-only edit；
- clean three-way merge；
- overlapping conflict；
- rename、delete、replace；
- CRLF/LF；
- atomic write failure；
- conflict resolution 后重新建立 Projection Base。

### 21.5 Presence and security

- heartbeat/tombstone/timeout；
- focus/blur/document switch；
- 恶意 name/color/avatar payload；
- oversized Awareness/update；
- auth revoked；
- unauthorized room；
- unload 后 listener/connection 泄漏检查。

### 21.6 性能与长期运行

- 大 Markdown 文档的本地输入延迟；
- 大 update 和 initial restore；
- 多 peer remote decoration；
- journal 增长和 compaction；
- 8 小时以上 churn/attach/detach soak；
- 无编辑时零轮询或有界心跳；
- 内存基线与关闭后回收。

具体预算需要先建立当前 core benchmark，不在设计阶段发明数字。

---

## 22. 单 PR 笔试交付顺序

笔试只允许一个最终 PR，因此使用一个 `add-plugin-collab` change 和一条功能分支，但实现仍按依赖顺序组织为可审查 commit：

1. **OpenSpec 与红测：** 冻结本 PR 的 interface、非目标、支持级别和失败 contract；先写 Core authority、收敛、History、IME、Widget 与生命周期失败测试。
2. **Core authority：** authoritative source、统一 History routing、external-document mode 与 table Markdown-source fallback。
3. **Headless Engine：** DocumentId、显式 create/open、DocumentRegistry、CollaborativeReplica、readiness、状态与 diagnostics。
4. **Yjs Binding：** Local Proposal → Y.Text、非本地 Yjs → Authoritative Update、per-Binding UndoManager、divergence Quarantine。
5. **Assessment adapters：** Provider/Replica Store seam、deterministic in-memory contract adapters 和显式 volatile mode；它们不进入生产支持声明。
6. **Presence 与集成：** Awareness 安全清洗、direct Core/React/Vue 同一 attach 路径、必要时的薄 native lifecycle adapter，以及 Electron 双 Editor/窗口 demo。
7. **一次性验证与提交：** Core/包/框架测试、API snapshot、全仓 typecheck/test/build、Electron smoke、人工表格路径、benchmark baseline、OpenSpec strict 和最终 diff 审计。

本 PR 完成时只能声明 `experimental`，但其 Engine/Core seam 是面向最终产品的正式 interface，不是以后需要推翻的临时 MVP。真实 Hocuspocus/Y-Sweet adapter、IndexedDB/SQLite durability、文件三方协调、生产安全/性能/soak 仍按本文后续产品化；未取得对应 Q3–Q8 证据前不得把路线图 #18 标为 done。

---

## 23. 被拒绝的旧设计

### 23.1 `NexusPlugin & CollabSession`

拒绝原因：把静态 editor contribution、应用生命周期、Provider、Persistence 和文件同步混进同一浅 interface，无法管理多编辑器和多窗口。

### 23.2 `CollabTransport.send/onMessage`

拒绝原因：只表达字节通道，不表达 Yjs sync handshake、state vector、initial sync、重连、auth 和 Awareness lifecycle。

### 23.3 自动 `initialValue` 播种

拒绝原因：两个 peer 可以同时判断空文档并重复播种。创建和加入必须是不同命令。

### 23.4 公共前后缀 minimal diff 作为安全文件回灌

拒绝原因：它只能产生单个替换 hunk，无法判断陈旧 disk snapshot 与 concurrent CRDT edit 的意图；无 base 时不存在通用安全合并。

### 23.5 “CRDT 没有冲突 UI”

拒绝原因：共享 Yjs 历史内可以自动收敛，但外部 Markdown、权限拒绝、schema mismatch 和 identity collision 仍然需要明确冲突/错误处理。

### 23.6 `documentKey` 作为房间身份

拒绝原因：Y.Text key 只在一个 Y.Doc 内选择 shared type，不能承担跨设备路由和重命名稳定身份。

### 23.7 只报告 `connected`

拒绝原因：socket open、initial sync、local persistence、model consistency 和 file projection 是不同事实。

### 23.8 core 零改动

拒绝原因：现有 transaction filters 和 Widget DOM editing model 无法保证 authoritative CRDT projection。把限制写进 README 不能替代可执行不变量。

---

## 24. 已冻结的产品基线与后续 Host 输入

`docs/superpowers/specs/2026-09-03-plugin-collab-product-decisions.md` 已为后续 OpenSpec 冻结以下默认基线：

- 默认入口 browser-safe；Chromium 承担 Engine/DOM/framework 自动化资格，Electron 承担多 renderer、broker、文件和恢复集成资格；
- `DocumentId` 是与 `FileId`/路径分离的 opaque 128-bit UUID，单文档显式 Enrollment，create 与 join 分离；
- Provider 通过 authenticated WebSocket seam；Hocuspocus 4.6 为首个生产候选，Y-Sweet 0.9.1 为第二候选，`y-websocket` 小型 server 只用于测试；
- browser 使用 IndexedDB 类 Store，Electron 使用单 utility-process broker 的 SQLite append journal + atomic snapshot；
- CRDT → file 是基本路径，外部文件导入必须基于 Projection Base 和经过资格验证的 three-way merge；
- 第一批要求传输加密和最小权限 token，不默认承诺 E2EE；
- comments/@mention 不与 #18 同时实现，只预留独立 shared collection 和 migration 机制。

这些是架构输入，不替 Host 做部署选择。进入 Provider/Persistence/File Reconciliation 实现前，具体 Host 仍必须批准并记录：

1. 生产 Provider 部署拓扑、账户/token 签发、权限撤销和 server durable acknowledgement 语义；
2. `Host document identity ↔ DocumentId` 的具体持久化位置和迁移策略；
3. 服务端数据保留、备份、恢复、容量与性能 SLO；
4. 外部文件自动导入 policy，以及冲突解决 UI 的产品归属和验收步骤；
5. Electron 升级目标与 `better-sqlite3` packaged-app spike 的目标平台；
6. 若产品需要 E2EE，另立会改变 Provider、搜索、审计、恢复和密钥生命周期的 OpenSpec change。

单一 `add-plugin-collab` 已覆盖笔试 PR 的 Core authority、Engine、Yjs Binding、assessment adapters、Presence 和集成要求，并通过严格校验。上述 Host 部署选择不阻塞 assessment implementation，但它们仍是任何 `production-supported` 声明的硬前置条件。

---

## 25. 最终完成定义

`plugin-collab` 只有同时满足以下条件，才能被称为真实可用需求而非演示：

- Headless Engine 可由 direct EditorAPI 使用，native plugin adapter 不包含第二份协作状态机；
- create/join、内容 readiness、Engine/Binding owner 和稳定 DocumentId 具有明确且可测试的语义；
- 本地/远端事务不会因 Nexus filters 产生静默分叉；
- 所有可编辑 Widget 在协作模式下不存在未提交文本黑洞；
- 至少一个真实产品 Provider adapter 完成端到端资格验证；
- Replica Store 支持离线、重启和故障恢复；
- Presence 有协议、安全和退出语义；
- Markdown 文件投影具有 Projection Base、原子写入和显式 conflict；
- 多窗口/多设备、网络分区、崩溃和外部文件修改测试通过；
- diagnostics 能区分 transport、sync、persistence、consistency 和 projection；
- Engine close、插件卸载、framework unmount、editor detach、document close 后无资源泄漏；
- OpenSpec requirements、implementation tasks、文档和支持级别与实际证据一致。

在这些条件之外，把 Y.Text 绑定到两个 EditorView 只能证明 CRDT 库能工作，不能证明 Nexus 已经具备真实协作能力。

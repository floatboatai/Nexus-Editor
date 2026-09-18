# @floatboat/nexus-plugin-collab

CRDT 驱动的实时协同编辑插件（离线优先）——为 Nexus-Editor 提供文档级同步、
光标/选区感知（awareness）、断网离线编辑与重连合并、可回放的协作历史，
以及一套能确定性证明收敛性的测试套件。

> 本插件**仅通过公开 capability 接入**（`EDITOR_TRANSACTIONS` / `EDITOR_HOST` /
> `PLUGIN_STORAGE` / `UI` / `VAULT`），**不修改 `@floatboat/nexus-core`**。
> 详见仓库根目录的 `需求描述文档.md`、`技术架构文档.md`、`测试和验证文档.md`。

## 为什么是这个命题

难点不在于接第三方库，而在于让「本地源码」「远程操作」「用户光标」三者
在时间维度上保持一致。CRDT 引擎被锁在 `ProviderAdapter` 接口之后，Nexus 只依赖抽象，
既避免核心被单一实现绑架，也方便后续替换为 Yjs / Automerge / 自研。

## 快速接入

```ts
import { createEditor } from "@floatboat/nexus-core";
import { CollabPlugin, collabPluginManifest } from "@floatboat/nexus-plugin-collab";

const app = /* NexusApp with capabilities */;
app.plugins.register(new CollabPlugin(app, collabPluginManifest, {
  roomId: "doc-123",           // 文档/房间标识（默认取 vault 路径）
  authorize: async (roomId) => canJoin(roomId), // 可选：房间鉴权钩子
  transport: myWebsocketTransport,              // 可选：默认内存 loopback
}));
```

## 分层

```
UI → Awareness → Sync(ProviderAdapter) → Model(CRDT) → Codec(版本化) → Storage(WAL)
```

## 收敛性（核心资产）

```bash
node packages/plugin-collab/test/convergence.sim.mjs
# 2320 次操作 / 最多 12 客户端 / 20 种乱序投递，文本哈希与偏移映射哈希全部一致
```

形式化版本见 `test/convergence.test.ts`（fast-check，由 CI 门禁运行）。

## 当前范围

- ✅ 分层脚手架、参考树形 CRDT、版本化 Codec、WAL 存储、远端光标 CM6 扩展、零信任安全
- ✅ 收敛性证明（可运行）+ 形式化属性测试 + Codec 往返/版本拒绝单测
- ⏳ 生产级 Yjs 接线 / 真实 WebSocket Transport / mdast 节点分片 Codec / electron-demo 集成 —— follow-up

## License

MIT

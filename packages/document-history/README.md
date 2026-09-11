# 文档内容版本历史

`@floatboat/nexus-document-history` 提供不可变内容版本、可注入存储、内存参考实现、有限额的行级差异，以及安全恢复适配。它不保存文件、不启用自动计时备份，也不替代 `plugin-history` 的编辑撤销栈。

## 记录与读取

```ts
import { MemoryDocumentVersionStore, checkpointDocument } from "@floatboat/nexus-document-history";

const store = new MemoryDocumentVersionStore();
const result = await checkpointDocument(editor, store, {
  documentKey: "host-owned-stable-document-key",
  reason: "checkpoint",
  signal: documentLifetime.signal,
});
const page = await store.list("host-owned-stable-document-key", { limit: 20 });
```

`checkpointDocument` 捕获实际 editor 的有效内容，不读取可能延迟的 React/Vue controlled props。`saved` 原因仅适用于宿主已确认保存的内容；如果成功保存后用户又继续输入，应直接把那次写入的快照交给 `store.append`，不要重新捕获并误标为已保存。

`DocumentVersionStore` 提供 `list`、`read`、`append`；读取不修改 editor。版本使用宿主 `documentKey`，包含独立 ID、时间、完整 Markdown、原因和可选标签。`list` 按最新优先分页且不返回正文；游标以最后一条 ID 继续读取。`append` 可传 `expectedHead`，`null` 要求空历史，冲突返回 `status: "conflict"`。未指定时是原子追加，不是覆盖现有记录。

不要混用三种版本：历史 ID 标识持久记录；buffer revision 只在来源 editor 的生命周期内有效；磁盘或 Vault 内容版本属于对应的文件服务。`documentKey` 应由宿主保持稳定，不能直接使用瞬时 editor/Vault session ID。

## 恢复只影响编辑缓冲区

```ts
import { restoreDocumentVersion } from "@floatboat/nexus-document-history";

const snapshot = await editor.captureDocumentSnapshot();
if (snapshot.revision) {
  const result = await restoreDocumentVersion(editor, store, {
    documentKey: "host-owned-stable-document-key",
    versionId: selectedVersionId,
    expectedRevision: snapshot.revision,
    signal: documentLifetime.signal,
  });
  // 仅 applied 表示恢复成功；显示其他状态，不自动强制重试。
}
```

恢复固定请求的来源与版本，检查只读、修订和取消，先追加恢复前的有效内容，再调用 core 的 `restoreDocumentBuffer`。存储等待期间用户继续输入会返回 `conflict`，不会覆盖新编辑；checkpoint 可能已记录，但不会被删除。旧 EditorAPI 没有可选方法时返回 `unsupported`；缺少撤销支持时返回 `history-unavailable`，不降级为不可撤销替换。事务过滤器拒绝时返回 `transaction-rejected`。

成功恢复由 core 隔离为一次 undo：撤销回到包含待提交表格文字的恢复前内容。恢复不改变文件编码或其他元数据，不调用任何文件写入接口。后续 Save 必须由宿主使用当前文件基准版本 CAS，不能拿历史记录当作强制覆盖许可。宿主切换同一个 editor 的资源身份时，应取消旧 `documentLifetime`。

取消抛出 `AbortError`。慢存储即使没有及时响应 signal，调用方也可先得到取消；底层已经开始的 checkpoint 写入仍可能完成。存储实现应在提交前检查 signal，提交后的持久化不能伪装成被撤销。

## 内存参考存储与持久化

`MemoryDocumentVersionStore` 默认最多 100 个文档、每文档 100 个版本、每文档 20 MiB、总计 64 MiB 的 UTF-8 记录数据。配额可显式调整；达到配额抛出 `quota-exceeded`，不会删除最近的恢复 checkpoint。它不承担自动清理政策。

`store.exportSnapshot()` 返回 schema v1 的不可变快照，可 JSON 序列化；`new MemoryDocumentVersionStore({ snapshot })` 验证恢复数据、身份唯一性和配额。未知 schema 或损坏记录拒绝，不静默覆盖。宿主可据此实现浏览器存储或 demo 主进程的受限本地文件持久化；原子替换、文件授权、多窗口互斥及保留策略由宿主负责。不需要把 Node 文件系统或 Git 引入该包。

## 有界文本差异

```ts
import { diffDocumentText } from "@floatboat/nexus-document-history";

const result = diffDocumentText(before, after, { timeoutMs: 50, maxHunks: 2000 });
if (result.status === "complete") {
  // hunk.before / hunk.after 是各输入中的 UTF-16 [from, to) 范围。
}
```

行级差异精确保留空白与 EOF 换行，不做 AST 比较、模糊 patch 或三方合并。默认各输入最多 1,000,000 个 UTF-16 单元、50,000 行、20,000 编辑距离、2,000 个 hunk，算法预算 50ms；超限返回 `limited` 和原因，不返回伪造的空差异。时间预算是算法检查，不是硬实时墙钟上限。

差异同步计算，signal 在工作前后检查；需要抢占大计算时使用宿主浏览器 Worker 或 Node worker_threads。内存存储和差异可在无 DOM Node 运行；editor 快照/恢复仍需要真实编辑器环境。

## 验证

`pnpm test` 覆盖存储并发、分页、配额与恢复校验、文本差异精度/预算、来源修订变化、取消以及 core 恢复的真实 undo。`pnpm check:api` 验证声明和无 DOM 的公开 Node 入口。

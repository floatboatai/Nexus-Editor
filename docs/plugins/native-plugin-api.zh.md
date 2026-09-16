# Nexus 原生插件 API 指南

> 状态：插件平台合同已完成并通过验收，设计记录见归档 change [`add-plugin-platform-api`](../../openspec/changes/archive/2026-08-13-add-plugin-platform-api/)。各宿主仍可只提供其声明支持的 capability。

Nexus 把插件拆成三层：`@floatboat/nexus-core` 是无 Workspace/Vault 假设的编辑器内核；`@floatboat/nexus-plugin-api` 是 browser-safe 公共合同；`@floatboat/nexus-plugin-runtime` 由宿主使用，负责加载、授权、生命周期和动态撤销。插件入口只依赖 `plugin-api`，不要依赖 runtime 的内部注册表。

## 1. 最小插件

作者 manifest（例如 `manifest.json`）只写作者字段：

```json
{
  "schemaVersion": 1,
  "id": "reading-tools",
  "name": "Reading tools",
  "version": "0.1.0",
  "entrypoint": "./dist/main.js",
  "apiVersion": "^1.0.0",
  "platforms": ["desktop", "web"],
  "requiredCapabilities": [
    { "id": "nexus.commands", "version": "^1.0.0", "scope": "application" }
  ],
  "optionalCapabilities": [
    { "id": "nexus.ui", "version": "^1.0.0", "scope": "window" }
  ],
  "permissions": [
    {
      "id": "ui.contribute",
      "purpose": "在宿主状态栏显示阅读统计",
      "required": false
    }
  ]
}
```

`id` 规范化后只能含小写 ASCII 字母、数字和单连字符；`version` 使用完整 semver，`apiVersion`、`hostVersion` 和 capability `version` 使用 semver range。`entrypoint` 必须是插件包内的相对模块路径，不能是绝对路径、URL、反斜杠路径或包含 `..`。作者不能填写 `source`、安装位置、digest 和 capability 解析结果，这些是宿主生成的不可变字段。

入口默认导出 `NexusPluginBase` 子类：

```ts
import {
  COMMANDS_CAPABILITY,
  NexusPluginBase,
} from "@floatboat/nexus-plugin-api";

export default class ReadingToolsPlugin extends NexusPluginBase {
  override async onload(): Promise<void> {
    const commands = this.app.capabilities.require(COMMANDS_CAPABILITY, "^1.0.0");
    const result = commands.registerCommand({
      id: "show-reading-time",
      name: "显示阅读时长",
      defaultHotkeys: [{ key: "R", modifiers: ["Mod", "Shift"] }],
      editorCallback: ({ editor }) => {
        const words = editor.getDocument().trim().split(/\s+/u).filter(Boolean).length;
        console.info(`约 ${Math.max(1, Math.ceil(words / 250))} 分钟`);
      },
    });

    if (!result.ok) this.app.diagnostics.report(result.diagnostic);
  }

  override onunload(): void {
    // 只处理未交给 Nexus 管理的插件自身状态。
  }
}
```

命令全局 ID 会变成 `reading-tools:show-reading-time`。同一 `onload()` 内的 capability contribution 处于 staging，只有整个加载成功才一次提交；任一步失败都会逆序回滚。

## 2. Capability 与 permission 是两件事

- **Capability** 回答“这个宿主、版本和上下文能否提供该服务”。token 有稳定 ID、语义版本和 `application/window/workspace/view/editor` scope。
- **Permission** 回答“该插件是否获准以声明的用途使用它”。它由宿主策略决定，不因为服务存在而自动授予。
- `requiredCapabilities` 在插件入口执行前预检；缺失、版本不符或权限拒绝都会阻止加载。
- `optionalCapabilities` 必须显式降级，不要调用 `require()` 后捕获所有异常伪装成可选。

```ts
import { UI_CAPABILITY } from "@floatboat/nexus-plugin-api";

const resolution = this.app.capabilities.resolve(
  UI_CAPABILITY,
  "^1.0.0",
  { windowId },
);

if (resolution.status === "available") {
  const ui = resolution.handle.assertAvailable();
  // 注册窗口 UI。
} else if (resolution.status === "unsupported") {
  // headless 宿主：继续提供非 UI 功能。
} else {
  this.app.diagnostics.report(resolution.diagnostic);
}
```

四种解析结果必须分别处理：`available`、`unsupported`、`version-mismatch`、`permission-denied`。长期持有的 handle 可能在运行中被撤销；调用 `onRevoked()` 或在使用前调用 `assertAvailable()`。permission 声明是兼容检查、审计和宿主策略输入，不是安全沙箱。

当前公共 token 包括命令、快捷键、Scope、EditorHost、剪贴板、事务、Markdown processor、Workspace、Vault、FileManager、Metadata、资源 URL、UI、插件数据和 secrets。具体宿主可以只实现其中一部分；例如没有安全后端时 `nexus.secrets` 必须返回 unsupported，不能退化为明文 JSON。

## 3. 生命周期与资源所有权

运行时控制 `load()`/`unload()`，插件只实现 `onload()`/`onunload()`：

```text
constructed -> loading -> loaded -> unloading -> unloaded
                    \-> failed
```

正常卸载先让 owner 进入 quiescing，停止命令和事件分发；再调用 `onunload()`；最后按注册逆序释放子组件、DOM listener、timer、subscription 和 contribution。重复或并发卸载共享结果。清理失败会成为诊断，但不会阻断剩余清理。

所有需要释放的资源必须有唯一 owner：

```ts
import { NexusComponent } from "@floatboat/nexus-plugin-api";

class PollingViewState extends NexusComponent {
  override onload(): void {
    const onVisibility = (): void => console.info(document.visibilityState);
    this.registerDomEvent(document, "visibilitychange", onVisibility);

    const intervalId = window.setInterval(() => this.refresh(), 30_000);
    this.registerInterval(intervalId);

    this.register(async () => {
      await this.flushPendingState();
    });
  }

  private refresh(): void {}
  private async flushPendingState(): Promise<void> {}
}

await this.addChild(new PollingViewState());
```

`register()`、`registerEvent()`、`registerDomEvent()`、`registerInterval()`、`registerTimeout()` 和 `addChild()` 都进入同一资源树。capability 返回的 registration 由 owner-bound service 自动归属；不要再手工注册同一个 registration。子组件先于父组件卸载，并且每个 disposer 幂等。

以下写法会泄漏，不要使用：

```ts
import { NexusComponent } from "@floatboat/nexus-plugin-api";

class LeakingComponent extends NexusComponent {
  override onload(): void {
    window.addEventListener("resize", this.relayout);
    window.setInterval(() => this.refresh(), 1000);
  }

  private readonly relayout = (): void => {};
  private refresh(): void {}
}
```

## 4. 多编辑器和宿主上下文

Nexus 不把活动编辑器建模成全局单例。一个插件实例可以服务多个 window、leaf、view 和 editor；命令执行时才解析 `CommandContext.editor`。编辑器贡献会动态安装到所有匹配的 editor，启停插件不会重建 `EditorView`。

需要特定窗口、Workspace 或 editor capability 时，传入对应的 `CapabilityRequestContext`。不要缓存“当前编辑器”或从全局 DOM 推断活动 leaf。Workspace 的 focused leaf、active view/file 和 recent editor 是相互独立且都可能为空的查询。

## 5. 事务过滤与更新监听

`nexus.editor-transactions`（`EDITOR_TRANSACTIONS_CAPABILITY`）的 scope 是 `editor`，所以 `require` 时必须传入 `{ editorId }`。运行时为每个已挂载编辑器提供一个**绑定到该编辑器**的服务，不依赖「当前活动编辑器」：同一插件实例服务多个编辑器时，每个编辑器各有自己的服务。

过滤器在提交**前**运行，可以对事务返回 `accept` / `reject` / `replace`；更新监听器在提交**后**运行，只读。两者拿到的都是与该编辑器命令、事件、扩展**同一个** `EditorContext`，外加本次的 `transaction`。

`dispatch(editorId, transaction)` 返回 `{ ok, value: { operationId } }`：调用方给了 `operationId` 就**原样回显**，没给则由服务生成 `editor-operation:<n>`。用户直接输入产生的提交没有调用方，因此在过滤器/监听器里它的 `operationId` 为 `undefined`——这是语义，不是缺省。

`annotations` 原样透传并保持同一引用：运行时不合并、不改写、不做命名空间仲裁，键的命名空间由调用方自负。过滤器 `replace` 携带的 `operationId` / `annotations` **不生效**：身份属于发起这次 `dispatch` 的调用方，不属于改写它的过滤器。

**故障不否决**：过滤器抛错、返回非同步值（Promise）或返回非法结果时，运行时会报 `callback-failed` 诊断并**旁路该过滤器**（提交按当前事务与其余过滤器继续）；只有**显式** `reject` 才是插件的意图，才否决事务。插件故障永远不该吞掉用户的按键。

**注入边界**：在过滤器内调用 `dispatch` 会被确定性拒绝（返回 `unsupported-operation`），外层提交不受影响；在监听器内允许调用（受 core 的 32 层递归上限约束）。

**覆盖边界**：上面的护栏只覆盖**经由本服务**的路径。插件直接调用 `context.editor.dispatchTransaction` 属显式使用 core 原生能力，不在保证内；在**过滤器回调内**调用任何会触发提交的 core API（`replaceRange` / `setDocument` / `replaceSelection` / `undo` / `redo`）与直接调用 `dispatchTransaction` 同等——CM6 会在 filter 阶段抛出 `RangeError` 并使外层提交被丢弃，属未定义行为。它是确定性契约，**不是安全机制**。

```ts
const transactions = this.app.capabilities.require(
  EDITOR_TRANSACTIONS_CAPABILITY,
  "^1.0.0",
  { editorId },
);
transactions.registerFilter((context) =>
  context.transaction.userEvent === "paste" ? { action: "reject" } : { action: "accept" },
);
transactions.registerUpdateListener((update) => {
  console.log(update.documentBefore, "->", update.documentAfter);
});
```

## 6. Manifest 字段速查

| 字段 | 必填 | 约束 |
|---|---:|---|
| `schemaVersion` | 否 | 当前规范版本；省略时由 normalizer 使用当前默认值 |
| `id` / `name` / `version` | 是 | 稳定身份、显示名、完整 semver |
| `entrypoint` | 是 | 插件包内 ESM 相对路径 |
| `apiVersion` | 是 | 支持的 Nexus Plugin API semver range |
| `hostVersion` | 否 | 可选宿主版本 range |
| `platforms` | 否 | `web/desktop/mobile/headless`；空数组表示不额外限制 |
| `requiredCapabilities` | 否 | 缺失、版本不符或拒权时不执行入口 |
| `optionalCapabilities` | 否 | 代码必须处理降级 |
| `permissions` | 否 | `id/purpose/required/scope`；名字与含义由宿主策略定义 |
| `deprecatedApis` | 否 | 声明仍在使用的弃用 API，供加载诊断和迁移检查 |
| `extensions` | 否 | JSON-only 的命名扩展区；未知顶层字段只保留用于诊断 |

继续阅读：[Obsidian 迁移差异](./obsidian-migration.zh.md)、[legacy 渐进迁移](./legacy-plugin-migration.zh.md)、[事件与安全示例](./security-and-events.zh.md)。

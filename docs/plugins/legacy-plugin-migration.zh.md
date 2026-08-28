# 从 `NexusPlugin` 渐进迁移到 `NexusPluginBase`

旧 `NexusPlugin` 是交给 `createEditor({ plugins })` 的声明对象，也可称为 `EditorPluginContribution`。它适合无应用状态的 CM6/remark/Widget 组合；`NexusPluginBase` 是由宿主 PluginRuntime 实例化、拥有 manifest/capability/生命周期的应用级插件。两者不是继承关系。

## 1. 何时暂时保留 legacy

满足以下条件时可以先不改：

- 插件只需要 editor-local 的 `commands`、`shortcuts`、`handlers`、`cmExtensions`、`remarkPlugins`、`widgets` 或 `slashCommands`。
- 不读取 Vault/Metadata/Workspace，不创建应用级 UI，不需要持久数据。
- 同一个 contribution 可安全用于一个或多个 editor，没有 attach-once 单例状态。

legacy adapter 会把整组 contribution 放进一个稳定 owner，并在加载前检查能否安全动态撤销。只要有一个字段在当前宿主无法适配，整组注册都会失败；不会 silent no-op，也不会返回“成功但需重启”。

## 2. 三阶段迁移

### 阶段 A：先消除实例域歧义

把旧 factory 保持为纯 contribution，不在对象里缓存 editor、DOM 节点或全局 disposer：

```ts
import type { NexusPlugin } from "@floatboat/nexus-core";

export function createReadingContribution(): NexusPlugin {
  return {
    name: "reading-tools",
    cmExtensions: [],
    commands: [
      { id: "reading-time", label: "Reading time", run: (editor) => editor.focus() },
    ],
  };
}
```

保留这个 factory 作为旧宿主回滚点，并为“同一 contribution 装到两个 editor”增加测试。

### 阶段 B：增加原生入口，复用纯逻辑

```ts
import {
  COMMANDS_CAPABILITY,
  NexusPluginBase,
} from "@floatboat/nexus-plugin-api";

export default class ReadingToolsPlugin extends NexusPluginBase {
  override onload(): void {
    const commands = this.app.capabilities.require(COMMANDS_CAPABILITY, "^1.0.0");
    const registered = commands.registerCommand({
      id: "reading-time",
      name: "Reading time",
      editorCallback: ({ editor }) => editor.focus(),
    });
    if (!registered.ok) this.app.diagnostics.report(registered.diagnostic);
  }
}

export { createReadingContribution } from "./legacy";
```

新旧入口可以在一个包中并存，但同一个宿主页面必须由 feature flag 只选择一个 owner，不能同时挂载两套 toolbar/status/menu 或注册重复命令。

### 阶段 C：迁移宿主服务与状态

- editor-local extension 使用 `EDITOR_HOST_CAPABILITY` 动态注册，并用 `matches` 控制适用 editor。
- 应用级数据改用 `PLUGIN_STORAGE_CAPABILITY`，不要直接使用 `localStorage`。
- Workspace/Vault/UI 逐项改成 required 或 optional capability；optional 必须有 headless/无能力路径。
- timer、listener、subscription 和 child view 状态全部交给 `NexusComponent` 资源树。
- 跑多轮 enable/disable，要求 listener/timer/registry/DOM 零残留。

## 3. 字段迁移表

| 旧 `NexusPlugin` 字段 | 原生目标 | 注意事项 |
|---|---|---|
| `commands` | `CommandService.registerCommand` | ID 变为 `${pluginId}:${localId}`，四种 callback 模式互斥 |
| `shortcuts` | 命令 `defaultHotkeys` 或 `ScopeService` | `Mod` 跨平台；用户覆盖高于默认值 |
| `handlers.paste/drop/keydown` | `EditorHostService.registerDomEvent` | 真实 DOM 事件、同步 consume；paste 不等于 Ctrl/Cmd+V |
| `cmExtensions` | `registerEditorExtension` | owner 级 compartment 动态 reconfigure，不重建 EditorView |
| `remarkPlugins` | Remark transform registry | transform 必须可验证、可撤销，不修改 undo 历史 |
| `widgets` | Widget registry | 稳定 contribution ID；`beginInteraction`/`endInteraction` 持锁期间不拆 DOM；卸载时 `destroy` 并释放锁 |
| `slashCommands` | command + slash menu UI slot | 命令作为唯一事实源，避免两套 ID/可用性集合 |

## 4. 弃用周期

建议按以下版本政策执行，具体版本写入 release note 和 runtime API policy：

1. **引入期**：legacy 和 native 都受支持；官方插件开始双入口，构建与行为对照测试为必需。
2. **警告期**：manifest `deprecatedApis` 声明 legacy 用法；加载时产生带 replacement/removedIn 的结构化 warning，但仍执行。
3. **冻结期**：legacy adapter 只修安全和回归问题，不接收新的字段族；新功能只进入 capability API。
4. **移除期**：只在 plugin API major version 中移除，并至少提前一个稳定周期公布；不在 patch/minor 中静默改变 adapter 语义。

不能安全动态撤销的字段可提前按宿主标为 `unsupported`，但必须在插件入口执行前失败并给出诊断，不能伪装成普通弃用。

## 5. 回滚方式

- 发布物保留旧 factory export 和原生 default export；宿主 feature flag 选择其一。
- 回滚时先停止新路径分发并卸载 `NexusPluginBase` 实例，确认资源计数归零，再以旧 `createEditor({ plugins })` 路径重新创建/挂载。不要让两条路径重叠。
- 插件数据迁移必须带 schema version 且幂等；保留损坏原文或上一版本备份，回滚代码不能用旧 schema 覆盖较新的未知数据。
- 回滚不是“禁用 native registration 后保留其 DOM”；owner 卸载必须完整清理。

## 6. 不提供的兼容捷径

Nexus 不提供 `obsidian` namespace shim，也不注入 `window.app`。同样不要为 legacy 插件增加 `window.nexusApp` 之类的全局巨型对象。这些捷径会绕过 capability 版本、scope、permission、运行中撤销和资源所有权，无法形成可测试的迁移边界。

完成迁移的判据不是“能加载”，而是：加载失败原子回滚；多编辑器行为正确；optional capability 可降级；重复启停零残留；旧/新入口的用户可见行为有对照测试。

# 插件运行时与宿主接入

`@floatboat/nexus-plugin-runtime` 提供插件生命周期、能力注册、命令、编辑器绑定以及可选的工作区和 UI 实现。它不要求使用 Electron Demo，也不规定应用的标签栏、分屏数量、工具栏图标或主题。

## 公共入口

从包入口导入运行时实现与选项类型，不依赖 `src/` 内部路径：

```ts
import {
  CommandRegistry,
  EditorHostRegistry,
  RuntimeCapabilityRegistry,
  RuntimeUiHost,
  RuntimeWorkspace,
  type RuntimeUiHostOptions,
  type RuntimeWorkspaceOptions,
} from "@floatboat/nexus-plugin-runtime";
```

插件面对的 `EditorHostService`、`WorkspaceService`、`UiService` 和 capability token 由 `@floatboat/nexus-plugin-api` 导出。运行时包提供可选实现，不要求自定义宿主继承具体类。

## 多编辑器不依赖工作区 UI

同一个 `EditorHostRegistry` 可以绑定多个 `EditorAPI` 实例：

```ts
const editors = new EditorHostRegistry();
const first = editors.attach({
  editor: firstEditor,
  surface: { kind: "document", root: firstContainer },
});
const second = editors.attach({
  editor: secondEditor,
  surface: { kind: "document", root: secondContainer },
});
await Promise.all([first.ready, second.ready]);

first.markRecent();
await first.detach();
// second 仍然绑定；编辑器实例本身由宿主管理和销毁。
```

示例中的编辑器和容器由宿主提供；无需创建 `RuntimeWorkspace` 或 `RuntimeUiHost`。`leaf`、`view`、`window` 可以为空，`surface.root` 仍是 DOM 输入表面；这里的“无工作区 UI”不表示 CodeMirror 编辑器可以脱离 DOM 运行。

宿主通过 attachment 的 `updateContext` 更新文件、来源路径和可选视图上下文，并在实际焦点变化时调用 `markRecent`。插件通过 `EditorHostService` 的 `attached`、`detached`、`contextChanged`、`recentChanged` 事件跟踪实例；不要把最近编辑器当成始终有效的活动文件。`detach` 是幂等的，只清理该绑定与其编辑器贡献，不销毁其他编辑器。

`CommandRegistry` 可以通过 `resolveContext` 获取最近编辑器，但菜单或其他异步交互应保留触发时的具体 `EditorContext`。宿主应在执行前验证来源仍有效，不能把已失效来源静默替换为当前编辑器。

## 可选 DOM 实现与完全自定义 UI

`RuntimeWorkspace` 需要 `Document`，会创建 leaf 容器并将其挂载到目标文档的 `body`；跨窗口移动也会重新挂载。`RuntimeUiHost` 会在宿主提供的插槽中创建按钮、菜单等 DOM。这些是可选的 DOM 实现，不是纯状态容器，也不是框架组件协议。

使用现有工作区实现时，可通过 `RuntimeWorkspaceOptions.markdownViewType` 指定文件导航使用的视图类型，默认值仍是 `markdown`。宿主必须另行注册相应的 view factory；插件注册的类型使用其插件 ID 命名空间，例如 `notes:markdown`。配置不会创建标签栏或分屏 UI，快照格式保持 schema v1。恢复空窗口只恢复窗口上下文身份，不负责打开原生窗口。

如果宿主要完全控制 DOM、布局与交互，应实现公共 `WorkspaceService` 和 `UiService`，通过能力注册接入，不必复用上述具体类：

```ts
import {
  UI_CAPABILITY,
  WORKSPACE_CAPABILITY,
  type UiService,
  type WindowId,
  type WorkspaceId,
  type WorkspaceService,
} from "@floatboat/nexus-plugin-api";
import {
  RuntimeCapabilityRegistry,
  type OwnerBoundCapabilityFactory,
} from "@floatboat/nexus-plugin-runtime";

function registerHostUi(
  capabilities: RuntimeCapabilityRegistry,
  workspaceId: WorkspaceId,
  windowId: WindowId,
  createWorkspace: OwnerBoundCapabilityFactory<WorkspaceService>,
  createUi: OwnerBoundCapabilityFactory<UiService>,
) {
  return [
    capabilities.registerOwnerBound(WORKSPACE_CAPABILITY, createWorkspace, {
      context: { workspaceId },
    }),
    capabilities.registerOwnerBound(UI_CAPABILITY, createUi, {
      context: { windowId },
    }),
  ];
}
```

上述两个工厂由宿主实现，并使用传入的 `owner`、`registerResource` 管理插件所有权和清理。宿主还需按契约提供类型化事件、导航结果与不支持能力的诊断；保留 `focusedLeaf`、`activeView`、`activeFile`、`recentEditor` 的独立含义。返回的 provider registration 由宿主负责撤销。未提供的 workspace/UI capability 可以被插件探测，编辑器与命令能力不因此失效。

## 工具栏图标只是装饰节点

`RuntimeUiHostOptions.renderIcon(icon, ownerDocument)` 只影响 `editor-toolbar` 插槽：

- 每次调用返回新建的装饰性 `HTMLElement`，或者在图标未知时返回 `null`；目标文档由参数提供。
- runtime 管理节点的采用、替换和移除，按钮仍保留可访问名称、禁用状态和动作上下文。
- 不配置回调、返回 `null` 或抛出异常时保留文字按钮；异常同时通过诊断回调报告。
- 该接口不是 React/Vue 组件挂载点，没有独立的组件卸载回调。不要返回交互控件，也不要在其中建立需要额外清理的全局监听器、计时器或组件资源；这些需求应由宿主自己的 `UiService` 管理。
- 不提供默认图标资产或固定主题；其他插槽继续采用原有文字呈现。

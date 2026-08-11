# CASE-NexusPlugin插件接口-测试用例（增强版）

- 一级功能点: FP-02 NexusPlugin 插件接口
- 二级功能点: 6 个（FP-02-01 ~ FP-02-06）
- 测试框架: Vitest（jsdom）
- 需求源: prd.md §3.2 分层插件基座（NexusPlugin）
- API 签名来源: packages/core/src/types.ts（NexusPlugin 接口）、packages/core/src/editor.ts（createEditor 实现）
- 增强信息注入: 全部 86 个步骤已注入精确 import 路径 / API 签名 / 预期类型（见各功能点「增强信息来源」）

## 测试数据命名规则
`TEST_{YYYYMMDDHHmm}_{描述}`，描述用英文小写下划线。文档内容使用占位符避免硬编码。

## 全局 import 约定（所有用例共用）

```typescript
// 核心包（packages/core/src/index.ts 导出）
import { createEditor } from "@floatboat/nexus-core";
import type {
  EditorAPI,          // EditorAPI 接口（types.ts:186）
  EditorConfig,       // createEditor 参数类型（types.ts:79）
  NexusPlugin,        // 插件接口（types.ts:387）
  SlashCommandDef,    // 斜杠命令定义（types.ts:280）
  SlashMenuState,     // slashMenuChange 事件状态（types.ts:123）
  WidgetDefinition,   // widget 定义（types.ts:322）
  WidgetRenderContext // widget render 第三参数（types.ts:311）
} from "@floatboat/nexus-core";
// 测试框架
import { describe, expect, it, vi } from "vitest";
```

- `createEditor(config: EditorConfig): EditorAPI`（editor.ts:232）——`EditorConfig.container` 必填，其余可选（initialValue/plugins/theme/locale/tabSize/direction/indentGuides/readOnly/multiCursor/slashMenuLimit/onChange/onFocus/onBlur/onAssetUpload，types.ts:79-121）。
- 插件扩展聚合语义: `shortcuts / slashCommands / cmExtensions / widgets / commands` 全部为 `plugins.flatMap((plugin) => plugin.xxx ?? [])`（editor.ts:247-252），**name 不参与去重**。
- 包名映射: `@floatboat/nexus-core` = packages/core、`@floatboat/nexus-plugin-slash` = packages/plugin-slash、`@floatboat/nexus-plugin-toolbar` = packages/plugin-toolbar、`@floatboat/nexus-preset-gfm` = packages/preset-gfm。

---

## FP-02-01-N01 [P1] [插件能力] 注册单个命名插件，编辑器正常创建并渲染

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `# Hello`
- 插件配置: 单个自定义插件 `{ name: "hello-plugin", shortcuts: [{ key: "Mod-b", run }] }`
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";
  import type { NexusPlugin } from "@floatboat/nexus-core";
  import { describe, expect, it } from "vitest";

  // step 1: 定义带 name 的插件（name 为 NexusPlugin 必填字段，types.ts:388）
  // 陷阱: 插件扩展按 plugins.flatMap(p => p.shortcuts ?? []) 聚合（editor.ts:247），
  //       name 仅作标识，不参与去重或校验。
  let ran = false;
  const helloPlugin: NexusPlugin = {
    name: "hello-plugin",
    shortcuts: [
      {
        key: "Mod-b",
        run() {
          ran = true;
          return true;
        },
      },
    ],
  };

  // step 2: 初始化编辑器（EditorConfig 完整签名见 types.ts:79-121）
  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "# Hello",
    plugins: [helloPlugin],
  });
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 调用 `createEditor` 创建编辑器 | [DOM] `container.querySelector(".cm-editor")` 不为 null，编辑器挂载成功（EditorView 挂载到 container 后生成 `.cm-editor` 根节点） | import: @floatboat/nexus-core; API: createEditor({ container, initialValue: "# Hello", plugins: [helloPlugin] }); 框架: vitest; 等待: 无（同步断言） |
| 2 | 读取初始文档 | [API] `editor.getDocument()` 返回 `"# Hello"`（EditorAPI.getDocument 实现为 `view.state.doc.toString()`，editor.ts:732-734，返回值类型 `string`） | import: @floatboat/nexus-core; API: editor.getDocument(): string; 框架: vitest; 等待: 无（同步断言） |
| 3 | 通过 name 注册的插件快捷键调用 `editor.runShortcut("Mod-b")` | [API] 返回 `true`，且 `ran === true`，证明带 name 的插件扩展被正确收集注册（runShortcut 实现: `shortcuts.find(entry => entry.key === key)` 命中后原样透传 `run(api)` 返回值，editor.ts:876-877） | import: @floatboat/nexus-core; API: editor.runShortcut("Mod-b"): boolean; 框架: vitest; 等待: 无（同步断言） |
| 4 | 销毁编辑器 | [DOM] `container.querySelector(".cm-editor")` 为 null（`editor.destroy()` 内部 `view.destroy()` 移除 DOM，editor.ts:967） | import: @floatboat/nexus-core; API: editor.destroy(): void; 框架: vitest; 等待: 无（同步断言） |

**断言汇总**:
- [API] `editor.getDocument()` 返回初始文档 `"# Hello"`
- [API] `editor.runShortcut("Mod-b")` 返回 `true` 且快捷键回调执行
- [DOM] 创建后 `.cm-editor` 存在，destroy 后移除

---

## FP-02-01-N02 [P2] [插件能力] 多插件多 name 同时注册，扩展聚合生效

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `start`
- 插件配置: 两个插件 `pluginA`（带快捷键）、`pluginB`（带斜杠命令）
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";
  import type { NexusPlugin } from "@floatboat/nexus-core";
  import { describe, expect, it } from "vitest";

  // step 1: 定义两个 name 不同的插件
  // 陷阱: shortcuts 与 slashCommands 分别按 plugins 数组顺序 flatMap 聚合
  //       （editor.ts:247-248），插件间扩展互不覆盖。
  const pluginA: NexusPlugin = {
    name: "plugin-a",
    shortcuts: [
      {
        key: "Ctrl-k",
        run(api) {
          api.setDocument("shortcut-ran");
          return true;
        },
      },
    ],
  };
  const pluginB: NexusPlugin = {
    name: "plugin-b",
    slashCommands: [{ id: "heading", title: "Heading" }],
  };

  // step 2: 初始化编辑器，同时注册两个插件
  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "start",
    plugins: [pluginA, pluginB],
  });
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 查询两个插件注册的扩展 | [API] `editor.getSlashCommands()` 含 pluginB 注册的命令 `id === "heading"`（`getSlashCommands(): SlashCommandDef[]` 返回 flatMap 聚合数组，editor.ts:765-767；参考 editor.test.ts:413 `getSlashCommands().map(c => c.id)` 断言模式） | import: @floatboat/nexus-core; API: editor.getSlashCommands(): SlashCommandDef[]; 框架: vitest; 等待: 无（同步断言） |
| 2 | 调用 pluginA 的快捷键 | [API] `editor.runShortcut("Ctrl-k")` 返回 `true`，且 `editor.getDocument()` 变为 `"shortcut-ran"`（快捷键 run 内 `api.setDocument` 走正常变更管道） | import: @floatboat/nexus-core; API: editor.runShortcut("Ctrl-k"): boolean; 框架: vitest; 等待: 无（同步断言） |
| 3 | 断言两个插件扩展互不干扰 | [API] pluginB 的斜杠命令依然存在（`getSlashCommands().length === 1`） | import: @floatboat/nexus-core; API: editor.getSlashCommands(): SlashCommandDef[]; 框架: vitest; 等待: 无（同步断言） |

**断言汇总**:
- [API] `getSlashCommands()` 返回 pluginB 的命令
- [API] `runShortcut("Ctrl-k")` 执行 pluginA 的快捷键并修改文档
- [API] 两个插件扩展同时生效、互不干扰

---

## FP-02-01-E01 [P3] [插件能力] 缺失 name 字段的插件对象运行时不崩溃（宽松契约）

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `# Hello`
- 插件配置: 缺少 name 字段的插件对象（TypeScript 层面非法，运行时不做校验）
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";
  import { describe, expect, it } from "vitest";

  // step 1: 定义缺失 name 的插件（仅用于验证运行时宽松行为）
  // 陷阱: createEditor 运行时只读取 plugins.flatMap(p => p.shortcuts ?? []) 等字段
  //       （editor.ts:247-252），不校验 name；TypeScript 层 name 必填，此处 as any 绕过。
  const anonymousPlugin = {
    // 故意省略 name 字段
    shortcuts: [
      {
        key: "Mod-b",
        run() {
          return true;
        },
      },
    ],
  } as any; // TS 编译层面 name 必填，此处绕过类型检查

  // step 2: 初始化编辑器
  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "# Hello",
    plugins: [anonymousPlugin],
  });
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 创建编辑器（不抛出异常） | [STATE] `createEditor` 正常返回，编辑器可正常创建（`expect(() => createEditor(...)).not.toThrow()`；createEditor 内部对插件仅做 flatMap 扩展收集，无 name 校验） | import: @floatboat/nexus-core; API: createEditor({ container, initialValue: "# Hello", plugins: [anonymousPlugin] }); 框架: vitest; 等待: 无（同步断言） |
| 2 | 验证扩展仍被注册 | [API] `editor.runShortcut("Mod-b")` 返回 `true`，缺失 name 不影响扩展收集（runShortcut 命中 `shortcuts.find` 后透传 run 返回值，editor.ts:876-877） | import: @floatboat/nexus-core; API: editor.runShortcut("Mod-b"): boolean; 框架: vitest; 等待: 无（同步断言） |
| 3 | 读取文档确认编辑器可用 | [API] `editor.getDocument()` 返回 `"# Hello"` | import: @floatboat/nexus-core; API: editor.getDocument(): string; 框架: vitest; 等待: 无（同步断言） |

**断言汇总**:
- [STATE] 缺失 name 的插件运行时不会导致 `createEditor` 抛出异常
- [API] 其扩展（快捷键）仍被正常注册执行

---

## FP-02-01-E02 [P3] [插件能力] 两个插件使用相同 name，扩展均生效（name 不参与去重）

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `start`
- 插件配置: 两个同名 `"dup"` 的插件，各注册不同快捷键
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";
  import type { NexusPlugin } from "@floatboat/nexus-core";
  import { describe, expect, it } from "vitest";

  // step 1: 定义两个同名插件
  // 陷阱: name 仅作标识，聚合为 plugins.flatMap（editor.ts:247），同名插件扩展全部保留。
  const dupA: NexusPlugin = {
    name: "dup",
    shortcuts: [
      {
        key: "Ctrl-a",
        run(api) {
          api.setDocument("from-dup-a");
          return true;
        },
      },
    ],
  };
  const dupB: NexusPlugin = {
    name: "dup",
    shortcuts: [
      {
        key: "Ctrl-b",
        run(api) {
          api.setDocument("from-dup-b");
          return true;
        },
      },
    ],
  };

  // step 2: 初始化编辑器
  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "start",
    plugins: [dupA, dupB],
  });
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 执行 dupA 的快捷键 | [API] `editor.runShortcut("Ctrl-a")` 返回 `true`，文档变为 `"from-dup-a"` | import: @floatboat/nexus-core; API: editor.runShortcut("Ctrl-a"): boolean; 框架: vitest; 等待: 无（同步断言） |
| 2 | 执行 dupB 的快捷键 | [API] `editor.runShortcut("Ctrl-b")` 返回 `true`，文档变为 `"from-dup-b"` | import: @floatboat/nexus-core; API: editor.runShortcut("Ctrl-b"): boolean; 框架: vitest; 等待: 无（同步断言） |
| 3 | 断言同名插件均生效 | [STATE] name 重复不导致任一插件扩展被丢弃或报错（聚合语义为 flatMap，无去重逻辑） | import: @floatboat/nexus-core; API: expect(editor.getDocument()).toBe("from-dup-b"); 框架: vitest; 等待: 无（同步断言） |

**断言汇总**:
- [API] 同名插件各自的快捷键均可触发
- [STATE] name 仅作标识用途，不参与去重

---

## FP-02-01-B01 [P4] [插件能力] 超长 name（1024 字符）不影响编辑器创建

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `# Hello`
- 插件配置: 单个插件，`name` 为 1024 个 `"x"` 组成的超长字符串
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";
  import type { NexusPlugin } from "@floatboat/nexus-core";
  import { describe, expect, it } from "vitest";

  // step 1: 构造超长 name
  // 陷阱: createEditor 的 debug 日志会输出 pluginNames（editor.ts:236），超长 name 仅影响日志长度，不影响功能。
  const longName = "x".repeat(1024);
  const longNamePlugin: NexusPlugin = {
    name: longName,
    shortcuts: [
      {
        key: "Mod-b",
        run() {
          return true;
        },
      },
    ],
  };

  // step 2: 初始化编辑器
  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "# Hello",
    plugins: [longNamePlugin],
  });
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 创建编辑器 | [STATE] `createEditor` 不抛出异常，编辑器正常创建 | import: @floatboat/nexus-core; API: createEditor({ container, initialValue: "# Hello", plugins: [longNamePlugin] }); 框架: vitest; 等待: 无（同步断言） |
| 2 | 验证扩展仍生效 | [API] `editor.runShortcut("Mod-b")` 返回 `true` | import: @floatboat/nexus-core; API: editor.runShortcut("Mod-b"): boolean; 框架: vitest; 等待: 无（同步断言） |
| 3 | 验证文档内容 | [API] `editor.getDocument()` 返回 `"# Hello"` | import: @floatboat/nexus-core; API: editor.getDocument(): string; 框架: vitest; 等待: 无（同步断言） |

**断言汇总**:
- [STATE] 超长 name 不影响编辑器创建
- [API] 超长 name 插件的扩展正常注册

---

## FP-02-01-F01 [P2] [插件能力] 插件注册→扩展生效→destroy 完整生命周期

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `start`
- 插件配置: 单个插件（快捷键 + 斜杠命令）
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";
  import type { NexusPlugin } from "@floatboat/nexus-core";
  import { describe, expect, it } from "vitest";

  // step 1: 定义插件
  const lifecyclePlugin: NexusPlugin = {
    name: "lifecycle",
    shortcuts: [
      {
        key: "Ctrl-k",
        run() {
          return true;
        },
      },
    ],
    slashCommands: [{ id: "cmd-1", title: "Command One" }],
  };

  // step 2: 初始化编辑器
  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "start",
    plugins: [lifecyclePlugin],
  });
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 创建编辑器，验证插件扩展生效 | [API] `editor.getSlashCommands()` 含 `cmd-1`，`runShortcut("Ctrl-k")` 返回 `true` | import: @floatboat/nexus-core; API: editor.getSlashCommands(): SlashCommandDef[]; editor.runShortcut("Ctrl-k"): boolean; 框架: vitest; 等待: 无（同步断言） |
| 2 | 调用 `editor.destroy()` | [STATE] destroy 不抛出异常（destroy 实现: `destroyed/destroying` 标志防重入，`view.destroy()` 后置 `destroyed = true`，editor.ts:924-952；若 flush 或 destroy 阶段有错则 `throw firstError`，editor.ts:975） | import: @floatboat/nexus-core; API: editor.destroy(): void; 框架: vitest; 等待: 无（同步断言） |
| 3 | destroy 后调用插件 API | [API] `editor.runShortcut("Ctrl-k")` 返回 `false`（runShortcut 首行 `if (destroyed) return false` 短路，editor.ts:872-874） | import: @floatboat/nexus-core; API: editor.runShortcut("Ctrl-k"): boolean; 框架: vitest; 等待: 无（同步断言） |
| 4 | 验证 DOM 已清理 | [DOM] `container.querySelector(".cm-editor")` 为 null | import: @floatboat/nexus-core; API: container.querySelector(".cm-editor"); 框架: vitest; 等待: 无（同步断言） |

**断言汇总**:
- [API] 插件扩展在 destroy 前全部生效
- [STATE] destroy 后快捷键执行被短路返回 `false`
- [DOM] destroy 后编辑器 DOM 从容器移除

---

## 增强信息来源（FP-02-01）

- API签名: packages/core/src/editor.ts（createEditor / runShortcut / getSlashCommands / destroy）
- 类型定义: packages/core/src/types.ts（NexusPlugin / EditorConfig / EditorAPI / SlashCommandDef）
- 插件参考: packages/plugin-slash/src/index.ts、packages/plugin-toolbar/src/index.ts
- 测试参考: packages/core/test/editor.test.ts（插件注册 + runShortcut 断言模式）
- 陷阱提示: AGENTS.md（Testing Conventions）

---

## FP-02-02-N01 [P1] [编辑交互] runShortcut 精确执行注册的快捷键并返回 true

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `hello world`
- 插件配置: 单个插件注册快捷键 `Ctrl-k`
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";
  import type { NexusPlugin } from "@floatboat/nexus-core";
  import { describe, expect, it } from "vitest";

  // step 1: 定义带快捷键的插件
  // ⚠️ 陷阱（关键发现）: CM6 EditorState.create 未传 selection 时，初始光标位于
  //       offset 0（文档开头），不是文档末尾（editor.ts:545-546）。因此 run 内
  //       replaceSelection("triggered") 在文档开头插入，结果为 "triggeredhello world"。
  let shortcutRan = false;
  const shortcutPlugin: NexusPlugin = {
    name: "shortcut-plugin",
    shortcuts: [
      {
        key: "Ctrl-k",
        run(api) {
          shortcutRan = true;
          api.replaceSelection("triggered");
          return true;
        },
      },
    ],
  };

  // step 2: 初始化编辑器（⚠️ 初始光标 offset 0，勿假定在末尾）
  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "hello world",
    plugins: [shortcutPlugin],
  });
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 调用 `editor.runShortcut("Ctrl-k")` | [API] 返回 `true`（runShortcut 命中 `shortcuts.find(entry => entry.key === key)` 后返回 `run(api)` 的原值 `true`，editor.ts:876-877） | import: @floatboat/nexus-core; API: editor.runShortcut("Ctrl-k"): boolean; 框架: vitest; 等待: 无（同步断言） |
| 2 | 验证回调副作用 | [STATE] `shortcutRan === true`；⚠️ 修正值: 初始光标在 offset 0，`replaceSelection("triggered")` 在文档开头插入，文档变为 `"triggeredhello world"`（`view.state.replaceSelection(text)` 替换当前选区，editor.ts:823-825） | import: @floatboat/nexus-core; API: editor.getDocument(): string; 框架: vitest; 等待: 无（同步断言） |

**断言汇总**:
- [API] `runShortcut("Ctrl-k")` 返回 `true`
- [STATE] 快捷键 run 回调执行且能操作编辑器（⚠️ 断言值应为 `"triggeredhello world"`——初始光标在 offset 0，原 `"hello worldtriggered"` 预期不成立）

---

## FP-02-02-N02 [P1] [编辑交互] 键盘事件实际触发快捷键（CM6 keymap 路径）

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `start`
- 插件配置: 单个插件注册 `Ctrl-k` 快捷键
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";
  import type { NexusPlugin } from "@floatboat/nexus-core";
  import { describe, expect, it } from "vitest";

  // step 1: 定义快捷键插件（key 使用显式 Ctrl 前缀避免平台差异）
  const keyboardPlugin: NexusPlugin = {
    name: "keyboard-shortcut",
    shortcuts: [
      {
        key: "Ctrl-k",
        run(api) {
          api.setDocument("shortcut-keyboard");
          return true;
        },
      },
    ],
  };

  // step 2: 初始化编辑器
  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "start",
    plugins: [keyboardPlugin],
  });

  // step 3: 构造键盘事件并派发到 CM6 content DOM
  // 陷阱: 事件必须带 bubbles: true + cancelable: true 才能被 CM6 keymap 捕获；
  //       contenteditable 选择器参考 editor.test.ts:380-391 既有模式。
  const content = container.querySelector<HTMLElement>("[contenteditable='true']")!;
  content.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "k",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
  );
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 向 `.cm-content` 派发 `Ctrl+k` 的 keydown 事件 | [EVENT] CM6 keymap 捕获事件并执行插件快捷键（键盘事件同步触发 CM6 的 keymap 处理；参考 editor.test.ts:384-391 断言 `getDocument()` 变化） | import: @floatboat/nexus-core; API: content.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true, cancelable: true })); 框架: vitest; 等待: 无（dispatchEvent 同步触发 updateListener） |
| 2 | 验证文档被快捷键修改 | [API] `editor.getDocument()` 变为 `"shortcut-keyboard"`（`setDocument` 整文档替换，与光标位置无关） | import: @floatboat/nexus-core; API: editor.getDocument(): string; 框架: vitest; 等待: 无（同步断言） |

**断言汇总**:
- [EVENT] keydown 事件触发插件快捷键（与 `runShortcut` 等价的 CM6 注册路径）
- [API] 快捷键内 `setDocument` 生效

---

## FP-02-02-N03 [P2] [编辑交互] run 返回 false 表示未消费，runShortcut 返回 false

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `start`
- 插件配置: 单个插件，快捷键 run 返回 `false`
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";
  import type { NexusPlugin } from "@floatboat/nexus-core";
  import { describe, expect, it } from "vitest";

  // step 1: run 返回 false 表示未消费该按键
  // 陷阱: runShortcut 返回 `shortcut ? shortcut.run(api) : false`（editor.ts:877），
  //       run 的返回值被原样透传，不做归一化。
  const unhandledPlugin: NexusPlugin = {
    name: "unhandled-shortcut",
    shortcuts: [
      {
        key: "Ctrl-k",
        run() {
          return false;
        },
      },
    ],
  };

  // step 2: 初始化编辑器
  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "start",
    plugins: [unhandledPlugin],
  });
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 调用 `editor.runShortcut("Ctrl-k")` | [API] 返回 `false`（run 的返回值被原样透传，editor.ts:877） | import: @floatboat/nexus-core; API: editor.runShortcut("Ctrl-k"): boolean; 框架: vitest; 等待: 无（同步断言） |
| 2 | 验证文档未被修改 | [API] `editor.getDocument()` 仍为 `"start"` | import: @floatboat/nexus-core; API: editor.getDocument(): string; 框架: vitest; 等待: 无（同步断言） |

**断言汇总**:
- [API] `runShortcut` 的返回值即 run 回调的返回值（false 透传）

---

## FP-02-02-E01 [P3] [编辑交互] 调用未注册的 key，runShortcut 返回 false

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `start`
- 插件配置: 单个插件注册 `Ctrl-k`（未注册 `Mod-x`）
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";
  import type { NexusPlugin } from "@floatboat/nexus-core";
  import { describe, expect, it } from "vitest";

  // step 1: 只注册一个快捷键
  // 陷阱: runShortcut 用 `shortcuts.find(entry => entry.key === key)` 精确匹配
  //       （editor.ts:876），未命中返回 false，且不会触发任何回调。
  const shortcutPlugin: NexusPlugin = {
    name: "shortcut-plugin",
    shortcuts: [
      {
        key: "Ctrl-k",
        run() {
          return true;
        },
      },
    ],
  };

  // step 2: 初始化编辑器
  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "start",
    plugins: [shortcutPlugin],
  });
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 调用 `editor.runShortcut("Mod-x")`（未注册） | [API] 返回 `false`，且不触发任何插件回调（`shortcuts.find` 未命中 → `: false`，editor.ts:876-877） | import: @floatboat/nexus-core; API: editor.runShortcut("Mod-x"): boolean; 框架: vitest; 等待: 无（同步断言） |
| 2 | 调用 `editor.runShortcut("")`（空 key） | [API] 返回 `false`（空字符串同样走 find 精确匹配，未命中即 false） | import: @floatboat/nexus-core; API: editor.runShortcut(""): boolean; 框架: vitest; 等待: 无（同步断言） |

**断言汇总**:
- [API] 未注册的 key / 空 key 均返回 `false`（精确匹配语义）

---

## FP-02-02-E02 [P3] [编辑交互] 快捷键 run 回调抛出异常时异常向外传播

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `start`
- 插件配置: 单个插件，快捷键 run 内部抛出异常
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";
  import type { NexusPlugin } from "@floatboat/nexus-core";
  import { describe, expect, it } from "vitest";

  // step 1: run 回调抛错
  // 陷阱: runShortcut 对 run 调用无 try/catch（editor.ts:877），插件异常直接冒泡到调用方。
  const throwingPlugin: NexusPlugin = {
    name: "throwing-shortcut",
    shortcuts: [
      {
        key: "Ctrl-k",
        run() {
          throw new Error("TEST_shortcut_broken");
        },
      },
    ],
  };

  // step 2: 初始化编辑器
  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "start",
    plugins: [throwingPlugin],
  });
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 调用 `editor.runShortcut("Ctrl-k")` | [STATE] 抛出异常 `Error("TEST_shortcut_broken")`（实现未捕获插件异常，异常冒泡；断言: `expect(() => editor.runShortcut("Ctrl-k")).toThrow("TEST_shortcut_broken")`） | import: vitest; API: expect(() => editor.runShortcut("Ctrl-k")).toThrow("TEST_shortcut_broken"); 框架: vitest; 等待: 无（同步断言） |
| 2 | 验证编辑器状态未被破坏 | [API] 捕获异常后 `editor.getDocument()` 仍为 `"start"`，编辑器可继续使用 | import: @floatboat/nexus-core; API: editor.getDocument(): string; 框架: vitest; 等待: 无（同步断言） |

**断言汇总**:
- [STATE] 插件 run 回调异常通过 `runShortcut` 向外传播（不吞异常）
- [API] 异常不影响编辑器既有文档状态

---

## FP-02-02-B01 [P4] [编辑交互] 多个插件注册相同 key，先注册者生效

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `start`
- 插件配置: 两个插件都注册 `Ctrl-k`，run 回调不同
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";
  import type { NexusPlugin } from "@floatboat/nexus-core";
  import { describe, expect, it } from "vitest";

  // step 1: 两个插件注册相同 key
  // 陷阱: runShortcut 用 `shortcuts.find(...)`（editor.ts:876），按聚合后的数组顺序
  //       返回第一个匹配项 —— 先注册者（plugins 数组顺序在前）生效，后注册者不执行。
  const firstRan: string[] = [];
  const pluginFirst: NexusPlugin = {
    name: "first",
    shortcuts: [
      {
        key: "Ctrl-k",
        run() {
          firstRan.push("first");
          return true;
        },
      },
    ],
  };
  const pluginSecond: NexusPlugin = {
    name: "second",
    shortcuts: [
      {
        key: "Ctrl-k",
        run() {
          firstRan.push("second");
          return true;
        },
      },
    ],
  };

  // step 2: 初始化编辑器（先注册者优先）
  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "start",
    plugins: [pluginFirst, pluginSecond],
  });
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 调用 `editor.runShortcut("Ctrl-k")` | [API] 返回 `true`（`shortcuts.find` 命中先注册的 pluginFirst） | import: @floatboat/nexus-core; API: editor.runShortcut("Ctrl-k"): boolean; 框架: vitest; 等待: 无（同步断言） |
| 2 | 检查实际执行的回调 | [STATE] `firstRan` 只包含 `"first"`（`shortcuts.find` 命中先注册者即返回，后注册者不执行；editor.ts:876-877） | import: @floatboat/nexus-core; API: expect(firstRan).toEqual(["first"]); 框架: vitest; 等待: 无（同步断言） |

**断言汇总**:
- [STATE] 相同 key 的快捷键按注册顺序取先注册者执行

---

## FP-02-02-F01 [P5] [编辑交互] 快捷键修改文档后 onChange 回调触发（流程）

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `start`
- 插件配置: 单个插件，快捷键内调用 `setDocument`
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";
  import type { NexusPlugin } from "@floatboat/nexus-core";
  import { describe, expect, it } from "vitest";

  // step 1: 定义快捷键插件
  // 陷阱: onChange 签名固定为 (doc: string, ast: Root)（types.ts:113），
  //       非 silent 的 setDocument 会同步触发 onChange 管道（silent 选项除外）。
  const docs: string[] = [];
  const flowPlugin: NexusPlugin = {
    name: "flow-plugin",
    shortcuts: [
      {
        key: "Ctrl-k",
        run(api) {
          api.setDocument("after-shortcut");
          return true;
        },
      },
    ],
  };

  // step 2: 初始化编辑器
  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "start",
    plugins: [flowPlugin],
    onChange(doc) {
      docs.push(doc);
    },
  });
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 执行 `editor.runShortcut("Ctrl-k")` | [API] 返回 `true` | import: @floatboat/nexus-core; API: editor.runShortcut("Ctrl-k"): boolean; 框架: vitest; 等待: 无（同步断言） |
| 2 | 验证 onChange 被触发 | [EVENT] `docs` 数组包含 `"after-shortcut"`（快捷键内 setDocument 走正常变更管道，onChange 回调参数 `doc: string` 为最新文档，types.ts:113；参考 editor.test.ts:231-233 onChange 收集模式） | import: @floatboat/nexus-core; API: expect(docs).toContain("after-shortcut"); 框架: vitest; 等待: 无（同步断言） |

**断言汇总**:
- [EVENT] 快捷键内的文档修改触发 `onChange` 回调

---

## 增强信息来源（FP-02-02）

- API签名: packages/core/src/editor.ts（runShortcut / setDocument / replaceSelection / EditorState.create 初始 selection）
- 类型定义: packages/core/src/types.ts（EditorAPI / EditorEventMap / EditorConfig.onChange）
- 插件参考: packages/plugin-toolbar/src/index.ts（快捷键注册模式: `{ key, run }` 数组）
- 测试参考: packages/core/test/editor.test.ts（键盘事件派发 + runShortcut 断言模式）
- 陷阱提示: AGENTS.md（Testing Conventions）+ 源码契约（初始光标 offset 0）

---

## FP-02-03-N01 [P1] [插件能力] getSlashCommands 返回插件注册的斜杠命令

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `# Heading`
- 插件配置: 单个插件注册两条斜杠命令（含 id/title/keywords/run）
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";
  import type { NexusPlugin, SlashCommandDef } from "@floatboat/nexus-core";
  import { describe, expect, it } from "vitest";

  // step 1: 定义斜杠命令插件
  // 陷阱: SlashCommandDef 完整字段为 { id, title, keywords?, description?, run? }
  //       （types.ts:280-301）；run 可选，无 run 的命令仍作为元数据保留。
  const slashPlugin: NexusPlugin = {
    name: "slash-plugin",
    slashCommands: [
      {
        id: "heading-1",
        title: "Heading 1",
        keywords: ["h1", "title"],
        run() {
          return true;
        },
      },
      {
        id: "table",
        title: "Table",
      },
    ],
  };

  // step 2: 初始化编辑器
  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "# Heading",
    plugins: [slashPlugin],
  });
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 调用 `editor.getSlashCommands()` | [API] 返回数组，长度 `2`，按注册顺序含 `id: "heading-1"` 与 `id: "table"`（返回 `SlashCommandDef[]`，flatMap 聚合保序，editor.ts:248, 765-767；断言模式参考 editor.test.ts:413 `map(c => c.id).toEqual([...])`） | import: @floatboat/nexus-core; API: editor.getSlashCommands(): SlashCommandDef[]; 框架: vitest; 等待: 无（同步断言） |
| 2 | 校验命令字段完整 | [API] 首条命令 `title === "Heading 1"`、`keywords` 含 `"h1"`；无 `run` 的命令仍作为元数据保留（`typeof cmd.run === "function"` / `"undefined"`，types.ts:280-301） | import: @floatboat/nexus-core; API: editor.getSlashCommands()[0].title / .keywords / .run; 框架: vitest; 等待: 无（同步断言） |

**断言汇总**:
- [API] `getSlashCommands()` 返回注册命令的完整对象（含 id/title/keywords/run）

---

## FP-02-03-N02 [P1] [编辑交互] 输入 "/" 触发 slashMenuChange 且菜单打开

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `start`
- 插件配置: 单个插件注册斜杠命令
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";
  import type { NexusPlugin, SlashMenuState } from "@floatboat/nexus-core";
  import { describe, expect, it } from "vitest";

  // step 1: 定义斜杠命令插件
  const slashPlugin: NexusPlugin = {
    name: "slash-plugin",
    slashCommands: [{ id: "heading", title: "Heading" }],
  };

  // step 2: 初始化编辑器
  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "start",
    plugins: [slashPlugin],
  });

  // step 3: 订阅斜杠菜单状态
  // 陷阱: slashMenuChange 事件仅在 slashCommands.length > 0 且发生
  //       selectionSet/docChanged 时触发（editor.ts:621-651）；事件参数类型为
  //       SlashMenuState { isOpen, from, to, query, commands, coords }（types.ts:123-130）。
  let lastState: SlashMenuState | null = null;
  editor.on("slashMenuChange", (state) => {
    lastState = state;
  });
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 光标移到文档末尾，插入 `"/"`：`editor.setSelection(5); editor.replaceSelection("/")` | [STATE] 文档变为 `"start/"`，触发 `slashMenuChange`（`setSelection(anchor, head=anchor)` 同步 dispatch，editor.ts:775-791；`replaceSelection` 走 `view.state.replaceSelection`，editor.ts:823-825） | import: @floatboat/nexus-core; API: editor.setSelection(5): void; editor.replaceSelection("/"): void; 框架: vitest; 等待: 无（dispatch 同步触发 updateListener → emitter.emit） |
| 2 | 校验菜单状态 | [STATE] `lastState.isOpen === true`，`lastState.query === ""`，`lastState.commands` 含注册命令 `id: "heading"`（空查询时 `filterSlashCommands` 返回 `commands.slice()` 保持注册顺序，slash-state.ts:122-127） | import: @floatboat/nexus-core; API: expect(lastState).toMatchObject({ isOpen: true, query: "" }); 框架: vitest; 等待: 无（同步断言） |

**断言汇总**:
- [STATE] 输入 `/` 后 `slashMenuChange` 事件触发且 `isOpen === true`
- [STATE] 空查询时命令列表包含全部注册命令（保持注册顺序）

---

## FP-02-03-N03 [P2] [编辑交互] 输入 "/hea" 按标题前缀过滤排序

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `start`
- 插件配置: 单个插件注册两条命令（`Heading 1`、`Table`）
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";
  import type { NexusPlugin, SlashMenuState } from "@floatboat/nexus-core";
  import { describe, expect, it } from "vitest";

  // step 1: 定义斜杠命令插件
  const slashPlugin: NexusPlugin = {
    name: "slash-plugin",
    slashCommands: [
      { id: "heading", title: "Heading 1" },
      { id: "table", title: "Table" },
    ],
  };

  // step 2: 初始化编辑器
  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "start",
    plugins: [slashPlugin],
  });

  // step 3: 订阅斜杠菜单状态
  // 陷阱: filterSlashCommands 对非空 query 按标题前缀 startsWith 优先匹配
  //       （slash-state.ts:82-84），"hea" 命中 "Heading 1"，"Table" 被过滤。
  let lastState: SlashMenuState | null = null;
  editor.on("slashMenuChange", (state) => {
    lastState = state;
  });
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 插入 `"/hea"`：`editor.setSelection(5); editor.replaceSelection("/hea")` | [STATE] 文档变为 `"start/hea"`，触发 `slashMenuChange` | import: @floatboat/nexus-core; API: editor.setSelection(5): void; editor.replaceSelection("/hea"): void; 框架: vitest; 等待: 无（同步断言） |
| 2 | 校验过滤结果 | [STATE] `lastState.isOpen === true`，`lastState.query === "hea"`，`commands` 仅含 `id: "heading"`（标题前缀匹配，slash-state.ts:82；`"table"` 被过滤） | import: @floatboat/nexus-core; API: expect(lastState?.commands.map(c => c.id)).toEqual(["heading"]); 框架: vitest; 等待: 无（同步断言） |

**断言汇总**:
- [STATE] 查询按标题前缀过滤，不匹配的命令从列表移除

---

## FP-02-03-D01 [P2] [数据] 多插件斜杠命令按注册顺序聚合

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `start`
- 插件配置: 三个插件各注册一条命令（`cmd-a`、`cmd-b`、`cmd-c`）
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";
  import type { NexusPlugin, SlashMenuState } from "@floatboat/nexus-core";
  import { describe, expect, it } from "vitest";

  // step 1: 三个插件各注册一条命令
  // 陷阱: 命令聚合为 plugins.flatMap(p => p.slashCommands ?? [])（editor.ts:248），
  //       plugins 数组顺序即命令顺序。
  const pluginA: NexusPlugin = {
    name: "plugin-a",
    slashCommands: [{ id: "cmd-a", title: "Alpha" }],
  };
  const pluginB: NexusPlugin = {
    name: "plugin-b",
    slashCommands: [{ id: "cmd-b", title: "Beta" }],
  };
  const pluginC: NexusPlugin = {
    name: "plugin-c",
    slashCommands: [{ id: "cmd-c", title: "Gamma" }],
  };

  // step 2: 初始化编辑器（plugins 数组顺序 = 命令聚合顺序）
  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "start",
    plugins: [pluginA, pluginB, pluginC],
  });

  let lastState: SlashMenuState | null = null;
  editor.on("slashMenuChange", (state) => {
    lastState = state;
  });
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 调用 `editor.getSlashCommands()` | [API] 返回 3 条命令，`id` 顺序为 `["cmd-a", "cmd-b", "cmd-c"]`（与插件注册顺序一致，flatMap 聚合 editor.ts:248） | import: @floatboat/nexus-core; API: editor.getSlashCommands(): SlashCommandDef[]; 框架: vitest; 等待: 无（同步断言） |
| 2 | 输入 `/` 打开菜单 | [STATE] `slashMenuChange` 的 `commands` 顺序与注册顺序一致（空查询 `filterSlashCommands` 返回 `commands.slice()` 不排序，slash-state.ts:122-127） | import: @floatboat/nexus-core; API: editor.setSelection(5): void; editor.replaceSelection("/"): void; 框架: vitest; 等待: 无（同步断言） |

**断言汇总**:
- [API] 多插件命令按 plugins 数组顺序聚合（flatMap 语义）
- [STATE] 空查询菜单命令保持注册顺序

---

## FP-02-03-E01 [P3] [编辑交互] slashMenuLimit 为 0 时菜单打开但命令列表为空

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `start`
- 插件配置: 单个插件注册命令，`slashMenuLimit: 0`
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";
  import type { NexusPlugin, SlashMenuState } from "@floatboat/nexus-core";
  import { describe, expect, it } from "vitest";

  // step 1: 定义斜杠命令插件
  const slashPlugin: NexusPlugin = {
    name: "slash-plugin",
    slashCommands: [{ id: "heading", title: "Heading" }],
  };

  // step 2: 初始化编辑器（限制菜单命令数量为 0）
  // 陷阱: slashMenuLimit 默认 8（types.ts:112）；limit=0 时 computeSlashState 仍返回
  //       isOpen: true 但 `filtered.slice(0, 0)` 得空列表（slash-state.ts:165-169）；
  //       limit < 0 视为不设上限。
  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "start",
    plugins: [slashPlugin],
    slashMenuLimit: 0,
  });

  // step 3: 订阅斜杠菜单状态
  let lastState: SlashMenuState | null = null;
  editor.on("slashMenuChange", (state) => {
    lastState = state;
  });
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 插入 `"/"`：`editor.setSelection(5); editor.replaceSelection("/")` | [STATE] 触发 `slashMenuChange`（selectionSet 触发 updateListener，editor.ts:621-651） | import: @floatboat/nexus-core; API: editor.setSelection(5): void; editor.replaceSelection("/"): void; 框架: vitest; 等待: 无（同步断言） |
| 2 | 校验 limit 行为 | [STATE] `lastState.isOpen === true`，`lastState.commands.length === 0`（limit 0 时保持打开但返回空列表，供"无结果"占位 UI 使用，slash-state.ts:165-169） | import: @floatboat/nexus-core; API: expect(lastState?.commands).toEqual([]); 框架: vitest; 等待: 无（同步断言） |

**断言汇总**:
- [STATE] `slashMenuLimit: 0` 时菜单保持打开、命令列表为空

---

## FP-02-03-B01 [P4] [编辑交互] 查询含空白字符时菜单关闭

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `start`
- 插件配置: 单个插件注册命令
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";
  import type { NexusPlugin, SlashMenuState } from "@floatboat/nexus-core";
  import { describe, expect, it } from "vitest";

  // step 1: 定义斜杠命令插件
  const slashPlugin: NexusPlugin = {
    name: "slash-plugin",
    slashCommands: [{ id: "heading", title: "Heading 1" }],
  };

  // step 2: 初始化编辑器
  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "start",
    plugins: [slashPlugin],
  });

  // step 3: 订阅斜杠菜单状态
  // 陷阱: getSlashMatch 对 query 做 /\s/.test(query) 检查（slash-state.ts:56），
  //       含空白返回 null → computeSlashState 返回
  //       { isOpen: false, from: null, to: null, query: "", commands: [] }（slash-state.ts:161）。
  let lastState: SlashMenuState | null = null;
  editor.on("slashMenuChange", (state) => {
    lastState = state;
  });
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 插入 `"/he lo"`（查询含空格）：`editor.setSelection(5); editor.replaceSelection("/he lo")` | [STATE] 触发 `slashMenuChange` | import: @floatboat/nexus-core; API: editor.setSelection(5): void; editor.replaceSelection("/he lo"): void; 框架: vitest; 等待: 无（同步断言） |
| 2 | 校验菜单状态 | [STATE] `lastState.isOpen === false`，`lastState.commands.length === 0`（查询含空白视为用户已输入完毕，关闭菜单；slash-state.ts:53-56, 161） | import: @floatboat/nexus-core; API: expect(lastState?.isOpen).toBe(false); 框架: vitest; 等待: 无（同步断言） |

**断言汇总**:
- [STATE] 查询字符串含空白时 `slashMenuChange` 报告 `isOpen === false`

---

## FP-02-03-F01 [P5] [编辑交互] 命令 run 钩子由宿主调用并修改文档（流程）

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `start`
- 插件配置: 单个插件注册带 run 钩子的命令
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";
  import type { NexusPlugin, EditorAPI } from "@floatboat/nexus-core";
  import { describe, expect, it } from "vitest";

  // step 1: 定义带 run 钩子的斜杠命令
  // 陷阱: core 只负责计算菜单状态，命令的 run 由宿主 UI 确认后调用（types.ts:289-300）；
  //       run 签名 (editor: EditorAPI) => boolean | void，返回值 advisory（菜单总是关闭）。
  const slashPlugin: NexusPlugin = {
    name: "slash-plugin",
    slashCommands: [
      {
        id: "insert-hr",
        title: "Horizontal Rule",
        run(api) {
          api.replaceSelection("\n\n---\n\n");
          return true;
        },
      },
    ],
  };

  // step 2: 初始化编辑器（core 只负责计算菜单状态，run 由宿主 UI 确认后调用）
  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "start",
    plugins: [slashPlugin],
  });
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 获取注册命令并模拟宿主确认执行 | [API] `const cmd = editor.getSlashCommands()[0]`，`cmd.id === "insert-hr"`，`typeof cmd.run === "function"` | import: @floatboat/nexus-core; API: editor.getSlashCommands(): SlashCommandDef[]; 框架: vitest; 等待: 无（同步断言） |
| 2 | 手动调用 `cmd.run(editor)` | [API] 返回 `true`，文档变为 `"start\n\n---\n\n"`（run 钩子获得 EditorAPI 句柄并插入 markdown；`replaceSelection` 替换当前选区——初始光标 offset 0，插入到文档开头） | import: @floatboat/nexus-core; API: cmd.run(editor): boolean | void; editor.getDocument(): string; 框架: vitest; 等待: 无（同步断言） |

**断言汇总**:
- [API] `getSlashCommands()` 返回带 run 钩子的命令对象
- [API] run 钩子可通过 EditorAPI 修改文档（确认命令执行流程）

---

## 增强信息来源（FP-02-03）

- API签名: packages/core/src/editor.ts（getSlashCommands / slashMenuChange 触发 / computeSlashState 调用）
- 类型定义: packages/core/src/types.ts（SlashCommandDef / SlashMenuState / EditorConfig.slashMenuLimit）
- 状态计算: packages/core/src/slash-state.ts（getSlashMatch / filterSlashCommands / computeSlashState）
- 插件参考: packages/plugin-slash/src/index.ts（createSlashPlugin / getSlashState 别名）
- 测试参考: packages/core/test/editor.test.ts（slashCommands 聚合断言）、packages/plugin-slash/test/plugin-slash.test.ts（filterSlashCommands 测试模式）
- 陷阱提示: AGENTS.md（Testing Conventions）

---

## FP-02-04-N01 [P1] [AST解析] remark transform 插件修改 getAst() 输出的 AST

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `# Heading`
- 插件配置: 单个插件注册 remark transform 插件（追加 paragraph 节点）
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";
  import type { NexusPlugin } from "@floatboat/nexus-core";
  import type { Plugin } from "unified";
  import type { Root } from "mdast";
  import { describe, expect, it } from "vitest";

  // step 1: 定义 remark 转换插件（transformer 形式：接收 mdast tree 并修改）
  // ⚠️ 陷阱（关键）: transformProcessor 仅在「未传 config.parser」且存在 remarkPlugins 时
  //       构建（editor.ts:277-278）。本用例禁止传 parser，否则插件不会应用。
  const appendParagraph: Plugin<[], Root, Root> = function () {
    return (tree) => {
      tree.children.push({
        type: "paragraph",
        children: [{ type: "text", value: "plugin-injected" }],
      });
    };
  };

  const remarkPlugin: NexusPlugin = {
    name: "remark-transform",
    remarkPlugins: [appendParagraph],
  };

  // step 2: 初始化编辑器
  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "# Heading",
    plugins: [remarkPlugin],
  });
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 调用 `editor.getAst()` | [AST] 返回的 mdast Root 的 `children` 类型为 `["heading", "paragraph"]`（`getAst(): Root` 返回 currentAst，经 transformProcessor.runSync 应用插件，editor.ts:279-280, 735-737；断言模式参考 editor.test.ts:231-238 `onChange(_doc, ast).children.map(c => c.type)`） | import: @floatboat/nexus-core; API: editor.getAst(): Root; 框架: vitest; 等待: 无（同步断言） |
| 2 | 校验注入节点内容 | [AST] 追加的 paragraph 节点 `children[0].value === "plugin-injected"` | import: @floatboat/nexus-core; API: editor.getAst().children[1].children[0].value; 框架: vitest; 等待: 无（同步断言） |

**断言汇总**:
- [AST] `getAst()` 输出经过 remark transform 插件转换
- [AST] 插件注入的节点结构与值正确

---

## FP-02-04-N02 [P2] [API契约] exportHTML() 反映 remark 插件转换结果

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `# Heading`
- 插件配置: 单个插件注册 remark transform 插件（追加 paragraph 节点）
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";
  import type { NexusPlugin } from "@floatboat/nexus-core";
  import type { Plugin } from "unified";
  import type { Root } from "mdast";
  import { describe, expect, it } from "vitest";

  // step 1: 定义 remark 转换插件
  // 陷阱: exportHTML 走独立的 unified 管道（editor.ts:133-142）:
  //       remarkParse → 各插件 remarkPlugins → remarkRehype → rehypeStringify，
  //       与 getAst 的 transformProcessor 管道是两条路径，但都会应用 remarkPlugins。
  const appendParagraph: Plugin<[], Root, Root> = function () {
    return (tree) => {
      tree.children.push({
        type: "paragraph",
        children: [{ type: "text", value: "plugin-injected" }],
      });
    };
  };

  const remarkPlugin: NexusPlugin = {
    name: "remark-transform",
    remarkPlugins: [appendParagraph],
  };

  // step 2: 初始化编辑器
  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "# Heading",
    plugins: [remarkPlugin],
  });
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 调用 `editor.exportHTML()` | [API] 返回的 HTML 字符串包含 `<h1>Heading</h1>` 与 `<p>plugin-injected</p>`（`exportHTML(): string` 实现为 `markdownToHtml(view.state.doc.toString(), plugins)`，editor.ts:741-743；unified 管道中插件对 AST 的转换同步影响 HTML 输出） | import: @floatboat/nexus-core; API: editor.exportHTML(): string; 框架: vitest; 等待: 无（同步断言） |

**断言汇总**:
- [API] `exportHTML()` 输出包含插件转换注入的内容

---

## FP-02-04-N03 [P2] [AST解析] setDocument 后 AST 仍经过 remark 转换（增量生效）

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `first`
- 插件配置: 单个插件注册 remark transform 插件（追加 paragraph 节点）
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";
  import type { NexusPlugin } from "@floatboat/nexus-core";
  import type { Plugin } from "unified";
  import type { Root } from "mdast";
  import { describe, expect, it } from "vitest";

  // step 1: 定义 remark 转换插件
  const appendParagraph: Plugin<[], Root, Root> = function () {
    return (tree) => {
      tree.children.push({
        type: "paragraph",
        children: [{ type: "text", value: "plugin-injected" }],
      });
    };
  };

  const remarkPlugin: NexusPlugin = {
    name: "remark-transform",
    remarkPlugins: [appendParagraph],
  };

  // step 2: 初始化编辑器
  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "first",
    plugins: [remarkPlugin],
  });
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | `editor.setDocument("# Second")` 替换文档 | [API] `editor.getDocument()` 变为 `"# Second"`（setDocument 走 performSetDocument，非 silent 时同步触发变更管道） | import: @floatboat/nexus-core; API: editor.setDocument("# Second"): void; editor.getDocument(): string; 框架: vitest; 等待: 无（同步断言） |
| 2 | 调用 `editor.getAst()` | [AST] `children` 类型为 `["heading", "paragraph"]`，新增内容同样经过 transform（每次解析后都应用 transformAst，转换不是一次性，editor.ts:279-280） | import: @floatboat/nexus-core; API: editor.getAst(): Root; 框架: vitest; 等待: 无（同步断言） |

**断言汇总**:
- [AST] 文档更新后 `getAst()` 输出仍经过 remark 转换（转换不是一次性）

---

## FP-02-04-E01 [P3] [AST解析] remark 插件在转换时抛出异常导致 createEditor 失败

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `# Heading`
- 插件配置: 单个插件注册 transformer 抛错的 remark 插件
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";
  import type { NexusPlugin } from "@floatboat/nexus-core";
  import type { Plugin } from "unified";
  import type { Root } from "mdast";
  import { describe, expect, it } from "vitest";

  // step 1: transformer 内部抛错
  // 陷阱: 初始 AST 在 createEditor 期间同步构建并经 transformAst（editor.ts:279-280），
  //       processor.runSync 抛出的异常直接向外传播，无 try/catch 兜底。
  const brokenTransform: Plugin<[], Root, Root> = function () {
    return () => {
      throw new Error("TEST_remark_plugin_broken");
    };
  };

  const brokenPlugin: NexusPlugin = {
    name: "broken-remark",
    remarkPlugins: [brokenTransform],
  };

  // step 2: 初始化编辑器（初始 AST 同步转换，异常在 createEditor 期间抛出）
  const container = document.createElement("div");
  let editor: ReturnType<typeof createEditor> | null = null;
  try {
    editor = createEditor({
      container,
      initialValue: "# Heading",
      plugins: [brokenPlugin],
    });
  } catch (error) {
    // 捕获：断言见步骤 1
  }
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 执行 createEditor（插件抛错） | [STATE] `createEditor` 抛出 `Error("TEST_remark_plugin_broken")`（transform 在初始 AST 同步执行，异常未被吞掉；断言: `expect(() => createEditor(...)).toThrow("TEST_remark_plugin_broken")`） | import: vitest; API: expect(() => createEditor({ container, initialValue: "# Heading", plugins: [brokenPlugin] })).toThrow("TEST_remark_plugin_broken"); 框架: vitest; 等待: 无（同步断言） |
| 2 | 断言编辑器未成功创建 | [STATE] `editor === null`（无半初始化实例） | import: vitest; API: expect(editor).toBeNull(); 框架: vitest; 等待: 无（同步断言） |

**断言汇总**:
- [STATE] remark 插件转换异常在 `createEditor` 期间向外传播

---

## FP-02-04-B01 [P4] [AST解析] 多个 remark 插件按注册顺序依次执行

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `# Heading`
- 插件配置: 单个插件注册两个 remark 插件（依次向 children 追加不同节点）
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";
  import type { NexusPlugin } from "@floatboat/nexus-core";
  import type { Plugin } from "unified";
  import type { Root } from "mdast";
  import { describe, expect, it } from "vitest";

  // step 1: 两个转换插件，各自追加一个节点
  // 陷阱: 插件按 processor.use(rp) 的注册顺序执行（editor.ts:197-201, 222-224），
  //       前一个 transformer 的输出作为后一个的输入。
  const appendFirst: Plugin<[], Root, Root> = function () {
    return (tree) => {
      tree.children.push({
        type: "paragraph",
        children: [{ type: "text", value: "first" }],
      });
    };
  };
  const appendSecond: Plugin<[], Root, Root> = function () {
    return (tree) => {
      tree.children.push({
        type: "paragraph",
        children: [{ type: "text", value: "second" }],
      });
    };
  };

  const remarkPlugin: NexusPlugin = {
    name: "multi-remark",
    remarkPlugins: [appendFirst, appendSecond],
  };

  // step 2: 初始化编辑器
  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "# Heading",
    plugins: [remarkPlugin],
  });
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 调用 `editor.getAst()` | [AST] `children` 长度为 3，类型为 `["heading", "paragraph", "paragraph"]` | import: @floatboat/nexus-core; API: editor.getAst(): Root; 框架: vitest; 等待: 无（同步断言） |
| 2 | 校验执行顺序 | [AST] 注入文本顺序为 `["first", "second"]`（与 remarkPlugins 数组顺序一致，前一个的输出作为后一个的输入；editor.ts:222-224） | import: @floatboat/nexus-core; API: editor.getAst().children.slice(1).map(p => p.children[0].value); 框架: vitest; 等待: 无（同步断言） |

**断言汇总**:
- [AST] 多个 remark 插件按注册顺序依次执行

---

## FP-02-04-D01 [P3] [数据] remark 插件仅改变 AST，文档源码不变（round-trip 无损）

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `# Heading`
- 插件配置: 单个插件注册 remark transform 插件（追加 paragraph 节点）
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";
  import type { NexusPlugin } from "@floatboat/nexus-core";
  import type { Plugin } from "unified";
  import type { Root } from "mdast";
  import { describe, expect, it } from "vitest";

  // step 1: 定义 remark 转换插件
  // 陷阱: transform 只作用于内存 AST 视图（transformAst，editor.ts:279-280），
  //       不写回 EditorState 文档 —— getDocument() 始终返回原始源码。
  const appendParagraph: Plugin<[], Root, Root> = function () {
    return (tree) => {
      tree.children.push({
        type: "paragraph",
        children: [{ type: "text", value: "plugin-injected" }],
      });
    };
  };

  const remarkPlugin: NexusPlugin = {
    name: "remark-transform",
    remarkPlugins: [appendParagraph],
  };

  // step 2: 初始化编辑器
  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "# Heading",
    plugins: [remarkPlugin],
  });
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 对比文档与 AST | [API] `editor.getDocument()` 仍为 `"# Heading"`（插件注入节点不写回源文档；getDocument 直接读 `view.state.doc.toString()`，editor.ts:732-734） | import: @floatboat/nexus-core; API: editor.getDocument(): string; 框架: vitest; 等待: 无（同步断言） |
| 2 | 再次解析验证 AST 一致性 | [AST] `getAst()` 的 children 包含注入的 paragraph，但源码不变 —— transform 是只读视图，不破坏 round-trip | import: @floatboat/nexus-core; API: editor.getAst(): Root; 框架: vitest; 等待: 无（同步断言） |

**断言汇总**:
- [API] 文档源码不受 remark 转换影响
- [AST] 转换只作用于内存 AST 视图

---

## 增强信息来源（FP-02-04）

- API签名: packages/core/src/editor.ts（getAst / exportHTML / setDocument / markdownToHtml / createTransformProcessor）
- 类型定义: packages/core/src/types.ts（EditorAPI / NexusPlugin.remarkPlugins）
- 插件参考: packages/preset-gfm/src/index.ts（createGfmPreset 的 remarkPlugins 注册模式）
- 测试参考: packages/core/test/editor.test.ts（onChange(_doc, ast) 收集 AST 断言模式）
- 陷阱提示: AGENTS.md（Testing Conventions）+ 源码契约（custom parser 时 transform 不应用）

---

## FP-02-05-N01 [P1] [Live Preview] 匹配的 AST 节点渲染为自定义 widget

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `Text\n\n\`\`\`js\nconsole.log(1)\n\`\`\``
- 插件配置: 单个插件注册 `nodeType: "code"` 的 widget
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";
  import type { NexusPlugin, WidgetDefinition } from "@floatboat/nexus-core";
  import { describe, expect, it } from "vitest";

  // step 1: 定义 code 节点 widget（渲染为带 data-widget 属性的 div）
  // 陷阱: WidgetDefinition 完整签名（types.ts:322-342）:
  //       { nodeType, match?, render(node, source, ctx?): HTMLElement, destroy?, block?, ignoreEvents? }。
  //       widget 渲染条件: nodeType 匹配 && (!match || match(node)) && 选区不与范围相交
  //       （widget-extension.ts:71-76）；渲染后自动 setAttribute("data-nexus-widget", nodeType)
  //       （widget-extension.ts:136-137）。
  const widgetPlugin: NexusPlugin = {
    name: "code-widget",
    widgets: [
      {
        nodeType: "code",
        render(node: any, source: string) {
          const el = document.createElement("div");
          el.setAttribute("data-widget", "code");
          el.textContent = source;
          return el;
        },
      },
    ],
  };

  // step 2: 初始化编辑器（初始光标 offset 0，落在 Text 段落内，不与 code 块范围相交，widget 正常渲染）
  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "Text\n\n```js\nconsole.log(1)\n```",
    plugins: [widgetPlugin],
  });
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 查询 widget DOM | [DOM] `container.querySelector("[data-widget='code']")` 不为 null | import: @floatboat/nexus-core; API: container.querySelector("[data-widget='code']"); 框架: vitest; 等待: 无（同步断言） |
| 2 | 校验 widget 标记属性 | [DOM] widget 元素带 `data-nexus-widget="code"` 属性（NexusWidget.toDOM 中自动 `el.setAttribute("data-nexus-widget", this.definition.nodeType)`，widget-extension.ts:136-137） | import: @floatboat/nexus-core; API: container.querySelector("[data-widget='code']")?.getAttribute("data-nexus-widget"); 框架: vitest; 等待: 无（同步断言） |
| 3 | 校验源码被替换 | [DOM] 容器内不再显示原始代码块文本 `console.log(1)`（源码被 widget 替换；`container.textContent` 不含 `"console.log(1)"`） | import: @floatboat/nexus-core; API: expect(container.textContent).not.toContain("console.log(1)"); 框架: vitest; 等待: 无（同步断言） |

**断言汇总**:
- [DOM] 匹配节点渲染为自定义 widget 元素
- [DOM] widget 元素自动带 `data-nexus-widget` 标记

---

## FP-02-05-N02 [P1] [Live Preview] 光标进入 widget 范围时恢复源码

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `Text\n\n\`\`\`js\nconsole.log(1)\n\`\`\``
- 插件配置: 单个插件注册 `nodeType: "code"` 的 widget
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";
  import type { NexusPlugin } from "@floatboat/nexus-core";
  import { describe, expect, it } from "vitest";

  // step 1: 定义 code 节点 widget
  const widgetPlugin: NexusPlugin = {
    name: "code-widget",
    widgets: [
      {
        nodeType: "code",
        render() {
          const el = document.createElement("div");
          el.setAttribute("data-widget", "code");
          return el;
        },
      },
    ],
  };

  // step 2: 初始化编辑器
  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "Text\n\n```js\nconsole.log(1)\n```",
    plugins: [widgetPlugin],
  });
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 确认 widget 已渲染 | [DOM] `container.querySelector("[data-widget='code']")` 不为 null | import: @floatboat/nexus-core; API: container.querySelector("[data-widget='code']"); 框架: vitest; 等待: 无（同步断言） |
| 2 | 光标移到 code 块内部：`editor.setSelection(10)`（`Text\n\n` 为 7 字符，10 落在块内） | [STATE] 触发 selection 变化（`selectionSet` → updateListener → decorations 重建，widget-extension.ts:75-76 `!selectionIntersects(from, to, selection)` 不再成立，widget 被移除） | import: @floatboat/nexus-core; API: editor.setSelection(10): void; 框架: vitest; 等待: 无（dispatch 同步触发 updateListener） |
| 3 | 验证源码恢复 | [DOM] `container.querySelector("[data-widget='code']")` 为 null，容器文本包含 `"```js"`（raw markdown 恢复） | import: @floatboat/nexus-core; API: container.querySelector("[data-widget='code']"); expect(container.textContent).toContain("```js"); 框架: vitest; 等待: 无（同步断言） |

**断言汇总**:
- [DOM] 光标与 widget 范围相交时 widget 移除、源码恢复
- [STATE] widget 对光标位置感知（进入范围即退出渲染）

---

## FP-02-05-N03 [P2] [Live Preview] match 谓词精确筛选被渲染的节点

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `Text\n\n\`\`\`mermaid\ngraph LR\n\`\`\`\n\n\`\`\`js\nconsole.log(1)\n\`\`\``
- 插件配置: 单个插件注册 `nodeType: "code"` + `match: node.lang === "mermaid"` 的 widget
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";
  import type { NexusPlugin } from "@floatboat/nexus-core";
  import { describe, expect, it } from "vitest";

  // step 1: 定义带 match 谓词的 widget（仅匹配 mermaid 代码块）
  // 陷阱: match 谓词在 collectWidgetRanges 中执行（widget-extension.ts:71-73），
  //       `(!w.match || w.match(child))` —— 不满足 match 的节点保持源码渲染。
  const widgetPlugin: NexusPlugin = {
    name: "mermaid-widget",
    widgets: [
      {
        nodeType: "code",
        match: (node: any) => node.lang === "mermaid",
        render() {
          const el = document.createElement("div");
          el.setAttribute("data-widget", "mermaid");
          return el;
        },
      },
    ],
  };

  // step 2: 初始化编辑器
  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "Text\n\n```mermaid\ngraph LR\n```\n\n```js\nconsole.log(1)\n```",
    plugins: [widgetPlugin],
  });
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 查询 mermaid widget | [DOM] `container.querySelector("[data-widget='mermaid']")` 不为 null | import: @floatboat/nexus-core; API: container.querySelector("[data-widget='mermaid']"); 框架: vitest; 等待: 无（同步断言） |
| 2 | 验证 js 代码块未被 widget 化 | [DOM] 容器文本包含 `"console.log(1)"`（match 不满足的节点保持源码渲染；`container.textContent` 含原始 js 代码） | import: @floatboat/nexus-core; API: expect(container.textContent).toContain("console.log(1)"); 框架: vitest; 等待: 无（同步断言） |

**断言汇总**:
- [DOM] match 谓词为真的节点被渲染为 widget
- [DOM] match 为假的同类型节点保持原生源码

---

## FP-02-05-E01 [P3] [Live Preview] widget 移除时调用 destroy 回调

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `Text\n\n\`\`\`js\ncode\n\`\`\``
- 插件配置: 单个插件注册带 destroy 回调的 widget
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";
  import type { NexusPlugin } from "@floatboat/nexus-core";
  import { describe, expect, it, vi } from "vitest";

  // step 1: 定义带 destroy 回调的 widget
  // 陷阱: NexusWidget.destroy(dom) 委托调用 definition.destroy?.(dom)
  //       （widget-extension.ts:140-142）；当选区进入范围导致 decoration 替换、
  //       旧 widget 被移除时触发。
  const destroyFn = vi.fn();
  const widgetPlugin: NexusPlugin = {
    name: "code-widget",
    widgets: [
      {
        nodeType: "code",
        render() {
          const el = document.createElement("div");
          el.setAttribute("data-widget", "code");
          return el;
        },
        destroy: destroyFn,
      },
    ],
  };

  // step 2: 初始化编辑器
  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "Text\n\n```js\ncode\n```",
    plugins: [widgetPlugin],
  });
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 确认 widget 已渲染 | [DOM] `container.querySelector("[data-widget='code']")` 不为 null，`destroyFn` 尚未调用（`expect(destroyFn).not.toHaveBeenCalled()`） | import: vitest; API: expect(destroyFn).not.toHaveBeenCalled(); 框架: vitest; 等待: 无（同步断言） |
| 2 | 光标移入 code 块：`editor.setSelection(10)` | [STATE] widget 被移除并触发析构（选区与 [from, to) 相交 → collectWidgetRanges 跳过该节点，widget-extension.ts:75-76） | import: @floatboat/nexus-core; API: editor.setSelection(10): void; 框架: vitest; 等待: 无（dispatch 同步触发） |
| 3 | 断言 destroy 回调 | [EVENT] `destroyFn` 被调用（`WidgetType.destroy` 钩子触发 → `definition.destroy?.(dom)`，widget-extension.ts:140-142；断言: `expect(destroyFn).toHaveBeenCalled()`） | import: vitest; API: expect(destroyFn).toHaveBeenCalled(); 框架: vitest; 等待: 无（同步断言） |

**断言汇总**:
- [EVENT] widget 元素被移除时 destroy 回调被调用（资源清理机会）

---

## FP-02-05-B01 [P4] [Live Preview] 无匹配节点的文档不渲染任何 widget

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `Just a paragraph without code blocks`
- 插件配置: 单个插件注册 `nodeType: "code"` 的 widget（文档中无 code 节点）
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";
  import type { NexusPlugin } from "@floatboat/nexus-core";
  import { describe, expect, it } from "vitest";

  // step 1: 定义 widget（但文档中没有匹配节点）
  // 陷阱: collectWidgetRanges 遍历 AST，无 nodeType 匹配节点时不产出任何
  //       WidgetRange（widget-extension.ts:57-95），编辑器仍正常渲染。
  const widgetPlugin: NexusPlugin = {
    name: "code-widget",
    widgets: [
      {
        nodeType: "code",
        render() {
          const el = document.createElement("div");
          el.setAttribute("data-widget", "code");
          return el;
        },
      },
    ],
  };

  // step 2: 初始化编辑器（文档无代码块）
  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "Just a paragraph without code blocks",
    plugins: [widgetPlugin],
  });
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 查询 widget DOM | [DOM] `container.querySelector("[data-widget='code']")` 为 null（无匹配节点不渲染） | import: @floatboat/nexus-core; API: container.querySelector("[data-widget='code']"); 框架: vitest; 等待: 无（同步断言） |
| 2 | 验证文档内容完整 | [DOM] 容器文本包含 `"Just a paragraph"`（原生渲染不受影响） | import: @floatboat/nexus-core; API: expect(container.textContent).toContain("Just a paragraph"); 框架: vitest; 等待: 无（同步断言） |

**断言汇总**:
- [DOM] 无匹配 AST 节点时不渲染任何 widget，编辑器正常工作

---

## FP-02-05-D01 [P3] [数据] render 收到的 source 参数与文档源码片段一致

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `Text\n\n\`\`\`js\nconsole.log(1)\n\`\`\``
- 插件配置: 单个插件注册 code widget，捕获 render 的 source 参数
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";
  import type { NexusPlugin } from "@floatboat/nexus-core";
  import { describe, expect, it } from "vitest";

  // step 1: 捕获 render 收到的 source 与 node
  // 陷阱: source 为 `doc.slice(from, to)`（widget-extension.ts:80），即节点在文档中
  //       的完整源码片段（code 节点含 ``` 围栏）；node 为 mdast 节点对象透传。
  let capturedSource: string | null = null;
  let capturedNode: { type?: string; lang?: string } | null = null;
  const widgetPlugin: NexusPlugin = {
    name: "code-widget",
    widgets: [
      {
        nodeType: "code",
        render(node: any, source: string) {
          capturedNode = node;
          capturedSource = source;
          const el = document.createElement("div");
          el.setAttribute("data-widget", "code");
          return el;
        },
      },
    ],
  };

  // step 2: 初始化编辑器
  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "Text\n\n```js\nconsole.log(1)\n```",
    plugins: [widgetPlugin],
  });
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 校验捕获的 source | [数据] `capturedSource === "\`\`\`js\nconsole.log(1)\n\`\`\`"`（widget 源片段与文档中节点源码完全一致，`doc.slice(from, to)`，widget-extension.ts:80） | import: vitest; API: expect(capturedSource).toBe("```js\nconsole.log(1)\n```"); 框架: vitest; 等待: 无（同步断言） |
| 2 | 校验 node 参数 | [AST] render 收到的 `node.type === "code"` 且 `node.lang === "js"`（mdast 节点对象透传，widget-extension.ts:79, 135） | import: vitest; API: expect(capturedNode?.type).toBe("code"); expect(capturedNode?.lang).toBe("js"); 框架: vitest; 等待: 无（同步断言） |

**断言汇总**:
- [数据] render 的 `source` 参数为节点在文档中的原始源码片段
- [AST] render 的 `node` 参数为对应 mdast 节点

---

## 增强信息来源（FP-02-05）

- API签名: packages/core/src/editor.ts（createEditor / setSelection）
- 类型定义: packages/core/src/types.ts（WidgetDefinition / WidgetRenderContext）
- widget 实现: packages/core/src/widget-extension.ts（collectWidgetRanges / NexusWidget.toDOM / destroy 委托）
- 测试参考: packages/core/test/editor.test.ts（widget 相关 setup 模式）
- 陷阱提示: AGENTS.md（Table Widget Development Rules 中 widget DOM 重建与 eq() 语义）+ 源码契约（选区相交不渲染）

---

## FP-02-06-N01 [P1] [插件能力] cmExtensions 中 editorAttributes 注入编辑器根节点

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `start`
- 插件配置: 单个插件 cmExtensions 含 `EditorView.editorAttributes.of({ "data-plugin": "yes" })`
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";
  import type { NexusPlugin } from "@floatboat/nexus-core";
  import { EditorView } from "@codemirror/view";
  import { describe, expect, it } from "vitest";

  // step 1: 通过 cmExtensions 注入编辑器根节点属性
  // 陷阱: cmExtensions 按 plugins.flatMap(p => p.cmExtensions ?? []) 聚合
  //       （editor.ts:249），合并进 EditorState extensions 数组（editor.ts:555-559）。
  const attrsPlugin: NexusPlugin = {
    name: "attrs-plugin",
    cmExtensions: [EditorView.editorAttributes.of({ "data-plugin": "yes" })],
  };

  // step 2: 初始化编辑器
  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "start",
    plugins: [attrsPlugin],
  });
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 查询编辑器根节点属性 | [DOM] `container.querySelector(".cm-editor")?.getAttribute("data-plugin")` 为 `"yes"`（CM6 EditorAttributes facet 在根元素应用属性） | import: @floatboat/nexus-core; API: container.querySelector(".cm-editor")?.getAttribute("data-plugin"); 框架: vitest; 等待: 无（同步断言） |
| 2 | 验证文档可读写 | [API] `editor.getDocument()` 返回 `"start"` | import: @floatboat/nexus-core; API: editor.getDocument(): string; 框架: vitest; 等待: 无（同步断言） |

**断言汇总**:
- [DOM] 插件 cmExtensions 注入的根节点属性生效

---

## FP-02-06-N02 [P1] [插件能力] cmExtensions 中 ViewPlugin 实例化并可访问编辑器状态

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `start`
- 插件配置: 单个插件 cmExtensions 含 ViewPlugin（捕获 view 实例）
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";
  import type { NexusPlugin } from "@floatboat/nexus-core";
  import { ViewPlugin, EditorView } from "@codemirror/view";
  import { describe, expect, it } from "vitest";

  // step 1: 定义捕获 view 的 ViewPlugin
  // 陷阱: ViewPlugin 在编辑器创建时实例化（editor.test.ts:291-298 参考模式:
  //       captureViewPlugin = ViewPlugin.define(v => (capturedView = v))）。
  let capturedView: EditorView | null = null;
  const captureViewPlugin = ViewPlugin.define((view) => {
    capturedView = view;
    return {};
  });

  const viewPlugin: NexusPlugin = {
    name: "view-plugin",
    cmExtensions: [captureViewPlugin],
  };

  // step 2: 初始化编辑器
  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "start",
    plugins: [viewPlugin],
  });
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言 ViewPlugin 已实例化 | [STATE] `capturedView !== null`（ViewPlugin.define 的构造函数在编辑器创建时同步执行） | import: vitest; API: expect(capturedView).not.toBeNull(); 框架: vitest; 等待: 无（同步断言） |
| 2 | 通过捕获的 view 读取文档 | [STATE] `capturedView.state.doc.toString()` 为 `"start"`（CM6 EditorView.state 反映当前文档） | import: @floatboat/nexus-core; API: expect(capturedView?.state.doc.toString()).toBe("start"); 框架: vitest; 等待: 无（同步断言） |

**断言汇总**:
- [STATE] cmExtensions 中的 ViewPlugin 随编辑器创建而实例化
- [STATE] 捕获的 EditorView 可读取文档状态

---

## FP-02-06-N03 [P1] [编辑交互] cmExtensions 中 keymap 绑定生效

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `start`
- 插件配置: 单个插件 cmExtensions 含 `keymap.of([{ key: "Mod-b", run }])`
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";
  import type { NexusPlugin } from "@floatboat/nexus-core";
  import { keymap } from "@codemirror/view";
  import { describe, expect, it } from "vitest";

  // step 1: 通过 cmExtensions 注入 CM6 keymap
  // ⚠️ 陷阱（关键发现）: CM6 keymap 的 run 回调签名是 (view: EditorView) => boolean，
  //       第一个参数是 EditorView 而非 EditorAPI！用例原 `api.setDocument("bold-toogled")`
  //       中 api 实为 view，`view.setDocument` 不存在会抛 TypeError。
  //       修正写法: view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "bold-toogled" } })。
  const keymapPlugin: NexusPlugin = {
    name: "keymap-plugin",
    cmExtensions: [
      keymap.of([
        {
          key: "Mod-b",
          run(view: any) {
            view.dispatch({
              changes: { from: 0, to: view.state.doc.length, insert: "bold-toogled" },
            });
            return true;
          },
        },
      ]),
    ],
  };

  // step 2: 初始化编辑器
  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "start",
    plugins: [keymapPlugin],
  });
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 派发 `Mod+b` 键盘事件 | [EVENT] CM6 keymap 捕获并执行（`content.dispatchEvent(new KeyboardEvent("keydown", { key: "b", metaKey: true, bubbles: true, cancelable: true }))`；参考 editor.test.ts:384-391 事件派发模式） | import: @floatboat/nexus-core; API: content.dispatchEvent(new KeyboardEvent("keydown", { key: "b", metaKey: true, bubbles: true, cancelable: true })); 框架: vitest; 等待: 无（dispatchEvent 同步触发） |
| 2 | 验证文档被修改 | [API] `editor.getDocument()` 变为 `"bold-toogled"`（keymap run 内 `view.dispatch` 走正常变更管道） | import: @floatboat/nexus-core; API: editor.getDocument(): string; 框架: vitest; 等待: 无（同步断言） |

**断言汇总**:
- [EVENT] cmExtensions 中的 keymap 绑定被键盘事件触发
- [API] keymap run 内 dispatch 修改文档生效

---

## FP-02-06-E01 [P3] [插件能力] cmExtensions 中非法 extension 导致编辑器创建失败

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `start`
- 插件配置: 单个插件 cmExtensions 含非法值（`null`）
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";
  import type { NexusPlugin } from "@floatboat/nexus-core";
  import { describe, expect, it } from "vitest";

  // step 1: cmExtensions 注入非法 extension 值
  // 陷阱: extensions 合并后交给 EditorState.create（editor.ts:545-546），
  //       CM6 对非法 extension 值抛错（flatMap 不做值校验）。
  const brokenPlugin: NexusPlugin = {
    name: "broken-extension",
    cmExtensions: [null as any],
  };

  // step 2: 初始化编辑器（CM6 校验非法 extension）
  const container = document.createElement("div");
  let editor: ReturnType<typeof createEditor> | null = null;
  let caught: unknown = null;
  try {
    editor = createEditor({
      container,
      initialValue: "start",
      plugins: [brokenPlugin],
    });
  } catch (error) {
    caught = error;
  }
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 执行 createEditor（非法 extension） | [STATE] `caught !== null`（CM6 EditorState.create 对非法 extension 值抛出异常，异常从 createEditor 向外传播） | import: vitest; API: expect(caught).not.toBeNull(); 框架: vitest; 等待: 无（同步断言） |
| 2 | 断言编辑器未创建 | [STATE] `editor === null`（无半初始化实例） | import: vitest; API: expect(editor).toBeNull(); 框架: vitest; 等待: 无（同步断言） |

**断言汇总**:
- [STATE] 非法 cmExtensions 值导致 `createEditor` 抛出异常

---

## FP-02-06-B01 [P4] [插件能力] 空 cmExtensions 数组安全注册

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `start`
- 插件配置: 单个插件 cmExtensions 为空数组
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";
  import type { NexusPlugin } from "@floatboat/nexus-core";
  import { describe, expect, it } from "vitest";

  // step 1: 空 cmExtensions
  // 陷阱: flatMap(p => p.cmExtensions ?? []) 对空数组合并后为空数组（editor.ts:249），
  //       EditorState.create 接受空 extensions，编辑器正常创建。
  const emptyPlugin: NexusPlugin = {
    name: "empty-extension",
    cmExtensions: [],
  };

  // step 2: 初始化编辑器
  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "start",
    plugins: [emptyPlugin],
  });
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 创建编辑器 | [STATE] `createEditor` 不抛出异常 | import: @floatboat/nexus-core; API: createEditor({ container, initialValue: "start", plugins: [emptyPlugin] }); 框架: vitest; 等待: 无（同步断言） |
| 2 | 验证文档 | [API] `editor.getDocument()` 返回 `"start"` | import: @floatboat/nexus-core; API: editor.getDocument(): string; 框架: vitest; 等待: 无（同步断言） |

**断言汇总**:
- [STATE] 空 cmExtensions 数组安全，编辑器正常创建

---

## FP-02-06-B02 [P4] [插件能力] 多个插件的 cmExtensions 合并生效（不覆盖）

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `start`
- 插件配置: 两个插件分别注入不同的 editorAttributes
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";
  import type { NexusPlugin } from "@floatboat/nexus-core";
  import { EditorView } from "@codemirror/view";
  import { describe, expect, it } from "vitest";

  // step 1: 两个插件分别注入不同属性
  // 陷阱: cmExtensions 按 flatMap 合并（editor.ts:249），同一 facet 多值同时保留，
  //       CM6 EditorAttributes facet 默认后注入者不覆盖先注入者（facet combine 语义）。
  const pluginOne: NexusPlugin = {
    name: "attrs-one",
    cmExtensions: [EditorView.editorAttributes.of({ "data-one": "1" })],
  };
  const pluginTwo: NexusPlugin = {
    name: "attrs-two",
    cmExtensions: [EditorView.editorAttributes.of({ "data-two": "2" })],
  };

  // step 2: 初始化编辑器
  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "start",
    plugins: [pluginOne, pluginTwo],
  });
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 校验两个属性均生效 | [DOM] `.cm-editor` 同时带 `data-one="1"` 与 `data-two="2"`（多个插件的 cmExtensions 合并注入，互不覆盖） | import: @floatboat/nexus-core; API: container.querySelector(".cm-editor")?.getAttribute("data-one"); container.querySelector(".cm-editor")?.getAttribute("data-two"); 框架: vitest; 等待: 无（同步断言） |
| 2 | 验证文档 | [API] `editor.getDocument()` 返回 `"start"` | import: @floatboat/nexus-core; API: editor.getDocument(): string; 框架: vitest; 等待: 无（同步断言） |

**断言汇总**:
- [DOM] 多插件 cmExtensions 合并生效，同一 facet 不覆盖

---

## 增强信息来源（FP-02-06）

- API签名: packages/core/src/editor.ts（createEditor / extensions 合并）
- 类型定义: packages/core/src/types.ts（NexusPlugin.cmExtensions: Extension[]）
- CM6 契约: @codemirror/view（EditorView / ViewPlugin / keymap，run 回调参数为 EditorView）
- 测试参考: packages/core/test/editor.test.ts（ViewPlugin 捕获 + 键盘事件派发模式）
- 陷阱提示: AGENTS.md（Testing Conventions）+ 源码契约（keymap run 参数类型）

---

## 全局增强信息来源汇总

- API签名: packages/core/src/editor.ts（createEditor / runShortcut / runCommand / getCommands / getSlashCommands / getAst / exportHTML / destroy / markdownToHtml）
- 类型定义: packages/core/src/types.ts（NexusPlugin / EditorConfig / EditorAPI / SlashCommandDef / SlashMenuState / WidgetDefinition / EditorCommand / EditorEventHandlers / EditorEventMap）
- 状态计算: packages/core/src/slash-state.ts（getSlashMatch / filterSlashCommands / computeSlashState）
- widget 实现: packages/core/src/widget-extension.ts（collectWidgetRanges / NexusWidget / data-nexus-widget / destroy 委托）
- 插件参考: packages/plugin-slash/src/index.ts（createSlashPlugin）、packages/plugin-toolbar/src/index.ts（createToolbarPlugin）、packages/preset-gfm/src/index.ts（createGfmPreset）
- 测试参考: packages/core/test/editor.test.ts（插件注册 / runShortcut / 键盘事件 / ViewPlugin 捕获）、packages/plugin-slash/test/plugin-slash.test.ts（filterSlashCommands / getSlashState）
- 陷阱提示: AGENTS.md（Testing Conventions：Fixture 断言应验证行为而非偶然内容；Table Widget Development Rules：多帧交互状态与 widget DOM 生命周期）
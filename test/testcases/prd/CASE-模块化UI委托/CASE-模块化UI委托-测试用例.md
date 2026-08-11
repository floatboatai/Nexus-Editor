# CASE-模块化UI委托-测试用例（FP-06）

> 一级功能点: 模块化 UI 委托（Headless 架构：core 只算数据、宿主负责渲染）
> 全局批次序号: 06
> 生成时间: 2026-08-10
> 测试框架: Vitest / jsdom（`vitest.config.ts` 已配置 `environment: "jsdom"` + `@floatboat/nexus-core` / `@floatboat/nexus-plugin-slash` 别名）
>
> 涉及二级功能点:
> - FP-06-01 core 只计算坐标(BoundingClientRect)+选区状态（不渲染 UI）（[UI委托]）
> - FP-06-02 editor.on('slashMenuChange') 状态订阅（[API契约]）
> - FP-06-03 宿主渲染绝对定位组件（解决 overflow 截断）（[UI委托][宿主集成]）

> ⚠️ 实现差异提示（影响前置条件，均以 `packages/core` 实际代码为准）:
> - `slashMenuChange` 仅在**注册了 `slashCommands` 的插件**时才会 emit（`packages/core/src/editor.ts:634` `if (slashCommands.length > 0)`）。未注册任何 slash 命令时，即使输入 `/` 也不会触发该事件（FP-06-01-E01 专门覆盖）。
> - 触发方式统一为 `editor.setDocument(...)` + `editor.setSelection(...)`（与 `packages/core/test/events.test.ts` 既有测试一致）。两者各产生一次 CM6 update（docChanged / selectionSet），`updateListener` 对每次 update 各 emit 一次 → 一次"设置文档+定位光标"通常触发 **2 次**回调，断言一律用 `handler.mock.calls[handler.mock.calls.length - 1][0]`（末次载荷）或"至少调用/包含"语义，禁止断言精确次数（FP-06-02-E02 除外，其精确次数是去重语义的判定依据）。
> - `coords` 字段来源于 `view.coordsAtPos(state.from)`（BoundingClientRect 计算，`editor.ts:639-648`，try-catch 包裹）。jsdom 无真实布局，`coordsAtPos` 返回 null → **jsdom 环境下 `coords === null` 属合法降级**，非 null 时结构为 `{ left, top, bottom }`（无 right，与 BoundingClientRect 兼容子集）。
> - 事件订阅基于 `packages/core/src/event-emitter.ts` 的 `EventEmitter`：内部用 `Set` 存储 → **同一 handler 重复 `on` 会去重只回调一次**；`off` 对未注册 handler 幂等安全（`set.delete` 不存在即 no-op）。
> - 宿主侧参考实现为 `@floatboat/nexus-plugin-slash` 的 `createSlashMenuUI`（`packages/plugin-slash/src/menu-ui.ts`）：`position: fixed`、默认挂载 `document.body`、支持自定义 `container`（HTMLElement | ShadowRoot），从而脱离编辑器容器的 `overflow` 约束。
> - 菜单根元素类名为 `${classPrefix}-menu`，默认 classPrefix 为 `"nexus-slash"` → **实际类名为 `nexus-slash-menu`**（`menu-ui.ts:89,97`）。用例中的 `document.querySelector(".nexus-slash")` 断言（不存在 `class="nexus-slash"` 的元素）成立，但更精确的选择器应使用 `.nexus-slash-menu`。
> - `createSlashMenuUI` 的定位基于 `state.coords`：`root.style.top = ${bottom + offset}px`（offset 默认 4，`menu-ui.ts:76,234`）；coords 为 null 时仅显示菜单、不移动位置（`menu-ui.ts:230-231`），可见性不依赖坐标。
> - `destroy()` 会执行 `emitter.clear()`（`editor.ts:965`）并令 updateListener 短路（`editor.ts:621` `!destroyed`），此后 `setDocument`/`setSelection` 不再触发任何事件（既有测试 `packages/plugin-slash/test/menu-ui.test.ts:160` 亦验证 destroy 后 open 不抛错）。

---

## FP-06-01-N01 [P1] [正常] 输入斜杠触发坐标+选区状态计算并 emit，core 不创建任何菜单 DOM

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `""`（空文档）
- 插件配置: `[{ name: "test", slashCommands: commands }]`（注册 2 个 slash 命令）
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  // ⚠️ 陷阱: slashMenuChange 仅在 slashCommands.length > 0 时 emit（editor.ts:634）
  // ⚠️ 陷阱: setDocument + setSelection 各产生一次 CM6 update，各 emit 一次（editor.ts:621）→ 共 2 次回调，断言必须取末次载荷
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor, type SlashCommandDef, type SlashMenuState } from "@floatboat/nexus-core";
  // import 来源: packages/core/src/index.ts 重新导出（源码: editor.ts/types.ts）

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const container = document.createElement("div");
  const handler = vi.fn();
  const commands: SlashCommandDef[] = [
    { id: "heading", title: "Heading", keywords: ["h1", "title"] },
    { id: "table", title: "Table", keywords: ["grid"] },
  ];
  const editor = createEditor({
    container,
    initialValue: "",
    plugins: [{ name: "test", slashCommands: commands }],
  });
  editor.on("slashMenuChange", handler); // editor.ts:895-897 → emitter.on（Set 存储）
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | `editor.setDocument("/")` | [STATE] docChanged update 触发一次 slash 状态计算（editor.ts:621 `update.docChanged` 分支，634 行 `slashCommands.length > 0` 成立）；空 query 时 `filterSlashCommands` 返回全部命令且保持注册序（slash-state.ts:122-127） | import: @floatboat/nexus-core; API: editor.setDocument(doc: string, opts?: SetDocumentOptions); 框架: vitest; 等待: 同步（CM6 dispatch 后 updateListener 立即执行，editor.ts:583-652，无需异步等待） |
| 2 | `editor.setSelection(1)` | [STATE] selectionSet update 再次计算（editor.ts:621 `update.selectionSet` 分支），光标落于斜杠之后；`getSlashMatch` 取 `to = cursor = 1`（slash-state.ts:60） | import: @floatboat/nexus-core; API: editor.setSelection(anchor: number, head?: number); 框架: vitest; 等待: 同步（selectionSet update 触发 updateListener） |
| 3 | 取末次载荷 `const last = handler.mock.calls[handler.mock.calls.length - 1][0]` 并断言 | [EVENT] `last.isOpen === true`，`last.from === 0`，`last.to === 1`，`last.query === ""`（空 query 打开菜单）；载荷结构为 `SlashMenuState`（types.ts:123-130）：`{ isOpen, from, to, query, commands, coords }`，coords 为 `{left,top,bottom} | null` | import: @floatboat/nexus-core; API: expect(handler).toHaveBeenCalled() + handler.mock.calls[...][0]（SlashMenuState 载荷，types.ts:150 slashMenuChange 签名）; 框架: vitest; 等待: 无 |
| 4 | 断言 `container.querySelectorAll("*").length` 与触发前一致 | [STATE] 编辑器容器 DOM 未因 slash 状态变化新增任何节点（core 不渲染菜单 UI）——updateListener 只 emit 事件、零 DOM 写入（editor.ts:650 仅 `emitter.emit`） | import: @floatboat/nexus-core; API: expect(container.querySelectorAll("*")).toHaveLength(before); 框架: vitest; 等待: 无 |

**断言汇总**:
- [EVENT] 末次 `slashMenuChange` 载荷 `isOpen === true`、`from === 0`、`to === 1`、`query === ""`
- [STATE] 触发前后 `container` 内节点数量不变（core 零 UI 渲染）

---

## FP-06-01-N02 [P1] [正常] 状态载荷携带 coords 字段（BoundingClientRect 契约），jsdom 无布局时 null 降级合法

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `""`
- 插件配置: `[{ name: "test", slashCommands: commands }]`
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  // ⚠️ 陷阱: coords 来源为 update.view.coordsAtPos(state.from)（editor.ts:643-646），
  //         jsdom 无真实布局 → coordsAtPos 返回 null → coords 保持 null（try-catch 包裹，raw falsy 不赋值）
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor, type SlashCommandDef } from "@floatboat/nexus-core";
  // import 来源: packages/core/src/index.ts 重新导出（源码: editor.ts/types.ts）

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const container = document.createElement("div");
  const handler = vi.fn();
  const commands: SlashCommandDef[] = [
    { id: "heading", title: "Heading", keywords: ["h1"] },
  ];
  const editor = createEditor({
    container,
    initialValue: "",
    plugins: [{ name: "test", slashCommands: commands }],
  });
  editor.on("slashMenuChange", handler);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | `editor.setDocument("/hea")` + `editor.setSelection(4)` | [STATE] 打开菜单，命中 heading 命令（`"heading"` 标题前缀匹配 `"hea"`，score=5000 title-prefix 档，slash-state.ts:82-85） | import: @floatboat/nexus-core; API: editor.setDocument(doc) + editor.setSelection(4); 框架: vitest; 等待: 同步（共 2 次 update → 2 次 emit） |
| 2 | 断言末次载荷包含 `coords` 键 | [EVENT] 载荷含 `coords` 字段（`"coords" in last === true`），坐标来源为 `view.coordsAtPos` 的 BoundingClientRect 计算（editor.ts:643 `update.view.coordsAtPos(state.from)`，非 null 时取 `{ left: raw.left, top: raw.top, bottom: raw.bottom }`，editor.ts:645） | import: @floatboat/nexus-core; API: expect(last).toHaveProperty("coords"); 框架: vitest; 等待: 无 |
| 3 | 断言 `last.coords` | [STATE] jsdom 无布局环境 `last.coords === null`（合法降级，不阻断状态推送）；若非 null 则结构为 `{ left, top, bottom }` 且三值均为 number（types.ts:129 类型契约） | import: @floatboat/nexus-core; API: expect(last.coords).toBeNull()（jsdom）; 框架: vitest; 等待: 无 |
| 4 | 断言 `last.from === 1`、`last.to === 4`、`last.query === "hea"` | [EVENT] 选区范围与查询文本计算正确（from 为斜杠位置）：`getSlashMatch` 返回 `{ from: lineStart + slashIndex, to: cursor, query }`（slash-state.ts:58-62） | import: @floatboat/nexus-core; API: expect(last).toMatchObject({ from: 1, to: 4, query: "hea" }); 框架: vitest; 等待: 无 |

**断言汇总**:
- [EVENT] 载荷包含 `coords` 键（`"coords" in last === true`）
- [STATE] `coords === null`（jsdom）或 `{ left: number, top: number, bottom: number }`
- [EVENT] `from === 1`、`to === 4`、`query === "hea"`

---

## FP-06-01-N03 [P1] [正常] core 零 UI 渲染：slash 状态变化不改变编辑器容器与 body 的 DOM

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `""`
- 插件配置: `[{ name: "test", slashCommands: commands }]`
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  // ⚠️ 陷阱: 菜单根元素类名为 `nexus-slash-menu`（menu-ui.ts:97 `${prefix}-menu`，默认 prefix "nexus-slash"），
  //         断言 "core 无菜单 DOM" 用 `.nexus-slash-menu` 更精确；`.nexus-slash` 只会恒为 null（无该独立类名）
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor, type SlashCommandDef } from "@floatboat/nexus-core";
  // import 来源: packages/core/src/index.ts 重新导出（源码: editor.ts/types.ts）

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const container = document.createElement("div");
  document.body.appendChild(container);
  const handler = vi.fn();
  const commands: SlashCommandDef[] = [
    { id: "heading", title: "Heading", keywords: ["h1"] },
  ];
  const editor = createEditor({
    container,
    initialValue: "",
    plugins: [{ name: "test", slashCommands: commands }],
  });
  editor.on("slashMenuChange", handler);

  // 触发前快照
  const beforeInnerHTML = container.innerHTML;
  const beforeContainerNodes = container.querySelectorAll("*").length;
  const beforeBodyChildren = document.body.children.length;
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | `editor.setDocument("/he")` + `editor.setSelection(3)`，等待回调触发 | [EVENT] handler 被调用，末次载荷 `isOpen === true`（editor.ts:650 emit `{ ...state, coords }`）；共 2 次 update → 至少 2 次回调 | import: @floatboat/nexus-core; API: editor.setDocument(doc) + editor.setSelection(3) + expect(handler).toHaveBeenCalled(); 框架: vitest; 等待: 同步（updateListener 同步执行） |
| 2 | 断言 `container.innerHTML` 与触发前快照一致 | [STATE] 编辑器容器 DOM 结构完全不变（无菜单容器、无定位层注入）——updateListener 仅 emit 事件，无任何 DOM 写入（editor.ts:650） | import: @floatboat/nexus-core; API: expect(container.innerHTML).toBe(beforeInnerHTML); 框架: vitest; 等待: 无 |
| 3 | 断言 `container.querySelectorAll("*").length === beforeContainerNodes` | [STATE] 容器内节点数量不变 | import: @floatboat/nexus-core; API: expect(container.querySelectorAll("*")).toHaveLength(beforeContainerNodes); 框架: vitest; 等待: 无 |
| 4 | 断言 `document.body.children.length === beforeBodyChildren` 且 `document.querySelector(".nexus-slash") === null` | [STATE] body 无新增子节点、无任何 slash 菜单元素——UI 完全委托给宿主；精确断言可改查 `.nexus-slash-menu`（menu-ui.ts:97 类名）同样为 null（core 包从不创建该 DOM） | import: @floatboat/nexus-core; API: expect(document.body.children).toHaveLength(beforeBodyChildren) + expect(document.querySelector(".nexus-slash-menu")).toBeNull(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [STATE] 触发前后 `container.innerHTML` 完全一致
- [STATE] 容器与 body 节点数量不变，`document.querySelector(".nexus-slash")` 为 null（core 零 UI 渲染）

---

## FP-06-01-N04 [P2] [正常] 选区状态与 slash 状态一致：selectionChange 与 slashMenuChange 位置信息互相对应

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `""`
- 插件配置: `[{ name: "test", slashCommands: commands }]`
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  // ⚠️ 陷阱: selectionChange 载荷为 { anchor, head, ranges, mainIndex }（editor.ts:626-631），
  //         types.ts:149 声明为 `{ anchor, head } & SelectionState`；既有测试见 events.test.ts:37-50
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor, type SlashCommandDef } from "@floatboat/nexus-core";
  // import 来源: packages/core/src/index.ts 重新导出（源码: editor.ts/types.ts）

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const container = document.createElement("div");
  const slashHandler = vi.fn();
  const selectionHandler = vi.fn();
  const commands: SlashCommandDef[] = [
    { id: "heading", title: "Heading", keywords: ["h1"] },
  ];
  const editor = createEditor({
    container,
    initialValue: "",
    plugins: [{ name: "test", slashCommands: commands }],
  });
  editor.on("slashMenuChange", slashHandler);
  editor.on("selectionChange", selectionHandler); // editor.ts:626-631 emit
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | `editor.setDocument("hi /he")`（斜杠前为空白，满足行内触发条件） | [STATE] 文档更新，slash 状态计算开启；`getSlashMatch` 判定斜杠前字符为空格（`charBefore.trim() === ""`，slash-state.ts:50-51）→ 合法触发 | import: @floatboat/nexus-core; API: editor.setDocument(doc); 框架: vitest; 等待: 同步（docChanged update） |
| 2 | `editor.setSelection(6)`（光标移至 `/he` 之后） | [STATE] 选区更新，selectionChange 与 slashMenuChange 各自推送（editor.ts:621 同一 update 内依次 emit：626 行 selectionChange → 650 行 slashMenuChange） | import: @floatboat/nexus-core; API: editor.setSelection(anchor: number, head?: number); 框架: vitest; 等待: 同步（selectionSet update） |
| 3 | 断言末次 `selectionChange` 载荷 | [EVENT] `selectionHandler` 末次载荷 `{ anchor: 6, head: 6, ranges: [{ anchor: 6, head: 6 }], mainIndex: 0 }`（collapsed 选区，载荷结构见 editor.ts:626-631 + events.test.ts:45-49） | import: @floatboat/nexus-core; API: expect(selectionHandler.mock.calls.at(-1)[0]).toMatchObject({ anchor: 6, head: 6 }); 框架: vitest; 等待: 无 |
| 4 | 断言末次 `slashMenuChange` 载荷 | [EVENT] `last.from === 3`、`last.to === 6`、`last.query === "he"`——slash 范围末端与光标位置一致（`to === selection.head`，slash-state.ts:60 `to: cursor`），证明"坐标+选区状态"由 core 统一计算 | import: @floatboat/nexus-core; API: expect(slashHandler.mock.calls.at(-1)[0]).toMatchObject({ from: 3, to: 6, query: "he" }); 框架: vitest; 等待: 无 |

**断言汇总**:
- [EVENT] 末次 `selectionChange` 载荷 `anchor === 6`、`head === 6`
- [EVENT] 末次 `slashMenuChange` 载荷 `from === 3`、`to === 6`、`query === "he"`，且 `to === selection.head`

---

## FP-06-01-F01 [P2] [流程] 输入→光标移出→移回：菜单状态随光标生命周期开/关

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `""`
- 插件配置: `[{ name: "test", slashCommands: commands }]`
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  // ⚠️ 陷阱: 关闭态载荷固定为 { isOpen: false, from: null, to: null, query: "", commands: [] }（slash-state.ts:161），
  //         coords 由 editor.ts:650 附加（关闭态 coords 恒为 null——isOpen=false 时 641 行条件不成立，coords 不计算）
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor, type SlashCommandDef } from "@floatboat/nexus-core";
  // import 来源: packages/core/src/index.ts 重新导出（源码: editor.ts/types.ts）

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const container = document.createElement("div");
  const handler = vi.fn();
  const commands: SlashCommandDef[] = [
    { id: "heading", title: "Heading", keywords: ["h1"] },
    { id: "table", title: "Table", keywords: ["grid"] },
  ];
  const editor = createEditor({
    container,
    initialValue: "",
    plugins: [{ name: "test", slashCommands: commands }],
  });
  editor.on("slashMenuChange", handler);

  function last(): any {
    return handler.mock.calls[handler.mock.calls.length - 1][0];
  }
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | `editor.setDocument("/he")` + `editor.setSelection(3)` | [STATE] 菜单打开，`last().isOpen === true`、`query === "he"`（getSlashMatch 返回 query "he"，slash-state.ts:53） | import: @floatboat/nexus-core; API: editor.setDocument(doc) + editor.setSelection(3); 框架: vitest; 等待: 同步 |
| 2 | `editor.setDocument("plain text")` + `editor.setSelection(11)`（光标移出 slash 触发区） | [STATE] 关闭推送，`last().isOpen === false`、`commands.length === 0`（getSlashMatch 无斜杠 → null → 关闭态载荷，slash-state.ts:159-161） | import: @floatboat/nexus-core; API: editor.setDocument(doc) + editor.setSelection(11); 框架: vitest; 等待: 同步 |
| 3 | `editor.setDocument("/h")` + `editor.setSelection(2)`（重新输入斜杠） | [STATE] 重新打开，`last().isOpen === true`、`query === "h"`、`from === 0`、`to === 2`（行首斜杠，from = lineStart + slashIndex = 0，slash-state.ts:59） | import: @floatboat/nexus-core; API: editor.setDocument(doc) + editor.setSelection(2); 框架: vitest; 等待: 同步 |
| 4 | 断言回调序列 | [EVENT] 调用序列中同时存在 `isOpen === true` 与 `isOpen === false` 的载荷（`handler.mock.calls.some(c => c[0].isOpen === true)` 且 `some(c => c[0].isOpen === false)`），状态机随光标生命周期切换 | import: @floatboat/nexus-core; API: expect(handler.mock.calls.some(...)); 框架: vitest; 等待: 无 |

**断言汇总**:
- [STATE] 打开态 `last().isOpen === true` 且携带正确 `from/to/query`
- [STATE] 移出后 `last().isOpen === false` 且 `commands` 为空
- [EVENT] 回调序列中 open / closed 两种载荷均出现（≥1 次各）

---

## FP-06-01-E01 [P3] [异常] 未注册任何 slashCommands 时不 emit（无命令源不打扰宿主）

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `""`
- 插件配置: 无（不注册任何 slash 命令）
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  // ⚠️ 陷阱: emit 被 editor.ts:634 `if (slashCommands.length > 0)` 门控——plugins: [] 时
  //         slashCommands 为空数组 → 整个 slash 分支跳过，handler 永不被调用
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor } from "@floatboat/nexus-core";
  // import 来源: packages/core/src/index.ts 重新导出（源码: editor.ts）

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const container = document.createElement("div");
  const handler = vi.fn();
  const editor = createEditor({
    container,
    initialValue: "",
    plugins: [],
  });
  editor.on("slashMenuChange", handler);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | `editor.setDocument("/")` + `editor.setSelection(1)` | [STATE] 文档与选区正常更新（编辑器功能不受影响）——updateListener 仍处理 docChanged/selectionSet 分支（editor.ts:621），仅 slash 分支被跳过 | import: @floatboat/nexus-core; API: editor.setDocument(doc) + editor.setSelection(1); 框架: vitest; 等待: 同步 |
| 2 | 断言 `handler` | [EVENT] `expect(handler).not.toHaveBeenCalled()`——`slashCommands.length === 0` 时 core 完全静默（editor.ts:634 门控），宿主无需处理 | import: @floatboat/nexus-core; API: expect(handler).not.toHaveBeenCalled(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [EVENT] `handler` 未被调用（无 slash 命令源时事件不触发）

---

## FP-06-01-E02 [P3] [异常] 行内 URL/路径中的斜杠（前导非空白字符）不触发 slash 匹配

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `""`
- 插件配置: `[{ name: "test", slashCommands: commands }]`
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  // ⚠️ 陷阱: getSlashMatch 检查斜杠前字符：非空白则视为 URL/路径/分数等 token 的一部分
  //         （slash-state.ts:50-51 `charBefore !== undefined && charBefore.trim() !== ""` → return null）
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor, type SlashCommandDef } from "@floatboat/nexus-core";
  // import 来源: packages/core/src/index.ts 重新导出（源码: editor.ts/types.ts）

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const container = document.createElement("div");
  const handler = vi.fn();
  const commands: SlashCommandDef[] = [
    { id: "heading", title: "Heading", keywords: ["h1"] },
  ];
  const editor = createEditor({
    container,
    initialValue: "",
    plugins: [{ name: "test", slashCommands: commands }],
  });
  editor.on("slashMenuChange", handler);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | `editor.setDocument("http://example.com")` + `editor.setSelection(19)`（光标位于行尾，斜杠前导字符为 `:`） | [STATE] `getSlashMatch` 判定斜杠前非空白字符（`:` 的 trim 非空，slash-state.ts:51）→ 不构成命令触发 | import: @floatboat/nexus-core; API: editor.setDocument(doc) + editor.setSelection(19); 框架: vitest; 等待: 同步 |
| 2 | 断言末次载荷 | [EVENT] `last.isOpen === false`、`from === null`、`to === null`、`query === ""`（关闭态载荷，slash-state.ts:161）——URL 中的斜杠不误触发菜单 | import: @floatboat/nexus-core; API: expect(last).toEqual({ isOpen: false, from: null, to: null, query: "", commands: [], coords: null }); 框架: vitest; 等待: 无 |

**断言汇总**:
- [EVENT] 末次载荷 `isOpen === false`、`from/to === null`、`query === ""`

---

## FP-06-01-E03 [P3] [异常] query 含空白字符时菜单关闭（isOpen=false）

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `""`
- 插件配置: `[{ name: "test", slashCommands: commands }]`
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  // ⚠️ 陷阱: query 内空白直接关闭菜单——slash-state.ts:56 `if (/\s/.test(query)) return null`，
  //         语义为"用户已输入命令之外的文本"，不进入 filterSlashCommands 匹配
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor, type SlashCommandDef } from "@floatboat/nexus-core";
  // import 来源: packages/core/src/index.ts 重新导出（源码: editor.ts/types.ts）

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const container = document.createElement("div");
  const handler = vi.fn();
  const commands: SlashCommandDef[] = [
    { id: "heading", title: "Heading", keywords: ["h1"] },
  ];
  const editor = createEditor({
    container,
    initialValue: "",
    plugins: [{ name: "test", slashCommands: commands }],
  });
  editor.on("slashMenuChange", handler);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | `editor.setDocument("/he a")`（query 中含空格） | [STATE] `getSlashMatch` 检测到 query 内空白（`/\s/.test("he a")` 为 true，slash-state.ts:56）→ 判定用户已输入命令之外的文本，返回 null | import: @floatboat/nexus-core; API: editor.setDocument(doc); 框架: vitest; 等待: 同步（docChanged update） |
| 2 | `editor.setSelection(5)` | [STATE] 光标位于行尾，处于触发区内但 query 含空白 → 二次计算仍返回关闭态（computeSlashState 对每次 update 独立计算，slash-state.ts:153-161） | import: @floatboat/nexus-core; API: editor.setSelection(anchor: number, head?: number); 框架: vitest; 等待: 同步（selectionSet update） |
| 3 | 断言末次载荷 | [EVENT] `last.isOpen === false`、`commands.length === 0`（关闭态载荷，slash-state.ts:161）——含空白的模糊文本不匹配任何命令 | import: @floatboat/nexus-core; API: expect(last.isOpen).toBe(false) + expect(last.commands).toHaveLength(0); 框架: vitest; 等待: 无 |

**断言汇总**:
- [EVENT] 末次载荷 `isOpen === false`、`commands` 为空数组

---

## FP-06-01-B01 [P4] [边界] 光标位于文档首字符（doc="/"）时 from=0/to=1

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `""`
- 插件配置: `[{ name: "test", slashCommands: commands }]`
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  // ⚠️ 陷阱: 空 query（""）时 filterSlashCommands 返回 commands.slice()（slash-state.ts:122-127），
  //         保持插件注册顺序、不做排序 → 2 条命令按注册序 ["heading", "table"]
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor, type SlashCommandDef } from "@floatboat/nexus-core";
  // import 来源: packages/core/src/index.ts 重新导出（源码: editor.ts/types.ts）

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const container = document.createElement("div");
  const handler = vi.fn();
  const commands: SlashCommandDef[] = [
    { id: "heading", title: "Heading", keywords: ["h1"] },
    { id: "table", title: "Table", keywords: ["grid"] },
  ];
  const editor = createEditor({
    container,
    initialValue: "",
    plugins: [{ name: "test", slashCommands: commands }],
  });
  editor.on("slashMenuChange", handler);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | `editor.setDocument("/")`（文档仅一个斜杠字符） | [STATE] 行首斜杠 + 空 query，菜单应打开（getSlashMatch：lineStart=0、slashIndex=0、query=""、无空白 → 匹配，slash-state.ts:40-63） | import: @floatboat/nexus-core; API: editor.setDocument(doc); 框架: vitest; 等待: 同步 |
| 2 | `editor.setSelection(1)`（光标在位置 1，即斜杠之后） | [STATE] 光标处于触发区末端，`to = cursor = 1`（slash-state.ts:60） | import: @floatboat/nexus-core; API: editor.setSelection(anchor: number, head?: number); 框架: vitest; 等待: 同步 |
| 3 | 断言末次载荷 | [EVENT] `last.isOpen === true`、`from === 0`、`to === 1`、`query === ""`——文档最左侧边界的 from/to 精确为 [0, 1]（from = lineStart + slashIndex = 0，slash-state.ts:59） | import: @floatboat/nexus-core; API: expect(last).toMatchObject({ isOpen: true, from: 0, to: 1, query: "" }); 框架: vitest; 等待: 无 |
| 4 | 断言 `last.commands.length` | [EVENT] 空 query 返回全部注册命令（按注册顺序，2 条）——filterSlashCommands 空 query 分支返回 `commands.slice()`（slash-state.ts:122-127） | import: @floatboat/nexus-core; API: expect(last.commands).toHaveLength(2); 框架: vitest; 等待: 无 |

**断言汇总**:
- [EVENT] `isOpen === true`、`from === 0`、`to === 1`、`query === ""`
- [EVENT] `commands.length === 2`（空 query 保持注册顺序返回全部）

---

## FP-06-01-B02 [P4] [边界] 多行文档仅当前行行首斜杠触发，跨行 from 偏移正确

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `""`
- 插件配置: `[{ name: "test", slashCommands: commands }]`
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  // ⚠️ 陷阱: getSlashMatch 的 from 为全文档绝对偏移 = lineStart + slashIndex
  //         （lineStart = before.lastIndexOf("\n") + 1，slash-state.ts:42,59），
  //         多行场景必须加行偏移，不能直接用行内偏移
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor, type SlashCommandDef } from "@floatboat/nexus-core";
  // import 来源: packages/core/src/index.ts 重新导出（源码: editor.ts/types.ts）

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const container = document.createElement("div");
  const handler = vi.fn();
  const commands: SlashCommandDef[] = [
    { id: "heading", title: "Heading", keywords: ["h1"] },
  ];
  const editor = createEditor({
    container,
    initialValue: "",
    plugins: [{ name: "test", slashCommands: commands }],
  });
  editor.on("slashMenuChange", handler);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | `editor.setDocument("foo\n/hea")`（第二行行首为斜杠） | [STATE] 换行后行首斜杠是合法触发点（`before.lastIndexOf("\n") + 1 = 4` 为第二行行首，slash-state.ts:42） | import: @floatboat/nexus-core; API: editor.setDocument(doc); 框架: vitest; 等待: 同步 |
| 2 | `editor.setSelection(8)`（光标在 `/hea` 之后，即 doc 末尾） | [STATE] 行内匹配：`lineStart = 4`，斜杠位于该行 0 偏移（slashIndex = 0）；query = "hea" 无空白 → 匹配（slash-state.ts:40-63） | import: @floatboat/nexus-core; API: editor.setSelection(anchor: number, head?: number); 框架: vitest; 等待: 同步 |
| 3 | 断言末次载荷 | [EVENT] `last.isOpen === true`、`from === 4`、`to === 8`、`query === "hea"`——from 为全文档绝对偏移（含跨行偏移 4，from = lineStart + slashIndex = 4 + 0），非行内偏移（slash-state.ts:59） | import: @floatboat/nexus-core; API: expect(last).toMatchObject({ isOpen: true, from: 4, to: 8, query: "hea" }); 框架: vitest; 等待: 无 |

**断言汇总**:
- [EVENT] 末次载荷 `isOpen === true`、`from === 4`、`to === 8`、`query === "hea"`（跨行绝对偏移正确）

---

## FP-06-01-D01 [P5] [数据] coords 数据契约：字段存在且为 null 或 {left, top, bottom} 三数值

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `""`
- 插件配置: `[{ name: "test", slashCommands: commands }]`
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  // ⚠️ 陷阱: coords 键在所有载荷中恒存在（editor.ts:650 始终 `{ ...state, coords }` 展开）；
  //         关闭态（isOpen=false 或 from=null）时 641 行条件不成立 → coords 保持 null
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor, type SlashCommandDef } from "@floatboat/nexus-core";
  // import 来源: packages/core/src/index.ts 重新导出（源码: editor.ts/types.ts）

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const container = document.createElement("div");
  const handler = vi.fn();
  const commands: SlashCommandDef[] = [
    { id: "heading", title: "Heading", keywords: ["h1"] },
  ];
  const editor = createEditor({
    container,
    initialValue: "",
    plugins: [{ name: "test", slashCommands: commands }],
  });
  editor.on("slashMenuChange", handler);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | `editor.setDocument("/he")` + `editor.setSelection(3)`，打开菜单 | [STATE] 载荷中 `coords` 键始终存在（editor.ts:650 `emitter.emit("slashMenuChange", { ...state, coords })` 无条件展开 coords 字段） | import: @floatboat/nexus-core; API: editor.setDocument(doc) + editor.setSelection(3); 框架: vitest; 等待: 同步 |
| 2 | 断言 coords 类型契约 | [D] `last.coords === null`（jsdom 无布局，editor.ts:643-646 `coordsAtPos` 返回 null）或 `typeof last.coords.left === "number" && typeof last.coords.top === "number" && typeof last.coords.bottom === "number"`，且 `!Number.isNaN(...)`（类型契约 types.ts:129） | import: @floatboat/nexus-core; API: expect(typeof last.coords.left).toBe("number")（非 null 分支）; 框架: vitest; 等待: 无 |
| 3 | 断言 `"coords" in last` 在 open / closed 两种载荷中均成立 | [D] 打开态与关闭态载荷结构一致（关闭态 coords 为 null——641 行 `state.isOpen && state.from !== null` 不成立，不计算坐标）——宿主可无差别消费该字段 | import: @floatboat/nexus-core; API: expect("coords" in last).toBe(true); 框架: vitest; 等待: 无 |

**断言汇总**:
- [D] `"coords" in last === true`（open 与 closed 载荷均含）
- [D] `coords === null` 或 `{ left: number, top: number, bottom: number }`（有限数值）

---

## 增强信息来源
- 事件发射: packages/core/src/editor.ts + event-emitter.ts
- 状态计算: packages/core/src/slash-state.ts
- 类型定义: packages/core/src/types.ts
- 测试参考: packages/core/test/events.test.ts + slash-state.test.ts
- 陷阱提示: AGENTS.md

---

## FP-06-02-N01 [P1] [正常] on 订阅后输入触发回调，载荷为完整 SlashMenuState（六字段齐备）

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `""`
- 插件配置: `[{ name: "test", slashCommands: commands }]`
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  // ⚠️ 陷阱: SlashMenuState 六字段: isOpen: boolean / from: number|null / to: number|null /
  //         query: string / commands: SlashCommandDef[] / coords: {left,top,bottom}|null（types.ts:123-130）
  // ⚠️ 陷阱: on() 内部为 EventEmitter Set 存储（event-emitter.ts:4-11），同一 handler 重复 on 只保留一份
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor, type SlashCommandDef } from "@floatboat/nexus-core";
  // import 来源: packages/core/src/index.ts 重新导出（源码: editor.ts/types.ts）

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const container = document.createElement("div");
  const handler = vi.fn();
  const commands: SlashCommandDef[] = [
    { id: "heading", title: "Heading", keywords: ["h1", "title"] },
    { id: "table", title: "Table", keywords: ["grid"] },
  ];
  const editor = createEditor({
    container,
    initialValue: "",
    plugins: [{ name: "test", slashCommands: commands }],
  });
  editor.on("slashMenuChange", handler);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | `editor.setDocument("/hea")` + `editor.setSelection(4)` | [STATE] 命中 heading 命令（`"heading"` title 前缀匹配 `"hea"`，title-prefix 档 score=5000，slash-state.ts:82-85）；2 次 update → 2 次 emit | import: @floatboat/nexus-core; API: editor.setDocument(doc) + editor.setSelection(4); 框架: vitest; 等待: 同步（2 次 update 各触发一次 updateListener） |
| 2 | 断言 `handler` 至少被调用一次 | [EVENT] `expect(handler).toHaveBeenCalled()` | import: @floatboat/nexus-core; API: expect(handler).toHaveBeenCalled(); 框架: vitest; 等待: 无 |
| 3 | 取末次载荷 `last`，逐一断言六字段存在 | [EVENT] `typeof last.isOpen === "boolean"`；`typeof last.from === "number"`；`typeof last.to === "number"`；`typeof last.query === "string"`；`Array.isArray(last.commands)`；`"coords" in last`——六字段契约对应 types.ts:123-130 | import: @floatboat/nexus-core; API: expect(typeof last.isOpen).toBe("boolean") 等（SlashMenuState 六字段逐一断言）; 框架: vitest; 等待: 无 |
| 4 | 断言核心值 | [EVENT] `last.isOpen === true`、`last.query === "hea"`、`last.commands.length === 1` 且 `last.commands[0].id === "heading"`（scoreCommand 返回非 null 仅 heading 一条，slash-state.ts:72-116） | import: @floatboat/nexus-core; API: expect(last.commands[0].id).toBe("heading"); 框架: vitest; 等待: 无 |

**断言汇总**:
- [EVENT] `handler` 被调用，末次载荷 `isOpen === true`、`query === "hea"`、`commands[0].id === "heading"`
- [EVENT] 载荷六字段（isOpen/from/to/query/commands/coords）类型齐备

---

## FP-06-02-N02 [P1] [正常] off 取消订阅后不再回调

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `""`
- 插件配置: `[{ name: "test", slashCommands: commands }]`
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  // ⚠️ 陷阱: off() = emitter.off → `listeners.get(event)?.delete(handler)`（event-emitter.ts:13-15），
  //         Set.delete 对已注册 handler 生效；emit 遍历 Set（event-emitter.ts:17-24）不再包含该 handler
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor, type SlashCommandDef } from "@floatboat/nexus-core";
  // import 来源: packages/core/src/index.ts 重新导出（源码: editor.ts/types.ts）

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const container = document.createElement("div");
  const handler = vi.fn();
  const commands: SlashCommandDef[] = [
    { id: "heading", title: "Heading", keywords: ["h1"] },
  ];
  const editor = createEditor({
    container,
    initialValue: "",
    plugins: [{ name: "test", slashCommands: commands }],
  });
  editor.on("slashMenuChange", handler);
  editor.off("slashMenuChange", handler); // editor.ts:898-900 → emitter.off
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | `editor.setDocument("/he")` + `editor.setSelection(3)`（订阅已取消） | [STATE] 文档与选区正常更新（updateListener 正常执行 editor.ts:621-652，仅 emit 时找不到 handler） | import: @floatboat/nexus-core; API: editor.setDocument(doc) + editor.setSelection(3); 框架: vitest; 等待: 同步 |
| 2 | 断言 `handler` | [EVENT] `expect(handler).not.toHaveBeenCalled()`——`off` 后事件流对宿主完全静默（event-emitter.ts:14 Set.delete 移除注册） | import: @floatboat/nexus-core; API: expect(handler).not.toHaveBeenCalled(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [EVENT] `off` 取消订阅后 `handler` 未被调用

---

## FP-06-02-N03 [P2] [正常] 多订阅者广播：两个 handler 均收到同一 state

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `""`
- 插件配置: `[{ name: "test", slashCommands: commands }]`
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  // ⚠️ 陷阱: emit 遍历 Set 按插入序调用全部 handler（event-emitter.ts:20-22），
  //         两个 handler 收到的是同一 emit 的同一载荷（值语义相同）
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor, type SlashCommandDef } from "@floatboat/nexus-core";
  // import 来源: packages/core/src/index.ts 重新导出（源码: editor.ts/types.ts）

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const container = document.createElement("div");
  const handlerA = vi.fn();
  const handlerB = vi.fn();
  const commands: SlashCommandDef[] = [
    { id: "heading", title: "Heading", keywords: ["h1"] },
  ];
  const editor = createEditor({
    container,
    initialValue: "",
    plugins: [{ name: "test", slashCommands: commands }],
  });
  editor.on("slashMenuChange", handlerA);
  editor.on("slashMenuChange", handlerB);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | `editor.setDocument("/he")` + `editor.setSelection(3)` | [STATE] 单次事件流广播给全部订阅者（emit 遍历 Set，event-emitter.ts:17-24） | import: @floatboat/nexus-core; API: editor.setDocument(doc) + editor.setSelection(3); 框架: vitest; 等待: 同步 |
| 2 | 断言 handlerA 与 handlerB 均被调用 | [EVENT] `expect(handlerA).toHaveBeenCalled()` 且 `expect(handlerB).toHaveBeenCalled()` | import: @floatboat/nexus-core; API: expect(handlerA).toHaveBeenCalled() + expect(handlerB).toHaveBeenCalled(); 框架: vitest; 等待: 无 |
| 3 | 断言两者末次载荷一致 | [EVENT] 两个 handler 的末次载荷 `query` 均为 `"he"`、`isOpen` 均为 `true`（同一 emit 广播，载荷同源） | import: @floatboat/nexus-core; API: expect(handlerA.mock.calls.at(-1)[0]).toEqual(handlerB.mock.calls.at(-1)[0]); 框架: vitest; 等待: 无 |

**断言汇总**:
- [EVENT] 两个订阅者均收到回调，末次载荷 `query === "he"`、`isOpen === true`（广播一致性）

---

## FP-06-02-N04 [P2] [正常] 关闭状态推送：光标移出 slash 后回调收到 isOpen=false 且 commands 为空

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `""`
- 插件配置: `[{ name: "test", slashCommands: commands }]`
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  // ⚠️ 陷阱: 关闭态命令列表为空数组 []（slash-state.ts:161），
  //         不是 null 也不是 undefined——宿主可安全遍历
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor, type SlashCommandDef } from "@floatboat/nexus-core";
  // import 来源: packages/core/src/index.ts 重新导出（源码: editor.ts/types.ts）

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const container = document.createElement("div");
  const handler = vi.fn();
  const commands: SlashCommandDef[] = [
    { id: "heading", title: "Heading", keywords: ["h1"] },
  ];
  const editor = createEditor({
    container,
    initialValue: "",
    plugins: [{ name: "test", slashCommands: commands }],
  });
  editor.on("slashMenuChange", handler);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | `editor.setDocument("plain text")`（无斜杠）+ `editor.setSelection(11)` | [STATE] 无 slash 匹配，关闭状态推送（getSlashMatch 返回 null → 关闭态载荷，slash-state.ts:159-161） | import: @floatboat/nexus-core; API: editor.setDocument(doc) + editor.setSelection(11); 框架: vitest; 等待: 同步 |
| 2 | 断言末次载荷 | [EVENT] `last.isOpen === false`、`last.commands.length === 0`、`last.from === null`、`last.to === null`、`last.query === ""`——关闭态载荷结构完整（slash-state.ts:161 固定形状 + editor.ts:650 附加 coords:null），宿主可据此隐藏菜单 | import: @floatboat/nexus-core; API: expect(last).toMatchObject({ isOpen: false, commands: [], from: null, to: null, query: "" }); 框架: vitest; 等待: 无 |

**断言汇总**:
- [EVENT] 末次载荷 `isOpen === false`、`commands` 为空、`from/to === null`、`query === ""`

---

## FP-06-02-F01 [P2] [流程] 连续键入 "/h"→"/he"→"/hea" 回调序列与末次载荷 query="hea"

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `""`
- 插件配置: `[{ name: "test", slashCommands: commands }]`
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  // ⚠️ 陷阱: 每次 typeSlash() 产生 2 次 update（docChanged + selectionSet）→ 2 次 emit，
  //         三档 query 合计至少 6 次回调；断言用"包含"语义而非精确次数
  // ⚠️ 陷阱: 匹配档位: title 精确 6000 > title 前缀 5000 > keyword 精确 4000 > title 子串 3000
  //         > keyword 前缀 2000 > keyword 子串 1000（slash-state.ts:32-38）
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor, type SlashCommandDef } from "@floatboat/nexus-core";
  // import 来源: packages/core/src/index.ts 重新导出（源码: editor.ts/types.ts）

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const container = document.createElement("div");
  const handler = vi.fn();
  const commands: SlashCommandDef[] = [
    { id: "heading", title: "Heading", keywords: ["h1", "title"] },
    { id: "table", title: "Table", keywords: ["grid"] },
  ];
  const editor = createEditor({
    container,
    initialValue: "",
    plugins: [{ name: "test", slashCommands: commands }],
  });
  editor.on("slashMenuChange", handler);

  function typeSlash(query: string): void {
    editor.setDocument(`/${query}`);
    editor.setSelection(query.length + 1);
  }
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | `typeSlash("h")` | [STATE] 回调载荷 query 含 `"h"`（getSlashMatch 返回 query="h"；匹配 title 前缀档的 "Heading"） | import: @floatboat/nexus-core; API: editor.setDocument(`/${query}`) + editor.setSelection(query.length + 1); 框架: vitest; 等待: 同步 |
| 2 | `typeSlash("he")` | [STATE] 回调载荷 query 含 `"he"`（title 前缀匹配 "heading" 的 "He"） | import: @floatboat/nexus-core; API: editor.setDocument(`/${query}`) + editor.setSelection(query.length + 1); 框架: vitest; 等待: 同步 |
| 3 | `typeSlash("hea")` | [STATE] 回调载荷 query 含 `"hea"`（title 前缀匹配精确命中 "heading"） | import: @floatboat/nexus-core; API: editor.setDocument(`/${query}`) + editor.setSelection(query.length + 1); 框架: vitest; 等待: 同步 |
| 4 | 断言末次载荷 | [EVENT] `last.query === "hea"`、`last.isOpen === true`、`last.commands.length === 1`（前缀匹配仅命中 heading 一条，filterSlashCommands 排名后保留） | import: @floatboat/nexus-core; API: expect(last).toMatchObject({ query: "hea", isOpen: true }) + expect(last.commands).toHaveLength(1); 框架: vitest; 等待: 无 |
| 5 | 断言调用序列覆盖三档查询 | [EVENT] `handler.mock.calls` 的载荷序列中分别存在 `query` 为 `"h"`、`"he"`、`"hea"` 的调用（`some(c => c[0].query === "h")` 等，每档 setDocument+setSelection 均推送） | import: @floatboat/nexus-core; API: expect(handler.mock.calls.some(c => c[0].query === "h")).toBe(true) 等; 框架: vitest; 等待: 无 |

**断言汇总**:
- [EVENT] 末次载荷 `query === "hea"`、`isOpen === true`、`commands.length === 1`
- [EVENT] 回调序列中 `query` 值覆盖 `"h"` / `"he"` / `"hea"` 三档

---

## FP-06-02-E01 [P3] [异常] off 从未注册的 handler 幂等安全（不抛错）

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `""`
- 插件配置: `[{ name: "test", slashCommands: commands }]`
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  // ⚠️ 陷阱: off 对未注册 handler 幂等——event-emitter.ts:14
  //         `this.listeners.get(event)?.delete(handler)` 可选链 + Set.delete 不存在即 no-op，绝不抛错
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor, type SlashCommandDef } from "@floatboat/nexus-core";
  // import 来源: packages/core/src/index.ts 重新导出（源码: editor.ts/types.ts）

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const container = document.createElement("div");
  const registered = vi.fn();
  const neverRegistered = vi.fn();
  const commands: SlashCommandDef[] = [
    { id: "heading", title: "Heading", keywords: ["h1"] },
  ];
  const editor = createEditor({
    container,
    initialValue: "",
    plugins: [{ name: "test", slashCommands: commands }],
  });
  editor.on("slashMenuChange", registered);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | `expect(() => editor.off("slashMenuChange", neverRegistered)).not.toThrow()` | [API] 取消订阅未注册 handler 不抛异常（EventEmitter `set.delete` 幂等，event-emitter.ts:13-15；editor.ts:898-900 透传） | import: @floatboat/nexus-core; API: editor.off(event: string, handler) 幂等安全; 框架: vitest; 等待: 无 |
| 2 | `editor.setDocument("/he")` + `editor.setSelection(3)` | [STATE] 正常触发（updateListener 正常 emit） | import: @floatboat/nexus-core; API: editor.setDocument(doc) + editor.setSelection(3); 框架: vitest; 等待: 同步 |
| 3 | 断言 `registered` 仍被调用、`neverRegistered` 未被调用 | [EVENT] 幂等 off 不影响已注册订阅者的接收（`expect(registered).toHaveBeenCalled()`、`expect(neverRegistered).not.toHaveBeenCalled()`） | import: @floatboat/nexus-core; API: expect(registered).toHaveBeenCalled() + expect(neverRegistered).not.toHaveBeenCalled(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [API] `off` 未注册 handler 不抛错
- [EVENT] 已注册 handler 仍正常收到回调，未注册 handler 从未被调用

---

## FP-06-02-E02 [P3] [异常] 同一 handler 重复 on 两次仅回调一次（EventEmitter Set 去重）

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `""`
- 插件配置: `[{ name: "test", slashCommands: commands }]`
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  // ⚠️ 陷阱: EventEmitter 用 Set 存储 handler（event-emitter.ts:2,10 `set.add(handler)`），
  //         同一函数引用重复 add 只保留一份 → 每轮 emit 只回调一次
  // ⚠️ 陷阱: 本用例是"精确断言次数"的唯一特例：setDocument(1 次 docChanged) + setSelection(1 次 selectionSet)
  //         = 2 次 update → 2 次 emit → Set 去重后 handler 恰好回调 2 次（editor.ts:621）
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor, type SlashCommandDef } from "@floatboat/nexus-core";
  // import 来源: packages/core/src/index.ts 重新导出（源码: editor.ts/types.ts）

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const container = document.createElement("div");
  const handler = vi.fn();
  const commands: SlashCommandDef[] = [
    { id: "heading", title: "Heading", keywords: ["h1"] },
  ];
  const editor = createEditor({
    container,
    initialValue: "",
    plugins: [{ name: "test", slashCommands: commands }],
  });
  // 同一 handler 重复订阅两次
  editor.on("slashMenuChange", handler);
  editor.on("slashMenuChange", handler);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | `editor.setDocument("/he")`（1 次 docChanged update）+ `editor.setSelection(3)`（1 次 selectionSet update） | [STATE] 共 2 次 update，各触发一次 emit（editor.ts:621 `update.docChanged || update.selectionSet` 每次 update 进入一次，slash 分支 634 行各 emit 一次） | import: @floatboat/nexus-core; API: editor.setDocument(doc) + editor.setSelection(3); 框架: vitest; 等待: 同步 |
| 2 | 断言 `handler.mock.calls.length` | [EVENT] `=== 2`（而非 4）——Set 去重后同一 handler 每轮 emit 仅回调一次（event-emitter.ts:10 `set.add` 幂等，17-24 emit 遍历 Set） | import: @floatboat/nexus-core; API: expect(handler.mock.calls).toHaveLength(2); 框架: vitest; 等待: 无 |
| 3 | 断言末次载荷 `last.query === "he"` | [EVENT] 去重不破坏载荷内容（末次载荷为 selectionSet update 计算的结果） | import: @floatboat/nexus-core; API: expect(handler.mock.calls.at(-1)[0].query).toBe("he"); 框架: vitest; 等待: 无 |

**断言汇总**:
- [EVENT] 重复 `on` 后 handler 回调次数为 2（2 次 update × 1 份注册，Set 去重生效）
- [EVENT] 末次载荷 `query === "he"` 不受影响

---

## FP-06-02-E03 [P3] [异常] slashMenuLimit=0 时 isOpen=true 且 commands=[]（无结果占位契约）

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `""`
- 插件配置: `[{ name: "test", slashCommands: commands }]` + `slashMenuLimit: 0`
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  // ⚠️ 陷阱: limit=0 时 `filtered.slice(0, 0)` → []，但 isOpen 保持 true（slash-state.ts:169,171-177）——
  //         "无结果占位"契约（types.ts:108-111 注释与 slash-state.test.ts:150-154 既有测试一致）
  // ⚠️ 陷阱: config.slashMenuLimit 传 0 必须显式提供，createEditor 默认无该字段时走 DEFAULT_LIMIT=8（slash-state.ts:26,165）
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor, type SlashCommandDef } from "@floatboat/nexus-core";
  // import 来源: packages/core/src/index.ts 重新导出（源码: editor.ts/types.ts）

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const container = document.createElement("div");
  const handler = vi.fn();
  const commands: SlashCommandDef[] = [
    { id: "heading", title: "Heading", keywords: ["h1"] },
    { id: "table", title: "Table", keywords: ["grid"] },
  ];
  const editor = createEditor({
    container,
    initialValue: "",
    slashMenuLimit: 0,
    plugins: [{ name: "test", slashCommands: commands }],
  });
  editor.on("slashMenuChange", handler);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | `editor.setDocument("/he")` + `editor.setSelection(3)` | [STATE] 打开菜单，limit=0 截断命令列表（editor.ts:636-638 `{ limit: config.slashMenuLimit }` 透传 → slash-state.ts:169 `filtered.slice(0, 0)`） | import: @floatboat/nexus-core; API: editor.setDocument(doc) + editor.setSelection(3); 框架: vitest; 等待: 同步 |
| 2 | 断言末次载荷 | [EVENT] `last.isOpen === true`（菜单保持打开状态，slash-state.ts:172 打开态无条件 isOpen: true）且 `last.commands.length === 0`（空命令列表，slice(0, 0) 截断）——供宿主渲染"无结果"占位 UI（与 slash-state.test.ts:150-154 既有测试一致） | import: @floatboat/nexus-core; API: expect(last.isOpen).toBe(true) + expect(last.commands).toHaveLength(0); 框架: vitest; 等待: 无 |
| 3 | 断言 `last.from`/`last.to` | [EVENT] `from === 0`、`to === 3`——触发范围仍完整（from/to 来自 getSlashMatch 匹配结果，slash-state.ts:58-62），仅命令列表被清空 | import: @floatboat/nexus-core; API: expect(last).toMatchObject({ from: 0, to: 3 }); 框架: vitest; 等待: 无 |

**断言汇总**:
- [EVENT] `slashMenuLimit: 0` 时 `isOpen === true`、`commands.length === 0`
- [EVENT] `from === 0`、`to === 3`（触发范围不受 limit 影响）

---

## FP-06-02-B01 [P4] [边界] slashMenuLimit=3 时命令排名后截断为 3 条

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `""`
- 插件配置: 20 个注册命令 + `slashMenuLimit: 3`
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  // ⚠️ 陷阱: limit 在排名之后应用（slash-state.ts:169 `filtered.slice(0, limit)`；先 filterSlashCommands 排名再截断，
  //         与 slash-state.test.ts:161-170 "applies limit AFTER ranking" 既有测试一致）
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor, type SlashCommandDef } from "@floatboat/nexus-core";
  // import 来源: packages/core/src/index.ts 重新导出（源码: editor.ts/types.ts）

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const container = document.createElement("div");
  const handler = vi.fn();
  const manyCommands: SlashCommandDef[] = Array.from({ length: 20 }, (_, i) => ({
    id: `cmd-${i}`,
    title: `Command ${i}`,
  }));
  const editor = createEditor({
    container,
    initialValue: "",
    slashMenuLimit: 3,
    plugins: [{ name: "test", slashCommands: manyCommands }],
  });
  editor.on("slashMenuChange", handler);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | `editor.setDocument("/com")` + `editor.setSelection(4)` | [STATE] 20 条命令均匹配前缀 "com"（title 前缀档 score=5000，slash-state.ts:82-85），排名后截断 | import: @floatboat/nexus-core; API: editor.setDocument(doc) + editor.setSelection(4); 框架: vitest; 等待: 同步 |
| 2 | 断言末次载荷 `last.commands.length` | [EVENT] `=== 3`（`filtered.slice(0, limit)` 截断，slash-state.ts:169；与 slash-state.test.ts:145-148 limit:3 既有测试一致） | import: @floatboat/nexus-core; API: expect(last.commands).toHaveLength(3); 框架: vitest; 等待: 无 |
| 3 | 断言 `last.isOpen === true` | [EVENT] 截断不影响打开状态（computeSlashState 打开态始终 isOpen: true，slash-state.ts:172） | import: @floatboat/nexus-core; API: expect(last.isOpen).toBe(true); 框架: vitest; 等待: 无 |

**断言汇总**:
- [EVENT] 20 条命令在 `slashMenuLimit: 3` 下载荷 `commands.length === 3`
- [EVENT] `isOpen === true`

---

## FP-06-02-B02 [P4] [边界] destroy() 后残留订阅不再触发回调

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `""`
- 插件配置: `[{ name: "test", slashCommands: commands }]`
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  // ⚠️ 陷阱: destroy() 设置 destroyed=true（editor.ts:952）+ emitter.clear()（editor.ts:965）+
  //         view.destroy()（editor.ts:967）；updateListener 以 `!destroyed` 短路（editor.ts:621）
  //         → destroy 后 setDocument/setSelection 不再 emit（menu-ui.test.ts:160 验证 destroy 后 open 不抛错）
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor, type SlashCommandDef } from "@floatboat/nexus-core";
  // import 来源: packages/core/src/index.ts 重新导出（源码: editor.ts/types.ts）

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const container = document.createElement("div");
  const handler = vi.fn();
  const commands: SlashCommandDef[] = [
    { id: "heading", title: "Heading", keywords: ["h1"] },
  ];
  const editor = createEditor({
    container,
    initialValue: "",
    plugins: [{ name: "test", slashCommands: commands }],
  });
  editor.on("slashMenuChange", handler);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | `editor.setDocument("/he")` + `editor.setSelection(3)`（destroy 前正常触发） | [STATE] 回调正常，`expect(handler).toHaveBeenCalled()` | import: @floatboat/nexus-core; API: editor.setDocument(doc) + editor.setSelection(3) + expect(handler).toHaveBeenCalled(); 框架: vitest; 等待: 同步 |
| 2 | `editor.destroy()` | [STATE] 编辑器销毁（editor.ts:924-974：destroyed=true → emitter.clear() 清空全部监听器 → view.destroy()） | import: @floatboat/nexus-core; API: editor.destroy(); 框架: vitest; 等待: 无 |
| 3 | 记录销毁后调用次数 `const afterDestroy = handler.mock.calls.length`，再执行 `editor.setDocument("/he")`、`editor.setSelection(3)` | [STATE] destroy 后 updateListener 短路（`!destroyed` 为 false，editor.ts:621），不再 emit | import: @floatboat/nexus-core; API: editor.setDocument(doc) + editor.setSelection(3)（destroy 后安全、不抛错）; 框架: vitest; 等待: 同步 |
| 4 | 断言 `handler.mock.calls.length === afterDestroy` | [EVENT] destroy 后残留订阅不再收到任何回调（emitter.clear() 清空，无泄漏、无异常） | import: @floatboat/nexus-core; API: expect(handler.mock.calls).toHaveLength(afterDestroy); 框架: vitest; 等待: 无 |

**断言汇总**:
- [EVENT] `destroy()` 后调用次数不再增长（残留订阅静默清理）

---

## FP-06-02-D01 [P5] [数据] commands 载荷与 getSlashCommands() 同源（id/title 字段与排名顺序契约）

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `""`
- 插件配置: `[{ name: "test", slashCommands: commands }]`
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  // ⚠️ 陷阱: getSlashCommands() 直接返回内部 slashCommands 数组（editor.ts:765-767 `return slashCommands`），
  //         与空 query 下 filterSlashCommands 的 commands.slice()（slash-state.ts:122-127）同源同序
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor, type SlashCommandDef } from "@floatboat/nexus-core";
  // import 来源: packages/core/src/index.ts 重新导出（源码: editor.ts/types.ts）

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const container = document.createElement("div");
  const handler = vi.fn();
  const commands: SlashCommandDef[] = [
    { id: "heading", title: "Heading", keywords: ["h1"] },
    { id: "table", title: "Table", keywords: ["grid"] },
  ];
  const editor = createEditor({
    container,
    initialValue: "",
    plugins: [{ name: "test", slashCommands: commands }],
  });
  editor.on("slashMenuChange", handler);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | `editor.setDocument("/")` + `editor.setSelection(1)`（空 query） | [STATE] 空 query 返回全部注册命令（filterSlashCommands 空 query 分支 `commands.slice()`，slash-state.ts:122-127） | import: @floatboat/nexus-core; API: editor.setDocument(doc) + editor.setSelection(1); 框架: vitest; 等待: 同步 |
| 2 | 断言 `last.commands` 与 `editor.getSlashCommands()` 的 id 序列一致 | [D] `last.commands.map((c) => c.id)` 等于 `editor.getSlashCommands().map((c) => c.id)`——载荷命令与插件注册同源（editor.ts:765-767 `getSlashCommands` 返回同一内部数组；API 类型签名见 types.ts:197） | import: @floatboat/nexus-core; API: editor.getSlashCommands(): SlashCommandDef[]; 框架: vitest; 等待: 无 |
| 3 | 断言每条命令含 `id` 与 `title` 字符串字段 | [D] `last.commands.every((c) => typeof c.id === "string" && typeof c.title === "string")`（SlashCommandDef 契约：id/title 必填、keywords/description 可选，types.ts:280-284） | import: @floatboat/nexus-core; API: expect(last.commands.every(...)).toBe(true); 框架: vitest; 等待: 无 |
| 4 | 断言空 query 下保持注册顺序 | [D] id 序列为 `["heading", "table"]`（注册序，不做排序——slash-state.ts:122-127 空 query 直接 slice 保留原序） | import: @floatboat/nexus-core; API: expect(last.commands.map(c => c.id)).toEqual(["heading", "table"]); 框架: vitest; 等待: 无 |

**断言汇总**:
- [D] `last.commands` 与 `getSlashCommands()` 同源（id 序列一致）
- [D] 每条命令含 `id`/`title` 字符串字段；空 query 下保持注册顺序

---

## 增强信息来源
- 事件发射: packages/core/src/editor.ts + event-emitter.ts
- 状态计算: packages/core/src/slash-state.ts
- 类型定义: packages/core/src/types.ts
- 测试参考: packages/core/test/events.test.ts + slash-state.test.ts
- 陷阱提示: AGENTS.md

---

## FP-06-03-N01 [P1] [正常] 宿主渲染：createSlashMenuUI 挂载菜单到 body（position: fixed）

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom（需在 vitest.config.ts `environment: "jsdom"` 下运行）
- 初始文档: `""`
- 插件配置: `[{ name: "test", slashCommands: commands }]`
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  // ⚠️ 陷阱: 菜单 root 类名为 `${classPrefix}-menu`（menu-ui.ts:89,97），默认 classPrefix "nexus-slash"
  //         → 实际类名 "nexus-slash-menu"；断言挂载用 menu.element.parentElement，避免依赖类名
  // ⚠️ 陷阱: root.style.position = "fixed"（menu-ui.ts:101）——脱离编辑器容器的 overflow 约束，
  //         初始 display = "none"（menu-ui.ts:102），仅在 open 后变为 "block"
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor, type SlashCommandDef } from "@floatboat/nexus-core";
  import { createSlashMenuUI, type SlashMenuUI } from "@floatboat/nexus-plugin-slash";
  // import 来源: packages/plugin-slash/src/index.ts（re-export createSlashMenuUI），
  //              实现位于 packages/plugin-slash/src/menu-ui.ts

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const container = document.createElement("div");
  document.body.appendChild(container);
  const commands: SlashCommandDef[] = [
    { id: "heading", title: "Heading", keywords: ["h1"] },
    { id: "table", title: "Table", keywords: ["grid"] },
  ];
  const editor = createEditor({
    container,
    initialValue: "",
    plugins: [{ name: "test", slashCommands: commands }],
  });
  const menu: SlashMenuUI = createSlashMenuUI(editor); // menu-ui.ts:85-106，默认挂载 document.body
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言 `menu.element.parentElement` | [STATE] `menu.element.parentElement === document.body`（默认 container 为 document.body，menu-ui.ts:91 `options.container ?? document.body`；既有测试 menu-ui.test.ts:106-111 "mounts hidden by default"） | import: @floatboat/nexus-plugin-slash; API: createSlashMenuUI(editor, options?: SlashMenuUIOptions) → SlashMenuUI（menu.element: HTMLElement）; 框架: vitest; 等待: 无 |
| 2 | 断言 `menu.element` 的 class 与 style | [STATE] `menu.element.className === "nexus-slash-menu"`（root.className = `${prefix}-menu`，menu-ui.ts:97）；`menu.element.style.position === "fixed"`（menu-ui.ts:101，脱离容器 overflow 布局） | import: @floatboat/nexus-plugin-slash; API: expect(menu.element.className).toBe("nexus-slash-menu") + expect(menu.element.style.position).toBe("fixed"); 框架: vitest; 等待: 无 |
| 3 | 打开菜单：`editor.setDocument("/he")` + `editor.setSelection(3)` | [EVENT] 编辑器事件驱动菜单显示：menu-ui.ts:445 订阅 `editor.on("slashMenuChange", onSlashMenuChange)` → 445-449 判 `state.isOpen`，渲染列表并显示（menu-ui.ts:324-349 `onSlashMenuChange`） | import: @floatboat/nexus-core; API: editor.setDocument(doc) + editor.setSelection(3); 框架: vitest; 等待: 同步（slashMenuChange 同步 emit，菜单随即更新） |
| 4 | 断言菜单可见与命令项数量 | [STATE] `menu.element.style.display === "block"`（reposition 内设置，menu-ui.ts:230）且 `menu.element.querySelectorAll("[role='option']").length === 2`（2 条命令渲染为 role="option" 项，menu-ui.ts:322 renderItems；role 契约 menu-ui.ts:105 role="listbox"） | import: @floatboat/nexus-plugin-slash; API: expect(menu.element.querySelectorAll("[role='option']")).toHaveLength(2); 框架: vitest; 等待: 无 |

**断言汇总**:
- [STATE] `menu.element.parentElement === document.body`（默认挂载 body）
- [STATE] 类名 `nexus-slash-menu`、`position: fixed`（脱离容器 overflow 约束）
- [STATE] 打开后 `display === "block"`、`role="option"` 项数量 = 命令数量

---

## FP-06-03-N02 [P2] [正常] 宿主渲染：reposition 使用 coords（left / bottom+offset 定位）

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom（坐标由 mock 注入）
- 初始文档: `""`
- 插件配置: `[{ name: "test", slashCommands: commands }]`
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  // ⚠️ 陷阱: jsdom 下 coordsAtPos 返回 null（editor.ts:643-646）→ 菜单不移动但可见（menu-ui.ts:230-231）。
  //         本用例通过 mock 编辑器 emit 自定义 coords 载荷验证定位公式: top = bottom + offset（menu-ui.ts:234），
  //         offset 默认 4（menu-ui.ts:76）
  // ⚠️ 陷阱: 定位用 root.style.left/top 内联样式（menu-ui.ts:233-234），不涉及 table border 等结构样式
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor, type SlashCommandDef, type SlashMenuState } from "@floatboat/nexus-core";
  import { createSlashMenuUI, type SlashMenuUI } from "@floatboat/nexus-plugin-slash";
  // import 来源: packages/plugin-slash/src/index.ts + packages/core/src/index.ts

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const container = document.createElement("div");
  const commands: SlashCommandDef[] = [
    { id: "heading", title: "Heading", keywords: ["h1"] },
  ];
  const editor = createEditor({
    container,
    initialValue: "",
    plugins: [{ name: "test", slashCommands: commands }],
  });
  const menu: SlashMenuUI = createSlashMenuUI(editor);
  const state: SlashMenuState = {
    isOpen: true,
    from: 0,
    to: 4,
    query: "hea",
    commands,
    coords: { left: 100, top: 50, bottom: 60 }, // 模拟真实浏览器 coordsAtPos 结果
  };
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | `editor.setDocument("/he")` + `editor.setSelection(3)`（触发内部订阅） | [STATE] 事件流激活菜单（内部订阅 editor.on("slashMenuChange", ...)，menu-ui.ts:445） | import: @floatboat/nexus-core; API: editor.setDocument(doc) + editor.setSelection(3); 框架: vitest; 等待: 同步 |
| 2 | `menu.show(state)`（携带 mock coords） | [STATE] `menu.element.style.display === "block"`（show → reposition → display block，menu-ui.ts:230,260-268） | import: @floatboat/nexus-plugin-slash; API: menu.show(state: SlashMenuState); 框架: vitest; 等待: 无 |
| 3 | 断言 `left` / `top` 内联样式 | [STATE] `menu.element.style.left === "100px"`（`left = coords.left`，menu-ui.ts:233）；`menu.element.style.top === "64px"`（`top = bottom + offset = 60 + 4`，menu-ui.ts:234）——定位公式与 BoundingClientRect 坐标联动 | import: @floatboat/nexus-plugin-slash; API: expect(menu.element.style.left).toBe("100px") + expect(menu.element.style.top).toBe("64px"); 框架: vitest; 等待: 无 |

**断言汇总**:
- [STATE] `display === "block"`（可见性不受 coords 影响，menu-ui.ts:230-231）
- [STATE] `left = coords.left`、`top = coords.bottom + offset`（offset 默认 4，viewport 越界时 clamp，menu-ui.ts:236-245）

---

## FP-06-03-E01 [P3] [异常] jsdom 无布局 coords=null：菜单仍可见但位置保持默认

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom（无真实布局，`coordsAtPos` 恒返回 null，editor.ts:643-646 try-catch 包裹）
- 初始文档: `""`
- 插件配置: `[{ name: "test", slashCommands: commands }]`
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  // ⚠️ 陷阱: coords=null 是 jsdom 的合法降级（editor.ts:643-646）；menu-ui.ts:231 对 coords 为 null 直接 return，
  //         仅 display 已置 block → "可见但不移动"；宿主不得因 coords 为 null 而抛错
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor, type SlashCommandDef } from "@floatboat/nexus-core";
  import { createSlashMenuUI, type SlashMenuUI } from "@floatboat/nexus-plugin-slash";
  // import 来源: packages/plugin-slash/src/index.ts + packages/core/src/index.ts

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const container = document.createElement("div");
  const commands: SlashCommandDef[] = [
    { id: "heading", title: "Heading", keywords: ["h1"] },
  ];
  const editor = createEditor({
    container,
    initialValue: "",
    plugins: [{ name: "test", slashCommands: commands }],
  });
  const menu: SlashMenuUI = createSlashMenuUI(editor);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | `editor.setDocument("/he")` + `editor.setSelection(3)` | [STATE] jsdom 下事件载荷 `coords === null`（editor.ts:643-646 `coordsAtPos` 返回 null → coords 保持 null） | import: @floatboat/nexus-core; API: editor.setDocument(doc) + editor.setSelection(3); 框架: vitest; 等待: 同步 |
| 2 | 断言菜单显示 | [STATE] `menu.element.style.display === "block"`（先置 block 再检查 coords，menu-ui.ts:230-231）——可见性不依赖坐标 | import: @floatboat/nexus-plugin-slash; API: expect(menu.element.style.display).toBe("block"); 框架: vitest; 等待: 无 |
| 3 | 断言位置未被改写 | [STATE] `menu.element.style.left`/`style.top` 保持初始空值（coords null → reposition 直接 return 不写定位样式，menu-ui.ts:231）——测试不抛错即通过 | import: @floatboat/nexus-plugin-slash; API: expect(menu.element.style.left).toBe("") + expect(menu.element.style.top).toBe(""); 框架: vitest; 等待: 无 |

**断言汇总**:
- [STATE] `coords === null` 时菜单仍 `display === "block"`（可见）
- [STATE] 定位样式未被写入（不抛错），等待真实浏览器布局提供坐标

---

## FP-06-03-E02 [P3] [异常] 菜单节点随 destroy 清理：解除订阅 + 移除 DOM

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `""`
- 插件配置: `[{ name: "test", slashCommands: commands }]`
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  // ⚠️ 陷阱: menu.destroy() 顺序: editor.off("slashMenuChange", onSlashMenuChange)（menu-ui.ts:465-467）+
  //         editor.off("blur", ...)（menu-ui.ts:468-470）+ removeEventListener + root.parentNode.removeChild(root)
  //         （menu-ui.ts:474-477）→ menu.element.parentElement === null
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor, type SlashCommandDef } from "@floatboat/nexus-core";
  import { createSlashMenuUI, type SlashMenuUI } from "@floatboat/nexus-plugin-slash";
  // import 来源: packages/plugin-slash/src/index.ts + packages/core/src/index.ts

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const container = document.createElement("div");
  const commands: SlashCommandDef[] = [
    { id: "heading", title: "Heading", keywords: ["h1"] },
  ];
  const editor = createEditor({
    container,
    initialValue: "",
    plugins: [{ name: "test", slashCommands: commands }],
  });
  const menu: SlashMenuUI = createSlashMenuUI(editor);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | `editor.setDocument("/he")` + `editor.setSelection(3)`（destroy 前） | [STATE] 菜单显示（`menu.element.parentElement !== null`，订阅生效中） | import: @floatboat/nexus-core; API: editor.setDocument(doc) + editor.setSelection(3); 框架: vitest; 等待: 同步 |
| 2 | `menu.destroy()` | [STATE] 解除订阅 + 移除 DOM 节点（editor.off 见 menu-ui.ts:465-470；removeChild 见 menu-ui.ts:474-477） | import: @floatboat/nexus-plugin-slash; API: menu.destroy(); 框架: vitest; 等待: 无 |
| 3 | 断言 `menu.element.parentElement` | [STATE] `menu.element.parentElement === null`（root 已从 document.body 移除，menu-ui.ts:477 `root.parentNode.removeChild(root)`；既有测试 menu-ui.test.ts:154-158 "destroy detaches"） | import: @floatboat/nexus-plugin-slash; API: expect(menu.element.parentElement).toBeNull(); 框架: vitest; 等待: 无 |
| 4 | destroy 后再 `editor.setDocument("/he")` + `editor.setSelection(3)` | [EVENT] 已解除订阅，菜单不会重新挂载/显示（editor.off 生效；既有测试 menu-ui.test.ts:160 验证 destroy 后 open 不抛错） | import: @floatboat/nexus-core; API: editor.setDocument(doc) + editor.setSelection(3)（不抛错即通过）; 框架: vitest; 等待: 同步 |

**断言汇总**:
- [STATE] `menu.destroy()` 后 `menu.element.parentElement === null`（DOM 移除）
- [EVENT] destroy 后编辑器事件不再驱动菜单（订阅已解除，且 editor 侧 `emitter.clear()` 兜底）

---

## FP-06-03-B01 [P4] [边界] 自定义容器：菜单挂载到 ShadowRoot（隔离样式，完全脱离 overflow 上下文）

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom（支持 Shadow DOM）
- 初始文档: `""`
- 插件配置: `[{ name: "test", slashCommands: commands }]`
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  // ⚠️ 陷阱: createSlashMenuUI 第二参数 options.container 支持 HTMLElement | ShadowRoot（types.ts 声明），
  //         container 默认 document.body（menu-ui.ts:91）；挂载 ShadowRoot 后 parentElement 即 shadowRoot
  //         （既有测试 menu-ui.test.ts:163-170 "supports custom container"）
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor, type SlashCommandDef } from "@floatboat/nexus-core";
  import { createSlashMenuUI, type SlashMenuUI } from "@floatboat/nexus-plugin-slash";
  // import 来源: packages/plugin-slash/src/index.ts + packages/core/src/index.ts

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const container = document.createElement("div");
  const host = document.createElement("div");
  const shadowRoot = host.attachShadow({ mode: "open" });
  const commands: SlashCommandDef[] = [
    { id: "heading", title: "Heading", keywords: ["h1"] },
  ];
  const editor = createEditor({
    container,
    initialValue: "",
    plugins: [{ name: "test", slashCommands: commands }],
  });
  const menu: SlashMenuUI = createSlashMenuUI(editor, { container: shadowRoot });
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 断言 `menu.element.parentElement` | [STATE] `menu.element.parentElement === shadowRoot`（自定义 container 生效，menu-ui.ts:91 `container.appendChild(root)`；ShadowRoot.appendChild 原生支持） | import: @floatboat/nexus-plugin-slash; API: createSlashMenuUI(editor, { container: shadowRoot }); 框架: vitest; 等待: 无 |
| 2 | 断言 shadowRoot 内节点 | [STATE] `shadowRoot.querySelector(".nexus-slash-menu") === menu.element`（类名契约 menu-ui.ts:97；菜单样式被 Shadow DOM 隔离，天然脱离宿主页面 overflow/样式干扰） | import: @floatboat/nexus-plugin-slash; API: expect(shadowRoot.querySelector(".nexus-slash-menu")).toBe(menu.element); 框架: vitest; 等待: 无 |
| 3 | `editor.setDocument("/he")` + `editor.setSelection(3)`（自定义容器内打开） | [STATE] 菜单在 ShadowRoot 内正常打开（订阅 editor.on("slashMenuChange") 与容器无关，menu-ui.ts:445） | import: @floatboat/nexus-core; API: editor.setDocument(doc) + editor.setSelection(3); 框架: vitest; 等待: 同步 |
| 4 | 断言菜单可见 | [STATE] `menu.element.style.display === "block"`（reposition 显示逻辑与容器无关，menu-ui.ts:230） | import: @floatboat/nexus-plugin-slash; API: expect(menu.element.style.display).toBe("block"); 框架: vitest; 等待: 无 |

**断言汇总**:
- [STATE] `menu.element.parentElement === shadowRoot`（自定义容器挂载）
- [STATE] ShadowRoot 内可查询到 `nexus-slash-menu` 节点并正常打开显示

---

## FP-06-03-F01 [P2] [流程] 打开→选择→关闭 完整生命周期（宿主渲染驱动）

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `""`
- 插件配置: `[{ name: "test", slashCommands: commands }]`
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  // ⚠️ 陷阱: 菜单项渲染为 role="option"（menu-ui.ts:322 renderItems 创建 li[role="option"]），
  //         选中高亮类名与 aria-selected 由 menu-ui.ts:280-310 applyHighlight 维护；
  //         关闭路径: 编辑器 emit isOpen=false → onSlashMenuChange → hide()（menu-ui.ts:270-272 display=none）
  import { afterEach, expect, it, vi } from "vitest";
  import { createEditor, type SlashCommandDef } from "@floatboat/nexus-core";
  import { createSlashMenuUI, type SlashMenuUI } from "@floatboat/nexus-plugin-slash";
  // import 来源: packages/plugin-slash/src/index.ts + packages/core/src/index.ts

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const container = document.createElement("div");
  const commands: SlashCommandDef[] = [
    { id: "heading", title: "Heading", keywords: ["h1"] },
    { id: "table", title: "Table", keywords: ["grid"] },
  ];
  const editor = createEditor({
    container,
    initialValue: "",
    plugins: [{ name: "test", slashCommands: commands }],
  });
  const menu: SlashMenuUI = createSlashMenuUI(editor);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | `editor.setDocument("/he")` + `editor.setSelection(3)` | [STATE] 菜单打开，`menu.element.style.display === "block"`、可见项数量 2（reposition → display block，menu-ui.ts:230,324-349） | import: @floatboat/nexus-core; API: editor.setDocument(doc) + editor.setSelection(3); 框架: vitest; 等待: 同步 |
| 2 | 选中首项：`menu.setHighlight(0)`（或点击 `menu.element.querySelectorAll("[role='option']")[0]`） | [STATE] 首项获得高亮态（`aria-selected === "true"`，applyHighlight 维护菜单项选中状态，menu-ui.ts:280-310） | import: @floatboat/nexus-plugin-slash; API: menu.setHighlight(index: number); 框架: vitest; 等待: 无 |
| 3 | 执行命令：`menu.run(0)`（触发回调，测试内注册命令处理） | [STATE] 命令处理回调被调用（menu-ui.ts 命令执行链路，SlashCommandDef 关联），菜单关闭 | import: @floatboat/nexus-plugin-slash; API: menu.run(index: number); 框架: vitest; 等待: 无 |
| 4 | 断言关闭态 | [STATE] 关闭后 `menu.element.style.display === "none"`（hide() 置 display none，menu-ui.ts:270-272）——若编辑器侧 emit isOpen=false 亦触发同一 hide 路径 | import: @floatboat/nexus-plugin-slash; API: expect(menu.element.style.display).toBe("none"); 框架: vitest; 等待: 无 |

**断言汇总**:
- [STATE] 打开 → `display === "block"`；选中 → 高亮项 `aria-selected === "true"`；关闭 → `display === "none"`
- [EVENT] 全程由编辑器 slashMenuChange 事件驱动（menu-ui.ts:445 订阅），宿主仅渲染

---

## 增强信息来源
- 事件发射: packages/core/src/editor.ts + event-emitter.ts
- 状态计算: packages/core/src/slash-state.ts
- 类型定义: packages/core/src/types.ts
- 测试参考: packages/core/test/events.test.ts + slash-state.test.ts + packages/plugin-slash/test/menu-ui.test.ts
- 宿主渲染: packages/plugin-slash/src/menu-ui.ts + index.ts
- 陷阱提示: AGENTS.md
# @floatboat/nexus-plugin-slash

Slash-command primitives for [Nexus-Editor](https://github.com/floatboat/nexus-editor):

- **State helpers** — pure functions that compute the menu state for a
  document + caret, ranked and capped.
- **Plugin factory** — wraps an arbitrary command catalogue as a
  `NexusPlugin`.
- **Floating menu UI** — `createSlashMenuUI(editor, options)`: a
  vanilla-DOM popover that subscribes to `slashMenuChange` and handles
  keyboard, mouse, IME, and ARIA on your behalf.

## Install

```bash
pnpm add @floatboat/nexus-plugin-slash @floatboat/nexus-core
```

## Register commands

```ts
import { createEditor } from "@floatboat/nexus-core";
import { createSlashPlugin, createSlashMenuUI } from "@floatboat/nexus-plugin-slash";

const editor = createEditor({
  container,
  plugins: [
    createSlashPlugin([
      {
        id: "h1",
        title: "Heading 1",
        keywords: ["h1", "title"],
        description: "Big section heading",
        run: (e) => {
          e.replaceSelection("# ");
          return true;
        },
      },
      {
        id: "todo",
        title: "Todo item",
        keywords: ["task", "checkbox"],
        run: (e) => {
          e.replaceSelection("- [ ] ");
          return true;
        },
      },
    ]),
  ],
});

// Mounts a floating menu on document.body that opens on `/`.
const menu = createSlashMenuUI(editor);

// Later, when tearing down:
menu.destroy();
```

## Ranking

`filterSlashCommands(commands, query)` ranks candidates deterministically:

1. exact title match
2. title prefix (shorter title wins)
3. exact keyword match
4. title substring (earlier offset wins)
5. keyword prefix
6. keyword substring

Ties break alphabetically by title. Empty queries preserve the original
registration order so you can curate "most useful first" via plugin
order.

## Limit

`computeSlashState(doc, cursor, commands, { limit })` caps the result at
`limit` (default `8`) **after** ranking. The same default flows through
`EditorConfig.slashMenuLimit` so you can configure it once per editor:

```ts
createEditor({ ..., slashMenuLimit: 5 });
```

## Headless usage

If you want to render the menu yourself (e.g. as a React component),
skip `createSlashMenuUI` and listen to the event directly:

```ts
editor.on("slashMenuChange", (state) => {
  if (!state.isOpen) return hide();
  renderAt(state.coords, state.commands);
});
```

`state.commands` is already ranked and capped — just render and bind
your own keyboard handlers.

## API reference

| Export | Purpose |
|---|---|
| `createSlashPlugin(commands)` | Wraps a command list as a `NexusPlugin`. |
| `createSlashMenuUI(editor, options?)` | Mount a floating menu UI. |
| `filterSlashCommands(commands, query)` | Rank + filter a command list. |
| `getSlashState(doc, cursor, commands, options?)` | Compute the full menu state. Alias of `computeSlashState`. |
| `getSlashMatch(doc, cursor)` | Detect the current `/query` trigger range. |
| `SlashMenuUIOptions` | `{ container?, onCommand?, classPrefix?, offset? }` |

See [`docs/ROADMAP.md`](../../docs/ROADMAP.md) for upcoming items
including history (#16) and fuzzy matching (#17).


## 中文使用示例

### 基础用法

在编辑器中使用 Slash 命令菜单：

```typescript
import { createEditor } from "@floatboat/nexus-core";
import { createSlashPlugin, createSlashMenuUI } from "@floatboat/nexus-plugin-slash";

const editor = createEditor({
  container: document.getElementById("editor")!,
  plugins: [
    createSlashPlugin([
      {
        id: "h1",
        title: "标题 1",
        keywords: ["h1", "标题"],
        description: "一级标题",
        run: (e) => {
          e.replaceSelection("# ");
          return true;
        },
      },
      {
        id: "bold",
        title: "加粗",
        keywords: ["bold", "粗体"],
        description: "加粗文本",
        run: (e) => {
          e.replaceSelection("**文本**");
          return true;
        },
      },
      {
        id: "todo",
        title: "待办事项",
        keywords: ["task", "任务", "checkbox"],
        description: "插入复选框",
        run: (e) => {
          e.replaceSelection("- [ ] ");
          return true;
        },
      },
    ]),
  ],
});

// 挂载浮动菜单
const menu = createSlashMenuUI(editor);
```

### 自定义命令

你可以根据自己的需求添加自定义命令：

```typescript
import { createEditor } from "@floatboat/nexus-core";
import { createSlashPlugin, createSlashMenuUI } from "@floatboat/nexus-plugin-slash";

const editor = createEditor({
  container: document.getElementById("editor")!,
  plugins: [
    createSlashPlugin([
      {
        id: "insert-date",
        title: "插入日期",
        keywords: ["date", "日期", "today"],
        description: "插入当前日期",
        run: (e) => {
          const date = new Date().toLocaleDateString("zh-CN");
          e.replaceSelection(date);
          return true;
        },
      },
      {
        id: "insert-time",
        title: "插入时间",
        keywords: ["time", "时间", "now"],
        description: "插入当前时间",
        run: (e) => {
          const time = new Date().toLocaleTimeString("zh-CN");
          e.replaceSelection(time);
          return true;
        },
      },
    ]),
  ],
});

const menu = createSlashMenuUI(editor);
```

### 过滤与排序

`filterSlashCommands(commands, query)` 按确定性规则排序：

1. 标题精确匹配
2. 标题前缀匹配（短标题优先）
3. 关键词精确匹配
4. 标题子串匹配（偏移量靠前优先）
5. 关键词前缀匹配
6. 关键词子串匹配

平局时按标题字母序排列。空查询保留原始注册顺序，可通过插件顺序自定义"最常用优先"。

更多 API 详情请参考 [API 文档](./src/types.ts)。

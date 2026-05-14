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

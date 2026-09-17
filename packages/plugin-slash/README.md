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

## Highlighting

The menu marks the title characters the query matched with
`<mark class="nexus-slash-menu__match">` (prefix follows `classPrefix`), so a
fuzzy `/tbl` query renders **T**_a_**bl**_e_ while `textContent` stays exactly
`Table`. Only the title is highlighted — a command that is returned because one
of its *keywords* matched renders as plain text, since keywords are not part of
the rendered item. Style the hook with your own CSS:

```css
.nexus-slash-menu__match {
  background: transparent;
  color: var(--nexus-accent);
  font-weight: 600;
}
```

## Ranking

`filterSlashCommands(commands, query)` ranks candidates deterministically:

1. exact title match
2. title prefix (shorter title wins)
3. exact keyword match
4. title substring (earlier offset wins)
5. keyword prefix
6. keyword substring
7. fuzzy subsequence match (title or keyword), highest alignment score first

Ties break alphabetically by title. Empty queries preserve the original
registration order so you can curate "most useful first" via plugin
order.

Fuzzy matching is a fallback tier: it only adds commands that no literal tier
matched, so `/table` ranks exactly as it did before, while `/tbl` still finds
**Table**. Pass `rankSlashCommands(commands, query)` instead of
`filterSlashCommands` when you want the score, the matched field
(`title`/`keyword`), the matched text and the positions of every candidate:

```ts
import { rankSlashCommands } from "@floatboat/nexus-plugin-slash";

rankSlashCommands([{ id: "table", title: "Table" }], "tbl");
// [{ command, score: 65, field: "title", matchedText: "Table", positions: [0, 2, 3] }]
```

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
| `rankSlashCommands(commands, query)` | Rank a command list with match positions for highlighting. |
| `getSlashState(doc, cursor, commands, options?)` | Compute the full menu state. Alias of `computeSlashState`. |
| `getSlashMatch(doc, cursor)` | Detect the current `/query` trigger range. |
| `SlashMenuUIOptions` | `{ container?, onCommand?, classPrefix?, offset? }` |

See [`docs/ROADMAP.md`](../../docs/ROADMAP.md) for upcoming items.

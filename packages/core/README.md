# @floatboat/nexus-core

Headless CodeMirror 6 Markdown editor engine with AST-driven live preview.

## Install

```bash
pnpm add @floatboat/nexus-core
```

## Quick start

```ts
import { createEditor } from "@floatboat/nexus-core";

const editor = createEditor({
  container: document.getElementById("editor"),
  initialValue: "# Hello\n\nWorld",
});

editor.getDocument(); // "# Hello\n\nWorld"
editor.focus();
```

## API Reference

### createEditor(config)

Creates the editor instance. Returns `EditorAPI`.

### EditorConfig

| Field | Type | Default | Description |
|---|---|---|---|
| `container` | `HTMLElement` | required | Mount point |
| `initialValue` | `string` | `""` | Initial document content |
| `plugins` | `NexusPlugin[]` | `[]` | Feature plugins |
| `livePreview` | `boolean \| LivePreviewConfig` | `false` | Enable inline live preview |
| `theme` | `NexusTheme` | `lightTheme` | Theme preset |
| `tabSize` | `number` | `4` | Tab width in spaces |
| `readOnly` | `boolean` | `false` | Prevent edits |
| `direction` | `"ltr" \| "rtl"` | `"ltr"` | Text direction |
| `indentGuides` | `boolean` | `false` | Show indent guides |
| `onChange` | `(doc, ast) => void` | — | Change callback |
| `onFocus` / `onBlur` | `() => void` | — | Focus/blur callbacks |
| `onAssetUpload` | `(file) => Promise<string>` | — | Image upload handler |
| `parseDelayMs` | `number` | `0` | Debounce delay for parse pipeline |
| `slashMenuLimit` | `number` | `8` | Max slash menu results |

### EditorAPI

| Method | Description |
|---|---|
| `getDocument(): string` | Get current document text |
| `setDocument(next, opts?)` | Replace document. `opts.silent` skips onChange |
| `getSelection()` | Get primary selection `{ anchor, head }` |
| `setSelection(anchor, head?)` | Set selection. `head` defaults to `anchor` |
| `getAst(): Root` | Get current mdast AST |
| `getTableOfContents()` | Get heading TOC entries `[{ level, text, from, to }]` |
| `exportHTML(): string` | Export document as HTML |
| `setTheme(theme)` | Switch theme |
| `undo()` / `redo()` | Undo/redo last change |
| `focus()` / `blur()` | Focus/blur editor |
| `getCoordsAtPos(pos)` | Pixel coordinates of document position |
| `getDocumentStats()` | Get `{ characters, words, lines }` |
| `getSlashCommands()` | Get registered slash commands |
| `uploadAsset(file)` | Upload via configured asset handler |
| `runShortcut(key)` | Run a registered shortcut by key |
| `on(event, handler)` | Subscribe to editor event |
| `off(event, handler)` | Unsubscribe |
| `destroy()` | Tear down editor |

### Events

| Event | Payload |
|---|---|
| `change` | `(doc: string, ast: Root)` |
| `focus` / `blur` | `()` |
| `selectionChange` | `({ anchor, head })` |
| `slashMenuChange` | `(state: SlashMenuState)` |

### NexusPlugin

```ts
interface NexusPlugin {
  name: string;
  shortcuts?: Array<{ key: string; run: (editor: EditorAPI) => boolean }>;
  slashCommands?: SlashCommandDef[];
  remarkPlugins?: unified.Plugin[];
  cmExtensions?: Extension[];
  widgets?: WidgetDefinition[];
}
```

## Exports

| Export | Purpose |
|---|---|
| `createEditor` | Editor factory |
| `lightTheme` / `darkTheme` | Built-in themes |
| `createWikilinksPlugin` | Wiki-link extension |
| `markdownKeymap` | Markdown keybindings |
| `isTableEditing` | Check if table interaction is active |
| `enLocale` / `zhLocale` | Locale presets |
| `computeSlashState` / `filterSlashCommands` / `getSlashMatch` | Slash command state helpers |

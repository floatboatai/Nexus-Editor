# @floatboat/nexus-wc

Web Component wrapper for [Nexus-Editor](https://github.com/floatboatai/Nexus-Editor): one `<nexus-editor>` tag for plain HTML and for every framework that renders DOM.

## Install

```bash
pnpm add @floatboat/nexus-wc @floatboat/nexus-core @floatboat/nexus-preset-gfm
```

## Quick start

Registration is an explicit call — importing the package has no side effects, so it is safe in SSR code paths.

```html
<script type="module">
  import { defineNexusEditor } from "@floatboat/nexus-wc";

  defineNexusEditor(); // registers <nexus-editor>
</script>

<nexus-editor value="# Hello" live-preview tab-size="2"></nexus-editor>
```

The element mounts a CodeMirror instance into itself (light DOM) when it is connected, and destroys it when the element leaves the document. Reparenting the element (`appendChild` to a new parent) keeps the live editor; removing and re-inserting it recreates the editor with the last document text intact.

## Attributes

Scalar config only — HTML attributes carry strings. Boolean attributes follow the HTML convention: present means `true`, absent defers to the core default.

| Attribute | Type | Maps to `EditorConfig` |
|---|---|---|
| `value` | string | `initialValue` + controlled document (see below) |
| `readonly` | boolean | `readOnly` |
| `direction` | `"ltr"` \| `"rtl"` | `direction` |
| `tab-size` | integer | `tabSize` |
| `indent-guides` | boolean | `indentGuides` |
| `parse-delay-ms` | integer | `parseDelayMs` |
| `slash-menu-limit` | integer | `slashMenuLimit` |
| `live-preview` | boolean | `livePreview` |
| `multi-cursor` | boolean | `multiCursor` |

Malformed numbers (`tab-size="abc"`) are ignored so core defaults stay in charge — `NaN` never reaches `createEditor`.

## Properties

Rich config that attributes cannot express. An explicitly set property overrides the matching attribute.

| Property | Type |
|---|---|
| `value` | `string` — read/write, see controlled usage |
| `editor` | `EditorAPI \| null` — read-only escape hatch |
| `plugins` | `NexusPlugin[]` |
| `parser` | `ParserLike` |
| `theme` | `NexusTheme` |
| `locale` | `Partial<NexusLocale>` |
| `livePreview` | `boolean \| LivePreviewConfig` |
| `onAssetUpload` | `(file: File) => Promise<string \| null>` |

```js
const el = document.querySelector("nexus-editor");
el.plugins = [createGfmPreset()];
```

## Events

All events are `CustomEvent`s with `bubbles: true` and `composed: true`, so they can be handled by delegation at any ancestor.

| Event | `detail` |
|---|---|
| `nexus-ready` | `{ editor: EditorAPI }` |
| `nexus-change` | `{ markdown: string, ast: Root }` |
| `nexus-focus` | — |
| `nexus-blur` | — |

`nexus-ready` fires on every editor (re)creation — after the initial mount **and** after a config rebuild (below). Hosts that cache the `EditorAPI` must rebind on each `nexus-ready`; the previous instance is destroyed.

Lifecycle events dispatch synchronously, so an element already in the markup emits its first `nexus-ready` during the `defineNexusEditor()` call. Attach listeners before registering (or before appending the element) — or skip the race entirely by reading `el.editor`, which is non-null once mounted:

```js
const el = document.querySelector("nexus-editor");
el.addEventListener("nexus-ready", (event) => {
  api = event.detail.editor; // rebinds after every rebuild
});
defineNexusEditor();
```

## Controlled usage

Set the `value` property (or attribute) when the host owns the markdown string. External updates are applied with a silent `setDocument` — the editor does not echo a `nexus-change` for content the host just pushed in, so the usual controlled-input feedback loop cannot form. This is the same contract as the React `value` prop and the Vue `v-model`.

```js
el.addEventListener("nexus-change", (event) => {
  store.markdown = event.detail.markdown;
});
store.subscribe((markdown) => {
  el.value = markdown; // silent, no echo
});
```

## Config changes after mount

`createEditor` options have no runtime setters, so changing any config attribute (or rich property) on a mounted element rebuilds the editor: the current document and selection are preserved, focus is restored, and `nexus-ready` fires again with the fresh `EditorAPI`. Multiple writes in the same task coalesce into a single rebuild.

Undo history does not survive a rebuild — treat config flips as host-level actions (e.g. toggling `readonly` around a save), not per-keystroke state.

## Styling

The element renders in light DOM and defaults itself to `display: block` (only when no inline display is set). Style it like any block element:

```css
nexus-editor {
  min-height: 320px;
  border: 1px solid #ddd;
}
```

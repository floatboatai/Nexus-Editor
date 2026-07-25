# @floatboat/nexus-wc

Framework-agnostic bindings for [Nexus-Editor](https://github.com/floatboatai/Nexus-Editor): a `<nexus-editor>` custom element for direct embedding and a typed bridge for consumer-hosted iframe pages.

Use this package when embedding Nexus-Editor from vanilla JS, Web Components, or a framework without a dedicated binding (`@floatboat/nexus-react` and `@floatboat/nexus-vue` exist for React and Vue).

## Install

```bash
pnpm add @floatboat/nexus-wc @floatboat/nexus-core @floatboat/nexus-preset-gfm
```

## Quick start

```ts
import { defineNexusEditor } from "@floatboat/nexus-wc";

defineNexusEditor(); // registers <nexus-editor>, no-op if already registered
```

```html
<nexus-editor initial-value="# Hello"></nexus-editor>
```

```ts
const el = document.querySelector("nexus-editor");

el.addEventListener("nexus-ready", (event) => {
  console.log(event.detail.editor.getDocument());
});

el.addEventListener("nexus-change", (event) => {
  console.log(event.detail.doc);
});
```

The element mounts a real `EditorAPI` instance (from `@floatboat/nexus-core`) into an inner `div` on connect. A permanent disconnect destroys it after the current microtask; a synchronous move between DOM parents preserves the live instance and uncontrolled edits.

### Reading the instance

`.editor` is available **synchronously** once the element has connected, so the direct read is usually the simplest option:

```ts
document.body.append(el);
el.editor?.getDocument(); // ready
```

`nexus-ready` is dispatched on a microtask after the editor is created, so a listener attached immediately after `append()` (or after `defineNexusEditor()` upgrades declarative markup) still receives it. Only listeners attached later — in a `setTimeout`, or after an `await` — can miss the event; use `.editor` in that case.

### Layout

The element sets `display: block` through a zero-specificity `:where()` rule, so it lays out like `@floatboat/nexus-react`'s wrapper div without any boilerplate CSS. Any consumer rule wins over it. The element has no intrinsic height, so give it one where your layout needs it:

```css
nexus-editor {
  min-height: 300px;
}
```

## Controlled usage

Set the `value` property (or attribute) to make the parent own the markdown string. External updates are applied with a silent `setDocument` so the editor does not echo another `nexus-change` for the same content.

```ts
const el = document.querySelector("nexus-editor");
el.value = "# Hello";

el.addEventListener("nexus-change", (event) => {
  state.doc = event.detail.doc;
});

// Later, an external update:
el.value = state.doc;
```

Use `initial-value` instead when the editor should own edits after mount (uncontrolled).

| Mode | Attribute/property | Owner updates |
|------|---------------------|----------------|
| Controlled | `value` | Set `value`; keep it in sync via `nexus-change` |
| Uncontrolled | `initial-value` | Optional; editor owns edits until you call `EditorAPI` |

## Iframe bridge

Use the iframe entry points when the editor must run in a separate browsing context. The package supplies both ends of the bridge; the consuming application supplies and hosts the frame page.

Parent page:

```ts
import { connectNexusIframe } from "@floatboat/nexus-wc/iframe-parent";

const iframe = document.querySelector<HTMLIFrameElement>("#editor-frame")!;
const controller = connectNexusIframe(iframe, {
  targetOrigin: "https://editor.example.com",
  timeoutMs: 5_000,
});

await controller.ready;
await controller.setDocument("# Hello from the parent");
console.log(await controller.getDocument());

const unsubscribe = controller.onChange((doc) => console.log(doc));
await controller.focus();

// Later:
unsubscribe();
controller.destroy();
```

Consumer-hosted iframe page:

```ts
import { mountNexusIframeRuntime } from "@floatboat/nexus-wc/iframe-runtime";
import { createGfmPreset } from "@floatboat/nexus-preset-gfm";

const editor = mountNexusIframeRuntime({
  container: document.querySelector("#editor")!,
  allowedParentOrigin: "https://app.example.com",
  editorConfig: {
    initialValue: "# Waiting for the parent",
    plugins: [createGfmPreset()],
    livePreview: true,
  },
});
```

Both origins are required and must be exact origins such as `https://app.example.com`: wildcard (`*`), opaque, and path-bearing values are rejected. Discovery validates `event.source`, origin, protocol version, and a per-runtime id before transferring a dedicated `MessagePort`. If the iframe reloads, create a new controller. Plugins, parsers, themes, locales, and callbacks remain in the iframe's local `editorConfig`; they are never serialized across the boundary.

The bridge intentionally exposes only asynchronous ready/change, `getDocument`, silent `setDocument`, `focus`, and `destroy`. Code that needs the complete synchronous `EditorAPI` should run inside the iframe or use `<nexus-editor>` directly.

Bridge failures reject with `NexusIframeBridgeError`. Stable codes include `TIMEOUT`, `IFRAME_RELOADED`, `DESTROYED`, `MESSAGE_ERROR`, `REMOTE_ERROR`, and `COMPOSING`. A `COMPOSING` response means the iframe is in an active IME composition; no replacement was queued, so retry `setDocument` after composition ends.

## Attributes and properties

Everything except `value` is read once in `connectedCallback` — matching the mount-only creation effect used by `@floatboat/nexus-react`'s `useEditor`. Reconnecting the element (disconnect + reconnect) re-reads all of them.

| Name | Kind | Type | Notes |
|------|------|------|-------|
| `value` | attribute + property | `string` | Reactive; controlled document |
| `initial-value` | attribute | `string` | Uncontrolled seed document |
| `read-only` | attribute + property (`readOnly`) | boolean | |
| `tab-size` | attribute | `number` | |
| `direction` | attribute | `"ltr" \| "rtl"` | |
| `indent-guides` | attribute | boolean | |
| `live-preview` | attribute | boolean | Use the `livePreview` property for a full `LivePreviewConfig` |
| `multi-cursor` | attribute + property (`multiCursor`) | boolean | Enables multiple selection ranges at connect time |
| `slash-menu-limit` | attribute | `number` | |
| `parse-delay-ms` | attribute | `number` | |
| `plugins` | property | `NexusPlugin[]` | JS-only, no attribute equivalent |
| `parser` | property | `ParserLike` | JS-only |
| `theme` | property | `NexusTheme` | JS-only |
| `locale` | property | `Partial<NexusLocale>` | JS-only |
| `livePreview` | property | `boolean \| LivePreviewConfig` | Overrides the `live-preview` attribute |
| `onAssetUpload` | property | `(file: File) => Promise<string \| null>` | JS-only |
| `editor` | property (readonly) | `EditorAPI \| null` | `null` until `connectedCallback` runs |

## Events

All events are namespaced with a `nexus-` prefix to avoid colliding with native `change`/`focus`/`blur`. They bubble and are composed, so delegated listeners also work outside a consumer-owned shadow root.

| Event | Detail |
|-------|--------|
| `nexus-ready` | `{ editor: EditorAPI }` |
| `nexus-change` | `{ doc: string, ast: Root }` |
| `nexus-focus` | — |
| `nexus-blur` | — |
| `nexus-selectionchange` | selection snapshot (see `EditorEventMap["selectionChange"]`) |
| `nexus-slashmenuchange` | `SlashMenuState` |

## Custom tag names

`defineNexusEditor` accepts an optional tag name for apps that need to avoid a collision:

```ts
defineNexusEditor("my-nexus-editor");
```

Calling `defineNexusEditor` again for the same Nexus constructor is a no-op. If another component already owns the requested tag name, the helper throws so the collision cannot be mistaken for a successful registration.

## Manual verification

From the repository root, start the parent test bench and an optional cross-origin frame server in separate terminals:

```bash
pnpm --dir apps/electron-demo exec vite ../../packages/wc/manual --host 127.0.0.1 --port 5173 --strictPort
pnpm --dir apps/electron-demo exec vite ../../packages/wc/manual --host 127.0.0.1 --port 5174 --strictPort
```

Open `http://127.0.0.1:5173/?frameOrigin=http://127.0.0.1:5174` for the cross-origin case.

The complete Chinese checklist is in [`openspec/changes/add-wc-wrapper/manual-test.zh.md`](../../openspec/changes/add-wc-wrapper/manual-test.zh.md).

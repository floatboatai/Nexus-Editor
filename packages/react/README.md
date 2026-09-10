# @floatboat/nexus-react

React bindings for [Nexus-Editor](https://github.com/floatboatai/Nexus-Editor): `useEditor` and `<Editor />`.

## Install

```bash
pnpm add @floatboat/nexus-react @floatboat/nexus-core @floatboat/nexus-preset-gfm
```

## `<Editor />`

The component mounts a CodeMirror instance into an outer wrapper `div`. Editor options match `createEditor` (except `container`). Host styling and accessibility attributes are forwarded to that wrapper.

```tsx
import { Editor } from "@floatboat/nexus-react";
import type { EditorAPI } from "@floatboat/nexus-core";

export default function App() {
  return (
    <Editor
      className="nexus-host"
      style={{ minHeight: 320 }}
      data-testid="editor"
      initialValue="# Hello"
      onReady={(editor: EditorAPI) => {
        console.log(editor.getDocument());
      }}
      onChange={(doc) => console.log(doc)}
    />
  );
}
```

- **`onReady`** — called once after the editor is created on first mount.
- **Container props** — `className`, `style`, `id`, `role`, `data-*`, `aria-*`, and other standard `div` attributes (except `children` / `ref`).

## Controlled usage

Pass `value` and update it from `onChange` when the parent must own the markdown string (AI rewrite, file switch, form state).

```tsx
import { useState } from "react";
import { Editor } from "@floatboat/nexus-react";
import { createGfmPreset } from "@floatboat/nexus-preset-gfm";

export function ControlledNoteEditor() {
  const [value, setValue] = useState("# Hello");

  return (
    <Editor
      value={value}
      plugins={[createGfmPreset()]}
      onChange={(doc) => setValue(doc)}
    />
  );
}
```

External updates to `value` are applied with a silent `setDocument` so the editor does not echo another `onChange` for the same content.

## `useEditor`

For custom layouts, call the hook and attach `containerRef` to your own element:

```tsx
import { useEditor } from "@floatboat/nexus-react";

function CustomEditor() {
  const { containerRef, editor } = useEditor({
    initialValue: "# Hello",
    onReady: (instance) => instance.focus()
  });

  return <div ref={containerRef} className="nexus-host" />;
}
```

`editor` is `null` until the first mount completes; prefer `onReady` when you need the instance immediately after creation.

## Document snapshots

In a save or backup handler, capture the actual `editor` returned by `useEditor`, or the same `EditorAPI` instance received by `onReady`:

```tsx
async function save(signal?: AbortSignal) {
  if (!editor) return;
  const { markdown } = await editor.captureDocumentSnapshot({ signal });
  await persistMarkdown(markdown); // Supplied by your application.
}
```

Do not substitute the controlled `value`: it can lag behind debounced changes or table-cell input that has not blurred. The snapshot includes settled pending input without changing focus, selection, or undo history. File access, persistence, and handling save failures remain the host's responsibility.

Snapshots wait for composition and active table gestures to finish. There is no implicit timeout; pass an `AbortSignal` to bound a request. Handle `AbortError` when the signal is aborted or the component unmounts and destroys its editor.

Pass `includeRenderAst: true` only when a detached rendering AST is needed. It uses the remark rendering pipeline and installed transforms, not a custom `parser` or a copy of `getAst()`. Uncloneable transform output rejects the request; source-only snapshots skip this extra rendering parse.

## How external sync works

Controlled updates use core `setDocument(text, { silent: true })` so the editor does not emit a duplicate `onChange`. Logic lives in `src/controlled-document.ts` (unit-tested).

| Mode | Prop | Parent updates |
|------|------|----------------|
| Controlled | `value` | Pass new `value`; keep state in sync via `onChange` |
| Uncontrolled | `initialValue` | Optional; editor owns edits until you call `EditorAPI` |

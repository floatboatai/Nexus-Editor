# @floatboat/nexus-react

React bindings for Nexus Editor.

## Installation

```bash
pnpm add @floatboat/nexus-react @floatboat/nexus-core @floatboat/nexus-preset-gfm
```

## Uncontrolled usage

`initialValue` seeds the document once; the editor owns subsequent edits until you call `EditorAPI` methods.

```tsx
import { Editor } from "@floatboat/nexus-react";
import { createGfmPreset } from "@floatboat/nexus-preset-gfm";

export function NoteEditor() {
  return (
    <Editor
      initialValue="# Hello"
      plugins={[createGfmPreset()]}
      onChange={(doc) => console.log(doc)}
    />
  );
}
```

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

## `useEditor` hook

Same configuration as `<Editor />`, plus a container ref:

```tsx
const { containerRef, editor } = useEditor({
  value: markdown,
  onChange: (doc) => setMarkdown(doc),
  plugins: [createGfmPreset()]
});

return <div ref={containerRef} style={{ minHeight: 240 }} />;
```

`editor` is `null` until the first mount effect runs.

## How external sync works

Controlled updates use core `setDocument(text, { silent: true })` so the editor does not emit a duplicate `onChange`. Logic lives in `src/controlled-document.ts` (unit-tested).

| Mode | Prop | Parent updates |
|------|------|----------------|
| Controlled | `value` | Pass new `value`; keep state in sync via `onChange` |
| Uncontrolled | `initialValue` | Optional; editor owns edits until you call `EditorAPI` |

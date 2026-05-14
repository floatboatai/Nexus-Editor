# @floatboat/nexus-react

React bindings for [Nexus Editor](../../README.md).

## Installation

```bash
pnpm add @floatboat/nexus-react @floatboat/nexus-core
```

## Usage

### `<Editor />` component

```tsx
import { useRef } from "react";
import { Editor } from "@floatboat/nexus-react";
import type { EditorAPI } from "@floatboat/nexus-core";

function App() {
  const editorRef = useRef<EditorAPI>(null);

  return (
    <Editor
      ref={editorRef}
      initialValue="# Hello"
      className="my-editor"
      style={{ height: 400 }}
      onReady={(editor) => {
        // Called once after the editor is mounted and ready.
        editor.focus();
      }}
      onChange={(doc, ast) => {
        console.log(doc);
      }}
    />
  );
}
```

### `useEditor` hook

Use the hook directly when you need more control over the container element.

```tsx
import { useRef } from "react";
import { useEditor } from "@floatboat/nexus-react";

function App() {
  const { containerRef, editor } = useEditor({
    initialValue: "# Hello",
    onReady: (e) => e.focus(),
  });

  return (
    <div>
      <div ref={containerRef} />
      <button onClick={() => editor?.undo()}>Undo</button>
    </div>
  );
}
```

## API

### `EditorProps`

All props from `EditorConfig` (minus `container`) plus:

| Prop | Type | Description |
|---|---|---|
| `onReady` | `(editor: EditorAPI) => void` | Called once after the editor mounts. |
| `className` | `string` | CSS class applied to the container `<div>`. |
| `style` | `CSSProperties` | Inline styles applied to the container `<div>`. |
| `ref` | `Ref<EditorAPI>` | Forwarded ref — holds the `EditorAPI` instance after mount. |

### `UseEditorConfig`

Same as `EditorProps` without `className` and `style`.

### `UseEditorResult`

| Field | Type | Description |
|---|---|---|
| `containerRef` | `RefObject<HTMLDivElement>` | Attach to your container element. |
| `editor` | `EditorAPI \| null` | The editor instance, or `null` before mount. |

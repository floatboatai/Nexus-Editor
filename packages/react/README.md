# @floatboat/nexus-react

React bindings for [Nexus-Editor](https://github.com/floatboatai/Nexus-Editor): `useEditor` and `<Editor />`.

## Install

```bash
pnpm add @floatboat/nexus-react @floatboat/nexus-core
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

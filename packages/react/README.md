# @floatboat/nexus-react

React bindings for Nexus Editor.

## Install

```bash
pnpm add @floatboat/nexus-react @floatboat/nexus-core react react-dom
```

## Editor Component

```tsx
import { Editor } from "@floatboat/nexus-react";

function App() {
  return (
    <Editor
      initialValue="# Hello"
      className="my-editor"
      id="editor-main"
      onReady={(editor) => console.log(editor.getDocument())}
    />
  );
}
```

### EditorProps

Extends `UseEditorConfig` and `ContainerProps`.

| Prop | Type | Description |
|---|---|---|
| `initialValue` | `string` | Initial document content |
| `onReady` | `(editor: EditorAPI) => void` | Called when editor is created |
| `className` | `string` | Forwarded to container div |
| `id` | `string` | Forwarded to container div |
| `style` | `CSSProperties` | Forwarded to container div |
| `data-*` | `string` | Any data attributes forwarded to container |
| `plugins` | `NexusPlugin[]` | Feature plugins |
| ... | | All other `EditorConfig` options except `container` |

## useEditor Hook

```tsx
import { useEditor } from "@floatboat/nexus-react";

function MyEditor() {
  const { containerRef, editor } = useEditor({
    initialValue: "start",
    onReady: (ed) => ed.focus(),
  });

  useEffect(() => {
    if (editor) {
      editor.setDocument("updated");
    }
  }, [editor]);

  return <div ref={containerRef} />;
}
```

### UseEditorConfig

`Omit<EditorConfig, "container"> & { onReady?: (editor: EditorAPI) => void }`

### UseEditorResult

| Field | Type | Description |
|---|---|---|
| `containerRef` | `RefObject<HTMLDivElement>` | Attach to your mount div |
| `editor` | `EditorAPI \| null` | Editor instance (null until mounted) |

## Exports

| Export | Purpose |
|---|---|
| `Editor` | Full editor component |
| `useEditor` | Hook for custom integration |
| `EditorProps` | Component prop type |
| `UseEditorConfig` | Hook config type |
| `UseEditorResult` | Hook return type |
| `ContainerProps` | HTML attribute passthrough type |

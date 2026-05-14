# @floatboat/nexus-vue

Vue 3 bindings for [Nexus Editor](../../README.md).

## Installation

```bash
pnpm add @floatboat/nexus-vue @floatboat/nexus-core
```

## Usage

### `<Editor />` component

```vue
<script setup lang="ts">
import { ref } from "vue";
import { Editor } from "@floatboat/nexus-vue";
import type { EditorAPI } from "@floatboat/nexus-core";

const editorRef = ref();

function onReady(editor: EditorAPI) {
  // Called once after the editor is mounted and ready.
  editor.focus();
}

function getContent() {
  // Access the EditorAPI via the exposed ref.
  return editorRef.value?.editor.value?.getDocument();
}
</script>

<template>
  <Editor
    ref="editorRef"
    initial-value="# Hello"
    class-name="my-editor"
    @ready="onReady"
  />
</template>
```

### `useEditor` composable

Use the composable directly when you need more control over the container element.

```vue
<script setup lang="ts">
import { useEditor } from "@floatboat/nexus-vue";

const { containerRef, editor } = useEditor({
  initialValue: "# Hello",
  onReady: (e) => e.focus(),
});
</script>

<template>
  <div>
    <div ref="containerRef" />
    <button @click="editor?.undo()">Undo</button>
  </div>
</template>
```

## API

### `<Editor />` props

| Prop | Type | Description |
|---|---|---|
| `initialValue` | `string` | Initial markdown content. |
| `className` | `string` | CSS class applied to the container `<div>`. |

### `<Editor />` events

| Event | Payload | Description |
|---|---|---|
| `ready` | `EditorAPI` | Emitted once after the editor mounts. |

### Template ref

`editorRef.value.editor` is a `ShallowRef<EditorAPI | null>` — access the instance
via `editorRef.value.editor.value`.

### `UseEditorConfig`

All fields from `EditorConfig` (minus `container`) plus:

| Field | Type | Description |
|---|---|---|
| `onReady` | `(editor: EditorAPI) => void` | Called once after the editor mounts. |

### `UseEditorResult`

| Field | Type | Description |
|---|---|---|
| `containerRef` | `Ref<HTMLDivElement>` | Attach to your container element. |
| `editor` | `ShallowRef<EditorAPI \| null>` | The editor instance, or `null` before mount. |

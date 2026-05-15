# @floatboat/nexus-vue

Vue 3 bindings for Nexus Editor.

## Install

```bash
pnpm add @floatboat/nexus-vue @floatboat/nexus-core vue
```

## Editor Component

```vue
<script setup>
import { Editor } from "@floatboat/nexus-vue";

function onReady(editor) {
  console.log(editor.getDocument());
}
</script>

<template>
  <Editor
    initial-value="## Title"
    class="my-editor"
    id="editor-main"
    :on-ready="onReady"
  />
</template>
```

### Props

| Prop | Type | Description |
|---|---|---|
| `initialValue` | `string` | Initial document content |
| `onReady` | `(editor: EditorAPI) => void` | Called when editor is created |
| `class` | `string` | Forwarded to container div via attrs |
| `id` | `string` | Forwarded to container div via attrs |
| `style` | `string \| object` | Forwarded to container div via attrs |

All HTML attributes and custom `data-*` attributes are passed through to the container div. Plugin and config props are passed through `useEditor`.

## useEditor Composable

```vue
<script setup>
import { useEditor } from "@floatboat/nexus-vue";
import { onMounted } from "vue";

const { containerRef, editor } = useEditor({
  initialValue: "start",
  onReady: (ed) => ed.focus(),
});

onMounted(() => {
  editor.value?.setDocument("updated");
});
</script>

<template>
  <div ref="containerRef" />
</template>
```

### UseEditorConfig

`Omit<EditorConfig, "container"> & { onReady?: (editor: EditorAPI) => void }`

### UseEditorResult

| Field | Type | Description |
|---|---|---|
| `containerRef` | `Ref<HTMLDivElement \| null>` | Template ref for mount div |
| `editor` | `ShallowRef<EditorAPI \| null>` | Editor instance (null until mounted) |

## Exports

| Export | Purpose |
|---|---|
| `Editor` | Full editor component |
| `useEditor` | Composable for custom integration |
| `UseEditorConfig` | Composable config type |
| `UseEditorResult` | Composable return type |

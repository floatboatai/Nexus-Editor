# @floatboat/nexus-vue

Vue 3 bindings for [Nexus-Editor](https://github.com/floatboatai/Nexus-Editor): `useEditor` and `<Editor />`.

## Install

```bash
pnpm add @floatboat/nexus-vue @floatboat/nexus-core
```

## `<Editor />`

The component mounts a CodeMirror instance into an outer wrapper `div`. Editor options are declared as component props; host styling and accessibility attributes use fallthrough attrs on the same wrapper.

```vue
<script setup lang="ts">
import { Editor } from "@floatboat/nexus-vue";
import type { EditorAPI } from "@floatboat/nexus-core";

function handleReady(editor: EditorAPI) {
  console.log(editor.getDocument());
}
</script>

<template>
  <Editor
    class="nexus-host"
    style="min-height: 320px"
    data-testid="editor"
    initial-value="# Hello"
    :on-ready="handleReady"
    :on-change="(doc) => console.log(doc)"
  />
</template>
```

- **`onReady`** — called once after the editor is created on first mount (prop: `on-ready` / `:onReady`).
- **Container attrs** — `class`, `style`, `id`, `role`, `data-*`, `aria-*`, and other non-prop attributes on `<Editor>`.

## `useEditor`

For custom layouts, call the composable and bind `containerRef` to your own element:

```vue
<script setup lang="ts">
import { useEditor } from "@floatboat/nexus-vue";

const { containerRef, editor } = useEditor({
  initialValue: "# Hello",
  onReady: (instance) => instance.focus()
});
</script>

<template>
  <div ref="containerRef" class="nexus-host" />
</template>
```

`editor` stays `null` until the first mount completes; prefer `onReady` when you need the instance right after creation.

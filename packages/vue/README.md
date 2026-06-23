# @floatboat/nexus-vue

Vue 3 bindings for [Nexus-Editor](https://github.com/floatboatai/Nexus-Editor): `useEditor` and `<Editor />`.

## Install

```bash
pnpm add @floatboat/nexus-vue @floatboat/nexus-core @floatboat/nexus-preset-gfm
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

## Controlled usage (`v-model`)

```vue
<script setup>
import { ref } from "vue";
import { Editor } from "@floatboat/nexus-vue";
import { createGfmPreset } from "@floatboat/nexus-preset-gfm";

const markdown = ref("# Hello");
</script>

<template>
  <Editor v-model="markdown" :plugins="[createGfmPreset()]" />
</template>
```

External updates to `modelValue` sync into the editor with a silent `setDocument` to avoid feedback loops.

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

For controlled `v-model`, pass a getter (or `computed`) so `modelValue` changes are observed after mount:

```vue
<script setup>
import { ref } from "vue";
import { useEditor } from "@floatboat/nexus-vue";
import { createGfmPreset } from "@floatboat/nexus-preset-gfm";

const markdown = ref("# Hello");

const { containerRef, editor } = useEditor(() => ({
  modelValue: markdown.value,
  onChange: (doc) => {
    markdown.value = doc;
  },
  plugins: [createGfmPreset()]
}));
</script>

<template>
  <div ref="containerRef" style="min-height: 240px" />
</template>
```

`editor` stays `null` until the first mount completes; prefer `onReady` when you need the instance right after creation.

## How external sync works

Silent `setDocument` for external `modelValue` changes; user edits emit `onChange` / `update:modelValue`. See `src/controlled-document.ts` (unit-tested).

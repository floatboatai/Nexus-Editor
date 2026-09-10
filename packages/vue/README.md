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

`editor.value` is `null` until the first mount completes; prefer `onReady` when you need the instance right after creation.

## Document snapshots

In a save or backup handler, capture the actual instance in the composable's `editor.value`, or the same `EditorAPI` received by `onReady`:

```ts
async function save(signal?: AbortSignal) {
  const instance = editor.value;
  if (!instance) return;
  const { markdown } = await instance.captureDocumentSnapshot({ signal });
  await persistMarkdown(markdown); // Supplied by your application.
}
```

Do not substitute `modelValue` or the parent's `v-model` value: either can lag behind debounced changes or table-cell input that has not blurred. The snapshot includes settled pending input without changing focus, selection, or undo history. File access, persistence, and handling save failures remain the host's responsibility.

Snapshots wait for composition and active table gestures to finish. There is no implicit timeout; pass an `AbortSignal` to bound a request. Handle `AbortError` when the signal is aborted or the component unmounts and destroys its editor.

Pass `includeRenderAst: true` only when a detached rendering AST is needed. It uses the remark rendering pipeline and installed transforms, not a custom `parser` or a copy of `getAst()`. Uncloneable transform output rejects the request; source-only snapshots skip this extra rendering parse.

## How external sync works

Silent `setDocument` for external `modelValue` changes; user edits emit `onChange` / `update:modelValue`. See `src/controlled-document.ts` (unit-tested).

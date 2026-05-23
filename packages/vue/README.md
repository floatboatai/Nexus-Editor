# @floatboat/nexus-vue

Vue 3 bindings for Nexus Editor.

## Installation

```bash
pnpm add @floatboat/nexus-vue @floatboat/nexus-core @floatboat/nexus-preset-gfm
```

## Uncontrolled usage

```vue
<script setup>
import { Editor } from "@floatboat/nexus-vue";
import { createGfmPreset } from "@floatboat/nexus-preset-gfm";
</script>

<template>
  <Editor
    initial-value="# Hello"
    :plugins="[createGfmPreset()]"
    @change="(doc) => console.log(doc)"
  />
</template>
```

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

## `useEditor` composable

```vue
<script setup>
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

Pass a getter (or `computed`) so `modelValue` changes are observed after mount.

## How external sync works

Same as React: silent `setDocument` for external `modelValue` changes; user edits emit `onChange` / `update:modelValue`. See `src/controlled-document.ts` (unit-tested).

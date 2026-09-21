# Vue 3 `v-model` 示例

本示例演示如何在 Vue 3 项目中使用 `@floatboat/nexus-vue` 的 `<Editor />` 组件，并通过 `v-model` 实现 Markdown 内容与组件状态的双向绑定。

## 完整代码

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { Editor } from '@floatboat/nexus-vue'
import { createGfmPreset } from '@floatboat/nexus-preset-gfm'

const markdown = ref<string>('# Hello, Nexus 👋\n\nStart typing...')

function handleChange(doc: string) {
  console.log('markdown changed:', doc)
}
</script>

<template>
  <div class="editor-wrapper">
    <Editor
      v-model="markdown"
      :plugins="[createGfmPreset()]"
      :live-preview="true"
      @change="handleChange"
    />
  </div>
</template>

<style scoped>
.editor-wrapper {
  min-height: 400px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 8px;
}
</style>
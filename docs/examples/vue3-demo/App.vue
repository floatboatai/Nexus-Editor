<script setup lang="ts">
import { ref } from 'vue'
import { Editor } from '@floatboat/nexus-vue'
import { createGfmPreset } from '@floatboat/nexus-preset-gfm'

const markdown = ref<string>('# Hello, Nexus 👋\n\nStart typing...')

function handleChange(doc: string) {
  console.log('markdown changed:', doc)
}

function handleReady(editor: any) {
  console.log('editor ready:', editor)
}
</script>

<template>
  <div class="editor-wrapper">
    <Editor
      v-model="markdown"
      :plugins="[createGfmPreset()]"
      :live-preview="true"
      @change="handleChange"
      @ready="handleReady"
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
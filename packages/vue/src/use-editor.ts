import { createEditor } from "@floatboat/nexus-core";
import { onBeforeUnmount, onMounted, ref, shallowRef } from "vue";

import type { UseEditorConfig, UseEditorResult } from "./types";

export function useEditor(config: UseEditorConfig): UseEditorResult {
  const containerRef = ref<HTMLDivElement | null>(null);
  const editor = shallowRef<ReturnType<typeof createEditor> | null>(null);
  const canUndo = ref(false);
  const canRedo = ref(false);

  const handleHistoryChange = (state: { canUndo: boolean; canRedo: boolean }) => {
    canUndo.value = state.canUndo;
    canRedo.value = state.canRedo;
  };

  onMounted(() => {
    if (!containerRef.value || editor.value) {
      return;
    }

    const instance = createEditor({
      container: containerRef.value,
      ...config,
    });

    // 同步初始状态
    canUndo.value = instance.canUndo();
    canRedo.value = instance.canRedo();

    instance.on("historyChange", handleHistoryChange);

    editor.value = instance;
  });

  onBeforeUnmount(() => {
    editor.value?.off("historyChange", handleHistoryChange);
    editor.value?.destroy();
    editor.value = null;
  });

  return {
    containerRef,
    editor,
    canUndo,
    canRedo,
  };
}

import { createEditor } from "@floatboat/nexus-core";
import type { Root } from "mdast";
import {
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  toValue,
  watch,
  type MaybeRefOrGetter
} from "vue";

import { resolveInitialDocument, shouldSyncControlledDocument } from "./controlled-document";
import type { UseEditorConfig, UseEditorResult } from "./types";

export function useEditor(config: MaybeRefOrGetter<UseEditorConfig>): UseEditorResult {
  const containerRef = ref<HTMLDivElement | null>(null);
  const editor = shallowRef<ReturnType<typeof createEditor> | null>(null);
  const lastSyncedDocRef = ref<string | null>(null);
  const syncRevision = ref(0);

  const resolveConfig = () => toValue(config);

  const buildCreateConfig = (
    container: HTMLDivElement,
    cfg: UseEditorConfig,
    onDocChange: (doc: string, ast: Root) => void
  ) => {
    const { modelValue, initialValue, onChange, onReady, onFocus, onBlur, onAssetUpload, ...rest } = cfg;

    const handleFocus = () => {
      resolveConfig().onFocus?.();
    };

    const handleBlur = () => {
      resolveConfig().onBlur?.();
    };

    const handleAssetUpload = (file: File): Promise<string | null> => {
      const fn = resolveConfig().onAssetUpload;
      return fn ? fn(file) : Promise.resolve(null);
    };

    return {
      container,
      ...rest,
      initialValue: resolveInitialDocument(modelValue, initialValue),
      onChange: onDocChange,
      onFocus: handleFocus,
      onBlur: handleBlur,
      onAssetUpload: handleAssetUpload
    };
  };

  onMounted(() => {
    if (!containerRef.value || editor.value) {
      return;
    }

    const current = resolveConfig();
    const onDocChange = (doc: string, ast: Root) => {
      lastSyncedDocRef.value = doc;
      syncRevision.value += 1;
      resolveConfig().onChange?.(doc, ast);
    };

    const instance = createEditor(buildCreateConfig(containerRef.value, current, onDocChange));
    editor.value = instance;

    lastSyncedDocRef.value = resolveInitialDocument(
      current.modelValue,
      current.initialValue
    );

    current.onReady?.(instance);
  });

  watch(
    () => resolveConfig().modelValue,
    (value) => {
      const instance = editor.value;

      if (!instance || value === undefined) {
        return;
      }

      if (!shouldSyncControlledDocument(value, lastSyncedDocRef.value)) {
        return;
      }

      instance.setDocument(value, { silent: true });
      lastSyncedDocRef.value = value;
      syncRevision.value += 1;
    }
  );

  onBeforeUnmount(() => {
    editor.value?.destroy();
    editor.value = null;
    lastSyncedDocRef.value = null;
  });

  return {
    containerRef,
    editor
  };
}

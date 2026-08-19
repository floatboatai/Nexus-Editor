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

function buildCreateConfig(
  container: HTMLDivElement,
  config: UseEditorConfig,
  onDocChange: (doc: string, ast: Root) => void
) {
  const { modelValue, initialValue, onChange, onReady, runtime: _runtime, ...rest } = config;

  return {
    container,
    ...rest,
    initialValue: resolveInitialDocument(modelValue, initialValue),
    onChange: onDocChange
  };
}

export function useEditor(config: MaybeRefOrGetter<UseEditorConfig>): UseEditorResult {
  const containerRef = ref<HTMLDivElement | null>(null);
  const editor = shallowRef<ReturnType<typeof createEditor> | null>(null);
  const lastSyncedDocRef = ref<string | null>(null);
  const syncRevision = ref(0);
  let runtimeAttachment: ReturnType<NonNullable<UseEditorConfig["runtime"]> extends never
    ? never
    : import("./types").EditorRuntimeBinding["attachEditor"]> | null = null;
  let ownedRuntime: import("./types").OwnedEditorRuntimeBinding | null = null;

  const resolveConfig = () => toValue(config);

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
    const ownership = current.runtime;
    const runtime = ownership?.kind === "owned"
      ? (ownedRuntime = ownership.createRuntime())
      : ownership?.runtime;
    runtimeAttachment = runtime?.attachEditor(instance, containerRef.value) ?? null;
    editor.value = instance;

    lastSyncedDocRef.value = resolveInitialDocument(
      current.modelValue,
      current.initialValue
    );

    current.onReady?.(instance);
  });

  watch(
    () => [resolveConfig().modelValue, syncRevision.value] as const,
    ([value]) => {
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
    const instance = editor.value;
    let detached: void | Promise<void>;
    try {
      detached = runtimeAttachment?.detach();
    } catch {
      detached = undefined;
    }
    instance?.destroy();
    if (ownedRuntime) {
      const runtime = ownedRuntime;
      void Promise.resolve(detached).then(
        () => runtime.dispose(),
        () => runtime.dispose()
      );
    }
    runtimeAttachment = null;
    ownedRuntime = null;
    editor.value = null;
    lastSyncedDocRef.value = null;
  });

  return {
    containerRef,
    editor
  };
}

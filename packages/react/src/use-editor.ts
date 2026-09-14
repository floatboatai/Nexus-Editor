import { createEditor } from "@floatboat/nexus-core";
import type { Root } from "mdast";
import { useEffect, useRef, useState } from "react";

import { resolveInitialDocument, shouldSyncControlledDocument } from "./controlled-document";
import type { EditorRuntimeAttachment, UseEditorConfig, UseEditorResult } from "./types";

function buildCreateConfig(
  container: HTMLDivElement,
  config: UseEditorConfig,
  onDocChange: (doc: string, ast: Root) => void
) {
  const { value, initialValue, onChange, onReady, runtime: _runtime, ...rest } = config;

  return {
    container,
    ...rest,
    initialValue: resolveInitialDocument(value, initialValue),
    onChange: onDocChange
  };
}

export function useEditor(config: UseEditorConfig): UseEditorResult {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<ReturnType<typeof createEditor> | null>(null);
  const [editor, setEditor] = useState<ReturnType<typeof createEditor> | null>(null);
  const [, setSyncRevision] = useState(0);
  const configRef = useRef(config);
  const lastSyncedDocRef = useRef<string | null>(null);

  configRef.current = config;

  useEffect(() => {
    const container = containerRef.current;

    if (!container || editorRef.current) {
      return;
    }

    const onDocChange = (doc: string, ast: Root) => {
      lastSyncedDocRef.current = doc;
      setSyncRevision((revision) => revision + 1);
      configRef.current.onChange?.(doc, ast);
    };

    const { onReady } = configRef.current;
    const instance = createEditor(buildCreateConfig(container, configRef.current, onDocChange));
    const ownership = configRef.current.runtime;
    const ownedRuntime = ownership?.kind === "owned"
      ? ownership.createRuntime()
      : null;
    const runtime = ownedRuntime ?? (ownership?.kind === "borrowed" ? ownership.runtime : undefined);
    let attachment: EditorRuntimeAttachment | undefined;
    try {
      attachment = runtime?.attachEditor(instance, container);
    } catch (attachError) {
      if (ownedRuntime) {
        try {
          void Promise.resolve(ownedRuntime.dispose()).catch(() => undefined);
        } catch {
          // Preserve the original attach failure.
        }
      }
      try {
        instance.destroy();
      } catch {
        // Preserve the original attach failure.
      }
      throw attachError;
    }

    lastSyncedDocRef.current = resolveInitialDocument(
      configRef.current.value,
      configRef.current.initialValue
    );

    editorRef.current = instance;
    setEditor(instance);
    onReady?.(instance);

    return () => {
      let detached: void | Promise<void>;
      try {
        detached = attachment?.detach();
      } catch {
        detached = undefined;
      }
      instance.destroy();
      if (ownedRuntime) {
        void Promise.resolve(detached).then(
          () => ownedRuntime.dispose(),
          () => ownedRuntime.dispose()
        );
      }
      editorRef.current = null;
      setEditor(null);
      lastSyncedDocRef.current = null;
    };
  }, []);

  useEffect(() => {
    const instance = editorRef.current;
    const { value } = config;

    if (!instance || value === undefined) {
      return;
    }

    if (!shouldSyncControlledDocument(value, lastSyncedDocRef.current)) {
      return;
    }

    instance.setDocument(value, { silent: true });
    lastSyncedDocRef.current = value;
    setSyncRevision((revision) => revision + 1);
  }, [config.value, editor]);

  return {
    containerRef,
    editor
  };
}

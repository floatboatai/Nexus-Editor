import { createEditor } from "@floatboat/nexus-core";
import { useEffect, useRef, useState } from "react";

import { toCreateEditorConfig } from "./editor-config";
import type { UseEditorConfig, UseEditorResult } from "./types";

export function useEditor(config: UseEditorConfig): UseEditorResult {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<ReturnType<typeof createEditor> | null>(null);
  const [editor, setEditor] = useState<ReturnType<typeof createEditor> | null>(null);
  const configRef = useRef(config);

  configRef.current = config;

  useEffect(() => {
    const container = containerRef.current;

    if (!container || editorRef.current) {
      return;
    }

    const { onReady } = configRef.current;
    const instance = createEditor({
      container,
      ...toCreateEditorConfig(configRef.current)
    });

    editorRef.current = instance;
    setEditor(instance);
    onReady?.(instance);

    return () => {
      instance.destroy();
      editorRef.current = null;
      setEditor(null);
    };
  }, []);

  return {
    containerRef,
    editor
  };
}

import { createEditor } from "@floatboat/nexus-core";
import { useEffect, useRef, useState } from "react";

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

    const instance = createEditor({
      container,
      ...configRef.current
    });

    editorRef.current = instance;
    setEditor(instance);

    // Call onReady callback if provided
    configRef.current.onReady?.(instance);

    return () => {
      instance.destroy();
      editorRef.current = null;
    };
  }, []);

  return {
    containerRef,
    editor
  };
}

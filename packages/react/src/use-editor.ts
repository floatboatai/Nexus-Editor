import { createEditor } from "@floatboat/nexus-core";
import { useCallback, useEffect, useRef, useState } from "react";

import type { UseEditorConfig, UseEditorResult } from "./types";

export function useEditor(config: UseEditorConfig): UseEditorResult {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<ReturnType<typeof createEditor> | null>(null);
  const [editor, setEditor] = useState<ReturnType<typeof createEditor> | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const configRef = useRef(config);

  configRef.current = config;

  const handleHistoryChange = useCallback(
    (state: { canUndo: boolean; canRedo: boolean }) => {
      setCanUndo(state.canUndo);
      setCanRedo(state.canRedo);
    },
    [],
  );

  useEffect(() => {
    const container = containerRef.current;

    if (!container || editorRef.current) {
      return;
    }

    const instance = createEditor({
      container,
      ...configRef.current,
    });

    // 同步初始状态——刚创建时 canUndo/canRedo 都是 false，
    // 但如果 history 插件在初始值之后立即创建了 undo 条目，
    // 我们需要读取真实状态。
    setCanUndo(instance.canUndo());
    setCanRedo(instance.canRedo());

    instance.on("historyChange", handleHistoryChange);

    editorRef.current = instance;
    setEditor(instance);

    return () => {
      instance.off("historyChange", handleHistoryChange);
      instance.destroy();
      editorRef.current = null;
    };
  }, [handleHistoryChange]);

  return {
    containerRef,
    editor,
    canUndo,
    canRedo,
  };
}

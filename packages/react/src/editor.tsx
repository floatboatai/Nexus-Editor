import { useEffect, useMemo, useRef } from "react";

import { useEditor } from "./use-editor";

import type { EditorAPI } from "@floatboat/nexus-core";
import type { EditorProps } from "./types";

/**
 * Keys that belong to the editor engine / lifecycle. They are stripped from
 * the props object before the remainder is spread onto the container `<div>`.
 *
 * Keep in sync with {@link EditorConfig} + the `onReady` lifecycle prop.
 */
const EDITOR_PROP_KEYS = new Set<string>([
  "initialValue",
  "parser",
  "parseDelayMs",
  "livePreview",
  "plugins",
  "theme",
  "locale",
  "tabSize",
  "direction",
  "indentGuides",
  "readOnly",
  "slashMenuLimit",
  "onChange",
  "onFocus",
  "onBlur",
  "onAssetUpload",
  "onReady",
]);

export function Editor({ onReady, ...props }: EditorProps) {
  const containerProps = useMemo(() => {
    const rest: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(props)) {
      if (!EDITOR_PROP_KEYS.has(key)) {
        rest[key] = value;
      }
    }
    return rest as React.HTMLAttributes<HTMLDivElement>;
  }, [props]);

  const { containerRef, editor } = useEditor(props);

  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const firedRef = useRef(false);

  useEffect(() => {
    if (editor && !firedRef.current) {
      firedRef.current = true;
      onReadyRef.current?.(editor);
    }
  }, [editor]);

  return <div {...containerProps} ref={containerRef} />;
}

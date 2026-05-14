import { forwardRef, useImperativeHandle } from "react";

import type { EditorAPI } from "@floatboat/nexus-core";
import type { EditorProps } from "./types";
import { useEditor } from "./use-editor";

export const Editor = forwardRef<EditorAPI, EditorProps>(function Editor(
  { className, style, ...config },
  ref
) {
  const { containerRef, editor } = useEditor(config);

  useImperativeHandle(ref, () => editor as EditorAPI, [editor]);

  return <div ref={containerRef} className={className} style={style} />;
});

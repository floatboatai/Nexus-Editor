import { useEditor } from "./use-editor";

import type { EditorComponentProps } from "./types";

export function Editor({ className, style, ...editorConfig }: EditorComponentProps) {
  const { containerRef } = useEditor(editorConfig);

  return <div ref={containerRef} className={className} style={style} />;
}
